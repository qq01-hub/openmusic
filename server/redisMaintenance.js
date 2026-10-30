import { evalRedisScript } from './redisScripts.js';
import { createLogger, incrementMetric } from './logger.js';
import { pruneHotRankMetadata } from './songHotRank.js';

const INTERVAL_MS = 60_000;
const BATCH_SIZE = 50;
const ORPHAN_REPORT_GRACE_MS = 24 * 60 * 60 * 1000;
const REPORT_IDS = 'openmusic:error_reports:ids';
const REPORT_SUMMARIES = 'openmusic:error_reports:summaries';
const REPORT_PREFIX = 'openmusic:error_reports:';
const ROOM_IDS = 'openmusic:room_ids';
const ACCOUNT_ROOMS_PREFIX = 'openmusic:account:rooms:';
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
for index = 3, #KEYS do
  local id = string.sub(KEYS[index], string.len('openmusic:error_reports:') + 1)
  if not active[id] and redis.call('TYPE', KEYS[index]).ok == 'string'
    and redis.call('STRLEN', KEYS[index]) <= 262144 then
    local raw = redis.call('GET', KEYS[index])
    local ok, report = pcall(cjson.decode, raw)
    if ok and type(report) == 'table' and report.id == id then
      local createdAt = tonumber(report.createdAt)
      if createdAt and createdAt > 0 and createdAt <= tonumber(ARGV[1]) then
        removed = removed + redis.call('UNLINK', KEYS[index])
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

function scanState() {
  return { cursor: '0', pending: [] };
}

async function readBatch(state, read, limit = BATCH_SIZE) {
  if (!state.pending.length) {
    const page = await read(state.cursor);
    state.cursor = String(page.cursor);
    state.pending = page.items;
  }
  // COUNT 仅是扫描提示，超量页留到后续轮次处理，单次删除仍有硬上限
  return state.pending.splice(0, limit);
}

export function createRedisMaintenance({ getClient, isRoomKnown = () => false, now = () => Date.now() }) {
  const reportScan = scanState();
  const summaryScan = scanState();
  const roomScan = scanState();
  const accountScan = scanState();
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
    const stats = { reports: 0, summaries: 0, roomIndexes: 0, hotRank: 0 };
    const reportKeys = await readBatch(reportScan, async cursor => {
      const page = await client.scan(cursor, { MATCH: `${REPORT_PREFIX}*`, TYPE: 'string', COUNT: BATCH_SIZE });
      return { cursor: page.cursor, items: page.keys };
    });
    const candidates = reportKeys.filter(key => /^[a-z0-9]{14}$/.test(key.slice(REPORT_PREFIX.length)));
    stats.reports = Number(await evalRedisScript(client, PRUNE_REPORTS, {
      keys: [REPORT_IDS, REPORT_SUMMARIES, ...candidates],
      arguments: [String(now() - ORPHAN_REPORT_GRACE_MS)],
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
        }, 1);
        if (!key) break;
        accountMembers = { key, ...scanState() };
      }
      stats.roomIndexes += await pruneRoomIndex(client, accountMembers.key, accountMembers);
      if (accountMembers.cursor === '0' && !accountMembers.pending.length) accountMembers = null;
    }
    stats.hotRank = await pruneHotRankMetadata(client);
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
