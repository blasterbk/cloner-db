package clone

import (
	"fmt"
	"math/rand"
	"os"
	"sync"
	"testing"
)

func TestCheckpointManager_ConcurrentAccess(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "checkpoint_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cm := NewCheckpointManager(tempDir, nil)
	jobID := "test-job-concurrent"
	_ = cm.GetOrCreateCheckpoint(jobID)

	numColls := 20
	for i := 0; i < numColls; i++ {
		collKey := fmt.Sprintf("test_db.coll_%d", i)
		cm.InitCollection(jobID, collKey, "test_db", fmt.Sprintf("coll_%d", i), "tgt_db", fmt.Sprintf("coll_%d", i), 100000)
	}

	var wg sync.WaitGroup
	numWorkers := 16
	iterations := 200

	// Concurrent writers simulating parallel copier workers
	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				collIdx := rand.Intn(numColls)
				collKey := fmt.Sprintf("test_db.coll_%d", collIdx)
				cm.UpdateBatchProgress(jobID, collKey, fmt.Sprintf("id_%d_%d", workerID, i), 2500, 50000)
			}
		}(w)
	}

	// Concurrent readers simulating WebSocket updates, orchestrator checks, and persistence serialization
	for r := 0; r < 8; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				snap := cm.GetJobCheckpointSnapshot(jobID)
				if snap != nil {
					// Iterate map to simulate BSON / JSON encoding
					for k, v := range snap.Collections {
						if v == nil || k == "" {
							t.Errorf("invalid collection checkpoint: %v", k)
						}
					}
				}

				collIdx := rand.Intn(numColls)
				collKey := fmt.Sprintf("test_db.coll_%d", collIdx)
				ccp := cm.GetCollectionCheckpoint(jobID, collKey)
				if ccp != nil && ccp.SourceDB != "test_db" {
					t.Errorf("unexpected SourceDB: %s", ccp.SourceDB)
				}
			}
		}()
	}

	wg.Wait()

	// Verify flush succeeds cleanly
	cm.FlushCheckpoint(jobID)

	snap := cm.GetJobCheckpointSnapshot(jobID)
	if snap == nil || len(snap.Collections) != numColls {
		t.Fatalf("expected %d collections, got %d", numColls, len(snap.Collections))
	}
}
