import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { selectNextUserRoundRobinSong } from './playbackOrder.js';

const queue = [
  { queueId: 'a-1', requestedById: 'alice' },
  { queueId: 'b-1', requestedById: 'bob' },
  { queueId: 'a-2', requestedById: 'alice' },
  { queueId: 'c-1', requestedById: 'carol' },
];

test('用户轮播默认将离房点歌人置后', () => {
  const next = selectNextUserRoundRobinSong(queue, {
    requesterOrder: ['alice', 'bob', 'carol'],
    lastRequesterId: 'carol',
    onlineUserIds: new Set(['bob', 'carol']),
  });

  assert.equal(next?.queueId, 'b-1');
});

test('关闭离房置后后按原始点歌人轮次继续播放', () => {
  const next = selectNextUserRoundRobinSong(queue, {
    requesterOrder: ['alice', 'bob', 'carol'],
    lastRequesterId: 'carol',
    onlineUserIds: new Set(['bob', 'carol']),
    deferOfflineRequesters: false,
  });

  assert.equal(next?.queueId, 'a-1');
});

const likedQueue = [
  { queueId: 'a-low', requestedById: 'alice', likedByIds: ['voter-1'], manualOrder: 0 },
  { queueId: 'b-high', requestedById: 'bob', likedByIds: ['voter-1', 'voter-2', 'voter-3'], manualOrder: 1 },
  { queueId: 'a-high', requestedById: 'alice', likedByIds: ['voter-1', 'voter-2'], manualOrder: 2 },
];

test('轮到某用户时优先播放该用户高赞歌曲，即使队列保留手动排序', () => {
  const next = selectNextUserRoundRobinSong(likedQueue, {
    requesterOrder: ['alice', 'bob'],
    lastRequesterId: 'bob',
  });

  assert.equal(next?.queueId, 'a-high');
  assert.deepEqual(likedQueue.map((song) => song.queueId), ['a-low', 'b-high', 'a-high']);
});

test('点赞不跨用户抢占轮次', () => {
  const next = selectNextUserRoundRobinSong(likedQueue, {
    requesterOrder: ['alice', 'bob'],
    lastRequesterId: 'alice',
  });

  assert.equal(next?.queueId, 'b-high');
});

test('关闭点赞排序后轮播仍按该用户队列顺序选歌', () => {
  const next = selectNextUserRoundRobinSong(likedQueue, {
    requesterOrder: ['alice', 'bob'],
    lastRequesterId: 'bob',
    queueLikeSortEnabled: false,
  });

  assert.equal(next?.queueId, 'a-low');
});

test('轮播点赞相同时保留原有队列顺序且不计入播放中点赞', () => {
  const next = selectNextUserRoundRobinSong([
    { queueId: 'a-first', requestedById: 'alice' },
    { queueId: 'a-second', requestedById: 'alice', likedByIds: [], currentLikedByIds: ['voter-1'] },
  ]);

  assert.equal(next?.queueId, 'a-first');
});

test('高赞离房用户仍遵守在线成员优先设置', () => {
  const next = selectNextUserRoundRobinSong(likedQueue, {
    requesterOrder: ['alice', 'bob'],
    lastRequesterId: 'alice',
    onlineUserIds: new Set(['alice']),
  });

  assert.equal(next?.queueId, 'a-high');
});

const roomSource = readFileSync(new URL('./roomManager.js', import.meta.url), 'utf8');

for (const mode of ['order', 'shuffle', 'user-round-robin', 'favorite-shuffle', 'loop-one', 'loop-all', 'shuffle-loop']) {
  for (const priorityBy of ['', '管理员']) {
    const behavior = mode === 'loop-one' ? '保持单曲循环' : '先播优先歌曲';
    test(`${mode} 下有${priorityBy || '房主'}优先歌曲时${behavior}`, async () => {
      const context = vm.createContext({
        Set,
        normalizePlayMode: (value) => value,
        selectNextUserRoundRobinSong,
        getRuntimeConfig: () => ({}),
        filterSongPayloadByArtist: (songs) => songs,
        isSongArtistBlocked: () => false,
        recordSongPlay() {},
        clearNextRandom() {},
        ensureNextRandom() {},
        restartCurrentSong: () => true,
        serializeQueueItemForRoom: (song) => ({ ...song }),
        buildPendingRandomItem: (song) => ({ ...song }),
        setCurrentSong: (room, song) => { room.current = song; },
        fetchRandomForRoom: () => { throw new Error('有优先歌曲时不应请求随机歌曲'); },
      });
      vm.runInContext(roomSource.slice(
        roomSource.indexOf('function takeNextFromQueue('),
        roomSource.indexOf('async function playNext(room,'),
      ), context);
      const room = {
        playMode: mode,
        queue: [
          { queueId: 'normal', requestedById: 'alice', likedByIds: ['one', 'two'], manualOrder: 0 },
          { queueId: 'priority', requestedById: 'offline', likedByIds: [], manualOrder: 1, ownerPriority: 1, priorityBy },
          { queueId: 'normal-high', requestedById: 'alice', likedByIds: ['one', 'two', 'three'], manualOrder: 2 },
        ],
        users: new Map([['alice', {}]]),
        playbackRequesterOrder: ['alice', 'offline'],
        lastPlaybackRequesterId: 'offline',
        favoriteShuffleUserId: 'alice',
        nextRandom: { queueId: 'favorite' },
        current: { queueId: 'current' },
      };

      await context.playNextUnlocked(room);

      assert.equal(room.current.queueId, mode === 'loop-one' ? 'current' : 'priority');
      assert.equal(room.queue.some((song) => song.queueId === 'priority'), mode === 'loop-one');
      assert.equal(room.lastPlaybackRequesterId, 'offline');
      assert.equal(room.playMode, mode);
      if (mode === 'user-round-robin') {
        await context.playNextUnlocked(room);
        assert.equal(room.current.queueId, 'normal-high');
        assert.equal(room.lastPlaybackRequesterId, 'alice');
      }
    });
  }
}
