import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import {
  completeQishuiVerification,
  createMusicQrSession,
  fetchQishuiVerificationAsset,
  checkMusicQrSession,
  requestQishuiVerification,
  startQishuiVerification,
} from './metingAdmin.js';
import { getRedisClient, isRedisEnabled } from './roomStorage.js';
import { decryptSensitiveValue, encryptSensitiveValue } from './roomCredentialCrypto.js';

const SESSION_TTL_MS = 10 * 60 * 1000;
const CONFIRMED_TTL_MS = 2 * 60 * 1000;
const BINDING_LOCK_MS = 30 * 1000;
const MAX_LOCAL_SESSIONS = 2000;
const sessions = new Map();
const REDIS_PREFIX = 'openmusic:music-qr:';

function shortId(value) {
  const raw = text(value);
  return raw ? `${raw.slice(0, 8)}...` : '-';
}

function redisKey(id) { return `${REDIS_PREFIX}${id}`; }

async function persistSession(id, session) {
  const redis = getRedisClient();
  if (!redis) return true;
  const encrypted = encryptSensitiveValue(JSON.stringify(session), id);
  if (!encrypted) throw new Error('房间凭证加密密钥不可用，无法保存扫码会话');
  await redis.set(redisKey(id), encrypted, { PX: Math.max(1000, session.expiresAt - Date.now()) });
  return true;
}

async function loadSession(id) {
  const local = sessions.get(id);
  if (local) return local;
  const redis = getRedisClient();
  if (!redis) return null;
  const encrypted = await redis.get(redisKey(id));
  if (!encrypted) return null;
  const raw = decryptSensitiveValue(encrypted, id);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (session.expiresAt <= Date.now()) {
      await redis.del(redisKey(id));
      return null;
    }
    cacheSession(id, session);
    return session;
  } catch { return null; }
}

async function removeSession(id) {
  sessions.delete(id);
  const redis = getRedisClient();
  if (redis) await redis.del(redisKey(id));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function unwrap(value) {
  let current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (let i = 0; i < 2; i += 1) {
    const nested = current.data || current.result;
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) break;
    current = nested;
  }
  return current;
}

function normalizeStatus(value) {
  const raw = text(value).toLowerCase();
  if (['0', 'waiting', 'wait', 'pending', 'new'].includes(raw)) return 'waiting';
  if (['1', 'scanned', 'scan', '已扫码'].includes(raw)) return 'scanned';
  if (['2', 'confirmed', 'confirm', 'success', 'authorized'].includes(raw)) return 'confirmed';
  if (['3', 'expired', 'expire', 'timeout'].includes(raw)) return 'expired';
  if (['error', 'failed', 'fail'].includes(raw)) return 'error';
  return raw || 'waiting';
}

function extractCookie(value) {
  const raw = unwrap(value);
  for (const candidate of [raw.cookie, raw.cookies, raw.credential, raw.token]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const object = raw.cookie && typeof raw.cookie === 'object' && !Array.isArray(raw.cookie)
    ? raw.cookie
    : null;
  if (!object) return '';
  return Object.entries(object)
    .map(([key, item]) => `${key}=${text(item)}`)
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

function normalizeQrImage(value) {
  const raw = text(value);
  if (raw.startsWith('data:image/')) return raw;
  if (/^[a-z\d+/]+=*$/i.test(raw) && raw.length > 100) return `data:image/png;base64,${raw}`;
  return '';
}

function cleanExpired() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function cacheSession(id, session) {
  cleanExpired();
  sessions.delete(id);
  sessions.set(id, session);
  while (sessions.size > MAX_LOCAL_SESSIONS) {
    const oldestId = sessions.keys().next().value;
    if (oldestId === undefined) break;
    sessions.delete(oldestId);
  }
}

async function requireOwnedSession({ sessionId, ownerId, purpose, roomId = '' }) {
  cleanExpired();
  const session = await loadSession(text(sessionId));
  if (!session || session.ownerId !== text(ownerId) || session.purpose !== purpose) return null;
  if (purpose === 'room' && session.roomId !== text(roomId).toUpperCase()) return null;
  return session;
}

export async function createManagedMusicQrSession({ ownerId, platform, purpose, roomId = '' }) {
  cleanExpired();
  const result = await createMusicQrSession(platform);
  if (!result.ok) return result;
  const raw = unwrap(result.data);
  const key = text(raw.key || raw.uuid || raw.unikey || raw.qrKey);
  const qrsig = text(raw.qrsig || raw.qr_sig || raw.qrSig || raw.key || raw.uuid);
  if (platform === 'tencent' ? !qrsig : !key) {
    return { ok: false, error: '上游未返回有效扫码会话' };
  }
  const sessionId = randomBytes(32).toString('base64url');
  const qrUrl = text(raw.qrurl || raw.qrUrl || raw.url || raw.loginUrl);
  let qrImage = normalizeQrImage(raw.qrimg || raw.qrImage || raw.image || raw.base64);
  if (!qrImage && qrUrl) qrImage = await QRCode.toDataURL(qrUrl, { width: 320, margin: 1 });
  const session = {
    ownerId: text(ownerId),
    roomId: text(roomId).toUpperCase(),
    platform,
    purpose,
    upstream: { platform, key, qrsig, ptqrtoken: text(raw.ptqrtoken || raw.ptqrToken) },
    credential: '',
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  cacheSession(sessionId, session);
  try { await persistSession(sessionId, session); } catch (err) {
    sessions.delete(sessionId);
    return { ok: false, error: `扫码会话保存失败：${err.message}` };
  }
  console.info('[Music QR] 创建会话', JSON.stringify({
    platform,
    purpose,
    roomId: text(roomId).toUpperCase() || undefined,
    sessionId: shortId(sessionId),
    upstreamKey: shortId(key),
    upstreamQrsig: shortId(qrsig),
    redis: isRedisEnabled(),
  }));
  return {
    ok: true,
    data: {
      sessionId,
      platform,
      qrimg: qrImage || undefined,
      message: text(raw.message || raw.msg) || undefined,
    },
  };
}

export async function checkManagedMusicQrSession(context) {
  const session = await requireOwnedSession(context);
  if (!session) {
    console.warn('[Music QR] OpenMusic 会话不存在', JSON.stringify({
      platform: 'unknown',
      purpose: context?.purpose,
      roomId: text(context?.roomId).toUpperCase() || undefined,
      sessionId: shortId(context?.sessionId),
      redis: isRedisEnabled(),
    }));
    return { ok: false, status: 404, error: '扫码会话无效或已过期，请重新生成二维码' };
  }
  console.info('[Music QR] 检查会话', JSON.stringify({
    platform: session.platform,
    purpose: session.purpose,
    sessionId: shortId(context?.sessionId),
    upstreamKey: shortId(session.upstream?.key),
    upstreamQrsig: shortId(session.upstream?.qrsig),
    expiresInMs: Math.max(0, Number(session.expiresAt) - Date.now()),
    redis: isRedisEnabled(),
  }));
  if (session.credential) return { ok: true, data: { status: 'confirmed' } };
  const result = await checkMusicQrSession(session.upstream);
  if (!result.ok) return result;
  const raw = unwrap(result.data);
  const status = normalizeStatus(raw.status ?? raw.code ?? raw.state);
  if (status === 'confirmed') {
    const credential = extractCookie(raw);
    if (!credential) return { ok: false, error: '登录成功但上游未返回有效凭证' };
    session.credential = credential;
    session.bindingUntil = 0;
    session.expiresAt = Date.now() + CONFIRMED_TTL_MS;
    try {
      await persistSession(text(context.sessionId), session);
    } catch (err) {
      session.credential = '';
      return { ok: false, error: `扫码凭证保存失败：${err.message}` };
    }
  }
  if (status === 'expired' || status === 'error') {
    console.warn('[Music QR] 上游会话结束', JSON.stringify({
      platform: session.platform,
      sessionId: shortId(context?.sessionId),
      upstreamQrsig: shortId(session.upstream?.qrsig),
      status,
      message: text(raw.message || raw.msg) || undefined,
    }));
    await removeSession(text(context.sessionId));
  }
  return {
    ok: true,
    data: {
      status,
      message: text(raw.message || raw.msg) || undefined,
      secondVerify: raw.secondVerify || undefined,
    },
  };
}

async function getQishuiSession(context) {
  // 二次验证页面通过 HTTP 回调，而扫码会话可能来自房间 Socket 或共享会员页面。
  // 会话 ID 是随机值，仍然必须校验当前用户归属；这里不强制限定 purpose。
  cleanExpired();
  const session = await loadSession(text(context.sessionId));
  if (!session || session.ownerId !== text(context.ownerId)) return null;
  return session?.platform === 'qishui' ? session : null;
}

export async function startManagedQishuiVerification(context) {
  const session = await getQishuiSession(context);
  if (!session) return { ok: false, status: 404, error: '汽水扫码会话无效或已过期' };
  const result = await startQishuiVerification(session.upstream.key);
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

export async function requestManagedQishuiVerification(context, request) {
  const session = await getQishuiSession(context);
  if (!session) return { ok: false, status: 404, error: '汽水扫码会话无效或已过期' };
  return requestQishuiVerification(session.upstream.key, request);
}

export async function completeManagedQishuiVerification(context) {
  const session = await getQishuiSession(context);
  if (!session) return { ok: false, status: 404, error: '汽水扫码会话无效或已过期' };
  const result = await completeQishuiVerification(session.upstream.key);
  if (!result.ok) return result;
  const raw = unwrap(result.data);
  const status = normalizeStatus(raw.status ?? raw.code ?? raw.state);
  if (status !== 'confirmed') return { ok: true, data: { status, message: text(raw.message || raw.msg) } };
  const credential = extractCookie(raw);
  if (!credential) return { ok: false, error: '二次验证完成但 Meting 未返回有效 Cookie' };
  session.credential = credential;
  session.bindingUntil = 0;
  session.expiresAt = Date.now() + CONFIRMED_TTL_MS;
  await persistSession(text(context.sessionId), session);
  return { ok: true, data: { status: 'confirmed', message: '登录成功' } };
}

export async function fetchManagedQishuiVerificationAsset(name) {
  return fetchQishuiVerificationAsset(name);
}

export async function getManagedMusicQrCredential(context) {
  const session = await requireOwnedSession(context);
  if (!session?.credential) return { ok: false, error: '扫码尚未确认或会话已过期' };
  if (Number(session.bindingUntil) > Date.now()) return { ok: false, error: '该扫码凭证正在绑定，请稍候重试' };
  session.bindingUntil = Date.now() + BINDING_LOCK_MS;
  try {
    await persistSession(text(context.sessionId), session);
  } catch (err) {
    session.bindingUntil = 0;
    return { ok: false, error: `扫码凭证锁定失败：${err.message}` };
  }
  return { ok: true, platform: session.platform, cookie: session.credential };
}

export async function releaseManagedMusicQrCredential(context) {
  const session = await requireOwnedSession(context);
  if (!session?.credential) return false;
  session.bindingUntil = 0;
  try {
    await persistSession(text(context.sessionId), session);
    return true;
  } catch {
    return false;
  }
}

export async function finalizeManagedMusicQrCredential(context) {
  const session = await requireOwnedSession(context);
  if (!session?.credential || Number(session.bindingUntil) <= 0) return false;
  await removeSession(text(context.sessionId));
  return true;
}


export const __test = { sessions, extractCookie, normalizeStatus };
