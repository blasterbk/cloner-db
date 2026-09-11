package jobs

import (
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	mongopkg "github.com/mongoclone/engine/pkg/mongo"
	"github.com/mongoclone/engine/pkg/types"
)

func TestStore_NoMockProfilesSeeded(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "store_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s := NewStore(tempDir)
	profiles := s.ListProfiles()

	if len(profiles) != 0 {
		t.Errorf("Expected 0 profiles initially, got %d", len(profiles))
	}
}

func TestStore_SaveAndListProfiles(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "store_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s := NewStore(tempDir)

	cfg := mongopkg.EndpointConfig{
		URI: "mongodb://user:pass@172.236.185.175:27017/prod_db",
	}

	saved := s.SaveProfile("Test Prod DB", "source", cfg)
	if saved.ID == "" {
		t.Fatal("Saved profile has empty ID")
	}

	profs := s.ListProfiles()
	if len(profs) != 1 {
		t.Fatalf("Expected 1 profile, got %d", len(profs))
	}
	if profs[0].Name != "Test Prod DB" {
		t.Errorf("Expected profile name 'Test Prod DB', got %s", profs[0].Name)
	}

	s.DeleteProfile(saved.ID)
	if len(s.ListProfiles()) != 0 {
		t.Errorf("Expected 0 profiles after delete, got %d", len(s.ListProfiles()))
	}
}

func TestStore_ConcurrentJobProgressAndSave(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "store_concurrent_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s := NewStore(tempDir)
	defer s.Close()

	job := s.CreateJob(types.CloneJobRequest{
		Name: "Concurrent Test Job",
		Mode: types.ModeSnapshotLive,
	})

	var wg sync.WaitGroup
	numWorkers := 8
	iterations := 50

	// Launch multiple workers concurrently modifying job collections progress and calling SaveJobAsync
	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				collKey := fmt.Sprintf("db_test.collection_%d", workerID)
				job.UpdateCollectionProgress(collKey, types.CollectionCopyProgress{
					DatabaseName:    "db_test",
					CollectionName:  fmt.Sprintf("collection_%d", workerID),
					TransferredDocs: int64(i * 100),
					TotalDocs:       10000,
				}, time.Now())

				s.SaveJobAsync(job)
			}
		}(w)
	}

	// Concurrently read jobs list
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			_ = s.ListJobs()
			time.Sleep(1 * time.Millisecond)
		}
	}()

	wg.Wait()
}

