import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Music } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import QueueRow, { QUEUE_ITEM_SIZE, QUEUE_ROW_GAP, QUEUE_ROW_HEIGHT } from './queue/QueueRow';
import type { RoomMemberTier, QueueItem, MusicSource } from '../types';
import { resolveDislikeSkipThreshold } from '../lib/dislikeSkip';
import { useSourceErrorRevision } from '../hooks/useSongSourceError';
import { isTrackSourceError, isTrackCrossSource, getTrackCrossSourceFrom } from '../lib/songPreloadCache';
import { useChatSystemToastStore } from '../stores/chatSystemToastStore';

const VISIBLE_ROWS = 3;
const LIST_HEIGHT = VISIBLE_ROWS * QUEUE_ROW_HEIGHT + (VISIBLE_ROWS - 1) * QUEUE_ROW_GAP;
const VIRTUAL_THRESHOLD = 5;

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
  likeRaisesOrder: boolean;
  dragOverQueueId: string | null;
  sourceStatusMap: Map<string, SourceStatus>;
  currentRef: React.RefObject<HTMLDivElement | null>;
  onLike: (queueId: string) => void;
  onDislike: () => void;
  onJump: (queueId: string) => void;
  onRemove: (queueId: string) => void;
  onBan: (song: QueueRowSong) => void;
  onArtistClick?: (artist: string) => void;
  onDragStart: (queueId: string) => void;
  onDragOver: (queueId: string) => void;
  onDrop: (queueId: string) => void;
  onDragEnd: () => void;
};

const VirtualQueueRow = memo(function VirtualQueueRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const song = data.songs[index];
  if (!song) return null;
  const memberTier = song.requestedById ? data.memberTiers?.[song.requestedById] : undefined;
  const ss = data.sourceStatusMap.get(song.queueId);
  return (
    <div style={style}>
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
          likeRaisesOrder={data.likeRaisesOrder}
          isDragOver={Boolean(
            data.dragOverQueueId
            && data.dragOverQueueId === song.queueId
            && !song.isCurrent
          )}
          rowRef={song.isCurrent ? data.currentRef : undefined}
          onLike={data.onLike}
          onDislike={song.isCurrent ? data.onDislike : undefined}
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
        />
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.index !== next.index) return false;
  const prevSong = prev.data.songs[prev.index];
  const nextSong = next.data.songs[next.index];
  if (prevSong !== nextSong) return false;
  if (prev.data.dragOverQueueId !== next.data.dragOverQueueId) {
    const qid = nextSong?.queueId;
    if (prev.data.dragOverQueueId === qid || next.data.dragOverQueueId === qid) return false;
  }
  if (prev.data.canControlPlayback !== next.data.canControlPlayback) return false;
  if (prev.data.memberTiers !== next.data.memberTiers) return false;
  if (prev.data.sourceStatusMap !== next.data.sourceStatusMap) {
    const qid = nextSong?.queueId;
    if (qid) {
      const ps = prev.data.sourceStatusMap.get(qid);
      const ns = next.data.sourceStatusMap.get(qid);
      if (ps !== ns && (ps?.error !== ns?.error || ps?.cross !== ns?.cross)) return false;
    }
  }
  return true;
});

interface Props {
  fillHeight?: boolean;
  onArtistClick?: (artist: string) => void;
}

export default function QueuePanel({ fillHeight = false, onArtistClick }: Props) {
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
  const likeRaisesOrder = !hasManualOrder;
  const { removeSong, requestJump, reorderQueue, toggleQueueLike, toggleCurrentDislike, banRoomSong } = useSocket();
  const [dragFromId, setDragFromId] = useState<string | null>(null);
  const [dragOverQueueId, setDragOverQueueId] = useState<string | null>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [virtualListHeight, setVirtualListHeight] = useState(LIST_HEIGHT);
  const dragFromIdRef = useRef<string | null>(null);

  // Single subscription for source error/cross-source changes at the panel level
  useSourceErrorRevision();

  const allSongs = useMemo<QueueRowSong[]>(() => {
    return [
      ...(currentSong ? [{ ...currentSong, isCurrent: true }] : []),
      ...(queue || []).map((s) => ({ ...s, isCurrent: false })),
    ];
  }, [queue, currentSong]);

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
  }, [allSongs]);

  const currentKey = currentSong?.queueId || '';
  const useVirtualList = allSongs.length >= VIRTUAL_THRESHOLD;
  const prevCurrentKeyRef = useRef(currentKey);

  useLayoutEffect(() => {
    if (!fillHeight || !useVirtualList) return;
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
  }, [fillHeight, useVirtualList]);

  // 仅在「当前曲目切换」时跟滚；点赞/插队等队列重排不要拽回顶部
  useEffect(() => {
    const switched = prevCurrentKeyRef.current !== currentKey;
    prevCurrentKeyRef.current = currentKey;
    if (!switched || !currentKey) return;

    if (useVirtualList) {
      const idx = allSongs.findIndex((song) => song.isCurrent);
      if (idx >= 0) listRef.current?.scrollToItem(idx, 'smart');
      return;
    }
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentKey, allSongs, useVirtualList]);

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
    const scrollEl = container.querySelector('[style*="overflow"]') as HTMLElement | null;
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
    likeRaisesOrder,
    dragOverQueueId,
    sourceStatusMap,
    currentRef,
    onLike: handleLike,
    onDislike: handleDislike,
    onJump: handleJumpRequest,
    onRemove: removeSong,
    onBan: handleBanSong,
    onArtistClick,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd,
  }), [
    allSongs,
    memberTiers,
    mySocketId,
    nickname,
    canControlPlayback,
    memberJumpEnabled,
    dislikeSkipThreshold,
    likeRaisesOrder,
    dragOverQueueId,
    sourceStatusMap,
    handleLike,
    handleDislike,
    handleJumpRequest,
    removeSong,
    handleBanSong,
    onArtistClick,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
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

  const renderPlainRows = () => allSongs.map((song, i) => {
    const ss = sourceStatusMap.get(song.queueId);
    return (
      <QueueRow
        key={song.queueId || `current-${song.id}`}
        song={song}
        index={i}
        memberTier={song.requestedById ? memberTiers?.[song.requestedById] : undefined}
        mySocketId={mySocketId}
        nickname={nickname}
        canControlPlayback={canControlPlayback}
        memberJumpEnabled={memberJumpEnabled}
        dislikeSkipThreshold={dislikeSkipThreshold}
        canReorder={canControlPlayback}
        likeRaisesOrder={likeRaisesOrder}
        isDragOver={Boolean(dragOverQueueId && dragOverQueueId === song.queueId && dragFromId !== song.queueId)}
        rowRef={song.isCurrent ? currentRef : undefined}
        onLike={handleLike}
        onDislike={song.isCurrent ? handleDislike : undefined}
        onJump={handleJumpRequest}
        onRemove={removeSong}
        onBan={handleBanSong}
        onArtistClick={onArtistClick}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        hasSourceError={ss?.error}
        hasCrossSource={ss?.cross}
        crossSourceFrom={ss?.crossFrom}
      />
    );
  });

  return (
    <div className={`flex flex-col ${fillHeight ? 'h-full min-h-0' : ''}`}>
      {useVirtualList ? (
        <div
          ref={listContainerRef}
          className={`pr-0.5 ${fillHeight ? 'flex-1 min-h-0' : ''}`}
          style={fillHeight ? undefined : { height: LIST_HEIGHT }}
          onDragOver={handleContainerDragOver}
        >
          <FixedSizeList
            ref={listRef}
            height={fillHeight ? virtualListHeight : LIST_HEIGHT}
            width="100%"
            itemCount={allSongs.length}
            itemSize={QUEUE_ITEM_SIZE}
            itemData={rowData}
            itemKey={(index, data) => data.songs[index]?.queueId ?? index}
            overscanCount={3}
          >
            {VirtualQueueRow}
          </FixedSizeList>
        </div>
      ) : (
        <div
          className={`space-y-1.5 overflow-y-auto pr-0.5 ${fillHeight ? 'flex-1 min-h-0' : ''}`}
          style={fillHeight ? undefined : { height: LIST_HEIGHT }}
        >
          {renderPlainRows()}
        </div>
      )}
    </div>
  );
}
