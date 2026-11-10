import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { LyricLine, QueueItem } from '../../types';
import { filterDisplayLyrics, getTrackKey, LYRIC_SYNC_LEAD_SEC } from '../../api/music';
import { findActiveLyricIndex } from '../../lib/lyricActiveIndex';
import { useSmoothPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackDuration, clampPlaybackTime } from '../../hooks/useTrackDuration';
import { useTrackLyrics } from '../../hooks/useTrackLyrics';
import { useRoomStore } from '../../stores/roomStore';
import Tooltip from '../Tooltip';

interface Props {
  song: QueueItem;
}

type LyricRowRole = 'past' | 'current' | 'next';

interface LyricRowProps {
  text: string;
  role: LyricRowRole;
  animateVertical: boolean;
  lineDurationSec: number;
  loopScroll?: boolean;
  isPlaying: boolean;
}

function MiniLyricRow({
  text,
  role,
  animateVertical,
  lineDurationSec,
  loopScroll = false,
  isPlaying,
}: LyricRowProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const panTimingRef = useRef<{ text: string; overflowPx: number; duration: number; delay: number } | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const textEl = textRef.current;
    if (!viewport || !textEl) {
      setOverflowPx(0);
      return;
    }

    const measure = () => {
      const vEl = viewportRef.current;
      const tEl = textRef.current;
      if (!vEl || !tEl) return;
      const diff = Math.ceil(tEl.scrollWidth - vEl.clientWidth);
      setOverflowPx(diff > 4 ? diff : 0);
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(viewport);
    return () => ro?.disconnect();
  }, [text]);

  const isActivated = role === 'current' || role === 'past';
  const shouldScrollHorizontally = overflowPx > 0 && isActivated;

  if (role === 'next') {
    panTimingRef.current = null;
  } else if (
    role === 'current'
    && overflowPx > 0
    && (!panTimingRef.current || panTimingRef.current.text !== text || panTimingRef.current.overflowPx !== overflowPx)
  ) {
    if (loopScroll) {
      panTimingRef.current = {
        text,
        overflowPx,
        duration: Math.max(5.8, Math.min(14, overflowPx / 22 + 3.2)),
        delay: 0.8,
      };
    } else {
      const delay = animateVertical ? Math.min(0.42, Math.max(0.22, lineDurationSec * 0.15)) : 0.28;
      const available = Math.max(0.9, lineDurationSec - delay - 0.32);
      const natural = Math.max(1.25, overflowPx / 42);
      panTimingRef.current = {
        text,
        overflowPx,
        duration: Math.min(available, natural),
        delay,
      };
    }
  }

  const rowAnimClass = role === 'past'
    ? 'mini-lyric-row--past-out text-white/90 font-medium'
    : role === 'current'
      ? `${animateVertical ? 'mini-lyric-row--promote' : 'mini-lyric-row--current-static'} text-white/95 font-medium`
      : `${animateVertical ? 'mini-lyric-row--next-in' : 'mini-lyric-row--next-static'} text-netease-muted font-normal`;

  const viewportMaskClass = overflowPx <= 0
    ? 'justify-center'
    : isActivated
      ? 'justify-start mini-lyric-line-viewport--mask-both'
      : 'justify-start mini-lyric-line-viewport--mask-right';

  const panTiming = panTimingRef.current;
  const innerScrollClass = shouldScrollHorizontally
    ? loopScroll
      ? 'mini-lyric-scroll-inner mini-lyric-scroll-inner--loop'
      : 'mini-lyric-scroll-inner mini-lyric-scroll-inner--pan'
    : 'mini-lyric-scroll-inner';

  const innerStyle: CSSProperties | undefined = shouldScrollHorizontally && panTiming
    ? {
        ['--lyric-pan-distance' as string]: `-${panTiming.overflowPx}px`,
        ['--lyric-pan-duration' as string]: `${panTiming.duration.toFixed(2)}s`,
        ['--lyric-pan-delay' as string]: `${panTiming.delay.toFixed(2)}s`,
        animationPlayState: isPlaying ? 'running' : 'paused',
      }
    : undefined;

  return (
    <div
      className={`mini-lyric-row text-xs sm:text-sm leading-[18px] ${rowAnimClass}`}
      aria-hidden={role === 'past' ? true : undefined}
    >
      <div ref={viewportRef} className={`mini-lyric-line-viewport ${viewportMaskClass}`}>
        <span
          className={`mini-lyric-scale-wrap ${role === 'next' ? 'mini-lyric-scale-wrap--next' : 'mini-lyric-scale-wrap--current'}`}
          style={{ transformOrigin: overflowPx > 0 ? 'left center' : 'center center' }}
        >
          <span ref={textRef} className={innerScrollClass} style={innerStyle}>
            {text || '\u00A0'}
          </span>
        </span>
      </div>
    </div>
  );
}

interface ContentProps {
  song: QueueItem;
  displayLines: LyricLine[];
  activeIndex: number;
  beforeFirstLine: boolean;
  duration: number;
  isPlaying: boolean;
}

function MiniPlayerLyricTickerContent({
  song,
  displayLines,
  activeIndex,
  beforeFirstLine,
  duration,
  isPlaying,
}: ContentProps) {
  const hasLyrics = displayLines.length > 0;
  const currentIdx = !hasLyrics
    ? -1
    : activeIndex >= 0
      ? activeIndex
      : beforeFirstLine
        ? -1
        : displayLines.length - 1;
  const nextIdx = !hasLyrics
    ? -1
    : activeIndex >= 0
      ? (activeIndex + 1 < displayLines.length ? activeIndex + 1 : -1)
      : beforeFirstLine
        ? 0
        : -1;

  const trackIdentity = `${getTrackKey(song)}:${hasLyrics ? 'lyrics' : 'fallback'}`;
  const stateRef = useRef<{
    identity: string;
    currentIdx: number;
    outgoingIdx: number;
    animated: boolean;
  }>({
    identity: '',
    currentIdx: -2,
    outgoingIdx: -1,
    animated: false,
  });

  if (stateRef.current.identity !== trackIdentity) {
    stateRef.current = {
      identity: trackIdentity,
      currentIdx,
      outgoingIdx: -1,
      animated: false,
    };
  } else if (stateRef.current.currentIdx !== currentIdx) {
    const prevIdx = stateRef.current.currentIdx;
    stateRef.current = {
      identity: trackIdentity,
      currentIdx,
      outgoingIdx: prevIdx >= 0 && prevIdx !== currentIdx && prevIdx !== nextIdx ? prevIdx : -1,
      animated: true,
    };
  }

  const { outgoingIdx, animated } = stateRef.current;

  const resolveLineDuration = (idx: number) => {
    const line = displayLines[idx];
    if (!line) return 4;
    const nextLine = displayLines[idx + 1];
    if (nextLine && nextLine.time > line.time) {
      return Math.max(1.8, Math.min(14, nextLine.time - line.time));
    }
    if (duration > line.time) {
      return Math.max(2.4, Math.min(14, duration - line.time));
    }
    return 5;
  };

  const rows: Array<{
    key: string;
    sortOrder: number;
    text: string;
    role: LyricRowRole;
    animateVertical: boolean;
    lineDurationSec: number;
    loopScroll?: boolean;
  }> = [];

  if (hasLyrics) {
    if (animated && outgoingIdx >= 0 && displayLines[outgoingIdx]) {
      rows.push({
        key: `line-${outgoingIdx}`,
        sortOrder: outgoingIdx,
        text: displayLines[outgoingIdx].text,
        role: 'past',
        animateVertical: true,
        lineDurationSec: resolveLineDuration(outgoingIdx),
      });
    }
    if (currentIdx >= 0 && displayLines[currentIdx]) {
      rows.push({
        key: `line-${currentIdx}`,
        sortOrder: currentIdx,
        text: displayLines[currentIdx].text,
        role: 'current',
        animateVertical: animated,
        lineDurationSec: resolveLineDuration(currentIdx),
      });
    }
    if (nextIdx >= 0 && displayLines[nextIdx]) {
      rows.push({
        key: `line-${nextIdx}`,
        sortOrder: nextIdx,
        text: displayLines[nextIdx].text,
        role: 'next',
        animateVertical: animated,
        lineDurationSec: resolveLineDuration(nextIdx),
      });
    }
    // 按歌词行号固定 DOM 顺序，防止晋升时发生节点重排导致横向动画重置
    rows.sort((a, b) => a.sortOrder - b.sortOrder);
  } else {
    rows.push(
      {
        key: 'fallback-title',
        sortOrder: 0,
        text: song.name,
        role: 'current',
        animateVertical: false,
        lineDurationSec: 8,
        loopScroll: true,
      },
      {
        key: 'fallback-artist',
        sortOrder: 1,
        text: song.artist,
        role: 'next',
        animateVertical: false,
        lineDurationSec: 8,
        loopScroll: false,
      },
    );
  }

  return (
    <Tooltip content="可直接选中复制歌词">
      <div className="hidden min-w-0 flex-1 select-text px-2 text-center sm:block">
        <div className="mini-lyric-stage" aria-live="polite">
          {rows.map((row) => (
            <MiniLyricRow
              key={row.key}
              text={row.text}
              role={row.role}
              animateVertical={row.animateVertical}
              lineDurationSec={row.lineDurationSec}
              loopScroll={row.loopScroll}
              isPlaying={isPlaying}
            />
          ))}
        </div>
      </div>
    </Tooltip>
  );
}

const MemoMiniPlayerLyricTickerContent = memo(MiniPlayerLyricTickerContent);

function MiniPlayerLyricTicker({ song }: Props) {
  const currentTime = useSmoothPlaybackTime();
  const isPlaying = useRoomStore((s) => s.room?.isPlaying ?? false);
  const duration = useTrackDuration(song);
  const displayTime = clampPlaybackTime(currentTime, duration);
  const lyrics = useTrackLyrics(song);
  const displayLines = useMemo(() => filterDisplayLyrics(lyrics), [lyrics]);
  const syncTime = displayTime + LYRIC_SYNC_LEAD_SEC;
  const activeIndex = findActiveLyricIndex(displayLines, syncTime);
  const beforeFirstLine = displayLines.length > 0 && activeIndex < 0 && syncTime < displayLines[0].time;

  return (
    <MemoMiniPlayerLyricTickerContent
      song={song}
      displayLines={displayLines}
      activeIndex={activeIndex}
      beforeFirstLine={beforeFirstLine}
      duration={duration}
      isPlaying={isPlaying}
    />
  );
}

export default memo(MiniPlayerLyricTicker);
