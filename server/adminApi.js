import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import {
  listRoomsForAdmin,
  listRoomsForAdminDetailed,
  getRoomPasswordForAdmin,
  adminDestroyRoom,
  adminTransferOwner,
  adminRenameRoomUser,
  adminResetRoomUserNickname,
  isRedisEnabled,
  setRoomProtectedFromDestroy,
  reviewRoomPermanentApplication,
  broadcastAdminSystemMessage,
  getRoomInternal,
  removeUser,
  prepareRoomBroadcast,
  roomUpdateForViewer,
} from './roomManager.js';
import {
  listPendingPermanentNoticesForUser,
  ackPermanentDecisionNotice,
} from './permanentApplication.js';
import { getRedisClient } from './roomStorage.js';
import {
  getMetingUpstreamStatus,
  resetMetingUpstreamCooldown,
  setMetingUpstreamDisabled,
} from './metingUpstream.js';
import {
  getCustomMusicApiStatus,
  previewCustomMusicApi,
  resetCustomMusicApiCircuit,
} from './customMusicApi.js';
import {
  getAdminEntryPath,
  setAdminEntryPath,
  createRandomAdminEntryPath,
  sanitizeAdminEntryPath,
  mustChangeAdminEntryPath,
} from './adminConfig.js';
import { getSiteAnnouncementForAdmin, setSiteAnnouncement } from './siteAnnouncement.js';
import { addDonation, listDonationsForAdmin, removeDonation, updateDonation } from './donations.js';
import { listSiteBans, addSiteBan, removeSiteBan } from './siteBan.js';
import { kickConnectionsMatchingBan } from './kickSiteBan.js';
import {
  listErrorReports,
  getErrorReport,
  updateErrorReport,
  deleteErrorReport,
  toSolutionNotice,
} from './errorReports.js';
import { sanitizeDeviceId } from './deviceIdentity.js';
import { getRuntimeConfigForAdmin, setRuntimeConfig, getRuntimeConfig } from './runtimeConfig.js';
import { testAiModelChat, testAiModelVision, getAiModelConfig, isAiModelConfigured } from './aiModelService.js';
import { patchClientIndexHtml } from './seoIndexHtml.js';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isAdminEnabled,
  verifyAdminCredentials,
  setAdminCredentials,
  getAdminUsername,
  isAdminCredentialsPersisted,
  mustChangeAdminCredentials,
  getAdminLinuxdoBinding,
  isLinuxdoIdBoundToAdmin,
  bindAdminLinuxdo,
  unbindAdminLinuxdo,
  getAdminGithubBinding,
  isGithubIdBoundToAdmin,
  bindAdminGithub,
  unbindAdminGithub,
} from './adminCredentials.js';
import {
  isLinuxdoConfigured,
  signLinuxdoState,
  buildLinuxdoAuthorizeUrl,
  clearLinuxdoBindingsForRoom,
} from './linuxdoAuth.js';
import {
  isGithubConfigured,
  signGithubState,
  buildGithubAuthorizeUrl,
} from './githubAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(__dirname, '../client/dist');

export { isAdminEnabled };

function getAdminSetupStatus() {
  const mustChangeCredentials = mustChangeAdminCredentials();
  const mustChangeEntryPath = mustChangeAdminEntryPath();
  return {
    mustChangeCredentials,
    mustChangeEntryPath,
    setupRequired: mustChangeCredentials || mustChangeEntryPath,
  };
}

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时
const ADMIN_COOKIE = 'om_admin_sid';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOW_INSECURE_COOKIES = process.env.ALLOW_INSECURE_COOKIES === '1'
  || process.env.ALLOW_INSECURE_COOKIES === 'true';
const ADMIN_AUDIT_KEY = 'openmusic:admin:audit';
/** 审计日志保留天数 */
const AUDIT_RETENTION_DAYS = 15;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** 安全上限：防止单日刷爆；主清理策略是按时间 */
const AUDIT_MAX = 10_000;
/** 过期清理节流，避免每次写入都扫全表 */
let auditPruneAt = 0;
const AUDIT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function auditCutoffMs(now = Date.now()) {
  return now - AUDIT_RETENTION_MS;
}

/** 删除超过保留期的审计记录（Redis list，新→旧） */
async function pruneExpiredAdminAudit(client, { force = false } = {}) {
  if (!client) return 0;
  const now = Date.now();
  if (!force && now - auditPruneAt < AUDIT_PRUNE_INTERVAL_MS) return 0;
  auditPruneAt = now;
  const cutoff = auditCutoffMs(now);
  try {
    const rows = await client.lRange(ADMIN_AUDIT_KEY, 0, -1);
    if (!rows.length) return 0;
    const kept = [];
    for (const raw of rows) {
      try {
        const entry = JSON.parse(raw);
        if (Number(entry?.at) >= cutoff) kept.push(raw);
      } catch {
        // 损坏条目直接丢弃
      }
    }
    const trimmed = kept.length > AUDIT_MAX ? kept.slice(0, AUDIT_MAX) : kept;
    if (trimmed.length === rows.length) return 0;
    const multi = client.multi();
    multi.del(ADMIN_AUDIT_KEY);
    if (trimmed.length) {
      // node-redis 支持一次传入数组，避免超大 spread
      multi.rPush(ADMIN_AUDIT_KEY, trimmed);
    }
    await multi.exec();
    return rows.length - trimmed.length;
  } catch (err) {
    console.error('admin-audit 过期清理失败:', err?.message || err);
    return 0;
  }
}

// 进程内会话表：重启后全部失效；logout / 吊销可立即生效（不依赖前端清存储）
const activeSessions = new Map();

function hmac(input) {
  // 仅用于密钥比对的等长时间摘要，不参与会话签发
  return createHmac('sha256', 'om-admin-eq').update(input).digest();
}

function safeEqual(a, b) {
  const ha = hmac(`eq:${a}`);
  const hb = hmac(`eq:${b}`);
  return timingSafeEqual(ha, hb);
}

function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function createSession() {
  const sid = randomBytes(24).toString('base64url');
  const exp = Date.now() + ADMIN_SESSION_TTL_MS;
  activeSessions.set(sid, { exp, createdAt: Date.now() });
  return { sid, exp };
}

function revokeSession(sid) {
  if (sid) activeSessions.delete(sid);
}

function getSessionIdFromRequest(req) {
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  return String(cookies[ADMIN_COOKIE] || '').trim();
}

function verifySession(req) {
  const sid = getSessionIdFromRequest(req);
  if (!sid) return null;
  const session = activeSessions.get(sid);
  if (!session) return null;
  if (Date.now() > session.exp) {
    activeSessions.delete(sid);
    return null;
  }
  return { sid, ...session };
}

function adminCookieFlags(maxAgeSec, req) {
  // 与普通用户会话保持一致：生产模式强制 Secure，测试模式允许 HTTP。
  const useSecureCookie = (IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || req?.secure;
  const secure = useSecureCookie ? '; Secure' : '';
  // Path 限定在 /api 下，降低被同站其它路径带出的面。用 Lax 而非 Strict：
  // Linux.do / GitHub OAuth 回调是从第三方域跳转回来的顶层 GET 导航，Strict 会导致
  // 浏览器不带上这个 Cookie，绑定流程里的 verifySession 永远拿不到会话。真正的
  // CSRF 防护是所有状态变更的 admin 接口都挂了 requireAdminOrigin（校验 Origin），
  // 不依赖 SameSite=Strict，降级到 Lax 不会削弱这层防护。
  // 之所以是 /api 而不是更窄的 /api/admin：admin-bind/admin-login 复用的共享 OAuth
  // 回调路由在 /api/auth/{provider}/callback 下，Path=/api/admin 会让浏览器在跳转回这个
  // 回调时根本不带上这个 Cookie，verifySession 永远拿不到会话，绑定必然报"已过期"。
  return `Path=/api; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure}`;
}

function setAdminSessionCookie(res, sid) {
  const maxAgeSec = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  res.append('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(sid)}; ${adminCookieFlags(maxAgeSec, res.req)}`);
}

function clearAdminSessionCookie(res) {
  res.append('Set-Cookie', `${ADMIN_COOKIE}=; ${adminCookieFlags(0, res.req)}`);
}

/** 写入管理端「操作审计」+ 控制台；建房/进房拦截等防护事件也可调用 */
export function appendAdminAudit(action, detail = {}, ip = '') {
  const entry = {
    id: randomUUID(),
    at: Date.now(),
    action,
    ip: String(ip || ''),
    ...detail,
  };
  const extra = Object.entries(detail)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  console.info(
    `[admin-audit] ${new Date(entry.at).toISOString()} action=${action} ip=${entry.ip || '-'} ${extra}`.trim(),
  );

  const client = getRedisClient();
  if (!client) {
    console.error('admin-audit: Redis 不可用，审计记录未持久化');
    return;
  }
  void client
    .lPush(ADMIN_AUDIT_KEY, JSON.stringify(entry))
    .then(async () => {
      await client.lTrim(ADMIN_AUDIT_KEY, 0, AUDIT_MAX - 1);
      await pruneExpiredAdminAudit(client);
    })
    .catch((err) => {
      console.error('admin-audit Redis 写入失败:', err?.message || err);
    });
}

function audit(action, detail = {}, ip = '') {
  appendAdminAudit(action, detail, ip);
}

/** 审计筛选大类 → 具体 action（与前端 AUDIT_ACTION_OPTIONS 对应） */
const AUDIT_ACTION_GROUPS = {
  auth: ['login_ok', 'login_fail', 'logout'],
  oauth: ['linuxdo_bind', 'linuxdo_unbind', 'github_bind', 'github_unbind'],
  account: ['set_credentials', 'set_credentials_fail', 'set_entry_path'],
  config: [
    'set_runtime_config',
    'reset_music_api_circuit',
    'meting_reset_cooldown',
    'meting_set_disabled',
    'ai_test',
  ],
  notify: ['set_announcement', 'broadcast'],
  donation: ['donation_add', 'donation_update', 'donation_delete'],
  room: [
    'set_room_protection',
    'view_room_password',
    'rename_room_user',
    'reset_room_user_nickname',
    'review_permanent_application',
    'destroy_room',
    'destroy_room_fail',
    'owner_destroy_room',
    'owner_destroy_room_denied',
  ],
  ban: ['site_ban_add', 'site_ban_remove'],
  guard: ['room_create_blocked', 'session_blocked'],
  report: ['error_report_update', 'error_report_delete'],
};

function resolveAuditActionFilter(action = '') {
  const key = String(action || '').trim();
  if (!key) return null;
  const group = AUDIT_ACTION_GROUPS[key];
  if (group) return new Set(group);
  return new Set([key]);
}

async function listAuditLogPage({ offset = 0, limit = 10, q = '', action = '' } = {}) {
  const pageSize = Math.min(Math.max(1, Number(limit) || 10), 100);
  const start = Math.max(0, Number(offset) || 0);
  const keyword = String(q || '').trim().toLowerCase();
  const actionSet = resolveAuditActionFilter(action);
  const client = getRedisClient();
  if (!client) return { items: [], total: 0, offset: start, limit: pageSize };
  try {
    await pruneExpiredAdminAudit(client);
    const cutoff = auditCutoffMs();
    const rows = await client.lRange(ADMIN_AUDIT_KEY, 0, -1);
    const all = rows.map((raw, index) => {
      try {
        const entry = JSON.parse(raw);
        // 历史审计记录没有 ID，读取时补一个与 Redis 列表位置绑定的兼容键。
        return entry && typeof entry === 'object'
          ? { ...entry, id: entry.id || `legacy-${index}` }
          : null;
      } catch {
        return null;
      }
    }).filter((entry) => entry && Number(entry.at) >= cutoff);

    const filtered = all.filter((entry) => {
      if (actionSet && !actionSet.has(entry.action)) return false;
      if (!keyword) return true;
      const haystack = [
        entry.action,
        entry.ip,
        entry.username,
        entry.linuxdoUsername,
        entry.githubUsername,
        entry.roomId,
        entry.name,
        entry.value,
        entry.banType,
        entry.banId,
        entry.reason,
        entry.path,
        entry.url,
        entry.reportId,
        entry.error,
        entry.trigger,
        entry.deviceId,
        entry.userId,
        entry.via,
        entry.source,
      ]
        .filter((v) => v != null && v !== '')
        .map((v) => String(v).toLowerCase())
        .join(' ');
      return haystack.includes(keyword);
    });

    const total = filtered.length;
    const items = filtered.slice(start, start + pageSize);
    return { items, total, offset: start, limit: pageSize };
  } catch (err) {
    console.error('admin-audit Redis 读取失败:', err?.message || err);
    return { items: [], total: 0, offset: start, limit: pageSize };
  }
}

// 登录限流：短窗次数限制 + 连续失败逐步加长锁定（缓解撞库 / 分布式试探）
const loginGuard = new Map();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_WINDOW_MAX = 5;
const LOCK_BASE_MS = 60_000;
const LOCK_MAX_MS = 60 * 60 * 1000;

function getLoginGuard(ip) {
  const key = ip || 'unknown';
  let entry = loginGuard.get(key);
  if (!entry) {
    entry = { windowStart: Date.now(), windowCount: 0, failCount: 0, lockedUntil: 0 };
    loginGuard.set(key, entry);
  }
  return entry;
}

function getLoginBlock(ip) {
  const now = Date.now();
  const entry = getLoginGuard(ip);
  if (entry.lockedUntil > now) {
    return {
      blocked: true,
      retryAfterSec: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
      reason: 'locked',
    };
  }
  if (now - entry.windowStart > LOGIN_WINDOW_MS) {
    entry.windowStart = now;
    entry.windowCount = 0;
  }
  if (entry.windowCount >= LOGIN_WINDOW_MAX) {
    return {
      blocked: true,
      retryAfterSec: Math.max(1, Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now) / 1000)),
      reason: 'rate',
    };
  }
  return { blocked: false };
}

function noteLoginAttempt(ip) {
  const entry = getLoginGuard(ip);
  const now = Date.now();
  if (now - entry.windowStart > LOGIN_WINDOW_MS) {
    entry.windowStart = now;
    entry.windowCount = 0;
  }
  entry.windowCount += 1;
}

function noteLoginFailure(ip) {
  const entry = getLoginGuard(ip);
  entry.failCount += 1;
  // 每累计 5 次失败锁定一次，时长 1m → 2m → 4m … 封顶 1h
  if (entry.failCount % 5 === 0) {
    const tier = Math.max(0, Math.floor(entry.failCount / 5) - 1);
    const lockMs = Math.min(LOCK_MAX_MS, LOCK_BASE_MS * (2 ** tier));
    entry.lockedUntil = Date.now() + lockMs;
  }
}

function noteLoginSuccess(ip) {
  const entry = getLoginGuard(ip);
  entry.failCount = 0;
  entry.lockedUntil = 0;
  entry.windowCount = 0;
  entry.windowStart = Date.now();
}

// 入口路径探测限流（防枚举）
const gateAttempts = new Map();
function isGateRateLimited(ip) {
  const now = Date.now();
  const entry = gateAttempts.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    gateAttempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 30;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginGuard.entries()) {
    if (entry.lockedUntil < now && now - entry.windowStart > 120_000 && entry.failCount === 0) {
      loginGuard.delete(ip);
    }
  }
  for (const [sid, session] of activeSessions.entries()) {
    if (session.exp <= now) activeSessions.delete(sid);
  }
  for (const [ip, entry] of gateAttempts.entries()) {
    if (now - entry.windowStart > 120_000) gateAttempts.delete(ip);
  }
  const redis = getRedisClient();
  if (redis) void pruneExpiredAdminAudit(redis);
}, 300_000).unref();

function pathsEqual(a, b) {
  return safeEqual(String(a || ''), String(b || ''));
}

const AUTH_DENIED = { error: '未登录或登录已过期' };
const KEY_DENIED = { error: '账号或密码错误' };

function resolveRequestOrigin(req) {
  const origin = String(req.headers?.origin || '').trim().replace(/\/$/, '');
  if (origin) return origin;
  const referer = String(req.headers?.referer || '').trim();
  if (!referer) return '';
  try {
    return new URL(referer).origin.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** Origin 的 host 与请求 Host 一致即视为同源（浏览器无法伪造 Origin，天然防 CSRF） */
function isSameHostOrigin(req, origin) {
  const host = String(req.headers?.host || '').trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * 写操作 Origin / Referer 白名单校验（SameSite=Strict 之外再加一层）
 * @param {Set<string> | null} allowedOrigins
 */
function createRequireAdminOrigin(allowedOrigins) {
  return function requireAdminOrigin(req, res, next) {
    const origin = resolveRequestOrigin(req);

    if (allowedOrigins && allowedOrigins.size > 0) {
      // 白名单命中或同源请求（如本地 localhost 直连服务端口调试）均放行
      if (!origin || (!allowedOrigins.has(origin) && !isSameHostOrigin(req, origin))) {
        return res.status(403).json({ error: '请求来源不被允许' });
      }
      return next();
    }

    // 未配置 CLIENT_URL：若带 Origin，必须与 Host 同源；无 Origin（如 curl）仅非生产放行
    if (origin) {
      const host = String(req.headers?.host || '').trim();
      try {
        if (new URL(origin).host !== host) {
          return res.status(403).json({ error: '请求来源不被允许' });
        }
      } catch {
        return res.status(403).json({ error: '请求来源不被允许' });
      }
      return next();
    }

    if (IS_PRODUCTION) {
      return res.status(403).json({ error: '请求来源不被允许' });
    }
    next();
  };
}

function emitErrorReportSolutionToUser(io, socketToUserId, report) {
  const notice = toSolutionNotice(report);
  if (!notice || !report?.userId) return 0;
  let delivered = 0;
  for (const [sid, uid] of socketToUserId.entries()) {
    if (uid !== report.userId) continue;
    const sock = io.sockets.sockets.get(sid);
    if (!sock) continue;
    sock.emit('error_report_solution', notice);
    delivered += 1;
  }
  return delivered;
}

function emitPermanentDecisionToUser(io, socketToUserId, notice) {
  if (!notice?.id || !notice?.userId) return 0;
  let delivered = 0;
  for (const [sid, uid] of socketToUserId.entries()) {
    if (uid !== notice.userId) continue;
    const sock = io.sockets.sockets.get(sid);
    if (!sock) continue;
    sock.emit('room_permanent_decision', {
      id: notice.id,
      roomId: notice.roomId,
      roomName: notice.roomName,
      approved: Boolean(notice.approved),
      reason: notice.reason || '',
      at: notice.at,
    });
    delivered += 1;
  }
  return delivered;
}

export function mountAdminApi(app, {
  io,
  socketToRoom,
  socketToUserId,
  getClientIp,
  allowedOrigins = null,
  broadcastRoomUpdate = null,
  clearRoomOwnerBindings = null,
}) {
  const requireAdminOrigin = createRequireAdminOrigin(allowedOrigins);

  // 校验当前前端路径是否为管理入口（不返回真实路径，避免泄露）
  app.post('/api/admin/gate', (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    if (isGateRateLimited(ip)) {
      return res.status(429).json({ match: false, error: '尝试过于频繁' });
    }
    // 未启用与路径不匹配一律 match:false，不泄露启用态
    if (!isAdminEnabled()) {
      return res.json({ match: false });
    }
    const candidate = sanitizeAdminEntryPath(req.body?.path);
    const configured = getAdminEntryPath();
    res.json({ match: Boolean(candidate && pathsEqual(candidate, configured)) });
  });

  // 会话探测：未登录与未启用一律 401，避免公开探测「管理后台是否启用」
  app.get('/api/admin/session', (req, res) => {
    if (!isAdminEnabled() || !verifySession(req)) {
      clearAdminSessionCookie(res);
      return res.status(401).json(AUTH_DENIED);
    }
    const setup = getAdminSetupStatus();
    res.json({
      ok: true,
      expiresInMs: ADMIN_SESSION_TTL_MS,
      entryPath: getAdminEntryPath(),
      ...setup,
    });
  });

  app.post('/api/admin/login', requireAdminOrigin, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const block = getLoginBlock(ip);
    if (block.blocked) {
      res.setHeader('Retry-After', String(block.retryAfterSec));
      return res.status(429).json({
        error: block.reason === 'locked'
          ? `登录已锁定，请 ${block.retryAfterSec} 秒后再试`
          : '尝试过于频繁，请稍后再试',
        retryAfterSec: block.retryAfterSec,
      });
    }
    noteLoginAttempt(ip);

    // 未启用与凭据错误统一 403「账号或密码错误」，避免探测后台是否启用
    const username = String(req.body?.username || '').trim();
    // 兼容旧客户端仍以 key 字段提交
    const password = String(req.body?.password ?? req.body?.key ?? '');
    const verified = isAdminEnabled() && username && password
      ? await verifyAdminCredentials(username, password)
      : false;
    if (!verified) {
      noteLoginFailure(ip);
      audit('login_fail', { username }, ip);
      const after = getLoginBlock(ip);
      if (after.blocked && after.reason === 'locked') {
        res.setHeader('Retry-After', String(after.retryAfterSec));
        return res.status(429).json({
          error: `账号或密码错误，登录已锁定 ${after.retryAfterSec} 秒`,
          retryAfterSec: after.retryAfterSec,
        });
      }
      return res.status(403).json(KEY_DENIED);
    }

    noteLoginSuccess(ip);
    const { sid } = createSession();
    setAdminSessionCookie(res, sid);
    audit('login_ok', { username }, ip);
    const setup = getAdminSetupStatus();
    res.json({ ok: true, expiresInMs: ADMIN_SESSION_TTL_MS, ...setup });
  });

  app.post('/api/admin/logout', requireAdminOrigin, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const sid = getSessionIdFromRequest(req);
    if (sid) {
      revokeSession(sid);
      audit('logout', {}, ip);
    }
    clearAdminSessionCookie(res);
    res.json({ ok: true });
  });

  // ---------- Linux.do OAuth：后台登录的一种额外方式 ----------
  // 只有「已经用账号密码登录过的管理员」才能把自己绑定到一个 Linux.do 账号；
  // Linux.do 本身不能凭空创建新的管理员权限，绑定关系随现有唯一管理员账号存储。

  app.get('/api/admin/linuxdo/status', (req, res) => {
    if (!isLinuxdoConfigured()) return res.json({ enabled: false, bound: null });
    // 登录页只需要知道功能是否开启；绑定详情（第三方用户名/头像/绑定时间）只有已登录管理员能看，
    // 否则随机管理入口路径就形同虚设——匿名访问者不该能探测出后台绑定了哪个账号。
    const isAdmin = isAdminEnabled() && Boolean(verifySession(req));
    res.json({ enabled: true, bound: isAdmin ? getAdminLinuxdoBinding() : null });
  });

  app.get('/api/admin/linuxdo/bind/start', requireAdmin, (req, res) => {
    if (!isLinuxdoConfigured()) return res.status(400).json({ error: 'Linux.do 登录未配置' });
    const state = signLinuxdoState({ purpose: 'admin-bind' });
    res.redirect(buildLinuxdoAuthorizeUrl(state));
  });

  app.get('/api/admin/linuxdo/login/start', (req, res) => {
    if (!isLinuxdoConfigured()) return res.status(400).json({ error: 'Linux.do 登录未配置' });
    const state = signLinuxdoState({ purpose: 'admin-login' });
    res.redirect(buildLinuxdoAuthorizeUrl(state));
  });

  // Linux.do / GitHub 的 OAuth 应用各自只能登记一个回调地址，房主绑定流程和这里的
  // 后台绑定/登录用的是同一个 LINUXDO_REDIRECT_URI / GITHUB_REDIRECT_URI，所以第三方
  // 授权完成后永远只会跳回 server/index.js 里注册的房主回调路由，这里单独注册的
  // /api/admin/linuxdo/callback 实际永远不会被命中。真正处理 admin-bind / admin-login
  // 的逻辑要交给 index.js 的共享回调按 state.purpose 分发调用，这里只导出处理函数。

  async function handleLinuxdoAdminCallback(req, res, state, profile) {
    const ip = getClientIp?.(req) || req.ip || '';
    const entryPath = getAdminEntryPath();
    const fail = (reason) => res.redirect(`${entryPath}?linuxdo=${reason}`);

    if (state.purpose === 'admin-bind') {
      // 跳转期间会话可能已过期，绑定前二次核验管理员身份
      if (!isAdminEnabled() || !verifySession(req)) return fail('expired');
      const result = await bindAdminLinuxdo(profile);
      if (!result.success) return fail('error');
      audit('linuxdo_bind', { linuxdoUsername: profile.username }, ip);
      return fail('bound');
    }

    // admin-login：走和密码登录同样的节流，避免被用来穷举/高频探测
    const block = getLoginBlock(ip);
    if (block.blocked) {
      res.setHeader('Retry-After', String(block.retryAfterSec));
      return fail('locked');
    }
    noteLoginAttempt(ip);

    if (!isAdminEnabled() || !isLinuxdoIdBoundToAdmin(profile.id)) {
      noteLoginFailure(ip);
      audit('login_fail', { via: 'linuxdo', linuxdoUsername: profile.username }, ip);
      return fail('denied');
    }

    noteLoginSuccess(ip);
    const { sid } = createSession();
    setAdminSessionCookie(res, sid);
    audit('login_ok', { via: 'linuxdo', linuxdoUsername: profile.username }, ip);
    return fail('login_ok');
  }

  app.post('/api/admin/linuxdo/unbind', requireAdminOrigin, requireAdmin, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await unbindAdminLinuxdo();
    if (!result.success) return res.status(400).json({ error: result.error });
    audit('linuxdo_unbind', {}, ip);
    res.json({ success: true });
  });

  // ---------- GitHub OAuth：后台登录的另一种额外方式（与 Linux.do 完全对称） ----------

  app.get('/api/admin/github/status', (req, res) => {
    if (!isGithubConfigured()) return res.json({ enabled: false, bound: null });
    const isAdmin = isAdminEnabled() && Boolean(verifySession(req));
    res.json({ enabled: true, bound: isAdmin ? getAdminGithubBinding() : null });
  });

  app.get('/api/admin/github/bind/start', requireAdmin, (req, res) => {
    if (!isGithubConfigured()) return res.status(400).json({ error: 'GitHub 登录未配置' });
    const state = signGithubState({ purpose: 'admin-bind' });
    res.redirect(buildGithubAuthorizeUrl(state));
  });

  app.get('/api/admin/github/login/start', (req, res) => {
    if (!isGithubConfigured()) return res.status(400).json({ error: 'GitHub 登录未配置' });
    const state = signGithubState({ purpose: 'admin-login' });
    res.redirect(buildGithubAuthorizeUrl(state));
  });

  // 同上：/api/admin/github/callback 永远不会被 GitHub 命中，真正处理逻辑在
  // handleGithubAdminCallback，由 index.js 的共享回调按 state.purpose 分发调用。

  async function handleGithubAdminCallback(req, res, state, profile) {
    const ip = getClientIp?.(req) || req.ip || '';
    const entryPath = getAdminEntryPath();
    const fail = (reason) => res.redirect(`${entryPath}?github=${reason}`);

    if (state.purpose === 'admin-bind') {
      if (!isAdminEnabled() || !verifySession(req)) return fail('expired');
      const result = await bindAdminGithub(profile);
      if (!result.success) return fail('error');
      audit('github_bind', { githubUsername: profile.username }, ip);
      return fail('bound');
    }

    const block = getLoginBlock(ip);
    if (block.blocked) {
      res.setHeader('Retry-After', String(block.retryAfterSec));
      return fail('locked');
    }
    noteLoginAttempt(ip);

    if (!isAdminEnabled() || !isGithubIdBoundToAdmin(profile.id)) {
      noteLoginFailure(ip);
      audit('login_fail', { via: 'github', githubUsername: profile.username }, ip);
      return fail('denied');
    }

    noteLoginSuccess(ip);
    const { sid } = createSession();
    setAdminSessionCookie(res, sid);
    audit('login_ok', { via: 'github', githubUsername: profile.username }, ip);
    return fail('login_ok');
  }

  app.post('/api/admin/github/unbind', requireAdminOrigin, requireAdmin, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await unbindAdminGithub();
    if (!result.success) return res.status(400).json({ error: result.error });
    audit('github_unbind', {}, ip);
    res.json({ success: true });
  });

  function requireAdmin(req, res, next) {
    // 未启用与未登录统一 401，不泄露启用态
    const session = isAdminEnabled() ? verifySession(req) : null;
    if (!session) {
      clearAdminSessionCookie(res);
      return res.status(401).json(AUTH_DENIED);
    }
    req.adminSession = session;
    next();
  }

  /** 初始安全设置未完成时，拦截除改密 / 改入口外的写操作 */
  function requireAdminSetupComplete(req, res, next) {
    const setup = getAdminSetupStatus();
    if (!setup.setupRequired) return next();
    return res.status(403).json({
      error: '请先完成初始安全设置（修改默认账号密码与登录地址）',
      ...setup,
    });
  }

  app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
    const rooms = listRoomsForAdmin();
    const mem = process.memoryUsage();
    const setup = getAdminSetupStatus();
    res.json({
      roomCount: rooms.length,
      onlineUsers: rooms.reduce((sum, r) => sum + r.userCount, 0),
      playingRooms: rooms.filter((r) => r.isPlaying).length,
      connectedSockets: io.engine?.clientsCount ?? 0,
      uptimeSec: Math.floor(process.uptime()),
      memoryRssMb: Math.round(mem.rss / 1024 / 1024),
      redisEnabled: isRedisEnabled(),
      metingUpstreams: getMetingUpstreamStatus(),
      customMusicApis: getCustomMusicApiStatus(),
      entryPath: getAdminEntryPath(),
      adminUsername: getAdminUsername(),
      credentialsPersisted: isAdminCredentialsPersisted(),
      ...setup,
      auditStoredIn: 'redis',
    });
  });

  app.get('/api/admin/audit', requireAdmin, async (req, res) => {
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || '10'), 10) || 10));
    const q = String(req.query.q || '').trim().slice(0, 80);
    const action = String(req.query.action || '').trim().slice(0, 64);
    const result = await listAuditLogPage({
      offset: (page - 1) * pageSize,
      limit: pageSize,
      q,
      action,
    });
    res.json({
      items: result.items,
      total: result.total,
      page,
      pageSize: result.limit,
      totalPages: Math.max(1, Math.ceil(result.total / result.limit) || 1),
    });
  });

  // 修改管理员账号密码（存 Redis；需验证当前密码；限流防会话泄露后爆破）
  app.put('/api/admin/credentials', requireAdminOrigin, requireAdmin, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const block = getLoginBlock(ip);
    if (block.blocked) {
      res.setHeader('Retry-After', String(block.retryAfterSec));
      return res.status(429).json({
        error: block.reason === 'locked'
          ? `操作已锁定，请 ${block.retryAfterSec} 秒后再试`
          : '尝试过于频繁，请稍后再试',
        retryAfterSec: block.retryAfterSec,
      });
    }
    noteLoginAttempt(ip);

    const result = await setAdminCredentials({
      username: req.body?.username,
      password: req.body?.password,
      currentPassword: req.body?.currentPassword,
    });
    if (!result.success) {
      noteLoginFailure(ip);
      audit('set_credentials_fail', {}, ip);
      const after = getLoginBlock(ip);
      if (after.blocked && after.reason === 'locked') {
        res.setHeader('Retry-After', String(after.retryAfterSec));
        return res.status(429).json({
          error: `当前密码错误，操作已锁定 ${after.retryAfterSec} 秒`,
          retryAfterSec: after.retryAfterSec,
        });
      }
      return res.status(400).json({ error: result.error });
    }
    noteLoginSuccess(ip);
    // 保留当前会话，吊销其它已登录会话
    const currentSid = req.adminSession?.sid;
    for (const sid of activeSessions.keys()) {
      if (sid !== currentSid) activeSessions.delete(sid);
    }
    audit('set_credentials', { username: result.username, persisted: result.persisted }, ip);
    res.json({
      ok: true,
      username: result.username,
      persisted: result.persisted,
      ...getAdminSetupStatus(),
    });
  });

  app.put('/api/admin/entry-path', requireAdminOrigin, requireAdmin, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const requireCustom = mustChangeAdminEntryPath();
    const result = setAdminEntryPath(req.body?.path, { requireCustom });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    audit('set_entry_path', { path: result.entryPath }, ip);
    res.json({ ok: true, entryPath: result.entryPath, ...getAdminSetupStatus() });
  });

  app.post('/api/admin/entry-path/random', requireAdminOrigin, requireAdmin, (_req, res) => {
    res.json({ path: createRandomAdminEntryPath() });
  });

  app.get('/api/admin/runtime-config', requireAdmin, (_req, res) => {
    res.json({ config: getRuntimeConfigForAdmin() });
  });

  app.get('/api/admin/ai/status', requireAdmin, (_req, res) => {
    const cfg = getAiModelConfig();
    res.json({
      configured: isAiModelConfigured(),
      enabled: cfg.enabled,
      botName: cfg.botName,
      textModel: cfg.textModel,
      visionModel: cfg.visionModel,
    });
  });

  app.post('/api/admin/ai/test', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const message = String(req.body?.message || '你好').trim().slice(0, 500) || '你好';
    // 允许测试未保存的草稿配置（不落盘）
    const draftKey = String(req.body?.apiKey || '').trim();
    const draftModel = String(req.body?.model || '').trim();
    if (!draftModel) {
      return res.status(400).json({ success: false, error: '请先填写模型 ID，再进行测试' });
    }
    if (/\s/.test(draftModel)) {
      return res.status(400).json({ success: false, error: '模型 ID 不支持空格，请删除空格后再进行测试' });
    }
    const draftBaseUrl = String(req.body?.apiBaseUrl || '').trim();
    const draftProtocol = String(req.body?.apiProtocol || '').trim();
    const draftMaxRequestsPerMinute = Number(req.body?.maxRequestsPerMinute);
    const draftMaxTokensPerMinute = Number(req.body?.maxTokensPerMinute);
    const draftEnableThinking = req.body?.enableThinking;
    const draftContextWindowTokens = Number(req.body?.contextWindowTokens);
    const poolId = String(req.body?.poolId || '').trim();
    const savedPool = getRuntimeConfig().aiModelPools.find((pool) => pool.id === poolId);
    const overrides = {
      apiKey: draftKey || savedPool?.apiKey || undefined,
      model: draftModel,
      apiBaseUrl: draftBaseUrl || savedPool?.apiBaseUrl || undefined,
      apiProtocol: draftProtocol || savedPool?.apiProtocol || undefined,
      maxRequestsPerMinute: Number.isFinite(draftMaxRequestsPerMinute) ? draftMaxRequestsPerMinute : savedPool?.maxRequestsPerMinute,
      maxTokensPerMinute: Number.isFinite(draftMaxTokensPerMinute) ? draftMaxTokensPerMinute : savedPool?.maxTokensPerMinute,
      enableThinking: typeof draftEnableThinking === 'boolean' ? draftEnableThinking : savedPool?.enableThinking === true,
      contextWindowTokens: Number.isFinite(draftContextWindowTokens) ? draftContextWindowTokens : savedPool?.contextWindowTokens,
    };
    const isVisionPool = req.body?.type === 'vision' || savedPool?.type === 'vision';
    const result = isVisionPool
      ? await testAiModelVision(overrides)
      : await testAiModelChat(message, overrides);
    audit('ai_test', {
      success: result.success,
      model: result.model,
      latencyMs: result.latencyMs,
      error: result.success ? undefined : result.error,
    }, ip);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.get('/api/admin/runtime-config/music-api-status', requireAdmin, (_req, res) => {
    res.json(getCustomMusicApiStatus());
  });

  app.post('/api/admin/runtime-config/music-api-circuit/reset', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const endpointId = String(req.body?.id || '').trim();
    const status = resetCustomMusicApiCircuit(endpointId);
    audit('reset_music_api_circuit', { id: endpointId || '*' }, ip);
    res.json(status);
  });

  app.post('/api/admin/runtime-config/music-api-preview', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    try {
      const result = await previewCustomMusicApi(req.body?.api, req.body?.variables);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err?.message || '自定义音乐接口解析失败' });
    }
  });

  app.put('/api/admin/runtime-config', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = setRuntimeConfig(req.body || {});
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    try {
      const cfg = getRuntimeConfig();
      patchClientIndexHtml(CLIENT_DIST, {
        baiduVerification: cfg.seoBaiduVerification,
        siteOrigin: cfg.seoCanonicalUrl || '',
      });
    } catch (err) {
      console.warn('[seo] patch index.html after runtime-config failed:', err?.message || err);
    }
    audit('set_runtime_config', {}, ip);
    res.json({ ok: true, config: result.config });
  });

  app.get('/api/admin/announcement', requireAdmin, (_req, res) => {
    res.json({ announcement: getSiteAnnouncementForAdmin() });
  });

  app.put('/api/admin/announcement', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await setSiteAnnouncement({
      enabled: Boolean(req.body?.enabled),
      title: req.body?.title,
      text: req.body?.text,
      bumpId: Boolean(req.body?.bumpId),
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    audit('set_announcement', {
      enabled: result.announcement.enabled,
      announcementId: result.announcement.id,
    }, ip);
    res.json({ ok: true, announcement: result.announcement });
  });

  app.get('/api/admin/donations', requireAdmin, (_req, res) => {
    res.json({ donations: listDonationsForAdmin() });
  });

  app.post('/api/admin/donations', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const result = await addDonation({ name: req.body?.name, date: req.body?.date, amount: req.body?.amount });
    if (!result.success) return res.status(400).json({ error: result.error });
    audit('donation_add', { name: result.donation.name }, getClientIp?.(req) || req.ip || '');
    res.json({ success: true, donation: result.donation });
  });

  app.put('/api/admin/donations/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const result = await updateDonation(req.params.id, { name: req.body?.name, date: req.body?.date, amount: req.body?.amount });
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('donation_update', { name: result.donation.name }, getClientIp?.(req) || req.ip || '');
    res.json({ success: true, donation: result.donation });
  });

  app.delete('/api/admin/donations/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const result = await removeDonation(req.params.id);
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('donation_delete', { donationId: req.params.id }, getClientIp?.(req) || req.ip || '');
    res.json({ success: true });
  });

  app.get('/api/admin/rooms', requireAdmin, async (_req, res) => {
    res.json({ rooms: await listRoomsForAdminDetailed() });
  });

  app.post('/api/admin/rooms/:id/owner', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const targetUserId = String(req.body?.userId || '').trim();
    const ip = getClientIp?.(req) || req.ip || '';
    const result = adminTransferOwner(roomId, targetUserId);
    if (result.error) {
      const status = result.error === '房间不存在' || result.error === '用户不在房间中' ? 404 : 400;
      audit('admin_transfer_owner', { roomId, targetUserId, error: result.error }, ip);
      return res.status(status).json({ error: result.error });
    }
    if (typeof clearRoomOwnerBindings === 'function') {
      await clearRoomOwnerBindings(roomId).catch((err) => {
        console.error('管理员转让房主后清理身份绑定失败:', err?.message || err);
      });
    } else {
      await clearLinuxdoBindingsForRoom(roomId).catch((err) => {
        console.error('管理员转让房主后清理 Linux.do 绑定失败:', err?.message || err);
      });
    }
    if (typeof broadcastRoomUpdate === 'function') broadcastRoomUpdate(roomId, { immediate: true });
    if (result.systemMessage) io.to(roomId).emit('chat_message', result.systemMessage);
    audit('admin_transfer_owner', {
      roomId,
      targetUserId,
      targetNickname: result.room?.users?.find?.((user) => user.id === targetUserId)?.nickname || '',
      previousOwnerNickname: result.previousOwnerNickname || '',
    }, ip);
    res.json({ success: true, room: result.room, message: result.message });
  });

  // 按需查看房间明文密码：列表不下发，每次查看写审计
  app.get('/api/admin/rooms/:id/password', requireAdmin, requireAdminSetupComplete, (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const ip = getClientIp?.(req) || req.ip || '';
    const result = getRoomPasswordForAdmin(roomId);
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }
    audit('view_room_password', {
      roomId,
      hasPassword: result.hasPassword,
      recoverable: Boolean(result.password),
    }, ip);
    res.json(result);
  });

  app.put('/api/admin/rooms/:id/protection', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await setRoomProtectedFromDestroy(roomId, Boolean(req.body?.enabled));
    if (!result.success) {
      return res.status(result.error === '房间不存在' ? 404 : 503).json({ error: result.error });
    }
    audit('set_room_protection', {
      roomId,
      enabled: result.protectedFromDestroy,
    }, ip);
    res.json(result);
  });

  app.put('/api/admin/rooms/:id/users/:userId/nickname', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const userId = String(req.params.userId || '').trim();
    const ip = getClientIp?.(req) || req.ip || '';
    const result = adminRenameRoomUser(roomId, userId, req.body?.nickname);
    if (!result.success) {
      return res.status(result.error === '房间不存在' || result.error === '用户不存在' ? 404 : 400).json({ error: result.error });
    }
    if (typeof broadcastRoomUpdate === 'function') broadcastRoomUpdate(roomId, { immediate: true });
    audit('rename_room_user', {
      roomId,
      userId,
      previousNickname: result.previousNickname,
      nickname: result.nickname,
    }, ip);
    res.json({
      success: true,
      room: result.room,
      previousNickname: result.previousNickname,
      nickname: result.nickname,
    });
  });

  app.post('/api/admin/rooms/:id/users/:userId/violation-reset', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const userId = String(req.params.userId || '').trim();
    const ip = getClientIp?.(req) || req.ip || '';
    const result = adminResetRoomUserNickname(roomId, userId);
    if (!result.success) {
      return res.status(result.error === '房间不存在' || result.error === '用户不存在' ? 404 : 400).json({ error: result.error });
    }

    const noticeText = `「${result.previousNickname || '该用户'}」名称违规，已被系统重置。`;
    const notice = broadcastAdminSystemMessage(noticeText, { roomIds: [roomId] });
    if (typeof broadcastRoomUpdate === 'function') broadcastRoomUpdate(roomId, { immediate: true });
    if (notice.success) {
      for (const delivery of notice.deliveries || []) {
        io.to(delivery.roomId).emit('chat_message', delivery.message);
        io.to(delivery.roomId).emit('chat_message', delivery.toast);
      }
    }
    audit('reset_room_user_nickname', {
      roomId,
      userId,
      previousNickname: result.previousNickname,
      nickname: result.nickname,
      delivered: notice.success ? notice.roomCount : 0,
    }, ip);
    res.json({
      success: true,
      room: result.room,
      previousNickname: result.previousNickname,
      nickname: result.nickname,
      notified: notice.success,
    });
  });

  app.post('/api/admin/rooms/:id/permanent-application', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const ip = getClientIp?.(req) || req.ip || '';
    const approved = Boolean(req.body?.approved);
    const reason = String(req.body?.reason || '').trim();
    const result = await reviewRoomPermanentApplication(roomId, { approved, reason });
    if (!result.success) {
      return res.status(400).json({ error: result.error || '审核失败' });
    }

    const delivered = emitPermanentDecisionToUser(io, socketToUserId, result.notice);
    audit('review_permanent_application', {
      roomId,
      approved,
      reason: approved ? undefined : reason,
      delivered,
    }, ip);
    res.json({ ...result, delivered });
  });

  app.post('/api/admin/meting/reset-cooldown', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = resetMetingUpstreamCooldown(req.body?.url);
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('meting_reset_cooldown', { url: result.upstream?.url }, ip);
    res.json(result);
  });

  app.post('/api/admin/meting/disable', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = setMetingUpstreamDisabled(req.body?.url, Boolean(req.body?.disabled));
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('meting_set_disabled', {
      url: result.upstream?.url,
      disabled: result.upstream?.disabled,
    }, ip);
    res.json(result);
  });

  app.post('/api/admin/broadcast', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const roomIds = Array.isArray(req.body?.roomIds) ? req.body.roomIds : undefined;
    const result = broadcastAdminSystemMessage(req.body?.text, { roomIds });
    if (!result.success) return res.status(400).json({ error: result.error });

    for (const delivery of result.deliveries || []) {
      io.to(delivery.roomId).emit('chat_message', delivery.message);
      io.to(delivery.roomId).emit('chat_message', delivery.toast);
    }

    audit('broadcast', { roomCount: result.roomCount }, ip);
    res.json({ success: true, roomCount: result.roomCount });
  });

  app.get('/api/admin/bans', requireAdmin, (_req, res) => {
    res.json({ bans: listSiteBans() });
  });

  app.post('/api/admin/bans', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const adminIp = getClientIp?.(req) || req.ip || '';
    const result = await addSiteBan({
      type: req.body?.type,
      value: req.body?.value,
      reason: req.body?.reason,
    });
    if (!result.success) return res.status(400).json({ error: result.error });

    const ban = result.ban;
    const { kicked } = kickConnectionsMatchingBan(ban, {
      io,
      socketToRoom,
      socketToUserId,
      getClientIp,
      getRoomInternal,
      removeUser,
      prepareRoomBroadcast,
      roomUpdateForViewer,
    });

    audit('site_ban_add', {
      banType: ban.type,
      value: ban.value,
      source: ban.source || 'manual',
      kicked,
    }, adminIp);
    res.json({ success: true, ban, kicked });
  });

  app.delete('/api/admin/bans/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await removeSiteBan(req.params.id);
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('site_ban_remove', { banId: req.params.id }, ip);
    res.json({ success: true });
  });

  app.get('/api/admin/error-reports', requireAdmin, async (_req, res) => {
    res.json({ reports: await listErrorReports() });
  });

  app.get('/api/admin/error-reports/:id', requireAdmin, async (req, res) => {
    const report = await getErrorReport(req.params.id);
    if (!report) return res.status(404).json({ error: '上报不存在' });
    res.json({ report });
  });

  app.put('/api/admin/error-reports/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await updateErrorReport(req.params.id, {
      status: req.body?.status,
      note: req.body?.note,
    });
    if (!result.success) {
      const code = result.error?.includes('解决方案') ? 400 : 404;
      return res.status(code).json({ error: result.error });
    }
    let delivered = 0;
    if (result.report.status === 'resolved' && result.report.note && !result.report.solutionAckedAt) {
      delivered = emitErrorReportSolutionToUser(io, socketToUserId, result.report);
    }
    audit('error_report_update', {
      reportId: result.report.id,
      status: result.report.status,
      delivered,
    }, ip);
    res.json({ success: true, report: result.report, delivered });
  });

  app.delete('/api/admin/error-reports/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await deleteErrorReport(req.params.id);
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('error_report_delete', { reportId: req.params.id }, ip);
    res.json({ success: true });
  });

  app.delete('/api/admin/rooms/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const ip = getClientIp?.(req) || req.ip || '';
    // 先把房内连接踢出，避免解散后客户端仍持有旧状态
    // 先收集再删除，避免在遍历 Map 的同时修改它
    const sidsToKick = [];
    for (const [sid, rid] of socketToRoom.entries()) {
      if (rid === roomId) sidsToKick.push(sid);
    }
    for (const sid of sidsToKick) {
      const s = io.sockets.sockets.get(sid);
      socketToRoom.delete(sid);
      socketToUserId.delete(sid);
      s?.leave(roomId);
      s?.emit('kicked', { message: '房间已被站点管理员解散' });
    }
    const result = adminDestroyRoom(roomId);
    if (!result.success) {
      audit('destroy_room_fail', { roomId, error: result.error }, ip);
      return res.status(404).json({ error: result.error });
    }
    audit('destroy_room', { roomId, name: result.name, kicked: sidsToKick.length }, ip);
    res.json({ success: true, name: result.name });
  });

  // Linux.do / GitHub 回调实际由 index.js 的共享房主回调路由分发调用（见上方注释）
  return { handleLinuxdoAdminCallback, handleGithubAdminCallback };
}
