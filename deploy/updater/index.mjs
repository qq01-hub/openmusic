import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createUpgradeManager, updateError } from './core.mjs';
import { checkRelease } from './release.mjs';
import { sourceExecutor, rollbackSource } from './source.mjs';
import { DockerEngine, findApplication, dockerExecutor, rollbackDocker, cleanupDocker } from './docker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2];
if (!['docker', 'source'].includes(mode) || process.platform === 'win32') {
  throw new Error('Updater requires Linux/macOS and a docker or source deployment');
}
const directory = mode === 'docker' ? '/run/openmusic-update' : path.join(root, '.openmusic-update');
const socket = path.join(directory, 'control.sock');
await fs.mkdir(directory, { recursive: true, mode: 0o700 });

// 主站和升级进程必须同一 UID，控制通道不监听 TCP 端口
await new Promise((resolve, reject) => {
  const request = http.get({ socketPath: socket, path: '/status', timeout: 1500 }, response => {
    response.resume();
    reject(new Error('Another updater is already running'));
  });
  request.on('timeout', () => request.destroy());
  request.on('error', error => {
    if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) resolve();
    else reject(error);
  });
});
await fs.rm(socket, { force: true });

let sourcePort = 4000;
if (mode === 'source') {
  const env = await fs.readFile(path.join(root, 'server/.env'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  sourcePort = Number(process.env.PORT || env.match(/^\s*PORT\s*=\s*["']?(\d+)/m)?.[1] || 4000);
  if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535) throw new Error('Invalid source service port');
}
async function health() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const ok = await new Promise(resolve => {
      const request = http.get({
        hostname: mode === 'docker' ? 'openmusic' : '127.0.0.1',
        port: mode === 'docker' ? 4000 : sourcePort,
        path: '/api/health', timeout: 3000,
      }, response => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('timeout', () => request.destroy());
      request.on('error', () => resolve(false));
    });
    if (ok) return;
    await delay(1000);
  }
  throw updateError('UPDATE_HEALTH_FAILED', '新版本未能在时限内响应健康检查');
}
const engine = new DockerEngine();
async function current() {
  if (mode === 'docker') {
    const app = await findApplication(engine);
    return app.Config.Env?.find(value => value.startsWith('OPENMUSIC_RELEASE_VERSION='))?.split('=')[1] || 'unknown';
  }
  try { return JSON.parse(await fs.readFile(path.join(root, 'deployment-version.json'), 'utf8')).tag || 'unknown'; }
  catch (error) { if (error.code === 'ENOENT') return 'unknown'; throw error; }
}
const manager = await createUpgradeManager({
  directory, mode, current, check: checkRelease,
  execute: mode === 'docker' ? dockerExecutor(engine, health) : sourceExecutor({ root, directory, health }),
  rollback: async transaction => {
    if (mode === 'docker') await rollbackDocker(engine, transaction);
    else await rollbackSource(transaction);
    await health();
  },
  cleanup: mode === 'docker' ? transaction => cleanupDocker(engine, transaction) : undefined,
});
const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  try {
    let result;
    if (request.method === 'GET' && request.url === '/status') result = manager.status();
    else if (request.method === 'POST' && request.url === '/check') result = await manager.check();
    else if (request.method === 'POST' && request.url === '/upgrade') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 1024) throw updateError('UPDATE_INVALID_INPUT', '升级请求过大', 413);
      }
      let input;
      try { input = JSON.parse(body); } catch { throw updateError('UPDATE_INVALID_INPUT', '升级请求无效'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => key !== 'releaseId')) throw updateError('UPDATE_INVALID_INPUT', '升级请求包含未知字段');
      result = await manager.start(input.releaseId);
      response.statusCode = 202;
    } else throw updateError('UPDATE_NOT_FOUND', '接口不存在', 404);
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = error.status || 503;
    response.end(JSON.stringify({
      code: error.code?.startsWith('UPDATE_') ? error.code : 'UPDATE_UNAVAILABLE',
      error: error.code?.startsWith('UPDATE_') ? error.message : '升级服务暂不可用，请检查网络、权限和服务器环境',
    }));
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(socket, () => {
  void fs.chmod(socket, 0o600).catch(() => server.close());
});
const shutdown = async () => {
  server.close();
  await manager.finished();
  await fs.rm(socket, { force: true });
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
