import { evalRedisScript } from './redisScripts.js';
import { getRedisClient, isRedisEnabled } from './roomStorage.js';

const DEVICE_USER_PREFIX = 'openmusic:device:';
const USER_DEVICES_PREFIX = 'openmusic:user_devices:';
const NETWORK_BINDING_PREFIX = 'openmusic:client_network_binding:';
export const DEVICE_BINDING_TTL_SEC = 180 * 24 * 60 * 60;
export const GUEST_ACTIVE_BINDING_TTL_SEC = 30 * 24 * 60 * 60;
export const GUEST_INITIAL_BINDING_TTL_SEC = 3 * 24 * 60 * 60;
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

function findFirstOtherKey(iterable, skipKey) {
  for (const candidate of iterable) {
    if (candidate !== skipKey) return candidate;
  }
  return null;
}

function rememberDeviceBinding(deviceId, userId) {
  const did = sanitizeDeviceId(deviceId);
  const uid = sanitizeDeviceId(userId);
  if (!did || !uid) return;

  const previousUser = deviceToUser.get(did);
  if (previousUser && previousUser !== uid) {
    const prevSet = userToDevices.get(previousUser);
    if (prevSet) {
      prevSet.delete(did);
      if (prevSet.size === 0) userToDevices.delete(previousUser);
    }
  }

  deviceToUser.delete(did);
  deviceToUser.set(did, uid);
  let devices = userToDevices.get(uid);
  if (!devices) {
    devices = new Set();
    userToDevices.set(uid, devices);
  }
  devices.delete(did);
  devices.add(did);
  while (devices.size > MAX_DEVICES_PER_USER) {
    const oldest = findFirstOtherKey(devices, did);
    if (!oldest) break;
    devices.delete(oldest);
    deviceToUser.delete(oldest);
  }
  while (deviceToUser.size > MAX_MEMORY_DEVICE_BINDINGS) {
    const oldest = findFirstOtherKey(deviceToUser.keys(), did);
    if (!oldest) break;
    const oldestUser = deviceToUser.get(oldest);
    deviceToUser.delete(oldest);
    if (oldestUser) {
      const oldestSet = userToDevices.get(oldestUser);
      if (oldestSet) {
        oldestSet.delete(oldest);
        if (oldestSet.size === 0) userToDevices.delete(oldestUser);
      }
    }
  }
}

async function persistDeviceBinding(deviceId, userId, ttlSec = DEVICE_BINDING_TTL_SEC) {
  const client = getRedisClient();
  if (!client) {
    console.error('Redis: 不可用，设备身份绑定未持久化');
    return false;
  }

  const did = sanitizeDeviceId(deviceId);
  const uid = sanitizeDeviceId(userId);
  if (!did || !uid) return false;
  const normalizedTtlSec = Math.max(60, Math.min(DEVICE_BINDING_TTL_SEC, Math.floor(Number(ttlSec) || DEVICE_BINDING_TTL_SEC)));

  try {
    await evalRedisScript(client, `
      local previous = redis.call('GET', KEYS[1])
      if previous and previous ~= ARGV[2] then redis.call('SREM', ARGV[4] .. previous, ARGV[1]) end
      redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
      redis.call('SREM', KEYS[2], ARGV[1])
      local excess = redis.call('SCARD', KEYS[2]) - 19
      if excess > 0 then
        local old = redis.call('SPOP', KEYS[2], math.min(excess, 100))
        for _, id in ipairs(old) do
          local key = ARGV[5] .. id
          if redis.call('GET', key) == ARGV[2] then redis.call('DEL', key) end
        end
      end
      redis.call('SADD', KEYS[2], ARGV[1])
      local currentSetTtl = redis.call('TTL', KEYS[2])
      local targetTtl = tonumber(ARGV[3])
      if currentSetTtl > targetTtl then targetTtl = currentSetTtl end
      redis.call('EXPIRE', KEYS[2], targetTtl)
      return 1
    `, { keys: [`${DEVICE_USER_PREFIX}${did}`, `${USER_DEVICES_PREFIX}${uid}`], arguments: [did, uid, String(normalizedTtlSec), USER_DEVICES_PREFIX, DEVICE_USER_PREFIX] });
    return true;
  } catch (err) {
    console.error('Redis: 保存设备身份绑定失败:', err.message);
    return false;
  }
}

/** 绑定设备与账号；同一设备始终映射到同一 userId（直至被新账号覆盖绑定） */
export async function linkDeviceToUser(deviceId, userId, options = {}) {
  const did = sanitizeDeviceId(deviceId);
  const uid = sanitizeDeviceId(userId);
  if (!did || !uid) return false;

  const ttlSec = options && typeof options === 'object' && Number.isFinite(Number(options.ttlSec))
    ? Number(options.ttlSec)
    : DEVICE_BINDING_TTL_SEC;
  if (!await persistDeviceBinding(did, uid, ttlSec)) return false;
  rememberDeviceBinding(did, uid);
  return true;
}

export async function getUserIdForDevice(deviceId, { authoritative = false, renewTtlSec = 0 } = {}) {
  const did = sanitizeDeviceId(deviceId);
  if (!did) return null;

  const cached = deviceToUser.get(did);
  if (cached && !authoritative) return cached;

  const client = getRedisClient();
  if (!isRedisEnabled() || !client) throw new Error('设备身份存储暂不可用');
  const normalizedRenew = Number.isFinite(Number(renewTtlSec)) && Number(renewTtlSec) > 0
    ? Math.max(60, Math.min(DEVICE_BINDING_TTL_SEC, Math.floor(Number(renewTtlSec))))
    : 0;

  try {
    const uid = await evalRedisScript(client, `
      local owner = redis.call('GET', KEYS[1])
      if owner then
        local renew = tonumber(ARGV[1])
        local fallbackTtl = tonumber(ARGV[3])
        local setKey = ARGV[2] .. owner
        if renew > 0 then
          local devTtl = redis.call('TTL', KEYS[1])
          if devTtl < 0 or devTtl < renew then redis.call('EXPIRE', KEYS[1], renew) end
          local setTtl = redis.call('TTL', setKey)
          if setTtl < 0 or setTtl < renew then redis.call('EXPIRE', setKey, renew) end
        else
          if redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], fallbackTtl) end
          if redis.call('TTL', setKey) == -1 then redis.call('EXPIRE', setKey, fallbackTtl) end
        end
      end
      return owner
    `, { keys: [`${DEVICE_USER_PREFIX}${did}`], arguments: [String(normalizedRenew), USER_DEVICES_PREFIX, String(GUEST_ACTIVE_BINDING_TTL_SEC)] });
    const normalized = sanitizeDeviceId(uid);
    if (normalized) {
      rememberDeviceBinding(did, normalized);
      return normalized;
    }
  } catch (err) {
    console.error('Redis: 读取设备身份绑定失败:', err.message);
    throw new Error('设备身份存储暂不可用');
  }
  return null;
}

export async function unlinkDevice(deviceId) {
  const did = sanitizeDeviceId(deviceId);
  if (!did) return false;

  const previousUser = deviceToUser.get(did);
  if (previousUser) {
    deviceToUser.delete(did);
    const prevSet = userToDevices.get(previousUser);
    if (prevSet) {
      prevSet.delete(did);
      if (prevSet.size === 0) userToDevices.delete(previousUser);
    }
  }

  const client = getRedisClient();
  if (!isRedisEnabled() || !client) return false;
  try {
    await evalRedisScript(client, `
      local owner = redis.call('GET', KEYS[1])
      redis.call('DEL', KEYS[1])
      if owner and owner ~= '' then
        local setKey = ARGV[2] .. owner
        redis.call('SREM', setKey, ARGV[1])
        if redis.call('SCARD', setKey) == 0 then redis.call('DEL', setKey) end
        redis.call('DEL', ARGV[3] .. owner .. ':' .. ARGV[1])
      end
      return 1
    `, { keys: [`${DEVICE_USER_PREFIX}${did}`], arguments: [did, USER_DEVICES_PREFIX, NETWORK_BINDING_PREFIX] });
    return true;
  } catch (err) {
    console.error('Redis: 解绑设备身份失败:', err.message);
    return false;
  }
}

export async function unlinkAllDevicesForUser(userId) {
  const uid = sanitizeDeviceId(userId);
  if (!uid) return 0;

  const localSet = userToDevices.get(uid);
  if (localSet) {
    for (const did of localSet) {
      if (deviceToUser.get(did) === uid) deviceToUser.delete(did);
    }
    userToDevices.delete(uid);
  }

  const client = getRedisClient();
  if (!isRedisEnabled() || !client) return 0;
  try {
    return Number(await evalRedisScript(client, `
      local members = redis.call('SMEMBERS', KEYS[1])
      local removed = 0
      for _, did in ipairs(members) do
        local devKey = ARGV[2] .. did
        if redis.call('GET', devKey) == ARGV[1] then
          removed = removed + redis.call('DEL', devKey)
        end
        redis.call('DEL', ARGV[3] .. ARGV[1] .. ':' .. did)
      end
      redis.call('DEL', KEYS[1])
      return removed
    `, { keys: [`${USER_DEVICES_PREFIX}${uid}`], arguments: [uid, DEVICE_USER_PREFIX, NETWORK_BINDING_PREFIX] }));
  } catch (err) {
    console.error('Redis: 清理用户全部设备绑定失败:', err.message);
    return 0;
  }
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
