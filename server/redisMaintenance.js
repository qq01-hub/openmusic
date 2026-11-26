import { evalRedisScript } from './redisScripts.js';
import { createLogger, incrementMetric } from './logger.js';
import { pruneHotRankMetadata } from './songHotRank.js';
import { DEVICE_BINDING_TTL_SEC, GUEST_ACTIVE_BINDING_TTL_SEC } from './deviceIdentity.js';
import { CLIENT_NETWORK_BINDING_TTL_SEC, GUEST_CLIENT_NETWORK_BINDING_TTL_SEC } from './clientIpBinding.js';

const INTERVAL_MS = 60_000;
const BATCH_SIZE = 50;
const ORPHAN_REPORT_GRACE_MS = 24 * 60 * 60 * 1000;
const RESOLVED_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FULL_KEYSPACE_SCAN_COOLDOWN_MS = 30 * 60 * 1000;
const REPORT_IDS = 'openmusic:error_reports:ids';
const REPORT_SUMMARIES = 'openmusic:error_reports:summaries';
const REPORT_PREFIX = 'openmusic:error_reports:';
const ROOM_IDS = 'openmusic:room_ids';
const ACCOUNT_ROOMS_PREFIX = 'openmusic:account:rooms:';
const DEVICE_PREFIX = 'openmusic:device:';
const USER_DEVICES_PREFIX = 'openmusic:user_devices:';
const CLIENT_NETWORK_BINDING_PREFIX = 'openmusic:client_network_binding:';
const ACCOUNT_ROOM_IDENTITY_PREFIX = 'openmusic:account:room-identity:';
const FAVORITES_PREFIX = 'openmusic:favorites:';
const log = createLogger('redis-maintenance');

const PRUNE_REPORTS = `
local idsType = redis.call('TYPE', KEYS[1]).ok
local summariesType = redis.call('TYPE', KEYS[2]).ok
if idsType ~= 'none' and idsType ~= 'list' then return 0 end
if summariesType ~= 'none' and summariesType ~= 'hash' then return 0 end
local active = {}
for _, id in ipairs(redis.call('LRANGE', KEYS[1], 0, 99)) do active[id] = true end
redis.call('LTRIM', KEYS[1], 0, 99)
local removed = 0
local orphanBefore = tonumber(ARGV[1])
local resolvedBefore = tonumber(ARGV[2])
for index = 3, #KEYS do
  local id = string.sub(KEYS[index], string.len('openmusic:error_reports:') + 1)
  if redis.call('TYPE', KEYS[index]).ok == 'string'
    and redis.call('STRLEN', KEYS[index]) <= 262144 then
    local raw = redis.call('GET', KEYS[index])
    local ok, report = pcall(cjson.decode, raw)
    if ok and type(report) == 'table' and report.id == id then
      local createdAt = tonumber(report.createdAt)
      local resolvedAt = tonumber(report.resolvedAt) or createdAt
      local pruneOrphan = (not active[id]) and createdAt and createdAt > 0 and orphanBefore and createdAt <= orphanBefore
      local pruneResolved = report.status == 'resolved' and resolvedAt and resolvedAt > 0 and resolvedBefore and resolvedAt <= resolvedBefore
      if pruneOrphan or pruneResolved then
        removed = removed + redis.call('UNLINK', KEYS[index])
        if active[id] then redis.call('LREM', KEYS[1], 0, id) end
        redis.call('HDEL', KEYS[2], id)
      end
    end
  end
end
return removed
`;

const PRUNE_SUMMARIES = `
local idsType = redis.call('TYPE', KEYS[1]).ok
local summariesType = redis.call('TYPE', KEYS[2]).ok
if idsType ~= 'none' and idsType ~= 'list' then return 0 end
if summariesType ~= 'none' and summariesType ~= 'hash' then return 0 end
local active = {}
for _, id in ipairs(redis.call('LRANGE', KEYS[1], 0, 99)) do active[id] = true end
local removed = 0
for _, id in ipairs(cjson.decode(ARGV[1])) do
  if not active[id] or redis.call('EXISTS', 'openmusic:error_reports:' .. id) == 0 then
    removed = removed + redis.call('HDEL', KEYS[2], id)
  end
end
return removed
`;

const PRUNE_ROOM_INDEX = `
local indexType = redis.call('TYPE', KEYS[1]).ok
if indexType ~= 'none' and indexType ~= 'set' then return 0 end
local removed = 0
for index, id in ipairs(cjson.decode(ARGV[1])) do
  if redis.call('EXISTS', KEYS[index + 1]) == 0 then
    removed = removed + redis.call('SREM', KEYS[1], id)
  end
end
return removed
`;

const REPAIR_DEVICE_KEYS = `
local repaired = 0
local guestTtl = tonumber(ARGV[1])
local accountTtl = tonumber(ARGV[2])
local userDevicesPrefix = ARGV[3]
local accountIdentityPrefix = ARGV[4]
local favoritesPrefix = ARGV[5]
for index = 1, #KEYS do
  local key = KEYS[index]
  if redis.call('TTL', key) == -1 and redis.call('TYPE', key).ok == 'string' then
    local owner = redis.call('GET', key)
    if owner and owner ~= '' then
      local hasDurableOwner = redis.call('EXISTS', accountIdentityPrefix .. owner) == 1
        or redis.call('EXISTS', favoritesPrefix .. owner) == 1
      local targetTtl = hasDurableOwner and accountTtl or guestTtl
      redis.call('EXPIRE', key, targetTtl)
      local setKey = userDevicesPrefix .. owner
      if redis.call('TTL', setKey) == -1 then
        redis.call('EXPIRE', setKey, targetTtl)
      end
      repaired = repaired + 1
    else
      redis.call('UNLINK', key)
      repaired = repaired + 1
    end
  end
end
return repaired
`;

const PRUNE_USER_DEVICES = `
local affected = 0
local guestTtl = tonumber(ARGV[1])
local accountTtl = tonumber(ARGV[2])
local devicePrefix = ARGV[3]
local userDevicesPrefix = ARGV[4]
local accountIdentityPrefix = ARGV[5]
local favoritesPrefix = ARGV[6]
local prefixLen = string.len(userDevicesPrefix)
for index = 1, #KEYS do
  local key = KEYS[index]
  if redis.call('TYPE', key).ok == 'set' then
    local uid = string.sub(key, prefixLen + 1)
    local members = redis.call('SMEMBERS', key)
    local stale = 0
    for _, did in ipairs(members) do
      if redis.call('GET', devicePrefix .. did) ~= uid then
        stale = stale + redis.call('SREM', key, did)
      end
    end
    if redis.call('SCARD', key) == 0 then
      redis.call('UNLINK', key)
      affected = affected + math.max(1, stale)
    else
      affected = affected + stale
      if redis.call('TTL', key) == -1 then
        local hasDurableOwner = redis.call('EXISTS', accountIdentityPrefix .. uid) == 1
          or redis.call('EXISTS', favoritesPrefix .. uid) == 1
        redis.call('EXPIRE', key, hasDurableOwner and accountTtl or guestTtl)
        affected = affected + 1
      end
    end
  end
end
return affected
`;

const PRUNE_CLIENT_NETWORK_BINDINGS = `
local affected = 0
local guestTtl = tonumber(ARGV[1])
local accountTtl = tonumber(ARGV[2])
local bindingPrefix = ARGV[3]
local devicePrefix = ARGV[4]
local accountIdentityPrefix = ARGV[5]
local prefixLen = string.len(bindingPrefix)
for index = 1, #KEYS do
  local key = KEYS[index]
  if redis.call('TYPE', key).ok == 'string' then
    local suffix = string.sub(key, prefixLen + 1)
    local sep = string.find(suffix, ':', 1, true)
    if not sep then
      affected = affected + redis.call('UNLINK', key)
    else
      local uid = string.sub(suffix, 1, sep - 1)
      local did = string.sub(suffix, sep + 1)
      local isAccount = redis.call('EXISTS', accountIdentityPrefix .. uid) == 1
      if (not isAccount) and redis.call('EXISTS', devicePrefix .. did) == 0 then
        affected = affected + redis.call('UNLINK', key)
      elseif redis.call('TTL', key) == -1 then
        redis.call('EXPIRE', key, isAccount and accountTtl or guestTtl)
        affected = affected + 1
      end
    end
  end
end
return affected
`;

function scanState() {
  return { cursor: '0', pending: [], nextCycleAt: 0 };
}

async function readBatch(state, read, limit = BATCH_SIZE, options = {}) {
  const cooldownMs = Math.max(0, Number(options.cooldownMs) || 0);
  const nowMs = typeof options.now === 'function' ? options.now() : Date.now();
  if (!state.pending.length) {
    if (cooldownMs > 0 && state.cursor === '0' && state.nextCycleAt > nowMs) {
      return [];
    }
    const page = await read(state.cursor);
    state.cursor = String(page.cursor);
    state.pending = page.items;
    if (cooldownMs > 0 && state.cursor === '0') {
      state.nextCycleAt = nowMs + cooldownMs;
    }
  }
  // COUNT 仅是扫描提示，超量页留到后续轮次处理，单次删除仍有硬上限
  return state.pending.splice(0, limit);
}

export function createRedisMaintenance({ getClient, isRoomKnown = () => false, now = () => Date.now() }) {
  const reportScan = scanState();
  const summaryScan = scanState();
  const roomScan = scanState();
  const accountScan = scanState();
  const deviceScan = scanState();
  const userDeviceScan = scanState();
  const networkBindingScan = scanState();
  let accountMembers = null;
  let inflight = null;
  let timer = null;

  async function pruneRoomIndex(client, key, state) {
    const ids = await readBatch(state, async cursor => {
      const page = await client.sScan(key, cursor, { COUNT: BATCH_SIZE });
      return { cursor: page.cursor, items: page.members };
    });
    const staleCandidates = ids.filter(id => /^[A-Z0-9_-]{4,64}$/.test(id) && !isRoomKnown(id));
    if (!staleCandidates.length) return 0;
    return Number(await evalRedisScript(client, PRUNE_ROOM_INDEX, {
      keys: [key, ...staleCandidates.map(id => `openmusic:room:${id}`)],
      arguments: [JSON.stringify(staleCandidates)],
    }));
  }

  async function sweep(client) {
    const stats = { reports: 0, summaries: 0, roomIndexes: 0, hotRank: 0, devices: 0, userDevices: 0, networkBindings: 0 };
    const reportKeys = await readBatch(reportScan, async cursor => {
      const page = await client.scan(cursor, { MATCH: `${REPORT_PREFIX}*`, TYPE: 'string', COUNT: BATCH_SIZE });
      return { cursor: page.cursor, items: page.keys };
    }, BATCH_SIZE, { cooldownMs: FULL_KEYSPACE_SCAN_COOLDOWN_MS, now });
    const candidates = reportKeys.filter(key => /^[a-z0-9]{14}$/.test(key.slice(REPORT_PREFIX.length)));
    stats.reports = Number(await evalRedisScript(client, PRUNE_REPORTS, {
      keys: [REPORT_IDS, REPORT_SUMMARIES, ...candidates],
      arguments: [String(now() - ORPHAN_REPORT_GRACE_MS), String(now() - RESOLVED_REPORT_RETENTION_MS)],
    }));
    const summaryIds = await readBatch(summaryScan, async cursor => {
      const page = await client.hScan(REPORT_SUMMARIES, cursor, { COUNT: BATCH_SIZE });
      return { cursor: page.cursor, items: page.entries.map(entry => entry.field) };
    });
    if (summaryIds.length) {
      stats.summaries = Number(await evalRedisScript(client, PRUNE_SUMMARIES, {
        keys: [REPORT_IDS, REPORT_SUMMARIES], arguments: [JSON.stringify(summaryIds)],
      }));
    }
    stats.roomIndexes += await pruneRoomIndex(client, ROOM_IDS, roomScan);
    for (let index = 0; index < 5; index++) {
      if (!accountMembers) {
        const [key] = await readBatch(accountScan, async cursor => {
          const page = await client.scan(cursor, { MATCH: `${ACCOUNT_ROOMS_PREFIX}*`, TYPE: 'set', COUNT: BATCH_SIZE });
          return { cursor: page.cursor, items: page.keys };
        }, 1, { cooldownMs: FULL_KEYSPACE_SCAN_COOLDOWN_MS, now });
        if (!key) break;
        accountMembers = { key, ...scanState() };
      }
      stats.roomIndexes += await pruneRoomIndex(client, accountMembers.key, accountMembers);
      if (accountMembers.cursor === '0' && !accountMembers.pending.length) accountMembers = null;
    }
    stats.hotRank = await pruneHotRankMetadata(client);
    const deviceKeys = await readBatch(deviceScan, async cursor => {
      const page = await client.scan(cursor, { MATCH: `${DEVICE_PREFIX}*`, TYPE: 'string', COUNT: BATCH_SIZE });
      return { cursor: page.cursor, items: page.keys };
    }, BATCH_SIZE, { cooldownMs: FULL_KEYSPACE_SCAN_COOLDOWN_MS, now });
    if (deviceKeys.length) {
      stats.devices = Number(await evalRedisScript(client, REPAIR_DEVICE_KEYS, {
        keys: deviceKeys,
        arguments: [
          String(GUEST_ACTIVE_BINDING_TTL_SEC),
          String(DEVICE_BINDING_TTL_SEC),
          USER_DEVICES_PREFIX,
          ACCOUNT_ROOM_IDENTITY_PREFIX,
          FAVORITES_PREFIX,
        ],
      }));
    }
    const userDeviceKeys = await readBatch(userDeviceScan, async cursor => {
      const page = await client.scan(cursor, { MATCH: `${USER_DEVICES_PREFIX}*`, TYPE: 'set', COUNT: BATCH_SIZE });
      return { cursor: page.cursor, items: page.keys };
    }, BATCH_SIZE, { cooldownMs: FULL_KEYSPACE_SCAN_COOLDOWN_MS, now });
    if (userDeviceKeys.length) {
      stats.userDevices = Number(await evalRedisScript(client, PRUNE_USER_DEVICES, {
        keys: userDeviceKeys,
        arguments: [
          String(GUEST_ACTIVE_BINDING_TTL_SEC),
          String(DEVICE_BINDING_TTL_SEC),
          DEVICE_PREFIX,
          USER_DEVICES_PREFIX,
          ACCOUNT_ROOM_IDENTITY_PREFIX,
          FAVORITES_PREFIX,
        ],
      }));
    }
    const networkBindingKeys = await readBatch(networkBindingScan, async cursor => {
      const page = await client.scan(cursor, { MATCH: `${CLIENT_NETWORK_BINDING_PREFIX}*`, TYPE: 'string', COUNT: BATCH_SIZE });
      return { cursor: page.cursor, items: page.keys };
    }, BATCH_SIZE, { cooldownMs: FULL_KEYSPACE_SCAN_COOLDOWN_MS, now });
    if (networkBindingKeys.length) {
      stats.networkBindings = Number(await evalRedisScript(client, PRUNE_CLIENT_NETWORK_BINDINGS, {
        keys: networkBindingKeys,
        arguments: [
          String(GUEST_CLIENT_NETWORK_BINDING_TTL_SEC),
          String(CLIENT_NETWORK_BINDING_TTL_SEC),
          CLIENT_NETWORK_BINDING_PREFIX,
          DEVICE_PREFIX,
          ACCOUNT_ROOM_IDENTITY_PREFIX,
        ],
      }));
    }
    for (const [kind, count] of Object.entries(stats)) {
      for (let index = 0; index < count; index++) incrementMetric('redis_maintenance_removed_total', { kind });
    }
    incrementMetric('redis_maintenance_runs_total');
    if (Object.values(stats).some(count => count > 0)) log.info('redis_maintenance_pruned', stats);
    return stats;
  }

  function runOnce() {
    if (inflight) return inflight;
    const client = getClient();
    if (!client || client.isReady === false) return Promise.resolve(null);
    inflight = sweep(client).catch(error => {
      incrementMetric('redis_error_total', { phase: 'maintenance' });
      log.error('redis_maintenance_failed', { error });
      return null;
    }).finally(() => { inflight = null; });
    return inflight;
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => { void runOnce(); }, INTERVAL_MS);
      timer.unref?.();
      void runOnce();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      return inflight || Promise.resolve();
    },
  };
}
