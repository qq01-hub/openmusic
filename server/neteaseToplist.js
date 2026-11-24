import { getRedisClient } from './roomStorage.js';

const HOT_TOPLIST_ID = '3778678';
const TOPLIST_URL = `https://music.163.com/discover/toplist?id=${HOT_TOPLIST_ID}`;
const REDIS_CACHE_KEY = 'openmusic:netease:toplist:hot';
/** 东八区对齐的 24 小时窗口，热榜按「每天一清」（北京时间 0 点换桶） */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const NETEASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com/',
  Accept: 'text/html,application/xhtml+xml',
};

/** @type {{ bucket: string; data: { id: string; name: string; songs: object[] } } | null} */
let memoryCache = null;
/** @type {Promise<{ id: string; name: string; songs: object[] }> | null} */
let inflight = null;

/** 东八区时间轴上的 24 小时桶键（按自然日） */
function chinaBucketKey(now = Date.now()) {
  const shifted = now + TZ_OFFSET_MS;
  return String(Math.floor(shifted / CACHE_TTL_MS));
}

/** 距下一个东八区日界（0 点）的秒数（至少 60s，避免边界抖动） */
function secondsUntilNextChinaBucket(now = Date.now()) {
  const shifted = now + TZ_OFFSET_MS;
  const nextBoundary = (Math.floor(shifted / CACHE_TTL_MS) + 1) * CACHE_TTL_MS;
  return Math.max(60, Math.ceil((nextBoundary - shifted) / 1000));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripCoverParam(url) {
  const raw = String(url || '').trim();
  if (!raw || !/param=\d+y\d+/i.test(raw)) return raw || undefined;
  try {
    const parsed = new URL(raw);
    parsed.searchParams.delete('param');
    return parsed.toString();
  } catch {
    return raw
      .replace(/([?&])param=\d+y\d+/gi, '$1')
      .replace(/\?&/, '?')
      .replace(/[?&]$/, '')
      .replace(/\?$/, '') || undefined;
  }
}

function normalizeNeteaseToplistSong(raw) {
  if (!raw || raw.id == null) return null;
  const artists = Array.isArray(raw.artists) ? raw.artists : [];
  return {
    id: String(raw.id),
    source: 'netease',
    name: String(raw.name || '未知歌曲'),
    artist: artists.map((a) => a?.name).filter(Boolean).join(' / ') || '未知歌手',
    album: raw.album?.name || undefined,
    // 不带 ?param=NyN，避免热榜封面加载失败
    pic: stripCoverParam(raw.album?.picUrl) || undefined,
    duration: typeof raw.duration === 'number' ? raw.duration : undefined,
  };
}

function parseTitle(html) {
  const match = html.match(/<h2 class="f-ff2">([^<]+)<\/h2>/i);
  const raw = match?.[1]?.trim() || '';
  const sanitized = raw
    .replace(/网易云?音乐?/g, '')
    .replace(/QQ\s*音乐?/gi, '')
    .replace(/酷狗音乐?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || '热榜';
}

function parseFromTextarea(html) {
  const match = html.match(/id="song-list-pre-data"[^>]*>([\s\S]*?)<\/textarea>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return null;
    return parsed.map(normalizeNeteaseToplistSong).filter(Boolean);
  } catch {
    return null;
  }
}

function parseFromHiddenList(html) {
  const blockMatch = html.match(/id="song-list-pre-cache"[\s\S]*?<ul class="f-hide">([\s\S]*?)<\/ul>/i);
  if (!blockMatch) return [];
  const items = [...blockMatch[1].matchAll(/<a href="\/song\?id=(\d+)">([^<]*)<\/a>/gi)];
  return items.map((m) => ({
    id: m[1],
    source: 'netease',
    name: m[2]?.trim() || '未知歌曲',
    artist: '未知歌手',
  }));
}

function parseToplistHtml(html) {
  const fromTextarea = parseFromTextarea(html);
  if (fromTextarea?.length) return fromTextarea;
  return parseFromHiddenList(html);
}

function sliceToplist(data, limit) {
  const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 200;
  return {
    ...data,
    songs: Array.isArray(data.songs) ? data.songs.slice(0, n) : [],
  };
}

function parseCachedPayload(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    // 兼容旧「按日」缓存：无 bucket 或 bucket 不匹配则视为过期
    if (parsed.bucket !== chinaBucketKey()) return null;
    if (!parsed.data || !Array.isArray(parsed.data.songs) || parsed.data.songs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readRedisCache() {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get(REDIS_CACHE_KEY);
    return parseCachedPayload(raw);
  } catch (err) {
    console.error('网易云热榜 Redis 读取失败:', err.message);
    return null;
  }
}

async function writeRedisCache(bucket, data) {
  const client = getRedisClient();
  if (!client) return;
  const ttlSec = secondsUntilNextChinaBucket();
  const payload = JSON.stringify({ bucket, data, cachedAt: Date.now() });
  try {
    await client.set(REDIS_CACHE_KEY, payload, { EX: ttlSec });
  } catch (err) {
    console.error('网易云热榜 Redis 写入失败:', err.message);
  }
}

async function fetchFreshToplist() {
  const res = await fetchWithTimeout(TOPLIST_URL, { headers: NETEASE_HEADERS });
  if (!res.ok) {
    await res.body?.cancel?.().catch(() => {});
    throw new Error(`热榜请求失败 (${res.status})`);
  }

  const html = await res.text();
  const songs = parseToplistHtml(html);
  if (songs.length === 0) throw new Error('未能解析热榜歌曲');

  return {
    id: HOT_TOPLIST_ID,
    name: parseTitle(html),
    songs,
  };
}

async function loadToplistCached() {
  const bucket = chinaBucketKey();

  if (memoryCache?.bucket === bucket && memoryCache.data?.songs?.length) {
    return memoryCache.data;
  }

  const fromRedis = await readRedisCache();
  if (fromRedis) {
    memoryCache = fromRedis;
    return fromRedis.data;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const data = await fetchFreshToplist();
    memoryCache = { bucket, data };
    await writeRedisCache(bucket, data);
    return data;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export async function fetchNeteaseHotToplist(limit = 200) {
  const data = await loadToplistCached();
  return sliceToplist(data, limit);
}
