import {
  fetchDjHotRadios,
  searchDjRadios,
  type DjRadioItem,
} from '../api/music/djRadio';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 40;

export type DjRadiosData = {
  hot: DjRadioItem[];
  recommend: DjRadioItem[];
};

type ModeCacheEntry = { data: DjRadioItem[]; expires: number };

const modeCache: Record<'hot' | 'recommend', ModeCacheEntry | null> = {
  hot: null,
  recommend: null,
};
const modeInflight: Record<'hot' | 'recommend', Promise<DjRadioItem[]> | null> = {
  hot: null,
  recommend: null,
};
const searchCache = new Map<string, ModeCacheEntry>();
const searchInflight = new Map<string, Promise<DjRadioItem[]>>();

export function peekDjRadiosByMode(mode: 'hot' | 'recommend'): DjRadioItem[] | null {
  const hit = modeCache[mode];
  if (hit && Date.now() < hit.expires) return hit.data;
  return null;
}

export async function getDjRadiosByMode(mode: 'hot' | 'recommend'): Promise<DjRadioItem[]> {
  const hit = peekDjRadiosByMode(mode);
  if (hit) return hit;
  const pending = modeInflight[mode];
  if (pending) return pending;

  const request = fetchDjHotRadios(mode)
    .then((data) => {
      modeCache[mode] = { data, expires: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .finally(() => {
      modeInflight[mode] = null;
    });

  modeInflight[mode] = request;
  return request;
}

export function peekDjRadios(): DjRadiosData | null {
  const hot = peekDjRadiosByMode('hot');
  const recommend = peekDjRadiosByMode('recommend');
  if (!hot && !recommend) return null;
  return {
    hot: hot ?? [],
    recommend: recommend ?? [],
  };
}

export async function getDjRadios(): Promise<DjRadiosData> {
  const [hot, recommend] = await Promise.all([
    getDjRadiosByMode('hot').catch(() => [] as DjRadioItem[]),
    getDjRadiosByMode('recommend').catch(() => [] as DjRadioItem[]),
  ]);
  return { hot, recommend };
}

export async function searchDjRadiosCached(keyword: string): Promise<DjRadioItem[]> {
  const key = keyword.trim().toLowerCase();
  if (!key) return [];
  const hit = searchCache.get(key);
  if (hit && Date.now() < hit.expires) return hit.data;
  const pending = searchInflight.get(key);
  if (pending) return pending;

  const request = searchDjRadios(keyword)
    .then((data) => {
      if (searchCache.has(key)) searchCache.delete(key);
      searchCache.set(key, { data, expires: Date.now() + SEARCH_CACHE_TTL_MS });
      while (searchCache.size > SEARCH_CACHE_MAX) {
        const oldest = searchCache.keys().next().value;
        if (oldest === undefined) break;
        searchCache.delete(oldest);
      }
      return data;
    })
    .finally(() => {
      searchInflight.delete(key);
    });

  searchInflight.set(key, request);
  return request;
}
