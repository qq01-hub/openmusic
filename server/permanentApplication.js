import { customAlphabet } from 'nanoid';
import { getRedisClient } from './roomStorage.js';

const generateId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

const APPLICATIONS_REDIS_KEY = 'openmusic:admin:permanent_applications';
const NOTICES_REDIS_KEY = 'openmusic:admin:permanent_decision_notices';

/** @typedef {'pending'} PermanentApplicationStatus */

/**
 * @typedef {object} PermanentApplication
 * @property {string} roomId
 * @property {string} roomName
 * @property {'pending'} status
 * @property {number} appliedAt
 * @property {string} applicantId
 * @property {string} applicantNickname
 * @property {string} [note]
 */

/**
 * @typedef {object} PermanentDecisionNotice
 * @property {string} id
 * @property {string} roomId
 * @property {string} roomName
 * @property {boolean} approved
 * @property {string} [reason]
 * @property {number} at
 * @property {string} userId
 */

/** @type {Map<string, PermanentApplication>} */
const applications = new Map();

/** @type {Map<string, PermanentDecisionNotice[]>} userId → notices */
const noticesByUser = new Map();

let hydrated = false;
let hydratePromise = null;

function normalizeRoomId(roomId) {
  return String(roomId || '').trim().toUpperCase();
}

function normalizeText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

async function ensureHydrated() {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  const redis = getRedisClient();
  if (!redis) return;

  hydratePromise = (async () => {
    let ok = true;
    try {
      const rawApps = await redis.hGetAll(APPLICATIONS_REDIS_KEY);
      for (const [, raw] of Object.entries(rawApps || {})) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.status === 'pending' && parsed.roomId) {
            applications.set(normalizeRoomId(parsed.roomId), parsed);
          }
        } catch {
          // ignore bad entry
        }
      }
    } catch (err) {
      ok = false;
      console.error('permanent-application: 读取申请列表失败:', err?.message || err);
    }

    try {
      const rawNotices = await redis.hGetAll(NOTICES_REDIS_KEY);
      for (const [userId, raw] of Object.entries(rawNotices || {})) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list) && list.length) {
            noticesByUser.set(userId, list.filter((item) => item?.id && item?.roomId));
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      ok = false;
      console.error('permanent-application: 读取决策通知失败:', err?.message || err);
    }

    if (ok) hydrated = true;
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

async function persistApplication(roomId, application) {
  const id = normalizeRoomId(roomId);
  const redis = getRedisClient();
  if (!redis) return;
  try {
    if (!application) await redis.hDel(APPLICATIONS_REDIS_KEY, id);
    else await redis.hSet(APPLICATIONS_REDIS_KEY, id, JSON.stringify(application));
  } catch (err) {
    console.error('permanent-application: 写入申请失败:', err?.message || err);
  }
}

async function persistNotices(userId) {
  const redis = getRedisClient();
  if (!redis) return;
  const list = noticesByUser.get(userId) || [];
  try {
    if (!list.length) await redis.hDel(NOTICES_REDIS_KEY, userId);
    else await redis.hSet(NOTICES_REDIS_KEY, userId, JSON.stringify(list));
  } catch (err) {
    console.error('permanent-application: 写入决策通知失败:', err?.message || err);
  }
}

export async function getPermanentApplication(roomId) {
  await ensureHydrated();
  return applications.get(normalizeRoomId(roomId)) || null;
}

export async function listPermanentApplications() {
  await ensureHydrated();
  return Array.from(applications.values())
    .filter((item) => item.status === 'pending')
    .sort((a, b) => b.appliedAt - a.appliedAt);
}

export async function applyPermanentResidence({
  roomId,
  roomName,
  applicantId,
  applicantNickname,
  note = '',
  alreadyProtected = false,
}) {
  await ensureHydrated();
  const id = normalizeRoomId(roomId);
  if (!id) return { success: false, error: '房间不存在' };
  if (alreadyProtected) return { success: false, error: '房间已是常驻，无需重复申请' };

  const existing = applications.get(id);
  if (existing?.status === 'pending') {
    return { success: false, error: '已提交申请，请等待管理员审核' };
  }

  const application = {
    roomId: id,
    roomName: normalizeText(roomName, 80) || id,
    status: 'pending',
    appliedAt: Date.now(),
    applicantId: String(applicantId || '').trim(),
    applicantNickname: normalizeText(applicantNickname, 40) || '房主',
    note: normalizeText(note, 120),
  };
  if (!application.applicantId) return { success: false, error: '无法识别申请人' };

  applications.set(id, application);
  await persistApplication(id, application);
  return { success: true, application };
}

export async function cancelPermanentApplication(roomId, applicantId) {
  await ensureHydrated();
  const id = normalizeRoomId(roomId);
  const existing = applications.get(id);
  if (!existing || existing.status !== 'pending') {
    return { success: false, error: '当前没有待审核申请' };
  }
  if (applicantId && existing.applicantId !== applicantId) {
    return { success: false, error: '仅申请人可撤销' };
  }
  applications.delete(id);
  await persistApplication(id, null);
  return { success: true };
}

async function enqueueDecisionNotice(notice) {
  const userId = String(notice.userId || '').trim();
  if (!userId) return;
  const list = noticesByUser.get(userId) || [];
  const next = [notice, ...list.filter((item) => item.id !== notice.id)].slice(0, 20);
  noticesByUser.set(userId, next);
  await persistNotices(userId);
}

/**
 * @param {{ roomId: string, approved: boolean, reason?: string, reviewerNote?: string }} options
 */
export async function reviewPermanentApplication(options) {
  await ensureHydrated();
  const id = normalizeRoomId(options.roomId);
  const existing = applications.get(id);
  if (!existing || existing.status !== 'pending') {
    return { success: false, error: '没有待审核的常驻申请' };
  }

  const approved = Boolean(options.approved);
  const reason = normalizeText(options.reason, 200);
  if (!approved && !reason) {
    return { success: false, error: '拒绝时请填写原因' };
  }

  applications.delete(id);
  await persistApplication(id, null);

  const notice = {
    id: generateId(),
    roomId: id,
    roomName: existing.roomName,
    approved,
    reason: approved ? '' : reason,
    at: Date.now(),
    userId: existing.applicantId,
  };
  await enqueueDecisionNotice(notice);

  return {
    success: true,
    approved,
    application: existing,
    notice,
  };
}

/** 内存快照（须先经过任意 async API 完成 hydrate） */
export function peekPermanentApplication(roomId) {
  return applications.get(normalizeRoomId(roomId)) || null;
}

export async function listPendingPermanentNoticesForUser(userId) {
  await ensureHydrated();
  const uid = String(userId || '').trim();
  if (!uid) return [];
  return [...(noticesByUser.get(uid) || [])];
}

export async function ackPermanentDecisionNotice(noticeId, userId) {
  await ensureHydrated();
  const uid = String(userId || '').trim();
  const nid = String(noticeId || '').trim();
  if (!uid || !nid) return { success: false, error: '参数无效' };

  const list = noticesByUser.get(uid) || [];
  const next = list.filter((item) => item.id !== nid);
  if (next.length === list.length) {
    return { success: false, error: '通知不存在或已确认' };
  }
  if (next.length) noticesByUser.set(uid, next);
  else noticesByUser.delete(uid);
  await persistNotices(uid);
  return { success: true };
}

/** 房间解散时清理申请 */
export async function clearPermanentApplicationForRoom(roomId) {
  await ensureHydrated();
  const id = normalizeRoomId(roomId);
  if (!applications.has(id)) return;
  applications.delete(id);
  await persistApplication(id, null);
}

export function toPublicPermanentApplication(application) {
  if (!application) return null;
  return {
    status: application.status,
    appliedAt: application.appliedAt,
    applicantNickname: application.applicantNickname,
    note: application.note || '',
  };
}
