import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getRedisClient } from './roomStorage.js';
import { evalRedisScript } from './redisScripts.js';

const scrypt = promisify(scryptCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 旧版本地哈希文件，仅迁移后删除，不再写入 */
const LEGACY_LOCAL_PATH = path.join(__dirname, 'adminCredentials.json');

const CREDENTIALS_KEY = 'openmusic:admin:credentials';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = '123456';
const ENV_USERNAME = String(process.env.ADMIN_USER || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME;
const ENV_PASSWORD = String(process.env.ADMIN_KEY || DEFAULT_PASSWORD).trim() || DEFAULT_PASSWORD;

/**
 * @type {{ username: string, salt: string, hash: string, updatedAt: number, mustChange: boolean, source: 'redis' } | null}
 */
let current = null;

export function sanitizeAdminUsername(raw) {
  const username = String(raw || '').trim();
  return /^[A-Za-z0-9_.@-]{2,32}$/.test(username) ? username : null;
}

/** 正式密码 ≥8；引导默认密码 123456 仅用于首次登录 */
export function sanitizeAdminPassword(raw, { allowBootstrap = false } = {}) {
  const password = String(raw ?? '');
  const min = allowBootstrap ? 6 : 8;
  return password.length >= min && password.length <= 64 ? password : null;
}

function safeEqual(a, b) {
  const ha = createHmac('sha256', 'om-admin-cred-eq').update(`eq:${a}`).digest();
  const hb = createHmac('sha256', 'om-admin-cred-eq').update(`eq:${b}`).digest();
  return timingSafeEqual(ha, hb);
}

async function hashPassword(password, salt) {
  const buf = await scrypt(String(password), String(salt), 32);
  return buf.toString('hex');
}

async function buildRecord(username, password, { mustChange = false } = {}) {
  const salt = randomBytes(16).toString('hex');
  return {
    username,
    salt,
    hash: await hashPassword(password, salt),
    updatedAt: Date.now(),
    mustChange: Boolean(mustChange),
  };
}

function normalizeRecord(parsed) {
  if (!parsed?.username || !parsed?.salt || !parsed?.hash) return null;
  return {
    username: String(parsed.username),
    salt: String(parsed.salt),
    hash: String(parsed.hash),
    updatedAt: Number(parsed.updatedAt) || Date.now(),
    // 旧记录无字段视为已完成改密；显式 true 才强制
    mustChange: parsed.mustChange === true,
    linuxdo: normalizeOAuthBinding(parsed.linuxdo),
    github: normalizeOAuthBinding(parsed.github),
    wechat_scan: normalizeOAuthBinding(parsed.wechat_scan),
    qq_scan: normalizeOAuthBinding(parsed.qq_scan),
  };
}

function normalizeOAuthBinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  return {
    id,
    username: String(raw.username || '').trim(),
    avatarUrl: String(raw.avatarUrl || '').trim(),
    boundAt: Number(raw.boundAt) || Date.now(),
  };
}

async function readFromRedis() {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get(CREDENTIALS_KEY);
    if (!raw) return null;
    return normalizeRecord(JSON.parse(raw));
  } catch (err) {
    console.error('admin-credentials Redis 读取失败:', err?.message || err);
    return null;
  }
}

async function writeToRedis(record) {
  const client = getRedisClient();
  if (!client) return false;
  try {
    const { source: _s, ...payload } = record;
    await client.set(CREDENTIALS_KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error('admin-credentials Redis 写入失败:', err?.message || err);
    return false;
  }
}

async function patchAdminRecord(patch, expectedHash) {
  const client = getRedisClient();
  if (!client) return null;
  let saved = false;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const raw = await client.get(CREDENTIALS_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      if (!normalizeRecord(stored) || expectedHash !== undefined && stored.hash !== expectedHash) return null;
      const result = await evalRedisScript(client,
        "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2]); return 1",
        { keys: [CREDENTIALS_KEY], arguments: [raw, JSON.stringify({ ...stored, ...patch })] });
      if (result !== 1) continue;
      saved = true;
      // 其他写入可能在确认响应之前已完成，重新读取后再更新凭据快照
      const latest = normalizeRecord(JSON.parse(await client.get(CREDENTIALS_KEY)));
      current = latest ? { ...latest, source: 'redis' } : null;
      return current;
    }
  } catch {
    if (saved) current = null;
  }
  return null;
}

function readLegacyLocalFile() {
  try {
    if (!fs.existsSync(LEGACY_LOCAL_PATH)) return null;
    return normalizeRecord(JSON.parse(fs.readFileSync(LEGACY_LOCAL_PATH, 'utf8')));
  } catch (err) {
    console.error('admin-credentials 旧本地文件读取失败:', err?.message || err);
    return null;
  }
}

function deleteLegacyLocalFile() {
  try {
    if (fs.existsSync(LEGACY_LOCAL_PATH)) fs.unlinkSync(LEGACY_LOCAL_PATH);
  } catch (err) {
    console.warn('admin-credentials 删除旧本地文件失败:', err?.message || err);
  }
}

/**
 * 启动时调用（须在 Redis 就绪之后）：
 * 优先 Redis；其次迁移旧本地文件到 Redis 后删除；最后用默认 admin/123456 引导写入 Redis。
 * 密码哈希只存 Redis，不再写入磁盘，也不使用内存兜底。
 */
export async function initAdminCredentials() {
  if (!getRedisClient()) {
    current = null;
    console.error('🔐 管理后台: Redis 不可用，凭据无法读取，后台已安全禁用');
    return;
  }

  const stored = await readFromRedis();
  if (stored) {
    current = { ...stored, source: 'redis' };
    deleteLegacyLocalFile();
    console.log(`🔐 管理后台: 已从 Redis 加载管理员账号（${current.username}${current.mustChange ? '，需强制改密' : ''}）`);
    return;
  }

  const legacy = readLegacyLocalFile();
  if (legacy) {
    // 旧本地哈希迁入 Redis 后删除文件
    const record = { ...legacy, mustChange: true };
    if (await writeToRedis(record)) {
      current = { ...record, source: 'redis' };
      deleteLegacyLocalFile();
      console.log(`🔐 管理后台: 已迁移旧本地凭据到 Redis（${current.username}），请尽快修改密码`);
    } else {
      current = null;
      console.error('🔐 管理后台: 旧凭据迁移 Redis 失败，后台已安全禁用');
    }
    return;
  }

  const username = sanitizeAdminUsername(ENV_USERNAME) || DEFAULT_USERNAME;
  const password = sanitizeAdminPassword(ENV_PASSWORD, { allowBootstrap: true }) || DEFAULT_PASSWORD;
  const isDefaultBootstrap = username === DEFAULT_USERNAME && password === DEFAULT_PASSWORD;
  const record = await buildRecord(username, password, {
    mustChange: isDefaultBootstrap || password === DEFAULT_PASSWORD || password.length < 8,
  });

  if (await writeToRedis(record)) {
    current = { ...record, source: 'redis' };
    console.log(`🔐 管理后台: 已初始化管理员账号（${username}）并写入 Redis${record.mustChange ? '（首次登录须改密）' : ''}`);
  } else {
    current = null;
    console.error('🔐 管理后台: 初始化凭据写入 Redis 失败，后台已安全禁用');
  }
}

export function isAdminEnabled() {
  return Boolean(current);
}

export function getAdminUsername() {
  return current?.username || '';
}

export function isAdminCredentialsPersisted() {
  return current?.source === 'redis';
}

export function mustChangeAdminCredentials() {
  return Boolean(current?.mustChange);
}

export async function verifyAdminCredentials(username, password) {
  if (!current) return false;
  const usernameOk = safeEqual(String(username || ''), current.username);
  const hash = await hashPassword(String(password || ''), current.salt);
  const passwordOk = safeEqual(hash, current.hash);
  return usernameOk && passwordOk;
}

/**
 * 修改管理员账号密码（需验证当前密码；禁止继续使用默认弱密码）
 * @returns {Promise<{ success: boolean, error?: string, username?: string, persisted?: boolean, mustChange?: boolean }>}
 */
export async function setAdminCredentials({ username, password, currentPassword }) {
  if (!current) return { success: false, error: '管理后台未启用' };

  const nextUsername = sanitizeAdminUsername(username);
  if (!nextUsername) return { success: false, error: '账号需为 2–32 位字母数字或 _ . @ -' };
  const nextPassword = sanitizeAdminPassword(password);
  if (!nextPassword) return { success: false, error: '新密码需为 8–64 位字符' };
  if (nextPassword === DEFAULT_PASSWORD) {
    return { success: false, error: '不能继续使用默认密码，请设置更强的密码' };
  }

  const verifiedHash = current.hash;
  const verified = await verifyAdminCredentials(current.username, currentPassword);
  if (!verified) return { success: false, error: '当前密码错误' };

  const record = await buildRecord(nextUsername, nextPassword, { mustChange: false });
  // 只更新凭据字段，保留 Redis 中最新的第三方绑定
  const redisPersisted = await patchAdminRecord(record, verifiedHash);
  if (!redisPersisted) return { success: false, error: '管理员凭据写入 Redis 失败' };

  deleteLegacyLocalFile();
  return { success: true, username: nextUsername, persisted: true, mustChange: false };
}

/** 后台管理员当前绑定的 Linux.do 账号（未绑定为 null） */
export function getAdminLinuxdoBinding() {
  return current?.linuxdo || null;
}

export async function getAdminSocialBinding(provider) {
  if (!['wechat_scan', 'qq_scan'].includes(provider)) return null;
  const stored = await readFromRedis();
  return stored?.[provider] || null;
}

export async function setAdminSocialBinding(provider, identity) {
  if (!current || !['wechat_scan', 'qq_scan'].includes(provider)) return { success: false, error: '无法更新管理员绑定' };
  const binding = identity ? normalizeOAuthBinding({ id: identity.subject, username: identity.profile.username, boundAt: Date.now() }) : null;
  if (identity && !binding) return { success: false, error: '无效的扫码身份' };
  if (await patchAdminRecord({ [provider]: binding })) return { success: true };
  return { success: false, error: '管理员绑定保存失败，请重试' };
}

/** 是否已有管理员账号绑定了这个 Linux.do 账号（用于「Linux.do 一键登录后台」） */
export function isLinuxdoIdBoundToAdmin(linuxdoId) {
  const id = String(linuxdoId || '').trim();
  return Boolean(id && current?.linuxdo?.id === id);
}

/** 绑定当前管理员账号到一个 Linux.do 账号（覆盖式，一次只允许绑一个） */
export async function bindAdminLinuxdo({ id, username, avatarUrl }) {
  if (!current) return { success: false, error: '管理后台未启用' };
  const linuxdoId = String(id || '').trim();
  if (!linuxdoId) return { success: false, error: '无效的 Linux.do 账号' };

  const persisted = await patchAdminRecord({ linuxdo: { id: linuxdoId, username: String(username || ''), avatarUrl: String(avatarUrl || ''), boundAt: Date.now() } });
  if (!persisted) return { success: false, error: '绑定写入 Redis 失败' };

  return { success: true, linuxdo: current.linuxdo };
}

/** 解绑管理员账号的 Linux.do 登录 */
export async function unbindAdminLinuxdo() {
  if (!current) return { success: false, error: '管理后台未启用' };
  const persisted = await patchAdminRecord({ linuxdo: null });
  if (!persisted) return { success: false, error: '解绑写入 Redis 失败' };

  return { success: true };
}

/** 后台管理员当前绑定的 GitHub 账号（未绑定为 null） */
export function getAdminGithubBinding() {
  return current?.github || null;
}

/** 是否已有管理员账号绑定了这个 GitHub 账号（用于「GitHub 一键登录后台」） */
export function isGithubIdBoundToAdmin(githubId) {
  const id = String(githubId || '').trim();
  return Boolean(id && current?.github?.id === id);
}

/** 绑定当前管理员账号到一个 GitHub 账号（覆盖式，一次只允许绑一个） */
export async function bindAdminGithub({ id, username, avatarUrl }) {
  if (!current) return { success: false, error: '管理后台未启用' };
  const githubId = String(id || '').trim();
  if (!githubId) return { success: false, error: '无效的 GitHub 账号' };

  const persisted = await patchAdminRecord({ github: { id: githubId, username: String(username || ''), avatarUrl: String(avatarUrl || ''), boundAt: Date.now() } });
  if (!persisted) return { success: false, error: '绑定写入 Redis 失败' };

  return { success: true, github: current.github };
}

/** 解绑管理员账号的 GitHub 登录 */
export async function unbindAdminGithub() {
  if (!current) return { success: false, error: '管理后台未启用' };
  const persisted = await patchAdminRecord({ github: null });
  if (!persisted) return { success: false, error: '解绑写入 Redis 失败' };

  return { success: true };
}
