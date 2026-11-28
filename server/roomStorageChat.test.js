import assert from 'node:assert/strict';
import test from 'node:test';
import {
  _setRoomStorageClientForTests,
  saveRoomToStorage,
  loadAllRoomsFromStorage,
  deleteRoomFromStorage,
} from './roomStorage.js';
import { roomChatKey } from './roomChatStorage.js';
import { createFakeRedis } from './testFakeRedis.js';

const msg = (i) => ({ id: `m${i}`, userId: 'u1', nickname: '甲', text: `消息${i}`, timestamp: 1700000000000 + i });
const snapshot = (id, messages) => ({
  id,
  name: '测试房',
  queue: [],
  current: null,
  messages,
  musicAccountSecrets: { netease: null, tencent: null, kugou: null, qishui: null },
  ownerAccountId: null,
});

test('新格式存取往返：主快照不含聊天、独立列表保存、加载合并', async () => {
  const client = createFakeRedis();
  _setRoomStorageClientForTests(client);
  const messages = [msg(0), msg(1), msg(2)];
  await saveRoomToStorage(snapshot('ROOMNEW', messages));

  const mainRaw = client.strings.get('openmusic:room:ROOMNEW');
  assert.ok(mainRaw, '主快照应存在');
  const main = JSON.parse(mainRaw);
  assert.equal('messages' in main, false, '主快照不应再内嵌聊天');
  assert.equal(main.chatStorageVersion, 2);
  assert.equal(client.lists.get(roomChatKey('ROOMNEW')).length, 3);

  const rooms = await loadAllRoomsFromStorage();
  const loaded = rooms.find((room) => room.id === 'ROOMNEW');
  assert.deepEqual(loaded.messages, messages);
});

test('旧格式快照加载时迁移到独立列表且主快照被改写', async () => {
  const client = createFakeRedis();
  _setRoomStorageClientForTests(client);
  const legacyMessages = [msg(0), msg(1)];
  // 直接种入旧格式（快照内嵌 messages、无 chatStorageVersion）
  await client.set('openmusic:room:ROOMOLD', JSON.stringify({
    id: 'ROOMOLD', name: '旧房', queue: [], current: null,
    messages: legacyMessages,
    musicAccountSecrets: { netease: null, tencent: null, kugou: null, qishui: null },
  }));
  await client.sAdd('openmusic:room_ids', 'ROOMOLD');

  const rooms = await loadAllRoomsFromStorage();
  const loaded = rooms.find((room) => room.id === 'ROOMOLD');
  assert.deepEqual(loaded.messages, legacyMessages, '旧格式聊天应完整恢复');

  const mainAfter = JSON.parse(client.strings.get('openmusic:room:ROOMOLD'));
  assert.equal('messages' in mainAfter, false, '迁移后主快照不应再内嵌聊天');
  assert.equal(mainAfter.chatStorageVersion, 2);
  assert.equal(client.lists.get(roomChatKey('ROOMOLD')).length, 2, '聊天应已写入独立列表');
});

test('删除房间时同步删除 chat 列表键', async () => {
  const client = createFakeRedis();
  _setRoomStorageClientForTests(client);
  await saveRoomToStorage(snapshot('ROOMDEL', [msg(0)]));
  assert.equal(client.lists.has(roomChatKey('ROOMDEL')), true);
  await deleteRoomFromStorage('ROOMDEL');
  assert.equal(client.lists.has(roomChatKey('ROOMDEL')), false);
  assert.equal(client.strings.has('openmusic:room:ROOMDEL'), false);
});
