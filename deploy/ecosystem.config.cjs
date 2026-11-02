/** PM2 配置 — SSH: cd /www/openmusic && pm2 start deploy/ecosystem.config.cjs */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'openmusic',
      cwd: path.join(__dirname, '../server'),
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      kill_timeout: 30000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        OPENMUSIC_UPDATE_SOCKET: path.join(__dirname, '../.openmusic-update/control.sock'),
      },
    },
    {
      name: 'openmusic-updater',
      cwd: path.join(__dirname, '..'),
      script: path.join(__dirname, 'updater/index.mjs'),
      args: 'source',
      instances: 1,
      autorestart: true,
      watch: false,
      kill_timeout: 900000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
