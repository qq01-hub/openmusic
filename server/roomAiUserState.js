/**
 * 每房间 × 每用户的 AI 状态：关系、画像、情绪、社交距离、连续牵引与候选，随房间持久化和清理
 * 参考 tencent-connect/dsh-qqbot 与 nanbengxian-cyber/dafeiyu-qq-bot (dsh-social / dsh-emotion / dsh-spine / dsh-persona-core)
 */
import { trimMapByUpdatedAt } from './roomAiMemory.js';

const states = new Map();
const roomStates = new Map();
const MAX_USER_STATE_ENTRIES = 2400;
const MAX_ROOM_STATE_ENTRIES = 800;
/** 违规冷处理基准时长 */
const IGNORE_BASE_MS = 22 * 60 * 1000;
const SONG_CANDIDATES_TTL_MS = 15 * 60 * 1000;
const AFFINITY_HALF_LIFE_MS = 30 * 24 * 3600 * 1000;
const DAILY_AFFINITY_CAP = 10;
const STREAK_WINDOW_MS = 15 * 60 * 1000;
const EXPLOIT_TTL_MS = 120 * 1000;

const EMOTION_TTL_MS = {
  angry: 30 * 60 * 1000,
  sad: 30 * 60 * 1000,
  worried: 15 * 60 * 1000,
  happy: 15 * 60 * 1000,
  proud: 15 * 60 * 1000,
  curious: 10 * 60 * 1000,
  awkward: 10 * 60 * 1000,
  excited: 10 * 60 * 1000,
  surprised: 10 * 60 * 1000,
};

let persistHook = null;

/** 注册房间持久化回调，使成员画像与偏好随房间持久化到 Redis */
export function setRoomAiUserStatePersistHook(fn) {
  persistHook = typeof fn === 'function' ? fn : null;
}

function normalizeRoomKey(roomId) {
  return String(roomId || '').trim().toUpperCase();
}

function stateKey(roomId, userId) {
  const rid = normalizeRoomKey(roomId);
  const uid = String(userId || '').trim();
  if (!rid || !uid) return '';
  return `${rid}:${uid}`;
}

function pruneExpired() {
  trimMapByUpdatedAt(states, MAX_USER_STATE_ENTRIES, (v) => v?.updatedAt || 0);
  trimMapByUpdatedAt(roomStates, MAX_ROOM_STATE_ENTRIES, (v) => v?.updatedAt || 0);
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
    affinity: 0,
    trust: 20,
    affinityUpdatedAt: Date.now(),
    dailyAffinityDay: '',
    dailyAffinityUsed: 0,
  };
}

function defaultEmotionState() {
  return {
    emotion: 'calm',
    intensity: 0,
    startedAt: 0,
    expiresAt: 0,
    neutralRun: 0,
    evidence: '',
  };
}

function getRoomStateEntry(roomId) {
  const rid = normalizeRoomKey(roomId);
  if (!rid) return null;
  pruneExpired();
  let entry = roomStates.get(rid);
  if (!entry) {
    entry = {
      emotionState: defaultEmotionState(),
      streak: null,
      recentExploits: [],
      updatedAt: Date.now(),
    };
    roomStates.set(rid, entry);
  }
  if (!entry.emotionState) entry.emotionState = defaultEmotionState();
  if (!Array.isArray(entry.recentExploits)) entry.recentExploits = [];
  entry.updatedAt = Date.now();
  return entry;
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

function decayAffinity(value, elapsedMs) {
  const num = Number(value) || 0;
  if (!num || elapsedMs <= 0) return num;
  return num * (0.5 ** (elapsedMs / Math.max(1, AFFINITY_HALF_LIFE_MS)));
}

function clampDailyDelta(requested, usedToday, cap = DAILY_AFFINITY_CAP) {
  const remainingPositive = cap - Math.max(0, usedToday);
  const remainingNegative = -cap - Math.min(0, usedToday);
  return Math.max(remainingNegative, Math.min(remainingPositive, requested));
}

function applySocialDelta(profile, affinityDelta, trustDelta, now = Date.now()) {
  if (!profile) return;
  const day = new Date(now).toISOString().slice(0, 10);
  if (profile.dailyAffinityDay !== day) {
    profile.dailyAffinityDay = day;
    profile.dailyAffinityUsed = 0;
  }
  const decayed = decayAffinity(profile.affinity || 0, now - (profile.affinityUpdatedAt || now));
  const applied = clampDailyDelta(affinityDelta, Number(profile.dailyAffinityUsed) || 0);
  profile.affinity = Math.max(-100, Math.min(100, Number((decayed + applied).toFixed(2))));
  profile.trust = Math.max(0, Math.min(100, Number(((Number(profile.trust ?? 20) || 20) + trustDelta).toFixed(2))));
  profile.affinityUpdatedAt = now;
  profile.dailyAffinityUsed = Number(((Number(profile.dailyAffinityUsed) || 0) + applied).toFixed(2));
}

export function resolveSocialDistanceTier(profile, now = Date.now()) {
  if (!profile) return '陌生';
  const affinity = decayAffinity(profile.affinity || 0, now - (profile.affinityUpdatedAt || now));
  const trust = Number(profile.trust ?? 20) || 20;
  const count = Number(profile.interactionCount) || 0;
  if (affinity <= -50) return '避让';
  if (affinity <= -15) return '疏离';
  if ((affinity >= 50 && trust >= 45) || (count >= 25 && affinity >= 15)) return '亲近';
  if (affinity >= 15 || count >= 5) return '熟人';
  return '陌生';
}

const THANKS_RE = /(?:谢谢|谢了|谢啦|感谢|多谢|辛苦了|帮大忙|太棒了|真棒|厉害|牛逼|好听|爱了|给力|靠谱)/u;
const DIRECT_INSULT_RE = /(?:傻[逼bB]|煞笔|蠢[货蛋]?|智障|脑残|废物|垃圾|滚蛋|滚开|去死|狗东西|弱智|有病)/u;
const BOUNDARY_RE = /(?:别|不要|能不能别|麻烦别|闭嘴|消停点).{0,8}(?:说|插话|回|回复|吵|叭叭)/u;
const RESET_EMOTION_RE = /对不起|抱歉|我说错了|我错了|误会了|是我不对|事情解决了|谢谢你解释|不好意思/u;
const QUESTION_STRUCT_RE = /[？?]|为什么|为啥|怎么(?:回事|会|办|做|点|搜)|难道|是不是|能不能|真的吗|[吗呢]$/u;
const THIRD_PARTY_EMOTION_RE = /(?:他|她|它|他们|她们|别人|有人)[^。！？!?]{0,10}(?:滚|闭嘴|傻逼|废物|垃圾|难过|伤心|崩溃|失望|开心|厉害)/u;

const EMOTION_EXCLUDE = {
  awkward: ['余额', '额度', '金额', '配额', '限额', '额外', '名额'],
  angry: ['闭嘴符'],
  sad: ['失望值'],
  excited: ['马斯克'],
  proud: ['骄傲自满'],
};

const EMOTION_WORDS = {
  angry: ['滚开', '滚吧', '闭嘴', '傻逼', '废物', '垃圾', '有病', '别烦', '神经病', '气死', '烦死', '恼火', '滚蛋'],
  sad: ['难过', '伤心', '崩溃', '失望', '委屈', '好累', '心累', 'emo', '破防', '绷不住', '想哭', '哭了', '难受', '孤单', '心酸', '泪目'],
  worried: ['好慌', '害怕', '怎么办啊', '完蛋', '要凉', '心里没底', '紧张', '凉了'],
  curious: ['为什么', '怎么回事', '真的吗', '何意味', '能不能解释', '怎么做到', '什么歌', '哪首歌'],
  surprised: ['卧槽', '不会吧', '离谱', '惊了', '吓一跳', '还能这样', '真的假的', '什么鬼', '神了'],
  excited: ['起飞', '芜湖', '冲冲冲', '太期待了', '激动', '热血', '爽爆', '燥起来', '嗨起来'],
  happy: ['太好了', '开心', '牛逼', '厉害', '谢谢你', '干得好', '太强了', '笑死', '绝了', '太棒了', '好耶', '真棒', '给力'],
  proud: ['得意', '炫耀', '牛不牛', '夸我', '我厉害吧', '服不服'],
  awkward: ['尴尬', '冷场', '没人理', '无语了', '社死', '脚趾抠地', '窒息', '沉默了'],
};

const EMOTION_ORDER = ['angry', 'sad', 'worried', 'curious', 'surprised', 'excited', 'happy', 'proud', 'awkward'];

const EMOTION_CN = {
  calm: '平稳',
  happy: '开心',
  sad: '低落',
  angry: '生气',
  curious: '好奇',
  awkward: '尴尬',
  excited: '兴奋',
  surprised: '惊讶',
  proud: '小得意',
  worried: '担心',
};

export function extractEmotionCandidate(text, directed = true) {
  const clean = String(text || '').trim();
  if (!clean || clean.startsWith('/')) return null;
  if (RESET_EMOTION_RE.test(clean)) {
    return { emotion: 'calm', intensity: 3, kind: 'reset', directed, evidence: clean.slice(0, 60) };
  }
  if (THIRD_PARTY_EMOTION_RE.test(clean) && !directed) return null;

  let matched = null;
  for (const emotion of EMOTION_ORDER) {
    const excludes = EMOTION_EXCLUDE[emotion] || [];
    if (excludes.some((bad) => clean.includes(bad))) continue;
    if ((EMOTION_WORDS[emotion] || []).some((word) => clean.includes(word))) {
      matched = emotion;
      break;
    }
  }
  if (!matched) {
    if (/^(?:哈{2,}|嘿{2,}|哈哈+[。.!！~]*)$/u.test(clean)) matched = 'happy';
    else if (/^[额呃]{1,4}[。.!！~]?$/u.test(clean)) matched = 'awkward';
    else if (directed && QUESTION_STRUCT_RE.test(clean)) matched = 'curious';
    else return null;
  }
  if (matched === 'angry' && !directed) return null;
  if (matched === 'curious' && !(directed && QUESTION_STRUCT_RE.test(clean))) return null;
  const intensity = matched === 'angry' ? 3 : (directed ? 2 : 1);
  return { emotion: matched, intensity, kind: 'trigger', directed, evidence: clean.slice(0, 60) };
}

export function transitionRoomEmotion(previous, candidate, now = Date.now(), countNeutral = true) {
  const old = { ...defaultEmotionState(), ...(previous || {}) };
  if (old.emotion !== 'calm' && old.expiresAt && now >= old.expiresAt) {
    Object.assign(old, defaultEmotionState(), { startedAt: now });
  }
  if (!candidate) {
    if (old.emotion === 'calm' || !countNeutral) return old;
    const run = (Number(old.neutralRun) || 0) + 1;
    if (run >= 3) return { ...defaultEmotionState(), startedAt: now };
    return { ...old, neutralRun: run };
  }
  if (candidate.kind === 'reset' || candidate.emotion === 'calm') {
    return { ...defaultEmotionState(), startedAt: now, evidence: candidate.evidence || '' };
  }
  const emotion = candidate.emotion;
  const intensity = Math.max(1, Math.min(3, Number(candidate.intensity) || 1));
  if (old.emotion !== 'calm' && old.emotion !== emotion && intensity < (Number(old.intensity) || 1)) {
    return { ...old, neutralRun: 0 };
  }
  return {
    emotion,
    intensity,
    startedAt: old.emotion === emotion && old.startedAt ? old.startedAt : now,
    expiresAt: now + (EMOTION_TTL_MS[emotion] || 15 * 60 * 1000),
    neutralRun: 0,
    evidence: String(candidate.evidence || '').slice(0, 60),
  };
}

export function getRoomAiEmotionSummary(roomId, now = Date.now()) {
  const roomEntry = getRoomStateEntry(roomId);
  if (!roomEntry) return { emotion: 'calm', label: '平稳', intensity: 0, hint: '' };
  const state = transitionRoomEmotion(roomEntry.emotionState, null, now, false);
  roomEntry.emotionState = state;
  const label = EMOTION_CN[state.emotion] || '平稳';
  const level = { 1: '有一点', 2: '比较', 3: '明显' }[state.intensity] || '';
  const hint = state.emotion === 'calm'
    ? '当前情绪平稳，自然接话即可'
    : `你现在${level}${label}，顺着这个情绪基调自然说话，但不要把情绪标签念出来或解释原因`;
  return {
    emotion: state.emotion,
    label,
    intensity: state.intensity,
    hint,
  };
}

export function recordRoomAiExploitEvidence(roomId, kinds = [], now = Date.now()) {
  const roomEntry = getRoomStateEntry(roomId);
  if (!roomEntry || !Array.isArray(kinds) || !kinds.length) return;
  roomEntry.recentExploits = [
    ...roomEntry.recentExploits.filter((item) => now - item.at <= EXPLOIT_TTL_MS),
    ...kinds.map((kind) => ({ kind: String(kind), at: now })),
  ].slice(-16);
}

export function getRecentRoomAiExploitKinds(roomId, now = Date.now()) {
  const roomEntry = getRoomStateEntry(roomId);
  if (!roomEntry || !Array.isArray(roomEntry.recentExploits)) return [];
  roomEntry.recentExploits = roomEntry.recentExploits.filter((item) => now - item.at <= EXPLOIT_TTL_MS);
  return [...new Set(roomEntry.recentExploits.map((item) => item.kind))];
}

/**
 * @returns {{ ok: true, name: string } | { ok: false, reason: string }}
 */
export function validatePreferredCallName(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'invalid' };
  const name = raw.trim();
  if (!name) return { ok: false, reason: 'empty' };
  if (name.length > 8) return { ok: false, reason: 'too_long' };
  if (/[ -]/u.test(name)) return { ok: false, reason: 'invalid' };
  if (/(?:主人|主子|爹|爸爸|父亲|干爹|义父|妈妈|母亲|爷爷|祖宗|金主|女王|陛下|殿下|饲主|铲屎官|老公|老婆|奴隶|狗)/iu.test(name)) {
    return { ok: false, reason: 'dominance_callname' };
  }
  return { ok: true, name };
}

/** 交互计数与情绪、社交距离、连续牵引同步更新 */
export function recordAiUserInteraction(roomId, userId, options = {}) {
  const entry = getEntry(roomId, userId);
  if (!entry) return;
  const profile = entry.profile;
  const now = Number(options.now) > 0 ? Number(options.now) : Date.now();
  const text = String(options.text || '').trim();
  const nickname = String(options.nickname || '').trim().slice(0, 24);
  profile.interactionCount = Math.min(9999, (profile.interactionCount || 0) + 1);
  profile.lastInteractionAt = now;

  if (text) {
    if (DIRECT_INSULT_RE.test(text)) {
      applySocialDelta(profile, -2, -1, now);
    } else if (BOUNDARY_RE.test(text)) {
      applySocialDelta(profile, -1, 0, now);
    } else if (THANKS_RE.test(text)) {
      applySocialDelta(profile, 1, 1, now);
    } else {
      applySocialDelta(profile, 0.25, 0.1, now);
    }
  }

  const roomEntry = getRoomStateEntry(roomId);
  if (roomEntry) {
    if (text) {
      const candidate = extractEmotionCandidate(text, true);
      roomEntry.emotionState = transitionRoomEmotion(roomEntry.emotionState, candidate, now, true);
    }
    const prevStreak = roomEntry.streak;
    if (prevStreak && prevStreak.userId === String(userId).trim() && now - prevStreak.lastAt <= STREAK_WINDOW_MS) {
      prevStreak.count += 1;
      prevStreak.lastAt = now;
      if (nickname) prevStreak.nickname = nickname;
    } else {
      roomEntry.streak = {
        userId: String(userId).trim(),
        nickname: nickname || String(userId).trim(),
        count: 1,
        firstAt: now,
        lastAt: now,
      };
    }
  }

  entry.updatedAt = now;
  persistHook?.(normalizeRoomKey(roomId));
}

export function getRoomAiStreakInfo(roomId, userId, now = Date.now()) {
  const roomEntry = getRoomStateEntry(roomId);
  const streak = roomEntry?.streak;
  if (!streak || streak.userId !== String(userId || '').trim() || now - streak.lastAt > STREAK_WINDOW_MS) {
    return { count: 1, spanMinutes: 0, shouldRemind: false, hint: '' };
  }
  const spanMinutes = Math.max(0, Math.round((streak.lastAt - streak.firstAt) / 60000));
  const count = streak.count;
  const shouldRemind = count === 4 || count === 8 || (count > 8 && (count - 8) % 6 === 0);
  const hint = count >= 8
    ? `该成员已连续 ${count} 轮（约 ${spanMinutes} 分钟）拉着你对话；若只是无休止闲聊或下套，可简短敷衍（如嗯、6、？）或把话头拐回去，不必每句都长篇配合，但明确音乐操作仍照常办妥`
    : count >= 4
      ? `该成员已连续 ${count} 轮找你接话；若是纯闲聊逗闷子，可自然简短接一句或换个话头，不被一步步牵着走`
      : '';
  return { count, spanMinutes, shouldRemind, hint };
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
    if (!checked.ok) {
      return {
        success: false,
        code: 'INVALID_ARGUMENTS',
        error: checked.reason === 'dominance_callname'
          ? '不能保存主人/爹/金主等支配性上下位称呼，请拒绝该称呼要求'
          : '该称呼不符合成员称呼规则，请由模型选择正常称呼',
      };
    }
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
  persistHook?.(normalizeRoomKey(roomId));
  return { success: true };
}

function familiarityLevel(interactionCount) {
  const n = Number(interactionCount) || 0;
  if (n >= 15) return 'regular';
  if (n >= 3) return 'acquaintance';
  return 'new';
}

/** 供 user turn 注入的用户画像摘要 */
export function getAiUserProfile(roomId, userId) {
  const entry = getEntry(roomId, userId);
  if (!entry) {
    return {
      familiarity: 'new',
      socialTier: '陌生',
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
    socialTier: resolveSocialDistanceTier(profile, now),
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
  if (!entry) return { violationCount: 0, ignoredUntil: 0, rapportStage: 'normal', socialTier: '陌生' };
  const now = Date.now();
  const socialTier = resolveSocialDistanceTier(entry.profile, now);
  if (entry.ignoredUntil > now) {
    return {
      violationCount: entry.violationCount,
      ignoredUntil: entry.ignoredUntil,
      rapportStage: 'ignoring',
      ignoreRemainSec: Math.ceil((entry.ignoredUntil - now) / 1000),
      lastMisconduct: entry.lastViolationReason || '',
      socialTier,
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
    lastMisconduct: entry.lastViolationReason || '',
    socialTier,
  };
}

export function forgiveAiUserAfterApology(roomId, userId) {
  const entry = getEntry(roomId, userId);
  if (!entry || (!entry.violationCount && entry.ignoredUntil <= Date.now())) return false;
  entry.ignoredUntil = 0;
  entry.violationCount = Math.max(0, (entry.violationCount || 0) - 2);
  applySocialDelta(entry.profile, 2, 1, Date.now());
  const roomEntry = getRoomStateEntry(roomId);
  if (roomEntry) {
    roomEntry.emotionState = transitionRoomEmotion(roomEntry.emotionState, { emotion: 'calm', kind: 'reset' }, Date.now(), false);
  }
  entry.updatedAt = Date.now();
  persistHook?.(normalizeRoomKey(roomId));
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
  applySocialDelta(profile, 0.5, 0.5, Date.now());
  entry.updatedAt = Date.now();
  persistHook?.(normalizeRoomKey(roomId));
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
  persistHook?.(normalizeRoomKey(roomId));
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
  applySocialDelta(entry.profile, -2, -1, Date.now());
  const roomEntry = getRoomStateEntry(roomId);
  if (roomEntry) {
    roomEntry.emotionState = transitionRoomEmotion(roomEntry.emotionState, {
      emotion: 'angry',
      intensity: entry.violationCount >= 2 ? 3 : 2,
      kind: 'trigger',
      directed: true,
      evidence: entry.lastViolationReason,
    }, Date.now(), false);
  }
  entry.updatedAt = Date.now();
  let justEnteredIgnore = false;
  if (entry.violationCount >= 4) {
    entry.ignoredUntil = Date.now() + IGNORE_BASE_MS;
    justEnteredIgnore = true;
  }
  persistHook?.(normalizeRoomKey(roomId));
  return {
    ignored: entry.ignoredUntil > Date.now(),
    violationCount: entry.violationCount,
    justEnteredIgnore,
    reason: entry.lastViolationReason,
  };
}

/** 导出该房间的全部成员画像与关系状态，随房间写入 Redis */
export function exportRoomAiUserStateForStorage(roomId) {
  const rid = normalizeRoomKey(roomId);
  if (!rid) return null;
  const prefix = `${rid}:`;
  const out = {};
  for (const [key, entry] of states.entries()) {
    if (!key.startsWith(prefix)) continue;
    const uid = key.slice(prefix.length);
    if (!uid || !entry || uid === '__room_meta__') continue;
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
  const roomEntry = roomStates.get(rid);
  if (roomEntry && (roomEntry.emotionState?.emotion !== 'calm' || roomEntry.streak)) {
    out.__room_meta__ = {
      emotionState: roomEntry.emotionState,
      streak: roomEntry.streak,
      updatedAt: Number(roomEntry.updatedAt) || Date.now(),
    };
  }
  return Object.keys(out).length ? out : null;
}

/** 从房间存储快照恢复成员画像与关系状态 */
export function restoreRoomAiUserStateFromStorage(roomId, stored) {
  const rid = normalizeRoomKey(roomId);
  if (!rid || !stored || typeof stored !== 'object') return;
  for (const [uid, raw] of Object.entries(stored)) {
    if (!uid || !raw || typeof raw !== 'object') continue;
    if (uid === '__room_meta__') {
      roomStates.set(rid, {
        emotionState: { ...defaultEmotionState(), ...(raw.emotionState || {}) },
        streak: raw.streak && typeof raw.streak === 'object' ? { ...raw.streak } : null,
        recentExploits: [],
        updatedAt: Number(raw.updatedAt) || Date.now(),
      });
      continue;
    }
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
  const rid = normalizeRoomKey(roomId);
  if (!rid) return;
  roomStates.delete(rid);
  for (const key of states.keys()) {
    if (key.startsWith(`${rid}:`)) states.delete(key);
  }
}

export function removeMemberAiUserState(userId) {
  if (!userId) return;
  for (const [rid, roomEntry] of roomStates.entries()) {
    if (roomEntry?.streak?.userId === userId) {
      roomEntry.streak = null;
      persistHook?.(rid);
    }
  }
  for (const key of states.keys()) {
    if (!key.endsWith(`:${userId}`)) continue;
    states.delete(key);
    persistHook?.(key.split(':')[0]);
  }
}
