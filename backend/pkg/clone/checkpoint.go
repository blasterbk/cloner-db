package clone

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// CollectionCheckpoint tracks the transfer progress and resume point of a single collection.
type CollectionCheckpoint struct {
	SourceDB         string    `json:"source_db" bson:"source_db"`
	SourceColl       string    `json:"source_coll" bson:"source_coll"`
	TargetDB         string    `json:"target_db" bson:"target_db"`
	TargetColl       string    `json:"target_coll" bson:"target_coll"`
	Status           string    `json:"status" bson:"status"` // "pending", "in_progress", "completed", "failed"
	LastID           any       `json:"last_id,omitempty" bson:"last_id,omitempty"`
	TransferredDocs  int64     `json:"transferred_docs" bson:"transferred_docs"`
	TransferredBytes int64     `json:"transferred_bytes" bson:"transferred_bytes"`
	TotalDocs        int64     `json:"total_docs" bson:"total_docs"`
	UpdatedAt        time.Time `json:"updated_at" bson:"updated_at"`
}

// JobCheckpoint holds the persistent checkpoint state for an entire clone job.
type JobCheckpoint struct {
	JobID       string                           `json:"job_id" bson:"job_id"`
	CreatedAt   time.Time                        `json:"created_at" bson:"created_at"`
	UpdatedAt   time.Time                        `json:"updated_at" bson:"updated_at"`
	Collections map[string]*CollectionCheckpoint `json:"collections" bson:"collections"`
}

// CheckpointManager handles thread-safe persistence of job checkpoints in MongoDB and local cache.
type CheckpointManager struct {
	mu        sync.RWMutex
	dir       string
	inMem     map[string]*JobCheckpoint
	checkColl *mongo.Collection
}

// NewCheckpointManager creates a new CheckpointManager using MongoDB and local fallback directory.
func NewCheckpointManager(dataDir string, checkColl *mongo.Collection) *CheckpointManager {
	dir := filepath.Join(dataDir, "checkpoints")
	_ = os.MkdirAll(dir, 0755)
	return &CheckpointManager{
		dir:       dir,
		inMem:     make(map[string]*JobCheckpoint),
		checkColl: checkColl,
	}
}

// GetOrCreateCheckpoint loads an existing checkpoint from memory, MongoDB, or disk.
func (cm *CheckpointManager) GetOrCreateCheckpoint(jobID string) *JobCheckpoint {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cp, ok := cm.inMem[jobID]; ok {
		return cp
	}

	// 1. Try reading from MongoDB
	if cm.checkColl != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		var cp JobCheckpoint
		err := cm.checkColl.FindOne(ctx, bson.M{"job_id": jobID}).Decode(&cp)
		cancel()
		if err == nil && cp.JobID != "" {
			if cp.Collections == nil {
				cp.Collections = make(map[string]*CollectionCheckpoint)
			}
			cm.inMem[jobID] = &cp
			_ = cm.saveToDisk(&cp)
			return &cp
		}
	}

	// 2. Try reading from local disk cache
	filePath := filepath.Join(cm.dir, fmt.Sprintf("%s.json", jobID))
	data, err := os.ReadFile(filePath)
	if err == nil {
		var cp JobCheckpoint
		if err := json.Unmarshal(data, &cp); err == nil {
			if cp.Collections == nil {
				cp.Collections = make(map[string]*CollectionCheckpoint)
			}
			cm.inMem[jobID] = &cp
			return &cp
		}
	}

	// 3. Create fresh checkpoint
	cp := &JobCheckpoint{
		JobID:       jobID,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
		Collections: make(map[string]*CollectionCheckpoint),
	}
	cm.inMem[jobID] = cp
	_ = cm.saveCheckpoint(cp)
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
		_ = cm.saveCheckpoint(cp)
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

	_ = cm.saveCheckpoint(cp)
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

	_ = cm.saveCheckpoint(cp)
}

func (cm *CheckpointManager) saveCheckpoint(cp *JobCheckpoint) error {
	// 1. Save to disk cache
	_ = cm.saveToDisk(cp)

	// 2. Persist to MongoDB collection mongoclone_checkpoints
	if cm.checkColl != nil {
		go func(item JobCheckpoint) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			opts := options.Replace().SetUpsert(true)
			_, _ = cm.checkColl.ReplaceOne(ctx, bson.M{"job_id": item.JobID}, item, opts)
		}(*cp)
	}

	return nil
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

// DeleteCheckpoint cleans up checkpoint once a job is safely completed or deleted.
func (cm *CheckpointManager) DeleteCheckpoint(jobID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	delete(cm.inMem, jobID)
	filePath := filepath.Join(cm.dir, fmt.Sprintf("%s.json", jobID))
	_ = os.Remove(filePath)

	if cm.checkColl != nil {
		go func(id string) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = cm.checkColl.DeleteOne(ctx, bson.M{"job_id": id})
		}(jobID)
	}
}
