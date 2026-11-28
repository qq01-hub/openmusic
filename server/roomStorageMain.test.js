import assert from 'node:assert/strict';
import test from 'node:test';
import {
  _setRoomStorageClientForTests,
  saveRoomToStorage,
  loadAllRoomsFromStorage,
  deleteRoomFromStorage,
  listRoomIdsForAccount,
} from './roomStorage.js';
import { createFakeRedis } from './testFakeRedis.js';

const snapshot = (id, extra = {}) => ({
  id,
  name: `房-${id}`,
  queue: [{ id: `song-${id}`, title: '歌' }],
  current: null,
  ownerAccountId: null,
  musicAccountSecrets: { netease: null, tencent: null, kugou: null, qishui: null },
  ...extra,
});

test('主快照往返一致性：无聊天字段的快照保存后加载字段不丢', async () => {
  const client = createFakeRedis();
  _setRoomStorageClientForTests(client);
  const original = snapshot('ROUNDRIP', { playMode: 'random', isPlaying: false });
  await saveRoomToStorage(original);

  const rooms = await loadAllRoomsFromStorage();
  const loaded = rooms.find((room) => room.id === 'ROUNDRIP');
  assert.ok(loaded);
  assert.equal(loaded.name, original.name);
  assert.deepEqual(loaded.queue, original.queue);
  assert.equal(loaded.playMode, 'random');
  assert.deepEqual(loaded.messages, [], '新格式房间聊天应从独立列表读出（空）');
});

test('loadAllRoomsFromStorage 多房并行加载：全部房间均可恢复', async () => {
  const client = createFakeRedis();
  _setRoomStorageClientForTests(client);
  const ids = ['MULTI1', 'MULTI2', 'MULTI3', 'MULTI4', 'MULTI5'];
  await Promise.all(ids.map((id) => saveRoomToStorage(snapshot(id, {
    messages: [{ id: `m-${id}`, userId: 'u1', nickname: '甲', text: `hi-${id}`, timestamp: 1700000000000 }],
  }))));

  const rooms = await loadAllRoomsFromStorage();
  assert.deepEqual(rooms.map((room) => room.id).sort(), ids);
  for (const room of rooms) {
    assert.equal(room.messages.length, 1);
    assert.equal(room.messages[0].text, `hi-${room.id}`);
  }
});

test('损坏 JSON 容错：单房坏数据被跳过且不拖垮其它房间加载', async () => {
  const client = createFakeRedis();
  _setRoomStorageClientForTests(client);
  await saveRoomToStorage(snapshot('GOOD1'));
  await saveRoomToStorage(snapshot('GOOD2'));
  // 直接种入损坏的主快照（模拟历史脏数据/写一半）
  await client.set('openmusic:room:BROKEN', '{"id":"BROKEN","name":');
  await client.sAdd('openmusic:room_ids', 'BROKEN');

  const rooms = await loadAllRoomsFromStorage();
  assert.deepEqual(rooms.map((room) => room.id).sort(), ['GOOD1', 'GOOD2']);
});

test('删房清主快照：主快照、房间索引与账户索引一并移除', async () => {
  const client = createFakeRedis();
  _setRoomStorageClientForTests(client);
  await saveRoomToStorage(snapshot('DELMAIN', { ownerAccountId: 'acct_1234567890abcdef' }));
  assert.ok(client.strings.has('openmusic:room:DELMAIN'));
  assert.deepEqual(await listRoomIdsForAccount('acct_1234567890abcdef'), ['DELMAIN']);

  await deleteRoomFromStorage('DELMAIN', 'acct_1234567890abcdef');
  assert.equal(client.strings.has('openmusic:room:DELMAIN'), false, '主快照应被删除');
  assert.equal((await client.sMembers('openmusic:room_ids')).includes('DELMAIN'), false, '房间总索引应移除');
  assert.deepEqual(await listRoomIdsForAccount('acct_1234567890abcdef'), [], '账户房间索引应移除');
  assert.deepEqual(await loadAllRoomsFromStorage(), []);
});
