package cron

import (
	"log"
	"time"

	"github.com/mongoclone/engine/pkg/clone"
	"github.com/mongoclone/engine/pkg/jobs"
)

// Runner manages recurring cron schedule executions.
type Runner struct {
	store        *jobs.Store
	orchestrator *clone.Orchestrator
	stopChan     chan struct{}
}

// NewRunner creates a new background schedule runner.
func NewRunner(store *jobs.Store, orchestrator *clone.Orchestrator) *Runner {
	return &Runner{
		store:        store,
		orchestrator: orchestrator,
		stopChan:     make(chan struct{}),
	}
}

// Start begins periodic schedule evaluation every 30 seconds.
func (r *Runner) Start() {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		for {
			select {
			case <-ticker.C:
				r.evaluateSchedules()
			case <-r.stopChan:
				ticker.Stop()
				return
			}
		}
	}()
	log.Println("[Scheduler] Background cron runner initialized and active (evaluation interval: 30s)")
}

// Stop halts the background schedule runner.
func (r *Runner) Stop() {
	close(r.stopChan)
}

func (r *Runner) evaluateSchedules() {
	schedules := r.store.ListSchedules()
	now := time.Now().UTC()

	for _, sched := range schedules {
		if !sched.Enabled {
			continue
		}

		if now.After(sched.NextRun) || now.Equal(sched.NextRun) {
			log.Printf("[Scheduler] Triggering scheduled clone job '%s' (ID: %s)", sched.Name, sched.ID)

			req := sched.Request
			req.Name = sched.Name + " (Scheduled Auto-Run)"

			job := r.store.CreateJob(req)
			r.orchestrator.StartJob(job)

			// Calculate next execution time
			nextRun := now.Add(24 * time.Hour)
			switch sched.Frequency {
			case "hourly":
				nextRun = now.Add(1 * time.Hour)
			case "weekly":
				nextRun = now.Add(7 * 24 * time.Hour)
			default:
				nextRun = now.Add(24 * time.Hour)
			}

			r.store.UpdateScheduleRun(sched.ID, now, nextRun)
		}
	}
}
