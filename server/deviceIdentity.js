import { getRedisClient, isRedisEnabled } from './roomStorage.js';

const DEVICE_USER_PREFIX = 'openmusic:device:';
const USER_DEVICES_PREFIX = 'openmusic:user_devices:';
const DEVICE_BINDING_TTL_SEC = 180 * 24 * 60 * 60;
const MAX_DEVICES_PER_USER = 20;
const MAX_MEMORY_DEVICE_BINDINGS = 10_000;

/** deviceId -> userId（进程内热缓存；持久化只写 Redis） */
const deviceToUser = new Map();
/** userId -> Set<deviceId> */
const userToDevices = new Map();

export function sanitizeDeviceId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : '';
}

function rememberDeviceBinding(deviceId, userId) {
  const did = sanitizeDeviceId(deviceId);
  const uid = sanitizeDeviceId(userId);
  if (!did || !uid) return;

  const previousUser = deviceToUser.get(did);
  if (previousUser && previousUser !== uid) {
    const prevSet = userToDevices.get(previousUser);
    prevSet?.delete(did);
  }

  deviceToUser.set(did, uid);
  if (!userToDevices.has(uid)) userToDevices.set(uid, new Set());
  const devices = userToDevices.get(uid);
  devices.add(did);
  while (devices.size > MAX_DEVICES_PER_USER) {
    const oldest = Array.from(devices).find((item) => item !== did);
    if (!oldest) break;
    devices.delete(oldest);
    deviceToUser.delete(oldest);
  }
  while (deviceToUser.size > MAX_MEMORY_DEVICE_BINDINGS) {
    const oldest = Array.from(deviceToUser.keys()).find((item) => item !== did);
    if (!oldest) break;
    const oldestUser = deviceToUser.get(oldest);
    deviceToUser.delete(oldest);
    userToDevices.get(oldestUser)?.delete(oldest);
  }
}

async function persistDeviceBinding(deviceId, userId) {
  const client = getRedisClient();
  if (!client) {
    console.error('Redis: 不可用，设备身份绑定未持久化');
    return false;
  }

  const did = sanitizeDeviceId(deviceId);
  const uid = sanitizeDeviceId(userId);
  if (!did || !uid) return false;

  try {
    const previousUser = await client.get(`${DEVICE_USER_PREFIX}${did}`);
    if (previousUser && previousUser !== uid) {
      await client.sRem(`${USER_DEVICES_PREFIX}${previousUser}`, did);
    }
    const deviceKey = `${DEVICE_USER_PREFIX}${did}`;
    const userDevicesKey = `${USER_DEVICES_PREFIX}${uid}`;
    await client.set(deviceKey, uid, { EX: DEVICE_BINDING_TTL_SEC });
    await client.sAdd(userDevicesKey, did);
    await client.expire(userDevicesKey, DEVICE_BINDING_TTL_SEC);

    const devices = await client.sMembers(userDevicesKey);
    const excess = devices.filter((item) => item !== did).slice(0, Math.max(0, devices.length - MAX_DEVICES_PER_USER));
    for (const staleDeviceId of excess) {
      await client.sRem(userDevicesKey, staleDeviceId);
      const staleKey = `${DEVICE_USER_PREFIX}${staleDeviceId}`;
      if (await client.get(staleKey) === uid) await client.del(staleKey);
    }
    return true;
  } catch (err) {
    console.error('Redis: 保存设备身份绑定失败:', err.message);
    return false;
  }
}

/** 绑定设备与账号；同一设备始终映射到同一 userId（直至被新账号覆盖绑定） */
export async function linkDeviceToUser(deviceId, userId) {
  const did = sanitizeDeviceId(deviceId);
  const uid = sanitizeDeviceId(userId);
  if (!did || !uid) return false;

  if (!await persistDeviceBinding(did, uid)) return false;
  rememberDeviceBinding(did, uid);
  return true;
}

export async function getUserIdForDevice(deviceId, { authoritative = false } = {}) {
  const did = sanitizeDeviceId(deviceId);
  if (!did) return null;

  const cached = deviceToUser.get(did);
  if (cached && !authoritative) return cached;

  const client = getRedisClient();
  if (!isRedisEnabled() || !client) throw new Error('设备身份存储暂不可用');

  try {
    const uid = await client.get(`${DEVICE_USER_PREFIX}${did}`);
    const normalized = sanitizeDeviceId(uid);
    if (normalized) {
      await client.expire(`${DEVICE_USER_PREFIX}${did}`, DEVICE_BINDING_TTL_SEC);
      await client.expire(`${USER_DEVICES_PREFIX}${normalized}`, DEVICE_BINDING_TTL_SEC);
      rememberDeviceBinding(did, normalized);
      return normalized;
    }
  } catch (err) {
    console.error('Redis: 读取设备身份绑定失败:', err.message);
    throw new Error('设备身份存储暂不可用');
  }
  return null;
}

export function getDeviceIdsForUser(userId) {
  const uid = sanitizeDeviceId(userId);
  if (!uid) return [];
  return Array.from(userToDevices.get(uid) || []);
}

export async function collectDeviceIdsForUser(userId) {
  const uid = sanitizeDeviceId(userId);
  if (!uid) return [];

  const ids = new Set(getDeviceIdsForUser(uid));

  if (isRedisEnabled()) {
    const client = getRedisClient();
    if (client) {
      try {
        const remote = await client.sMembers(`${USER_DEVICES_PREFIX}${uid}`);
        for (const did of remote) {
          const normalized = sanitizeDeviceId(did);
          if (normalized) ids.add(normalized);
        }
      } catch (err) {
        console.error('Redis: 读取用户设备列表失败:', err.message);
      }
    }
  }

  return Array.from(ids);
}

export function isDeviceBanned(room, deviceId) {
  const did = sanitizeDeviceId(deviceId);
  if (!did || !room?.bannedDeviceIds) return false;
  return room.bannedDeviceIds.has(did);
}

export function isAccessBanned(room, userId, deviceId) {
  if (room?.bannedUserIds?.has(userId)) return true;
  return isDeviceBanned(room, deviceId);
}
