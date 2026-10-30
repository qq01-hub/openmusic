import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import {
  getGuideSelector,
  getPendingGuideSteps,
  isGuideScopeCompleted,
  markGuideFeatureUsed,
  markGuideScopeCompleted,
  markGuideSkipped,
  setGuideTourActive,
  subscribeGuideFeatureUsed,
  isGuideFeatureUsed,
  type GuideScope,
  type GuideSide,
  type GuideStep,
} from '../lib/userGuide';
import { isGuideExternallyPaused, subscribeGuidePause } from '../lib/guidePause';

interface Props {
  scope: GuideScope;
  /** 站点公告等弹窗打开时先别抢焦点 */
  paused?: boolean;
  /** 进房后略等布局稳定再开 */
  delayMs?: number;
}

const PAD = 10;
const VIEW_PAD = 12;
const POPOVER_GAP = 16;
const POPOVER_WIDTH = 360;

function isDesktopWidth() {
  return typeof window !== 'undefined' && window.innerWidth >= 1024;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function resolveSide(
  anchor: DOMRect,
  tipW: number,
  tipH: number,
  preferred: GuideSide = 'bottom',
): GuideSide {
  const space = {
    top: anchor.top - VIEW_PAD,
    bottom: window.innerHeight - anchor.bottom - VIEW_PAD,
    left: anchor.left - VIEW_PAD,
    right: window.innerWidth - anchor.right - VIEW_PAD,
  };
  const need = {
    top: tipH + POPOVER_GAP,
    bottom: tipH + POPOVER_GAP,
    left: tipW + POPOVER_GAP,
    right: tipW + POPOVER_GAP,
  };
  if (space[preferred] >= need[preferred]) return preferred;
  const order: GuideSide[] = [preferred, 'bottom', 'top', 'right', 'left'];
  for (const side of order) {
    if (space[side] >= need[side]) return side;
  }
  return preferred;
}

function popoverStyle(anchor: DOMRect, tipW: number, tipH: number, side: GuideSide): CSSProperties {
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  let top = 0;
  let left = 0;
  switch (side) {
    case 'top':
      top = anchor.top - POPOVER_GAP - tipH;
      left = cx - tipW / 2;
      break;
    case 'bottom':
      top = anchor.bottom + POPOVER_GAP;
      left = cx - tipW / 2;
      break;
    case 'left':
      top = cy - tipH / 2;
      left = anchor.left - POPOVER_GAP - tipW;
      break;
    case 'right':
      top = cy - tipH / 2;
      left = anchor.right + POPOVER_GAP;
      break;
  }
  return {
    position: 'fixed',
    top: clamp(top, VIEW_PAD, window.innerHeight - tipH - VIEW_PAD),
    left: clamp(left, VIEW_PAD, window.innerWidth - tipW - VIEW_PAD),
    width: tipW,
  };
}

function findAnchor(step: GuideStep): HTMLElement | null {
  const el = document.querySelector(getGuideSelector(step.id));
  if (!(el instanceof HTMLElement)) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 && rect.height < 2) return null;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  return el;
}

export default function UserGuideTour({ scope, paused = false, delayMs = 700 }: Props) {
  const [ready, setReady] = useState(false);
  const [steps, setSteps] = useState<GuideStep[]>([]);
  const [index, setIndex] = useState(0);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [popoverSize, setPopoverSize] = useState({ w: POPOVER_WIDTH, h: 180 });
  const [externalPaused, setExternalPaused] = useState(() => isGuideExternallyPaused());
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const blocked = paused || externalPaused;
  const active = ready && !blocked && steps.length > 0 && index < steps.length;
  const step = active ? steps[index] : null;

  useEffect(() => subscribeGuidePause(() => {
    setExternalPaused(isGuideExternallyPaused());
  }), []);

  const refreshSteps = useCallback((opts?: { resetIndex?: boolean }) => {
    if (isGuideScopeCompleted(scope)) {
      setSteps([]);
      return;
    }
    const rawPending = getPendingGuideSteps(scope, { isDesktop: isDesktopWidth() });
    if (rawPending.length === 0) {
      markGuideScopeCompleted(scope);
      setSteps([]);
      return;
    }
    // 不在开场时按锚点过滤：房间卡片等可能稍后才挂载，过滤掉就永远出不来
    setSteps(rawPending);
    if (opts?.resetIndex !== false) setIndex(0);
  }, [scope]);

  useEffect(() => {
    if (blocked || isGuideScopeCompleted(scope)) return;
    // 已开过指引、只是被更新弹窗打断：恢复即可，不重置进度
    if (ready && steps.length > 0) return;
    const timer = window.setTimeout(() => {
      refreshSteps({ resetIndex: true });
      setReady(true);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [scope, blocked, delayMs, refreshSteps, ready, steps.length]);

  useEffect(() => {
    setGuideTourActive(active);
    return () => setGuideTourActive(false);
  }, [active]);

  const goNext = useCallback(() => {
    setIndex((prev) => {
      const next = prev + 1;
      if (next >= steps.length) {
        markGuideScopeCompleted(scope);
        setSteps([]);
        return prev;
      }
      return next;
    });
  }, [scope, steps.length]);

  const advance = useCallback(() => {
    // 静默记已用，避免再触发 subscribe → goNext 造成「隔一步跳过」
    if (step) markGuideFeatureUsed(step.id, { emit: false });
    goNext();
  }, [step, goNext]);

  const skipAll = useCallback(() => {
    markGuideSkipped();
    setSteps([]);
  }, []);

  useEffect(() => {
    if (!active || !step) return;
    return subscribeGuideFeatureUsed((id) => {
      if (id === step.id) goNext();
    });
  }, [active, step, goNext]);

  // 弹窗暂停期间点过当前功能：恢复后直接进入下一步
  useEffect(() => {
    if (!active || !step) return;
    if (isGuideFeatureUsed(step.id)) goNext();
  }, [active, step, goNext]);

  // 锚点晚出现时多试几次，避免创建按钮/房间卡片被瞬间跳过
  useEffect(() => {
    if (!active || !step) {
      setAnchorRect(null);
      return;
    }

    let cancelled = false;
    let tries = 0;
    const maxTries = 40;

    const tick = () => {
      if (cancelled) return;
      const el = findAnchor(step);
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        setAnchorRect(el.getBoundingClientRect());
        return;
      }
      tries += 1;
      if (tries >= maxTries) {
        goNext();
        return;
      }
      window.setTimeout(tick, 100);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [active, step, goNext, index]);

  useEffect(() => {
    if (!active || !step) return;
    const onScrollOrResize = () => {
      const el = findAnchor(step);
      if (el) setAnchorRect(el.getBoundingClientRect());
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [active, step]);

  useLayoutEffect(() => {
    const tip = popoverRef.current;
    if (!tip) return;
    const rect = tip.getBoundingClientRect();
    setPopoverSize({ w: rect.width, h: rect.height });
  }, [step, anchorRect]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        skipAll();
      } else if (event.key === 'Enter' || event.key === 'ArrowRight') {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, skipAll, advance]);

  const hole = useMemo(() => {
    if (!anchorRect) return null;
    const top = Math.max(0, anchorRect.top - PAD);
    const left = Math.max(0, anchorRect.left - PAD);
    const right = Math.min(window.innerWidth, anchorRect.right + PAD);
    const bottom = Math.min(window.innerHeight, anchorRect.bottom + PAD);
    return {
      top,
      left,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }, [anchorRect]);

  const tipPlacement = useMemo(() => {
    if (!anchorRect || !step) return null;
    const tipW = Math.min(POPOVER_WIDTH, window.innerWidth - VIEW_PAD * 2);
    const side = resolveSide(anchorRect, tipW, popoverSize.h, step.side);
    return { side, style: popoverStyle(anchorRect, tipW, popoverSize.h, side) };
  }, [anchorRect, step, popoverSize]);

  const stopBubble = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  if (!active || !step || !hole || !tipPlacement) return null;

  const isLast = index >= steps.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[320]" role="dialog" aria-modal="true" aria-label="功能指引">
      {/* 聚光高亮：box-shadow 铺满灰色遮罩，避免四块面板高度为 0 时看不见 */}
      <div
        aria-hidden
        className="pointer-events-none fixed rounded-[14px] outline outline-2 outline-netease-red/85 outline-offset-2 transition-[top,left,width,height] duration-200"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.62)',
        }}
      />

      {/* 灰色区域可点下一步；中间镂空不挡高亮控件 */}
      {hole.top > 0 && (
        <div
          role="presentation"
          className="absolute left-0 right-0 top-0 cursor-pointer"
          style={{ height: hole.top }}
          onClick={advance}
        />
      )}
      {hole.bottom < window.innerHeight && (
        <div
          role="presentation"
          className="absolute bottom-0 left-0 right-0 cursor-pointer"
          style={{ top: hole.bottom }}
          onClick={advance}
        />
      )}
      {hole.left > 0 && (
        <div
          role="presentation"
          className="absolute cursor-pointer"
          style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }}
          onClick={advance}
        />
      )}
      {window.innerWidth - hole.right > 0 && (
        <div
          role="presentation"
          className="absolute cursor-pointer"
          style={{ top: hole.top, left: hole.right, right: 0, height: hole.height }}
          onClick={advance}
        />
      )}

      <div
        ref={popoverRef}
        style={tipPlacement.style}
        className="pointer-events-auto z-[321] flex max-h-[calc(100dvh-24px)] max-w-[min(380px,calc(100vw-24px))] animate-fade-in flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#16161c]/96 shadow-2xl shadow-black/50 backdrop-blur-xl"
        onClick={stopBubble}
        onMouseDown={stopBubble}
      >
        <div className="shrink-0 border-b border-white/8 bg-white/[0.025] px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-netease-red/90 sm:text-[13px]">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>新手指引</span>
            </div>
            <span className="shrink-0 tabular-nums text-xs text-white/45 sm:text-[13px]">
              {index + 1} / {steps.length}
            </span>
          </div>
          <div className="flex gap-1" aria-label={`进度 ${index + 1} / ${steps.length}`}>
            {steps.map((item, itemIndex) => (
              <span
                key={item.id}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  itemIndex <= index ? 'bg-netease-red' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-col px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white sm:text-lg">{step.title}</h3>
            </div>
            <button
              type="button"
              onClick={skipAll}
              className="min-h-11 shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:text-[13px]"
            >
              跳过指引
            </button>
          </div>
          <ul className="min-h-0 space-y-2.5 overflow-y-auto pr-1 text-base leading-6 sm:text-[15px]">
            {step.body.split('\n').filter(Boolean).map((line, lineIndex) => {
              const sep = line.indexOf('：');
              if (sep <= 0) {
                return (
                  <li key={line} className="flex gap-2.5 text-white/80">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-netease-red" />
                    <span>{line}</span>
                  </li>
                );
              }
              const name = line.slice(0, sep);
              const desc = line.slice(sep + 1);
              return (
                <li key={lineIndex} className="flex gap-2.5 text-white/80">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-netease-red" />
                  <span>
                    <span className="font-semibold text-white">{name}</span>
                    <span className="text-white/60">：</span>
                    <span>{desc}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex shrink-0 justify-end">
            <button
              type="button"
              onClick={advance}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-netease-red px-4 py-2 text-sm font-medium text-white shadow-lg shadow-netease-red/25 transition-colors hover:bg-netease-red/90"
            >
              {isLast ? '完成' : '下一步'}
              {!isLast && <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
