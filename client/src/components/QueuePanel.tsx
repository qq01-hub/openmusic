import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo, type KeyboardEvent } from 'react';
import { Music, Search, X } from 'lucide-react';
import { songKey } from '../api/music';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import QueueRow, { QUEUE_ITEM_SIZE, QUEUE_ROW_GAP, QUEUE_ROW_HEIGHT } from './queue/QueueRow';
import QueueTip from './queue/QueueTip';
import type { RoomMemberTier, QueueItem, FavoriteSong, Song } from '../types';
import { useQueueRowActions, type QueueSourceStatus } from '../hooks/useQueueRowActions';
import { filterQueueSongs, type QueueRowSong, type QueueSearchMatch } from '../lib/queueSearch';

const VISIBLE_ROWS = 3;
const LIST_HEIGHT = VISIBLE_ROWS * QUEUE_ROW_HEIGHT + (VISIBLE_ROWS - 1) * QUEUE_ROW_GAP;
const VIRTUAL_OVERSCAN_COUNT = 2;

type RowData = {
  matches: QueueSearchMatch[];
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
  sourceStatusMap: Map<string, QueueSourceStatus>;
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
  const match = data.matches[index];
  if (!match) return null;
  const { song, queueIndex } = match;
  const memberTier = song.requestedById ? data.memberTiers?.[song.requestedById] : undefined;
  const ss = data.sourceStatusMap.get(song.queueId);
  const sKey = songKey(song);
  return (
    <div style={style} data-queue-row={song.queueId}>
      <div style={{ height: QUEUE_ITEM_SIZE, paddingBottom: QUEUE_ROW_GAP }}>
        <QueueRow
          song={song}
          index={queueIndex}
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
  searchOpen?: boolean;
  onCloseSearch?: () => void;
  onArtistClick?: (artist: string) => void;
  onShareSong?: (song: QueueItem) => void;
}

export default memo(function QueuePanel({
  fillHeight = false,
  searchOpen = false,
  onCloseSearch,
  onArtistClick,
  onShareSong,
}: Props) {
  const {
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
  } = useQueueRowActions();
  const [dragFromId, setDragFromId] = useState<string | null>(null);
  const [dragOverQueueId, setDragOverQueueId] = useState<string | null>(null);
  const listRef = useRef<FixedSizeList>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [virtualListHeight, setVirtualListHeight] = useState(LIST_HEIGHT);
  const dragFromIdRef = useRef<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const currentKey = currentSong?.queueId || '';
  const prevCurrentKeyRef = useRef(currentKey);
  const trimmedKeyword = searchOpen ? searchKeyword.trim() : '';
  const isFiltering = trimmedKeyword.length > 0;

  const displayedMatches = useMemo<QueueSearchMatch[]>(() => {
    if (isFiltering) {
      return filterQueueSongs(allSongs, trimmedKeyword);
    }
    return allSongs.map((song, queueIndex) => ({ song, queueIndex, score: 1 }));
  }, [allSongs, isFiltering, trimmedKeyword]);

  const hasDisplayedSongs = displayedMatches.length > 0;

  useEffect(() => {
    if (!searchOpen) {
      setSearchKeyword('');
      return;
    }
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);

  useEffect(() => {
    listRef.current?.scrollTo(0);
  }, [trimmedKeyword]);

  useLayoutEffect(() => {
    if (!fillHeight || !hasRoom || !hasDisplayedSongs) return;
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
  }, [fillHeight, hasRoom, hasDisplayedSongs, searchOpen]);

  // 仅在「当前曲目切换」时跟滚；点赞/插队等队列重排不要拽回顶部
  useEffect(() => {
    const switched = prevCurrentKeyRef.current !== currentKey;
    prevCurrentKeyRef.current = currentKey;
    if (!switched || !currentKey || isFiltering) return;

    const idx = allSongs.findIndex((song) => song.isCurrent);
    if (idx >= 0) listRef.current?.scrollToItem(idx, 'smart');
  }, [currentKey, allSongs, isFiltering]);

  const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setSearchKeyword('');
    onCloseSearch?.();
  }, [onCloseSearch]);

  const handleClearSearch = useCallback(() => {
    setSearchKeyword('');
    searchInputRef.current?.focus();
  }, []);

  const handleCloseSearch = useCallback(() => {
    setSearchKeyword('');
    onCloseSearch?.();
  }, [onCloseSearch]);

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
    matches: displayedMatches,
    memberTiers,
    mySocketId,
    nickname,
    canControlPlayback,
    memberJumpEnabled,
    dislikeSkipThreshold,
    canReorder: canControlPlayback && !isFiltering,
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
    displayedMatches,
    memberTiers,
    mySocketId,
    nickname,
    canControlPlayback,
    memberJumpEnabled,
    dislikeSkipThreshold,
    isFiltering,
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

  const searchBarNode = searchOpen ? (
    <div className="mb-2 flex shrink-0 items-center gap-1.5" data-queue-inline-search>
      <div className="relative flex min-w-0 flex-1 items-center rounded-xl border border-white/10 bg-black/25 px-2.5 py-1.5 transition-colors focus-within:border-netease-red/60">
        <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-netease-muted" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchKeyword}
          onChange={(event) => setSearchKeyword(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="搜索歌名、歌手、专辑或点歌人"
          aria-label="搜索播放队列"
          className="min-w-0 flex-1 bg-transparent text-xs text-white placeholder:text-netease-muted focus:outline-none"
        />
        {isFiltering && (
          <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-netease-muted">
            {displayedMatches.length} / {allSongs.length}
          </span>
        )}
        {searchKeyword && (
          <QueueTip content="清空关键词">
            <button
              type="button"
              onClick={handleClearSearch}
              className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
              aria-label="清空搜索词"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </QueueTip>
        )}
      </div>
      {onCloseSearch && (
        <button
          type="button"
          onClick={handleCloseSearch}
          className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
        >
          收起
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className={`flex flex-col ${fillHeight ? 'h-full min-h-0' : ''}`}>
      {searchBarNode}
      {allSongs.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center text-netease-muted ${
            fillHeight ? 'flex-1 min-h-0' : ''
          }`}
          style={fillHeight ? undefined : { height: LIST_HEIGHT }}
        >
          <Music className="w-7 h-7 mb-2 opacity-30" />
          <p className="text-xs text-center">队列为空，搜索或双击点歌</p>
        </div>
      ) : displayedMatches.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center px-4 text-center text-netease-muted ${
            fillHeight ? 'flex-1 min-h-0' : ''
          }`}
          style={fillHeight ? undefined : { height: LIST_HEIGHT }}
        >
          <Search className="mb-2 h-6 w-6 opacity-35" />
          <p className="text-xs text-white/75">未找到与「{trimmedKeyword}」匹配的歌曲</p>
          <p className="mt-1 text-[11px] text-netease-muted">换个歌名、歌手、专辑或点歌人试试</p>
          <button
            type="button"
            onClick={handleClearSearch}
            className="mt-2.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            清空搜索
          </button>
        </div>
      ) : (
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
            itemCount={displayedMatches.length}
            itemSize={QUEUE_ITEM_SIZE}
            itemData={rowData}
            itemKey={(index, data) => data.matches[index]?.song.queueId ?? index}
            overscanCount={VIRTUAL_OVERSCAN_COUNT}
          >
            {VirtualQueueRow}
          </FixedSizeList>
        </div>
      )}
    </div>
  );
});
