import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const roomSource = readFileSync(new URL('./roomManager.js', import.meta.url), 'utf8');
const fmSource = readFileSync(new URL('./metingFm.js', import.meta.url), 'utf8');

function roomHarness() {
  let fetchedOptions;
  const context = vm.createContext({
    MAX_RANDOM_HISTORY: 200,
    DEFAULT_FM_MODE: 'DEFAULT',
    normalizeFmSource: (source) => source,
    normalizePlayMode: (mode) => mode,
    songIdentity: (source, id) => `${source}:${id}`,
    persistRoom() {},
    filterSongPayloadByArtist: (songs) => songs,
    getRuntimeConfig: () => ({}),
    getRoomFmCookie: () => '',
    fetchMetingFmSongs: async (_mode, options) => {
      fetchedOptions = options;
      return [];
    },
    serializeQueueItemForRoom: (song) => ({ ...song }),
    clearSharedPlaybackMedia() {},
    recordSongPlayHistory() {},
    bumpPlaybackState() {},
    invalidateRoomsListCache() {},
    scheduleLobbyCoverResolve() {},
    ensureNextRandom() {},
  });
  vm.runInContext(
    roomSource.slice(roomSource.indexOf('async function fetchRandomForRoom('), roomSource.indexOf('async function ensureNextRandom('))
      + roomSource.slice(roomSource.indexOf('function setCurrentSong('), roomSource.indexOf('function restartCurrentSong(')),
    context,
  );
  return { context, options: () => fetchedOptions };
}

function makeRoom(count, source = 'netease') {
  return {
    id: 'rolling-room',
    fmSource: source,
    randomPlayedKeys: new Set(Array.from({ length: count }, (_, i) => `${source}:${i}`)),
    randomBatch: [],
    queue: [{}],
    current: { source, id: String(count - 1) },
  };
}

test('199 entries remain excluded', async () => {
  const harness = roomHarness();
  const room = makeRoom(199);
  await harness.context.fetchRandomForRoom(room);
  assert.equal(harness.options().excludeIds.length, 199);
});

test('200 entries release only the oldest, preserving recent and other-source history', async () => {
  const harness = roomHarness();
  const room = makeRoom(200);
  room.randomPlayedKeys.add('tencent:other');
  await harness.context.fetchRandomForRoom(room);
  assert.equal(room.randomPlayedKeys.has('netease:0'), false);
  assert.equal(room.randomPlayedKeys.has('netease:1'), true);
  assert.equal(room.randomPlayedKeys.has('netease:199'), true);
  assert.equal(room.randomPlayedKeys.has('tencent:other'), true);
  assert.equal(harness.options().excludeIds.length, 199);
});

test('legacy excess history releases oldest entries and never releases current', async () => {
  const harness = roomHarness();
  const room = makeRoom(203);
  room.current.id = '0';
  await harness.context.fetchRandomForRoom(room);
  assert.equal(room.randomPlayedKeys.has('netease:0'), true);
  assert.equal(room.randomPlayedKeys.has('netease:1'), false);
  assert.equal(room.randomPlayedKeys.has('netease:4'), false);
  assert.equal(room.randomPlayedKeys.has('netease:5'), true);
  assert.equal(harness.options().excludeIds.length, 199);
});

test('replaying an older song refreshes recency before the next eviction', () => {
  const harness = roomHarness();
  const room = makeRoom(200);
  harness.context.setCurrentSong(room, { id: '0', source: 'netease', requestedBy: '私人漫游' });
  harness.context.setCurrentSong(room, { id: 'new', source: 'netease', requestedBy: '私人漫游' });
  assert.equal(room.randomPlayedKeys.has('netease:0'), true);
  assert.equal(room.randomPlayedKeys.has('netease:1'), false);
  assert.equal([...room.randomPlayedKeys].at(-2), 'netease:0');
});

async function fetchBatch(ids, options = {}) {
  const raw = ids.map((id) => ({ id, name: `song-${id}` }));
  const context = vm.createContext({
    setTimeout,
    console,
    getRuntimeConfig: () => ({}),
    isMusicSourceEnabled: () => true,
    fetchMetingApi: async () => ({ ok: true, text: async () => JSON.stringify(raw) }),
    runWithMetingRequestContext: (_context, fn) => fn(),
    fetchEphemeralFmSong: async () => ({ ok: true, data: raw }),
    formatMetingFetchError: String,
  });
  vm.runInContext(fmSource.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  const songs = await context.fetchMetingFmSongs('DEFAULT', {
    source: 'tencent',
    excludeIds: ['oldest', 'older', 'recent', 'current'],
    currentSongId: 'current',
    ...options,
  });
  return Array.from(songs, (song) => song.id);
}

test('QQ exhausted batch returns only the oldest eligible repeat', async () => {
  assert.deepEqual(await fetchBatch(['current', 'recent', 'older', 'oldest', 'oldest']), ['oldest']);
});

test('QQ prioritizes new songs over repeats', async () => {
  assert.deepEqual(await fetchBatch(['current', 'oldest', 'new']), ['new']);
});

test('QQ account-cookie path uses the same oldest repeat fallback', async () => {
  assert.deepEqual(await fetchBatch(['recent', 'older'], { ephemeralCookie: 'test-cookie' }), ['older']);
});
