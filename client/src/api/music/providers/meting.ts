import type { MusicProvider, SearchResult } from '../types';
import type { MusicSource } from '../../../types';
import { fetchWithTimeout } from '../../http';
import { isSourceUnavailableMessage, SourceUnavailableError } from '../../../lib/audioPlaybackError';
import { normalizeDurationMs } from '../../../lib/duration';

const API_BASE = '/api/meting';

function parseMetingMediaQuery(url: string): { server: MusicSource; id: string; type: 'url' | 'lrc' | 'pic' } | null {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const type = parsed.searchParams.get('type');
    if (type !== 'url' && type !== 'lrc' && type !== 'pic') return null;
    const server = parsed.searchParams.get('server');
    const id = parsed.searchParams.get('id');
    if (!server || !id) return null;
    if (server !== 'netease' && server !== 'tencent' && server !== 'kugou' && server !== 'qishui') return null;
    return { server, id, type };
  } catch {
    return null;
  }
}

/** Meting 搜索结果里常带 127.0.0.1/api?type=url，需经 /api/meting 二次解析 */
function isMetingResolverUrl(url?: string): boolean {
  if (!url?.startsWith('http')) return false;
  const query = parseMetingMediaQuery(url);
  if (!query) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost'
      || host === '127.0.0.1'
      || host.endsWith('.local')
      || parsed.pathname.includes('/api');
  } catch {
    return false;
  }
}

/**
 * 网易云「外链直连」假地址：上游拿不到真实 CDN 时常回落成
 * music.163.com/song/media/outer/url?id=xxx.mp3，实际访问 404，不可播。
 */
function isNeteaseOuterMediaUrl(url?: string): boolean {
  if (!url?.startsWith('http')) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'music.163.com' && host !== 'www.music.163.com') return false;
    return /\/song\/media\/outer\/url/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isDirectPlayableUrl(url?: string): boolean {
  return Boolean(url?.startsWith('http') && !isMetingResolverUrl(url) && !isNeteaseOuterMediaUrl(url));
}

function normalizeMetingTextUrl(raw: string): string {
  const text = raw.trim();
  return text.startsWith('@') ? text.slice(1).trim() : text;
}

function parseMetingErrorMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as { error?: unknown };
      if (typeof data.error === 'string') return data.error.trim();
    } catch {
      // fall through
    }
  }
  return trimmed;
}

function throwIfSourceUnavailable(message: string): void {
  if (isSourceUnavailableMessage(message)) {
    throw new SourceUnavailableError(message);
  }
}

async function metingFetch<T>(server: MusicSource, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ server, ...params });
  const res = await fetchWithTimeout(`${API_BASE}?${query}`, { signal });
  if (!res.ok) throw new Error('API 请求失败');
  return res.json();
}

async function metingText(server: MusicSource, params: Record<string, string>): Promise<string> {
  const query = new URLSearchParams({ server, ...params });
  const res = await fetchWithTimeout(`${API_BASE}?${query}`, { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('Location') || res.headers.get('location') || '';
    if (location) return location;
  }
  if (!res.ok) throw new Error('API 请求失败');
  return res.text();
}

function extractIdFromUrl(url: string): string {
  try {
    const match = url.match(/[?&]id=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function extractSongId(raw: Record<string, unknown>, url: string): string {
  const rawId = raw.id ?? raw.songId ?? raw.mid;
  if (rawId !== undefined && rawId !== null && String(rawId).trim()) {
    return String(rawId).trim();
  }
  // 服务端会将解析链接改写为 /api/meting，必须先取查询参数，不能把相对链接当 ID。
  const urlId = extractIdFromUrl(url).trim();
  if (urlId) return urlId;
  return /^[0-9A-Za-z_-]+$/.test(url) ? url : '';
}

function normalizeSong(raw: Record<string, unknown>, source: MusicSource): SearchResult {
  const artist = raw.artist ?? raw.author;
  const artistStr = Array.isArray(artist)
    ? (artist as Array<{ name?: string }>).map((a) => a.name).join(' / ')
    : String(artist || '未知歌手');

  const urlStr = raw.url ? String(raw.url) : '';
  const lrcStr = raw.lrc ? String(raw.lrc) : '';
  const id = extractSongId(raw, urlStr);

  return {
    id,
    source,
    name: String(raw.name || raw.title || '未知歌曲'),
    artist: artistStr,
    album: String(raw.album || raw.album_name || ''),
    pic: String(raw.pic || raw.cover || raw.album_pic || ''),
    duration: normalizeDurationMs(raw.duration || raw.dt),
    url: isDirectPlayableUrl(urlStr) ? urlStr : undefined,
    lrc: lrcStr.startsWith('[') ? lrcStr : undefined,
  };
}

function createMetingProvider(
  source: Extract<MusicSource, 'netease' | 'tencent' | 'kugou' | 'qishui'>,
  meta: Omit<import('../types').MusicProviderMeta, 'id'>,
): MusicProvider {
  return {
    id: source,
    ...meta,
    async search(keyword, options = {}) {
      if (!meta.supportsSearch || !keyword.trim()) return [];
      const allPages = source === 'netease' && options.allPages === true;
      const results: SearchResult[] = [];
      const seen = new Set<string>();
      let offset = 0;
      while (true) {
        options.signal?.throwIfAborted();
        const data = await metingFetch<Record<string, unknown>[]>(source, {
          type: 'search',
          id: keyword.trim(),
          ...(allPages ? { limit: '100', offset: String(offset) } : {}),
        }, options.signal);
        options.signal?.throwIfAborted();
        if (!Array.isArray(data)) return results;
        const songs = data.map((item) => normalizeSong(item, source)).filter((song) => song.id);
        if (!allPages) return songs;
        const previousCount = results.length;
        for (const song of songs) {
          if (seen.has(song.id)) continue;
          seen.add(song.id);
          results.push(song);
        }
        if (data.length < 100 || results.length === previousCount) return results;
        offset += data.length;
      }
    },
    async getSongById(id) {
      if (!id.trim()) return null;
      const data = await metingFetch<Record<string, unknown> | Record<string, unknown>[]>(source, {
        type: 'song',
        id: id.trim(),
      });
      const raw = Array.isArray(data) ? data[0] : data;
      if (!raw) return null;
      const song = normalizeSong(raw, source);
      return song.id ? song : null;
    },
    async getSongUrl(song, quality) {
      if (!song.id && isDirectPlayableUrl(song.url)) return { url: song.url!, duration: song.duration };
      const query = new URLSearchParams({ server: song.source, type: 'url', id: song.id });
      if (quality) query.set('quality', quality);
      const res = await fetchWithTimeout(`${API_BASE}?${query}`, { redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const location = normalizeMetingTextUrl(res.headers.get('Location') || res.headers.get('location') || '');
        if (isDirectPlayableUrl(location)) return { url: location, duration: song.duration };
      }
      const text = (await res.text()).trim();
      if (!res.ok) {
        const errMsg = parseMetingErrorMessage(text);
        throwIfSourceUnavailable(errMsg);
        throw new Error(errMsg || 'API 请求失败');
      }
      if (text.startsWith('{')) {
        try {
          const data = JSON.parse(text) as {
            url?: unknown; quality?: unknown; error?: unknown; duration?: unknown;
            loudness?: { gain?: unknown; peak?: unknown; lra?: unknown };
          };
          const errMsg = typeof data.error === 'string' ? data.error.trim() : '';
          throwIfSourceUnavailable(errMsg);
          const url = normalizeMetingTextUrl(String(data.url || ''));
          if (isDirectPlayableUrl(url)) {
            const qualityLabel = String(data.quality || '').trim() || undefined;
            const duration = Number(data.duration);
            const loudness = data.loudness && typeof data.loudness === 'object'
              ? Object.fromEntries(
                Object.entries(data.loudness)
                  .map(([key, value]) => [key, Number(value)])
                  .filter(([, value]) => Number.isFinite(value)),
              )
              : undefined;
            return {
              url,
              qualityLabel,
              duration: normalizeDurationMs(duration),
              loudness: loudness && Object.keys(loudness).length > 0 ? loudness as { gain?: number; peak?: number; lra?: number } : undefined,
            };
          }
        } catch (error) {
          if (error instanceof SourceUnavailableError) throw error;
          // fall through
        }
      }
      const url = normalizeMetingTextUrl(text);
      if (isDirectPlayableUrl(url)) return { url, duration: song.duration };
      throw new SourceUnavailableError('no url');
    },
    async getLyrics(song) {
      if (song.lrc?.startsWith('[')) return song.lrc;
      return metingText(song.source, { type: 'lrc', id: song.id });
    },
    getCoverUrl(song) {
      const pic = String(song.pic || '');
      if (isDirectPlayableUrl(pic)) return pic;
      return `${API_BASE}?server=${song.source}&type=pic&id=${song.id}`;
    },
  };
}

export const neteaseProvider = createMetingProvider('netease', {
  name: '网易',
  shortName: '网易',
  color: '#ec4141',
  supportsSearch: true,
  supportsIdLookup: true,
});

export const tencentProvider = createMetingProvider('tencent', {
  name: 'QQ',
  shortName: 'QQ',
  color: '#31c27c',
  supportsSearch: true,
  supportsIdLookup: false,
});

export const kugouProvider = createMetingProvider('kugou', {
  name: '酷狗',
  shortName: '酷狗',
  color: '#2688ee',
  supportsSearch: true,
  supportsIdLookup: true,
  description: '酷狗音乐曲库与会员音源',
});

export const qishuiProvider = createMetingProvider('qishui', {
  name: '汽水',
  shortName: '汽水',
  color: '#ff5b73',
  supportsSearch: true,
  supportsIdLookup: true,
  description: '汽水音乐曲库与会员音源',
});

export async function metingSearchPlaylists(
  server: Extract<MusicSource, 'netease' | 'tencent' | 'kugou' | 'qishui'>,
  keyword: string,
): Promise<Record<string, unknown>[]> {
  if (!keyword.trim()) return [];
  const data = await metingFetch<Record<string, unknown>[]>(server, {
    type: 'search_playlist',
    id: keyword.trim(),
  });
  return Array.isArray(data) ? data : [];
}
