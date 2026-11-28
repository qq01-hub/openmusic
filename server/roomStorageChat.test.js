import assert from 'node:assert/strict';
import test from 'node:test';
import {
  _setRoomStorageClientForTests,
  saveRoomToStorage,
  loadAllRoomsFromStorage,
  deleteRoomFromStorage,
} from './roomStorage.js';
import { createRoomChatStore, roomChatKey } from './roomChatStorage.js';
import { createFakeRedis } from './testFakeRedis.js';
import { rollbackRoomChat } from './scripts/rollback-room-chat.mjs';

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

test('在途保存和删除串行完成后，同 ID 房间重新写入完整聊天', async () => {
  const client = createFakeRedis();
  _setRoomStorageClientForTests(client);
  const id = 'ROOMRACE';
  const multi = client.multi.bind(client);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let started;
  const writing = new Promise((resolve) => { started = resolve; });
  client.multi = () => {
    client.multi = multi;
    const transaction = multi();
    const exec = transaction.exec.bind(transaction);
    transaction.exec = async () => {
      started();
      await blocked;
      return exec();
    };
    return transaction;
  };

  const save = saveRoomToStorage(snapshot(id, [msg(0)]));
  await writing;
  const remove = deleteRoomFromStorage(id);
  release();
  await Promise.all([save, remove]);
  assert.equal(client.lists.has(roomChatKey(id)), false);

  const messages = [msg(0), msg(1)];
  await saveRoomToStorage(snapshot(id, messages));
  assert.deepEqual(client.lists.get(roomChatKey(id)).map((row) => JSON.parse(row)), messages);
});

test('forgetAll 后 Redis 丢失的列表通过整表重写恢复', async () => {
  const client = createFakeRedis();
  const store = createRoomChatStore({ getClient: () => client });
  const id = 'ROOMRECONNECT';
  await store.saveChat(id, [msg(0)]);
  client.lists.clear();
  store.forgetAll();
  const messages = [msg(0), msg(1)];
  assert.equal((await store.saveChat(id, messages)).mode, 'rewrite');
  assert.deepEqual(await store.loadChat(id), messages);
});

test('离线回滚恢复旧版内嵌聊天，支持保留或清理列表且可重复运行', async () => {
  for (const deleteChatKeys of [false, true]) {
    const client = createFakeRedis();
    _setRoomStorageClientForTests(client);
    const id = 'ROOMROLLBACK';
    const key = `openmusic:room:${id}`;
    const messages = [msg(0), msg(1)];
    await saveRoomToStorage(snapshot(id, messages));
    const original = JSON.parse(await client.get(key));
    assert.equal(await rollbackRoomChat(client, { deleteChatKeys }), 1);
    delete original.chatStorageVersion;
    assert.deepEqual(JSON.parse(await client.get(key)), { ...original, messages });
    assert.equal(client.lists.has(roomChatKey(id)), !deleteChatKeys);
    assert.equal(await rollbackRoomChat(client, { deleteChatKeys }), 0);
    assert.deepEqual(JSON.parse(await client.get(key)).messages, messages);
  }
});
