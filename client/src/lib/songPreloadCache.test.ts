import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPrefetchCurrentSong } from './playbackPrefetchPolicy';

test('暂停房间不预取当前歌曲播放地址', () => {
  assert.equal(shouldPrefetchCurrentSong({ isPlaying: false }), false);
  assert.equal(shouldPrefetchCurrentSong({ isPlaying: true }), true);
});
