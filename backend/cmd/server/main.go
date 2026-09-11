package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/mongoclone/engine/pkg/auth"
	"github.com/mongoclone/engine/pkg/clone"
	"github.com/mongoclone/engine/pkg/jobs"
	mongopkg "github.com/mongoclone/engine/pkg/mongo"
	"github.com/mongoclone/engine/pkg/pitr"
	"github.com/mongoclone/engine/pkg/types"
	"github.com/mongoclone/engine/pkg/ws"
	"github.com/mongoclone/engine/web"
)

// ─── Overview cache ───────────────────────────────────────────────────────────
// A lightweight TTL cache shared by both the batch and streaming overview
// endpoints. Profiles don't change every second; 30 s staleness is fine and
// removes ALL MongoDB round-trips on repeat page visits.

type connOverviewItem struct {
	Profile    jobs.SavedProfile        `json:"profile"`
	Online     bool                     `json:"online"`
	ServerInfo *mongopkg.ServerInfo     `json:"server_info,omitempty"`
	Catalog    *mongopkg.ClusterCatalog `json:"catalog,omitempty"`
	Error      string                   `json:"error,omitempty"`
}

var (
	overviewCacheMu      sync.RWMutex
	overviewCacheData    []connOverviewItem
	overviewCacheExpires time.Time
)

const overviewCacheTTL = 30 * time.Second

func getCachedOverview() ([]connOverviewItem, bool) {
	overviewCacheMu.RLock()
	defer overviewCacheMu.RUnlock()
	if overviewCacheData != nil && time.Now().Before(overviewCacheExpires) {
		return overviewCacheData, true
	}
	return nil, false
}

func setCachedOverview(items []connOverviewItem) {
	overviewCacheMu.Lock()
	defer overviewCacheMu.Unlock()
	overviewCacheData = items
	overviewCacheExpires = time.Now().Add(overviewCacheTTL)
}

func invalidateOverviewCache() {
	overviewCacheMu.Lock()
	defer overviewCacheMu.Unlock()
	overviewCacheData = nil
}

// loadOverviewItems connects to all profiles concurrently and returns results
// as they arrive via the returned channel. The caller must drain the channel.
func loadOverviewItems(ctx context.Context, profiles []jobs.SavedProfile) <-chan connOverviewItem {
	ch := make(chan connOverviewItem, len(profiles))
	var wg sync.WaitGroup
	for _, prof := range profiles {
		wg.Add(1)
		go func(p jobs.SavedProfile) {
			defer wg.Done()
			item := connOverviewItem{Profile: p}
			fastCfg := p.Config
			timeout := 4000 * time.Millisecond
			if fastCfg.TimeoutMs > 4000 {
				timeout = time.Duration(fastCfg.TimeoutMs) * time.Millisecond
			}
			fastCfg.TimeoutMs = int(timeout / time.Millisecond)
			pCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()

			client, err := mongopkg.Connect(pCtx, &fastCfg)
			if err != nil {
				item.Online = false
				item.Error = err.Error()
				ch <- item
				return
			}
			defer client.Disconnect(pCtx) //nolint:errcheck

			info, err := mongopkg.InspectServer(pCtx, client)
			if err != nil {
				item.Online = false
				item.Error = err.Error()
				ch <- item
				return
			}
			item.Online = true
			item.ServerInfo = info

			var dbHints []string
			if dbName := fastCfg.ExtractDatabaseName(); dbName != "" {
				dbHints = append(dbHints, dbName)
			}
			cat, err := mongopkg.InspectCatalog(pCtx, client, false, dbHints...)
			if err == nil {
				item.Catalog = cat
			}
			ch <- item
		}(prof)
	}
	go func() { wg.Wait(); close(ch) }()
	return ch
}

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
	startTime := time.Now()
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

	// Read performance tuning defaults from .env
	defaultBatchSize := 0
	if v := os.Getenv("DEFAULT_BATCH_SIZE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			defaultBatchSize = n
			log.Printf("[env] Default batch size: %d docs/batch", defaultBatchSize)
		}
	}
	defaultParallelWorkers := 0
	if v := os.Getenv("DEFAULT_PARALLEL_WORKERS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			defaultParallelWorkers = n
			log.Printf("[env] Default parallel workers: %d", defaultParallelWorkers)
		}
	}

	orchestrator := clone.NewOrchestrator(store, hub, dataDir, defaultBatchSize, defaultParallelWorkers)

	// Auth manager — credentials from .env (AUTH_USERNAME / AUTH_PASSWORD)
	// If AUTH_USERNAME is empty, all requests pass through without authentication.
	authMgr := auth.New(
		os.Getenv("AUTH_USERNAME"),
		os.Getenv("AUTH_PASSWORD"),
	)

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
			"status":         "ok",
			"version":        "1.0.0",
			"time":           time.Now().UTC().Format(time.RFC3339),
			"uptime_seconds": int64(time.Since(startTime).Seconds()),
			"store": map[string]any{
				"jobs": len(store.ListJobs()),
			},
		})
	}))

	// 2. Auth routes — always public (no auth middleware on these)
	mux.HandleFunc("/api/v1/auth/login", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
			return
		}
		token, ok := authMgr.Login(body.Username, body.Password)
		if !ok {
			log.Printf("[auth] Failed login attempt for username: %q (remote: %s)", body.Username, r.RemoteAddr)
			// Use 401 with a generic message to prevent username enumeration
			jsonResponse(w, http.StatusUnauthorized, map[string]string{"error": "Invalid username or password"})
			return
		}
		log.Printf("[auth] Login successful for username: %q (remote: %s)", body.Username, r.RemoteAddr)
		jsonResponse(w, http.StatusOK, map[string]string{"token": token})
	}))

	mux.HandleFunc("/api/v1/auth/logout", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		token := r.Header.Get("Authorization")
		if strings.HasPrefix(token, "Bearer ") {
			authMgr.Logout(strings.TrimPrefix(token, "Bearer "))
		}
		jsonResponse(w, http.StatusOK, map[string]string{"message": "Logged out successfully"})
	})))

	// 3. Test MongoDB Connection
	mux.HandleFunc("/api/v1/mongo/test-connection", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	// 3. Inspect Cluster Catalog (Databases, Collections, Indexes, Sizes)
	mux.HandleFunc("/api/v1/mongo/catalog", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
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

		catalog, err := mongopkg.InspectCatalog(ctx, client, req.IncludeSystemDBs, req.Config.ExtractDatabaseName())
		if err != nil {
			jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		jsonResponse(w, http.StatusOK, catalog)
	})))

	// 4. Inspect Oplog Window for Point-in-Time Recovery
	mux.HandleFunc("/api/v1/mongo/oplog-window", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
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
	})))

	// 4b. Overview of all saved connections — cache-aware batch endpoint
	// Returns immediately from cache when data is fresh (≤30 s old).
	mux.HandleFunc("/api/v1/mongo/connections/overview", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
		// Force-refresh requested by client (e.g. manual refresh button)
		forceRefresh := r.URL.Query().Get("refresh") == "1"
		if forceRefresh {
			invalidateOverviewCache()
		}

		// Serve from cache if still warm
		if cached, ok := getCachedOverview(); ok {
			w.Header().Set("X-Cache", "HIT")
			jsonResponse(w, http.StatusOK, cached)
			return
		}

		profiles := store.ListProfiles()
		results := make([]connOverviewItem, 0, len(profiles))
		for item := range loadOverviewItems(r.Context(), profiles) {
			results = append(results, item)
		}
		setCachedOverview(results)
		w.Header().Set("X-Cache", "MISS")
		jsonResponse(w, http.StatusOK, results)
	})))

	// 4c. NDJSON streaming overview — flushes each profile result the instant its
	// goroutine finishes so the frontend can render cards progressively.
	// Served from cache when warm; otherwise streams live and populates cache.
	mux.HandleFunc("/api/v1/mongo/connections/overview/stream", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
		forceRefresh := r.URL.Query().Get("refresh") == "1"
		if forceRefresh {
			invalidateOverviewCache()
		}

		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering

		flusher, canFlush := w.(http.Flusher)

		// Cache hit: stream all items in one shot from memory
		if cached, ok := getCachedOverview(); ok {
			w.Header().Set("X-Cache", "HIT")
			for _, item := range cached {
				data, err := json.Marshal(item)
				if err != nil {
					continue
				}
				fmt.Fprintf(w, "%s\n", data)
				if canFlush {
					flusher.Flush()
				}
			}
			return
		}

		// Cache miss: stream live results as goroutines complete
		w.Header().Set("X-Cache", "MISS")
		profiles := store.ListProfiles()
		collected := make([]connOverviewItem, 0, len(profiles))

		for item := range loadOverviewItems(r.Context(), profiles) {
			data, err := json.Marshal(item)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "%s\n", data)
			if canFlush {
				flusher.Flush()
			}
			collected = append(collected, item)
		}

		// Populate cache so the next visit (batch or stream) is instant
		if len(collected) > 0 {
			setCachedOverview(collected)
		}
	})))

	// 5. Jobs CRUD & Launch
	mux.HandleFunc("/api/v1/jobs", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
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

			jsonResponse(w, http.StatusAccepted, job.GetSafeSnapshot())

		case "DELETE":
			// Bulk delete: {"ids": ["id1","id2",...]} OR clear-all: {"clear_all": true}
			var body struct {
				IDs      []string `json:"ids"`
				ClearAll bool     `json:"clear_all"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
				return
			}
			if body.ClearAll {
				cleared := store.ClearAllJobs()
				jsonResponse(w, http.StatusOK, map[string]any{"cleared": cleared})
				return
			}
			if len(body.IDs) == 0 {
				jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Provide 'ids' array or set 'clear_all' to true"})
				return
			}
			deleted := store.DeleteJobsBulk(body.IDs)
			jsonResponse(w, http.StatusOK, map[string]any{"deleted": deleted})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})))

	// Specific Job Route (/api/v1/jobs/{id} and /api/v1/jobs/{id}/cancel)
	mux.HandleFunc("/api/v1/jobs/", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
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

		// Pause action: /api/v1/jobs/{id}/pause
		if len(parts) > 1 && parts[1] == "pause" {
			if r.Method != "POST" {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			paused := orchestrator.PauseJob(jobID)
			jsonResponse(w, http.StatusOK, map[string]bool{"paused": paused})
			return
		}

		// Resume action: /api/v1/jobs/{id}/resume
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
			jsonResponse(w, http.StatusOK, job.GetSafeSnapshot())

		case "DELETE":
			deleted := store.DeleteJob(jobID)
			jsonResponse(w, http.StatusOK, map[string]bool{"deleted": deleted})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})))

	// 6. Profiles CRUD — stored in data/profiles.json (no MongoDB required)
	mux.HandleFunc("/api/v1/profiles", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
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
			if strings.TrimSpace(req.Name) == "" {
				jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Profile name is required"})
				return
			}
			profile := store.SaveProfile(req.Name, req.Type, req.Config)
			jsonResponse(w, http.StatusCreated, profile)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})))

	mux.HandleFunc("/api/v1/profiles/", cors(authMgr.Middleware(func(w http.ResponseWriter, r *http.Request) {
		rawID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/profiles/"), "/")
		id, _ := url.PathUnescape(rawID)
		id = strings.TrimSpace(id)

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

		case "DELETE":
			deleted := store.DeleteProfile(id)
			jsonResponse(w, http.StatusOK, map[string]bool{"deleted": deleted})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})))

	// 7. WebSocket live progress endpoint
	// Auth via ?token= query parameter (browsers can't set headers on WebSocket connections)
	mux.HandleFunc("/ws", authMgr.Middleware(hub.ServeHTTP))

	// 8. Static frontend file server (Embedded with fallback to disk)
	var frontendFS fs.FS
	var frontendSource string

	if web.HasEmbedded() {
		frontendFS = web.GetFS()
		frontendSource = "embedded binary assets"
	} else {
		// Fallback check on local disk
		candidates := []string{
			filepath.Join("..", "frontend", "dist"),
			"web",
			"dist",
		}
		for _, dir := range candidates {
			if _, err := os.Stat(filepath.Join(dir, "index.html")); err == nil {
				frontendFS = os.DirFS(dir)
				frontendSource = fmt.Sprintf("disk folder (%s)", dir)
				break
			}
		}
	}

	if frontendFS != nil {
		fileServer := http.FileServer(http.FS(frontendFS))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" || r.URL.Path == "/health" {
				http.NotFound(w, r)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}

			reqPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
			if reqPath == "" || reqPath == "." {
				reqPath = "index.html"
			}

			// Check if file exists in filesystem
			f, err := frontendFS.Open(reqPath)
			if err != nil {
				// SPA fallback to index.html for client-side routing
				indexContent, readErr := fs.ReadFile(frontendFS, "index.html")
				if readErr != nil {
					http.NotFound(w, r)
					return
				}
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(indexContent)
				return
			}

			stat, statErr := f.Stat()
			_ = f.Close()
			if statErr == nil && stat.IsDir() {
				// Directory requested, serve index.html
				indexContent, readErr := fs.ReadFile(frontendFS, "index.html")
				if readErr == nil {
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write(indexContent)
					return
				}
			}

			fileServer.ServeHTTP(w, r)
		})
		log.Printf("[frontend] Serving web UI via %s", frontendSource)
	} else {
		log.Printf("[frontend] No frontend assets found. Only API and WebSocket enabled.")
	}

	addr := fmt.Sprintf("0.0.0.0:%s", port)
	log.Printf("================================================================")
	log.Printf(" MongoClone Backend Engine listening on http://%s", addr)
	log.Printf(" WebSocket stream active on ws://%s/ws", addr)
	log.Printf(" Uptime tracking started: %s", startTime.Format(time.RFC3339))
	log.Printf("================================================================")

	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Graceful shutdown: pause running jobs, drain HTTP, then exit cleanly
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("[shutdown] Signal '%v' received — pausing running jobs and shutting down...", sig)

	orchestrator.PauseAllRunning()

	shutCtx, shutCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutCancel()
	if err := server.Shutdown(shutCtx); err != nil {
		log.Printf("[shutdown] HTTP server forced close: %v", err)
	}
	log.Printf("[shutdown] MongoClone exited cleanly. All job checkpoints preserved.")
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

