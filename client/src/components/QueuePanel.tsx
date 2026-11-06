import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Music } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import { useFavorites } from '../hooks/useFavorites';
import { songKey } from '../api/music';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import QueueRow, { QUEUE_ITEM_SIZE, QUEUE_ROW_GAP, QUEUE_ROW_HEIGHT } from './queue/QueueRow';
import type { RoomMemberTier, QueueItem, MusicSource, FavoriteSong, Song } from '../types';
import { resolveDislikeSkipThreshold } from '../lib/dislikeSkip';
import { useSourceErrorRevision } from '../hooks/useSongSourceError';
import { isTrackSourceError, isTrackCrossSource, getTrackCrossSourceFrom } from '../lib/songPreloadCache';
import { useChatSystemToastStore } from '../stores/chatSystemToastStore';

const VISIBLE_ROWS = 3;
const LIST_HEIGHT = VISIBLE_ROWS * QUEUE_ROW_HEIGHT + (VISIBLE_ROWS - 1) * QUEUE_ROW_GAP;
const VIRTUAL_OVERSCAN_COUNT = 2;

type QueueRowSong = QueueItem & { isCurrent: boolean };

type SourceStatus = { error: boolean; cross: boolean; crossFrom?: MusicSource };

type RowData = {
  songs: QueueRowSong[];
  memberTiers: Record<string, RoomMemberTier> | undefined;
  mySocketId: string | null;
  nickname: string;
  canControlPlayback: boolean;
  memberJumpEnabled: boolean;
  dislikeSkipThreshold: number;
  canReorder: boolean;
  likeOrderScope: 'queue' | 'requester' | 'none';
  dragFromId: string | null;
  dragOverQueueId: string | null;
  sourceStatusMap: Map<string, SourceStatus>;
  favoriteIds: Set<string>;
  favoriteSongMap: Map<string, FavoriteSong>;
  favoriteCategories: string[];
  onLike: (queueId: string) => void;
  onDislike: () => void;
  onJump: (queueId: string) => void;
  onRemove: (queueId: string) => void;
  onBan: (song: QueueRowSong) => void;
  onArtistClick?: (artist: string) => void;
  onShareSong?: (song: QueueRowSong) => void;
  onDragStart: (queueId: string) => void;
  onDragOver: (queueId: string) => void;
  onDrop: (queueId: string) => void;
  onDragEnd: () => void;
  onToggleFavorite: (song: Song) => Promise<{ success: boolean; error?: string }>;
  onSelectFavoriteCategory: (song: QueueRowSong, category: string) => Promise<void>;
};

const VirtualQueueRow = memo(function VirtualQueueRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const song = data.songs[index];
  if (!song) return null;
  const memberTier = song.requestedById ? data.memberTiers?.[song.requestedById] : undefined;
  const ss = data.sourceStatusMap.get(song.queueId);
  const sKey = songKey(song);
  return (
    <div style={style} data-queue-row={song.queueId}>
      <div style={{ height: QUEUE_ITEM_SIZE, paddingBottom: QUEUE_ROW_GAP }}>
        <QueueRow
          song={song}
          index={index}
          memberTier={memberTier}
          mySocketId={data.mySocketId}
          nickname={data.nickname}
          canControlPlayback={data.canControlPlayback}
          memberJumpEnabled={data.memberJumpEnabled}
          dislikeSkipThreshold={data.dislikeSkipThreshold}
          canReorder={data.canReorder}
          likeOrderScope={data.likeOrderScope}
          isDragOver={Boolean(
            data.dragOverQueueId
            && data.dragOverQueueId === song.queueId
            && data.dragFromId !== song.queueId
            && !song.isCurrent
          )}
          onLike={data.onLike}
          onDislike={song.isCurrent ? data.onDislike : undefined}
          onShare={data.onShareSong}
          onJump={data.onJump}
          onRemove={data.onRemove}
          onBan={data.onBan}
          onArtistClick={data.onArtistClick}
          onDragStart={data.onDragStart}
          onDragOver={data.onDragOver}
          onDrop={data.onDrop}
          onDragEnd={data.onDragEnd}
          hasSourceError={ss?.error}
          hasCrossSource={ss?.cross}
          crossSourceFrom={ss?.crossFrom}
          isFavorited={data.favoriteIds.has(sKey)}
          favoriteCategory={data.favoriteSongMap.get(sKey)?.category || ''}
          favoriteCategories={data.favoriteCategories}
          onToggleFavorite={data.onToggleFavorite}
          onSelectFavoriteCategory={data.onSelectFavoriteCategory}
        />
      </div>
    </div>
  );
});

interface Props {
  fillHeight?: boolean;
  onArtistClick?: (artist: string) => void;
  onShareSong?: (song: QueueItem) => void;
}

export default function QueuePanel({ fillHeight = false, onArtistClick, onShareSong }: Props) {
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
  const likeOrderScope = !queueLikeSortEnabled ? 'none'
    : isUserRoundRobin ? 'requester'
      : hasManualOrder ? 'none' : 'queue';
  const { removeSong, requestJump, reorderQueue, toggleQueueLike, toggleCurrentDislike, banRoomSong } = useSocket();
  const {
    favoriteIds,
    favorites,
    categories: favoriteCategories,
    toggleFavorite,
    setFavorite,
    setFavoriteCategory,
  } = useFavorites();
  const [dragFromId, setDragFromId] = useState<string | null>(null);
  const [dragOverQueueId, setDragOverQueueId] = useState<string | null>(null);
  const listRef = useRef<FixedSizeList>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [virtualListHeight, setVirtualListHeight] = useState(LIST_HEIGHT);
  const dragFromIdRef = useRef<string | null>(null);

  // Single subscription for source error/cross-source changes at the panel level
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
  const allSongs = useMemo<QueueRowSong[]>(() => {
    return [
      ...(currentSong ? [{ ...currentSong, isCurrent: true }] : []),
      ...queuedSongs,
    ];
  }, [queuedSongs, currentSong]);

  const sourceStatusMap = useMemo(() => {
    const map = new Map<string, SourceStatus>();
    for (const song of allSongs) {
      const error = isTrackSourceError(song);
      const cross = isTrackCrossSource(song);
      if (error || cross) {
        map.set(song.queueId, { error, cross, crossFrom: cross ? getTrackCrossSourceFrom(song) : undefined });
      }
    }
    return map;
  }, [allSongs, sourceErrorRevision]);

  const currentKey = currentSong?.queueId || '';
  const hasSongs = allSongs.length > 0;
  const prevCurrentKeyRef = useRef(currentKey);

  useLayoutEffect(() => {
    if (!fillHeight || !hasRoom || !hasSongs) return;
    const container = listContainerRef.current;
    if (!container) return;
    const h = Math.floor(container.clientHeight);
    if (h > 0) setVirtualListHeight(h);
    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.height ?? 0);
      if (next > 0) setVirtualListHeight(next);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [fillHeight, hasRoom, hasSongs]);

  // 仅在「当前曲目切换」时跟滚；点赞/插队等队列重排不要拽回顶部
  useEffect(() => {
    const switched = prevCurrentKeyRef.current !== currentKey;
    prevCurrentKeyRef.current = currentKey;
    if (!switched || !currentKey) return;

    const idx = allSongs.findIndex((song) => song.isCurrent);
    if (idx >= 0) listRef.current?.scrollToItem(idx, 'smart');
  }, [currentKey, allSongs]);

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

  const handleDragStart = useCallback((queueId: string) => {
    dragFromIdRef.current = queueId;
    setDragFromId(queueId);
  }, []);

  const handleDragOver = useCallback((queueId: string) => {
    setDragOverQueueId((prev) => (prev === queueId ? prev : queueId));
  }, []);

  const autoScrollRef = useRef<number>(0);

  useEffect(() => () => cancelAnimationFrame(autoScrollRef.current), []);

  const handleDragEnd = useCallback(() => {
    dragFromIdRef.current = null;
    setDragFromId(null);
    setDragOverQueueId(null);
    cancelAnimationFrame(autoScrollRef.current);
  }, []);

  const handleContainerDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = listContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const edgeZone = 50;
    const scrollEl = scrollRootRef.current;
    if (!scrollEl) return;

    cancelAnimationFrame(autoScrollRef.current);
    if (y < edgeZone) {
      const speed = Math.max(2, (edgeZone - y) * 0.3);
      autoScrollRef.current = requestAnimationFrame(() => { scrollEl.scrollTop -= speed; });
    } else if (y > rect.height - edgeZone) {
      const speed = Math.max(2, (y - (rect.height - edgeZone)) * 0.3);
      autoScrollRef.current = requestAnimationFrame(() => { scrollEl.scrollTop += speed; });
    }
  }, []);

  const handleDrop = useCallback(async (targetQueueId: string) => {
    cancelAnimationFrame(autoScrollRef.current);
    const fromId = dragFromIdRef.current;
    dragFromIdRef.current = null;
    setDragFromId(null);
    setDragOverQueueId(null);
    if (!fromId || fromId === targetQueueId || !canControlPlayback) return;

    const queueIds = (queue || []).map((s) => s.queueId).filter(Boolean);
    const fromIndex = queueIds.indexOf(fromId);
    const toIndex = queueIds.indexOf(targetQueueId);
    if (fromIndex < 0 || toIndex < 0) return;

    const next = [...queueIds];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);

    const res = await reorderQueue(next, fromId);
    if (!res.success) {
      showQueueMessage(res.error || '排序失败');
    }
  }, [canControlPlayback, queue, reorderQueue, showQueueMessage]);

  const rowData = useMemo<RowData>(() => ({
    songs: allSongs,
    memberTiers,
    mySocketId,
    nickname,
    canControlPlayback,
    memberJumpEnabled,
    dislikeSkipThreshold,
    canReorder: canControlPlayback,
    likeOrderScope,
    dragFromId,
    dragOverQueueId,
    sourceStatusMap,
    favoriteIds,
    favoriteSongMap,
    favoriteCategories,
    onLike: handleLike,
    onDislike: handleDislike,
    onJump: handleJumpRequest,
    onRemove: removeSong,
    onBan: handleBanSong,
    onArtistClick,
    onShareSong,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd,
    onToggleFavorite: toggleFavorite,
    onSelectFavoriteCategory: handleSelectFavoriteCategory,
  }), [
    allSongs,
    memberTiers,
    mySocketId,
    nickname,
    canControlPlayback,
    memberJumpEnabled,
    dislikeSkipThreshold,
    likeOrderScope,
    dragFromId,
    dragOverQueueId,
    sourceStatusMap,
    favoriteIds,
    favoriteSongMap,
    favoriteCategories,
    handleLike,
    handleDislike,
    handleJumpRequest,
    removeSong,
    handleBanSong,
    onArtistClick,
    onShareSong,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    toggleFavorite,
    handleSelectFavoriteCategory,
  ]);

  if (!hasRoom) return null;

  if (allSongs.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center text-netease-muted ${
          fillHeight ? 'flex-1 min-h-0' : ''
        }`}
        style={fillHeight ? undefined : { height: LIST_HEIGHT }}
      >
        <Music className="w-7 h-7 mb-2 opacity-30" />
        <p className="text-xs text-center">队列为空，搜索或双击点歌</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${fillHeight ? 'h-full min-h-0' : ''}`}>
      <div
        ref={listContainerRef}
        className={`pr-0.5 ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={fillHeight ? undefined : { height: LIST_HEIGHT }}
        onDragOver={handleContainerDragOver}
      >
        <FixedSizeList
          className="queue-scroll-viewport"
          ref={listRef}
          outerRef={scrollRootRef}
          height={fillHeight ? virtualListHeight : LIST_HEIGHT}
          width="100%"
          itemCount={allSongs.length}
          itemSize={QUEUE_ITEM_SIZE}
          itemData={rowData}
          itemKey={(index, data) => data.songs[index]?.queueId ?? index}
          overscanCount={VIRTUAL_OVERSCAN_COUNT}
        >
          {VirtualQueueRow}
        </FixedSizeList>
      </div>
    </div>
  );
}
