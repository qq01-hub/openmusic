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

for (const mode of ['order', 'shuffle', 'user-round-robin', 'favorite-shuffle', 'artist-shuffle', 'loop-one', 'loop-all', 'shuffle-loop']) {
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
        isSongBanned: () => false,
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

test('单曲循环下 FM 曲目自然播完重播当前曲且不获取新 FM', async () => {
  let fetched = false;
  let restarted = false;
  const context = vm.createContext({
    Set,
    normalizePlayMode: (value) => value,
    selectNextUserRoundRobinSong,
    getRuntimeConfig: () => ({}),
    filterSongPayloadByArtist: (songs) => songs,
    isSongArtistBlocked: () => false,
    isSongBanned: () => false,
    recordSongPlay() {},
    clearNextRandom(room) {
      room.nextRandom = null;
      room.nextRandomPromise = null;
      room.randomBatch = [];
    },
    ensureNextRandom() { fetched = true; },
    restartCurrentSong(room) {
      restarted = true;
      room.currentTime = 0;
      return true;
    },
    serializeQueueItemForRoom: (song) => ({ ...song }),
    buildPendingRandomItem: (song) => ({ ...song }),
    setCurrentSong: (room, song) => { room.current = song; },
    fetchRandomForRoom: async () => {
      fetched = true;
      return { queueId: 'fm-next', id: '2', source: 'netease', requestedBy: '私人漫游', requestedById: '' };
    },
  });
  vm.runInContext(roomSource.slice(
    roomSource.indexOf('function takeNextFromQueue('),
    roomSource.indexOf('async function playNext(room,'),
  ), context);

  const fmSong = { queueId: 'random-1', id: '1', source: 'netease', requestedBy: '私人漫游', requestedById: '' };
  const room = {
    playMode: 'loop-one',
    queue: [],
    users: new Map(),
    current: fmSong,
    nextRandom: null,
  };

  await context.playNextUnlocked(room, { allowFetchRandom: false, finishedSong: fmSong });

  assert.equal(restarted, true);
  assert.equal(fetched, false);
  assert.equal(room.current.queueId, 'random-1');
});

test('单曲循环已有在播歌曲时 ensureNextRandom 不再预取新 FM', async () => {
  let fetched = false;
  const context = vm.createContext({
    DEFAULT_FM_MODE: 'DEFAULT',
    FM_MODE_OFF: 'OFF',
    MAX_RANDOM_PREFETCH_ATTEMPTS: 3,
    normalizePlayMode: (value) => value,
    clearNextRandom(room) {
      room.nextRandom = null;
      room.nextRandomPromise = null;
      room.randomBatch = [];
    },
    fetchRandomForRoom: async () => {
      fetched = true;
      return { id: '2', source: 'netease' };
    },
  });
  vm.runInContext(roomSource.slice(
    roomSource.indexOf('async function ensureNextRandom('),
    roomSource.indexOf('async function withPlaybackLock('),
  ), context);

  const room = {
    playMode: 'loop-one',
    queue: [],
    current: { queueId: 'random-1', id: '1', source: 'netease', requestedBy: '私人漫游', requestedById: '' },
    nextRandom: { queueId: 'random-2', id: '2', source: 'netease' },
    nextRandomPromise: null,
    randomBatch: [{ id: '3', source: 'netease' }],
    neteaseFmMode: 'DEFAULT',
  };

  await context.ensureNextRandom(room);

  assert.equal(fetched, false);
  assert.equal(room.nextRandom, null);
  assert.deepEqual(room.randomBatch, []);
});

for (const mode of ['loop-all', 'shuffle-loop']) {
  test(`${mode} 不回收 FM 曲目到点歌队列`, async () => {
    const context = vm.createContext({
      Set,
      normalizePlayMode: (value) => value,
      selectNextUserRoundRobinSong,
      getRuntimeConfig: () => ({}),
      filterSongPayloadByArtist: (songs) => songs,
      isSongArtistBlocked: () => false,
      isSongBanned: () => false,
      recordSongPlay() {},
      clearNextRandom() {},
      ensureNextRandom() {},
      bumpPlaybackState() {},
      restartCurrentSong: () => true,
      serializeQueueItemForRoom: (song) => ({ ...song }),
      buildPendingRandomItem: (song) => ({ ...song }),
      setCurrentSong: (room, song) => { room.current = song; },
      fetchRandomForRoom: async () => ({ queueId: 'random-2', id: '2', source: 'netease', requestedBy: '私人漫游', requestedById: '' }),
    });
    vm.runInContext(roomSource.slice(
      roomSource.indexOf('function takeNextFromQueue('),
      roomSource.indexOf('async function playNext(room,'),
    ), context);

    const fmSong = { queueId: 'random-1', id: '1', source: 'netease', requestedBy: '私人漫游', requestedById: '' };
    const room = {
      playMode: mode,
      queue: [],
      users: new Map(),
      current: fmSong,
      nextRandom: null,
    };

    await context.playNextUnlocked(room, { allowFetchRandom: false, finishedSong: fmSong });

    assert.equal(room.queue.length, 0);
    assert.equal(room.current.queueId, 'random-2');
  });
}

function createShuffleQueueContext(room, controllerSet = new Set(['owner-1'])) {
  let persisted = 0;
  const rooms = new Map();
  if (room) rooms.set(room.id, room);
  const context = vm.createContext({
    rooms,
    Math,
    Array,
    isControllerConnection: (_room, actorId) => controllerSet.has(actorId),
    persistRoom: () => { persisted += 1; },
    lazyRoomResult: (target) => ({ room: target }),
  });
  const start = roomSource.indexOf('export function shuffleQueue(');
  const end = roomSource.indexOf('export async function approveJump(');
  const code = roomSource.slice(start, end).replace('export function shuffleQueue(', 'function shuffleQueue(');
  vm.runInContext(code, context);
  return { shuffleQueue: context.shuffleQueue, getPersisted: () => persisted };
}

test('shuffleQueue 支持房主和管理员打乱待播队列、写入 manualOrder 且不动当前播放曲目', () => {
  const room = {
    id: 'ROOM01',
    current: { queueId: 'now-1', name: '正在播放' },
    queue: [
      { queueId: 'q-1', name: '江南', artist: '林俊杰' },
      { queueId: 'q-2', name: '晴天', artist: '周杰伦' },
      { queueId: 'q-3', name: '修炼爱情', artist: '林俊杰' },
    ],
  };
  const { shuffleQueue, getPersisted } = createShuffleQueueContext(room, new Set(['owner-1', 'admin-1']));

  const denied = shuffleQueue('ROOM01', 'guest-1', 'conn-guest');
  assert.equal(denied.error, '仅房主或管理员可打乱播放队列');
  assert.equal(getPersisted(), 0);

  const res = shuffleQueue('ROOM01', 'admin-1', 'conn-admin', () => 0.99);
  assert.equal(res.error, undefined);
  assert.equal(getPersisted(), 1);
  assert.equal(room.current.queueId, 'now-1');
  const shuffledIds = Array.from(room.queue, (song) => song.queueId);
  assert.notDeepEqual(shuffledIds, ['q-1', 'q-2', 'q-3']);
  assert.deepEqual(
    [...shuffledIds].sort(),
    ['q-1', 'q-2', 'q-3'],
  );
  assert.deepEqual(Array.from(room.queue, (song) => song.manualOrder), [0, 1, 2]);
  assert.equal(room.queue.some((song) => Boolean(song.ownerPriority)), false);
});

test('shuffleQueue 待播不足 2 首或房间不存在时拒绝执行', () => {
  const room = {
    id: 'ROOM02',
    current: { queueId: 'now-1', name: '正在播放' },
    queue: [{ queueId: 'q-1', name: '江南' }],
  };
  const { shuffleQueue, getPersisted } = createShuffleQueueContext(room, new Set(['owner-1']));

  assert.equal(shuffleQueue('MISSING', 'owner-1').error, '房间不存在');
  assert.equal(shuffleQueue('ROOM02', 'owner-1').error, '待播歌曲不足 2 首，无法打乱');
  assert.equal(getPersisted(), 0);
});

test('shuffleQueue 在仅 2 首待播歌曲时确保顺序发生变化', () => {
  const room = {
    id: 'ROOM03',
    current: null,
    queue: [
      { queueId: 'q-1', name: '第一首' },
      { queueId: 'q-2', name: '第二首' },
    ],
  };
  const { shuffleQueue } = createShuffleQueueContext(room, new Set(['owner-1']));
  const res = shuffleQueue('ROOM03', 'owner-1', 'conn-owner', () => 0.99);
  assert.equal(res.error, undefined);
  assert.deepEqual(Array.from(room.queue, (song) => song.queueId), ['q-2', 'q-1']);
  assert.deepEqual(Array.from(room.queue, (song) => song.manualOrder), [0, 1]);
});
