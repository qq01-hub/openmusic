import test from 'node:test';
import assert from 'node:assert/strict';
import { musicRequestContext, shouldRecordMusicResponse } from './riskMusicResponse.js';

test('展示型热榜请求不进入音乐响应记录', () => {
  assert.equal(musicRequestContext('/api/music/hot'), null);
  assert.equal(musicRequestContext('/api/music/toplist/netease'), null);
  assert.equal(shouldRecordMusicResponse(null), false);
});

test('取链类请求继续进入音乐响应记录，搜索和歌单响应不记录明细', () => {
  assert.equal(shouldRecordMusicResponse(musicRequestContext('/api/meting', { type: 'url', server: 'netease' })), true);
  assert.equal(shouldRecordMusicResponse(musicRequestContext('/api/meting', { type: 'lrc', server: 'netease' })), true);
  assert.equal(shouldRecordMusicResponse(musicRequestContext('/api/meting', { type: 'song', server: 'netease' })), true);
  assert.equal(shouldRecordMusicResponse(musicRequestContext('/api/meting', { type: 'search', server: 'netease' })), false);
  assert.equal(shouldRecordMusicResponse(musicRequestContext('/api/music/netease/playlists/search')), false);
});
