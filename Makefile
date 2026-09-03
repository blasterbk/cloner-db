.PHONY: all build test clean run-backend run-frontend dev env-up env-down

all: test build

build:
	@echo "Building frontend..."
	cd frontend && npm run build
	@echo "Building backend..."
	cd backend && go build -o ../bin/mongoclone cmd/server/main.go

test:
	@echo "Running backend unit tests..."
	cd backend && go test -v ./...
	@echo "Running frontend type check & build..."
	cd frontend && npm run build

run-backend:
	@echo "Starting MongoClone Backend on port 8080..."
	cd backend && go run cmd/server/main.go

run-frontend:
	@echo "Starting MongoClone Frontend on port 5173..."
	cd frontend && npm run dev

dev:
	@echo "Running backend in background..."
	cd backend && go run cmd/server/main.go

env-up:
	docker compose up -d

env-down:
	docker compose down
