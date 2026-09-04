module.exports = {
  apps: [
    {
      name: 'mongoclone',
      cwd: './backend',
      script: './mongoclone',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        PORT: 8080,
        DATA_DIR: 'data'
      }
    }
  ]
};
