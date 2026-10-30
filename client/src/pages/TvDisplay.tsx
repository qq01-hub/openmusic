import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Music2, Maximize } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { useSocket } from '../hooks/useSocket';
import {
  getLyrics, parseLrc, getCoverUrl,
  getLrcFallbackDurationMs, getTrackKey,
} from '../api/music';
import type { LyricLine } from '../types';
import VinylPlayer from '../components/VinylPlayer';
import SongInfoPanel from '../components/SongInfoPanel';
import SyncedLyricsPane from '../components/playback/SyncedLyricsPane';
import TvCoverBackground from '../components/tv/TvCoverBackground';
import TvProgressFooter from '../components/tv/TvProgressFooter';
import AudioEngine from '../components/AudioEngine';
import Tooltip from '../components/Tooltip';
import MusicLoading from '../components/MusicLoading';
import { usePageSeo } from '../lib/seo';
import { ensureTvChromeInit } from '../lib/roomChromeInit';
import {
  getStoredRoomPassword,
  parseRoomPasswordFromSearch,
  rememberRoomPassword,
  stripRoomPasswordFromSearch,
} from '../lib/roomPassword';
import { useSignedApiUrl } from '../lib/signedApiUrl';

export default function TvDisplay() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const hasRoom = useRoomStore((s) => Boolean(s.room));
  const roomName = useRoomStore((s) => s.room?.name);
  const current = useRoomStore((s) => s.room?.current ?? null);
  const isPlaying = useRoomStore((s) => s.room?.isPlaying ?? false);
  const queueLength = useRoomStore((s) => s.room?.queue.length ?? 0);
  const rawCoverUrl = current ? getCoverUrl(current, 'medium') : null;
  const signedCoverUrl = useSignedApiUrl(rawCoverUrl);
  const { joinRoom } = useSocket();
  const setLrcDuration = useAudioStore((s) => s.setLrcDuration);

  const [joinError, setJoinError] = useState('');
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [bgLoaded, setBgLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgProbeRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    ensureTvChromeInit();
  }, []);

  usePageSeo({
    title: roomName ? `${roomName} 电视歌词` : '电视歌词模式',
    description: '大屏歌词与封面展示，实时同步房间播放进度，适合投屏观看。',
    path: roomId ? `/tv/${roomId}` : undefined,
    noindex: true,
  });

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
    };
  }, []);

  const enterFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      const request = el.requestFullscreen
        ?? (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
      await request?.call(el);
    } catch {
      // 部分电视浏览器不支持或需用户手势
    }
  };

  useEffect(() => {
    if (!roomId) return;
    const fromUrl = parseRoomPasswordFromSearch(location.search);
    if (!fromUrl) return;
    rememberRoomPassword(roomId, fromUrl);
    const nextSearch = stripRoomPasswordFromSearch(location.search);
    if (nextSearch === location.search) return;
    navigate(
      { pathname: location.pathname, search: nextSearch },
      { replace: true, state: location.state },
    );
  }, [roomId, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let redirectTimer: number | undefined;

    const password =
      parseRoomPasswordFromSearch(location.search)
      || getStoredRoomPassword(roomId);

    joinRoom(roomId, '电视机', password, { readOnly: true }).then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setJoinError(res.error || '无法连接房间');
        redirectTimer = window.setTimeout(() => navigate('/'), 3000);
        return;
      }
      rememberRoomPassword(roomId, password);
    });
    return () => {
      cancelled = true;
      if (redirectTimer) window.clearTimeout(redirectTimer);
    };
  }, [roomId, location.search, joinRoom, navigate]);

  useEffect(() => {
    if (!current) {
      setLyrics([]);
      return;
    }

    setLyrics([]);
    setBgLoaded(false);

    getLyrics({
      id: current.id,
      source: current.source || 'netease',
      name: current.name,
      artist: current.artist,
      lrc: current.lrc,
    })
      .then((lrc) => {
        const lines = parseLrc(lrc);
        setLyrics(lines);
        if (!current.duration) {
          const ms = getLrcFallbackDurationMs(lrc);
          if (ms) setLrcDuration(getTrackKey(current), ms);
        }
      })
      .catch(() => setLyrics([]));
  }, [current?.id, current?.source, current?.name, current?.lrc, current?.duration, setLrcDuration]);

  useEffect(() => {
    if (!current) return;
    const img = bgProbeRef.current;
    if (!img) return;
    if (img.complete) {
      setBgLoaded(true);
      return;
    }
    const onLoad = () => setBgLoaded(true);
    img.addEventListener('load', onLoad);
    return () => img.removeEventListener('load', onLoad);
  }, [current?.id, current?.source]);

  let content: React.ReactNode;

  if (joinError) {
    content = (
      <div className="h-full flex items-center justify-center bg-[#080808]">
        <p className="text-netease-red text-sm">{joinError}</p>
      </div>
    );
  } else if (!hasRoom) {
    content = <MusicLoading label="正在连接房间" className="bg-[#080808]" />;
  } else if (!current) {
    content = (
      <div className="h-full w-full overflow-hidden bg-[#080808] select-none">
        <div className="h-full flex flex-col items-center justify-center animate-fade-in px-6">
          <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center mb-4">
            <Music2 className="w-7 h-7 text-white/20" />
          </div>
          <p className="text-base font-light text-white/50 mb-1">等待点播</p>
          <p className="text-xs text-white/25 text-center">
            {queueLength > 0
              ? `队列中有 ${queueLength} 首歌曲即将播放`
              : '在手机上搜索并点歌吧'}
          </p>
        </div>
      </div>
    );
  } else {
    const coverUrl = rawCoverUrl || '';
    content = (
      <div className="fixed inset-0 z-50 flex flex-col animate-fade-in select-none">
        <TvCoverBackground coverUrl={coverUrl} loaded={bgLoaded} />
        <img
          ref={bgProbeRef}
          src={signedCoverUrl || ''}
          alt=""
          className="hidden"
          loading="eager"
          decoding="async"
        />

        <div className="relative z-10 flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 px-4 lg:px-12 gap-4 lg:gap-10">
          <div className="flex-shrink-0 lg:flex-1 flex items-center justify-center py-2 lg:py-8">
            <VinylPlayer coverUrl={coverUrl} isPlaying={isPlaying} size="large" />
          </div>

          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <SongInfoPanel
              name={current.name}
              artist={current.artist}
              source={current.source || 'netease'}
              requestedBy={current.requestedBy}
              size="large"
            />
            <SyncedLyricsPane lines={lyrics} variant="side" size="large" instantScroll />
          </div>
        </div>

        <TvProgressFooter song={current} isPlaying={isPlaying} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full bg-[#080808]">
      <AudioEngine tvMode />
      {!isFullscreen && hasRoom && !joinError && (
        <Tooltip content="全屏">
          <button
            type="button"
            onClick={enterFullscreen}
            className="fixed top-4 right-4 z-[55] w-10 h-10 flex items-center justify-center rounded-xl bg-black/40 border border-white/10 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            aria-label="全屏"
          >
            <Maximize className="w-5 h-5" />
          </button>
        </Tooltip>
      )}
      {content}
    </div>
  );
}
