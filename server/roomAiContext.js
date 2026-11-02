/**
 * 每房间独立的 AI 对话上下文与滚动压缩摘要（跟随房间生命周期持久化，不因时间自动失忆）。
 */
import { trimMapByUpdatedAt } from './roomAiMemory.js';

const contexts = new Map();
const MAX_CONTEXT_ROOMS = 800;

/** 每个会话保留的近期原始轮次，超出部分自动浓缩进 summary */
const MAX_RECENT_TURNS = 28;
const COMPRESS_TRIGGER_TURNS = 22;
const COMPRESS_BATCH_TURNS = 10;
const MAX_SUMMARY_CHARS = 1800;

let persistHook = null;

/** 注册房间持久化回调，使 AI 上下文变动后跟随房间写入 Redis */
export function setRoomAiContextPersistHook(fn) {
  persistHook = typeof fn === 'function' ? fn : null;
}

function normalizeRoomId(roomId) {
  return String(roomId || '').trim().toUpperCase();
}

function roomKey(roomId, userId = '') {
  const rid = normalizeRoomId(roomId);
  if (!rid) return '';
  const user = String(userId || '').trim();
  if (user) return `${rid}:${user}`;
  return `${rid}:__room__`;
}

function pruneOverflow() {
  trimMapByUpdatedAt(contexts, MAX_CONTEXT_ROOMS, (v) => v?.updatedAt || 0);
}

function compactSingleTurnForSummary(turn) {
  const raw = String(turn?.content || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\[(?:系统备注|识图结果|引用图片识图结果)[^\]]*\]/g, '')
    .trim();
  const speaker = turn?.role === 'assistant' ? 'AI' : (turn?.nickname || '成员');
  const clipped = raw.length > 90 ? `${raw.slice(0, 90)}…` : raw;
  return clipped ? `${speaker}: ${clipped}` : '';
}

/** 将较早的多轮对话压缩进滚动摘要，避免直接丢弃造成失忆 */
function rollTurnsIntoSummary(entry, countToCompress = COMPRESS_BATCH_TURNS) {
  if (!entry || !Array.isArray(entry.turns) || entry.turns.length <= 4) return;
  const count = Math.min(Math.max(2, countToCompress), entry.turns.length - 4);
  const removed = entry.turns.splice(0, count);
  const lines = removed.map(compactSingleTurnForSummary).filter(Boolean);
  if (!lines.length) return;
  const combined = entry.summary
    ? `${entry.summary}\n${lines.join(' ｜ ')}`
    : lines.join(' ｜ ');
  entry.summary = combined.length > MAX_SUMMARY_CHARS
    ? `…${combined.slice(-MAX_SUMMARY_CHARS)}`
    : combined;
}

function ensureEntry(key) {
  let entry = contexts.get(key);
  if (!entry) {
    entry = { summary: '', turns: [], updatedAt: Date.now() };
    contexts.set(key, entry);
  }
  return entry;
}

export function appendRoomAiTurn(roomId, userId, role, content, options = {}) {
  const rid = normalizeRoomId(roomId);
  if (!rid) return;
  const text = String(content || '').trim();
  if (!text) return;
  pruneOverflow();

  const nickname = String(options.nickname || '').trim().slice(0, 24);
  const at = Date.now();
  const normalizedRole = role === 'assistant' ? 'assistant' : 'user';

  // 1) 记录该成员专属对话上下文
  if (userId) {
    const userKey = roomKey(rid, userId);
    const userEntry = ensureEntry(userKey);
    userEntry.turns.push({
      role: normalizedRole,
      nickname: nickname || undefined,
      content: text.slice(0, 2000),
      at,
    });
    if (userEntry.turns.length >= COMPRESS_TRIGGER_TURNS) {
      rollTurnsIntoSummary(userEntry, COMPRESS_BATCH_TURNS);
    }
    if (userEntry.turns.length > MAX_RECENT_TURNS) {
      rollTurnsIntoSummary(userEntry, userEntry.turns.length - MAX_RECENT_TURNS);
    }
    userEntry.updatedAt = at;
  }

  // 2) 同步记录房间公共 AI 记忆流（让 AI 记得房间里其他成员刚聊过什么、点过什么）
  const sharedKey = roomKey(rid, '');
  const sharedEntry = ensureEntry(sharedKey);
  const sharedContent = normalizedRole === 'user' && nickname
    ? `[${nickname}] ${text.slice(0, 600)}`
    : text.slice(0, 600);
  sharedEntry.turns.push({
    role: normalizedRole,
    userId: String(userId || '').trim() || undefined,
    nickname: nickname || undefined,
    content: sharedContent,
    at,
  });
  if (sharedEntry.turns.length >= COMPRESS_TRIGGER_TURNS) {
    rollTurnsIntoSummary(sharedEntry, COMPRESS_BATCH_TURNS);
  }
  if (sharedEntry.turns.length > MAX_RECENT_TURNS) {
    rollTurnsIntoSummary(sharedEntry, sharedEntry.turns.length - MAX_RECENT_TURNS);
  }
  sharedEntry.updatedAt = at;

  persistHook?.(rid);
}

/** 供模型 messages 数组使用的历史（含滚动压缩摘要 + 房间公共近期上下文 + 当前成员上下文） */
export function getRoomAiContextMessages(roomId, userId) {
  const rid = normalizeRoomId(roomId);
  if (!rid) return [];
  const userKey = userId ? roomKey(rid, userId) : '';
  const sharedKey = roomKey(rid, '');
  const userEntry = userKey ? contexts.get(userKey) : null;
  const sharedEntry = contexts.get(sharedKey);

  const result = [];
  const summaryParts = [];
  if (sharedEntry?.summary) {
    summaryParts.push(`【房间早期对话摘要】：${sharedEntry.summary}`);
  }
  if (userEntry?.summary) {
    summaryParts.push(`【与当前成员早期对话摘要】：${userEntry.summary}`);
  }
  // 补充房间内其他成员最近 6 条公开互动，避免房间失忆
  if (sharedEntry?.turns?.length) {
    const otherRecent = sharedEntry.turns
      .filter((t) => !userId || !t.userId || t.userId !== userId)
      .slice(-6)
      .map(compactSingleTurnForSummary)
      .filter(Boolean);
    if (otherRecent.length) {
      summaryParts.push(`【房间内其他成员近期互动】：${otherRecent.join(' ｜ ')}`);
    }
  }
  if (summaryParts.length) {
    result.push({
      role: 'system',
      content: `# 房间与成员长期记忆摘要（跟随房间持久化）\n${summaryParts.join('\n')}`,
    });
  }

  const turns = userEntry?.turns?.length ? userEntry.turns : (sharedEntry?.turns || []);
  for (const turn of turns) {
    result.push({
      role: turn.role,
      content: turn.content,
    });
  }
  return result;
}

/** 导出该房间的全部上下文快照，供随房间持久化进 Redis */
export function exportRoomAiContextForStorage(roomId) {
  const rid = normalizeRoomId(roomId);
  if (!rid) return null;
  const prefix = `${rid}:`;
  const entries = {};
  for (const [key, value] of contexts.entries()) {
    if (!key.startsWith(prefix)) continue;
    const subKey = key.slice(prefix.length);
    if (!subKey) continue;
    if (!value?.summary && (!Array.isArray(value?.turns) || value.turns.length === 0)) continue;
    entries[subKey] = {
      summary: String(value.summary || '').slice(0, MAX_SUMMARY_CHARS),
      turns: (value.turns || []).slice(-MAX_RECENT_TURNS).map((t) => ({
        role: t.role === 'assistant' ? 'assistant' : 'user',
        userId: t.userId || undefined,
        nickname: t.nickname || undefined,
        content: String(t.content || '').slice(0, 1200),
        at: Number(t.at) || Date.now(),
      })),
      updatedAt: Number(value.updatedAt) || Date.now(),
    };
  }
  return Object.keys(entries).length ? entries : null;
}

/** 从房间存储快照恢复该房间的 AI 上下文 */
export function restoreRoomAiContextFromStorage(roomId, stored) {
  const rid = normalizeRoomId(roomId);
  if (!rid || !stored || typeof stored !== 'object') return;
  for (const [subKey, raw] of Object.entries(stored)) {
    if (!subKey || !raw || typeof raw !== 'object') continue;
    const key = `${rid}:${subKey}`;
    const turns = Array.isArray(raw.turns)
      ? raw.turns
        .filter((t) => t && typeof t.content === 'string' && t.content.trim())
        .slice(-MAX_RECENT_TURNS)
        .map((t) => ({
          role: t.role === 'assistant' ? 'assistant' : 'user',
          userId: t.userId ? String(t.userId) : undefined,
          nickname: t.nickname ? String(t.nickname).slice(0, 24) : undefined,
          content: String(t.content).slice(0, 1200),
          at: Number(t.at) || Date.now(),
        }))
      : [];
    contexts.set(key, {
      summary: String(raw.summary || '').slice(0, MAX_SUMMARY_CHARS),
      turns,
      updatedAt: Number(raw.updatedAt) || Date.now(),
    });
  }
}

export function clearRoomAiContext(roomId) {
  const rid = normalizeRoomId(roomId);
  if (!rid) return;
  const prefix = `${rid}:`;
  for (const contextKey of contexts.keys()) {
    if (contextKey === rid || contextKey.startsWith(prefix)) contexts.delete(contextKey);
  }
}
