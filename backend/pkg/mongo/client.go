package mongo

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

// ServerInfo contains cluster health, topology, and build version metadata.
type ServerInfo struct {
	Version        string   `json:"version"`
	GitVersion     string   `json:"git_version,omitempty"`
	TopologyType   string   `json:"topology_type"` // Standalone, ReplicaSet, ShardedCluster
	ReplicaSetName string   `json:"replica_set_name,omitempty"`
	IsPrimary      bool     `json:"is_primary"`
	Hosts          []string `json:"hosts,omitempty"`
	LatencyMs      int64    `json:"latency_ms"`
	UptimeSeconds  int64    `json:"uptime_seconds"`
	MaxBSONSize    int64    `json:"max_bson_size_bytes"`
	StorageEngine  string   `json:"storage_engine"`
}

// Connect creates a verified MongoDB client based on EndpointConfig.
func Connect(ctx context.Context, cfg *EndpointConfig) (*mongo.Client, error) {
	effectiveURI := cfg.GetEffectiveURI()
	clientOpts := options.Client().ApplyURI(effectiveURI)

	// Set connection pooling and connect timeout
	timeout := cfg.GetTimeout()
	clientOpts.SetConnectTimeout(timeout)
	clientOpts.SetServerSelectionTimeout(timeout)
	clientOpts.SetSocketTimeout(60 * time.Minute) // Long socket timeout for streaming
	clientOpts.SetMaxPoolSize(100)
	clientOpts.SetMinPoolSize(5)

	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize mongo client: %w", err)
	}

	return client, nil
}

// Ping verifies connectivity and returns response latency.
func Ping(ctx context.Context, client *mongo.Client) (int64, error) {
	start := time.Now()
	err := client.Ping(ctx, readpref.PrimaryPreferred())
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return 0, fmt.Errorf("ping failed: %w", err)
	}
	return latency, nil
}

// InspectServer fetches server build version, topology, replica set status, and engine information.
func InspectServer(ctx context.Context, client *mongo.Client) (*ServerInfo, error) {
	start := time.Now()
	info := &ServerInfo{
		TopologyType: "Standalone",
	}

	adminDB := client.Database("admin")

	// 1. buildInfo
	var buildInfo bson.M
	if err := adminDB.RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&buildInfo); err == nil {
		if v, ok := buildInfo["version"].(string); ok {
			info.Version = v
		}
		if gv, ok := buildInfo["gitVersion"].(string); ok {
			info.GitVersion = gv
		}
		if maxBson, ok := buildInfo["maxBsonObjectSize"].(int32); ok {
			info.MaxBSONSize = int64(maxBson)
		}
	}

	// 2. isMaster / hello
	var isMaster bson.M
	if err := adminDB.RunCommand(ctx, bson.D{{Key: "hello", Value: 1}}).Decode(&isMaster); err != nil {
		// Fallback for MongoDB < 5.0
		_ = adminDB.RunCommand(ctx, bson.D{{Key: "isMaster", Value: 1}}).Decode(&isMaster)
	}

	if isMaster != nil {
		if setName, ok := isMaster["setName"].(string); ok && setName != "" {
			info.TopologyType = "ReplicaSet"
			info.ReplicaSetName = setName
		}
		if msg, ok := isMaster["msg"].(string); ok && msg == "isdbgrid" {
			info.TopologyType = "ShardedCluster"
		}
		if isWritablePrimary, ok := isMaster["isWritablePrimary"].(bool); ok {
			info.IsPrimary = isWritablePrimary
		} else if isMasterBool, ok := isMaster["ismaster"].(bool); ok {
			info.IsPrimary = isMasterBool
		}
		if hostsRaw, ok := isMaster["hosts"].(bson.A); ok {
			for _, h := range hostsRaw {
				if hStr, ok := h.(string); ok {
					info.Hosts = append(info.Hosts, hStr)
				}
			}
		}
	}

	// 3. serverStatus for storageEngine and uptime
	var serverStatus bson.M
	if err := adminDB.RunCommand(ctx, bson.D{{Key: "serverStatus", Value: 1}}).Decode(&serverStatus); err == nil {
		if up, ok := serverStatus["uptime"].(float64); ok {
			info.UptimeSeconds = int64(up)
		} else if up, ok := serverStatus["uptime"].(int64); ok {
			info.UptimeSeconds = up
		}
		if se, ok := serverStatus["storageEngine"].(bson.M); ok {
			if name, ok := se["name"].(string); ok {
				info.StorageEngine = name
			}
		}
	}

	info.LatencyMs = time.Since(start).Milliseconds()
	return info, nil
}
