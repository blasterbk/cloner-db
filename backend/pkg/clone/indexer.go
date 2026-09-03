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

	mongopkg "github.com/mongoclone/engine/pkg/mongo"
)

// IndexReplicator handles the creation of collection options and secondary indexes on target.
type IndexReplicator struct {
	targetClient *mongo.Client
}

// NewIndexReplicator creates a new IndexReplicator.
func NewIndexReplicator(targetClient *mongo.Client) *IndexReplicator {
	return &IndexReplicator{
		targetClient: targetClient,
	}
}

// EnsureCollection creates target collection with matched options (e.g. capped collection) if needed.
func (r *IndexReplicator) EnsureCollection(ctx context.Context, targetDB string, collDetail *mongopkg.CollectionDetail) error {
	db := r.targetClient.Database(targetDB)

	if collDetail.IsCapped {
		opts := options.CreateCollection()
		opts.SetCapped(true)
		if collDetail.MaxCappedBytes > 0 {
			opts.SetSizeInBytes(collDetail.MaxCappedBytes)
		} else {
			opts.SetSizeInBytes(1024 * 1024) // 1MB default for capped
		}
		if collDetail.MaxCappedDocs > 0 {
			opts.SetMaxDocuments(collDetail.MaxCappedDocs)
		}

		// Create collection explicitly if capped
		err := db.CreateCollection(ctx, collDetail.Name, opts)
		if err != nil && !isNamespaceExistsErr(err) {
			return fmt.Errorf("failed to create capped collection %s.%s: %w", targetDB, collDetail.Name, err)
		}
	}

	return nil
}

// ReplicateIndexes creates all non-_id secondary indexes on target collection.
func (r *IndexReplicator) ReplicateIndexes(ctx context.Context, targetDB, targetColl string, indexes []mongopkg.IndexDetail) (int, error) {
	if len(indexes) == 0 {
		return 0, nil
	}

	coll := r.targetClient.Database(targetDB).Collection(targetColl)
	var models []mongo.IndexModel

	for _, idx := range indexes {
		// Skip standard _id index
		if idx.Name == "_id_" || isDefaultIDKey(idx.Key) {
			continue
		}

		idxOpts := options.Index()
		idxOpts.SetName(idx.Name)

		if idx.Unique {
			idxOpts.SetUnique(true)
		}
		if idx.Sparse {
			idxOpts.SetSparse(true)
		}
		if idx.ExpireAfterSec != nil {
			idxOpts.SetExpireAfterSeconds(*idx.ExpireAfterSec)
		}

		models = append(models, mongo.IndexModel{
			Keys:    idx.Key,
			Options: idxOpts,
		})
	}

	if len(models) == 0 {
		return 0, nil
	}

	// Create with timeout
	createCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	names, err := coll.Indexes().CreateMany(createCtx, models)
	if err != nil {
		return len(names), fmt.Errorf("failed to create indexes on %s.%s: %w", targetDB, targetColl, err)
	}

	return len(names), nil
}

// IndexTask describes secondary indexes to replicate for a specific collection.
type IndexTask struct {
	TargetDB   string
	TargetColl string
	Indexes    []mongopkg.IndexDetail
}

// ReplicateIndexesParallel creates secondary indexes across multiple collections concurrently.
func (r *IndexReplicator) ReplicateIndexesParallel(ctx context.Context, tasks []IndexTask, maxConcurrency int) (int, []error) {
	if len(tasks) == 0 {
		return 0, nil
	}
	if maxConcurrency <= 0 {
		maxConcurrency = 4
	}

	taskChan := make(chan IndexTask, len(tasks))
	for _, t := range tasks {
		taskChan <- t
	}
	close(taskChan)

	var totalCreated int64
	var errs []error
	var errMu sync.Mutex
	var wg sync.WaitGroup

	for w := 0; w < maxConcurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for task := range taskChan {
				select {
				case <-ctx.Done():
					return
				default:
				}
				created, err := r.ReplicateIndexes(ctx, task.TargetDB, task.TargetColl, task.Indexes)
				if err != nil {
					errMu.Lock()
					errs = append(errs, fmt.Errorf("%s.%s: %w", task.TargetDB, task.TargetColl, err))
					errMu.Unlock()
				}
				atomic.AddInt64(&totalCreated, int64(created))
			}
		}()
	}

	wg.Wait()
	return int(totalCreated), errs
}

func isDefaultIDKey(key bson.D) bool {
	if len(key) == 1 && key[0].Key == "_id" {
		return true
	}
	return false
}

func isNamespaceExistsErr(err error) bool {
	if err == nil {
		return false
	}
	// Code 48 = NamespaceExists
	return mongo.IsDuplicateKeyError(err) || err.Error() == "NamespaceExists"
}
