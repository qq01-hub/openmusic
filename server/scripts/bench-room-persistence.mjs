// 房间落盘基准（批 3 性能优化的改前/改后对照，非生产代码，手动运行）。
//
// 用途：构造一个活跃房快照（300 条聊天 + 100 首队列 + 100 条歌曲历史，
// 消息/歌曲字段形态与 snapshotRoomForStorage 的序列化结果近似），对比：
//   改前：整房快照 JSON.stringify 一次写入（含聊天内嵌）
//   改后：主快照（不含聊天）stringify + 聊天增量保存（新消息 1 条时只 RPUSH 1 条）
// 用法：node scripts/bench-room-persistence.mjs
import { createRoomChatStore } from '../roomChatStorage.js';
import { createFakeRedis } from '../testFakeRedis.js';

const msg = (i) => ({
  id: `m${i}_${'x'.repeat(12)}`, userId: `u${i % 50}`, nickname: `用户昵称${i % 50}`,
  text: `这是一条聊天消息内容，用来模拟活跃房间的真实聊天长度，大约四十个字左右。${i}`,
  kind: 'text', mentions: [], replyTo: null, timestamp: 1700000000000 + i * 1000,
});
const song = (i) => ({
  queueId: `q${i}`, id: `song${i}`, source: 'netease', name: `歌曲名称示例${i}`,
  artist: '歌手名', album: '专辑名', pic: 'https://p1.music.126.net/abc/cover.jpg',
  duration: 240, requestedBy: `u${i % 50}`, requesterName: '用户昵称', likes: [],
});

const messages = Array.from({ length: 300 }, (_, i) => msg(i));
const snapshot = {
  id: 'BENCH1', name: '活跃房',
  queue: Array.from({ length: 100 }, (_, i) => song(i)),
  current: song(0),
  messages,
  songHistory: Array.from({ length: 100 }, (_, i) => song(i)),
  knownUserIds: Array.from({ length: 50 }, (_, i) => `u${i}`),
};

function timeIt(fn, n = 200) {
  const t0 = performance.now();
  for (let i = 0; i < n; i += 1) fn();
  return (performance.now() - t0) / n;
}

// 改前：整包
const oldPayload = JSON.stringify(snapshot);
const oldMs = timeIt(() => JSON.stringify(snapshot));
const chatBytes = messages.reduce((sum, m) => sum + Buffer.byteLength(JSON.stringify(m)), 0);

// 改后：主快照（无聊天）
const { messages: _drop, ...mainSnapshot } = snapshot;
const newMain = { ...mainSnapshot, chatStorageVersion: 2 };
const newMainPayload = JSON.stringify(newMain);
const newMainMs = timeIt(() => JSON.stringify(newMain));

// 改后：聊天增量（稳态下每来一条新消息的落盘成本）
const client = createFakeRedis();
const store = createRoomChatStore({ getClient: () => client });
await store.saveChat('BENCH1', messages);
const appended = await store.saveChat('BENCH1', [...messages.slice(1), msg(300)]);
const rewrite = await store.saveChat('BENCH1', messages.filter((m) => m.id !== messages[10].id));

console.log(JSON.stringify({
  condition: '300 聊天 + 100 队列 + 100 历史',
  before: { bytes: Buffer.byteLength(oldPayload), stringifyMs: Number(oldMs.toFixed(3)), chatBytes, chatSharePct: Number((chatBytes / Buffer.byteLength(oldPayload) * 100).toFixed(1)) },
  afterMainSnapshot: { bytes: Buffer.byteLength(newMainPayload), stringifyMs: Number(newMainMs.toFixed(3)) },
  afterChatAppendOne: { mode: appended.mode, bytesWritten: appended.bytesWritten },
  afterChatRewriteOnDelete: { mode: rewrite.mode, bytesWritten: rewrite.bytesWritten },
}, null, 2));
