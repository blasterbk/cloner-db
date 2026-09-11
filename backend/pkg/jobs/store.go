package jobs

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
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
// All data is persisted to local JSON files — no external database required.
type Store struct {
	mu         sync.RWMutex
	fileMu     sync.Mutex // serializes disk writes to prevent race conditions and file corruption
	jobs       map[string]*types.CloneJob
	profiles   map[string]SavedProfile
	schedules  map[string]ScheduledJob
	dataDir    string
	jobsFile   string
	profsFile  string
	schedsFile string

	asyncSaveCh chan struct{}
	stopCh      chan struct{}
}

// NewStore creates a new Store instance backed by local JSON files in dataDir.
func NewStore(dataDir string) *Store {
	if dataDir == "" {
		dataDir = "data"
	}
	_ = os.MkdirAll(dataDir, 0755)

	s := &Store{
		jobs:        make(map[string]*types.CloneJob),
		profiles:    make(map[string]SavedProfile),
		schedules:   make(map[string]ScheduledJob),
		dataDir:     dataDir,
		jobsFile:    filepath.Join(dataDir, "jobs.json"),
		profsFile:   filepath.Join(dataDir, "profiles.json"),
		schedsFile:  filepath.Join(dataDir, "schedules.json"),
		asyncSaveCh: make(chan struct{}, 1),
		stopCh:      make(chan struct{}),
	}

	s.load()
	go s.asyncJobSaver()
	log.Printf("[store] Local JSON storage initialized (dir: %s)", dataDir)
	return s
}

// asyncJobSaver runs as a single background worker that periodically flushes job updates to disk.
// This throttles high-frequency progress telemetry writes during active clones and prevents
// launching unbounded goroutines or triggering concurrent map read/write runtime crashes.
func (s *Store) asyncJobSaver() {
	for {
		select {
		case <-s.stopCh:
			return
		case <-s.asyncSaveCh:
			// Coalesce rapid progress updates: wait 250ms so multiple updates collapse into one disk write
			time.Sleep(250 * time.Millisecond)
			// Drain any intermediate notification that queued while sleeping
			select {
			case <-s.asyncSaveCh:
			default:
			}
			s.saveJobs()
		}
	}
}

// Close stops the background worker and synchronously flushes all state to disk.
func (s *Store) Close() {
	select {
	case <-s.stopCh:
	default:
		close(s.stopCh)
	}
	s.saveJobs()
}

// IsMongoConnected always returns false — this store uses local file storage only.
func (s *Store) IsMongoConnected() bool {
	return false
}

// CreateJob registers a new job and persists it to local storage.
func (s *Store) CreateJob(req types.CloneJobRequest) *types.CloneJob {
	s.mu.Lock()

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
	snaps := s.snapshotJobsLocked()
	s.mu.Unlock()

	s.writeJobsFile(snaps)
	return job
}

// SaveJob persists the updated state of a clone job into memory and local storage synchronously.
func (s *Store) SaveJob(job *types.CloneJob) {
	s.mu.Lock()
	s.jobs[job.ID] = job
	snaps := s.snapshotJobsLocked()
	s.mu.Unlock()

	s.writeJobsFile(snaps)
}

// SaveJobAsync signals that job progress should be persisted to disk asynchronously.
// Uses a coalesced single-worker channel to avoid launching unbounded goroutines
// and takes thread-safe deep snapshots to avoid "concurrent map read and map write" panics.
func (s *Store) SaveJobAsync(job *types.CloneJob) {
	s.mu.Lock()
	s.jobs[job.ID] = job
	s.mu.Unlock()

	select {
	case s.asyncSaveCh <- struct{}{}:
	default:
		// Disk save already queued
	}
}

// GetJob retrieves a job by ID.
func (s *Store) GetJob(id string) (*types.CloneJob, bool) {
	s.mu.RLock()
	job, ok := s.jobs[id]
	s.mu.RUnlock()
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

// DeleteJob removes a job record from memory and local storage.
func (s *Store) DeleteJob(id string) bool {
	s.mu.Lock()
	delete(s.jobs, id)
	snaps := s.snapshotJobsLocked()
	s.mu.Unlock()

	s.writeJobsFile(snaps)
	return true
}

// DeleteJobsBulk removes multiple job records atomically in one disk write.
// Skips any IDs that do not exist. Returns the count of actually deleted jobs.
func (s *Store) DeleteJobsBulk(ids []string) int {
	s.mu.Lock()
	deleted := 0
	for _, id := range ids {
		if _, ok := s.jobs[id]; ok {
			delete(s.jobs, id)
			deleted++
		}
	}
	snaps := s.snapshotJobsLocked()
	s.mu.Unlock()

	if deleted > 0 {
		s.writeJobsFile(snaps)
	}
	return deleted
}

// ClearAllJobs removes every job record from memory and local storage.
// Active (RUNNING) jobs are NOT removed — they will remain in the map.
// Returns the count of records cleared.
func (s *Store) ClearAllJobs() int {
	s.mu.Lock()
	cleared := 0
	for id, j := range s.jobs {
		if j.Status != types.StatusRunning {
			delete(s.jobs, id)
			cleared++
		}
	}
	snaps := s.snapshotJobsLocked()
	s.mu.Unlock()

	s.writeJobsFile(snaps)
	return cleared
}

// SaveProfile creates or updates a saved connection profile in local storage.
func (s *Store) SaveProfile(name, pType string, cfg mongopkg.EndpointConfig) SavedProfile {
	s.mu.Lock()

	// If a profile with the same name and type already exists, update its config in place.
	for id, p := range s.profiles {
		if p.Name == name && p.Type == pType {
			p.Config = cfg
			s.profiles[id] = p
			profs := s.snapshotProfilesLocked()
			s.mu.Unlock()
			s.writeProfilesFile(profs)
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
	profs := s.snapshotProfilesLocked()
	s.mu.Unlock()

	s.writeProfilesFile(profs)
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

// DeleteProfile removes a connection profile from local storage by ID or Name.
func (s *Store) DeleteProfile(id string) bool {
	s.mu.Lock()

	id = strings.TrimSpace(id)
	if id == "" {
		s.mu.Unlock()
		return false
	}

	foundID := ""
	if _, ok := s.profiles[id]; ok {
		foundID = id
	} else {
		// Fallback: search by Name or DB hint in URI
		for pid, p := range s.profiles {
			if strings.EqualFold(p.Name, id) ||
				strings.EqualFold(p.Config.ExtractDatabaseName(), id) ||
				strings.Contains(strings.ToLower(p.Name), strings.ToLower(id)) {
				foundID = pid
				break
			}
		}
	}

	if foundID == "" {
		s.mu.Unlock()
		return false
	}

	delete(s.profiles, foundID)
	profs := s.snapshotProfilesLocked()
	s.mu.Unlock()

	s.writeProfilesFile(profs)
	return true
}

// UpdateProfile updates an existing connection profile by ID or Name.
func (s *Store) UpdateProfile(id, name string, cfg mongopkg.EndpointConfig) (SavedProfile, bool) {
	s.mu.Lock()

	prof, ok := s.profiles[id]
	if !ok {
		// Fallback: search by Name
		for pid, p := range s.profiles {
			if p.Name == name {
				p.Config = cfg
				s.profiles[pid] = p
				profs := s.snapshotProfilesLocked()
				s.mu.Unlock()
				s.writeProfilesFile(profs)
				return p, true
			}
		}
		s.mu.Unlock()
		return SavedProfile{}, false
	}

	prof.Name = name
	prof.Config = cfg
	s.profiles[id] = prof
	profs := s.snapshotProfilesLocked()
	s.mu.Unlock()

	s.writeProfilesFile(profs)
	return prof, true
}

// SaveSchedule creates or updates a recurring clone schedule.
func (s *Store) SaveSchedule(name, frequency, cronSpec string, req types.CloneJobRequest) ScheduledJob {
	s.mu.Lock()

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
	scheds := s.snapshotSchedulesLocked()
	s.mu.Unlock()

	s.writeSchedulesFile(scheds)
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

// DeleteSchedule removes a schedule from local storage.
func (s *Store) DeleteSchedule(id string) bool {
	s.mu.Lock()

	if _, ok := s.schedules[id]; ok {
		delete(s.schedules, id)
		scheds := s.snapshotSchedulesLocked()
		s.mu.Unlock()
		s.writeSchedulesFile(scheds)
		return true
	}
	s.mu.Unlock()
	return false
}

// ToggleSchedule enables or disables a schedule.
func (s *Store) ToggleSchedule(id string) (ScheduledJob, bool) {
	s.mu.Lock()

	sched, ok := s.schedules[id]
	if !ok {
		s.mu.Unlock()
		return ScheduledJob{}, false
	}

	sched.Enabled = !sched.Enabled
	s.schedules[id] = sched
	scheds := s.snapshotSchedulesLocked()
	s.mu.Unlock()

	s.writeSchedulesFile(scheds)
	return sched, true
}

// UpdateScheduleRun updates the last and next run timestamps for a schedule.
func (s *Store) UpdateScheduleRun(id string, lastRun time.Time, nextRun time.Time) {
	s.mu.Lock()

	if sched, ok := s.schedules[id]; ok {
		sched.LastRun = &lastRun
		sched.NextRun = nextRun
		s.schedules[id] = sched
		scheds := s.snapshotSchedulesLocked()
		s.mu.Unlock()
		s.writeSchedulesFile(scheds)
		return
	}
	s.mu.Unlock()
}

// --- Thread-Safe Snapshot Helpers ---

// snapshotJobsLocked creates an isolated snapshot of each job in memory.
// Must be called while holding s.mu (Lock or RLock).
func (s *Store) snapshotJobsLocked() map[string]types.CloneJob {
	snaps := make(map[string]types.CloneJob, len(s.jobs))
	for id, j := range s.jobs {
		snaps[id] = j.GetSnapshot()
	}
	return snaps
}

// snapshotProfilesLocked creates an isolated copy of connection profiles.
// Must be called while holding s.mu (Lock or RLock).
func (s *Store) snapshotProfilesLocked() map[string]SavedProfile {
	profs := make(map[string]SavedProfile, len(s.profiles))
	for k, v := range s.profiles {
		profs[k] = v
	}
	return profs
}

// snapshotSchedulesLocked creates an isolated copy of scheduled jobs.
// Must be called while holding s.mu (Lock or RLock).
func (s *Store) snapshotSchedulesLocked() map[string]ScheduledJob {
	scheds := make(map[string]ScheduledJob, len(s.schedules))
	for k, v := range s.schedules {
		scheds[k] = v
	}
	return scheds
}

// --- Thread-Safe Disk Write Helpers ---

func (s *Store) writeJobsFile(snaps map[string]types.CloneJob) {
	s.fileMu.Lock()
	defer s.fileMu.Unlock()

	jobData, err := json.MarshalIndent(snaps, "", "  ")
	if err != nil {
		log.Printf("[store] Failed to marshal jobs: %v", err)
		return
	}

	tmpFile := s.jobsFile + ".tmp"
	if err := os.WriteFile(tmpFile, jobData, 0644); err == nil {
		_ = os.Rename(tmpFile, s.jobsFile)
	} else {
		_ = os.WriteFile(s.jobsFile, jobData, 0644)
	}
}

func (s *Store) writeProfilesFile(profs map[string]SavedProfile) {
	s.fileMu.Lock()
	defer s.fileMu.Unlock()

	if profData, err := json.MarshalIndent(profs, "", "  "); err == nil {
		tmpFile := s.profsFile + ".tmp"
		if err := os.WriteFile(tmpFile, profData, 0644); err == nil {
			_ = os.Rename(tmpFile, s.profsFile)
		} else {
			_ = os.WriteFile(s.profsFile, profData, 0644)
		}
	}
}

func (s *Store) writeSchedulesFile(scheds map[string]ScheduledJob) {
	s.fileMu.Lock()
	defer s.fileMu.Unlock()

	if schedData, err := json.MarshalIndent(scheds, "", "  "); err == nil {
		tmpFile := s.schedsFile + ".tmp"
		if err := os.WriteFile(tmpFile, schedData, 0644); err == nil {
			_ = os.Rename(tmpFile, s.schedsFile)
		} else {
			_ = os.WriteFile(s.schedsFile, schedData, 0644)
		}
	}
}

// saveJobs takes an isolated snapshot of all jobs and safely writes them to disk.
func (s *Store) saveJobs() {
	s.mu.RLock()
	snaps := s.snapshotJobsLocked()
	s.mu.RUnlock()

	s.writeJobsFile(snaps)
}

// save persists all in-memory state to local JSON files safely.
func (s *Store) save() {
	s.mu.RLock()
	profs := s.snapshotProfilesLocked()
	snaps := s.snapshotJobsLocked()
	scheds := s.snapshotSchedulesLocked()
	s.mu.RUnlock()

	s.writeProfilesFile(profs)
	s.writeJobsFile(snaps)
	s.writeSchedulesFile(scheds)
}

// load reads persisted state from local JSON files into memory.
func (s *Store) load() {
	if data, err := os.ReadFile(s.profsFile); err == nil {
		var profs map[string]SavedProfile
		if err := json.Unmarshal(data, &profs); err == nil && len(profs) > 0 {
			s.profiles = profs
		}
	}

	if data, err := os.ReadFile(s.jobsFile); err == nil {
		var loadedJobs map[string]*types.CloneJob
		if err := json.Unmarshal(data, &loadedJobs); err == nil && len(loadedJobs) > 0 {
			for _, j := range loadedJobs {
				if j != nil && j.Status == types.StatusRunning {
					j.Status = types.StatusPaused
					j.AddLog("WARN", "Server restarted while clone was in progress. Job paused with checkpoint preserved. Ready to resume.")
				}
			}
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
