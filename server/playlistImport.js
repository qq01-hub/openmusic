import { fetchMetingApi } from './metingUpstream.js';

const NETEASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com/',
};

const QQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://y.qq.com/',
};

const PLAYLIST_META_CACHE_TTL_MS = 30 * 60 * 1000;
const PLAYLIST_META_CACHE_MAX = 256;
const neteasePlaylistMetaCache = new Map();
const neteasePlaylistMetaInflight = new Map();
const qqPlaylistMetaCache = new Map();
const qqPlaylistMetaInflight = new Map();

function readMetaCache(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeMetaCache(cache, key, value) {
  if (!value) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + PLAYLIST_META_CACHE_TTL_MS });
  while (cache.size > PLAYLIST_META_CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
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

function extractUrlFromText(input) {
  const text = String(input || '').trim();
  const match = text.match(/https?:\/\/[^\s\u4e00-\u9fff「」]+/i);
  return match ? match[0].replace(/[.,;，。；)）\]]+$/, '') : text;
}

export function parseNeteasePlaylistId(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^\d{4,}$/.test(text)) return text;

  const url = extractUrlFromText(text);
  if (!/music\.163\.com|y\.music\.163\.com/i.test(url)) return null;

  const idMatch = url.match(/[?&]id=(\d+)/i) || url.match(/playlist\/(\d+)/i);
  return idMatch ? idMatch[1] : null;
}

export function parseQqPlaylistId(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^\d{4,}$/.test(text)) return text;

  const url = extractUrlFromText(text);
  if (!/\.qq\.com/i.test(url)) return null;

  // QQ 分享到 QQ / 我的电脑：i2.y.qq.com/.../details/playlist.html?...&id=歌单ID
  // 以 id= 为准；兼容旧版 playlist/songlist 路径与 dissid
  const idMatch = url.match(/[?&]id=(\d{4,})/i)
    || url.match(/[?&]dissid=(\d{4,})/i)
    || url.match(/\/playlist\/(\d{4,})/i)
    || url.match(/\/songlist\/(\d{4,})/i);
  if (!idMatch) return null;

  const looksLikePlaylist = /playlist|songlist|details|taoge|diss/i.test(url)
    || /[?&](?:id|dissid)=\d{4,}/i.test(url);
  if (!looksLikePlaylist) return null;

  return idMatch[1];
}

/** @deprecated 使用 parseQqPlaylistId */
export function parseQqPlaylistUrl(input) {
  const id = parseQqPlaylistId(input);
  return id ? String(input).trim() : null;
}

function extractIdFromApiUrl(url) {
  const match = String(url || '').match(/[?&]id=([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

export function parseKugouPlaylistId(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^\d{4,}$/.test(text) || /^collection_\d+_\d+_\d+_\d+$/.test(text)) return text;
  const url = extractUrlFromText(text);
  if (!/kugou\.com/i.test(url)) return null;

  // Meting accepts Kugou gcid share links as the playlist id; do not reduce them to a numeric id.
  if (/\/songlist\/gcid_[a-z0-9_-]+\/?(?:[?#]|$)/i.test(url)) return url;

  const match = url.match(/[?&](?:global_collection_id|specialid|id)=(\d{4,})/i)
    || url.match(/\/(?:special|playlist|collection)\/(?:single\/)?(\d{4,})/i);
  return match ? match[1] : null;
}

export function parseQishuiPlaylistId(input) {
  const text = String(input || '').trim();
  if (/^\d{4,}$/.test(text) || /^collection_\d+_\d+_\d+_\d+$/.test(text)) return text;
  const url = extractUrlFromText(text);
  const match = url.match(/[?&](?:playlist_id|id)=(\d{4,})/i) || url.match(/playlist[\/_-](\d{4,})/i);
  return match ? match[1] : null;
}

function normalizeMetingPlaylistSong(raw, source) {
  if (!raw || typeof raw !== 'object') return null;

  const id = extractIdFromApiUrl(raw.url) || String(raw.id || raw.mid || '').trim();
  if (!id) return null;
  const duration = Number(raw.duration ?? raw.dt);

  return {
    id,
    source,
    name: String(raw.title || raw.name || '未知歌曲'),
    artist: String(raw.author || raw.artist || '未知歌手'),
    album: String(raw.album || ''),
    pic: String(raw.pic || raw.cover || ''),
    duration: Number.isFinite(duration) && duration > 0
      ? Math.round(source === 'netease' || source === 'tencent' ? duration : duration * 1000)
      : undefined,
    lrc: raw.lrc ? String(raw.lrc) : undefined,
  };
}

async function fetchNeteasePlaylistMeta(playlistId) {
  const key = String(playlistId || '').trim();
  if (!key) return null;
  const cached = readMetaCache(neteasePlaylistMetaCache, key);
  if (cached) return cached;
  const pending = neteasePlaylistMetaInflight.get(key);
  if (pending) return pending;

  const request = (async () => {
  try {
    const response = await fetchWithTimeout(
      `https://music.163.com/api/playlist/detail?id=${encodeURIComponent(key)}`,
      { headers: NETEASE_HEADERS },
      6000,
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data.code !== 200 || !data.result) return null;
    const result = data.result;
    const meta = {
      id: String(result.id || key),
      name: String(result.name || '未命名歌单'),
      coverImgUrl: String(result.coverImgUrl || result.picUrl || ''),
      creatorName: String(result.creator?.nickname || ''),
      trackCount: Number(result.trackCount || 0),
      playCount: Number(result.playCount || 0),
    };
    writeMetaCache(neteasePlaylistMetaCache, key, meta);
    return meta;
  } catch {
    return null;
  }
  })().finally(() => {
    neteasePlaylistMetaInflight.delete(key);
  });

  neteasePlaylistMetaInflight.set(key, request);
  return request;
}

async function fetchNeteasePlaylistName(playlistId) {
  const meta = await fetchNeteasePlaylistMeta(playlistId);
  return meta?.name || null;
}

export async function fetchNeteasePlaylistMetas(playlistIds) {
  const unique = [...new Set(playlistIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 12);
  const settled = await Promise.all(
    unique.map(async (id) => {
      let meta = await fetchNeteasePlaylistMeta(id);
      if (!meta) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        meta = await fetchNeteasePlaylistMeta(id);
      }
      return meta;
    }),
  );
  return settled.filter(Boolean);
}

async function fetchQqPlaylistMeta(playlistId) {
  const key = String(playlistId || '').trim();
  if (!key) return null;
  const cached = readMetaCache(qqPlaylistMetaCache, key);
  if (cached) return cached;
  const pending = qqPlaylistMetaInflight.get(key);
  if (pending) return pending;

  const request = (async () => {
  try {
    const params = new URLSearchParams({
      type: '1',
      json: '1',
      utf8: '1',
      onlysong: '0',
      disstid: key,
      format: 'json',
      platform: 'yqq',
      needNewCode: '0',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      notice: '0',
      g_tk: '5381',
      loginUin: '0',
      hostUin: '0',
    });
    const response = await fetchWithTimeout(
      `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${params.toString()}`,
      { headers: QQ_HEADERS },
      6000,
    );
    if (!response.ok) return null;

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // 部分节点会用 jsonCallback(...) 包裹，兜底提取内层 JSON。
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      data = JSON.parse(match[0]);
    }

    const cd = Array.isArray(data?.cdlist) ? data.cdlist[0] : null;
    if (!cd) return null;

    const name = String(cd.dissname || '').trim();
    const meta = {
      id: String(cd.disstid || key),
      name: name || null,
      coverImgUrl: String(cd.logo || '').trim(),
      creatorName: String(cd.nickname || cd.nick || '').trim(),
      trackCount: Number(cd.songnum || cd.total_song_num || 0),
      playCount: Number(cd.visitnum || 0),
    };
    writeMetaCache(qqPlaylistMetaCache, key, meta);
    return meta;
  } catch {
    return null;
  }
  })().finally(() => {
    qqPlaylistMetaInflight.delete(key);
  });

  qqPlaylistMetaInflight.set(key, request);
  return request;
}

async function fetchQqPlaylistName(playlistId) {
  const meta = await fetchQqPlaylistMeta(playlistId);
  return meta?.name || null;
}

async function fetchPlaylistSearchMeta(server, playlistId) {
  try {
    const response = await fetchMetingApi(
      { server, type: 'search_playlist', id: playlistId },
      { headers: NETEASE_HEADERS },
      10000,
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data)) return null;

    const normalizedId = String(playlistId || '').trim();
    const exact = data.find((item) => String(item?.id || '').trim() === normalizedId);
    const item = exact || data[0];
    if (!item || typeof item !== 'object') return null;

    const name = String(item.name || item.title || item.dissname || item.specialname || '').trim();
    return name ? { name } : null;
  } catch {
    return null;
  }
}

async function fetchMetingPlaylist(server, playlistId, { retries = 1 } = {}) {
  try {
    const response = await fetchMetingApi(
      { server, type: 'playlist', id: playlistId },
      { headers: NETEASE_HEADERS },
      60000,
    );
    if (!response.ok) throw new Error('歌单请求失败');

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(typeof data?.error === 'string' ? data.error : '歌单数据格式异常');
    }
    return data;
  } catch (err) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return fetchMetingPlaylist(server, playlistId, { retries: retries - 1 });
    }
    throw err;
  }
}

async function importMetingPlaylist(server, playlistId, defaultName) {
  // 酷狗/汽水先走 search_playlist 获取歌单元数据，再查询 playlist 歌曲详情。
  const meta = ['kugou', 'qishui'].includes(server)
    ? await fetchPlaylistSearchMeta(server, playlistId)
    : null;
  const tracks = await fetchMetingPlaylist(server, playlistId);
  const playlistName = meta?.name || defaultName;

  if (tracks.length === 0) {
    return {
      name: playlistName,
      playlistId,
      source: server === 'netease' ? 'netease' : server === 'qishui' ? 'qishui' : server === 'kugou' ? 'kugou' : 'tencent',
      songs: [],
      total: 0,
      failed: 0,
    };
  }

  const songs = tracks
    .map((track) => normalizeMetingPlaylistSong(track, server === 'netease' ? 'netease' : server === 'qishui' ? 'qishui' : server === 'kugou' ? 'kugou' : 'tencent'))
    .filter(Boolean);

  return {
    name: playlistName,
    playlistId,
    source: server === 'netease' ? 'netease' : server === 'qishui' ? 'qishui' : server === 'kugou' ? 'kugou' : 'tencent',
    songs,
    total: tracks.length,
    failed: tracks.length - songs.length,
  };
}

export async function importNeteasePlaylist(input) {
  const playlistId = parseNeteasePlaylistId(input);
  if (!playlistId) throw new Error('无法识别网易歌单链接，请粘贴完整分享链接');

  const [result, name] = await Promise.all([
    importMetingPlaylist('netease', playlistId, '网易歌单'),
    fetchNeteasePlaylistName(playlistId),
  ]);

  if (name) result.name = name;
  return result;
}

export async function importQqPlaylist(input) {
  const playlistId = parseQqPlaylistId(input);
  if (!playlistId) {
    throw new Error(
      '无法识别 QQ 歌单链接。请在 QQ 音乐将歌单分享到「QQ / 我的电脑」，粘贴带 id= 的链接（例如 …playlist.html?…&id=9211556467）',
    );
  }

  try {
    const [result, name] = await Promise.all([
      importMetingPlaylist('tencent', playlistId, 'QQ歌单'),
      fetchQqPlaylistName(playlistId),
    ]);

    if (name) result.name = name;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('无法识别')) throw err;
    throw new Error('歌单解析失败，请检查歌单链接是否正确');
  }
}

export async function importQishuiPlaylist(input) {
  const playlistId = parseQishuiPlaylistId(input);
  if (!playlistId) throw new Error('无法识别汽水歌单 ID 或分享链接');
  return importMetingPlaylist('qishui', playlistId, '汽水歌单');
}

export async function importKugouPlaylist(input) {
  const playlistId = parseKugouPlaylistId(input);
  if (!playlistId) throw new Error('无法识别酷狗歌单 ID 或分享链接');
  return importMetingPlaylist('kugou', playlistId, '酷狗歌单');
}
