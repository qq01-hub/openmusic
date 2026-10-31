import { getAvailableSources, getSongUrlInfo, getTrackKey, searchSongs, unwrapQishuiAudioUrl } from '../api/music';
import { prefetchQishuiLocalPlayback } from './qishuiLocalPlayback';
import { isHttpsPageContext, isProxiedMediaUrl, shouldProxyPlaybackUrl, toProxiedMediaUrl } from './mediaProxyUrl';
import { isIOS } from './audioUnlock';
import { shouldProxySongPlaybackUrl } from './roomVisualPreset';
import { stripApiSignParams } from './signedApiUrl';
import {
  getDowngradedQuality,
  getLowestQuality,
  getUserPlaybackQuality,
} from '../api/music/quality';
import {
  classifySongUrlFetchError,
  classifySongUrlFetchFailure,
  isBlockedPlaybackUrl,
  SourceUnavailableError,
  type PlaybackErrorClass,
} from './audioPlaybackError';
import {
  isPlaybackQualityLockedToLowest,
  lockPlaybackQualityToLowest,
  resetPlaybackQualityLock,
} from './playbackQualityLock';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import type { MusicSource, QueueItem, RoomState, SearchResult } from '../types';
import { isMobileDevice } from './audioUnlock';
import { normalizeDurationMs } from './duration';
import { isHumanCheckPending } from './humanCheckState';

const MAX_URL_CACHE = 24;
const DEFAULT_PREFETCH_COUNT = 2;
// v4: 汽水带 auth 的 audio_mp4 必须保留解密包装地址，淘汰旧版直链缓存。
const URL_CACHE_STORAGE_KEY = 'openmusic:song-url-cache:v4';

export type TrackLoudness = { gain?: number; peak?: number; lra?: number };

type CachedUrlEntry = {
  url: string;
  qualityLabel?: string;
  crossSource?: boolean;
  crossSourceFrom?: MusicSource;
  loudness?: TrackLoudness;
  duration?: number;
};

type FetchUrlResult =
  | { ok: true; url: string; qualityLabel?: string; crossSource?: boolean; crossSourceFrom?: MusicSource; loudness?: TrackLoudness; duration?: number }
  | { ok: false; errorClass: PlaybackErrorClass };

const urlCache = loadUrlCacheFromStorage();
const pendingFetches = new Map<string, Promise<FetchUrlResult>>();
// queueId 会在歌曲重新入队时变化，但同一平台歌曲 ID 的短期播放链仍可复用。
// 只放内存，不持久化，避免把签名地址长期写入 sessionStorage。
const identityUrlCache = new Map<string, { expiresAt: number; entry: CachedUrlEntry }>();
const IDENTITY_URL_CACHE_TTL_MS = 8 * 60_000;
const sourceErrorKeys = new Set<string>();
/** 原平台无链、已用其它平台 URL 兜底成功 */
const crossSourceKeys = new Set<string>();
/** 实际取到音源的平台（网易/QQ/酷狗） */
const crossSourceFromByKey = new Map<string, MusicSource>();
const sourceErrorListeners = new Set<() => void>();
const pendingCrossSourceFallbacks = new Map<string, Promise<CachedUrlEntry | null>>();
const crossSourceCandidateCache = new Map<string, { expiresAt: number; candidates: SearchResult[] }>();
const CROSS_SOURCE_CACHE_TTL_MS = 10 * 60_000;
// 跨源只在可用于兜底的其它平台中搜索，不把汽水再次作为候选源。
const ALL_MUSIC_SOURCES: MusicSource[] = ['netease', 'tencent', 'kugou'];

function notifySourceErrors() {
  sourceErrorListeners.forEach((listener) => listener());
}

export function subscribeSourceErrors(listener: () => void) {
  sourceErrorListeners.add(listener);
  return () => {
    sourceErrorListeners.delete(listener);
  };
}

export function isTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): boolean {
  return sourceErrorKeys.has(trackKeyOf(song));
}

export function isTrackCrossSource(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): boolean {
  return crossSourceKeys.has(trackKeyOf(song));
}

/** 跨源取到音源的平台（网易/QQ/酷狗） */
export function getTrackCrossSourceFrom(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source'>,
): MusicSource | undefined {
  return crossSourceFromByKey.get(trackKeyOf(song));
}

function normalizeMusicSource(value: unknown): MusicSource | undefined {
  if (value === 'netease' || value === 'tencent' || value === 'kugou' || value === 'qishui') return value;
  return undefined;
}

function normalizeLoudness(value: unknown): TrackLoudness | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: TrackLoudness = {};
  for (const key of ['gain', 'peak', 'lra'] as const) {
    const number = Number((value as Record<string, unknown>)[key]);
    if (Number.isFinite(number)) result[key] = number;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeDuration(value: unknown): number | undefined {
  return normalizeDurationMs(value);
}

function markTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const key = trackKeyOf(song);
  const clearedCross = crossSourceKeys.delete(key);
  const clearedFrom = crossSourceFromByKey.delete(key);
  if (sourceErrorKeys.has(key)) {
    if (clearedCross || clearedFrom) notifySourceErrors();
    return;
  }
  sourceErrorKeys.add(key);
  notifySourceErrors();
}

/** 跨源取链成功后打标（含下一曲预取；取链中途不打，一旦成功常显到离队） */
export function markTrackCrossSource(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source'>,
  from?: MusicSource,
) {
  const key = trackKeyOf(song);
  const clearedError = sourceErrorKeys.delete(key);
  const nextFrom = normalizeMusicSource(from);
  const had = crossSourceKeys.has(key);
  const prevFrom = crossSourceFromByKey.get(key);
  if (nextFrom && prevFrom !== nextFrom) {
    crossSourceFromByKey.set(key, nextFrom);
  }
  if (had && !clearedError && (!nextFrom || prevFrom === nextFrom)) return;
  crossSourceKeys.add(key);
  notifySourceErrors();
}

/** 仅清除源异常标，不清除跨源标（跨源一旦确认应保持到曲目离队） */
export function clearTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const key = trackKeyOf(song);
  if (!sourceErrorKeys.delete(key)) return;
  notifySourceErrors();
}

/** 移除已不在播放列表中的源错误/跨源标记，避免 Set 无限增长 */
export function pruneSourceErrors(activeSongs: Array<Pick<QueueItem, 'queueId' | 'id' | 'source'>>) {
  const activeKeys = new Set(activeSongs.map(trackKeyOf));
  let changed = false;
  for (const key of sourceErrorKeys) {
    if (!activeKeys.has(key)) {
      sourceErrorKeys.delete(key);
      changed = true;
    }
  }
  for (const key of crossSourceKeys) {
    if (!activeKeys.has(key)) {
      crossSourceKeys.delete(key);
      crossSourceFromByKey.delete(key);
      changed = true;
    }
  }
  for (const key of crossSourceFromByKey.keys()) {
    if (!activeKeys.has(key)) {
      crossSourceFromByKey.delete(key);
      changed = true;
    }
  }
  if (changed) notifySourceErrors();
}

function loadUrlCacheFromStorage(): Map<string, CachedUrlEntry> {
  try {
    const raw = sessionStorage.getItem(URL_CACHE_STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, CachedUrlEntry | string>;
    const map = new Map<string, CachedUrlEntry>();
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        map.set(key, { url: value });
      } else if (value && typeof value === 'object' && typeof value.url === 'string') {
        map.set(key, {
          url: value.url,
          qualityLabel: typeof value.qualityLabel === 'string' ? value.qualityLabel : undefined,
          crossSource: Boolean(value.crossSource),
          crossSourceFrom: normalizeMusicSource(value.crossSourceFrom),
          loudness: normalizeLoudness(value.loudness),
          duration: normalizeDuration(value.duration),
        });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function persistUrlCacheToStorage() {
  try {
    const entries = [...urlCache.entries()].slice(-MAX_URL_CACHE);
    sessionStorage.setItem(URL_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // sessionStorage may be unavailable.
  }
}

function publishActualQuality(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source'>,
  qualityLabel?: string,
  actualSource?: MusicSource,
) {
  const label = qualityLabel?.trim();
  const source = normalizeMusicSource(actualSource);
  // 无音质时仍允许写入实际平台：跨源取链可能没有 quality，但底栏来源必须跟真实取链平台一致。
  if (!label && !source) return;
  useAudioStore.getState().setActualMedia(trackKeyOf(song), { qualityLabel: label, source });
}

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function songSourceOf(song: Pick<QueueItem, 'source'>): MusicSource {
  return song.source || 'netease';
}

function normalizeMatchText(value: string | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【\[].*?(?:feat\.?|ft\.?|live|伴奏|翻唱|remix).*?[）)】\]]/gi, '')
    .replace(/\b(?:feat\.?|ft\.?)\b.*$/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function durationSeconds(value: number | undefined): number | null {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return duration > 10_000 ? duration / 1000 : duration;
}

function scoreFallbackCandidate(song: QueueItem, candidate: SearchResult): number {
  if (!candidate.id || candidate.source === songSourceOf(song)) return -1;
  const wantedTitle = normalizeMatchText(song.name);
  const candidateTitle = normalizeMatchText(candidate.name);
  if (!wantedTitle || !candidateTitle) return -1;

  let score = 0;
  if (wantedTitle === candidateTitle) score += 70;
  else if (
    Math.min(wantedTitle.length, candidateTitle.length) >= 5
    && (wantedTitle.includes(candidateTitle) || candidateTitle.includes(wantedTitle))
  ) score += 42;
  else return -1;

  const wantedArtist = normalizeMatchText(song.artist);
  const candidateArtist = normalizeMatchText(candidate.artist);
  if (wantedArtist && candidateArtist) {
    if (wantedArtist === candidateArtist) score += 30;
    else if (wantedArtist.includes(candidateArtist) || candidateArtist.includes(wantedArtist)) score += 20;
    else return -1;
  }

  const wantedDuration = durationSeconds(song.duration);
  const candidateDuration = durationSeconds(candidate.duration);
  if (wantedDuration && candidateDuration) {
    const difference = Math.abs(wantedDuration - candidateDuration);
    if (difference > 30) return -1;
    if (difference <= 5) score += 20;
    else if (difference <= 12) score += 12;
  }
  return score;
}

async function findCrossSourceCandidates(song: QueueItem): Promise<SearchResult[]> {
  const enabledSources = await getEnabledCrossSourceIds();
  const cacheKey = `${songSourceOf(song)}:${[...enabledSources].sort().join(',')}:${normalizeMatchText(song.name)}:${normalizeMatchText(song.artist)}`;
  const cached = crossSourceCandidateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.candidates;

  const sources = ALL_MUSIC_SOURCES.filter((source) => source !== songSourceOf(song) && enabledSources.has(source));
  const batches = await Promise.allSettled(sources.map((source) => searchSongs(source, song.name)));
  const candidates = batches.flatMap((batch) => batch.status === 'fulfilled' ? batch.value : [])
    .map((candidate) => ({ candidate, score: scoreFallbackCandidate(song, candidate) }))
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.candidate);

  crossSourceCandidateCache.set(cacheKey, {
    expiresAt: Date.now() + CROSS_SOURCE_CACHE_TTL_MS,
    candidates,
  });
  return candidates;
}

async function getEnabledCrossSourceIds(): Promise<Set<MusicSource>> {
  try {
    const sources = await getAvailableSources();
    const enabled = new Set<MusicSource>(
      sources
        .filter((source) => source.supportsSearch)
        .map((source) => source.id)
        .filter((source): source is MusicSource => ALL_MUSIC_SOURCES.includes(source)),
    );
    // 网易和 QQ 是服务端始终启用的平台；接口异常时仍保留这两个安全候选，
    // 不把未启用的酷狗或汽水加入跨源搜索。
    if (enabled.size > 0) return enabled;
  } catch {
    // fall through to the built-in always-on sources
  }
  return new Set<MusicSource>(['netease', 'tencent']);
}

async function fetchCrossSourceFallback(song: QueueItem): Promise<CachedUrlEntry | null> {
  const key = trackKeyOf(song);
  const pending = pendingCrossSourceFallbacks.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const candidates = await findCrossSourceCandidates(song);
    for (const candidate of candidates) {
      try {
        const quality = getLowestQuality(candidate.source) ?? getUserPlaybackQuality(candidate.source);
        const info = await getSongUrlInfo(candidate, quality);
        if (!info.url || isBlockedPlaybackUrl(info.url)) continue;
        const from = normalizeMusicSource(candidate.source);
        const entry: CachedUrlEntry = {
          url: info.url,
          qualityLabel: info.qualityLabel,
          crossSource: true,
          crossSourceFrom: from,
          loudness: info.loudness,
          duration: info.duration,
        };
        urlCache.set(urlCacheKey(song, getEffectivePlaybackQuality(song)), entry);
        urlCache.set(trackKeyOf(song), entry);
        trimUrlCache();
        // 取链成功即打标（含下一曲预取）；中途未拿到 URL 前不会走到这里
        markTrackCrossSource(song, from);
        publishActualQuality(song, info.qualityLabel, from);
        return entry;
      } catch {
        // 当前候选不可播放时继续尝试下一平台/版本。
      }
    }
    return null;
  })().finally(() => pendingCrossSourceFallbacks.delete(key));

  pendingCrossSourceFallbacks.set(key, promise);
  return promise;
}

function getEffectivePlaybackQuality(song: Pick<QueueItem, 'id' | 'source'>): string | undefined {
  const source = songSourceOf(song);
  if (isPlaybackQualityLockedToLowest()) {
    return getLowestQuality(source) ?? getUserPlaybackQuality(source);
  }
  return getUserPlaybackQuality(source);
}

export function shouldProxyQishuiTrack(
  song: Pick<QueueItem, 'queueId' | 'id'>,
  enabled: boolean,
  percent: number,
): boolean {
  if (!enabled) return false;
  const ratio = Math.min(100, Math.max(0, Math.floor(Number(percent) || 0)));
  if (ratio <= 0) return false;
  if (ratio >= 100) return true;
  const source = `${song.queueId || ''}:${song.id || ''}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < ratio;
}

function songLikelyNeedsPlaybackProxy(song: Pick<QueueItem, 'source' | 'url'>): boolean {
  // 汽水始终本地解密，缓存键不要跟沉浸模式 proxy 标签绑在一起
  if (songSourceOf(song) === 'qishui') return false;
  if (shouldProxySongPlaybackUrl()) return true;
  if (isIOS() && songSourceOf(song) === 'kugou') return true;
  if (!isHttpsPageContext()) return false;
  // 酷狗播放链多为 http://，HTTPS 站点必须走 media-proxy（不可升 https）
  if (songSourceOf(song) === 'kugou') return true;
  return Boolean(song.url?.trim().startsWith('http://'));
}

function urlCacheKey(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  quality?: string,
) {
  const effective = quality ?? getEffectivePlaybackQuality(song);
  const proxyTag = songLikelyNeedsPlaybackProxy(song) ? 'proxy' : 'direct';
  return `${trackKeyOf(song)}:${effective || 'default'}:${proxyTag}`;
}

function identityUrlCacheKey(
  song: Pick<QueueItem, 'id' | 'source' | 'url'>,
  quality?: string,
) {
  const effective = quality ?? getEffectivePlaybackQuality(song);
  const proxyTag = songLikelyNeedsPlaybackProxy(song) ? 'proxy' : 'direct';
  return `${songSourceOf(song)}:${song.id}:${effective || 'default'}:${proxyTag}`;
}

export function clearSongUrlCache() {
  urlCache.clear();
  identityUrlCache.clear();
  pendingFetches.clear();
  resetPlaybackQualityLock();
  try {
    sessionStorage.removeItem(URL_CACHE_STORAGE_KEY);
  } catch {
    // sessionStorage may be unavailable.
  }
}

/** 清除指定曲目的全部 URL 缓存（含 proxy/direct、各音质档） */
export function invalidateTrackUrlCache(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const prefix = trackKeyOf(song);
  let changed = false;

  for (const key of [...urlCache.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}:`)) {
      urlCache.delete(key);
      changed = true;
    }
  }

  for (const key of identityUrlCache.keys()) {
    if (key.startsWith(`${song.source || 'netease'}:${song.id}:`)) identityUrlCache.delete(key);
  }
  if (changed) {
    pendingFetches.clear();
    persistUrlCacheToStorage();
  }
}

/** 切换音质时保留当前已加载曲目，仅让未加载歌曲按新音质重新取链 */
export function invalidateUnloadedSongUrlCache(keepTrackKey?: string | null) {
  const keepKey = keepTrackKey?.trim() || null;

  for (const key of [...urlCache.keys()]) {
    if (keepKey && (key === keepKey || key.startsWith(`${keepKey}:`))) continue;
    urlCache.delete(key);
  }

  pendingFetches.clear();
  identityUrlCache.clear();
  resetPlaybackQualityLock();
  persistUrlCacheToStorage();
}

function trimUrlCache() {
  while (urlCache.size > MAX_URL_CACHE) {
    const oldest = urlCache.keys().next().value;
    if (!oldest) break;
    urlCache.delete(oldest);
  }
  persistUrlCacheToStorage();
}

async function fetchSongUrlOnce(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  quality: string | undefined,
  options: { refresh?: boolean } = {},
): Promise<FetchUrlResult> {
  if (isHumanCheckPending()) return { ok: false, errorClass: 'service' };
  const key = urlCacheKey(song, quality);
  const identityKey = identityUrlCacheKey(song, quality);
  if (options.refresh) {
    urlCache.delete(key);
  } else {
    const shared = identityUrlCache.get(identityKey);
    if (shared) {
      if (shared.expiresAt > Date.now() && !isBlockedPlaybackUrl(shared.entry.url)) {
        return {
          ok: true,
          url: shared.entry.url,
          qualityLabel: shared.entry.qualityLabel,
          crossSource: Boolean(shared.entry.crossSource),
          crossSourceFrom: normalizeMusicSource(shared.entry.crossSourceFrom),
          loudness: shared.entry.loudness,
          duration: shared.entry.duration,
        };
      }
      identityUrlCache.delete(identityKey);
    }
    const cached = urlCache.get(key);
    if (cached) {
      // 旧缓存可能仍是汽水的 /audio/qishui 包装地址；带 auth 的地址必须保留，
      // 由 Meting 解密后再交给浏览器播放。
      const unwrappedCachedUrl = songSourceOf(song) === 'qishui'
        ? unwrapQishuiAudioUrl('qishui', cached.url)
        : cached.url;
      if (unwrappedCachedUrl !== cached.url) {
        cached.url = unwrappedCachedUrl;
        urlCache.set(key, cached);
        persistUrlCacheToStorage();
      }
      // 历史缓存里的网易 outer/url 假直链不可播，丢弃后重新取链
      if (/music\.163\.com\/song\/media\/outer\/url/i.test(cached.url)) {
        urlCache.delete(key);
        persistUrlCacheToStorage();
      } else if (isBlockedPlaybackUrl(cached.url)) {
        urlCache.delete(key);
        persistUrlCacheToStorage();
      } else if (
        !cached.qualityLabel
        && songSourceOf(song) !== 'kugou'
      ) {
        // 旧缓存没有实际音质字段，强制重取以拿到 type=url 的 quality
        urlCache.delete(key);
        persistUrlCacheToStorage();
      } else {
        return {
          ok: true,
          url: cached.url,
          qualityLabel: cached.qualityLabel,
          crossSource: Boolean(cached.crossSource),
          crossSourceFrom: normalizeMusicSource(cached.crossSourceFrom),
          loudness: cached.loudness,
          duration: cached.duration,
        };
      }
    }
  }

  const pendingKey = options.refresh ? `${key}:refresh` : identityKey;
  const pending = pendingFetches.get(pendingKey);
  if (pending) return pending;

  const promise = (async (): Promise<FetchUrlResult> => {
    try {
      let url: string | null = null;
      let qualityLabel: string | undefined;
      let loudness: TrackLoudness | undefined;
      let duration: number | undefined;
      try {
        const info = await getSongUrlInfo({
          id: song.id,
          source: songSourceOf(song),
          url: options.refresh ? undefined : song.url,
        }, quality);
        url = info.url;
        qualityLabel = info.qualityLabel;
        loudness = info.loudness;
        duration = info.duration;
      } catch (error) {
        return { ok: false, errorClass: classifySongUrlFetchError(error) };
      }

      if (!url || isBlockedPlaybackUrl(url)) {
        return { ok: false, errorClass: classifySongUrlFetchFailure(url) };
      }

      const entry = { url, qualityLabel, loudness, duration };
      urlCache.set(key, entry);
      identityUrlCache.set(identityKey, {
        expiresAt: Date.now() + IDENTITY_URL_CACHE_TTL_MS,
        entry,
      });
      while (identityUrlCache.size > MAX_URL_CACHE) {
        const oldest = identityUrlCache.keys().next().value;
        if (!oldest) break;
        identityUrlCache.delete(oldest);
      }
      trimUrlCache();
      return { ok: true, url, qualityLabel, loudness, duration };
    } finally {
      pendingFetches.delete(pendingKey);
    }
  })();

  pendingFetches.set(pendingKey, promise);
  return promise;
}

async function tryLowestQualityFetch(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
): Promise<FetchUrlResult> {
  const source = songSourceOf(song);
  const lowest = getLowestQuality(source);
  if (!lowest) return { ok: false, errorClass: 'service' };

  lockPlaybackQualityToLowest();
  return fetchSongUrlOnce(song, lowest, { refresh: true });
}

async function fetchSongUrl(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  options: { refresh?: boolean; allowQualityDowngrade?: boolean } = {},
): Promise<CachedUrlEntry | null> {
  if (isHumanCheckPending()) return null;
  const source = songSourceOf(song);
  const quality = getEffectivePlaybackQuality(song);
  const lowest = getLowestQuality(source);
  const alreadyAtLowest = Boolean(lowest && quality === lowest);
  const allowQualityDowngrade = options.allowQualityDowngrade !== false;

  // 汽水一旦成功切到其它已启用平台，就锁定跨源链，避免后续刷新再次请求汽水。
  const cachedEntry = urlCache.get(urlCacheKey(song, quality)) || urlCache.get(trackKeyOf(song));
  const qishuiLockedToCrossSource = source === 'qishui'
    && (isTrackCrossSource(song) || Boolean(cachedEntry?.crossSource));
  if (qishuiLockedToCrossSource) {
    if (cachedEntry && !isBlockedPlaybackUrl(cachedEntry.url)) {
      return cachedEntry;
    }
    const crossSourceEntry = await fetchCrossSourceFallback(song as QueueItem);
    if (crossSourceEntry) return crossSourceEntry;
    markTrackSourceError(song);
    return null;
  }

  const first = await fetchSongUrlOnce(song, quality, options);
  if (first.ok) {
    clearTrackSourceError(song);
    // 命中跨源缓存时补打标，避免刷新/重取后标丢失
    if (first.crossSource) markTrackCrossSource(song, first.crossSourceFrom);
    publishActualQuality(song, first.qualityLabel, first.crossSource ? first.crossSourceFrom : songSourceOf(song));
    return {
      url: first.url,
      qualityLabel: first.qualityLabel,
      crossSource: Boolean(first.crossSource),
      crossSourceFrom: first.crossSourceFrom,
      loudness: first.loudness,
      duration: first.duration,
    };
  }

  if (first.errorClass === 'temporary') {
    return null;
  }

  // 播放取链可降档；预取不做降档（避免 lockPlaybackQualityToLowest 影响全屋）
  if (allowQualityDowngrade && source !== 'qishui' && !alreadyAtLowest) {
    const fallback = await tryLowestQualityFetch(song);
    if (fallback.ok) {
      clearTrackSourceError(song);
      if (fallback.crossSource) markTrackCrossSource(song, fallback.crossSourceFrom);
      publishActualQuality(song, fallback.qualityLabel, fallback.crossSource ? fallback.crossSourceFrom : songSourceOf(song));
      return {
        url: fallback.url,
        qualityLabel: fallback.qualityLabel,
        crossSource: Boolean(fallback.crossSource),
        crossSourceFrom: fallback.crossSourceFrom,
        loudness: fallback.loudness,
        duration: fallback.duration,
      };
    }
  }

  const crossSourceEntry = await fetchCrossSourceFallback(song as QueueItem);
  if (crossSourceEntry) return crossSourceEntry;

  // 跨源也失败：打「将跳过」异常标；轮到播放时主控直接 source_error 切歌
  markTrackSourceError(song);
  return null;
}

/** B 类服务错误：按音质阶梯逐级向下尝试（如 hires → lossless → exhigh → standard），仅针对当前单曲，不锁死全局 standard */
export async function fetchServiceFallbackUrl(
  song: QueueItem,
  options: { lockGlobalLowest?: boolean } = {},
): Promise<string | null> {
  if (isHumanCheckPending()) return null;
  const source = songSourceOf(song);
  const quality = getEffectivePlaybackQuality(song);
  const lowest = getLowestQuality(source);

  // 汽水只提供 PC 完整流，当前地址播放失败后直接走跨源，
  // 不再重复请求汽水的低音质或试听地址。
  if (source === 'qishui') {
    return (await fetchCrossSourceFallback(song))?.url || null;
  }

  if (lowest && quality === lowest) {
    // 当前平台最低音质仍触发播放错误时，刷新同一地址意义不大，直接切换平台。
    return (await fetchCrossSourceFallback(song))?.url || null;
  }

  if (options.lockGlobalLowest) {
    const fallback = await tryLowestQualityFetch(song);
    if (fallback.ok) {
      publishActualQuality(song, fallback.qualityLabel, fallback.crossSource ? fallback.crossSourceFrom : songSourceOf(song));
      return fallback.url;
    }
    return (await fetchCrossSourceFallback(song))?.url || null;
  }

  let candidateQuality = quality ? getDowngradedQuality(source, quality) : lowest;
  while (candidateQuality) {
    const step = await fetchSongUrlOnce(song, candidateQuality, { refresh: true });
    if (step.ok && step.url) {
      const entry = {
        url: step.url,
        qualityLabel: step.qualityLabel,
        loudness: step.loudness,
        duration: step.duration,
      };
      urlCache.set(urlCacheKey(song, quality), entry);
      urlCache.set(trackKeyOf(song), entry);
      trimUrlCache();
      publishActualQuality(song, step.qualityLabel, songSourceOf(song));
      return step.url;
    }
    candidateQuality = getDowngradedQuality(source, candidateQuality);
  }

  return (await fetchCrossSourceFallback(song))?.url || null;
}

export function rememberSongUrl(
  trackKey: string,
  url: string,
  qualityLabel?: string,
  crossSource?: boolean,
  crossSourceFrom?: MusicSource,
  loudness?: TrackLoudness,
  duration?: number,
) {
  const existing = urlCache.get(trackKey);
  const from = normalizeMusicSource(crossSourceFrom) || existing?.crossSourceFrom;
  urlCache.set(trackKey, {
    url,
    qualityLabel: qualityLabel?.trim() || existing?.qualityLabel,
    crossSource: crossSource ?? existing?.crossSource,
    crossSourceFrom: from,
    loudness: loudness || existing?.loudness,
    duration: normalizeDuration(duration) || existing?.duration,
  });
  trimUrlCache();
}

/** 缓存中该曲是否为跨源链 */
export function isCachedUrlCrossSource(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
): boolean {
  const key = urlCacheKey(song, getEffectivePlaybackQuality(song));
  const cached = urlCache.get(key) || urlCache.get(trackKeyOf(song));
  return Boolean(cached?.crossSource);
}

export function getCachedUrlCrossSourceFrom(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
): MusicSource | undefined {
  const key = urlCacheKey(song, getEffectivePlaybackQuality(song));
  const cached = urlCache.get(key) || urlCache.get(trackKeyOf(song));
  return normalizeMusicSource(cached?.crossSourceFrom) || getTrackCrossSourceFrom(song);
}

/**
 * 注入房间分享的当前曲播放地址，避免新进房成员重复打上游取链。
 * url 应已去掉本机 API 签名参数；播放前仍会 refreshSignedApiUrl。
 */
export function seedSharedSongUrl(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  entry: { url: string; qualityLabel?: string; crossSource?: boolean; crossSourceFrom?: MusicSource; loudness?: TrackLoudness; duration?: number },
) {
  const raw = unwrapQishuiAudioUrl(songSourceOf(song), String(entry.url || '').trim());
  if (!raw || isBlockedPlaybackUrl(raw)) return false;

  const stripped = stripApiSignParams(raw);
  if (!stripped) return false;

  const qualityLabel = entry.qualityLabel?.trim() || undefined;
  const key = urlCacheKey(song, getEffectivePlaybackQuality(song));
  const crossSource = Boolean(entry.crossSource);
  const crossSourceFrom = normalizeMusicSource(entry.crossSourceFrom);
  const effectiveSource = crossSource ? (crossSourceFrom || songSourceOf(song)) : songSourceOf(song);
  const url = effectiveSource !== 'qishui' && shouldProxyPlaybackUrl(
    stripped,
    shouldProxySongPlaybackUrl() || (isIOS() && effectiveSource === 'kugou'),
  )
    ? toProxiedMediaUrl(stripped)
    : stripped;
  const cached = { url, qualityLabel, crossSource: crossSource || undefined, crossSourceFrom, loudness: normalizeLoudness(entry.loudness), duration: normalizeDuration(entry.duration) };
  urlCache.set(key, cached);
  urlCache.set(trackKeyOf(song), cached);
  identityUrlCache.set(identityUrlCacheKey(song, getEffectivePlaybackQuality(song)), {
    expiresAt: Date.now() + IDENTITY_URL_CACHE_TTL_MS,
    entry: cached,
  });
  trimUrlCache();
  persistUrlCacheToStorage();

  if (crossSource) {
    markTrackCrossSource(song, crossSourceFrom);
  } else if (sourceErrorKeys.delete(trackKeyOf(song))) {
    notifySourceErrors();
  }
  publishActualQuality(song, qualityLabel, crossSource ? crossSourceFrom : songSourceOf(song));
  return true;
}

/** 若分享的 media 对应当前曲，写入本机 URL 缓存 */
export function applySharedPlaybackMedia(
  room: Pick<RoomState, 'current'> | null | undefined,
  media: {
    trackId?: string;
    url?: string;
    qualityLabel?: string;
    crossSource?: boolean;
    crossSourceFrom?: MusicSource;
    loudness?: TrackLoudness;
    duration?: number;
  } | null | undefined,
) {
  if (!room?.current || !media?.url || !media.trackId) return false;
  if (room.current.queueId !== media.trackId) return false;
  return seedSharedSongUrl(room.current, {
    url: media.url,
    qualityLabel: media.qualityLabel,
    crossSource: Boolean(media?.crossSource),
    crossSourceFrom: media?.crossSourceFrom,
    loudness: media.loudness,
    duration: media.duration,
  });
}

/** 从 playback_state 注入共享媒体链 */
export function applySharedPlaybackMediaFromState(
  room: Pick<RoomState, 'current'> | null | undefined,
  state: {
    trackId?: string;
    mediaUrl?: string;
    mediaQuality?: string;
    mediaCrossSource?: boolean;
    mediaCrossSourceFrom?: MusicSource;
    mediaLoudness?: TrackLoudness;
    mediaDuration?: number;
  } | null | undefined,
) {
  if (!state?.mediaUrl) return false;
  return applySharedPlaybackMedia(room, {
    trackId: state.trackId,
    url: state.mediaUrl,
    qualityLabel: state.mediaQuality,
    crossSource: state.mediaCrossSource,
    crossSourceFrom: state.mediaCrossSourceFrom,
    loudness: state.mediaLoudness,
    duration: state.mediaDuration,
  });
}

/** 从缓存恢复当前曲实际音质（跳过重新加载时用） */
export function syncActualQualityFromCache(song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>) {
  const key = urlCacheKey(song, getEffectivePlaybackQuality(song));
  const cached = urlCache.get(key) || urlCache.get(trackKeyOf(song));
  if (cached?.qualityLabel) {
    publishActualQuality(song, cached.qualityLabel, cached.crossSource ? normalizeMusicSource(cached.crossSourceFrom) : songSourceOf(song));
  }
}

export async function resolveSongUrl(
  song: QueueItem,
  options: { refresh?: boolean } = {},
): Promise<CachedUrlEntry> {
  const result = await fetchSongUrl(song, options);
  if (result?.url) return result;
  // service 失败会 markTrackSourceError；temporary 不会
  if (isTrackSourceError(song)) {
    throw new SourceUnavailableError('no url');
  }
  throw new TypeError('取链失败，请稍后重试');
}

/** 加入房间后立即预取当前歌曲 URL，缩短刷新后的加载等待 */
export function prefetchCurrentSong(song: QueueItem | null | undefined) {
  if (!song) return;
  // 汽水整曲解密占内存大：当前曲交给播放路径解密，这里只预取签名 URL
  void fetchSongUrl(song, { allowQualityDowngrade: false });
}

type UrlPrefetchSong = Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>;

/** 预取即将播放的曲目：队列下一首，或私人漫游 nextRandom */
export function prefetchUpcomingFromRoom(
  room: Pick<RoomState, 'current' | 'queue' | 'nextRandom'> | null | undefined,
  options: { count?: number; includeCurrent?: boolean } = {},
) {
  if (!room) return;
  // 切换音质时勿重拉当前曲：否则会按新音质取链并覆盖「实际音质」标签，尽管仍在播旧档
  if (options.includeCurrent !== false && room.current) {
    prefetchCurrentSong(room.current);
  }
  prefetchQueueSongs(room.queue ?? [], {
    current: room.current,
    nextRandom: room.nextRandom,
    count: options.count,
  });
}

export function prefetchQueueSongs(
  queue: QueueItem[],
  options: {
    count?: number;
    current?: QueueItem | null;
    nextRandom?: QueueItem | null;
  } = {},
) {
  const count = options.count ?? DEFAULT_PREFETCH_COUNT;
  const maxAhead = Math.max(1, isMobileDevice() ? 1 : count);
  const targets: UrlPrefetchSong[] = [];

  if (queue.length > 0) {
    targets.push(...queue.slice(0, maxAhead));
  } else if (options.nextRandom?.id) {
    targets.push(options.nextRandom);
  }

  if (targets.length === 0) {
    // 无预取目标时仍按整队裁剪标记，避免旧标记残留
    const retain: UrlPrefetchSong[] = [];
    if (options.current) retain.push(options.current);
    if (queue.length) retain.push(...queue);
    if (options.nextRandom?.id) retain.push(options.nextRandom);
    if (retain.length) pruneSourceErrors(retain);
    return;
  }

  // 保留整队 + 当前曲的源异常标记，避免只保留预取窗口导致角标被清掉
  const retain: UrlPrefetchSong[] = [];
  if (options.current) retain.push(options.current);
  if (queue.length) retain.push(...queue);
  else if (options.nextRandom?.id) retain.push(options.nextRandom);
  pruneSourceErrors(retain);

  // 仅预取即将播放的第一首歌曲音频数据（汽水或同源代理），避免多首并发预取占用服务器带宽
  const nextUp = targets[0] || null;
  for (const song of targets) {
    void fetchSongUrl(song, { allowQualityDowngrade: false }).then((result) => {
      if (!result?.url || !nextUp || song.queueId !== nextUp.queueId) return;
      if (songSourceOf(song) === 'qishui') {
        const room = useRoomStore.getState().room;
        const proxyQishui = shouldProxyQishuiTrack(
          song,
          Boolean(room?.qishuiProxyEnabled),
          Number(room?.qishuiProxyPercent ?? 100),
        );
        prefetchQishuiLocalPlayback(result.url, proxyQishui, Boolean(useRoomStore.getState().isPlaybackLeader));
        return;
      }
      if (isProxiedMediaUrl(result.url)) {
        prefetchProxiedAudioPlayback(result.url);
      }
    });
  }
}


let proxiedPrefetchTimer: number | null = null;
let proxiedPrefetchAbort: AbortController | null = null;
let proxiedPrefetchUrl = '';
const proxiedPrefetchedSet = new Set<string>();

/** 预取下一首同源代理音频首包（256KB），带随机错峰抖动，避免同房多人同时切歌时突发请求洪峰 */
export function prefetchProxiedAudioPlayback(url: string | null | undefined): void {
  if (!url || !isProxiedMediaUrl(url) || typeof window === 'undefined') return;
  const canonical = stripApiSignParams(url);
  if (!canonical || proxiedPrefetchedSet.has(canonical) || proxiedPrefetchUrl === canonical) return;

  if (proxiedPrefetchTimer !== null) {
    window.clearTimeout(proxiedPrefetchTimer);
    proxiedPrefetchTimer = null;
  }
  proxiedPrefetchAbort?.abort();
  const controller = new AbortController();
  proxiedPrefetchAbort = controller;
  proxiedPrefetchUrl = canonical;

  const isLeader = useRoomStore.getState().isPlaybackLeader;
  const delayMs = isLeader ? 600 : 1200 + Math.floor(Math.random() * 1600);

  proxiedPrefetchTimer = window.setTimeout(() => {
    proxiedPrefetchTimer = null;
    if (controller.signal.aborted) return;
    void fetch(canonical, {
      method: 'GET',
      headers: { Range: 'bytes=0-262143' },
      credentials: 'include',
      signal: controller.signal,
    }).then(async (res) => {
      if (res.ok || res.status === 206) {
        await res.arrayBuffer().catch(() => {});
        proxiedPrefetchedSet.add(canonical);
        while (proxiedPrefetchedSet.size > MAX_URL_CACHE) {
          const oldest = proxiedPrefetchedSet.keys().next().value;
          if (!oldest) break;
          proxiedPrefetchedSet.delete(oldest);
        }
      }
    }).catch(() => {}).finally(() => {
      if (proxiedPrefetchAbort === controller) {
        proxiedPrefetchAbort = null;
        proxiedPrefetchUrl = '';
      }
    });
  }, delayMs);
}
