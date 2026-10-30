import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlaybackQualityFallbackChain } from './iosPlaybackQuality';

test('iOS 播放失败时按高到低顺序逐档降级', () => {
  assert.deepEqual(
    buildPlaybackQualityFallbackChain('jyeffect', ['standard', 'exhigh', 'lossless', 'jyeffect'], true),
    ['jyeffect', 'lossless', 'exhigh', 'standard'],
  );
});

test('非 iOS 只返回当前请求音质', () => {
  assert.deepEqual(
    buildPlaybackQualityFallbackChain('jyeffect', ['standard', 'exhigh', 'lossless', 'jyeffect'], false),
    ['jyeffect'],
  );
});
