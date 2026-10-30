import { formatMetingFetchError } from './metingFetch.js';
import { fetchMetingApi, runWithMetingRequestContext } from './metingUpstream.js';
import { fetchEphemeralFmSong } from './metingAdmin.js';
import { getRuntimeConfig } from './runtimeConfig.js';
import { isMusicSourceEnabled } from './musicSources.js';

export const DEFAULT_FM_MODE = 'DEFAULT';

/** 关闭漫游：队列放空后停止播放，不自动推荐 */
export const FM_MODE_OFF = 'OFF';

const FM_MODES = new Set([
  'DEFAULT',
  'FAMILIAR',
  'EXPLORE',
  'SCENE_RCMD',
  'aidj',
  'SCENE_RCMD:EXERCISE',
  'SCENE_RCMD:FOCUS',
  'SCENE_RCMD:NIGHT_EMO',
  // 汽水 PC feed/song-tab 模式
  'FRESH',
  'SCENE_MODE_ID:2',
  'SCENE_MODE_ID:3',
  'SCENE_MODE_ID:5',
  'SCENE_MODE_ID:40',
  'SCENE_MODE_ID:21',
  'SCENE_MODE_ID:18',
  FM_MODE_OFF,
]);

export function normalizeFmMode(input) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_FM_MODE;
  if (FM_MODES.has(raw)) return raw;
  return DEFAULT_FM_MODE;
}

export function normalizeFmSource(input) {
  const raw = String(input || '').trim();
  if (raw === 'kugou') return 'kugou';
  if (raw === 'qishui') return 'qishui';
  if (raw === 'tencent') return 'tencent';
  return 'netease';
}

export function buildFmQuery(mode, source = 'netease') {
  const server = normalizeFmSource(source);
  const query = { server, type: 'fm' };
  const normalized = normalizeFmMode(mode);
  // QQ、酷狗只有默认私人漫游；网易 / 汽水通过 id 传模式。
  if (!['tencent', 'kugou'].includes(server) && normalized && normalized !== 'DEFAULT' && normalized !== FM_MODE_OFF) {
    query.id = normalized;
  }
  return query;
}

function extractIdFromUrl(url) {
  try {
    const match = String(url || '').match(/[?&]id=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function extractSongId(item) {
  if (!item || typeof item !== 'object') return '';
  const rawUrl = String(item.url || '').trim();
  const rawId = item.id ?? item.songId ?? item.mid;
  if (rawId !== undefined && rawId !== null && String(rawId).trim()) {
    return String(rawId).trim();
  }
  if (rawUrl && !/^https?:\/\//i.test(rawUrl)) return rawUrl;
  return extractIdFromUrl(rawUrl).trim();
}

function normalizeFmSong(raw, source = 'netease', excludedIds = new Set()) {
  const candidates = Array.isArray(raw)
    ? raw.filter((item) => item && typeof item === 'object')
    : [raw];
  const item = candidates.find((candidate) => {
    const id = extractSongId(candidate);
    return id && !excludedIds.has(id);
  }) || null;
  if (!item || typeof item !== 'object') return null;

  const artist = item.artist ?? item.author;
  const artistStr = Array.isArray(artist)
    ? artist.map((a) => a?.name).filter(Boolean).join(' / ')
    : String(artist || '未知歌手');

  const urlStr = item.url ? String(item.url) : '';
  const id = extractSongId(item);
  const name = String(item.name || item.title || '').trim();
  if (!id || !name) return null;

  const rawDuration = Number(item.duration || item.dt || 0);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0
    ? Math.round(rawDuration < 10_000 ? rawDuration * 1000 : rawDuration)
    : undefined;
  return {
    id,
    source: normalizeFmSource(source),
    name,
    artist: artistStr,
    album: String(item.album || item.album_name || ''),
    pic: String(item.pic || item.cover || item.album_pic || ''),
    duration,
    url: urlStr || undefined,
    lrc: item.lrc ? String(item.lrc) : undefined,
  };
}

function normalizeFmSongs(raw, source = 'netease', excludedIds = new Set()) {
  let payload = raw;
  for (let i = 0; i < 4; i += 1) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) break;
    const next = payload.data ?? payload.songs ?? payload.results ?? payload.list;
    if (next === undefined || next === payload) break;
    payload = next;
  }
  const candidates = Array.isArray(payload) ? payload : [payload];
  const usedIds = new Set(excludedIds);
  const songs = [];
  for (const candidate of candidates) {
    const song = normalizeFmSong(candidate, source, usedIds);
    if (!song) continue;
    usedIds.add(song.id);
    songs.push(song);
  }
  return songs;
}

const MAX_FM_RETRIES = 2;
const FM_RETRY_BACKOFF_MS = 800;
// FM 整体失败后的熔断窗口：空队列的房间会以自动推进节奏反复预取，
// 上游长期不可用时避免每个 tick 都重复请求
const FM_FAILURE_COOLDOWN_MS = 30_000;
const fmFailureCooldowns = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 私人漫游（网易 / QQ / 酷狗 / 汽水）。
 * - 传入 ephemeralCookie（无 VIP 本地账号）：走 Meting /admin/fm，不入库
 * - 私有账号无结果或不可用时走公共 type=fm，使用 Meting 原有 Cookie 池
 * - QQ 仅支持猜你喜欢，无熟悉/探索等模式
 */
export async function fetchMetingFmSongs(fmMode = DEFAULT_FM_MODE, options = {}) {
  if (normalizeFmMode(fmMode) === FM_MODE_OFF) return [];
  const roomId = String(options.roomId || '').trim();
  const roomName = String(options.roomName || '私人漫游');
  let ephemeralCookie = String(options.ephemeralCookie || '').trim();
  const mode = normalizeFmMode(fmMode);
  const source = normalizeFmSource(options.source);
  const onAccountInvalid = typeof options.onAccountInvalid === 'function' ? options.onAccountInvalid : null;
  const cooldownKey = `${roomId}:${source}:${mode}`;
  const now = Date.now();
  for (const [key, until] of fmFailureCooldowns) {
    if (until <= now) fmFailureCooldowns.delete(key);
  }
  const cooldownUntil = fmFailureCooldowns.get(cooldownKey) || 0;
  if (now < cooldownUntil) {
    console.info('Meting FM skipped during cooldown', {
      roomId,
      source,
      mode,
      remainingMs: cooldownUntil - now,
    });
    return [];
  }
  // 已保存的旧房间也必须遵守后台音源开关，避免关闭后仍被空队列预取触发上游请求。
  if (!isMusicSourceEnabled(source, getRuntimeConfig().musicSourcesEnabled)) return [];
  // QQ、酷狗无模式参数；其余平台 DEFAULT 不传 id。
  const modeId = ['tencent', 'kugou'].includes(source) || mode === 'DEFAULT' ? '' : mode;
  const excludedIds = new Set(Array.isArray(options.excludeIds) ? options.excludeIds.map((id) => String(id).trim()).filter(Boolean) : []);
  const currentIds = new Set(options.currentSongId ? [String(options.currentSongId)] : []);
  for (const id of currentIds) excludedIds.add(id);
  const normalizeSongs = (raw) => {
    const songs = normalizeFmSongs(raw, source, excludedIds);
    if (songs.length || source !== 'tencent') return songs;
    // QQ 推荐批次耗尽时只重播最久远的一首，下次重新推荐，始终排除当前曲
    const repeats = new Map(normalizeFmSongs(raw, source, currentIds).map((song) => [song.id, song]));
    for (const id of excludedIds) {
      if (repeats.has(id)) return [repeats.get(id)];
    }
    return [];
  };

  for (let i = 0; i < MAX_FM_RETRIES; i += 1) {
    if (i > 0) await sleep(FM_RETRY_BACKOFF_MS * i);
    try {
      console.info('Meting FM request', {
        roomId,
        source,
        mode,
        attempt: i + 1,
        accountCookie: Boolean(ephemeralCookie),
      });
      if (ephemeralCookie) {
        // QQ 在本层优先挑选未播歌曲，避免上游先排空整批后无法进入下一轮
        const upstreamExcludedIds = source === 'tencent' ? currentIds : excludedIds;
        const result = await fetchEphemeralFmSong(ephemeralCookie, modeId, source, [...upstreamExcludedIds]);
        const songs = result.ok ? normalizeSongs(result.data) : [];
        if (songs.length) {
          fmFailureCooldowns.delete(cooldownKey);
          console.info('Meting FM success', { roomId, source, mode, count: songs.length });
          return songs;
        }

        if (!result.ok) {
          const accountInvalid = result.code === 'MUSIC_ACCOUNT_INVALID'
            || /登录态.*(?:无效|过期)|登录.*(?:失效|过期)|未登录|需要登录|请.*登录|cookie.*(?:无效|失效|过期)|not logged in|login required|cookie.*expired/iu.test(String(result.error || ''));
          if (accountInvalid) ephemeralCookie = '';
          if (onAccountInvalid && accountInvalid) {
            await onAccountInvalid({ status: Number(result.status), code: result.code, error: result.error || '' });
          }
          console.warn('Meting FM account request failed', {
            roomId,
            source,
            mode,
            status: result.status || null,
            code: result.code || null,
            error: result.error || 'empty response',
          });
        }

        // 保留房间日志归因，显式绕过房间私有账号路由
      }

      const response = await runWithMetingRequestContext(
        {
          userId: '',
          userNickname: '系统',
          roomId,
          roomName,
          usePublicMeting: true,
        },
        () => fetchMetingApi(buildFmQuery(fmMode, source), {}, 12000),
      );
      if (!response.ok) {
        let failure;
        try { failure = JSON.parse(await response.text()); } catch { failure = null; }
        console.warn('Meting FM public request failed', {
          roomId,
          source,
          mode,
          status: response.status || null,
          code: failure?.code || null,
          error: failure?.error || `HTTP ${response.status || 0}`,
        });
        continue;
      }

      const text = await response.text();
      if (!text.trim()) continue;

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }

      const songs = normalizeSongs(data);
      if (songs.length) {
        fmFailureCooldowns.delete(cooldownKey);
        console.info('Meting FM success', { roomId, source, mode, count: songs.length });
        return songs;
      }
    } catch (err) {
      console.error('Meting FM error:', { roomId, source, mode, code: err?.code || 'UPSTREAM_REQUEST_FAILED', error: formatMetingFetchError(err) });
    }
  }

  if (fmFailureCooldowns.size >= 2048) fmFailureCooldowns.delete(fmFailureCooldowns.keys().next().value);
  fmFailureCooldowns.set(cooldownKey, Date.now() + FM_FAILURE_COOLDOWN_MS);
  console.info('Meting FM empty or failed', {
    roomId,
    source,
    mode,
    cooldownMs: FM_FAILURE_COOLDOWN_MS,
  });
  console.error(`Meting FM 连续 ${MAX_FM_RETRIES} 次失败，${FM_FAILURE_COOLDOWN_MS / 1000}s 内暂停漫游预取`);
  return [];
}

export async function fetchMetingFmSong(fmMode = DEFAULT_FM_MODE, options = {}) {
  const songs = await fetchMetingFmSongs(fmMode, options);
  return Array.isArray(songs) ? songs[0] || null : null;
}
