1. Start the Go Backend Server:
cd C:\Users\BK\Documents\Final\Repo\mongoDB\mongoDB\backend

go build ./...

go build ./cmd/server

go run cmd/server/main.go
# Backend starts on http://localhost:8080 (REST API and WebSocket ws://localhost:8080/ws)

2. Start the React Frontend:
cd C:\Users\BK\Documents\Final\Repo\mongoDB\mongoDB\frontend
npm run dev
# Frontend opens on http://localhost:5173
