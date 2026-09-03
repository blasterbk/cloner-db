package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mongoclone/engine/pkg/clone"
	"github.com/mongoclone/engine/pkg/jobs"
	mongopkg "github.com/mongoclone/engine/pkg/mongo"
	"github.com/mongoclone/engine/pkg/pitr"
	"github.com/mongoclone/engine/pkg/types"
	"github.com/mongoclone/engine/pkg/ws"
)

// loadEnvFile reads a .env file and sets environment variables (no external dependency needed)
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // .env is optional
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if os.Getenv(key) == "" { // don't override existing env vars
			os.Setenv(key, val)
		}
	}
}

func main() {
	// Load .env file from current working directory (backend root)
	loadEnvFile(".env")
	loadEnvFile("../.env") // also try repo root

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}

	store := jobs.NewStore(dataDir)
	hub := ws.NewHub()
	go hub.Run()

	// Seed default target profile from .env if set and not already saved
	defaultTargetURI := os.Getenv("DEFAULT_TARGET_URI")
	defaultTargetName := os.Getenv("DEFAULT_TARGET_NAME")
	if defaultTargetURI != "" {
		if defaultTargetName == "" {
			defaultTargetName = "Default Test Cluster"
		}
		existing := store.ListProfiles()
		found := false
		for _, p := range existing {
			if p.Type == "target" && p.Name == defaultTargetName {
				found = true
				break
			}
		}
		if !found {
			store.SaveProfile(defaultTargetName, "target", mongopkg.EndpointConfig{URI: defaultTargetURI})
			log.Printf("[env] Seeded default target profile: %s", defaultTargetName)
		}
	}

	orchestrator := clone.NewOrchestrator(store, hub, dataDir)

	mux := http.NewServeMux()

	// CORS Middleware Helper
	cors := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next(w, r)
		}
	}

	// 1. Health check
	mux.HandleFunc("/health", cors(func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"version": "1.0.0",
			"time":    time.Now().UTC().Format(time.RFC3339),
		})
	}))

	// 2. Test MongoDB Connection
	mux.HandleFunc("/api/v1/mongo/test-connection", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var cfg mongopkg.EndpointConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), cfg.GetTimeout())
		defer cancel()

		client, err := mongopkg.Connect(ctx, &cfg)
		if err != nil {
			jsonResponse(w, http.StatusOK, map[string]any{
				"success": false,
				"error":   err.Error(),
			})
			return
		}
		defer client.Disconnect(ctx) //nolint:errcheck

		info, err := mongopkg.InspectServer(ctx, client)
		if err != nil {
			jsonResponse(w, http.StatusOK, map[string]any{
				"success": false,
				"error":   err.Error(),
			})
			return
		}

		jsonResponse(w, http.StatusOK, map[string]any{
			"success":     true,
			"server_info": info,
			"masked_uri":  cfg.MaskedURI(),
		})
	}))

	// 3. Inspect Cluster Catalog (Databases, Collections, Indexes, Sizes)
	mux.HandleFunc("/api/v1/mongo/catalog", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Config           mongopkg.EndpointConfig `json:"config"`
			IncludeSystemDBs bool                    `json:"include_system_dbs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), req.Config.GetTimeout()+10*time.Second)
		defer cancel()

		client, err := mongopkg.Connect(ctx, &req.Config)
		if err != nil {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("Failed to connect: %v", err)})
			return
		}
		defer client.Disconnect(ctx) //nolint:errcheck

		catalog, err := mongopkg.InspectCatalog(ctx, client, req.IncludeSystemDBs)
		if err != nil {
			jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		jsonResponse(w, http.StatusOK, catalog)
	}))

	// 4. Inspect Oplog Window for Point-in-Time Recovery
	mux.HandleFunc("/api/v1/mongo/oplog-window", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var cfg mongopkg.EndpointConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), cfg.GetTimeout())
		defer cancel()

		client, err := mongopkg.Connect(ctx, &cfg)
		if err != nil {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("Failed to connect: %v", err)})
			return
		}
		defer client.Disconnect(ctx) //nolint:errcheck

		window, err := pitr.GetOplogWindow(ctx, client)
		if err != nil {
			jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		jsonResponse(w, http.StatusOK, window)
	}))

	// 4b. Overview of all saved connections (for the home page)
	mux.HandleFunc("/api/v1/mongo/connections/overview", cors(func(w http.ResponseWriter, r *http.Request) {
		profiles := store.ListProfiles()
		type ConnOverview struct {
			Profile      jobs.SavedProfile      `json:"profile"`
			Online       bool                   `json:"online"`
			ServerInfo   *mongopkg.ServerInfo   `json:"server_info,omitempty"`
			Catalog      *mongopkg.ClusterCatalog `json:"catalog,omitempty"`
			Error        string                 `json:"error,omitempty"`
		}

		results := make([]ConnOverview, len(profiles))
		var wg sync.WaitGroup

		for i, prof := range profiles {
			wg.Add(1)
			go func(idx int, p jobs.SavedProfile) {
				defer wg.Done()
				item := ConnOverview{
					Profile: p,
				}
				fastCfg := p.Config
				fastCfg.TimeoutMs = 800
				ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
				defer cancel()

				client, err := mongopkg.Connect(ctx, &fastCfg)
				if err != nil {
					item.Online = false
					item.Error = err.Error()
					results[idx] = item
					return
				}
				defer client.Disconnect(ctx) //nolint:errcheck

				info, err := mongopkg.InspectServer(ctx, client)
				if err != nil {
					item.Online = false
					item.Error = err.Error()
					results[idx] = item
					return
				}

				item.Online = true
				item.ServerInfo = info

				// Fetch lightweight catalog
				cat, err := mongopkg.InspectCatalog(ctx, client, false)
				if err == nil {
					item.Catalog = cat
				}

				results[idx] = item
			}(i, prof)
		}

		wg.Wait()
		jsonResponse(w, http.StatusOK, results)
	}))

	// 5. Jobs CRUD & Launch
	mux.HandleFunc("/api/v1/jobs", cors(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			list := store.ListJobs()
			jsonResponse(w, http.StatusOK, list)

		case "POST":
			var req types.CloneJobRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
				return
			}

			if len(req.Databases) == 0 {
				jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "At least one database mapping is required"})
				return
			}

			job := store.CreateJob(req)
			orchestrator.StartJob(job)

			jsonResponse(w, http.StatusAccepted, job.GetSnapshot())

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	// Specific Job Route (/api/v1/jobs/{id} and /api/v1/jobs/{id}/cancel)
	mux.HandleFunc("/api/v1/jobs/", cors(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/jobs/")
		parts := strings.Split(path, "/")
		jobID := parts[0]

		if jobID == "" {
			http.NotFound(w, r)
			return
		}

		// Cancel action: /api/v1/jobs/{id}/cancel
		if len(parts) > 1 && parts[1] == "cancel" {
			if r.Method != "POST" {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			cancelled := orchestrator.CancelJob(jobID)
			jsonResponse(w, http.StatusOK, map[string]bool{"cancelled": cancelled})
			return
		}

		if len(parts) > 1 && parts[1] == "resume" {
			if r.Method != "POST" {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			resumed, err := orchestrator.ResumeJob(jobID)
			if err != nil {
				jsonResponse(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			jsonResponse(w, http.StatusOK, map[string]bool{"resumed": resumed})
			return
		}

		switch r.Method {
		case "GET":
			job, found := store.GetJob(jobID)
			if !found {
				jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
				return
			}
			jsonResponse(w, http.StatusOK, job.GetSnapshot())

		case "DELETE":
			deleted := store.DeleteJob(jobID)
			jsonResponse(w, http.StatusOK, map[string]bool{"deleted": deleted})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	// 6. Profiles CRUD
	mux.HandleFunc("/api/v1/profiles", cors(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			list := store.ListProfiles()
			jsonResponse(w, http.StatusOK, list)

		case "POST":
			var req struct {
				Name   string                  `json:"name"`
				Type   string                  `json:"type"`
				Config mongopkg.EndpointConfig `json:"config"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
				return
			}
			profile := store.SaveProfile(req.Name, req.Type, req.Config)
			jsonResponse(w, http.StatusCreated, profile)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/api/v1/profiles/", cors(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/profiles/")
		switch r.Method {
		case "PUT", "POST":
			var req struct {
				Name   string                  `json:"name"`
				Config mongopkg.EndpointConfig `json:"config"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
				return
			}
			updated, ok := store.UpdateProfile(id, req.Name, req.Config)
			if !ok {
				jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Profile not found"})
				return
			}
			jsonResponse(w, http.StatusOK, updated)
			return

		case "DELETE":
			deleted := store.DeleteProfile(id)
			jsonResponse(w, http.StatusOK, map[string]bool{"deleted": deleted})
			return

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	// 7. WebSocket live progress endpoint
	mux.HandleFunc("/ws", hub.ServeHTTP)

	// 8. Static frontend file server (if built)
	frontendDist := filepath.Join("..", "frontend", "dist")
	if _, err := os.Stat(frontendDist); err == nil {
		fs := http.FileServer(http.Dir(frontendDist))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" || r.URL.Path == "/health" {
				http.NotFound(w, r)
				return
			}
			path := filepath.Join(frontendDist, r.URL.Path)
			if _, err := os.Stat(path); os.IsNotExist(err) {
				http.ServeFile(w, r, filepath.Join(frontendDist, "index.html"))
				return
			}
			fs.ServeHTTP(w, r)
		})
	}

	addr := fmt.Sprintf("0.0.0.0:%s", port)
	log.Printf("================================================================")
	log.Printf(" MongoClone Backend Engine listening on http://%s", addr)
	log.Printf(" WebSocket stream active on ws://%s/ws", addr)
	log.Printf("================================================================")

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
