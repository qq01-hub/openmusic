export const MAX_LOCAL_RECOVERY_ATTEMPTS = 4;
export const MAX_AUTO_SOURCE_ERROR_SKIPS_PER_TRACK = 2;

const NORMAL_RECOVERY_DELAYS_MS = [5000, 15000, 30000, 60000] as const;
const SOURCE_UNAVAILABLE_RECOVERY_DELAYS_MS = [3000, 10000, 30000, 60000] as const;

export function isSourceUnavailableRecoveryReason(reason: string): boolean {
  return reason === 'source_unavailable'
    || reason === 'source_error_marked_local'
    || reason === 'service_fallback_exhausted'
    || reason === 'service_no_fallback';
}

/** 按失败原因和当前重试次数返回退避毫秒数；超过单曲上限返回 null 停止自动重试 */
export function getLocalRecoveryDelayMs(attempt: number, reason: string): number | null {
  if (!Number.isFinite(attempt) || attempt < 1 || attempt > MAX_LOCAL_RECOVERY_ATTEMPTS) {
    return null;
  }
  const schedule = isSourceUnavailableRecoveryReason(reason)
    ? SOURCE_UNAVAILABLE_RECOVERY_DELAYS_MS
    : NORMAL_RECOVERY_DELAYS_MS;
  return schedule[Math.min(attempt - 1, schedule.length - 1)];
}

/** 仅在确认源异常或二次缓冲超时时失效前端 URL 缓存，避免普通超时反复穿透后端取链 */
export function shouldInvalidateUrlCacheOnRecovery(reason: string, attempt: number): boolean {
  if (attempt < 1) return false;
  if (
    isSourceUnavailableRecoveryReason(reason)
    || reason === 'qishui_temp_retry'
    || reason === 'qishui_playback_failed'
  ) {
    return attempt <= 2;
  }
  if (reason === 'load_track_failed') {
    return attempt === 2;
  }
  return false;
}

/** 微信/移动端等受限自动播放环境尚未手势解锁时，保持音频绑定等待点击，不判为缓冲超时失败 */
export function shouldPauseForAudioUnlock(state: {
  restrictedAutoplay: boolean;
  needsAudioUnlock: boolean;
  audioPaused: boolean;
  hasAudioError: boolean;
}): boolean {
  return Boolean(
    state.restrictedAutoplay
    && state.needsAudioUnlock
    && state.audioPaused
    && !state.hasAudioError,
  );
}

/** 看门狗门禁：存在待执行退避定时器、等待解锁或已达单曲重试上限时禁止抢跑重拉 */
export function shouldWatchdogTriggerReload(state: {
  isPlaying: boolean;
  isTrackLoaded: boolean;
  hasLoadLock: boolean;
  trackLoading: boolean;
  hasPendingRecovery: boolean;
  recoveryExhausted: boolean;
  waitingForAudioUnlock: boolean;
}): boolean {
  if (!state.isPlaying) return false;
  if (state.isTrackLoaded) return false;
  if (state.hasLoadLock || state.trackLoading) return false;
  if (state.hasPendingRecovery || state.recoveryExhausted || state.waitingForAudioUnlock) return false;
  return true;
}

export interface TrackRecoveryState {
  queueId: string | null;
  attempts: number;
  exhausted: boolean;
  exhaustedWhileHidden: boolean;
  foregroundRetryUsed: boolean;
  autoSourceErrorSkips: number;
}

export interface TrackRecoveryTracker {
  nextAttempt: (queueId: string, reason: string, isHidden?: boolean) => {
    attempt: number;
    delayMs: number | null;
    exhausted: boolean;
  };
  isExhausted: (queueId: string) => boolean;
  canRetryOnForeground: (queueId: string) => boolean;
  markForegroundRetryUsed: (queueId: string) => void;
  consumeAutoSourceErrorSkip: (queueId: string) => boolean;
  getAttempts: (queueId: string) => number;
  reset: (queueId?: string) => void;
}

export function createTrackRecoveryTracker(): TrackRecoveryTracker {
  const state: TrackRecoveryState = {
    queueId: null,
    attempts: 0,
    exhausted: false,
    exhaustedWhileHidden: false,
    foregroundRetryUsed: false,
    autoSourceErrorSkips: 0,
  };

  const ensureQueue = (queueId: string) => {
    if (state.queueId === queueId) return;
    state.queueId = queueId;
    state.attempts = 0;
    state.exhausted = false;
    state.exhaustedWhileHidden = false;
    state.foregroundRetryUsed = false;
    state.autoSourceErrorSkips = 0;
  };

  return {
    nextAttempt(queueId: string, reason: string, isHidden = false) {
      ensureQueue(queueId);
      const next = state.attempts + 1;
      const delayMs = getLocalRecoveryDelayMs(next, reason);
      state.attempts = next;
      if (delayMs === null) {
        state.exhausted = true;
        if (isHidden) state.exhaustedWhileHidden = true;
        return { attempt: next, delayMs: null, exhausted: true };
      }
      return { attempt: next, delayMs, exhausted: false };
    },
    isExhausted(queueId: string) {
      return state.queueId === queueId && state.exhausted;
    },
    canRetryOnForeground(queueId: string) {
      return state.queueId === queueId
        && state.exhausted
        && state.exhaustedWhileHidden
        && !state.foregroundRetryUsed;
    },
    markForegroundRetryUsed(queueId: string) {
      if (state.queueId !== queueId) return;
      state.foregroundRetryUsed = true;
      state.exhausted = false;
      state.attempts = Math.max(0, MAX_LOCAL_RECOVERY_ATTEMPTS - 1);
    },
    consumeAutoSourceErrorSkip(queueId: string) {
      ensureQueue(queueId);
      if (state.autoSourceErrorSkips >= MAX_AUTO_SOURCE_ERROR_SKIPS_PER_TRACK) {
        return false;
      }
      state.autoSourceErrorSkips += 1;
      return true;
    },
    getAttempts(queueId: string) {
      return state.queueId === queueId ? state.attempts : 0;
    },
    reset(queueId?: string) {
      if (queueId && state.queueId !== queueId) return;
      state.queueId = null;
      state.attempts = 0;
      state.exhausted = false;
      state.exhaustedWhileHidden = false;
      state.foregroundRetryUsed = false;
      state.autoSourceErrorSkips = 0;
    },
  };
}
