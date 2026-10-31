import { evalRedisScript } from './redisScripts.js';
import { customAlphabet } from 'nanoid';
import { getRedisClient } from './roomStorage.js';

const IDS_KEY = 'openmusic:error_reports:ids';
const SUMMARIES_KEY = 'openmusic:error_reports:summaries';
const reportKey = (id) => `openmusic:error_reports:${id}`;
const generateId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 14);
const MAX_REPORTS = 100;
const MAX_DESCRIPTION = 500;
const MAX_SNAPSHOT = 64_000;
const MAX_SNAPSHOT_SECTIONS = 5;
const MAX_SNAPSHOT_SECTION = 16_000;
const MAX_EVENTS = 80;
const MAX_META_STRING = 2048;
const MAX_NOTE = 500;

/** @type {Map<string, object>} */
const memoryReports = new Map();
/** @type {string[]} 新到旧 */
let memoryIds = [];

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeMeta(raw = {}) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const k = cleanText(key, 40);
    if (!k) continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      out[k] = value;
    } else if (value == null) {
      out[k] = null;
    } else {
      out[k] = cleanText(value, MAX_META_STRING);
    }
  }
  return out;
}

function sanitizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_EVENTS).map((item) => ({
    at: cleanText(item?.at, 40),
    name: cleanText(item?.name, 80),
    line: cleanText(item?.line, 800),
  }));
}

function sanitizeSnapshots(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SNAPSHOT_SECTIONS).map((item) => ({
    id: cleanText(item?.id, 40),
    title: cleanText(item?.title, 40),
    content: cleanText(item?.content, MAX_SNAPSHOT_SECTION),
  })).filter((item) => item.id && item.title && item.content);
}

function sanitizeReport(raw = {}) {
  const status = raw.status === 'resolved' ? 'resolved' : 'open';
  const type = raw.type === 'feedback' ? 'feedback' : 'error';
  const note = cleanText(raw.note, MAX_NOTE);
  const ackedAt = Number(raw.solutionAckedAt);
  return {
    id: cleanText(raw.id, 32) || generateId(),
    type,
    status,
    description: cleanText(raw.description, MAX_DESCRIPTION),
    snapshot: cleanText(raw.snapshot, MAX_SNAPSHOT),
    snapshots: sanitizeSnapshots(raw.snapshots),
    events: sanitizeEvents(raw.events),
    meta: sanitizeMeta(raw.meta),
    ip: cleanText(raw.ip, 64),
    userId: cleanText(raw.userId, 64),
    createdAt: Number(raw.createdAt) || Date.now(),
    resolvedAt: status === 'resolved' ? (Number(raw.resolvedAt) || Date.now()) : null,
    note,
    /** 用户已确认看过解决方案；有 note 且未确认时需推送弹窗 */
    solutionAckedAt: status === 'resolved' && note && Number.isFinite(ackedAt) && ackedAt > 0
      ? ackedAt
      : null,
  };
}

function toSummary(report) {
  return {
    id: report.id,
    type: report.type || 'error',
    status: report.status,
    description: report.description,
    ip: report.ip,
    userId: report.userId,
    createdAt: report.createdAt,
    resolvedAt: report.resolvedAt,
    note: report.note,
    solutionAckedAt: report.solutionAckedAt,
    meta: {
      roomId: report.meta?.roomId ?? null,
      nickname: report.meta?.nickname ?? null,
      trackName: report.meta?.trackName ?? null,
      trackSource: report.meta?.trackSource ?? null,
      href: report.meta?.href ?? null,
    },
    eventCount: Array.isArray(report.events) ? report.events.length : 0,
    snapshotCount: Array.isArray(report.snapshots) ? report.snapshots.length : 0,
    hasSnapshot: Boolean(report.snapshot || report.snapshots?.length),
  };
}

/** 下发给上报用户的解决方案通知 */
export function toSolutionNotice(report) {
  if (!report || report.status !== 'resolved') return null;
  const solution = cleanText(report.note, MAX_NOTE);
  if (!solution) return null;
  if (report.solutionAckedAt) return null;
  return {
    id: report.id,
    description: report.description,
    solution,
    resolvedAt: report.resolvedAt,
  };
}

function isPendingSolution(report, userId) {
  if (!report || report.status !== 'resolved') return false;
  if (!report.note) return false;
  if (report.solutionAckedAt) return false;
  if (userId && report.userId && report.userId !== userId) return false;
  return Boolean(report.userId);
}

async function persistReport(report) {
  const client = getRedisClient();
  if (!client) {
    memoryReports.set(report.id, report);
    memoryIds = [report.id, ...memoryIds.filter((id) => id !== report.id)].slice(0, MAX_REPORTS);
    // 清理被裁掉的
    for (const id of memoryReports.keys()) {
      if (!memoryIds.includes(id)) memoryReports.delete(id);
    }
    return;
  }
  try {
    await evalRedisScript(client, `
      redis.call('SET', KEYS[1], ARGV[2])
      redis.call('HSET', KEYS[3], ARGV[1], ARGV[3])
      redis.call('LREM', KEYS[2], 0, ARGV[1])
      redis.call('LPUSH', KEYS[2], ARGV[1])
      local old = redis.call('LRANGE', KEYS[2], 100, 199)
      redis.call('LTRIM', KEYS[2], 0, 99)
      for _, id in ipairs(old) do
        redis.call('UNLINK', ARGV[4] .. id)
        redis.call('HDEL', KEYS[3], id)
      end
      return 1
    `, { keys: [reportKey(report.id), IDS_KEY, SUMMARIES_KEY], arguments: [report.id, JSON.stringify(report), JSON.stringify(toSummary(report)), 'openmusic:error_reports:'] });
  } catch (err) {
    console.error('error-report Redis 写入失败:', err?.message || err);
    memoryReports.set(report.id, report);
    memoryIds = [report.id, ...memoryIds.filter((id) => id !== report.id)].slice(0, MAX_REPORTS);
    for (const id of memoryReports.keys()) if (!memoryIds.includes(id)) memoryReports.delete(id);
  }
}

async function readReport(id) {
  const reportId = cleanText(id, 32);
  if (!reportId) return null;
  const client = getRedisClient();
  if (client) {
    try {
      const raw = await client.get(reportKey(reportId));
      if (raw) return sanitizeReport(JSON.parse(raw));
    } catch (err) {
      console.error('error-report Redis 读取失败:', err?.message || err);
    }
  }
  const mem = memoryReports.get(reportId);
  return mem ? sanitizeReport(mem) : null;
}

export async function createErrorReport(input = {}) {
  const description = cleanText(input.description, MAX_DESCRIPTION);
  if (!description) return { success: false, error: '请填写问题描述' };

  const report = sanitizeReport({
    id: generateId(),
    type: input.type === 'feedback' ? 'feedback' : 'error',
    status: 'open',
    description,
    snapshot: input.type === 'feedback' ? '' : input.snapshot,
    snapshots: input.type === 'feedback' ? [] : input.snapshots,
    events: input.type === 'feedback' ? [] : input.events,
    meta: input.meta,
    ip: input.ip,
    userId: input.userId,
    createdAt: Date.now(),
    resolvedAt: null,
    note: '',
  });

  await persistReport(report);
  return { success: true, report: toSummary(report) };
}

export async function listErrorReports() {
  const client = getRedisClient();
  if (client) {
    try {
      const ids = await client.lRange(IDS_KEY, 0, MAX_REPORTS - 1);
      if (!ids.length) return [];
      const summaries = await client.hmGet(SUMMARIES_KEY, ids);
      const byId = new Map();
      const missing = [];
      ids.forEach((id, index) => {
        try { const value = JSON.parse(summaries[index] || 'null'); if (value?.id === id) { byId.set(id, value); return; } } catch { /* 旧摘要不可用时从权威正文读取 */ }
        missing.push(id);
      });
      for (let offset = 0; offset < missing.length; offset += 20) {
        const batch = missing.slice(offset, offset + 20);
        const bodies = await client.mGet(batch.map(reportKey));
        const backfill = [];
        bodies.forEach(raw => {
          try {
            const report = raw ? sanitizeReport(JSON.parse(raw)) : null;
            if (report?.id) { const summary = toSummary(report); byId.set(report.id, summary); backfill.push([report.id, JSON.stringify(summary)]); }
          } catch { /* 不删除损坏的历史正文 */ }
        });
        if (backfill.length) await evalRedisScript(client, `
          for _, item in ipairs(cjson.decode(ARGV[1])) do
            if redis.call('LPOS', KEYS[1], item[1]) then redis.call('HSETNX', KEYS[2], item[1], item[2]) end
          end
          return 1
        `, { keys: [IDS_KEY, SUMMARIES_KEY], arguments: [JSON.stringify(backfill)] });
      }
      const reports = ids.map(id => byId.get(id)).filter(Boolean);
      return reports;
    } catch (err) {
      console.error('error-report Redis 列表失败:', err?.message || err);
    }
  }
  return memoryIds.map((id) => memoryReports.get(id)).filter(Boolean).map(toSummary);
}

export async function getErrorReport(id) {
  return readReport(id);
}

export async function updateErrorReport(id, { status, note } = {}) {
  const report = await readReport(id);
  if (!report) return { success: false, error: '上报不存在' };

  const prevNote = report.note;
  const prevStatus = report.status;

  if (status === 'open' || status === 'resolved') {
    report.status = status;
    report.resolvedAt = status === 'resolved' ? Date.now() : null;
  }
  if (note !== undefined) {
    report.note = cleanText(note, MAX_NOTE);
  }

  if (report.status === 'open') {
    report.solutionAckedAt = null;
  } else if (report.status === 'resolved') {
    // 新解决方案或重新标记已处理：需要再次推送给用户
    if (prevStatus !== 'resolved' || report.note !== prevNote || !report.note) {
      report.solutionAckedAt = null;
    }
  }

  if (report.status === 'resolved' && !report.note) {
    return { success: false, error: '请填写解决方案后再标记已处理' };
  }

  await persistReport(report);
  return { success: true, report };
}

/** 某用户尚未确认的解决方案（新到旧） */
export async function listPendingSolutionsForUser(userId) {
  const uid = cleanText(userId, 64);
  if (!uid) return [];
  const summaries = await listErrorReports();
  const notices = [];
  for (const summary of summaries) {
    if (!isPendingSolution(summary, uid)) continue;
    const notice = toSolutionNotice(summary);
    if (notice) notices.push(notice);
  }
  return notices;
}

export async function ackErrorReportSolution(id, userId) {
  const uid = cleanText(userId, 64);
  if (!uid) return { success: false, error: '会话无效' };
  const report = await readReport(id);
  if (!report) return { success: false, error: '上报不存在' };
  if (report.userId !== uid) return { success: false, error: '无权确认该上报' };
  if (report.status !== 'resolved' || !report.note) {
    return { success: false, error: '该上报没有待确认的解决方案' };
  }
  if (report.solutionAckedAt) return { success: true, report };
  report.solutionAckedAt = Date.now();
  await persistReport(report);
  return { success: true, report };
}

export async function deleteErrorReport(id) {
  const reportId = cleanText(id, 32);
  if (!reportId) return { success: false, error: '上报不存在' };

  const client = getRedisClient();
  if (client) {
    try {
      const existed = await client.exists(reportKey(reportId));
      await client.del(reportKey(reportId));
      await client.hDel(SUMMARIES_KEY, reportId);
      await client.lRem(IDS_KEY, 0, reportId);
      if (!existed && !memoryReports.has(reportId)) {
        return { success: false, error: '上报不存在' };
      }
    } catch (err) {
      console.error('error-report Redis 删除失败:', err?.message || err);
      return { success: false, error: '删除失败' };
    }
  } else if (!memoryReports.has(reportId)) {
    return { success: false, error: '上报不存在' };
  }

  memoryReports.delete(reportId);
  memoryIds = memoryIds.filter((item) => item !== reportId);
  return { success: true };
}
