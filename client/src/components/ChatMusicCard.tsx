import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Heart, Loader2, Music, Pause, Play, Plus } from 'lucide-react';
import type { ChatSongCard } from '../types';
import SongCover from './SongCover';
import Tooltip from './Tooltip';
import TruncateTip from './TruncateTip';
import { useChatCardPlaybackState } from '../hooks/useChatCardPlaybackState';
import {
  chatCardKey,
  resolveChatCardActiveLyric,
  seekChatCardPlayback,
  toggleChatCardPlayback,
} from '../lib/chatCardPlayer';
import { SOURCE_COLORS, getSourceShortLabel } from '../lib/sourceLabels';
import { formatDuration, songKey } from '../api/music';
import type { ChatCardActions } from './chatCardActions';

interface Props {
  song: ChatSongCard;
  messageId: string;
  /** 弹窗预览：禁用播放与卡片操作，只展示样式 */
  preview?: boolean;
  /** 收藏 / 点歌（由 ChatPanel 统一提供，避免每张卡片各自订阅） */
  actions?: ChatCardActions;
}

// 宽度固定，但始终限制在气泡内容宽度内，避免窄屏 / 长消息把卡片顶出气泡
const CARD_WIDTH_CLASS = 'w-[17.5rem] max-w-full flex-shrink-0';

/**
 * 聊天音乐卡片：封面负责播放/暂停，右侧一行是歌名、歌手与收藏/点歌按钮，
 * 底部进度条支持点击和拖动定位。卡片播放只作用于本机，房间播放器状态不受影响。
 */
function ChatMusicCard({ song, messageId, preview = false, actions }: Props) {
  const playback = useChatCardPlaybackState();

  const cardKey = songKey(song);
  const favoritedNow = Boolean(actions?.favoriteKeys.has(cardKey));
  const inQueue = Boolean(actions?.queueKeys.has(cardKey));
  const favoriteLoading = Boolean(actions?.pendingKeys.has(`fav:${cardKey}`));
  const addingToQueue = Boolean(actions?.pendingKeys.has(`add:${cardKey}`));
  const thisCardKey = chatCardKey(messageId, song);
  const isThisCard = !preview && playback.cardKey === thisCardKey;
  const isLoading = isThisCard && playback.status === 'loading';
  const isPlaying = isThisCard && playback.status === 'playing';
  const errorText = isThisCard && playback.status === 'error' ? playback.error : null;

  const activeLyric = useMemo(
    () => (isThisCard ? resolveChatCardActiveLyric(playback) : null),
    [isThisCard, playback],
  );

  const handleToggle = useCallback(() => {
    if (preview) return;
    void toggleChatCardPlayback({
      id: song.id,
      source: song.source,
      name: song.name,
      artist: song.artist,
      duration: song.duration,
    }, messageId);
  }, [messageId, preview, song.artist, song.duration, song.id, song.name, song.source]);

  const handleFavorite = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    if (preview || favoriteLoading) return;
    actions?.onToggleFavorite(song);
  }, [actions, favoriteLoading, preview, song]);

  const handleAdd = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    if (preview || addingToQueue) return;
    actions?.onAddToQueue(song);
  }, [actions, addingToQueue, preview, song]);

  const sourceColor = SOURCE_COLORS[song.source] || SOURCE_COLORS.netease;
  const sourceLabel = getSourceShortLabel(song.source);

  const durationSec = isThisCard
    ? (playback.durationSec || (song.duration ? song.duration / 1000 : 0))
    : (song.duration ? song.duration / 1000 : 0);
  const positionSec = isThisCard ? playback.positionSec : 0;

  /** 第二行固定占位：播放时显示歌词，否则显示专辑，避免卡片高度跳动 */
  const subtitle = errorText
    ? errorText
    : isPlaying
      ? (activeLyric || '…')
      : (song.album || '');
  const subtitleClass = errorText
    ? 'text-amber-300'
    : isPlaying
      ? 'text-sky-200/85'
      : 'text-white/40';

  return (
    <div
      className={`group/card flex ${CARD_WIDTH_CLASS} min-w-0 flex-col rounded-xl border px-2.5 py-2 transition-colors ${
        isPlaying || isLoading
          ? 'border-netease-red/30 bg-netease-card/60'
          : 'border-white/10 bg-netease-card/35 hover:bg-netease-card/55'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {/* 播控集中在封面：单击播放/暂停 */}
        <button
          type="button"
          onClick={handleToggle}
          disabled={preview}
          className={`relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-netease-dark ${preview ? 'cursor-default' : ''}`}
          aria-label={preview ? song.name : isPlaying ? `暂停 ${song.name}` : `播放 ${song.name}`}
        >
          <SongCover song={song} size="tiny" className="h-full w-full object-cover" />
          {!preview && (
            <span
              className={`absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity ${
                isPlaying || isLoading ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100'
              }`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : isPlaying ? (
                <Pause className="h-4 w-4 text-white" />
              ) : (
                <Play className="h-4 w-4 text-white" />
              )}
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          {/* 歌名与歌词各占整行宽度，操作按钮放到歌手那一行 */}
          <TruncateTip text={song.name} as="span" className="block truncate text-[13px] font-medium text-white/95" />

          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <Music className="h-3 w-3 flex-shrink-0" style={{ color: sourceColor }} aria-label={sourceLabel} />
            <TruncateTip text={song.artist} as="span" className="min-w-0 flex-1 truncate text-[11px] text-netease-muted" />

            {!preview && (
              <div className="flex flex-shrink-0 items-center gap-0.5">
                <Tooltip content={favoritedNow ? '取消收藏' : '收藏'}>
                  <button
                    type="button"
                    onClick={handleFavorite}
                    disabled={favoriteLoading}
                    className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                      favoritedNow ? 'text-rose-300' : 'text-netease-muted hover:bg-white/10 hover:text-rose-200'
                    }`}
                    aria-label={favoritedNow ? '取消收藏' : '收藏'}
                  >
                    {favoriteLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Heart className={`h-3.5 w-3.5 ${favoritedNow ? 'fill-current' : ''}`} />
                    )}
                  </button>
                </Tooltip>
                {/* 已在队列中的歌曲不再展示点歌按钮 */}
                {!inQueue && (
                  <Tooltip content="点歌到房间">
                    <button
                      type="button"
                      onClick={handleAdd}
                      disabled={addingToQueue}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-netease-red/85 transition-colors hover:bg-netease-red/15 hover:text-netease-red disabled:opacity-50"
                      aria-label="点歌到房间"
                    >
                      {addingToQueue ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>

          <div
            className={`overflow-hidden transition-all duration-300 ease-out ${
              subtitle ? 'max-h-[16px] opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <span
              className={`block truncate text-[10px] leading-4 ${subtitleClass}`}
              aria-live={activeLyric ? 'polite' : undefined}
            >
              {subtitle}
            </span>
          </div>
        </div>
      </div>

      {!preview && (
        <div
          className={`overflow-hidden transition-all duration-300 ease-out ${
            isPlaying ? 'mt-1.5 max-h-[22px] opacity-100' : 'mt-0 max-h-0 opacity-0'
          }`}
        >
          <ChatCardProgress positionSec={positionSec} durationSec={durationSec} color={sourceColor} />
        </div>
      )}
    </div>
  );
}

/** 卡片底部进度条：显示播放进度与时间，支持点击与拖动定位；颜色跟随歌曲平台 */
function ChatCardProgress({ positionSec, durationSec, color }: { positionSec: number; durationSec: number; color: string }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [dragPercent, setDragPercent] = useState<number | null>(null);

  const ratioFromClientX = useCallback((clientX: number) => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (durationSec <= 0) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragPercent(ratioFromClientX(event.clientX) * 100);
  }, [durationSec, ratioFromClientX]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setDragPercent(ratioFromClientX(event.clientX) * 100);
  }, [ratioFromClientX]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const ratio = ratioFromClientX(event.clientX);
    setDragPercent(ratio * 100);
    seekChatCardPlayback(ratio * durationSec);
    window.setTimeout(() => setDragPercent(null), 600);
  }, [durationSec, ratioFromClientX]);

  const percent = Math.min(100, Math.max(0, dragPercent ?? (durationSec > 0 ? (positionSec / durationSec) * 100 : 0)));
  const timeSec = dragPercent === null ? positionSec : (percent / 100) * durationSec;
  const canSeek = durationSec > 0;

  return (
    <div className="mt-1.5 flex h-4 min-w-0 items-center gap-2">
      {/* 触摸/点击判定用整行高度，视觉轨道只有 3px */}
      <div
        ref={barRef}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={Math.round(timeSec)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex h-4 min-w-0 flex-1 touch-none select-none items-center ${
          canSeek ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className="absolute inset-x-0 h-[3px] rounded-full bg-white/10" aria-hidden />
        <span
          className="absolute left-0 h-[3px] rounded-full"
          style={{ width: `${percent}%`, background: color }}
          aria-hidden
        />
        {canSeek && (
          <span
            className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
            /* 圆点位置夹在轨道内，保证 0% / 100% 时不被裁掉 */
            style={{ left: `clamp(3px, ${percent}%, calc(100% - 3px))` }}
            aria-hidden
          />
        )}
      </div>
      <span className="flex-shrink-0 text-[10px] leading-4 tabular-nums text-white/55">
        {formatDuration(Math.round(timeSec))}
        {durationSec > 0 ? ` / ${formatDuration(Math.round(durationSec))}` : ''}
      </span>
    </div>
  );
}

export default memo(ChatMusicCard);