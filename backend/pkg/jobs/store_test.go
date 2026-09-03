package jobs

import (
	"os"
	"testing"

	mongopkg "github.com/mongoclone/engine/pkg/mongo"
)

func TestStore_NoMockProfilesSeeded(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "store_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s := NewStore(tempDir, "")
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

	s := NewStore(tempDir, "")

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
