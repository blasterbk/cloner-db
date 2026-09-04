package types

import (
	"fmt"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
	mongopkg "github.com/mongoclone/engine/pkg/mongo"
	"github.com/mongoclone/engine/pkg/pitr"
)

// MaskType defines the strategy used to sanitize or anonymize a field value.
type MaskType string

const (
	MaskTypeEmail        MaskType = "email"
	MaskTypePhone        MaskType = "phone"
	MaskTypePassword     MaskType = "password"
	MaskTypeCreditCard   MaskType = "credit_card"
	MaskTypeHashSHA256   MaskType = "hash_sha256"
	MaskTypeFixedValue   MaskType = "fixed_value"
	MaskTypeRemoveField  MaskType = "remove_field"
	MaskTypeRegexReplace MaskType = "regex_replace"
)

// MaskRule configures how a specific field in a collection should be sanitized.
type MaskRule struct {
	DatabaseName   string   `json:"database" bson:"database"`
	CollectionName string   `json:"collection" bson:"collection"`
	FieldPath      string   `json:"field_path" bson:"field_path"` // e.g. "email", "profile.phoneNumber"
	Type           MaskType `json:"type" bson:"type"`             // email, phone, password, hash_sha256, fixed_value, remove_field, regex_replace
	CustomValue    string   `json:"custom_value,omitempty" bson:"custom_value,omitempty"`
	RegexPattern   string   `json:"regex_pattern,omitempty" bson:"regex_pattern,omitempty"`
	RegexReplace   string   `json:"regex_replace,omitempty" bson:"regex_replace,omitempty"`
}

// CollectionCopyProgress represents progress of a single collection copy.
type CollectionCopyProgress struct {
	DatabaseName     string  `json:"database" bson:"database"`
	CollectionName   string  `json:"collection" bson:"collection"`
	TargetDatabase   string  `json:"target_database" bson:"target_database"`
	TargetCollection string  `json:"target_collection" bson:"target_collection"`
	TransferredDocs  int64   `json:"transferred_docs" bson:"transferred_docs"`
	TotalDocs        int64   `json:"total_docs" bson:"total_docs"`
	TransferredBytes int64   `json:"transferred_bytes" bson:"transferred_bytes"`
	Percent          float64 `json:"percent" bson:"percent"`
	DocsPerSec       int64   `json:"docs_per_sec" bson:"docs_per_sec"`
	BytesPerSec      int64   `json:"bytes_per_sec" bson:"bytes_per_sec"`
	Completed        bool    `json:"completed" bson:"completed"`
	Error            string  `json:"error,omitempty" bson:"error,omitempty"`
}

// JobStatus defines the execution state of a database clone job.
type JobStatus string

const (
	StatusPending   JobStatus = "PENDING"
	StatusRunning   JobStatus = "RUNNING"
	StatusCompleted JobStatus = "COMPLETED"
	StatusFailed    JobStatus = "FAILED"
	StatusCancelled JobStatus = "CANCELLED"
	StatusPaused    JobStatus = "PAUSED"
)

// CloneMode defines whether the clone is an instant live snapshot or a PITR time-travel restore.
type CloneMode string

const (
	ModeSnapshotLive CloneMode = "SNAPSHOT_LIVE"
	ModePITR         CloneMode = "POINT_IN_TIME_PITR"
)

// DatabaseMapping specifies how a database and its collections are selected and remapped.
type DatabaseMapping struct {
	SourceDatabase string            `json:"source_database" bson:"source_database"`
	TargetDatabase string            `json:"target_database" bson:"target_database"`
	AllCollections bool              `json:"all_collections" bson:"all_collections"`
	Collections    []string          `json:"collections,omitempty" bson:"collections,omitempty"`          // Selected collections
	CollectionMap  map[string]string `json:"collection_map,omitempty" bson:"collection_map,omitempty"` // SourceColl -> TargetColl remapping
}

// LogEntry represents an event or diagnostic message emitted during a clone operation.
type LogEntry struct {
	Timestamp time.Time `json:"timestamp" bson:"timestamp"`
	Level     string    `json:"level" bson:"level"` // INFO, WARN, ERROR, SUCCESS
	Message   string    `json:"message" bson:"message"`
}

// CloneJobRequest defines the input payload to launch a database clone job.
type CloneJobRequest struct {
	Name                string                  `json:"name" bson:"name"`
	Mode                CloneMode               `json:"mode" bson:"mode"` // SNAPSHOT_LIVE or POINT_IN_TIME_PITR
	Source              mongopkg.EndpointConfig `json:"source" bson:"source"`
	Target              mongopkg.EndpointConfig `json:"target" bson:"target"`
	Databases           []DatabaseMapping       `json:"databases" bson:"databases"`
	PITRTimestamp       *primitive.Timestamp    `json:"pitr_timestamp,omitempty" bson:"pitr_timestamp,omitempty"` // Oplog target timestamp
	PITRTargetTime      *time.Time              `json:"pitr_target_time,omitempty" bson:"pitr_target_time,omitempty"` // Target datetime
	MaskingRules        []MaskRule              `json:"masking_rules,omitempty" bson:"masking_rules,omitempty"`
	DropTargetFirst     bool                    `json:"drop_target_first" bson:"drop_target_first"`
	PreserveIndexes     bool                    `json:"preserve_indexes" bson:"preserve_indexes"`
	BatchSize           int                     `json:"batch_size,omitempty" bson:"batch_size,omitempty"`
	ParallelCollections int                     `json:"parallel_collections,omitempty" bson:"parallel_collections,omitempty"`
	DeferIndexes        bool                    `json:"defer_indexes,omitempty" bson:"defer_indexes,omitempty"`
}

// ProgressTelemetry holds live transfer metrics broadcast over WebSockets.
type ProgressTelemetry struct {
	Phase                string                            `json:"phase" bson:"phase"`
	CurrentCollection    string                            `json:"current_collection" bson:"current_collection"`
	TotalCollections     int                               `json:"total_collections" bson:"total_collections"`
	CompletedCollections int                               `json:"completed_collections" bson:"completed_collections"`
	TotalEstimatedDocs   int64                             `json:"total_estimated_docs" bson:"total_estimated_docs"`
	TransferredDocs      int64                             `json:"transferred_docs" bson:"transferred_docs"`
	TotalEstimatedBytes  int64                             `json:"total_estimated_bytes" bson:"total_estimated_bytes"`
	TransferredBytes     int64                             `json:"transferred_bytes" bson:"transferred_bytes"`
	Percent              float64                           `json:"percent" bson:"percent"`
	ThroughputMBs        float64                           `json:"throughput_mbs" bson:"throughput_mbs"`
	DocsPerSec           int64                             `json:"docs_per_sec" bson:"docs_per_sec"`
	ReplayedOplogOps     int64                             `json:"replayed_oplog_ops" bson:"replayed_oplog_ops"`
	ETASeconds           int64                             `json:"eta_seconds" bson:"eta_seconds"`
	Collections          map[string]CollectionCopyProgress `json:"collections" bson:"collections"`
}

// CloneJob represents the full state and history of a clone job.
type CloneJob struct {
	mu           sync.RWMutex           `json:"-" bson:"-"`
	ID           string                 `json:"id" bson:"id"`
	Name         string                 `json:"name" bson:"name"`
	Status       JobStatus              `json:"status" bson:"status"`
	Mode         CloneMode              `json:"mode" bson:"mode"`
	SourceMasked string                 `json:"source_masked" bson:"source_masked"`
	TargetMasked string                 `json:"target_masked" bson:"target_masked"`
	Request      CloneJobRequest        `json:"request" bson:"request"`
	Progress     ProgressTelemetry      `json:"progress" bson:"progress"`
	OplogWindow  *pitr.OplogWindow      `json:"oplog_window,omitempty" bson:"oplog_window,omitempty"`
	Logs         []LogEntry             `json:"logs" bson:"logs"`
	Error        string                 `json:"error,omitempty" bson:"error,omitempty"`
	CreatedAt    time.Time              `json:"created_at" bson:"created_at"`
	StartedAt    *time.Time             `json:"started_at,omitempty" bson:"started_at,omitempty"`
	FinishedAt   *time.Time             `json:"finished_at,omitempty" bson:"finished_at,omitempty"`
	DurationSec  int64                  `json:"duration_seconds" bson:"duration_seconds"`
}

// AddLog appends a timestamped log entry safely.
func (j *CloneJob) AddLog(level, msg string) {
	j.mu.Lock()
	defer j.mu.Unlock()

	entry := LogEntry{
		Timestamp: time.Now().UTC(),
		Level:     level,
		Message:   msg,
	}
	j.Logs = append(j.Logs, entry)
}

// UpdateProgress updates the progress telemetry thread-safely.
func (j *CloneJob) UpdateProgress(p ProgressTelemetry) {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.Progress = p
}

// SetProgressPhase updates the current phase thread-safely.
func (j *CloneJob) SetProgressPhase(phase string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Progress.Phase = phase
}

// InitProgressTotals initializes total estimated statistics.
func (j *CloneJob) InitProgressTotals(totalColls int, totalDocs, totalBytes int64) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Progress.TotalCollections = totalColls
	j.Progress.TotalEstimatedDocs = totalDocs
	j.Progress.TotalEstimatedBytes = totalBytes
	if j.Progress.Collections == nil {
		j.Progress.Collections = make(map[string]CollectionCopyProgress)
	}
}

// SyncResumeProgress sets progress counters when resuming from a checkpoint.
func (j *CloneJob) SyncResumeProgress(completedColls int, transferredDocs, transferredBytes int64) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Progress.CompletedCollections = completedColls
	j.Progress.TransferredDocs = transferredDocs
	j.Progress.TransferredBytes = transferredBytes
}

// SetCompletedCollections updates completed collections count thread-safely.
func (j *CloneJob) SetCompletedCollections(completed int) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Progress.CompletedCollections = completed
}

// SetProgressReplayedOplogOps updates PITR oplog progress thread-safely.
func (j *CloneJob) SetProgressReplayedOplogOps(ops int64) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Progress.ReplayedOplogOps = ops
}

// CompleteProgress marks the progress telemetry as finished thread-safely.
func (j *CloneJob) CompleteProgress() {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Progress.Phase = "Complete"
	j.Progress.Percent = 100
	j.Progress.ETASeconds = 0
}

// UpdateCollectionProgress thread-safely updates progress for a collection and recalculates overall job totals.
func (j *CloneJob) UpdateCollectionProgress(collKey string, p CollectionCopyProgress, jobStart time.Time) {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.Progress.CurrentCollection = fmt.Sprintf("%s.%s -> %s.%s", p.DatabaseName, p.CollectionName, p.TargetDatabase, p.TargetCollection)
	if j.Progress.Collections == nil {
		j.Progress.Collections = make(map[string]CollectionCopyProgress)
	}
	j.Progress.Collections[collKey] = p

	var liveDocs int64
	var liveBytes int64
	for _, cpEntry := range j.Progress.Collections {
		liveDocs += cpEntry.TransferredDocs
		liveBytes += cpEntry.TransferredBytes
	}
	j.Progress.TransferredDocs = liveDocs
	j.Progress.TransferredBytes = liveBytes
	j.Progress.DocsPerSec = p.DocsPerSec
	j.Progress.ThroughputMBs = float64(p.BytesPerSec) / (1024 * 1024)
	j.DurationSec = int64(time.Since(jobStart).Seconds())

	if j.Progress.TotalEstimatedDocs > 0 {
		j.Progress.Percent = float64(liveDocs) / float64(j.Progress.TotalEstimatedDocs) * 100
		if j.Progress.Percent > 100 {
			j.Progress.Percent = 100
		}
		if p.DocsPerSec > 0 {
			remDocs := j.Progress.TotalEstimatedDocs - liveDocs
			if remDocs > 0 {
				j.Progress.ETASeconds = remDocs / p.DocsPerSec
			} else {
				j.Progress.ETASeconds = 0
			}
		}
	}
}

// SetStatus updates job status.
func (j *CloneJob) SetStatus(status JobStatus) {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.Status = status
	now := time.Now().UTC()
	if status == StatusRunning && j.StartedAt == nil {
		j.StartedAt = &now
	} else if status == StatusCompleted || status == StatusFailed || status == StatusCancelled || status == StatusPaused {
		j.FinishedAt = &now
		if j.StartedAt != nil {
			j.DurationSec = int64(now.Sub(*j.StartedAt).Seconds())
		}
	}
}

// GetSnapshot returns a thread-safe copy of the job.
func (j *CloneJob) GetSnapshot() CloneJob {
	j.mu.RLock()
	defer j.mu.RUnlock()

	copied := *j
	copied.Logs = make([]LogEntry, len(j.Logs))
	copy(copied.Logs, j.Logs)

	if j.Progress.Collections != nil {
		copied.Progress.Collections = make(map[string]CollectionCopyProgress, len(j.Progress.Collections))
		for k, v := range j.Progress.Collections {
			copied.Progress.Collections[k] = v
		}
	} else {
		copied.Progress.Collections = make(map[string]CollectionCopyProgress)
	}

	return copied
}
