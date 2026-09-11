// Package auth provides simple session-token-based authentication for MongoClone.
// Credentials are read from AUTH_USERNAME / AUTH_PASSWORD environment variables.
// If AUTH_USERNAME is empty, authentication is disabled (all requests pass through).
//
// Tokens are random 32-byte hex strings stored in an in-memory map with a configurable TTL.
// The server-side map is the source of truth — no JWT signing complexity needed for VPC deployments.
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	tokenTTL     = 24 * time.Hour // sessions expire after 24 hours of inactivity
	cleanupEvery = 30 * time.Minute
)

// Manager handles login/logout and token validation.
type Manager struct {
	username    string
	password    string
	enabled     bool
	sessionFile string // path to the on-disk session store

	mu       sync.RWMutex
	sessions map[string]time.Time // token → last seen
}

// New creates an auth manager. If username is empty, auth is disabled.
// dataDir is the directory where sessions.json will be persisted.
func New(username, password, dataDir string) *Manager {
	m := &Manager{
		username:    username,
		password:    password,
		enabled:     username != "",
		sessionFile: filepath.Join(dataDir, "sessions.json"),
		sessions:    make(map[string]time.Time),
	}
	if m.enabled {
		log.Printf("[auth] Authentication ENABLED — login required to access MongoClone")
		m.loadSessions() // restore sessions from disk on startup
		go m.cleanupLoop()
	} else {
		log.Printf("[auth] Authentication DISABLED — set AUTH_USERNAME in .env to enable")
	}
	return m
}

// Enabled reports whether authentication is active.
func (m *Manager) Enabled() bool { return m.enabled }

// Login validates credentials and returns a session token on success.
func (m *Manager) Login(username, password string) (token string, ok bool) {
	if !m.enabled {
		return "", false
	}
	if username != m.username || password != m.password {
		return "", false
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", false
	}
	token = hex.EncodeToString(buf)

	m.mu.Lock()
	m.sessions[token] = time.Now()
	m.mu.Unlock()

	m.saveSessions() // persist immediately
	return token, true
}

// Validate checks whether the token is valid and updates its last-seen time.
func (m *Manager) Validate(token string) bool {
	if !m.enabled {
		return true // auth disabled → everything is allowed
	}
	if token == "" {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	ts, exists := m.sessions[token]
	if !exists {
		return false
	}
	if time.Since(ts) > tokenTTL {
		delete(m.sessions, token)
		go m.saveSessions()
		return false
	}
	m.sessions[token] = time.Now() // refresh TTL on activity
	go m.saveSessions()            // persist the refreshed timestamp
	return true
}

// Logout invalidates a session token.
func (m *Manager) Logout(token string) {
	m.mu.Lock()
	delete(m.sessions, token)
	m.mu.Unlock()
	m.saveSessions() // persist immediately
}

// extractToken pulls the bearer token from the Authorization header or
// the 'token' query parameter (used for WebSocket connections).
func extractToken(r *http.Request) string {
	// Authorization: Bearer <token>
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	// X-Auth-Token header (alternative)
	if t := r.Header.Get("X-Auth-Token"); t != "" {
		return t
	}
	// ?token=<token> query param (for WebSocket connections where browsers can't set headers)
	return r.URL.Query().Get("token")
}

// Middleware returns an HTTP middleware that enforces authentication.
// Unauthenticated requests get a 401 JSON response.
func (m *Manager) Middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !m.enabled {
			next(w, r)
			return
		}
		token := extractToken(r)
		if !m.Validate(token) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("WWW-Authenticate", "Bearer realm=\"MongoClone\"")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{ //nolint:errcheck
				"error": "Unauthorized — please log in",
			})
			return
		}
		next(w, r)
	}
}

// cleanupLoop periodically removes expired sessions from the map.
func (m *Manager) cleanupLoop() {
	for {
		time.Sleep(cleanupEvery)
		now := time.Now()
		m.mu.Lock()
		changed := false
		for token, ts := range m.sessions {
			if now.Sub(ts) > tokenTTL {
				delete(m.sessions, token)
				changed = true
			}
		}
		m.mu.Unlock()
		if changed {
			m.saveSessions()
		}
	}
}

// saveSessions writes the current session map to disk.
// Called without the mutex held — uses a separate read lock.
func (m *Manager) saveSessions() {
	if m.sessionFile == "" {
		return
	}
	m.mu.RLock()
	// Snapshot sessions while under read lock
	snap := make(map[string]time.Time, len(m.sessions))
	for k, v := range m.sessions {
		snap[k] = v
	}
	m.mu.RUnlock()

	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		log.Printf("[auth] Failed to marshal sessions: %v", err)
		return
	}
	if err := os.WriteFile(m.sessionFile, data, 0600); err != nil {
		log.Printf("[auth] Failed to write sessions file: %v", err)
	}
}

// loadSessions reads previously persisted sessions from disk, discarding expired ones.
func (m *Manager) loadSessions() {
	if m.sessionFile == "" {
		return
	}
	data, err := os.ReadFile(m.sessionFile)
	if err != nil {
		return // file doesn't exist yet — first run
	}
	var saved map[string]time.Time
	if err := json.Unmarshal(data, &saved); err != nil {
		log.Printf("[auth] Ignoring corrupt sessions file: %v", err)
		return
	}
	now := time.Now()
	m.mu.Lock()
	loaded := 0
	for token, ts := range saved {
		if now.Sub(ts) <= tokenTTL {
			m.sessions[token] = ts
			loaded++
		}
	}
	m.mu.Unlock()
	log.Printf("[auth] Restored %d active session(s) from disk", loaded)
}
