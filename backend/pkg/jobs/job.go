package jobs

import (
	"github.com/mongoclone/engine/pkg/types"
)

// Re-export core job types from pkg/types for package convenience
type (
	JobStatus         = types.JobStatus
	CloneMode         = types.CloneMode
	DatabaseMapping   = types.DatabaseMapping
	LogEntry          = types.LogEntry
	CloneJobRequest   = types.CloneJobRequest
	ProgressTelemetry = types.ProgressTelemetry
	CloneJob          = types.CloneJob
)

const (
	StatusPending   = types.StatusPending
	StatusRunning   = types.StatusRunning
	StatusCompleted = types.StatusCompleted
	StatusFailed    = types.StatusFailed
	StatusCancelled = types.StatusCancelled
	StatusPaused    = types.StatusPaused

	ModeSnapshotLive = types.ModeSnapshotLive
	ModePITR         = types.ModePITR
)
