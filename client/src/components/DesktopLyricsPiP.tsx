import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Captions } from 'lucide-react';
import type { QueueItem } from '../types';
import { useTrackLyrics } from '../hooks/useTrackLyrics';
import { useSmoothPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import { useTrackDuration, clampPlaybackTime } from '../hooks/useTrackDuration';
import { filterDisplayLyrics, LYRIC_SYNC_LEAD_SEC } from '../api/music';
import { findActiveLyricIndex } from '../lib/lyricActiveIndex';
import { createElectronLyricsPayload, isElectronRenderer } from '../lib/electronLyrics';
import { getSourceShortLabel } from '../lib/sourceLabels';
import Tooltip from './Tooltip';

interface Props { song: QueueItem | null; }

const PIP_STYLE = `
  :root { --lyrics-scale: 1; color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #20262d; color: #fff; }
  body { display: flex; align-items: flex-start; }
  .desktop-lyrics { display: flex; min-height: 100%; width: 100%; flex-direction: column; padding: calc(7px * var(--lyrics-scale)) calc(14px * var(--lyrics-scale)) calc(5px * var(--lyrics-scale)); text-align: center; }
  .desktop-lyrics__meta { display: flex; align-items: center; justify-content: center; gap: calc(5px * var(--lyrics-scale)); max-width: 100%; margin-bottom: calc(7px * var(--lyrics-scale)); color: rgba(255,255,255,.45); font-size: calc(13px * var(--lyrics-scale)); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desktop-lyrics__title { max-width: 48%; color: rgba(255,255,255,.78); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .desktop-lyrics__line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; transition: color .18s ease, transform .18s ease; }
  .desktop-lyrics__line--active { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; white-space: normal; overflow-wrap: anywhere; color: #fff; font-size: calc(22px * var(--lyrics-scale)); font-weight: 700; line-height: 1.2; }
  .desktop-lyrics__line--near { color: rgba(255,255,255,.42); font-size: calc(16px * var(--lyrics-scale)); margin-top: calc(5px * var(--lyrics-scale)); }
  .desktop-lyrics__stage { display: flex; min-height: 0; flex: 1; flex-direction: column; justify-content: center; }
  .desktop-lyrics__translation { margin-left: calc(6px * var(--lyrics-scale)); color: rgba(255,255,255,.42); font-size: calc(10px * var(--lyrics-scale)); font-weight: 400; }
  .desktop-lyrics__empty { color: rgba(255,255,255,.58); font-size: calc(17px * var(--lyrics-scale)); font-weight: 600; }
  .desktop-lyrics__subtle { color: rgba(255,255,255,.38); font-size: calc(12px * var(--lyrics-scale)); margin-top: calc(3px * var(--lyrics-scale)); }
`;

function notify(message: string, type: 'success' | 'error' = 'error') {
  window.dispatchEvent(new CustomEvent('openmusic:visual-toast', { detail: { message, type } }));
}

function useDesktopLyricsState(song: QueueItem | null) {
  const currentTime = useSmoothPlaybackTime();
  const duration = useTrackDuration(song);
  const lyrics = useTrackLyrics(song);
  const displayLines = useMemo(() => filterDisplayLyrics(lyrics), [lyrics]);
  const activeIndex = findActiveLyricIndex(displayLines, clampPlaybackTime(currentTime, duration) + LYRIC_SYNC_LEAD_SEC);
  return { displayLines, activeIndex };
}

function DesktopLyricsContent({ song }: Props) {
  const { displayLines, activeIndex } = useDesktopLyricsState(song);
  if (!song) return null;
  const active = activeIndex >= 0 ? displayLines[activeIndex] : null;
  const next = activeIndex >= 0 ? displayLines[activeIndex + 1] : null;
  return (
    <main className="desktop-lyrics" aria-live="polite">
      <div className="desktop-lyrics__meta"><span className="desktop-lyrics__title">{song.name}</span><span>·</span><span>{song.artist}</span><span>·</span><span>{getSourceShortLabel(song.source || 'netease')}</span></div>
      <div className="desktop-lyrics__stage">
        {active ? <><div className="desktop-lyrics__line desktop-lyrics__line--active">{active.text}{active.translation && <span className="desktop-lyrics__translation">{active.translation}</span>}</div>{next && <div className="desktop-lyrics__line desktop-lyrics__line--near">{next.text}</div>}</> : <div className="desktop-lyrics__empty">{displayLines.length ? displayLines[0].text : '暂无歌词'}</div>}
        {!active && displayLines.length === 0 && <div className="desktop-lyrics__subtle">{song.name}</div>}
      </div>
    </main>
  );
}

function ElectronLyrics({ song, onClose }: Props & { onClose: () => void }) {
  const { displayLines, activeIndex } = useDesktopLyricsState(song);
  const api = window.electronAPI!;
  const active = activeIndex >= 0 ? displayLines[activeIndex] : null;
  const next = activeIndex >= 0 ? displayLines[activeIndex + 1] : null;

  useEffect(() => {
    const unsubscribe = api.onLyricsClosed?.(onClose);
    return unsubscribe;
  }, [api, onClose]);

  useEffect(() => {
    if (!song) return;
    api.updateLyrics(createElectronLyricsPayload({
      title: song.name,
      artist: song.artist,
      source: getSourceShortLabel(song.source || 'netease'),
      pic: song.pic,
      activeText: active?.text || (displayLines.length ? displayLines[0].text : '暂无歌词'),
      translation: active?.translation,
      nextText: next?.text,
    }));
  }, [active?.text, active?.translation, api, displayLines, next?.text, song]);

  return null;
}

export default function DesktopLyricsPiP({ song }: Props) {
  const electron = isElectronRenderer();
  const [opened, setOpened] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const close = useCallback(() => { setOpened(false); setPipWindow(null); }, []);

  const open = useCallback(async () => {
    if (electron) {
      if (opened) { await window.electronAPI?.closeLyrics(); close(); return; }
      try { await window.electronAPI?.openLyrics(); setOpened(true); } catch { notify('桌面歌词窗口打开失败，请重试'); }
      return;
    }
    if (pipWindow) { pipWindow.close(); close(); return; }
    const api = window.documentPictureInPicture;
    if (!api) { notify('当前浏览器不支持桌面歌词，请使用最新版 Chrome 或 Edge'); return; }
    try {
      const nextWindow = await api.requestWindow({ width: 268, height: 150 });
      nextWindow.document.title = 'OpenMusic 桌面歌词';
      const style = nextWindow.document.createElement('style'); style.textContent = PIP_STYLE; nextWindow.document.head.appendChild(style);
      const syncWindowScale = () => { const scale = Math.min(1.35, Math.max(0.78, Math.min(nextWindow.innerWidth / 268, nextWindow.innerHeight / 150))); nextWindow.document.documentElement.style.setProperty('--lyrics-scale', scale.toFixed(3)); };
      syncWindowScale(); nextWindow.addEventListener('resize', syncWindowScale); nextWindow.addEventListener('pagehide', () => { nextWindow.removeEventListener('resize', syncWindowScale); close(); }, { once: true }); setPipWindow(nextWindow);
    } catch (error) { if ((error as DOMException)?.name !== 'AbortError') notify('桌面歌词窗口打开失败，请重试'); }
  }, [close, electron, opened, pipWindow]);

  useEffect(() => { if (pipWindow?.closed) close(); }, [close, pipWindow]);
  const isOpen = electron ? opened : Boolean(pipWindow);
  return <>
    <Tooltip content={isOpen ? '关闭桌面歌词' : '桌面歌词'}>
      <button type="button" data-guide="room-desktop-lyrics" onClick={() => void open()} className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center transition-colors ${isOpen ? 'text-white' : 'text-netease-muted hover:text-white'}`} aria-label={isOpen ? '关闭桌面歌词' : '打开桌面歌词'} aria-pressed={isOpen}><Captions className="h-4 w-4" aria-hidden /></button>
    </Tooltip>
    {electron && isOpen && <ElectronLyrics song={song} onClose={close} />}
    {!electron && pipWindow && <>{createPortal(<DesktopLyricsContent song={song} />, pipWindow.document.body)}</>}
  </>;
}
