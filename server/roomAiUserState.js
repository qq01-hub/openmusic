/**
 * 每房间 × 每用户的 AI 状态：关系温度与个性化画像（内存，随房间销毁清理）。
 */
import { trimMapByUpdatedAt } from './roomAiMemory.js';

const states = new Map();
const MAX_USER_STATE_ENTRIES = 2400;
/** 违规冷处理基准时长 */
const IGNORE_BASE_MS = 22 * 60 * 1000;
const SONG_CANDIDATES_TTL_MS = 15 * 60 * 1000;

let persistHook = null;

/** 注册房间持久化回调，使成员画像与偏好随房间持久化到 Redis */
export function setRoomAiUserStatePersistHook(fn) {
  persistHook = typeof fn === 'function' ? fn : null;
}
const MOOD_KEYWORDS = [
  '治愈', '摇滚', '说唱', '民谣', '电子', '古典', '爵士', '粤语', '国语', '英语',
  '安静', '学习', '运动', '开车', '夜听', '睡前', 'emo', '伤感', '快乐', '兴奋',
  '放松', '专注', '派对', '怀旧', '二次元', '纯音乐', '轻音乐',
];

function stateKey(roomId, userId) {
  const rid = String(roomId || '').trim().toUpperCase();
  const uid = String(userId || '').trim();
  if (!rid || !uid) return '';
  return `${rid}:${uid}`;
}

function pruneExpired() {
  trimMapByUpdatedAt(states, MAX_USER_STATE_ENTRIES, (v) => v?.updatedAt || 0);
}
function defaultProfile() {
  return {
    interactionCount: 0,
    songRequestCount: 0,
    preferredCallName: '',
    artistCounts: {},
    recentMoods: [],
    recentSongs: [],
    dislikes: [],
    notes: [],
    firstSeenAt: Date.now(),
    lastInteractionAt: 0,
  };
}

function getEntry(roomId, userId) {
  const key = stateKey(roomId, userId);
  if (!key) return null;
  pruneExpired();
  let entry = states.get(key);
  if (!entry) {
    entry = {
      violationCount: 0,
      ignoredUntil: 0,
      profile: defaultProfile(),
      songCandidates: [],
      songCandidatesUpdatedAt: 0,
      updatedAt: Date.now(),
    };
    states.set(key, entry);
  }
  if (!entry.profile) entry.profile = defaultProfile();
  entry.updatedAt = Date.now();
  return entry;
}

function bumpArtistCount(profile, artist) {
  const name = String(artist || '').trim().slice(0, 32);
  if (!name || name === '未知') return;
  profile.artistCounts[name] = (profile.artistCounts[name] || 0) + 1;
  const keys = Object.keys(profile.artistCounts);
  if (keys.length > 24) {
    const sorted = keys.sort((a, b) => profile.artistCounts[b] - profile.artistCounts[a]);
    for (const drop of sorted.slice(20)) delete profile.artistCounts[drop];
  }
}

function pushUniqueLimited(list, value, max = 8) {
  const item = String(value || '').trim().slice(0, 48);
  if (!item) return;
  const next = list.filter((x) => x !== item);
  next.unshift(item);
  list.splice(0, list.length, ...next.slice(0, max));
}

/** 禁止不当/戏谑/尊卑型称呼（如爸爸、主人等） */
const BLOCKED_CALL_NAMES = new Set([
  '爸爸', '爸比', '爹', '爹地', '父亲', '老妈', '妈妈', '妈咪', '母亲', '爷爷', '奶奶', '外公', '外婆',
  '祖宗', '主人', '主子', '陛下', '皇上', '奴隶', '狗子', '儿子', '女儿', '孙子', '孙女', '宝贝儿',
  '老公', '老婆', '亲爱的', '宝宝', '主人大人', '爸爸大人', 'mommy', 'daddy', 'master', 'slave',
]);

const BLOCKED_CALL_NAME_RES = [
  /爸|妈|爷|奶|外公|外婆/,
  /主人|主子|陛下|皇上|奴隶|狗子/,
  /叫爸爸|叫主人|叫爹|叫妈/,
  /master|daddy|mommy|slave|owner/i,
  /^您|^朕|^本座|^本王/,
];

/**
 * @returns {{ ok: true, name: string } | { ok: false, reason: string }}
 */
export function validatePreferredCallName(raw) {
  const name = String(raw || '').trim().slice(0, 12);
  if (!name) return { ok: false, reason: 'empty' };
  if (name.length > 8) return { ok: false, reason: 'too_long' };
  if (/^[0-9\s\p{P}]+$/u.test(name)) return { ok: false, reason: 'invalid' };
  const lower = name.toLowerCase();
  if (BLOCKED_CALL_NAMES.has(name) || BLOCKED_CALL_NAMES.has(lower)) {
    return { ok: false, reason: 'inappropriate' };
  }
  for (const re of BLOCKED_CALL_NAME_RES) {
    if (re.test(name)) return { ok: false, reason: 'inappropriate' };
  }
  return { ok: true, name };
}

/** 从用户聊天里提取可记忆的偏好信号（不含改 bot 名） */
export function extractUserChatSignals(text) {
  const content = String(text || '').trim();
  if (!content || content.length < 2) return null;
  const signals = {};

  const callMatch = content.match(/(?:可以|请)?叫我[「"']?([^「」"'，,。!！?？\s]{1,12})/);
  if (callMatch?.[1]) {
    const attempted = callMatch[1].trim();
    const validated = validatePreferredCallName(attempted);
    if (validated.ok) {
      signals.preferredCallName = validated.name;
    } else {
      signals.rejectedCallName = { attempted, reason: validated.reason };
    }
  }

  const artistMatch = content.match(/(?:最喜欢|最爱|喜欢|常听)(?:的)?(?:歌手|艺人|乐队)(?:是|叫)?[「"']?([^「」"'，,。!！?？\n]{2,20})/);
  if (artistMatch?.[1]) {
    signals.likedArtist = artistMatch[1].trim();
  } else {
    const likeMatch = content.match(/(?:最喜欢|最爱|喜欢|常听)[「"']?([^「」"'，,。!！?？\n]{2,20})/);
    if (likeMatch?.[1]) signals.likeTopic = likeMatch[1].trim();
  }

  const dislikeMatch = content.match(/(?:不要|别|不想听|讨厌|拒绝)(?:推荐|放|听)?[「"']?([^「」"'，,。!！?？\n]{2,20})/);
  if (dislikeMatch?.[1]) signals.dislike = dislikeMatch[1].trim();

  for (const mood of MOOD_KEYWORDS) {
    if (content.includes(mood)) {
      signals.mood = mood;
      break;
    }
  }

  if (Object.keys(signals).length === 0) return null;
  return signals;
}

export function recordAiUserInteraction(roomId, userId, payload = {}) {
  const entry = getEntry(roomId, userId);
  if (!entry) return;
  const profile = entry.profile;
  const now = Date.now();
  profile.interactionCount = Math.min(9999, (profile.interactionCount || 0) + 1);
  profile.lastInteractionAt = now;

  const text = String(payload.text || '').trim();
  const signals = extractUserChatSignals(text);
  if (signals?.preferredCallName) {
    profile.preferredCallName = signals.preferredCallName;
  }
  if (signals?.rejectedCallName) {
    pushUniqueLimited(profile.notes, `曾要求不当称呼「${signals.rejectedCallName.attempted}」（已拒绝）`, 4);
  }
  if (signals?.likeTopic) {
    pushUniqueLimited(profile.notes, `说过喜欢：${signals.likeTopic}`, 6);
  }
  if (signals?.likedArtist) {
    pushUniqueLimited(profile.notes, `喜欢的歌手：${signals.likedArtist}`, 6);
    bumpArtistCount(profile, signals.likedArtist);
  }
  if (signals?.dislike) {
    pushUniqueLimited(profile.dislikes, signals.dislike, 6);
  }
  if (signals?.mood) {
    pushUniqueLimited(profile.recentMoods, signals.mood, 6);
  }

  entry.updatedAt = now;
  persistHook?.(String(roomId || '').trim().toUpperCase());
}

function familiarityLevel(interactionCount) {
  const n = Number(interactionCount) || 0;
  if (n >= 15) return 'regular';
  if (n >= 3) return 'acquaintance';
  return 'new';
}

/** 供 system prompt 注入的用户画像摘要 */
export function getAiUserProfile(roomId, userId) {
  const entry = getEntry(roomId, userId);
  if (!entry) {
    return {
      familiarity: 'new',
      interactionCount: 0,
      isFirstMeeting: true,
    };
  }
  const profile = entry.profile || defaultProfile();
  const now = Date.now();
  const lastAt = profile.lastInteractionAt || profile.firstSeenAt || now;
  const lastSeenMinutesAgo = Math.max(0, Math.round((now - lastAt) / 60000));
  const topArtists = Object.entries(profile.artistCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return {
    familiarity: familiarityLevel(profile.interactionCount),
    interactionCount: profile.interactionCount || 0,
    songRequestCount: profile.songRequestCount || 0,
    isFirstMeeting: (profile.interactionCount || 0) <= 1,
    preferredCallName: profile.preferredCallName || '',
    topArtists,
    recentMoods: [...(profile.recentMoods || [])].slice(0, 5),
    recentSongs: [...(profile.recentSongs || [])].slice(0, 5),
    dislikes: [...(profile.dislikes || [])].slice(0, 4),
    notes: [...(profile.notes || [])].slice(0, 4),
    lastSeenMinutesAgo,
  };
}
export function getAiUserRapport(roomId, userId) {
  const entry = getEntry(roomId, userId);
  if (!entry) return { violationCount: 0, ignoredUntil: 0, rapportStage: 'normal' };
  const now = Date.now();
  if (entry.ignoredUntil > now) {
    return {
      violationCount: entry.violationCount,
      ignoredUntil: entry.ignoredUntil,
      rapportStage: 'ignoring',
      ignoreRemainSec: Math.ceil((entry.ignoredUntil - now) / 1000),
    };
  }
  let rapportStage = 'normal';
  if (entry.violationCount >= 3) rapportStage = 'angry';
  else if (entry.violationCount >= 2) rapportStage = 'annoyed';
  else if (entry.violationCount >= 1) rapportStage = 'mild';
  return {
    violationCount: entry.violationCount,
    ignoredUntil: 0,
    rapportStage,
  };
}

export function isAiUserIgnored(roomId, userId) {
  const entry = getEntry(roomId, userId);
  if (!entry) return false;
  return entry.ignoredUntil > Date.now();
}

export function forgiveAiUserAfterApology(roomId, userId, text) {
  const content = String(text || '').trim();
  if (!/(?:对不起|抱歉|我错了|不该这样|不该那么说|sorry)/i.test(content)) return false;
  const entry = getEntry(roomId, userId);
  if (!entry || entry.ignoredUntil <= Date.now()) return false;
  entry.ignoredUntil = 0;
  entry.violationCount = Math.max(0, (entry.violationCount || 0) - 2);
  entry.updatedAt = Date.now();
  return true;
}

export function recordAiSongRequest(roomId, userId, song = {}) {
  const entry = getEntry(roomId, userId);
  if (!entry) return;
  const profile = entry.profile;
  const name = String(song.name || '').trim().slice(0, 80);
  const artist = String(song.artist || '').trim().slice(0, 48);
  profile.songRequestCount = Math.min(9999, (profile.songRequestCount || 0) + 1);
  if (name) pushUniqueLimited(profile.recentSongs, artist ? `${name} - ${artist}` : name, 8);
  bumpArtistCount(profile, artist);
  entry.updatedAt = Date.now();
  persistHook?.(String(roomId || '').trim().toUpperCase());
}

/** 保存当前用户最近一次搜歌/推荐的候选，供下一条消息选择歌曲。 */
export function setAiSongCandidates(roomId, userId, songs = []) {
  const entry = getEntry(roomId, userId);
  if (!entry) return;
  entry.songCandidates = Array.isArray(songs)
    ? songs.filter((song) => song && song.id).slice(0, 5).map((song) => ({
      index: Number(song.index) || 0,
      id: String(song.id),
      name: String(song.name || '').slice(0, 100),
      artist: String(song.artist || '').slice(0, 80),
      pic: String(song.pic || '').slice(0, 500),
      server: String(song.server || 'netease'),
    }))
    : [];
  entry.songCandidatesUpdatedAt = Date.now();
  entry.updatedAt = Date.now();
}

/** 获取尚未过期的候选；候选按用户隔离，避免串歌。 */
export function getAiSongCandidates(roomId, userId) {
  const entry = getEntry(roomId, userId);
  if (!entry || !Array.isArray(entry.songCandidates)) return [];
  if (Date.now() - (entry.songCandidatesUpdatedAt || 0) > SONG_CANDIDATES_TTL_MS) {
    entry.songCandidates = [];
    entry.songCandidatesUpdatedAt = 0;
    return [];
  }
  return entry.songCandidates.map((song) => ({ ...song }));
}

/** @returns {{ ignored: boolean, violationCount: number, justEnteredIgnore?: boolean }} */
export function recordAiUserViolation(roomId, userId, reason = '') {
  const entry = getEntry(roomId, userId);
  if (!entry) return { ignored: false, violationCount: 0 };
  entry.violationCount = Math.min(99, (entry.violationCount || 0) + 1);
  entry.lastViolationReason = String(reason || '').slice(0, 80);
  entry.updatedAt = Date.now();
  let justEnteredIgnore = false;
  if (entry.violationCount >= 4) {
    entry.ignoredUntil = Date.now() + IGNORE_BASE_MS;
    justEnteredIgnore = true;
  }
  persistHook?.(String(roomId || '').trim().toUpperCase());
  return {
    ignored: entry.ignoredUntil > Date.now(),
    violationCount: entry.violationCount,
    justEnteredIgnore,
    reason: entry.lastViolationReason,
  };
}

/** 导出该房间的全部成员画像与关系状态，随房间写入 Redis */
export function exportRoomAiUserStateForStorage(roomId) {
  const rid = String(roomId || '').trim().toUpperCase();
  if (!rid) return null;
  const prefix = `${rid}:`;
  const out = {};
  for (const [key, entry] of states.entries()) {
    if (!key.startsWith(prefix)) continue;
    const uid = key.slice(prefix.length);
    if (!uid || !entry) continue;
    out[uid] = {
      violationCount: Number(entry.violationCount) || 0,
      ignoredUntil: Number(entry.ignoredUntil) || 0,
      lastViolationReason: entry.lastViolationReason || undefined,
      profile: entry.profile || defaultProfile(),
      songCandidates: Array.isArray(entry.songCandidates) ? entry.songCandidates.slice(0, 5) : [],
      songCandidatesUpdatedAt: Number(entry.songCandidatesUpdatedAt) || 0,
      updatedAt: Number(entry.updatedAt) || Date.now(),
    };
  }
  return Object.keys(out).length ? out : null;
}

/** 从房间存储快照恢复成员画像与关系状态 */
export function restoreRoomAiUserStateFromStorage(roomId, stored) {
  const rid = String(roomId || '').trim().toUpperCase();
  if (!rid || !stored || typeof stored !== 'object') return;
  for (const [uid, raw] of Object.entries(stored)) {
    if (!uid || !raw || typeof raw !== 'object') continue;
    const key = `${rid}:${uid}`;
    const rawProfile = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
    states.set(key, {
      violationCount: Math.max(0, Number(raw.violationCount) || 0),
      ignoredUntil: Math.max(0, Number(raw.ignoredUntil) || 0),
      lastViolationReason: raw.lastViolationReason ? String(raw.lastViolationReason).slice(0, 80) : undefined,
      profile: {
        ...defaultProfile(),
        ...rawProfile,
        artistCounts: rawProfile.artistCounts && typeof rawProfile.artistCounts === 'object' ? rawProfile.artistCounts : {},
        recentMoods: Array.isArray(rawProfile.recentMoods) ? rawProfile.recentMoods.slice(0, 8) : [],
        recentSongs: Array.isArray(rawProfile.recentSongs) ? rawProfile.recentSongs.slice(0, 8) : [],
        dislikes: Array.isArray(rawProfile.dislikes) ? rawProfile.dislikes.slice(0, 6) : [],
        notes: Array.isArray(rawProfile.notes) ? rawProfile.notes.slice(0, 6) : [],
      },
      songCandidates: Array.isArray(raw.songCandidates) ? raw.songCandidates.slice(0, 5) : [],
      songCandidatesUpdatedAt: Number(raw.songCandidatesUpdatedAt) || 0,
      updatedAt: Number(raw.updatedAt) || Date.now(),
    });
  }
}

export function clearRoomAiUserState(roomId) {
  const rid = String(roomId || '').trim().toUpperCase();
  if (!rid) return;
  for (const key of states.keys()) {
    if (key.startsWith(`${rid}:`)) states.delete(key);
  }
}
