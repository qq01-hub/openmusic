import { useCallback, useMemo, useRef } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from './useSocket';
import { useFavorites } from './useFavorites';
import { songKey } from '../api/music';
import { resolveDislikeSkipThreshold } from '../lib/dislikeSkip';
import { useSourceErrorRevision } from './useSongSourceError';
import { isTrackSourceError, isTrackCrossSource, getTrackCrossSourceFrom } from '../lib/songPreloadCache';
import { useChatSystemToastStore } from '../stores/chatSystemToastStore';
import type { FavoriteSong, MusicSource } from '../types';
import type { QueueRowSong } from '../lib/queueSearch';

export type QueueSourceStatus = {
  error: boolean;
  cross: boolean;
  crossFrom?: MusicSource;
};

export function useQueueRowActions() {
  const queue = useRoomStore((s) => s.room?.queue);
  const currentSong = useRoomStore((s) => s.room?.current);
  const memberTiers = useRoomStore((s) => s.room?.memberTiers);
  const hasRoom = useRoomStore((s) => Boolean(s.room));
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const memberJumpEnabled = useRoomStore((s) => Boolean(s.room?.memberJumpEnabled));
  const dislikeSkipThreshold = useRoomStore((s) => resolveDislikeSkipThreshold(s.room));
  const hasManualOrder = useRoomStore((s) => (s.room?.queue || []).some((song) => Number.isFinite(song.manualOrder)));
  const queueLikeSortEnabled = useRoomStore((s) => s.room?.queueLikeSortEnabled !== false);
  const isUserRoundRobin = useRoomStore((s) => s.room?.playMode === 'user-round-robin');
  const likeOrderScope: 'queue' | 'requester' | 'none' = !queueLikeSortEnabled
    ? 'none'
    : isUserRoundRobin
      ? 'requester'
      : hasManualOrder
        ? 'none'
        : 'queue';

  const {
    removeSong,
    requestJump,
    reorderQueue,
    toggleQueueLike,
    toggleCurrentDislike,
    banRoomSong,
  } = useSocket();

  const {
    favoriteIds,
    favorites,
    categories: favoriteCategories,
    toggleFavorite,
    setFavorite,
    setFavoriteCategory,
  } = useFavorites();

  const sourceErrorRevision = useSourceErrorRevision();

  const favoriteSongMap = useMemo(() => {
    const map = new Map<string, FavoriteSong>();
    for (const item of favorites) {
      map.set(songKey(item), item);
    }
    return map;
  }, [favorites]);

  const favoriteSongMapRef = useRef(favoriteSongMap);
  favoriteSongMapRef.current = favoriteSongMap;

  const handleSelectFavoriteCategory = useCallback(async (song: QueueRowSong, category: string) => {
    try {
      const sKey = songKey(song);
      let target: FavoriteSong | undefined = favoriteSongMapRef.current.get(sKey);
      if (!target) {
        const added = await setFavorite(song, true);
        if (!added.success) throw new Error(added.error || '收藏失败');
        target = (added.favorites || []).find((item) => songKey(item) === sKey)
          || { ...song, category };
      }
      const result = await setFavoriteCategory(target, category);
      if (!result.success) throw new Error(result.error || '分类更新失败');
      window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
        detail: { message: category ? `已加入收藏 · ${category}` : '已加入收藏 · 未分类', type: 'success' },
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
        detail: { message: error instanceof Error ? error.message : '收藏分类保存失败', type: 'error' },
      }));
      throw error;
    }
  }, [setFavorite, setFavoriteCategory]);

  const queuedSongs = useMemo<QueueRowSong[]>(
    () => (queue || []).map((song) => ({ ...song, isCurrent: false })),
    [queue],
  );
  const allSongs = useMemo<QueueRowSong[]>(() => [
    ...(currentSong ? [{ ...currentSong, isCurrent: true }] : []),
    ...queuedSongs,
  ], [queuedSongs, currentSong]);

  const sourceStatusMap = useMemo(() => {
    const map = new Map<string, QueueSourceStatus>();
    for (const song of allSongs) {
      const error = isTrackSourceError(song);
      const cross = isTrackCrossSource(song);
      if (error || cross) {
        map.set(song.queueId, { error, cross, crossFrom: cross ? getTrackCrossSourceFrom(song) : undefined });
      }
    }
    return map;
  }, [allSongs, sourceErrorRevision]);

  const showQueueMessage = useCallback((message: string) => {
    useChatSystemToastStore.getState().show(message);
  }, []);

  const handleJumpRequest = useCallback(async (queueId: string) => {
    const res = await requestJump(queueId);
    if (res.success) {
      showQueueMessage(canControlPlayback ? '已插队到下一首，优先于点赞排序' : '已插队到下一首');
    } else {
      showQueueMessage(res.error || '插队失败');
    }
  }, [canControlPlayback, requestJump, showQueueMessage]);

  const handleLike = useCallback(async (queueId: string) => {
    const res = await toggleQueueLike(queueId);
    if (!res.success && res.error) showQueueMessage(res.error);
  }, [showQueueMessage, toggleQueueLike]);

  const handleDislike = useCallback(async () => {
    const res = await toggleCurrentDislike();
    if (!res.success) {
      showQueueMessage(res.error || '踩歌失败');
      return;
    }
    if (res.skipped) {
      showQueueMessage('踩歌人数已满，已切歌');
    }
  }, [showQueueMessage, toggleCurrentDislike]);

  const handleBanSong = useCallback(async (song: QueueRowSong) => {
    const res = await banRoomSong({
      id: song.id,
      source: song.source || 'netease',
      name: song.name,
      artist: song.artist,
      album: song.album,
      pic: song.pic,
      duration: song.duration,
      url: song.url,
      lrc: song.lrc,
    });
    if (res.success) {
      showQueueMessage('已禁播并移出队列');
    } else {
      showQueueMessage(res.error || '禁播失败');
    }
  }, [banRoomSong, showQueueMessage]);

  return {
    queue,
    currentSong,
    allSongs,
    memberTiers,
    hasRoom,
    nickname,
    mySocketId,
    canControlPlayback,
    memberJumpEnabled,
    dislikeSkipThreshold,
    likeOrderScope,
    sourceStatusMap,
    favoriteIds,
    favoriteSongMap,
    favoriteCategories,
    reorderQueue,
    removeSong,
    toggleFavorite,
    showQueueMessage,
    handleJumpRequest,
    handleLike,
    handleDislike,
    handleBanSong,
    handleSelectFavoriteCategory,
  };
}
