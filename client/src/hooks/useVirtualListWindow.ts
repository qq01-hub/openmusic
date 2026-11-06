import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

interface Options {
  count: number;
  itemSize: number;
  overscan?: number;
  minVirtualCount?: number;
  defaultViewportHeight?: number;
  resetKey?: string | number;
}

interface VirtualWindowResult {
  startIndex: number;
  endIndex: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
}

const STEP_GRANULARITY = 2;

function computeWindow(
  scrollTop: number,
  clientHeight: number,
  count: number,
  itemSize: number,
  overscan: number,
  minVirtualCount: number,
): { start: number; end: number } {
  if (count <= minVirtualCount || itemSize <= 0) {
    return { start: 0, end: count };
  }
  const safeHeight = clientHeight > 0 ? clientHeight : 520;
  const rawStart = Math.max(0, Math.floor(scrollTop / itemSize) - overscan);
  const start = Math.floor(rawStart / STEP_GRANULARITY) * STEP_GRANULARITY;
  const visibleCount = Math.ceil(safeHeight / itemSize) + overscan * 2 + STEP_GRANULARITY;
  const end = Math.min(count, start + visibleCount);
  return { start, end };
}

/**
 * 轻量流式虚拟窗口：仅在列表项超过阈值时按需挂载可视区附近的行，
 * 通过上下占位高度保持原生滚动条与普通文档流布局
 */
export function useVirtualListWindow(
  scrollRef: RefObject<HTMLElement | null>,
  {
    count,
    itemSize,
    overscan = 5,
    minVirtualCount = 20,
    defaultViewportHeight = 520,
    resetKey,
  }: Options,
): VirtualWindowResult {
  const [range, setRange] = useState<{ start: number; end: number }>(() =>
    computeWindow(0, defaultViewportHeight, count, itemSize, overscan, minVirtualCount),
  );

  const syncWindow = useCallback(() => {
    const el = scrollRef.current;
    const scrollTop = el ? el.scrollTop : 0;
    const clientHeight = el && el.clientHeight > 0 ? el.clientHeight : defaultViewportHeight;
    const next = computeWindow(scrollTop, clientHeight, count, itemSize, overscan, minVirtualCount);
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [count, defaultViewportHeight, itemSize, minVirtualCount, overscan, scrollRef]);

  useLayoutEffect(() => {
    syncWindow();
  }, [syncWindow, resetKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || count <= minVirtualCount) return;
    const onScroll = () => {
      syncWindow();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, [count, minVirtualCount, scrollRef, syncWindow]);

  if (count <= minVirtualCount) {
    return {
      startIndex: 0,
      endIndex: count,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
    };
  }

  const startIndex = Math.min(range.start, Math.max(0, count - 1));
  const endIndex = Math.max(startIndex, Math.min(count, range.end));
  const topSpacerPx = startIndex * itemSize;
  const bottomSpacerPx = Math.max(0, (count - endIndex) * itemSize);

  return {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
  };
}