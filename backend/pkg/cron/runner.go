package cron

import (
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/mongoclone/engine/pkg/clone"
	"github.com/mongoclone/engine/pkg/jobs"
	"github.com/mongoclone/engine/pkg/types"
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
	activeJobs := r.store.ListJobs()

outerLoop:
	for _, sched := range schedules {
		if !sched.Enabled {
			continue
		}

		if now.Before(sched.NextRun) {
			continue
		}

		// Duplicate prevention: skip if a job with this schedule name is still RUNNING
		for _, j := range activeJobs {
			if j.Status == types.StatusRunning && strings.Contains(j.Name, sched.Name) {
				log.Printf("[Scheduler] Skipping '%s' — previous scheduled run is still active (job %s)", sched.Name, j.ID)
				continue outerLoop
			}
		}

		log.Printf("[Scheduler] Triggering scheduled clone job '%s' (ID: %s)", sched.Name, sched.ID)

		req := sched.Request
		req.Name = sched.Name + " (Scheduled Auto-Run)"

		job := r.store.CreateJob(req)
		r.orchestrator.StartJob(job)

		// Calculate next run using CronSpec if available, otherwise frequency string
		nextRun := calculateNextRun(sched, now)
		r.store.UpdateScheduleRun(sched.ID, now, nextRun)
	}
}

// calculateNextRun determines the next run time using CronSpec if present, otherwise frequency string.
func calculateNextRun(sched jobs.ScheduledJob, from time.Time) time.Time {
	if sched.CronSpec != "" {
		if next, err := parseCronNext(sched.CronSpec, from); err == nil {
			return next
		}
		log.Printf("[Scheduler] Warning: CronSpec '%s' for schedule '%s' could not be parsed; falling back to frequency", sched.CronSpec, sched.Name)
	}
	switch sched.Frequency {
	case "hourly":
		return from.Add(1 * time.Hour)
	case "weekly":
		return from.Add(7 * 24 * time.Hour)
	default: // "daily"
		return from.Add(24 * time.Hour)
	}
}

// parseCronNext parses a standard 5-field cron expression and returns the next trigger time after 'from'.
// Supported fields: minute hour day-of-month month day-of-week (all integers or '*').
func parseCronNext(spec string, from time.Time) (time.Time, error) {
	fields := strings.Fields(spec)
	if len(fields) != 5 {
		return time.Time{}, &cronParseError{spec: spec, msg: "expected 5 fields"}
	}

	minute, err := parseCronField(fields[0], 0, 59)
	if err != nil {
		return time.Time{}, err
	}
	hour, err := parseCronField(fields[1], 0, 23)
	if err != nil {
		return time.Time{}, err
	}

	// Advance from current time by 1 minute minimum to prevent immediate re-trigger
	candidate := from.Add(time.Minute).Truncate(time.Minute)

	// Search forward up to 1 week for next matching time
	for i := 0; i < 10080; i++ { // 10080 = 7 days × 24h × 60min
		m := candidate.Minute()
		h := candidate.Hour()

		minuteOK := minute < 0 || m == minute
		hourOK := hour < 0 || h == hour

		if minuteOK && hourOK {
			return candidate, nil
		}
		candidate = candidate.Add(time.Minute)
	}

	return time.Time{}, &cronParseError{spec: spec, msg: "no matching time found within 1 week"}
}

// parseCronField parses a single cron field: returns -1 for wildcard '*', or the integer value.
func parseCronField(field string, min, max int) (int, error) {
	if field == "*" {
		return -1, nil // wildcard
	}
	n, err := strconv.Atoi(field)
	if err != nil || n < min || n > max {
		return 0, &cronParseError{spec: field, msg: "invalid value"}
	}
	return n, nil
}

type cronParseError struct {
	spec string
	msg  string
}

func (e *cronParseError) Error() string {
	return "cron parse error for '" + e.spec + "': " + e.msg
}
