/**
 * 每房间 × 每用户的 AI 状态：关系、画像与候选，随房间持久化和清理
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

/**
 * @returns {{ ok: true, name: string } | { ok: false, reason: string }}
 */
export function validatePreferredCallName(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'invalid' };
  const name = raw.trim();
  if (!name) return { ok: false, reason: 'empty' };
  if (name.length > 8) return { ok: false, reason: 'too_long' };
  if (/[\u0000-\u001F\u007F]/u.test(name)) return { ok: false, reason: 'invalid' };
  return { ok: true, name };
}

/** 交互计数只记录事实，不从聊天原文匹配语义 */
export function recordAiUserInteraction(roomId, userId) {
  const entry = getEntry(roomId, userId);
  if (!entry) return;
  const profile = entry.profile;
  const now = Date.now();
  profile.interactionCount = Math.min(9999, (profile.interactionCount || 0) + 1);
  profile.lastInteractionAt = now;

  entry.updatedAt = now;
  persistHook?.(String(roomId || '').trim().toUpperCase());
}

/** 仅接受模型选择的结构化记忆，成员身份由调用端绑定 */
export function updateAiUserMemory(roomId, userId, updates = {}) {
  const fields = ['preferredCallName', 'likedArtist', 'mood', 'dislike', 'removeDislike', 'note'];
  for (const key of fields) {
    if (updates[key] !== undefined && (typeof updates[key] !== 'string' || updates[key].length > 80)) {
      return { success: false, code: 'INVALID_ARGUMENTS', error: '记忆字段需为80字符以内的文本' };
    }
  }
  const callName = updates.preferredCallName?.trim();
  if (callName) {
    const checked = validatePreferredCallName(callName);
    if (!checked.ok) return { success: false, code: 'INVALID_ARGUMENTS', error: '该称呼不符合成员称呼规则，请由模型选择正常称呼' };
  }
  const entry = getEntry(roomId, userId);
  if (!entry) return { success: false, error: '成员上下文不存在' };
  const profile = entry.profile;
  if (callName !== undefined) profile.preferredCallName = callName;
  if (updates.likedArtist?.trim()) {
    pushUniqueLimited(profile.notes, `喜欢的歌手：${updates.likedArtist.trim()}`, 6);
    bumpArtistCount(profile, updates.likedArtist.trim());
  }
  if (updates.mood?.trim()) pushUniqueLimited(profile.recentMoods, updates.mood.trim(), 6);
  if (updates.dislike?.trim()) pushUniqueLimited(profile.dislikes, updates.dislike.trim(), 6);
  if (updates.removeDislike?.trim()) profile.dislikes = profile.dislikes.filter((item) => item !== updates.removeDislike.trim());
  if (updates.note?.trim()) pushUniqueLimited(profile.notes, updates.note.trim(), 6);
  entry.updatedAt = Date.now();
  persistHook?.(String(roomId || '').trim().toUpperCase());
  return { success: true };
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

export function forgiveAiUserAfterApology(roomId, userId) {
  const entry = getEntry(roomId, userId);
  if (!entry || (!entry.violationCount && entry.ignoredUntil <= Date.now())) return false;
  entry.ignoredUntil = 0;
  entry.violationCount = Math.max(0, (entry.violationCount || 0) - 2);
  entry.updatedAt = Date.now();
  persistHook?.(String(roomId || '').trim().toUpperCase());
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
  persistHook?.(String(roomId || '').trim().toUpperCase());
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
