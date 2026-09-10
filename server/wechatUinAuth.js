import { getRedisClient, isRedisEnabled } from './roomStorage.js';

export const WECHAT_UIN_CONFLICT = 'WECHAT_UIN_CONFLICT';
const BIND_PREFIX = 'openmusic:wechat:uin:bind:';
const PROFILE_PREFIX = 'openmusic:wechat:uin:profile:';

export function normalizeWechatUin(value) {
  const normalized = String(value ?? '').trim();
  return /^\d{1,32}$/.test(normalized) ? normalized : null;
}

function normalizeRoomId(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(normalized) ? normalized : null;
}

export function createWechatUinStore({ redis, enabled } = {}) {
  const getStoreRedis = () => redis || getRedisClient();
  const isAvailable = () => Boolean((enabled === undefined ? isRedisEnabled() : enabled) && getStoreRedis());
  const requireRedis = () => {
    const client = getStoreRedis();
    if (!((enabled === undefined ? isRedisEnabled() : enabled) && client)) {
      throw new Error('Redis 不可用，无法保存微信绑定');
    }
    return client;
  };
  const bindKey = (uin, roomId) => `${BIND_PREFIX}${uin}:${roomId}`;
  const profileKey = (userId, roomId) => `${PROFILE_PREFIX}${userId}:${roomId}`;

  async function getProfileForUser(userId, roomId) {
    if (!isAvailable()) return null;
    const id = String(userId || '').trim();
    const rid = normalizeRoomId(roomId);
    if (!id) return null;
    const client = getStoreRedis();
    const keys = rid ? [profileKey(id, rid), `${PROFILE_PREFIX}${id}`] : [`${PROFILE_PREFIX}${id}`];
    for (const key of keys) {
      const raw = await client.get(key);
      if (!raw) continue;
      try { return JSON.parse(raw); } catch { return null; }
    }
    return null;
  }

  async function bindToUser(rawUin, userId, roomId) {
    const client = requireRedis();
    const uin = normalizeWechatUin(rawUin);
    const id = String(userId || '').trim();
    const rid = normalizeRoomId(roomId);
    if (!uin || !id || !rid) throw new Error('微信 UIN、用户身份或房间号无效');

    const key = bindKey(uin, rid);
    const existingUserId = await client.get(key);
    if (existingUserId && existingUserId !== id) {
      const error = new Error('该房间已绑定其他房主身份');
      error.code = WECHAT_UIN_CONFLICT;
      throw error;
    }

    const record = { wechatUin: uin, roomId: rid, boundAt: Date.now() };
    await client.set(key, id);
    await client.set(profileKey(id, rid), JSON.stringify(record));
    return record;
  }

  async function getUserIdForUin(rawUin, roomId) {
    if (!isAvailable()) return null;
    const uin = normalizeWechatUin(rawUin);
    const rid = normalizeRoomId(roomId);
    if (!uin || !rid) return null;
    const client = getStoreRedis();
    const scoped = await client.get(bindKey(uin, rid));
    return scoped || client.get(`${BIND_PREFIX}${uin}`);
  }

  async function unbindForUser(userId, roomId) {
    if (!isAvailable()) return false;
    const id = String(userId || '').trim();
    const rid = normalizeRoomId(roomId);
    if (!id || !rid) return false;
    const client = getStoreRedis();
    const profile = await getProfileForUser(id, rid);
    if (profile?.wechatUin) {
      await client.del(bindKey(profile.wechatUin, rid));
      if (!profile.roomId) await client.del(`${BIND_PREFIX}${profile.wechatUin}`);
    }
    await client.del(profileKey(id, rid));
    return true;
  }

  async function clearBindingsForRoom(roomId) {
    if (!isAvailable()) return false;
    const rid = normalizeRoomId(roomId);
    const client = getStoreRedis();
    if (!rid || typeof client.scanIterator !== 'function') return false;
    const bindKeys = [];
    for await (const key of client.scanIterator({ MATCH: `${BIND_PREFIX}*:${rid}` })) bindKeys.push(key);
    const profileKeys = [];
    for await (const key of client.scanIterator({ MATCH: `${PROFILE_PREFIX}*:${rid}` })) profileKeys.push(key);
    if (bindKeys.length) await client.del(...bindKeys);
    if (profileKeys.length) await client.del(...profileKeys);
    return true;
  }

  return { isEnabled: isAvailable, getProfileForUser, bindToUser, getUserIdForUin, unbindForUser, clearBindingsForRoom };
}
