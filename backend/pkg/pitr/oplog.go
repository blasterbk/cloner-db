package pitr

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// OplogWindow holds information about the available Point-in-Time Recovery window in the cluster.
type OplogWindow struct {
	Available         bool      `json:"available"`
	FirstTimestamp    uint32    `json:"first_timestamp_sec"`
	FirstIncrement    uint32    `json:"first_increment"`
	FirstTimeFormatted string   `json:"first_time_formatted"`
	FirstTimeUTC      time.Time `json:"first_time_utc"`

	LastTimestamp     uint32    `json:"last_timestamp_sec"`
	LastIncrement     uint32    `json:"last_increment"`
	LastTimeFormatted string    `json:"last_time_formatted"`
	LastTimeUTC       time.Time `json:"last_time_utc"`

	WindowDurationSeconds int64 `json:"window_duration_seconds"`
	WindowDurationHuman   string `json:"window_duration_human"`
	OplogSizeBytes        int64 `json:"oplog_size_bytes"`
	OplogMaxSizeBytes     int64 `json:"oplog_max_size_bytes"`
	Message               string `json:"message,omitempty"`
}

// GetOplogWindow inspects the `local.oplog.rs` collection to determine earliest and latest timestamps.
func GetOplogWindow(ctx context.Context, client *mongo.Client) (*OplogWindow, error) {
	window := &OplogWindow{}

	localDB := client.Database("local")
	oplogColl := localDB.Collection("oplog.rs")

	// 1. Check if oplog collection exists
	count, err := oplogColl.EstimatedDocumentCount(ctx)
	if err != nil || count == 0 {
		window.Available = false
		window.Message = "Oplog is not available (source is not a Replica Set or oplog is empty)"
		return window, nil
	}

	// 2. Fetch first (earliest) oplog entry
	var firstEntry bson.M
	findFirstOpts := options.FindOne().SetSort(bson.D{{Key: "$natural", Value: 1}})
	err = oplogColl.FindOne(ctx, bson.D{}, findFirstOpts).Decode(&firstEntry)
	if err != nil {
		window.Available = false
		window.Message = fmt.Sprintf("Failed to query earliest oplog entry: %v", err)
		return window, nil
	}

	// 3. Fetch last (latest) oplog entry
	var lastEntry bson.M
	findLastOpts := options.FindOne().SetSort(bson.D{{Key: "$natural", Value: -1}})
	err = oplogColl.FindOne(ctx, bson.D{}, findLastOpts).Decode(&lastEntry)
	if err != nil {
		window.Available = false
		window.Message = fmt.Sprintf("Failed to query latest oplog entry: %v", err)
		return window, nil
	}

	// 4. Extract timestamps
	firstTS, ok1 := firstEntry["ts"].(primitive.Timestamp)
	lastTS, ok2 := lastEntry["ts"].(primitive.Timestamp)
	if !ok1 || !ok2 {
		window.Available = false
		window.Message = "Oplog timestamps format is unrecognized"
		return window, nil
	}

	window.Available = true
	window.FirstTimestamp = firstTS.T
	window.FirstIncrement = firstTS.I
	window.FirstTimeUTC = time.Unix(int64(firstTS.T), 0).UTC()
	window.FirstTimeFormatted = window.FirstTimeUTC.Format(time.RFC3339)

	window.LastTimestamp = lastTS.T
	window.LastIncrement = lastTS.I
	window.LastTimeUTC = time.Unix(int64(lastTS.T), 0).UTC()
	window.LastTimeFormatted = window.LastTimeUTC.Format(time.RFC3339)

	durationSec := int64(lastTS.T) - int64(firstTS.T)
	if durationSec < 0 {
		durationSec = 0
	}
	window.WindowDurationSeconds = durationSec
	window.WindowDurationHuman = formatDuration(time.Duration(durationSec) * time.Second)

	// 5. Get oplog storage size stats
	var collStats bson.M
	if err := localDB.RunCommand(ctx, bson.D{{Key: "collStats", Value: "oplog.rs"}}).Decode(&collStats); err == nil {
		if sz, ok := collStats["size"].(int64); ok {
			window.OplogSizeBytes = sz
		} else if sz, ok := collStats["size"].(float64); ok {
			window.OplogSizeBytes = int64(sz)
		}
		if maxSz, ok := collStats["maxSize"].(int64); ok {
			window.OplogMaxSizeBytes = maxSz
		} else if maxSz, ok := collStats["maxSize"].(float64); ok {
			window.OplogMaxSizeBytes = int64(maxSz)
		}
	}

	return window, nil
}

func formatDuration(d time.Duration) string {
	hours := int(d.Hours())
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60

	if hours > 24 {
		days := hours / 24
		hours = hours % 24
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm %ds", hours, minutes, seconds)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm %ds", minutes, seconds)
	}
	return fmt.Sprintf("%ds", seconds)
}
