import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import {
  nextPlayMode,
  normalizePlayMode,
  PLAY_MODE_META,
  PLAY_MODE_ORDER,
  resolvePlayModeSelection,
  shouldOpenPlayModeMenu,
  type PlayMode,
} from '../lib/playMode';
import { isMobileDevice } from '../lib/audioUnlock';
import Tooltip from './Tooltip';
import { useSiteFeaturesStore } from '../stores/siteFeaturesStore';
import { getFmSourceLabel, normalizeFmSource, type FmSource } from '../api/music/fmMode';

interface Props {
  className?: string;
  iconClassName?: string;
}

type MenuPosition = { left: number; top: number };

const PLAY_MODE_MENU_WIDTH = 280;
const PLAY_MODE_MENU_HEIGHT = 400;
const PLAY_MODE_MENU_GAP = 8;
const MOBILE_DOUBLE_CLICK_DELAY = 280;

function clampMenuPosition(left: number, top: number): MenuPosition {
  const maxLeft = Math.max(PLAY_MODE_MENU_GAP, window.innerWidth - PLAY_MODE_MENU_WIDTH - PLAY_MODE_MENU_GAP);
  const maxTop = Math.max(PLAY_MODE_MENU_GAP, window.innerHeight - PLAY_MODE_MENU_HEIGHT - PLAY_MODE_MENU_GAP);
  return {
    left: Math.min(Math.max(left, PLAY_MODE_MENU_GAP), maxLeft),
    top: Math.min(Math.max(top, PLAY_MODE_MENU_GAP), maxTop),
  };
}

function getMenuPositionAtPoint(x: number, y: number): MenuPosition {
  const top = y + PLAY_MODE_MENU_HEIGHT + PLAY_MODE_MENU_GAP > window.innerHeight - PLAY_MODE_MENU_GAP
    ? y - PLAY_MODE_MENU_HEIGHT - PLAY_MODE_MENU_GAP
    : y + PLAY_MODE_MENU_GAP;
  return clampMenuPosition(x, top);
}

function getMenuPositionForButton(button: HTMLButtonElement): MenuPosition {
  const rect = button.getBoundingClientRect();
  const left = rect.left + rect.width / 2 - PLAY_MODE_MENU_WIDTH / 2;
  const below = rect.bottom + PLAY_MODE_MENU_GAP;
  const above = rect.top - PLAY_MODE_MENU_HEIGHT - PLAY_MODE_MENU_GAP;
  const top = below + PLAY_MODE_MENU_HEIGHT <= window.innerHeight - PLAY_MODE_MENU_GAP
    ? below
    : above;
  return clampMenuPosition(left, top);
}

function showPlayModeToast(message: string, type: 'success' | 'error'): void {
  window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
    detail: { message, type },
  }));
}

export default function PlayModeButton({
  className = '',
  iconClassName = 'h-4 w-4',
}: Props) {
  const playMode = useRoomStore((s) => normalizePlayMode(s.room?.playMode));
  const canControl = useRoomStore((s) => s.canControlPlayback);
  const artistShuffle = useRoomStore((s) => s.room?.artistShuffle);
  const fmSource = useRoomStore((s) => s.room?.fmSource);
  const enabledSources = useSiteFeaturesStore((s) => s.musicSourcesEnabled);
  const { setRoomPlayMode } = useSocket();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [artistEditorOpen, setArtistEditorOpen] = useState(false);
  const [artist, setArtist] = useState('');
  const [artistSource, setArtistSource] = useState<FmSource>('netease');
  const [includeCollaborations, setIncludeCollaborations] = useState(false);
  const [artistError, setArtistError] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingClickRef = useRef<number | null>(null);
  const isMobile = isMobileDevice();
  const meta = PLAY_MODE_META[playMode];
  const nextMode = nextPlayMode(playMode);
  const nextMeta = PLAY_MODE_META[nextMode];
  const Icon = meta.Icon;

  const clearPendingClick = useCallback(() => {
    if (pendingClickRef.current === null) return;
    window.clearTimeout(pendingClickRef.current);
    pendingClickRef.current = null;
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuPosition(null);
  }, []);

  const openMenuAtPoint = useCallback((x: number, y: number) => {
    if (busy) return;
    setArtistEditorOpen(false);
    setMenuPosition(getMenuPositionAtPoint(x, y));
    setMenuOpen(true);
  }, [busy]);

  const openMenuForButton = useCallback(() => {
    if (busy || !buttonRef.current) return;
    setArtistEditorOpen(false);
    setMenuPosition(getMenuPositionForButton(buttonRef.current));
    setMenuOpen(true);
  }, [busy]);

  const selectPlayMode = useCallback(async (value: unknown) => {
    const mode = resolvePlayModeSelection(value);
    if (!mode || !canControl || busy) return;
    if (mode === 'artist-shuffle') {
      const preferredSource = normalizeFmSource(artistShuffle?.source || fmSource);
      setArtist(artistShuffle?.artist || '');
      setArtistSource(enabledSources[preferredSource] ? preferredSource : ((Object.keys(enabledSources) as FmSource[]).find((source) => enabledSources[source]) || preferredSource));
      setIncludeCollaborations(artistShuffle?.includeCollaborations === true);
      setArtistError('');
      setArtistEditorOpen(true);
      if (!menuOpen && buttonRef.current) setMenuPosition(getMenuPositionForButton(buttonRef.current));
      setMenuOpen(true);
      return;
    }

    setMenuOpen(false);
    setMenuPosition(null);
    setBusy(true);
    try {
      const res = await setRoomPlayMode(mode);
      if (!res.success) {
        showPlayModeToast(res.error || '切换失败', 'error');
      } else {
        showPlayModeToast(PLAY_MODE_META[mode].label, 'success');
      }
    } catch {
      showPlayModeToast('切换失败，请稍后重试', 'error');
    } finally {
      setBusy(false);
    }
  }, [artistShuffle, busy, canControl, enabledSources, fmSource, menuOpen, setRoomPlayMode]);

  const submitArtist = async () => {
    if (!canControl || busy) return;
    if (!artist.trim()) {
      setArtistError('请填写歌手名称');
      return;
    }
    setArtistError('');
    setBusy(true);
    try {
      const res = await setRoomPlayMode('artist-shuffle', { artist: artist.trim(), source: artistSource, includeCollaborations });
      if (!res.success) {
        setArtistError(res.error || '歌手无效，未找到可播放歌曲');
        return;
      }
      closeMenu();
      showPlayModeToast(`歌手随机：${artist.trim()}`, 'success');
    } catch {
      setArtistError('查找歌手歌曲失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const handleCycle = useCallback(() => {
    void selectPlayMode(nextMode);
  }, [nextMode, selectPlayMode]);

  const handleClick = useCallback(() => {
    if (!isMobile) {
      handleCycle();
      return;
    }

    if (pendingClickRef.current !== null) {
      clearPendingClick();
      openMenuForButton();
      return;
    }

    pendingClickRef.current = window.setTimeout(() => {
      pendingClickRef.current = null;
      handleCycle();
    }, MOBILE_DOUBLE_CLICK_DELAY);
  }, [clearPendingClick, handleCycle, isMobile, openMenuForButton]);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!shouldOpenPlayModeMenu('contextmenu', isMobile)) return;
    openMenuAtPoint(event.clientX, event.clientY);
  }, [isMobile, openMenuAtPoint]);

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (!shouldOpenPlayModeMenu('doubleclick', isMobile)) return;
    event.preventDefault();
    clearPendingClick();
    openMenuForButton();
  }, [clearPendingClick, isMobile, openMenuForButton]);

  useEffect(() => () => clearPendingClick(), [clearPendingClick]);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      closeMenu();
    };
    const onViewportChange = () => closeMenu();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [closeMenu, menuOpen]);

  const tip = canControl
    ? `当前：${meta.label}${playMode === 'artist-shuffle' && artistShuffle ? `（${artistShuffle.artist}）` : ''}，点击切换为${nextMeta.label}；${isMobile ? '双击展开选项' : '右键展开选项'}`
    : `当前：${meta.label}（仅房主或管理员可切换）`;

  return (
    <>
      <Tooltip content={tip} tapToShow={!canControl}>
        <button
          ref={buttonRef}
          type="button"
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onDoubleClick={handleDoubleClick}
          disabled={busy}
          className={`inline-flex min-h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-full transition-[color,background-color,opacity,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-netease-red/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-wait disabled:opacity-50 ${
            !canControl ? 'cursor-not-allowed opacity-50' : 'active:scale-95'
          } ${
            playMode === 'order'
              ? 'text-netease-muted hover:bg-white/10 hover:text-white'
              : 'text-netease-red hover:bg-netease-red/15'
          } ${className}`}
          aria-label={tip}
          aria-disabled={!canControl || busy}
          aria-busy={busy}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-play-mode={playMode}
        >
          <Icon className={iconClassName} />
        </button>
      </Tooltip>

      {menuOpen && menuPosition && createPortal(
        <div
          ref={menuRef}
          role={artistEditorOpen ? 'dialog' : 'menu'}
          aria-label={artistEditorOpen ? '歌手随机设置' : '播放顺序选项'}
          tabIndex={-1}
          className="fixed z-[230] max-h-[calc(100vh-16px)] w-[280px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-white/10 bg-[#17191f]/[.98] p-1.5 text-white shadow-2xl shadow-black/40 backdrop-blur-xl animate-fade-in"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {artistEditorOpen ? (
            <form className="space-y-3 p-2.5" onSubmit={(event) => { event.preventDefault(); void submitArtist(); }}>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="返回播放模式" disabled={busy} onClick={() => setArtistEditorOpen(false)} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-netease-red disabled:opacity-50">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <p className="text-sm font-medium">歌手随机</p>
              </div>
              <label className="block text-xs text-white/75">
                歌手名称
                <input autoFocus value={artist} onChange={(event) => { setArtist(event.target.value); setArtistError(''); }} maxLength={80} disabled={!canControl || busy} placeholder="填写完整歌手名" aria-invalid={Boolean(artistError)} aria-describedby={artistError ? 'artist-shuffle-error' : undefined} className="mt-1.5 min-h-10 w-full rounded-lg border border-white/20 bg-white/5 px-3 text-sm text-white placeholder:text-white/55 focus:border-netease-red focus:outline-none disabled:opacity-50" />
              </label>
              <label className="block text-xs text-white/75">
                音乐源
                <select value={artistSource} onChange={(event) => setArtistSource(event.target.value as FmSource)} disabled={!canControl || busy} className="mt-1.5 min-h-10 w-full rounded-lg border border-white/20 bg-[#17191f] px-2 text-sm text-white focus:border-netease-red focus:outline-none disabled:opacity-50">
                  {(Object.keys(enabledSources) as FmSource[]).filter((source) => enabledSources[source]).map((source) => <option key={source} value={source}>{getFmSourceLabel(source)}</option>)}
                </select>
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-white/90">
                <input type="checkbox" checked={includeCollaborations} onChange={(event) => setIncludeCollaborations(event.target.checked)} disabled={!canControl || busy} className="h-4 w-4 accent-netease-red" />
                包含其他歌手合唱
              </label>
              <p className="text-xs leading-relaxed text-white/65">默认只选该歌手独唱，禁播歌曲自动排除，已播放歌曲降低权重，全部播过后重置</p>
              {artistError && <p id="artist-shuffle-error" role="alert" className="text-xs leading-relaxed text-red-300">{artistError}</p>}
              <button type="submit" disabled={!canControl || busy || !artist.trim() || !enabledSources[artistSource]} aria-busy={busy} className="min-h-10 w-full rounded-lg bg-netease-red px-3 text-sm font-medium text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-50">{busy ? '正在查找歌曲…' : '开启歌手随机'}</button>
            </form>
          ) : <>
          <div className="border-b border-white/10 px-2.5 pb-2 pt-1">
            <p className="text-[13px] font-medium text-white/95">播放顺序</p>
            <p className="mt-0.5 text-[11px] text-white/45">
              {canControl ? `当前：${meta.label}` : '仅房主或管理员可切换'}
            </p>
          </div>
          <div className="mt-1 space-y-0.5">
            {PLAY_MODE_ORDER.map((mode: PlayMode) => {
              const option = PLAY_MODE_META[mode];
              const OptionIcon = option.Icon;
              const active = mode === playMode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  disabled={!canControl || busy}
                  className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    active
                      ? 'bg-netease-red/15 text-white'
                      : 'text-white/75 hover:bg-white/10 hover:text-white'
                  }`}
                  onClick={() => void selectPlayMode(mode)}
                >
                  <OptionIcon className={`h-4 w-4 shrink-0 ${active ? 'text-netease-red' : 'text-white/50'}`} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-netease-red" />}
                  {mode === 'artist-shuffle' && <ChevronRight className="h-4 w-4 shrink-0 text-white/60" />}
                </button>
              );
            })}
          </div>
          </>}
        </div>,
        document.body,
      )}
    </>
  );
}
