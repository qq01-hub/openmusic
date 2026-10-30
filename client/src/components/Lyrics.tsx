import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { filterDisplayLyrics, LYRIC_SYNC_LEAD_SEC } from '../api/music';
import { findActiveLyricIndex } from '../lib/lyricActiveIndex';
import { roomVisualFxLive, subscribeRoomVisualFx } from '../lib/roomVisualFxLive';
import type { LyricLine } from '../types';

interface Props {
  lines: LyricLine[];
  currentTime: number;
  onSeek?: (time: number) => void;
  /** 侧边布局：左对齐，当前句居中 */
  variant?: 'center' | 'side';
  size?: 'default' | 'large';
  /** 全屏歌词：展示全部行并允许手动滚动 */
  scrollable?: boolean;
  /** TV 等场景用 instant 滚动降低布局成本 */
  instantScroll?: boolean;
  mobileCentered?: boolean;
}

const SIDE_WINDOW = 5;
const SCROLL_IDLE_MS = 3000;

function Lyrics({ lines, currentTime, ...props }: Props) {
  const displayLines = useMemo(() => filterDisplayLyrics(lines), [lines]);
  const activeIndex = findActiveLyricIndex(displayLines, currentTime + LYRIC_SYNC_LEAD_SEC);
  return <MemoLyricsContent {...props} displayLines={displayLines} activeIndex={activeIndex} />;
}

type ContentProps = Omit<Props, 'lines' | 'currentTime'> & {
  displayLines: LyricLine[];
  activeIndex: number;
};

function LyricsContent({
  displayLines,
  activeIndex,
  onSeek,
  variant = 'center',
  size = 'default',
  scrollable = false,
  instantScroll = false,
  mobileCentered = false,
}: ContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [manualScroll, setManualScroll] = useState(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastActiveIndexRef = useRef(-1);
  const programmaticScrollRef = useRef(false);
  const needsInstantSnapRef = useRef(true);
  const [showTranslation, setShowTranslation] = useState(
    () => roomVisualFxLive.current.lyricShowTranslation !== false,
  );

  useEffect(() => subscribeRoomVisualFx(() => {
    setShowTranslation(roomVisualFxLive.current.lyricShowTranslation !== false);
  }), []);

  const isSide = variant === 'side';
  const isLarge = size === 'large';
  const fullScroll = scrollable && isSide;
  const shouldAutoScroll = fullScroll || !isSide;

  const windowStart = fullScroll
    ? 0
    : isSide
      ? Math.max(0, Math.min(
          activeIndex >= 0 ? activeIndex - 1 : 0,
          Math.max(0, displayLines.length - SIDE_WINDOW),
        ))
      : 0;
  const windowEnd = fullScroll
    ? displayLines.length
    : isSide
      ? Math.min(displayLines.length, windowStart + SIDE_WINDOW)
      : displayLines.length;
  const visibleLines = displayLines.slice(windowStart, windowEnd);

  const scrollActiveToCenter = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = containerRef.current;
    const active = activeRef.current;
    if (!container || !active) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const nextTop = container.scrollTop
      + (activeRect.top - containerRect.top)
      - container.clientHeight / 2
      + activeRect.height / 2;
    const top = Math.max(0, nextTop);
    if (Math.abs(container.scrollTop - top) < 1) return;

    programmaticScrollRef.current = true;
    container.scrollTo({ top, behavior });
    if (behavior === 'instant') {
      // instant 同步完成，下一帧再放开 scroll 监听
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
      return;
    }
    // smooth 期间忽略 scroll 事件，避免误判为手动滚动
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 450);
  }, []);

  useEffect(() => {
    setManualScroll(false);
    lastActiveIndexRef.current = -1;
    needsInstantSnapRef.current = true;
  }, [displayLines]);

  // 首次进入 / 换歌：布局后立刻对齐，避免看到滚动条动画
  useLayoutEffect(() => {
    if (!shouldAutoScroll || activeIndex < 0) return;
    if (!needsInstantSnapRef.current) return;
    needsInstantSnapRef.current = false;
    lastActiveIndexRef.current = activeIndex;
    scrollActiveToCenter('instant');
  }, [activeIndex, displayLines, scrollActiveToCenter, shouldAutoScroll]);

  useEffect(() => {
    if (!shouldAutoScroll || manualScroll || activeIndex < 0) return;
    if (activeIndex === lastActiveIndexRef.current) return;
    lastActiveIndexRef.current = activeIndex;
    scrollActiveToCenter(instantScroll || needsInstantSnapRef.current ? 'instant' : 'smooth');
  }, [activeIndex, instantScroll, manualScroll, shouldAutoScroll, scrollActiveToCenter]);

  const handleScroll = () => {
    if (!shouldAutoScroll) return;
    if (programmaticScrollRef.current) return;
    setManualScroll(true);
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => setManualScroll(false), SCROLL_IDLE_MS);
  };

  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  if (displayLines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40 text-base 2xl:text-2xl 3xl:text-3xl">
        暂无歌词
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`flex-1 ${
        fullScroll
          ? 'overflow-y-auto overflow-x-hidden px-1 py-2 sm:py-4'
          : isSide
            ? 'flex flex-col justify-center overflow-hidden px-1'
            : 'overflow-y-auto scrollbar-hide px-6 py-8'
      }`}
      style={isSide && !fullScroll
        ? { maskImage: 'linear-gradient(transparent, black 8%, black 92%, transparent)' }
        : { maskImage: 'linear-gradient(transparent, black 12%, black 88%, transparent)' }}
    >
      <div className={fullScroll
        ? (isLarge ? 'space-y-2 sm:space-y-3 py-[min(38vh,320px)] 2xl:space-y-6' : 'space-y-3 py-[min(38vh,320px)]')
        : isSide
          ? (isLarge ? 'space-y-2 sm:space-y-3 py-1 sm:py-2 2xl:space-y-8 2xl:py-4' : 'space-y-3 py-2')
          : 'space-y-5 py-[40vh] 2xl:space-y-8'}>
        {visibleLines.map((line, i) => {
          const realIndex = windowStart + i;
          const isActive = realIndex === activeIndex;
          const isPast = activeIndex >= 0 && realIndex < activeIndex;

          const activeSideCls = isLarge
            ? 'text-white text-xl lg:text-2xl xl:text-3xl 2xl:text-4xl 3xl:text-5xl font-semibold leading-snug'
            : 'text-white text-base lg:text-lg xl:text-xl 2xl:text-2xl font-semibold leading-snug';
          const pastSideCls = isLarge
            ? 'text-white/20 text-base lg:text-lg xl:text-xl 2xl:text-2xl 3xl:text-3xl leading-snug'
            : 'text-white/20 text-sm lg:text-base xl:text-lg 2xl:text-xl leading-snug';
          const futureSideCls = isLarge
            ? 'text-white/35 text-base lg:text-lg xl:text-xl 2xl:text-2xl 3xl:text-3xl leading-snug'
            : 'text-white/35 text-sm lg:text-base xl:text-lg 2xl:text-xl leading-snug';

          return (
            <div
              key={`${line.time}-${realIndex}`}
              ref={isActive ? activeRef : undefined}
              onClick={onSeek ? () => onSeek(line.time) : undefined}
              className={`${onSeek ? 'cursor-pointer' : ''} ${
                isActive || isPast ? 'transition-none' : 'transition-colors duration-150'
              } ${isSide ? (mobileCentered ? 'text-center lg:text-left' : 'text-left') : 'text-center'} ${
                isActive
                  ? isSide
                    ? activeSideCls
                    : 'text-white text-xl font-bold scale-[1.02]'
                  : isPast
                    ? isSide ? pastSideCls : 'text-white/25 text-base'
                    : isSide ? futureSideCls : 'text-white/45 text-base hover:text-white/60'
              }`}
            >
              <p>{line.text}</p>
              {showTranslation && line.translation && (
                <p className={`mt-0.5 ${isLarge ? 'text-sm lg:text-base 2xl:text-xl 3xl:text-2xl' : 'text-xs 2xl:text-sm'} ${isActive ? 'text-white/60' : 'text-white/15'}`}>
                  {line.translation}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MemoLyricsContent = memo(LyricsContent);

export default memo(Lyrics);
