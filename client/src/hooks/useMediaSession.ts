import { useEffect, useRef } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import {
  resolveDisplayDurationSeconds,
} from './useTrackDuration';
import {
  bindMediaSessionActions,
  clearMediaSession,
  isMediaSessionSupported,
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
  updateMediaSessionPositionState,
} from '../lib/mediaSession';
import {
  installBackgroundPlaybackGuards,
  shouldIgnoreBackgroundRoomPause,
} from '../lib/backgroundPlayback';
import { canPauseInRoom, canSeekInRoom } from '../lib/roomPermissions';
import type { RoomState } from '../types';

const SEEK_STEP_SEC = 10;
const POSITION_UPDATE_MS = 1000;

type MediaSessionControls = {
  /** false 时禁用（如 TV 投屏页不占用系统媒体会话） */
  enabled?: boolean;
  togglePlay: (isPlaying: boolean) => void | Promise<boolean>;
  skipSong: () => Promise<{ success: boolean; error?: string }>;
  requestSkip: () => Promise<{ success: boolean; error?: string }>;
  seekTo: (time: number) => void;
};

/** 系统媒体栏各按键是否可用：房间开关 ∩ 成员权限 */
function resolveSystemMediaControlFlags(
  room: RoomState | null | undefined,
  canControlPlayback: boolean,
): { playBound: boolean; prevBound: boolean; nextBound: boolean } {
  const systemPlay = room?.systemMediaPlayBound !== false;
  const systemSkip = room?.systemMediaSkipBound !== false;
  return {
    playBound: systemPlay && canPauseInRoom(room, canControlPlayback),
    prevBound: canSeekInRoom(room, canControlPlayback),
    nextBound: systemSkip && canControlPlayback,
  };
}

/**
 * 将房间播放/暂停/切歌同步到系统媒体控件（锁屏、通知栏、耳机键、键盘多媒体键）。
 * 无对应权限时不注册/不展示按键。
 */
export function useMediaSession({
  enabled = true,
  togglePlay,
  skipSong,
  requestSkip,
  seekTo,
}: MediaSessionControls): void {
  const controlsRef = useRef({ togglePlay, skipSong, requestSkip, seekTo });
  controlsRef.current = { togglePlay, skipSong, requestSkip, seekTo };

  useEffect(() => {
    if (!enabled) {
      clearMediaSession();
      return;
    }

    const webSessionOk = isMediaSessionSupported();
    if (!webSessionOk) return;

    installBackgroundPlaybackGuards();

    let pendingPauseTimer: number | null = null;

    const softResumeOnly = () => {
      if (!useRoomStore.getState().room?.isPlaying) return;
      useAudioStore.getState().softResumeLocalAudio?.();
      updateMediaSessionPlaybackState('playing', { force: true });
    };

    const toggleLocalMute = () => {
      const store = useAudioStore.getState();
      if (store.volume > 0) {
        try { localStorage.setItem('openmusic:volume-before-mute', String(store.volume)); } catch { /* ignore */ }
        store.setVolume(0);
      } else {
        let prev = 1;
        try { prev = Number(localStorage.getItem('openmusic:volume-before-mute')) || 1; } catch { /* ignore */ }
        store.setVolume(Math.max(0.05, prev));
      }
      softResumeOnly();
    };

    const cancelPendingPause = () => {
      if (pendingPauseTimer != null) {
        window.clearTimeout(pendingPauseTimer);
        pendingPauseTimer = null;
      }
    };

    const handlePlay = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!room?.current) return;
      cancelPendingPause();
      if (!resolveSystemMediaControlFlags(room, canControlPlayback).playBound) {
        toggleLocalMute();
        return;
      }
      const { localPlayback } = useAudioStore.getState();
      if (!room.isPlaying) {
        updateMediaSessionPlaybackState('playing');
        void controlsRef.current.togglePlay(true);
        localPlayback?.(true);
      } else {
        localPlayback?.(true);
      }
    };

    const applyPauseOrMute = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!room?.current) return;

      const hasPausePermission = resolveSystemMediaControlFlags(room, canControlPlayback).playBound;

      if (!hasPausePermission) {
        toggleLocalMute();
        return;
      }

      if (shouldIgnoreBackgroundRoomPause() && room.isPlaying) {
        softResumeOnly();
        return;
      }

      updateMediaSessionPlaybackState('paused');
      useAudioStore.getState().localPlayback?.(false);
      void controlsRef.current.togglePlay(false);
    };

    const handlePause = () => {
      const { room } = useRoomStore.getState();
      if (!room?.current) return;
      // Safari 在切歌/替换 audio.src 时可能误发一次 Media Session pause。
      // 这类 pause 不能被成员的“本地静音”兼容逻辑处理，否则会把音量持久化为 0。
      const pauseTrackId = room.current.queueId;
      const pauseDuringTrackLoad = useAudioStore.getState().trackLoading;
      // Windows 关媒体卡片有时先 pause 再 stop：短延迟，若收到 stop 则取消，避免进度条卡顿
      cancelPendingPause();
      pendingPauseTimer = window.setTimeout(() => {
        pendingPauseTimer = null;
        const latestRoom = useRoomStore.getState().room;
        const trackChanged = latestRoom?.current?.queueId !== pauseTrackId;
        const trackIsLoading = useAudioStore.getState().trackLoading;
        if (pauseDuringTrackLoad || trackChanged || trackIsLoading) {
          softResumeOnly();
          return;
        }
        applyPauseOrMute();
      }, 120);
    };

    const handleStop = () => {
      // 关闭系统媒体卡片：取消误触发的 pause，只软续播，不改房态/进度
      cancelPendingPause();
      const room = useRoomStore.getState().room;
      if (!room?.current) return;
      if (room.isPlaying) {
        softResumeOnly();
      }
    };

    const handleNext = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!resolveSystemMediaControlFlags(room, canControlPlayback).nextBound) return;
      useAudioStore.getState().setTrackLoading(true);
      void controlsRef.current.skipSong().then((res) => {
        if (!res.success) useAudioStore.getState().setTrackLoading(false);
      });
    };

    const handlePrevious = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!resolveSystemMediaControlFlags(room, canControlPlayback).prevBound) return;
      const time = useAudioStore.getState().smoothPlaybackTime;
      controlsRef.current.seekTo(Math.max(0, time - SEEK_STEP_SEC));
    };

    const syncPosition = () => {
      const room = useRoomStore.getState().room;
      const current = room?.current;
      if (!current) return;

      const { smoothPlaybackTime, mediaDurationMs, mediaTrackKey, lrcDurationMs, lrcTrackKey } = useAudioStore.getState();
      const duration = resolveDisplayDurationSeconds(current, {
        lrcDurationMs,
        lrcTrackKey,
        mediaDurationMs,
        mediaTrackKey,
      });
      if (!(duration > 0)) return;

      const position = Math.min(Math.max(0, smoothPlaybackTime), duration);
      if (webSessionOk) {
        updateMediaSessionPositionState({
          duration,
          position,
          playbackRate: 1,
        });
      }
    };

    const syncHandlers = () => {
      const state = useRoomStore.getState();
      const canControl = state.canControlPlayback;
      const canSeek = canSeekInRoom(state.room, canControl);
      const hasTrack = Boolean(state.room?.current);
      const { prevBound, nextBound } = resolveSystemMediaControlFlags(state.room, canControl);

      if (webSessionOk) {
        bindMediaSessionActions({
          play: hasTrack ? handlePlay : undefined,
          pause: hasTrack ? handlePause : undefined,
          nexttrack: hasTrack && nextBound ? handleNext : undefined,
          previoustrack: hasTrack && prevBound ? handlePrevious : undefined,
          seekbackward: hasTrack && canSeek
            ? (details) => {
              const step = Number(details.seekOffset) > 0 ? Number(details.seekOffset) : SEEK_STEP_SEC;
              const time = useAudioStore.getState().smoothPlaybackTime;
              controlsRef.current.seekTo(Math.max(0, time - step));
            }
            : undefined,
          seekforward: hasTrack && canSeek
            ? (details) => {
              const step = Number(details.seekOffset) > 0 ? Number(details.seekOffset) : SEEK_STEP_SEC;
              const time = useAudioStore.getState().smoothPlaybackTime;
              controlsRef.current.seekTo(time + step);
            }
            : undefined,
          seekto: hasTrack && canSeek
            ? (details) => {
              if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) return;
              controlsRef.current.seekTo(Math.max(0, details.seekTime));
            }
            : undefined,
          stop: hasTrack ? handleStop : undefined,
        });
      }
    };

    const syncMetadataAndState = () => {
      const store = useRoomStore.getState();
      const room = store.room;
      const current = room?.current ?? null;
      if (webSessionOk) {
        updateMediaSessionMetadata(current);
        if (!current) {
          updateMediaSessionPlaybackState('none');
        } else {
          updateMediaSessionPlaybackState(room?.isPlaying ? 'playing' : 'paused');
        }
      }


    };

    syncHandlers();
    syncMetadataAndState();
    syncPosition();


    const unsubRoom = useRoomStore.subscribe((state, prev) => {
      if (
        state.room?.current?.queueId !== prev.room?.current?.queueId
        || state.room?.current?.name !== prev.room?.current?.name
        || state.room?.current?.artist !== prev.room?.current?.artist
        || state.room?.current?.pic !== prev.room?.current?.pic
        || state.room?.isPlaying !== prev.room?.isPlaying
        || state.canControlPlayback !== prev.canControlPlayback
        || state.room?.memberSeekEnabled !== prev.room?.memberSeekEnabled
        || state.room?.memberPauseEnabled !== prev.room?.memberPauseEnabled
        || state.room?.systemMediaPlayBound !== prev.room?.systemMediaPlayBound
        || state.room?.systemMediaSkipBound !== prev.room?.systemMediaSkipBound
        || Boolean(state.room?.current) !== Boolean(prev.room?.current)
      ) {
        syncHandlers();
        syncMetadataAndState();
        syncPosition();
      }
    });

    const unsubAudio = useAudioStore.subscribe((state, prev) => {
      if (
        state.mediaDurationMs !== prev.mediaDurationMs
        || state.lrcDurationMs !== prev.lrcDurationMs
      ) {
        syncPosition();
        syncMetadataAndState();
      }
    });

    const timer = window.setInterval(syncPosition, POSITION_UPDATE_MS);

    return () => {
      cancelPendingPause();
      unsubRoom();
      unsubAudio();
      window.clearInterval(timer);
      clearMediaSession();
    };
  }, [enabled]);
}
