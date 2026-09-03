package clone

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// CollectionCheckpoint tracks the transfer progress and resume point of a single collection.
type CollectionCheckpoint struct {
	SourceDB         string    `json:"source_db"`
	SourceColl       string    `json:"source_coll"`
	TargetDB         string    `json:"target_db"`
	TargetColl       string    `json:"target_coll"`
	Status           string    `json:"status"` // "pending", "in_progress", "completed", "failed"
	LastID           any       `json:"last_id,omitempty"`
	TransferredDocs  int64     `json:"transferred_docs"`
	TransferredBytes int64     `json:"transferred_bytes"`
	TotalDocs        int64     `json:"total_docs"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// JobCheckpoint holds the persistent checkpoint state for an entire clone job.
type JobCheckpoint struct {
	JobID       string                           `json:"job_id"`
	CreatedAt   time.Time                        `json:"created_at"`
	UpdatedAt   time.Time                        `json:"updated_at"`
	Collections map[string]*CollectionCheckpoint `json:"collections"`
}

// CheckpointManager handles thread-safe disk persistence of job checkpoints.
type CheckpointManager struct {
	mu    sync.RWMutex
	dir   string
	inMem map[string]*JobCheckpoint
}

// NewCheckpointManager creates a new CheckpointManager using the given data directory.
func NewCheckpointManager(dataDir string) *CheckpointManager {
	dir := filepath.Join(dataDir, "checkpoints")
	_ = os.MkdirAll(dir, 0755)
	return &CheckpointManager{
		dir:   dir,
		inMem: make(map[string]*JobCheckpoint),
	}
}

// GetOrCreateCheckpoint loads an existing checkpoint from disk/memory or initializes a new one.
func (cm *CheckpointManager) GetOrCreateCheckpoint(jobID string) *JobCheckpoint {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cp, ok := cm.inMem[jobID]; ok {
		return cp
	}

	// Try reading from disk
	filePath := filepath.Join(cm.dir, fmt.Sprintf("%s.json", jobID))
	data, err := os.ReadFile(filePath)
	if err == nil {
		var cp JobCheckpoint
		if err := json.Unmarshal(data, &cp); err == nil {
			cm.inMem[jobID] = &cp
			return &cp
		}
	}

	// Create fresh checkpoint
	cp := &JobCheckpoint{
		JobID:       jobID,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
		Collections: make(map[string]*CollectionCheckpoint),
	}
	cm.inMem[jobID] = cp
	_ = cm.saveToDisk(cp)
	return cp
}

// InitCollection registers a planned collection into the checkpoint if not already present.
func (cm *CheckpointManager) InitCollection(jobID, collKey, srcDB, srcColl, tgtDB, tgtColl string, totalDocs int64) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	cp, ok := cm.inMem[jobID]
	if !ok {
		return
	}

	if _, exists := cp.Collections[collKey]; !exists {
		cp.Collections[collKey] = &CollectionCheckpoint{
			SourceDB:   srcDB,
			SourceColl: srcColl,
			TargetDB:   tgtDB,
			TargetColl: tgtColl,
			Status:     "pending",
			TotalDocs:  totalDocs,
			UpdatedAt:  time.Now().UTC(),
		}
		_ = cm.saveToDisk(cp)
	}
}

// UpdateBatchProgress records progress and the latest monotonic _id for a collection.
func (cm *CheckpointManager) UpdateBatchProgress(jobID, collKey string, lastID any, incDocs, incBytes int64) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	cp, ok := cm.inMem[jobID]
	if !ok {
		return
	}

	collCp, ok := cp.Collections[collKey]
	if !ok {
		return
	}

	collCp.Status = "in_progress"
	if lastID != nil {
		collCp.LastID = lastID
	}
	collCp.TransferredDocs += incDocs
	collCp.TransferredBytes += incBytes
	collCp.UpdatedAt = time.Now().UTC()
	cp.UpdatedAt = time.Now().UTC()

	_ = cm.saveToDisk(cp)
}

// MarkCollectionCompleted records that a collection has finished transferring all documents.
func (cm *CheckpointManager) MarkCollectionCompleted(jobID, collKey string, finalDocs, finalBytes int64) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	cp, ok := cm.inMem[jobID]
	if !ok {
		return
	}

	collCp, ok := cp.Collections[collKey]
	if !ok {
		return
	}

	collCp.Status = "completed"
	if finalDocs > 0 {
		collCp.TransferredDocs = finalDocs
	}
	if finalBytes > 0 {
		collCp.TransferredBytes = finalBytes
	}
	collCp.UpdatedAt = time.Now().UTC()
	cp.UpdatedAt = time.Now().UTC()

	_ = cm.saveToDisk(cp)
}

func (cm *CheckpointManager) saveToDisk(cp *JobCheckpoint) error {
	data, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return err
	}
	filePath := filepath.Join(cm.dir, fmt.Sprintf("%s.json", cp.JobID))
	tmpPath := filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, filePath)
}

// DeleteCheckpoint cleans up checkpoint files once a job is safely completed or deleted.
func (cm *CheckpointManager) DeleteCheckpoint(jobID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	delete(cm.inMem, jobID)
	filePath := filepath.Join(cm.dir, fmt.Sprintf("%s.json", jobID))
	_ = os.Remove(filePath)
}
