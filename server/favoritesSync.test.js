import { evalRedisScript } from './redisScripts.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { analyzeFavoritesMigration, appendMissingFavoriteSongs, buildFavoritesSyncResult, favoriteSongKey, filterFavoriteCategories, mergeFavoriteSnapshots } from './favoritesSync.js';

const song = (id, source = 'netease') => ({ id, source, name: id });

test('favorites are merged by source and song id with account order preserved', () => {
  const result = mergeFavoriteSnapshots([song('1'), song('2')], [song('2'), song('3'), song('4', 'qq')]);
  assert.deepEqual(result.map(favoriteSongKey), ['netease:1', 'netease:2', 'netease:3', 'qq:4']);
});
test('same stable identity reports identity_same while still returning local snapshot merge result', () => {
  const result = buildFavoritesSyncResult({
    sourceUserId: 'guest-123',
    targetUserId: 'guest-123',
    accountFavorites: [song('1')],
    guestFavorites: [song('1'), song('2')],
  });
  assert.equal(result.status, 'identity_same');
  assert.equal(result.imported, 1);
  assert.deepEqual(result.favorites.map(favoriteSongKey), ['netease:1', 'netease:2']);
});

test('different identities report merged and remain idempotent', () => {
  const input = { sourceUserId: 'guest-123', targetUserId: 'account-456', accountFavorites: [song('1')], guestFavorites: [song('1'), song('2')] };
  const first = buildFavoritesSyncResult(input);
  const second = buildFavoritesSyncResult({ ...input, accountFavorites: first.favorites, guestFavorites: input.guestFavorites });
  assert.equal(first.status, 'merged');
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.deepEqual(second.favorites, first.favorites);
});

test('收藏歌曲只保留账户实际接收的分类', () => {
  const songs = [
    song('1'),
    { ...song('2'), category: '已接收' },
    { ...song('3'), category: '被截断' },
  ];
  assert.deepEqual(
    filterFavoriteCategories(songs, ['已接收']).map((item) => [item.id, item.category || null]),
    [['1', null], ['2', '已接收'], ['3', null]],
  );
});

test('迁移前发现收藏容量不足，避免写入部分结果后才失败', () => {
  const result = analyzeFavoritesMigration({
    accountFavorites: [song('1'), song('2')],
    guestFavorites: [song('2'), song('3'), song('4')],
    maxFavorites: 3,
  });

  assert.deepEqual(result, { missingFavorites: 2, droppedFavorites: 1 });
});

test('迁移前发现分类容量不足', () => {
  const result = analyzeFavoritesMigration({
    accountCategories: ['已有'],
    guestCategories: ['已有', '游客一', '游客二'],
    maxCategories: 2,
  });

  assert.deepEqual(result, { missingCategories: 2, droppedCategories: 1 });
});

test('身份迁移追加缺失收藏并保持账户原顺序', () => {
  const result = appendMissingFavoriteSongs(
    [song('1'), song('2')],
    [song('2'), song('3'), song('4')],
    3,
  );

  assert.deepEqual(result.items.map(favoriteSongKey), ['netease:1', 'netease:2', 'netease:3']);
  assert.equal(result.imported, 1);
  assert.equal(result.dropped, 1);
});

test('Redis 收藏不可读时不得返回成功空列表或用空列表覆盖损坏数据', async () => {
  const source = readFileSync(new URL('./roomStorage.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function parseFavorites('), source.indexOf('export async function listFavoriteSongs('));
  let raw = JSON.stringify([song('1')]);
  let writes = 0;
  const context = vm.createContext({
    evalRedisScript, enabled: false,
    redisClient: { get: async () => raw, eval: async () => { writes += 1; return 1; } },
    favoriteKey: (id) => id, MAX_FAVORITES: 5000, FAVORITES_CAS_RETRIES: 8,
    FAVORITES_CAS_SCRIPT: 'fixture-script',
  });
  vm.runInContext(functions, context);
  await assert.rejects(context.readFavorites('guest_user_123'), /收藏存储暂不可用/);
  context.enabled = true;
  assert.equal((await context.readFavorites('guest_user_123'))[0].id, '1');
  for (const invalid of ['', '{invalid', '{}']) {
    raw = invalid;
    await assert.rejects(context.readFavorites('guest_user_123'), /收藏数据读取失败/);
    await assert.rejects(context.mutateFavoritesAtomically('guest_user_123', () => ({ items: [song('2')] })), /收藏数据读取失败/);
    assert.equal(writes, 0);
    assert.equal(raw, invalid);
  }
  raw = null;
  assert.equal((await context.readFavorites('guest_user_123')).length, 0);
});
