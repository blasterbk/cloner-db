package mongo

import (
	"context"
	"slices"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// IndexDetail contains complete index definition needed for replication.
type IndexDetail struct {
	Name           string `json:"name"`
	Key            bson.D `json:"key"`
	Unique         bool   `json:"unique,omitempty"`
	Sparse         bool   `json:"sparse,omitempty"`
	Background     bool   `json:"background,omitempty"`
	ExpireAfterSec *int32 `json:"expire_after_seconds,omitempty"`
	SizeBytes      int64  `json:"size_bytes"`
}

// CollectionDetail holds statistics and schema metadata for a single collection.
type CollectionDetail struct {
	Name           string        `json:"name"`
	DocCount       int64         `json:"doc_count"`
	StorageSize    int64         `json:"storage_size_bytes"`
	AvgDocSize     int64         `json:"avg_doc_size_bytes"`
	TotalIndexSize int64         `json:"total_index_size_bytes"`
	IndexCount     int           `json:"index_count"`
	IsCapped       bool          `json:"is_capped"`
	MaxCappedDocs  int64         `json:"max_capped_docs,omitempty"`
	MaxCappedBytes int64         `json:"max_capped_bytes,omitempty"`
	Indexes        []IndexDetail `json:"indexes"`
}

// DatabaseDetail represents a database and its list of collections.
type DatabaseDetail struct {
	Name             string             `json:"name"`
	SizeBytes        int64              `json:"size_bytes"`
	Empty            bool               `json:"empty"`
	TotalCollections int                `json:"total_collections"`
	TotalDocuments   int64              `json:"total_documents"`
	Collections      []CollectionDetail `json:"collections"`
}

// ClusterCatalog represents the complete catalog of an entire MongoDB cluster.
type ClusterCatalog struct {
	TotalDatabases   int              `json:"total_databases"`
	TotalCollections int              `json:"total_collections"`
	TotalDocuments   int64            `json:"total_documents"`
	TotalDataSize    int64            `json:"total_data_size_bytes"`
	Databases        []DatabaseDetail `json:"databases"`
}

// System databases that should usually be excluded from standard user cloning
var SystemDatabases = []string{"admin", "config", "local"}

// InspectCatalog performs a fast concurrent scan of all databases, collections, and indexes.
func InspectCatalog(ctx context.Context, client *mongo.Client, includeSystemDBs bool) (*ClusterCatalog, error) {
	catalog := &ClusterCatalog{
		Databases: make([]DatabaseDetail, 0),
	}

	// 1. List all databases
	adminDB := client.Database("admin")
	var listRes bson.M
	var dbNames []string
	dbSizes := make(map[string]int64)

	listCtx, listCancel := context.WithTimeout(ctx, 3*time.Second)
	defer listCancel()

	if err := adminDB.RunCommand(listCtx, bson.D{{Key: "listDatabases", Value: 1}}).Decode(&listRes); err == nil {
		if rawDBs, ok := listRes["databases"].(bson.A); ok {
			for _, dbRaw := range rawDBs {
				if dbObj, ok := dbRaw.(bson.M); ok {
					if name, ok := dbObj["name"].(string); ok && name != "" {
						dbNames = append(dbNames, name)
						if sz, ok := dbObj["sizeOnDisk"].(float64); ok {
							dbSizes[name] = int64(sz)
						} else if sz, ok := dbObj["sizeOnDisk"].(int64); ok {
							dbSizes[name] = sz
						}
					}
				}
			}
		}
	}

	// Fallback to client.ListDatabaseNames if listDatabases admin command returned empty
	if len(dbNames) == 0 {
		if names, err := client.ListDatabaseNames(ctx, bson.D{}); err == nil {
			dbNames = names
		}
	}

	var filteredDBs []string
	for _, dbName := range dbNames {
		if !includeSystemDBs && slices.Contains(SystemDatabases, dbName) {
			continue
		}
		filteredDBs = append(filteredDBs, dbName)
	}

	// Inspect all databases concurrently in parallel
	type dbResult struct {
		index  int
		detail DatabaseDetail
	}

	resultsChan := make(chan dbResult, len(filteredDBs))
	var wg sync.WaitGroup

	for i, dbName := range filteredDBs {
		wg.Add(1)
		go func(idx int, dName string) {
			defer wg.Done()

			dbDetail := DatabaseDetail{
				Name:        dName,
				SizeBytes:   dbSizes[dName],
				Collections: make([]CollectionDetail, 0),
			}

			db := client.Database(dName)
			collCtx, collCancel := context.WithTimeout(ctx, 3*time.Second)
			defer collCancel()

			collsCursor, err := db.ListCollections(collCtx, bson.D{})
			if err != nil {
				resultsChan <- dbResult{index: idx, detail: dbDetail}
				return
			}

			var collSpecs []bson.M
			if err := collsCursor.All(collCtx, &collSpecs); err != nil {
				resultsChan <- dbResult{index: idx, detail: dbDetail}
				return
			}

			// Inspect collections within this DB concurrently (up to 12 workers)
			type collResult struct {
				cIdx   int
				detail CollectionDetail
			}

			var cWg sync.WaitGroup
			cChan := make(chan collResult, len(collSpecs))
			sem := make(chan struct{}, 12)

			for cIdx, spec := range collSpecs {
				collName, _ := spec["name"].(string)
				if collName == "" || strings.HasPrefix(collName, "system.") {
					continue
				}

				cWg.Add(1)
				go func(cIndex int, cSpec bson.M, name string) {
					defer cWg.Done()
					sem <- struct{}{}
					defer func() { <-sem }()

					cDetail := CollectionDetail{
						Name:    name,
						Indexes: make([]IndexDetail, 0),
					}

					// Check options
					if opts, ok := cSpec["options"].(bson.M); ok {
						if capped, ok := opts["capped"].(bool); ok && capped {
							cDetail.IsCapped = true
							if maxDocs, ok := opts["max"].(int64); ok {
								cDetail.MaxCappedDocs = maxDocs
							}
							if maxBytes, ok := opts["size"].(int64); ok {
								cDetail.MaxCappedBytes = maxBytes
							}
						}
					}

					itemCtx, itemCancel := context.WithTimeout(ctx, 2*time.Second)
					defer itemCancel()

					coll := db.Collection(name)

					// Quick collStats command
					var collStats bson.M
					if err := db.RunCommand(itemCtx, bson.D{{Key: "collStats", Value: name}}).Decode(&collStats); err == nil {
						if cnt, ok := collStats["count"].(int32); ok {
							cDetail.DocCount = int64(cnt)
						} else if cnt, ok := collStats["count"].(int64); ok {
							cDetail.DocCount = cnt
						} else if cnt, ok := collStats["count"].(float64); ok {
							cDetail.DocCount = int64(cnt)
						}

						if sz, ok := collStats["storageSize"].(int32); ok {
							cDetail.StorageSize = int64(sz)
						} else if sz, ok := collStats["storageSize"].(int64); ok {
							cDetail.StorageSize = sz
						} else if sz, ok := collStats["storageSize"].(float64); ok {
							cDetail.StorageSize = int64(sz)
						}

						if avgSz, ok := collStats["avgObjSize"].(float64); ok {
							cDetail.AvgDocSize = int64(avgSz)
						}

						if idxSz, ok := collStats["totalIndexSize"].(int64); ok {
							cDetail.TotalIndexSize = idxSz
						} else if idxSz, ok := collStats["totalIndexSize"].(float64); ok {
							cDetail.TotalIndexSize = int64(idxSz)
						}
					} else {
						cnt, _ := coll.EstimatedDocumentCount(itemCtx)
						cDetail.DocCount = cnt
					}

					// List indexes (fast)
					idxCursor, err := coll.Indexes().List(itemCtx, options.ListIndexes().SetMaxTime(1500*time.Millisecond))
					if err == nil {
						var rawIndexes []bson.M
						if err := idxCursor.All(itemCtx, &rawIndexes); err == nil {
							for _, rawIdx := range rawIndexes {
								idxName, _ := rawIdx["name"].(string)
								if idxName == "" {
									continue
								}
								idxDetail := IndexDetail{Name: idxName}
								if keyDoc, ok := rawIdx["key"].(bson.M); ok {
									var d bson.D
									for k, v := range keyDoc {
										d = append(d, bson.E{Key: k, Value: v})
									}
									idxDetail.Key = d
								} else if keyD, ok := rawIdx["key"].(bson.D); ok {
									idxDetail.Key = keyD
								}
								if u, ok := rawIdx["unique"].(bool); ok {
									idxDetail.Unique = u
								}
								if sp, ok := rawIdx["sparse"].(bool); ok {
									idxDetail.Sparse = sp
								}
								if exp, ok := rawIdx["expireAfterSeconds"].(int32); ok {
									idxDetail.ExpireAfterSec = &exp
								}
								cDetail.Indexes = append(cDetail.Indexes, idxDetail)
							}
						}
					}
					cDetail.IndexCount = len(cDetail.Indexes)
					cChan <- collResult{cIdx: cIndex, detail: cDetail}
				}(cIdx, spec, collName)
			}

			cWg.Wait()
			close(cChan)

			// Preserve order of collections
			collMap := make(map[int]CollectionDetail)
			for cr := range cChan {
				collMap[cr.cIdx] = cr.detail
			}
			for cIdx := 0; cIdx < len(collSpecs); cIdx++ {
				if cd, ok := collMap[cIdx]; ok {
					dbDetail.Collections = append(dbDetail.Collections, cd)
					dbDetail.TotalDocuments += cd.DocCount
				}
			}
			dbDetail.TotalCollections = len(dbDetail.Collections)

			resultsChan <- dbResult{index: idx, detail: dbDetail}
		}(i, dbName)
	}

	wg.Wait()
	close(resultsChan)

	dbMap := make(map[int]DatabaseDetail)
	for r := range resultsChan {
		dbMap[r.index] = r.detail
	}

	for i := 0; i < len(filteredDBs); i++ {
		if d, ok := dbMap[i]; ok {
			catalog.Databases = append(catalog.Databases, d)
			catalog.TotalCollections += d.TotalCollections
			catalog.TotalDocuments += d.TotalDocuments
			catalog.TotalDataSize += d.SizeBytes
		}
	}
	catalog.TotalDatabases = len(catalog.Databases)

	return catalog, nil
}

