import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'adminConfig.json');
const DEFAULT_ENTRY_PATH = '/admin';

const RESERVED_PREFIXES = [
  '/api',
  '/socket.io',
  '/downloads',
  '/wx-proxy',
  '/cgi-bin',
  '/room/',
  '/tv/',
  '/assets/',
  '/qface/',
  '/vendor/',
];

let cached = {
  mtimeMs: -1,
  checkedAt: 0,
  entryPath: DEFAULT_ENTRY_PATH,
  entryPathCustomized: false,
};
const STAT_CHECK_INTERVAL_MS = 1000;

function normalizeEntryPath(raw) {
  let p = String(raw || '').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** @returns {string | null} 合法路径，否则 null */
export function sanitizeAdminEntryPath(raw) {
  const p = normalizeEntryPath(raw);
  // /admin 默认入口；自定义须 8–64 位 URL 安全字符
  if (p === '/admin') return p;
  if (!/^\/[A-Za-z0-9_-]{8,64}$/.test(p)) return null;
  const lower = p.toLowerCase();
  if (lower === '/room' || lower === '/tv') return null;
  for (const prefix of RESERVED_PREFIXES) {
    const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    if (lower === bare || lower.startsWith(prefix)) return null;
  }
  return p;
}

function readConfigFromDisk() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { entryPath: DEFAULT_ENTRY_PATH, entryPathCustomized: false };
    }
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const entryPath = sanitizeAdminEntryPath(raw.entryPath) || DEFAULT_ENTRY_PATH;
    // 已是非默认路径则视为已自定义；否则看显式标记
    const entryPathCustomized = entryPath !== DEFAULT_ENTRY_PATH
      ? true
      : Boolean(raw.entryPathCustomized);
    return { entryPath, entryPathCustomized };
  } catch (err) {
    console.error('admin-config read error:', err?.message || err);
    return { entryPath: DEFAULT_ENTRY_PATH, entryPathCustomized: false };
  }
}

function refreshCache(forceStat = false) {
  const now = Date.now();
  if (!forceStat && cached.checkedAt > 0 && now - cached.checkedAt < STAT_CHECK_INTERVAL_MS) {
    return cached;
  }
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    cached = { mtimeMs: 0, checkedAt: now, entryPath: DEFAULT_ENTRY_PATH, entryPathCustomized: false };
    return cached;
  }
  if (cached.mtimeMs === mtimeMs) {
    cached.checkedAt = now;
    return cached;
  }
  const cfg = readConfigFromDisk();
  cached = { mtimeMs, checkedAt: now, ...cfg };
  return cached;
}

export function getAdminEntryPath() {
  return refreshCache().entryPath;
}

/** 从未自定义过登录地址 → 首次登录强制修改（须离开默认 /admin） */
export function mustChangeAdminEntryPath() {
  return !refreshCache().entryPathCustomized;
}

/**
 * 兼容没有 adminConfig.json 的旧站点：保留原 /admin 入口，并标记为已配置，
 * 避免升级后被当成新站强制重新设置。已有配置文件绝不覆盖。
 */
export function migrateLegacyAdminEntryConfig() {
  if (fs.existsSync(CONFIG_PATH)) return;
  try {
    const payload = { entryPath: DEFAULT_ENTRY_PATH, entryPathCustomized: true };
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    cached = { mtimeMs: fs.statSync(CONFIG_PATH).mtimeMs, checkedAt: Date.now(), ...payload };
  } catch (err) {
    if (err?.code !== 'EEXIST') {
      console.warn('admin-config: 旧站点入口兼容标记写入失败:', err?.message || err);
    }
  }
}

/**
 * @param {string} raw
 * @param {{ requireCustom?: boolean }} [opts] 初始安全设置阶段禁止继续使用 /admin
 */
export function setAdminEntryPath(raw, opts = {}) {
  const entryPath = sanitizeAdminEntryPath(raw);
  if (!entryPath) {
    return { success: false, error: '登录地址格式无效（须为 / 加 8–64 位字母数字_-）' };
  }
  if (opts.requireCustom && entryPath === DEFAULT_ENTRY_PATH) {
    return { success: false, error: '初始设置须将登录地址改为非 /admin 的随机路径' };
  }
  const prev = refreshCache(true);
  // 一旦用过非默认路径即标记已自定义；之后即使改回 /admin 也不再强制
  const entryPathCustomized = prev.entryPathCustomized || entryPath !== DEFAULT_ENTRY_PATH;
  try {
    const payload = { entryPath, entryPathCustomized };
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    cached = { mtimeMs: fs.statSync(CONFIG_PATH).mtimeMs, checkedAt: Date.now(), entryPath, entryPathCustomized };
    return { success: true, entryPath, entryPathCustomized };
  } catch (err) {
    console.error('admin-config write error:', err?.message || err);
    return { success: false, error: '保存失败' };
  }
}

export function createRandomAdminEntryPath() {
  return `/${randomBytes(12).toString('base64url')}`;
}
