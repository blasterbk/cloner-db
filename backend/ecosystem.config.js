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
      //   1. Pause all running jobs + write checkpoints to MongoDB (~2-5s)
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
        // DATA_DIR: 'data',
        // PROFILES_DB_URI: 'mongodb://...',
      },

      // --- Logging ---
      out_file: '/root/.pm2/logs/mongoclone-out.log',
      error_file: '/root/.pm2/logs/mongoclone-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
