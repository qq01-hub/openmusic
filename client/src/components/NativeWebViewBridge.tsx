import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../types';
import { filterDisplayLyrics, getCoverUrl, LYRIC_SYNC_LEAD_SEC, songKey } from '../api/music';
import { normalizeDurationMs } from '../lib/duration';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { canPauseInRoom, canSeekInRoom } from '../lib/roomPermissions';
import { getClientPlaybackState, getPlaybackTime } from '../lib/playbackState';
import { useTrackLyrics } from '../hooks/useTrackLyrics';
import { findActiveLyricIndex } from '../lib/lyricActiveIndex';
import { normalizePlayMode, nextPlayMode, PLAY_MODE_META, type PlayMode } from '../lib/playMode';
import { useFavorites } from '../hooks/useFavorites';
import { useSocket } from '../hooks/useSocket';
import { getNativeBridgeToken } from '../lib/nativeWebView';

interface Props {
  song: Song | null;
  isPlaying: boolean;
  togglePlay: (isPlaying: boolean) => Promise<boolean>;
  skipSong: () => Promise<{ success: boolean }>;
  showLyrics?: () => void;
}

type NativePlayerPermissions = {
  canPause: boolean;
  canSkip: boolean;
  canSeek: boolean;
};

type NativePlayerExtras = {
  lyric: string;
  playMode: PlayMode;
  playModeLabel: string;
  canChangeMode: boolean;
  favorited: boolean;
};

function currentLyricText(song: Song | null, displayLyrics: ReturnType<typeof filterDisplayLyrics>) {
  if (!song || displayLyrics.length === 0) return '';
  const playbackState = getClientPlaybackState();
  const serverClockMatchesSong = playbackState?.trackId === (song as { queueId?: string }).queueId;
  const position = serverClockMatchesSong
    ? getPlaybackTime(playbackState)
    : useAudioStore.getState().smoothPlaybackTime;
  const activeIndex = findActiveLyricIndex(displayLyrics, position + LYRIC_SYNC_LEAD_SEC);
  const active = activeIndex >= 0 ? displayLyrics[activeIndex] : null;
  if (!active) return '';
  return [active.text, active.translation].filter(Boolean).join(' / ').slice(0, 180);
}

function sendPlayerState(
  song: Song | null,
  isPlaying: boolean,
  permissions: NativePlayerPermissions,
  extras: NativePlayerExtras,
) {
  const bridge = window.flutter_inappwebview;
  const bridgeToken = getNativeBridgeToken();
  if (!bridge || !bridgeToken) return;
  if (!song) {
    void bridge.callHandler('omPlayerState', { title: '', bridgeToken });
    return;
  }

  const audio = useAudioStore.getState();
  const playbackState = getClientPlaybackState();
  const serverClockMatchesSong = playbackState?.trackId === (song as { queueId?: string }).queueId;
  const position = serverClockMatchesSong
    ? getPlaybackTime(playbackState)
    : audio.smoothPlaybackTime;
  const duration = audio.mediaDurationMs != null
    ? audio.mediaDurationMs / 1000
    : (normalizeDurationMs(song.duration) ?? 0) / 1000;
  const cover = getCoverUrl(song, 'medium');
  void bridge.callHandler('omPlayerState', {
    title: song.name,
    artist: song.artist,
    cover: new URL(cover, window.location.origin).toString(),
    playing: isPlaying,
    position,
    duration,
    canPause: permissions.canPause,
    canSkip: permissions.canSkip,
    canSeek: permissions.canSeek,
    lyric: extras.lyric,
    playMode: extras.playMode,
    playModeLabel: extras.playModeLabel,
    canChangeMode: extras.canChangeMode,
    favorited: extras.favorited,
    bridgeToken,
  });
}

const ActiveNativeWebViewBridge = memo(function ActiveNativeWebViewBridge({ song, isPlaying, togglePlay, skipSong, showLyrics }: Props) {
  const songId = song ? songKey(song) : '';
  const playMode = useRoomStore((state) => normalizePlayMode(state.room?.playMode));
  const canControlPlayback = useRoomStore((state) => state.canControlPlayback);
  const canPause = useRoomStore((state) => canPauseInRoom(state.room, state.canControlPlayback));
  const canSeek = useRoomStore((state) => canSeekInRoom(state.room, state.canControlPlayback));
  const lyrics = useTrackLyrics(song);
  const displayLyrics = useMemo(() => filterDisplayLyrics(lyrics), [lyrics]);
  const { isFavorite, toggleFavorite } = useFavorites();
  const { setRoomPlayMode } = useSocket();
  const playModeLabel = PLAY_MODE_META[playMode].short;
  const favorited = isFavorite(song);
  const reportRef = useRef<() => void>(() => {});
  reportRef.current = () => {
    sendPlayerState(
      song,
      isPlaying,
      { canPause, canSkip: canControlPlayback, canSeek },
      {
        lyric: currentLyricText(song, displayLyrics),
        playMode,
        playModeLabel,
        canChangeMode: canControlPlayback,
        favorited,
      },
    );
  };

  useEffect(() => {
    reportRef.current();
  }, [songId, isPlaying, canPause, canControlPlayback, canSeek, playMode, favorited, displayLyrics]);

  useEffect(() => {
    const timer = window.setInterval(() => reportRef.current(), 750);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    const bridgeToken = getNativeBridgeToken();
    if (window.flutter_inappwebview && bridgeToken) {
      void window.flutter_inappwebview.callHandler('omPlayerState', {
        title: '',
        bridgeToken,
      });
    }
  }, []);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; time?: unknown }>).detail;
      if (detail?.action === 'play' && canPause) void togglePlay(true);
      if (detail?.action === 'pause' && canPause) void togglePlay(false);
      if (detail?.action === 'next' && canControlPlayback) void skipSong();
      if (detail?.action === 'seek' && canSeek) {
        const time = Number(detail.time);
        if (Number.isFinite(time) && time >= 0) useAudioStore.getState().seekPlayback?.(time);
      }
      if (detail?.action === 'lyrics') showLyrics?.();
      if (detail?.action === 'toggleMode' && canControlPlayback) {
        let next = nextPlayMode(playMode);
        if (next === 'artist-shuffle' && !useRoomStore.getState().room?.artistShuffle) next = nextPlayMode(next);
        void setRoomPlayMode(next).then((res) => {
          window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
            detail: {
              message: res.success ? PLAY_MODE_META[next].label : (res.error || '切换失败'),
              type: res.success ? 'success' : 'error',
            },
          }));
        });
      }
      if (detail?.action === 'toggleFavorite' && song) {
        void toggleFavorite(song);
      }
    };
    window.addEventListener('omNativePlayerCommand', onCommand);
    return () => window.removeEventListener('omNativePlayerCommand', onCommand);
  }, [
    canControlPlayback,
    canPause,
    canSeek,
    playMode,
    setRoomPlayMode,
    showLyrics,
    skipSong,
    song,
    toggleFavorite,
    togglePlay,
  ]);

  return null;
});

/** 仅在 Flutter 移动端 WebView 内激活原生媒体通知同步，桌面端零开销早退 */
export default memo(function NativeWebViewBridge(props: Props) {
  const [bridgeAvailable, setBridgeAvailable] = useState(
    () => typeof window !== 'undefined' && Boolean(window.flutter_inappwebview),
  );

  useEffect(() => {
    if (bridgeAvailable || typeof window === 'undefined') return;
    if (window.flutter_inappwebview) {
      setBridgeAvailable(true);
      return;
    }
    const onReady = () => {
      if (window.flutter_inappwebview) setBridgeAvailable(true);
    };
    window.addEventListener('flutterInAppWebViewPlatformReady', onReady);
    return () => window.removeEventListener('flutterInAppWebViewPlatformReady', onReady);
  }, [bridgeAvailable]);

  if (!bridgeAvailable) return null;
  return <ActiveNativeWebViewBridge {...props} />;
});
