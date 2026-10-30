import { useEffect } from 'react';

import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { resolveDisplayDurationSeconds } from '../hooks/useTrackDuration';
import { getClientPlaybackState, getPlaybackTime } from '../lib/playbackState';
import { getSharedAudio } from '../lib/audioElement';
import { isAudioBoundToQueue } from '../lib/audioTrackBinding';
import { isRoomAudioTakenOver } from '../lib/roomAudioPriority';
import type { Song, QueueItem } from '../types';

type TimeCapSong = Pick<Song, 'duration' | 'id' | 'source'> & Partial<Pick<QueueItem, 'queueId'>>;

let rafId = 0;
let loopSubscribers = 0;
let lastTrackKey = '';
let lastPublishedTime = 0;

function publishSmoothPlaybackTime(time: number, force = false) {
  if (!force && Math.abs(time - lastPublishedTime) < 0.05) return;
  lastPublishedTime = time;
  useAudioStore.getState().setSmoothPlaybackTime(time);
}

function getSongDisplayDurationSec(song: TimeCapSong | null | undefined): number {
  if (!song) return 0;
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  return resolveDisplayDurationSeconds(song, {
    lrcDurationMs,
    lrcTrackKey,
    mediaDurationMs,
    mediaTrackKey,
  });
}

function capSongTime(time: number, song: TimeCapSong | null | undefined): number {
  const dur = getSongDisplayDurationSec(song);
  return dur > 0 ? Math.min(time, dur) : time;
}

function stateMatchesSong(song: TimeCapSong | null | undefined): boolean {
  const state = getClientPlaybackState();
  if (!state?.trackId || !song?.queueId) return true;
  return state.trackId === song.queueId;
}

function readAudioCurrentTime(song: TimeCapSong | null | undefined): number | null {
  const audio = getSharedAudio();
  if (!audio.src || !Number.isFinite(audio.currentTime)) return null;
  return capSongTime(audio.currentTime, song);
}

/**
 * 酷狗和汽水以本机实际播放位置显示，缓冲时不会凭房间时钟继续前进
 * 试听占用或音源尚未绑定时继续显示房间时间轴
 */
function resolveDisplayedPlaybackTime(song: TimeCapSong | null | undefined): number | null {
  if (!song || !stateMatchesSong(song)) return null;
  if ((song.source === 'kugou' || song.source === 'qishui')
    && song.queueId && !isRoomAudioTakenOver()
    && isAudioBoundToQueue(getSharedAudio(), song.queueId)) {
    return readAudioCurrentTime(song);
  }
  const state = getClientPlaybackState();
  if (state) return capSongTime(getPlaybackTime(state), song);
  return readAudioCurrentTime(song);
}

function publishAudioTimeForSong(song: TimeCapSong | null | undefined, force = false) {
  if (!stateMatchesSong(song)) return;
  const displayed = resolveDisplayedPlaybackTime(song);
  if (displayed !== null) {
    publishSmoothPlaybackTime(displayed, force);
    return;
  }
  const state = getClientPlaybackState();
  if (state) {
    publishSmoothPlaybackTime(capSongTime(getPlaybackTime(state), song), force);
  }
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function tick() {
  if (loopSubscribers <= 0) {
    stopLoop();
    return;
  }

  const { room } = useRoomStore.getState();
  publishAudioTimeForSong(room?.current ?? null);
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (!rafId) rafId = requestAnimationFrame(tick);
}

/** seek / 切歌时立即对齐进度 */
export function snapSmoothPlaybackTime(time: number) {
  publishSmoothPlaybackTime(time, true);
}

export function readLocalPlaybackTime(song: TimeCapSong | null | undefined): number {
  const displayed = resolveDisplayedPlaybackTime(song);
  if (displayed !== null) return displayed;
  if (!song || !stateMatchesSong(song)) {
    return useAudioStore.getState().smoothPlaybackTime;
  }
  const fromAudio = readAudioCurrentTime(song);
  if (fromAudio !== null) return fromAudio;
  return capSongTime(getPlaybackTime(getClientPlaybackState()), song);
}

/**
 * 歌词/进度条用的高频播放时间（全局单例 RAF）。
 * 有控制权：本机 HTMLAudioElement.currentTime。
 * 听众：房间服务端播放时钟，本机误拖进度不影响展示。
 */
export function useSmoothPlaybackTime(): number {
  const isPlaying = useRoomStore((s) => s.room?.isPlaying ?? false);
  const current = useRoomStore((s) => s.room?.current);
  const playbackVersion = useAudioStore((s) => s.playbackVersion);
  // RAF 写入 smoothPlaybackTime 以驱动重绘；展示值始终读本机 audio
  useAudioStore((s) => s.smoothPlaybackTime);

  useEffect(() => {
    const trackKey = current ? `${current.source}:${current.id}:${current.queueId}` : '';
    const trackChanged = trackKey !== lastTrackKey;
    lastTrackKey = trackKey;

    if (trackChanged) {
      snapSmoothPlaybackTime(0);
    }
  }, [playbackVersion, current?.queueId, current?.id, current?.source]);

  useEffect(() => {
    publishAudioTimeForSong(current ?? null, true);

    if (!isPlaying) {
      return;
    }

    loopSubscribers += 1;
    startLoop();

    return () => {
      loopSubscribers -= 1;
      if (loopSubscribers <= 0) stopLoop();
    };
  }, [isPlaying, current?.queueId, current?.id, current?.source, playbackVersion]);

  return readLocalPlaybackTime(current ?? null);
}
