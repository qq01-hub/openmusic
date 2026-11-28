import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from 'redis';
import { getRedisConnectionOptions, ROOM_IDS_KEY, roomKey } from '../roomStorage.js';
import { createRoomChatStore, roomChatKey, ROOM_CHAT_STORAGE_VERSION } from '../roomChatStorage.js';

export async function rollbackRoomChat(client, { deleteChatKeys = false } = {}) {
  const chatStore = createRoomChatStore({ getClient: () => client });
  let converted = 0;
  for await (const batch of client.sScanIterator(ROOM_IDS_KEY)) {
    for (const id of batch) {
      const key = roomKey(id);
      const raw = await client.get(key);
      if (!raw) continue;
      const room = JSON.parse(raw);
      if (room.chatStorageVersion !== ROOM_CHAT_STORAGE_VERSION) continue;

      room.messages = await chatStore.loadChat(id);
      delete room.chatStorageVersion;
      const transaction = client.multi().set(key, JSON.stringify(room), { KEEPTTL: true });
      if (deleteChatKeys) transaction.del(roomChatKey(id));
      await transaction.exec();
      converted += 1;
    }
  }
  return converted;
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--delete-chat-keys')) {
    throw new Error('用法：node server/scripts/rollback-room-chat.mjs [--delete-chat-keys]');
  }
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
  const options = getRedisConnectionOptions();
  if (!options) throw new Error('请配置 REDIS_URL 或 REDIS_HOST');
  const client = createClient({ ...options, socket: { ...options.socket, reconnectStrategy: false } });
  client.on('error', (err) => console.error('Redis 连接异常', err.code || err.name));
  try {
    await client.connect();
    const count = await rollbackRoomChat(client, { deleteChatKeys: flags.includes('--delete-chat-keys') });
    console.log(`已回滚 ${count} 个房间的聊天存储格式`);
  } finally {
    if (client.isOpen) await client.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('房间聊天回滚失败', err.message);
    process.exitCode = 1;
  });
}
