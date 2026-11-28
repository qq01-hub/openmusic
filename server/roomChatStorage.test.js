import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomChatStore, roomChatKey } from './roomChatStorage.js';
import { createFakeRedis } from './testFakeRedis.js';

const msg = (i, text = `消息${i}`) => ({ id: `m${i}`, userId: 'u1', nickname: '甲', text, timestamp: 1700000000000 + i });
const msgs = (from, to) => Array.from({ length: to - from }, (_, k) => msg(from + k));

function makeStore(client, maxMessages = 300) {
  return createRoomChatStore({ getClient: () => client, maxMessages });
}

test('首次保存整表写入，存取往返一致', async () => {
  const client = createFakeRedis();
  const store = makeStore(client);
  const list = msgs(0, 10);
  const first = await store.saveChat('ROOM1', list);
  assert.equal(first.mode, 'rewrite');
  assert.deepEqual(await store.loadChat('ROOM1'), list);
  assert.equal(client.lists.get(roomChatKey('ROOM1')).length, 10);
});

test('追加一条消息只增量写入一条，不重写整表', async () => {
  const client = createFakeRedis();
  const store = makeStore(client);
  await store.saveChat('ROOM1', msgs(0, 300));
  const before = client.lists.get(roomChatKey('ROOM1')).slice();
  const result = await store.saveChat('ROOM1', msgs(1, 301)); // 头部裁 1 条 + 尾部加 1 条
  assert.equal(result.mode, 'append');
  assert.equal(result.appended, 1);
  assert.ok(result.bytesWritten < 1000, `增量字节应远小于整表，实际 ${result.bytesWritten}`);
  const after = await store.loadChat('ROOM1');
  assert.equal(after.length, 300);
  assert.equal(after[0].id, 'm1');
  assert.equal(after.at(-1).id, 'm300');
  assert.deepEqual(client.lists.get(roomChatKey('ROOM1')).slice(0, 299), before.slice(1));
});

test('无变化时不写 Redis', async () => {
  const client = createFakeRedis();
  const store = makeStore(client);
  await store.saveChat('ROOM1', msgs(0, 5));
  const result = await store.saveChat('ROOM1', msgs(0, 5));
  assert.equal(result.mode, 'noop');
  assert.equal(result.bytesWritten, 0);
});

test('删除中间一条（撤回）触发整表重写且内容正确', async () => {
  const client = createFakeRedis();
  const store = makeStore(client);
  await store.saveChat('ROOM1', msgs(0, 10));
  const next = msgs(0, 10).filter((m) => m.id !== 'm5');
  const result = await store.saveChat('ROOM1', next);
  assert.equal(result.mode, 'rewrite');
  assert.deepEqual((await store.loadChat('ROOM1')).map((m) => m.id), next.map((m) => m.id));
});

test('清空聊天后列表键为空', async () => {
  const client = createFakeRedis();
  const store = makeStore(client);
  await store.saveChat('ROOM1', msgs(0, 5));
  const result = await store.saveChat('ROOM1', []);
  assert.equal(result.mode, 'rewrite');
  assert.deepEqual(await store.loadChat('ROOM1'), []);
});

test('超过上限时 LTRIM 只保留最新 maxMessages 条', async () => {
  const client = createFakeRedis();
  const store = makeStore(client, 5);
  await store.saveChat('ROOM1', msgs(0, 5));
  const appended = await store.saveChat('ROOM1', msgs(0, 8));
  assert.equal(appended.mode, 'append');
  const after = await store.loadChat('ROOM1');
  assert.deepEqual(after.map((m) => m.id), ['m3', 'm4', 'm5', 'm6', 'm7']);
});

test('进程重启后 noteLoaded 播种可继续增量追加', async () => {
  const client = createFakeRedis();
  const storeA = makeStore(client);
  await storeA.saveChat('ROOM1', msgs(0, 10));
  // 模拟重启：新 store 实例、同一 Redis
  const storeB = makeStore(client);
  const loaded = await storeB.loadChat('ROOM1');
  storeB.noteLoaded('ROOM1', loaded);
  const result = await storeB.saveChat('ROOM1', [...loaded, msg(10)]);
  assert.equal(result.mode, 'append');
  assert.equal(result.appended, 1);
});

test('未播种的新实例首存走整表重写，结果仍正确', async () => {
  const client = createFakeRedis();
  const storeA = makeStore(client);
  await storeA.saveChat('ROOM1', msgs(0, 10));
  const storeB = makeStore(client);
  const result = await storeB.saveChat('ROOM1', msgs(0, 11));
  assert.equal(result.mode, 'rewrite');
  assert.equal((await storeB.loadChat('ROOM1')).length, 11);
});

test('deleteChat 删除列表键并清 diff 状态', async () => {
  const client = createFakeRedis();
  const store = makeStore(client);
  await store.saveChat('ROOM1', msgs(0, 3));
  await store.deleteChat('ROOM1');
  assert.equal(client.lists.has(roomChatKey('ROOM1')), false);
  assert.deepEqual(await store.loadChat('ROOM1'), []);
});

test('migrateLegacy 无条件写入旧格式聊天', async () => {
  const client = createFakeRedis();
  const store = makeStore(client);
  const legacy = msgs(0, 7);
  await store.migrateLegacy('ROOM1', legacy);
  assert.deepEqual(await store.loadChat('ROOM1'), legacy);
});
