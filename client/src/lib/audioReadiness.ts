const DEFAULT_MIN_BUFFER_SEC = 1;

export function getBufferedAheadSeconds(audio: Pick<HTMLMediaElement, 'buffered' | 'currentTime'>): number {
  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const ranges = audio.buffered;
  for (let i = 0; i < ranges.length; i += 1) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (currentTime >= start - 0.05 && currentTime <= end + 0.05) {
      return Math.max(0, end - currentTime);
    }
  }
  return 0;
}

export function isAudioBufferedForPlayback(
  audio: Pick<HTMLMediaElement, 'readyState' | 'buffered' | 'currentTime'>,
  minBufferSec = DEFAULT_MIN_BUFFER_SEC,
): boolean {
  return audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    && getBufferedAheadSeconds(audio) >= minBufferSec;
}

export { DEFAULT_MIN_BUFFER_SEC };
