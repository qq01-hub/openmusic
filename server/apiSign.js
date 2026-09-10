import { createHash, createHmac, timingSafeEqual } from 'crypto';

const SIGN_WINDOW_SEC = Math.max(30, Number(process.env.API_SIGN_WINDOW_SEC) || 300);
/** 媒体签名窗口：读取 API_MEDIA_SIGN_WINDOW_SEC，且不少于 20 分钟 */
const MEDIA_SIGN_WINDOW_SEC = Math.max(
  20 * 60,
  Number(process.env.API_MEDIA_SIGN_WINDOW_SEC) || 20 * 60,
);
const NONCE_TTL_MS = Math.max(SIGN_WINDOW_SEC, MEDIA_SIGN_WINDOW_SEC) * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const API_SIGN_REQUIRED = process.env.API_SIGN_REQUIRED !== undefined
  ? process.env.API_SIGN_REQUIRED !== '0' && process.env.API_SIGN_REQUIRED !== 'false'
  : IS_PRODUCTION;

const SIGN_QUERY_KEYS = new Set(['om_ts', 'om_nonce', 'om_sign']);
const MEDIA_PATHS = new Set(['/api/meting', '/api/media-proxy']);
const API_ACCESS_DENIED = '请求无效，请刷新页面后重试';

export function getMediaSignWindowSec() {
  return MEDIA_SIGN_WINDOW_SEC;
}

export function isMediaApiPath(path = '') {
  return MEDIA_PATHS.has(path);
}

function getSignWindowSec(req) {
  if (isMediaApiPath(req.path || '')) return MEDIA_SIGN_WINDOW_SEC;
  return SIGN_WINDOW_SEC;
}

/** @type {Map<string, number>} */
const usedNonces = new Map();

let nonceCleanupTimer = null;

function scheduleNonceCleanup() {
  if (nonceCleanupTimer) return;
  nonceCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, expiresAt] of usedNonces) {
      if (expiresAt <= now) usedNonces.delete(key);
    }
  }, 60_000);
  if (typeof nonceCleanupTimer.unref === 'function') nonceCleanupTimer.unref();
}

export function isApiSignRequired() {
  return API_SIGN_REQUIRED;
}

const OAUTH_PUBLIC_GET_PATHS = new Set([
  '/api/auth/linuxdo/status',
  '/api/auth/linuxdo/start',
  '/api/auth/linuxdo/callback',
  '/api/auth/github/status',
  '/api/auth/github/start',
  '/api/auth/github/callback',
]);

const ACCOUNT_PUBLIC_POST_PATHS = new Set([
  '/api/auth/email/code',
  '/api/auth/email/register',
  '/api/auth/email/login',
  '/api/auth/logout',
]);

export function isPublicApiPath(req) {
  const path = req.path || '';
  if (
    path === '/api/health'
    || path === '/api/app-version'
    || path === '/api/site-announcement'
    || path === '/api/site-seo'
    || path === '/api/donations'
  ) return true;
  // 音源能力清单无敏感信息；公开后客户端可在进房前决定是否展示酷狗
  if (path === '/api/music/sources' && req.method === 'GET') return true;
  // 大厅房间列表仅公开摘要，无敏感字段；公开后首屏可与会话并行加载
  if (path === '/api/rooms' && req.method === 'GET') return true;
  if (path === '/api/rooms/random-match' && req.method === 'GET') return true;
  if (path === '/api/session/bootstrap' && req.method === 'POST') return true;
  // 汽水官方二次验证组件运行在 iframe 中，只能通过原生 fetch 回调，
  // 无法生成 OpenMusic 的 X-OM-* 请求签名；具体路由仍会校验 HttpOnly 会话和扫码会话归属。
  if (path.startsWith('/api/music-account-contribution/qr/verify/')) return true;
  // OAuth 找回/后台登录场景下浏览器可能压根没有房主身份 Cookie（这正是找回要解决的问题），
  // 这几条路由自己会按 purpose 做对应的身份/会话校验，不能被这里的通用身份门槛提前拦掉。
  if (req.method === 'GET' && OAUTH_PUBLIC_GET_PATHS.has(path)) return true;
  if (ACCOUNT_PUBLIC_POST_PATHS.has(path) && req.method === 'POST') return true;
  if (path === '/api/auth/session' && req.method === 'GET') return true;
  return false;
}

export function deriveApiSignKey(clientIdSecret, userId, iat) {
  return createHmac('sha256', clientIdSecret)
    .update(`om-api-sign:${userId}:${iat}`)
    .digest('base64url');
}

function hashBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return '';
  const raw = req.rawBody;
  if (!raw || !raw.length) return '';
  return createHash('sha256').update(raw).digest('hex');
}

export function canonicalApiQuery(query = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(query)) {
    if (SIGN_QUERY_KEYS.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) entries.push([key, String(item)]);
    } else {
      entries.push([key, String(value)]);
    }
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

function extractSignParts(req) {
  const ts = req.headers['x-om-ts'] || req.query?.om_ts;
  const nonce = req.headers['x-om-nonce'] || req.query?.om_nonce;
  const sign = req.headers['x-om-sign'] || req.query?.om_sign;
  return {
    ts: String(ts || '').trim(),
    nonce: String(nonce || '').trim(),
    sign: String(sign || '').trim(),
  };
}

function shouldConsumeNonce(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return true;
  return !MEDIA_PATHS.has(req.path || '');
}

function consumeNonce(userId, nonce) {
  scheduleNonceCleanup();
  const key = `${userId}:${nonce}`;
  if (usedNonces.has(key)) return false;
  usedNonces.set(key, Date.now() + NONCE_TTL_MS);
  return true;
}

function buildSignPayload(req, timestamp, nonce) {
  return [
    req.method.toUpperCase(),
    req.path,
    canonicalApiQuery(req.query),
    hashBody(req),
    String(timestamp),
    String(nonce),
  ].join('\n');
}

function verifySignature(signKey, payload, providedSign) {
  const expected = createHmac('sha256', signKey).update(payload).digest('base64url');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(providedSign);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function verifyApiSign(req, signKey, userId) {
  if (!API_SIGN_REQUIRED) return { ok: true };

  const { ts, nonce, sign } = extractSignParts(req);
  if (!ts || !nonce || !sign) {
    return { ok: false, error: API_ACCESS_DENIED };
  }

  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, error: API_ACCESS_DENIED };
  }

  const now = Math.floor(Date.now() / 1000);
  if (timestamp > now + 60) {
    return { ok: false, error: API_ACCESS_DENIED };
  }
  if (now - timestamp > getSignWindowSec(req)) {
    return { ok: false, error: API_ACCESS_DENIED };
  }

  if (nonce.length < 8 || nonce.length > 128) {
    return { ok: false, error: API_ACCESS_DENIED };
  }

  const payload = buildSignPayload(req, timestamp, nonce);
  if (!verifySignature(signKey, payload, sign)) {
    return { ok: false, error: API_ACCESS_DENIED };
  }

  if (shouldConsumeNonce(req) && !consumeNonce(userId, nonce)) {
    return { ok: false, error: API_ACCESS_DENIED };
  }

  return { ok: true };
}
