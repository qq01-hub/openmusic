import { useEffect, useMemo } from 'react';
import type { Song } from '../types';
import { filterDisplayLyrics, getCoverUrl, LYRIC_SYNC_LEAD_SEC, songKey } from '../api/music';
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

function currentLyricText(song: Song | null, lyrics: ReturnType<typeof useTrackLyrics>) {
  if (!song || lyrics.length === 0) return '';
  const playbackState = getClientPlaybackState();
  const serverClockMatchesSong = playbackState?.trackId === (song as { queueId?: string }).queueId;
  const position = serverClockMatchesSong
    ? getPlaybackTime(playbackState)
    : useAudioStore.getState().smoothPlaybackTime;
  const lines = filterDisplayLyrics(lyrics);
  const activeIndex = findActiveLyricIndex(lines, position + LYRIC_SYNC_LEAD_SEC);
  const active = activeIndex >= 0 ? lines[activeIndex] : null;
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
  const rawDuration = audio.mediaDurationMs != null
    ? audio.mediaDurationMs / 1000
    : Number(song.duration) || 0;
  const duration = rawDuration > 10000 ? rawDuration / 1000 : rawDuration;
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

/** Synchronizes the Web room player with the Android media notification. */
export default function NativeWebViewBridge({ song, isPlaying, togglePlay, skipSong, showLyrics }: Props) {
  const songId = song ? songKey(song) : '';
  const room = useRoomStore((state) => state.room);
  const canControlPlayback = useRoomStore((state) => state.canControlPlayback);
  const lyrics = useTrackLyrics(song);
  const { isFavorite, toggleFavorite } = useFavorites();
  const { setRoomPlayMode } = useSocket();
  const playMode = normalizePlayMode(room?.playMode);
  const playModeLabel = PLAY_MODE_META[playMode].short;
  const favorited = isFavorite(song);
  const permissions: NativePlayerPermissions = {
    canPause: canPauseInRoom(room, canControlPlayback),
    canSkip: canControlPlayback,
    canSeek: canSeekInRoom(room, canControlPlayback),
  };
  const extras = useMemo<NativePlayerExtras>(() => ({
    lyric: currentLyricText(song, lyrics),
    playMode,
    playModeLabel,
    canChangeMode: canControlPlayback,
    favorited,
  }), [canControlPlayback, favorited, lyrics, playMode, playModeLabel, song]);

  useEffect(() => {
    const report = () => sendPlayerState(song, isPlaying, permissions, {
      ...extras,
      lyric: currentLyricText(song, lyrics),
    });
    report();
    const timer = window.setInterval(report, 750);
    return () => window.clearInterval(timer);
  }, [song, songId, isPlaying, permissions.canPause, permissions.canSkip, permissions.canSeek, extras, lyrics]);

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
      if (detail?.action === 'play' && permissions.canPause) void togglePlay(true);
      if (detail?.action === 'pause' && permissions.canPause) void togglePlay(false);
      if (detail?.action === 'next' && permissions.canSkip) void skipSong();
      if (detail?.action === 'seek' && permissions.canSeek) {
        const time = Number(detail.time);
        if (Number.isFinite(time) && time >= 0) useAudioStore.getState().seekPlayback?.(time);
      }
      if (detail?.action === 'lyrics') showLyrics?.();
      if (detail?.action === 'toggleMode' && canControlPlayback) {
        const next = nextPlayMode(playMode);
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
    permissions.canPause,
    permissions.canSeek,
    permissions.canSkip,
    playMode,
    setRoomPlayMode,
    showLyrics,
    skipSong,
    song,
    toggleFavorite,
    togglePlay,
  ]);

  return null;
}
