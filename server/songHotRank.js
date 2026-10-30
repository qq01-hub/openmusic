import { evalRedisScript } from './redisScripts.js';
import { getRedisClient } from './roomStorage.js';

const HOT_ZSET_KEY = 'openmusic:song_hot';
const HOT_META_HASH = 'openmusic:song_hot:meta';
const MAX_HOT_ITEMS = 200;
const DEFAULT_LIMIT = 30;
let metadataCursor = '0';
let metadataPruneAt = 0;
let metadataPruning = false;
let metadataPending = [];
let metadataPruneInflight = null;

const RECORD_PLAY = `
redis.call('ZINCRBY', KEYS[1], 1, ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
local excess = redis.call('ZCARD', KEYS[1]) - 200
if excess > 0 then
  local old = redis.call('ZRANGE', KEYS[1], 0, math.min(excess, 200) - 1)
  for _, id in ipairs(old) do redis.call('ZREM', KEYS[1], id); redis.call('HDEL', KEYS[2], id) end
end
return 1
`;

export function pruneHotRankMetadata(client) {
  if (metadataPruneInflight) return metadataPruneInflight;
  metadataPruneInflight = runPruneHotRankMetadata(client).finally(() => { metadataPruneInflight = null; });
  return metadataPruneInflight;
}

async function runPruneHotRankMetadata(client) {
  const rankedRemoved = Number(await evalRedisScript(client, `
    local excess = redis.call('ZCARD', KEYS[1]) - 200
    if excess <= 0 then return 0 end
    local old = redis.call('ZRANGE', KEYS[1], 0, math.min(excess, 200) - 1)
    for _, id in ipairs(old) do redis.call('ZREM', KEYS[1], id); redis.call('HDEL', KEYS[2], id) end
    return #old
  `, { keys: [HOT_ZSET_KEY, HOT_META_HASH], arguments: [] }));
  if (!metadataPending.length) {
    const page = await client.hScan(HOT_META_HASH, metadataCursor, { COUNT: 100 });
    metadataCursor = String(page.cursor);
    metadataPending = page.entries.map(entry => entry.field);
  }
  const batch = metadataPending.splice(0, 100);
  if (!batch.length) return rankedRemoved;
  const metadataRemoved = Number(await evalRedisScript(client, `
    local removed = 0
    for _, id in ipairs(cjson.decode(ARGV[1])) do
      if not redis.call('ZSCORE', KEYS[1], id) then removed = removed + redis.call('HDEL', KEYS[2], id) end
    end
    return removed
  `, { keys: [HOT_ZSET_KEY, HOT_META_HASH], arguments: [JSON.stringify(batch)] }));
  return rankedRemoved + metadataRemoved;
}


/**
 * 内存兜底（无 Redis 时使用）。
 * @type {Map<string, { count: number; id: string; source: string; name: string; artist: string; album?: string; pic?: string; duration?: number; lastPlayedAt: number }>}
 */
const memoryHot = new Map();

function songHotKey(source, id) {
  return `${source || 'netease'}:${id}`;
}

function buildMeta(song) {
  return {
    id: String(song.id),
    source: song.source || 'netease',
    name: song.name,
    artist: song.artist || '未知歌手',
    album: song.album || undefined,
    pic: song.pic || undefined,
    duration: song.duration || undefined,
    lastPlayedAt: Date.now(),
  };
}

function recordSongPlayMemory(song) {
  const key = songHotKey(song.source, song.id);
  const meta = buildMeta(song);
  const existing = memoryHot.get(key);
  if (existing) {
    existing.count += 1;
    Object.assign(existing, meta);
  } else {
    memoryHot.set(key, { ...meta, count: 1 });
  }
  if (memoryHot.size > MAX_HOT_ITEMS) {
    const oldest = [...memoryHot.entries()].sort((a, b) => a[1].count - b[1].count || a[1].lastPlayedAt - b[1].lastPlayedAt)[0];
    memoryHot.delete(oldest[0]);
  }
}

/** 仅记录用户主动点播且实际播完的歌曲，排名与元数据在同一脚本内淘汰 */
export async function recordSongPlay(song) {
  if (!song?.id || !song?.name) return;
  const client = getRedisClient();
  if (!client) { recordSongPlayMemory(song); return; }
  try {
    await evalRedisScript(client, RECORD_PLAY, { keys: [HOT_ZSET_KEY, HOT_META_HASH], arguments: [songHotKey(song.source, song.id), JSON.stringify(buildMeta(song))] });
    if (!metadataPruning && Date.now() - metadataPruneAt >= 60000) {
      metadataPruning = true; metadataPruneAt = Date.now();
      void pruneHotRankMetadata(client).catch(error => console.error('平台热榜旧元数据清理失败:', error.message)).finally(() => { metadataPruning = false; });
    }
  } catch (error) {
    console.error('平台热榜记录失败:', error.message);
    recordSongPlayMemory(song);
  }
}

export async function getHotSongs(limit = DEFAULT_LIMIT) {
  const n = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), 100);
  const client = getRedisClient();

  if (client) {
    try {
      const entries = await client.zRangeWithScores(HOT_ZSET_KEY, 0, n - 1, { REV: true });
      if (entries.length === 0) return getHotSongsFromMemory(n);

      const keys = entries.map((entry) => entry.value);
      const rawMetas = await client.hmGet(HOT_META_HASH, keys);

      return entries
        .map((entry, i) => {
          let meta = null;
          try {
            meta = rawMetas[i] ? JSON.parse(rawMetas[i]) : null;
          } catch {
            meta = null;
          }
          if (!meta?.id || !meta?.name) return null;
          return {
            id: meta.id,
            source: meta.source || 'netease',
            name: meta.name,
            artist: meta.artist || '未知歌手',
            album: meta.album,
            pic: meta.pic,
            duration: meta.duration,
            count: Math.round(Number(entry.score) || 0),
            lastPlayedAt: meta.lastPlayedAt,
          };
        })
        .filter(Boolean);
    } catch (err) {
      console.error('平台热榜读取失败:', err.message);
      return getHotSongsFromMemory(n);
    }
  }

  return getHotSongsFromMemory(n);
}

function getHotSongsFromMemory(n) {
  return Array.from(memoryHot.values())
    .sort((a, b) => b.count - a.count || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, n)
    .map(({ count, ...song }) => ({ ...song, count }));
}
