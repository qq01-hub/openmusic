import { customAlphabet } from "nanoid";
import { scrypt, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { fetchMetingFmSongs, normalizeFmMode, DEFAULT_FM_MODE, FM_MODE_OFF } from "./metingFm.js";
import { importNeteasePlaylist, importQqPlaylist, importKugouPlaylist, importQishuiPlaylist } from "./playlistImport.js";
import { getRedisClient, initRoomStorage, isRedisEnabled, loadAllRoomsFromStorage, queueSaveRoomToStorage, deleteRoomFromStorage, saveRoomToStorage, listFavoriteSongs } from "./roomStorage.js";
import {
  DEFAULT_MEMBER_SETTINGS,
  buildWelcomeText,
  normalizeIncomingMemberTier,
  normalizeMemberSettings,
  resolveMemberWelcomeSettings,
  restoreMemberTiersFromStorage,
  serializeMemberSettings,
  serializeMemberTier,
  serializeMemberTiersMap,
} from "./memberTier.js";
import { deleteRoomChatImages, validateChatImageForRoom, validateExternalChatImage } from "./qiniuOss.js";
import { isLocalStickerImageKey, validateLocalStickerImage } from "./localSticker.js";
import { collectDeviceIdsForUser, isAccessBanned } from "./deviceIdentity.js";
import { getRuntimeConfig, ensureRoomCredentialEncryptionKey } from "./runtimeConfig.js";
import { resizeCoverForThumb } from "./coverUrl.js";
import { isDirectCoverUrl, resolveSongCoverUrl } from "./resolveSongCover.js";
import { isSongPlayableOnServer } from "./songPlayableProbe.js";
import { clearRoomAiContext } from "./roomAiContext.js";
import { clearRoomAiUserState } from "./roomAiUserState.js";
import { runWithMetingRequestContext } from "./metingUpstream.js";
import { recordSongPlay } from "./songHotRank.js";
import {
  AI_BOT_USER_ID,
  AI_BOT_MESSAGE_KIND,
  attachAiBotWireFields,
  isReservedBotNickname,
  sanitizeStoredAiBotMessage,
  verifyAiBotMessage,
} from "./chatAiAuth.js";
import { normalizeRoomAiBotName, resolveRoomAiBotName } from "./aiModelService.js";
import {
  applyPermanentResidence,
  cancelPermanentApplication,
  clearPermanentApplicationForRoom,
  getPermanentApplication,
  listPermanentApplications,
  peekPermanentApplication,
  reviewPermanentApplication,
  toPublicPermanentApplication,
} from "./permanentApplication.js";
import { buildUserRoundRobinOrder } from "./playbackOrder.js";
import { resolveAdminOwnerLastJoinedAt } from "./adminRoomUtils.js";

const generateRoomId = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const generateId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

// 房间无人时销毁延迟（毫秒），用于减少“退出再进设置丢失/房间被清理”的情况
const PROTECTED_ROOMS_REDIS_KEY = "openmusic:admin:protected_rooms";
/** 管理后台设置的保活房间；Redis 可用时跨重启持久化 */
const protectedRoomIds = new Set();
const DEFAULT_QUEUE_MAX_LENGTH = 200;
export const MIN_PLAYBACK_RATE = 0.1;
export const MAX_PLAYBACK_RATE = 3;
export const DEFAULT_PLAYBACK_RATE = 1;
const ALLOWED_QUEUE_MAX_LENGTHS = [50, 100, 200];
const ALLOWED_SONG_REQUEST_COOLDOWNS_SEC = [0, 10, 30, 60, 120];
const DEFAULT_DISLIKE_SKIP_THRESHOLD = 5;
const DEFAULT_DISLIKE_SKIP_MODE = "count";
const DEFAULT_DISLIKE_SKIP_PERCENT = 50;
const MAX_DISLIKE_SKIP_THRESHOLD = 50;
const DEFAULT_CLEAR_SONGS_ON_LEAVE_DELAY_SEC = 60;
const MAX_CLEAR_SONGS_ON_LEAVE_DELAY_SEC = 24 * 60 * 60;
const DEFAULT_JOIN_NOTICE_COOLDOWN_SEC = 3 * 60;
const MAX_JOIN_NOTICE_COOLDOWN_SEC = 24 * 60 * 60;
const MAX_BANNED_SONGS = 100;
const MAX_FORBIDDEN_WORDS = 150;
const MAX_FORBIDDEN_WORD_LEN = 20;
/** 新房间默认违禁词；房主可删除，排序时排在自定义词之后 */
const DEFAULT_FORBIDDEN_WORDS = [
  "傻逼",
  "傻B",
  "傻比",
  "傻叉",
  "煞笔",
  "煞B",
  "沙比",
  "沙B",
  "傻屌",
  "傻吊",
  "傻缺",
  "傻帽",
  "傻狗",
  "蠢逼",
  "死逼",
  "烂逼",
  "臭逼",
  "装逼",
  "逼样",
  "逼养的",
  "sb",
  "脑残",
  "脑瘫",
  "智障",
  "弱智",
  "低能",
  "白痴",
  "蠢货",
  "蠢猪",
  "蠢驴",
  "废物",
  "人渣",
  "畜生",
  "杂种",
  "杂碎",
  "婊子",
  "婊砸",
  "贱人",
  "贱货",
  "臭婊子",
  "婊子养的",
  "烂货",
  "破鞋",
  "狗东西",
  "狗日的",
  "狗娘养的",
  "狗崽子",
  "狗逼",
  "狗比",
  "去死",
  "找死",
  "去死吧",
  "去死啊",
  "死全家",
  "全家死光",
  "你妈死了",
  "死妈",
  "草泥马",
  "操你妈",
  "操你妈逼",
  "操你",
  "操你全家",
  "操你祖宗",
  "草你妈",
  "草你妈逼",
  "操尼玛",
  "日你妈",
  "日你全家",
  "日你",
  "干你妈",
  "干你全家",
  "干你",
  "你妈的",
  "去你妈的",
  "妈的逼",
  "妈逼",
  "你妈逼",
  "你妈逼的",
  "你麻痹",
  "你麻痹的",
  "麻痹的",
  "尼玛",
  "妈了个逼",
  "操他妈",
  "他妈的",
  "他吗的",
  "特么的",
  "我操你",
  "我操",
  "我草",
  "卧槽",
  "cnm",
  "wcnm",
  "nmsl",
  "nmb",
  "nm",
  "rnm",
  "tmd",
  "mlgb",
  "mmp",
  "滚你妈",
  "滚蛋",
  "滚犊子",
  "滚开",
  "你大爷",
  "神经病",
  "吃屎",
  "混蛋",
  "浑蛋",
  "妈蛋",
  "鸡巴",
  "鸡吧",
  "几把",
  "臭鸡巴",
  "鸡巴脸",
  "屌",
  "吊毛",
  "屌毛",
  "逗比",
  "二逼",
  "二B",
  "王八蛋",
  "龟孙子",
  "绿帽子",
  "骚货",
  "骚逼",
  "约炮",
  "一夜情",
  "操你妹",
  "日你妹",
  "操你爹",
  "肏",
  "艹你妈",
  "靠你妈",
  "撸管",
  "打飞机",
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "bastard",
];
const MAX_CHAT_MESSAGES = 300;
/** 同一设备（非 IP）：办公室共用出口 IP 不应互相挤占 */
const MAX_ACCOUNTS_PER_DEVICE_PER_ROOM = 2;
const MAX_SONG_HISTORY = 150;
export const INITIAL_CHAT_LIMIT = 100;
export const CHAT_PAGE_LIMIT = 50;
const MAX_RANDOM_HISTORY = 200;
const MAX_RANDOM_PREFETCH_ATTEMPTS = 20;
/** 非控制者首次补种时长的最小合理值（毫秒），杜绝 durationMs:1 之类的恶意切歌 */
const MIN_REPORTABLE_DURATION_MS = 1000;

/** 播放顺序：顺序 / 乱序 / 收藏随机 / 单曲循环 / 列表循环 / 列表内随机 */
export const PLAY_MODES = ["order", "shuffle", "user-round-robin", "favorite-shuffle", "loop-one", "loop-all", "shuffle-loop"];
export const DEFAULT_PLAY_MODE = "order";

export function normalizePlayMode(value) {
  const mode = String(value || "")
    .trim()
    .toLowerCase();
  return PLAY_MODES.includes(mode) ? mode : DEFAULT_PLAY_MODE;
}

/** @type {((roomId: string) => void) | null} */
let onRoomPrefetchReady = null;
/** @type {((roomId: string) => void) | null} */
let onRoomStructureChanged = null;

export function setOnRoomPrefetchReady(handler) {
  onRoomPrefetchReady = handler;
}

export function setOnRoomStructureChanged(handler) {
  onRoomStructureChanged = handler;
}

function notifyRoomPrefetchReady(room) {
  if (room?.nextRandom && onRoomPrefetchReady) {
    onRoomPrefetchReady(room.id);
  }
}

function notifyRoomStructureChanged(roomId) {
  if (onRoomStructureChanged) onRoomStructureChanged(roomId);
}

function skipRequestTimerKey(roomId, requestId) {
  return `${roomId}:${requestId}`;
}

function clearSkipRequestExpiryTimer(roomId, requestId) {
  const key = skipRequestTimerKey(roomId, requestId);
  const timer = skipRequestExpiryTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  skipRequestExpiryTimers.delete(key);
}

function clearSkipRequestExpiryTimersForRoom(roomId) {
  const prefix = `${roomId}:`;
  for (const [key, timer] of skipRequestExpiryTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    skipRequestExpiryTimers.delete(key);
  }
}

function expireSkipRequest(roomId, requestId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const before = room.skipRequests.length;
  room.skipRequests = room.skipRequests.filter((r) => r.id !== requestId);
  if (room.skipRequests.length === before) return;
  persistRoom(room);
  notifyRoomStructureChanged(roomId);
}

function scheduleSkipRequestExpiry(roomId, requestId, requestedAt = Date.now()) {
  clearSkipRequestExpiryTimer(roomId, requestId);
  const remainingMs = Math.max(0, SKIP_REQUEST_TTL_MS - (Date.now() - requestedAt));
  const key = skipRequestTimerKey(roomId, requestId);
  const timer = setTimeout(() => {
    skipRequestExpiryTimers.delete(key);
    expireSkipRequest(roomId, requestId);
  }, remainingMs);
  skipRequestExpiryTimers.set(key, timer);
}

function syncSkipRequestExpiryTimers(room) {
  if (!room) return;
  clearSkipRequestExpiryTimersForRoom(room.id);
  room.skipRequests.forEach((request) => {
    scheduleSkipRequestExpiry(room.id, request.id, request.requestedAt);
  });
}

function purgeExpiredSkipRequests(room) {
  const now = Date.now();
  const before = room.skipRequests.length;
  room.skipRequests = room.skipRequests.filter((request) => {
    const expired = now - request.requestedAt >= SKIP_REQUEST_TTL_MS;
    if (expired) clearSkipRequestExpiryTimer(room.id, request.id);
    return !expired;
  });
  return before !== room.skipRequests.length;
}
const AUTO_ADVANCE_GRACE_SEC = 0.15;
const SKIP_REQUEST_TTL_MS = 10_000;
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const skipRequestExpiryTimers = new Map();
const NETEASE_CANONICAL = new Set([
  "standard",
  "higher",
  "exhigh",
  "lossless",
  "hires",
  "jyeffect",
  "sky",
  "jymaster",
  "dolby",
]);
const TENCENT_CANONICAL = new Set([
  "standard",
  "exhigh",
  "lossless",
  "atmos",
  "master",
]);
const KUGOU_CANONICAL = new Set([
  "standard",
  "exhigh",
  "lossless",
  "hires",
  "atmos",
  "master",
]);
const QUALITY_ALIASES = {
  128: "standard",
  320: "exhigh",
  flac: "lossless",
};

function normalizeRoomAudioQuality(input) {
  const rawNetease = String(input?.netease || "jyeffect");
  const rawTencent = String(input?.tencent || "lossless");
  const rawKugou = String(input?.kugou || "exhigh");
  const netease = QUALITY_ALIASES[rawNetease] || rawNetease;
  const tencent = QUALITY_ALIASES[rawTencent] || rawTencent;
  const kugou = QUALITY_ALIASES[rawKugou] || rawKugou;
  return {
    netease: NETEASE_CANONICAL.has(netease) ? netease : "jyeffect",
    tencent: TENCENT_CANONICAL.has(tencent) ? tencent : "lossless",
    kugou: KUGOU_CANONICAL.has(kugou) ? kugou : "exhigh",
  };
}

function normalizeMusicAccountEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const cookieId = String(raw.cookieId || raw.id || "").trim();
  if (!cookieId && !raw.hasVip && raw.usage !== "fm") return null;
  const hasVip = Boolean(raw.hasVip);
  const id = cookieId || (hasVip ? "" : `local-fm-${raw.platform || "netease"}`);
  if (!id) return null;
  return {
    cookieId: id,
    platform: raw.platform === "tencent" ? "tencent" : raw.platform === "kugou" ? "kugou" : raw.platform === "qishui" ? "qishui" : "netease",
    shared: hasVip ? Boolean(raw.shared) : false,
    hasVip,
    hasSvip: hasVip && Boolean(raw.hasSvip),
    canSearchSongs: raw.canSearchSongs !== false,
    canSearchPlaylists: raw.canSearchPlaylists !== false,
    usage: hasVip ? "vip" : "fm",
    nickname: String(raw.nickname || "").slice(0, 64),
    providerName: String(raw.providerName || "").slice(0, 64),
    avatarUrl: String(raw.avatarUrl || "").slice(0, 512),
    userId: String(raw.userId || "").slice(0, 64),
    isValid: raw.isValid !== false,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

export function normalizeMusicAccounts(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    netease: normalizeMusicAccountEntry(src.netease),
    tencent: normalizeMusicAccountEntry(src.tencent),
    kugou: normalizeMusicAccountEntry(src.kugou),
    qishui: normalizeMusicAccountEntry(src.qishui),
  };
}

/** 上游共享接口可能只返回状态，不返回完整账号资料；保留本地登录资料，避免界面回到未绑定。 */
export function mergeSharedMusicAccount(current, upstream) {
  const local = normalizeMusicAccountEntry(current);
  const remote = normalizeMusicAccountEntry(upstream);
  if (!local && !remote) return null;
  return normalizeMusicAccountEntry({
    ...(local || {}),
    ...(remote || {}),
    cookieId: remote?.cookieId || local?.cookieId,
    platform: remote?.platform || local?.platform,
    shared: true,
    hasVip: remote?.hasVip ?? local?.hasVip ?? true,
    hasSvip: remote?.hasSvip ?? local?.hasSvip ?? false,
    nickname: remote?.nickname || local?.nickname,
    providerName: remote?.providerName || local?.providerName,
    avatarUrl: remote?.avatarUrl || local?.avatarUrl,
    userId: remote?.userId || local?.userId,
    isValid: remote?.isValid ?? local?.isValid ?? true,
    updatedAt: remote?.updatedAt || Date.now(),
  });
}

/** 合并 Meting 刷新结果，避免并发刷新用旧快照覆盖刚完成的共享切换。 */
export function mergeRoomMusicAccountsWithUpstream(localAccounts, upstreamAccounts) {
  const local = normalizeMusicAccounts(localAccounts);
  const upstream = normalizeMusicAccounts(upstreamAccounts);
  const merged = { ...local };
  for (const platform of ["netease", "tencent", "kugou", "qishui"]) {
    if (upstream[platform]) {
      merged[platform] = mergeSharedMusicAccount(local[platform], upstream[platform]);
    }
  }
  return merged;
}


/** 房间音源凭证仅存服务端，不进房间广播 */
function normalizeMusicAccountSecrets(input) {
  const src = input && typeof input === "object" ? input : {};
  const netease = String(src.netease || "").trim();
  const tencent = String(src.tencent || "").trim();
  const kugou = String(src.kugou || "").trim();
  const qishui = String(src.qishui || "").trim();
  return {
    netease: netease || null,
    tencent: tencent || null,
    kugou: kugou || null,
    qishui: qishui || null,
  };
}

function normalizeFmSource(value) {
  if (value === "kugou") return "kugou";
  if (value === "qishui") return "qishui";
  if (value === "tencent") return "tencent";
  return "netease";
}

const PLAYLIST_ROAMING_MAX_PLAYLISTS = 20;
// 与收藏整单导入的上限保持一致；指定歌单也应保留完整的大型歌单。
const PLAYLIST_ROAMING_MAX_SONGS_PER_PLAYLIST = 5000;

function normalizePlaylistUrl(value) {
  const match = String(value || '').trim().match(/https?:\/\/[^\s]+/i);
  if (!match) return '';
  const candidate = match[0].replace(/[.,;，。；)）\]]+$/, '').slice(0, 2000);
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizePlaylistRoamingEntry(playlist) {
  if (!playlist || typeof playlist !== "object") return null;
  const source = normalizeFmSource(playlist.source);
  const id = String(playlist.id || "").trim().slice(0, 160);
  const name = String(playlist.name || "").trim().slice(0, 160);
  const url = normalizePlaylistUrl(playlist.url);
  const songs = (Array.isArray(playlist.songs) ? playlist.songs : [])
    .map((song) => serializeSongMeta(song))
    .filter((song) => song?.id && song?.name)
    .slice(0, PLAYLIST_ROAMING_MAX_SONGS_PER_PLAYLIST);
  if (!id || songs.length === 0) return null;
  return { id, source, name, ...(url ? { url } : {}), songs };
}

function normalizePlaylistRoaming(playlistRoaming) {
  if (!playlistRoaming || typeof playlistRoaming !== "object") return null;
  const rawPlaylists = Array.isArray(playlistRoaming.playlists)
    ? playlistRoaming.playlists
    : [playlistRoaming];
  const seen = new Set();
  const playlists = rawPlaylists
    .map(normalizePlaylistRoamingEntry)
    .filter((playlist) => {
      if (!playlist) return false;
      const key = playlist.source + ":" + playlist.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, PLAYLIST_ROAMING_MAX_PLAYLISTS);
  return playlists.length
    ? { playlists, dedupeByName: playlistRoaming.dedupeByName === true, enabled: playlistRoaming.enabled !== false }
    : null;
}

function getPlaylistRoamingSongs(playlistRoaming) {
  const songs = [];
  for (const playlist of playlistRoaming?.playlists || []) {
    for (const song of playlist.songs || []) songs.push(song);
  }
  return songs;
}

async function importPlaylistForRoaming(platform, input) {
  if (platform === "netease") return importNeteasePlaylist(input);
  if (platform === "qq") return importQqPlaylist(input);
  if (platform === "kugou") return importKugouPlaylist(input);
  if (platform === "qishui") return importQishuiPlaylist(input);
  throw new Error("不支持的平台");
}

const rooms = new Map();
const ensurePlaybackInflight = new Map();

const MAX_ROOM_PASSWORD_LENGTH = 64;
const MIN_ROOM_PASSWORD_LENGTH = 4;

function normalizeRoomPasswordInput(password) {
  return String(password || "")
    .trim()
    .slice(0, MAX_ROOM_PASSWORD_LENGTH);
}

/** 空密码允许（公开房 / 仅房主可进）；有密码则至少 4 位 */
export function validateRoomPassword(password) {
  const trimmed = normalizeRoomPasswordInput(password);
  if (!trimmed) return { ok: true, password: "" };
  if (trimmed.length < MIN_ROOM_PASSWORD_LENGTH) {
    return { ok: false, error: "房间密码至少 4 位" };
  }
  return { ok: true, password: trimmed };
}

function hashPassword(password) {
  const normalized = normalizeRoomPasswordInput(password);
  const salt = randomBytes(16);
  const hash = scryptSync(normalized, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return true;
  if (!password) return false;
  const normalized = normalizeRoomPasswordInput(password);
  if (!normalized) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await new Promise((resolve, reject) => {
    scrypt(normalized, salt, 32, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function verifyRoomPassword(roomId, password, options = {}) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return { ok: false, error: "房间不存在" };

  const clientId = sanitizeCreatorId(options.clientId);
  const deviceId = sanitizeCreatorId(options.deviceId);
  // TV/只读进房会发临时 clientId，绝不能用设备绑定把永久房主改写给该临时身份。
  if (
    !options.readOnly
    && clientId
    && deviceId
    && room.creatorDeviceId === deviceId
    && room.creatorId !== clientId
  ) {
    // 身份 Cookie 因重装/密钥轮换而变化时，以 HttpOnly 设备绑定恢复永久房主。
    room.creatorId = clientId;
    ensureAdminIds(room).delete(clientId);
    ensureAutoPromotedAdminIds(room).delete(clientId);
    persistRoom(room);
  }
  // 原创建者始终可进：无密码上锁 / 有密码房均免密
  if (clientId && room.creatorId === clientId) {
    return { ok: true };
  }

  if (room.isLocked && !room.passwordHash) {
    return { ok: false, error: "房间已上锁，禁止进入" };
  }

  if (room.passwordHash) {
    const normalized = normalizeRoomPasswordInput(password);
    if (!normalized) {
      return { ok: false, error: "请输入房间密码", needsPassword: true };
    }
    let valid = false;
    try {
      valid = await verifyPassword(password, room.passwordHash);
    } catch {
      valid = false;
    }
    if (!valid) {
      return { ok: false, error: "密码错误", needsPassword: true };
    }
  }
  return { ok: true };
}

function cancelRoomDestroy(room) {
  if (room.destroyTimer) {
    clearTimeout(room.destroyTimer);
    room.destroyTimer = null;
  }
  if (room) room.destroyAt = 0;
}

/** 真正销毁：先同步移出内存，再异步清七牛/Redis，避免删图卡住或持久化竞态把空房「救活」 */
function destroyRoomNow(roomId) {
  const id = String(roomId || "").toUpperCase();
  const room = rooms.get(id);
  if (!room) return false;
  if (room.users.size > 0) return false;
  if (protectedRoomIds.has(id)) return false;

  cancelRoomDestroy(room);
  clearAllPendingLeaveClears(room);
  clearSkipRequestExpiryTimersForRoom(id);
  rooms.delete(id);
  invalidateRoomsListCache();
  void deleteRoomChatImages(id).catch((err) => {
    console.error(`删除房间 ${id} 聊天图片失败:`, err?.message || err);
  });
  void deleteRoomFromStorage(id);
  return true;
}

function scheduleRoomDestroy(roomId, ttlMsOverride) {
  const room = rooms.get(roomId);
  if (!room) return;

  cancelRoomDestroy(room);
  if (protectedRoomIds.has(roomId)) return;
  const ttlMs = Number.isFinite(ttlMsOverride) ? ttlMsOverride : getRuntimeConfig().roomEmptyTtlMs;
  room.destroyAt = Date.now() + Math.max(0, ttlMs);
  if (ttlMs <= 0) {
    destroyRoomNow(roomId);
    return;
  }
  room.destroyTimer = setTimeout(() => {
    destroyRoomNow(roomId);
  }, ttlMs);
}

/** 空房已无人多久（优先 emptySince；旧房间用 lastJoinedAt/createdAt 兜底） */
function getRoomEmptySince(room) {
  const emptySince = Number(room.emptySince) || 0;
  if (emptySince > 0) return emptySince;
  return Math.max(Number(room.lastJoinedAt) || 0, Number(room.createdAt) || 0) || Date.now();
}

/** 兜底清扫：定时器丢失 / 异步删图竞态导致的僵尸空房 */
function sweepStaleEmptyRooms() {
  const ttlMs = getRuntimeConfig().roomEmptyTtlMs;
  const now = Date.now();
  const hardLimitMs = Math.max(60 * 60 * 1000, (ttlMs > 0 ? ttlMs : 60_000) * 2);

  for (const room of rooms.values()) {
    if (room.users.size > 0) continue;
    if (protectedRoomIds.has(room.id)) continue;

    const destroyAt = Number(room.destroyAt) || 0;
    if (destroyAt > 0 && now >= destroyAt) {
      destroyRoomNow(room.id);
      continue;
    }

    if (!room.destroyTimer && destroyAt <= 0) {
      scheduleRoomDestroy(room.id);
      continue;
    }

    // 极端兜底：空闲过久仍未销毁（例如旧进程遗留、定时器丢失）
    if (now - getRoomEmptySince(room) >= hardLimitMs) {
      destroyRoomNow(room.id);
    }
  }
}

/** 房间是否含值得跨重启保留的内容（队列 / 当前曲 / 点歌历史） */
function roomHasPersistableContent(room) {
  if (!room) return false;
  if (room.queue.length > 0) return true;
  if (room.current || room.isPlaying) return true;
  if ((room.songHistory?.length ?? 0) > 0) return true;
  // 仅有聊天记录或 knownUserIds 不足以长期保活，否则空房会堆积
  return false;
}

function snapshotRoomForStorage(room) {
  return {
    id: room.id,
    name: room.name,
    passwordHash: room.passwordHash,
    passwordPlain: room.passwordPlain || null,
    isLocked: Boolean(room.isLocked),
    muteAll: Boolean(room.muteAll),
    mutedUserIds: Array.from(room.mutedUserIds || []),
    creatorId: room.creatorId ?? null,
    creatorDeviceId: room.creatorDeviceId ?? null,
    creatorIp: room.creatorIp || null,
    ownerLastJoinedAtByUserId: Object.fromEntries(room.ownerLastJoinedAtByUserId || []),
    bannedUserIds: Array.from(room.bannedUserIds || []),
    bannedDeviceIds: Array.from(room.bannedDeviceIds || []),
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
    isPlaying: room.isPlaying,
    currentTime: getPlaybackTime(room),
    playbackVersion: room.playbackVersion ?? 0,
    playbackUpdatedAt: room.playbackUpdatedAt ?? Date.now(),
    playbackRate: normalizePlaybackRate(room.playbackRate),
    messages: room.messages.slice(-MAX_CHAT_MESSAGES).map(sanitizeMessageForStorage),
    knownUserIds: Array.from(room.knownUserIds || []),
    chatVisibleSinceByUserId: Object.fromEntries(room.chatVisibleSinceByUserId || []),
    songHistory: (room.songHistory || []).slice(0, MAX_SONG_HISTORY).map(serializeSongHistoryForClient).filter(Boolean),
    jumpRequests: room.jumpRequests,
    skipRequests: room.skipRequests,
    randomPlayedKeys: Array.from(room.randomPlayedKeys),
    nextRandom: serializeSongMeta(room.nextRandom),
    adminIds: Array.from(room.adminIds || []),
    autoPromotedAdminIds: Array.from(room.autoPromotedAdminIds || []),
    maxAdmins: getRoomMaxAdmins(room),
    userNicknames: Object.fromEntries(room.userNicknames || []),
    userAvatarUrls: Object.fromEntries(room.userAvatarUrls || []),
    audioQuality: room.audioQuality ?? { netease: "jyeffect", tencent: "lossless", kugou: "exhigh" },
    neteaseFmMode: normalizeFmMode(room.neteaseFmMode),
    fmSource: normalizeFmSource(room.fmSource),
    fmModeBeforeOff: normalizeFmMode(room.fmModeBeforeOff),
    playlistRoaming: normalizePlaylistRoaming(room.playlistRoaming),
    musicAccounts: normalizeMusicAccounts(room.musicAccounts),
    musicAccountSecrets: normalizeMusicAccountSecrets(room.musicAccountSecrets),
    playMode: normalizePlayMode(room.playMode),
    lastPlaybackRequesterId: room.lastPlaybackRequesterId || null,
    playbackRequesterOrder: Array.isArray(room.playbackRequesterOrder) ? room.playbackRequesterOrder : [],
    favoriteShuffleUserId: room.favoriteShuffleUserId || null,
    announcementEnabled: Boolean(room.announcementEnabled),
    announcementText: String(room.announcementText || "").slice(0, MAX_ANNOUNCEMENT_LENGTH),
    customCoverUrl: normalizeCustomCoverUrl(room.customCoverUrl),
    chatHistoryVisibleOnJoin: Boolean(room.chatHistoryVisibleOnJoin),
    chatShowAvatars: Boolean(room.chatShowAvatars),
    joinNoticeEnabled: room.joinNoticeEnabled !== false,
    joinNoticeCooldownSec: normalizeJoinNoticeCooldownSec(room.joinNoticeCooldownSec),
    roomAiEnabled: room.roomAiEnabled !== false,
    roomAiBotName: normalizeRoomAiBotName(room.roomAiBotName) || undefined,
    songRequestEnabled: room.songRequestEnabled !== false,
    songRequestMinStaySec: normalizeSongRequestMinStaySec(room.songRequestMinStaySec),
    songRequestMaxPerUser: normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser),
    songRequestCooldownSec: normalizeSongRequestCooldownSec(room.songRequestCooldownSec),
    queueMaxLength: normalizeQueueMaxLength(room.queueMaxLength),
    memberJumpEnabled: Boolean(room.memberJumpEnabled),
    memberSeekEnabled: Boolean(room.memberSeekEnabled),
    memberPauseEnabled: Boolean(room.memberPauseEnabled),
    systemMediaPlayBound: room.systemMediaPlayBound !== false,
    systemMediaSkipBound: room.systemMediaSkipBound !== false,
    dislikeSkipMode: normalizeDislikeSkipMode(room.dislikeSkipMode),
    dislikeSkipThreshold: normalizeDislikeSkipThreshold(room.dislikeSkipThreshold),
    dislikeSkipPercent: normalizeDislikeSkipPercent(room.dislikeSkipPercent),
    clearSongsOnLeaveEnabled: Boolean(room.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelaySec: normalizeClearSongsOnLeaveDelaySec(room.clearSongsOnLeaveDelaySec),
    bannedSongs: serializeBannedSongs(room.bannedSongs),
    forbiddenWords: serializeForbiddenWords(ensureForbiddenWords(room)),
    memberTiers: serializeMemberTiersMap(room.memberTiers),
    memberSettings: serializeMemberSettings(room.memberSettings),
    adminSelfManageMemberTierEnabled: Boolean(room.adminSelfManageMemberTierEnabled),
    createdAt: room.createdAt,
    lastJoinedAt: Number(room.lastJoinedAt) || room.createdAt || Date.now(),
    emptySince: room.users.size === 0
      ? (Number(room.emptySince) || Number(room.lastJoinedAt) || room.createdAt || Date.now())
      : null,
  };
}

function restoreRoomFromStorage(data) {
  const room = createEmptyRoom(data.id, data.name, data.passwordHash ?? null);
  room.passwordPlain = data.passwordPlain || null;
  room.queue = (data.queue || []).map(serializeQueueItemForRoom).filter(Boolean);
  room.current = serializeQueueItemForRoom(data.current) ?? null;
  room.isPlaying = Boolean(data.isPlaying);
  room.currentTime = data.currentTime ?? 0;
  room.playbackVersion = data.playbackVersion ?? 0;
  room.playbackUpdatedAt = data.playbackUpdatedAt ?? Date.now();
  room.playbackRate = normalizePlaybackRate(data.playbackRate);
  room.messages = data.messages || [];
  room.knownUserIds = new Set(data.knownUserIds || []);
  room.chatVisibleSinceByUserId = restoreChatVisibleSinceMap(data.chatVisibleSinceByUserId);
  room.songHistory = (Array.isArray(data.songHistory) ? data.songHistory : []).slice(0, MAX_SONG_HISTORY).map(serializeSongHistoryForClient).filter(Boolean);
  room.jumpRequests = data.jumpRequests || [];
  room.skipRequests = data.skipRequests || [];
  purgeExpiredSkipRequests(room);
  syncSkipRequestExpiryTimers(room);
  room.randomPlayedKeys = new Set(data.randomPlayedKeys || []);
  room.nextRandom = serializeSongMeta(data.nextRandom);
  room.creatorId = data.creatorId ?? null;
  room.creatorDeviceId = sanitizeCreatorId(data.creatorDeviceId) || null;
  room.creatorIp = String(data.creatorIp || "").trim().slice(0, 64) || null;
  room.ownerLastJoinedAtByUserId = new Map(
    Object.entries(data.ownerLastJoinedAtByUserId || {})
      .map(([id, at]) => [id, Number(at) || 0])
      .filter(([, at]) => at > 0),
  );
  room.bannedUserIds = new Set(data.bannedUserIds || []);
  room.bannedDeviceIds = new Set(data.bannedDeviceIds || []);
  room.isLocked = Boolean(data.isLocked);
  room.muteAll = Boolean(data.muteAll);
  room.mutedUserIds = new Set(data.mutedUserIds || []);
  room.adminIds = new Set(Array.isArray(data.adminIds) ? data.adminIds : []);
  room.autoPromotedAdminIds = new Set(Array.isArray(data.autoPromotedAdminIds) ? data.autoPromotedAdminIds : []);
  room.maxAdmins = normalizeMaxAdmins(data.maxAdmins);
  room.userNicknames = new Map(Object.entries(data.userNicknames || {}));
  room.userAvatarUrls = new Map(Object.entries(data.userAvatarUrls || {}));
  room.audioQuality = normalizeRoomAudioQuality(data.audioQuality);
  room.neteaseFmMode = normalizeFmMode(data.neteaseFmMode);
  room.fmSource = normalizeFmSource(data.fmSource);
  const fmModeBeforeOff = normalizeFmMode(data.fmModeBeforeOff);
  room.fmModeBeforeOff = fmModeBeforeOff === FM_MODE_OFF ? DEFAULT_FM_MODE : fmModeBeforeOff;
  room.playlistRoaming = normalizePlaylistRoaming(data.playlistRoaming);
  room.musicAccounts = normalizeMusicAccounts(data.musicAccounts);
  room.musicAccountSecrets = normalizeMusicAccountSecrets(data.musicAccountSecrets);
  room.playMode = normalizePlayMode(data.playMode);
  room.lastPlaybackRequesterId = String(data.lastPlaybackRequesterId || "").trim() || null;
  room.playbackRequesterOrder = Array.isArray(data.playbackRequesterOrder) ? data.playbackRequesterOrder.map(String) : [];
  room.favoriteShuffleUserId = String(data.favoriteShuffleUserId || "").trim() || null;
  room.announcementEnabled = Boolean(data.announcementEnabled);
  room.announcementText = String(data.announcementText || "").slice(0, MAX_ANNOUNCEMENT_LENGTH);
  room.customCoverUrl = normalizeCustomCoverUrl(data.customCoverUrl);
  room.chatHistoryVisibleOnJoin = Boolean(data.chatHistoryVisibleOnJoin);
  room.chatShowAvatars = Boolean(data.chatShowAvatars);
  room.joinNoticeEnabled = data.joinNoticeEnabled !== false;
  room.joinNoticeCooldownSec = normalizeJoinNoticeCooldownSec(data.joinNoticeCooldownSec);
  room.roomAiEnabled = data.roomAiEnabled !== false;
  room.roomAiBotName = normalizeRoomAiBotName(data.roomAiBotName);
  room.songRequestEnabled = data.songRequestEnabled !== false;
  room.songRequestMinStaySec = normalizeSongRequestMinStaySec(data.songRequestMinStaySec);
  room.songRequestMaxPerUser = normalizeSongRequestMaxPerUser(data.songRequestMaxPerUser);
  room.songRequestCooldownSec = normalizeSongRequestCooldownSec(data.songRequestCooldownSec);
  room.queueMaxLength = normalizeQueueMaxLength(data.queueMaxLength);
  room.memberJumpEnabled = Boolean(data.memberJumpEnabled);
  room.memberSeekEnabled = Boolean(data.memberSeekEnabled);
  room.memberPauseEnabled = Boolean(data.memberPauseEnabled);
  room.systemMediaPlayBound = data.systemMediaPlayBound !== false;
  room.systemMediaSkipBound = data.systemMediaSkipBound !== false;
  room.dislikeSkipMode = normalizeDislikeSkipMode(data.dislikeSkipMode);
  room.dislikeSkipThreshold = normalizeDislikeSkipThreshold(data.dislikeSkipThreshold);
  room.dislikeSkipPercent = normalizeDislikeSkipPercent(data.dislikeSkipPercent);
  room.clearSongsOnLeaveEnabled = Boolean(data.clearSongsOnLeaveEnabled);
  room.clearSongsOnLeaveDelaySec = normalizeClearSongsOnLeaveDelaySec(data.clearSongsOnLeaveDelaySec ?? DEFAULT_CLEAR_SONGS_ON_LEAVE_DELAY_SEC);
  room.bannedSongs = restoreBannedSongs(data.bannedSongs);
  room.forbiddenWords = restoreForbiddenWords(data.forbiddenWords);
  room.memberTiers = restoreMemberTiersFromStorage(data.memberTiers);
  room.memberSettings = normalizeMemberSettings(data.memberSettings);
  room.createdAt = data.createdAt ?? Date.now();
  room.lastJoinedAt = Number(data.lastJoinedAt) || room.createdAt;
  // 重启后 socket 全断，视为此刻变空，以便重连宽限期从启动算起（勿用陈旧 lastJoinedAt）
  room.emptySince = Date.now();

  if (room.isPlaying && room.current) {
    room.startedAt = Date.now() - (room.currentTime / normalizePlaybackRate(room.playbackRate)) * 1000;
  }

  return room;
}

const pendingPersistRooms = new Map();
let persistFlushScheduled = false;
/** 单个事件循环 tick 最多序列化多少个房间，避免房间多时一次性卡住事件循环 */
const PERSIST_FLUSH_CHUNK = 20;

function flushPendingPersists() {
  persistFlushScheduled = false;
  if (pendingPersistRooms.size === 0) return;

  let processed = 0;
  for (const [id, room] of pendingPersistRooms) {
    pendingPersistRooms.delete(id);
    queueSaveRoomToStorage(snapshotRoomForStorage(room));
    processed += 1;
    if (processed >= PERSIST_FLUSH_CHUNK) break;
  }

  // 仍有剩余：让出事件循环，下一 tick 继续，避免大批房间同步序列化造成卡顿
  if (pendingPersistRooms.size > 0) {
    persistFlushScheduled = true;
    setImmediate(flushPendingPersists);
  }
}

function persistRoom(room) {
  if (!room) return;
  pendingPersistRooms.set(room.id, room);
  if (!persistFlushScheduled) {
    persistFlushScheduled = true;
    setImmediate(flushPendingPersists);
  }
}

/** 优雅退出前：把内存中待写房间全部同步刷进 Redis */
export async function flushAllPendingRoomPersists() {
  persistFlushScheduled = false;
  const snapshots = [];
  for (const room of pendingPersistRooms.values()) {
    snapshots.push(snapshotRoomForStorage(room));
  }
  pendingPersistRooms.clear();
  if (snapshots.length === 0) return;
  await Promise.all(snapshots.map((snap) => saveRoomToStorage(snap)));
}

let cachedListRooms = null;
let cachedListRoomsAt = 0;
/** 大厅列表为纯内存序列化，可稍长缓存；封面异步补齐后会主动失效 */
const LIST_ROOMS_CACHE_MS = 5000;

function invalidateRoomsListCache() {
  cachedListRooms = null;
  cachedListRoomsAt = 0;
}

function isRoomVisibleInLobby(room) {
  if (room.users.size > 0) return true;
  if (room.current || room.isPlaying) return true;
  if (room.queue.length > 0) return true;
  return false;
}

export async function initRooms() {
  const keyResult = ensureRoomCredentialEncryptionKey();
  if (keyResult.error) console.error(`房间凭证密钥初始化失败：${keyResult.error}`);
  await initRoomStorage();
  const redis = getRedisClient();
  if (redis) {
    try {
      const ids = await redis.sMembers(PROTECTED_ROOMS_REDIS_KEY);
      for (const id of ids) protectedRoomIds.add(String(id).toUpperCase());
    } catch (err) {
      console.error("Redis: 读取保活房间列表失败:", err.message);
    }
  }
  const stored = await loadAllRoomsFromStorage();

  const restartGraceMs = getRuntimeConfig().roomRestartGraceMs;
  const emptyTtlMs = getRuntimeConfig().roomEmptyTtlMs;
  // 进房/贵宾通知静默窗：重启后已知成员回流（客户端也会带 rejoin）
  const RESTART_NOTICE_MUTE_MS = 5 * 60 * 1000;
  const noticeMuteUntil = Date.now() + RESTART_NOTICE_MUTE_MS;
  let preservedCount = 0;
  for (const data of stored) {
    const room = restoreRoomFromStorage(data);
    room.restartNoticeMuteUntil = noticeMuteUntil;
    rooms.set(room.id, room);
    if (room.users.size === 0) {
      // 重启时 socket 全断，房间会短暂无人。有队列/当前曲的房间给重连宽限期；
      // 宽限期未配置或为 0 时，回退到正常空房 TTL，避免空房永远不销毁。
      if (!roomHasPersistableContent(room)) {
        scheduleRoomDestroy(room.id);
      } else {
        const graceMs = restartGraceMs > 0 ? restartGraceMs : emptyTtlMs;
        scheduleRoomDestroy(room.id, graceMs);
        preservedCount += 1;
      }
    }
  }

  if (stored.length > 0) {
    console.log(`已从 Redis 恢复 ${stored.length} 个房间（保留 ${preservedCount} 个空闲房间不因重启解散）`);
  }

  // 每分钟兜底清扫超时空房（含「播放中但无人」的僵尸房）
  setInterval(() => {
    try {
      sweepStaleEmptyRooms();
    } catch (err) {
      console.error("空房清扫失败:", err?.message || err);
    }
  }, 60_000);
  // 启动后稍延迟跑一次，尽快清掉已超时僵尸
  setTimeout(() => {
    try {
      sweepStaleEmptyRooms();
    } catch (err) {
      console.error("空房清扫失败:", err?.message || err);
    }
  }, 5_000);

  if (isRedisEnabled()) {
    setInterval(() => {
      for (const room of rooms.values()) {
        // 无人且已进入销毁倒计时的空房不再刷写，降低与销毁的竞态
        if (room.users.size === 0 && room.destroyTimer) continue;
        // 在线但没有播放/队列变化的房间无需每 30 秒重复写 Redis；状态变更路径
        // 会主动调用 persistRoom，避免中午在线房间多时产生无意义写 IO。
        if (room.isPlaying || room.queue.length > 0) {
          persistRoom(room);
        }
      }
    }, 30000);
  }
}

export { isRedisEnabled };

function truncateByGrapheme(text, maxChars) {
  const str = String(text || "");
  const limit = Math.max(0, Number(maxChars) || 0);
  if (!str || limit <= 0) return "";
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let out = "";
    let count = 0;
    for (const { segment } of seg.segment(str)) {
      if (count >= limit) break;
      out += segment;
      count += 1;
    }
    return out;
  }
  return Array.from(str).slice(0, limit).join("");
}

function normalizeRoomName(name, roomId) {
  const trimmed = String(name || "").trim();
  return truncateByGrapheme(trimmed, 20) || `房间 ${roomId}`;
}

function bumpPlaybackState(room) {
  room.playbackVersion = (room.playbackVersion || 0) + 1;
  room.playbackUpdatedAt = Date.now();
}

/** 队列快照：仅 queue + current，用于点赞/踩/排序等结构变化的轻量广播 */
export function buildQueueSnapshot(room) {
  if (!room) return null;
  return {
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
  };
}

export function buildPlaybackState(room) {
  if (!room) return null;
  repairPlaybackClock(room);
  const now = Date.now();
  const positionSec = getPlaybackTime(room);
  const durationSec = room.current ? getSongDurationSeconds(room.current) : 0;
  const trackId = room.current?.queueId || "";
  const state = {
    roomId: room.id,
    version: room.playbackVersion || 0,
    trackId,
    status: room.isPlaying ? "playing" : "paused",
    positionSec,
    durationSec: durationSec > 0 ? durationSec : 0,
    serverNowMs: now,
    startedAt: room.isPlaying && room.startedAt ? room.startedAt : 0,
    currentTime: positionSec,
    playbackRate: normalizePlaybackRate(room.playbackRate),
    updatedAt: room.playbackUpdatedAt || now,
  };
  // 仅当共享链仍对应当前曲时下发，避免切歌后旧链误用
  if (
    trackId
    && room.sharedMediaTrackId === trackId
    && typeof room.sharedMediaUrl === "string"
    && room.sharedMediaUrl.trim()
  ) {
    state.mediaUrl = room.sharedMediaUrl.trim();
    if (room.sharedMediaQualityLabel) state.mediaQuality = String(room.sharedMediaQualityLabel).slice(0, 40);
    if (room.sharedMediaCrossSource) state.mediaCrossSource = true;
    if (room.sharedMediaCrossSourceFrom) state.mediaCrossSourceFrom = room.sharedMediaCrossSourceFrom;
    if (room.sharedMediaLoudness) state.mediaLoudness = room.sharedMediaLoudness;
    if (room.sharedMediaDuration > 0) state.mediaDuration = room.sharedMediaDuration;
  }
  return state;
}

function clearSharedPlaybackMedia(room) {
  if (!room) return;
  room.sharedMediaUrl = "";
  room.sharedMediaTrackId = "";
  room.sharedMediaQualityLabel = "";
  room.sharedMediaCrossSource = false;
  room.sharedMediaCrossSourceFrom = "";
  room.sharedMediaLoudness = null;
  room.sharedMediaDuration = 0;
  room.sharedMediaAt = 0;
}

/**
 * 成员取链成功后上报，供后续进房者直接播，免重复打上游。
 * @returns {{ updated: boolean, roomId?: string, media?: object, error?: string }}
 */
export function setSharedPlaybackMedia(roomId, payload = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const trackId = String(payload.trackId || "").trim();
  const url = String(payload.url || "").trim();
  if (!trackId || !url) return { error: "缺少 trackId 或 url" };
  if (!room.current || room.current.queueId !== trackId) {
    return { error: "非当前曲，已忽略" };
  }
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/api/")) {
    return { error: "非法播放地址" };
  }
  // 先到先得：当前曲已有共享链则不再覆盖，避免多人上报互相踩
  if (
    room.sharedMediaTrackId === trackId
    && typeof room.sharedMediaUrl === "string"
    && room.sharedMediaUrl.trim()
  ) {
    return { updated: false, roomId: room.id };
  }

  room.sharedMediaUrl = url.slice(0, 2000);
  room.sharedMediaTrackId = trackId;
  room.sharedMediaQualityLabel = String(payload.qualityLabel || "").trim().slice(0, 40);
  room.sharedMediaCrossSource = Boolean(payload.crossSource);
  const from = String(payload.crossSourceFrom || "").trim();
  room.sharedMediaCrossSourceFrom = (
    from === "netease" || from === "tencent" || from === "kugou" || from === "qishui"
  ) ? from : "";
  const loudness = payload.loudness && typeof payload.loudness === "object"
    ? Object.fromEntries(
      ["gain", "peak", "lra"]
        .map((key) => [key, Number(payload.loudness[key])])
        .filter(([, value]) => Number.isFinite(value)),
    )
    : null;
  room.sharedMediaLoudness = loudness && Object.keys(loudness).length > 0 ? loudness : null;
  const duration = Number(payload.duration);
  room.sharedMediaDuration = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
  room.sharedMediaAt = Date.now();

  return {
    updated: true,
    roomId: room.id,
    media: {
      roomId: room.id,
      trackId,
      url: room.sharedMediaUrl,
      qualityLabel: room.sharedMediaQualityLabel || undefined,
      crossSource: room.sharedMediaCrossSource || undefined,
      crossSourceFrom: room.sharedMediaCrossSourceFrom || undefined,
      loudness: room.sharedMediaLoudness || undefined,
      duration: room.sharedMediaDuration || undefined,
    },
  };
}

function createEmptyRoom(roomId, name, passwordHash = null) {
  return {
    id: roomId,
    name: normalizeRoomName(name, roomId),
    passwordHash,
    /** 明文密码（仅内存 + Redis，管理后台可查） */
    passwordPlain: null,
    isLocked: false,
    muteAll: false,
    mutedUserIds: new Set(),
    creatorId: null,
    creatorDeviceId: null,
    creatorIp: null,
    ownerLastJoinedAtByUserId: new Map(),
    ownerId: null,
    bannedUserIds: new Set(),
    bannedDeviceIds: new Set(),
    queue: [],
    current: null,
    isPlaying: false,
    currentTime: 0,
    startedAt: null,
    playbackVersion: 0,
    playbackUpdatedAt: Date.now(),
    playbackRate: DEFAULT_PLAYBACK_RATE,
    playbackDriftAnchored: false,
    playbackDriftAnchorCooldownUntil: 0,
    /** 当前曲已解析的播放直链（内存态，不落盘；供进房成员免二次取链） */
    sharedMediaUrl: "",
    sharedMediaTrackId: "",
    sharedMediaQualityLabel: "",
    sharedMediaCrossSource: false,
    sharedMediaCrossSourceFrom: "",
    sharedMediaAt: 0,
    users: new Map(),
    ownerConnectionId: null,
    jumpRequests: [],
    skipRequests: [],
    messages: [],
    knownUserIds: new Set(),
    chatVisibleSinceByUserId: new Map(),
    songHistory: [],
    randomPlayedKeys: new Set(),
    /** 当前汽水 song-tab 批次的剩余歌曲，按接口顺序消费，不落盘。 */
    randomBatch: [],
    nextRandom: null,
    nextRandomPromise: null,
    randomLoading: false,
    playbackLock: null,
    autoAdvancePromise: null,
    adminIds: new Set(),
    autoPromotedAdminIds: new Set(),
    /** 房主可设的正式管理员人数上限，默认 5 */
    maxAdmins: MAX_ADMINS_DEFAULT,
    userNicknames: new Map(),
    userAvatarUrls: new Map(),
    audioQuality: {
      netease: "jyeffect",
      tencent: "lossless",
      kugou: "exhigh",
    },
    neteaseFmMode: DEFAULT_FM_MODE,
    fmSource: "netease",
    fmModeBeforeOff: DEFAULT_FM_MODE,
    playlistRoaming: null,
    /** 房主扫码绑定的音源账号公开信息 */
    musicAccounts: { netease: null, tencent: null, kugou: null, qishui: null },
    /** 房间私有音源凭证（不广播；仅开启共享时同步到 Meting 池） */
    musicAccountSecrets: { netease: null, tencent: null, kugou: null, qishui: null },
    playMode: DEFAULT_PLAY_MODE,
    /** 用户轮转模式上一次实际播放的用户，用于保证跨轮次公平 */
    lastPlaybackRequesterId: null,
    playbackRequesterOrder: [],
    /** 收藏随机模式使用的收藏列表所属用户；不向客户端广播 */
    favoriteShuffleUserId: null,
    /** 列表内随机：上一首回收进队列的 queueId，避免立刻抽到自己 */
    lastRecycledQueueId: null,
    announcementEnabled: false,
    announcementText: "",
    /** 房主自定义封面；有值时房间/大厅不再跟随当前歌曲封面 */
    customCoverUrl: "",
    /** 进房是否可查看历史聊天；默认关闭（仅看进房后的消息） */
    chatHistoryVisibleOnJoin: false,
    /** 聊天室昵称旁是否显示头像；默认关闭，仅房主可改 */
    chatShowAvatars: false,
    /** 普通成员进房时是否向聊天室推送短暂系统提示 */
    joinNoticeEnabled: true,
    joinNoticeCooldownSec: DEFAULT_JOIN_NOTICE_COOLDOWN_SEC,
    /** 房主是否允许本房 AI（默认开启；站点未开 AI 时仍无效） */
    roomAiEnabled: true,
    /** 本房 AI 昵称；有值时优先于站点默认 */
    roomAiBotName: "",
    lastJoinNoticeAt: new Map(),
    /**
     * 进程重启恢复后，已知成员重连时静默进房/贵宾通知的截止时间。
     * 静默时长由服务端固定，不由房主配置。
     */
    restartNoticeMuteUntil: 0,
    songRequestEnabled: true,
    songRequestMinStaySec: 0,
    songRequestMaxPerUser: 0,
    songRequestCooldownSec: 0,
    queueMaxLength: DEFAULT_QUEUE_MAX_LENGTH,
    memberJumpEnabled: false,
    /** 是否允许成员拖动进度条（默认关闭，房主/管理员始终可） */
    memberSeekEnabled: false,
    /** 是否允许成员暂停/播放（默认关闭，房主/管理员始终可） */
    memberPauseEnabled: false,
    systemMediaPlayBound: true,
    systemMediaSkipBound: true,
    dislikeSkipMode: DEFAULT_DISLIKE_SKIP_MODE,
    dislikeSkipThreshold: DEFAULT_DISLIKE_SKIP_THRESHOLD,
    dislikeSkipPercent: DEFAULT_DISLIKE_SKIP_PERCENT,
    clearSongsOnLeaveEnabled: false,
    clearSongsOnLeaveDelaySec: DEFAULT_CLEAR_SONGS_ON_LEAVE_DELAY_SEC,
    pendingLeaveClears: new Map(),
    bannedSongs: [],
    forbiddenWords: createDefaultForbiddenWords(),
    lastSongRequestAt: new Map(),
    memberTiers: new Map(),
    memberSettings: { ...DEFAULT_MEMBER_SETTINGS },
    /** 是否允许管理员仅修改自己的贵宾标识；默认关闭 */
    adminSelfManageMemberTierEnabled: false,
    createdAt: Date.now(),
    /** 最近一次非 TV 成员进房时间（管理后台闲置判断） */
    lastJoinedAt: Date.now(),
    /** 变为空房的时间；有人在时为 null。用于空房 TTL 兜底清扫 */
    emptySince: Date.now(),
    destroyTimer: null,
    destroyAt: 0,
  };
}

const MAX_ADMINS_DEFAULT = 5;
const MAX_ADMINS_MIN = 1;
const MAX_ADMINS_MAX = 20;

function normalizeMaxAdmins(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return MAX_ADMINS_DEFAULT;
  return Math.min(MAX_ADMINS_MAX, Math.max(MAX_ADMINS_MIN, n));
}

function getRoomMaxAdmins(room) {
  return normalizeMaxAdmins(room?.maxAdmins ?? MAX_ADMINS_DEFAULT);
}

function getNextOwnerId(room) {
  return (
    Array.from(room.users.values())
      .filter((user) => !user.readOnly)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id || null
  );
}

function isEligibleOwner(user) {
  return Boolean(user && !user.readOnly);
}

function ensureAdminIds(room) {
  if (!room.adminIds) room.adminIds = new Set();
  return room.adminIds;
}

function ensureAutoPromotedAdminIds(room) {
  if (!room.autoPromotedAdminIds) room.autoPromotedAdminIds = new Set();
  return room.autoPromotedAdminIds;
}

function revokeAutoPromotedAdmins(room) {
  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  let changed = false;
  for (const id of auto) {
    if (admins.delete(id)) changed = true;
  }
  if (auto.size > 0) {
    auto.clear();
    changed = true;
  }
  return changed;
}

/** 自动提升管理最多 1 人：只保留 keepId，其余全部收回 */
function ensureSingleAutoPromotedAdmin(room, keepId) {
  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  const keep = keepId && admins.has(keepId) ? keepId : null;

  for (const id of [...auto]) {
    if (id === keep) continue;
    admins.delete(id);
    auto.delete(id);
  }

  if (keep) {
    auto.clear();
    auto.add(keep);
    admins.add(keep);
  } else if (auto.size > 0) {
    for (const id of [...auto]) {
      admins.delete(id);
    }
    auto.clear();
  }
}

function pruneAdminIds(room) {
  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  for (const id of [...admins]) {
    const user = room.users.get(id);
    // 离线指定管理保留身份；仅清掉不可控的 TV/只读在线用户
    if (user && !isEligibleOwner(user)) {
      admins.delete(id);
      auto.delete(id);
    }
  }
  // 自动提升残留：人不在 adminIds 里则清理标记
  for (const id of [...auto]) {
    if (!admins.has(id)) auto.delete(id);
  }
  // 持久化脏数据兜底：自动提升最多保留 1 人（优先在线、否则最早进房记录）
  if (auto.size > 1) {
    const ordered = Array.from(auto).sort((a, b) => {
      const aOnline = isEligibleOwner(room.users.get(a)) ? 0 : 1;
      const bOnline = isEligibleOwner(room.users.get(b)) ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;
      return (room.users.get(a)?.joinedAt || 0) - (room.users.get(b)?.joinedAt || 0);
    });
    ensureSingleAutoPromotedAdmin(room, ordered[0]);
  }
}

/** 房主指定的正式管理（不含自动提升） */
function getAppointedAdminIds(room) {
  pruneAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  return Array.from(ensureAdminIds(room))
    .filter((id) => !auto.has(id))
    .sort((a, b) => (room.users.get(a)?.joinedAt || 0) - (room.users.get(b)?.joinedAt || 0));
}

function getOnlineAppointedAdminIds(room) {
  return getAppointedAdminIds(room).filter((id) => isEligibleOwner(room.users.get(id)));
}

function isAppointedAdmin(room, userId) {
  if (!userId) return false;
  pruneAdminIds(room);
  if (!ensureAdminIds(room).has(userId)) return false;
  return !ensureAutoPromotedAdminIds(room).has(userId);
}

function isAutoPromotedAdmin(room, userId) {
  if (!userId) return false;
  return ensureAutoPromotedAdminIds(room).has(userId) && ensureAdminIds(room).has(userId);
}

function rememberUserNickname(room, userId, nickname) {
  const nick = normalizeNickname(nickname);
  if (!userId || !nick) return;
  if (!room.userNicknames) room.userNicknames = new Map();
  room.userNicknames.set(userId, nick);
}

/** base64 头像（客户端已压到 128px）上限，与客户端 avatarImage.ts 保持一致 */
const MAX_AVATAR_DATA_URL_LENGTH = 200 * 1024;
/** 房间封面轻度压缩（约 512px / q≈0.96），与客户端 roomCoverImage.ts 保持一致 */
const MAX_CUSTOM_COVER_DATA_URL_LENGTH = 800 * 1024;

/** 头像取值：jpg/png 的 base64 data URL（限长），或兼容旧的 http(s) 链接；非法值归空 */
function normalizeAvatarUrl(avatarUrl) {
  const raw = String(avatarUrl || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) {
    if (!/^data:image\/(jpeg|png);base64,/.test(raw)) return "";
    if (raw.length > MAX_AVATAR_DATA_URL_LENGTH) return "";
    return raw;
  }
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw.slice(0, 500);
}

/** 房间自定义封面：空字符串表示取消自定义、跟随当前歌曲封面 */
function normalizeCustomCoverUrl(coverUrl) {
  const raw = String(coverUrl || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) {
    if (!/^data:image\/(jpeg|png);base64,/.test(raw)) return "";
    if (raw.length > MAX_CUSTOM_COVER_DATA_URL_LENGTH) return "";
    return raw;
  }
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw.slice(0, 500);
}

function rememberUserAvatar(room, userId, avatarUrl) {
  if (!userId) return;
  if (!room.userAvatarUrls) room.userAvatarUrls = new Map();
  const url = normalizeAvatarUrl(avatarUrl);
  if (url) room.userAvatarUrls.set(userId, url);
  else room.userAvatarUrls.delete(userId);
}

/** 管理端广播/进房 ACK 仅需当前相关用户昵称，避免历史访客 Map（可上千条）撑爆载荷 */
function serializeUserNicknamesForViewer(room) {
  const map = room.userNicknames;
  if (!map?.size) return undefined;

  const needed = new Set();
  for (const user of room.users.values()) {
    if (user?.id) needed.add(user.id);
  }
  for (const id of getOrderedAdminIds(room)) needed.add(id);
  if (room.creatorId) needed.add(room.creatorId);
  if (room.ownerId) needed.add(room.ownerId);
  for (const id of room.mutedUserIds || []) needed.add(id);
  if (room.memberTiers instanceof Map) {
    for (const id of room.memberTiers.keys()) needed.add(id);
  } else if (room.memberTiers && typeof room.memberTiers === "object") {
    for (const id of Object.keys(room.memberTiers)) needed.add(id);
  }
  for (const item of room.queue || []) {
    if (item?.requestedById) needed.add(item.requestedById);
  }
  if (room.current?.requestedById) needed.add(room.current.requestedById);

  const out = {};
  for (const id of needed) {
    const nick = map.get(id);
    if (nick) out[id] = nick;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 序列化用户头像 URL，仅当前在线用户 + 相关身份，避免历史 Map 膨胀载荷 */
function serializeUserAvatarUrlsForViewer(room) {
  const map = room.userAvatarUrls;
  if (!map?.size) return undefined;

  const needed = new Set();
  for (const user of room.users.values()) {
    if (user?.id) needed.add(user.id);
  }
  for (const id of getOrderedAdminIds(room)) needed.add(id);
  if (room.creatorId) needed.add(room.creatorId);
  if (room.ownerId) needed.add(room.ownerId);

  const out = {};
  for (const id of needed) {
    const url = map.get(id);
    if (url) out[id] = url;
  }
  return Object.keys(out).length ? out : undefined;
}

function resolveStoredNickname(room, userId) {
  const online = room.users.get(userId);
  if (online?.nickname) return online.nickname;
  const stored = room.userNicknames?.get(userId);
  if (stored) return stored;
  for (let i = room.messages.length - 1; i >= 0; i -= 1) {
    const message = room.messages[i];
    if (message.userId === userId && message.nickname) return message.nickname;
  }
  return "用户";
}

function getOnlineAdminIds(room) {
  return getOrderedAdminIds(room).filter((id) => isEligibleOwner(room.users.get(id)));
}

/** 对外 adminIds：仅房主指定的正式管理（不含自动提升） */
function getOrderedAdminIds(room) {
  return getAppointedAdminIds(room);
}

function getOrderedAutoPromotedAdminIds(room) {
  pruneAdminIds(room);
  const admins = ensureAdminIds(room);
  return Array.from(ensureAutoPromotedAdminIds(room))
    .filter((id) => admins.has(id))
    .sort((a, b) => (room.users.get(a)?.joinedAt || 0) - (room.users.get(b)?.joinedAt || 0));
}

function isAdminUser(room, userId) {
  if (!userId) return false;
  pruneAdminIds(room);
  return room.adminIds.has(userId);
}

function canControlPlayback(room, userId) {
  if (!room || !userId) return false;
  const user = room.users.get(userId);
  if (!isEligibleOwner(user)) return false;
  if (isRoomCreator(room, userId)) return true;
  return isAdminUser(room, userId);
}

/** 管理权（踢人/禁言/公告等）：仅创建者与正式指定管理；临时自动提升只有播放控制权 */
function canModerate(room, userId) {
  if (!room || !userId) return false;
  const user = room.users.get(userId);
  if (!isEligibleOwner(user)) return false;
  if (isRoomCreator(room, userId)) return true;
  return isAppointedAdmin(room, userId);
}

/** 操作者必须在线且 connectionId 属于本人，防止串连接提权（connectionId 必填） */
function isActorConnection(room, userId, connectionId = null) {
  const user = room.users.get(userId);
  if (!isEligibleOwner(user)) return false;
  if (connectionId == null || connectionId === "") return false;
  const ids = user.connectionIds;
  return Boolean((ids && ids.has(connectionId)) || user.connectionId === connectionId);
}

function requireModerator(room, actorId, connectionId = null) {
  if (!canModerate(room, actorId)) return { error: "仅房主或管理员可操作" };
  if (!isActorConnection(room, actorId, connectionId)) return { error: "会话无效，请刷新后重试" };
  return null;
}

function requireCreator(room, actorId, connectionId = null) {
  if (!isCreatorConnection(room, actorId, connectionId)) {
    return { error: "仅房间创建者可操作" };
  }
  return null;
}

function canUserRequestSong(room, userId) {
  if (!room || !userId) return false;
  if (room.songRequestEnabled !== false) return true;
  return canControlPlayback(room, userId);
}

const MAX_ANNOUNCEMENT_LENGTH = 2000;
const MAX_SONG_REQUEST_MIN_STAY_SEC = 24 * 60 * 60;
const MAX_SONG_REQUEST_PER_USER = 50;

function normalizeJoinNoticeCooldownSec(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_JOIN_NOTICE_COOLDOWN_SEC;
  }
  const sec = Math.floor(Number(value));
  if (!Number.isFinite(sec) || sec < 0) return DEFAULT_JOIN_NOTICE_COOLDOWN_SEC;
  return Math.min(sec, MAX_JOIN_NOTICE_COOLDOWN_SEC);
}

function normalizeSongRequestMinStaySec(value) {
  const sec = Math.floor(Number(value) || 0);
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return Math.min(sec, MAX_SONG_REQUEST_MIN_STAY_SEC);
}

function normalizeSongRequestMaxPerUser(value) {
  const count = Math.floor(Number(value) || 0);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(count, MAX_SONG_REQUEST_PER_USER);
}

function normalizeSongRequestCooldownSec(value) {
  const sec = Math.floor(Number(value) || 0);
  if (!ALLOWED_SONG_REQUEST_COOLDOWNS_SEC.includes(sec)) return 0;
  return sec;
}

export function normalizePlaybackRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= MIN_PLAYBACK_RATE && rate <= MAX_PLAYBACK_RATE
    ? rate
    : DEFAULT_PLAYBACK_RATE;
}

function normalizeQueueMaxLength(value) {
  const length = Math.floor(Number(value) || DEFAULT_QUEUE_MAX_LENGTH);
  if (!ALLOWED_QUEUE_MAX_LENGTHS.includes(length)) return DEFAULT_QUEUE_MAX_LENGTH;
  return length;
}

function normalizeDislikeSkipThreshold(value) {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count < 1) return DEFAULT_DISLIKE_SKIP_THRESHOLD;
  return Math.min(count, MAX_DISLIKE_SKIP_THRESHOLD);
}

function normalizeDislikeSkipMode(value) {
  return value === "percent" ? "percent" : "count";
}

function normalizeDislikeSkipPercent(value) {
  const pct = Math.floor(Number(value));
  if (!Number.isFinite(pct) || pct < 1) return DEFAULT_DISLIKE_SKIP_PERCENT;
  return Math.min(pct, 100);
}

function resolveDislikeSkipThreshold(room) {
  const mode = normalizeDislikeSkipMode(room?.dislikeSkipMode);
  if (mode === "percent") {
    const userCount = Math.max(1, room.users?.size ?? 0);
    const percent = normalizeDislikeSkipPercent(room.dislikeSkipPercent);
    return Math.max(1, Math.ceil((userCount * percent) / 100));
  }
  return normalizeDislikeSkipThreshold(room.dislikeSkipThreshold);
}

function normalizeClearSongsOnLeaveDelaySec(value) {
  const sec = Math.floor(Number(value));
  if (!Number.isFinite(sec) || sec < 0) return DEFAULT_CLEAR_SONGS_ON_LEAVE_DELAY_SEC;
  return Math.min(sec, MAX_CLEAR_SONGS_ON_LEAVE_DELAY_SEC);
}

function ensurePendingLeaveClears(room) {
  if (!room.pendingLeaveClears) room.pendingLeaveClears = new Map();
  return room.pendingLeaveClears;
}

function cancelPendingLeaveClear(room, userId) {
  const pending = ensurePendingLeaveClears(room);
  const timer = pending.get(userId);
  if (timer) {
    clearTimeout(timer);
    pending.delete(userId);
  }
}

function clearAllPendingLeaveClears(room) {
  const pending = ensurePendingLeaveClears(room);
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
}

function removeUserSongsFromQueue(room, userId) {
  if (!room || !userId) return false;
  const removedIds = new Set();
  for (const item of room.queue) {
    if (item.requestedById === userId) removedIds.add(item.queueId);
  }
  if (removedIds.size === 0) return false;
  room.queue = room.queue.filter((item) => item.requestedById !== userId);
  room.jumpRequests = room.jumpRequests.filter((r) => !removedIds.has(r.queueId));
  return true;
}

function scheduleClearUserSongsOnLeave(room, userId) {
  if (!room?.clearSongsOnLeaveEnabled || !userId) return;
  cancelPendingLeaveClear(room, userId);
  const delayMs = normalizeClearSongsOnLeaveDelaySec(room.clearSongsOnLeaveDelaySec) * 1000;
  const pending = ensurePendingLeaveClears(room);
  const timer = setTimeout(() => {
    pending.delete(userId);
    const current = rooms.get(room.id);
    if (!current || current.users.has(userId)) return;
    if (!removeUserSongsFromQueue(current, userId)) return;
    persistRoom(current);
    notifyRoomStructureChanged(current.id);
  }, delayMs);
  pending.set(userId, timer);
}

function getRoomQueueMaxLength(room) {
  return normalizeQueueMaxLength(room?.queueMaxLength);
}

function ensureLastSongRequestAt(room) {
  if (!room.lastSongRequestAt) room.lastSongRequestAt = new Map();
  return room.lastSongRequestAt;
}

function ensureBannedSongs(room) {
  if (!Array.isArray(room.bannedSongs)) room.bannedSongs = [];
  return room.bannedSongs;
}

function normalizeForbiddenWord(word) {
  return String(word || "")
    .trim()
    .toLowerCase();
}

function serializeForbiddenWord(entry) {
  const word = String(entry?.word || "")
    .trim()
    .slice(0, MAX_FORBIDDEN_WORD_LEN);
  if (!word) return null;
  return {
    word,
    isDefault: Boolean(entry?.isDefault),
    addedAt: Number(entry?.addedAt) || Date.now(),
  };
}

function sortForbiddenWords(list) {
  return [...list].sort((a, b) => {
    const aDefault = Boolean(a.isDefault);
    const bDefault = Boolean(b.isDefault);
    if (aDefault !== bDefault) return aDefault ? 1 : -1;
    return (Number(a.addedAt) || 0) - (Number(b.addedAt) || 0);
  });
}

function serializeForbiddenWords(list) {
  const source = Array.isArray(list) ? list : [];
  const seen = new Set();
  const result = [];
  for (const entry of source) {
    const item = serializeForbiddenWord(entry);
    if (!item) continue;
    const key = normalizeForbiddenWord(item.word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= MAX_FORBIDDEN_WORDS) break;
  }
  return sortForbiddenWords(result);
}

function createDefaultForbiddenWords(now = Date.now()) {
  return serializeForbiddenWords(
    DEFAULT_FORBIDDEN_WORDS.map((word, index) => ({
      word,
      isDefault: true,
      addedAt: now + index,
    })),
  );
}

/**
 * 旧房间无此字段时种入默认词；已有数组（含空数组）表示房主已管理过，原样恢复。
 */
function restoreForbiddenWords(list) {
  if (list === undefined || list === null) {
    return createDefaultForbiddenWords();
  }
  return serializeForbiddenWords(Array.isArray(list) ? list : []);
}

function ensureForbiddenWords(room) {
  if (!Array.isArray(room.forbiddenWords)) {
    room.forbiddenWords = createDefaultForbiddenWords();
  }
  return room.forbiddenWords;
}

function findForbiddenWordInText(room, text) {
  const content = String(text || "");
  if (!content) return null;
  const lowered = content.toLowerCase();
  for (const entry of ensureForbiddenWords(room)) {
    const word = String(entry?.word || "").trim();
    if (!word) continue;
    if (lowered.includes(word.toLowerCase())) return word;
  }
  return null;
}

function normalizeBannedSongName(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function serializeBannedSong(entry) {
  const name = String(entry?.name || "")
    .trim()
    .slice(0, 120);
  if (!name) return null;
  return {
    source: String(entry.source || "netease"),
    id: String(entry.id || name),
    name,
    artist: String(entry.artist || "").slice(0, 120),
    bannedAt: Number(entry.bannedAt) || Date.now(),
  };
}

function serializeBannedSongs(list) {
  return ensureBannedSongs({ bannedSongs: list }).map(serializeBannedSong).filter(Boolean).slice(0, MAX_BANNED_SONGS);
}

function restoreBannedSongs(list) {
  return serializeBannedSongs(Array.isArray(list) ? list : []);
}

function isSongBanned(room, song) {
  const name = normalizeBannedSongName(song?.name);
  if (!name) return false;
  return ensureBannedSongs(room).some((entry) => normalizeBannedSongName(entry.name) === name);
}

function formatSongRequestCooldownError(remainSec) {
  const sec = Math.ceil(Math.max(1, remainSec));
  return `点歌冷却中，还需等待 ${sec} 秒`;
}

function trimQueueToMaxLength(room) {
  const maxLength = getRoomQueueMaxLength(room);
  if (room.queue.length <= maxLength) return;
  sortQueueByPriority(room);
  room.queue.splice(maxLength);
}

function countUserRequestedSongs(room, userId) {
  const user = room.users.get(userId);
  let count = 0;
  if (room.current && isQueueRequester(room.current, userId, user)) count += 1;
  for (const item of room.queue) {
    if (isQueueRequester(item, userId, user)) count += 1;
  }
  return count;
}

function formatSongRequestMinStayError(remainSec) {
  const sec = Math.ceil(Math.max(1, remainSec));
  if (sec < 60) return `还需等待 ${sec} 秒才能点歌`;
  const minutes = Math.ceil(sec / 60);
  return minutes <= 1 ? "还需等待 1 分钟才能点歌" : `还需等待 ${minutes} 分钟才能点歌`;
}

function removeUserFromAdmins(room, userId) {
  if (!userId) return;
  ensureAdminIds(room).delete(userId);
  ensureAutoPromotedAdminIds(room).delete(userId);
}

function sanitizeCreatorId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : "";
}

/** 记录房间创建者（首个可操控的非只读用户，或由创建房间 API 指定，持久保留；仅可通过 transferOwner 变更） */
function ensureCreatorId(room, userId) {
  if (room.creatorId) return;
  const safeId = sanitizeCreatorId(userId);
  if (!safeId) return;
  const user = room.users.get(safeId);
  if (isEligibleOwner(user)) {
    room.creatorId = safeId;
  }
}

/**
 * 刷新播放主控：初创房主在线时由其驱动；离线时由正式指定管理接管。
 * 指定管理回到房间时，立刻收回自动提升的临时管理。
 * 仅当房主与正式管理都不在时，才临时提升最早进房的成员（播放控制 + 管理角标）。
 */
function refreshRoomOwner(room, options = {}) {
  const { preferCreator = false } = options;

  const creator = room.creatorId ? room.users.get(room.creatorId) : null;
  const creatorOnline = isEligibleOwner(creator);

  if ((preferCreator || creatorOnline) && creatorOnline) {
    revokeAutoPromotedAdmins(room);
    room.ownerId = room.creatorId;
    refreshOwnerConnection(room);
    return;
  }

  const onlineAppointed = getOnlineAppointedAdminIds(room);
  if (onlineAppointed.length > 0) {
    // 指定管理已在场：收回所有临时自动提升
    revokeAutoPromotedAdmins(room);
    room.ownerId = onlineAppointed[0];
    refreshOwnerConnection(room);
    return;
  }

  // 仍有在线临时管理时只保留最早一人，其余收回
  const onlineTemps = getOrderedAutoPromotedAdminIds(room).filter((id) => isEligibleOwner(room.users.get(id)));
  if (onlineTemps.length > 0) {
    const keepId = onlineTemps[0];
    ensureSingleAutoPromotedAdmin(room, keepId);
    room.ownerId = keepId;
    refreshOwnerConnection(room);
    return;
  }

  const nextId = getNextOwnerId(room);
  if (nextId) {
    // 先清空旧临时管理，再只提升一人
    revokeAutoPromotedAdmins(room);
    ensureAdminIds(room).add(nextId);
    ensureAutoPromotedAdminIds(room).add(nextId);
    room.ownerId = nextId;
  } else {
    revokeAutoPromotedAdmins(room);
    room.ownerId = null;
  }
  refreshOwnerConnection(room);

  // 兜底：主控离线或未设置时，强制从在线成员提升（防止房间无主控）
  if (!isEligibleOwner(room.users.get(room.ownerId))) {
    const fallbackId = getNextOwnerId(room);
    if (fallbackId) {
      revokeAutoPromotedAdmins(room);
      if (fallbackId !== room.creatorId && !isAppointedAdmin(room, fallbackId)) {
        ensureAdminIds(room).add(fallbackId);
        ensureAutoPromotedAdminIds(room).add(fallbackId);
      }
      room.ownerId = fallbackId;
      refreshOwnerConnection(room);
    }
  }
}

function getDefaultNickname(room) {
  const used = new Set(Array.from(room.users.values()).map((user) => user.nickname));
  for (let i = 1; i <= room.users.size + 100; i++) {
    const nickname = `听众${i}`;
    if (!used.has(nickname)) return nickname;
  }
  return `听众${Date.now().toString(36).slice(-4)}`;
}

function getRandomNickname(room, userId = null) {
  for (let i = 0; i < 24; i += 1) {
    const seed = Math.random().toString(36).slice(2, 6);
    const nickname = ensureUniqueNickname(room, userId, `听众${seed}`);
    if (nickname) return nickname;
  }
  return ensureUniqueNickname(room, userId, getDefaultNickname(room));
}

function getOwnerConnectionId(room) {
  const owner = room.ownerId ? room.users.get(room.ownerId) : null;
  return owner?.connectionIds?.values().next().value || owner?.connectionId || null;
}

function refreshOwnerConnection(room) {
  room.ownerConnectionId = getOwnerConnectionId(room);
}

function normalizeConnectionIds(existing, connectionId) {
  const ids = new Set(existing?.connectionIds || []);
  if (existing?.connectionId) ids.add(existing.connectionId);
  if (connectionId) ids.add(connectionId);
  return ids;
}

function freezePlayback(room) {
  if (!room?.current || !room.isPlaying) return;
  room.currentTime = getPlaybackTime(room);
  room.isPlaying = false;
  room.startedAt = null;
  bumpPlaybackState(room);
}

function getSongDurationSeconds(song) {
  const duration = Number(song?.duration || 0);
  if (Number.isFinite(duration) && duration > 0) {
    // Meting/汽水漫游有时返回秒，房间内部统一按毫秒处理。
    const durationMs = duration < 10_000 ? duration * 1000 : duration;
    return durationMs / 1000;
  }
  return 0;
}

function normalizeSongDurationMs(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  return Math.round(duration < 10_000 ? duration * 1000 : duration);
}

export function createRoom({ name, password, creatorId, creatorDeviceId, creatorIp } = {}) {
  const pwd = validateRoomPassword(password);
  if (!pwd.ok) return { error: pwd.error };

  let roomId;
  do {
    roomId = generateRoomId();
  } while (rooms.has(roomId));

  const trimmed = pwd.password;
  const passwordHash = trimmed ? hashPassword(trimmed) : null;
  const room = createEmptyRoom(roomId, name, passwordHash);
  room.passwordPlain = trimmed || null;
  const reservedCreator = sanitizeCreatorId(creatorId);
  if (reservedCreator) {
    room.creatorId = reservedCreator;
    room.creatorDeviceId = sanitizeCreatorId(creatorDeviceId) || null;
  }
  const ip = String(creatorIp || "").trim().slice(0, 64);
  if (ip) room.creatorIp = ip;
  rooms.set(roomId, room);
  persistRoom(room);
  invalidateRoomsListCache();
  // 创建后若无人进房，按空房 TTL 自动销毁，避免只建不进导致后台堆积
  scheduleRoomDestroy(roomId);
  return serializeRoom(room);
}

function roomOwnedBy({ room, creatorId, creatorDeviceId }) {
  const uid = sanitizeCreatorId(creatorId);
  const did = sanitizeCreatorId(creatorDeviceId);
  if (!uid && !did) return false;
  const matchUser = uid && room.creatorId === uid;
  const matchDid = did && room.creatorDeviceId === did;
  return Boolean(matchUser || matchDid);
}

/**
 * 统计该身份当前仍存在的自建房间数（含有人/有曲的房间；不含常驻保护房）。
 */
export function countOwnedRooms({ creatorId, creatorDeviceId } = {}) {
  let count = 0;
  for (const room of rooms.values()) {
    if (protectedRoomIds.has(room.id)) continue;
    if (!roomOwnedBy({ room, creatorId, creatorDeviceId })) continue;
    count += 1;
  }
  return count;
}

/**
 * 查找该身份已创建、仍空闲（无人）的房间。
 * 无人即可复用；残留当前曲/队列在 reuseIdleOwnedRoom 时清空。
 * 仅按 userId / deviceId 匹配。
 */
export function findIdleOwnedRoom({ creatorId, creatorDeviceId } = {}) {
  const uid = sanitizeCreatorId(creatorId);
  const did = sanitizeCreatorId(creatorDeviceId);
  if (!uid && !did) return null;

  let best = null;
  for (const room of rooms.values()) {
    if (protectedRoomIds.has(room.id)) continue;
    // 只要有人在就不复用（含自己还在房里）
    if (room.users.size > 0) continue;
    if (!roomOwnedBy({ room, creatorId: uid, creatorDeviceId: did })) continue;
    if (!best || (Number(room.createdAt) || 0) > (Number(best.createdAt) || 0)) {
      best = room;
    }
  }
  return best ? serializeRoom(best) : null;
}

/**
 * 复用空闲自建房：可更新名称/密码，清空残留播放状态，并重新挂销毁倒计时。
 */
export function reuseIdleOwnedRoom(roomId, { name, password } = {}) {
  const id = String(roomId || "").toUpperCase();
  const room = rooms.get(id);
  if (!room) return null;
  if (room.users.size > 0) return null;

  if (name !== undefined) {
    room.name = normalizeRoomName(name, room.id);
  }
  if (password !== undefined) {
    const pwd = validateRoomPassword(password);
    if (!pwd.ok) return { error: pwd.error };
    const trimmed = pwd.password;
    room.passwordHash = trimmed ? hashPassword(trimmed) : null;
    room.passwordPlain = trimmed || null;
  }

  // 当作新建：清掉上次残留的曲目/播放状态，避免「空房却无法复用」
  room.queue = [];
  room.current = null;
  room.isPlaying = false;
  room.currentTime = 0;
  room.startedAt = null;
  room.randomLoading = false;
  room.skipRequests = [];
  // 复用后沿用漫游配置，但不能沿用旧会话的预取歌曲，否则首首可能来自旧音源。
  clearNextRandom(room);
  room.playbackVersion = (room.playbackVersion || 0) + 1;
  room.playbackUpdatedAt = Date.now();

  persistRoom(room);
  invalidateRoomsListCache();
  scheduleRoomDestroy(room.id);
  return serializeRoom(room);
}

const coverResolveInflight = new Map();
/** 解析失败负缓存，避免每次 listRooms 都打慢上游 */
const coverResolveFailedAt = new Map();
const COVER_RESOLVE_FAIL_TTL_MS = 2 * 60 * 1000;

function normalizeDirectCoverInPlace(song) {
  if (!song || !isDirectCoverUrl(song.pic)) return false;
  const normalized = resizeCoverForThumb(String(song.pic).trim(), 96) || String(song.pic).trim();
  if (normalized === song.pic) return false;
  song.pic = normalized;
  return true;
}

/**
 * 解析当前曲封面为 CDN 直链。成功返回 true（已写入 song.pic）。
 * 不阻塞大厅列表：由 scheduleLobbyCoverResolve 后台调用。
 */
async function ensureCurrentSongCover(room) {
  const song = room.current;
  if (!song?.id) return false;

  if (isDirectCoverUrl(song.pic)) {
    if (normalizeDirectCoverInPlace(song)) persistRoom(room);
    return true;
  }

  const key = `${song.source || "netease"}:${song.id}`;
  const failedAt = coverResolveFailedAt.get(key);
  if (failedAt && Date.now() - failedAt < COVER_RESOLVE_FAIL_TTL_MS) {
    return false;
  }

  let pending = coverResolveInflight.get(key);
  if (!pending) {
    pending = resolveSongCoverUrl(song.source || "netease", song.id, 96)
      .catch(() => "")
      .finally(() => {
        coverResolveInflight.delete(key);
      });
    coverResolveInflight.set(key, pending);
  }

  const url = await pending;
  if (!url) {
    coverResolveFailedAt.set(key, Date.now());
    return false;
  }
  coverResolveFailedAt.delete(key);
  if (room.current !== song) return false;
  song.pic = url;
  persistRoom(room);
  return true;
}

/** 后台补齐封面；成功后失效列表缓存，下一轮轮询即可带图 */
function scheduleLobbyCoverResolve(room) {
  const song = room.current;
  if (!song?.id) return;
  if (isDirectCoverUrl(song.pic)) {
    if (normalizeDirectCoverInPlace(song)) persistRoom(room);
    return;
  }
  const key = `${song.source || "netease"}:${song.id}`;
  if (coverResolveInflight.has(key)) return;
  const failedAt = coverResolveFailedAt.get(key);
  if (failedAt && Date.now() - failedAt < COVER_RESOLVE_FAIL_TTL_MS) return;

  void ensureCurrentSongCover(room).then((resolved) => {
    if (resolved) invalidateRoomsListCache();
  });
}

export async function listRooms(userId = '') {
  const now = Date.now();
  if (cachedListRooms && now - cachedListRoomsAt < LIST_ROOMS_CACHE_MS) {
    return personalizeLobbyRooms(cachedListRooms, userId);
  }

  const visible = Array.from(rooms.values()).filter(isRoomVisibleInLobby);
  // 不阻塞响应：已有直链同步规范化，缺封面后台解析
  for (const room of visible) {
    scheduleLobbyCoverResolve(room);
  }

  cachedListRooms = visible
    .map(serializeRoomSummary)
    .sort((a, b) => {
      // 大厅：开放播放 → … → 密码锁 → 无密码硬锁（不可进）最后
      const typeRank = (room) => {
        if (room.isLocked && !room.hasPassword) return 4;
        const locked = room.isLocked || room.hasPassword ? 1 : 0;
        const paused = room.isPlaying ? 0 : 1;
        return locked * 2 + paused;
      };
      const typeDiff = typeRank(a) - typeRank(b);
      if (typeDiff !== 0) return typeDiff;
      return b.userCount - a.userCount || b.createdAt - a.createdAt;
    });
  cachedListRoomsAt = Date.now();
  return personalizeLobbyRooms(cachedListRooms, userId);
}

function randomMatchRoomWeight(room) {
  const userCount = room.users.size;
  const activeScore = room.isPlaying && room.current ? 12 : room.current ? 8 : 0;
  const crowdScore = Math.min(userCount, 8) * 3;
  const queueScore = Math.min(room.queue.length, 12) * 0.75;
  const freshnessScore = Math.max(0, 6 - Math.floor((Date.now() - (Number(room.createdAt) || 0)) / (30 * 60 * 1000)));
  return Math.max(1, 1 + activeScore + crowdScore + queueScore + freshnessScore);
}

function isRoomRandomMatchable(room) {
  if (!isRoomVisibleInLobby(room)) return false;
  // 无人房间无法交接房主体验，随机匹配只带用户进入已有成员在线的房间。
  if (room.users.size <= 0) return false;
  // 随机匹配只进入无需凭据的公开房，避免把用户带到锁房/密码页。
  if (room.isLocked || room.passwordHash) return false;
  return true;
}

export function findRandomMatchRoom(userId = '') {
  const candidates = Array.from(rooms.values()).filter(isRoomRandomMatchable);
  if (candidates.length === 0) return null;

  const weighted = candidates.map((room) => ({ room, weight: randomMatchRoomWeight(room) }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let pick = Math.random() * total;
  let selected = weighted[weighted.length - 1].room;
  for (const item of weighted) {
    pick -= item.weight;
    if (pick <= 0) {
      selected = item.room;
      break;
    }
  }

  scheduleLobbyCoverResolve(selected);
  return personalizeLobbyRooms([serializeRoomSummary(selected)], userId)[0] || null;
}

function personalizeLobbyRooms(list, userId) {
  const normalizedUserId = String(userId || '').trim();
  return list.map(({ ownerId, adminIds, ...room }) => ({
    ...room,
    ...(normalizedUserId
      ? {
          isOwner: ownerId === normalizedUserId,
          isAdmin: Array.isArray(adminIds)
            ? adminIds.includes(normalizedUserId)
            : Boolean(adminIds?.has?.(normalizedUserId)),
        }
      : {}),
  }));
}

export function listRoomIds() {
  return Array.from(rooms.keys());
}

// 管理后台：全量房间列表（不过滤大厅隐藏房间，附带成员昵称）
export function listRoomsForAdmin() {
  return Array.from(rooms.values())
    .map((room) => {
      // 旧房间无 lastJoinedAt 时，用在线成员进房时间 / 创建时间兜底
      const onlineJoinedAt = Array.from(room.users.values())
        .filter((u) => !u.readOnly)
        .reduce((max, u) => Math.max(max, Number(u.joinedAt) || 0), 0);
      const lastJoinedAt = Math.max(
        Number(room.lastJoinedAt) || 0,
        onlineJoinedAt,
        Number(room.createdAt) || 0,
      ) || null;
      return {
        id: room.id,
        name: room.name,
        userCount: room.users.size,
        users: Array.from(room.users.values()).map((u) => ({
          id: u.id,
          nickname: u.nickname,
          clientIp: u.clientIp || "",
          deviceId: u.deviceId || "",
          readOnly: Boolean(u.readOnly),
        })),
        hasPassword: Boolean(room.passwordHash),
        isLocked: Boolean(room.isLocked),
        isPlaying: room.isPlaying,
        currentSong: room.current ? { name: room.current.name, artist: room.current.artist } : null,
        queueLength: room.queue.length,
        createdAt: room.createdAt,
        lastJoinedAt,
        protectedFromDestroy: protectedRoomIds.has(room.id),
        permanentApplication: null,
        creatorId: room.creatorId || null,
        creatorDeviceId: room.creatorDeviceId || null,
        creatorIp: room.creatorIp || null,
        ownerLastJoinedAt: resolveAdminOwnerLastJoinedAt(room),
        creatorNickname: (() => {
          const oid = room.creatorId || room.ownerId;
          if (!oid) return "";
          return (
            room.users.get(oid)?.nickname
            || room.userNicknames?.get(oid)
            || ""
          );
        })(),
        ownerNickname: (() => {
          const oid = room.ownerId || room.creatorId;
          if (!oid) return "";
          return (
            room.users.get(oid)?.nickname
            || room.userNicknames?.get(oid)
            || ""
          );
        })(),
      };
    })
    .sort((a, b) => {
      const aProtected = a.protectedFromDestroy ? 0 : 1;
      const bProtected = b.protectedFromDestroy ? 0 : 1;
      if (aProtected !== bProtected) return aProtected - bProtected;
      if (a.userCount !== b.userCount) return b.userCount - a.userCount;
      return (b.lastJoinedAt || 0) - (a.lastJoinedAt || 0);
    });
}

/** 管理后台按需查看房间明文密码（不进列表；调用方须自行审计） */
export function getRoomPasswordForAdmin(roomId) {
  const id = String(roomId || "").toUpperCase();
  const room = rooms.get(id);
  if (!room) return { error: "房间不存在" };
  if (!room.passwordHash) {
    return { roomId: id, hasPassword: false, password: null };
  }
  return {
    roomId: id,
    hasPassword: true,
    // 旧房间可能只有哈希、无明文（升级前设置的密码）
    password: room.passwordPlain || null,
  };
}

/** 管理后台房间列表（含常驻申请，待审优先） */
export async function listRoomsForAdminDetailed() {
  const base = listRoomsForAdmin();
  const apps = await listPermanentApplications();
  const byId = new Map(apps.map((item) => [item.roomId, item]));
  return base
    .map((room) => {
      const app = byId.get(room.id);
      return {
        ...room,
        permanentApplication: app
          ? {
              status: app.status,
              appliedAt: app.appliedAt,
              applicantNickname: app.applicantNickname,
              note: app.note || "",
              applicantId: app.applicantId,
            }
          : null,
      };
    })
    .sort((a, b) => {
      const aProtected = a.protectedFromDestroy ? 0 : 1;
      const bProtected = b.protectedFromDestroy ? 0 : 1;
      if (aProtected !== bProtected) return aProtected - bProtected;
      if (a.userCount !== b.userCount) return b.userCount - a.userCount;
      return (b.lastJoinedAt || 0) - (a.lastJoinedAt || 0);
    });
}

/** 房主申请房间常驻（空房不销毁） */
export async function requestRoomPermanent(roomId, actorId, connectionId = null, note = "") {
  const room = rooms.get(roomId?.toUpperCase?.() ? roomId.toUpperCase() : String(roomId || "").toUpperCase());
  if (!room) return { error: "房间不存在" };
  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  const user = room.users.get(actorId);
  const result = await applyPermanentResidence({
    roomId: room.id,
    roomName: room.name,
    applicantId: actorId,
    applicantNickname: user?.nickname || "房主",
    note,
    alreadyProtected: protectedRoomIds.has(room.id),
  });
  if (!result.success) return { error: result.error };
  return {
    room: serializeRoom(room, { forUserId: actorId }),
    application: toPublicPermanentApplication(result.application),
  };
}

/** 房主撤销常驻申请 */
export async function cancelRoomPermanentRequest(roomId, actorId, connectionId = null) {
  const id = String(roomId || "").toUpperCase();
  const room = rooms.get(id);
  if (!room) return { error: "房间不存在" };
  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  const result = await cancelPermanentApplication(id, actorId);
  if (!result.success) return { error: result.error };
  return { room: serializeRoom(room, { forUserId: actorId }) };
}

/** 管理后台审核常驻申请 */
export async function reviewRoomPermanentApplication(roomId, { approved, reason } = {}) {
  const id = String(roomId || "").toUpperCase();
  const result = await reviewPermanentApplication({ roomId: id, approved, reason });
  if (!result.success) return { success: false, error: result.error };

  if (result.approved) {
    const protect = await setRoomProtectedFromDestroy(id, true);
    if (!protect.success) {
      // 审核记录已清，尽量补回申请态不现实；返回错误让管理员手动保活
      return { success: false, error: protect.error || "通过失败：无法写入常驻状态" };
    }
  }

  return {
    success: true,
    approved: result.approved,
    notice: result.notice,
    application: result.application,
    protectedFromDestroy: protectedRoomIds.has(id),
  };
}

/** 管理后台：设置房间是否跳过无人超时销毁。 */
export async function setRoomProtectedFromDestroy(roomId, enabled) {
  const id = String(roomId || "")
    .trim()
    .toUpperCase();
  const room = rooms.get(id);
  if (!room) return { success: false, error: "房间不存在" };

  const next = Boolean(enabled);
  const redis = getRedisClient();
  if (redis) {
    try {
      if (next) await redis.sAdd(PROTECTED_ROOMS_REDIS_KEY, id);
      else await redis.sRem(PROTECTED_ROOMS_REDIS_KEY, id);
    } catch (err) {
      console.error(`Redis: 更新房间 ${id} 保活状态失败:`, err.message);
      return { success: false, error: "Redis 保存失败，请稍后重试" };
    }
  }

  if (next) {
    protectedRoomIds.add(id);
    cancelRoomDestroy(room);
    // 确保空房也已有持久化快照，重启后可以恢复。
    persistRoom(room);
  } else {
    protectedRoomIds.delete(id);
    if (room.users.size === 0) scheduleRoomDestroy(id);
  }

  return { success: true, roomId: id, protectedFromDestroy: next };
}

  // 管理后台：立即解散房间（调用方负责先踢出房内 socket）
export function adminDestroyRoom(roomId) {
  const id = roomId?.toUpperCase();
  const room = rooms.get(id);
  if (!room) return { success: false, error: "房间不存在" };
  const name = room.name;
  cancelRoomDestroy(room);
  clearAllPendingLeaveClears(room);
  clearSkipRequestExpiryTimersForRoom(id);
  protectedRoomIds.delete(id);
  const redis = getRedisClient();
  if (redis) {
    void redis.sRem(PROTECTED_ROOMS_REDIS_KEY, id).catch((err) => console.error(`Redis: 清理房间 ${id} 保活状态失败:`, err.message));
  }
  void clearPermanentApplicationForRoom(id);
  rooms.delete(id);
  invalidateRoomsListCache();
  void deleteRoomChatImages(id).catch((err) => console.error(`删除房间 ${id} 聊天图片失败:`, err));
  void deleteRoomFromStorage(id).catch((err) => console.error(`删除房间 ${id} 存储失败:`, err));
  clearRoomAiContext(id);
  clearRoomAiUserState(id);
  return { success: true, name };
}

/**
 * 房主手动解散鉴权
 */
export function assertOwnerCanDestroyRoom(roomId, actorId, connectionId) {
  const id = String(roomId || "").toUpperCase();
  const room = rooms.get(id);
  if (!room) return { ok: false, error: "房间不存在" };

  const uid = sanitizeCreatorId(actorId);
  if (!uid) return { ok: false, error: "会话无效，请刷新后重试" };
  if (!connectionId) return { ok: false, error: "会话无效，请刷新后重试" };

  const denied = requireCreator(room, uid, connectionId);
  if (denied) return { ok: false, error: denied.error || "仅房主可解散房间" };

  const user = room.users.get(uid);
  if (!isEligibleOwner(user)) {
    return { ok: false, error: "仅房主可解散房间" };
  }

  return { ok: true, roomId: id, name: room.name };
}

/**
 * 管理后台：向所有活跃房间广播持久化系统通知（落盘进聊天历史，样式同撤回提示行）。
 * @returns {{ success: boolean, error?: string, roomCount?: number, deliveries?: Array<{ roomId: string, message: object, toast: object }> }}
 */
export function broadcastAdminSystemMessage(text, { roomIds } = {}) {
  const content = String(text || "")
    .trim()
    .slice(0, 300);
  if (!content) return { success: false, error: "广播内容不能为空" };

  const targetRooms = roomIds?.length
    ? roomIds.map((id) => rooms.get(String(id).toUpperCase())).filter(Boolean)
    : Array.from(rooms.values());

  const deliveries = [];
  for (const room of targetRooms) {
    const message = {
      id: generateId(),
      userId: "system",
      nickname: "站点通知",
      text: content,
      kind: "recall",
      mentions: [],
      replyTo: null,
      timestamp: Date.now(),
    };
    room.messages.push(message);
    if (room.messages.length > MAX_CHAT_MESSAGES) {
      room.messages.splice(0, room.messages.length - MAX_CHAT_MESSAGES);
    }
    persistRoom(room);

    const wire = serializeChatMessage(message, { roomId: room.id });
    deliveries.push({
      roomId: room.id,
      message: wire,
      // 额外发一条短暂 toast，不进历史
      toast: {
        ...wire,
        id: `${wire.id}-toast`,
        kind: "system",
        nickname: "系统",
      },
    });
  }

  return { success: true, roomCount: deliveries.length, deliveries };
}

export function getRoomPublic(roomId) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return null;
  return {
    id: room.id,
    name: room.name,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    userCount: room.users.size,
    isPlaying: room.isPlaying,
    currentSong: room.current ? { name: room.current.name, artist: room.current.artist } : null,
    queueLength: room.queue.length,
    createdAt: room.createdAt,
  };
}

export function getRoom(roomId) {
  const room = rooms.get(roomId?.toUpperCase());
  return room ? serializeRoom(room) : null;
}

/** 查找用户当前所在房间（用于音源失败日志归因） */
export function findUserRoomPresence(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  for (const room of rooms.values()) {
    const user = room.users.get(id);
    if (!user) continue;
    return {
      userId: id,
      userNickname: String(user.nickname || '').slice(0, 40),
      roomId: room.id,
      roomName: String(room.name || room.id).slice(0, 60),
    };
  }
  return null;
}

export function roomExists(roomId) {
  return rooms.has(roomId?.toUpperCase());
}

export function isUserBanned(roomId, userId, deviceId = null) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room || !userId) return false;
  return isAccessBanned(room, userId, deviceId);
}

function restoreChatVisibleSinceMap(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object") return map;
  for (const [userId, value] of Object.entries(raw)) {
    const ts = Number(value);
    if (userId && Number.isFinite(ts) && ts > 0) map.set(userId, ts);
  }
  return map;
}

/** 新用户首进时间戳：默认只看进房之后的消息；房间开启「历史可见」时不截断 */
function resolveChatVisibleSince(room, userId, existingUser) {
  if (!room.chatVisibleSinceByUserId) room.chatVisibleSinceByUserId = new Map();

  if (room.chatHistoryVisibleOnJoin) {
    room.chatVisibleSinceByUserId.delete(userId);
    return 0;
  }

  const stored = room.chatVisibleSinceByUserId.get(userId);
  if (Number.isFinite(stored) && stored > 0) return stored;
  if (Number.isFinite(existingUser?.chatVisibleSince) && existingUser.chatVisibleSince > 0) {
    room.chatVisibleSinceByUserId.set(userId, existingUser.chatVisibleSince);
    return existingUser.chatVisibleSince;
  }
  const since = Date.now();
  room.chatVisibleSinceByUserId.set(userId, since);
  return since;
}

function countActiveUsersByDevice(room, deviceId, excludeUserId = null) {
  if (!room || !deviceId) return 0;
  let count = 0;
  for (const [userId, user] of room.users) {
    if (excludeUserId && userId === excludeUserId) continue;
    if (user.readOnly) continue;
    if (user.deviceId && user.deviceId === deviceId) count += 1;
  }
  return count;
}

export function addUser(roomId, userId, nickname, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const deviceId = options.deviceId || null;
  if (isAccessBanned(room, userId, deviceId)) {
    return { error: "你已被移出该房间，无法再次进入" };
  }

  cancelRoomDestroy(room);
  cancelPendingLeaveClear(room, userId);

  const existing = room.users.get(userId);
  const clientIp = String(options.clientIp || existing?.clientIp || "").trim() || null;
  if (deviceId && !options.readOnly) {
    const othersFromSameDevice = countActiveUsersByDevice(room, deviceId, userId);
    if (othersFromSameDevice >= MAX_ACCOUNTS_PER_DEVICE_PER_ROOM) {
      return { error: "同一设备最多 2 个账号同时在房间内，请先退出其他窗口后再试" };
    }
  }

  const connectionIds = normalizeConnectionIds(existing, options.connectionId || null);
  if (!room.knownUserIds) room.knownUserIds = new Set();
  room.knownUserIds.add(userId);

  const resolvedNickname = ensureUniqueNickname(room, userId, normalizeNickname(nickname) || existing?.nickname || getDefaultNickname(room));

  const readOnly = Boolean(options.readOnly);
  const chatVisibleSince = resolveChatVisibleSince(room, userId, existing);
  if (!readOnly) {
    room.ownerLastJoinedAtByUserId.set(userId, Date.now());
  }

  // 非 TV 进房刷新「最后进房时间」（含重连重进；多标签同会话也刷新无妨）
  if (!readOnly) {
    room.lastJoinedAt = Date.now();
    room.emptySince = null;
  }

  room.users.set(userId, {
    id: userId,
    nickname: resolvedNickname,
    readOnly,
    joinedAt: existing?.joinedAt || Date.now(),
    connectionId: options.connectionId || null,
    connectionIds,
    location: String(options.location || existing?.location || "")
      .trim()
      .slice(0, 12),
    clientIp,
    deviceId: options.deviceId || existing?.deviceId || null,
    chatVisibleSince,
  });
  const safeDeviceId = sanitizeCreatorId(deviceId);
  if (room.creatorId === userId && safeDeviceId && !room.creatorDeviceId) {
    // 兼容旧房间：原房主下一次正常进房时补记可信的 HttpOnly 设备身份。
    room.creatorDeviceId = safeDeviceId;
  }
  rememberUserNickname(room, userId, resolvedNickname);

  reassignOrphanQueueOwnership(room, userId, resolvedNickname);

  ensureCreatorId(room, userId);
  refreshRoomOwner(room, { preferCreator: room.creatorId === userId });
  if (room.creatorId === userId) {
    refreshOwnerConnection(room);
  }
  if (room.isPlaying && room.current && !room.startedAt) {
    room.startedAt = Date.now() - ((room.currentTime || 0) / normalizePlaybackRate(room.playbackRate)) * 1000;
  }

  persistRoom(room);
  invalidateRoomsListCache();
  return serializeRoom(room, { forUserId: userId });
}

function normalizeNickname(nickname) {
  return truncateByGrapheme(String(nickname || "").trim(), 20);
}

function getUsedNicknames(room, excludeUserId = null) {
  const used = new Set();
  for (const user of room.users.values()) {
    if (excludeUserId && user.id === excludeUserId) continue;
    if (user.nickname) used.add(user.nickname);
  }
  return used;
}

/** 房间内昵称唯一；重名时后进入者在原名后追加 1、2、3… */
function ensureUniqueNickname(room, userId, preferred) {
  const base = normalizeNickname(preferred);
  if (!base) return getDefaultNickname(room);

  const used = getUsedNicknames(room, userId);
  if (!used.has(base)) return base;

  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = truncateByGrapheme(`${base}${suffix}`, 20);
    if (!used.has(candidate)) return candidate;
  }

  return truncateByGrapheme(
    `${truncateByGrapheme(base, 14)}${Date.now().toString(36).slice(-5)}`,
    20,
  );
}

function updateRequesterNickname(item, socketId, nickname) {
  if (item?.requestedById === socketId) {
    item.requestedBy = nickname;
  }
}

function reassignOrphanQueueOwnership(room, userId, nickname) {
  const normalizedNick = normalizeNickname(nickname);
  if (!normalizedNick) return;

  const reclaim = (item) => {
    if (!item) return;
    if (item.requestedById === userId) {
      item.requestedBy = normalizedNick;
      return;
    }
    if (item.requestedById) return;
    if (item.requestedBy !== normalizedNick) return;
    const owners = Array.from(room.users.values()).filter((user) => user.nickname === normalizedNick);
    if (owners.length === 1 && owners[0].id === userId) {
      item.requestedById = userId;
    }
  };

  reclaim(room.current);
  room.queue.forEach(reclaim);
}

function isQueueRequester(item, socketId, user) {
  if (!item) return false;
  if (item.requestedById) return item.requestedById === socketId;
  return item.requestedBy === user?.nickname;
}

function isRoomCreator(room, userId) {
  return Boolean(room?.creatorId && userId === room.creatorId);
}

export function renameRoom(roomId, actorId, name, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  room.name = normalizeRoomName(name, room.id);
  persistRoom(room);
  invalidateRoomsListCache();
  return { room: serializeRoom(room) };
}

export function setRoomLock(roomId, actorId, options = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  const locked = Boolean(options.locked);
  if (!locked) {
    room.isLocked = false;
    room.passwordHash = null;
    room.passwordPlain = null;
  } else {
    const pwd = validateRoomPassword(options.password);
    if (!pwd.ok) return { error: pwd.error };
    room.isLocked = true;
    const trimmed = pwd.password;
    room.passwordHash = trimmed ? hashPassword(trimmed) : null;
    room.passwordPlain = trimmed || null;
  }

  persistRoom(room);
  invalidateRoomsListCache();
  return { room: serializeRoom(room) };
}

export function setRoomAdmin(roomId, actorId, targetUserId, admin = true, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  // 仅房间创建者可任免管理员；临时主控 / 自动提升不可升权
  if (!isCreatorConnection(room, actorId, connectionId)) {
    return { error: "仅房间创建者可设置管理员" };
  }

  const targetId = sanitizeCreatorId(targetUserId) || String(targetUserId || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: "无效用户" };
  if (targetId === actorId) return { error: "不能修改自己的管理员状态" };
  if (targetId === room.creatorId) return { error: "房主无需设为管理员" };

  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  const target = room.users.get(targetId);
  const targetLabel = resolveStoredNickname(room, targetId);
  const appointedCount = getAppointedAdminIds(room).length;

  if (admin) {
    if (!target) return { error: "用户不在房间中" };
    if (!isEligibleOwner(target)) return { error: "不能设置 TV 用户为管理员" };
    if (isAppointedAdmin(room, targetId)) {
      return { room: serializeRoom(room) };
    }
    if (appointedCount >= getRoomMaxAdmins(room)) {
      return { error: `管理员最多 ${getRoomMaxAdmins(room)} 人` };
    }
    admins.add(targetId);
    auto.delete(targetId);
  } else {
    if (!admins.has(targetId) && !auto.has(targetId)) {
      return { room: serializeRoom(room) };
    }
    admins.delete(targetId);
    auto.delete(targetId);
  }

  refreshRoomOwner(room);
  persistRoom(room);
  return {
    room: serializeRoom(room),
    message: admin ? `已将「${targetLabel}」设为管理员` : `已取消「${targetLabel}」的管理员`,
  };
}

export async function setRoomPlaylistRoaming(roomId, actorId, payload = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: "仅房主可设置指定歌单" };

  const hasDedupeByName = typeof payload?.dedupeByName === "boolean";
  const dedupeByName = payload?.dedupeByName === true;
  if (typeof payload?.playlistEnabled === "boolean") {
    if (!room.playlistRoaming) return { error: "请先指定至少一个歌单" };
    room.playlistRoaming = normalizePlaylistRoaming({ ...room.playlistRoaming, enabled: payload.playlistEnabled });
    room.randomPlayedKeys.clear();
    clearNextRandom(room);
    persistRoom(room);
    if (room.playlistRoaming.enabled && !room.current && room.queue.length === 0) void ensureNextRandom(room);
    return { room: serializeRoom(room) };
  }
  if (hasDedupeByName && !payload?.clear && !payload?.input) {
    if (!room.playlistRoaming) return { error: "请先指定至少一个歌单" };
    room.playlistRoaming = normalizePlaylistRoaming({
      ...room.playlistRoaming,
      dedupeByName,
    });
    room.randomPlayedKeys.clear();
    clearNextRandom(room);
    persistRoom(room);
    if (!room.current && room.queue.length === 0) void ensureNextRandom(room);
    return { room: serializeRoom(room) };
  }

  if (payload?.clear === true) {
    const playlistId = String(payload?.playlistId || "").trim();
    const playlistSource = normalizeFmSource(payload?.playlistSource);
    if (playlistId && room.playlistRoaming?.playlists) {
      room.playlistRoaming = normalizePlaylistRoaming({
        playlists: room.playlistRoaming.playlists.filter((playlist) => playlist.source !== playlistSource || playlist.id !== playlistId),
        dedupeByName: room.playlistRoaming.dedupeByName === true,
      });
    } else {
      room.playlistRoaming = null;
    }
    room.randomPlayedKeys.clear();
    clearNextRandom(room);
    persistRoom(room);
    if (!room.current && room.queue.length === 0) void ensureNextRandom(room);
    return { room: serializeRoom(room) };
  }

  const platform = String(payload?.platform || "").trim();
  const input = String(payload?.input || "").trim().slice(0, 2000);
  if (!input) return { error: "请粘贴歌单链接" };
  try {
    const imported = await importPlaylistForRoaming(platform, input);
    const playlist = normalizePlaylistRoamingEntry({
      id: imported.playlistId || input,
      source: imported.source,
      name: typeof payload?.playlistName === "string"
        ? payload.playlistName.trim().slice(0, 160)
        : "",
      url: typeof payload?.playlistName === "string" ? "" : input,
      songs: imported.songs,
    });
    if (!playlist) return { error: "歌单中没有可用歌曲" };
    const playlists = room.playlistRoaming?.playlists || [];
    room.playlistRoaming = normalizePlaylistRoaming({
      playlists: [...playlists.filter((item) => item.source !== playlist.source || item.id !== playlist.id), playlist],
      dedupeByName: hasDedupeByName ? dedupeByName : room.playlistRoaming?.dedupeByName === true,
    });
    room.randomPlayedKeys.clear();
    clearNextRandom(room);
    persistRoom(room);
    if (!room.current && room.queue.length === 0) void ensureNextRandom(room);
    return { room: serializeRoom(room) };
  } catch (error) {
    return { error: String(error?.message || "歌单加载失败").slice(0, 200) };
  }
}

export function setRoomFmMode(roomId, actorId, mode, connectionId = null, source = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: "仅房主可调整漫游模式" };

  let nextMode = normalizeFmMode(mode);
  const nextSource = normalizeFmSource(source ?? room.fmSource);
  // QQ、酷狗仅提供默认私人漫游；切换时强制 DEFAULT。
  if (["tencent", "kugou"].includes(nextSource) && nextMode !== FM_MODE_OFF) {
    nextMode = DEFAULT_FM_MODE;
  }
  if (room.neteaseFmMode === nextMode && normalizeFmSource(room.fmSource) === nextSource) {
    return { room: serializeRoom(room) };
  }

  // 记住关闭前的模式，重新开启时恢复
  if (nextMode === FM_MODE_OFF && room.neteaseFmMode !== FM_MODE_OFF) {
    room.fmModeBeforeOff = normalizeFmMode(room.neteaseFmMode);
  }
  room.neteaseFmMode = nextMode;
  room.fmSource = nextSource;
  // 切回私人漫游时只停用指定歌单，保留已加载歌单，便于稍后恢复。
  if (room.playlistRoaming && nextMode !== FM_MODE_OFF) {
    room.playlistRoaming = normalizePlaylistRoaming({ ...room.playlistRoaming, enabled: false });
  }
  clearNextRandom(room);
  persistRoom(room);

  if (!room.current && room.queue.length === 0) {
    void ensureNextRandom(room);
  }

  return { room: serializeRoom(room) };
}

/** 更新房间音源账号公开缓存（VIP Cookie 在 Meting；无 VIP Cookie 在 musicAccountSecrets） */
export function setRoomMusicAccountsCache(roomId, accounts) {
  const room = rooms.get(String(roomId || "").toUpperCase());
  if (!room) return { error: "房间不存在" };
  const next = normalizeMusicAccounts(accounts);
  // 刷新 VIP 列表时保留本地无 VIP 漫游账号元数据
  const prev = normalizeMusicAccounts(room.musicAccounts);
  for (const platform of ["netease", "tencent", "kugou", "qishui"]) {
    if (prev[platform]?.usage === "fm" && !next[platform]) {
      next[platform] = prev[platform];
    }
  }
  room.musicAccounts = next;
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function patchRoomMusicAccountCache(roomId, platform, account, options = {}) {
  const room = rooms.get(String(roomId || "").toUpperCase());
  if (!room) return { error: "房间不存在" };
  const plat = platform === "tencent" ? "tencent" : platform === "kugou" ? "kugou" : platform === "qishui" ? "qishui" : "netease";
  const next = normalizeMusicAccounts(room.musicAccounts);
  next[plat] = normalizeMusicAccountEntry(account);
  room.musicAccounts = next;

  const secrets = normalizeMusicAccountSecrets(room.musicAccountSecrets);
  if (Object.prototype.hasOwnProperty.call(options, "localCookie")) {
    secrets[plat] = String(options.localCookie || "").trim() || null;
  } else if (account == null) {
    secrets[plat] = null;
  }
  room.musicAccountSecrets = secrets;
  persistRoom(room);
  return { room: serializeRoom(room) };
}

/** 读取房间私有音源凭证，仅供服务端调用 Meting 定制接口。 */
export function getRoomMusicAccountCookie(roomId, platform) {
  const room = rooms.get(String(roomId || "").toUpperCase());
  if (!room) return null;
  const plat = platform === "tencent" ? "tencent" : platform === "kugou" ? "kugou" : platform === "qishui" ? "qishui" : "netease";
  return normalizeMusicAccountSecrets(room.musicAccountSecrets)[plat] || null;
}

export function getRoomNeteaseFmCookie(roomId) {
  const room = rooms.get(String(roomId || "").toUpperCase());
  if (!room) return null;
  const secret = normalizeMusicAccountSecrets(room.musicAccountSecrets).netease;
  if (!secret) return null;
  const meta = normalizeMusicAccounts(room.musicAccounts).netease;
  if (meta && meta.hasVip) return null;
  return secret;
}

export function getRoomFmCookie(roomId, platform) {
  const room = rooms.get(String(roomId || "").toUpperCase());
  if (!room) return null;
  const plat = platform === "qishui" ? "qishui" : platform === "kugou" ? "kugou" : platform === "tencent" ? "tencent" : "netease";
  const secret = normalizeMusicAccountSecrets(room.musicAccountSecrets)[plat];
  if (!secret) return null;
  const meta = normalizeMusicAccounts(room.musicAccounts)[plat];
  // 未共享账号统一走一次性私人漫游接口，避免使用公共账号池。
  if (meta?.shared === true) return null;
  return secret;
}

export function clearRoomMusicAccountSecret(roomId, platform = "netease") {
  const room = rooms.get(String(roomId || "").toUpperCase());
  if (!room) return { error: "房间不存在" };
  const secrets = normalizeMusicAccountSecrets(room.musicAccountSecrets);
  if (platform === "netease" || platform === "all") secrets.netease = null;
  if (platform === "tencent" || platform === "all") secrets.tencent = null;
  if (platform === "kugou" || platform === "all") secrets.kugou = null;
  if (platform === "qishui" || platform === "all") secrets.qishui = null;
  room.musicAccountSecrets = secrets;
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomPlayMode(roomId, actorId, mode, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isControllerConnection(room, actorId, connectionId)) {
    return { error: "仅房主或管理员可切换播放顺序" };
  }

  const nextMode = normalizePlayMode(mode);
  const sameMode = normalizePlayMode(room.playMode) === nextMode;
  room.playMode = nextMode;
  if (room.playMode !== "user-round-robin") {
    room.lastPlaybackRequesterId = null;
    room.playbackRequesterOrder = [];
  }
  room.favoriteShuffleUserId = nextMode === "favorite-shuffle" ? String(actorId || "").trim() || null : null;
  if (sameMode && nextMode !== "favorite-shuffle") {
    return { room: serializeRoom(room) };
  }
  clearNextRandom(room);
  room.randomBatch = [];
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomMemberTier(roomId, actorId, targetUserId, payload = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const userId = String(targetUserId || "").trim();
  if (!userId) return { error: "无效用户" };
  // 房主可管理所有人；管理员仅在房主开启后管理自己的贵宾标识。
  if (!isRoomCreator(room, actorId)) {
    if (!room.adminSelfManageMemberTierEnabled || userId !== actorId) {
      return { error: userId === actorId ? "仅房主可修改房主或管理员的贵宾设置" : "仅房主可修改其他用户的贵宾设置" };
    }
  }

  if (!room.memberTiers) room.memberTiers = new Map();
  const normalized = normalizeIncomingMemberTier(payload);
  room.memberTiers.set(
    userId,
    serializeMemberTier(userId, {
      ...normalized,
      assignedAt: Date.now(),
    }),
  );

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function removeRoomMemberTier(roomId, actorId, targetUserId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const userId = String(targetUserId || "").trim();
  if (!userId) return { error: "无效用户" };
  if (!isRoomCreator(room, actorId)) {
    if (!room.adminSelfManageMemberTierEnabled || userId !== actorId) {
      return { error: userId === actorId ? "仅房主可修改房主或管理员的贵宾设置" : "仅房主可修改其他用户的贵宾设置" };
    }
  }
  if (!room.memberTiers?.has(userId)) return { error: "该用户不是贵宾" };

  room.memberTiers.delete(userId);
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomAdminSelfManageMemberTier(roomId, actorId, enabled, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  room.adminSelfManageMemberTierEnabled = Boolean(enabled);
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomMemberSettings(roomId, actorId, settings = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  room.memberSettings = normalizeMemberSettings({
    ...normalizeMemberSettings(room.memberSettings),
    ...settings,
  });
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomPlaybackRate(roomId, actorId, playbackRate, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: "仅房主可设置播放倍速" };
  const nextRate = normalizePlaybackRate(playbackRate);
  if (Number(playbackRate) !== nextRate) return { error: "播放倍速无效" };
  const now = Date.now();
  if (room.current) {
    room.currentTime = getPlaybackTime(room);
    room.startedAt = room.isPlaying ? now - (room.currentTime / nextRate) * 1000 : null;
  }
  room.playbackRate = nextRate;
  bumpPlaybackState(room);
  persistRoom(room);
  return { room: serializeRoom(room), playbackRate: nextRate };
}

export function setRoomMaxAdmins(roomId, actorId, maxAdmins, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isCreatorConnection(room, actorId, connectionId)) {
    return { error: "仅房主可设置管理员人数" };
  }
  room.maxAdmins = normalizeMaxAdmins(maxAdmins);
  persistRoom(room);
  return { room: serializeRoom(room), maxAdmins: room.maxAdmins };
}

export function setRoomJoinNotice(roomId, actorId, settings = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: "仅房主可调整进房提醒" };

  if (settings.enabled !== undefined) {
    room.joinNoticeEnabled = Boolean(settings.enabled);
  }
  if (settings.cooldownSec !== undefined) {
    room.joinNoticeCooldownSec = normalizeJoinNoticeCooldownSec(settings.cooldownSec);
  }
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomAiSettings(roomId, actorId, settings = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: "仅房主可调整 AI 设置" };

  if (settings.enabled !== undefined) {
    room.roomAiEnabled = Boolean(settings.enabled);
  }
  if (settings.botName !== undefined) {
    room.roomAiBotName = normalizeRoomAiBotName(settings.botName);
  }
  persistRoom(room);
  return { room: serializeRoom(room) };
}

/** 进房前判断：是否为本房已知成员（须在 addUser 写入 knownUserIds 之前调用） */
export function wasKnownRoomUser(room, userId) {
  if (!room || !userId) return false;
  if (room.knownUserIds?.has(userId)) return true;
  if (room.userNicknames?.has(userId)) return true;
  if (room.memberTiers?.has(userId)) return true;
  if (room.creatorId === userId) return true;
  if (room.adminIds?.has(userId)) return true;
  return false;
}

/**
 * 是否应跳过进房系统提醒与贵宾迎宾。
 * - 同会话仍在线（hadActiveSession）
 * - 客户端「重新连接中」自动重进（rejoin）——不再要求 known，避免重启后身份未恢复仍刷屏
 * - 服务重启静默窗内的已知成员回流
 */
export function shouldMuteJoinAnnouncements(room, userId, {
  hadActiveSession = false,
  rejoin = false,
  wasKnown = false,
} = {}) {
  if (hadActiveSession) return true;
  // 「重新连接中」路径发出的 join：一律不发进房/贵宾通知
  if (rejoin) return true;
  const known = wasKnown || wasKnownRoomUser(room, userId);
  const muteUntil = Number(room?.restartNoticeMuteUntil) || 0;
  if (known && muteUntil > 0 && Date.now() < muteUntil) return true;
  return false;
}

export function postJoinNoticeMessage(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room || !userId || room.joinNoticeEnabled === false) return null;

  const user = room.users.get(userId);
  if (!user || user.readOnly) return null;

  if (!room.lastJoinNoticeAt) room.lastJoinNoticeAt = new Map();
  const now = Date.now();
  const cooldownMs = normalizeJoinNoticeCooldownSec(room.joinNoticeCooldownSec) * 1000;
  const lastNoticeAt = Number(room.lastJoinNoticeAt.get(userId)) || 0;
  if (cooldownMs > 0 && now - lastNoticeAt < cooldownMs) return null;

  room.lastJoinNoticeAt.set(userId, now);
  const nickname = formatActorName(user);
  const message = appendSystemChatMessage(room, `${nickname} 进入房间`);
  return message ? { ...message, kind: "notice" } : null;
}

const MEMBER_WELCOME_COOLDOWN_MS = 5 * 60 * 1000;

function hasRecentMemberWelcome(room, userId, cooldownMs = MEMBER_WELCOME_COOLDOWN_MS) {
  if (!room?.messages?.length || !userId) return false;
  if (!(cooldownMs > 0)) return false;
  const now = Date.now();
  for (let i = room.messages.length - 1; i >= 0; i -= 1) {
    const message = room.messages[i];
    if (message.kind !== "welcome" || message.targetUserId !== userId) continue;
    return now - message.timestamp < cooldownMs;
  }
  return false;
}

export function postMemberWelcomeMessage(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room || !userId) return null;

  const tier = room.memberTiers?.get(userId);
  if (!tier) return null;

  const settings = resolveMemberWelcomeSettings(tier, room.memberSettings);
  const welcomeOn = Boolean(settings.welcomeEnabled);
  const confettiOn = Boolean(settings.confettiEnabled);
  if (!welcomeOn && !confettiOn) return null;

  const cooldownMs = Math.max(0, Number(settings.welcomeCooldownSec) || 0) * 1000;
  if (hasRecentMemberWelcome(room, userId, cooldownMs)) return null;

  const user = room.users.get(userId);
  const nickname = user?.nickname || room.userNicknames?.get(userId) || "贵宾";
  const text = welcomeOn ? buildWelcomeText(settings, tier, nickname) : "";
  const message = {
    id: generateId(),
    userId: "system",
    nickname: "房间迎宾",
    text,
    kind: "welcome",
    mentions: [],
    replyTo: null,
    timestamp: Date.now(),
    memberTier: {
      badgeLabel: tier.badgeLabel,
      badgeColor: tier.badgeColor,
      borderStyleId: tier.borderStyleId,
      borderColor: tier.borderColor,
    },
    targetUserId: userId,
    targetNickname: nickname,
    confettiEnabled: confettiOn,
  };

  room.messages.push(message);
  if (room.messages.length > MAX_CHAT_MESSAGES) {
    room.messages.splice(0, room.messages.length - MAX_CHAT_MESSAGES);
  }
  persistRoom(room);
  return serializeChatMessage(message);
}

function formatSongTitle(song) {
  const name = String(song?.name || "").trim() || "未知歌曲";
  return `《${name.slice(0, 40)}》`;
}

function formatActorName(user) {
  return (
    String(user?.nickname || "匿名")
      .trim()
      .slice(0, 20) || "匿名"
  );
}

/** 聊天室顶部短暂系统提示（点歌/点赞等，不落盘、不进消息列表） */
function appendSystemChatMessage(room, text) {
  if (!room) return null;
  const content = String(text || "")
    .trim()
    .slice(0, 200);
  if (!content) return null;

  const message = {
    id: generateId(),
    userId: "system",
    nickname: "系统",
    text: content,
    kind: "system",
    mentions: [],
    replyTo: null,
    timestamp: Date.now(),
  };

  return serializeChatMessage(message);
}

/** 撤回提示：落盘并常驻聊天列表 */
function appendRecallChatMessage(room, text) {
  if (!room) return null;
  const content = String(text || "")
    .trim()
    .slice(0, 200);
  if (!content) return null;

  const message = {
    id: generateId(),
    userId: "system",
    nickname: "系统",
    text: content,
    kind: "recall",
    mentions: [],
    replyTo: null,
    timestamp: Date.now(),
  };

  room.messages.push(message);
  if (room.messages.length > MAX_CHAT_MESSAGES) {
    room.messages.splice(0, room.messages.length - MAX_CHAT_MESSAGES);
  }
  persistRoom(room);
  return serializeChatMessage(message);
}

function isUserChatMuted(room, userId) {
  if (!room || !userId) return false;
  if (isRoomCreator(room, userId)) return false;
  if (room.muteAll) return true;
  return room.mutedUserIds?.has(userId) ?? false;
}

const MENTION_ALL_LABEL = "全体成员";

function hasMentionAllInText(text) {
  return new RegExp(`@${MENTION_ALL_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(String(text || ""));
}

function buildMentionAllTargets(room, senderId) {
  return [...room.users.values()].filter((user) => user.id !== senderId && !user.readOnly).map((user) => ({ id: user.id, nickname: user.nickname || "匿名" }));
}

export function setChatMute(roomId, actorId, options = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  if (!room.mutedUserIds) room.mutedUserIds = new Set();

  if (options.muteAll !== undefined) {
    // 全体禁言：仅创建者；指定管理不可借此锁死房间
    if (!isRoomCreator(room, actorId)) {
      return { error: "仅房间创建者可设置全体禁言" };
    }
    room.muteAll = Boolean(options.muteAll);
  }

  if (options.userId && options.muted !== undefined) {
    const targetId = String(options.userId).trim();
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: "无效用户" };
    if (isRoomCreator(room, targetId)) {
      return { error: "不能禁言房间创建者" };
    }
    if (isAppointedAdmin(room, targetId) || isAutoPromotedAdmin(room, targetId)) {
      if (!isRoomCreator(room, actorId)) {
        return { error: "仅房主可禁言管理员" };
      }
    }
    // 解禁：仅创建者可解，防止管理撤销房主禁言实现「变相提权」
    if (!options.muted && !isRoomCreator(room, actorId)) {
      return { error: "仅房主可解除禁言" };
    }
    if (options.muted) {
      room.mutedUserIds.add(targetId);
    } else {
      room.mutedUserIds.delete(targetId);
    }
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomAnnouncement(roomId, actorId, options = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  if (options.enabled !== undefined) {
    room.announcementEnabled = Boolean(options.enabled);
  }
  if (options.text !== undefined) {
    room.announcementText = String(options.text || "")
      .trim()
      .slice(0, MAX_ANNOUNCEMENT_LENGTH);
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

/** 房主设置自定义封面；传空字符串取消自定义，恢复跟随当前歌曲 */
export function setRoomCustomCover(roomId, actorId, coverUrl, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  const next = normalizeCustomCoverUrl(coverUrl);
  if (String(coverUrl || "").trim() && !next) {
    return { error: "封面无效，请使用 JPG/PNG 图片或 http(s) 链接" };
  }

  room.customCoverUrl = next;
  persistRoom(room);
  invalidateRoomsListCache();
  return { room: serializeRoom(room) };
}

/** 进房是否可查看聊天历史 */
export function setChatHistoryVisibleOnJoin(roomId, actorId, enabled, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const next = Boolean(enabled);
  room.chatHistoryVisibleOnJoin = next;

  if (next) {
    // 开启后清除进房截断，当前在房成员也可立刻看到历史
    room.chatVisibleSinceByUserId = new Map();
    for (const user of room.users.values()) {
      user.chatVisibleSince = 0;
    }
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

/** 聊天室是否显示头像（仅房主） */
export function setChatShowAvatars(roomId, actorId, enabled, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isOwnerConnection(room, actorId, connectionId)) {
    return { error: "仅房主可设置聊天头像显示" };
  }

  room.chatShowAvatars = Boolean(enabled);
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setSongRequestEnabled(roomId, actorId, options = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  if (options.enabled !== undefined) {
    room.songRequestEnabled = Boolean(options.enabled);
  }
  if (options.minStaySec !== undefined) {
    room.songRequestMinStaySec = normalizeSongRequestMinStaySec(options.minStaySec);
  }
  if (options.maxPerUser !== undefined) {
    room.songRequestMaxPerUser = normalizeSongRequestMaxPerUser(options.maxPerUser);
  }
  if (options.cooldownSec !== undefined) {
    room.songRequestCooldownSec = normalizeSongRequestCooldownSec(options.cooldownSec);
  }
  if (options.queueMaxLength !== undefined) {
    room.queueMaxLength = normalizeQueueMaxLength(options.queueMaxLength);
    trimQueueToMaxLength(room);
  }
  if (options.memberJumpEnabled !== undefined) {
    room.memberJumpEnabled = Boolean(options.memberJumpEnabled);
  }
  if (options.memberSeekEnabled !== undefined) {
    room.memberSeekEnabled = Boolean(options.memberSeekEnabled);
  }
  if (options.memberPauseEnabled !== undefined) {
    room.memberPauseEnabled = Boolean(options.memberPauseEnabled);
  }
  if (options.systemMediaPlayBound !== undefined) {
    room.systemMediaPlayBound = Boolean(options.systemMediaPlayBound);
  }
  if (options.systemMediaSkipBound !== undefined) {
    room.systemMediaSkipBound = Boolean(options.systemMediaSkipBound);
  }
  if (options.dislikeSkipMode !== undefined) {
    room.dislikeSkipMode = normalizeDislikeSkipMode(options.dislikeSkipMode);
  }
  if (options.dislikeSkipThreshold !== undefined) {
    room.dislikeSkipThreshold = normalizeDislikeSkipThreshold(options.dislikeSkipThreshold);
  }
  if (options.dislikeSkipPercent !== undefined) {
    room.dislikeSkipPercent = normalizeDislikeSkipPercent(options.dislikeSkipPercent);
  }
  if (options.clearSongsOnLeaveEnabled !== undefined) {
    room.clearSongsOnLeaveEnabled = Boolean(options.clearSongsOnLeaveEnabled);
  }
  if (options.clearSongsOnLeaveDelaySec !== undefined) {
    room.clearSongsOnLeaveDelaySec = normalizeClearSongsOnLeaveDelaySec(options.clearSongsOnLeaveDelaySec);
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function banRoomSong(roomId, actorId, song, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const entry = serializeBannedSong({
    source: song?.source,
    id: song?.id,
    name: song?.name,
    artist: song?.artist,
    bannedAt: Date.now(),
  });
  if (!entry) return { error: "歌曲信息无效" };

  const bannedSongs = ensureBannedSongs(room);
  if (!isSongBanned(room, entry)) {
    if (bannedSongs.length >= MAX_BANNED_SONGS) {
      return { error: `禁播列表最多 ${MAX_BANNED_SONGS} 首` };
    }
    bannedSongs.push(entry);
  }

  const bannedName = normalizeBannedSongName(entry.name);
  room.queue = room.queue.filter((item) => normalizeBannedSongName(item.name) !== bannedName);

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function unbanRoomSong(roomId, actorId, name, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const normalized = normalizeBannedSongName(name);
  if (!normalized) return { error: "歌曲信息无效" };

  const before = ensureBannedSongs(room).length;
  room.bannedSongs = ensureBannedSongs(room).filter((entry) => normalizeBannedSongName(entry.name) !== normalized);
  if (room.bannedSongs.length === before) {
    return { error: "歌曲不在禁播列表中" };
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function addRoomForbiddenWord(roomId, actorId, word, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const entry = serializeForbiddenWord({
    word,
    isDefault: false,
    addedAt: Date.now(),
  });
  if (!entry) return { error: "请输入违禁词" };

  const list = ensureForbiddenWords(room);
  const key = normalizeForbiddenWord(entry.word);
  if (list.some((item) => normalizeForbiddenWord(item.word) === key)) {
    return { error: "该违禁词已存在" };
  }
  if (list.length >= MAX_FORBIDDEN_WORDS) {
    return { error: `违禁词最多 ${MAX_FORBIDDEN_WORDS} 个` };
  }

  list.push(entry);
  room.forbiddenWords = serializeForbiddenWords(list);
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function removeRoomForbiddenWord(roomId, actorId, word, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const key = normalizeForbiddenWord(word);
  if (!key) return { error: "违禁词无效" };

  const before = ensureForbiddenWords(room).length;
  room.forbiddenWords = ensureForbiddenWords(room).filter(
    (entry) => normalizeForbiddenWord(entry.word) !== key,
  );
  if (room.forbiddenWords.length === before) {
    return { error: "违禁词不在列表中" };
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

function applyNicknameToRoomState(room, userId, nextNickname) {
  const user = room.users.get(userId);
  if (user) user.nickname = nextNickname;
  rememberUserNickname(room, userId, nextNickname);
  updateRequesterNickname(room.current, userId, nextNickname);
  room.queue.forEach((item) => updateRequesterNickname(item, userId, nextNickname));
  room.jumpRequests.forEach((request) => {
    if (request.requestedBy === userId) request.nickname = nextNickname;
  });
  room.skipRequests.forEach((request) => {
    if (request.requestedBy === userId) request.nickname = nextNickname;
  });
  room.messages.forEach((message) => {
    if (message.userId === userId) {
      message.userId = userId;
      message.nickname = nextNickname;
    }
    if (message.reactions) {
      for (const users of Object.values(message.reactions)) {
        for (const entry of users) {
          if (entry.userId === userId) entry.nickname = nextNickname;
        }
      }
    }
  });
}

export function renameUser(roomId, socketId, nickname) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const user = room.users.get(socketId);
  if (!user) return { error: "未加入房间" };

  const nextNickname = ensureUniqueNickname(room, socketId, nickname);
  if (!nextNickname) return { error: "昵称不能为空" };
  if (isReservedBotNickname(nextNickname)) {
    return { error: "该昵称已被系统保留，请换一个" };
  }

  applyNicknameToRoomState(room, socketId, nextNickname);
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function adminRenameRoomUser(roomId, userId, nickname) {
  const id = String(roomId || "").toUpperCase();
  const uid = sanitizeCreatorId(userId);
  const room = rooms.get(id);
  if (!room) return { success: false, error: "房间不存在" };
  if (!uid) return { success: false, error: "用户不存在" };
  if (!room.users.has(uid) && !room.userNicknames?.has(uid)) {
    return { success: false, error: "用户不存在" };
  }

  const previousNickname = room.users.get(uid)?.nickname || room.userNicknames?.get(uid) || "";
  const nextNickname = ensureUniqueNickname(room, uid, nickname);
  if (!nextNickname) return { success: false, error: "昵称不能为空" };
  if (isReservedBotNickname(nextNickname)) {
    return { success: false, error: "该昵称已被系统保留，请换一个" };
  }

  applyNicknameToRoomState(room, uid, nextNickname);
  persistRoom(room);
  return {
    success: true,
    room: serializeRoom(room),
    previousNickname,
    nickname: nextNickname,
  };
}

export function adminResetRoomUserNickname(roomId, userId) {
  const id = String(roomId || "").toUpperCase();
  const uid = sanitizeCreatorId(userId);
  const room = rooms.get(id);
  if (!room) return { success: false, error: "房间不存在" };
  if (!uid) return { success: false, error: "用户不存在" };
  if (!room.users.has(uid) && !room.userNicknames?.has(uid)) {
    return { success: false, error: "用户不存在" };
  }

  const previousNickname = room.users.get(uid)?.nickname || room.userNicknames?.get(uid) || "";
  const nickname = getRandomNickname(room, uid);
  applyNicknameToRoomState(room, uid, nickname);
  persistRoom(room);
  return {
    success: true,
    room: serializeRoom(room),
    previousNickname,
    nickname,
  };
}

export function setUserAvatar(roomId, socketId, avatarUrl) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const user = room.users.get(socketId);
  if (!user) return { error: '未加入房间' };

  const raw = String(avatarUrl || '').trim();
  const url = normalizeAvatarUrl(raw);
  if (raw && !url) return { error: '头像格式不支持或图片过大' };
  rememberUserAvatar(room, socketId, url);
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export async function kickUser(roomId, actorId, targetUserId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;
  const targetId = String(targetUserId || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: "无效用户" };
  if (targetId === actorId) return { error: "不能踢出自己" };
  if (targetId === room.creatorId) return { error: "不能踢出房间创建者" };
  // 正式/临时管理均不可被普通管理员互踢；仅创建者可踢管理
  if ((isAppointedAdmin(room, targetId) || isAutoPromotedAdmin(room, targetId)) && !isRoomCreator(room, actorId)) {
    return { error: "仅房主可踢出管理员" };
  }

  const target = room.users.get(targetId);
  if (!target) return { error: "用户不在房间中" };

  if (!room.bannedUserIds) room.bannedUserIds = new Set();
  if (!room.bannedDeviceIds) room.bannedDeviceIds = new Set();
  room.bannedUserIds.add(targetId);

  const deviceIds = await collectDeviceIdsForUser(targetId);
  for (const did of deviceIds) {
    room.bannedDeviceIds.add(did);
  }

  room.users.delete(targetId);
  removeUserFromAdmins(room, targetId);

  if (room.users.size === 0) {
    clearAllPendingLeaveClears(room);
    // 最后一人被踢出：暂停播放（断线宽限期内刷新不会走到空房）
    freezePlayback(room);
    room.ownerId = null;
    room.ownerConnectionId = null;
    room.emptySince = Date.now();
    persistRoom(room);
    scheduleRoomDestroy(roomId);
    invalidateRoomsListCache();
    return {
      room: serializeRoom(room),
      kickedUserId: targetId,
      kickedNickname: target.nickname,
    };
  }

  refreshRoomOwner(room);
  if (!room.ownerId) {
    freezePlayback(room);
  }

  room.jumpRequests = room.jumpRequests.filter((r) => room.users.has(r.requestedBy));
  room.skipRequests = room.skipRequests.filter((r) => room.users.has(r.requestedBy));
  syncSkipRequestExpiryTimers(room);

  scheduleClearUserSongsOnLeave(room, targetId);

  persistRoom(room);
  invalidateRoomsListCache();
  return {
    room: serializeRoom(room),
    kickedUserId: targetId,
    kickedNickname: target.nickname,
  };
}

export function transferOwner(roomId, actorId, targetUserId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  const targetId = sanitizeCreatorId(targetUserId) || String(targetUserId || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: "无效用户" };
  if (targetId === actorId) return { error: "不能转让给自己" };
  if (targetId === room.creatorId) return { error: "对方已是房主" };

  const target = room.users.get(targetId);
  if (!target) return { error: "用户不在房间中" };
  if (!isEligibleOwner(target)) return { error: "不能转让给 TV / 只读用户" };

  const actor = room.users.get(actorId);
  const actorLabel = formatActorName(actor);
  const targetLabel = resolveStoredNickname(room, targetId);

  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);

  // 新房主不再保留管理员身份
  admins.delete(targetId);
  auto.delete(targetId);

  room.creatorId = targetId;
  // 同步设备绑定：否则原房主刷新进房时会因 creatorDeviceId 匹配被「恢复」为房主
  room.creatorDeviceId = sanitizeCreatorId(target.deviceId) || null;

  // 原房主降为正式管理员（名额允许时），避免转让后立刻失去管理权
  if (actorId && actorId !== targetId) {
    auto.delete(actorId);
    const appointedCount = getAppointedAdminIds(room).filter((id) => id !== actorId).length;
    if (appointedCount < getRoomMaxAdmins(room)) {
      admins.add(actorId);
    } else {
      admins.delete(actorId);
    }
  }

  refreshRoomOwner(room, { preferCreator: true });
  persistRoom(room);
  invalidateRoomsListCache();

  const systemMessage = appendSystemChatMessage(room, `${actorLabel} 将房主转让给了 ${targetLabel}`);

  return {
    room: serializeRoom(room),
    message: `已将房主转让给「${targetLabel}」`,
    systemMessage,
  };
}


/** 管理后台强制转让房主；不依赖原房主在线连接，但目标必须是在线可控成员。 */
export function adminTransferOwner(roomId, targetUserId) {
  const room = rooms.get(String(roomId || '').toUpperCase());
  if (!room) return { error: '房间不存在' };

  const targetId = sanitizeCreatorId(targetUserId) || String(targetUserId || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: '无效用户' };
  if (targetId === room.creatorId) return { error: '对方已是房主' };

  const target = room.users.get(targetId);
  if (!target) return { error: '用户不在房间中' };
  if (!isEligibleOwner(target)) return { error: '不能转让给 TV / 只读用户' };

  const previousOwnerId = room.creatorId;
  const previousOwnerLabel = resolveStoredNickname(room, previousOwnerId);
  const targetLabel = resolveStoredNickname(room, targetId);
  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);

  admins.delete(targetId);
  auto.delete(targetId);
  room.creatorId = targetId;
  room.creatorDeviceId = sanitizeCreatorId(target.deviceId) || null;

  if (previousOwnerId && previousOwnerId !== targetId) {
    auto.delete(previousOwnerId);
    if (getAppointedAdminIds(room).filter((id) => id !== previousOwnerId).length < getRoomMaxAdmins(room)) {
      admins.add(previousOwnerId);
    } else {
      admins.delete(previousOwnerId);
    }
  }

  refreshRoomOwner(room, { preferCreator: true });
  persistRoom(room);
  invalidateRoomsListCache();

  const systemMessage = appendSystemChatMessage(room, `站点管理员将房主从 ${previousOwnerLabel} 转让给了 ${targetLabel}`);
  return {
    room: serializeRoom(room),
    message: `已将房主转让给「${targetLabel}」`,
    systemMessage,
    previousOwnerNickname: previousOwnerLabel,
  };
}

/**
 * 外部身份找回房主。
 *
 * 第三方账号绑定的是创建者的内部 userId，而不是一张可永久夺回房间的凭证。
 * 因此房主已经通过前台或后台转让给其他人后，旧 creatorId 即使仍命中残留的
 * 绑定记录也必须被拒绝，不能覆盖已完成的转让。
 */
export function recoverRoomOwner(roomId, recoveredUserId, recoveryDeviceId = null) {
  const room = rooms.get(String(roomId || '').toUpperCase());
  if (!room) return { error: '房间不存在' };

  const targetId = sanitizeCreatorId(recoveredUserId) || String(recoveredUserId || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: '无效用户' };
  if (targetId === room.creatorId) return { ok: true, room: serializeRoom(room), changed: false };
  if (room.creatorId) return { error: '该身份已不再是当前房主' };
  if (!wasKnownRoomUser(room, targetId) && !room.users.has(targetId)) {
    return { error: '该身份不是当前房间成员' };
  }

  const previousOwnerId = room.creatorId;
  const previousOwnerLabel = resolveStoredNickname(room, previousOwnerId);
  const targetLabel = resolveStoredNickname(room, targetId);
  const target = room.users.get(targetId);
  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);

  admins.delete(targetId);
  auto.delete(targetId);
  room.creatorId = targetId;
  room.creatorDeviceId = sanitizeCreatorId(target?.deviceId || recoveryDeviceId) || null;

  if (previousOwnerId && previousOwnerId !== targetId) {
    auto.delete(previousOwnerId);
    if (getAppointedAdminIds(room).filter((id) => id !== previousOwnerId).length < getRoomMaxAdmins(room)) {
      admins.add(previousOwnerId);
    } else {
      admins.delete(previousOwnerId);
    }
  }

  refreshRoomOwner(room, { preferCreator: true });
  persistRoom(room);
  invalidateRoomsListCache();
  notifyRoomStructureChanged(room.id);
  const systemMessage = appendSystemChatMessage(room, `${previousOwnerLabel} 找回了房主身份，${targetLabel} 成为新房主`);
  return { ok: true, changed: true, room: serializeRoom(room), systemMessage, previousOwnerId };
}
export function removeUser(roomId, userId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const user = room.users.get(userId);
  if (connectionId && user?.connectionIds?.size && !user.connectionIds.has(connectionId)) {
    return { unchanged: true };
  }

  if (connectionId && user?.connectionIds) {
    user.connectionIds.delete(connectionId);
    if (user.connectionIds.size > 0) {
      if (user.connectionId === connectionId) {
        user.connectionId = user.connectionIds.values().next().value || null;
      }
      refreshOwnerConnection(room);
      persistRoom(room);
      invalidateRoomsListCache();
      // 用户仍在房内，仅少了一条连接：不触发全房 users 风暴
      return { unchanged: true };
    }
  }

  if (!user) return { unchanged: true };

  room.users.delete(userId);
  // 管理员身份在主动离房时保留，重进后恢复；仅踢人时清除（见 kickUser）

  if (room.users.size === 0) {
    clearAllPendingLeaveClears(room);
    // 最后一人退出：暂停播放并冻结进度。刷新有断线宽限期，不会误触空房。
    freezePlayback(room);
    room.ownerId = null;
    room.ownerConnectionId = null;
    room.emptySince = Date.now();
    persistRoom(room);
    scheduleRoomDestroy(roomId);
    invalidateRoomsListCache();
    return { empty: true, userRemoved: true };
  }

  refreshRoomOwner(room);
  if (!room.ownerId) {
    freezePlayback(room);
  }

  room.jumpRequests = room.jumpRequests.filter((r) => room.users.has(r.requestedBy));
  room.skipRequests = room.skipRequests.filter((r) => room.users.has(r.requestedBy));
  syncSkipRequestExpiryTimers(room);

  scheduleClearUserSongsOnLeave(room, userId);

  persistRoom(room);
  invalidateRoomsListCache();
  return { userRemoved: true, room: serializeRoom(room) };
}

export function updateUserLocation(roomId, userId, location) {
  const room = rooms.get(roomId);
  const user = room?.users.get(userId);
  if (!room || !user) return null;

  const nextLocation = String(location || "")
    .trim()
    .slice(0, 12);
  if (user.location === nextLocation) return null;

  user.location = nextLocation;
  // 定位不必立刻落盘，随下一次结构变更 persist 即可
  return true;
}

export function canUserMutate(roomId, userId) {
  const room = rooms.get(roomId);
  const user = room?.users.get(userId);
  return Boolean(room && user && !user.readOnly);
}

function isCreatorConnection(room, userId, connectionId = null) {
  if (!isRoomCreator(room, userId)) return false;
  // connectionId 必填：禁止仅凭 userId / 响应里的 creatorId 冒充房主操作
  return isActorConnection(room, userId, connectionId);
}

function isOwnerConnection(room, userId, connectionId = null) {
  return isCreatorConnection(room, userId, connectionId);
}

function isControllerConnection(room, userId, connectionId = null) {
  if (!canControlPlayback(room, userId)) return false;
  if (!isActorConnection(room, userId, connectionId)) return false;
  return true;
}

/** 房主/管理员始终可；开启 memberSeekEnabled 后普通成员也可调进度 */
function canSeekPlayback(room, userId, connectionId = null) {
  if (isControllerConnection(room, userId, connectionId)) return true;
  if (!room.memberSeekEnabled) return false;
  return isActorConnection(room, userId, connectionId);
}

/** 房主/管理员始终可；开启 memberPauseEnabled 后普通成员也可暂停/播放 */
function canPausePlayback(room, userId, connectionId = null) {
  if (isControllerConnection(room, userId, connectionId)) return true;
  if (!room.memberPauseEnabled) return false;
  return isActorConnection(room, userId, connectionId);
}

function songIdentity(source, id) {
  return `${source || "netease"}:${id}`;
}

function isSongInPlaylist(room, song) {
  const key = songIdentity(song.source, song.id);
  if (room.current && songIdentity(room.current.source, room.current.id) === key) {
    return true;
  }
  return room.queue.some((item) => songIdentity(item.source, item.id) === key);
}

function getQueueLikes(item) {
  return Array.isArray(item?.likedByIds) ? item.likedByIds.length : 0;
}

function queueHasManualOrder(room) {
  return (room.queue || []).some((song) => Number.isFinite(song?.manualOrder));
}

function reindexManualOrder(room) {
  room.queue.forEach((song, index) => {
    song.manualOrder = index;
  });
}

function sortQueueByPriority(room) {
  const lockedByDrag = queueHasManualOrder(room);
  room.queue.sort((a, b) => {
    // 拖拽排序锁定整队相对顺序，优先于点赞（点赞仍可点，只不再改序）
    if (lockedByDrag) {
      const aOrder = Number.isFinite(a.manualOrder) ? a.manualOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b.manualOrder) ? b.manualOrder : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    // 插队 / 单曲拖动标记，优先于点赞
    const priorityDiff = (b.ownerPriority || 0) - (a.ownerPriority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    if (!lockedByDrag) {
      const likeDiff = getQueueLikes(b) - getQueueLikes(a);
      if (likeDiff !== 0) return likeDiff;
    }
    return (a.addedAt || 0) - (b.addedAt || 0);
  });
}

export async function addToQueue(roomId, song, requestedByUser) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const requestedBy = {
    id: requestedByUser?.id || "",
    nickname: requestedByUser?.nickname || "匿名",
  };

  if (!canUserRequestSong(room, requestedBy.id)) {
    return { error: "房主已禁止点歌" };
  }

  if (!canControlPlayback(room, requestedBy.id)) {
    const user = room.users.get(requestedBy.id);
    const minStaySec = normalizeSongRequestMinStaySec(room.songRequestMinStaySec);
    if (minStaySec > 0 && user) {
      const stayedSec = (Date.now() - user.joinedAt) / 1000;
      if (stayedSec < minStaySec) {
        return { error: formatSongRequestMinStayError(minStaySec - stayedSec) };
      }
    }

    const maxPerUser = normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser);
    if (maxPerUser > 0) {
      const count = countUserRequestedSongs(room, requestedBy.id);
      if (count >= maxPerUser) {
        return { error: `每人最多 ${maxPerUser} 首待播，你已达上限` };
      }
    }

    const cooldownSec = normalizeSongRequestCooldownSec(room.songRequestCooldownSec);
    if (cooldownSec > 0) {
      const lastAt = ensureLastSongRequestAt(room).get(requestedBy.id) || 0;
      const elapsedSec = (Date.now() - lastAt) / 1000;
      if (lastAt > 0 && elapsedSec < cooldownSec) {
        return { error: formatSongRequestCooldownError(cooldownSec - elapsedSec) };
      }
    }
  }

  if (isSongBanned(room, song)) {
    return { error: "该歌曲已被禁播" };
  }

  if (isSongInPlaylist(room, song)) {
    return { error: "这首歌已经在歌单里啦" };
  }

  const queueMaxLength = getRoomQueueMaxLength(room);
  if (room.queue.length >= queueMaxLength) {
    return { error: `队列最多保留 ${queueMaxLength} 首歌` };
  }

  const hadManualOrder = queueHasManualOrder(room);
  const item = serializeQueueItemForRoom({
    queueId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...song,
    requestedBy: requestedBy.nickname,
    requestedById: requestedBy.id,
    addedAt: Date.now(),
    likedByIds: [],
    ownerPriority: 0,
  });

  room.queue.push(item);
  if (hadManualOrder) {
    item.manualOrder = room.queue.length - 1;
  }

  if (!canControlPlayback(room, requestedBy.id)) {
    const cooldownSec = normalizeSongRequestCooldownSec(room.songRequestCooldownSec);
    if (cooldownSec > 0) {
      ensureLastSongRequestAt(room).set(requestedBy.id, Date.now());
    }
  }

  if (!room.current) {
    await withPlaybackLock(room, async () => {
      if (!room.current) await playNextUnlocked(room, { allowFetchRandom: true });
    });
  }

  const systemMessage = appendSystemChatMessage(room, `${formatActorName(requestedBy)} 点了 ${formatSongTitle(item)}`);
  persistRoom(room);
  return { room: serializeRoom(room), systemMessage };
}

export function toggleQueueLike(roomId, userId, queueId) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const user = room.users.get(userId);
  if (!user) return { error: "未加入房间" };

  const item = room.queue.find((s) => s.queueId === queueId);
  if (!item) return { error: "只能点赞待播放歌曲" };

  const likedByIds = Array.isArray(item.likedByIds) ? item.likedByIds : [];
  const nextLiked = !likedByIds.includes(userId);
  if (nextLiked && isQueueRequester(item, userId, user)) {
    return { error: "不能给自己的歌点赞" };
  }
  item.likedByIds = nextLiked ? [...likedByIds, userId] : likedByIds.filter((id) => id !== userId);
  sortQueueByPriority(room);
  const systemMessage = nextLiked ? appendSystemChatMessage(room, `${formatActorName(user)} 点赞了 ${formatSongTitle(item)}`) : null;
  persistRoom(room);
  return {
    liked: nextLiked,
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
    systemMessage,
  };
}

export async function toggleCurrentDislike(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  const user = room.users.get(userId);
  if (!user) return { error: "未加入房间" };
  if (!room.current) return { error: "当前没有正在播放的歌曲" };

  const dislikedByIds = Array.isArray(room.current.dislikedByIds) ? room.current.dislikedByIds : [];
  const nextDisliked = !dislikedByIds.includes(userId);
  room.current.dislikedByIds = nextDisliked ? [...dislikedByIds, userId] : dislikedByIds.filter((id) => id !== userId);

  const songTitle = formatSongTitle(room.current);
  const mode = normalizeDislikeSkipMode(room.dislikeSkipMode);
  const threshold = resolveDislikeSkipThreshold(room);
  const dislikeCount = room.current.dislikedByIds.length;
  let skipped = false;
  let systemMessage = null;
  if (dislikeCount >= threshold) {
    await playNext(room, { allowFetchRandom: false, forceAdvance: true });
    skipped = true;
    systemMessage = appendSystemChatMessage(room, `踩歌达到人数，已切掉 ${songTitle}`);
  }

  persistRoom(room);
  return {
    disliked: nextDisliked,
    skipped,
    dislikeCount: skipped ? 0 : dislikeCount,
    threshold,
    dislikeSkipMode: mode,
    dislikeSkipPercent: normalizeDislikeSkipPercent(room.dislikeSkipPercent),
    roomUserCount: room.users.size,
    room: serializeRoom(room),
    systemMessage,
  };
}

export function removeFromQueue(roomId, socketId, queueId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const item = room.queue.find((s) => s.queueId === queueId);
  if (!item) return { error: "歌曲不在队列中" };

  const user = room.users.get(socketId);
  if (!isActorConnection(room, socketId, connectionId)) {
    return { error: "会话无效，请刷新后重试" };
  }
  const canManage = isControllerConnection(room, socketId, connectionId);
  const isRequester = isQueueRequester(item, socketId, user);
  if (!canManage && !isRequester) {
    return { error: "只能删除自己点的歌" };
  }

  const songTitle = formatSongTitle(item);
  room.queue = room.queue.filter((s) => s.queueId !== queueId);
  room.jumpRequests = room.jumpRequests.filter((r) => r.queueId !== queueId);
  if (queueHasManualOrder(room)) {
    reindexManualOrder(room);
  }
  const systemMessage = appendSystemChatMessage(room, `${formatActorName(user)} 移除了 ${songTitle}`);
  persistRoom(room);
  return { room: serializeRoom(room), systemMessage };
}

export function clearQueue(roomId, userId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  if (!isOwnerConnection(room, userId, connectionId)) {
    return { error: "仅房主可清空队列" };
  }

  room.queue = [];
  room.jumpRequests = room.current ? room.jumpRequests.filter((r) => r.queueId === room.current.queueId) : [];
  clearNextRandom(room);
  persistRoom(room);
  return { room: serializeRoom(room) };
}

// function trimRandomHistory(room) {
//   if (room.randomPlayedKeys.size <= MAX_RANDOM_HISTORY) return;
//   const excess = room.randomPlayedKeys.size - MAX_RANDOM_HISTORY;
//   const iter = room.randomPlayedKeys.values();
//   for (let i = 0; i < excess; i++) {
//     const key = iter.next().value;
//     if (key) room.randomPlayedKeys.delete(key);
//   }
// }

// function recordRandomPlayed(room, song) {
//   room.randomPlayedKeys.add(songIdentity(song.source, song.id));
//   trimRandomHistory(room);
// }

// function getRandomExcludeKeys(room) {
//   const exclude = new Set(room.randomPlayedKeys);
//   if (room.current?.requestedBy === '随机推荐') {
//     exclude.add(songIdentity(room.current.source, room.current.id));
//   }
//   if (room.nextRandom) {
//     exclude.add(songIdentity(room.nextRandom.source, room.nextRandom.id));
//   }
//   return exclude;
// }

function clearNextRandom(room) {
  room.nextRandom = null;
  room.nextRandomPromise = null;
  room.randomBatch = [];
}

// function trimRandomPlayedKeys(room, removeCount) {
//   if (room.randomPlayedKeys.size === 0) return;
//   const keys = Array.from(room.randomPlayedKeys);
//   const count = removeCount ?? Math.max(50, Math.ceil(keys.length / 2));
//   for (let i = 0; i < Math.min(count, keys.length); i++) {
//     room.randomPlayedKeys.delete(keys[i]);
//   }
// }

export function selectRandomFavoriteSong(favorites, currentSong = null, playedKeys = new Set(), random = Math.random) {
  const currentKey = currentSong?.source && currentSong?.id
    ? songIdentity(currentSong.source, currentSong.id)
    : '';
  const usable = (Array.isArray(favorites) ? favorites : []).filter((song) => song?.id && song?.source);
  const unplayed = usable.filter((song) => {
    const key = songIdentity(song.source, song.id);
    return key !== currentKey && !playedKeys.has(key);
  });
  const fallback = usable.filter((song) => songIdentity(song.source, song.id) !== currentKey);
  const pool = unplayed.length > 0
    ? unplayed
    : (fallback.length > 0 ? fallback : usable);
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))];
}

const PLAYLIST_SONG_SOURCE_PRIORITY = ["netease", "tencent", "qishui", "kugou"];

function playlistSongNameKey(song) {
  return String(song?.name || "").trim().toLocaleLowerCase();
}

function playlistSongPriority(song) {
  const index = PLAYLIST_SONG_SOURCE_PRIORITY.indexOf(normalizeFmSource(song?.source));
  return index === -1 ? PLAYLIST_SONG_SOURCE_PRIORITY.length : index;
}

function dedupePlaylistSongsByName(songs) {
  const preferredByName = new Map();
  for (const song of songs) {
    const nameKey = playlistSongNameKey(song);
    if (!nameKey) continue;
    const current = preferredByName.get(nameKey);
    if (!current || playlistSongPriority(song) < playlistSongPriority(current)) {
      preferredByName.set(nameKey, song);
    }
  }
  return Array.from(preferredByName.values());
}

/** 从指定歌单循环选歌；所有歌曲播放过后才重置本轮，绝不回退到私人漫游。 */
export function selectPlaylistRoamingSong(songs, currentSong = null, playedKeys = new Set(), random = Math.random, options = {}) {
  const usable = (Array.isArray(songs) ? songs : []).filter((song) => song?.id && song?.source);
  if (!options?.dedupeByName) return selectRandomFavoriteSong(usable, currentSong, playedKeys, random);

  const deduped = dedupePlaylistSongsByName(usable);
  const currentNameKey = playlistSongNameKey(currentSong);
  const playedNameKeys = new Set(
    usable
      .filter((song) => playedKeys.has(songIdentity(song.source, song.id)))
      .map(playlistSongNameKey)
      .filter(Boolean),
  );
  const unplayed = deduped.filter((song) => playlistSongNameKey(song) !== currentNameKey && !playedNameKeys.has(playlistSongNameKey(song)));
  const fallback = deduped.filter((song) => playlistSongNameKey(song) !== currentNameKey);
  const pool = unplayed.length > 0 ? unplayed : (fallback.length > 0 ? fallback : deduped);
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))];
}

async function fetchRandomForRoom(room) {
  if (room.playlistRoaming && room.playlistRoaming.enabled !== false) {
    const song = selectPlaylistRoamingSong(
      getPlaylistRoamingSongs(room.playlistRoaming),
      room.current,
      room.randomPlayedKeys,
      Math.random,
      { dedupeByName: room.playlistRoaming.dedupeByName === true },
    );
    if (!song) return null;
    return { ...song, requestedBy: "指定歌单", requestedById: "" };
  }
  if (!room.playlistRoaming && normalizePlayMode(room.playMode) === "favorite-shuffle") {
    if (!room.favoriteShuffleUserId) return null;
    const favorites = await listFavoriteSongs(room.favoriteShuffleUserId);
    const song = selectRandomFavoriteSong(favorites, room.current, room.randomPlayedKeys);
    if (!song) return null;
    return {
      ...song,
      requestedBy: "收藏随机",
      requestedById: "",
    };
  }
  if (Array.isArray(room.randomBatch) && room.randomBatch.length > 0) {
    return room.randomBatch.shift();
  }

  const source = normalizeFmSource(room.fmSource);
  const ephemeralCookie = getRoomFmCookie(room.id, source);
  const excludeIds = Array.from(room.randomPlayedKeys || [])
    .filter((key) => key.startsWith(`${source}:`))
    .map((key) => key.slice(source.length + 1));
  const songs = await fetchMetingFmSongs(room.neteaseFmMode || DEFAULT_FM_MODE, {
    roomId: room.id,
    roomName: room.name || room.id,
    ephemeralCookie: ephemeralCookie || '',
    source,
    excludeIds,
  });
  if (!Array.isArray(songs) || songs.length === 0) return null;
  room.randomBatch = songs.slice(1);
  return songs[0];
}

async function ensureNextRandom(room) {
  if (room.queue.length > 0) {
    clearNextRandom(room);
    return;
  }
  // 漫游已关闭：不预取，队列放空后自然停止
  if ((!room.playlistRoaming || room.playlistRoaming.enabled === false) && normalizePlayMode(room.playMode) !== "favorite-shuffle" && (room.neteaseFmMode || DEFAULT_FM_MODE) === FM_MODE_OFF) {
    clearNextRandom(room);
    return;
  }
  if (room.nextRandom || room.nextRandomPromise) return;

  room.nextRandomPromise = (async () => {
    try {
      for (let i = 0; i < MAX_RANDOM_PREFETCH_ATTEMPTS && room.queue.length === 0; i++) {
        const song = await fetchRandomForRoom(room);
        if (!song) break;

        const key = songIdentity(song.source, song.id);
        const currentKey = room.current ? songIdentity(room.current.source, room.current.id) : '';
        const nextKey = room.nextRandom ? songIdentity(room.nextRandom.source, room.nextRandom.id) : '';
        if (key === currentKey || key === nextKey || ((!room.playlistRoaming || room.playlistRoaming.enabled === false) && room.randomPlayedKeys.has(key))) continue;

        room.nextRandom = buildPendingRandomItem(song, song.requestedBy || "私人漫游", song.requestedById || "");
        break;
      }
      persistRoom(room);
      notifyRoomPrefetchReady(room);
    } finally {
      room.nextRandomPromise = null;
    }
  })();

  await room.nextRandomPromise;
}

async function withPlaybackLock(room, task) {
  const previous = room.playbackLock || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  room.playbackLock = current;
  try {
    return await current;
  } finally {
    if (room.playbackLock === current) {
      room.playbackLock = null;
    }
  }
}

function recordSongPlayHistory(room, song) {
  if (!song?.id || !song?.name) return;
  const playedAt = Date.now();
  room.songHistory = [
    serializeSongHistoryForClient({
      id: song.id,
      source: song.source,
      name: song.name,
      artist: song.artist,
      album: song.album,
      pic: song.pic,
      duration: normalizeSongDurationMs(song.duration),
      requestedBy: song.requestedBy || "私人漫游",
      requestedById: song.requestedById || "",
      requestedAt: playedAt,
    }),
    ...(room.songHistory || []),
  ].slice(0, MAX_SONG_HISTORY);
}

function setCurrentSong(room, song) {
  room.randomLoading = false;
  const next = serializeQueueItemForRoom(song);
  if (next) next.dislikedByIds = [];
  room.current = next;
  if ((song?.requestedBy === '私人漫游' || song?.requestedBy === '收藏随机' || song?.requestedBy === '指定歌单') && song?.id) {
    room.randomPlayedKeys.add(songIdentity(song.source, song.id));
    while (room.randomPlayedKeys.size > MAX_RANDOM_HISTORY) {
      const oldest = room.randomPlayedKeys.values().next().value;
      if (!oldest) break;
      room.randomPlayedKeys.delete(oldest);
    }
  }
  room.isPlaying = true;
  room.currentTime = 0;
  room.startedAt = Date.now();
  clearSharedPlaybackMedia(room);
  recordSongPlayHistory(room, song);
  bumpPlaybackState(room);
  invalidateRoomsListCache();
  // 切歌时预解析封面，大厅列表命中直链、无需等轮询再打上游
  scheduleLobbyCoverResolve(room);
  if (room.queue.length === 0) void ensureNextRandom(room);
}

function restartCurrentSong(room) {
  if (!room.current) return false;
  room.skipRequests = [];
  room.current.dislikedByIds = [];
  room.currentTime = 0;
  room.startedAt = Date.now();
  room.isPlaying = true;
  room.randomLoading = false;
  bumpPlaybackState(room);
  return true;
}

function takeNextFromQueue(room) {
  if (!room.queue.length) return null;
  const mode = normalizePlayMode(room.playMode);
  if (mode === "user-round-robin") {
    // 房主/管理员置顶是明确的人工指令，仍高于用户轮转和在线状态。
    const pinnedIndex = room.queue.findIndex((item) => Number(item.ownerPriority || 0) > 0);
    if (pinnedIndex >= 0) {
      return room.queue.splice(pinnedIndex, 1)[0] || null;
    }

    const queuedUserIds = [];
    const seen = new Set();
    for (const item of room.queue) {
      const userId = String(item.requestedById || "").trim();
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      queuedUserIds.push(userId);
    }
    if (!queuedUserIds.length) return null;
    room.playbackRequesterOrder = [
      ...room.playbackRequesterOrder,
      ...queuedUserIds.filter((userId) => !room.playbackRequesterOrder.includes(userId)),
    ];
    const onlineUserIds = queuedUserIds.filter((userId) => room.users.has(userId));
    // 仍有人在线时只消费在线用户的歌曲；所有点歌用户都离开后才回退消费离房用户的歌曲。
    const eligibleUserIds = onlineUserIds.length ? onlineUserIds : queuedUserIds;
    const orderedUsers = room.playbackRequesterOrder.filter((userId) => eligibleUserIds.includes(userId));
    const allOrder = room.playbackRequesterOrder;
    const previousIndex = allOrder.indexOf(room.lastPlaybackRequesterId);
    const rotatedAll = previousIndex >= 0 && allOrder.length > 1
      ? [...allOrder.slice(previousIndex + 1), ...allOrder.slice(0, previousIndex + 1)]
      : allOrder;
    const rotated = rotatedAll.filter((userId) => eligibleUserIds.includes(userId));
    const next = buildUserRoundRobinOrder(room.queue.filter((item) => eligibleUserIds.includes(item.requestedById)), { userOrder: rotated.length ? rotated : orderedUsers })[0];
    if (!next) return null;
    const index = room.queue.findIndex((item) => item.queueId === next.queueId);
    if (index >= 0) room.queue.splice(index, 1);
    room.lastPlaybackRequesterId = String(next.requestedById || "").trim() || null;
    return next;
  }
  if (mode === "shuffle" || mode === "shuffle-loop") {
    // 列表内随机：刚回收的那首排除在外，否则两首以上时会原地重播
    const excludeId = mode === "shuffle-loop" ? room.lastRecycledQueueId : null;
    const pool = excludeId
      ? room.queue.map((item, index) => index).filter((index) => room.queue[index]?.queueId !== excludeId)
      : room.queue.map((_, index) => index);
    // 房主/管理员置顶是明确的人工指令，优先级高于随机模式；多个置顶按置顶时间从早到晚消费。
    const prioritized = pool
      .filter((index) => Number(room.queue[index]?.ownerPriority || 0) > 0)
      .sort((a, b) => {
        const priorityDiff = Number(room.queue[a]?.ownerPriority || 0) - Number(room.queue[b]?.ownerPriority || 0);
        return priorityDiff || a - b;
      });
    const candidates = prioritized.length ? prioritized : (pool.length ? pool : room.queue.map((_, index) => index));
    const idx = prioritized.length ? candidates[0] : candidates[Math.floor(Math.random() * candidates.length)];
    return room.queue.splice(idx, 1)[0] || null;
  }
  return room.queue.shift() || null;
}

function recycleFinishedSongToQueue(room, finishedSong) {
  const mode = normalizePlayMode(room.playMode);
  if (!finishedSong || (mode !== "loop-all" && mode !== "shuffle-loop")) {
    room.lastRecycledQueueId = null;
    return;
  }
  const recycled = serializeQueueItemForRoom({
    ...finishedSong,
    queueId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dislikedByIds: [],
    likedByIds: Array.isArray(finishedSong.likedByIds) ? [...finishedSong.likedByIds] : [],
    ownerPriority: 0,
    priorityBy: "",
    manualOrder: undefined,
    addedAt: Date.now(),
  });
  if (!recycled) {
    room.lastRecycledQueueId = null;
    return;
  }
  room.queue.push(recycled);
  room.lastRecycledQueueId = recycled.queueId;
}

async function playNextUnlocked(room, options = {}) {
  const { allowFetchRandom = false, finishedSong = null, forceAdvance = false } = options;

  // 平台热榜：仅统计用户主动点播且真正播放完成的歌曲，随机/漫游（requestedById 为空）不计入
  if (finishedSong && finishedSong.requestedById) {
    recordSongPlay(finishedSong);
  }
  room.skipRequests = [];

  // 单曲循环：自然播完时重播当前曲；手动切歌 forceAdvance 仍前进
  if (!forceAdvance && normalizePlayMode(room.playMode) === "loop-one" && (finishedSong || room.current)) {
    if (restartCurrentSong(room)) return;
  }

  recycleFinishedSongToQueue(room, finishedSong || room.current);

  // 收藏随机明确以收藏列表作为下一首来源；已有点歌队列保留，退出该模式后继续消费。
  if (!room.playlistRoaming && normalizePlayMode(room.playMode) === "favorite-shuffle") {
    if (room.nextRandomPromise) await room.nextRandomPromise;
    let favorite = room.nextRandom;
    room.nextRandom = null;
    if (!favorite) {
      room.randomLoading = true;
      bumpPlaybackState(room);
      favorite = await fetchRandomForRoom(room);
    }
    if (favorite) {
      setCurrentSong(room, buildPendingRandomItem(favorite, "收藏随机") || favorite);
      void ensureNextRandom(room);
      return;
    }
    // 收藏为空/读取失败时不丢弃房间队列，退回普通队列播放。
  }

  if (room.queue.length > 0) {
    clearNextRandom(room);
    setCurrentSong(room, takeNextFromQueue(room));
    return;
  }

  // 队列为空时先等待预取，避免切歌/自然结束因 nextRandom 尚未就绪而反复进入 loading
  if (room.nextRandomPromise) {
    await room.nextRandomPromise;
  }

  let random = room.nextRandom;
  room.nextRandom = null;

  const shouldFetchRandom = !random && (allowFetchRandom || room.queue.length === 0);
  if (shouldFetchRandom) {
    room.randomLoading = true;
    bumpPlaybackState(room);
    random = await fetchRandomForRoom(room);
    if (random && !random.queueId) {
      random = buildPendingRandomItem(random, random.requestedBy || "私人漫游", random.requestedById || "");
    }
  }

  if (room.queue.length > 0) {
    if (random) {
      const pending = buildPendingRandomItem(random, random.requestedBy || "私人漫游", random.requestedById || "");
      if (pending && !room.nextRandom) room.nextRandom = pending;
      notifyRoomPrefetchReady(room);
    }
    setCurrentSong(room, takeNextFromQueue(room));
    return;
  }

  if (random) {
    const item = random.queueId
      ? serializeQueueItemForRoom({
          ...random,
          requestedBy: random.requestedBy || "私人漫游",
          requestedById: random.requestedById || "",
          addedAt: random.addedAt || Date.now(),
        })
      : buildPendingRandomItem(random, random.requestedBy || "私人漫游", random.requestedById || "");
    if (!item) {
      clearNextRandom(room);
      room.current = null;
      room.isPlaying = false;
      room.currentTime = 0;
      room.startedAt = null;
      room.randomLoading = true;
      clearSharedPlaybackMedia(room);
      bumpPlaybackState(room);
      invalidateRoomsListCache();
      return;
    }
    setCurrentSong(room, item);
    // 当前批次快耗尽时后台拉下一批，播放顺序仍由当前批次决定。
    if ((room.randomBatch?.length || 0) <= 1) void ensureNextRandom(room);
    return;
  }

  clearNextRandom(room);
  room.current = null;
  room.isPlaying = false;
  room.currentTime = 0;
  room.startedAt = null;
  // 漫游关闭时干净停机，不进入"漫游加载中"重试
  room.randomLoading = Boolean(room.playlistRoaming && room.playlistRoaming.enabled !== false) || (room.neteaseFmMode || DEFAULT_FM_MODE) !== FM_MODE_OFF;
  clearSharedPlaybackMedia(room);
  bumpPlaybackState(room);
  invalidateRoomsListCache();
}

async function playNext(room, options = {}) {
  return withPlaybackLock(room, () => playNextUnlocked(room, options));
}

async function runEnsurePlayback(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.current) {
    room.randomLoading = false;
    return serializeRoom(room);
  }

  if (!room.randomLoading) room.randomLoading = true;
  try {
    await withPlaybackLock(room, async () => {
      if (!room.current) await playNextUnlocked(room, { allowFetchRandom: true });
    });
  } finally {
    if (room.current) room.randomLoading = false;
  }
  persistRoom(room);
  return serializeRoom(room);
}

export async function ensurePlayback(roomId) {
  const inflight = ensurePlaybackInflight.get(roomId);
  if (inflight) return inflight;

  const task = runEnsurePlayback(roomId);
  ensurePlaybackInflight.set(roomId, task);
  try {
    return await task;
  } finally {
    ensurePlaybackInflight.delete(roomId);
  }
}

const RANDOM_RETRY_COOLDOWN_MS = 2000;

/** 房间卡在 randomLoading 时由定时任务触发重试 */
export async function retryStuckRandomLoading(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.current || !room.randomLoading || room.users.size === 0) return null;

  const now = Date.now();
  if (room.lastRandomRetryAt && now - room.lastRandomRetryAt < RANDOM_RETRY_COOLDOWN_MS) {
    return null;
  }
  room.lastRandomRetryAt = now;

  return ensurePlayback(roomId);
}

/** 标记房间正在拉取随机歌曲（用于加入后立即向客户端反馈"加载中"） */
export function markRandomLoading(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (!room.current && room.queue.length === 0) {
    room.randomLoading = true;
  }
  return serializeRoom(room);
}

export async function skipSong(roomId, socketId, connectionId = null, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: "仅房主或管理员可切歌" };

  const user = room.users.get(socketId);
  const currentSong = room.current;
  if (!currentSong) return { error: "当前没有正在播放的歌曲" };
  const songTitle = currentSong ? formatSongTitle(currentSong) : "";
  const reason = String(options.reason || "manual");

  // 音源异常必须由服务端探测确认，不能凭主控本机取链失败全屋切歌
  if (reason === "source_error") {
    if (!currentSong) return { error: "当前没有正在播放的歌曲" };
    const playable = await runWithMetingRequestContext(
      {
        userId: socketId,
        userNickname: String(user?.nickname || "").slice(0, 40),
        roomId: room.id,
        roomName: String(room.name || room.id).slice(0, 60),
      },
      () => isSongPlayableOnServer(currentSong),
    );
    if (playable) {
      return { error: "服务端检测音源正常，未切歌（可能是本机网络问题）" };
    }
  }

  await playNext(room, { allowFetchRandom: false, forceAdvance: true });

  let systemMessage = null;
  if (songTitle) {
    if (reason === "source_error") {
      systemMessage = appendSystemChatMessage(room, `因歌曲源异常，已跳过 ${songTitle}`);
    } else if (reason === "system") {
      systemMessage = appendSystemChatMessage(room, `系统已跳过 ${songTitle}`);
    } else {
      systemMessage = appendSystemChatMessage(room, `${formatActorName(user)} 切了 ${songTitle}`);
    }
  }

  persistRoom(room);
  return { room: serializeRoom(room), systemMessage };
}

/** AI 助手切歌：不要求主控连接，以系统身份推进播放 */
export async function skipSongAsAi(roomId, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!room.current) return { error: "当前没有正在播放的歌曲" };

  const songTitle = formatSongTitle(room.current);
  const botName = String(options.botName || "小音").trim().slice(0, 20) || "小音";
  const reasonText = String(options.reasonText || "").trim().slice(0, 40);

  await playNext(room, { allowFetchRandom: false, forceAdvance: true });

  const notice = reasonText
    ? `${botName} 切了 ${songTitle}（${reasonText}）`
    : `${botName} 切了 ${songTitle}`;
  const systemMessage = appendSystemChatMessage(room, notice);
  persistRoom(room);
  return {
    room: serializeRoom(room),
    systemMessage,
    message: notice,
  };
}

function resolveUserConnectionId(room, userId) {
  const user = room?.users?.get(userId);
  if (!user || user.readOnly) return null;
  if (user.connectionId) return String(user.connectionId);
  if (user.connectionIds instanceof Set && user.connectionIds.size > 0) {
    return String([...user.connectionIds][0]);
  }
  return null;
}

/**
 * AI 代操前的身份与权限快照。所有写操作必须以触发用户身份校验，禁止提权。
 */
export function getAiActorPermissions(roomId, userId) {
  const room = rooms.get(roomId);
  const uid = String(userId || "").trim();
  if (!room) {
    return {
      ok: false,
      error: "房间不存在",
      inRoom: false,
      role: "none",
      canSearch: false,
      canRequestSong: false,
      canSkipDirectly: false,
      canRequestSkip: false,
      canRecommend: false,
      canUseEmoji: false,
      canUseSticker: false,
      details: {},
    };
  }

  const user = uid ? room.users.get(uid) : null;
  if (!user) {
    return {
      ok: false,
      error: "你当前不在房间内，无法代你操作",
      inRoom: false,
      role: "none",
      canSearch: false,
      canRequestSong: false,
      canSkipDirectly: false,
      canRequestSkip: false,
      canRecommend: false,
      canUseEmoji: false,
      canUseSticker: false,
      details: {},
    };
  }

  if (user.readOnly) {
    return {
      ok: false,
      error: "只读访客无权操作房间",
      inRoom: true,
      role: "readonly",
      canSearch: true,
      canRequestSong: false,
      canSkipDirectly: false,
      canRequestSkip: false,
      canRecommend: true,
      canUseEmoji: false,
      canUseSticker: false,
      details: { readOnly: true },
    };
  }

  const isOwner = isRoomCreator(room, uid);
  const isAdmin = canControlPlayback(room, uid) && !isOwner;
  const role = isOwner ? "owner" : (canControlPlayback(room, uid) ? "admin" : "member");
  const canPlayControl = canControlPlayback(room, uid);
  const songRequestOpen = room.songRequestEnabled !== false;
  const canRequest = canUserRequestSong(room, uid);

  const details = {
    nickname: user.nickname || "匿名",
    songRequestEnabled: songRequestOpen,
    muted: isUserChatMuted(room, uid),
  };

  if (!canPlayControl) {
    const minStaySec = normalizeSongRequestMinStaySec(room.songRequestMinStaySec);
    if (minStaySec > 0) {
      const stayedSec = (Date.now() - (user.joinedAt || Date.now())) / 1000;
      const remain = Math.max(0, minStaySec - stayedSec);
      details.minStaySec = minStaySec;
      details.minStayRemainSec = Math.ceil(remain);
      if (remain > 0) details.blockRequestReason = formatSongRequestMinStayError(remain);
    }
    const maxPerUser = normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser);
    if (maxPerUser > 0) {
      const count = countUserRequestedSongs(room, uid);
      details.maxPerUser = maxPerUser;
      details.queuedByUser = count;
      if (count >= maxPerUser) details.blockRequestReason = `每人最多 ${maxPerUser} 首待播，你已达上限`;
    }
    const cooldownSec = normalizeSongRequestCooldownSec(room.songRequestCooldownSec);
    if (cooldownSec > 0) {
      const lastAt = ensureLastSongRequestAt(room).get(uid) || 0;
      const elapsedSec = (Date.now() - lastAt) / 1000;
      const remain = lastAt > 0 ? Math.max(0, cooldownSec - elapsedSec) : 0;
      details.cooldownSec = cooldownSec;
      details.cooldownRemainSec = Math.ceil(remain);
      if (remain > 0) details.blockRequestReason = formatSongRequestCooldownError(remain);
    }
  }

  if (!canRequest) {
    details.blockRequestReason = details.blockRequestReason || "房主已禁止点歌";
  }

  const requestBlocked = Boolean(details.blockRequestReason);
  return {
    ok: true,
    error: null,
    inRoom: true,
    role,
    canSearch: true,
    canRequestSong: canRequest && !requestBlocked,
    canSkipDirectly: canPlayControl,
    canRequestSkip: !canPlayControl && Boolean(room.current),
    canRecommend: true,
    // 表情由 AI 账号发出，不占用用户发言权；但只读访客不允许整活
    canUseEmoji: true,
    canUseSticker: true,
    details,
  };
}

/** 以触发用户身份切歌：必须具备播放控制权，并绑定其在线连接 */
export async function skipSongOnBehalfOfUser(roomId, userId, options = {}) {
  const perms = getAiActorPermissions(roomId, userId);
  if (!perms.ok) return { error: perms.error || "无权操作" };
  if (!perms.canSkipDirectly) {
    return {
      error: "仅房主或管理员可直接切歌",
      canRequestSkip: perms.canRequestSkip,
      role: perms.role,
    };
  }

  const room = rooms.get(roomId);
  const connectionId = resolveUserConnectionId(room, userId);
  if (!connectionId) {
    return { error: "会话无效，请刷新页面后再试" };
  }

  const result = await skipSong(roomId, userId, connectionId, {
    reason: options.reason || "manual",
  });
  if (result.error) return result;

  const botName = String(options.botName || "小音").trim().slice(0, 20) || "小音";
  return {
    ...result,
    message: result.systemMessage?.text || `${botName} 已按你的权限切歌`,
  };
}

/** 以触发用户身份申请切歌（普通成员） */
export function requestSkipOnBehalfOfUser(roomId, userId) {
  const perms = getAiActorPermissions(roomId, userId);
  if (!perms.ok) return { error: perms.error || "无权操作" };
  if (perms.canSkipDirectly) {
    return { error: "你有直接切歌权限，请使用切歌而不是申请" };
  }
  if (!perms.canRequestSkip) {
    return { error: "当前无法申请切歌" };
  }
  return requestSkip(roomId, userId);
}

/** 以触发用户身份点歌前的硬校验（再交给 addToQueue 做细则） */
export function assertAiCanRequestSong(roomId, userId) {
  const perms = getAiActorPermissions(roomId, userId);
  if (!perms.ok) return { error: perms.error || "无权操作", permissions: perms };
  if (!perms.canRequestSong) {
    return {
      error: perms.details?.blockRequestReason || "你当前没有点歌权限",
      permissions: perms,
    };
  }
  return { ok: true, permissions: perms };
}

export async function finishCurrentSong(roomId, socketId, connectionId, queueId) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: "仅房主或管理员可结束歌曲" };
  if (!room.current) return { error: "当前没有正在播放的歌曲" };
  if (queueId && room.current.queueId !== queueId) return { room: serializeRoom(room) };

  await withPlaybackLock(room, async () => {
    if (!room.current) return;
    if (queueId && room.current.queueId !== queueId) return;
    const finished = room.current;
    await playNextUnlocked(room, { allowFetchRandom: false, finishedSong: finished });
  });
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export async function advancePlaybackIfEnded(roomId, options = {}) {
  const room = rooms.get(roomId);
  if (!room?.current || !room.isPlaying) return null;

  const { force = false, expectedQueueId = "" } = options;
  if (expectedQueueId && room.current.queueId !== expectedQueueId) return null;

  const durationSec = getSongDurationSeconds(room.current);
  if (durationSec <= 0 && !force) return null;
  if (!force && getPlaybackTime(room) < durationSec + AUTO_ADVANCE_GRACE_SEC) return null;

  if (room.autoAdvancePromise) return null;

  room.autoAdvancePromise = withPlaybackLock(room, async () => {
    if (!room.current || !room.isPlaying) return null;
    if (expectedQueueId && room.current.queueId !== expectedQueueId) return null;

    const lockedDurationSec = getSongDurationSeconds(room.current);
    if (!force && (lockedDurationSec <= 0 || getPlaybackTime(room) < lockedDurationSec + AUTO_ADVANCE_GRACE_SEC)) {
      return null;
    }
    await playNextUnlocked(room, { allowFetchRandom: false, finishedSong: room.current });
    persistRoom(room);
    return serializeRoom(room);
  });

  try {
    return await room.autoAdvancePromise;
  } finally {
    room.autoAdvancePromise = null;
  }
}

export function setPlaying(roomId, socketId, isPlaying, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room || !room.current) return null;
  if (!canPausePlayback(room, socketId, connectionId)) return null;

  room.isPlaying = isPlaying;
  if (isPlaying) {
    const now = Date.now();
    const currentTime = calculatePlaybackTime(room, now);
    room.currentTime = currentTime;
    room.startedAt = now - (currentTime / normalizePlaybackRate(room.playbackRate)) * 1000;
  } else {
    room.currentTime = calculatePlaybackTime(room);
    room.startedAt = null;
  }
  bumpPlaybackState(room);

  persistRoom(room);
  return serializeRoom(room);
}

export function seekTo(roomId, socketId, time, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room || !room.current) return null;
  if (!canSeekPlayback(room, socketId, connectionId)) return null;

  const nextTime = Number(time);
  if (!Number.isFinite(nextTime) || nextTime < 0) return null;

  room.currentTime = nextTime;
  room.startedAt = room.isPlaying ? Date.now() - (room.currentTime / normalizePlaybackRate(room.playbackRate)) * 1000 : null;
  bumpPlaybackState(room);
  persistRoom(room);
  return serializeRoom(room);
}

async function applyJumpToFront(room, queueId, options = {}) {
  const { ownerPriority = false, priorityBy = "" } = options;
  const qIdx = room.queue.findIndex((s) => s.queueId === queueId);
  if (qIdx === -1) return false;

  const [song] = room.queue.splice(qIdx, 1);
  if (ownerPriority) {
    song.ownerPriority = Date.now();
    if (priorityBy) {
      song.priorityBy = priorityBy;
    } else {
      delete song.priorityBy;
    }
  }
  room.queue.unshift(song);
  if (queueHasManualOrder(room) || Number.isFinite(song.manualOrder)) {
    reindexManualOrder(room);
  }
  if (!room.current) {
    await withPlaybackLock(room, async () => {
      if (!room.current) await playNextUnlocked(room, { allowFetchRandom: true });
    });
  }
  return true;
}

export async function requestJump(roomId, socketId, queueId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const user = room.users.get(socketId);
  if (!user) return { error: "未加入房间" };
  if (!isActorConnection(room, socketId, connectionId)) {
    return { error: "会话无效，请刷新后重试" };
  }

  const item = room.queue.find((s) => s.queueId === queueId);
  if (!item) return { error: "歌曲不在队列中" };
  const isController = isControllerConnection(room, socketId, connectionId);
  const isRequester = isQueueRequester(item, socketId, user);
  if (!isController && !isRequester) return { error: "只能为自己点的歌插队" };
  if (!isController && !room.memberJumpEnabled) {
    return { error: "房间未开启成员插队" };
  }

  const jumped = await applyJumpToFront(room, queueId, {
    ownerPriority: isController,
    priorityBy: isController && !isRoomCreator(room, socketId) ? user.nickname : "",
  });
  if (!jumped) return { error: "歌曲不在队列中" };

  room.jumpRequests = room.jumpRequests.filter((r) => r.queueId !== queueId);
  const systemMessage = appendSystemChatMessage(room, `${formatActorName(user)} 将 ${formatSongTitle(item)} 插到下一首`);
  persistRoom(room);
  return { room: serializeRoom(room), systemMessage };
}

/**
 * 房主/管理员拖拽重排待播队列。
 * 仅被拖动的歌曲写入 ownerPriority（边框与插队一致），不改动点歌人。
 * 全队写入 manualOrder 以锁定顺序。
 */
export function reorderQueue(roomId, actorId, orderedQueueIds, movedQueueId = null, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isControllerConnection(room, actorId, connectionId)) {
    return { error: "仅房主或管理员可排序播放列表" };
  }

  if (!Array.isArray(orderedQueueIds) || orderedQueueIds.length === 0) {
    return { error: "排序参数无效" };
  }

  const byId = new Map(room.queue.map((song) => [song.queueId, song]));
  if (orderedQueueIds.length !== room.queue.length) {
    return { error: "排序与当前队列不匹配" };
  }
  const seen = new Set();
  for (const queueId of orderedQueueIds) {
    if (!byId.has(queueId) || seen.has(queueId)) {
      return { error: "排序与当前队列不匹配" };
    }
    seen.add(queueId);
  }

  const actor = room.users.get(actorId);
  const isAdminReorder = actor && !isRoomCreator(room, actorId);
  const movedId = movedQueueId && byId.has(movedQueueId) ? movedQueueId : null;

  room.queue = orderedQueueIds.map((queueId, index) => {
    const song = byId.get(queueId);
    song.manualOrder = index;
    return song;
  });

  // 只给真正被拖动的那首加优先级边框，且绝不改写 requestedBy
  if (movedId) {
    const moved = byId.get(movedId);
    moved.ownerPriority = Date.now();
    if (isAdminReorder) {
      moved.priorityBy = actor.nickname;
    } else {
      delete moved.priorityBy;
    }
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export async function approveJump(roomId, socketId, requestId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: "仅房主或管理员可审批" };

  const reqIdx = room.jumpRequests.findIndex((r) => r.id === requestId);
  if (reqIdx === -1) return { error: "申请不存在" };

  const req = room.jumpRequests[reqIdx];
  room.jumpRequests.splice(reqIdx, 1);

  const approver = room.users.get(socketId);
  const isAdminJump = approver && !isRoomCreator(room, socketId);
  await applyJumpToFront(room, req.queueId, {
    ownerPriority: true,
    priorityBy: isAdminJump ? approver.nickname : "",
  });

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function rejectJump(roomId, socketId, requestId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: "仅房主或管理员可审批" };

  const before = room.jumpRequests.length;
  room.jumpRequests = room.jumpRequests.filter((r) => r.id !== requestId);
  if (room.jumpRequests.length === before) return { error: "申请不存在" };

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function requestSkip(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!room.current) return { error: "当前没有正在播放的歌曲" };
  if (canControlPlayback(room, socketId)) return { error: "可直接切歌" };

  const user = room.users.get(socketId);
  if (room.skipRequests.some((r) => r.requestedBy === socketId)) {
    return { error: "已提交过切歌申请" };
  }

  room.skipRequests.push({
    id: generateId(),
    songName: room.current.name,
    nickname: user?.nickname || "匿名",
    requestedBy: socketId,
    requestedAt: Date.now(),
  });

  const created = room.skipRequests[room.skipRequests.length - 1];
  scheduleSkipRequestExpiry(roomId, created.id, created.requestedAt);

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export async function approveSkip(roomId, socketId, requestId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: "仅房主或管理员可审批" };

  const reqIdx = room.skipRequests.findIndex((r) => r.id === requestId);
  if (reqIdx === -1) return { error: "申请不存在" };

  clearSkipRequestExpiryTimer(roomId, requestId);
  room.skipRequests.splice(reqIdx, 1);
  await playNext(room, { allowFetchRandom: false, forceAdvance: true });

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function rejectSkip(roomId, socketId, requestId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: "仅房主或管理员可审批" };

  const before = room.skipRequests.length;
  room.skipRequests = room.skipRequests.filter((r) => r.id !== requestId);
  if (room.skipRequests.length === before) return { error: "申请不存在" };

  clearSkipRequestExpiryTimer(roomId, requestId);

  persistRoom(room);
  return { room: serializeRoom(room) };
}

const MAX_REACTION_EMOJI_LEN = 32;
const QQFACE_REACTION_RE = /^\[qqface:[^\]]+\]$/;

function sanitizeReactionEmoji(emoji) {
  const text = String(emoji || "").trim();
  if (!text || text.length > MAX_REACTION_EMOJI_LEN) return "";
  if (QQFACE_REACTION_RE.test(text)) return text;
  if ([...text].length <= 4) return text;
  return "";
}

function serializeReactions(reactions) {
  if (!reactions || typeof reactions !== "object") return [];
  return Object.entries(reactions)
    .map(([emoji, users]) => ({
      emoji,
      users: Array.isArray(users) ? users : [],
    }))
    .filter((group) => group.users.length > 0);
}

function serializeChatMessage(message, options = {}) {
  const roomId = options.roomId ? String(options.roomId).toUpperCase() : '';
  const allowLargeDataUrl = Boolean(options.allowLargeDataUrl);
  let source = message;
  if (roomId && source?.userId === AI_BOT_USER_ID) {
    source = sanitizeStoredAiBotMessage(roomId, source);
  }

  const imageUrl = String(source.imageUrl || "").trim() || null;
  const replyTo = sanitizeReplyImageForWire(source.replyTo, allowLargeDataUrl);

  let safeImageUrl = imageUrl;
  if (!allowLargeDataUrl && isOversizedDataUrl(imageUrl)) {
    safeImageUrl = null;
  }

  let kind = source.kind || "chat";
  let aiBotSig = null;
  if (source.userId === AI_BOT_USER_ID) {
    if (roomId && verifyAiBotMessage(roomId, source)) {
      kind = AI_BOT_MESSAGE_KIND;
      aiBotSig = source.aiBotSig || null;
    } else {
      kind = 'chat';
      aiBotSig = null;
    }
  }

  const out = {
    id: source.id,
    userId: source.userId,
    nickname: source.nickname,
    text: source.text,
    imageUrl: safeImageUrl,
    imageKey: source.imageKey || null,
    asSticker: Boolean(source.asSticker),
    kind,
    mentions: source.mentions || [],
    replyTo,
    timestamp: source.timestamp,
    reactions: serializeReactions(source.reactions),
    memberTier: source.memberTier || null,
    targetUserId: source.targetUserId || null,
    targetNickname: source.targetNickname || null,
    confettiEnabled: source.kind === 'welcome'
      ? source.confettiEnabled !== false
      : Boolean(source.confettiEnabled),
  };
  if (aiBotSig) out.aiBotSig = aiBotSig;
  return out;
}

function isOversizedDataUrl(imageUrl) {
  const url = String(imageUrl || "");
  return url.startsWith("data:") && url.length > 8 * 1024;
}

function sanitizeReplyImageForWire(replyTo, allowLargeDataUrl) {
  if (!replyTo) return null;
  if (allowLargeDataUrl || !isOversizedDataUrl(replyTo.imageUrl)) return replyTo;
  return {
    ...replyTo,
    imageUrl: null,
  };
}

function sanitizeMessageForStorage(message) {
  if (!message) return message;
  const imageUrl = message.imageUrl;
  const replyTo = message.replyTo;
  const needsStrip = isOversizedDataUrl(imageUrl) || (replyTo && isOversizedDataUrl(replyTo.imageUrl));
  if (!needsStrip) return message;

  return {
    ...message,
    imageUrl: isOversizedDataUrl(imageUrl) ? undefined : imageUrl,
    replyTo: replyTo && isOversizedDataUrl(replyTo.imageUrl) ? { ...replyTo, imageUrl: undefined } : replyTo,
  };
}

export function toggleChatReaction(roomId, userId, messageId, emoji) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const emojiKey = sanitizeReactionEmoji(emoji);
  if (!emojiKey) return { error: "无效表情" };

  const message = room.messages.find((entry) => entry.id === messageId);
  if (!message) return { error: "消息不存在" };

  if (isUserChatMuted(room, userId)) {
    return { error: room.muteAll ? "当前房间已全体禁言" : "你已被禁言" };
  }

  const user = room.users.get(userId);
  if (!user) return { error: "未加入房间" };

  if (!message.reactions) message.reactions = {};
  if (!message.reactions[emojiKey]) message.reactions[emojiKey] = [];

  const list = message.reactions[emojiKey];
  const index = list.findIndex((entry) => entry.userId === userId);
  if (index >= 0) {
    list.splice(index, 1);
    if (list.length === 0) delete message.reactions[emojiKey];
  } else {
    list.push({ userId, nickname: user.nickname || "匿名" });
  }

  persistRoom(room);
  return {
    messageId,
    reactions: serializeReactions(message.reactions),
  };
}

function sanitizeChatReplyRef(replyTo, roomId) {
  if (!replyTo || typeof replyTo !== "object") return null;
  const id = String(replyTo.id || "").trim();
  const userId = String(replyTo.userId || "").trim();
  const nickname = String(replyTo.nickname || "")
    .trim()
    .slice(0, 32);
  const text = String(replyTo.text || "")
    .trim()
    .slice(0, 48);
  if (!id || !userId || !nickname) return null;

  const imageUrl = String(replyTo.imageUrl || "").trim();
  const imageKey = String(replyTo.imageKey || "").trim();
  const asSticker = Boolean(replyTo.asSticker);
  const result = { id, userId, nickname, text };
  if (asSticker) result.asSticker = true;

  if (imageUrl && !imageUrl.startsWith("data:")) {
    const imageCheck = imageKey
      ? isLocalStickerImageKey(imageKey)
        ? validateLocalStickerImage(imageUrl, imageKey)
        : validateChatImageForRoom(roomId, imageUrl, imageKey)
      : validateExternalChatImage(imageUrl);
    if (!imageCheck.error) {
      result.imageUrl = imageUrl;
      if (imageKey) result.imageKey = imageKey;
    }
  } else if (imageKey && isLocalStickerImageKey(imageKey)) {
    // 回复引用不内联 data URL，避免历史/广播膨胀
    result.imageKey = imageKey;
  }
  return result;
}

export function addChatMessage(roomId, userId, text, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const content = String(text || "").trim();
  const imageUrl = String(options.imageUrl || "").trim();
  const imageKey = String(options.imageKey || "").trim();
  const asSticker = Boolean(options.asSticker) || isLocalStickerImageKey(imageKey);

  if (!content && !imageUrl) return { error: "消息不能为空" };
  if (content.length > 500) return { error: "消息过长" };

  if (content) {
    const hit = findForbiddenWordInText(room, content);
    if (hit) {
      return { error: "消息包含违禁词，请修改后发送" };
    }
  }

  const user = room.users.get(userId);
  if (isUserChatMuted(room, userId)) {
    return { error: room.muteAll ? "当前房间已全体禁言" : "你已被禁言" };
  }

  if (imageUrl) {
    const imageCheck = imageKey
      ? isLocalStickerImageKey(imageKey)
        ? validateLocalStickerImage(imageUrl, imageKey)
        : validateChatImageForRoom(roomId, imageUrl, imageKey)
      : validateExternalChatImage(imageUrl);
    if (imageCheck.error) return imageCheck;
  }

  if (hasMentionAllInText(content) && !canControlPlayback(room, userId)) {
    return { error: "仅房主或管理员可使用 @全体成员" };
  }

  let mentions = Array.isArray(options.mentions) ? options.mentions.slice(0, 10) : [];
  // 禁止客户端伪造 @AI / bot userId
  mentions = mentions.filter((entry) => {
    const id = String(entry?.id || entry?.userId || "").trim();
    return id && id !== AI_BOT_USER_ID && id !== "system";
  });
  if (hasMentionAllInText(content)) {
    mentions = buildMentionAllTargets(room, userId);
  }

  const message = {
    id: generateId(),
    userId,
    nickname: user?.nickname || "匿名",
    text: content,
    imageUrl: imageUrl || undefined,
    imageKey: imageKey || undefined,
    asSticker: asSticker || undefined,
    mentions,
    replyTo: sanitizeChatReplyRef(options.replyTo, roomId),
    timestamp: Date.now(),
  };

  room.messages.push(message);
  if (room.messages.length > MAX_CHAT_MESSAGES) {
    room.messages.splice(0, room.messages.length - MAX_CHAT_MESSAGES);
  }

  // 内存里也不长期保留超大 data URL，实时广播后即可压缩历史体积
  if (isOversizedDataUrl(message.imageUrl)) {
    setImmediate(() => {
      if (message.imageUrl && isOversizedDataUrl(message.imageUrl)) {
        message.imageUrl = undefined;
        persistRoom(room);
      }
    });
  }

  persistRoom(room);
  return { message: serializeChatMessage(message, { roomId, allowLargeDataUrl: true }) };
}

/** AI 助手发言（不占用真实用户席位；带服务端签名） */
export function postBotChatMessage(roomId, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const botName = String(options.nickname || resolveRoomAiBotName(room) || "小音")
    .trim()
    .slice(0, 20) || "小音";
  const content = String(options.text || "").trim();
  const imageUrl = String(options.imageUrl || "").trim();
  const imageKey = String(options.imageKey || "").trim();
  const asSticker = Boolean(options.asSticker);

  if (!content && !imageUrl) return { error: "消息不能为空" };
  if (content.length > 500) return { error: "消息过长" };

  if (imageUrl) {
    const imageCheck = imageKey
      ? isLocalStickerImageKey(imageKey)
        ? validateLocalStickerImage(imageUrl, imageKey)
        : validateChatImageForRoom(roomId, imageUrl, imageKey)
      : validateExternalChatImage(imageUrl);
    if (imageCheck.error) return imageCheck;
  }

  const message = {
    id: generateId(),
    userId: AI_BOT_USER_ID,
    nickname: botName,
    text: content,
    imageUrl: imageUrl || undefined,
    imageKey: imageKey || undefined,
    asSticker: asSticker || undefined,
    mentions: [],
    replyTo: sanitizeChatReplyRef(options.replyTo, roomId),
    timestamp: Date.now(),
  };

  room.messages.push(message);
  if (room.messages.length > MAX_CHAT_MESSAGES) {
    room.messages.splice(0, room.messages.length - MAX_CHAT_MESSAGES);
  }

  attachAiBotWireFields(roomId, message);

  persistRoom(room);
  return { message: serializeChatMessage(message, { roomId, allowLargeDataUrl: true }) };
}

/** 给 AI 工具用的房间摘要（避免把整房状态塞进 prompt） */
export function getRoomAiSnapshot(roomId, viewerUserId = null) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const uid = String(viewerUserId || '').trim();
  const current = room.current
    ? {
        name: room.current.name,
        artist: room.current.artist,
        requestedBy: room.current.requestedBy,
        requestedById: room.current.requestedById || null,
      }
    : null;
  const queue = (room.queue || []).slice(0, 5).map((item, index) => ({
    index: index + 1,
    name: item.name,
    artist: item.artist,
    requestedBy: item.requestedBy,
    requestedById: item.requestedById || null,
  }));

  let viewerQueueCount = 0;
  let viewerQueuePreview = [];
  if (uid) {
    const mine = (room.queue || []).filter((item) => item.requestedById === uid);
    viewerQueueCount = mine.length;
    viewerQueuePreview = mine.slice(0, 3).map((item, index) => ({
      index: index + 1,
      name: item.name,
      artist: item.artist,
    }));
  }

  return {
    roomName: room.name || room.id,
    onlineCount: room.users?.size || 0,
    queueCount: room.queue?.length || 0,
    isPlaying: Boolean(room.isPlaying),
    playMode: room.playMode || 'order',
    current,
    queuePreview: queue,
    viewerUserId: uid || null,
    viewerQueueCount,
    viewerQueuePreview,
    viewerIsCurrentRequester: Boolean(uid && current?.requestedById === uid),
  };
}

/** 延迟取配置，避免 roomManager ↔ AI 模型服务循环依赖在模块顶层爆炸 */
function requireAiIdentity() {
  // 动态 import 在 sync 路径不可用；这里用已加载的 runtimeConfig + 常量本地化
  // AI_BOT_USER_ID / botName 从 runtimeConfig 读，常量与 AI 模型服务保持一致
  return {
    AI_BOT_USER_ID: "__openmusic_ai__",
    getAiModelConfig: () => {
      const cfg = getRuntimeConfig();
      return {
        botName: String(cfg.aiBotName || "小音").trim().slice(0, 20) || "小音",
      };
    },
  };
}

const CHAT_RECALL_WINDOW_MS = 2 * 60 * 1000;

export function recallChatMessage(roomId, userId, messageId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const id = String(messageId || "").trim();
  if (!id) return { error: "消息不存在" };

  const index = room.messages.findIndex((entry) => entry.id === id);
  if (index === -1) return { error: "消息不存在" };

  const message = room.messages[index];
  if (message.kind && message.kind !== "chat") return { error: "该消息无法撤回" };

  const isSelf = message.userId === userId;
  const isModerator = canModerate(room, userId);
  if (!isSelf && !isModerator) return { error: "只能撤回自己的消息" };
  if (!isSelf) {
    const denied = requireModerator(room, userId, connectionId);
    if (denied) return denied;
    // 管理不可撤回房主消息；管理之间也不可互撤，仅房主可撤回他人管理消息
    if (isRoomCreator(room, message.userId)) {
      return { error: "不能撤回房主的消息" };
    }
    if ((isAppointedAdmin(room, message.userId) || isAutoPromotedAdmin(room, message.userId)) && !isRoomCreator(room, userId)) {
      return { error: "仅房主可撤回管理员的消息" };
    }
  }
  if (isSelf && !isModerator && Date.now() - (message.timestamp || 0) > CHAT_RECALL_WINDOW_MS) {
    return { error: "已超过可撤回时间" };
  }

  const authorName =
    String(message.nickname || "匿名")
      .trim()
      .slice(0, 20) || "匿名";
  const actor = room.users.get(userId);
  const actorName = formatActorName(actor);
  room.messages.splice(index, 1);

  const noticeText = isSelf ? `${authorName} 撤回了一条消息` : `${actorName} 撤回了 ${authorName} 的一条消息`;
  const recallMessage = appendRecallChatMessage(room, noticeText);
  return { recalledMessageId: id, recallMessage };
}

export function getPlaybackTime(room) {
  if (!room.current) return 0;
  if (room.isPlaying && room.current && !room.startedAt) {
    room.startedAt = Date.now() - ((room.currentTime || 0) / normalizePlaybackRate(room.playbackRate)) * 1000;
  }
  return calculatePlaybackTime(room);
}

const PLAYBACK_DRIFT_ANCHOR_ENTER_SEC = 3.5;
const PLAYBACK_DRIFT_ANCHOR_EXIT_SEC = 2.5;
const PLAYBACK_DRIFT_ANCHOR_COOLDOWN_MS = 5000;

function applyPlaybackDriftAnchor(room, serverTime, now = Date.now()) {
  if (room.playbackDriftAnchorCooldownUntil && now < room.playbackDriftAnchorCooldownUntil) {
    if (room.playbackDriftAnchored) {
      room.currentTime = serverTime;
    }
    return;
  }

  const stored = room.currentTime || 0;
  const diff = Math.abs(serverTime - stored);
  let toggled = false;

  if (!room.playbackDriftAnchored && diff > PLAYBACK_DRIFT_ANCHOR_ENTER_SEC) {
    room.playbackDriftAnchored = true;
    toggled = true;
  } else if (room.playbackDriftAnchored && diff < PLAYBACK_DRIFT_ANCHOR_EXIT_SEC) {
    room.playbackDriftAnchored = false;
    toggled = true;
  }

  if (toggled) {
    room.playbackDriftAnchorCooldownUntil = now + PLAYBACK_DRIFT_ANCHOR_COOLDOWN_MS;
  }

  if (room.playbackDriftAnchored) {
    room.currentTime = serverTime;
  }
}

function calculatePlaybackTime(room, now = Date.now()) {
  if (!room?.current) return 0;
  if (room.isPlaying && room.startedAt) {
    const serverTime = ((now - room.startedAt) / 1000) * normalizePlaybackRate(room.playbackRate);
    applyPlaybackDriftAnchor(room, serverTime, now);
    return serverTime;
  }
  return room.currentTime || 0;
}

function serializeLobbyCoverPic(pic) {
  const raw = String(pic || "").trim();
  if (!isDirectCoverUrl(raw)) return undefined;
  return resizeCoverForThumb(raw, 96) || raw;
}

function serializeLobbyCustomCover(coverUrl) {
  const raw = normalizeCustomCoverUrl(coverUrl);
  if (!raw) return undefined;
  if (raw.startsWith("data:")) return raw;
  if (!isDirectCoverUrl(raw)) return undefined;
  return resizeCoverForThumb(raw, 96) || raw;
}

function serializeRoomSummary(room) {
  const customCoverUrl = serializeLobbyCustomCover(room.customCoverUrl);
  return {
    id: room.id,
    name: room.name,
    userCount: room.users.size,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    isPlaying: room.isPlaying,
    customCoverUrl,
    currentSong: room.current
      ? {
          name: room.current.name,
          artist: room.current.artist,
          id: room.current.id,
          source: room.current.source,
          pic: serializeLobbyCoverPic(room.current.pic),
        }
      : null,
    queueLength: room.queue.length,
    createdAt: room.createdAt,
    ownerId: room.creatorId || null,
    adminIds: Array.from(room.adminIds || []),
  };
}

function repairPlaybackClock(room) {
  if (room.isPlaying && room.current && !room.startedAt) {
    const now = Date.now();
    room.startedAt = now - ((room.currentTime || 0) / normalizePlaybackRate(room.playbackRate)) * 1000;
  }
}

function serializeUser(user, options = {}) {
  const payload = {
    id: user.id,
    nickname: user.nickname,
    readOnly: user.readOnly,
    joinedAt: user.joinedAt,
  };
  // 头像 URL：优先从房间 userAvatarUrls Map 取，兼容直接挂在 user 上的情形
  const avatarUrl = user.avatarUrl || options.roomAvatarUrls?.get(user.id) || '';
  if (avatarUrl) payload.avatar_url = avatarUrl;
  // 广播包省略 location，缩小人多时的 users 体积；进房 ACK 仍带完整字段
  if (options.includeLocation !== false) {
    payload.location = user.location || "";
  }
  return payload;
}

/** 队列/当前歌曲广播字段：不含 url/lrc，歌词与播放地址由客户端按需拉取 */
function serializeQueueItemForRoom(item) {
  if (!item) return null;
  const payload = {
    queueId: item.queueId,
    id: item.id,
    source: item.source || "netease",
    name: item.name,
    artist: item.artist,
    album: item.album,
    pic: item.pic,
    duration: normalizeSongDurationMs(item.duration),
    requestedBy: item.requestedBy,
    requestedById: item.requestedById,
    addedAt: item.addedAt,
    likedByIds: Array.isArray(item.likedByIds) ? item.likedByIds : [],
    dislikedByIds: Array.isArray(item.dislikedByIds) ? item.dislikedByIds : [],
    ownerPriority: item.ownerPriority || 0,
    priorityBy: item.priorityBy || "",
    ...(Number.isFinite(item.manualOrder) ? { manualOrder: item.manualOrder } : {}),
  };
  if (
    item.source === 'qishui'
    && (item.requestedBy === '私人漫游' || item.requestedBy === '收藏随机')
    && /^https?:\/\//i.test(String(item.url || ''))
  ) {
    payload.url = String(item.url);
  }
  return payload;
}

/** 自动随机曲目预取：分配稳定 queueId，播放与客户端 URL 缓存可复用 */
function buildPendingRandomItem(song, requestedBy = "私人漫游", requestedById = "") {
  if (!song?.id) return null;
  return serializeQueueItemForRoom({
    queueId: song.queueId || `random-${generateId()}`,
    id: song.id,
    source: song.source || "netease",
    name: song.name,
    artist: song.artist,
    album: song.album,
    pic: song.pic,
    duration: normalizeSongDurationMs(song.duration),
    url: /^https?:\/\//i.test(String(song.url || '')) ? String(song.url) : undefined,
    requestedBy,
    requestedById,
    addedAt: song.addedAt || Date.now(),
  });
}

/** 随机预取等待歌曲等无 queueId 的元数据（不含 url/lrc/raw） */
function serializeSongMeta(item) {
  if (!item) return null;
  if (item.queueId) return serializeQueueItemForRoom(item);
  return {
    id: item.id,
    source: item.source || "netease",
    name: item.name,
    artist: item.artist,
    album: item.album,
    pic: item.pic,
    duration: normalizeSongDurationMs(item.duration),
  };
}

function serializeSongHistoryForClient(item) {
  if (!item) return null;
  return {
    id: item.id,
    source: item.source || "netease",
    name: item.name,
    artist: item.artist,
    album: item.album,
    pic: item.pic,
    duration: normalizeSongDurationMs(item.duration),
    requestedBy: item.requestedBy,
    requestedById: item.requestedById,
    requestedAt: item.requestedAt,
  };
}

function getMessagesForUser(room, userId) {
  if (!userId) return room.messages;
  const user = room.users.get(userId);
  if (user?.chatVisibleSince) {
    return room.messages.filter((message) => message.timestamp >= user.chatVisibleSince);
  }
  return room.messages;
}

/** 分页拉取聊天历史（join 初始 100 条，上滑每次 50 条） */
export function getChatHistoryForUser(roomId, userId, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const limit = Math.min(Math.max(Number(options.limit) || CHAT_PAGE_LIMIT, 1), INITIAL_CHAT_LIMIT);
  const beforeTimestamp = Number(options.before) || 0;
  const beforeId = String(options.beforeId || "").trim();
  const all = getMessagesForUser(room, userId);

  if (beforeTimestamp > 0 || beforeId) {
    let endIndex = all.length;
    if (beforeId) {
      const idx = all.findIndex((message) => message.id === beforeId);
      if (idx >= 0) endIndex = idx;
    } else {
      const idx = all.findIndex((message) => message.timestamp >= beforeTimestamp);
      if (idx >= 0) endIndex = idx;
    }

    const older = all.slice(0, endIndex);
    const messages = older.slice(-limit).map((message) => serializeChatMessage(message, { roomId }));
    return { messages, hasMore: older.length > limit };
  }

  const messages = all.slice(-limit).map((message) => serializeChatMessage(message, { roomId }));
  return { messages, hasMore: all.length > limit };
}

/** 按需拉取播放历史（不随 room_update 广播，不含 url/lrc） */
export function getSongHistory(roomId, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: "房间不存在" };

  const limit = Math.min(Math.max(Number(options.limit) || MAX_SONG_HISTORY, 1), MAX_SONG_HISTORY);
  const songs = (room.songHistory || []).slice(0, limit).map(serializeSongHistoryForClient).filter(Boolean);
  return { songs };
}

/** 上报音频/元数据时长，供服务端自动切歌（不广播 room_update） */
export function reportTrackDuration(roomId, userId, queueId, durationMs, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room?.current) return { error: "无当前歌曲" };

  const expectedQueueId = String(queueId || "");
  if (expectedQueueId && room.current.queueId !== expectedQueueId) {
    return { success: true, skipped: true };
  }

  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return { error: "时长无效" };

  const existing = Number(room.current.duration || 0);
  const isController = isControllerConnection(room, userId, connectionId);
  // 控制者可更新；其他人仅在缺失时长时补种（避免文件已结束但服务端永不 advance）
  if (!isController && existing > 0) return { error: "仅房主或管理员可上报时长" };
  // 允许缩短：CDN 截断预览时长常短于元数据，否则服务端永不 auto-advance
  if (existing > 0 && Math.abs(ms - existing) < 50) return { success: true, skipped: true };

  // 非控制者首次补种时长时，禁止上报过小或小于当前已播放进度的值：
  // 否则任意成员可凭 durationMs:1 触发 advanceEndedRoomNow 立即切歌。
  // 合法补种时长必然 >= 已播放进度（歌未放完）且不小于最小合理歌曲时长。
  if (!isController && existing === 0) {
    const playedMs = Math.max(0, Math.floor(getPlaybackTime(room) * 1000));
    if (ms < Math.max(playedMs, MIN_REPORTABLE_DURATION_MS)) {
      return { error: "上报时长无效" };
    }
  }

  room.current.duration = Math.round(ms);
  persistRoom(room);
  return { success: true };
}

function serializeRoom(room, options = {}) {
  repairPlaybackClock(room);
  const forUserId = options.forUserId || null;
  const forUser = forUserId ? room.users.get(forUserId) : null;
  // 敏感管理字段仅对正式管理权可见；临时播放主控不可窥探禁言名单等
  const viewerCanModerate = forUserId ? canModerate(room, forUserId) : false;
  return {
    id: room.id,
    name: room.name,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    muteAll: Boolean(room.muteAll),
    mutedUserIds: viewerCanModerate ? Array.from(room.mutedUserIds || []) : undefined,
    chatMuted: forUserId ? isUserChatMuted(room, forUserId) : false,
    ownerId: room.ownerId,
    creatorId: room.creatorId ?? null,
    adminIds: getOrderedAdminIds(room),
    maxAdmins: getRoomMaxAdmins(room),
    autoPromotedAdminIds: getOrderedAutoPromotedAdminIds(room),
    userNicknames: viewerCanModerate ? serializeUserNicknamesForViewer(room) : undefined,
    userAvatarUrls: serializeUserAvatarUrlsForViewer(room),
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
    isPlaying: room.isPlaying,
    currentTime: getPlaybackTime(room),
    playbackRate: normalizePlaybackRate(room.playbackRate),
    users: Array.from(room.users.values()).map((user) => serializeUser(user, { roomAvatarUrls: room.userAvatarUrls })),
    userCount: room.users.size,
    jumpRequests: room.jumpRequests,
    skipRequests: room.skipRequests,
    chatVisibleSince: forUser?.chatVisibleSince ?? null,
    nextRandom: serializeQueueItemForRoom(room.nextRandom),
    randomLoading: Boolean(room.randomLoading),
    audioQuality: normalizeRoomAudioQuality(room.audioQuality),
    neteaseFmMode: normalizeFmMode(room.neteaseFmMode),
    fmSource: normalizeFmSource(room.fmSource),
    fmModeBeforeOff: normalizeFmMode(room.fmModeBeforeOff),
    playlistRoaming: normalizePlaylistRoaming(room.playlistRoaming),
    musicAccounts: normalizeMusicAccounts(room.musicAccounts),
    playMode: normalizePlayMode(room.playMode),
    lastPlaybackRequesterId: room.lastPlaybackRequesterId || null,
    announcementEnabled: Boolean(room.announcementEnabled),
    announcementText: String(room.announcementText || "").slice(0, MAX_ANNOUNCEMENT_LENGTH),
    customCoverUrl: normalizeCustomCoverUrl(room.customCoverUrl) || undefined,
    chatHistoryVisibleOnJoin: Boolean(room.chatHistoryVisibleOnJoin),
    chatShowAvatars: Boolean(room.chatShowAvatars),
    joinNoticeEnabled: room.joinNoticeEnabled !== false,
    joinNoticeCooldownSec: normalizeJoinNoticeCooldownSec(room.joinNoticeCooldownSec),
    roomAiEnabled: room.roomAiEnabled !== false,
    roomAiBotName: normalizeRoomAiBotName(room.roomAiBotName) || undefined,
    songRequestEnabled: room.songRequestEnabled !== false,
    songRequestMinStaySec: normalizeSongRequestMinStaySec(room.songRequestMinStaySec),
    songRequestMaxPerUser: normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser),
    songRequestCooldownSec: normalizeSongRequestCooldownSec(room.songRequestCooldownSec),
    queueMaxLength: normalizeQueueMaxLength(room.queueMaxLength),
    memberJumpEnabled: Boolean(room.memberJumpEnabled),
    memberSeekEnabled: Boolean(room.memberSeekEnabled),
    memberPauseEnabled: Boolean(room.memberPauseEnabled),
    systemMediaPlayBound: room.systemMediaPlayBound !== false,
    systemMediaSkipBound: room.systemMediaSkipBound !== false,
    dislikeSkipMode: normalizeDislikeSkipMode(room.dislikeSkipMode),
    dislikeSkipThreshold: normalizeDislikeSkipThreshold(room.dislikeSkipThreshold),
    dislikeSkipPercent: normalizeDislikeSkipPercent(room.dislikeSkipPercent),
    clearSongsOnLeaveEnabled: Boolean(room.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelaySec: normalizeClearSongsOnLeaveDelaySec(room.clearSongsOnLeaveDelaySec),
    bannedSongs: viewerCanModerate ? serializeBannedSongs(room.bannedSongs) : undefined,
    forbiddenWords: viewerCanModerate ? serializeForbiddenWords(ensureForbiddenWords(room)) : undefined,
    memberTiers: serializeMemberTiersMap(room.memberTiers),
    memberSettings: serializeMemberSettings(room.memberSettings),
    adminSelfManageMemberTierEnabled: Boolean(room.adminSelfManageMemberTierEnabled),
    // 仅创建者可见：常驻状态与申请进度
    ...(forUserId && isRoomCreator(room, forUserId)
      ? {
          protectedFromDestroy: protectedRoomIds.has(room.id),
          permanentApplication: toPublicPermanentApplication(peekPermanentApplication(room.id)),
        }
      : {}),
  };
}

/**
 * 预先序列化广播共用载荷，避免人数多时对每个连接重复 map queue/users。
 */
export function prepareRoomBroadcast(roomId) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return null;
  repairPlaybackClock(room);

  const shared = {
    id: room.id,
    name: room.name,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    muteAll: Boolean(room.muteAll),
    ownerId: room.ownerId,
    creatorId: room.creatorId ?? null,
    adminIds: getOrderedAdminIds(room),
    maxAdmins: getRoomMaxAdmins(room),
    autoPromotedAdminIds: getOrderedAutoPromotedAdminIds(room),
    userAvatarUrls: serializeUserAvatarUrlsForViewer(room),
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
    isPlaying: room.isPlaying,
    currentTime: getPlaybackTime(room),
    playbackRate: normalizePlaybackRate(room.playbackRate),
    users: Array.from(room.users.values()).map((user) => serializeUser(user, { includeLocation: false, roomAvatarUrls: room.userAvatarUrls })),
    userCount: room.users.size,
    jumpRequests: room.jumpRequests,
    skipRequests: room.skipRequests,
    nextRandom: serializeQueueItemForRoom(room.nextRandom),
    randomLoading: Boolean(room.randomLoading),
    audioQuality: normalizeRoomAudioQuality(room.audioQuality),
    neteaseFmMode: normalizeFmMode(room.neteaseFmMode),
    fmSource: normalizeFmSource(room.fmSource),
    fmModeBeforeOff: normalizeFmMode(room.fmModeBeforeOff),
    playlistRoaming: normalizePlaylistRoaming(room.playlistRoaming),
    musicAccounts: normalizeMusicAccounts(room.musicAccounts),
    playMode: normalizePlayMode(room.playMode),
    lastPlaybackRequesterId: room.lastPlaybackRequesterId || null,
    announcementEnabled: Boolean(room.announcementEnabled),
    announcementText: String(room.announcementText || "").slice(0, MAX_ANNOUNCEMENT_LENGTH),
    customCoverUrl: normalizeCustomCoverUrl(room.customCoverUrl) || undefined,
    chatHistoryVisibleOnJoin: Boolean(room.chatHistoryVisibleOnJoin),
    chatShowAvatars: Boolean(room.chatShowAvatars),
    joinNoticeEnabled: room.joinNoticeEnabled !== false,
    joinNoticeCooldownSec: normalizeJoinNoticeCooldownSec(room.joinNoticeCooldownSec),
    roomAiEnabled: room.roomAiEnabled !== false,
    roomAiBotName: normalizeRoomAiBotName(room.roomAiBotName) || undefined,
    songRequestEnabled: room.songRequestEnabled !== false,
    songRequestMinStaySec: normalizeSongRequestMinStaySec(room.songRequestMinStaySec),
    songRequestMaxPerUser: normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser),
    songRequestCooldownSec: normalizeSongRequestCooldownSec(room.songRequestCooldownSec),
    queueMaxLength: normalizeQueueMaxLength(room.queueMaxLength),
    memberJumpEnabled: Boolean(room.memberJumpEnabled),
    memberSeekEnabled: Boolean(room.memberSeekEnabled),
    memberPauseEnabled: Boolean(room.memberPauseEnabled),
    systemMediaPlayBound: room.systemMediaPlayBound !== false,
    systemMediaSkipBound: room.systemMediaSkipBound !== false,
    dislikeSkipMode: normalizeDislikeSkipMode(room.dislikeSkipMode),
    dislikeSkipThreshold: normalizeDislikeSkipThreshold(room.dislikeSkipThreshold),
    dislikeSkipPercent: normalizeDislikeSkipPercent(room.dislikeSkipPercent),
    clearSongsOnLeaveEnabled: Boolean(room.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelaySec: normalizeClearSongsOnLeaveDelaySec(room.clearSongsOnLeaveDelaySec),
    memberTiers: serializeMemberTiersMap(room.memberTiers),
    memberSettings: serializeMemberSettings(room.memberSettings),
    adminSelfManageMemberTierEnabled: Boolean(room.adminSelfManageMemberTierEnabled),
  };

  const moderatorExtras = {
    mutedUserIds: Array.from(room.mutedUserIds || []),
    userNicknames: serializeUserNicknamesForViewer(room),
    bannedSongs: serializeBannedSongs(room.bannedSongs),
    forbiddenWords: serializeForbiddenWords(ensureForbiddenWords(room)),
  };

  return { room, shared, moderatorExtras };
}

export function roomUpdateForViewer(prepared, viewerUserId = null) {
  if (!prepared) return null;
  const { room, shared, moderatorExtras } = prepared;
  const viewerCanModerate = viewerUserId ? canModerate(room, viewerUserId) : false;
  const creatorExtras = viewerUserId && isRoomCreator(room, viewerUserId)
    ? {
        protectedFromDestroy: protectedRoomIds.has(room.id),
        permanentApplication: toPublicPermanentApplication(peekPermanentApplication(room.id)),
      }
    : {};
  return {
    ...shared,
    ...(viewerCanModerate ? moderatorExtras : {}),
    ...creatorExtras,
    chatMuted: viewerUserId ? isUserChatMuted(room, viewerUserId) : false,
    // chatVisibleSince 仅进房 ACK 下发，后续广播省略以缩小载荷并便于整房共享
  };
}

/**
 * 成员进出只需要同步在线成员与角色，不重复广播队列、播放设置等完整房间状态。
 * 这能把高并发进房时的广播从「完整房间快照 × 在线人数」缩小为轻量 presence 包。
 */
export function prepareRoomPresence(roomId) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return null;

  return {
    room,
    shared: {
      id: room.id,
      ownerId: room.ownerId,
      creatorId: room.creatorId ?? null,
      adminIds: getOrderedAdminIds(room),
      maxAdmins: getRoomMaxAdmins(room),
      autoPromotedAdminIds: getOrderedAutoPromotedAdminIds(room),
      userAvatarUrls: serializeUserAvatarUrlsForViewer(room),
      users: Array.from(room.users.values()).map((user) => serializeUser(user, { includeLocation: false, roomAvatarUrls: room.userAvatarUrls })),
      userCount: room.users.size,
      jumpRequests: room.jumpRequests,
      skipRequests: room.skipRequests,
    },
    moderatorUserNicknames: null,
  };
}

export function roomPresenceForViewer(prepared, viewerUserId = null) {
  if (!prepared) return null;
  const { room, shared } = prepared;
  const viewerCanModerate = viewerUserId ? canModerate(room, viewerUserId) : false;
  if (viewerCanModerate && !prepared.moderatorUserNicknames) {
    prepared.moderatorUserNicknames = serializeUserNicknamesForViewer(room);
  }
  return {
    ...shared,
    ...(viewerCanModerate ? { userNicknames: prepared.moderatorUserNicknames } : {}),
  };
}

/** 按观众身份序列化房间（隐藏禁言名单、离线昵称映射等管理字段） */
export function serializeRoomForViewer(roomId, viewerUserId = null) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return null;
  return serializeRoom(room, { forUserId: viewerUserId || null });
}

export function getRoomInternal(roomId) {
  return rooms.get(roomId);
}

export function persistRoomById(roomId) {
  const room = rooms.get(roomId);
  if (room) persistRoom(room);
}
