import type { SearchResult } from '../../types';
import { fetchWithTimeout } from '../http';
import { upgradeInsecureCoverUrl } from '../../lib/coverUrl';

export interface DjRadioItem {
  id: string;
  name: string;
  creatorName?: string;
  coverImgUrl?: string;
  trackCount: number;
}

function extractIdFromApiUrl(url: string): string {
  try {
    const match = String(url || '').match(/[?&]id=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function normalizeRadio(raw: Record<string, unknown>): DjRadioItem | null {
  const id = String(raw.id || extractIdFromApiUrl(String(raw.url || '')) || '').trim();
  if (!id || id === 'undefined') return null;
  const pic = String(raw.pic || raw.cover || raw.coverImgUrl || '');
  return {
    id,
    name: String(raw.title || raw.name || '未命名电台'),
    creatorName: String(raw.author || raw.artist || raw.creatorName || '').trim() || undefined,
    coverImgUrl: pic.startsWith('http') ? upgradeInsecureCoverUrl(pic) : undefined,
    trackCount: Number(raw.trackCount || raw.programCount || raw.song_count || 0),
  };
}

function normalizeProgram(raw: Record<string, unknown>): SearchResult | null {
  const urlStr = String(raw.url || '');
  const songId = extractIdFromApiUrl(urlStr) || (/^\d+$/.test(urlStr) ? urlStr : '');
  if (!songId || songId === 'undefined') return null;
  const pic = String(raw.pic || raw.cover || '');
  return {
    id: songId,
    source: 'netease',
    name: String(raw.title || raw.name || '未知节目'),
    artist: String(raw.author || raw.artist || '未知主播'),
    pic: pic.startsWith('http') ? upgradeInsecureCoverUrl(pic) : undefined,
  };
}

async function metingJson(
  type: string,
  id: string,
  extra?: Record<string, string>,
  signal?: AbortSignal,
  onResponse?: (response: Response) => void,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    server: 'netease',
    type,
    id,
    ...extra,
  });
  const res = await fetchWithTimeout(`/api/meting?${params}`, { signal }, 30000);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data && typeof data === 'object' && 'error' in data)
      ? String((data as { error?: string }).error || '')
      : '';
    const msg = (data && typeof data === 'object' && 'message' in data)
      ? String((data as { message?: string }).message || '')
      : '';
    const combined = `${err} ${msg}`;
    if (res.status === 400 && /不合法|invalid|unsupported/i.test(combined)) {
      throw new Error('当前音乐 API 暂不支持电台接口，请升级 Meting-API 后重试');
    }
    throw new Error(err || msg || '电台请求失败');
  }
  onResponse?.(res);
  return Array.isArray(data) ? data as Record<string, unknown>[] : [];
}

/** 热门 / 推荐电台 */
export async function fetchDjHotRadios(mode: 'hot' | 'recommend' = 'hot'): Promise<DjRadioItem[]> {
  const list = await metingJson('dj_hot', mode);
  return list.map(normalizeRadio).filter((item): item is DjRadioItem => Boolean(item));
}

/** 搜索电台 */
export async function searchDjRadios(keyword: string): Promise<DjRadioItem[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const list = await metingJson('search_dj', trimmed);
  return list.map(normalizeRadio).filter((item): item is DjRadioItem => Boolean(item));
}

/**
 * 分页拉取电台节目并转为可点歌结果。
 * 必须带 page/limit，避免后端一次性读取全部节目触发网易云频繁请求限制。
 */
export async function fetchDjPrograms(
  radioId: string,
  page = 1,
  limit = 100,
  signal?: AbortSignal,
): Promise<{
  name: string;
  songs: SearchResult[];
  total: number;
  upstreamCount: number;
}> {
  const id = String(radioId || '').trim();
  if (!id) throw new Error('缺少电台 ID');
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 100));
  let upstreamCount: number | undefined;

  const [programs, detail] = await Promise.all([
    metingJson('dj', id, { page: String(safePage), limit: String(safeLimit) }, signal, (response) => {
      const count = response.headers.get('X-OpenMusic-Upstream-Count');
      if (count !== null && /^\d+$/.test(count) && Number.isSafeInteger(Number(count))) {
        upstreamCount = Number(count);
      }
    }),
    safePage === 1
      ? metingJson('dj_detail', id, undefined, signal).catch(() => [])
      : Promise.resolve<Record<string, unknown>[]>([]),
  ]);

  const songs = programs
    .map(normalizeProgram)
    .filter((item): item is SearchResult => Boolean(item));

  const radioName = detail[0]
    ? String(detail[0].title || detail[0].name || '')
    : '';
  const total = detail[0]
    ? Number(detail[0].trackCount || detail[0].programCount || 0)
    : 0;

  return {
    name: radioName,
    songs,
    total: Number.isFinite(total) && total > 0 ? total : 0,
    upstreamCount: Math.max(programs.length, upstreamCount ?? programs.length),
  };
}
