import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDisplayedPlaybackTime, type DisplayedPlaybackTimeInput } from './displayedPlaybackTime';

function makeInput(overrides: Partial<DisplayedPlaybackTimeInput> = {}): DisplayedPlaybackTimeInput {
  return {
    audioBound: true,
    audioCurrentTime: 10.2,
    audioPaused: false,
    audioSeeking: false,
    audioReadyState: 4,
    trackLoading: false,
    roomTakenOver: false,
    needsAudioUnlock: false,
    stateTime: 13.8,
    statePlaying: true,
    songSource: 'netease',
    ...overrides,
  };
}

test('全音源实际播放中优先使用本机音频位置，避免切歌缓冲导致的整首抢跑', () => {
  for (const songSource of ['netease', 'tencent', 'kugou', 'qishui']) {
    assert.equal(selectDisplayedPlaybackTime(makeInput({ songSource })), 10.2);
  }
});

test('播放中途网络卡顿缓冲时停留在真实出声位置而非继续抢跑', () => {
  assert.equal(selectDisplayedPlaybackTime(makeInput({
    audioCurrentTime: 42.5,
    audioPaused: false,
    audioReadyState: 1,
    stateTime: 47.1,
  })), 42.5);
});

test('切歌初期正在缓冲加载时停在曲首 0 秒，避免先按房间时钟跑偏再回跳', () => {
  assert.equal(selectDisplayedPlaybackTime(makeInput({
    audioCurrentTime: 0,
    audioPaused: true,
    audioReadyState: 1,
    trackLoading: true,
    stateTime: 3.4,
  })), 0);
});

test('中途进房仍在加载尚未跳转时展示房间进度，不闪回 0 秒', () => {
  assert.equal(selectDisplayedPlaybackTime(makeInput({
    audioCurrentTime: 0,
    audioPaused: true,
    audioReadyState: 1,
    trackLoading: true,
    stateTime: 86.5,
  })), 86.5);
});

test('试听占用、待解锁、暂停与拖动寻址时回退房间时钟', () => {
  assert.equal(selectDisplayedPlaybackTime(makeInput({ roomTakenOver: true })), 13.8);
  assert.equal(selectDisplayedPlaybackTime(makeInput({ needsAudioUnlock: true, audioPaused: true, audioCurrentTime: 0, stateTime: 2.5 })), 2.5);
  assert.equal(selectDisplayedPlaybackTime(makeInput({ statePlaying: false, audioPaused: true, stateTime: 30 })), 30);
  assert.equal(selectDisplayedPlaybackTime(makeInput({ audioSeeking: true, stateTime: 55 })), 55);
  assert.equal(selectDisplayedPlaybackTime(makeInput({ audioBound: false, stateTime: 18 })), 18);
});
