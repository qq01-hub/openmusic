import type { SearchResult } from '../types';
import { getSongUrlInfo, songKey } from '../api/music';
import { resolveQishuiLocalPlaybackUrl, isQishuiLocalPlaybackUrl } from './qishuiLocalPlayback';
import { getSharedAudio } from './audioElement';
import { getAudioController } from './audioController';
import { configureInlineAudio } from './audioUnlock';
import {
  acquireRoomAudio,
  consumeRoomResumeRequest,
  isRoomAudioTakenOver,
  markRoomPausedForLocalPlayback,
  releaseRoomAudio,
  resetRoomAudioPriority,
  unregisterRoomAudio,
} from './roomAudioPriority';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';

export type SongPreviewStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type SongPreviewState = {
  key: string | null;
  status: SongPreviewStatus;
  error: string | null;
};

let previewAudio: HTMLAudioElement | null = null;
let activeKey: string | null = null;
let status: SongPreviewStatus = 'idle';
let lastError: string | null = null;
let loadToken = 0;
let previewAbortController: AbortController | null = null;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((cb) => cb());
}

export function applyPreviewVolume(volume: number): void {
  if (!previewAudio) return;
  previewAudio.volume = Math.min(1, Math.max(0, volume));
}

function syncPreviewVolume(): void {
  applyPreviewVolume(useAudioStore.getState().volume);
}

function getOrCreatePreviewAudio(): HTMLAudioElement {
  if (!previewAudio) {
    previewAudio = new Audio();
    configureInlineAudio(previewAudio);
    previewAudio.preload = 'metadata';
    syncPreviewVolume();
    previewAudio.addEventListener('ended', () => {
      finishPreview({ resumeRoom: true });
    });
    previewAudio.addEventListener('error', () => {
      if (status === 'loading' || status === 'playing') {
        lastError = '试听加载失败';
        status = 'error';
        notify();
        // 播放中出错时 play() 已经 resolve，不会再走下面的 catch，必须在这里归还音频
        releaseAudio();
        resumeRoomAudioIfNeeded();
      }
    });
  }
  return previewAudio;
}

function pauseRoomAudioLocally() {
  const room = useRoomStore.getState().room;
  if (room?.isPlaying) markRoomPausedForLocalPlayback();
  const audio = getSharedAudio();
  if (!audio.paused) {
    audio.pause();
  }
  // 再入队 pause，排在可能已排队的 play/sync 之后，避免被跟播立刻挤掉
  getAudioController().enqueue(() => {
    if (!isRoomAudioTakenOver()) return;
    if (!getSharedAudio().paused) {
      getSharedAudio().pause();
    }
  });
}

function takeOverPreviewAudio() {
  pauseRoomAudioLocally();
  acquireRoomAudio('preview', () => {
    // 被其它本机播放接管：立即停止试听，避免两路音频同时出声
    if (previewAudio && !previewAudio.paused) previewAudio.pause();
    if (status === 'playing' || status === 'loading') {
      loadToken += 1;
      previewAbortController?.abort();
      previewAbortController = null;
      activeKey = null;
      status = 'idle';
      lastError = null;
      notify();
    }
  });
}

function releaseAudio(): boolean {
  return releaseRoomAudio('preview');
}

function resumeRoomAudioIfNeeded() {
  // 其它本机播放（如聊天音乐卡片）仍占用音频时不要抢回播放
  if (isRoomAudioTakenOver()) return;
  if (!consumeRoomResumeRequest()) return;
  const room = useRoomStore.getState().room;
  if (room?.isPlaying) {
    useAudioStore.getState().retryPlayback?.(true);
  }
}

function finishPreview(options: { resumeRoom: boolean }) {
  loadToken += 1;
  previewAbortController?.abort();
  previewAbortController = null;
  const audio = previewAudio;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  activeKey = null;
  status = 'idle';
  lastError = null;
  const released = releaseAudio();
  unregisterRoomAudio('preview');
  notify();
  if (options.resumeRoom !== false && released) resumeRoomAudioIfNeeded();
}

export function getSongPreviewState(): SongPreviewState {
  return { key: activeKey, status, error: lastError };
}

export function subscribeSongPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function stopSongPreview(options: { resumeRoom?: boolean } = {}) {
  if (status === 'idle' && !activeKey) return;
  finishPreview({ resumeRoom: options.resumeRoom !== false });
}

/** 离开房间/重置会话时清理，避免把音频占用带到下一个房间 */
export function resetSongPreview(): void {
  stopSongPreview({ resumeRoom: false });
  resetRoomAudioPriority();
}

export async function toggleSongPreview(song: SearchResult): Promise<void> {
  const key = songKey(song);
  const audio = getOrCreatePreviewAudio();

  if (activeKey === key) {
    if (status === 'loading') return;
    if (status === 'playing') {
      audio.pause();
      status = 'paused';
      notify();
      return;
    }
    if (status === 'paused') {
      takeOverPreviewAudio();
      syncPreviewVolume();
      try {
        await audio.play();
        status = 'playing';
        lastError = null;
        notify();
      } catch {
        lastError = '无法播放试听';
        status = 'error';
        notify();
        releaseAudio();
        resumeRoomAudioIfNeeded();
      }
      return;
    }
    // error：重新拉流
  }

  const token = ++loadToken;
  previewAbortController?.abort();
  const previewAbort = new AbortController();
  previewAbortController = previewAbort;
  activeKey = key;
  status = 'loading';
  lastError = null;
  notify();

  takeOverPreviewAudio();

  try {
    const resolved = await getSongUrlInfo(song);
    if (token !== loadToken || activeKey !== key) return;
    let url = resolved.url;
    if (!url) throw new Error('empty url');
    if (song.source === 'qishui' && isQishuiLocalPlaybackUrl(url)) {
      const local = await resolveQishuiLocalPlaybackUrl(url, previewAbort.signal);
      if (local.status === 'aborted' || token !== loadToken || activeKey !== key) return;
      if (local.status !== 'ok') throw new Error('汽水试听解密失败');
      url = local.url;
    }

    audio.src = url;
    syncPreviewVolume();
    await audio.play();
    if (token !== loadToken || activeKey !== key) return;
    status = 'playing';
    lastError = null;
    notify();
  } catch (err) {
    if (token !== loadToken) return;
    lastError = err instanceof Error && err.message ? '试听失败，换一首试试' : '试听失败';
    status = 'error';
    notify();
    releaseAudio();
    resumeRoomAudioIfNeeded();
  }
}
