import fs from 'fs';
import path from 'path';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getRuntimeConfig } from './runtimeConfig.js';
import {
  migrateLegacyAdminEntryConfig,
  sanitizeAdminEntryPath,
  setAdminEntryPath,
} from './adminConfig.js';

const scrypt = promisify(scryptCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');
const LOCK_PATH = path.join(__dirname, 'setup.lock');
const INSTALLING_LOCK_PATH = path.join(__dirname, 'setup.installing.lock');
const INSTALLING_LOCK_STALE_MS = 30 * 60_000;
const RUNTIME_CONFIG_PATH = path.join(__dirname, 'runtimeConfig.json');
const ADMIN_CREDENTIALS_KEY = 'openmusic:admin:credentials';
const SETUP_TOKEN_PATH = path.join(__dirname, 'setup.token');
const SETUP_TOKEN_COOKIE = 'openmusic_setup_token';
let memorySetupToken = '';
let setupTokenNoticeLogged = false;
const attempts = new Map();
const MAX_SETUP_ATTEMPT_ENTRIES = 2000;

function acquireSetupLease() {
  const openLease = () => {
    const fd = fs.openSync(INSTALLING_LOCK_PATH, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, 'utf8');
    } catch (err) {
      try { fs.closeSync(fd); } catch { /* ignore cleanup failure */ }
      try { fs.unlinkSync(INSTALLING_LOCK_PATH); } catch { /* ignore cleanup failure */ }
      throw err;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      try { fs.closeSync(fd); } catch { /* already closed */ }
      try { fs.unlinkSync(INSTALLING_LOCK_PATH); } catch { /* already removed */ }
    };
  };

  try {
    return openLease();
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    try {
      const stat = fs.statSync(INSTALLING_LOCK_PATH);
      if (Date.now() - stat.mtimeMs <= INSTALLING_LOCK_STALE_MS) {
        const busy = new Error('安装正在由其它请求执行');
        busy.code = 'EBUSY';
        throw busy;
      }
      fs.unlinkSync(INSTALLING_LOCK_PATH);
      return openLease();
    } catch (retryErr) {
      if (retryErr?.code === 'ENOENT') return openLease();
      throw retryErr;
    }
  }
}

function hasCompletedSetupLock() {
  try {
    const stat = fs.statSync(LOCK_PATH);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function hasLegacyConfiguration() {
  return Boolean(
    String(process.env.REDIS_URL || '').trim()
    || String(process.env.REDIS_HOST || '').trim(),
  );
}

function writeSetupLock(detail = {}) {
  if (hasCompletedSetupLock()) {
    const error = new Error('安装已完成');
    error.code = 'EEXIST';
    throw error;
  }
  const payload = {
    installedAt: new Date().toISOString(),
    version: 1,
    ...detail,
  };
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    // Docker 单文件挂载要求宿主机预先创建空文件，因此需允许覆盖空锁文件。
    flag: fs.existsSync(LOCK_PATH) ? 'w' : 'wx',
  });
}

/**
 * 兼容升级前没有 setup.lock 的站点：
 * 只要已有 Redis 环境配置，就说明站点已经按旧流程部署，不能重新进入安装向导。
 */
export function migrateLegacySetupLock() {
  if (hasCompletedSetupLock() || !hasLegacyConfiguration()) return;
  try {
    migrateLegacyAdminEntryConfig();
    writeSetupLock({ migrated: true });
  } catch (err) {
    if (err?.code !== 'EEXIST') {
      console.error('setup: 迁移安装锁失败:', err?.message || err);
    }
  }
}

export function isSetupRequired() {
  // 即使运行目录暂时不可写、无法补建锁，也必须阻止旧站点暴露安装接口。
  return !hasCompletedSetupLock() && !hasLegacyConfiguration();
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function readSetupTokenFile() {
  try {
    return fs.readFileSync(SETUP_TOKEN_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * 一次性安装令牌来源（优先级）：环境变量 SETUP_TOKEN > server/setup.token 文件 >
 * 首启随机生成（0600 落盘，写不进时用内存令牌）并在日志中只呈现一次。
 * 部署脚本会把 SETUP_TOKEN 写入 .env / data/.env，与本函数第一来源对齐。
 */
export function getSetupToken() {
  const envToken = String(process.env.SETUP_TOKEN || '').trim();
  if (envToken) return envToken;
  if (memorySetupToken) return memorySetupToken;
  const fileToken = readSetupTokenFile();
  if (fileToken) {
    memorySetupToken = fileToken;
    return fileToken;
  }
  if (!isSetupRequired()) return '';
  const token = randomBytes(32).toString('base64url');
  memorySetupToken = token;
  try {
    fs.writeFileSync(SETUP_TOKEN_PATH, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err?.code === 'EEXIST') {
      const raced = readSetupTokenFile();
      if (raced) {
        memorySetupToken = raced;
        return raced;
      }
    }
    // 文件不可写时退化为内存令牌：进程重启后重新生成并重新打印，不降低校验强度。
  }
  if (!setupTokenNoticeLogged) {
    setupTokenNoticeLogged = true;
    console.log(`🔐 安装向导一次性令牌（仅显示一次，请妥善保存）: ${token}`);
    console.log('🔐 打开向导前请先访问 /api/setup/authorize?token=<令牌> 完成授权，或在请求头 X-Setup-Token 中携带令牌');
  }
  return token;
}

export function setupTokensEqual(expected, provided) {
  const a = String(expected || '');
  const b = String(provided || '');
  if (!a || !b) return false;
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function extractSetupToken(req) {
  const header = String(req.headers?.['x-setup-token'] || '').trim();
  if (header) return header;
  const body = String(req.body?.setupToken || '').trim();
  if (body) return body;
  const cookieHeader = String(req.headers?.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SETUP_TOKEN_COOKIE) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return '';
}

export function isLoopbackRequest(req) {
  const remote = String(req.socket?.remoteAddress || req.ip || '').replace(/^::ffff:/, '');
  return remote === '::1' || remote === '127.0.0.1' || remote.startsWith('127.');
}

/**
 * 纯判定：返回 { ok: true } 或 { ok: false }。
 * 无任何令牌可用（生成失败的极端情形）时只放行回环请求，避免把部署流程彻底锁死；
 * 正常路径下令牌必然存在（env / 文件 / 内存生成），回退不会被触发。
 */
export function checkSetupAuthorization(req, { token, setupRequired }) {
  if (!setupRequired) return { ok: true };
  if (token) {
    return setupTokensEqual(token, extractSetupToken(req)) ? { ok: true } : { ok: false };
  }
  return isLoopbackRequest(req) ? { ok: true } : { ok: false };
}

function requireSetupToken(req, res, next) {
  const verdict = checkSetupAuthorization(req, { token: getSetupToken(), setupRequired: isSetupRequired() });
  if (verdict.ok) return next();
  return res.status(403).json({ error: '安装令牌无效或缺失', code: 'SETUP_TOKEN_REQUIRED' });
}

function clearSetupToken() {
  memorySetupToken = '';
  try {
    fs.unlinkSync(SETUP_TOKEN_PATH);
  } catch {
    // 令牌文件不存在或不可删都不影响安装完成；env 令牌靠 setup.lock 关闭入口兜底。
  }
}

function isRateLimited(req, max = 10) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.startedAt > 60_000) {
    if (!entry && attempts.size >= MAX_SETUP_ATTEMPT_ENTRIES) {
      for (const [oldKey, oldEntry] of attempts.entries()) {
        if (now - oldEntry.startedAt > 60_000) attempts.delete(oldKey);
        if (attempts.size < MAX_SETUP_ATTEMPT_ENTRIES) break;
      }
      while (attempts.size >= MAX_SETUP_ATTEMPT_ENTRIES) {
        const oldestKey = attempts.keys().next().value;
        if (oldestKey === undefined) break;
        attempts.delete(oldestKey);
      }
    }
    attempts.set(key, { startedAt: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

function requireSameHost(req, res, next) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) {
    if (process.env.NODE_ENV !== 'production') return next();
    return res.status(403).json({ error: '请求来源不被允许' });
  }
  try {
    if (new URL(origin).host !== String(req.headers.host || '')) {
      return res.status(403).json({ error: '请求来源不被允许' });
    }
  } catch {
    return res.status(403).json({ error: '请求来源不被允许' });
  }
  next();
}

function cleanText(raw, max = 256) {
  const value = String(raw ?? '').trim();
  if (/[\r\n\0]/.test(value) || value.length > max) return null;
  return value;
}

function parseRedisInput(raw = {}) {
  const mode = raw.mode === 'url' ? 'url' : 'host';
  if (mode === 'url') {
    const url = cleanText(raw.url, 1024);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') throw new Error();
      return { options: { url }, values: { REDIS_URL: url } };
    } catch {
      return { error: 'Redis URL 必须以 redis:// 或 rediss:// 开头' };
    }
  }

  const host = cleanText(raw.host, 253);
  const username = cleanText(raw.username, 128);
  const password = cleanText(raw.password, 512);
  const port = Number(raw.port);
  const database = Number(raw.database);
  if (!host || !/^[A-Za-z0-9._:-]+$/.test(host)) return { error: 'Redis 主机名无效' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'Redis 端口无效' };
  if (!Number.isInteger(database) || database < 0 || database > 255) return { error: 'Redis DB 无效' };

  const options = { socket: { host, port, connectTimeout: 8_000 }, database };
  if (username) options.username = username;
  if (password) options.password = password;
  return {
    options,
    values: {
      REDIS_HOST: host,
      REDIS_PORT: String(port),
      REDIS_USERNAME: username || '',
      REDIS_PASSWORD: password || '',
      REDIS_DB: String(database),
    },
  };
}

async function connectRedis(raw) {
  const parsed = parseRedisInput(raw);
  if (parsed.error) return parsed;
  const { createClient } = await import('redis');
  const client = createClient({ ...parsed.options, disableOfflineQueue: true, commandsQueueMaxLength: 128, socket: { ...parsed.options.socket, connectTimeout: 8000, reconnectStrategy: false } });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return { client, values: parsed.values };
  } catch (err) {
    try {
      if (client.isOpen) await client.quit();
    } catch {
      // ignore cleanup failure
    }
    return { error: `Redis 连接失败：${err?.message || err}` };
  }
}

function updateEnvFile(values) {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const lines = existing ? existing.replace(/\r\n/g, '\n').split('\n') : [];
  const pending = new Map(Object.entries(values));
  const format = (value) => JSON.stringify(String(value ?? ''));
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${format(value)}`;
  });
  if (next.length && next[next.length - 1] !== '') next.push('');
  for (const [key, value] of pending) next.push(`${key}=${format(value)}`);
  const temp = `${ENV_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${next.join('\n').replace(/\n+$/, '')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.renameSync(temp, ENV_PATH);
  } catch (err) {
    // Docker bind mount 的单文件挂载点不能被 rename 覆盖（Linux 返回 EBUSY）。
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(err?.code) || !fs.existsSync(ENV_PATH)) throw err;
    fs.copyFileSync(temp, ENV_PATH);
    fs.unlinkSync(temp);
  }
}

/** 重新安装时让新生成的 Meting 环境配置优先生效，保留其它后台运行配置。 */
function clearPersistedMetingOverrides() {
  if (!fs.existsSync(RUNTIME_CONFIG_PATH)) return;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8'));
  } catch {
    return;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return;
  if (!Object.hasOwn(config, 'metingApiUrl') && !Object.hasOwn(config, 'metingApiAuth')) return;
  delete config.metingApiUrl;
  delete config.metingApiAuth;
  fs.writeFileSync(RUNTIME_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function createBootstrapCredentials(client, username, password, { mustChange = true } = {}) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 32)).toString('hex');
  await client.set(ADMIN_CREDENTIALS_KEY, JSON.stringify({
    username,
    salt,
    hash,
    updatedAt: Date.now(),
    mustChange: Boolean(mustChange),
  }));
}

function pickFromAlphabet(alphabet, length) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** 安装完成时随机账号：om_ + 8 位小写字母数字 */
function generateBootstrapUsername() {
  return `om_${pickFromAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)}`;
}

/** 安装完成时随机密码：16 位，避开易混淆字符 */
function generateBootstrapPassword() {
  return pickFromAlphabet(
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*',
    16,
  );
}

function validateSiteUrl(raw) {
  const value = cleanText(raw, 512);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    return parsed.origin;
  } catch {
    return null;
  }
}

/** 校验并规范化 Meting 上游地址。空值允许（可后台再配） */
function validateMetingUrl(raw) {
  const value = cleanText(raw, 1024);
  if (value === null) return null;
  if (!value) return '';
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    try {
      const parsed = new URL(part);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }
  return parts.join(',');
}

function getDockerDefaults() {
  const redisUrl = String(process.env.DOCKER_REDIS_URL || '').trim();
  const metingUrl = String(process.env.DOCKER_METING_URL || '').trim();
  if (!redisUrl) return null;
  return { redisUrl, metingUrl: metingUrl || '' };
}

export function resolveSetupMetingAuth(sources, submittedAuth) {
  if (submittedAuth) return sources.map(() => submittedAuth);
  const dockerUrl = String(process.env.DOCKER_METING_URL || '').trim().replace(/\/+$/, '');
  if (!getDockerDefaults() || !dockerUrl) return sources.map(() => '');
  const config = getRuntimeConfig();
  const urls = config.metingApiUrl.split(',').map(value => value.trim().replace(/\/+$/, ''));
  const auths = config.metingApiAuth.split(',').map(value => value.trim());
  const index = urls.indexOf(dockerUrl);
  const auth = index < 0 ? '' : (auths.length === 1 ? auths[0] : (auths[index] || ''));
  return sources.map(url => url.replace(/\/+$/, '') === dockerUrl ? auth : '');
}

function isDockerEnvironment() {
  return Boolean(String(process.env.DOCKER_REDIS_URL || '').trim());
}

export function mountSetupApi(app) {
  migrateLegacySetupLock();
  if (isSetupRequired()) getSetupToken();

  app.get('/api/setup/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const dockerDefaults = isSetupRequired() ? getDockerDefaults() : null;
    res.json({
      setupRequired: isSetupRequired(),
      ...(isSetupRequired() ? { setupTokenRequired: true } : {}),
      ...(dockerDefaults ? { dockerDefaults } : {}),
    });
  });

  // 部署脚本/终端输出的令牌通过此入口换成 HttpOnly Cookie，随后未改动的向导页面
  // 以同源请求自动携带 Cookie 通过 requireSetupToken 校验。
  app.get('/api/setup/authorize', (req, res) => {
    if (!isSetupRequired()) return res.status(404).json({ error: '安装向导已锁定' });
    const token = getSetupToken();
    if (!token || !setupTokensEqual(token, String(req.query?.token || ''))) {
      return res.status(403).json({ error: '安装令牌无效或缺失', code: 'SETUP_TOKEN_REQUIRED' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', `${SETUP_TOKEN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/api/setup; SameSite=Strict; Max-Age=1800`);
    return res.redirect(302, '/setup');
  });

  app.post('/api/setup/test-redis', requireSameHost, requireSetupToken, async (req, res) => {
    if (!isSetupRequired()) return res.status(404).json({ error: '安装向导已锁定' });
    if (isRateLimited(req)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
    const result = await connectRedis(req.body?.redis);
    if (result.error) return res.status(400).json({ error: result.error });
    await result.client.quit();
    res.json({ ok: true });
  });

  app.post('/api/setup/complete', requireSameHost, requireSetupToken, async (req, res) => {
    if (isRateLimited(req, 5)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });

    let releaseLease;
    try {
      releaseLease = acquireSetupLease();
    } catch (err) {
      if (err?.code === 'EBUSY' || err?.code === 'EEXIST') {
        return res.status(409).json({ error: '安装正在由其它请求执行' });
      }
      console.error('setup: 获取安装锁失败:', err?.message || err);
      return res.status(500).json({ error: '无法锁定安装流程' });
    }
    try {
      // 必须在获取原子租约后再次判断，避免两个请求同时通过前置检查。
      if (!isSetupRequired()) return res.status(404).json({ error: '安装向导已锁定' });

    const siteUrl = validateSiteUrl(req.body?.siteUrl);
    if (siteUrl === null) return res.status(400).json({ error: '站点地址必须是有效的 http/https 地址' });
    const adminPath = sanitizeAdminEntryPath(req.body?.adminPath);
    if (!adminPath || adminPath === '/admin') {
      return res.status(400).json({ error: '管理入口须为非 /admin 的 8–64 位随机路径' });
    }
    const metingApiUrl = validateMetingUrl(req.body?.metingApiUrl);
    if (metingApiUrl === null) {
      return res.status(400).json({ error: 'Meting 音源地址无效（http/https，多个用英文逗号分隔）' });
    }
    const metingSources = metingApiUrl
      ? metingApiUrl.split(',').map((url) => url.trim()).filter(Boolean)
      : [];
    const metingApiAuth = cleanText(req.body?.metingApiAuth, 1024);
    if (metingApiAuth === null) return res.status(400).json({ error: 'Meting 令牌无效' });

    const dockerDefs = getDockerDefaults();
    const redisInput = req.body?.redis ?? (dockerDefs ? { mode: 'url', url: dockerDefs.redisUrl } : undefined);
    const result = await connectRedis(redisInput);
    if (result.error) return res.status(400).json({ error: result.error });

    if (!metingSources.length && dockerDefs?.metingUrl) {
      metingSources.push(dockerDefs.metingUrl);
    }
    const metingAuths = resolveSetupMetingAuth(metingSources, metingApiAuth);

    try {
      const username = generateBootstrapUsername();
      const password = generateBootstrapPassword();
      await createBootstrapCredentials(result.client, username, password, { mustChange: false });
      const clientSecret = String(process.env.CLIENT_ID_SECRET || '').trim() || randomBytes(32).toString('hex');
      const setupNonce = createHash('sha256').update(randomBytes(32)).digest('hex');
      updateEnvFile({
        ...result.values,
        CLIENT_URL: siteUrl || '',
        CLIENT_ID_SECRET: clientSecret,
        TRUST_PROXY: req.body?.trustProxy === false ? '0' : '1',
        METING_API_URL: metingSources.join(','),
        METING_API_AUTH: metingAuths.some(Boolean) ? metingAuths.join(',') : '',
        SETUP_NONCE: setupNonce,
      });
      clearPersistedMetingOverrides();
      const pathResult = setAdminEntryPath(adminPath, { requireCustom: true });
      if (!pathResult.success) throw new Error(pathResult.error);
      writeSetupLock({ siteUrl: siteUrl || '', adminPath });
      clearSetupToken();
      await result.client.quit();

      const willAutoRestart = isDockerEnvironment();
      res.json({
        ok: true,
        restartRequired: !willAutoRestart,
        autoRestarting: willAutoRestart,
        adminPath,
        username,
        password,
      });

      if (willAutoRestart) {
        console.log('setup: Docker 环境检测到，2 秒后自动重启进程…');
        setTimeout(() => process.exit(0), 2000);
      }
    } catch (err) {
      try {
        if (result.client.isOpen) await result.client.quit();
      } catch {
        // ignore cleanup failure
      }
      if (err?.code === 'EEXIST') return res.status(409).json({ error: '安装已由其它请求完成' });
      console.error('setup: 安装失败:', err?.message || err);
      res.status(500).json({ error: '保存安装配置失败' });
    }
    } finally {
      releaseLease?.();
    }
  });
}
