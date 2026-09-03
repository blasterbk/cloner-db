# =====================================================================
# MongoClone - Setup & Run Cheat Sheet
# =====================================================================

# ---------------------------------------------------------------------
# A. UBUNTU SERVER PRODUCTION RUN (USING PM2)
# ---------------------------------------------------------------------

# 1. Install System Prerequisites & PM2 (Run Once on Ubuntu Server)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential
sudo npm install -g pm2 serve

# Install Go 1.22+
wget https://go.dev/dl/go1.22.6.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.22.6.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

# 2. Clone & Build
git clone https://github.com/blasterbk/cloner-db.git
cd cloner-db

# Build Backend
cd backend
cp .env.example .env
go build -o mongoclone cmd/server/main.go
chmod +x mongoclone

# Build Frontend
cd ../frontend
npm install
npm run build
cd ..

# 3. Start Both Backend & Frontend with PM2
pm2 start ecosystem.config.js

# 4. Useful PM2 Commands
pm2 status                    # Check running status of both services
pm2 logs                      # View live output logs
pm2 restart all               # Restart both services
pm2 stop all                  # Stop both services
pm2 save                      # Save running list for reboot persistence
pm2 startup                   # Configure auto-start on server boot

# Access in browser: http://YOUR_SERVER_IP:5173


# ---------------------------------------------------------------------
# B. LOCAL WINDOWS DEVELOPMENT RUN
# ---------------------------------------------------------------------

# 1. Start Backend (Terminal 1):
cd C:\Users\BK\Documents\Final\Repo\mongoDB\mongoDB\backend
go run cmd/server/main.go
# Backend starts on http://localhost:8080 (REST API and WebSocket ws://localhost:8080/ws)

# 2. Start Frontend (Terminal 2):
cd C:\Users\BK\Documents\Final\Repo\mongoDB\mongoDB\frontend
npm run dev
# Frontend opens on http://localhost:5173
