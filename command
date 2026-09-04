# =====================================================================
# MongoClone - Setup & Run Cheat Sheet (Lightweight Unified Architecture)
# =====================================================================

# ---------------------------------------------------------------------
# A. UBUNTU SERVER PRODUCTION RUN (Zero-Node Lightweight Deployment)
# ---------------------------------------------------------------------
# The Go backend has the frontend embedded directly inside the binary.
# No Node.js, npm install, node_modules, or separate 'serve' process needed!

# 1. Install System Prerequisites (Only Go 1.22+ & Git needed)
sudo apt update && sudo apt install -y git build-essential

# Install Go 1.22+
wget https://go.dev/dl/go1.22.6.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.22.6.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

# Optional: Install PM2 if you want PM2 process management (or run via systemd / nohup)
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs && sudo npm install -g pm2

# 2. Clone & Build
git clone https://github.com/blasterbk/cloner-db.git
cd cloner-db/backend

# Configure & Build Single Standalone Binary
cp .env.example .env
go build -o mongoclone cmd/server/main.go
chmod +x mongoclone

# 3. Run Directly
./mongoclone
# Or with PM2:
# cd .. && pm2 start ecosystem.config.js

# Access full application in browser: http://YOUR_SERVER_IP:8080


# ---------------------------------------------------------------------
# B. LOCAL WINDOWS RUN (Single Unified Process)
# ---------------------------------------------------------------------

# 1. Run Everything (Backend + Embedded Frontend) in One Step:
cd C:\Users\BK\Documents\Final\Repo\mongoDB\mongoDB\backend
go run cmd/server/main.go

# Access in browser:
# http://localhost:8080   -> Full Web UI Dashboard & REST API
# ws://localhost:8080/ws  -> Live Telemetry WebSocket

# (Optional: Only if editing frontend React code with live Vite HMR)
# cd C:\Users\BK\Documents\Final\Repo\mongoDB\mongoDB\frontend
# npm run dev   # Opens on http://localhost:5173

