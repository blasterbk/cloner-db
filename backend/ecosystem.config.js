// PM2 Ecosystem Config for MongoClone
// Deploy with: pm2 start ecosystem.config.js
// Reload with: pm2 reload mongoclone  
// Stop with:   pm2 stop mongoclone  (sends SIGTERM → graceful pause of running jobs)

module.exports = {
  apps: [
    {
      name: 'mongoclone',
      script: './mongoclone',

      // --- Process Management ---
      autorestart: true,
      watch: false,        // NEVER enable watch — causes constant restarts during clones
      ignore_watch: ['*'],

      // --- Memory: CRITICAL for large clones ---
      // Large MongoDB migrations (30M+ docs) need 2-4GB RAM due to:
      //   - Batch buffers: 4 workers × 4 queue slots × 2500 docs × avg doc size
      //   - Go GC headroom: the live heap + GC overhead can be 2-3x live data
      //   - MongoDB driver internal caching and cursor buffers
      //
      // Setting max_memory_restart to '4G' prevents PM2 from killing mid-clone.
      // Adjust upward if your server has more RAM and clones are larger.
      max_memory_restart: '4G',

      // --- Graceful Shutdown ---
      // IMPORTANT: mongoclone needs time to flush checkpoints before dying.
      //   1. Pause all running jobs + write checkpoints to local disk (~2-5s)
      //   2. Drain in-flight HTTP connections (~15s max in graceful shutdown code)
      // Give 25 seconds before SIGKILL (PM2 default is only 1.6s — far too short).
      kill_timeout: 25000,
      kill_signal: 'SIGTERM',
      listen_timeout: 8000,

      // --- Restart Policy ---
      restart_delay: 3000,     // Wait 3s before restart after crash
      max_restarts: 10,        // Stop trying after 10 consecutive failures
      min_uptime: '10s',       // Treat process as stable after 10s

      // --- Go GC Tuning ---
      // GOGC=50 makes Go collect garbage twice as frequently (50% heap growth trigger
      // instead of default 100%). This keeps peak RSS lower at the cost of ~5-10%
      // more CPU. Critical for large clone jobs to avoid memory spikes.
      //
      // GOMEMLIMIT sets a soft memory cap — Go will GC more aggressively when
      // approaching this limit. Set to ~80% of max_memory_restart to keep headroom.
      env: {
        NODE_ENV: 'production',
        PORT: '8080',
        GOGC: '50',
        GOMEMLIMIT: '3GiB',

        // --- Clone Performance Tuning (mirrors .env settings) ---
        // Change these values to tune clone speed without rebuilding.
        // After editing: pm2 reload mongoclone
        DEFAULT_BATCH_SIZE: '5000',      // docs per InsertMany batch (range: 1000–20000)
        DEFAULT_PARALLEL_WORKERS: '6',   // parallel collection workers (range: 1–16)

        // --- Authentication ---
        // Must match AUTH_USERNAME / AUTH_PASSWORD in .env
        // Leave AUTH_USERNAME empty string to disable login page
        AUTH_USERNAME: 'admin',
        AUTH_PASSWORD: 'A7$Fe]bZyMBB9%!p',

        // --- Optional CPU throttling (uncomment if this server runs other workloads) ---
        // GOMAXPROCS: '2',    // Limit Go to 2 OS threads instead of all 4 cores
        // DATA_DIR: 'data',
      },

      // Lower OS scheduling priority so other processes aren't starved during clones.
      // 0 = normal priority, 10 = polite background task (recommended for shared servers)
      // Uncomment the line below if this server also runs production services:
      // treekill: false,
      // args: [],

      // --- Logging ---
      out_file: '/root/.pm2/logs/mongoclone-out.log',
      error_file: '/root/.pm2/logs/mongoclone-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
