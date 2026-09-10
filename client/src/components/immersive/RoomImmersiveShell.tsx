import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ListMusic, Maximize2, MessageCircle, Minimize2, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  exitDocumentFullscreen,
  isDocumentFullscreen,
  requestElementFullscreen,
  subscribeFullscreenChange,
} from '../../lib/browserFullscreen';
import QueueSystemToast from '../QueueSystemToast';
import Tooltip from '../Tooltip';

type PanelId = 'search' | 'queue' | 'chat';

/** Mineradio PEEK_HIDE_DELAY ≈ 170ms */
const CLOSE_DELAY_MS = 120;
const CLOSE_DELAY_FAST_MS = 50;
const PANEL_EXIT_PAD = 24;
const EDGE_SIZE = 14;
const BOTTOM_BAR_CLOSE_DELAY_MS = 420;
const FX_FAB_PEEK_DELAY_MS = 1100;
/** 鼠标静止多久后把整套沉浸 UI 渐隐 */
const CHROME_IDLE_MS = 3000;

interface Props {
  className?: string;
  onExit: () => void;
  onPanelFocusChange?: (panel: 'search' | 'queue' | 'chat' | null) => void;
  searchBar: ReactNode;
  searchExtras?: ReactNode;
  searchResults?: ReactNode;
  showSearchResults?: boolean;
  queueContent: ReactNode;
  chatContent: ReactNode;
  settingsPanel: ReactNode;
  player: ReactNode;
}

function EdgeHint({
  label,
  icon: Icon,
  side,
  visible,
}: {
  label: string;
  icon: typeof Search;
  side: 'top' | 'left' | 'right';
  visible: boolean;
}) {
  const sideClass =
    side === 'top'
      ? 'left-1/2 top-0 -translate-x-1/2 rounded-b-xl border-t-0 px-4 py-1'
      : side === 'left'
        ? 'left-0 top-1/2 -translate-y-1/2 rounded-r-xl border-l-0 py-3 pl-1.5 pr-2'
        : 'right-0 top-1/2 -translate-y-1/2 rounded-l-xl border-r-0 py-3 pl-2 pr-1.5';

  return (
    <div
      className={`pointer-events-none absolute z-20 flex items-center gap-1 border border-white/15 bg-black/32 text-[10px] font-medium tracking-wide text-white/78 backdrop-blur-md transition-all duration-300 ${sideClass} ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden
    >
      <Icon className="h-3.5 w-3.5" />
      <span className={side === 'left' || side === 'right' ? '[writing-mode:vertical-rl]' : ''}>{label}</span>
    </div>
  );
}

export default function RoomImmersiveShell({
  className,
  onExit,
  onPanelFocusChange,
  searchBar,
  searchExtras,
  searchResults,
  showSearchResults = false,
  queueContent,
  chatContent,
  settingsPanel,
  player,
}: Props) {
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  // 一旦某面板被打开过就保持内容挂载,收起时仅用 CSS 离屏隐藏,
  // 避免重新挂载导致列表图片重载(黑一下再加载);初进沉浸不会三面板全挂载。
  const [mountedPanels, setMountedPanels] = useState<Record<PanelId, boolean>>({
    search: false,
    queue: false,
    chat: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fxFabAutoHide, setFxFabAutoHide] = useState(false);
  const [fxFabPeek, setFxFabPeek] = useState(true);
  const [bottomBarVisible, setBottomBarVisible] = useState(false);
  const [chromeIdle, setChromeIdle] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(() => isDocumentFullscreen());
  const chromeHoverRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const bottomBarCloseTimerRef = useRef<number | null>(null);
  const fxFabPeekTimerRef = useRef<number | null>(null);
  const panelHoverRef = useRef(false);
  const edgeHoverRef = useRef(false);
  const lastPointerRef = useRef({ x: -1, y: -1 });
  const openPanelRef = useRef<PanelId | null>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const queuePanelRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    openPanelRef.current = openPanel;
  }, [openPanel]);

  useEffect(() => {
    if (!openPanel) return;
    setMountedPanels((prev) => (prev[openPanel] ? prev : { ...prev, [openPanel]: true }));
  }, [openPanel]);

  useEffect(() => {
    const sync = () => setIsNativeFullscreen(isDocumentFullscreen());
    sync();
    return subscribeFullscreenChange(sync);
  }, []);

  useEffect(() => {
    return () => {
      void exitDocumentFullscreen();
    };
  }, []);

  const toggleNativeFullscreen = useCallback(async () => {
    try {
      if (isDocumentFullscreen()) {
        await exitDocumentFullscreen();
      } else {
        await requestElementFullscreen(document.documentElement);
      }
    } catch {
      // 浏览器可能拒绝或需用户手势
    }
  }, []);

  const cancelBottomBarClose = useCallback(() => {
    if (bottomBarCloseTimerRef.current !== null) {
      window.clearTimeout(bottomBarCloseTimerRef.current);
      bottomBarCloseTimerRef.current = null;
    }
  }, []);

  const cancelFxFabPeek = useCallback(() => {
    if (fxFabPeekTimerRef.current !== null) {
      window.clearTimeout(fxFabPeekTimerRef.current);
      fxFabPeekTimerRef.current = null;
    }
  }, []);

  const revealFxFab = useCallback(() => {
    cancelFxFabPeek();
    setFxFabPeek(true);
  }, [cancelFxFabPeek]);

  const scheduleFxFabHide = useCallback(() => {
    cancelFxFabPeek();
    if (!fxFabAutoHide || settingsOpen) return;
    fxFabPeekTimerRef.current = window.setTimeout(() => {
      setFxFabPeek(false);
      fxFabPeekTimerRef.current = null;
    }, FX_FAB_PEEK_DELAY_MS);
  }, [cancelFxFabPeek, fxFabAutoHide, settingsOpen]);

  const showBottomBar = useCallback(() => {
    cancelBottomBarClose();
    setBottomBarVisible(true);
  }, [cancelBottomBarClose]);

  const scheduleBottomBarClose = useCallback(() => {
    cancelBottomBarClose();
    bottomBarCloseTimerRef.current = window.setTimeout(() => {
      setBottomBarVisible(false);
      bottomBarCloseTimerRef.current = null;
    }, BOTTOM_BAR_CLOSE_DELAY_MS);
  }, [cancelBottomBarClose]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const isPointInRect = useCallback((x: number, y: number, rect: DOMRect | undefined | null, pad = 0) => {
    if (!rect) return false;
    return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
  }, []);

  const shouldKeepPanelOpen = useCallback(
    (panel: PanelId | null, x: number, y: number) => {
      if (!panel) return false;
      const panelRef =
        panel === 'search' ? searchPanelRef : panel === 'queue' ? queuePanelRef : chatPanelRef;
      return isPointInRect(x, y, panelRef.current?.getBoundingClientRect(), 4);
    },
    [isPointInRect],
  );

  const shouldClosePanelFromPointer = useCallback(
    (panel: PanelId | null, x: number, y: number) => {
      if (!panel) return true;
      const panelRef =
        panel === 'search' ? searchPanelRef : panel === 'queue' ? queuePanelRef : chatPanelRef;
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return true;
      if (panel === 'queue') return x > rect.right + PANEL_EXIT_PAD;
      if (panel === 'chat') return x < rect.left - PANEL_EXIT_PAD;
      return y > rect.bottom + 20;
    },
    [],
  );

  const scheduleClose = useCallback(
    (fast = false) => {
      cancelClose();
      closeTimerRef.current = window.setTimeout(() => {
        const panel = openPanelRef.current;
        const { x, y } = lastPointerRef.current;
        if (panel && shouldKeepPanelOpen(panel, x, y)) return;
        setOpenPanel(null);
        panelHoverRef.current = false;
        edgeHoverRef.current = false;
        closeTimerRef.current = null;
      }, fast ? CLOSE_DELAY_FAST_MS : CLOSE_DELAY_MS);
    },
    [cancelClose, shouldKeepPanelOpen],
  );

  const scheduleCloseFromEdge = useCallback(() => {
    edgeHoverRef.current = false;
    scheduleClose(true);
  }, [scheduleClose]);

  const openFromEdge = useCallback(
    (panel: PanelId) => {
      edgeHoverRef.current = true;
      cancelClose();
      setOpenPanel(panel);
    },
    [cancelClose],
  );

  const syncPanelOpenFromPointer = useCallback(
    (x: number, y: number) => {
      lastPointerRef.current = { x, y };
      const panel = openPanelRef.current;
      if (!panel || settingsOpen) return;
      const keepOpen = shouldKeepPanelOpen(panel, x, y);
      panelHoverRef.current = keepOpen;
      if (keepOpen) {
        cancelClose();
        return;
      }
      const fast = shouldClosePanelFromPointer(panel, x, y);
      // 明显离开面板区域：立即重设短倒计时；贴近边缘时避免每次移动都推迟收起
      if (fast || closeTimerRef.current === null) {
        scheduleClose(fast);
      }
    },
    [cancelClose, scheduleClose, settingsOpen, shouldClosePanelFromPointer, shouldKeepPanelOpen],
  );

  const handlePanelEnter = useCallback(() => {
    panelHoverRef.current = true;
    edgeHoverRef.current = false;
    cancelClose();
  }, [cancelClose]);

  const handlePanelLeave = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      panelHoverRef.current = false;
      const panel = openPanelRef.current;
      if (!panel) return;
      scheduleClose(shouldClosePanelFromPointer(panel, e.clientX, e.clientY));
    },
    [scheduleClose, shouldClosePanelFromPointer],
  );

  useEffect(
    () => () => {
      cancelClose();
      cancelBottomBarClose();
      cancelFxFabPeek();
    },
    [cancelBottomBarClose, cancelClose, cancelFxFabPeek],
  );

  useEffect(() => {
    onPanelFocusChange?.(openPanel);
  }, [onPanelFocusChange, openPanel]);

  useEffect(() => {
    if (!openPanel || settingsOpen) return;
    const onPointerMove = (e: PointerEvent) => {
      syncPanelOpenFromPointer(e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [openPanel, settingsOpen, syncPanelOpenFromPointer]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (openPanel) {
        setOpenPanel(null);
        return;
      }
      onExit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onExit, openPanel, settingsOpen]);

  useEffect(() => {
    if (settingsOpen) {
      setFxFabPeek(true);
      cancelFxFabPeek();
      return;
    }
    scheduleFxFabHide();
  }, [cancelFxFabPeek, scheduleFxFabHide, settingsOpen]);

  const anyPanelOpen = openPanel !== null || settingsOpen;

  // 鼠标静止 3 秒后整套 UI 渐隐；面板展开或指针停在某块 UI 上时不计时
  const wakeChrome = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setChromeIdle((prev) => (prev ? false : prev));
    if (anyPanelOpen || chromeHoverRef.current) return;
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setChromeIdle(true);
    }, CHROME_IDLE_MS);
  }, [anyPanelOpen]);

  const holdChrome = useCallback(() => {
    chromeHoverRef.current = true;
    wakeChrome();
  }, [wakeChrome]);

  const releaseChrome = useCallback(() => {
    chromeHoverRef.current = false;
    wakeChrome();
  }, [wakeChrome]);

  useEffect(() => {
    wakeChrome();
    const onActivity = () => wakeChrome();
    window.addEventListener('pointermove', onActivity, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('wheel', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    return () => {
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('wheel', onActivity);
      window.removeEventListener('keydown', onActivity);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [wakeChrome]);

  const chatDocked = openPanel === 'chat' && !settingsOpen;
  const openSettingsPanel = useCallback(() => {
    setOpenPanel(null);
    setFxFabPeek(true);
    setSettingsOpen(true);
  }, []);

  const closeSettingsPanel = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  return (
    <div className={`room-immersive-mode fixed inset-0 z-40 pointer-events-none${className ? ` ${className}` : ''}`}>
      <div
        className="absolute inset-x-0 bottom-0 h-[88px] bg-gradient-to-t from-black/14 to-transparent"
        aria-hidden
      />

      <div
        className="absolute top-0 left-0 right-0 pointer-events-auto z-30"
        style={{ height: EDGE_SIZE }}
        onMouseEnter={() => openFromEdge('search')}
        onMouseLeave={scheduleCloseFromEdge}
      />
      <div
        className="absolute top-0 left-0 bottom-0 pointer-events-auto z-30"
        style={{ width: EDGE_SIZE }}
        onMouseEnter={() => openFromEdge('queue')}
        onMouseLeave={scheduleCloseFromEdge}
      />
      <div
        className="absolute top-0 right-0 bottom-0 pointer-events-auto z-30"
        style={{ width: EDGE_SIZE, bottom: 112 }}
        onMouseEnter={() => openFromEdge('chat')}
        onMouseLeave={scheduleCloseFromEdge}
      />
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-auto z-30"
        style={{ height: 28 }}
        onMouseEnter={showBottomBar}
      />
      <EdgeHint label="搜索" icon={Search} side="top" visible={!anyPanelOpen && !chromeIdle} />
      <EdgeHint label="队列" icon={ListMusic} side="left" visible={!anyPanelOpen && !chromeIdle} />
      <EdgeHint label="聊天" icon={MessageCircle} side="right" visible={!anyPanelOpen && !chromeIdle} />

      <div
        className={`absolute right-4 top-4 z-[72] flex items-center gap-2 transition-opacity duration-500 ${
          chromeIdle ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
        }`}
        onMouseEnter={holdChrome}
        onMouseLeave={releaseChrome}
      >
        <Tooltip content={isNativeFullscreen ? '退出全屏 (Esc)' : '浏览器原生全屏'}>
          <button
            type="button"
            onClick={() => {
              void toggleNativeFullscreen();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-white/70 backdrop-blur-xl transition-colors hover:bg-black/40 hover:text-white"
            aria-label={isNativeFullscreen ? '退出浏览器全屏' : '进入浏览器全屏'}
            aria-pressed={isNativeFullscreen}
          >
            {isNativeFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span>{isNativeFullscreen ? '退出全屏' : '全屏'}</span>
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={onExit}
          className="rounded-xl border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-white/70 backdrop-blur-xl transition-colors hover:bg-black/40 hover:text-white"
        >
          退出沉浸
        </button>
      </div>

      <button
        type="button"
        id="fx-fab"
        onMouseEnter={() => {
          holdChrome();
          revealFxFab();
        }}
        onMouseLeave={() => {
          releaseChrome();
          scheduleFxFabHide();
        }}
        onClick={openSettingsPanel}
        className={`immersive-fx-fab ${settingsOpen ? 'active' : ''} ${chatDocked ? 'chat-docked' : ''} ${fxFabAutoHide && !fxFabPeek && !settingsOpen ? 'auto-hidden' : ''} ${chromeIdle ? 'idle-hidden' : ''}`}
        style={{ pointerEvents: 'auto' }}
        aria-label="视觉控制台"
        aria-expanded={settingsOpen}
      >
        <SlidersHorizontal className="h-[21px] w-[21px]" />
      </button>
      <button
        type="button"
        id="fx-fab-hide-btn"
        onMouseEnter={() => {
          holdChrome();
          revealFxFab();
        }}
        onMouseLeave={() => {
          releaseChrome();
          scheduleFxFabHide();
        }}
        onClick={(e) => {
          e.stopPropagation();
          setFxFabAutoHide((prev) => {
            const next = !prev;
            if (!next) setFxFabPeek(true);
            return next;
          });
        }}
        className={`immersive-fx-fab-hide ${fxFabAutoHide ? 'on' : ''} ${chatDocked ? 'chat-docked' : ''} ${fxFabAutoHide && !fxFabPeek && !settingsOpen ? 'auto-hidden' : ''} ${chromeIdle ? 'idle-hidden' : ''}`}
        style={{ pointerEvents: 'auto' }}
        title={fxFabAutoHide ? '取消自动隐藏视觉控制台' : '自动隐藏视觉控制台'}
        aria-label={fxFabAutoHide ? '取消自动隐藏视觉控制台' : '自动隐藏视觉控制台'}
      >
        <ChevronLeft className="h-3 w-3" />
      </button>

      <div
        ref={searchPanelRef}
        className={`fixed left-1/2 top-4 z-[70] w-[min(620px,calc(100vw-56px))] -translate-x-1/2 transition-transform duration-[280ms] ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
          openPanel === 'search'
            ? 'pointer-events-auto translate-y-0'
            : 'pointer-events-none -translate-y-[calc(100%+1.5rem)]'
        }`}
        onPointerEnter={handlePanelEnter}
        onPointerLeave={handlePanelLeave}
      >
        <div
          className={`mineradio-glass-panel flex flex-col overflow-hidden rounded-[24px] p-3 ${
            showSearchResults ? 'h-[min(78vh,720px)]' : 'max-h-[min(78vh,720px)]'
          }`}
        >
          <div className="shrink-0">{searchBar}</div>
          {searchExtras ? <div className="mt-2 shrink-0 px-0.5">{searchExtras}</div> : null}
          {showSearchResults && searchResults ? (
            <div id="search-results" className="mineradio-glass-search-results mt-2 flex min-h-0 flex-1 flex-col overflow-hidden p-3">
              {searchResults}
            </div>
          ) : null}
        </div>
      </div>

      <div
        ref={queuePanelRef}
        className={`fixed left-0 top-0 z-[68] h-full w-[min(380px,calc(100vw-48px))] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          openPanel === 'queue'
            ? 'pointer-events-auto translate-x-0'
            : 'pointer-events-none -translate-x-full'
        }`}
        onPointerEnter={handlePanelEnter}
        onPointerLeave={handlePanelLeave}
      >
        <div className="mineradio-glass-panel m-3 flex h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-[22px]">
          <div className="relative flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-medium text-white/90">播放队列</h2>
            <button
              type="button"
              onClick={() => setOpenPanel(null)}
              className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white"
              aria-label="关闭队列"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden p-2">
            {mountedPanels.queue ? queueContent : null}
            <QueueSystemToast />
          </div>
        </div>
      </div>

      <div
        ref={chatPanelRef}
        className={`fixed right-0 top-0 z-[68] h-full w-[min(380px,calc(100vw-48px))] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          openPanel === 'chat' && !settingsOpen
            ? 'pointer-events-auto translate-x-0'
            : 'pointer-events-none translate-x-full'
        }`}
        onPointerEnter={handlePanelEnter}
        onPointerLeave={handlePanelLeave}
      >
        <div className="mineradio-glass-panel m-3 flex h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-[22px]">
          <div className="min-h-0 flex-1 overflow-hidden">{mountedPanels.chat ? chatContent : null}</div>
        </div>
      </div>

      {settingsOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[78]"
          style={{ pointerEvents: 'auto' }}
          onClick={closeSettingsPanel}
          aria-label="关闭视觉控制台遮罩"
        />
      ) : null}

      <div
        id="fx-panel"
        className={`mineradio-fx-panel pointer-events-auto fixed z-[79] transition-all duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          settingsOpen ? 'show' : ''
        }`}
        style={{
          right: settingsOpen ? '24px' : '-460px',
          bottom: '88px',
          opacity: settingsOpen ? 1 : 0,
          pointerEvents: settingsOpen ? 'auto' : 'none',
          transform: settingsOpen ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.97)',
        }}
        onMouseEnter={revealFxFab}
        onMouseLeave={scheduleFxFabHide}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fx-head">
          <div className="fx-head-main">
            <div className="fx-title">视觉控制台</div>
            <div className="fx-sub">MINERADIO VISUALS · 鼠标移开自动隐藏</div>
          </div>
          <div className="fx-head-actions">
            <button
              type="button"
              onClick={closeSettingsPanel}
              className="fx-close"
              aria-label="关闭设置"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mineradio-fx-panel-body">{settingsOpen ? settingsPanel : null}</div>
      </div>

      <div
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-[71] flex justify-center px-3 pb-4 transition-[transform,opacity] duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          bottomBarVisible && !chromeIdle
            ? 'translate-y-0 opacity-100'
            : 'translate-y-[calc(100%+24px)] opacity-0'
        }`}
      >
        <div
          className="pointer-events-auto w-full max-w-[min(1120px,calc(100vw-clamp(20px,5vw,72px)))]"
          onMouseEnter={() => {
            holdChrome();
            showBottomBar();
          }}
          onMouseLeave={() => {
            releaseChrome();
            scheduleBottomBarClose();
          }}
        >
          {player}
        </div>
      </div>
    </div>
  );
}
