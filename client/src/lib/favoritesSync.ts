import type { FavoriteSong } from '../types';
import { fetchWithTimeout } from '../api/http';
import { getAccountSessionGeneration } from './accountAccessSession';

export type FavoritesSyncStatus = 'idle' | 'pending' | 'syncing' | 'identity_same' | 'merged' | 'failed';

export interface FavoritesSyncState {
  status: FavoritesSyncStatus;
  retryCount: number;
  lastAttemptAt: number | null;
  lastError?: string;
}

export const INITIAL_FAVORITES_SYNC_STATE: FavoritesSyncState = {
  status: 'idle',
  retryCount: 0,
  lastAttemptAt: null,
};

const STATE_KEY = 'openmusic:favorites-sync:v1:guest';
export const FAVORITES_SYNC_BATCH_SIZE = 1000;

export interface FavoriteSyncBatchResponse {
  success: boolean;
  status?: 'identity_same' | 'merged';
  identitySame?: boolean;
  favorites?: FavoriteSong[];
  imported?: number;
  dropped?: number;
  categories?: string[];
  error?: string;
}

export interface FavoriteSyncResult extends FavoriteSyncBatchResponse {
  complete: boolean;
}

type FavoriteCategoriesResponse = { success: boolean; categories?: string[]; error?: string };

export function readFavoritesSyncState(): FavoritesSyncState {
  try {
    const value = JSON.parse(localStorage.getItem(STATE_KEY) || 'null') as Partial<FavoritesSyncState> | null;
    if (!value || typeof value !== 'object') return INITIAL_FAVORITES_SYNC_STATE;
    let status: FavoritesSyncStatus = ['idle', 'pending', 'syncing', 'identity_same', 'merged', 'failed'].includes(String(value.status))
      ? value.status as FavoritesSyncStatus
      : 'idle';
    if (status === 'syncing') status = 'pending';
    return {
      status,
      retryCount: Number.isFinite(Number(value.retryCount)) ? Math.max(0, Number(value.retryCount)) : 0,
      lastAttemptAt: Number.isFinite(Number(value.lastAttemptAt)) ? Number(value.lastAttemptAt) : null,
      ...(value.lastError ? { lastError: String(value.lastError).slice(0, 300) } : {}),
    };
  } catch {
    return INITIAL_FAVORITES_SYNC_STATE;
  }
}

export function writeFavoritesSyncState(state: FavoritesSyncState): void {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export function markFavoritesSyncPending(previous = readFavoritesSyncState()): FavoritesSyncState {
  const next = { ...previous, status: 'pending' as const, lastError: undefined };
  writeFavoritesSyncState(next);
  return next;
}

export function markFavoritesSyncAttempt(previous = readFavoritesSyncState()): FavoritesSyncState {
  const next = {
    ...previous,
    status: 'syncing' as const,
    lastAttemptAt: Date.now(),
    retryCount: previous.retryCount + 1,
    lastError: undefined,
  };
  writeFavoritesSyncState(next);
  return next;
}

export function markFavoritesSyncResult(status: 'identity_same' | 'merged', previous = readFavoritesSyncState()): FavoritesSyncState {
  const next = { ...previous, status, lastError: undefined };
  writeFavoritesSyncState(next);
  return next;
}

export function markFavoritesSyncFailed(error: unknown, previous = readFavoritesSyncState()): FavoritesSyncState {
  const message = error instanceof Error ? error.message : String(error || '收藏同步失败');
  const next = { ...previous, status: 'failed' as const, lastError: message.slice(0, 300) };
  writeFavoritesSyncState(next);
  return next;
}

export function mergeFavoriteSongs(base: FavoriteSong[], incoming: FavoriteSong[]): FavoriteSong[] {
  const result = [...base];
  const seen = new Set(result.map((song) => `${song.source || 'netease'}:${song.id}`));
  for (const song of incoming) {
    const key = `${song.source || 'netease'}:${song.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.unshift(song);
    }
  }
  return result.slice(0, 5000);
}

export function buildFavoriteMigrationPlan(
  serverFavorites: FavoriteSong[],
  localFavorites: FavoriteSong[],
): { favorites: FavoriteSong[]; missingLocalFavorites: FavoriteSong[] } {
  const seen = new Set(serverFavorites.map((song) => `${song.source || 'netease'}:${song.id}`));
  const missingLocalFavorites = localFavorites.filter((song) => {
    const key = `${song.source || 'netease'}:${song.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    favorites: [...serverFavorites, ...missingLocalFavorites],
    missingLocalFavorites,
  };
}

export async function migrateFavoriteCache(
  serverFavorites: FavoriteSong[],
  localFavorites: FavoriteSong[],
  upload: (songs: FavoriteSong[]) => Promise<FavoriteSyncBatchResponse>,
): Promise<{ favorites: FavoriteSong[]; migrated: boolean }> {
  const plan = buildFavoriteMigrationPlan(serverFavorites, localFavorites);
  if (plan.missingLocalFavorites.length === 0) return { favorites: plan.favorites, migrated: true };
  const result = await syncFavoriteBatches(plan.missingLocalFavorites, upload);
  return {
    favorites: result.favorites?.length ? result.favorites : plan.favorites,
    migrated: result.success && result.complete,
  };
}

export async function migrateFavoriteCategories(
  localCategories: string[],
  listRemote: () => Promise<FavoriteCategoriesResponse>,
  createRemote: (name: string) => Promise<FavoriteCategoriesResponse>,
): Promise<{ categories: string[]; migrated: boolean }> {
  const listed = await listRemote();
  if (!listed.success) return { categories: localCategories, migrated: false };
  let categories = listed.categories || [];
  for (const value of localCategories) {
    const name = value.trim();
    if (!name || categories.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
    const created = await createRemote(name);
    if (!created.success) return { categories, migrated: false };
    categories = created.categories || [...categories, name];
  }
  return { categories, migrated: true };
}

export async function syncFavoriteBatches(
  songs: FavoriteSong[],
  syncBatch: (batch: FavoriteSong[]) => Promise<FavoriteSyncBatchResponse>,
): Promise<FavoriteSyncResult> {
  let imported = 0;
  let dropped = 0;
  let last: FavoriteSyncBatchResponse = { success: true, favorites: [] };

  for (let offset = 0; offset < Math.max(1, songs.length); offset += FAVORITES_SYNC_BATCH_SIZE) {
    const result = await syncBatch(songs.slice(offset, offset + FAVORITES_SYNC_BATCH_SIZE));
    if (!result.success) return { ...result, complete: false, imported, dropped };
    last = result;
    imported += Math.max(0, Number(result.imported) || 0);
    dropped += Math.max(0, Number(result.dropped) || 0);
  }

  return { ...last, success: true, complete: dropped === 0, imported, dropped };
}

export async function syncAccountFavorites(songs: FavoriteSong[], categories: string[] = [], accountId?: string): Promise<FavoriteSyncResult> {
  const generation = getAccountSessionGeneration();
  return syncFavoriteBatches(songs, async (batch) => {
    if (generation !== getAccountSessionGeneration()) return { success: false, error: '账户已变化，请重新迁移收藏' };
    const response = await fetchWithTimeout('/api/account/favorites/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs: batch, categories, accountId }),
    }, 10000);
    const data = await response.json().catch(() => ({})) as FavoriteSyncBatchResponse;
    if (generation !== getAccountSessionGeneration()) return { success: false, error: '账户已变化，请重新迁移收藏' };
    if (!response.ok || !data.success) return { success: false, error: data.error || '收藏同步失败' };
    return data;
  });
}
