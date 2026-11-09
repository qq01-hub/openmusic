/** 按播放倍速换算实际剩余秒数，0 表示不显示预告 */
export function getUpcomingSongCountdown(
  playMode: string | undefined,
  isPlaying: boolean,
  duration: number,
  currentTime: number,
  playbackRate = 1,
): number {
  if (playMode !== 'user-round-robin' || !isPlaying
    || !Number.isFinite(duration) || duration <= 0
    || !Number.isFinite(currentTime) || currentTime < 0) return 0;
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  const remaining = (duration - currentTime) / rate;
  return remaining > 0 && remaining <= 20 ? Math.ceil(remaining) : 0;
}
