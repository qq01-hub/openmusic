import { useCallback, useEffect, useRef, useState } from 'react';
import { songKey } from '../api/music';
import { useSocket } from './useSocket';
import type { FavoriteSong, Song } from '../types';
import { fetchAccountSession } from '../lib/accountAuth';
import { isAccountSessionRevisionEvent } from '../lib/accountSessionSignal';
import { getAccountSessionGeneration, hasAnonymousAccess } from '../lib/accountAccessSession';
import {
  markFavoritesSyncAttempt,
  markFavoritesSyncFailed,
  markFavoritesSyncPending,
  markFavoritesSyncResult,
  readFavoritesSyncState,
  syncAccountFavorites,
  type FavoritesSyncState,
} from '../lib/favoritesSync';

let sharedFavoriteSongs: FavoriteSong[] = [];
let sharedFavoriteIds = new Set<string>();
type FavoritesLoadResult = { success: boolean; error?: string };
let loadPromise: Promise<FavoritesLoadResult> | null = null;
let loadGeneration = 0;
const listeners = new Set<() => void>();
let sharedSyncState = readFavoritesSyncState();
const syncListeners = new Set<() => void>();

const GUEST_CACHE_KEY = 'openmusic:favorites-cache:v1:guest';
const ACCOUNT_CACHE_PREFIX = 'openmusic:favorites-cache:v1:account:';
const GUEST_CATEGORIES_KEY = 'openmusic:favorite-categories:v1:guest';
const ACCOUNT_CATEGORIES_PREFIX = 'openmusic:favorite-categories:v1:account:';

function readCache(key: string): FavoriteSong[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is FavoriteSong => Boolean(
      item && typeof item === 'object' && String(item.id || '').trim() && String(item.name || '').trim(),
    ));
  } catch {
    return [];
  }
}

function removeCache(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

function accountCacheKey(accountId: string): string {
  return `${ACCOUNT_CACHE_PREFIX}${accountId}`;
}

function categoriesCacheKey(accountId?: string): string {
  return accountId ? `${ACCOUNT_CATEGORIES_PREFIX}${accountId}` : GUEST_CATEGORIES_KEY;
}

function readCategories(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeCategories(key: string, categories: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(categories)); } catch { /* storage unavailable */ }
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function updateSharedFavorites(songs: FavoriteSong[]) {
  sharedFavoriteSongs = songs;
  sharedFavoriteIds = new Set(songs.map(songKey));
  notifyListeners();
}

function updateSharedSyncState(state: FavoritesSyncState) {
  sharedSyncState = state;
  syncListeners.forEach((listener) => listener());
}

async function runFavoriteRequest<Result extends { success: boolean; error?: string }>(
  request: () => Promise<Result>,
  apply?: (result: Result, accountId: string) => void,
) {
  const generation = loadGeneration;
  const session = getAccountSessionGeneration();
  const assertCurrent = () => {
    if (generation !== loadGeneration || session !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新读取收藏');
  };
  try {
    const account = await fetchAccountSession();
    assertCurrent();
    if (!account && !hasAnonymousAccess()) throw new Error('请先登录账户');
    const result = await request();
    assertCurrent();
    if (result.success) apply?.(result, account?.id || '');
    return result;
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : '收藏操作失败，请重试' };
  }
}

if (typeof window !== 'undefined') {
  const invalidate = () => {
    loadGeneration += 1;
    loadPromise = null;
    updateSharedFavorites([]);
  };
  window.addEventListener('openmusic:account-session-changed', invalidate);
  window.addEventListener('openmusic:account-auth-required', invalidate);
  window.addEventListener('storage', (event) => {
    if (isAccountSessionRevisionEvent(event)) invalidate();
  });
}

export function useFavorites() {
  const { listFavorites, listFavoriteCategories, createFavoriteCategory, deleteFavoriteCategory, setFavorite, setFavoriteCategory, importFavorites: importFavoritesOnServer } = useSocket();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [favoriteSongs, setFavoriteSongs] = useState<FavoriteSong[]>([]);
  const [syncState, setSyncState] = useState<FavoritesSyncState>(() => sharedSyncState);
  const [categories, setCategories] = useState<string[]>([]);
  const retryTimer = useRef<number | null>(null);

  useEffect(() => {
    const listener = () => {
      setFavoriteIds(sharedFavoriteIds);
      setFavoriteSongs(sharedFavoriteSongs);
    };
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        loadGeneration += 1;
        loadPromise = null;
        sharedFavoriteSongs = [];
        sharedFavoriteIds = new Set();
      }
    };
  }, []);

  useEffect(() => {
    const listener = () => setSyncState(sharedSyncState);
    syncListeners.add(listener);
    return () => { syncListeners.delete(listener); };
  }, []);

  const ensureLoaded = useCallback(async () => {
    if (loadPromise) return loadPromise;
    const generation = loadGeneration;
    const session = getAccountSessionGeneration();
    const assertCurrent = () => {
      if (generation !== loadGeneration || session !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新读取收藏');
    };
    const pending = (async (): Promise<FavoritesLoadResult> => {
      const guestCached = readCache(GUEST_CACHE_KEY);
      const account = await fetchAccountSession();
      assertCurrent();
      if (!account) {
        if (hasAnonymousAccess()) {
          const [result, categoryResult] = await Promise.all([listFavorites(), listFavoriteCategories()]);
          assertCurrent();
          if (!result.success) throw new Error(result.error || '收藏列表加载失败');
          if (!categoryResult.success) throw new Error(categoryResult.error || '收藏分类加载失败');
          setCategories(categoryResult.categories || []);
          updateSharedFavorites(result.favorites || []);
          return { success: true };
        }
        updateSharedFavorites([]);
        throw new Error('请先登录账户，原游客收藏会在登录后迁移');
      }

      const cachedGuestCategories = readCategories(GUEST_CATEGORIES_KEY);
      const legacyGuestCategories = [...new Set([
        ...cachedGuestCategories,
        ...guestCached.map(song => String(song.category || '').trim()).filter(Boolean),
      ])];
      const cacheKey = accountCacheKey(account.id);
      const accountCached = readCache(cacheKey);

      if (guestCached.length || legacyGuestCategories.length) {
        updateSharedSyncState(markFavoritesSyncPending());
        const attempt = markFavoritesSyncAttempt();
        updateSharedSyncState(attempt);
        try {
          const imported = await syncAccountFavorites(guestCached, legacyGuestCategories, account.id);
          assertCurrent();
          if (!imported.success) throw new Error(imported.error || '收藏同步失败');
          const next = imported.favorites || [];
          if (imported.complete) {
            if (JSON.stringify(readCache(GUEST_CACHE_KEY)) !== JSON.stringify(guestCached)
              || JSON.stringify(readCategories(GUEST_CATEGORIES_KEY)) !== JSON.stringify(cachedGuestCategories)) {
              throw new Error('本机游客缓存已更新，已保存的数据不会丢失，请重试迁移');
            }
            removeCache(GUEST_CACHE_KEY);
            try { localStorage.removeItem(GUEST_CATEGORIES_KEY); } catch { /* storage unavailable */ }
            if (imported.categories) {
              writeCategories(categoriesCacheKey(account.id), imported.categories);
              setCategories(imported.categories);
            }
            const syncResult = imported.identitySame ? 'identity_same' : 'merged';
            updateSharedSyncState(markFavoritesSyncResult(syncResult, attempt));
          } else {
            updateSharedSyncState(markFavoritesSyncFailed(
              `账户收藏容量不足，${imported.dropped || 0} 首歌曲仍保留在本机`,
              attempt,
            ));
          }
          updateSharedFavorites(next);
        } catch (error) {
          if (generation === loadGeneration) updateSharedSyncState(markFavoritesSyncFailed(error, attempt));
          throw error;
        }
        return { success: true };
      }

      const [result, categoryResult] = await Promise.all([listFavorites(), listFavoriteCategories()]);
      assertCurrent();
      if (!result.success) throw new Error(result.error || '收藏列表加载失败');
      if (!categoryResult.success) throw new Error(categoryResult.error || '收藏分类加载失败');
      if (accountCached.length) removeCache(cacheKey);
      removeCache(categoriesCacheKey(account.id));
      setCategories(categoryResult.categories || []);
      updateSharedFavorites(result.favorites || []);
      return { success: true };
    })().catch((error): FavoritesLoadResult => ({
      success: false,
      error: error instanceof Error ? error.message : '收藏列表加载失败，请重试',
    }));
    loadPromise = pending;
    void pending.then(() => {
      if (loadPromise === pending) loadPromise = null;
    });
    return pending;
  }, [listFavoriteCategories, listFavorites]);

  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  useEffect(() => {
    const onAccountSessionChanged = () => {
      setCategories([]);
      if (readCache(GUEST_CACHE_KEY).length || readCategories(GUEST_CATEGORIES_KEY).length) updateSharedSyncState(markFavoritesSyncPending());
      void ensureLoaded();
    };
    const onStorage = (event: StorageEvent) => {
      if (isAccountSessionRevisionEvent(event)) onAccountSessionChanged();
    };
    window.addEventListener('openmusic:account-session-changed', onAccountSessionChanged);
    window.addEventListener('openmusic:account-auth-required', onAccountSessionChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('openmusic:account-session-changed', onAccountSessionChanged);
      window.removeEventListener('openmusic:account-auth-required', onAccountSessionChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, [ensureLoaded]);

  useEffect(() => {
    const retryWhenOnline = () => {
      if (!loadPromise) void ensureLoaded();
    };
    window.addEventListener('online', retryWhenOnline);
    window.addEventListener('openmusic:socket-connected', retryWhenOnline);
    return () => {
      window.removeEventListener('online', retryWhenOnline);
      window.removeEventListener('openmusic:socket-connected', retryWhenOnline);
    };
  }, [ensureLoaded]);

  useEffect(() => {
    if (syncState.status !== 'failed' || retryTimer.current !== null) return undefined;
    const delay = Math.min(60_000, 2_000 * (2 ** Math.min(syncState.retryCount, 5)));
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      loadPromise = null;
      void ensureLoaded();
    }, delay);
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [ensureLoaded, syncState.retryCount, syncState.status]);

  const isFavorite = useCallback(
    (song: Song | null) => (song ? favoriteIds.has(songKey(song)) : false),
    [favoriteIds],
  );

  const toggleFavorite = useCallback(async (song: Song) => {
    const key = songKey(song);
    const favorite = !favoriteIds.has(key);
    try {
      const result = await runFavoriteRequest(() => setFavorite(song, favorite), (next) => {
        if (next.favorites) updateSharedFavorites(next.favorites);
      });
      if (!result.success) throw new Error(result.error || '收藏失败');
      window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
        detail: { message: favorite ? '已收藏' : '已取消收藏', type: 'success' },
      }));
      return { success: true as const, favorites: result.favorites || sharedFavoriteSongs };
    } catch (error) {
      const message = error instanceof Error ? error.message : '收藏失败，请稍后重试';
      window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
        detail: { message, type: 'error' },
      }));
      return { success: false as const, error: message };
    }
  }, [favoriteIds, setFavorite]);

  const applyFavorites = useCallback((favorites: FavoriteSong[]) => {
    updateSharedFavorites(favorites);
  }, []);

  const reloadFavorites = useCallback(async () => {
    loadPromise = null;
    await ensureLoaded();
  }, [ensureLoaded]);

  const retryFavoritesSync = useCallback(async () => {
    updateSharedSyncState(markFavoritesSyncPending());
    loadPromise = null;
    await ensureLoaded();
    return readFavoritesSyncState();
  }, [ensureLoaded]);

  const listCachedFavorites = useCallback(async () => {
    const result = await ensureLoaded();
    return { ...result, favorites: result.success ? sharedFavoriteSongs : [] };
  }, [ensureLoaded]);

  const listCachedCategories = useCallback(async () => {
    const loaded = await ensureLoaded();
    if (!loaded.success) return { success: false, categories: [], error: loaded.error };
    const generation = loadGeneration;
    const result = await listFavoriteCategories();
    if (generation !== loadGeneration) return { success: false, categories: [], error: '账户已变化，请重新读取收藏' };
    if (result.success) setCategories(result.categories || []);
    return result;
  }, [ensureLoaded, listFavoriteCategories]);

  const addFavoriteCategory = useCallback(async (name: string) => {
    return runFavoriteRequest(() => createFavoriteCategory(name), (result, accountId) => {
      if (result.categories) {
        if (accountId) removeCache(categoriesCacheKey(accountId));
        setCategories(result.categories);
      }
    });
  }, [createFavoriteCategory]);

  const setCachedFavoriteCategory = useCallback(async (song: FavoriteSong, category: string) => {
    return runFavoriteRequest(() => setFavoriteCategory(song, category), (result) => {
      if (result.favorites) updateSharedFavorites(result.favorites);
    });
  }, [setFavoriteCategory]);

  const deleteCategory = useCallback(async (name: string, keepSongs: boolean) => {
    return runFavoriteRequest(() => deleteFavoriteCategory(name, keepSongs), (result) => {
      if (result.favorites) updateSharedFavorites(result.favorites);
      if (result.categories) setCategories(result.categories);
    });
  }, [deleteFavoriteCategory]);

  const setCachedFavorite = useCallback(async (song: Song, favorite: boolean) => {
    if (favoriteIds.has(songKey(song)) !== favorite) return toggleFavorite(song);
    return { success: true as const, favorites: sharedFavoriteSongs, favorite };
  }, [favoriteIds, toggleFavorite]);

  const importCachedFavorites = useCallback(async (songs: Song[]) => {
    return runFavoriteRequest(() => importFavoritesOnServer(songs), (result) => {
      if (result.favorites) updateSharedFavorites(result.favorites);
    });
  }, [importFavoritesOnServer]);

  return {
    favoriteIds,
    favorites: favoriteSongs,
    isFavorite,
    toggleFavorite,
    listFavorites: listCachedFavorites,
    setFavorite: setCachedFavorite,
    setFavoriteCategory: setCachedFavoriteCategory,
    importFavorites: importCachedFavorites,
    applyFavorites,
    reloadFavorites,
    syncState,
    retryFavoritesSync,
    categories,
    listCategories: listCachedCategories,
    addCategory: addFavoriteCategory,
    deleteCategory,
  };
}
