/**
 * 房间聊天 AI Agent：由配置的模型选择并调用点歌、切歌、表情等工具
 */
import { fetchMetingApi, runWithMetingRequestContext } from './metingUpstream.js';
import { verifyAiBotMessage } from './chatAiAuth.js';
import { searchApihzStickersRandom, isApihzStickerConfigured } from './apihzSticker.js';
import {
  evaluateBuiltinStickerForReply,
  getBuiltinStickerById,
  hasMatchingBuiltinStickers,
  resolvePersonaStickerRole,
  searchBuiltinStickers,
  shuffleStickers,
} from './builtinStickers.js';
import { collectRecentBotQqFaceIds, normalizeAiQqFaceText, queryQqFaces } from './qqFaces.js';
import {
  addToQueue,
  skipSongOnBehalfOfUser,
  requestSkipOnBehalfOfUser,
  assertAiCanRequestSong,
  getAiActorPermissions,
  postBotChatMessage,
  getRoomAiSnapshot,
  getRoomInternal,
  getSongHistory,
  setRoomPlayModeOnBehalfOfUser,
  setRoomFmModeOnBehalfOfUser,
  jumpQueueSongOnBehalfOfUser,
  removeQueueSongOnBehalfOfUser,
  likeQueueSongOnBehalfOfUser,
} from './roomManager.js';
import {
  AI_BOT_USER_ID,
  AI_FORBIDDEN_ROOM_TOOL_NAMES,
  buildOpenMusicAiSystemPrompt,
  buildRoomAiUserTurn,
  buildRoomAiTools,
  describeImageWithVision,
  inspectStickerForReply,
  extractAssistantText,
  getPublicRoomAiConfig,
  getAiModelConfig,
  getAiRequestConcurrencyLimit,
  getTimeOfDayContext,
  isRoomAiEnabledForRoom,
  isAiModelEnabled,
  resolveQqFaceToken,
  shouldTriggerRoomAi,
  stripAiTriggerPrefix,
  aiChatCompletions,
} from './aiModelService.js';
import { appendRoomAiTurn, getRoomAiContextMessages } from './roomAiContext.js';
import { MAX_CHAT_SONG_CARDS, sanitizeChatSongCards } from './chatSongCard.js';
import { listFavoriteSongs } from './roomStorage.js';
import { sanitizeFavoriteSongInput } from './favoriteSongInput.js';
import { incrementMetric } from './logger.js';
import { searchWeb } from './aiWebSearch.js';
import { validDeskPetArgs, compactDeskPetResult } from './roomAiDeskPet.js';
import { fetchNeteaseHotToplist } from './neteaseToplist.js';
import { getHotSongs } from './songHotRank.js';
import {
  getAiUserRapport,
  getAiUserProfile,
  forgiveAiUserAfterApology,
  updateAiUserMemory,
  recordAiUserInteraction,
  recordAiSongRequest,
  setAiSongCandidates,
  getAiSongCandidates,
  recordAiUserViolation,
  getRoomAiEmotionSummary,
} from './roomAiUserState.js';

const MAX_TOOL_ROUNDS = 8;
const AI_MAX_ATTEMPTS = 3;
/**
 * 真正产生外部副作用的工具：重试时命中台账，避免重复执行。
 * send_song_card 不在此列——它只是把卡片放进本轮缓冲，真正发送发生在 flush，
 * 如果在这里记账，重试会命中缓存而永不发送。
 */
const MUTATING_TOOL_NAMES = new Set([
  'request_song',
  'skip_song',
  'request_skip_song',
  'set_play_mode',
  'set_fm_mode',
  'jump_queue_song',
  'remove_queue_song',
  'like_queue_song',
  'send_emoji',
  'send_sticker',
  'reply_message',
  'update_member_context',
  'control_desk_pet',
]);
const aiQueue = [];
const aiActiveTasks = new Map();
const aiRecentRequestIds = new Map();
const AI_REQUEST_DEDUPE_TTL_MS = 2 * 60 * 1000;

function getRoomAiTaskWeight(room) {
  const onlineCount = Math.max(0, Number(room?.users?.size) || 0);
  const active = onlineCount > 0 && Boolean(room?.isPlaying);
  return { active, onlineCount };
}

function getRoomActiveTaskCount(roomId) {
  let count = 0;
  for (const task of aiActiveTasks.values()) {
    if (task.roomId === roomId) count += 1;
  }
  return count;
}

function hasActiveMemberTask(task) {
  const userId = String(task.params.userId || task.params.triggerMessage?.userId || '').trim();
  return Array.from(aiActiveTasks.values()).some((active) => (
    active.roomId === task.roomId
    && String(active.params.userId || active.params.triggerMessage?.userId || '').trim() === userId
  ));
}

function getDynamicRoomTaskLimit(roomId) {
  const room = getRoomInternal(roomId);
  const roomIds = new Set([
    ...aiQueue.map((task) => task.roomId),
    ...Array.from(aiActiveTasks.values(), (task) => task.roomId),
  ]);
  const activeRooms = Array.from(roomIds)
    .map((id) => ({ id, weight: getRoomAiTaskWeight(getRoomInternal(id)) }))
    .filter(({ weight }) => weight.active);
  const currentWeight = getRoomAiTaskWeight(room);
  if (!currentWeight.active || activeRooms.length === 0) return 1;
  const totalOnline = activeRooms.reduce((sum, item) => sum + item.weight.onlineCount, 0);
  const weightedLimit = Math.ceil((getAiRequestConcurrencyLimit() * currentWeight.onlineCount) / Math.max(1, totalOnline));
  return Math.max(1, weightedLimit);
}

function compareAiTasks(a, b) {
  const aWeight = getRoomAiTaskWeight(getRoomInternal(a.roomId));
  const bWeight = getRoomAiTaskWeight(getRoomInternal(b.roomId));
  if (aWeight.active !== bWeight.active) return aWeight.active ? -1 : 1;
  if (aWeight.onlineCount !== bWeight.onlineCount) return bWeight.onlineCount - aWeight.onlineCount;
  return a.queuedAt - b.queuedAt;
}

function emitQueuedStatuses() {
  const byRoom = new Map();
  for (const task of aiQueue.slice().sort(compareAiTasks)) {
    const list = byRoom.get(task.roomId) || [];
    list.push(task);
    byRoom.set(task.roomId, list);
  }
  for (const [roomId, tasks] of byRoom) {
    const pendingCount = tasks.length + getRoomActiveTaskCount(roomId);
    tasks.forEach((task, index) => task.onStatus?.({
      status: 'queued',
      queuePosition: index + 1,
      pendingCount,
      attempt: task.attempt,
      maxAttempts: AI_MAX_ATTEMPTS,
    }));
  }
}

function pumpAiQueue() {
  const globalLimit = getAiRequestConcurrencyLimit();
  if (aiActiveTasks.size >= globalLimit || aiQueue.length === 0) {
    emitQueuedStatuses();
    return;
  }
  aiQueue.sort(compareAiTasks);
  let index = aiQueue.findIndex((task) => (
    !hasActiveMemberTask(task) && getRoomActiveTaskCount(task.roomId) < getDynamicRoomTaskLimit(task.roomId)
  ));
  if (index < 0) {
    index = aiQueue.findIndex((task) => !hasActiveMemberTask(task) && getRoomActiveTaskCount(task.roomId) < globalLimit);
  }
  if (index < 0) {
    emitQueuedStatuses();
    return;
  }

  const [task] = aiQueue.splice(index, 1);
  aiActiveTasks.set(task.requestId, task);
  task.onStatus?.({
    status: 'start',
    queuePosition: 0,
    pendingCount: aiQueue.filter((item) => item.roomId === task.roomId).length + getRoomActiveTaskCount(task.roomId),
    attempt: task.attempt,
    maxAttempts: AI_MAX_ATTEMPTS,
  });
  void handleRoomAiChat({
    ...task.params,
    executionLedger: task.executionLedger,
    onProgress: (stepText, thoughtSteps) => {
      task.onStatus?.({
        status: 'start',
        queuePosition: 0,
        pendingCount: aiQueue.filter((item) => item.roomId === task.roomId).length + getRoomActiveTaskCount(task.roomId),
        attempt: task.attempt,
        maxAttempts: AI_MAX_ATTEMPTS,
        stepText,
        thoughtSteps,
      });
    },
  })
    .then((result) => {
      if (result?.error) throw new Error(result.error);
      aiActiveTasks.delete(task.requestId);
      task.onStatus?.({ status: 'end', queuePosition: 0, pendingCount: 0 });
      pumpAiQueue();
    })
    .catch((err) => {
      aiActiveTasks.delete(task.requestId);
      if (task.attempt + 1 < AI_MAX_ATTEMPTS) {
        aiQueue.push({ ...task, attempt: task.attempt + 1 });
      } else {
        task.onStatus?.({
          status: 'error',
          queuePosition: 0,
          pendingCount: 0,
          attempt: task.attempt + 1,
          maxAttempts: AI_MAX_ATTEMPTS,
          error: String(err?.message || 'AI 调用失败').slice(0, 80),
        });
      }
      pumpAiQueue();
    });
  pumpAiQueue();
}

export function enqueueRoomAiChat(params = {}, onStatus) {
  const roomId = String(params.roomId || '').trim();
  const requestId = String(params.requestId || '').trim();
  if (!roomId || !requestId) return { queued: false };
  const now = Date.now();
  for (const [knownRequestId, seenAt] of aiRecentRequestIds) {
    if (now - seenAt > AI_REQUEST_DEDUPE_TTL_MS) aiRecentRequestIds.delete(knownRequestId);
  }
  if (aiRecentRequestIds.has(requestId) || aiActiveTasks.has(requestId) || aiQueue.some((task) => task.requestId === requestId)) {
    return { queued: false, duplicate: true };
  }
  aiRecentRequestIds.set(requestId, now);
  aiQueue.push({
    roomId,
    requestId,
    params,
    onStatus,
    queuedAt: Date.now(),
    attempt: 0,
    executionLedger: new Map(),
  });
  pumpAiQueue();
  return { queued: true };
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeSongFromMeting(raw, server = 'netease') {
  if (!raw || typeof raw !== 'object') return null;
  const source = String(raw.source || server || 'netease').trim() || 'netease';
  const url = String(raw.url || '').trim();
  const urlId = (() => {
    try {
      const parsed = new URL(url);
      return String(parsed.searchParams.get('id') || '').trim();
    } catch {
      return '';
    }
  })();
  const rawId = String(raw.id || raw.songid || '').trim();
  const name = String(raw.name || raw.title || '').trim();
  const id = source === 'netease' && /^\d+$/.test(urlId)
    ? urlId
    : rawId || urlId;
  if (!id || !name || id === name) return null;
  if (source === 'netease' && !/^\d+$/.test(id)) return null;
  return {
    id,
    name: name || '未知歌曲',
    artist: String(raw.artist || raw.author || raw.singer || '未知').trim() || '未知',
    pic: String(raw.pic || raw.picture || raw.cover || '').trim(),
    url,
    lrc: String(raw.lrc || raw.lyric || '').trim(),
    source,
  };
}

async function searchSongsInternal(keyword, server = 'netease', limit = 5) {
  const q = String(keyword || '').trim().slice(0, 64);
  if (!q) return { success: false, error: '关键词为空' };
  const src = ['netease', 'tencent', 'kugou', 'qishui'].includes(server) ? server : 'netease';
  const safeLimit = Math.max(1, Math.min(8, Number(limit) || 5));

  try {
    const response = await runWithMetingRequestContext(
      { userId: AI_BOT_USER_ID, userNickname: 'AI', roomId: '', roomName: 'ai-search' },
      () => fetchMetingApi({ server: src, type: 'search', id: q }, {}, 12000),
    );
    if (!response.ok) {
      return { success: false, error: `搜索失败 HTTP ${response.status}` };
    }
    const data = await response.json();
    const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const seen = new Set();
    const songs = list
      .map((item) => normalizeSongFromMeting(item, src))
      .filter(Boolean)
      .filter((song) => {
        const key = `${song.source}:${song.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, safeLimit)
      .map((song, index) => ({
        index: index + 1,
        id: song.id,
        name: song.name,
        artist: song.artist,
        pic: song.pic,
        server: song.source,
      }));
    return { success: true, keyword: q, server: src, songs };
  } catch (err) {
    return { success: false, error: err?.message || '搜索失败' };
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function compactSongForModel(song, index = 0) {
  if (!song || typeof song !== 'object') return null;
  const id = String(song.id || '').trim();
  const name = String(song.name || '').trim();
  if (!id && !name) return null;
  return {
    index: Number(song.index) || index + 1,
    ...(id ? { id: id.slice(0, 100) } : {}),
    server: String(song.server || song.source || 'netease').slice(0, 16),
    name: name.slice(0, 100),
    artist: String(song.artist || '').slice(0, 80),
    ...(Number.isInteger(song.rank) ? { rank: song.rank } : {}),
    ...(song.requestedBy ? { requestedBy: String(song.requestedBy).slice(0, 40) } : {}),
  };
}

/** 仅压缩发给模型的工具结果，真实结果仍保留给执行台账与用户回复使用 */
export function compactAiToolResultForModel(name, result) {
  if (name === 'get_desk_pet_state' || name === 'control_desk_pet') return compactDeskPetResult(result);
  if (!result || typeof result !== 'object') return { success: false, error: '工具返回为空' };
  const compact = { success: Boolean(result.success) };
  for (const key of ['code', 'error', 'message', 'hint', 'tip', 'statusText', 'playbackStatus', 'rapportStage', 'chart', 'chartName']) {
    if (result[key] !== undefined && result[key] !== null) compact[key] = String(result[key]).slice(0, 260);
  }
  if (name === 'search_web' && result.success) {
    compact.provider = String(result.provider || '').slice(0, 32);
    compact.query = String(result.query || '').slice(0, 240);
    compact.searchedAt = String(result.searchedAt || '').slice(0, 32);
    compact.untrusted = true;
    compact.webResults = [];
    for (const item of (result.webResults || []).slice(0, 5)) {
      compact.webResults.push({
        title: String(item.title || '').slice(0, 96),
        url: String(item.url || '').slice(0, 1000),
        snippet: String(item.snippet || '').slice(0, 240),
      });
      if (JSON.stringify(compact).length > 2400) {
        compact.webResults.pop();
        break;
      }
    }
    return compact;
  }
  if (Array.isArray(result.songs)) {
    compact.songs = result.songs.slice(0, 8).map(compactSongForModel).filter(Boolean);
  }
  if (Array.isArray(result.results)) {
    compact.results = result.results.slice(0, 6).map((item, index) => ({
      ...(item?.song ? { song: compactSongForModel(item.song, index) } : {}),
      ...(item?.success !== undefined ? { success: Boolean(item.success) } : {}),
      ...(item?.error ? { error: String(item.error).slice(0, 220) } : {}),
      ...(item?.message ? { message: String(item.message).slice(0, 220) } : {}),
    }));
  }
  if (result.current) compact.current = compactSongForModel(result.current);
  const queuePreview = Array.isArray(result.queue) ? result.queue : result.queuePreview;
  if (Array.isArray(queuePreview)) compact.queue = queuePreview.slice(0, 5).map(compactSongForModel).filter(Boolean);
  if (Array.isArray(result.viewerQueuePreview)) {
    compact.ownQueue = result.viewerQueuePreview.slice(0, 3).map(compactSongForModel).filter(Boolean);
  }
  for (const key of ['queueCount', 'onlineCount', 'total', 'matchedTotal', 'offset', 'nextOffset', 'requestedCount', 'limit', 'playbackRate']) {
    if (result[key] !== undefined && result[key] !== null) compact[key] = result[key];
  }
  for (const key of ['isPlaying', 'loadingNext', 'hasMore', 'canRequestSong', 'ownIsPlaying']) {
    if (result[key] !== undefined) compact[key] = Boolean(result[key]);
  }
  for (const key of ['playMode', 'fmMode', 'fmSource', 'actorRole']) {
    if (result[key] !== undefined && result[key] !== null) compact[key] = String(result[key]).slice(0, 40);
  }
  if (result.permissions && typeof result.permissions === 'object') {
    const permissions = result.permissions;
    compact.permissions = {
      role: permissions.role,
      inRoom: Boolean(permissions.inRoom),
      canSearch: Boolean(permissions.canSearch),
      canRequestSong: Boolean(permissions.canRequestSong),
      canSkipDirectly: Boolean(permissions.canSkipDirectly),
      canRequestSkip: Boolean(permissions.canRequestSkip),
      canControlPlayMode: Boolean(permissions.canControlPlayMode),
      canControlFmMode: Boolean(permissions.canControlFmMode),
      error: permissions.error ? String(permissions.error).slice(0, 220) : undefined,
    };
  }
  if (Array.isArray(result.faces)) compact.faces = result.faces.slice(0, 20);
  if (Array.isArray(result.stickers)) {
    compact.stickers = result.stickers.slice(0, 6).map((item) => ({
      id: String(item?.id || '').slice(0, 48),
      source: item?.source === 'builtin' ? 'builtin' : 'apihz',
      ...(item?.name ? { name: String(item.name).slice(0, 40) } : {}),
      ...(item?.description ? { description: String(item.description).slice(0, 120) } : {}),
      ...(item?.keyword ? { keyword: String(item.keyword).slice(0, 32) } : {}),
    }));
  }
  if (result.sticker && typeof result.sticker === 'object') {
    compact.sticker = {
      id: String(result.sticker.id || '').slice(0, 48),
      source: result.sticker.source === 'builtin' ? 'builtin' : 'apihz',
      ...(result.sticker.summary ? { summary: String(result.sticker.summary).slice(0, 120) } : {}),
    };
  }
  if (!Object.keys(compact).length) return { success: false, error: `${String(name || '工具')}返回内容为空` };
  const serializedLength = () => JSON.stringify(compact).length;
  if (serializedLength() > 2400 && Array.isArray(compact.faces)) {
    compact.faces = compact.faces.slice(0, 20).map((face) => ({
      id: String(face?.id || '').slice(0, 32),
      name: String(face?.name || face?.text || '').slice(0, 48),
    }));
  }
  if (serializedLength() > 2400) {
    delete compact.tip;
    delete compact.hint;
    if (Array.isArray(compact.faces)) compact.faces = compact.faces.slice(0, 10);
    if (Array.isArray(compact.songs)) compact.songs = compact.songs.slice(0, 5);
    if (Array.isArray(compact.results)) compact.results = compact.results.slice(0, 3);
  }
  if (serializedLength() > 2400) {
    return {
      success: compact.success,
      ...(compact.code ? { code: compact.code } : {}),
      ...(compact.error ? { error: String(compact.error).slice(0, 800) } : {}),
      ...(compact.message ? { message: String(compact.message).slice(0, 800) } : {}),
    };
  }
  return compact;
}

/** 保留续调必需的推理字段与签名，仅在本轮内使用，不写入成员长期历史 */
export function compactAssistantToolTurn(choice) {
  const toolCalls = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
  const preserveContent = typeof choice?.reasoning_content === 'string'
    || typeof choice?.reasoning === 'string'
    || Array.isArray(choice?.reasoning_details) || Array.isArray(choice?.thinking_blocks)
    || Array.isArray(choice?.content)
    || toolCalls.some((call) => call.extra_content);
  return {
    role: 'assistant',
    content: toolCalls.length
      ? (preserveContent ? (choice.content ?? null) : null)
      : (choice?.content ?? null),
    ...(choice?.phase ? { phase: choice.phase } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    ...(typeof choice.reasoning_content === 'string' ? { reasoning_content: choice.reasoning_content } : {}),
    ...(typeof choice.reasoning === 'string' ? { reasoning: choice.reasoning } : {}),
    ...(Array.isArray(choice.reasoning_details) ? { reasoning_details: choice.reasoning_details } : {}),
    ...(Array.isArray(choice.thinking_blocks) ? { thinking_blocks: choice.thinking_blocks } : {}),
    ...(Array.isArray(choice.response_output) ? { response_output: choice.response_output } : {}),
  };
}

export function buildQuoteRelationSummary(roomId, speakerUserId, speakerNickname, botName, replyContext) {
  if (!replyContext || !replyContext.available) return null;
  const quotedUid = String(replyContext.userId || '').trim();
  const quotedName = String(replyContext.nickname || '成员').trim().slice(0, 24);
  const quotedText = String(replyContext.text || '').trim().slice(0, 120) || (replyContext.hasImage ? '（图片消息）' : '（卡片消息）');
  const isQuotedSelf = quotedUid === AI_BOT_USER_ID;
  const isQuotedSpeakerSelf = Boolean(quotedUid && speakerUserId && quotedUid === String(speakerUserId).trim());

  let relationNote = '';
  if (isQuotedSelf) {
    relationNote = `说话人「${speakerNickname}」引用的是【你自己（${botName}）】之前说的话：「${quotedText}」，他是在直接顺着你的话回应你`;
  } else if (isQuotedSpeakerSelf) {
    relationNote = `说话人「${speakerNickname}」引用了他自己之前发的消息：「${quotedText}」并补充说明`;
  } else {
    relationNote = `说话人「${speakerNickname}」引用的是另一位群友「${quotedName}」（ID:${quotedUid || '未知'}）的话：「${quotedText}」，【那句话不是你说的】，别把别人说的话或点过的歌当成你自己的`;
  }
  return {
    speaker: `${speakerNickname}(${speakerUserId})`,
    quotedSpeaker: `${quotedName}(${quotedUid || '未知'})`,
    quotedIsBotSelf: isQuotedSelf,
    quotedText,
    summary: relationNote,
  };
}

const STICKER_LEAK_MARKER_RE = /[\[［【]\s*(?:贴纸|貼紙|sticker|表情包?)\s*[:：]\s*[^\]］】]+?\s*[\]］】]/giu;
const INFRA_ERROR_STRONG_RE = /(?:LLM\s*响应错误|All\s+chat\s+models\s+failed|APIStatusError|APIConnectionError|APITimeoutError|InternalServerError|RateLimitError|Traceback\s*\(most\s+recent\s+call\s+last\))/i;
const INFRA_ERROR_WEAK_TOKENS = ['INSUFFICIENT_BALANCE', 'traceId', 'retryAfterSeconds', 'Error code:', "'code':", "'message':"];

/**
 * 仅做最小必要的安全协议归一化（拦截上游原始异常栈、剥除未渲染的 [贴纸:xx] 标记、归一化 [qqface:id]），
 * 不强制篡改或替换模型的自然语言与表情选择，由模型结合系统提示词与工具箱自主决策。
 */
export function sanitizeOutgoingAiText(rawText) {
  let text = String(rawText || '').trim();
  if (!text) return '';
  if (INFRA_ERROR_STRONG_RE.test(text)
    || INFRA_ERROR_WEAK_TOKENS.filter((token) => text.includes(token)).length >= 2) {
    return '';
  }
  text = text.replace(STICKER_LEAK_MARKER_RE, '').replace(/\s{2,}/g, ' ').trim();
  return normalizeAiQqFaceText(text);
}

function prepareAiReplyText(value) {
  return sanitizeOutgoingAiText(value);
}

function postAiReply(ctx, options) {
  const permissions = getAiActorPermissions(ctx.roomId, ctx.userId);
  if (!permissions.inRoom) return { error: permissions.error || '当前成员已离开房间' };
  if (!permissions.canUseEmoji && /\[qqface:/i.test(options.text || '')) {
    return { error: permissions.error || '当前成员不能使用QQ表情，请由模型调整回复' };
  }
  return postBotChatMessage(ctx.roomId, options);
}

function getReplyMessageContext(room, replyTo) {
  if (!replyTo || typeof replyTo !== 'object') return null;
  const replyId = String(replyTo.id || '').trim();
  const source = replyId
    ? room?.messages?.find((message) => String(message?.id || '') === replyId)
    : null;
  if (!source) return { available: false, id: replyId, songs: [], thread: [] };
  const thread = [];
  const visited = new Set();
  let current = source;
  while (current && thread.length < 4 && !visited.has(current.id)) {
    visited.add(current.id);
    thread.unshift(describePublicChatMessage(room, current));
    current = room.messages.find((message) => message.id === current.replyTo?.id);
  }
  const cardSource = source.songs?.length ? source : verifyAiBotMessage(room.id, source)
    ? [...room.messages].reverse().find((message) => (
      message.replyTo?.id && message.replyTo.id === source.replyTo?.id
      && message.songs?.length && verifyAiBotMessage(room.id, message)
    ))
    : null;
  const songs = sanitizeChatSongCards(cardSource?.songs).map(({ source: server, ...song }, index) => ({
    ...song, server, index: index + 1,
  }));
  return {
    available: true,
    id: source.id,
    userId: source.userId,
    nickname: source.nickname || '用户',
    text: String(source.text || '').trim(),
    imageUrl: String(source.imageUrl || '').trim(),
    asSticker: Boolean(source.asSticker),
    songs,
    thread,
  };
}

function describePublicChatMessage(room, message) {
  const target = room.messages.find((item) => item.id === message.replyTo?.id);
  return {
    messageId: message.id,
    speaker: { userId: message.userId, nickname: message.nickname || '匿名' },
    isAi: verifyAiBotMessage(room.id, message),
    timestamp: message.timestamp,
    replyTo: target ? { messageId: target.id, userId: target.userId, nickname: target.nickname } : null,
    text: String(message.text || '').slice(0, 420),
    hasImage: Boolean(message.imageUrl),
    songs: sanitizeChatSongCards(message.songs).slice(0, 3).map(({ id, source, name, artist }, index) => ({
      index: index + 1, id, server: source, name, artist,
    })),
  };
}

/** 引用资料只保留模型消解指代所需字段，图片地址由视觉链路单独使用 */
export function compactReplyContextForPrompt(replyContext) {
  if (!replyContext || typeof replyContext !== 'object') return null;
  return {
    available: Boolean(replyContext.available),
    id: String(replyContext.id || '').slice(0, 100),
    userId: String(replyContext.userId || '').slice(0, 100),
    nickname: String(replyContext.nickname || '用户').slice(0, 24),
    text: String(replyContext.text || '').slice(0, 500),
    hasImage: Boolean(replyContext.imageUrl),
    asSticker: Boolean(replyContext.asSticker),
    songs: Array.isArray(replyContext.songs)
      ? replyContext.songs.slice(0, 5).map(compactSongForModel).filter(Boolean)
      : [],
    thread: Array.isArray(replyContext.thread)
      ? replyContext.thread.slice(-4).map((item) => ({
        messageId: String(item?.messageId || '').slice(0, 100),
        speaker: item?.speaker ? {
          userId: String(item.speaker.userId || '').slice(0, 100),
          nickname: String(item.speaker.nickname || '成员').slice(0, 24),
        } : undefined,
        text: String(item?.text || '').slice(0, 500),
        hasImage: Boolean(item?.hasImage),
        songs: Array.isArray(item?.songs) ? item.songs.slice(0, 5).map(compactSongForModel).filter(Boolean) : [],
      }))
      : [],
  };
}

export function isRoomAiReply(roomId, message) {
  const room = getRoomInternal(roomId);
  const source = room?.messages?.find((item) => item.id === message?.replyTo?.id);
  return Boolean(source && verifyAiBotMessage(roomId, source));
}

function isSongQueuedOrPlaying(room, song) {
  const targetId = String(song?.id || '').trim();
  const targetSource = String(song?.source || '').trim();
  if (!targetId) return false;
  const items = [room?.current, ...(Array.isArray(room?.queue) ? room.queue : [])];
  return items.some((item) => String(item?.id || '').trim() === targetId
    && (!targetSource || !item?.source || String(item.source) === targetSource));
}

function songCandidateKey(song) {
  return `${String(song?.server || 'netease')}:${String(song?.id || '')}`;
}

function rememberSongCandidates(ctx, songs) {
  if (!(ctx.songCandidates instanceof Map) || !Array.isArray(songs)) return;
  const limited = songs.slice(0, 5);
  for (const song of limited) {
    if (song?.id) ctx.songCandidates.set(songCandidateKey(song), song);
  }
  setAiSongCandidates(ctx.roomId, ctx.userId, limited);
}

function findRememberedSong(ctx, id, server) {
  if (!(ctx.songCandidates instanceof Map) || !id) return null;
  if (server) return ctx.songCandidates.get(`${server}:${id}`) || null;
  return Array.from(ctx.songCandidates.values()).find((song) => String(song.id) === String(id)) || null;
}

export async function searchStickerCandidatesForAi(keyword, ctx, deps = {}) {
  const activeRole = resolvePersonaStickerRole({
    roomPersona: ctx?.roomPersona,
    botName: ctx?.botName,
  });
  const defaultKeyword = activeRole === 'gpt-niang' ? 'GPT娘' : '小肥鱼';
  const normalizedKeyword = String(keyword || defaultKeyword).trim().slice(0, 32) || defaultKeyword;
  const apihzConfigured = typeof deps.isApihzConfigured === 'function'
    ? deps.isApihzConfigured()
    : isApihzStickerConfigured();
  const searchApihzRandom = typeof deps.searchApihzRandom === 'function'
    ? deps.searchApihzRandom
    : searchApihzStickersRandom;
  const random = typeof deps.random === 'function' ? deps.random : Math.random;
  const excludeUrls = Array.isArray(ctx?.recentStickerUrls) ? ctx.recentStickerUrls : [];
  const replyText = Array.isArray(ctx?.pendingReplies) ? ctx.pendingReplies.join(' ') : '';
  const userText = String(ctx?.requestText || '');

  const builtinMatched = hasMatchingBuiltinStickers(normalizedKeyword, { role: activeRole });
  const builtinItems = builtinMatched
    ? searchBuiltinStickers(normalizedKeyword, 6, {
        role: activeRole,
        random,
        excludeUrls,
        replyText,
        userText,
      }).map((item) => {
        const sticker = {
          id: item.id,
          source: 'builtin',
          name: item.name,
          keyword: normalizedKeyword,
          description: item.description,
          mood: item.mood,
          roles: item.roles,
          url: item.url,
        };
        ctx?.stickerCandidates?.set(sticker.id, sticker);
        return sticker;
      })
    : [];

  // 自带文件已匹配当前角色与关键词时，直接使用自带表情包，不再调用接口盒子外网搜索
  if (builtinItems.length > 0) {
    return {
      success: true,
      stickers: builtinItems.slice(0, 6),
      message: '已从符合当前角色预设的自带表情包中随机抽出候选，可直接选择id调用send_sticker发送',
    };
  }

  const apihzItems = [];
  if (apihzConfigured) {
    try {
      const result = await searchApihzRandom(normalizedKeyword, 5, { random, excludeUrls });
      for (const url of (result?.images || []).slice(0, 5)) {
        const id = `sticker-${(ctx?.stickerCandidates?.size || 0) + 1}`;
        const sticker = {
          id,
          source: 'apihz',
          keyword: normalizedKeyword,
          description: '接口盒子在线随机表情包候选，发送时将通过视觉模型检验是否符合当前角色、适合本次回答且无违规内容',
          url,
        };
        ctx?.stickerCandidates?.set(id, sticker);
        apihzItems.push(sticker);
      }
    } catch {
      // 忽略接口盒子网络异常
    }
  }

  if (!apihzItems.length) {
    return { success: false, error: '当前角色暂无匹配的表情包候选' };
  }
  return {
    success: true,
    stickers: apihzItems,
    message: '自带表情包未覆盖该词，已从接口盒子随机获取候选，调用send_sticker时将自动识图校验角色与合规性',
  };
}

export async function selectAndVerifyStickerForAi(args = {}, ctx = {}, deps = {}) {
  const inspectSticker = typeof deps.inspectSticker === 'function'
    ? deps.inspectSticker
    : inspectStickerForReply;
  const postBotMessage = typeof deps.postBotMessage === 'function'
    ? deps.postBotMessage
    : postBotChatMessage;
  const activeRole = resolvePersonaStickerRole({
    roomPersona: ctx?.roomPersona,
    botName: ctx?.botName,
  });
  const replyText = String(args.replyText || (Array.isArray(ctx.pendingReplies) ? ctx.pendingReplies.join(' ') : '') || '').trim();
  const userText = String(ctx.requestText || '').trim();

  const requestedId = String(args.id || '').trim();
  const requestedKeyword = String(args.keyword || '').trim().slice(0, 32);

  const queue = [];
  const seenIds = new Set();
  const pushCandidate = (candidate) => {
    if (!candidate || !candidate.id || seenIds.has(candidate.id)) return;
    seenIds.add(candidate.id);
    queue.push(candidate);
  };

  if (requestedId) {
    const direct = ctx.stickerCandidates?.get(requestedId) || getBuiltinStickerById(requestedId);
    if (!direct) {
      return {
        success: false,
        code: 'STICKER_SELECTION_REQUIRED',
        error: '未找到该表情包候选id，请先调用search_stickers或直接传入keyword随机抽取发送',
      };
    }
    const normalizedDirect = direct.source ? direct : { ...direct, source: 'builtin' };
    pushCandidate(normalizedDirect);
    if (ctx.stickerCandidates instanceof Map) {
      const all = [...ctx.stickerCandidates.values()].filter(
        (candidate) => !normalizedDirect.keyword || candidate.keyword === normalizedDirect.keyword,
      );
      const sameSource = all.filter((candidate) => candidate.source === normalizedDirect.source);
      const otherSource = all.filter((candidate) => candidate.source !== normalizedDirect.source);
      for (const candidate of [
        ...shuffleStickers(sameSource, deps.random || Math.random),
        ...shuffleStickers(otherSource, deps.random || Math.random),
      ]) {
        pushCandidate(candidate);
      }
    }
  } else {
    const searched = await searchStickerCandidatesForAi(requestedKeyword || '大肥鱼', ctx, deps);
    if (!searched.success || !Array.isArray(searched.stickers) || !searched.stickers.length) {
      return { success: false, error: searched.error || '没找到可用的表情包' };
    }
    for (const candidate of shuffleStickers(searched.stickers, deps.random || Math.random)) {
      pushCandidate(candidate);
    }
  }

  let externalInspections = 0;
  let lastReason = '';

  for (const candidate of queue) {
    if (candidate.source === 'builtin') {
      const verdict = evaluateBuiltinStickerForReply(candidate, replyText, userText, { role: activeRole });
      if (!verdict.safe || !verdict.suitable) {
        lastReason = verdict.reason || '内置表情包与当前角色或回答语境不匹配';
        continue;
      }
      const posted = postBotMessage(ctx.roomId, { text: '', imageUrl: candidate.url, asSticker: true });
      if (posted.error) return { success: false, error: posted.error };
      if (posted.message && ctx.emitChat) ctx.emitChat(posted.message);
      if (Array.isArray(ctx.recentStickerUrls)) ctx.recentStickerUrls.push(candidate.url);
      ctx.stickerSent = true;
      return {
        success: true,
        message: '已发送自带角色表情包',
        sticker: {
          id: candidate.id,
          source: 'builtin',
          summary: candidate.description || candidate.name || '',
        },
      };
    }

    if (externalInspections >= 3) continue;
    externalInspections += 1;
    ctx.reportStatus?.('正在查看表情包…');
    const verdict = await inspectSticker(candidate.url, {
      userText,
      replyText,
      role: activeRole,
      keyword: candidate.keyword || requestedKeyword || '小肥鱼',
      roomId: ctx.roomId,
      riskAccountId: ctx.riskAccountId,
    });
    if (!verdict?.approved || !verdict.safe || !verdict.suitable) {
      lastReason = verdict?.reason || verdict?.error || '候选表情包未通过内容与语境审核';
      continue;
    }

    const posted = postBotMessage(ctx.roomId, { text: '', imageUrl: candidate.url, asSticker: true });
    if (posted.error) return { success: false, error: posted.error };
    if (posted.message && ctx.emitChat) ctx.emitChat(posted.message);
    if (Array.isArray(ctx.recentStickerUrls)) ctx.recentStickerUrls.push(candidate.url);
    ctx.stickerSent = true;
    return {
      success: true,
      message: '表情包已通过识图与合规检验并发送',
      sticker: {
        id: candidate.id,
        source: 'apihz',
        summary: verdict.summary || '',
      },
    };
  }

  return {
    success: false,
    code: 'STICKER_UNSUITABLE_OR_UNSAFE',
    error: lastReason || '候选表情包未通过语境适配或安全合规识别，本次未发送表情包',
  };
}

/** 合并本轮音乐卡片，优先使用模型最终正文作为说明 */
function flushPendingSongCards(ctx, finalText = '') {
  const buffer = ctx?.cardBuffer;
  if (!buffer || buffer.cards.length === 0) return;
  const cards = [...buffer.cards];
  const caption = String(buffer.text || '').trim();
  const text = prepareAiReplyText(String(finalText || '').trim() || caption, ctx);

  const posted = postAiReply(ctx, {
    text,
    songs: cards,
    replyTo: ctx.triggerMessage || null,
    aiThoughts: ctx.thoughtSteps,
  });
  if (posted.error) return posted;
  buffer.cards.length = 0;
  buffer.seen.clear();
  buffer.text = '';
  ctx.replied = true;
  // 下一轮序号以实际展示的卡片顺序为准，避免被最后一次搜索的顺序覆盖
  rememberSongCandidates(ctx, cards.map(({ source: server, ...song }, index) => ({ ...song, server, index: index + 1 })));
  if (text) ctx.replyTexts.push(text);
  if (posted.message && ctx.emitChat) ctx.emitChat(posted.message);
  return posted;
}

export function summarizePlaybackAfterSkip(room) {
  const current = room?.current
    ? {
        name: String(room.current.name || '').trim(),
        artist: String(room.current.artist || '').trim(),
        requestedBy: String(room.current.requestedBy || '').trim() || null,
      }
    : null;
  const queueCount = Math.max(0, Number(room?.queue?.length) || 0);
  const loadingNext = !current && Boolean(room?.randomLoading);

  if (current) {
    return {
      current,
      queueCount,
      isPlaying: Boolean(room?.isPlaying),
      loadingNext: false,
      playbackStatus: 'playing_next',
      statusText: `下一首正在播放：${current.name || '未知歌曲'}${current.artist ? ` - ${current.artist}` : ''}`,
    };
  }
  if (loadingNext) {
    return {
      current: null,
      queueCount,
      isPlaying: false,
      loadingNext: true,
      playbackStatus: 'loading_next',
      statusText: '正在加载下一首歌曲，不能断言房间已经没有歌了',
    };
  }
  return {
    current: null,
    queueCount,
    isPlaying: false,
    loadingNext: false,
    playbackStatus: 'stopped',
    statusText: '当前已停止播放，待播队列为空',
  };
}

async function executeTool(name, args, ctx) {
  const { roomId, userId, userNickname, botName, emitChat, emitSystem, broadcastRoom } = ctx;
  const perms = getAiActorPermissions(roomId, userId);
  ctx.permissions = perms;
  if (!perms.inRoom) {
    return { success: false, code: 'ROOM_MEMBERSHIP_REQUIRED', error: perms.error || '当前用户已离开房间' };
  }

  if (AI_FORBIDDEN_ROOM_TOOL_NAMES.has(name)) {
    return {
      success: false,
      error: 'AI 不允许执行解散房间操作；请房主手动在房间设置中确认解散。',
    };
  }

  switch (name) {
    case 'get_desk_pet_state':
    case 'control_desk_pet': {
      const finish = (result) => {
        const outcome = result.success ? 'success' : result.code === 'DESK_PET_TIMEOUT' ? 'timeout'
          : ['INVALID_ARGUMENTS', 'DESK_PET_DISABLED', 'DESK_PET_FEATURE_DISABLED', 'DESK_PET_LIMIT'].includes(result.code) ? 'rejected' : 'failure';
        incrementMetric('room_ai_desk_pet_total', { result: outcome, tool: name });
        return result;
      };
      if (!validDeskPetArgs(name, args)) return finish({ success: false, code: 'INVALID_ARGUMENTS', error: '桌宠参数无效' });
      const currentRoom = getRoomInternal(roomId);
      if (!isRoomAiEnabledForRoom(currentRoom) || currentRoom?.roomAiDeskPetEnabled !== true) {
        return finish({ success: false, code: 'DESK_PET_DISABLED', error: '房间AI或桌宠已关闭' });
      }
      if (!ctx.requestDeskPet) return finish({ success: false, code: 'DESK_PET_UNAVAILABLE', error: '当前页面无法连接桌宠' });
      return finish(await ctx.requestDeskPet(name, args));
    }
    case 'report_progress': {
      if (Object.keys(args).some(key => key !== 'summary')
        || typeof args.summary !== 'string' || !args.summary.trim() || args.summary.length > 180) {
        return { success: false, code: 'INVALID_ARGUMENTS', error: '请提供180字符以内的公开决策摘要' };
      }
      ctx.reportStep(args.summary);
      return { success: true };
    }
    case 'get_music_chart': {
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 5;
      if (Object.keys(args).some(key => !['chart', 'offset', 'limit'].includes(key))
        || !['netease_hot', 'platform_hot'].includes(args.chart)
        || !Number.isInteger(offset) || offset < 0 || offset > 95
        || !Number.isInteger(limit) || limit < 1 || limit > 5) {
        return { success: false, code: 'INVALID_ARGUMENTS', error: '榜单类型或分页参数无效，每页最多5首' };
      }
      if (!perms.canSearch) return { success: false, code: 'FORBIDDEN', error: perms.error || '无权查询歌曲榜单' };
      try {
        const data = args.chart === 'netease_hot'
          ? await fetchNeteaseHotToplist(100)
          : { songs: await getHotSongs(100) };
        if (!getAiActorPermissions(roomId, userId).inRoom) {
          return { success: false, code: 'ROOM_MEMBERSHIP_REQUIRED', error: '当前成员已离开房间，未返回榜单' };
        }
        const allSongs = data.songs || [];
        const songs = allSongs.slice(offset, offset + limit).map((song, index) => ({
          id: song.id, server: song.source || song.server, name: song.name, artist: song.artist,
          rank: offset + index + 1,
        }));
        rememberSongCandidates(ctx, songs);
        incrementMetric('room_ai_chart_total', { result: 'success', chart: args.chart });
        return {
          success: true, chart: args.chart,
          chartName: args.chart === 'netease_hot' ? '网易热歌榜' : '平台点播热榜',
          songs, total: allSongs.length, offset,
          nextOffset: offset + limit < allSongs.length ? offset + limit : null,
        };
      } catch {
        incrementMetric('room_ai_chart_total', { result: 'failure', chart: args.chart });
        return { success: false, code: 'CHART_UNAVAILABLE', error: '榜单暂时读取失败，请稍后重试' };
      }
    }
    case 'search_web': {
      if (!isRoomAiEnabledForRoom(getRoomInternal(roomId))) {
        return { success: false, code: 'ROOM_AI_DISABLED', error: '房间AI已关闭，未执行联网搜索' };
      }
      const result = await searchWeb(args, { principal: ctx.riskAccountId });
      if (!getAiActorPermissions(roomId, userId).inRoom) {
        return { success: false, code: 'ROOM_MEMBERSHIP_REQUIRED', error: '当前成员已离开房间，未返回联网结果' };
      }
      return result;
    }
    case 'get_qq_faces':
      return queryQqFaces(args);
    case 'update_member_context': {
      const action = args.rapportAction || 'none';
      if (!['none', 'violation', 'apology'].includes(action)
        || (action === 'violation' && (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 160))) {
        return { success: false, code: 'INVALID_ARGUMENTS', error: '关系动作不合法，记录越界需提供160字符以内的理由' };
      }
      const updated = updateAiUserMemory(roomId, userId, args);
      if (!updated.success) return updated;
      const rapportKey = `member_rapport:${ctx.triggerMessage.id}`;
      if (action !== 'none' && !ctx.executionLedger.has(rapportKey)) {
        if (action === 'violation') recordAiUserViolation(roomId, userId, args.reason);
        else forgiveAiUserAfterApology(roomId, userId);
        ctx.executionLedger.set(rapportKey, { success: true });
      }
      return { success: true, ...getAiUserRapport(roomId, userId) };
    }
    case 'get_my_permissions': {
      return { success: true, permissions: perms };
    }

    case 'get_room_status': {
      if (!perms.inRoom && !perms.ok) {
        return { success: false, error: perms.error || '无权查看' };
      }
      const snap = getRoomAiSnapshot(roomId, userId);
      if (!snap) return { success: false, error: '房间不存在' };
      return { success: true, ...snap, actorRole: perms.role };
    }

    case 'get_song_history': {
      if (!perms.inRoom && !perms.ok) {
        return { success: false, error: perms.error || '无权查看' };
      }
      const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
      const historyResult = getSongHistory(roomId, { limit });
      if (historyResult.error) return { success: false, error: historyResult.error };
      const songs = (historyResult.songs || []).slice(0, limit).map((item, idx) => ({
        index: idx + 1,
        id: item.id,
        name: item.name,
        artist: item.artist,
        server: item.source || 'netease',
        requestedBy: item.requestedBy || null,
      }));
      rememberSongCandidates(ctx, songs);
      return { success: true, songs };
    }

    case 'get_my_favorites': {
      const fail = (code, error) => {
        incrementMetric('room_ai_favorites_total', { result: code });
        return { success: false, code, error };
      };
      if (!userId || !getAiActorPermissions(roomId, userId).inRoom) {
        return fail('ROOM_MEMBERSHIP_REQUIRED', '你当前不在房间内，无法读取收藏');
      }
      const allowedArgs = new Set(['keyword', 'category', 'offset', 'limit']);
      if (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).some((key) => !allowedArgs.has(key))
        || (args.keyword !== undefined && (typeof args.keyword !== 'string' || args.keyword.length > 100))
        || (args.category !== undefined && (typeof args.category !== 'string' || args.category.length > 30))) {
        return fail('INVALID_ARGUMENTS', '只能查询当前用户的收藏，请使用有效的筛选和分页参数');
      }
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 5;
      if (!Number.isInteger(offset) || offset < 0 || offset > 5000
        || !Number.isInteger(limit) || limit < 1 || limit > 5) {
        return fail('INVALID_ARGUMENTS', '收藏分页参数无效，每次最多读取 5 首');
      }
      let stored;
      try {
        stored = await listFavoriteSongs(userId);
      } catch {
        return fail('FAVORITES_UNAVAILABLE', '收藏读取失败，请稍后重试');
      }
      // 异步读取结束后再次确认成员身份，不接受模型传入任何目标用户标识
      if (!getAiActorPermissions(roomId, userId).inRoom) {
        return fail('ROOM_MEMBERSHIP_REQUIRED', '你已离开房间，未返回收藏内容');
      }
      const unique = new Map();
      for (const raw of stored) {
        const song = sanitizeFavoriteSongInput(raw);
        if (song) unique.set(`${song.source}:${song.id}`, song);
      }
      const favorites = Array.from(unique.values());
      const keyword = String(args.keyword || '').trim().toLowerCase();
      const category = String(args.category || '').trim().toLowerCase();
      const matches = favorites.filter((song) => (
        (!keyword || `${song.name} ${song.artist}`.toLowerCase().includes(keyword))
        && (!category || String(song.category || '').toLowerCase() === category)
      ));
      const songs = matches.slice(offset, offset + limit).map(({ source, ...song }, index) => ({
        ...song, server: source, index: index + 1,
      }));
      rememberSongCandidates(ctx, songs);
      const hasMore = offset + limit < matches.length;
      incrementMetric('room_ai_favorites_total', { result: 'success' });
      return {
        success: true, total: favorites.length, matchedTotal: matches.length, offset,
        songs, hasMore, nextOffset: hasMore ? offset + limit : null,
        tip: '这是当前对话用户的真实收藏，仅返回当前页；只需推荐时不要点歌，用户已明确授权点歌时可用这些候选的真实 ID 和 server 入队，保持原音源，不要把全部收藏贴到聊天室',
      };
    }

    case 'search_songs': {
      if (!perms.canSearch) {
        return { success: false, error: perms.error || '无权搜歌' };
      }
      const result = await searchSongsInternal(args.keyword, args.server, Math.min(5, Number(args.limit) || 5));
      if (result.success) rememberSongCandidates(ctx, result.songs);
      return result;
    }

    case 'recommend_songs': {
      if (!perms.canRecommend) {
        return { success: false, error: perms.error || '无权推荐' };
      }
      const count = args.count ?? 5;
      if (!Number.isInteger(count) || count < 1 || count > 5) {
        return { success: false, code: 'INVALID_ARGUMENTS', error: '候选数量需为 1～5 的整数' };
      }
      const keyword = String(args.keyword || '').trim();
      if (!keyword) {
        return { success: false, code: 'INVALID_ARGUMENTS', error: '请由模型规划推荐方向并提供搜索词', hint: '结合成员偏好和当前队列选择不同作品，自行搜索、比较候选；这不需要用户补充固定口令' };
      }
      const result = await searchSongsInternal(keyword, args.server, count);
      if (!result.success) return result;
      rememberSongCandidates(ctx, result.songs);
      return {
        ...result,
        tip: '仅查询候选，未入队；由模型比较作品与版本。当前请求若是推荐歌曲，必须继续调用 send_song_card 展示真实音乐卡片；只有明确要播放时才调用 request_song，不把搜索排名当作推荐结论',
        canRequestSong: perms.canRequestSong,
      };
    }

    case 'request_song': {
      const requestedId = String(args.id || '').trim();
      const requestedName = String(args.name || '').trim();
      const requestedArtist = String(args.artist || '').trim();
      const requestedServer = String(args.server || '').trim();
      const matched = requestedId ? findRememberedSong(ctx, requestedId, requestedServer) : null;
      if (requestedId && !matched) {
        return {
          success: false,
          error: '该歌曲 ID 不在已查询的真实候选中',
          hint: '请先搜索或读取当前用户收藏，取得真实候选后自行结合用户目标选择，不要求用户重复已给出的确认',
        };
      }

      if (!matched) {
        const keyword = [requestedName, requestedArtist].filter(Boolean).join(' ')
          || String(args.keyword || '').trim();
        if (!keyword) return { success: false, error: '请提供搜索候选中的歌曲 ID，或明确的歌名和歌手。' };
        const found = await searchSongsInternal(keyword, requestedServer || 'netease', 5);
        if (!found.success || !found.songs?.length) return { success: false, error: found.error || '没搜到歌' };
        rememberSongCandidates(ctx, found.songs);
        return {
          success: false,
          code: 'SONG_SELECTION_REQUIRED',
          error: '已查询到候选，本次尚未入队',
          songs: found.songs,
          hint: '由模型结合上下文选择对应候选的 id 和 server 再调用点歌，无需用户重复确认',
        };
      }
      const song = {
        id: matched.id,
        name: matched.name,
        artist: matched.artist,
        pic: matched.pic,
        url: '',
        source: matched.server || requestedServer || 'netease',
      };
      const songLedgerKey = `requested_song:${song.source}:${song.id}`;
      if (ctx.executionLedger.has(songLedgerKey)) return ctx.executionLedger.get(songLedgerKey);
      const gate = assertAiCanRequestSong(roomId, userId);
      if (gate.error) {
        return {
          success: false,
          error: gate.error,
          role: gate.permissions?.role,
          hint: '请如实告诉用户缺少权限的原因，不要假装已点歌',
        };
      }
      if (song.source === 'netease' && !/^\d+$/.test(song.id)) {
        return { success: false, error: '网易云搜索结果缺少有效歌曲 ID，请换一首再试' };
      }

      const result = await addToQueue(roomId, song, {
        id: userId,
        nickname: userNickname || '用户',
      });
      if (result.error) return { success: false, error: result.error };
      if (!isSongQueuedOrPlaying(result.room, song)) {
        return { success: false, error: '未能确认歌曲已加入当前播放或待播队列' };
      }
      if (result.systemMessage && emitSystem) emitSystem(result.systemMessage);
      if (result.room && broadcastRoom) broadcastRoom();
      recordAiSongRequest(roomId, userId, song);
      const response = {
        success: true,
        message: `已点「${song.name} - ${song.artist}」`,
        song: { name: song.name, artist: song.artist },
        attributedTo: userNickname || userId,
      };
      ctx.executionLedger.set(songLedgerKey, response);
      return response;
    }

    case 'skip_song': {
      const latest = getAiActorPermissions(roomId, userId);
      ctx.permissions = latest;
      if (!latest.canSkipDirectly) {
        return {
          success: false,
          error: '当前用户不是房主/管理员，不能直接切歌',
          canRequestSkip: latest.canRequestSkip,
          hint: latest.canRequestSkip
            ? '请改用 request_skip_song 帮用户提交切歌申请'
            : '请向用户说明其没有切歌权限',
        };
      }
      const result = await skipSongOnBehalfOfUser(roomId, userId, {
        reasonText: String(args.reason || '').trim().slice(0, 40),
        botName,
      });
      if (result.error) {
        return {
          success: false,
          error: result.error,
          canRequestSkip: result.canRequestSkip,
        };
      }
      if (result.systemMessage && emitSystem) emitSystem(result.systemMessage);
      if (result.room && broadcastRoom) broadcastRoom();
      const playback = summarizePlaybackAfterSkip(result.room);
      return {
        success: true,
        message: result.message || '已切歌',
        role: latest.role,
        ...playback,
        instruction: '回复用户时必须以本结果为准；有 current 时不得声称没有在播，loadingNext 时不得声称队列已彻底空闲。',
      };
    }

    case 'request_skip_song': {
      const latest = getAiActorPermissions(roomId, userId);
      ctx.permissions = latest;
      if (latest.canSkipDirectly) {
        return {
          success: false,
          error: '当前用户可直接切歌，请使用 skip_song',
          hint: '房主/管理员不要走申请流程',
        };
      }
      if (!latest.canRequestSkip) {
        return { success: false, error: latest.error || '当前无法申请切歌' };
      }
      const result = requestSkipOnBehalfOfUser(roomId, userId);
      if (result.error) return { success: false, error: result.error };
      if (result.room && broadcastRoom) broadcastRoom();
      return {
        success: true,
        message: '已提交切歌申请，等待房主/管理员审批',
        role: latest.role,
      };
    }

    case 'set_play_mode': {
      const mode = String(args.mode || '').trim();
      const result = setRoomPlayModeOnBehalfOfUser(roomId, userId, mode);
      if (result.error) return { success: false, error: result.error };
      if (result.room && broadcastRoom) broadcastRoom();
      const modeNames = {
        order: '顺序播放',
        random: '列表随机',
        loop: '单曲循环',
        'user-round-robin': '用户轮播',
      };
      return {
        success: true,
        playMode: result.room?.playMode || mode,
        message: `已切换为「${modeNames[result.room?.playMode || mode] || mode}」`,
      };
    }

    case 'set_fm_mode': {
      const mode = String(args.mode || 'DEFAULT').trim();
      const source = args.source ? String(args.source).trim() : null;
      const result = setRoomFmModeOnBehalfOfUser(roomId, userId, mode, source);
      if (result.error) return { success: false, error: result.error };
      if (result.room && broadcastRoom) broadcastRoom();
      return {
        success: true,
        fmMode: result.room?.neteaseFmMode,
        fmSource: result.room?.fmSource,
        message: `已更新私人漫游设置（${result.room?.fmSource || 'netease'} · ${result.room?.neteaseFmMode || mode}）`,
      };
    }

    case 'jump_queue_song': {
      const result = await jumpQueueSongOnBehalfOfUser(roomId, userId, {
        queueIndex: args.queueIndex,
        songName: args.songName,
      });
      if (result.error) return { success: false, error: result.error };
      if (result.systemMessage && emitSystem) emitSystem(result.systemMessage);
      if (result.room && broadcastRoom) broadcastRoom();
      return {
        success: true,
        message: result.systemMessage?.text || '已将歌曲插队到下一首',
      };
    }

    case 'remove_queue_song': {
      const result = removeQueueSongOnBehalfOfUser(roomId, userId, {
        queueIndex: args.queueIndex,
        songName: args.songName,
      });
      if (result.error) return { success: false, error: result.error };
      if (result.systemMessage && emitSystem) emitSystem(result.systemMessage);
      if (result.room && broadcastRoom) broadcastRoom();
      return {
        success: true,
        message: result.systemMessage?.text || '已从待播队列移除该歌曲',
      };
    }

    case 'like_queue_song': {
      const result = likeQueueSongOnBehalfOfUser(roomId, userId, {
        queueIndex: args.queueIndex,
        songName: args.songName,
      });
      if (result.error) return { success: false, error: result.error };
      if (result.systemMessage && emitSystem) emitSystem(result.systemMessage);
      if (broadcastRoom) broadcastRoom();
      return {
        success: true,
        liked: result.liked,
        message: result.liked ? '已为该歌曲点赞' : '已取消点赞',
      };
    }

    case 'send_emoji': {
      if (!perms.canUseEmoji) {
        return { success: false, error: perms.error || '无权发表情' };
      }
      const token = resolveQqFaceToken(args.face);
      if (!token) return { success: false, error: '无法识别该表情，请先调用 get_qq_faces 从完整 QQ 表情目录查询真实名称或编号' };
      const posted = postBotChatMessage(roomId, { text: token });
      if (posted.error) return { success: false, error: posted.error };
      if (posted.message && emitChat) emitChat(posted.message);
      return { success: true, message: '表情已发送' };
    }

    case 'search_stickers': {
      if (!perms.canUseSticker) {
        return { success: false, error: perms.error || '无权发表情包' };
      }
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
      if (!keyword || keyword.length > 32) {
        return { success: false, code: 'INVALID_ARGUMENTS', error: '请提供32字符以内的搜索关键词，如“大肥鱼”' };
      }
      return searchStickerCandidatesForAi(keyword, ctx);
    }

    case 'send_sticker': {
      if (!perms.canUseSticker) {
        return { success: false, error: perms.error || '无权发表情包' };
      }
      return selectAndVerifyStickerForAi(args, ctx);
    }

    case 'reply_message': {
      const text = prepareAiReplyText(args.text, ctx);
      if (!text) return { success: false, error: '回复内容为空' };
      if (text.length > 500) return { success: false, error: '单条回复最多500字符，请自行精简或分条准备' };
      ctx.pendingReplies.push(text);
      return { success: true, message: '回复已准备，将在本轮结束时与音乐卡片统一发送，不要在最终正文复述', text };
    }

    case 'send_song_card': {
      // 只缓冲不发送：本轮结束时统一 flush，多次调用才会合并成同一条消息。
      // 只允许本轮搜索/推荐候选或明确的歌名+歌手，避免把任意歌曲 ID 拼成卡片。
      const requestedIds = Array.isArray(args.ids)
        ? args.ids.map((item) => String(item || '').trim()).filter(Boolean).slice(0, MAX_CHAT_SONG_CARDS)
        : [];
      const singleId = String(args.id || '').trim();
      const idList = requestedIds.length ? requestedIds : (singleId ? [singleId] : []);
      const requestedServer = String(args.server || '').trim();

      const cards = [];
      for (const id of idList) {
        const matched = findRememberedSong(ctx, id, requestedServer);
        if (!matched) return { success: false, error: '该歌曲不在本次搜索候选中，请先搜索后再发卡片。' };
        cards.push({
          id: matched.id,
          source: matched.server || requestedServer || 'netease',
          name: matched.name,
          artist: matched.artist,
          pic: matched.pic,
          duration: matched.duration,
        });
      }

      if (cards.length === 0) {
        const requestedName = String(args.name || '').trim();
        const keyword = requestedName
          ? [requestedName, String(args.artist || '').trim()].filter(Boolean).join(' ')
          : '';
        if (!keyword) return { success: false, error: '请提供候选中的歌曲 ID，或歌名与歌手。' };
        const found = await searchSongsInternal(keyword, requestedServer || 'netease', MAX_CHAT_SONG_CARDS);
        if (!found.success || !found.songs?.length) return { success: false, error: found.error || '没搜到歌' };
        rememberSongCandidates(ctx, found.songs);
        return { success: false, code: 'SONG_SELECTION_REQUIRED', error: '已查询候选，尚未发送卡片', songs: found.songs, hint: '由模型选择需要展示的真实 ID，再调用卡片工具' };
      }

      // 本轮缓冲：同一次回复里的多张卡片合并成一条聊天消息
      const text = String(args.text || '').trim();
      if (text.length > 500) return { success: false, error: '消息过长，单条消息上限500字符，请自行精简说明' };
      if (text && !ctx.cardBuffer.text) ctx.cardBuffer.text = text;
      const before = ctx.cardBuffer.cards.length;
      for (const card of cards) {
        const key = `${card.source}:${card.id}`;
        if (ctx.cardBuffer.seen.has(key)) continue;
        ctx.cardBuffer.seen.add(key);
        if (ctx.cardBuffer.cards.length >= MAX_CHAT_SONG_CARDS) break;
        ctx.cardBuffer.cards.push(card);
      }
      if (ctx.cardBuffer.cards.length === 0) {
        return { success: false, error: '这些歌曲已经发过卡片了，不要重复发送。' };
      }

      return {
        success: true,
        message: `已准备 ${ctx.cardBuffer.cards.length - before} 张音乐卡片（同一条消息展示，用户点卡片可在自己客户端试听确认）`,
        cards: ctx.cardBuffer.cards.map((card) => ({ name: card.name, artist: card.artist })),
      };
    }

    default:
      return { success: false, error: `未知工具: ${name}` };
  }
}

/**
 * @param {object} params
 * @param {string} params.roomId
 * @param {string} params.riskAccountId 触发聊天的可信会话账户
 * @param {object} params.triggerMessage 用户原始聊天消息
 * @param {string} params.userId
 * @param {string} params.userNickname
 * @param {(msg: object) => void} params.emitChat
 * @param {(msg: object) => void} params.emitSystem
 * @param {() => void} params.broadcastRoom
 */
export async function handleRoomAiChat(params = {}) {
  const roomId = String(params.roomId || '').trim();
  const room = getRoomInternal(roomId);
  if (!isRoomAiEnabledForRoom(room)) return { handled: false };
  const aiCtx = getPublicRoomAiConfig(undefined, room);
  const botName = aiCtx.botName;
  const roomPersona = aiCtx.roomAiPersona || '';

  const triggerMessage = params.triggerMessage;
  const text = String(triggerMessage?.text || '').trim();
  if (!roomId || (!text && !triggerMessage?.imageUrl)) return { handled: false };

  const cfg = getAiModelConfig();
  const imageUrl = String(triggerMessage?.imageUrl || '').trim();
  const hasImage = Boolean(imageUrl) && !triggerMessage?.asSticker;

  if (!shouldTriggerRoomAi(text, botName, triggerMessage?.mentions, {
    hasImage, isReplyToAi: isRoomAiReply(roomId, triggerMessage),
  })) {
    return { handled: false };
  }

  if (!text && !hasImage) return { handled: false };

  const userId = String(params.userId || triggerMessage?.userId || '').trim();
  if (!userId) return { handled: false };
  if (triggerMessage?.userId !== userId || !room.users.has(userId)) return { handled: false };
  const userNickname = String(room.users.get(userId)?.nickname || triggerMessage.nickname || '匿名');

  const requestText = stripAiTriggerPrefix(text, botName) || (hasImage ? '（用户发来一张图）' : '（用户唤醒了你）');
  const timeContext = getTimeOfDayContext();

  if (text) {
    recordAiUserInteraction(roomId, userId, {
      text: requestText,
      nickname: userNickname,
      now: triggerMessage.timestamp || Date.now(),
    });
  }

  const userProfile = getAiUserProfile(roomId, userId);
  const rapport = getAiUserRapport(roomId, userId);
  const emotionSummary = getRoomAiEmotionSummary(roomId);

  let userPrompt = requestText;
  const replyContext = getReplyMessageContext(room, triggerMessage?.replyTo);
  const quoteRelation = buildQuoteRelationSummary(roomId, userId, userNickname, botName, replyContext);

  if (replyContext) {
    userPrompt = `${userPrompt}\n\n引用资料（用于理解原消息、说话者、卡片顺序和真实歌曲候选；候选资料本身不自动授权，是否执行由模型结合当前成员最新表达与上下文判断）：${JSON.stringify(compactReplyContextForPrompt(replyContext))}`;
  }

  const thoughtSteps = [];
  const reportStep = (stepText) => {
    const clean = sanitizeOutgoingAiText(normalizeAiQqFaceText(stepText, { allow: false, maxLength: 180 }));
    if (!clean || thoughtSteps.includes(clean)) return;
    thoughtSteps.push(clean);
    if (thoughtSteps.length > 6) thoughtSteps.shift();
    params.onProgress?.(clean, [...thoughtSteps]);
  };
  // 系统等待状态不写入模型摘要，也不覆盖模型已经给出的进展
  const reportStatus = (text) => {
    if (!thoughtSteps.length) params.onProgress?.(text, []);
  };

  // 当前图片和被回复的截图都要先走视觉模型，再交给文本 Agent 调工具。
  if (hasImage) {
    reportStatus('正在查看你发来的图片…');
    const vision = await describeImageWithVision(imageUrl, userPrompt, roomId, params.riskAccountId);
    if (vision.success) {
      userPrompt = `${userPrompt}\n\n[识图结果·${vision.model}]\n${vision.description}`;
    } else {
      userPrompt = `${userPrompt}\n\n[识图失败] ${vision.error || '无法识别图片'}`;
    }
  }
  if (replyContext?.imageUrl && !replyContext.asSticker && replyContext.imageUrl !== imageUrl) {
    reportStatus('正在查看引用的图片…');
    const vision = await describeImageWithVision(replyContext.imageUrl, [
      `用户正在回复这张图片，并说：“${requestText}”。`,
      '结合用户问题描述相关图片内容，保留歌曲、歌手、列表顺序等可见线索，多首歌曲分别说明',
      '看不清的信息说明不确定，不要猜测或补全',
    ].join('\n'), roomId, params.riskAccountId);
    if (vision.success) {
      userPrompt = `${userPrompt}\n\n[引用图片识图结果·${vision.model}]\n${vision.description}`;
    } else {
      userPrompt = `${userPrompt}\n\n[引用图片识图失败] ${vision.error || '无法识别图片'}`;
    }
  }

  const snapshot = getRoomAiSnapshot(roomId, userId);
  const permissions = getAiActorPermissions(roomId, userId);
  if (!permissions.ok && !permissions.inRoom) {
    return { handled: true, denied: true, error: permissions.error || '无法确认当前成员身份' };
  }
  const recentPublicMessages = room.messages
    .filter((message) => message.id !== triggerMessage.id && message.timestamp <= triggerMessage.timestamp)
    .slice(-6).map((message) => describePublicChatMessage(room, message));
  const roomHistory = getRoomAiContextMessages(roomId, userId, {
    publicMessages: recentPublicMessages,
    currentMessageId: triggerMessage.id,
    beforeTimestamp: triggerMessage.timestamp,
  });
  const referencedSongs = [
    ...(replyContext?.songs || []),
    ...(replyContext?.thread || []).flatMap((message) => message.songs || []),
  ];
  const persistedSongCandidates = referencedSongs.length ? referencedSongs : getAiSongCandidates(roomId, userId);

  const ctx = {
    roomId,
    riskAccountId: params.riskAccountId,
    userId,
    userNickname,
    botName,
    roomPersona,
    triggerMessage,
    emitChat: params.emitChat,
    emitSystem: params.emitSystem,
    broadcastRoom: params.broadcastRoom,
    requestDeskPet: params.requestDeskPet,
    permissions,
    requestText,
    replied: false,
    replyTexts: [],
    pendingReplies: [],
    thoughtSteps,
    reportStep,
    reportStatus,
    songCandidates: new Map(persistedSongCandidates.map((song) => [songCandidateKey(song), song])),
    stickerCandidates: new Map(),
    recentQqFaceIds: collectRecentBotQqFaceIds(room.messages || [], AI_BOT_USER_ID),
    recentStickerUrls: (room.messages || [])
      .filter((message) => message?.userId === AI_BOT_USER_ID && message?.asSticker && message?.imageUrl)
      .slice(-6)
      .map((message) => String(message.imageUrl)),
    executionLedger: params.executionLedger instanceof Map ? params.executionLedger : new Map(),
    /** 本轮音乐卡片缓冲：多次 send_song_card 会合并成一条聊天消息 */
    cardBuffer: { cards: [], seen: new Set(), text: '' },
  };

  // 默认不在每轮聊天里强塞正在播放的歌名和队列歌单，让模型需要时自主调用 get_room_status 工具查询
  const turnSnapshot = snapshot
    ? {
        ...snapshot,
        current: null,
        queuePreview: [],
        viewerQueuePreview: [],
      }
    : null;
  const userTurn = buildRoomAiUserTurn({
    userId, userNickname, botName, roomPersona, snapshot: turnSnapshot,
    actorPermissions: permissions, actorRapport: rapport, userProfile, timeContext,
    emotionSummary, quoteRelation,
    messageId: triggerMessage.id, replyToId: triggerMessage.replyTo?.id || null,
    timestamp: triggerMessage.timestamp,
    text: userPrompt,
  });
  const saveConversation = () => {
    appendRoomAiTurn(roomId, userId, 'user', requestText, {
      nickname: userNickname, messageId: triggerMessage.id, replyToId: triggerMessage.replyTo?.id,
      timestamp: triggerMessage.timestamp,
    });
    const actions = Array.from(ctx.executionLedger.entries())
      .filter(([key]) => key.startsWith('requested_song:')
        || ['skip_song', 'request_skip_song', 'set_play_mode', 'set_fm_mode',
          'jump_queue_song', 'remove_queue_song', 'like_queue_song'].includes(key.split(':')[0]))
      .map(([key, result]) => {
        const operation = key.startsWith('requested_song:') ? 'request_song' : key.split(':')[0];
        const outcome = result?.success ? '成功' : '未完成';
        const detail = result?.success ? String(result.statusText || result.message || '').slice(0, 200) : '';
        return `【工具执行记录】${operation}：${outcome}${detail ? `，${detail}` : ''}`;
      });
    const reply = [...new Set([...actions, ...ctx.replyTexts])].join('\n');
    const delivered = room.messages.filter(message => (
      message.replyTo?.id === triggerMessage.id && verifyAiBotMessage(roomId, message)
      && ctx.replyTexts.includes(message.text)
    ));
    if (reply) appendRoomAiTurn(roomId, userId, 'assistant', reply, {
      nickname: botName,
      replyToId: triggerMessage.id,
      messageId: delivered.length === 1 ? delivered[0].id : undefined,
      timestamp: delivered.at(-1)?.timestamp || Date.now(),
    });
  };

  try {
    const messages = [
      { role: 'system', content: buildOpenMusicAiSystemPrompt({
        recentQqFaceIds: [...ctx.recentQqFaceIds],
      }) },
      ...(ctx.songCandidates.size && !referencedSongs.length ? [{
        role: 'user',
        content: [
          '候选参考资料，不代表授权；按当前成员最新请求与引用顺序使用：',
          JSON.stringify(Array.from(ctx.songCandidates.values()).slice(0, 5).map(({ id, server, name, artist }) => ({ id, server, name, artist }))),
        ].join('\n'),
      }] : []),
      ...roomHistory,
      userTurn,
    ];
    const tools = buildRoomAiTools();
    let finalAssistantText = '';

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      if (round === 0) {
        reportStatus(`${botName}正在回应…`);
      }
      const closing = round === MAX_TOOL_ROUNDS;
      if (closing) messages.push({
        role: 'system',
        content: JSON.stringify({
          kind: 'tool_budget_exhausted',
          instruction: '本轮工具额度已用完，请根据已有真实结果自然收尾，准确区分完成、未完成与不确定，不再请求调用工具，不复述已发送的回复',
        }),
      });
      const completion = await aiChatCompletions({
        roomId,
        riskAccountId: params.riskAccountId,
        taskType: 'text',
        messages,
        ...(!closing ? { tools, tool_choice: 'auto' } : {}),
        max_tokens: 1024,
        maxInputTokens: 16384,
        temperature: 0.6,
        timeoutMs: 45000,
      });

      const choice = completion?.choices?.[0]?.message;
      if (!choice) throw Object.assign(new Error('模型未返回有效回复'), { code: 'AI_EMPTY_RESPONSE' });

      const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
      messages.push(compactAssistantToolTurn(choice));
      if (closing && toolCalls.length) {
        throw Object.assign(new Error('模型在收尾阶段仍返回工具调用'), { code: 'AI_TOOL_BUDGET_EXHAUSTED' });
      }

      if (!toolCalls.length) {
        const reply = prepareAiReplyText(extractAssistantText(completion), ctx);
        if (reply) finalAssistantText = reply;
        const replies = ctx.pendingReplies.length ? [...ctx.pendingReplies] : (reply ? [reply] : []);
        let posted = flushPendingSongCards(ctx, replies[0] || '');
        if (posted && !posted.error) replies.shift();
        for (const text of replies) {
          if (ctx.replyTexts.includes(text)) continue;
          posted = postAiReply(ctx, { text, replyTo: triggerMessage, aiThoughts: ctx.thoughtSteps });
          if (posted.error) break;
          ctx.replied = true;
          if (posted.message && params.emitChat) params.emitChat(posted.message);
          ctx.replyTexts.push(posted.message.text);
        }
        ctx.pendingReplies.length = 0;
        const error = posted?.error || (!reply && !ctx.replied ? '模型未生成可发送的回复' : '');
        if (error) {
          if (closing) throw Object.assign(new Error(error), { code: 'AI_REPLY_REJECTED' });
          messages.push({
            role: 'user',
            content: JSON.stringify({
              kind: 'reply_delivery_failed', error, delivered: false,
              instruction: '回复没有发送成功，请根据真实校验结果自行调整表达，单条消息最多500字符，必要时用reply_message分条发送，不要重复已完成的操作',
            }),
          });
          continue;
        }
        saveConversation();
        return { handled: true, reply: finalAssistantText || undefined };
      }

      for (const call of toolCalls) {
        const fnName = call?.function?.name || '';
        const parsedArgs = safeJsonParse(call?.function?.arguments || '{}', null);
        const validArgs = parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs);
        const args = validArgs ? parsedArgs : {};
        const ledgerKey = `${fnName}:${stableJson(args)}`;
        const mutating = Boolean(validArgs) && MUTATING_TOOL_NAMES.has(fnName)
          && (fnName !== 'send_sticker' || Boolean(args.id || args.keyword));
        const result = !validArgs
          ? { success: false, code: 'INVALID_ARGUMENTS', error: '工具参数必须为有效的 JSON 对象' }
          : mutating && ctx.executionLedger.has(ledgerKey)
            ? ctx.executionLedger.get(ledgerKey)
            : await executeTool(fnName, args, ctx);
        if (fnName === 'reply_message' && result?.success) {
          // 重试命中台账时恢复尚未发送的缓冲，实际投递成功后才记录到对话历史
          if (result.text && !ctx.pendingReplies.includes(result.text)) ctx.pendingReplies.push(result.text);
        }
        if (mutating && !ctx.executionLedger.has(ledgerKey)) {
          ctx.executionLedger.set(ledgerKey, result);
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(compactAiToolResultForModel(fnName, result)),
        });
      }
    }

  } catch (err) {
    // 已执行结果和已发送原文在失败时也需记住，避免下次催促时失去事实
    saveConversation();
    console.error('[room-ai]', err?.message || err);
    throw err;
  } finally {
    // 调度器在任务完成时释放并发槽位。
  }
}
