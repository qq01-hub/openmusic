import { markBufferingEnd, markBufferingStart, resetSyncStateMachine } from './syncStateMachine';

let waitingFlag = false;
let listenersAttached = false;
let bufferingListenersTarget: HTMLAudioElement | null = null;
let bufferEndHandler: ((audio: HTMLAudioElement) => void) | null = null;

function onBufferStart(): void {
  waitingFlag = true;
  markBufferingStart();
}

function onBufferEnd(audio: HTMLAudioElement): void {
  waitingFlag = false;
  markBufferingEnd();
  bufferEndHandler?.(audio);
}

export function setAudioBufferEndHandler(handler: ((audio: HTMLAudioElement) => void) | null): void {
  bufferEndHandler = handler;
}

export function isAudioBuffering(audio: HTMLAudioElement): boolean {
  if (audio.seeking) return true;
  if (waitingFlag) return true;
  return !audio.paused
    && !audio.ended
    && audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
}

export function attachAudioBufferingListeners(audio: HTMLAudioElement): void {
  if (listenersAttached && bufferingListenersTarget === audio) return;
  listenersAttached = true;
  bufferingListenersTarget = audio;
  waitingFlag = false;

  audio.addEventListener('waiting', onBufferStart);
  audio.addEventListener('stalled', onBufferStart);
  audio.addEventListener('seeking', onBufferStart);
  audio.addEventListener('seeked', () => {
    if (!audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) onBufferEnd(audio);
  });
  audio.addEventListener('playing', () => onBufferEnd(audio));
  audio.addEventListener('canplay', () => {
    if (!audio.paused && !audio.seeking) onBufferEnd(audio);
  });
}

export { resetSyncStateMachine as resetPostBufferLock };
