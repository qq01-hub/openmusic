import type { MusicSource, RoomCheckResult, RoomSummary, SearchResult, Song } from '../../types';
import { getSourceShortLabel } from '../../lib/sourceLabels';
import type { MusicProviderMeta } from './types';
import { providers, getAllSources } from './sources';
import { interleaveSearchResults } from './merge';
import { hasValidLrc } from './lrcFallback';
import { fetchWithTimeout } from '../http';
import { toProxiedMediaUrl, toLocalMetingPicUrl, shouldProxyPlaybackUrl } from '../../lib/mediaProxyUrl';
import { shouldProxySongPlaybackUrl } from '../../lib/roomVisualPreset';
import { getUserPlaybackQuality } from './quality';
import { resizeCoverUrl, type CoverSize } from '../../lib/coverUrl';
import { requireSessionBootstrap } from '../../lib/sessionBootstrap';
import { signApiUrl } from '../../lib/signedApiUrl';
import { isBlockedPlaybackUrl, SourceUnavailableError } from '../../lib/audioPlaybackError';
import { mergeLyricTranslations } from '../../lib/immersiveLyricLines';

function getProvider(source: MusicSource) {
  return providers[source];
}

/**
 * 汽水带 auth 的 `/audio/qishui` 是 Meting 服务端解密端点，禁止拆成原始 CDN，
 * 也禁止套 media-proxy（否则会把整曲解密流量打回 OpenMusic/Meting）。
 * 没有 auth 的历史包装地址才允许还原为普通音频直链。
 */
export function unwrapQishuiAudioUrl(source: MusicSource, url: string): string {
  if (source !== 'qishui' || !url) return url;
  try {
    const wrapped = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (!/\/audio\/qishui\/?$/i.test(wrapped.pathname)) return url;
    const rawNested = wrapped.searchParams.get('url') || '';
    if (!rawNested) return url;
    if (wrapped.searchParams.get('auth') || wrapped.searchParams.get('t')) return url;
    const nested = new URL(rawNested);
    if (!['http:', 'https:'].includes(nested.protocol) || !nested.hostname.toLowerCase().includes('douyin')) {
      return url;
    }
    const mimeType = (nested.searchParams.get('mime_type') || wrapped.searchParams.get('mime_type') || '').trim();
    if (!/^audio_mp4$/i.test(mimeType)) return url;
    return nested.toString();
  } catch {
    return url;
  }
}

export async function searchSongs(source: MusicSource, keyword: string): Promise<SearchResult[]> {
  return getProvider(source).search(keyword);
}

export type SearchFilterMode = 'smart' | MusicSource;

export interface SearchAllSongsOptions {
  filterMode?: SearchFilterMode;
  suggestion?: Pick<SearchResult, 'name' | 'artist'>;
}

/** 并行搜索，多平台交替合并 */
export async function searchAllSongs(
  keyword: string,
  sourceList?: MusicProviderMeta[],
  options: SearchAllSongsOptions = {},
): Promise<SearchResult[]> {
  if (!keyword.trim()) return [];

  const filterMode = options.filterMode ?? 'smart';
  const allSources = (sourceList ?? getAllSources()).filter((s) => s.supportsSearch);

  if (filterMode !== 'smart') {
    const meta = allSources.find((s) => s.id === filterMode);
    if (!meta) return [];
    try {
      const songs = await searchSongs(filterMode, keyword);
      return interleaveSearchResults(
        { [filterMode]: songs },
        { sourceOnly: filterMode, keyword, suggestion: options.suggestion },
      );
    } catch {
      return [];
    }
  }

  const batches = await Promise.allSettled(
    allSources.map((meta) => searchSongs(meta.id, keyword)),
  );

  const groups: Partial<Record<MusicSource, SearchResult[]>> = {};
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (batch.status === 'fulfilled') {
      groups[allSources[i].id] = batch.value;
    }
  }

  return interleaveSearchResults(groups, { dedupeCrossSource: true, keyword, suggestion: options.suggestion });
}

export {
  interleaveSearchResults,
  songKey,
  artistGroupKey,
  trackTitleKey,
  rankSearchResultsByKeyword,
  rankSearchResultsBySuggestion,
  scoreTitleRelevance,
} from './merge';
export type { InterleaveOptions } from './merge';

export async function getSongById(source: MusicSource, id: string): Promise<SearchResult | null> {
  return getProvider(source).getSongById(id);
}

export async function getSongUrlInfo(
  song: Pick<Song, 'id' | 'source' | 'url' | 'duration'>,
  qualityOverride?: string,
  options?: { proxy?: boolean },
): Promise<import('./types').SongUrlResult> {
  const source = song.source || 'netease';
  const quality = qualityOverride ?? getUserPlaybackQuality(source);
  const result = await getProvider(source).getSongUrl({ ...song, source }, quality);
  if (!result.url || isBlockedPlaybackUrl(result.url)) {
    throw new SourceUnavailableError('no url');
  }
  const playbackUrl = unwrapQishuiAudioUrl(source, result.url);
  // 汽水只允许浏览器本地解密：沉浸/Web Audio 也用解密后的 blob:（同源），
  // 严禁把 /audio/qishui 或 CDN 密文套进 media-proxy（会炸 OpenMusic 内存并变成服务端解密）。
  if (source === 'qishui') {
    let resolved = playbackUrl;
    if (resolved.startsWith('/api/')) {
      resolved = await signApiUrl(resolved);
    }
    return {
      url: resolved,
      qualityLabel: result.qualityLabel?.trim() || undefined,
      loudness: result.loudness,
      duration: result.duration,
    };
  }
  const wantsProxy = options?.proxy
    ?? shouldProxyPlaybackUrl(playbackUrl, shouldProxySongPlaybackUrl());
  let resolved = wantsProxy ? toProxiedMediaUrl(playbackUrl) : playbackUrl;
  if (resolved.startsWith('/api/')) {
    resolved = await signApiUrl(resolved);
  }
  return {
    url: resolved,
    qualityLabel: result.qualityLabel?.trim() || undefined,
    loudness: result.loudness,
    duration: result.duration,
  };
}

export async function getSongUrl(
  song: Pick<Song, 'id' | 'source' | 'url' | 'duration'>,
  qualityOverride?: string,
  options?: { proxy?: boolean },
): Promise<string> {
  return (await getSongUrlInfo(song, qualityOverride, options)).url;
}

export {
  getQualityLabel,
  normalizeRoomAudioQuality,
  DEFAULT_ROOM_AUDIO_QUALITY,
  NETEASE_QUALITY_OPTIONS,
  TENCENT_QUALITY_OPTIONS,
  KUGOU_QUALITY_OPTIONS,
  getDowngradedQuality,
  buildQualityFallbackChain,
  getQualityOptionsForSource,
} from './quality';
export type { NeteaseQuality, TencentQuality } from './quality';
export type { RoomAudioQuality } from '../../types';

const lyricsInflight = new Map<string, Promise<string>>();
const LYRICS_CACHE_TTL_MS = 5 * 60_000;
const lyricsCache = new Map<string, { value: string; expires: number }>();

function lyricsRequestKey(song: Pick<Song, 'id' | 'source' | 'lrc' | 'name'>) {
  const source = song.source || 'netease';
  return `${source}:${song.id}:${song.lrc ?? ''}:${song.name ?? ''}`;
}

type LyricsSong = Pick<Song, 'id' | 'source' | 'lrc' | 'name'> & Partial<Pick<Song, 'artist' | 'album'>>;

async function fetchLyrics(song: LyricsSong): Promise<string> {
  const source = song.source || 'netease';
  let lrc = '';

  try {
    lrc = await getProvider(source).getLyrics({ ...song, source });
  } catch {
    lrc = '';
  }

  if (hasValidLrc(lrc)) return lrc;

  return lrc;
}

export async function getLyrics(song: LyricsSong): Promise<string> {
  const key = lyricsRequestKey(song);
  const cached = lyricsCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const inflight = lyricsInflight.get(key);
  if (inflight) return inflight;

  const promise = fetchLyrics(song).then((lrc) => {
    lyricsCache.set(key, { value: lrc, expires: Date.now() + LYRICS_CACHE_TTL_MS });
    return lrc;
  }).finally(() => {
    lyricsInflight.delete(key);
  });
  lyricsInflight.set(key, promise);
  return promise;
}

export function getCoverUrl(
  song: Pick<Song, 'id' | 'source' | 'pic'>,
  size: CoverSize = 'full',
): string {
  // 房间自定义封面不是音乐平台歌曲，不能按网易云歌曲 ID 请求 Meting pic。
  // 该对象由 Room.tsx 以 id=room-custom-cover 构造，pic 本身就是最终图片地址。
  if (song.id === 'room-custom-cover' && song.pic) {
    return resizeCoverUrl(song.pic, size);
  }
  const source = song.source || 'netease';
  const raw = getProvider(source).getCoverUrl({ ...song, source });
  const normalized = toLocalMetingPicUrl(raw) ?? raw;
  return resizeCoverUrl(normalized, size);
}

export type { CoverSize } from '../../lib/coverUrl';

export function getSourceLabel(source?: MusicSource): string {
  return getSourceShortLabel(source);
}

export function parseLrc(lrc: string): import('../../types').LyricLine[] {
  const lines: import('../../types').LyricLine[] = [];
  const regex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  /** 部分音源常用 99:xx 存放页脚推广，非真实歌词时间 */
  const PHANTOM_LRC_MINUTES = 90;

  for (const line of lrc.split('\n')) {
    const matches = [...line.matchAll(regex)];
    if (matches.length === 0) continue;

    const text = line.slice((matches[matches.length - 1].index ?? 0) + matches[matches.length - 1][0].length).trim();
    if (!text) continue;

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      if (minutes >= PHANTOM_LRC_MINUTES) continue;
      const seconds = parseInt(match[2], 10);
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0;
      const time = minutes * 60 + seconds + fraction;
      if (Number.isFinite(time)) lines.push({ time, text });
    }
  }

  return mergeLyricTranslations(lines.sort((a, b) => a.time - b.time));
}

/** 过滤 LRC 中的制作信息、推广文案等非演唱歌词 */
const CREDIT_LINE_RE =
  /^(歌手|演唱|原唱|专辑|来源|OP|SP|版权|未经许可|宣传|策划|统筹|发行|出品方?|监制|配唱|监唱|制作|录音|混音|母带|编曲|作曲|作词|吉他|贝斯|鼓|键盘|和声|弦乐|钢琴|打击乐|营销推广|音乐制作|音乐监制|歌曲监制|和声编写|弦乐编写|混音工程师|录音工程师|母带工程师|制作统筹|人声|弦乐演奏|吉他演奏|贝斯演奏|鼓演奏)\s*[:：]/i;

const PROMO_LINE_RE =
  /(网易飓风计划|现金激励|流量扶持|业务联系|vip\.163\.com|来自〖|〗)/i;

const NON_LYRIC_LINE_RE = /^(?:乐夏|拜拜|谢谢|再见|主唱|吉他(?:\/和声)?|贝斯|鼓(?:\/和声)?|和声|特邀键盘|声音制作人|音乐混音(?:顾问)?|舞台总监|灯光总监)\b/i;

export function filterDisplayLyrics(lines: import('../../types').LyricLine[]): import('../../types').LyricLine[] {
  return lines.filter((line) => {
    const text = line.text.trim();
    if (!text) return false;
    if (CREDIT_LINE_RE.test(text)) return false;
    if (PROMO_LINE_RE.test(text)) return false;
    if (NON_LYRIC_LINE_RE.test(text)) return false;
    return true;
  });
}

/** 歌词高亮相对播放时间略提前，减轻「歌词慢半拍」听感 */
export const LYRIC_SYNC_LEAD_SEC = 0.28;

export function getActiveLyricLine(
  lines: import('../../types').LyricLine[],
  currentTime: number,
): import('../../types').LyricLine | null {
  const displayLines = filterDisplayLyrics(lines);
  if (displayLines.length === 0) return null;

  const syncTime = currentTime + LYRIC_SYNC_LEAD_SEC;
  const activeIndex = displayLines.findIndex((line, i) => {
    const next = displayLines[i + 1];
    return syncTime >= line.time && (!next || syncTime < next.time);
  });

  if (activeIndex >= 0) return displayLines[activeIndex];
  if (syncTime < displayLines[0].time) return null;
  return displayLines[displayLines.length - 1];
}

export function getActiveLyricPair(
  lines: import('../../types').LyricLine[],
  currentTime: number,
): { current: string | null; next: string | null } {
  const displayLines = filterDisplayLyrics(lines);
  if (displayLines.length === 0) return { current: null, next: null };

  const syncTime = currentTime + LYRIC_SYNC_LEAD_SEC;
  const activeIndex = displayLines.findIndex((line, i) => {
    const next = displayLines[i + 1];
    return syncTime >= line.time && (!next || syncTime < next.time);
  });

  if (activeIndex >= 0) {
    return {
      current: displayLines[activeIndex].text,
      next: displayLines[activeIndex + 1]?.text ?? null,
    };
  }

  if (syncTime < displayLines[0].time) {
    return { current: null, next: displayLines[0].text };
  }

  return {
    current: displayLines[displayLines.length - 1].text,
    next: null,
  };
}

/** 歌词结束后常见纯音乐尾奏预留（秒） */
const LRC_TAIL_PADDING_SEC = 20;

const INSTRUMENTAL_LINE_RE =
  /纯音乐|伴奏|instrumental|off\s*vocal|no\s*vocal|请欣赏|此歌曲为.*纯音乐/i;

/** 有效演唱歌词是否仅为纯音乐/伴奏提示（不可用于推算时长） */
export function isInstrumentalOnlyLyrics(lrc: string): boolean {
  const lines = filterDisplayLyrics(parseLrc(lrc));
  if (lines.length === 0) return true;
  return lines.every((line) => INSTRUMENTAL_LINE_RE.test(line.text.trim()));
}

/** 从 LRC 推算备选时长（毫秒）：有效歌词末行 + 20 秒尾奏；纯音乐/伴奏提示不推算 */
export function getLrcFallbackDurationMs(lrc: string): number | undefined {
  if (isInstrumentalOnlyLyrics(lrc)) return undefined;
  const lines = filterDisplayLyrics(parseLrc(lrc));
  if (lines.length === 0) return undefined;
  return Math.round((lines[lines.length - 1].time + LRC_TAIL_PADDING_SEC) * 1000);
}

/** 解析播放时长：元数据优先，无元数据时用歌词+20 秒 */
export function getDurationFromLrc(lrc: string, metadataMs?: number): number | undefined {
  if (metadataMs && metadataMs > 0) return metadataMs;
  return getLrcFallbackDurationMs(lrc);
}

export function getTrackKey(song: { queueId?: string; id: string; source?: MusicSource }): string {
  return `${song.queueId || song.id}-${song.source || 'netease'}`;
}

export async function resolveDurationFromLyrics(
  song: Pick<Song, 'id' | 'source' | 'name' | 'lrc' | 'duration'>,
): Promise<number | undefined> {
  const lrc = await getLyrics(song);
  return getDurationFromLrc(lrc, song.duration);
}

export async function createRoom(name?: string, password?: string): Promise<{ id: string; name: string }> {
  await requireSessionBootstrap();
  const payload: { name?: string; password?: string } = {};
  if (name?.trim()) payload.name = name.trim();
  if (password?.trim()) payload.password = password.trim();
  const res = await fetchWithTimeout('/api/rooms', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: unknown;
      code?: unknown;
      retryAfterSec?: unknown;
    } | null;
    const message = typeof data?.error === 'string' ? data.error.trim() : '';
    const code = typeof data?.code === 'string' ? data.code.trim() : '';
    if (code === 'OM-RCD1') {
      const retryAfterSec = Number(data?.retryAfterSec) || 0;
      throw new Error(retryAfterSec > 0
        ? `你创建房间有点频繁啦，请 ${retryAfterSec} 秒后再试～`
        : '你创建房间有点频繁啦，请稍后再试～');
    }
    if (code === 'OM-RCD2') {
      const retryAfterSec = Number(data?.retryAfterSec) || 0;
      throw new Error(retryAfterSec > 0
        ? `刚刚已经创建过房间啦，请 ${retryAfterSec} 秒后再试～`
        : '刚刚已经创建过房间啦，请稍后再试～');
    }
    if (message) throw new Error(message);
    if (code) throw new Error(`系统开小差了，请稍后再试。如有疑问请联系管理员（错误码 ${code}）`);
    throw new Error(`创建房间失败（${res.status}）`);
  }
  return res.json();
}

export async function listRooms(): Promise<RoomSummary[]> {
  const res = await fetchWithTimeout('/api/rooms', {}, 12000);
  if (!res.ok) throw new Error('获取房间列表失败');
  return res.json();
}

export async function randomMatchRoom(): Promise<RoomSummary> {
  const res = await fetchWithTimeout('/api/rooms/random-match', {}, 12000);
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const message = typeof data?.error === 'string' ? data.error.trim() : '';
    throw new Error(message || '随机匹配失败，请稍后再试');
  }
  return res.json();
}

export async function checkRoom(id: string): Promise<RoomCheckResult> {
  const res = await fetchWithTimeout(`/api/rooms/${id}`);
  if (!res.ok) return { exists: false, hasPassword: false };
  const data = await res.json();
  return {
    exists: true,
    hasPassword: Boolean(data.hasPassword),
    isLocked: Boolean(data.isLocked),
    name: data.name,
  };
}

export async function getAvailableSources(): Promise<MusicProviderMeta[]> {
  try {
    const res = await fetchWithTimeout('/api/music/sources');
    if (res.ok) return res.json();
  } catch {
    // fallback
  }
  // 服务端固定启用网易和 QQ；接口不可用时不要臆测酷狗/汽水已开启。
  return getAllSources().filter((source) => source.id === 'netease' || source.id === 'tencent');
}

export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export { getAllSources, providers };
