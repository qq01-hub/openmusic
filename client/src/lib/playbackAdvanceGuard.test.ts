import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlaybackAdvanceGuard } from './playbackAdvanceGuard';

test('同一 queueId 只能认领一次曲末推进，切换到新曲后可再次认领', () => {
  const guard = createPlaybackAdvanceGuard();

  assert.equal(guard.claim('track-a'), true);
  assert.equal(guard.claim('track-a'), false);
  assert.equal(guard.claim('track-a'), false);
  assert.equal(guard.claim('track-b'), true);
  assert.equal(guard.claim('track-b'), false);
});
