module.exports = {
  apps: [
    {
      name: 'mongoclone-backend',
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
    },
    {
      name: 'mongoclone-frontend',
      cwd: './frontend',
      script: 'npx',
      args: 'serve -s dist -l 5173',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    }
  ]
};
