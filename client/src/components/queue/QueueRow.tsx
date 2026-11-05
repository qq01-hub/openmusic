import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Zap, ThumbsUp, ThumbsDown, AlertTriangle, Ban, GripVertical, Shuffle, Share2 } from 'lucide-react';
import { getClientId } from '../../lib/clientId';
import { formatCrossSourceTip } from '../../lib/sourceLabels';
import type { RoomMemberTier, QueueItem, MusicSource, Song } from '../../types';
import SongCover from '../SongCover';
import FavoriteButton from '../FavoriteButton';
import FavoriteCategorySelect from '../FavoriteCategorySelect';
import QueueText from './QueueText';
import QueueTip from './QueueTip';
import MemberQueueFrame from '../MemberQueueFrame';
import MemberTierBadge from '../MemberTierBadge';
import RoleBadge from '../RoleBadge';

export const QUEUE_ROW_HEIGHT = 64;
export const QUEUE_ROW_GAP = 6;
export const QUEUE_ITEM_SIZE = QUEUE_ROW_HEIGHT + QUEUE_ROW_GAP;

type QueueRowSong = QueueItem & { isCurrent: boolean };

interface Props {
  song: QueueRowSong;
  index: number;
  memberTier?: RoomMemberTier;
  mySocketId: string | null;
  nickname: string;
  canControlPlayback: boolean;
  memberJumpEnabled?: boolean;
  dislikeSkipThreshold?: number;
  /** 房主/管理员可拖拽排序 */
  canReorder?: boolean;
  /** 用户轮播仅比较同一点歌人的点赞数，其他模式遵守手动排序锁定 */
  likeOrderScope?: 'queue' | 'requester' | 'none';
  isDragOver?: boolean;
  rowRef?: React.MutableRefObject<HTMLDivElement | null>;
  onLike: (queueId: string) => void;
  onDislike?: () => void;
  onShare?: (song: QueueRowSong) => void;
  onJump: (queueId: string) => void;
  onRemove: (queueId: string) => void;
  onBan: (song: QueueRowSong) => void;
  onArtistClick?: (artist: string) => void;
  onDragStart?: (queueId: string) => void;
  onDragOver?: (queueId: string, e: React.DragEvent) => void;
  onDrop?: (queueId: string) => void;
  onDragEnd?: () => void;
  /** Pre-computed source status passed from parent to avoid per-row subscriptions */
  hasSourceError?: boolean;
  hasCrossSource?: boolean;
  crossSourceFrom?: MusicSource;
  /** Pre-computed favorite state passed from QueuePanel to avoid per-row useFavorites/useSocket hooks */
  isFavorited?: boolean;
  favoriteCategory?: string;
  favoriteCategories?: string[];
  onToggleFavorite?: (song: Song) => Promise<{ success: boolean; error?: string }>;
  onSelectFavoriteCategory?: (song: QueueRowSong, category: string) => Promise<void>;
}

const EMPTY_CATEGORIES: string[] = [];

function sameStringArray(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  const lenA = a?.length ?? 0;
  const lenB = b?.length ?? 0;
  if (lenA !== lenB) return false;
  if (lenA === 0) return true;
  for (let i = 0; i < lenA; i += 1) {
    if (a![i] !== b![i]) return false;
  }
  return true;
}

function QueueRow({
  song,
  index,
  memberTier,
  mySocketId,
  nickname,
  canControlPlayback,
  memberJumpEnabled = false,
  dislikeSkipThreshold = 5,
  canReorder = false,
  likeOrderScope = 'queue',
  isDragOver = false,
  rowRef,
  onLike,
  onDislike,
  onShare,
  onJump,
  onRemove,
  onBan,
  onArtistClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  hasSourceError = false,
  hasCrossSource = false,
  crossSourceFrom,
  isFavorited = false,
  favoriteCategory = '',
  favoriteCategories = EMPTY_CATEGORIES,
  onToggleFavorite,
  onSelectFavoriteCategory,
}: Props) {
  const myUserId = mySocketId || getClientId();
  const isMine = !song.isCurrent && Boolean(myUserId && (
    song.requestedById === myUserId
    || (!song.requestedById && song.requestedBy === nickname)
  ));
  const songLikes = song.isCurrent ? song.currentLikedByIds : song.likedByIds;
  const likedByIds = Array.isArray(songLikes) ? songLikes : [];
  const likeCount = likedByIds.length;
  const likedByMe = Boolean(myUserId && likedByIds.includes(myUserId));
  const dislikedByIds = Array.isArray(song.dislikedByIds) ? song.dislikedByIds : [];
  const dislikeCount = dislikedByIds.length;
  const dislikedByMe = Boolean(myUserId && dislikedByIds.includes(myUserId));
  const canLike = !isMine;
  const canJump = !song.isCurrent && (canControlPlayback || (isMine && memberJumpEnabled));
  const canRemove = !song.isCurrent && (canControlPlayback || isMine);
  const isAdminPriority = Boolean(song.ownerPriority && song.priorityBy);
  const isOwnerPriority = Boolean(song.ownerPriority && !song.priorityBy);
  const allowDrag = canReorder && !song.isCurrent;
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const categoryPickerRootRef = useRef<HTMLDivElement>(null);
  const [categorySaving, setCategorySaving] = useState(false);

  useEffect(() => {
    if (!categoryPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!categoryPickerRootRef.current?.contains(target) && !(target instanceof Element && target.closest('[role="listbox"]'))) setCategoryPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [categoryPickerOpen]);

  const handleFavoriteDoubleClick = useCallback(() => {
    setCategoryPickerOpen(true);
  }, []);

  const handleCategoryChange = useCallback(async (category: string) => {
    if (categorySaving || !onSelectFavoriteCategory) return;
    setCategorySaving(true);
    try {
      await onSelectFavoriteCategory(song, category);
      setCategoryPickerOpen(false);
    } finally {
      setCategorySaving(false);
    }
  }, [categorySaving, onSelectFavoriteCategory, song]);

  const dragProps = allowDrag
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', song.queueId);
          const el = e.currentTarget as HTMLElement;
          // 让 ghost 清晰可见：同步设置亮背景，浏览器在此帧截取 ghost
          el.style.background = 'rgba(30, 41, 59, 0.98)';
          el.style.boxShadow = '0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)';
          el.style.opacity = '1';
          requestAnimationFrame(() => {
            // 原位变淡
            el.style.opacity = '0.4';
            el.style.background = '';
            el.style.boxShadow = '';
          });
          onDragStart?.(song.queueId);
        },
        onDragEnd: (e: React.DragEvent) => {
          const el = e.currentTarget as HTMLElement;
          el.style.opacity = '';
          el.style.background = '';
          el.style.boxShadow = '';
          onDragEnd?.();
        },
      }
    : {};

  const rowInner = (
    <>
      {allowDrag ? (
        <span className="flex w-5 flex-shrink-0 cursor-grab items-center justify-center text-netease-muted/70 active:cursor-grabbing hover:text-white/80">
          <GripVertical className="h-4 w-4" />
        </span>
      ) : (
        <span className="w-5 text-center text-[11px] text-netease-muted flex-shrink-0">
          {song.isCurrent ? (
            <span className="inline-flex gap-0.5 items-end h-3.5">
              <span className="w-0.5 h-1.5 bg-netease-red animate-pulse" />
              <span className="w-0.5 h-2.5 bg-netease-red animate-pulse delay-75" />
              <span className="w-0.5 h-1 bg-netease-red animate-pulse delay-150" />
            </span>
          ) : (
            index
          )}
        </span>
      )}
      <SongCover
        song={song}
        size="tiny"
        lazy={false}
        className="w-11 h-11 rounded-lg object-cover bg-netease-card flex-shrink-0"
      />
      <div className="flex-1 min-w-0 self-stretch flex flex-col justify-center gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <QueueText
            text={song.name}
            as="p"
            className={`min-w-0 flex-1 text-sm leading-5 truncate ${
              song.isCurrent ? 'text-netease-red font-medium' : 'text-white/92'
            }`}
          />
          {hasSourceError && (
            <QueueTip content="歌曲源异常，将跳过此歌">
              <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-md border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium leading-tight text-red-400 max-w-[9rem] sm:max-w-none">
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                <span className="truncate sm:whitespace-nowrap">源异常</span>
              </span>
            </QueueTip>
          )}
          {!hasSourceError && hasCrossSource && (
            <QueueTip content={formatCrossSourceTip(song.source, crossSourceFrom)}>
              <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-md border border-amber-500/35 bg-amber-500/12 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium leading-tight text-amber-300/95 max-w-[9rem] sm:max-w-none">
                <Shuffle className="h-3 w-3 flex-shrink-0" />
                <span className="truncate sm:whitespace-nowrap">跨源取链</span>
              </span>
            </QueueTip>
          )}
          {isOwnerPriority && !memberTier && <RoleBadge role="owner" />}
          {isAdminPriority && !memberTier && (
            <QueueText
              text={song.priorityBy!}
              as="span"
              className="flex-shrink-0 max-w-[4.5rem] rounded-full bg-sky-400/15 px-1.5 py-0 text-[9px] leading-4 text-sky-300 truncate"
            />
          )}
          {memberTier && <MemberTierBadge tier={memberTier} />}
          {memberTier && isOwnerPriority && <RoleBadge role="owner" variant="icon" />}
          {memberTier && isAdminPriority && (
            <QueueText
              text={song.priorityBy!}
              as="span"
              className="flex-shrink-0 max-w-[4.5rem] rounded-full bg-sky-400/15 px-1.5 py-0 text-[9px] leading-4 text-sky-300 truncate"
            />
          )}
          <div ref={categoryPickerRootRef} className="relative flex flex-shrink-0 items-center">
            <FavoriteButton
              song={song}
              favorited={isFavorited}
              onToggle={onToggleFavorite}
              className="w-7 h-7 text-netease-muted hover:text-rose-300"
              iconClassName="w-3.5 h-3.5"
              useQueueTip
              onDoubleClick={handleFavoriteDoubleClick}
            />
            {categoryPickerOpen && (
              <div className="absolute right-0 top-full z-40 mt-1 w-32">
                <FavoriteCategorySelect
                  value={favoriteCategory}
                  categories={favoriteCategories}
                  songName={song.name}
                  disabled={categorySaving}
                  openOnMount
                  onChange={(category) => { void handleCategoryChange(category); }}
                />
              </div>
            )}
          </div>
          {onShare && (
            <QueueTip content="分享到聊天">
              <button
                type="button"
                onClick={() => onShare(song)}
                className="rounded-lg p-1 text-netease-muted transition-colors hover:bg-sky-400/10 hover:text-sky-300"
                aria-label="分享到聊天"
              >
                <Share2 className="h-3.5 w-3.5" />
              </button>
            </QueueTip>
          )}
          {song.isCurrent && (
            <QueueTip content={likedByMe ? '取消点赞（仅计数）' : '点赞（仅计数，不影响排序）'}>
              <button
                type="button"
                onClick={() => onLike(song.queueId)}
                aria-label={likedByMe ? '取消点赞' : '点赞'}
                aria-pressed={likedByMe}
                className={`flex min-w-7 items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] transition-colors ${likedByMe ? 'bg-netease-red/10 text-netease-red' : 'text-netease-muted hover:bg-white/10 hover:text-white'}`}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
                <span>{likeCount}</span>
              </button>
            </QueueTip>
          )}
          {song.isCurrent && onDislike && (
            <QueueTip content={dislikedByMe
              ? `取消踩（${dislikeCount}/${dislikeSkipThreshold}）`
              : `踩歌（${dislikeCount}/${dislikeSkipThreshold}）`}>
              <button
                type="button"
                onClick={onDislike}
                className={`flex min-w-7 items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] transition-colors ${
                  dislikedByMe
                    ? 'bg-netease-red/10 text-netease-red'
                    : 'text-netease-muted hover:bg-white/10 hover:text-white'
                }`}
                aria-label="踩歌"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
                {dislikeCount > 0 && <span>{dislikeCount}</span>}
              </button>
            </QueueTip>
          )}
          {!song.isCurrent && (
            <div className="flex flex-shrink-0 items-center gap-0.5">
              {canLike && (
                <QueueTip content={likedByMe ? '取消点赞' : (
                  likeOrderScope === 'requester' ? '点赞提高该用户轮次内的播放顺序'
                    : likeOrderScope === 'queue' ? '点赞提高排序'
                      : '点赞（仅计数，房间设置或手动排序优先）'
                )}>
                  <button
                    type="button"
                    onClick={() => onLike(song.queueId)}
                    className={`flex min-w-7 items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] transition-colors ${
                      likedByMe
                        ? 'bg-netease-red/10 text-netease-red'
                        : 'text-netease-muted hover:bg-white/10 hover:text-white'
                    }`}
                    aria-label={likedByMe ? '取消点赞' : '点赞'}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                    {likeCount > 0 && <span>{likeCount}</span>}
                  </button>
                </QueueTip>
              )}
              {!canLike && likeCount > 0 && (
                <span className="flex min-w-7 items-center justify-center gap-0.5 px-1 py-1 text-[11px] text-netease-muted/70">
                  <ThumbsUp className="h-3.5 w-3.5" />
                  <span>{likeCount}</span>
                </span>
              )}
              {canJump && (
                <QueueTip content={canControlPlayback ? '管理员插队' : '插队到下一首'}>
                  <button
                    type="button"
                    onClick={() => onJump(song.queueId)}
                    className="rounded-lg p-1 text-amber-400/75 transition-colors hover:bg-amber-400/10 hover:text-amber-300"
                    aria-label="插队"
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </button>
                </QueueTip>
              )}
              {canRemove && (
                <QueueTip content={canControlPlayback && !isMine ? '移除歌曲' : '删除我的点歌'}>
                  <button
                    type="button"
                    onClick={() => onRemove(song.queueId)}
                    className="rounded-lg p-1 text-netease-muted transition-colors hover:bg-netease-red/10 hover:text-netease-red"
                    aria-label="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </QueueTip>
              )}
              {canControlPlayback && !song.isCurrent && (
                <QueueTip content="禁播此歌">
                  <button
                    type="button"
                    onClick={() => onBan(song)}
                    className="rounded-lg p-1 text-netease-muted transition-colors hover:bg-amber-400/10 hover:text-amber-300"
                    aria-label="禁播"
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                </QueueTip>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] leading-4 text-netease-muted min-w-0">
          {onArtistClick ? (
            <QueueTip content={`查看 ${song.artist} 的全部歌曲`}>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onArtistClick(song.artist);
                }}
                className="min-w-0 truncate text-left transition-colors hover:text-white hover:underline focus:outline-none focus-visible:text-white focus-visible:underline"
              >
                {song.artist}
              </button>
            </QueueTip>
          ) : (
            <QueueText text={song.artist} className="min-w-0 truncate" />
          )}
          {!song.isCurrent && song.requestedBy && (
            <QueueText
              text={`${song.requestedBy}点的歌`}
              className="min-w-0 truncate text-netease-muted/65"
            />
          )}
        </div>
      </div>
    </>
  );

  const dropHandlers = canReorder
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (song.isCurrent) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          onDragOver?.(song.queueId, e);
        },
        onDrop: (e: React.DragEvent) => {
          if (song.isCurrent) return;
          e.preventDefault();
          onDrop?.(song.queueId);
        },
      }
    : {};

  const dragCursor = allowDrag ? 'cursor-grab active:cursor-grabbing' : '';

  const dropIndicator = isDragOver && (
    <div className="absolute top-0 left-2 right-2 h-0.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
  );

  if (memberTier) {
    const memberInnerClassName = song.isCurrent ? 'bg-netease-red/10' : 'bg-transparent';
    return (
      <div className="relative" {...dropHandlers}>
        {dropIndicator}
        <MemberQueueFrame variant="queue" tier={memberTier} innerClassName={memberInnerClassName}>
          <div
            ref={rowRef}
            className={`group flex items-center gap-2.5 px-2.5 py-2 transition-colors hover:bg-netease-card/80 ${dragCursor}`}
            style={{ minHeight: QUEUE_ROW_HEIGHT }}
            {...dragProps}
          >
            {rowInner}
          </div>
        </MemberQueueFrame>
      </div>
    );
  }

  return (
    <div className="relative" {...dropHandlers}>
      {dropIndicator}
      <div
        ref={rowRef}
        className={`group flex items-center gap-2.5 px-2.5 py-2 transition-colors rounded-xl border ${dragCursor} ${
          song.isCurrent
            ? 'bg-netease-red/10 border-netease-red/25'
            : isAdminPriority
              ? 'bg-sky-400/10 border border-sky-400/20 hover:bg-sky-400/15'
              : isOwnerPriority
                ? 'bg-amber-400/10 border border-amber-400/20 hover:bg-amber-400/15'
                : 'bg-netease-card/35 border-transparent hover:bg-netease-card/80'
        }`}
        style={{ minHeight: QUEUE_ROW_HEIGHT }}
        {...dragProps}
      >
        {rowInner}
      </div>
    </div>
  );
}

export default memo(QueueRow, (prev, next) => (
  prev.index === next.index
  && prev.song.queueId === next.song.queueId
  && prev.song.id === next.song.id
  && prev.song.source === next.song.source
  && prev.song.name === next.song.name
  && prev.song.artist === next.song.artist
  && prev.song.pic === next.song.pic
  && prev.song.isCurrent === next.song.isCurrent
  && prev.song.requestedBy === next.song.requestedBy
  && prev.song.requestedById === next.song.requestedById
  && prev.song.ownerPriority === next.song.ownerPriority
  && prev.song.priorityBy === next.song.priorityBy
  && sameStringArray(prev.song.likedByIds, next.song.likedByIds)
  && sameStringArray(prev.song.currentLikedByIds, next.song.currentLikedByIds)
  && sameStringArray(prev.song.dislikedByIds, next.song.dislikedByIds)
  && prev.memberTier === next.memberTier
  && prev.mySocketId === next.mySocketId
  && prev.nickname === next.nickname
  && prev.canControlPlayback === next.canControlPlayback
  && prev.memberJumpEnabled === next.memberJumpEnabled
  && prev.dislikeSkipThreshold === next.dislikeSkipThreshold
  && prev.canReorder === next.canReorder
  && prev.likeOrderScope === next.likeOrderScope
  && prev.isDragOver === next.isDragOver
  && prev.hasSourceError === next.hasSourceError
  && prev.hasCrossSource === next.hasCrossSource
  && prev.crossSourceFrom === next.crossSourceFrom
  && prev.isFavorited === next.isFavorited
  && prev.favoriteCategory === next.favoriteCategory
  && prev.favoriteCategories === next.favoriteCategories
  && prev.onLike === next.onLike
  && prev.onDislike === next.onDislike
  && prev.onShare === next.onShare
  && prev.onJump === next.onJump
  && prev.onRemove === next.onRemove
  && prev.onBan === next.onBan
  && prev.onArtistClick === next.onArtistClick
  && prev.onDragStart === next.onDragStart
  && prev.onDragOver === next.onDragOver
  && prev.onDrop === next.onDrop
  && prev.onDragEnd === next.onDragEnd
  && prev.onToggleFavorite === next.onToggleFavorite
  && prev.onSelectFavoriteCategory === next.onSelectFavoriteCategory
));
