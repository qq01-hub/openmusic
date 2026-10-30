/** 保留程序跳转目标直到 seeked，避免听众把缓冲耗时误判为擅自拖动 */
const expectedSeeks = new WeakMap<HTMLAudioElement, { target: number; expiresAt: number }>();

const EXPECTED_SEEK_TTL_MS = 2500;

export function seekAudioTo(audio: HTMLAudioElement, target: number): void {
  const safeTarget = Math.max(0, target);
  expectedSeeks.set(audio, { target: safeTarget, expiresAt: Date.now() + EXPECTED_SEEK_TTL_MS });
  try {
    audio.currentTime = safeTarget;
  } catch (error) {
    expectedSeeks.delete(audio);
    throw error;
  }
}

export function isExpectedAudioSeek(audio: HTMLAudioElement): boolean {
  const entry = expectedSeeks.get(audio);
  if (!entry) return false;
  if (Date.now() <= entry.expiresAt) return true;
  if (Math.abs(audio.currentTime - entry.target) < 0.6) return true;
  expectedSeeks.delete(audio);
  return false;
}

export function finishAudioSeek(audio: HTMLAudioElement): void {
  const entry = expectedSeeks.get(audio);
  if (!entry) return;
  if (Date.now() > entry.expiresAt) {
    expectedSeeks.delete(audio);
  }
}
