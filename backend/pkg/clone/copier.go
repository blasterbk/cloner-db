package clone

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/mongoclone/engine/pkg/types"
)

// ProgressCallback is called as documents are transferred in batches.
type ProgressCallback func(p types.CollectionCopyProgress)

// BatchCommitCallback is invoked after a batch of documents is written to the target.
type BatchCommitCallback func(lastID any, docsInBatch int64, bytesInBatch int64)

// LogCallback sends formatted progress log messages to the orchestrator audit trail.
type LogCallback func(level, msg string)

// CopierOptions defines options for the batch streaming copier.
type CopierOptions struct {
	BatchSize        int
	NumWorkers       int
	DropTargetFirst  bool
	ResumeFromID     any                 // Optional _id to resume streaming from
	Masker           *DataMasker
	FilterQuery      bson.M              // Optional custom query filter
	ProgressCallback ProgressCallback
	OnBatchCommitted BatchCommitCallback // Callback for persistence/checkpointing
	LogCallback      LogCallback         // Forward audit/retry diagnostics to job log
}

// BatchCopier handles high-throughput document streaming from source to target.
type BatchCopier struct {
	sourceClient *mongo.Client
	targetClient *mongo.Client
	opts         CopierOptions
}

// NewBatchCopier creates a new BatchCopier.
func NewBatchCopier(sourceClient, targetClient *mongo.Client, opts CopierOptions) *BatchCopier {
	if opts.BatchSize <= 0 {
		opts.BatchSize = 2500
	}
	if opts.NumWorkers <= 0 {
		opts.NumWorkers = 4 // Default 4 parallel ingestion workers
	}
	return &BatchCopier{
		sourceClient: sourceClient,
		targetClient: targetClient,
		opts:         opts,
	}
}

type docBatch struct {
	docs      []any
	byteCount int64
	lastID    any
}

// CopyCollection streams documents using a high-throughput multi-worker parallel ingestion pipeline
// with automated reconnection and retry resilience against NAT gateway stalls and network drops.
func (c *BatchCopier) CopyCollection(ctx context.Context, sourceDB, sourceColl, targetDB, targetColl string, estimatedCount int64) (*types.CollectionCopyProgress, error) {
	progress := &types.CollectionCopyProgress{
		DatabaseName:     sourceDB,
		CollectionName:   sourceColl,
		TargetDatabase:   targetDB,
		TargetCollection: targetColl,
		TotalDocs:        estimatedCount,
	}

	sourceCollRef := c.sourceClient.Database(sourceDB).Collection(sourceColl)
	targetCollRef := c.targetClient.Database(targetDB).Collection(targetColl)

	logMsg := func(level, msg string) {
		if c.opts.LogCallback != nil {
			c.opts.LogCallback(level, msg)
		}
	}

	// 1. Drop target collection only if configured AND we are NOT resuming an interrupted job
	if c.opts.DropTargetFirst && c.opts.ResumeFromID == nil {
		_ = targetCollRef.Drop(ctx)
	}

	// 2. Multi-worker buffered channel pipeline
	numWorkers := c.opts.NumWorkers
	if numWorkers <= 0 {
		numWorkers = 4
	}

	batchChan := make(chan docBatch, numWorkers*4)
	var transferredDocs int64
	var transferredBytes int64
	var workerWg sync.WaitGroup
	var callbackMu sync.Mutex
	stopProgress := make(chan struct{})

	var closeOnce sync.Once
	stopPipeline := func() {
		closeOnce.Do(func() {
			close(batchChan)
			close(stopProgress)
		})
	}
	defer func() {
		stopPipeline()
		workerWg.Wait()
	}()

	sendBatch := func(b docBatch) bool {
		select {
		case <-ctx.Done():
			return false
		case batchChan <- b:
			return true
		}
	}

	// Worker Pool: Concurrent Ingestion into Target MongoDB with automated transient write retries
	for w := 0; w < numWorkers; w++ {
		workerWg.Add(1)
		go func() {
			defer workerWg.Done()
			insertOpts := options.InsertMany().SetOrdered(false)

			for batch := range batchChan {
				if len(batch.docs) == 0 {
					continue
				}

				var insertedLen int64
				maxWriteAttempts := 5
				var lastErr error

				for attempt := 1; attempt <= maxWriteAttempts; attempt++ {
					select {
					case <-ctx.Done():
						return
					default:
					}

					writeCtx, writeCancel := context.WithTimeout(ctx, 40*time.Second)
					res, err := targetCollRef.InsertMany(writeCtx, batch.docs, insertOpts)
					writeCancel()

					if err == nil {
						if res != nil {
							insertedLen = int64(len(res.InsertedIDs))
						} else {
							insertedLen = int64(len(batch.docs))
						}
						lastErr = nil
						break
					}

					lastErr = err
					// If duplicate key error in unordered insert, partial documents were still inserted
					if mongo.IsDuplicateKeyError(err) {
						if res != nil {
							insertedLen = int64(len(res.InsertedIDs))
						} else {
							insertedLen = int64(len(batch.docs))
						}
						lastErr = nil
						break
					}

					if attempt < maxWriteAttempts {
						backoff := time.Duration(attempt*500) * time.Millisecond
						logMsg("WARN", fmt.Sprintf("[Target Retry] Transient write stall on %s.%s (attempt %d/%d): %v. Retrying in %v...", targetDB, targetColl, attempt, maxWriteAttempts, err, backoff))
						select {
						case <-ctx.Done():
							return
						case <-time.After(backoff):
						}
					}
				}

				if lastErr != nil && ctx.Err() == nil {
					logMsg("ERROR", fmt.Sprintf("[Target Write] %s.%s write had unrecovered errors after %d retries: %v", targetDB, targetColl, maxWriteAttempts, lastErr))
				}

				atomic.AddInt64(&transferredDocs, insertedLen)
				atomic.AddInt64(&transferredBytes, batch.byteCount)

				if c.opts.OnBatchCommitted != nil && batch.lastID != nil {
					c.opts.OnBatchCommitted(batch.lastID, insertedLen, batch.byteCount)
				}
			}
		}()
	}

	// Dedicated Progress Telemetry Broadcaster (Runs every 400ms)
	go func() {
		ticker := time.NewTicker(400 * time.Millisecond)
		defer ticker.Stop()
		lastDocs := int64(0)
		lastBytes := int64(0)
		lastTime := time.Now()

		for {
			select {
			case <-stopProgress:
				return
			case <-ticker.C:
				currentDocs := atomic.LoadInt64(&transferredDocs)
				currentBytes := atomic.LoadInt64(&transferredBytes)
				now := time.Now()
				elapsed := now.Sub(lastTime).Seconds()

				callbackMu.Lock()
				progress.TransferredDocs = currentDocs
				progress.TransferredBytes = currentBytes
				if estimatedCount > 0 {
					progress.Percent = float64(currentDocs) / float64(estimatedCount) * 100
					if progress.Percent > 100 {
						progress.Percent = 100
					}
				}
				if elapsed > 0 {
					docsDelta := currentDocs - lastDocs
					bytesDelta := currentBytes - lastBytes
					progress.DocsPerSec = int64(float64(docsDelta) / elapsed)
					progress.BytesPerSec = int64(float64(bytesDelta) / elapsed)
				}
				lastDocs = currentDocs
				lastBytes = currentBytes
				lastTime = now

				if c.opts.ProgressCallback != nil {
					c.opts.ProgressCallback(*progress)
				}
				callbackMu.Unlock()
			}
		}
	}()

	// 3. Producer: Resilient stream reading from cursor with automated reconnect on NAT drops
	start := time.Now()
	hasMasking := c.opts.Masker != nil && c.opts.Masker.HasRules(sourceDB, sourceColl)

	openCursor := func(fromID any) (*mongo.Cursor, error) {
		filter := bson.M{}
		if len(c.opts.FilterQuery) > 0 {
			filter = c.opts.FilterQuery
		}

		if fromID != nil {
			normID := fromID
			if m, ok := fromID.(map[string]any); ok {
				if oidStr, hasOid := m["$oid"].(string); hasOid {
					if objID, err := primitive.ObjectIDFromHex(oidStr); err == nil {
						normID = objID
					}
				}
			}
			resumeFilter := bson.M{"_id": bson.M{"$gt": normID}}
			if len(filter) > 0 {
				filter = bson.M{"$and": []bson.M{filter, resumeFilter}}
			} else {
				filter = resumeFilter
			}
		}

		findOpts := options.Find().
			SetBatchSize(int32(c.opts.BatchSize)).
			SetSort(bson.D{{Key: "_id", Value: 1}}).
			SetNoCursorTimeout(true)

		return sourceCollRef.Find(ctx, filter, findOpts)
	}

	var lastSentID any = c.opts.ResumeFromID
	currentBatch := make([]any, 0, c.opts.BatchSize)
	currentBatchBytes := int64(0)
	maxStreamRetries := 8
	retryCount := 0

	for {
		select {
		case <-ctx.Done():
			progress.Error = "cancelled"
			return progress, ctx.Err()
		default:
		}

		cursor, err := openCursor(lastSentID)
		if err != nil {
			if ctx.Err() != nil {
				progress.Error = "cancelled"
				return progress, ctx.Err()
			}

			retryCount++
			if retryCount > maxStreamRetries {
				progress.Error = err.Error()
				return progress, fmt.Errorf("failed opening cursor on %s.%s after %d retries: %w", sourceDB, sourceColl, maxStreamRetries, err)
			}

			backoff := time.Duration(retryCount*2) * time.Second
			logMsg("WARN", fmt.Sprintf("[Auto-Retry] Cannot open cursor on %s.%s: %v. Reconnecting in %v (attempt %d/%d)...", sourceDB, sourceColl, err, backoff, retryCount, maxStreamRetries))
			select {
			case <-ctx.Done():
				progress.Error = "cancelled"
				return progress, ctx.Err()
			case <-time.After(backoff):
				continue
			}
		}

		var streamErr error

		for cursor.Next(ctx) {
			retryCount = 0 // Reset retry count upon successfully receiving documents

			var doc bson.M
			if err := cursor.Decode(&doc); err != nil {
				streamErr = fmt.Errorf("failed to decode document: %w", err)
				break
			}

			rawBytes, _ := bson.Marshal(doc)
			currentBatchBytes += int64(len(rawBytes))

			if hasMasking {
				doc = c.opts.Masker.MaskDocument(sourceDB, sourceColl, doc)
			}

			currentBatch = append(currentBatch, doc)

			if len(currentBatch) >= c.opts.BatchSize {
				var lastID any
				if lastDoc, ok := currentBatch[len(currentBatch)-1].(bson.M); ok {
					lastID = lastDoc["_id"]
				}
				if lastID != nil {
					lastSentID = lastID
				}
				if !sendBatch(docBatch{
					docs:      currentBatch,
					byteCount: currentBatchBytes,
					lastID:    lastID,
				}) {
					progress.Error = "cancelled"
					return progress, ctx.Err()
				}
				currentBatch = make([]any, 0, c.opts.BatchSize)
				currentBatchBytes = 0
			}
		}

		if streamErr == nil {
			streamErr = cursor.Err()
		}
		cursor.Close(ctx)

		if ctx.Err() != nil {
			progress.Error = "cancelled"
			return progress, ctx.Err()
		}

		if streamErr != nil {
			// Network drop, NAT stall, or socket timeout occurred
			// Flush any accumulated documents before reconnecting
			if len(currentBatch) > 0 {
				var lastID any
				if lastDoc, ok := currentBatch[len(currentBatch)-1].(bson.M); ok {
					lastID = lastDoc["_id"]
				}
				if lastID != nil {
					lastSentID = lastID
				}
				if !sendBatch(docBatch{
					docs:      currentBatch,
					byteCount: currentBatchBytes,
					lastID:    lastID,
				}) {
					progress.Error = "cancelled"
					return progress, ctx.Err()
				}
				currentBatch = make([]any, 0, c.opts.BatchSize)
				currentBatchBytes = 0
			}

			retryCount++
			if retryCount > maxStreamRetries {
				progress.Error = streamErr.Error()
				return progress, fmt.Errorf("stream error on %s.%s after %d retries: %w", sourceDB, sourceColl, maxStreamRetries, streamErr)
			}

			backoff := time.Duration(retryCount*2) * time.Second
			logMsg("WARN", fmt.Sprintf("[Auto-Retry] ⚡ Network stall / NAT connection drop on %s.%s: %v. Auto-reconnecting from last _id in %v (attempt %d/%d)...",
				sourceDB, sourceColl, streamErr, backoff, retryCount, maxStreamRetries))

			select {
			case <-ctx.Done():
				progress.Error = "cancelled"
				return progress, ctx.Err()
			case <-time.After(backoff):
				continue // Re-open cursor from lastSentID and resume streaming
			}
		}

		// Cursor exhausted with no errors
		break
	}

	// Push remaining documents
	if len(currentBatch) > 0 {
		var lastID any
		if lastDoc, ok := currentBatch[len(currentBatch)-1].(bson.M); ok {
			lastID = lastDoc["_id"]
		}
		if !sendBatch(docBatch{
			docs:      currentBatch,
			byteCount: currentBatchBytes,
			lastID:    lastID,
		}) {
			progress.Error = "cancelled"
			return progress, ctx.Err()
		}
	}

	stopPipeline()
	workerWg.Wait()

	// Final summary calculation
	totalDocs := atomic.LoadInt64(&transferredDocs)
	totalBytes := atomic.LoadInt64(&transferredBytes)
	totalDuration := time.Since(start).Seconds()

	progress.TransferredDocs = totalDocs
	progress.TransferredBytes = totalBytes
	if totalDuration > 0 {
		progress.DocsPerSec = int64(float64(totalDocs) / totalDuration)
		progress.BytesPerSec = int64(float64(totalBytes) / totalDuration)
	}
	progress.Percent = 100
	progress.Completed = true

	if c.opts.ProgressCallback != nil {
		c.opts.ProgressCallback(*progress)
	}

	return progress, nil
}
