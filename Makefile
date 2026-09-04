.PHONY: all build test clean run-backend run-frontend dev env-up env-down

all: test build

build-frontend:
	@echo "Building frontend..."
	cd frontend && npm run build
	@echo "Syncing frontend build to backend/web for embedding..."
	mkdir -p backend/web
	cp -r frontend/dist/* backend/web/

build-backend:
	@echo "Building unified backend binary (with embedded frontend)..."
	cd backend && go build -o ../bin/mongoclone cmd/server/main.go

build: build-frontend build-backend

test:
	@echo "Running backend unit tests..."
	cd backend && go test -v ./...

run:
	@echo "Starting MongoClone Unified Server (API + Web UI) on port 8080..."
	cd backend && go run cmd/server/main.go

run-backend: run

run-frontend-dev:
	@echo "Starting MongoClone Frontend in dev mode (with HMR) on port 5173..."
	cd frontend && npm run dev

dev: run

env-up:
	docker compose up -d

env-down:
	docker compose down
