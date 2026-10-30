/** 保留程序跳转目标直到 seeked，避免听众把缓冲耗时误判为擅自拖动 */
const expectedSeeks = new WeakMap<HTMLAudioElement, number>();

export function seekAudioTo(audio: HTMLAudioElement, target: number): void {
  expectedSeeks.set(audio, target);
  try {
    audio.currentTime = target;
  } catch (error) {
    expectedSeeks.delete(audio);
    throw error;
  }
}

export function isExpectedAudioSeek(audio: HTMLAudioElement): boolean {
  const target = expectedSeeks.get(audio);
  return target !== undefined && Math.abs(audio.currentTime - target) < 0.5;
}

export function finishAudioSeek(audio: HTMLAudioElement): void {
  expectedSeeks.delete(audio);
}
