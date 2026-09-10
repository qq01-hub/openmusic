import { decryptRoomSecrets, encryptRoomSecrets } from './roomCredentialCrypto.js';
import { randomBytes } from 'node:crypto';
import { createLogger, incrementMetric } from './logger.js';

const ROOM_IDS_KEY = 'openmusic:room_ids';
const roomKey = (id) => `openmusic:room:${id}`;
const log = createLogger('room-storage');

let redisClient = null;
let enabled = false;
const pendingRoomWrites = new Map();
let roomWriteFlushScheduled = false;

function parseRedisDb(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function getRedisConnectionOptions(env = process.env) {
  const url = String(env.REDIS_URL || '').trim();
  const host = String(env.REDIS_HOST || '').trim();

  if (!url && !host) return null;

  const username = String(env.REDIS_USERNAME || '').trim();
  const password = String(env.REDIS_PASSWORD || '').trim();
  const database = parseRedisDb(env.REDIS_DB);

  if (url) {
    const options = { url };
    if (username) options.username = username;
    if (password) options.password = password;
    if (database !== undefined) options.database = database;
    return options;
  }

  const port = parseInt(env.REDIS_PORT || '6379', 10) || 6379;
  const options = {
    socket: { host, port },
  };
  if (username) options.username = username;
  if (password) options.password = password;
  if (database !== undefined) options.database = database;
  return options;
}

function describeRedisTarget(options) {
  if (options.url) {
    try {
      const parsed = new URL(options.url);
      const db = options.database ?? (parsed.pathname?.replace(/^\//, '') || '0');
      return `${parsed.hostname}:${parsed.port || 6379} db=${db}`;
    } catch {
      return 'REDIS_URL';
    }
  }
  const host = options.socket?.host || 'localhost';
  const port = options.socket?.port || 6379;
  const db = options.database ?? 0;
  return `${host}:${port} db=${db}`;
}

export function isRedisEnabled() {
  return enabled;
}

export function getRedisClient() {
  return enabled ? redisClient : null;
}

/** .env 中是否配置了 Redis 连接（未配置视为首次部署，进入安装向导） */
export function hasRedisEnvConfig() {
  return Boolean(
    (process.env.REDIS_URL || '').trim()
    || (process.env.REDIS_HOST || '').trim(),
  );
}

export async function initRoomStorage() {
  if (redisClient?.isOpen) return enabled;
  if (redisClient) {
    redisClient = null;
    enabled = false;
  }

  const options = getRedisConnectionOptions();
  if (!options) {
    log.info('redis_not_configured');
    return false;
  }

  try {
    const { createClient } = await import('redis');
    redisClient = createClient(options);
    redisClient.on('error', (err) => {
      incrementMetric('redis_error_total', { phase: 'runtime' });
      log.error('redis_runtime_error', { error: err });
    });
    await redisClient.connect();
    enabled = true;
    log.info('redis_connected', { target: describeRedisTarget(options) });
    return true;
  } catch (err) {
    incrementMetric('redis_error_total', { phase: 'connect' });
    log.error('redis_connect_failed', { error: err });
    redisClient = null;
    enabled = false;
    return false;
  }
}

export async function loadAllRoomsFromStorage() {
  if (!enabled || !redisClient) return [];

  const ids = await redisClient.sMembers(ROOM_IDS_KEY);
  const rooms = [];

  for (const id of ids) {
    try {
      const raw = await redisClient.get(roomKey(id));
      if (!raw) continue;
      const room = JSON.parse(raw);
      room.musicAccountSecrets = decryptRoomSecrets(room.musicAccountSecrets, room.id);
      rooms.push(room);
    } catch (err) {
      incrementMetric('redis_error_total', { phase: 'load_room' });
      log.warn('redis_room_payload_invalid', { roomId: id, error: err });
    }
  }

  return rooms;
}

export async function saveRoomToStorage(roomSnapshot) {
  if (!enabled || !redisClient) return;

  try {
    const persisted = {
      ...roomSnapshot,
      musicAccountSecrets: encryptRoomSecrets(roomSnapshot.musicAccountSecrets, roomSnapshot.id),
    };
    const payload = JSON.stringify(persisted);
    await redisClient.set(roomKey(roomSnapshot.id), payload);
    await redisClient.sAdd(ROOM_IDS_KEY, roomSnapshot.id);
  } catch (err) {
    incrementMetric('redis_error_total', { phase: 'save_room' });
    log.error('redis_save_room_failed', { roomId: roomSnapshot.id, error: err });
  }
}

/** 异步持久化，避免 JSON 序列化阻塞 HTTP / Socket 热路径 */
export function queueSaveRoomToStorage(roomSnapshot) {
  if (!enabled || !redisClient) return;

  const id = String(roomSnapshot?.id || '').trim().toUpperCase();
  if (!id) return;
  // 同一事件循环内只保留每个房间最新快照，避免播放/队列事件叠加 Redis 写入。
  pendingRoomWrites.set(id, { ...roomSnapshot, id });
  if (roomWriteFlushScheduled) return;
  scheduleRoomWriteFlush();
}

function scheduleRoomWriteFlush() {
  roomWriteFlushScheduled = true;
  setImmediate(() => {
    roomWriteFlushScheduled = false;
    const snapshots = [...pendingRoomWrites.values()];
    pendingRoomWrites.clear();
    for (const snapshot of snapshots) void saveRoomToStorage(snapshot);
    if (pendingRoomWrites.size > 0) scheduleRoomWriteFlush();
  });
}

export async function deleteRoomFromStorage(roomId) {
  if (!enabled || !redisClient) return;

  try {
    await redisClient.del(roomKey(roomId));
    await redisClient.sRem(ROOM_IDS_KEY, roomId);
  } catch (err) {
    incrementMetric('redis_error_total', { phase: 'delete_room' });
    log.error('redis_delete_room_failed', { roomId, error: err });
  }
}

const FAVORITES_PREFIX = 'openmusic:favorites:';
const MAX_FAVORITES = 5000;
const FAVORITES_CAS_RETRIES = 8;
const FAVORITE_SHARE_PREFIX = 'openmusic:favorite-share:';
const FAVORITE_SHARE_OWNER_PREFIX = 'openmusic:favorite-share-owner:';
const FAVORITE_SHARE_CODE_LENGTH = 8;
const FAVORITE_SHARE_VERSION = 2;
const FAVORITES_CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == '0' then
  if current then return 0 end
elseif not current or current ~= ARGV[2] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[3])
return 1
`;

function favoriteKey(userId) {
  return `${FAVORITES_PREFIX}${userId}`;
}

function songFavoriteId(song) {
  return `${song?.source || 'netease'}:${song?.id || ''}`;
}

function normalizeFavoriteSong(song) {
  if (!song || typeof song !== 'object') return null;
  const id = String(song.id || '').trim();
  const source = String(song.source || 'netease').trim();
  const name = String(song.name || '').trim();
  const artist = String(song.artist || '').trim();
  if (!id || !source || !name) return null;
  return {
    id,
    source,
    name,
    artist,
    album: String(song.album || '').trim(),
    pic: String(song.pic || '').trim(),
    duration: Number.isFinite(Number(song.duration)) ? Number(song.duration) : undefined,
    url: song.url ? String(song.url) : undefined,
    lrc: song.lrc ? String(song.lrc) : undefined,
    favoritedAt: Date.now(),
  };
}

function parseFavorites(raw) {
  if (!raw) return [];
  try {
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function readFavoritesSnapshot(userId) {
  if (!enabled || !redisClient) return [];
  const raw = await redisClient.get(favoriteKey(userId));
  return { raw, items: parseFavorites(raw) };
}

async function readFavorites(userId) {
  const snapshot = await readFavoritesSnapshot(userId);
  return Array.isArray(snapshot) ? snapshot : snapshot.items;
}

function capFavorites(items) {
  return items.slice(0, MAX_FAVORITES);
}

async function compareAndSwapFavorites(userId, expectedRaw, items) {
  if (!enabled || !redisClient) throw new Error('Redis 不可用，收藏无法保存');
  const result = await redisClient.eval(FAVORITES_CAS_SCRIPT, {
    keys: [favoriteKey(userId)],
    arguments: [
      expectedRaw === null ? '0' : '1',
      expectedRaw || '',
      JSON.stringify(capFavorites(items)),
    ],
  });
  return Number(result) === 1;
}

async function mutateFavoritesAtomically(userId, update) {
  if (!enabled || !redisClient) throw new Error('Redis 不可用，收藏无法保存');
  for (let attempt = 0; attempt < FAVORITES_CAS_RETRIES; attempt += 1) {
    const snapshot = await readFavoritesSnapshot(userId);
    const mutation = update(snapshot.items);
    const items = capFavorites(mutation.items);
    if (await compareAndSwapFavorites(userId, snapshot.raw, items)) {
      return { ...mutation, items };
    }
  }
  const error = new Error('收藏状态已被并发修改，请重试');
  error.code = 'FAVORITES_CONFLICT';
  throw error;
}

export async function listFavoriteSongs(userId) {
  const id = String(userId || '').trim();
  if (!id) return [];
  return readFavorites(id);
}

export async function setFavoriteSong(userId, song, favorite) {
  const id = String(userId || '').trim();
  const clean = normalizeFavoriteSong(song);
  if (!id || !clean) return { error: '收藏歌曲无效' };

  try {
    const mutation = await mutateFavoritesAtomically(id, (items) => {
      const favId = songFavoriteId(clean);
      const exists = items.some((item) => songFavoriteId(item) === favId);
      let next = items;
      if (favorite && !exists) {
        next = [clean, ...items];
      } else if (!favorite && exists) {
        next = items.filter((item) => songFavoriteId(item) !== favId);
      }
      return { items: next };
    });
    return { favorites: mutation.items, favorite: Boolean(favorite) };
  } catch (err) {
    return { error: err.message || '收藏保存失败' };
  }
}

function favoriteShareKey(code) {
  return `${FAVORITE_SHARE_PREFIX}${code}`;
}

function favoriteShareOwnerKey(userId) {
  return `${FAVORITE_SHARE_OWNER_PREFIX}${userId}`;
}

function normalizeFavoriteShareCode(code) {
  return String(code || '').trim().toUpperCase();
}

function createFavoriteShareCode() {
  return randomBytes(8).toString('hex').slice(0, FAVORITE_SHARE_CODE_LENGTH).toUpperCase();
}

/**
 * 解析永久分享码引用。旧版分享码保存的是歌曲快照，由 previewFavoriteShare
 * 继续按旧格式读取，直到它自然过期；新版只保存分享者身份，读取时实时取收藏。
 */
export function parseFavoriteShareReference(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const userId = String(value?.userId || '').trim();
    return value?.version === FAVORITE_SHARE_VERSION && userId ? { userId } : null;
  } catch {
    return null;
  }
}

async function getExistingFavoriteShareCode(userId) {
  const code = normalizeFavoriteShareCode(await redisClient.get(favoriteShareOwnerKey(userId)));
  if (!/^[A-Z0-9]{8}$/.test(code)) return null;
  const reference = parseFavoriteShareReference(await redisClient.get(favoriteShareKey(code)));
  return reference?.userId === userId ? code : null;
}

export async function createFavoriteShare(userId) {
  const id = String(userId || '').trim();
  if (!id) return { error: '用户身份无效' };
  if (!enabled || !redisClient) return { error: 'Redis 不可用，分享码无法创建' };

  const existing = await getExistingFavoriteShareCode(id);
  if (existing) {
    const favorites = await listFavoriteSongs(id);
    return { code: existing, count: favorites.length };
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createFavoriteShareCode();
    const reference = JSON.stringify({ version: FAVORITE_SHARE_VERSION, userId: id });
    const created = await redisClient.set(favoriteShareKey(code), reference, { NX: true });
    if (created !== 'OK') continue;

    const ownerSet = await redisClient.set(favoriteShareOwnerKey(id), code, { NX: true });
    if (ownerSet === 'OK') {
      const favorites = await listFavoriteSongs(id);
      return { code, count: favorites.length };
    }

    // 另一个并发请求先完成了该用户的创建；删除本次未被引用的随机码。
    await redisClient.del(favoriteShareKey(code));
    const winner = await getExistingFavoriteShareCode(id);
    if (winner) {
      const favorites = await listFavoriteSongs(id);
      return { code: winner, count: favorites.length };
    }
  }
  return { error: '分享码创建失败，请重试' };
}

export async function previewFavoriteShare(code) {
  const normalized = normalizeFavoriteShareCode(code);
  if (!/^[A-Z0-9]{8}$/.test(normalized) || !enabled || !redisClient) return { error: '分享码无效' };
  const raw = await redisClient.get(favoriteShareKey(normalized));
  const reference = parseFavoriteShareReference(raw);
  if (reference) {
    return { code: normalized, songs: await listFavoriteSongs(reference.userId) };
  }

  // 兼容此前的七天歌曲快照，避免已发出的旧链接立刻失效。
  const songs = parseFavorites(raw);
  if (!songs.length) return { error: '分享码无效或已过期' };
  return { code: normalized, songs };
}

export async function importFavoriteShare(userId, code, selectedIds) {
  const preview = await previewFavoriteShare(code);
  if (preview.error) return preview;
  if (!Array.isArray(selectedIds) || selectedIds.length === 0 || selectedIds.length > 1000) return { error: '请选择要导入的歌曲' };
  const selected = new Set(selectedIds.map((id) => String(id || '').trim()).filter(Boolean));
  const songs = preview.songs.filter((song) => selected.has(songFavoriteId(song)) || selected.has(`${song.source || 'netease'}-${song.id}`));
  if (!songs.length) return { error: '没有可导入的歌曲' };
  return importFavoriteSongs(userId, songs);
}

export async function importFavoriteSongs(userId, songs) {
  const id = String(userId || '').trim();
  if (!id) return { error: '用户身份无效' };
  if (!Array.isArray(songs)) return { error: '收藏数据格式无效' };

  const imported = songs.map(normalizeFavoriteSong).filter(Boolean);
  if (imported.length === 0) return { error: '没有可导入的歌曲' };

  try {
    const mutation = await mutateFavoritesAtomically(id, (items) => {
      // 已有收藏优先保留：导入只填补剩余容量，不能静默挤掉用户旧收藏。
      const current = capFavorites(items);
      const seen = new Set(current.map(songFavoriteId));
      const candidates = [];

      for (const song of imported) {
        const favId = songFavoriteId(song);
        if (seen.has(favId)) continue;
        seen.add(favId);
        candidates.push(song);
      }

      const accepted = candidates.slice(0, Math.max(0, MAX_FAVORITES - current.length));
      return {
        items: [...accepted, ...current],
        imported: accepted.length,
        dropped: candidates.length - accepted.length,
      };
    });
    return {
      favorites: mutation.items,
      imported: mutation.imported,
      dropped: mutation.dropped,
      maxFavorites: MAX_FAVORITES,
    };
  } catch (err) {
    return { error: err.message || '收藏保存失败' };
  }
}
