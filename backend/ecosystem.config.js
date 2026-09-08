// PM2 Ecosystem Config for MongoClone
// Deploy with: pm2 start ecosystem.config.js
// Reload with: pm2 reload mongoclone
// Stop with:   pm2 stop mongoclone (this sends SIGTERM → graceful pause of running jobs)

module.exports = {
  apps: [
    {
      name: 'mongoclone',
      script: './mongoclone',

      // --- Process Management ---
      // CRITICAL: Do NOT auto-restart on exit code 0 (clean shutdown)
      // PM2 restarts only on crash (non-zero exit).
      autorestart: true,
      watch: false,              // NEVER watch files — causes constant restarts during clones
      ignore_watch: ['*'],

      // --- Memory: IMPORTANT for large clones ---
      // Large MongoDB clones (30M+ docs) consume significant RAM during batch buffering.
      // Default PM2 max_memory_restart is 1.5GB — TOO LOW for large migrations.
      // Set to 0 (disabled) so PM2 never restarts mid-clone due to memory pressure.
      max_memory_restart: 0,

      // --- Graceful Shutdown ---
      // Give mongoclone enough time to:
      //   1. Flush checkpoints to MongoDB (up to 5s)
      //   2. Drain in-flight HTTP connections (up to 15s)
      kill_timeout: 25000,       // 25 seconds before SIGKILL (default is 1600ms — WAY too short)
      shutdown_with_message: false,
      listen_timeout: 8000,

      // --- Signal Configuration ---
      kill_signal: 'SIGTERM',    // pm2 stop/restart sends SIGTERM → graceful pause

      // --- Restart Policy ---
      restart_delay: 2000,       // Wait 2s before restarting after crash
      max_restarts: 10,          // Stop restarting after 10 consecutive failures
      min_uptime: '10s',         // Consider process stable after 10s

      // --- Environment ---
      env: {
        NODE_ENV: 'production',
        PORT: '8080',
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
