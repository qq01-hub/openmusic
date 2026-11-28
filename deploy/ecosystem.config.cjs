/** PM2 配置 — SSH: cd /www/openmusic && pm2 start deploy/ecosystem.config.cjs
 *
 * 日志轮转：PM2 本身不带轮转，日志默认无限增长。生产环境请安装官方轮转模块：
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 10M
 *   pm2 set pm2-logrotate:retain 3
 * 未安装时请定期人工清理 ~/.pm2/logs，避免磁盘被日志吃满。
 */
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
      max_memory_restart: '640M',
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
      max_memory_restart: '256M',
      kill_timeout: 900000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
