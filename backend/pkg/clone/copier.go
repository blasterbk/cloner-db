package clone

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/mongoclone/engine/pkg/types"
)

// ProgressCallback is called as documents are transferred in batches.
type ProgressCallback func(p types.CollectionCopyProgress)

// BatchCommitCallback is invoked after a batch of documents is written to the target.
type BatchCommitCallback func(lastID any, docsInBatch int64, bytesInBatch int64)

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

// CopyCollection streams documents using a high-throughput multi-worker parallel ingestion pipeline.
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

	// 1. Drop target collection only if configured AND we are NOT resuming an interrupted job
	if c.opts.DropTargetFirst && c.opts.ResumeFromID == nil {
		_ = targetCollRef.Drop(ctx)
	}

	// 2. Open source cursor with optimized pre-fetch batch size and deterministic _id sort
	filter := bson.M{}
	if len(c.opts.FilterQuery) > 0 {
		filter = c.opts.FilterQuery
	}

	if c.opts.ResumeFromID != nil {
		resumeFilter := bson.M{"_id": bson.M{"$gt": c.opts.ResumeFromID}}
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

	cursor, err := sourceCollRef.Find(ctx, filter, findOpts)
	if err != nil {
		progress.Error = err.Error()
		return progress, fmt.Errorf("failed to open find cursor on %s.%s: %w", sourceDB, sourceColl, err)
	}
	defer cursor.Close(ctx)

	// 3. Multi-worker buffered channel pipeline
	numWorkers := c.opts.NumWorkers
	if numWorkers <= 0 {
		numWorkers = 4
	}

	batchChan := make(chan docBatch, numWorkers*4)
	var transferredDocs int64
	var transferredBytes int64
	var workerWg sync.WaitGroup
	var callbackMu sync.Mutex

	// Worker Pool: Concurrent Ingestion into Target MongoDB
	for w := 0; w < numWorkers; w++ {
		workerWg.Add(1)
		go func() {
			defer workerWg.Done()
			insertOpts := options.InsertMany().SetOrdered(false)

			for batch := range batchChan {
				if len(batch.docs) == 0 {
					continue
				}

				res, err := targetCollRef.InsertMany(ctx, batch.docs, insertOpts)
				insertedLen := int64(len(batch.docs))
				if res != nil {
					insertedLen = int64(len(res.InsertedIDs))
				} else if err != nil {
					// Some documents might still have inserted in unordered mode
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
	stopProgress := make(chan struct{})
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

	// 4. Producer: Continuous stream reading from cursor
	start := time.Now()
	hasMasking := c.opts.Masker != nil && c.opts.Masker.HasRules(sourceDB, sourceColl)
	currentBatch := make([]any, 0, c.opts.BatchSize)
	currentBatchBytes := int64(0)

	for cursor.Next(ctx) {
		select {
		case <-ctx.Done():
			close(batchChan)
			close(stopProgress)
			progress.Error = "cancelled"
			return progress, ctx.Err()
		default:
		}

		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			close(batchChan)
			close(stopProgress)
			return progress, fmt.Errorf("failed to decode document: %w", err)
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
			batchChan <- docBatch{
				docs:      currentBatch,
				byteCount: currentBatchBytes,
				lastID:    lastID,
			}
			currentBatch = make([]any, 0, c.opts.BatchSize)
			currentBatchBytes = 0
		}
	}

	// Push remaining documents
	if len(currentBatch) > 0 {
		var lastID any
		if lastDoc, ok := currentBatch[len(currentBatch)-1].(bson.M); ok {
			lastID = lastDoc["_id"]
		}
		batchChan <- docBatch{
			docs:      currentBatch,
			byteCount: currentBatchBytes,
			lastID:    lastID,
		}
	}

	close(batchChan)
	workerWg.Wait()
	close(stopProgress)

	if err := cursor.Err(); err != nil {
		progress.Error = err.Error()
		return progress, fmt.Errorf("cursor error on %s.%s: %w", sourceDB, sourceColl, err)
	}

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
