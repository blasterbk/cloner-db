package jobs

import (
	"context"
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
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// SavedProfile represents a stored connection preset for quick selection in the UI.
type SavedProfile struct {
	ID        string                  `json:"id" bson:"id"`
	Name      string                  `json:"name" bson:"name"`
	Type      string                  `json:"type" bson:"type"` // "source" or "target"
	Config    mongopkg.EndpointConfig `json:"config" bson:"config"`
	CreatedAt time.Time               `json:"created_at" bson:"created_at"`
}

// ScheduledJob defines a recurring scheduled clone operation.
type ScheduledJob struct {
	ID        string                `json:"id" bson:"id"`
	Name      string                `json:"name" bson:"name"`
	Frequency string                `json:"frequency" bson:"frequency"` // "daily", "weekly", "hourly"
	CronSpec  string                `json:"cron_spec" bson:"cron_spec"`
	Enabled   bool                  `json:"enabled" bson:"enabled"`
	Request   types.CloneJobRequest `json:"request" bson:"request"`
	LastRun   *time.Time            `json:"last_run,omitempty" bson:"last_run,omitempty"`
	NextRun   time.Time             `json:"next_run" bson:"next_run"`
	CreatedAt time.Time             `json:"created_at" bson:"created_at"`
}

// Store provides thread-safe access and persistence for jobs, schedules, and connection profiles.
type Store struct {
	mu           sync.RWMutex
	jobs         map[string]*types.CloneJob
	profiles     map[string]SavedProfile
	schedules    map[string]ScheduledJob
	dataDir      string
	jobsFile     string
	profsFile    string
	schedsFile   string
	mongoClient  *mongo.Client
	mongoDB      *mongo.Database
	profilesColl *mongo.Collection
	jobsColl     *mongo.Collection
	schedsColl   *mongo.Collection
}

// NewStore creates a new Store instance backed by MongoDB and local backup cache.
func NewStore(dataDir string, mongoURI string) *Store {
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

	// 1. Initial local load (cache)
	s.load()

	// 2. Connect to MongoDB for centralized storage if URI is configured
	if strings.TrimSpace(mongoURI) != "" {
		s.initMongoDB(strings.TrimSpace(mongoURI))
	}

	return s
}

// GetDB returns the underlying MongoDB database handle (or nil if disconnected).
func (s *Store) GetDB() *mongo.Database {
	return s.mongoDB
}

// initMongoDB initializes the remote MongoDB database collections.
func (s *Store) initMongoDB(uri string) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	clientOpts := options.Client().ApplyURI(uri)
	clientOpts.SetConnectTimeout(5 * time.Second)
	clientOpts.SetServerSelectionTimeout(5 * time.Second)

	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		log.Printf("[store] Warning: Unable to connect to MongoDB database: %v. Using local storage.", err)
		return
	}

	if err := client.Ping(ctx, nil); err != nil {
		log.Printf("[store] Warning: MongoDB database ping failed: %v. Using local storage.", err)
		return
	}

	// Extract database name from URI, defaulting to "birats_db" or "mongoclone"
	dbName := "birats_db"
	uParts := strings.Split(uri, "?")
	if len(uParts) > 0 {
		trimmed := strings.TrimRight(uParts[0], "/")
		if slashIdx := strings.LastIndex(trimmed, "/"); slashIdx != -1 {
			extracted := trimmed[slashIdx+1:]
			if extracted != "" && extracted != "admin" && !strings.Contains(extracted, ":") && !strings.Contains(extracted, "@") {
				dbName = extracted
			}
		}
	}

	s.mongoClient = client
	s.mongoDB = client.Database(dbName)
	s.profilesColl = s.mongoDB.Collection("mongoclone_profiles")
	s.jobsColl = s.mongoDB.Collection("mongoclone_jobs")
	s.schedsColl = s.mongoDB.Collection("mongoclone_schedules")
	log.Printf("[store] MongoDB Central Storage connected: %s (profiles, jobs, schedules, checkpoints)", dbName)

	syncCtx, syncCancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer syncCancel()

	// 1. Sync / Migrate Profiles
	s.syncProfiles(syncCtx)

	// 2. Sync / Migrate Jobs
	s.syncJobs(syncCtx)

	// 3. Sync / Migrate Schedules
	s.syncSchedules(syncCtx)
}

func (s *Store) syncProfiles(ctx context.Context) {
	cur, err := s.profilesColl.Find(ctx, bson.M{})
	if err == nil {
		var dbProfs []SavedProfile
		if err := cur.All(ctx, &dbProfs); err == nil && len(dbProfs) > 0 {
			s.mu.Lock()
			s.profiles = make(map[string]SavedProfile, len(dbProfs))
			for _, p := range dbProfs {
				if !isMockProfile(p) {
					s.profiles[p.ID] = p
				}
			}
			s.mu.Unlock()
			s.save()
			log.Printf("[store] Loaded %d profiles from MongoDB", len(s.profiles))
		} else {
			// Migrate local profiles to MongoDB
			s.mu.RLock()
			toMigrate := make([]interface{}, 0)
			for _, p := range s.profiles {
				if !isMockProfile(p) {
					toMigrate = append(toMigrate, p)
				}
			}
			s.mu.RUnlock()

			if len(toMigrate) > 0 {
				_, _ = s.profilesColl.InsertMany(ctx, toMigrate)
				log.Printf("[store] Migrated %d local profiles into MongoDB", len(toMigrate))
			}
		}
	}
}

func (s *Store) syncJobs(ctx context.Context) {
	cur, err := s.jobsColl.Find(ctx, bson.M{})
	if err == nil {
		var dbJobs []types.CloneJob
		if err := cur.All(ctx, &dbJobs); err == nil && len(dbJobs) > 0 {
			s.mu.Lock()
			s.jobs = make(map[string]*types.CloneJob, len(dbJobs))
			for _, j := range dbJobs {
				copyJob := j
				if copyJob.Status == types.StatusRunning {
					copyJob.Status = types.StatusPaused
					copyJob.AddLog("WARN", "Server restarted while clone was in progress. Job paused with checkpoint preserved. Ready to resume.")
				}
				s.jobs[j.ID] = &copyJob
			}
			s.mu.Unlock()
			s.save()
			log.Printf("[store] Loaded %d jobs from MongoDB", len(s.jobs))
		} else {
			// Migrate local jobs to MongoDB
			s.mu.RLock()
			toMigrate := make([]interface{}, 0)
			for _, j := range s.jobs {
				toMigrate = append(toMigrate, j.GetSnapshot())
			}
			s.mu.RUnlock()

			if len(toMigrate) > 0 {
				_, _ = s.jobsColl.InsertMany(ctx, toMigrate)
				log.Printf("[store] Migrated %d local jobs into MongoDB", len(toMigrate))
			}
		}
	}
}

func (s *Store) syncSchedules(ctx context.Context) {
	cur, err := s.schedsColl.Find(ctx, bson.M{})
	if err == nil {
		var dbScheds []ScheduledJob
		if err := cur.All(ctx, &dbScheds); err == nil && len(dbScheds) > 0 {
			s.mu.Lock()
			s.schedules = make(map[string]ScheduledJob, len(dbScheds))
			for _, sc := range dbScheds {
				s.schedules[sc.ID] = sc
			}
			s.mu.Unlock()
			s.save()
			log.Printf("[store] Loaded %d schedules from MongoDB", len(s.schedules))
		} else {
			// Migrate local schedules to MongoDB
			s.mu.RLock()
			toMigrate := make([]interface{}, 0)
			for _, sc := range s.schedules {
				toMigrate = append(toMigrate, sc)
			}
			s.mu.RUnlock()

			if len(toMigrate) > 0 {
				_, _ = s.schedsColl.InsertMany(ctx, toMigrate)
				log.Printf("[store] Migrated %d local schedules into MongoDB", len(toMigrate))
			}
		}
	}
}

// isMockProfile checks whether a profile is an old hardcoded mock/dummy entry.
func isMockProfile(p SavedProfile) bool {
	if strings.HasPrefix(p.ID, "prof-prod-") || strings.HasPrefix(p.ID, "prof-test-") {
		return true
	}
	if p.Name == "payment_service_prod" || strings.Contains(p.Config.URI, "127.0.0.1:27017") {
		return true
	}
	return false
}

// CreateJob registers a new job and saves it to store and MongoDB.
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

	if s.jobsColl != nil {
		go func(item types.CloneJob) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			opts := options.Replace().SetUpsert(true)
			_, _ = s.jobsColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, opts)
		}(job.GetSnapshot())
	}

	return job
}

// SaveJob persists the updated state of a clone job into memory, local cache, and MongoDB.
func (s *Store) SaveJob(job *types.CloneJob) {
	s.mu.Lock()
	s.jobs[job.ID] = job
	s.mu.Unlock()

	s.save()

	if s.jobsColl != nil {
		go func(item types.CloneJob) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			opts := options.Replace().SetUpsert(true)
			_, _ = s.jobsColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, opts)
		}(job.GetSnapshot())
	}
}

// GetJob retrieves a job by ID.
func (s *Store) GetJob(id string) (*types.CloneJob, bool) {
	s.mu.RLock()
	job, ok := s.jobs[id]
	s.mu.RUnlock()

	if ok {
		return job, true
	}

	// Try reading from MongoDB
	if s.jobsColl != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var dbJob types.CloneJob
		if err := s.jobsColl.FindOne(ctx, bson.M{"id": id}).Decode(&dbJob); err == nil {
			s.mu.Lock()
			s.jobs[id] = &dbJob
			s.mu.Unlock()
			return &dbJob, true
		}
	}

	return nil, false
}

// ListJobs returns all jobs sorted newest first.
func (s *Store) ListJobs() []types.CloneJob {
	// Sync with MongoDB if collection is connected
	if s.jobsColl != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})
		cur, err := s.jobsColl.Find(ctx, bson.M{}, opts)
		if err == nil {
			var dbJobs []types.CloneJob
			if err := cur.All(ctx, &dbJobs); err == nil && len(dbJobs) > 0 {
				s.mu.Lock()
				s.jobs = make(map[string]*types.CloneJob, len(dbJobs))
				for _, j := range dbJobs {
					copyJob := j
					s.jobs[j.ID] = &copyJob
				}
				s.mu.Unlock()
			}
		}
		cancel()
	}

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

// DeleteJob removes a job record from memory, local backup, and MongoDB.
func (s *Store) DeleteJob(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.jobs[id]; ok {
		delete(s.jobs, id)
		s.save()

		if s.jobsColl != nil {
			go func(delID string) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, _ = s.jobsColl.DeleteOne(ctx, bson.M{"id": delID})
			}(id)
		}
		return true
	}
	return false
}

// SaveProfile creates or updates a saved connection profile in DB and local store.
func (s *Store) SaveProfile(name, pType string, cfg mongopkg.EndpointConfig) SavedProfile {
	s.mu.Lock()
	defer s.mu.Unlock()

	// If a profile with the same name and type already exists, update its config in place!
	for id, p := range s.profiles {
		if p.Name == name && p.Type == pType {
			p.Config = cfg
			s.profiles[id] = p
			s.save()

			if s.profilesColl != nil {
				go func(item SavedProfile) {
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					_, _ = s.profilesColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, options.Replace().SetUpsert(true))
				}(p)
			}
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

	if s.profilesColl != nil {
		go func(item SavedProfile) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = s.profilesColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, options.Replace().SetUpsert(true))
		}(profile)
	}

	return profile
}

// ListProfiles returns all saved connection profiles.
func (s *Store) ListProfiles() []SavedProfile {
	// Sync with MongoDB if collection is connected
	if s.profilesColl != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cur, err := s.profilesColl.Find(ctx, bson.M{})
		if err == nil {
			var dbProfs []SavedProfile
			if err := cur.All(ctx, &dbProfs); err == nil && len(dbProfs) > 0 {
				s.mu.Lock()
				s.profiles = make(map[string]SavedProfile, len(dbProfs))
				for _, p := range dbProfs {
					if !isMockProfile(p) {
						s.profiles[p.ID] = p
					}
				}
				s.mu.Unlock()
			}
		}
		cancel()
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]SavedProfile, 0, len(s.profiles))
	for _, p := range s.profiles {
		if !isMockProfile(p) {
			list = append(list, p)
		}
	}
	return list
}

// DeleteProfile deletes a connection profile from DB and local store.
func (s *Store) DeleteProfile(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.profiles[id]; ok {
		delete(s.profiles, id)
		s.save()

		if s.profilesColl != nil {
			go func(delID string) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, _ = s.profilesColl.DeleteOne(ctx, bson.M{"id": delID})
			}(id)
		}
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

				if s.profilesColl != nil {
					go func(item SavedProfile) {
						ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
						defer cancel()
						_, _ = s.profilesColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, options.Replace().SetUpsert(true))
					}(p)
				}
				return p, true
			}
		}
		return SavedProfile{}, false
	}

	prof.Name = name
	prof.Config = cfg
	s.profiles[id] = prof
	s.save()

	if s.profilesColl != nil {
		go func(item SavedProfile) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = s.profilesColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, options.Replace().SetUpsert(true))
		}(prof)
	}

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

	if s.schedsColl != nil {
		go func(item ScheduledJob) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			opts := options.Replace().SetUpsert(true)
			_, _ = s.schedsColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, opts)
		}(sched)
	}

	return sched
}

// ListSchedules returns all scheduled clone tasks.
func (s *Store) ListSchedules() []ScheduledJob {
	if s.schedsColl != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cur, err := s.schedsColl.Find(ctx, bson.M{})
		if err == nil {
			var dbScheds []ScheduledJob
			if err := cur.All(ctx, &dbScheds); err == nil && len(dbScheds) > 0 {
				s.mu.Lock()
				s.schedules = make(map[string]ScheduledJob, len(dbScheds))
				for _, sc := range dbScheds {
					s.schedules[sc.ID] = sc
				}
				s.mu.Unlock()
			}
		}
		cancel()
	}

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

		if s.schedsColl != nil {
			go func(delID string) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, _ = s.schedsColl.DeleteOne(ctx, bson.M{"id": delID})
			}(id)
		}
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

	if s.schedsColl != nil {
		go func(item ScheduledJob) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			opts := options.Replace().SetUpsert(true)
			_, _ = s.schedsColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, opts)
		}(sched)
	}

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

		if s.schedsColl != nil {
			go func(item ScheduledJob) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				opts := options.Replace().SetUpsert(true)
				_, _ = s.schedsColl.ReplaceOne(ctx, bson.M{"id": item.ID}, item, opts)
			}(sched)
		}
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
			for id, p := range profs {
				if !isMockProfile(p) {
					s.profiles[id] = p
				}
			}
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
