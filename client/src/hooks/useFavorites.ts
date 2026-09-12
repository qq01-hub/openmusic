import { useCallback, useEffect, useState } from 'react';
import { songKey } from '../api/music';
import { useSocket } from './useSocket';
import type { FavoriteSong, Song } from '../types';

let sharedFavoriteIds = new Set<string>();
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function updateSharedFavoriteIds(ids: Set<string>) {
  sharedFavoriteIds = ids;
  notifyListeners();
}

export function useFavorites() {
  const { listFavorites, setFavorite } = useSocket();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(sharedFavoriteIds));

  useEffect(() => {
    const listener = () => setFavoriteIds(new Set(sharedFavoriteIds));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const ensureLoaded = useCallback(async () => {
    if (loadPromise) return loadPromise;
    loadPromise = listFavorites().then((res) => {
      if (res.success) {
        updateSharedFavoriteIds(new Set((res.favorites || []).map((item) => songKey(item))));
      }
    });
    return loadPromise;
  }, [listFavorites]);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  useEffect(() => {
    const onAccountSessionChanged = () => {
      loadPromise = null;
      updateSharedFavoriteIds(new Set());
      void ensureLoaded();
    };
    window.addEventListener('openmusic:account-session-changed', onAccountSessionChanged);
    return () => window.removeEventListener('openmusic:account-session-changed', onAccountSessionChanged);
  }, [ensureLoaded]);

  const isFavorite = useCallback(
    (song: Song | null) => (song ? favoriteIds.has(songKey(song)) : false),
    [favoriteIds],
  );

  const toggleFavorite = useCallback(async (song: Song) => {
    const key = songKey(song);
    const nextFavorite = !favoriteIds.has(key);
    const res = await setFavorite(song, nextFavorite);
    if (!res.success) {
      return { success: false as const, error: res.error || '收藏失败' };
    }

    if (res.favorites) {
      updateSharedFavoriteIds(new Set(res.favorites.map((item) => songKey(item))));
    } else {
      const next = new Set(favoriteIds);
      if (nextFavorite) next.add(key);
      else next.delete(key);
      updateSharedFavoriteIds(next);
    }

    return { success: true as const };
  }, [favoriteIds, setFavorite]);

  const applyFavorites = useCallback((favorites: FavoriteSong[]) => {
    updateSharedFavoriteIds(new Set(favorites.map((item) => songKey(item))));
  }, []);

  const reloadFavorites = useCallback(async () => {
    loadPromise = null;
    await ensureLoaded();
  }, [ensureLoaded]);

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
    applyFavorites,
    reloadFavorites,
  };
}
