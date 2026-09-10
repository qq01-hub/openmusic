import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { getRedisClient, isRedisEnabled } from './roomStorage.js';

// linuxdoAuth.js 和 githubAuth.js 除了接口地址/字段名以外几乎是同一套逻辑
// （state 签名验证、Redis 绑定存取、防止旧绑定悬挂）；这里抽成一个工厂，
// 两个模块只保留各自平台特有的 URL 构造 / code 换 token / 用户信息解析。

// 未配置 CLIENT_ID_SECRET 时的兜底：必须是进程启动时随机生成、不可预测的值——
// 之前用固定字符串兜底，任何拿到这份开源代码的人都能算出同样的签名，
// 使 state 形同虚设。随机兜底每次重启会变，但只影响「10 分钟内未完成的登录跳转」，
// 不影响已持久化的绑定关系本身。
const FALLBACK_STATE_SECRET = randomBytes(32).toString('hex');

function stateSecret() {
  return String(process.env.CLIENT_ID_SECRET || FALLBACK_STATE_SECRET);
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 仅允许跳回站内相对路径，避免 state 被用来做开放重定向 */
export function sanitizeReturnPath(path) {
  const value = String(path || '').trim();
  if (!/^\/[a-zA-Z0-9\-._~/%]*$/.test(value)) return '/';
  if (value.startsWith('//')) return '/'; // 防止 //evil.com 这类协议相对 URL
  return value;
}

/**
 * @param {object} opts
 * @param {string} opts.idField - 绑定记录里第三方账号 ID 的字段名，如 'linuxdoId' / 'githubId'
 * @param {string} opts.bindPrefix - Redis：providerId -> userId
 * @param {string} opts.profilePrefix - Redis：userId -> { [idField], username, avatarUrl, boundAt }
 * @param {(state: string) => string} opts.buildAuthorizeUrl
 * @param {(code: string) => Promise<string>} opts.exchangeCode - 返回 access_token
 * @param {(accessToken: string) => Promise<{ id: string, username: string, avatarUrl: string }>} opts.fetchProfile
 * @param {number} [opts.stateTtlSec] - 授权跳转允许的最长耗时（默认 10 分钟）
 */
export function createOAuthProvider(opts) {
  const stateTtlSec = opts.stateTtlSec ?? 10 * 60;
  const configuredRedis = opts.redis || null;
  const { idField, bindPrefix, profilePrefix } = opts;
  const normalizeRoomId = (value) => {
    const normalized = String(value ?? '').trim().toUpperCase();
    return /^[A-Z0-9]{4,16}$/.test(normalized) ? normalized : null;
  };
  const bindKey = (providerId, roomId) => roomId ? `${bindPrefix}${providerId}:${roomId}` : `${bindPrefix}${providerId}`;
  const profileKey = (userId, roomId) => roomId ? `${profilePrefix}${userId}:${roomId}` : `${profilePrefix}${userId}`;

  /**
   * 无状态签名 state，避免额外的服务端会话存储。
   * @param {{ purpose: string, userId?: string, returnPath?: string }} payload
   */
  function signState(payload) {
    const body = JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) });
    const encoded = Buffer.from(body, 'utf8').toString('base64url');
    const sig = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  function verifyState(token) {
    const raw = String(token || '');
    const dot = raw.lastIndexOf('.');
    if (dot <= 0) return null;
    const encoded = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);

    try {
      const expected = Buffer.from(createHmac('sha256', stateSecret()).update(encoded).digest('base64url'));
      const actual = Buffer.from(sig);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      const iat = Number(payload.iat);
      if (!Number.isFinite(iat) || Math.floor(Date.now() / 1000) - iat > stateTtlSec) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async function getProfileForUser(userId, roomId) {
    const client = configuredRedis || getRedisClient();
    if ((!configuredRedis && !isRedisEnabled()) || !client) return null;
    const id = String(userId || '').trim();
    if (!id) return null;
    try {
      const rid = normalizeRoomId(roomId);
      const keys = rid ? [profileKey(id, rid), profileKey(id, null)] : [profileKey(id, null)];
      for (const key of keys) {
        const raw = await client.get(key);
        if (!raw) continue;
        return JSON.parse(raw);
      }
      return null;
    } catch {
      return null;
    }
  }

  async function bindToUser(providerId, userId, profile, roomId) {
    const client = configuredRedis || getRedisClient();
    if ((!configuredRedis && !isRedisEnabled()) || !client) throw new Error('Redis 不可用，无法保存绑定');

    const rid = normalizeRoomId(roomId);
    const currentBindKey = bindKey(providerId, rid);
    const existingUserId = await client.get(currentBindKey);
    if (existingUserId && existingUserId !== userId) {
      if (rid) throw new Error('该房间已绑定其他房主身份');
      // 兼容旧的全局绑定：这个第三方账号之前绑定给别的 userId 的旧关联需要清掉。
      await client.del(`${profilePrefix}${existingUserId}`);
    }

    // 这个 userId 之前绑定过别的第三方账号也要一并清掉，否则旧账号仍能找回这个身份
    // （换绑后旧账号继续拥有恢复权限，等于换绑形同虚设）
    const previousProfile = rid ? null : await getProfileForUser(userId);
    if (previousProfile?.[idField] && previousProfile[idField] !== providerId) {
      await client.del(bindKey(previousProfile[idField], null));
    }

    const record = {
      [idField]: providerId,
      username: profile?.username || '',
      avatarUrl: profile?.avatarUrl || '',
      boundAt: Date.now(),
      ...(rid ? { roomId: rid } : {}),
    };
    await client.set(currentBindKey, userId);
    await client.set(profileKey(userId, rid), JSON.stringify(record));
    return record;
  }

  async function getUserIdFor(providerId, roomId) {
    const client = configuredRedis || getRedisClient();
    if ((!configuredRedis && !isRedisEnabled()) || !client) return null;
    const id = String(providerId || '').trim();
    if (!id) return null;
    const rid = normalizeRoomId(roomId);
    const userId = await client.get(bindKey(id, rid));
    if (userId) return userId;
    return rid ? client.get(bindKey(id, null)) : null;
  }

  async function unbindForUser(userId, roomId) {
    const client = configuredRedis || getRedisClient();
    if ((!configuredRedis && !isRedisEnabled()) || !client) return false;
    const rid = normalizeRoomId(roomId);
    const profile = await getProfileForUser(userId, rid);
    if (profile?.[idField]) {
      await client.del(bindKey(profile[idField], rid));
      if (!profile.roomId) await client.del(bindKey(profile[idField], null));
    }
    await client.del(profileKey(userId, rid));
    return true;
  }

  async function clearBindingsForRoom(roomId) {
    const client = configuredRedis || getRedisClient();
    if ((!configuredRedis && !isRedisEnabled()) || !client) return false;
    const rid = normalizeRoomId(roomId);
    if (!rid || typeof client.scanIterator !== 'function') return false;
    const bindKeys = [];
    for await (const key of client.scanIterator({ MATCH: `${bindPrefix}*:${rid}` })) bindKeys.push(key);
    const profileKeys = [];
    for await (const key of client.scanIterator({ MATCH: `${profilePrefix}*:${rid}` })) profileKeys.push(key);
    if (bindKeys.length) await client.del(...bindKeys);
    if (profileKeys.length) await client.del(...profileKeys);
    return true;
  }

  return {
    signState,
    verifyState,
    buildAuthorizeUrl: opts.buildAuthorizeUrl,
    exchangeCode: opts.exchangeCode,
    fetchProfile: opts.fetchProfile,
    bindToUser,
    getUserIdFor,
    getProfileForUser,
    unbindForUser,
    clearBindingsForRoom,
  };
}
