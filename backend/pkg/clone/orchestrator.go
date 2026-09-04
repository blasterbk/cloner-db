package clone

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/mongoclone/engine/pkg/jobs"
	mongopkg "github.com/mongoclone/engine/pkg/mongo"
	"github.com/mongoclone/engine/pkg/pitr"
	"github.com/mongoclone/engine/pkg/types"
	"github.com/mongoclone/engine/pkg/ws"
)

// Orchestrator executes database clone and PITR recovery workflows.
type Orchestrator struct {
	store         *jobs.Store
	hub           *ws.Hub
	checkpointMgr *CheckpointManager

	// Active running job cancel funcs & pause state
	mu          sync.Mutex
	cancelFuncs map[string]context.CancelFunc
	pausedJobs  map[string]bool
}

// NewOrchestrator creates a new Orchestrator instance.
func NewOrchestrator(store *jobs.Store, hub *ws.Hub, dataDir string) *Orchestrator {
	if dataDir == "" {
		dataDir = "data"
	}
	var checkColl *mongo.Collection
	if db := store.GetDB(); db != nil {
		checkColl = db.Collection("mongoclone_checkpoints")
	}
	return &Orchestrator{
		store:         store,
		hub:           hub,
		checkpointMgr: NewCheckpointManager(dataDir, checkColl),
		cancelFuncs:   make(map[string]context.CancelFunc),
		pausedJobs:    make(map[string]bool),
	}
}

// StartJob launches an asynchronous background clone operation.
func (o *Orchestrator) StartJob(job *types.CloneJob) {
	ctx, cancel := context.WithCancel(context.Background())

	o.mu.Lock()
	o.cancelFuncs[job.ID] = cancel
	delete(o.pausedJobs, job.ID)
	o.mu.Unlock()

	go func() {
		defer func() {
			o.mu.Lock()
			delete(o.cancelFuncs, job.ID)
			o.mu.Unlock()
			cancel()
		}()

		o.runJob(ctx, job, false)
	}()
}

// PauseJob pauses an active running clone job and preserves its progress checkpoint.
func (o *Orchestrator) PauseJob(jobID string) bool {
	o.mu.Lock()
	cancel, ok := o.cancelFuncs[jobID]
	if ok {
		o.pausedJobs[jobID] = true
	}
	o.mu.Unlock()

	if ok {
		cancel()
	}

	if job, found := o.store.GetJob(jobID); found {
		job.SetStatus(types.StatusPaused)
		job.AddLog("INFO", "⏸️ Job paused by user. Progress and checkpoints saved. Ready to resume anytime.")
		o.checkpointMgr.FlushCheckpoint(jobID)
		o.store.SaveJob(job)
		o.broadcastUpdate(job)
		return true
	}
	return false
}

// ResumeJob resumes a previously paused, interrupted, cancelled, or failed clone job from its checkpoint.
func (o *Orchestrator) ResumeJob(jobID string) (bool, error) {
	job, found := o.store.GetJob(jobID)
	if !found {
		return false, fmt.Errorf("job %s not found", jobID)
	}

	o.mu.Lock()
	if _, running := o.cancelFuncs[jobID]; running {
		o.mu.Unlock()
		return false, fmt.Errorf("job %s is already running", jobID)
	}
	delete(o.pausedJobs, jobID)

	ctx, cancel := context.WithCancel(context.Background())
	o.cancelFuncs[jobID] = cancel
	o.mu.Unlock()

	go func() {
		defer func() {
			o.mu.Lock()
			delete(o.cancelFuncs, jobID)
			delete(o.pausedJobs, jobID)
			o.mu.Unlock()
			cancel()
		}()

		o.runJob(ctx, job, true)
	}()

	return true, nil
}

// CancelJob cancels an active running job.
func (o *Orchestrator) CancelJob(jobID string) bool {
	o.mu.Lock()
	cancel, ok := o.cancelFuncs[jobID]
	delete(o.pausedJobs, jobID)
	o.mu.Unlock()

	if ok {
		cancel()
	}

	if job, found := o.store.GetJob(jobID); found {
		job.SetStatus(types.StatusCancelled)
		job.AddLog("WARN", "Job execution was cancelled by user. Checkpoint preserved for resuming.")
		o.checkpointMgr.FlushCheckpoint(jobID)
		o.store.SaveJob(job)
		o.broadcastUpdate(job)
		return true
	}
	return false
}

func (o *Orchestrator) runJob(ctx context.Context, job *types.CloneJob, isResuming bool) {
	jobStart := time.Now()
	job.SetStatus(types.StatusRunning)
	if isResuming {
		job.AddLog("INFO", "Resuming execution pipeline from saved checkpoint...")
	} else {
		job.AddLog("INFO", "Starting high-speed execution pipeline...")
	}
	o.broadcastUpdate(job)

	// Step 1: Pre-flight connections
	job.SetProgressPhase("Pre-flight Check")
	job.AddLog("INFO", fmt.Sprintf("Connecting to source: %s", job.SourceMasked))
	sourceClient, err := mongopkg.Connect(ctx, &job.Request.Source)
	if err != nil {
		o.failJob(job, fmt.Sprintf("Failed to connect to source MongoDB: %v", err))
		return
	}
	defer sourceClient.Disconnect(context.Background()) //nolint:errcheck

	sourceLatency, err := mongopkg.Ping(ctx, sourceClient)
	if err != nil {
		o.failJob(job, fmt.Sprintf("Source MongoDB ping failed: %v", err))
		return
	}
	job.AddLog("SUCCESS", fmt.Sprintf("Source connected (latency: %dms)", sourceLatency))

	job.AddLog("INFO", fmt.Sprintf("Connecting to target: %s", job.TargetMasked))
	targetClient, err := mongopkg.Connect(ctx, &job.Request.Target)
	if err != nil {
		o.failJob(job, fmt.Sprintf("Failed to connect to target MongoDB: %v", err))
		return
	}
	defer targetClient.Disconnect(context.Background()) //nolint:errcheck

	targetLatency, err := mongopkg.Ping(ctx, targetClient)
	if err != nil {
		o.failJob(job, fmt.Sprintf("Target MongoDB ping failed: %v", err))
		return
	}
	job.AddLog("SUCCESS", fmt.Sprintf("Target connected (latency: %dms)", targetLatency))

	// Step 2: Check Oplog if in PITR mode & get snapshot baseline timestamp
	var baselineTS primitive.Timestamp
	if job.Request.Mode == types.ModePITR {
		job.SetProgressPhase("Oplog Window Inspection")
		oplogWindow, err := pitr.GetOplogWindow(ctx, sourceClient)
		if err != nil || !oplogWindow.Available {
			job.AddLog("WARN", fmt.Sprintf("Oplog check note: %v. Proceeding with snapshot baseline.", oplogWindow.Message))
		} else {
			job.OplogWindow = oplogWindow
			job.AddLog("INFO", fmt.Sprintf("Oplog window available from %s to %s (%s)",
				oplogWindow.FirstTimeFormatted, oplogWindow.LastTimeFormatted, oplogWindow.WindowDurationHuman))
		}

		findOpts := options.FindOne().SetSort(bson.D{{Key: "$natural", Value: -1}})
		var lastEntry bson.M
		_ = sourceClient.Database("local").Collection("oplog.rs").FindOne(
			ctx,
			bson.D{},
			findOpts,
		).Decode(&lastEntry)
		if ts, ok := lastEntry["ts"].(primitive.Timestamp); ok {
			baselineTS = ts
			job.AddLog("INFO", fmt.Sprintf("Recorded snapshot baseline timestamp: %d", baselineTS.T))
		}
	}

	// Step 3: Catalog & Schema Discovery
	job.SetProgressPhase("Catalog Discovery")
	job.AddLog("INFO", "Inspecting database catalog and schema metadata...")
	var dbHints []string
	for _, dm := range job.Request.Databases {
		if dm.SourceDatabase != "" {
			dbHints = append(dbHints, dm.SourceDatabase)
		}
	}
	if srcUriDb := job.Request.Source.ExtractDatabaseName(); srcUriDb != "" {
		dbHints = append(dbHints, srcUriDb)
	}
	catalog, err := mongopkg.InspectCatalog(ctx, sourceClient, false, dbHints...)
	if err != nil {
		o.failJob(job, fmt.Sprintf("Failed to inspect source catalog: %v", err))
		return
	}

	type planItem struct {
		SourceDB   string
		SourceColl string
		TargetDB   string
		TargetColl string
		Detail     mongopkg.CollectionDetail
	}

	var plan []planItem
	dbMap := make(map[string]string)
	var totalEstDocs int64
	var totalEstBytes int64

	for _, dbMapping := range job.Request.Databases {
		targetDB := dbMapping.TargetDatabase
		if targetDB == "" {
			targetDB = dbMapping.SourceDatabase
		}
		dbMap[dbMapping.SourceDatabase] = targetDB

		var matchedDB *mongopkg.DatabaseDetail
		for i := range catalog.Databases {
			if strings.EqualFold(catalog.Databases[i].Name, dbMapping.SourceDatabase) {
				matchedDB = &catalog.Databases[i]
				break
			}
		}

		if matchedDB == nil && len(catalog.Databases) > 0 {
			for i := range catalog.Databases {
				if !slices.Contains(mongopkg.SystemDatabases, catalog.Databases[i].Name) {
					matchedDB = &catalog.Databases[i]
					break
				}
			}
		}

		if matchedDB != nil {
			for _, collDetail := range matchedDB.Collections {
				if !dbMapping.AllCollections && len(dbMapping.Collections) > 0 {
					selected := false
					for _, c := range dbMapping.Collections {
						if strings.EqualFold(c, collDetail.Name) {
							selected = true
							break
						}
					}
					if !selected {
						continue
					}
				}

				targetColl := collDetail.Name
				if mappedColl, exists := dbMapping.CollectionMap[collDetail.Name]; exists && mappedColl != "" {
					targetColl = mappedColl
				}

				plan = append(plan, planItem{
					SourceDB:   matchedDB.Name,
					SourceColl: collDetail.Name,
					TargetDB:   targetDB,
					TargetColl: targetColl,
					Detail:     collDetail,
				})

				totalEstDocs += collDetail.DocCount
				totalEstBytes += collDetail.StorageSize
			}
		}

		if len(plan) == 0 {
			srcDB := sourceClient.Database(dbMapping.SourceDatabase)
			collsCursor, err := srcDB.ListCollections(ctx, bson.D{})
			if err == nil {
				var collSpecs []bson.M
				if err := collsCursor.All(ctx, &collSpecs); err == nil {
					for _, spec := range collSpecs {
						cName, _ := spec["name"].(string)
						if cName == "" || strings.HasPrefix(cName, "system.") {
							continue
						}
						if !dbMapping.AllCollections && len(dbMapping.Collections) > 0 {
							selected := false
							for _, c := range dbMapping.Collections {
								if strings.EqualFold(c, cName) {
									selected = true
									break
								}
							}
							if !selected {
								continue
							}
						}

						tColl := cName
						if mappedColl, exists := dbMapping.CollectionMap[cName]; exists && mappedColl != "" {
							tColl = mappedColl
						}

						coll := srcDB.Collection(cName)
						cnt, _ := coll.EstimatedDocumentCount(ctx)

						plan = append(plan, planItem{
							SourceDB:   dbMapping.SourceDatabase,
							SourceColl: cName,
							TargetDB:   targetDB,
							TargetColl: tColl,
							Detail: mongopkg.CollectionDetail{
								Name:     cName,
								DocCount: cnt,
							},
						})
						totalEstDocs += cnt
					}
				}
			}
		}
	}

	job.InitProgressTotals(len(plan), totalEstDocs, totalEstBytes)
	job.AddLog("INFO", fmt.Sprintf("Discovered %d collections to clone (est. %d documents, %.2f MB)",
		len(plan), totalEstDocs, float64(totalEstBytes)/(1024*1024)))
	o.broadcastUpdate(job)

	// Step 4: Checkpoint & Worker Pool Setup
	_ = o.checkpointMgr.GetOrCreateCheckpoint(job.ID)
	for _, item := range plan {
		collKey := fmt.Sprintf("%s.%s", item.SourceDB, item.SourceColl)
		o.checkpointMgr.InitCollection(job.ID, collKey, item.SourceDB, item.SourceColl, item.TargetDB, item.TargetColl, item.Detail.DocCount)
	}

	job.SetProgressPhase("Copying Collections (Multi-Worker Parallel)")
	masker := NewDataMasker(job.Request.MaskingRules)
	indexer := NewIndexReplicator(targetClient)

	batchSize := job.Request.BatchSize
	if batchSize <= 0 {
		batchSize = 2500
	}

	// Concurrency workers
	numWorkers := job.Request.ParallelCollections
	if numWorkers <= 0 {
		numWorkers = 4 // 4 parallel collection workers
	}

	job.AddLog("INFO", fmt.Sprintf("🚀 High-Speed Engine active: %d parallel collection workers, batch size: %d", numWorkers, batchSize))
	o.broadcastUpdate(job)

	// Secondary index stashing for "Bulk Stream First, Index Later"
	var indexTasks []IndexTask
	var indexTasksMu sync.Mutex

	var completedCollsCount int64
	var totalTransDocs int64
	var totalTransBytes int64

	// Sync existing progress from checkpoint if resuming
	if isResuming {
		cpSnapshot := o.checkpointMgr.GetJobCheckpointSnapshot(job.ID)
		if cpSnapshot != nil {
			for _, item := range plan {
				collKey := fmt.Sprintf("%s.%s", item.SourceDB, item.SourceColl)
				if ccp, ok := cpSnapshot.Collections[collKey]; ok {
					if ccp.Status == "completed" {
						atomic.AddInt64(&completedCollsCount, 1)
						atomic.AddInt64(&totalTransDocs, ccp.TransferredDocs)
						atomic.AddInt64(&totalTransBytes, ccp.TransferredBytes)
					} else if ccp.Status == "in_progress" {
						atomic.AddInt64(&totalTransDocs, ccp.TransferredDocs)
						atomic.AddInt64(&totalTransBytes, ccp.TransferredBytes)
					}
				}
			}
		}
		job.SyncResumeProgress(int(completedCollsCount), totalTransDocs, totalTransBytes)
		o.broadcastUpdate(job)
	}

	planChan := make(chan planItem, len(plan))
	for _, item := range plan {
		planChan <- item
	}
	close(planChan)

	var wg sync.WaitGroup
	var workerErr error
	var errMu sync.Mutex

	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			for item := range planChan {
				select {
				case <-ctx.Done():
					return
				default:
				}

				collKey := fmt.Sprintf("%s.%s", item.SourceDB, item.SourceColl)
				collCp := o.checkpointMgr.GetCollectionCheckpoint(job.ID, collKey)

				// If already completed in checkpoint, skip!
				if collCp != nil && collCp.Status == "completed" {
					job.AddLog("INFO", fmt.Sprintf("[Checkpoint] Skipping %s (already completed with %d docs)", collKey, collCp.TransferredDocs))
					continue
				}

				var resumeID any
				if collCp != nil && collCp.Status == "in_progress" && collCp.LastID != nil {
					resumeID = collCp.LastID
					job.AddLog("INFO", fmt.Sprintf("[Checkpoint] Resuming %s from last_id: %v (transferred %d docs)", collKey, resumeID, collCp.TransferredDocs))
				} else {
					job.AddLog("INFO", fmt.Sprintf("[Worker %d] Streaming collection %s.%s -> %s.%s (est. %d docs)",
						workerID+1, item.SourceDB, item.SourceColl, item.TargetDB, item.TargetColl, item.Detail.DocCount))
				}

				// 4a. Stash index definitions (Bulk Stream First, Index Later)
				if job.Request.PreserveIndexes && len(item.Detail.Indexes) > 0 {
					indexTasksMu.Lock()
					indexTasks = append(indexTasks, IndexTask{
						TargetDB:   item.TargetDB,
						TargetColl: item.TargetColl,
						Indexes:    item.Detail.Indexes,
					})
					indexTasksMu.Unlock()
				}

				// 4b. Ensure collection options (capped, etc.)
				if err := indexer.EnsureCollection(ctx, item.TargetDB, &item.Detail); err != nil {
					job.AddLog("WARN", fmt.Sprintf("Ensure collection notice on %s.%s: %v", item.TargetDB, item.TargetColl, err))
				}

				// 4c. Setup Copier with Checkpointing callback
				copier := NewBatchCopier(sourceClient, targetClient, CopierOptions{
					BatchSize:        batchSize,
					NumWorkers:       2,
					DropTargetFirst:  job.Request.DropTargetFirst,
					ResumeFromID:     resumeID,
					Masker:           masker,
					ProgressCallback: func(p types.CollectionCopyProgress) {
						job.UpdateCollectionProgress(collKey, p, jobStart)
						o.broadcastUpdate(job)
					},
					OnBatchCommitted: func(lastID any, docsInBatch int64, bytesInBatch int64) {
						o.checkpointMgr.UpdateBatchProgress(job.ID, collKey, lastID, docsInBatch, bytesInBatch)
					},
					LogCallback: func(level, msg string) {
						job.AddLog(level, msg)
						o.broadcastUpdate(job)
					},
				})

				res, err := copier.CopyCollection(ctx, item.SourceDB, item.SourceColl, item.TargetDB, item.TargetColl, item.Detail.DocCount)
				if err != nil {
					errMu.Lock()
					if workerErr == nil {
						workerErr = fmt.Errorf("failed copying %s.%s: %w", item.SourceDB, item.SourceColl, err)
					}
					errMu.Unlock()
					return
				}

				// Mark collection completed in checkpoint
				o.checkpointMgr.MarkCollectionCompleted(job.ID, collKey, res.TransferredDocs, res.TransferredBytes)
				atomic.AddInt64(&completedCollsCount, 1)

				job.SetCompletedCollections(int(atomic.LoadInt64(&completedCollsCount)))
				o.broadcastUpdate(job)
			}
		}(w)
	}

	wg.Wait()

	if ctx.Err() != nil {
		o.mu.Lock()
		isPaused := o.pausedJobs[job.ID]
		o.mu.Unlock()

		if isPaused {
			job.SetStatus(types.StatusPaused)
			job.AddLog("INFO", "⏸️ Job execution paused. Checkpoint saved. Click Resume to continue.")
		} else {
			job.SetStatus(types.StatusCancelled)
			job.AddLog("WARN", "Job execution was cancelled. Checkpoint saved for resume.")
		}
		o.checkpointMgr.FlushCheckpoint(job.ID)
		o.store.SaveJob(job)
		o.broadcastUpdate(job)
		return
	}

	if workerErr != nil {
		o.failJob(job, workerErr.Error())
		return
	}

	// Step 5: Post-Copy Deferred Parallel Index Building ("Index Later")
	if len(indexTasks) > 0 {
		job.SetProgressPhase("Building Secondary Indexes (Parallel)")
		job.AddLog("INFO", fmt.Sprintf("⚡ Bulk Stream complete! Creating secondary indexes across %d collections in parallel...", len(indexTasks)))
		o.broadcastUpdate(job)

		createdIdxs, idxErrs := indexer.ReplicateIndexesParallel(ctx, indexTasks, 4)
		if len(idxErrs) > 0 {
			job.AddLog("WARN", fmt.Sprintf("Secondary index creation completed with %d warnings: %v", len(idxErrs), idxErrs[0]))
		} else {
			job.AddLog("SUCCESS", fmt.Sprintf("Successfully built %d secondary indexes across all collections", createdIdxs))
		}
	}

	// Step 6: Oplog PITR Replay (if requested)
	if job.Request.Mode == types.ModePITR && job.Request.PITRTimestamp != nil {
		job.SetProgressPhase("Replaying Oplog (PITR)")
		job.AddLog("INFO", fmt.Sprintf("Replaying oplog from snapshot baseline %d up to target timestamp %d...",
			baselineTS.T, job.Request.PITRTimestamp.T))

		replayer := pitr.NewReplayer(sourceClient, targetClient, &pitr.ReplayerConfig{
			FromTimestamp:  baselineTS,
			UntilTimestamp: *job.Request.PITRTimestamp,
			DatabaseMap:    dbMap,
			ProgressCb: func(replayedCount int64, currentTS primitive.Timestamp, lastOp string) {
				job.SetProgressReplayedOplogOps(replayedCount)
				o.broadcastUpdate(job)
			},
		})

		replayed, err := replayer.Replay(ctx)
		if err != nil {
			job.AddLog("WARN", fmt.Sprintf("Oplog replay warning: %v", err))
		} else {
			job.SetProgressReplayedOplogOps(replayed)
			job.AddLog("SUCCESS", fmt.Sprintf("Successfully replayed %d incremental oplog operations", replayed))
		}
	}

	// Step 7: Finalize
	job.CompleteProgress()
	job.SetStatus(types.StatusCompleted)
	job.AddLog("SUCCESS", fmt.Sprintf("Database clone completed successfully! Transferred %d documents (%.2f MB) in %d seconds.",
		job.Progress.TransferredDocs, float64(job.Progress.TransferredBytes)/(1024*1024), job.DurationSec))

	// Clean up completed checkpoint
	o.checkpointMgr.DeleteCheckpoint(job.ID)
	o.broadcastUpdate(job)
}

func (o *Orchestrator) failJob(job *types.CloneJob, errMsg string) {
	job.Error = errMsg
	job.SetStatus(types.StatusFailed)
	job.AddLog("ERROR", errMsg)
	o.checkpointMgr.FlushCheckpoint(job.ID)
	o.broadcastUpdate(job)
}

func (o *Orchestrator) broadcastUpdate(job *types.CloneJob) {
	snapshot := job.GetSnapshot()
	o.hub.BroadcastJSON("PROGRESS", job.ID, snapshot)
	o.store.SaveJob(job)
}
