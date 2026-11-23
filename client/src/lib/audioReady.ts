import { isMobileDevice } from './audioUnlock';
import { getBufferedAheadSeconds, isAudioBufferedForPlayback } from './audioReadiness';

export function waitForAudioCanPlay(audio: HTMLAudioElement, timeoutMs?: number): Promise<void> {
  const timeout = timeoutMs ?? (isMobileDevice() ? 12000 : 15000);
  if (isAudioBufferedForPlayback(audio)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('progress', onReady);
      audio.removeEventListener('loadeddata', onReady);
    };
    const onReady = () => {
      if (!isAudioBufferedForPlayback(audio)) return;
      cleanup();
      resolve();
    };
    timer = window.setTimeout(() => {
      cleanup();
      if (!audio.error && audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        resolve();
        return;
      }
      reject(new Error(`音频缓冲不足（readyState=${audio.readyState}, bufferedAhead=${getBufferedAheadSeconds(audio).toFixed(3)}s）`));
    }, timeout);
    audio.addEventListener('canplay', onReady);
    audio.addEventListener('canplaythrough', onReady);
    audio.addEventListener('progress', onReady);
    audio.addEventListener('loadeddata', onReady);
  });
}

/** 等待元数据：仅供需要读取时长/seek 的非播放场景。 */
export function waitForAudioMinimumReady(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();

  const timeoutMs = isMobileDevice() ? 400 : 700;
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', done);
      audio.removeEventListener('loadeddata', done);
      audio.removeEventListener('canplay', done);
    };
    const finish = () => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timer);
      cleanup();
      resolve();
    };
    const done = () => {
      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
      finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener('loadedmetadata', done, { once: true });
    audio.addEventListener('loadeddata', done, { once: true });
    audio.addEventListener('canplay', done, { once: true });
  });
}

export async function waitForAudioProgress(
  audio: HTMLAudioElement,
  timeoutMs = 1500,
): Promise<boolean> {
  const initial = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  if (audio.paused || audio.ended) return false;

  return new Promise((resolve) => {
    let timer = 0;
    let settled = false;
    const finish = (progressed: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeEventListener('timeupdate', onProgress);
      audio.removeEventListener('playing', onProgress);
      resolve(progressed);
    };
    const onProgress = () => {
      const current = Number.isFinite(audio.currentTime) ? audio.currentTime : initial;
      if (current > initial + 0.05) finish(true);
    };
    timer = window.setTimeout(() => finish(false), timeoutMs);
    audio.addEventListener('timeupdate', onProgress);
    audio.addEventListener('playing', onProgress);
    onProgress();
  });
}
