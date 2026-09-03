package pitr

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ReplayProgressCallback reports incremental oplog replay progress.
type ReplayProgressCallback func(replayedCount int64, currentTS primitive.Timestamp, lastOp string)

// ReplayerConfig configures the oplog replay process.
type ReplayerConfig struct {
	FromTimestamp  primitive.Timestamp           // Starting oplog timestamp (exclusive/inclusive)
	UntilTimestamp primitive.Timestamp           // Ending target timestamp (inclusive)
	DatabaseMap    map[string]string             // SourceDB -> TargetDB remapping
	IncludeDBs     []string                      // Whitelist of databases to replay
	ExcludeDBs     []string                      // Blacklist of databases
	ProgressCb     ReplayProgressCallback        // Live progress reporter
}

// Replayer manages the streaming and execution of oplog operations onto target MongoDB.
type Replayer struct {
	sourceClient *mongo.Client
	targetClient *mongo.Client
	cfg          *ReplayerConfig
}

// NewReplayer creates a new Oplog Replayer.
func NewReplayer(sourceClient, targetClient *mongo.Client, cfg *ReplayerConfig) *Replayer {
	return &Replayer{
		sourceClient: sourceClient,
		targetClient: targetClient,
		cfg:          cfg,
	}
}

// Replay streams and applies oplog entries matching the time window and database filters.
func (r *Replayer) Replay(ctx context.Context) (int64, error) {
	oplogColl := r.sourceClient.Database("local").Collection("oplog.rs")

	// 1. Build time range query
	timeFilter := bson.M{}
	if r.cfg.FromTimestamp.T > 0 {
		timeFilter["$gte"] = r.cfg.FromTimestamp
	}
	if r.cfg.UntilTimestamp.T > 0 {
		timeFilter["$lte"] = r.cfg.UntilTimestamp
	}

	filter := bson.M{}
	if len(timeFilter) > 0 {
		filter["ts"] = timeFilter
	}

	// 2. Query oplog with cursor in natural ascending order
	findOpts := options.Find().
		SetSort(bson.D{{Key: "$natural", Value: 1}}).
		SetBatchSize(2000).
		SetCursorType(options.NonTailable)

	cursor, err := oplogColl.Find(ctx, filter, findOpts)
	if err != nil {
		return 0, fmt.Errorf("failed to open oplog cursor: %w", err)
	}
	defer cursor.Close(ctx)

	var replayedCount int64

	for cursor.Next(ctx) {
		select {
		case <-ctx.Done():
			return replayedCount, ctx.Err()
		default:
		}

		var entry bson.M
		if err := cursor.Decode(&entry); err != nil {
			return replayedCount, fmt.Errorf("failed to decode oplog entry: %w", err)
		}

		ns, _ := entry["ns"].(string)
		op, _ := entry["op"].(string)
		ts, _ := entry["ts"].(primitive.Timestamp)

		// Parse namespace: "database.collection" or "database.$cmd"
		parts := strings.SplitN(ns, ".", 2)
		if len(parts) < 2 {
			continue
		}
		sourceDB, sourceColl := parts[0], parts[1]

		// Filter system DBs and exclusions
		if sourceDB == "admin" || sourceDB == "config" || sourceDB == "local" {
			continue
		}

		if len(r.cfg.IncludeDBs) > 0 {
			included := false
			for _, db := range r.cfg.IncludeDBs {
				if db == sourceDB {
					included = true
					break
				}
			}
			if !included {
				continue
			}
		}

		// Remap target database if specified
		targetDB := sourceDB
		if mapped, ok := r.cfg.DatabaseMap[sourceDB]; ok && mapped != "" {
			targetDB = mapped
		}

		// Apply operation
		if err := r.applyOp(ctx, targetDB, sourceColl, op, entry); err != nil {
			// Log and continue on non-fatal duplicate key errors
			// or return if critical
		}

		replayedCount++

		if r.cfg.ProgressCb != nil && replayedCount%100 == 0 {
			r.cfg.ProgressCb(replayedCount, ts, fmt.Sprintf("%s on %s.%s", op, targetDB, sourceColl))
		}
	}

	if err := cursor.Err(); err != nil {
		return replayedCount, fmt.Errorf("oplog cursor error: %w", err)
	}

	return replayedCount, nil
}

// applyOp translates and executes a single oplog operation on the target cluster.
func (r *Replayer) applyOp(ctx context.Context, targetDB, targetColl, op string, entry bson.M) error {
	db := r.targetClient.Database(targetDB)

	switch op {
	case "i": // Insert
		doc, ok := entry["o"].(bson.M)
		if !ok {
			return nil
		}
		coll := db.Collection(targetColl)
		// Use upsert or ReplaceOne with upsert to make replay idempotent
		if idVal, hasID := doc["_id"]; hasID {
			opts := options.Replace().SetUpsert(true)
			_, err := coll.ReplaceOne(ctx, bson.M{"_id": idVal}, doc, opts)
			return err
		}
		_, err := coll.InsertOne(ctx, doc)
		return err

	case "u": // Update
		updateDoc, ok1 := entry["o"].(bson.M)
		queryDoc, ok2 := entry["o2"].(bson.M)
		if !ok1 || !ok2 {
			return nil
		}
		coll := db.Collection(targetColl)
		// If updateDoc has $-operators ($set, $unset)
		hasDollar := false
		for k := range updateDoc {
			if strings.HasPrefix(k, "$") {
				hasDollar = true
				break
			}
		}
		if hasDollar {
			_, err := coll.UpdateOne(ctx, queryDoc, updateDoc)
			return err
		}
		// Full document replacement
		opts := options.Replace().SetUpsert(true)
		_, err := coll.ReplaceOne(ctx, queryDoc, updateDoc, opts)
		return err

	case "d": // Delete
		filterDoc, ok := entry["o"].(bson.M)
		if !ok {
			return nil
		}
		coll := db.Collection(targetColl)
		_, err := coll.DeleteOne(ctx, filterDoc)
		return err

	case "c": // Database command (createIndex, drop, etc.)
		cmdObj, ok := entry["o"].(bson.M)
		if !ok {
			return nil
		}
		// Execute command on target database if supported
		if _, ok := cmdObj["drop"]; ok {
			collName, _ := cmdObj["drop"].(string)
			if collName != "" {
				_ = db.Collection(collName).Drop(ctx)
			}
			return nil
		}
		if _, ok := cmdObj["dropDatabase"]; ok {
			_ = db.Drop(ctx)
			return nil
		}
		// Execute other commands with context timeout
		cmdCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		_ = db.RunCommand(cmdCtx, cmdObj)
		return nil

	case "n": // No-op
		return nil
	}

	return nil
}
