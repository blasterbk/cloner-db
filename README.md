# MongoClone: Prod-to-Test Database Cloner & Point-in-Time Restore (PITR)

**MongoClone** is an enterprise-grade MongoDB cloning, data migration, and Time-Travel Point-in-Time Recovery (PITR) platform. It allows engineers, DevOps, and DBA teams to clone databases directly from a Source cluster (e.g. Production) to a Target cluster (e.g. Staging or Development) with zero intermediate disk bottlenecks, on-the-fly PII anonymization, and granular timestamp-based Oplog replay.

---

## Key Features

1. **Direct URI-to-URI Streaming Clone:**
   - Stream BSON documents in concurrent memory batches directly from Source to Target without writing intermediate files to disk.
   - Live connection latency ping and topology auto-detection (Standalone, Replica Set, Sharded cluster).

2. **Time-Travel Point-in-Time Recovery (PITR):**
   - Inspect the live `local.oplog.rs` window (earliest vs latest available timestamps and total oplog capacity).
   - Visual interactive timeline slider and precise datetime picker.
   - Replays incremental operations (`insert`, `update`, `delete`, `createIndex`, `drop`) up to the chosen target moment $t_{target}$.

3. **Prod-to-Test Data Sanitization & PII Scrubbing:**
   - Real-time in-flight field anonymization (fake emails, password hash replacement, card number masking, regex substitutions).
   - Exclude sensitive collections (e.g., audit logs, token stores).

4. **Catalog & Schema Discovery:**
   - Deep inspection of databases, collections, document counts, average sizes, and index definitions.
   - Database and collection remapping (e.g., `prod_orders` $\rightarrow$ `test_orders`).
   - Automated secondary index and capped collection options replication.

5. **Real-Time WebSockets Telemetry Dashboard:**
   - Live speed gauges (MB/s throughput, docs/sec rate, elapsed duration, dynamic ETA).
   - Collection-by-collection progress bars and live console logs.
   - Pause, resume, and abort controls.

---

## Architecture Overview

```
+--------------------------------------------------------------------------------------------------+
|                                    MODERN WEB FRONTEND (Vite + React)                            |
|  - Step-by-Step Clone Wizard (Source/Target URIs, Catalog Tree, Time-Travel Slider, Masking)     |
|  - Live Oplog Window Visualizer & Date/Time Picker                                               |
|  - Real-Time Live Transfer Telemetry (WebSockets: docs/sec, MB/s, ETA, Collection Progress)      |
|  - Saved Connection Profiles & Past Migration Audits                                             |
+-------------------------------------------------+------------------------------------------------+
                                                  | HTTP / WebSockets (Port 8080)
+-------------------------------------------------v------------------------------------------------+
|                                      GO BACKEND ENGINE (Go 1.27)                                 |
|                                                                                                  |
|  +---------------------------+  +---------------------------+  +-------------------------------+ |
|  |    Connection Manager     |  |     Catalog Inspector     |  |     Oplog & PITR Engine       | |
|  |  (URI, Latency & Topology)|  | (Deep DB/Coll/Index stats)|  | (Timestamp-based Oplog Apply) | |
|  +---------------------------+  +---------------------------+  +-------------------------------+ |
|  +---------------------------+  +---------------------------+  +-------------------------------+ |
|  |    Data Masking Engine    |  |  Streaming Batch Copier   |  |     WebSocket Dispatcher      | |
|  |  (PII Scrubbing/Hashing)  |  | (Direct BSON Batch Pipe)  |  |  (Live stats & Console Logs) | |
|  +---------------------------+  +---------------------------+  +-------------------------------+ |
+-------------------------------------------------+------------------------------------------------+
                                                  |
                         +------------------------+------------------------+
                         |                                                 |
                         v                                                 v
           +---------------------------+                     +---------------------------+
           |    SOURCE MONGODB URI     |                     |    TARGET MONGODB URI     |
           |   (Prod Replica/Cluster)  |                     |    (Test / Staging DB)    |
           +---------------------------+                     +---------------------------+
```

---

## Getting Started

### Prerequisites
- **Go:** 1.22+ (Go 1.27 supported)
- **Node.js:** 18+ (Node 22 supported) & npm
- **MongoDB Instances:** Source and Target MongoDB clusters (or use the provided `docker-compose.yml`)

---

### Quick Start (Local Development)

#### 1. (Optional) Launch Local Test MongoDB Clusters
```bash
# Starts Source on port 27017 (ReplicaSet rs0) and Target on port 27018
docker compose up -d
```

#### 2. Start the Go Backend Server
```bash
cd backend
go run cmd/server/main.go
# Backend starts on http://localhost:8080 (REST API and ws://localhost:8080/ws)
```

#### 3. Start the React Frontend
```bash
cd frontend
npm install
npm run dev
# Frontend starts on http://localhost:5173
```

Open your browser at [http://localhost:5173](http://localhost:5173).

---

## Production Build

To build the complete application into a single deployable artifact:

```bash
# 1. Build frontend distribution bundle
cd frontend
npm run build

# 2. Build Go backend binary
cd ../backend
go build -o ../bin/mongoclone cmd/server/main.go

# 3. Run standalone binary (automatically serves frontend from dist/)
./bin/mongoclone
```

---

## API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/mongo/test-connection` | `POST` | Test connection to a MongoDB endpoint and measure ping latency. |
| `/api/v1/mongo/catalog` | `POST` | Deep scan databases, collections, sizes, and index definitions. |
| `/api/v1/mongo/oplog-window` | `POST` | Inspect `local.oplog.rs` for available PITR earliest/latest boundaries. |
| `/api/v1/jobs` | `GET` | List all past and active clone jobs. |
| `/api/v1/jobs` | `POST` | Launch an asynchronous database clone or PITR recovery job. |
| `/api/v1/jobs/:id` | `GET` | Get real-time status, telemetry metrics, and logs for a job. |
| `/api/v1/jobs/:id/cancel` | `POST` | Cancel an active running clone pipeline. |
| `/api/v1/jobs/:id` | `DELETE` | Delete a job record from history. |
| `/api/v1/profiles` | `GET` | List saved connection profiles. |
| `/api/v1/profiles` | `POST` | Save a new connection profile preset. |
| `/ws` | `GET` | WebSocket endpoint for real-time progress broadcasts. |

---

## License
Apache 2.0 / MIT
