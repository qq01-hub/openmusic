/**
 * AI 机器人消息鉴权：HMAC 签名，防止伪造 userId=__openmusic_ai__ 的消息。
 * 密钥 = hash(CLIENT_ID_SECRET + aiApiKey)，不落盘明文组合。
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getRuntimeConfig } from './runtimeConfig.js';

export const AI_BOT_USER_ID = '__openmusic_ai__';
export const AI_BOT_MESSAGE_KIND = 'ai_bot';

function deriveSignKey() {
  const clientSecret = String(process.env.CLIENT_ID_SECRET || '').trim();
  const aiKey = String(getRuntimeConfig().aiApiKey || '').trim();
  if (!clientSecret && !aiKey) return null;
  return createHmac('sha256', 'om-ai-bot-v1')
    .update(`${clientSecret}\n${aiKey}`)
    .digest();
}

export function signAiBotMessage(roomId, message) {
  const key = deriveSignKey();
  if (!key || !message?.id) return '';
  const payload = [
    String(roomId || '').toUpperCase(),
    String(message.id),
    String(message.timestamp || 0),
    AI_BOT_USER_ID,
  ].join(':');
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function verifyAiBotMessage(roomId, message) {
  if (!message || message.userId !== AI_BOT_USER_ID) return false;
  if (message.kind !== AI_BOT_MESSAGE_KIND) return false;
  const sig = String(message.aiBotSig || message._aiBotSig || '').trim();
  if (!sig) return false;
  const expected = signAiBotMessage(roomId, message);
  if (!expected) return false;
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** 对外序列化前写入签名；对内存储保留 kind */
export function attachAiBotWireFields(roomId, message) {
  if (!message || message.userId !== AI_BOT_USER_ID) return message;
  message.kind = AI_BOT_MESSAGE_KIND;
  const sig = signAiBotMessage(roomId, message);
  if (sig) message.aiBotSig = sig;
  return message;
}

/** 从持久化/恶意数据恢复：无有效签名则降级为普通聊天，避免冒充 bot */
export function sanitizeStoredAiBotMessage(roomId, message) {
  if (!message || message.userId !== AI_BOT_USER_ID) return message;
  if (verifyAiBotMessage(roomId, message)) return message;
  return {
    ...message,
    kind: 'chat',
    aiBotSig: undefined,
    _aiBotSig: undefined,
  };
}

export function isReservedBotNickname(nickname) {
  const cfg = getRuntimeConfig();
  const bot = String(cfg.aiBotName || '小肥鱼').trim();
  const name = String(nickname || '').trim();
  if (!name) return false;
  const lower = name.toLowerCase();
  if (bot && lower === bot.toLowerCase()) return true;
  if (lower === 'ai' || lower === 'openmusic_ai' || lower === 'openmusic ai') return true;
  if (lower === '系统' || lower === 'system') return false; // 系统消息用 userId=system
  return false;
}
