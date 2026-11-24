import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTrackRecoveryTracker,
  getLocalRecoveryDelayMs,
  MAX_AUTO_SOURCE_ERROR_SKIPS_PER_TRACK,
  MAX_LOCAL_RECOVERY_ATTEMPTS,
  shouldInvalidateUrlCacheOnRecovery,
  shouldPauseForAudioUnlock,
  shouldWatchdogTriggerReload,
} from './audioRecoveryPolicy';

test('普通播放失败按指数退避并在达到单曲上限后停止重试', () => {
  assert.equal(getLocalRecoveryDelayMs(1, 'load_track_failed'), 5000);
  assert.equal(getLocalRecoveryDelayMs(2, 'load_track_failed'), 15000);
  assert.equal(getLocalRecoveryDelayMs(3, 'load_track_failed'), 30000);
  assert.equal(getLocalRecoveryDelayMs(4, 'load_track_failed'), 60000);
  assert.equal(getLocalRecoveryDelayMs(MAX_LOCAL_RECOVERY_ATTEMPTS + 1, 'load_track_failed'), null);
});

test('音源异常恢复采用较短首跳并在达到上限后停止', () => {
  assert.equal(getLocalRecoveryDelayMs(1, 'source_unavailable'), 3000);
  assert.equal(getLocalRecoveryDelayMs(2, 'service_fallback_exhausted'), 10000);
  assert.equal(getLocalRecoveryDelayMs(3, 'service_no_fallback'), 30000);
  assert.equal(getLocalRecoveryDelayMs(4, 'source_unavailable'), 60000);
  assert.equal(getLocalRecoveryDelayMs(5, 'source_unavailable'), null);
});

test('普通缓冲超时不无脑清空 URL 缓存，仅二次超时刷新一次', () => {
  assert.equal(shouldInvalidateUrlCacheOnRecovery('load_track_failed', 1), false);
  assert.equal(shouldInvalidateUrlCacheOnRecovery('load_track_failed', 2), true);
  assert.equal(shouldInvalidateUrlCacheOnRecovery('load_track_failed', 3), false);
  assert.equal(shouldInvalidateUrlCacheOnRecovery('source_error_rejected', 1), false);
  assert.equal(shouldInvalidateUrlCacheOnRecovery('service_fallback_exhausted', 1), true);
  assert.equal(shouldInvalidateUrlCacheOnRecovery('service_fallback_exhausted', 2), true);
  assert.equal(shouldInvalidateUrlCacheOnRecovery('service_fallback_exhausted', 3), false);
});

test('受限自动播放环境未解锁且无音频错误时暂停缓冲失败判定', () => {
  assert.equal(shouldPauseForAudioUnlock({
    restrictedAutoplay: true,
    needsAudioUnlock: true,
    audioPaused: true,
    hasAudioError: false,
  }), true);
  assert.equal(shouldPauseForAudioUnlock({
    restrictedAutoplay: true,
    needsAudioUnlock: true,
    audioPaused: true,
    hasAudioError: true,
  }), false);
  assert.equal(shouldPauseForAudioUnlock({
    restrictedAutoplay: false,
    needsAudioUnlock: true,
    audioPaused: true,
    hasAudioError: false,
  }), false);
});

test('看门狗在待恢复、已达上限或等待解锁时不抢跑触发重载', () => {
  const baseState = {
    isPlaying: true,
    isTrackLoaded: false,
    hasLoadLock: false,
    trackLoading: false,
    hasPendingRecovery: false,
    recoveryExhausted: false,
    waitingForAudioUnlock: false,
  };
  assert.equal(shouldWatchdogTriggerReload(baseState), true);
  assert.equal(shouldWatchdogTriggerReload({ ...baseState, hasPendingRecovery: true }), false);
  assert.equal(shouldWatchdogTriggerReload({ ...baseState, recoveryExhausted: true }), false);
  assert.equal(shouldWatchdogTriggerReload({ ...baseState, waitingForAudioUnlock: true }), false);
  assert.equal(shouldWatchdogTriggerReload({ ...baseState, isTrackLoaded: true }), false);
});

test('单曲恢复追踪器在切歌或重置后清零，并限制后台回前台补试与自动切歌次数', () => {
  const tracker = createTrackRecoveryTracker();
  for (let step = 1; step <= MAX_LOCAL_RECOVERY_ATTEMPTS; step += 1) {
    const attempt = tracker.nextAttempt('q-1', 'load_track_failed', true);
    assert.equal(attempt.exhausted, false);
    assert.ok(attempt.delayMs && attempt.delayMs > 0);
  }
  const capped = tracker.nextAttempt('q-1', 'load_track_failed', true);
  assert.equal(capped.exhausted, true);
  assert.equal(capped.delayMs, null);
  assert.equal(tracker.isExhausted('q-1'), true);
  assert.equal(tracker.canRetryOnForeground('q-1'), true);

  tracker.markForegroundRetryUsed('q-1');
  assert.equal(tracker.isExhausted('q-1'), false);
  assert.equal(tracker.canRetryOnForeground('q-1'), false);

  for (let count = 0; count < MAX_AUTO_SOURCE_ERROR_SKIPS_PER_TRACK; count += 1) {
    assert.equal(tracker.consumeAutoSourceErrorSkip('q-1'), true);
  }
  assert.equal(tracker.consumeAutoSourceErrorSkip('q-1'), false);

  // 切歌后自动重置单曲状态
  assert.equal(tracker.isExhausted('q-2'), false);
  assert.equal(tracker.consumeAutoSourceErrorSkip('q-2'), true);
  assert.equal(tracker.getAttempts('q-2'), 0);
});
