package jobs

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	mongopkg "github.com/mongoclone/engine/pkg/mongo"
	"github.com/mongoclone/engine/pkg/types"
)

// SavedProfile represents a stored connection preset for quick selection in the UI.
type SavedProfile struct {
	ID        string                  `json:"id"`
	Name      string                  `json:"name"`
	Type      string                  `json:"type"` // "source" or "target"
	Config    mongopkg.EndpointConfig `json:"config"`
	CreatedAt time.Time               `json:"created_at"`
}

// ScheduledJob defines a recurring scheduled clone operation.
type ScheduledJob struct {
	ID        string                `json:"id"`
	Name      string                `json:"name"`
	Frequency string                `json:"frequency"` // "daily", "weekly", "hourly"
	CronSpec  string                `json:"cron_spec"`
	Enabled   bool                  `json:"enabled"`
	Request   types.CloneJobRequest `json:"request"`
	LastRun   *time.Time            `json:"last_run,omitempty"`
	NextRun   time.Time             `json:"next_run"`
	CreatedAt time.Time             `json:"created_at"`
}

// Store provides thread-safe access and persistence for jobs, schedules, and connection profiles.
type Store struct {
	mu            sync.RWMutex
	jobs          map[string]*types.CloneJob
	profiles      map[string]SavedProfile
	schedules     map[string]ScheduledJob
	dataDir       string
	jobsFile      string
	profsFile     string
	schedsFile    string
}

// NewStore creates a new Store instance.
func NewStore(dataDir string) *Store {
	if dataDir == "" {
		dataDir = "data"
	}
	_ = os.MkdirAll(dataDir, 0755)

	s := &Store{
		jobs:       make(map[string]*types.CloneJob),
		profiles:   make(map[string]SavedProfile),
		schedules:  make(map[string]ScheduledJob),
		dataDir:    dataDir,
		jobsFile:   filepath.Join(dataDir, "jobs.json"),
		profsFile:  filepath.Join(dataDir, "profiles.json"),
		schedsFile: filepath.Join(dataDir, "schedules.json"),
	}

	s.load()
	return s
}

// CreateJob registers a new job and saves it to store.
func (s *Store) CreateJob(req types.CloneJobRequest) *types.CloneJob {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := uuid.New().String()
	name := req.Name
	if name == "" {
		name = fmt.Sprintf("Clone Job %s", time.Now().Format("2006-01-02 15:04"))
	}

	job := &types.CloneJob{
		ID:           id,
		Name:         name,
		Status:       types.StatusPending,
		Mode:         req.Mode,
		SourceMasked: req.Source.MaskedURI(),
		TargetMasked: req.Target.MaskedURI(),
		Request:      req,
		Progress: types.ProgressTelemetry{
			Phase:       "Initialized",
			Collections: make(map[string]types.CollectionCopyProgress),
		},
		Logs:      make([]types.LogEntry, 0),
		CreatedAt: time.Now().UTC(),
	}

	job.AddLog("INFO", fmt.Sprintf("Created clone job '%s' (%s mode)", name, req.Mode))

	s.jobs[id] = job
	s.save()
	return job
}

// GetJob retrieves a job by ID.
func (s *Store) GetJob(id string) (*types.CloneJob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	job, ok := s.jobs[id]
	return job, ok
}

// ListJobs returns all jobs sorted newest first.
func (s *Store) ListJobs() []types.CloneJob {
	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]types.CloneJob, 0, len(s.jobs))
	for _, j := range s.jobs {
		list = append(list, j.GetSnapshot())
	}

	// Sort descending by CreatedAt
	for i := 0; i < len(list)-1; i++ {
		for j := i + 1; j < len(list); j++ {
			if list[i].CreatedAt.Before(list[j].CreatedAt) {
				list[i], list[j] = list[j], list[i]
			}
		}
	}

	return list
}

// DeleteJob removes a job record.
func (s *Store) DeleteJob(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.jobs[id]; ok {
		delete(s.jobs, id)
		s.save()
		return true
	}
	return false
}

// SaveProfile creates or updates a saved connection profile.
// SaveProfile creates or updates a saved connection profile.
func (s *Store) SaveProfile(name, pType string, cfg mongopkg.EndpointConfig) SavedProfile {
	s.mu.Lock()
	defer s.mu.Unlock()

	// If a profile with the same name and type already exists, update its config in place!
	for id, p := range s.profiles {
		if p.Name == name && p.Type == pType {
			p.Config = cfg
			s.profiles[id] = p
			s.save()
			return p
		}
	}

	id := uuid.New().String()
	profile := SavedProfile{
		ID:        id,
		Name:      name,
		Type:      pType,
		Config:    cfg,
		CreatedAt: time.Now().UTC(),
	}

	s.profiles[id] = profile
	s.save()
	return profile
}

// ListProfiles returns all saved connection profiles.
func (s *Store) ListProfiles() []SavedProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]SavedProfile, 0, len(s.profiles))
	for _, p := range s.profiles {
		list = append(list, p)
	}
	return list
}

// DeleteProfile deletes a connection profile.
func (s *Store) DeleteProfile(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.profiles[id]; ok {
		delete(s.profiles, id)
		s.save()
		return true
	}
	return false
}

// UpdateProfile updates an existing connection profile by ID or Name.
func (s *Store) UpdateProfile(id, name string, cfg mongopkg.EndpointConfig) (SavedProfile, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	prof, ok := s.profiles[id]
	if !ok {
		// Fallback search by Name
		for pid, p := range s.profiles {
			if p.Name == name {
				p.Config = cfg
				s.profiles[pid] = p
				s.save()
				return p, true
			}
		}
		return SavedProfile{}, false
	}

	prof.Name = name
	prof.Config = cfg
	s.profiles[id] = prof
	s.save()
	return prof, true
}

// SaveSchedule creates or updates a recurring clone schedule.
func (s *Store) SaveSchedule(name, frequency, cronSpec string, req types.CloneJobRequest) ScheduledJob {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := uuid.New().String()
	nextRun := time.Now().UTC().Add(24 * time.Hour)
	if frequency == "hourly" {
		nextRun = time.Now().UTC().Add(1 * time.Hour)
	} else if frequency == "weekly" {
		nextRun = time.Now().UTC().Add(7 * 24 * time.Hour)
	}

	sched := ScheduledJob{
		ID:        id,
		Name:      name,
		Frequency: frequency,
		CronSpec:  cronSpec,
		Enabled:   true,
		Request:   req,
		NextRun:   nextRun,
		CreatedAt: time.Now().UTC(),
	}

	s.schedules[id] = sched
	s.save()
	return sched
}

// ListSchedules returns all scheduled clone tasks.
func (s *Store) ListSchedules() []ScheduledJob {
	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]ScheduledJob, 0, len(s.schedules))
	for _, sc := range s.schedules {
		list = append(list, sc)
	}
	return list
}

// DeleteSchedule removes a schedule.
func (s *Store) DeleteSchedule(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.schedules[id]; ok {
		delete(s.schedules, id)
		s.save()
		return true
	}
	return false
}

// ToggleSchedule enables or disables a schedule.
func (s *Store) ToggleSchedule(id string) (ScheduledJob, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sched, ok := s.schedules[id]
	if !ok {
		return ScheduledJob{}, false
	}

	sched.Enabled = !sched.Enabled
	s.schedules[id] = sched
	s.save()
	return sched, true
}

// UpdateScheduleRun updates the last and next run timestamps.
func (s *Store) UpdateScheduleRun(id string, lastRun time.Time, nextRun time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if sched, ok := s.schedules[id]; ok {
		sched.LastRun = &lastRun
		sched.NextRun = nextRun
		s.schedules[id] = sched
		s.save()
	}
}

func (s *Store) save() {
	if profData, err := json.MarshalIndent(s.profiles, "", "  "); err == nil {
		_ = os.WriteFile(s.profsFile, profData, 0644)
	}
	if jobData, err := json.MarshalIndent(s.jobs, "", "  "); err == nil {
		_ = os.WriteFile(s.jobsFile, jobData, 0644)
	}
	if schedData, err := json.MarshalIndent(s.schedules, "", "  "); err == nil {
		_ = os.WriteFile(s.schedsFile, schedData, 0644)
	}
}

func (s *Store) load() {
	if data, err := os.ReadFile(s.profsFile); err == nil {
		var profs map[string]SavedProfile
		if err := json.Unmarshal(data, &profs); err == nil && len(profs) > 0 {
			s.profiles = profs
		}
	}
	if len(s.profiles) == 0 {
		s.seedDefaultProfiles()
	}

	if data, err := os.ReadFile(s.jobsFile); err == nil {
		var loadedJobs map[string]*types.CloneJob
		if err := json.Unmarshal(data, &loadedJobs); err == nil && len(loadedJobs) > 0 {
			s.jobs = loadedJobs
		}
	}

	if data, err := os.ReadFile(s.schedsFile); err == nil {
		var loadedScheds map[string]ScheduledJob
		if err := json.Unmarshal(data, &loadedScheds); err == nil && len(loadedScheds) > 0 {
			s.schedules = loadedScheds
		}
	}
}

func (s *Store) seedDefaultProfiles() {
	p1 := SavedProfile{
		ID:   "prof-prod-primary",
		Name: "Production Primary Cluster (rs0)",
		Type: "source",
		Config: mongopkg.EndpointConfig{
			URI:        "mongodb://127.0.0.1:27017/?directConnection=true",
			TimeoutMs:  10000,
			ReplicaSet: "rs0",
		},
		CreatedAt: time.Now().UTC(),
	}
	p2 := SavedProfile{
		ID:   "prof-prod-analytics",
		Name: "Production Analytics & Core DB",
		Type: "source",
		Config: mongopkg.EndpointConfig{
			URI:       "mongodb://127.0.0.1:27017/?directConnection=true",
			TimeoutMs: 10000,
		},
		CreatedAt: time.Now().UTC(),
	}
	p3 := SavedProfile{
		ID:   "prof-test-staging",
		Name: "Staging / QA Test Cluster (Port 27018)",
		Type: "target",
		Config: mongopkg.EndpointConfig{
			URI:       "mongodb://127.0.0.1:27018/?directConnection=true",
			TimeoutMs: 10000,
		},
		CreatedAt: time.Now().UTC(),
	}
	p4 := SavedProfile{
		ID:   "prof-test-dev",
		Name: "Developer Sandbox (Target)",
		Type: "target",
		Config: mongopkg.EndpointConfig{
			URI:       "mongodb://127.0.0.1:27018/?directConnection=true",
			TimeoutMs: 10000,
		},
		CreatedAt: time.Now().UTC(),
	}

	s.profiles[p1.ID] = p1
	s.profiles[p2.ID] = p2
	s.profiles[p3.ID] = p3
	s.profiles[p4.ID] = p4
	s.save()
}
