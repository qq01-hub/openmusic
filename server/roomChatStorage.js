// 房间聊天记录的独立 Redis 列表存储。
//
// 背景：房间落盘原本把聊天（最多 300 条）塞进主快照 JSON 整体重写，
// 活跃房每次落盘都要序列化整包（基准见 scripts/bench-room-persistence.mjs：
// 300 聊天 + 100 队列 + 100 历史时整包约 127KB，聊天占约 42%）。
// 现在聊天拆到独立键 openmusic:room:{id}:chat（LIST，每元素一条消息 JSON）：
// - 追加型变更（新消息 + 头部裁剪）只 RPUSH 新增条目 + LTRIM 到上限，不重写旧消息；
// - 删除单条/清空/内容变化等非追加变更才整表重写（DEL + RPUSH）；
// - 进程内记住上次落盘的 id 序列与逐条序列化结果做 diff；进程重启后由
//   加载路径 noteLoaded 重新播种，Redis 列表与内存不一致时自动退回整表重写。
// 主快照以 chatStorageVersion: 2 标记新格式；旧格式（快照内嵌 messages）
// 由 loadAllRoomsFromStorage 识别并迁移，restore 侧读到的仍是完整 messages 数组。

export const ROOM_CHAT_STORAGE_VERSION = 2;
export const ROOM_CHAT_MAX_MESSAGES = 300; // 与 roomManager.js 的 MAX_CHAT_MESSAGES 保持一致

export const roomChatKey = (id) => `openmusic:room:${id}:chat`;

function messageId(message, index) {
  const id = message?.id;
  return typeof id === 'string' && id ? id : `__noid_${index}`;
}

export function createRoomChatStore({
  getClient,
  maxMessages = ROOM_CHAT_MAX_MESSAGES,
  onMode = () => {},
} = {}) {
  if (typeof getClient !== 'function') throw new TypeError('createRoomChatStore 需要 getClient 函数');
  const cap = Math.max(1, Math.floor(maxMessages) || ROOM_CHAT_MAX_MESSAGES);
  // roomId -> { ids: string[], serialized: Map<string, string> }
  const lastSaved = new Map();

  function remember(roomId, messages, serializedList) {
    const ids = messages.map((message, index) => messageId(message, index));
    const serialized = new Map();
    ids.forEach((id, index) => serialized.set(id, serializedList[index]));
    lastSaved.set(roomId, { ids, serialized });
  }

  function forget(roomId) {
    lastSaved.delete(roomId);
  }

  // 判断 newMessages 是否是「旧序列裁掉头部若干条 + 尾部追加若干条」且保留条目内容未变。
  // 返回 { drop, appended } 或 null（需要整表重写）。
  function planAppend(roomId, messages, serializedList) {
    const state = lastSaved.get(roomId);
    if (!state) return null;
    const newIds = messages.map((message, index) => messageId(message, index));
    if (newIds.length === 0) return null; // 清空走重写（DEL）
    let drop = -1;
    if (state.ids.length === 0) {
      drop = 0;
    } else {
      const firstIdx = state.ids.indexOf(newIds[0]);
      if (firstIdx >= 0) drop = firstIdx;
    }
    if (drop < 0) return null;
    const retained = state.ids.length - drop;
    if (newIds.length < retained) return null;
    for (let i = 0; i < retained; i += 1) {
      const id = newIds[i];
      if (state.ids[drop + i] !== id) return null;
      if (state.serialized.get(id) !== serializedList[i]) return null; // 内容被改过 → 重写
    }
    const appended = serializedList.slice(retained);
    // 追加条目的 id 不应与已保存 id 重复（id 复用视为异常，走重写保证一致）
    for (let i = retained; i < newIds.length; i += 1) {
      if (state.serialized.has(newIds[i])) return null;
    }
    return { drop, appended };
  }

  async function saveChat(roomId, messages) {
    const client = getClient();
    if (!client) return { mode: 'disabled', appended: 0, bytesWritten: 0 };
    const list = Array.isArray(messages) ? messages.slice(-cap) : [];
    const serializedList = list.map((message) => JSON.stringify(message));
    const key = roomChatKey(roomId);
    const plan = planAppend(roomId, list, serializedList);
    if (plan && (plan.appended.length > 0 || plan.drop > 0)) {
      const transaction = client.multi();
      if (plan.appended.length > 0) transaction.rPush(key, plan.appended);
      // 精确裁到本次快照长度：头部裁剪（drop）也靠这一步在 Redis 侧生效
      transaction.lTrim(key, -list.length, -1);
      await transaction.exec();
      remember(roomId, list, serializedList);
      const bytesWritten = plan.appended.reduce((sum, item) => sum + Buffer.byteLength(item), 0);
      onMode(roomId, 'append');
      return { mode: 'append', appended: plan.appended.length, bytesWritten };
    }
    if (plan) { // 无变化
      onMode(roomId, 'noop');
      return { mode: 'noop', appended: 0, bytesWritten: 0 };
    }
    const transaction = client.multi().del(key);
    if (serializedList.length > 0) transaction.rPush(key, serializedList);
    await transaction.exec();
    remember(roomId, list, serializedList);
    const bytesWritten = serializedList.reduce((sum, item) => sum + Buffer.byteLength(item), 0);
    onMode(roomId, 'rewrite');
    return { mode: 'rewrite', appended: list.length, bytesWritten };
  }

  async function loadChat(roomId) {
    const client = getClient();
    if (!client) return [];
    const rows = await client.lRange(roomChatKey(roomId), 0, -1);
    const messages = [];
    for (const row of rows || []) {
      try {
        const parsed = JSON.parse(row);
        if (parsed && typeof parsed === 'object') messages.push(parsed);
      } catch { /* 跳过损坏条目，不让一条坏数据丢掉整房聊天 */ }
    }
    return messages.slice(-cap);
  }

  // 加载后播种 diff 状态：Redis 列表内容即权威，后续保存可继续走增量。
  function noteLoaded(roomId, messages) {
    const list = Array.isArray(messages) ? messages.slice(-cap) : [];
    remember(roomId, list, list.map((message) => JSON.stringify(message)));
  }

  // 旧格式迁移：无条件整表写入（不看 diff 状态）。
  async function migrateLegacy(roomId, messages) {
    const client = getClient();
    if (!client) return { mode: 'disabled', appended: 0, bytesWritten: 0 };
    lastSaved.delete(roomId);
    return saveChat(roomId, messages);
  }

  async function deleteChat(roomId) {
    forget(roomId);
    const client = getClient();
    if (!client) return;
    await client.del(roomChatKey(roomId));
  }

  return { saveChat, loadChat, noteLoaded, migrateLegacy, deleteChat, forget, planAppend };
}
