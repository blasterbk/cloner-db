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

// Clone creates an isolated, deep copy of JobCheckpoint safe for background serialization.
func (cp *JobCheckpoint) Clone() *JobCheckpoint {
	if cp == nil {
		return nil
	}
	newCp := &JobCheckpoint{
		JobID:     cp.JobID,
		CreatedAt: cp.CreatedAt,
		UpdatedAt: cp.UpdatedAt,
	}
	if cp.Collections != nil {
		newCp.Collections = make(map[string]*CollectionCheckpoint, len(cp.Collections))
		for k, v := range cp.Collections {
			if v != nil {
				vCopy := *v
				newCp.Collections[k] = &vCopy
			}
		}
	} else {
		newCp.Collections = make(map[string]*CollectionCheckpoint)
	}
	return newCp
}

// CheckpointManager handles thread-safe persistence of job checkpoints in MongoDB and local cache.
type CheckpointManager struct {
	mu        sync.RWMutex
	saveMu    sync.Mutex
	dir       string
	inMem     map[string]*JobCheckpoint
	lastSaved map[string]time.Time
	checkColl *mongo.Collection
}

// NewCheckpointManager creates a new CheckpointManager using MongoDB and local fallback directory.
func NewCheckpointManager(dataDir string, checkColl *mongo.Collection) *CheckpointManager {
	dir := filepath.Join(dataDir, "checkpoints")
	_ = os.MkdirAll(dir, 0755)
	return &CheckpointManager{
		dir:       dir,
		inMem:     make(map[string]*JobCheckpoint),
		lastSaved: make(map[string]time.Time),
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
			cm.saveCheckpointLocked(&cp, true)
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
	cm.saveCheckpointLocked(cp, true)
	return cp
}

// GetCollectionCheckpoint safely returns a copy of a single collection checkpoint.
func (cm *CheckpointManager) GetCollectionCheckpoint(jobID, collKey string) *CollectionCheckpoint {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	cp, ok := cm.inMem[jobID]
	if !ok {
		return nil
	}
	ccp, ok := cp.Collections[collKey]
	if !ok || ccp == nil {
		return nil
	}
	copy := *ccp
	return &copy
}

// GetJobCheckpointSnapshot safely returns an isolated deep clone of the entire job checkpoint.
func (cm *CheckpointManager) GetJobCheckpointSnapshot(jobID string) *JobCheckpoint {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	cp, ok := cm.inMem[jobID]
	if !ok {
		return nil
	}
	return cp.Clone()
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
		cm.saveCheckpointLocked(cp, true)
	}
}

// UpdateBatchProgress records progress and the latest monotonic _id for a collection with throttled persistence.
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

	cm.saveCheckpointLocked(cp, false)
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

	cm.saveCheckpointLocked(cp, true)
}

// saveCheckpointLocked persists the checkpoint using an isolated snapshot. Must be called while holding cm.mu.
func (cm *CheckpointManager) saveCheckpointLocked(cp *JobCheckpoint, force bool) {
	if !force {
		if last, ok := cm.lastSaved[cp.JobID]; ok && time.Since(last) < 1500*time.Millisecond {
			return
		}
	}
	cm.lastSaved[cp.JobID] = time.Now()
	snapshot := cp.Clone()

	go func(item *JobCheckpoint) {
		cm.saveMu.Lock()
		defer cm.saveMu.Unlock()

		_ = cm.saveToDisk(item)

		if cm.checkColl != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			opts := options.Replace().SetUpsert(true)
			_, _ = cm.checkColl.ReplaceOne(ctx, bson.M{"job_id": item.JobID}, item, opts)
		}
	}(snapshot)
}

// FlushCheckpoint forces a synchronous, guaranteed save of the checkpoint to disk and MongoDB.
func (cm *CheckpointManager) FlushCheckpoint(jobID string) {
	cm.mu.Lock()
	cp, ok := cm.inMem[jobID]
	if !ok {
		cm.mu.Unlock()
		return
	}
	cm.lastSaved[jobID] = time.Now()
	snapshot := cp.Clone()
	cm.mu.Unlock()

	cm.saveMu.Lock()
	defer cm.saveMu.Unlock()

	_ = cm.saveToDisk(snapshot)
	if cm.checkColl != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		opts := options.Replace().SetUpsert(true)
		_, _ = cm.checkColl.ReplaceOne(ctx, bson.M{"job_id": snapshot.JobID}, snapshot, opts)
	}
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
	delete(cm.lastSaved, jobID)
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
