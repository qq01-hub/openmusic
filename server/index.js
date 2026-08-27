import './loadEnv.js';
import { resizeCoverForThumb } from './coverUrl.js';
import {
  isAllowedMediaHostname,
  isBlockedMediaHostname,
  serveUpstreamMedia,
} from './mediaProxy.js';
import { formatMetingFetchError } from './metingFetch.js';
import { fetchMeting } from './metingFetch.js';
import {
  fetchMetingApi,
  isMetingApiHostname,
  getMetingUpstreamBases,
  isConfiguredMetingUrl,
  getMetingUpstreamStatus,
  startMetingHealthProbe,
  runWithMetingRequestContext,
  registerMetingRoomResolver,
} from './metingUpstream.js';
import { fetchCustomMusicApi, hasCustomMusicApi, getCustomMusicApiStatus } from './customMusicApi.js';
import {
  contributeMusicAccount,
  revokeMusicContribution,
  bindRoomMusicAccount,
  fetchRoomMusicAccounts,
  fetchRoomMusicAccountCredentials,
  fetchMusicContributions,
  getMetingQualityCapabilities,
  hasMetingVipAccount,
  setRoomMusicAccountShared,
  unbindRoomMusicAccount,
} from './metingAdmin.js';
import {
  createManagedMusicQrSession,
  checkManagedMusicQrSession,
  completeManagedQishuiVerification,
  fetchManagedQishuiVerificationAsset,
  getManagedMusicQrCredential,
  releaseManagedMusicQrCredential,
  finalizeManagedMusicQrCredential,
  requestManagedQishuiVerification,
  startManagedQishuiVerification,
} from './musicQrSessions.js';
import { hasRoomCredentialEncryptionKey } from './roomCredentialCrypto.js';
import { mountWechatFileHelperProxy } from './wechatFileHelperProxy.js';
import { mountAdminApi, appendAdminAudit } from './adminApi.js';
import { initAdminCredentials } from './adminCredentials.js';
import { getAdminEntryPath } from './adminConfig.js';
import { isSetupRequired, mountSetupApi } from './setupApi.js';
import { buildRobotsTxt, buildSitemapXml, resolveSiteOrigin } from './seoFiles.js';
import { patchClientIndexHtml, readClientIndexHtml } from './seoIndexHtml.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import {
  deriveApiSignKey,
  verifyApiSign,
  isPublicApiPath,
  isApiSignRequired,
} from './apiSign.js';
import {
  collectDeviceIdsForUser,
  getUserIdForDevice,
  isAccessBanned,
  linkDeviceToUser,
  sanitizeDeviceId,
} from './deviceIdentity.js';
import { resolveBoundClientNetwork } from './clientIpBinding.js';
import {
  createRoom,
  getRoomPublic,
  getRoom,
  listRooms,
  findRandomMatchRoom,
  listRoomsForAdmin,
  findIdleOwnedRoom,
  reuseIdleOwnedRoom,
  countOwnedRooms,
  listRoomIds,
  flushAllPendingRoomPersists,
  verifyRoomPassword,
  roomExists,
  initRooms,
  isRedisEnabled,
  addUser,
  removeUser,
  renameUser,
  setUserAvatar,
  renameRoom,
  setRoomLock,
  setRoomMemberTier,
  removeRoomMemberTier,
  setRoomMemberSettings,
  postMemberWelcomeMessage,
  setRoomJoinNotice,
  setRoomAiSettings,
  setRoomMaxAdmins,
  setRoomPlaybackRate,
  postJoinNoticeMessage,
  shouldMuteJoinAnnouncements,
  wasKnownRoomUser,
  setRoomFmMode,
  setRoomPlayMode,
  setRoomMusicAccountsCache,
  patchRoomMusicAccountCache,
  getRoomMusicAccountCookie,
  setRoomAnnouncement,
  setRoomCustomCover,
  setChatHistoryVisibleOnJoin,
  setChatShowAvatars,
  setSongRequestEnabled,
  banRoomSong,
  unbanRoomSong,
  addRoomForbiddenWord,
  removeRoomForbiddenWord,
  setChatMute,
  addToQueue,
  removeFromQueue,
  clearQueue,
  skipSong,
  finishCurrentSong,
  ensurePlayback,
  retryStuckRandomLoading,
  markRandomLoading,
  setPlaying,
  seekTo,
  getRoomInternal,
  adminDestroyRoom,
  assertOwnerCanDestroyRoom,
  buildPlaybackState,
  buildQueueSnapshot,
  setSharedPlaybackMedia,
  requestJump,
  reorderQueue,
  toggleQueueLike,
  toggleCurrentDislike,
  approveJump,
  rejectJump,
  requestSkip,
  approveSkip,
  rejectSkip,
  addChatMessage,
  postBotChatMessage,
  recallChatMessage,
  toggleChatReaction,
  getChatHistoryForUser,
  getSongHistory,
  INITIAL_CHAT_LIMIT,
  advancePlaybackIfEnded,
  getPlaybackTime,
  canUserMutate,
  kickUser,
  transferOwner,
  setRoomAdmin,
  reportTrackDuration,
  setOnRoomPrefetchReady,
  setOnRoomStructureChanged,
  serializeRoomForViewer,
  prepareRoomBroadcast,
  roomUpdateForViewer,
  prepareRoomPresence,
  roomPresenceForViewer,
  findUserRoomPresence,
  requestRoomPermanent,
  cancelRoomPermanentRequest,
  getRoomAiSnapshot,
  skipSongOnBehalfOfUser,
  requestSkipOnBehalfOfUser,
} from './roomManager.js';
import {
  listPendingPermanentNoticesForUser,
  ackPermanentDecisionNotice,
} from './permanentApplication.js';
import { importNeteasePlaylist, importQqPlaylist, importQishuiPlaylist, fetchNeteasePlaylistMetas } from './playlistImport.js';
import { fetchNeteaseHotToplist } from './neteaseToplist.js';
import { createNeteasePlaylistSearchHandler } from './neteasePlaylistSearch.js';
import { getHotSongs } from './songHotRank.js';
import { hasRedisEnvConfig, importFavoriteSongs, listFavoriteSongs, setFavoriteSong, getRedisClient } from './roomStorage.js';
import {
  createChatImageUploadToken,
  isQiniuConfigured,
} from './qiniuOss.js';
import { enqueueRoomAiChat } from './roomAiAgent.js';
import { getPublicRoomAiConfig, getAiModelConfig, isRoomAiEnabledForRoom, isAiModelEnabled, resolveRoomAiBotName, shouldTriggerRoomAi, stripAiTriggerPrefix } from './aiModelService.js';
import {
  isApihzStickerConfigured,
  searchApihzStickers,
} from './apihzSticker.js';
import { getSiteAnnouncement, initSiteAnnouncement } from './siteAnnouncement.js';
import { initDonations, listDonations } from './donations.js';
import { initSiteBans, isSiteBanned } from './siteBan.js';
import {
  checkRoomCreateCooldown,
  recordRoomCreate,
} from './roomCreateGuard.js';
import {
  SOFT_BLOCK_CODES,
  softBlockMessage,
  softBlockPayload,
  setSoftBlockHeaders,
} from './softBlock.js';
import { kickConnectionsMatchingBan } from './kickSiteBan.js';
import { createErrorReport, listPendingSolutionsForUser, ackErrorReportSolution } from './errorReports.js';
import { getRuntimeConfig, getPublicSiteSeo, setRuntimeConfig } from './runtimeConfig.js';
import { socketPayload } from './socketPayload.js';
import { hardenSocketHandlers } from './socketHandlerGuard.js';
import {
  buildSocketRatePrincipal,
  createDistributedSocketRateLimiter,
  getSocketEventRatePolicy,
} from './socketRateLimiter.js';
import { createLogger, incrementMetric } from './logger.js';
import {
  isLinuxdoConfigured,
  signLinuxdoState,
  verifyLinuxdoState,
  sanitizeReturnPath,
  buildLinuxdoAuthorizeUrl,
  exchangeLinuxdoCode,
  fetchLinuxdoProfile,
  bindLinuxdoToUser,
  getUserIdForLinuxdo,
  getLinuxdoProfileForUser,
  unbindLinuxdoForUser,
} from './linuxdoAuth.js';
import {
  isGithubConfigured,
  signGithubState,
  verifyGithubState,
  sanitizeGithubReturnPath,
  buildGithubAuthorizeUrl,
  exchangeGithubCode,
  fetchGithubProfile,
  bindGithubToUser,
  getUserIdForGithub,
  getGithubProfileForUser,
  unbindGithubForUser,
} from './githubAuth.js';

// 由 mountAdminApi() 返回赋值：房主 OAuth 回调路由与后台 OAuth 回调共用同一个
// 已在第三方平台注册的 redirect_uri，只能在这一个路由里按 state.purpose 分发，
// 详见下方 /api/auth/{provider}/callback 路由与 adminApi.js 内的处理函数。
let handleLinuxdoAdminCallback = null;
let handleGithubAdminCallback = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '../client/dist');
const PORT = process.env.PORT || 4000;
const DISCONNECT_GRACE_MS = 30_000;
const AUTO_ADVANCE_INTERVAL_MS = 500;
const CLIENT_URL = (process.env.CLIENT_URL || '').replace(/\/$/, '');
const SITE_CANONICAL_URL = (process.env.SITE_CANONICAL_URL || '').trim().replace(/\/$/, '');
const ALLOWED_ORIGINS = CLIENT_URL
  ? new Set(CLIENT_URL.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean))
  : null;
const CLIENT_ID_SECRET = process.env.CLIENT_ID_SECRET || randomBytes(32).toString('hex');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const ALLOW_INSECURE_HTTP_API = process.env.ALLOW_INSECURE_HTTP_API === '1'
  || process.env.ALLOW_INSECURE_HTTP_API === 'true';
const ALLOW_INSECURE_COOKIES = process.env.ALLOW_INSECURE_COOKIES === '1'
  || process.env.ALLOW_INSECURE_COOKIES === 'true';
/** 会话 HMAC 有效期（秒），默认 90 天 */
const SESSION_TTL_SEC = Math.max(
  60 * 60 * 24,
  parseInt(process.env.SESSION_TTL_SEC || String(60 * 60 * 24 * 90), 10) || (60 * 60 * 24 * 90),
);
/** 剩余有效期低于此值时 bootstrap 静默续签 */
const SESSION_RENEW_WITHIN_SEC = Math.min(
  60 * 60 * 24 * 7,
  Math.max(60 * 60, Math.floor(SESSION_TTL_SEC / 3)),
);

if (IS_PRODUCTION && !ALLOWED_ORIGINS) {
  console.warn('安全告警: NODE_ENV=production 但未配置 CLIENT_URL，浏览器跨域请求将被拒绝');
}
if (IS_PRODUCTION && !(process.env.CLIENT_ID_SECRET || '').trim()) {
  console.warn('安全告警: NODE_ENV=production 但未配置 CLIENT_ID_SECRET，重启后所有会话将失效');
}

const app = express();
// Forwarded IP headers are only trustworthy when the deployment explicitly
// declares that a reverse proxy is in front of this process.
app.set('trust proxy', TRUST_PROXY ? 1 : false);
const httpServer = createServer(app);

/** 本地调试 Origin（Flutter Web / Vite 等任意端口） */
function isLocalDevOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '[::1]'
      || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

function corsOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }

  const normalized = origin.replace(/\/$/, '');

  // 首次部署尚无 CLIENT_URL；安装 API 自身仍执行严格同 Host 校验。
  if (isSetupRequired()) {
    callback(null, true);
    return;
  }

  // 非生产：允许本机任意端口跨域（Flutter Web、Vite 等），即使 CLIENT_URL 指向正式域。
  if (!IS_PRODUCTION && isLocalDevOrigin(normalized)) {
    callback(null, true);
    return;
  }

  if (!ALLOWED_ORIGINS) {
    callback(null, !IS_PRODUCTION);
    return;
  }

  callback(null, ALLOWED_ORIGINS.has(normalized));
}

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // 表情 data URL 需 >1MB；4MB 兼顾防大包 DoS 与本地贴纸
  maxHttpBufferSize: 4 * 1024 * 1024,
  // base64 表情几乎压不动，抬高阈值避免人多时 CPU 被 deflate 打满
  perMessageDeflate: {
    threshold: 262144,
  },
  httpCompression: true,
  // 人多时事件循环偶发阻塞，放宽 ping 超时减少误判断连
  pingInterval: 10_000,
  pingTimeout: 60_000,
});

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'Authorization',
    'X-OM-Ts',
    'X-OM-Nonce',
    'X-OM-Sign',
  ],
}));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

function isExemptFromSiteBan(reqPath = '') {
  const p = String(reqPath || '');
  if (p.startsWith('/api/admin')) return true;
  if (p.startsWith('/api/setup')) return true;
  if (p.startsWith('/socket.io')) return true;
  try {
    const entry = getAdminEntryPath();
    if (entry && (p === entry || p.startsWith(`${entry}/`))) return true;
  } catch {
    // ignore
  }
  return false;
}

function resolveSiteBanFromRequest(req) {
  const ip = getRequestIp(req);
  const deviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  const ban = isSiteBanned({ ip, deviceId });
  return { ban, ip, deviceId };
}

function sendSiteBannedResponse(req, res) {
  // 站点封禁拦截不写审计：被封用户会高频重试，日志无运维价值且易刷爆
  const code = SOFT_BLOCK_CODES.SITE_BAN;
  const message = softBlockMessage(code);
  const wantsHtml = String(req.headers.accept || '').includes('text/html')
    || !String(req.path || '').startsWith('/api/');
  // 禁止 CDN/浏览器缓存封禁页，否则一人被封可能污染公共缓存误伤全站
  res.setHeader('Cache-Control', 'no-store, no-cache, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-OpenMusic-Site-Blocked', '1');
  setSoftBlockHeaders(res, code);
  if (wantsHtml) {
    res.status(503).type('html').send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>暂时无法访问</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#0b0d12;color:#e8eaed;text-align:center;padding:24px}
p{opacity:.75;font-size:15px;margin:0 0 8px;line-height:1.6}
code{opacity:.55;font-size:13px}
</style></head><body>
<p>${message}</p>
</body></html>`);
    return;
  }
  res.status(503).json(softBlockPayload(code));
}

/** 全站封禁：首页 / API / SPA 一律拦截（管理后台入口除外） */
app.use((req, res, next) => {
  if (isExemptFromSiteBan(req.path)) return next();
  const { ban } = resolveSiteBanFromRequest(req);
  if (!ban) return next();
  sendSiteBannedResponse(req, res);
});

mountSetupApi(app);

/** 受保护 API：会话校验 + 请求签名校验 */
const API_ACCESS_DENIED = '请求无效，请刷新页面后重试';

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/setup/')) return next();
  // 管理后台使用独立的账号密码鉴权（见 adminApi.js / adminCredentials.js），不走会话身份与签名
  if (req.path.startsWith('/api/admin/')) return next();
  if (isPublicApiPath(req)) return next();

  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(403).json({ error: API_ACCESS_DENIED });
  }

  req.apiIdentity = identity;

  // 仅当管理员显式允许时，HTTP 才降级为只校验会话；HTTPS 始终校验请求签名。
  const requireRequestSign = req.secure || !ALLOW_INSECURE_HTTP_API;
  // 汽水取链接口由客户端用 session 调用；签名在拼接 token 时已校验上游会话，这里免二次签名以免 Worker 取链失败。
  const isQishuiSourceRequest = req.path === '/api/qishui-source' && req.method === 'GET';
  if (isApiSignRequired() && requireRequestSign && !isQishuiSourceRequest) {
    const signKey = deriveApiSignKey(CLIENT_ID_SECRET, identity.userId, identity.iat);
    const result = verifyApiSign(req, signKey, identity.userId);
    if (!result.ok) {
      return res.status(403).json({ error: API_ACCESS_DENIED });
    }
  }

  next();
});

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeClientIp(raw) {
  let ip = String(raw || '').replace(/^::ffff:/, '').trim();
  if (!ip) return '';

  // 取逗号分隔链的首段（CDN 自定义头偶发带多值）
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  const v4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) return v4WithPort[1];

  return ip;
}

function normalizeReportedClientIp(raw) {
  const ip = normalizeClientIp(String(raw || '').slice(0, 64));
  return isIP(ip) ? ip : '';
}

function getHeaderIp(headers, name) {
  const key = String(name || '').toLowerCase();
  if (!key) return '';
  const raw = headers[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return normalizeClientIp(value);
}

/**
 * CDN 回源真实客户端 IP 头（有 CDN 时必填）。
 * Cloudflare: CF-Connecting-IP；EdgeOne: iqp
 */
const CLIENT_IP_HEADER = String(process.env.CLIENT_IP_HEADER || '').trim().toLowerCase();

function getClientIpFromHeaders(headers = {}, remoteAddress = '') {
  // 未接反代时只用 socket 地址，避免客户端伪造 XFF 绕过限流
  const trustForwarded = TRUST_PROXY;
  if (!trustForwarded) {
    return normalizeClientIp(remoteAddress || '');
  }

  // CDN 配置头优先于 Nginx 写入的边缘节点 X-Real-IP
  if (CLIENT_IP_HEADER) {
    const customIp = getHeaderIp(headers, CLIENT_IP_HEADER);
    if (customIp) return customIp;
  }

  // Nginx 覆盖写入的 X-Real-IP 优先于可被伪造的 XFF 首段
  const realIp = getHeaderIp(headers, 'x-real-ip');
  if (realIp) return realIp;

  const forwarded = headers['x-forwarded-for'];
  const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (rawForwarded) {
    const parts = String(rawForwarded).split(',').map((part) => part.trim()).filter(Boolean);
    // 可信代理追加在末尾；取最后一段
    if (parts.length > 0) return normalizeClientIp(parts[parts.length - 1]);
  }

  return normalizeClientIp(remoteAddress || '');
}

function logIpDebug(scope, headers, remoteAddress, resolvedIp) {
  if (process.env.DEBUG_IP !== '1') return;
  console.log(`[ip-debug:${scope}]`, {
    clientIpHeader: CLIENT_IP_HEADER || '(unset)',
    customIp: CLIENT_IP_HEADER ? headers?.[CLIENT_IP_HEADER] : undefined,
    xff: headers?.['x-forwarded-for'],
    realIp: headers?.['x-real-ip'],
    remoteAddress,
    resolvedIp,
  });
}

function getRequestIp(req) {
  const ip = getClientIpFromHeaders(req.headers, req.socket?.remoteAddress || req.ip);
  logIpDebug('http', req.headers, req.socket?.remoteAddress || req.ip, ip);
  return ip;
}

function getClientIp(socket) {
  const headers = socket.request?.headers || socket.handshake.headers || {};
  const remoteAddress = socket.request?.socket?.remoteAddress || socket.handshake.address;
  const ip = getClientIpFromHeaders(headers, remoteAddress);
  logIpDebug('socket', headers, remoteAddress, ip);
  return ip;
}

function isPrivateIp(ip) {
  return (
    !ip
    || ip === '::1'
    || ip === '127.0.0.1'
    || ip === '0.0.0.0'
    || ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || ip.startsWith('169.254.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    || /^fc|^fd/i.test(ip)
    || /^fe80:/i.test(ip)
  );
}

function normalizeLocationName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parts = text
    .replace(/^(中国|中华人民共和国)\s*/u, '')
    .split(/[\s/|]+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part
      .replace(/(省|市|特别行政区|壮族自治区|回族自治区|维吾尔自治区)$/u, '')
      .trim())
    .filter(Boolean)
    .slice(0, 2);

  const deduped = [];
  for (const part of parts) {
    if (deduped.length > 0 && deduped[deduped.length - 1] === part) continue;
    deduped.push(part);
  }
  if (deduped.length > 1 && deduped.every((part) => part === deduped[0])) {
    return deduped[0].slice(0, 12);
  }
  return deduped.join(' ').slice(0, 12);
}

function fallbackLocationForIp(ip) {
  if (!ip || isPrivateIp(ip)) return '本地';
  return '未知';
}

const VALID_SOURCES = new Set(['netease', 'tencent', 'kugou', 'qishui']);

function limitText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function createRateLimiter({ windowMs, max, maxBuckets = 10_000 }) {
  const buckets = new Map();
  let lastSweepAt = 0;
  return (key) => {
    const now = Date.now();
    if (now - lastSweepAt >= windowMs) {
      lastSweepAt = now;
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && buckets.size >= maxBuckets) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
  };
}

const limitJoinAttempt = createRateLimiter({ windowMs: 60_000, max: 30 });
const limitJoinPasswordFail = createRateLimiter({ windowMs: 60_000, max: 8 });
const limitProxyRequest = createRateLimiter({ windowMs: 60_000, max: 120 });
const limitSocketAction = createRateLimiter({ windowMs: 60_000, max: 90 });
const limitContributionQr = createRateLimiter({ windowMs: 60_000, max: 45 });
const limitContributionBind = createRateLimiter({ windowMs: 10 * 60_000, max: 8 });
const limitSocketChat = createRateLimiter({ windowMs: 60_000, max: 30 });
const limitOwnerDestroyRoom = createRateLimiter({ windowMs: 60_000, max: 3 });
const limitErrorReport = createRateLimiter({ windowMs: 10 * 60_000, max: 5 });
const limitSessionBootstrap = createRateLimiter({ windowMs: 60_000, max: 90 });
const limitNewSessionBootstrap = createRateLimiter({ windowMs: 60_000, max: 45 });
const limitLinuxdoAuth = createRateLimiter({ windowMs: 60_000, max: 10 });
const limitGithubAuth = createRateLimiter({ windowMs: 60_000, max: 10 });
const socketRateLog = createLogger('socket-rate-limit');
let lastSocketRateRedisErrorAt = 0;
const distributedSocketRateLimiter = createDistributedSocketRateLimiter({
  getRedisClient,
  onRedisError: (error) => {
    incrementMetric('socket_rate_limit_redis_error_total');
    const now = Date.now();
    if (now - lastSocketRateRedisErrorAt >= 60_000) {
      lastSocketRateRedisErrorAt = now;
      socketRateLog.warn('redis_failed_using_memory_fallback', { error });
    }
  },
});

function sanitizeClientSong(song) {
  if (!song || typeof song !== 'object') {
    return { error: '歌曲数据无效' };
  }

  const source = VALID_SOURCES.has(song.source) ? song.source : 'netease';
  const id = limitText(song.id, 128);
  const name = limitText(song.name, 100);
  const artist = limitText(song.artist, 100) || '未知歌手';

  if (!id || !name) {
    return { error: '歌曲数据缺少 id 或名称' };
  }

  const sanitized = {
    id,
    source,
    name,
    artist,
    album: limitText(song.album, 100) || undefined,
    pic: limitText(song.pic, 1000) || undefined,
    // 不信任客户端上报的时长，避免伪造超短 duration 触发自动切歌
  };

  // 歌词/播放 URL 由客户端按需拉取，服务端不持久化。
  return { song: sanitized };
}

// buildMetingUrl / isMetingApiHostname 已迁移至 metingUpstream.js（多上游负载均衡）

function parseMetingMediaQuery(url) {
  try {
    const parsed = new URL(url);
    const type = parsed.searchParams.get('type');
    if (type !== 'pic' && type !== 'url') return null;
    const server = parsed.searchParams.get('server');
    const id = parsed.searchParams.get('id');
    if (!server || !id) return null;
    const quality = parsed.searchParams.get('quality') || undefined;
    return { server, id, type, quality };
  } catch {
    return null;
  }
}

function parseMetingPicQuery(url) {
  const query = parseMetingMediaQuery(url);
  return query?.type === 'pic' ? query : null;
}

function normalizeMetingResolvedUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.startsWith('@') ? text.slice(1).trim() : text;
}

function isMetingNoUrlMessage(raw) {
  const text = String(raw || '').trim().toLowerCase();
  return text === 'no url' || text.includes('no url') || text.includes('空播放');
}

function extractMetingLyricText(raw) {
  const text = normalizeMetingResolvedUrl(raw);
  if (!text) return '';
  if (text.startsWith('{')) {
    try {
      const payload = JSON.parse(text);
      const lyric = String(payload?.lyric || payload?.data?.lyric || '').trim();
      const translation = String(payload?.tlyric || payload?.data?.tlyric || '').trim();
      // 仅在字段确实是带时间轴的 LRC 时解包；其它 JSON 保持旧的文本返回行为。
      if (/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(lyric)) {
        return translation ? `${lyric}\n${translation}` : lyric;
      }

      const fallbackCandidates = [
        payload?.lrc,
        payload?.data?.lrc?.lyric,
        payload?.data?.tlyric?.lyric,
      ];
      for (const candidate of fallbackCandidates) {
        const fallback = String(candidate || '').trim();
        if (/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(fallback)) return fallback;
      }
    } catch {
      // 非 JSON 时按纯 LRC 继续处理
    }
  }
  return text;
}

function normalizeMetingSongIds(data) {
  const list = Array.isArray(data)
    ? data
    : (data && Array.isArray(data.data) ? data.data : (data && Array.isArray(data.list) ? data.list : []));

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (item.id !== undefined && item.id !== null && String(item.id).trim() !== '') continue;

    const url = item.url;
    if (typeof url === 'number' || (typeof url === 'string' && /^\d{4,}$/.test(url.trim()))) {
      item.id = String(url).trim();
    }
  }

  return data;
}

function normalizeMetingLoudness(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const result = {};
  for (const key of ['gain', 'peak', 'lra']) {
    const value = Number(raw[key]);
    if (Number.isFinite(value)) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeMetingDuration(raw) {
  const duration = Number(raw);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  return Math.round(duration < 10_000 ? duration * 1000 : duration);
}

/** 解析 type=url 响应：兼容 JSON {url,quality,loudness,duration} 与纯文本/重定向 URL */
function parseMetingUrlPayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      const url = normalizeMetingResolvedUrl(data?.url);
      if (!url) return null;
      const quality = typeof data?.quality === 'string' ? data.quality.trim() : '';
      return {
        url,
        quality,
        loudness: normalizeMetingLoudness(data?.loudness),
        duration: normalizeMetingDuration(data?.duration),
      };
    } catch {
      return null;
    }
  }

  const url = normalizeMetingResolvedUrl(text);
  if (!url) return null;
  return { url, quality: '' };
}

/** 网易云 outer/url 假直链（实为 404），当作无音源 */
function isNeteaseOuterMediaUrl(url) {
  const text = String(url || '').trim();
  if (!text.startsWith('http')) return false;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'music.163.com' && host !== 'www.music.163.com') return false;
    return /\/song\/media\/outer\/url/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isUnresolvedMetingMediaUrl(url) {
  const query = parseMetingMediaQuery(url);
  if (!query) return false;
  try {
    const parsed = new URL(url);
    return isMetingApiHostname(parsed.hostname) || isPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
}

async function resolveMetingMediaUrl(query, depth = 0) {
  if (depth > 5) throw new Error('Meting 媒体地址解析过深');

  const params = { server: query.server, type: query.type, id: query.id };
  if (query.quality) params.quality = query.quality;

  const response = await fetchMetingApi(params, { redirect: 'manual' }, 15000);

  if (response.status >= 300 && response.status < 400) {
    const location = normalizeMetingResolvedUrl(response.headers.get('location'));
    if (!location) throw new Error('Meting 返回空重定向');
    if (isNeteaseOuterMediaUrl(location)) throw new Error('Meting 返回不可播外链');
    const nested = parseMetingMediaQuery(location);
    if (nested && isUnresolvedMetingMediaUrl(location)) {
      return resolveMetingMediaUrl(nested, depth + 1);
    }
    return location;
  }

  const text = await response.text();
  const payload = parseMetingUrlPayload(text);
  const resolved = payload?.url || normalizeMetingResolvedUrl(text);
  if (!resolved.startsWith('http')) throw new Error('Meting 未返回有效媒体地址');
  if (isNeteaseOuterMediaUrl(resolved)) throw new Error('Meting 返回不可播外链');

  const nested = parseMetingMediaQuery(resolved);
  if (nested && isUnresolvedMetingMediaUrl(resolved)) {
    return resolveMetingMediaUrl(nested, depth + 1);
  }

  return resolved;
}

const metingCoverCache = new Map();
const metingCoverInflight = new Map();
const METING_COVER_CACHE_TTL_MS = 10 * 60 * 1000;
const METING_COVER_CACHE_MAX = 512;

async function resolveCachedMetingCover(query) {
  const key = `${String(query.server || 'netease')}:${String(query.id || '')}`;
  const now = Date.now();
  const cached = metingCoverCache.get(key);
  if (cached && cached.expiresAt > now) return cached.url;
  if (cached) metingCoverCache.delete(key);

  const pending = metingCoverInflight.get(key);
  if (pending) return pending;

  const request = resolveMetingMediaUrl(query)
    .then((url) => {
      const value = String(url || '').trim();
      if (!/^https?:\/\//i.test(value)) throw new Error('Meting 未返回有效封面地址');
      metingCoverCache.set(key, { url: value, expiresAt: Date.now() + METING_COVER_CACHE_TTL_MS });
      while (metingCoverCache.size > METING_COVER_CACHE_MAX) {
        const oldest = metingCoverCache.keys().next().value;
        if (!oldest) break;
        metingCoverCache.delete(oldest);
      }
      return value;
    })
    .finally(() => {
      metingCoverInflight.delete(key);
    });
  metingCoverInflight.set(key, request);
  return request;
}

function requestPublicOrigin(req) {
  const forwardedProto = String(req?.get?.('X-Forwarded-Proto') || '').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProto === 'https' ? 'https' : (req?.protocol || 'http');
  const host = String(req?.get?.('X-Forwarded-Host') || req?.get?.('Host') || '').split(',')[0].trim();
  if (!host) return '';
  const prefix = String(req?.get?.('X-Forwarded-Prefix') || '').trim().replace(/\/$/, '');
  return `${protocol}://${host}${prefix}`;
}

// 与 Meting 汽水播放地址保持同级有效期，避免长时间暂停或慢速播放时失效。
const QISHUI_SOURCE_TOKEN_TTL_MS = 10 * 60 * 1000;
const QISHUI_SOURCE_REDIS_PREFIX = 'openmusic:qishui-src:';
const qishuiSourceTokens = new Map();

function isQishuiPlayUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.pathname.endsWith('/audio/qishui') && Boolean(url.searchParams.get('t'));
  } catch {
    return false;
  }
}

function pruneQishuiSourceTokens() {
  const now = Date.now();
  for (const [token, entry] of qishuiSourceTokens) {
    if (entry.expiresAt <= now) qishuiSourceTokens.delete(token);
  }
  while (qishuiSourceTokens.size > 2048) {
    const oldest = qishuiSourceTokens.keys().next().value;
    if (!oldest) break;
    qishuiSourceTokens.delete(oldest);
  }
}

const qishuiSourceTokenCleanupTimer = setInterval(pruneQishuiSourceTokens, 60 * 1000);
qishuiSourceTokenCleanupTimer.unref?.();

/** 优先用持久密钥，保证进程重启后仍可校验已发出的汽水播放会话。 */
function getQishuiSourceSigningKey() {
  const roomKey = String(
    getRuntimeConfig().roomCredentialEncryptionKey
    || process.env.ROOM_CREDENTIAL_ENCRYPTION_KEY
    || '',
  ).trim();
  const material = roomKey || CLIENT_ID_SECRET;
  return createHmac('sha256', 'openmusic:qishui-source').update(material).digest();
}

function qishuiSourceRedisKey(token) {
  return `${QISHUI_SOURCE_REDIS_PREFIX}${createHash('sha256').update(token).digest('hex')}`;
}

async function persistQishuiSourceToken(token, rawUrl, expiresAt) {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    const ttl = Math.max(1000, expiresAt - Date.now());
    await redis.set(qishuiSourceRedisKey(token), rawUrl, { PX: ttl });
  } catch (err) {
    console.warn('汽水播放会话 Redis 写入失败:', err?.message || err);
  }
}

function rememberQishuiSourceToken(token, rawUrl, expiresAt) {
  qishuiSourceTokens.set(token, { rawUrl, expiresAt });
  void persistQishuiSourceToken(token, rawUrl, expiresAt);
}

function createQishuiSourceToken(rawUrl) {
  pruneQishuiSourceTokens();
  const expiresAt = Date.now() + QISHUI_SOURCE_TOKEN_TTL_MS;
  const body = Buffer.from(JSON.stringify({ u: String(rawUrl), e: expiresAt }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getQishuiSourceSigningKey()).update(body).digest('base64url');
  const token = `v2.${body}.${sig}`;
  rememberQishuiSourceToken(token, String(rawUrl), expiresAt);
  return token;
}

function verifySignedQishuiSourceToken(token) {
  const match = /^v2\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || '').trim());
  if (!match) return '';
  const body = match[1];
  const sig = match[2];
  try {
    const expected = Buffer.from(createHmac('sha256', getQishuiSourceSigningKey()).update(body).digest('base64url'));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return '';
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const rawUrl = String(parsed?.u || '').trim();
    const expiresAt = Number(parsed?.e) || 0;
    if (!rawUrl || expiresAt <= Date.now()) return '';
    return rawUrl;
  } catch {
    return '';
  }
}

async function resolveQishuiSourceToken(token) {
  pruneQishuiSourceTokens();
  const normalized = String(token || '').trim();
  if (!normalized) return '';

  const signed = verifySignedQishuiSourceToken(normalized);
  if (signed) return signed;

  const entry = qishuiSourceTokens.get(normalized);
  if (entry && entry.expiresAt > Date.now()) return entry.rawUrl;

  try {
    const redis = getRedisClient();
    if (redis) {
      const rawUrl = String(await redis.get(qishuiSourceRedisKey(normalized)) || '').trim();
      if (rawUrl) {
        const ttl = await redis.pTTL(qishuiSourceRedisKey(normalized)).catch(() => -1);
        const expiresAt = ttl > 0 ? Date.now() + ttl : Date.now() + QISHUI_SOURCE_TOKEN_TTL_MS;
        qishuiSourceTokens.set(normalized, { rawUrl, expiresAt });
        return rawUrl;
      }
    }
  } catch (err) {
    console.warn('汽水播放会话 Redis 读取失败:', err?.message || err);
  }

  return '';
}

async function localizeQishuiPayload(payload, metingQuery, req) {
  if (metingQuery?.server !== 'qishui' || metingQuery?.type !== 'url' || !isQishuiPlayUrl(payload?.url)) return payload;
  const token = createQishuiSourceToken(payload.url);
  const path = `/api/qishui-source?t=${encodeURIComponent(token)}`;
  const origin = requestPublicOrigin(req);
  return { ...payload, url: origin ? `${origin}${path}` : path };
}

/** media-proxy 误收到 Meting API 地址时，先解析为真实 CDN 地址 */
async function resolveMediaProxyFetchUrl(fetchUrl, thumbPx = 0) {
  const query = parseMetingMediaQuery(fetchUrl);
  if (!query) return fetchUrl;

  try {
    const resolved = await resolveMetingMediaUrl(query);
    if (query.type === 'pic' && thumbPx > 0) {
      return resizeCoverForThumb(resolved, thumbPx);
    }
    return resolved;
  } catch (err) {
    console.error(`Meting ${query.type} resolve error:`, err.message);
    return fetchUrl;
  }
}

async function finalizeMetingTextResponse(body, metingType) {
  if (metingType === 'lrc') {
    return { url: extractMetingLyricText(body), quality: '' };
  }

  if (metingType === 'url') {
    const payload = parseMetingUrlPayload(body);
    if (payload?.url) {
      const normalized = payload.url;
      if (isNeteaseOuterMediaUrl(normalized)) return { url: '', quality: '' };
      if (!isUnresolvedMetingMediaUrl(normalized)) {
        return { ...payload, url: normalized, quality: payload.quality || '' };
      }
      const nested = parseMetingMediaQuery(normalized);
      if (!nested || nested.type !== 'url') {
        return { ...payload, url: normalized, quality: payload.quality || '' };
      }
      const resolved = await resolveMetingMediaUrl(nested);
      return { ...payload, url: resolved, quality: payload.quality || '' };
    }

    // 纯文本 URL / @URL；JSON 无 url、{"error":"no url"} 等一律视为无链
    const textUrl = normalizeMetingResolvedUrl(body);
    if (textUrl.startsWith('http')) {
      if (isNeteaseOuterMediaUrl(textUrl)) return { url: '', quality: '' };
      if (!isUnresolvedMetingMediaUrl(textUrl)) {
        return { url: textUrl, quality: '' };
      }
      const nested = parseMetingMediaQuery(textUrl);
      if (nested?.type === 'url') {
        const resolved = await resolveMetingMediaUrl(nested);
        return { url: resolved, quality: '' };
      }
      return { url: textUrl, quality: '' };
    }
    return { url: '', quality: '' };
  }

  const normalized = normalizeMetingResolvedUrl(body);
  return { url: normalized, quality: '' };
}

async function proxyMetingResponse(metingQuery, res, thumbPx = 0, metingType = '', req = null) {
  if (metingType === 'pic') {
    try {
      const resolved = await resolveCachedMetingCover(metingQuery);
      return serveUpstreamMedia(
        thumbPx > 0 ? resizeCoverForThumb(resolved, thumbPx) : resolved,
        res,
        fetchWithTimeout,
        { thumbPx: 0, requireAllowlist: true },
      );
    } catch (err) {
      console.error('Meting pic resolve error:', err?.message || err);
      return res.status(404).json({ error: 'no cover' });
    }
  }

  const response = await fetchMetingApi(metingQuery, { redirect: 'manual' });

  if (response.status >= 300 && response.status < 400) {
    let location = response.headers.get('location');
    if (location && thumbPx > 0) {
      location = resizeCoverForThumb(location, thumbPx);
    }
    if (location) {
      // type=url/lrc 必须返回文本/JSON，不能把浏览器重定向到第三方 CDN（fetch 会触发 CORS）
      if (metingType === 'url') {
        const body = await localizeQishuiPayload(await finalizeMetingTextResponse(location, metingType), metingQuery, req);
        if (!body.url) return res.status(403).json({ error: 'no url' });
        return res.json(body);
      }
      if (metingType === 'lrc') {
        const body = await finalizeMetingTextResponse(location, metingType);
        return res.type('text').send(body.url);
      }
      if (metingType === 'pic' && /^https?:\/\//i.test(location)) {
        return serveUpstreamMedia(location, res, fetchWithTimeout, {
          thumbPx,
          requireAllowlist: true,
        });
      }
      return res.redirect(response.status, location);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (metingType === 'url') {
    const body = await localizeQishuiPayload(await finalizeMetingTextResponse(text, metingType), metingQuery, req);
    if (!body.url) return res.status(403).json({ error: 'no url' });
    return res.json(body);
  }

  if (metingType === 'lrc') {
    const body = await finalizeMetingTextResponse(text, metingType);
    return res.type('text').send(body.url);
  }

  if (contentType.includes('application/json') || text.startsWith('[') || text.startsWith('{')) {
    try {
      return res.json(normalizeMetingSongIds(JSON.parse(text)));
    } catch {
      return res.type('text').send(text);
    }
  }

  return res.type('text').send(text);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/** 首页站点公告：管理后台设置（Redis 持久化）；no-store 防 CDN/浏览器缓存旧公告 */
app.get('/api/site-announcement', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.json(getSiteAnnouncement());
});

/** 首页捐赠名单：仅公开管理员录入的署名与日期，不处理支付信息。 */
app.get('/api/donations', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.json({ donations: listDonations() });
});

/** 站点 SEO：管理后台可覆盖标题/描述等；空字段回退内置默认 */
app.get('/api/site-seo', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.json(getPublicSiteSeo());
});

/** 前端更新检测：走 /api 绕过 EdgeOne 静态缓存；no-store 防中间层缓存 */
app.get('/api/app-version', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  const versionPath = path.join(clientDist, 'version.json');
  try {
    if (fs.existsSync(versionPath)) {
      const raw = fs.readFileSync(versionPath, 'utf8');
      const data = JSON.parse(raw);
      return res.json({
        buildId: String(data.buildId || data.version || ''),
        version: String(data.version || data.buildId || ''),
        notes: Array.isArray(data.notes) ? data.notes : [],
        builtAt: data.builtAt || null,
        forcePrompt: data.forcePrompt === true,
      });
    }
  } catch (err) {
    console.error('app-version read error:', err?.message || err);
  }
  return res.json({ buildId: 'dev', version: 'dev', notes: [], builtAt: null, forcePrompt: false });
});

app.post('/api/music-account-contribution/qr/create', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  if (!getRuntimeConfig().sharedMembershipEnabled) {
    return res.status(403).json({ success: false, error: '共享会员功能当前已关闭' });
  }
  if (!limitContributionQr(`contribution-qr:${getRequestIp(req)}:${identity.userId}`)) {
    return res.status(429).json({ success: false, error: '操作有点频繁，请稍等一会儿再试' });
  }
  const platform = ['netease', 'tencent', 'qishui'].includes(req.body?.platform) ? req.body.platform : '';
  if (!platform) return res.status(400).json({ success: false, error: '请选择音乐平台' });
  const result = await createManagedMusicQrSession({
    ownerId: identity.userId,
    platform,
    purpose: 'contribution',
  });
  if (!result.ok) return res.status(result.status || 502).json({ success: false, error: result.error || '二维码生成失败' });
  return res.json({ success: true, data: result.data });
});

app.post('/api/music-account-contribution/qr/check', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  if (!limitContributionQr(`contribution-check:${getRequestIp(req)}:${identity.userId}`)) {
    return res.status(429).json({ success: false, error: '查询有点频繁，请稍等一会儿再试' });
  }
  const result = await checkManagedMusicQrSession({
    sessionId: limitText(req.body?.sessionId, 128),
    ownerId: identity.userId,
    purpose: 'contribution',
  });
  if (!result.ok) return res.status(result.status || 502).json({ success: false, error: result.error || '扫码状态查询失败' });
  return res.json({ success: true, data: result.data });
});

app.post('/api/music-account-contribution/qr/verify/start', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  const result = await startManagedQishuiVerification({
    sessionId: limitText(req.body?.sessionId || req.body?.key || req.body?.token, 128),
    ownerId: identity.userId,
    purpose: 'contribution',
  });
  if (!result.ok) return res.status(result.status || 502).json({ success: false, error: result.error || '汽水验证初始化失败' });
  return res.json({ success: true, data: result.data });
});

app.post('/api/music-account-contribution/qr/verify/request', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  const result = await requestManagedQishuiVerification({
    sessionId: limitText(req.body?.sessionId || req.body?.key || req.body?.token, 128),
    ownerId: identity.userId,
    purpose: 'contribution',
  }, req.body?.request || {});
  if (!result.ok) return res.status(result.status || 502).json({ success: false, error: result.error || '汽水验证请求失败' });
  return res.json({ success: true, ...result.data });
});

app.post('/api/music-account-contribution/qr/verify/complete', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  const result = await completeManagedQishuiVerification({
    sessionId: limitText(req.body?.sessionId || req.body?.key || req.body?.token, 128),
    ownerId: identity.userId,
    purpose: 'contribution',
  });
  if (!result.ok) return res.status(result.status || 502).json({ success: false, error: result.error || '汽水验证完成失败' });
  return res.json({ success: true, data: result.data });
});

app.get('/api/music-account-contribution/qr/verify/:asset', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  const asset = String(req.params.asset || '');
  if (!['security_host.html', 'react.js', 'react-dom.js', 'sdk-glue.js', 'bdms.js'].includes(asset)) return res.status(404).end();
  const result = await fetchManagedQishuiVerificationAsset(asset);
  if (!result.ok) return res.status(result.status || 502).json({ success: false, error: result.error || '汽水验证资源获取失败' });
  res.set('Content-Type', result.contentType);
  res.set('Cache-Control', 'no-store');
  return res.send(Buffer.from(result.body));
});

app.post('/api/music-account-contribution/bind', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  if (!getRuntimeConfig().sharedMembershipEnabled) {
    return res.status(403).json({ success: false, error: '共享会员功能当前已关闭' });
  }
  if (!limitContributionBind(`contribution-bind:${getRequestIp(req)}:${identity.userId}`)) {
    return res.status(429).json({ success: false, error: '提交次数有点多，请稍后再试' });
  }
  const context = {
    sessionId: limitText(req.body?.sessionId, 128),
    ownerId: identity.userId,
    purpose: 'contribution',
  };
  const credential = await getManagedMusicQrCredential(context);
  if (!credential.ok) return res.status(400).json({ success: false, error: credential.error });
  const revokeToken = randomBytes(12).toString('base64url');
  const result = await contributeMusicAccount(
    credential.platform,
    credential.cookie,
    limitText(req.body?.providerName || req.body?.provider, 40),
    revokeToken,
  );
  if (!result.ok) {
    await releaseManagedMusicQrCredential(context);
    return res.status(result.status || 400).json({
      success: false,
      code: result.code,
      error: result.error || '会员能力验证失败，请重新扫码',
    });
  }
  await finalizeManagedMusicQrCredential(context);
  return res.json({
    success: true,
    updated: result.updated,
    data: result.data,
    revokeToken: result.revokeToken || revokeToken,
    message: result.message,
  });
});

app.post('/api/music-account-contribution/revoke', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  if (!limitContributionBind(`contribution-revoke:${getRequestIp(req)}:${identity.userId}`)) {
    return res.status(429).json({ success: false, error: '操作频繁，请稍后再试' });
  }
  const result = await revokeMusicContribution(req.body?.revokeToken);
  if (!result.ok) return res.status(result.status || 400).json({ success: false, error: result.error || '取消共享失败' });
  return res.json({ success: true, message: result.message || '共享已取消' });
});

app.get('/api/music-account-contribution/shared', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  if (!getRuntimeConfig().sharedMembershipEnabled) {
    return res.json({ success: true, data: [] });
  }
  const result = await fetchMusicContributions(Math.min(Number(req.query.limit) || 20, 50));
  if (!result.ok) return res.status(result.status || 502).json({ success: false, error: result.error || '共享记录暂时不可用' });
  return res.json({ success: true, data: result.data });
});

app.get('/api/music/hot', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  const limit = parseInt(String(req.query.limit || ''), 10);
  try {
    const songs = await getHotSongs(Number.isFinite(limit) ? limit : 30);
    res.json(songs);
  } catch (err) {
    console.error('Hot songs error:', err.message);
    res.status(500).json({ error: '获取热榜失败' });
  }
});

app.get('/api/music/toplist/netease', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('toplist', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  const limit = parseInt(String(req.query.limit || ''), 10);
  try {
    const data = await fetchNeteaseHotToplist(Number.isFinite(limit) ? limit : 200);
    res.json(data);
  } catch (err) {
    console.error('Netease toplist error:', err.message);
    res.status(502).json({ error: err.message || '获取热榜失败' });
  }
});

app.get('/api/music/netease/playlists/meta', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('playlist-meta', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const ids = String(req.query.ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (ids.length === 0) {
    return res.json({ playlists: [] });
  }

  try {
    const playlists = await fetchNeteasePlaylistMetas(ids);
    res.json({ playlists });
  } catch (err) {
    console.error('Netease playlist meta error:', err.message);
    res.status(502).json({ error: '获取歌单信息失败' });
  }
});

app.get('/api/music/netease/playlists/search', createNeteasePlaylistSearchHandler({
  requireIdentity: requireSessionIdentity,
  consumeLimit: (req) => limitProxyRequest(proxyLimitKey('playlist-search', req)),
  findPresence: findUserRoomPresence,
}));

app.get('/api/music/sources', async (_req, res) => {
  const sources = [
    {
      id: 'netease',
      name: '网易',
      shortName: '网易',
      color: '#ec4141',
      supportsSearch: true,
      supportsIdLookup: true,
    },
    {
      id: 'tencent',
      name: 'QQ',
      shortName: 'QQ',
      color: '#31c27c',
      supportsSearch: true,
      supportsIdLookup: false,
    },
  ];
  try {
    const metingQishui = await hasMetingVipAccount('qishui');
    if (metingQishui.ok && metingQishui.hasVip) {
      sources.push({
        id: 'qishui',
        name: '汽水',
        shortName: '汽水',
        color: '#f5c542',
        supportsSearch: true,
        supportsIdLookup: true,
        description: '汽水音乐曲库与会员音源',
      });
    }
  } catch {
    // 汽水会员状态未知时保持关闭，避免展示无法使用的搜索入口。
  }
  // 酷狗仅在管理后台「自定义接口」启用搜索时下发，客户端据此隐藏入口
  if (hasCustomMusicApi('kugou', 'search')) {
    sources.push({
      id: 'kugou',
      name: '酷狗',
      shortName: '酷狗',
      color: '#2688ee',
      supportsSearch: true,
      supportsIdLookup: false,
      description: '通过自定义接口搜索',
    });
  }
  res.json(sources);
});

/** 本机音质能力：是否开放 SVIP 档（管理后台可开关） */
app.get('/api/music/quality-capabilities', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  const { svipQualityEnabled } = getRuntimeConfig();
  let sharedSvip = false;
  let neteaseSvip = false;
  let tencentSvip = false;
  let qishuiVip = false;
  let qishuiSvip = false;
  try {
    const metingCapabilities = await getMetingQualityCapabilities();
    if (metingCapabilities.ok) {
      neteaseSvip = Boolean(metingCapabilities.neteaseSvip);
        tencentSvip = Boolean(metingCapabilities.tencentSvip);
        qishuiVip = Boolean(metingCapabilities.qishuiVip);
        qishuiSvip = Boolean(metingCapabilities.qishuiSvip);
    }
    const contributions = await fetchMusicContributions(100);
    if (contributions.ok) {
      contributions.data.forEach((item) => {
        const platform = item?.platform || item?.account?.platform;
        const hasSvip = item?.tier === 'svip' || item?.account?.hasSvip === true;
        const hasVip = hasSvip || item?.account?.hasVip === true || item?.tier === 'vip';
        if (platform === 'netease' && hasSvip) neteaseSvip = true;
        if (platform === 'tencent' && hasSvip) tencentSvip = true;
        if (platform === 'qishui' && hasVip) qishuiVip = true;
        if (platform === 'qishui' && hasSvip) qishuiSvip = true;
      });
    }
    sharedSvip = neteaseSvip || tencentSvip;
    if (sharedSvip && !svipQualityEnabled) {
      setRuntimeConfig({ svipQualityEnabled: true });
    }
  } catch {
    // 共享池暂时不可用时保留管理后台开关状态。
  }
  res.json({
    svipQualityEnabled: Boolean(svipQualityEnabled || sharedSvip),
    sharedSvip,
    neteaseSvip,
    tencentSvip,
    qishuiVip,
    qishuiSvip,
  });
});

app.get('/api/meting', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;

  try {
    const thumbPx = parseInt(String(req.query.size || ''), 10) || 0;
    const query = { ...req.query };
    delete query.size;
    const presence = findUserRoomPresence(identity.userId);
    await runWithMetingRequestContext(
      {
        userId: identity.userId,
        userNickname: presence?.userNickname || '',
        roomId: presence?.roomId || '',
        roomName: presence?.roomName || '',
      },
      () => proxyMetingResponse(query, res, thumbPx, String(query.type || ''), req),
    );
  } catch (err) {
    const message = formatMetingFetchError(err);
    console.error('Meting proxy error:', message);
    // 业务无链 / 上游 403 不应伪装成连通性故障，否则客户端会无限按「网络问题」重试
    if (/no\s*url|空播放|未返回有效媒体|不可播外链/i.test(message)) {
      return res.status(403).json({ error: 'no url' });
    }
    if (/上游返回 403/.test(message)) {
      return res.status(403).json({ error: 'no url' });
    }
    if (/未配置 METING_API_URL/.test(message)) {
      return res.status(502).json({ error: '未配置 METING_API_URL' });
    }
    if (/未配置 Meting API Token/.test(message)) {
      return res.status(502).json({ error: message });
    }
    if (/均已禁用|均不可用/.test(message)) {
      return res.status(502).json({ error: '音源上游暂不可用，请稍后重试' });
    }
    res.status(502).json({ error: '无法连接 Meting API，请检查 METING_API_URL 配置' });
  }
});

/** 仅从 Meting 获取汽水 CDN 地址和本次音频密钥，解密始终在客户端完成。 */
async function resolveQishuiPlaybackSource(rawUrl, signal) {
  const sourceEndpoint = new URL(rawUrl);
  sourceEndpoint.searchParams.set('mode', 'source');
  const metadataResponse = await fetchMeting(sourceEndpoint.toString(), { signal }, 15_000);
  if (!metadataResponse.ok) {
    const body = await metadataResponse.text().catch(() => '');
    if (isMetingNoUrlMessage(body)) throw new Error('no url');
    throw new Error(`汽水源信息请求失败 (${metadataResponse.status})`);
  }

  const rawMetadata = await metadataResponse.text();
  if (isMetingNoUrlMessage(rawMetadata)) throw new Error('no url');
  let metadata;
  try {
    metadata = JSON.parse(rawMetadata);
  } catch {
    throw new Error('汽水源信息格式无效');
  }
  const sourceUrl = String(metadata?.url || '').trim();
  const auth = String(metadata?.auth || '').trim();
  if (isMetingNoUrlMessage(sourceUrl)) throw new Error('no url');
  let parsedSource;
  try {
    parsedSource = new URL(sourceUrl);
  } catch {
    throw new Error('汽水源地址无效');
  }
  if (parsedSource.protocol !== 'https:' || !isAllowedMediaHostname(parsedSource.hostname)) {
    throw new Error('汽水源地址不在允许范围');
  }
  if (!auth) throw new Error('汽水音频密钥缺失');
  return { sourceUrl, auth };
}

/** 浏览器本地解密模式：只返回短时有效的汽水 CDN 地址和本次音频密钥。 */
app.get('/api/qishui-source', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;

  const token = String(req.query.t || '').trim();
  const rawUrl = token ? await resolveQishuiSourceToken(token) : '';
  if (!rawUrl || !isQishuiPlayUrl(rawUrl) || !isConfiguredMetingUrl(rawUrl)) {
    return res.status(400).json({ error: '汽水播放会话无效或已过期' });
  }

  try {
    const { sourceUrl, auth } = await resolveQishuiPlaybackSource(rawUrl);
    res.set('Cache-Control', 'no-store, private');
    return res.json({ url: sourceUrl, auth });
  } catch (error) {
    const message = String(error?.message || error);
    if (isMetingNoUrlMessage(message)) {
      return res.status(403).json({ error: 'no url' });
    }
    console.error('OpenMusic 汽水本地解密取链失败:', message);
    return res.status(502).json({ error: '汽水本地解密取链失败' });
  }
});

app.get('/api/media-proxy', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  if (!limitProxyRequest(proxyLimitKey('media', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const raw = String(req.query.url || '').trim();
  const thumbPx = Math.min(512, Math.max(0, parseInt(String(req.query.size || ''), 10) || 0));
  let fetchUrl = raw;
  let parsed;
  try {
    parsed = new URL(fetchUrl);
  } catch {
    return res.status(400).json({ error: '无效地址' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: '不支持的协议' });
  }

  // 汽水 /audio/qishui 是 Meting 服务端解密流，禁止经 OpenMusic 代理（解密只允许浏览器本地）
  if (/(?:^|\/)audio\/qishui\/?$/i.test(parsed.pathname)) {
    return res.status(403).json({ error: '汽水音频仅支持本地解密' });
  }

  if (isBlockedMediaHostname(parsed.hostname) && !isMetingApiHostname(parsed.hostname)) {
    return res.status(403).json({ error: '禁止访问内网地址' });
  }
  // 不再限制媒体域名白名单，仅拦截内网地址

  const presence = findUserRoomPresence(identity.userId);
  const metingCtx = {
    userId: identity.userId,
    userNickname: presence?.userNickname || '',
    roomId: presence?.roomId || '',
    roomName: presence?.roomName || '',
  };

  try {
    if (parseMetingMediaQuery(raw)) {
      fetchUrl = await runWithMetingRequestContext(
        metingCtx,
        () => resolveMediaProxyFetchUrl(raw, thumbPx),
      );
    } else if (thumbPx > 0) {
      fetchUrl = resizeCoverForThumb(raw, thumbPx);
    } else {
      fetchUrl = raw;
    }

    // 解析后的最终 URL 必须落在音乐 CDN 白名单（不再允许任意公网 / 内网 Meting）
    let finalHost = '';
    try {
      const finalParsed = new URL(fetchUrl);
      finalHost = finalParsed.hostname;
      if (/(?:^|\/)audio\/qishui\/?$/i.test(finalParsed.pathname)) {
        return res.status(403).json({ error: '汽水音频仅支持本地解密' });
      }
    } catch {
      return res.status(400).json({ error: '无效地址' });
    }
    if (isBlockedMediaHostname(finalHost)) {
      return res.status(403).json({ error: '禁止访问内网地址' });
    }

    await serveUpstreamMedia(fetchUrl, res, fetchWithTimeout, {
      range: req.headers.range,
      thumbPx,
      requireAllowlist: true,
    });
  } catch (err) {
    console.error('Media proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
  }
});

/** 酷狗音乐搜索：走管理后台自定义接口 */
async function handleKugouSearch(req, res) {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('kugou', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const keyword = String(req.query.q || '').trim();
  const num = Math.min(Math.max(parseInt(String(req.query.num || '15'), 10) || 15, 1), 30);

  if (!keyword) return res.json([]);

  try {
    const custom = await fetchCustomMusicApi({
      server: 'kugou',
      type: 'search',
      id: keyword,
      keyword,
      limit: num,
    });
    if (custom) return res.json(await custom.json());
    return res.status(503).json({ error: '未配置酷狗自定义接口' });
  } catch (err) {
    console.error('Kugou search error:', err.message);
    res.status(502).json({ error: '酷狗音乐搜索失败' });
  }
}

app.get('/api/music/kugou/search', handleKugouSearch);

/** 导入外部歌单（分享链接） */
app.post('/api/music/playlist/import', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('playlist', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const platform = String(req.body?.platform || '').trim();
  const input = String(req.body?.input || '').trim();
  if (!input) return res.status(400).json({ error: '请粘贴歌单分享链接' });
  if (platform !== 'netease' && platform !== 'qq' && platform !== 'qishui') {
    return res.status(400).json({ error: '不支持的平台' });
  }

  try {
    const result = platform === 'netease'
      ? await importNeteasePlaylist(input)
      : platform === 'qq' ? await importQqPlaylist(input) : await importQishuiPlaylist(input);
    res.json(result);
  } catch (err) {
    console.error('Playlist import error:', err.message);
    res.status(400).json({ error: err.message || '歌单导入失败' });
  }
});

/** 酷狗音乐详情（播放链接、歌词）：走管理后台自定义接口 */
async function handleKugouSong(req, res) {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('kugou-song', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: '缺少歌曲 id' });

  try {
    const customOperations = ['song', 'url', 'lrc', 'pic'].filter((operation) => (
      hasCustomMusicApi('kugou', operation)
    ));
    if (customOperations.length === 0) {
      return res.status(503).json({ error: '未配置酷狗自定义接口' });
    }
    const results = await Promise.allSettled(customOperations.map(async (operation) => {
      const response = await fetchCustomMusicApi({ server: 'kugou', type: operation, id });
      if (!response) return [operation, null];
      if (operation === 'song') {
        const songs = await response.json();
        return [operation, Array.isArray(songs) ? songs[0] : songs];
      }
      return [operation, await response.text()];
    }));
    const customDetail = { id, source: 'kugou' };
    let customHit = false;
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        console.warn(`自定义酷狗详情字段失败：${result.reason?.message || result.reason}`);
        continue;
      }
      const [operation, value] = result.value;
      if (operation === 'song' && value && typeof value === 'object') {
        Object.assign(customDetail, value);
        customHit = true;
      } else if (value) {
        customDetail[operation] = value;
        customHit = true;
      }
    }
    if (!customHit) {
      return res.status(404).json({ error: '歌曲不存在或接口未返回可用结果' });
    }
    res.json(customDetail);
  } catch (err) {
    console.error('Kugou song error:', err.message);
    res.status(502).json({ error: '酷狗音乐获取失败' });
  }
}

app.get('/api/music/kugou/song', handleKugouSong);

const IDENTITY_UID_COOKIE = 'openmusic_uid';
const IDENTITY_TOKEN_COOKIE = 'openmusic_token';
const DEVICE_ID_COOKIE = 'openmusic_did';
const IDENTITY_COOKIE_MAX_AGE_SEC = SESSION_TTL_SEC;

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

function sanitizeClientId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : '';
}

/** 签名格式：`iat.hmac(userId.iat)`，带过期时间 */
function signClientId(clientId, iat = Math.floor(Date.now() / 1000)) {
  const issuedAt = Math.floor(Number(iat) || Date.now() / 1000);
  const payload = `${clientId}.${issuedAt}`;
  const sig = createHmac('sha256', CLIENT_ID_SECRET).update(payload).digest('base64url');
  return `${issuedAt}.${sig}`;
}

/**
 * @returns {{ userId: string, iat: number, expiresAt: number } | null}
 */
function verifyClientToken(clientId, token) {
  const id = sanitizeClientId(clientId);
  const rawToken = String(token || '').trim();
  if (!id || !rawToken) return null;

  const dot = rawToken.indexOf('.');
  if (dot <= 0) return null;

  const iat = Number(rawToken.slice(0, dot));
  const sig = rawToken.slice(dot + 1);
  if (!Number.isFinite(iat) || iat <= 0 || !sig) return null;

  try {
    const expected = Buffer.from(
      createHmac('sha256', CLIENT_ID_SECRET).update(`${id}.${iat}`).digest('base64url'),
    );
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (iat > now + 60) return null;
  if (now - iat > SESSION_TTL_SEC) return null;

  return { userId: id, iat, expiresAt: iat + SESSION_TTL_SEC };
}

function createServerClientId() {
  return randomBytes(18).toString('base64url');
}

function setIdentityCookieHeaders(res, userId, token, deviceId = null) {
  // 生产环境默认强制 Secure，避免反代漏传 X-Forwarded-Proto 时静默降级。
  // 临时 HTTP 部署必须由管理员显式允许不安全 Cookie。
  const useSecureCookie = (IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || res.req?.secure;
  const secure = useSecureCookie ? '; Secure' : '';
  const origin = res.req?.headers?.origin;
  // 同主机跨端口（Flutter :57920 → API :4000）仍是 same-site，Lax 即可。
  // SameSite=None 必须带 Secure；本地 HTTP 若写 None 无 Secure，Chrome 会直接丢弃 Cookie。
  const sameSite = (useSecureCookie && !IS_PRODUCTION && isLocalDevOrigin(origin))
    ? 'SameSite=None'
    : 'SameSite=Lax';
  const base = `Path=/; Max-Age=${IDENTITY_COOKIE_MAX_AGE_SEC}; HttpOnly; ${sameSite}${secure}`;
  const cookies = [
    `${IDENTITY_UID_COOKIE}=${encodeURIComponent(userId)}; ${base}`,
    `${IDENTITY_TOKEN_COOKIE}=${encodeURIComponent(token)}; ${base}`,
  ];
  const did = sanitizeDeviceId(deviceId);
  if (did) {
    cookies.push(`${DEVICE_ID_COOKIE}=${encodeURIComponent(did)}; ${base}`);
  }
  res.setHeader('Set-Cookie', cookies);
}

/** 仅读取 HttpOnly 设备 Cookie（不可用 body/localStorage 冒充恢复） */
function resolveDeviceIdFromCookieHeader(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader || '');
  return sanitizeDeviceId(cookies[DEVICE_ID_COOKIE]);
}

function resolveBodyDeviceId(req) {
  return sanitizeDeviceId(req.body?.deviceId);
}

function resolveIdentityFromCookies(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader);
  const userId = sanitizeClientId(cookies[IDENTITY_UID_COOKIE]);
  const token = String(cookies[IDENTITY_TOKEN_COOKIE] || '').trim();
  return verifyClientToken(userId, token);
}

function resolveIdentityFromRequest(req) {
  return resolveIdentityFromCookies(req.headers?.cookie || '');
}

function requireSessionIdentity(req, res) {
  const identity = req.apiIdentity || resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
    return null;
  }
  return identity;
}

function sendBootstrapResponse(res, userId, iat, token, deviceId = null) {
  setIdentityCookieHeaders(res, userId, token, deviceId);
  const runtime = getRuntimeConfig();
  const payload = {
    clientId: userId,
    features: {
      svipQualityEnabled: Boolean(runtime.svipQualityEnabled),
      sharedMembershipEnabled: Boolean(runtime.sharedMembershipEnabled),
    },
  };
  const requireRequestSign = res.req?.secure || !ALLOW_INSECURE_HTTP_API;
  if (isApiSignRequired() && requireRequestSign) {
    payload.apiSignKey = deriveApiSignKey(CLIENT_ID_SECRET, userId, iat);
  }
  return res.json(payload);
}

function proxyLimitKey(kind, req) {
  const identity = resolveIdentityFromRequest(req);
  return `${kind}:${getRequestIp(req)}:${identity?.userId || 'anon'}`;
}

/** 建立 HttpOnly 会话：身份凭证仅通过 Cookie 传递，不经 WebSocket 明文下发 */
app.post('/api/session/bootstrap', async (req, res) => {
  const requestIp = getRequestIp(req);
  if (!limitSessionBootstrap(`session:${requestIp}`)) {
    const code = SOFT_BLOCK_CODES.SESSION_BOOTSTRAP_LIMIT;
    appendAdminAudit('session_blocked', {
      reason: 'bootstrap_rate_limit',
      code,
    }, requestIp);
    setSoftBlockHeaders(res, code);
    return res.status(500).json(softBlockPayload(code));
  }
  const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  const bodyDeviceId = resolveBodyDeviceId(req);
  const now = Math.floor(Date.now() / 1000);

  const existing = resolveIdentityFromRequest(req);
  if (existing) {
    // 已认证：可用 body deviceId 对齐绑定；恢复路径不依赖 body
    const deviceId = cookieDeviceId || bodyDeviceId || createServerClientId();
    await linkDeviceToUser(deviceId, existing.userId);
    const shouldRenew = existing.expiresAt - now <= SESSION_RENEW_WITHIN_SEC;
    const signIat = shouldRenew ? now : existing.iat;
    const token = signClientId(existing.userId, signIat);
    return sendBootstrapResponse(res, existing.userId, signIat, token, deviceId);
  }

  // 无身份 Cookie：仅允许 HttpOnly openmusic_did 恢复同一 userId
  if (cookieDeviceId) {
    const boundUserId = await getUserIdForDevice(cookieDeviceId);
    if (boundUserId) {
      await linkDeviceToUser(cookieDeviceId, boundUserId);
      const signIat = now;
      return sendBootstrapResponse(
        res,
        boundUserId,
        signIat,
        signClientId(boundUserId, signIat),
        cookieDeviceId,
      );
    }
  }

  if (!limitNewSessionBootstrap(`session-new:${requestIp}`)) {
    const code = SOFT_BLOCK_CODES.SESSION_NEW_LIMIT;
    appendAdminAudit('session_blocked', {
      reason: 'new_session_rate_limit',
      code,
    }, requestIp);
    setSoftBlockHeaders(res, code);
    return res.status(500).json(softBlockPayload(code));
  }
  const userId = createServerClientId();
  const deviceId = cookieDeviceId || createServerClientId();
  await linkDeviceToUser(deviceId, userId);
  const signIat = now;
  return sendBootstrapResponse(res, userId, signIat, signClientId(userId, signIat), deviceId);
});

// ---------- Linux.do OAuth：房主身份绑定 / 找回 ----------
// 只影响“把当前浏览器身份绑定到一个 Linux.do 账号”这件事，不改变匿名创建/加入房间的既有流程；
// 不登录 Linux.do 完全不受影响。持久化只写 Redis（server/linuxdoAuth.js）。

app.get('/api/auth/linuxdo/status', async (req, res) => {
  const enabled = isLinuxdoConfigured();
  if (!enabled) return res.json({ enabled: false, bound: null });

  const identity = resolveIdentityFromRequest(req);
  const bound = identity?.userId ? await getLinuxdoProfileForUser(identity.userId) : null;
  res.json({ enabled: true, bound });
});

app.get('/api/auth/linuxdo/start', (req, res) => {
  if (!isLinuxdoConfigured()) return res.status(400).json({ error: 'Linux.do 登录未配置' });
  if (!limitLinuxdoAuth(`linuxdo-start:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const purpose = req.query?.purpose === 'recover' ? 'recover' : 'bind';
  const returnPath = sanitizeReturnPath(req.query?.returnPath);

  if (purpose === 'bind') {
    const identity = requireSessionIdentity(req, res);
    if (!identity) return;
    const roomId = String(req.query?.roomId || '').trim().toUpperCase();
    const room = roomId ? getRoomInternal(roomId) : null;
    if (!room || room.creatorId !== identity.userId) {
      return res.status(403).json({ error: '只有房主本人可以绑定 Linux.do 账号' });
    }
    const state = signLinuxdoState({ purpose: 'bind', userId: identity.userId, returnPath });
    return res.redirect(buildLinuxdoAuthorizeUrl(state));
  }

  // recover：此时大概率已不是原身份，不要求当前必须有身份
  const state = signLinuxdoState({ purpose: 'recover', returnPath });
  res.redirect(buildLinuxdoAuthorizeUrl(state));
});

app.get('/api/auth/linuxdo/callback', async (req, res) => {
  const fail = (returnPath, reason) => res.redirect(`${sanitizeReturnPath(returnPath)}?linuxdo=${reason}`);

  if (!isLinuxdoConfigured()) return fail('/', 'error');
  if (!limitLinuxdoAuth(`linuxdo-callback:${getRequestIp(req)}`)) {
    return res.status(429).send('请求过于频繁，请稍后再试');
  }

  const state = verifyLinuxdoState(req.query?.state);
  if (!state) return fail('/', 'error');
  const returnPath = sanitizeReturnPath(state.returnPath);

  let profile;
  try {
    const accessToken = await exchangeLinuxdoCode(req.query?.code);
    profile = await fetchLinuxdoProfile(accessToken);
  } catch (err) {
    console.error('Linux.do OAuth 失败:', err?.message || err);
    return fail(returnPath, 'error');
  }

  if (state.purpose === 'admin-bind' || state.purpose === 'admin-login') {
    // 后台绑定 / 后台登录复用同一个已注册的 redirect_uri，只能在这里按 purpose 转发
    return handleLinuxdoAdminCallback(req, res, state, profile);
  }

  if (state.purpose === 'bind') {
    // 二次核验：跳转期间房主可能已变化（转让 / 身份过期），不能只信 state
    const identity = resolveIdentityFromRequest(req);
    if (!identity?.userId || identity.userId !== state.userId) {
      return fail(returnPath, 'expired');
    }
    try {
      await bindLinuxdoToUser(profile.id, identity.userId, profile);
    } catch (err) {
      console.error('Linux.do 绑定写入失败:', err?.message || err);
      return fail(returnPath, 'error');
    }
    return fail(returnPath, 'bound');
  }

  // recover：查已绑定的 userId，重新签发身份 Cookie（不改变房间归属逻辑本身）
  const boundUserId = await getUserIdForLinuxdo(profile.id);
  if (!boundUserId) return fail(returnPath, 'notfound');

  const now = Math.floor(Date.now() / 1000);
  const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  const deviceId = cookieDeviceId || createServerClientId();
  await linkDeviceToUser(deviceId, boundUserId);
  setIdentityCookieHeaders(res, boundUserId, signClientId(boundUserId, now), deviceId);
  return fail(returnPath, 'recovered');
});

app.post('/api/auth/linuxdo/unbind', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  await unbindLinuxdoForUser(identity.userId);
  res.json({ success: true });
});

// ---------- GitHub OAuth：房主身份绑定 / 找回（与 Linux.do 完全对称的一套流程） ----------

app.get('/api/auth/github/status', async (req, res) => {
  const enabled = isGithubConfigured();
  if (!enabled) return res.json({ enabled: false, bound: null });

  const identity = resolveIdentityFromRequest(req);
  const bound = identity?.userId ? await getGithubProfileForUser(identity.userId) : null;
  res.json({ enabled: true, bound });
});

app.get('/api/auth/github/start', (req, res) => {
  if (!isGithubConfigured()) return res.status(400).json({ error: 'GitHub 登录未配置' });
  if (!limitGithubAuth(`github-start:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const purpose = req.query?.purpose === 'recover' ? 'recover' : 'bind';
  const returnPath = sanitizeGithubReturnPath(req.query?.returnPath);

  if (purpose === 'bind') {
    const identity = requireSessionIdentity(req, res);
    if (!identity) return;
    const roomId = String(req.query?.roomId || '').trim().toUpperCase();
    const room = roomId ? getRoomInternal(roomId) : null;
    if (!room || room.creatorId !== identity.userId) {
      return res.status(403).json({ error: '只有房主本人可以绑定 GitHub 账号' });
    }
    const state = signGithubState({ purpose: 'bind', userId: identity.userId, returnPath });
    return res.redirect(buildGithubAuthorizeUrl(state));
  }

  const state = signGithubState({ purpose: 'recover', returnPath });
  res.redirect(buildGithubAuthorizeUrl(state));
});

app.get('/api/auth/github/callback', async (req, res) => {
  const fail = (returnPath, reason) => res.redirect(`${sanitizeGithubReturnPath(returnPath)}?github=${reason}`);

  if (!isGithubConfigured()) return fail('/', 'error');
  if (!limitGithubAuth(`github-callback:${getRequestIp(req)}`)) {
    return res.status(429).send('请求过于频繁，请稍后再试');
  }

  const state = verifyGithubState(req.query?.state);
  if (!state) return fail('/', 'error');
  const returnPath = sanitizeGithubReturnPath(state.returnPath);

  let profile;
  try {
    const accessToken = await exchangeGithubCode(req.query?.code);
    profile = await fetchGithubProfile(accessToken);
  } catch (err) {
    console.error('GitHub OAuth 失败:', err?.message || err);
    return fail(returnPath, 'error');
  }

  if (state.purpose === 'admin-bind' || state.purpose === 'admin-login') {
    // 后台绑定 / 后台登录复用同一个已注册的 redirect_uri，只能在这里按 purpose 转发
    return handleGithubAdminCallback(req, res, state, profile);
  }

  if (state.purpose === 'bind') {
    const identity = resolveIdentityFromRequest(req);
    if (!identity?.userId || identity.userId !== state.userId) {
      return fail(returnPath, 'expired');
    }
    try {
      await bindGithubToUser(profile.id, identity.userId, profile);
    } catch (err) {
      console.error('GitHub 绑定写入失败:', err?.message || err);
      return fail(returnPath, 'error');
    }
    return fail(returnPath, 'bound');
  }

  const boundUserId = await getUserIdForGithub(profile.id);
  if (!boundUserId) return fail(returnPath, 'notfound');

  const now = Math.floor(Date.now() / 1000);
  const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  const deviceId = cookieDeviceId || createServerClientId();
  await linkDeviceToUser(deviceId, boundUserId);
  setIdentityCookieHeaders(res, boundUserId, signClientId(boundUserId, now), deviceId);
  return fail(returnPath, 'recovered');
});

app.post('/api/auth/github/unbind', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  await unbindGithubForUser(identity.userId);
  res.json({ success: true });
});

app.post('/api/error-reports', async (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }
  const ip = getRequestIp(req);
  if (!limitErrorReport(`error-report:${ip}:${identity.userId}`)) {
    return res.status(429).json({ error: '上报过于频繁，请稍后再试' });
  }

  const result = await createErrorReport({
    type: req.body?.type,
    description: req.body?.description,
    snapshot: req.body?.snapshot,
    snapshots: req.body?.snapshots,
    events: req.body?.events,
    meta: req.body?.meta,
    ip,
    userId: identity.userId,
  });
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true, report: result.report });
});

app.get('/api/error-reports/pending-solutions', async (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }
  const solutions = await listPendingSolutionsForUser(identity.userId);
  res.json({ solutions });
});

app.post('/api/error-reports/:id/ack-solution', async (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }
  const result = await ackErrorReportSolution(req.params.id, identity.userId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true });
});

app.get('/api/permanent-decisions/pending', async (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }
  const notices = await listPendingPermanentNoticesForUser(identity.userId);
  res.json({
    notices: notices.map((item) => ({
      id: item.id,
      roomId: item.roomId,
      roomName: item.roomName,
      approved: Boolean(item.approved),
      reason: item.reason || '',
      at: item.at,
    })),
  });
});

app.post('/api/permanent-decisions/:id/ack', async (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }
  const result = await ackPermanentDecisionNotice(req.params.id, identity.userId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true });
});

app.get('/api/rooms', async (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  res.json(await listRooms(identity?.userId || ''));
});

app.get('/api/rooms/random-match', (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  const room = findRandomMatchRoom(identity?.userId || '');
  if (!room) {
    return res.status(404).json({ error: '暂时没有可随机加入的公开房间' });
  }
  res.json(room);
});

app.post('/api/rooms', async (req, res) => {
  const createIp = getRequestIp(req);
  const createDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');

  if (isSiteBanned({ ip: createIp, deviceId: createDeviceId })) {
    // 不暴露封禁细节；拦截本身不写审计（高频重试无价值）
    const code = SOFT_BLOCK_CODES.SITE_BAN;
    res.setHeader('Cache-Control', 'no-store, no-cache, private, max-age=0');
    res.setHeader('X-OpenMusic-Site-Blocked', '1');
    setSoftBlockHeaders(res, code);
    return res.status(503).json(softBlockPayload(code));
  }

  const name = req.body?.name;
  const password = req.body?.password;
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }

  // 先复用空闲自建房，避免冷却把「再建一次」误拦成失败
  const idleOwned = findIdleOwnedRoom({
    creatorId: identity.userId,
    creatorDeviceId: createDeviceId,
  });
  if (idleOwned) {
    const reused = reuseIdleOwnedRoom(idleOwned.id, { name, password });
    if (reused?.error) {
      return res.status(400).json({ error: reused.error });
    }
    const room = reused || idleOwned;
    recordRoomCreate({
      ip: createIp,
      deviceId: createDeviceId,
      userId: identity.userId,
    });
    return res.json(room);
  }

  const cooldown = checkRoomCreateCooldown({
    ip: createIp,
    deviceId: createDeviceId,
    userId: identity.userId,
  });
  if (!cooldown.allowed) {
    const code = cooldown.code || SOFT_BLOCK_CODES.ROOM_CREATE_COOLDOWN;
    appendAdminAudit('room_create_blocked', {
      reason: 'cooldown',
      code,
      userId: identity.userId,
      deviceId: createDeviceId || '',
      retryAfterSec: cooldown.retryAfterSec || 0,
    }, createIp);
    setSoftBlockHeaders(res, code);
    const retryAfterSec = cooldown.retryAfterSec || 0;
    const message = code === SOFT_BLOCK_CODES.ROOM_CREATE_COOLDOWN_IP
      ? `刚刚已经创建过房间啦，请 ${retryAfterSec} 秒后再试～`
      : `你创建房间有点频繁啦，请 ${retryAfterSec} 秒后再试～`;
    return res.status(429).json({
      error: message,
      code,
      retryAfterSec,
    });
  }

  // 每人最多同时保留 N 个自建房（runtimeConfig.roomCreateMaxOwned；0 = 不限制）
  const maxOwned = Number(getRuntimeConfig().roomCreateMaxOwned) || 0;
  const ownedCount = countOwnedRooms({
    creatorId: identity.userId,
    creatorDeviceId: createDeviceId,
  });
  if (maxOwned > 0 && ownedCount >= maxOwned) {
    appendAdminAudit('room_create_blocked', {
      reason: 'max_owned_rooms',
      userId: identity.userId,
      deviceId: createDeviceId || '',
      ownedCount,
      maxOwnedRooms: maxOwned,
    }, createIp);
    return res.status(400).json({
      error: '你创建的房间有点多啦，先解散不用的房间，再回来开新的吧～',
    });
  }

  const room = createRoom({
    name,
    password,
    creatorId: identity.userId,
    creatorDeviceId: createDeviceId,
    creatorIp: createIp,
  });
  if (room?.error) {
    return res.status(400).json({ error: room.error });
  }

  recordRoomCreate({
    ip: createIp,
    deviceId: createDeviceId,
    userId: identity.userId,
  });

  res.json(room);
});

app.get('/api/rooms/:id', (req, res) => {
  const room = getRoomPublic(req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  res.json(room);
});

app.get('/api/chat/upload-config', (_req, res) => {
  res.json({ enabled: isQiniuConfigured() });
});

app.get('/api/chat/sticker-search-config', (_req, res) => {
  res.json({ enabled: isApihzStickerConfigured() });
});

app.get('/api/chat/ai-config', (_req, res) => {
  res.json(getPublicRoomAiConfig());
});

app.get('/api/chat/sticker-search', async (req, res) => {
  if (!isApihzStickerConfigured()) {
    return res.status(503).json({ error: '未配置表情包搜索' });
  }

  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('sticker-search', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const words = limitText(req.query.words, 32);
  const page = Math.max(1, Math.min(200, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 15));
  if (!words) {
    return res.status(400).json({ error: '请输入搜索关键词' });
  }

  try {
    const result = await searchApihzStickers(words, page, limit);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || '搜索失败' });
  }
});

app.post('/api/chat/upload-token', (req, res) => {
  if (!isQiniuConfigured()) {
    return res.status(503).json({ error: '图片上传未配置' });
  }

  if (!limitProxyRequest(`chat-upload:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const roomId = limitText(req.body?.roomId, 32);
  const ext = limitText(req.body?.ext, 8).toLowerCase();
  if (!roomId) {
    return res.status(400).json({ error: '房间无效' });
  }

  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '未登录' });
  }

  const room = getRoomInternal(roomId);
  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  if (!room.users.has(identity.userId)) {
    return res.status(403).json({ error: '未加入房间' });
  }

  if (room.muteAll || room.mutedUserIds?.has(identity.userId)) {
    return res.status(403).json({ error: room.muteAll ? '当前房间已全体禁言' : '你已被禁言' });
  }

  try {
    const tokenData = createChatImageUploadToken(roomId, ext);
    res.json(tokenData);
  } catch (err) {
    res.status(400).json({ error: err.message || '生成上传凭证失败' });
  }
});

function resolveAndroidApkPath() {
  const candidates = [
    path.join(__dirname, 'downloads/openmusic.apk'),
    path.join(clientDist, 'downloads/openmusic.apk'),
    path.join(clientDist, 'downloads/apk'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveIosIpaPath() {
  const candidates = [
    path.join(__dirname, 'downloads/openmusic.ipa'),
    path.join(clientDist, 'downloads/openmusic.ipa'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function sendAndroidApk(req, res) {
  const apkPath = resolveAndroidApkPath();
  if (!apkPath) {
    return res.status(404).type('text/plain; charset=utf-8').send(
      'APK 尚未部署。请将 GitHub Actions 构建的 app-debug.apk 上传到 server/downloads/openmusic.apk',
    );
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.download(apkPath, 'openmusic.apk');
}

function sendIosIpa(req, res) {
  const ipaPath = resolveIosIpaPath();
  if (!ipaPath) {
    return res.status(404).type('text/plain; charset=utf-8').send(
      'IPA 尚未部署。请将 GitHub Actions 构建的 openmusic.ipa 上传到 server/downloads/openmusic.ipa，并用 Sideloadly 安装。',
    );
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.download(ipaPath, 'openmusic.ipa');
}

app.get('/downloads/openmusic.apk', sendAndroidApk);
app.get('/downloads/openmusic.ipa', sendIosIpa);

mountWechatFileHelperProxy(app, fetchWithTimeout, {
  requireAuth: (req, res) => Boolean(requireSessionIdentity(req, res)),
  secureCookies: IS_PRODUCTION,
});

app.get('/robots.txt', (req, res) => {
  const runtime = getRuntimeConfig();
  const origin = resolveSiteOrigin(req, ALLOWED_ORIGINS, {
    canonicalEnv: runtime.seoCanonicalUrl || SITE_CANONICAL_URL,
  });
  res.type('text/plain; charset=utf-8').send(buildRobotsTxt(origin));
});

app.get('/sitemap.xml', (req, res) => {
  const runtime = getRuntimeConfig();
  const origin = resolveSiteOrigin(req, ALLOWED_ORIGINS, {
    canonicalEnv: runtime.seoCanonicalUrl || SITE_CANONICAL_URL,
  });
  res.type('application/xml; charset=utf-8').send(buildSitemapXml(origin));
});

function sendSpaIndexHtml(req, res, next, opts = {}) {
  const runtime = getRuntimeConfig();
  const origin = resolveSiteOrigin(req, ALLOWED_ORIGINS, {
    canonicalEnv: runtime.seoCanonicalUrl || SITE_CANONICAL_URL,
  });
  const html = readClientIndexHtml(clientDist, {
    baiduVerification: runtime.seoBaiduVerification,
    siteOrigin: origin,
  });
  if (!html) return next();
  if (opts.noindex) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  if (opts.status) {
    res.status(opts.status);
  }
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(html);
}

function isRoomOrTvPage(pathname) {
  return /^\/(?:room|tv)\/[^/]+\/?$/.test(pathname);
}

/** 启动时把后台已保存的百度验证码写进 dist，兼容 Nginx 静态直出 */
try {
  const bootRuntime = getRuntimeConfig();
  const bootOrigin = bootRuntime.seoCanonicalUrl || SITE_CANONICAL_URL || '';
  const patched = patchClientIndexHtml(clientDist, {
    baiduVerification: bootRuntime.seoBaiduVerification,
    siteOrigin: bootOrigin,
  });
  if (patched.ok && !patched.unchanged && bootRuntime.seoBaiduVerification) {
    console.log('[seo] baidu-site-verification written into client/dist/index.html');
  }
} catch (err) {
  console.warn('[seo] patch index.html skipped:', err?.message || err);
}

app.get(['/', '/index.html'], sendSpaIndexHtml);

// Node 直出时复用构建期预压缩文件，避免未经过 Nginx 的部署退化为原始大包传输。
app.use('/assets', (req, res, next) => {
  const relative = decodeURIComponent(req.path).replace(/^\/+/, '');
  if (!relative || relative.includes('..') || !/-[a-z0-9_-]{6,}\.(?:js|css|json|svg|map)$/i.test(relative)) {
    next();
    return;
  }
  const originalPath = path.join(clientDist, 'assets', relative);
  const acceptEncoding = String(req.headers['accept-encoding'] || '').toLowerCase();
  const candidates = acceptEncoding.includes('br')
    ? [[`${originalPath}.br`, 'br'], [`${originalPath}.gz`, 'gzip']]
    : acceptEncoding.includes('gzip')
      ? [[`${originalPath}.gz`, 'gzip']]
      : [];
  const selected = candidates.find(([filePath]) => fs.existsSync(filePath));
  if (!selected || !fs.existsSync(originalPath)) {
    next();
    return;
  }
  const [compressedPath, encoding] = selected;
  const contentType = relative.endsWith('.css')
    ? 'text/css; charset=utf-8'
    : relative.endsWith('.json')
      ? 'application/json; charset=utf-8'
      : relative.endsWith('.svg')
        ? 'image/svg+xml'
      : 'application/javascript; charset=utf-8';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Encoding', encoding);
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(compressedPath).on('error', next).pipe(res);
});

app.use(express.static(clientDist, {
  index: false,
  setHeaders(res, filePath) {
    const rel = path.relative(clientDist, filePath).replace(/\\/g, '/');
    if (rel === 'index.html') {
      // 入口页不长期缓存，确保发版后能拉到新资源
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }
    if (rel.startsWith('assets/')) {
      // 构建文件名带 hash，版本更新会生成新 URL，可安全长期缓存。
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    if (rel.startsWith('vendor/sonic-workshop/')) {
      // sandboxed iframe 使用 opaque origin 加载 ES module，精确允许 Origin: null。
      res.setHeader('Access-Control-Allow-Origin', 'null');
    }
    if (rel.startsWith('qface/') || rel.startsWith('vendor/')) {
      // QQ 表情几乎不变，浏览器长缓存 1 年
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api')
    || req.path.startsWith('/socket.io')
    || req.path.startsWith('/downloads/')
    || req.path.startsWith('/wx-proxy')
    || req.path.startsWith('/cgi-bin')
  ) {
    return next();
  }
  if (isRoomOrTvPage(req.path)) {
    return sendSpaIndexHtml(req, res, next, { noindex: true });
  }
  if (req.path === getAdminEntryPath()) {
    return sendSpaIndexHtml(req, res, next, { noindex: true });
  }
  sendSpaIndexHtml(req, res, next, { noindex: true, status: 404 });
});

const socketToRoom = new Map();
const socketToUserId = new Map();

({ handleLinuxdoAdminCallback, handleGithubAdminCallback } = mountAdminApi(app, {
  io,
  socketToRoom,
  socketToUserId,
  getClientIp: (req) => getClientIpFromHeaders(req.headers, req.socket?.remoteAddress || ''),
  allowedOrigins: ALLOWED_ORIGINS,
  broadcastRoomUpdate,
}));

function isPrivateHostname(hostname) {
  return isBlockedMediaHostname(hostname);
}

function getSocketUserId(socket) {
  return socketToUserId.get(socket.id) || null;
}

function getSocketRatePrincipal(socket) {
  const roomId = socketToRoom.get(socket.id);
  const socketUserId = getSocketUserId(socket);
  const roomUser = roomId && socketUserId
    ? getRoomInternal(roomId)?.users?.get(socketUserId)
    : null;
  const identity = roomUser?.readOnly
    ? null
    : resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
  return buildSocketRatePrincipal({
    userId: identity?.userId || '',
    ip: getClientIp(socket),
  });
}

async function consumeDistributedSocketRate(socket, scope, policy) {
  return distributedSocketRateLimiter.consume({
    scope,
    principal: getSocketRatePrincipal(socket),
    windowMs: policy.windowMs,
    max: policy.max,
  });
}

function getMusicAccountProviderName(room, ownerId) {
  const onlineNickname = String(room?.users?.get(ownerId)?.nickname || '').trim();
  const savedNickname = String(room?.userNicknames?.get(ownerId) || '').trim();
  return (onlineNickname || savedNickname || '房主').slice(0, 40);
}

function buildMusicAccountNote(room, ownerId) {
  const roomId = String(room?.id || '').trim().toUpperCase();
  const roomName = String(room?.name || '').trim().slice(0, 60) || roomId;
  const provider = getMusicAccountProviderName(room, ownerId);
  return `房间：${roomName}（${roomId}） / 提供人：${provider}`;
}

function rejectReadOnly(socket, callback) {
  const roomId = socketToRoom.get(socket.id);
  if (!roomId) {
    callback?.({ success: false, error: '未加入房间' });
    return true;
  }

  const userId = getSocketUserId(socket);
  if (!userId) {
    callback?.({ success: false, error: '会话无效，请刷新后重试' });
    return true;
  }

  if (!canUserMutate(roomId, userId)) {
    callback?.({ success: false, error: '只读端无法执行此操作' });
    return true;
  }

  return false;
}

function rejectRateLimited(socket, limiter, kind, callback) {
  if (!limiter(`${kind}:${socket.id}`)) {
    callback?.({ success: false, error: '操作过于频繁，请稍后再试' });
    return true;
  }
  return false;
}

function getViewerRoomPayload(socket, roomId) {
  return serializeRoomForViewer(roomId, getSocketUserId(socket));
}

function emitSystemChat(roomId, message) {
  if (!roomId || !message) return;
  io.to(roomId).emit('chat_message', message);
}

function roomAiSocketHelpers(roomId) {
  return {
    emitChat: (message) => {
      if (message) io.to(roomId).emit('chat_message', message);
    },
    emitSystem: (message) => emitSystemChat(roomId, message),
    broadcastRoom: () => broadcastRoomUpdate(roomId, { immediate: true }),
  };
}

/** 合并同房短时间内的多次 room_update，减轻人多时 O(N) 风暴 */
const ROOM_BROADCAST_DEBOUNCE_MS = 80;
const ROOM_BROADCAST_MAX_WAIT_MS = 220;
const pendingRoomBroadcasts = new Map();

function clearPendingRoomBroadcast(normalized) {
  const pending = pendingRoomBroadcasts.get(normalized);
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.maxTimer) clearTimeout(pending.maxTimer);
  pendingRoomBroadcasts.delete(normalized);
}

function flushRoomBroadcast(normalized) {
  const pending = pendingRoomBroadcasts.get(normalized);
  const excludeSocketIds = pending?.excludeSocketIds?.size
    ? [...pending.excludeSocketIds]
    : undefined;
  const presenceOnly = Boolean(pending?.presenceOnly);
  clearPendingRoomBroadcast(normalized);
  if (presenceOnly) {
    doBroadcastRoomPresence(normalized);
  } else {
    doBroadcastRoomUpdate(normalized, { excludeSocketIds });
  }
}

/**
 * @param {string} roomId
 * @param {{ immediate?: boolean }} [options]
 */
function broadcastRoomUpdate(roomId, options = {}) {
  const normalized = roomId?.toUpperCase();
  if (!normalized) return;

  if (options.immediate) {
    clearPendingRoomBroadcast(normalized);
    doBroadcastRoomUpdate(normalized, options);
    return;
  }

  let pending = pendingRoomBroadcasts.get(normalized);
  if (!pending) {
    pending = {
      timer: null,
      maxTimer: null,
      excludeSocketIds: new Set(),
      presenceOnly: Boolean(options.presenceOnly),
    };
    pendingRoomBroadcasts.set(normalized, pending);
    pending.maxTimer = setTimeout(() => flushRoomBroadcast(normalized), ROOM_BROADCAST_MAX_WAIT_MS);
  } else if (!options.presenceOnly) {
    // 同一合并窗口内只要出现一次完整更新，就升级为完整 room_update。
    pending.presenceOnly = false;
  }

  if (options.excludeSocketIds?.length) {
    for (const sid of options.excludeSocketIds) pending.excludeSocketIds.add(sid);
  }

  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => flushRoomBroadcast(normalized), ROOM_BROADCAST_DEBOUNCE_MS);
}

function broadcastRoomPresence(roomId) {
  broadcastRoomUpdate(roomId, { presenceOnly: true });
}

function doBroadcastRoomPresence(roomId) {
  const normalized = roomId?.toUpperCase();
  if (!normalized) return;
  const sockets = io.sockets.adapter.rooms.get(normalized);
  if (!sockets?.size) return;

  const prepared = prepareRoomPresence(normalized);
  if (!prepared) return;

  const personalized = [];
  const legacy = [];
  for (const sid of sockets) {
    const viewerId = socketToUserId.get(sid);
    const clientSocket = io.sockets.sockets.get(sid);
    if (clientSocket?.handshake?.auth?.presenceUpdates !== true) {
      legacy.push({ sid, viewerId });
      continue;
    }
    const payload = roomPresenceForViewer(prepared, viewerId);
    if (!payload) continue;
    if (payload.userNicknames != null) personalized.push({ sid, payload });
  }

  if (personalized.length + legacy.length < sockets.size) {
    let target = io.to(normalized);
    for (const entry of personalized) target = target.except(entry.sid);
    for (const entry of legacy) target = target.except(entry.sid);
    target.emit('presence_update', roomPresenceForViewer(prepared));
  }
  for (const entry of personalized) {
    io.to(entry.sid).emit('presence_update', entry.payload);
  }

  // 滚动发布或 CDN 缓存期间，旧客户端不认识 presence_update，继续给它完整快照。
  if (legacy.length > 0) {
    const full = prepareRoomBroadcast(normalized);
    for (const entry of legacy) {
      const payload = roomUpdateForViewer(full, entry.viewerId);
      if (payload) io.to(entry.sid).emit('room_update', payload);
    }
  }
}

function doBroadcastRoomUpdate(roomId, options = {}) {
  const normalized = roomId?.toUpperCase();
  if (!normalized) return;
  const sockets = io.sockets.adapter.rooms.get(normalized);
  if (!sockets?.size) return;

  const prepared = prepareRoomBroadcast(normalized);
  if (!prepared) return;

  const excludeSids = options.excludeSocketIds?.length
    ? new Set(options.excludeSocketIds)
    : null;

  const muteAll = Boolean(prepared.room.muteAll);
  const basePayload = {
    ...prepared.shared,
    chatMuted: muteAll,
  };

  const personalized = [];
  for (const sid of sockets) {
    if (excludeSids?.has(sid)) continue;
    const viewerId = socketToUserId.get(sid);
    const payload = roomUpdateForViewer(prepared, viewerId);
    if (!payload) continue;

    const needsPersonal = payload.chatMuted !== muteAll
      || payload.mutedUserIds != null
      || payload.userNicknames != null
      || payload.bannedSongs != null
      || payload.forbiddenWords != null;

    if (needsPersonal) {
      personalized.push({ sid, payload });
    }
  }

  // 绝大多数成员载荷一致：整房一次 emit，仅房主/管理员/被禁言者补一次私信
  if (personalized.length === 0) {
    let target = io.to(normalized);
    if (excludeSids) {
      for (const sid of excludeSids) target = target.except(sid);
    }
    target.emit('room_update', basePayload);
    return;
  }

  if (personalized.length >= sockets.size - (excludeSids?.size || 0)) {
    for (const entry of personalized) {
      io.to(entry.sid).emit('room_update', entry.payload);
    }
    return;
  }

  const personalSids = new Set(personalized.map((entry) => entry.sid));
  let target = io.to(normalized);
  for (const sid of personalSids) {
    target = target.except(sid);
  }
  if (excludeSids) {
    for (const sid of excludeSids) target = target.except(sid);
  }
  target.emit('room_update', basePayload);

  for (const entry of personalized) {
    io.to(entry.sid).emit('room_update', entry.payload);
  }
}

function broadcastPlaybackState(roomId) {
  const internal = getRoomInternal(roomId);
  if (!internal) return;
  const state = buildPlaybackState(internal);
  if (state) io.to(roomId).emit('playback_state', state);
}

setOnRoomPrefetchReady((roomId) => {
  broadcastRoomUpdate(roomId);
});

setOnRoomStructureChanged((roomId) => {
  broadcastRoomUpdate(roomId, { immediate: true });
  broadcastPlaybackState(roomId);
});

function emitRoomAndPlayback(roomId, room) {
  // 切歌/队列结构变化：立即下发完整 room + playback
  broadcastRoomUpdate(roomId, { immediate: true });
  broadcastPlaybackState(roomId);

  if (room?.randomLoading && !room.current) {
    ensurePlayback(roomId).then((nextRoom) => {
      if (!nextRoom) return;
      if (nextRoom.current) {
        emitRoomAndPlayback(roomId, nextRoom);
        return;
      }
      broadcastRoomUpdate(roomId, { immediate: true });
      broadcastPlaybackState(roomId);
    }).catch((err) => {
      console.error('Ensure playback after loading state failed:', err.message);
    });
  }
}

/** 房间音源账号变更后，空房间需要立即重新尝试私人漫游。 */
function refreshRoomPlaybackAfterMusicAccountChange(roomId) {
  const internal = getRoomInternal(roomId);
  if (!internal || internal.current || internal.queue.length > 0) return;
  if (internal.neteaseFmMode === 'OFF') return;

  void ensurePlayback(roomId).then((nextRoom) => {
    if (nextRoom) emitRoomAndPlayback(roomId, nextRoom);
  }).catch((err) => {
    console.error('Ensure playback after music account change failed:', err?.message || err);
  });
}

/** 仅播放时钟变化（暂停/播放/seek）：只推 playback_state，避免全量 users+queue 风暴 */
function emitPlaybackOnly(roomId) {
  broadcastPlaybackState(roomId);
}

/**
 * 合并同房短时间内的多次 queue_snapshot（点赞/踩/拖动排序等高频操作），
 * 避免每次点击都对全房扇出完整队列。取最后一次快照即可（队列是幂等全量）。
 */
const QUEUE_SNAPSHOT_DEBOUNCE_MS = 60;
const pendingQueueSnapshots = new Map();

function emitQueueSnapshot(roomId) {
  const normalized = roomId?.toUpperCase();
  if (!normalized) return;
  if (pendingQueueSnapshots.has(normalized)) return;

  const timer = setTimeout(() => {
    pendingQueueSnapshots.delete(normalized);
    const internal = getRoomInternal(normalized);
    if (!internal) return;
    const sockets = io.sockets.adapter.rooms.get(normalized);
    if (!sockets?.size) return;
    const snapshot = buildQueueSnapshot(internal);
    if (snapshot) io.to(normalized).emit('queue_snapshot', snapshot);
  }, QUEUE_SNAPSHOT_DEBOUNCE_MS);

  pendingQueueSnapshots.set(normalized, timer);
}

async function advanceEndedRoomNow(roomId, expectedQueueId = '') {
  const internal = getRoomInternal(roomId);
  if (!internal?.current || !internal.isPlaying) return null;
  if (expectedQueueId && internal.current.queueId !== expectedQueueId) return null;

  const beforeQueueId = internal.current.queueId;
  const beforePosition = getPlaybackTime(internal);
  // 禁止客户端 force：否则任意成员可凭 queueId 跳过「是否播完」检查强制切歌
  const advanced = await advancePlaybackIfEnded(roomId, {
    force: false,
    expectedQueueId,
  });
  if (!advanced) return null;

  // 单曲循环重播时 queueId 不变，但仍需下发 playback_state（回到曲首）
  const sameTrackRestart = advanced.current?.queueId === beforeQueueId;
  if (sameTrackRestart) {
    const afterPosition = getPlaybackTime(getRoomInternal(roomId) || internal);
    if (afterPosition > 2) return null;
  }

  emitRoomAndPlayback(roomId, advanced);
  console.log(sameTrackRestart ? 'playback loop-one restarted' : 'playback auto advanced', {
    roomId,
    from: beforeQueueId,
    at: beforePosition.toFixed(2),
    to: advanced.current?.queueId || 'loading',
  });
  return advanced;
}

io.on('connection', (socket) => {
  hardenSocketHandlers(socket);

  socket.use(async (packet, next) => {
    const event = String(packet?.[0] || '');
    const policy = getSocketEventRatePolicy(event);
    if (!policy) {
      next();
      return;
    }
    try {
      const result = await consumeDistributedSocketRate(socket, `event:${event}`, policy);
      if (result.allowed) {
        next();
        return;
      }
      incrementMetric('socket_rate_limit_rejected_total', { event });
      const callback = typeof packet[packet.length - 1] === 'function'
        ? packet[packet.length - 1]
        : null;
      callback?.({ success: false, error: '操作过于频繁，请稍后再试' });
    } catch (error) {
      // 限流器自身异常不能破坏房间基础功能；实现内部已优先使用内存兜底。
      socketRateLog.error('middleware_failed_open', { event, error });
      next();
    }
  });

  // 建连即拦：避免被封用户反复 join_room 刷审计 / 占连接
  {
    const joinProbeIp = getClientIp(socket);
    const deviceId = resolveDeviceIdFromCookieHeader(socket.handshake?.headers?.cookie || '');
    const siteBan = isSiteBanned({ ip: joinProbeIp, deviceId });
    if (siteBan) {
      const code = SOFT_BLOCK_CODES.SITE_BAN;
      socket.emit('kicked', {
        message: softBlockMessage(code),
        code,
        stopReconnect: true,
      });
      socket.disconnect(true);
      return;
    }
  }

  socket.on('join_room', async ({
    roomId,
    nickname,
    password,
    readOnly,
    rejoin,
    clientIp: reportedClientIp,
    clientLocation,
  } = {}, callback) => {
    const id = roomId?.toUpperCase();
    if (!roomExists(id)) {
      callback?.({ success: false, error: '房间不存在' });
      return;
    }

    const ip = getClientIp(socket);
    if (!limitJoinAttempt(`join:${ip}:${id}`)) {
      callback?.({ success: false, error: '尝试过于频繁，请稍后再试' });
      return;
    }

    const cookieIdentity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    const userId = Boolean(readOnly)
      ? createServerClientId()
      : (cookieIdentity?.userId || createServerClientId());

    if (!readOnly && !cookieIdentity) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试', needsSession: true });
      return;
    }

    const deviceId = resolveDeviceIdFromCookieHeader(socket.handshake?.headers?.cookie || '');

    // 站点封禁优先：踢出并断开，阻止客户端无限重连刷日志
    const joinProbeIp = getClientIp(socket);
    const siteBan = isSiteBanned({ ip: joinProbeIp, deviceId });
    if (siteBan) {
      const code = SOFT_BLOCK_CODES.SITE_BAN;
      const message = softBlockMessage(code);
      callback?.({ success: false, error: message, code });
      socket.emit('kicked', { message, code, stopReconnect: true });
      socket.disconnect(true);
      return;
    }

    // TV/只读进房使用临时 userId，不可走设备绑定恢复房主（否则会把 creatorId 偷给电视机）。
    const auth = await verifyRoomPassword(id, password, {
      clientId: userId,
      deviceId: readOnly ? null : deviceId,
      readOnly: Boolean(readOnly),
    });
    if (!auth.ok) {
      if (!limitJoinPasswordFail(`joinfail:${ip}:${id}`)) {
        callback?.({ success: false, error: '尝试过于频繁，请稍后再试' });
        return;
      }
      callback?.({ success: false, error: auth.error, needsPassword: auth.needsPassword });
      return;
    }

    const joinRoomInternal = getRoomInternal(id);
    if (joinRoomInternal && isAccessBanned(joinRoomInternal, userId, deviceId)) {
      callback?.({ success: false, error: '你已被移出该房间，无法再次进入' });
      return;
    }

    if (deviceId && !Boolean(readOnly)) {
      void linkDeviceToUser(deviceId, userId);
    }

    const prevRoomId = socketToRoom.get(socket.id);
    const prevUserId = getSocketUserId(socket);
    if (prevRoomId && prevRoomId !== id && prevUserId) {
      socket.leave(prevRoomId);
      const prevResult = removeUser(prevRoomId, prevUserId, socket.id);
      if (prevResult?.userRemoved && !prevResult.empty) {
        broadcastRoomPresence(prevRoomId);
      }
    } else if (prevRoomId && prevRoomId !== id) {
      socket.leave(prevRoomId);
    }

    // 同一连接再次加入同一房间，但解析出的用户身份不同（如身份令牌尚未持久化、
    // 快速重连或 StrictMode 重复挂载）：先移除旧的占位用户，避免一个浏览器出现多个用户。
    if (prevRoomId === id && prevUserId && prevUserId !== userId) {
      removeUser(id, prevUserId, socket.id);
    }

    const joinInternalBefore = getRoomInternal(id);
    const priorUser = joinInternalBefore?.users?.get(userId);
    const hadActiveSession = Boolean(
      priorUser && (
        (Array.isArray(priorUser.connectionIds) && priorUser.connectionIds.length > 0)
        || priorUser.connectionId
      ),
    );
    // addUser 会写入 knownUserIds，须在进房前判断「是否旧成员」
    const wasKnown = wasKnownRoomUser(joinInternalBefore, userId);
    const muteJoinAnnouncements = shouldMuteJoinAnnouncements(joinInternalBefore, userId, {
      hadActiveSession,
      rejoin: Boolean(rejoin),
      wasKnown,
    });

    // 展示网络信息使用前端公网查询结果；首次有效值按 userId + deviceId 固定，后续 payload 不可覆盖。
    const boundClientNetwork = await resolveBoundClientNetwork({ userId, deviceId }, {
      ip: reportedClientIp,
      location: clientLocation,
    });
    const clientIp = boundClientNetwork.ip || getClientIp(socket);
    const location = boundClientNetwork.location || fallbackLocationForIp(clientIp);
    const joinedRoom = addUser(id, userId, nickname, {
      readOnly: Boolean(readOnly),
      connectionId: socket.id,
      location,
      // 只读会话不绑定设备，避免后续路径误用本机 deviceId 恢复/改写房主
      deviceId: readOnly ? undefined : (deviceId || undefined),
      clientIp: clientIp || undefined,
    });
    if (!joinedRoom) {
      callback?.({ success: false, error: '加入房间失败' });
      return;
    }
    if (joinedRoom.error) {
      callback?.({ success: false, error: joinedRoom.error });
      return;
    }

    socketToRoom.set(socket.id, id);
    socketToUserId.set(socket.id, userId);
    socket.join(id);

    const welcomeMessage = muteJoinAnnouncements ? null : postMemberWelcomeMessage(id, userId);
    const joinNoticeMessage = muteJoinAnnouncements ? null : postJoinNoticeMessage(id, userId);

    // 无当前歌曲且队列为空时，加入后会异步拉取随机歌曲，先告知客户端"加载中"，
    // 避免播放条在随机歌曲到达前直接消失。
    const loadingRoom = markRandomLoading(id);
    const roomPayload = loadingRoom || joinedRoom;
    const chatHistory = getChatHistoryForUser(id, userId, { limit: INITIAL_CHAT_LIMIT });
    const joinInternal = getRoomInternal(id);
    const playbackState = joinInternal ? buildPlaybackState(joinInternal) : null;

    const joinUser = joinInternal?.users.get(userId);
    // 先 ACK 再广播：人数多时 O(N) 序列化/推送不应阻塞进房方超时
    callback?.({
      success: true,
      room: serializeRoomForViewer(id, userId) || roomPayload,
      messages: chatHistory.messages || [],
      chatHasMore: Boolean(chatHistory.hasMore),
      playbackState,
      roomAi: getPublicRoomAiConfig(getRuntimeConfig(), joinInternal),
      socketId: userId,
      connectionId: socket.id,
      nickname: joinUser?.nickname
        || roomPayload.users?.find((user) => user.id === userId)?.nickname
        || String(nickname || '').trim(),
      // 不在 ACK 中下发 isOwner/isAdmin/canControl 等特权布尔值：
      // 角色仅由服务端鉴权 + 客户端用 room.creatorId/adminIds 与自身 socketId 比对展示 UI
    });

    setImmediate(() => {
      // 进房仅广播在线成员与角色，避免人数增长时重复推送 40KB+ 完整房间快照。
      broadcastRoomPresence(id);
      // presence_update 省略 location，需单独补发新成员的归属地给房内其他人，
      // 否则他们要等自己退出重进才能看到（进房 ACK 才带全量 location）
      if (location) {
        socket.to(id).emit('user_location', { userId, location });
      }
      if (welcomeMessage) {
        // 含进房者本人：全员都能收到迎宾，前端再放礼花
        io.to(id).emit('chat_message', welcomeMessage);
      }
      if (joinNoticeMessage) {
        socket.to(id).emit('chat_message', joinNoticeMessage);
      }
      // 若管理员已给出解决方案且用户尚未确认，进房时补推弹窗
      if (!readOnly && userId) {
        void listPendingSolutionsForUser(userId).then((solutions) => {
          for (const notice of solutions) {
            socket.emit('error_report_solution', notice);
          }
        }).catch(() => {});
        void listPendingPermanentNoticesForUser(userId).then((notices) => {
          for (const notice of notices) {
            socket.emit('room_permanent_decision', {
              id: notice.id,
              roomId: notice.roomId,
              roomName: notice.roomName,
              approved: Boolean(notice.approved),
              reason: notice.reason || '',
              at: notice.at,
            });
          }
        }).catch(() => {});
      }
    });

    ensurePlayback(id).then((room) => {
      if (room) emitRoomAndPlayback(id, room);
    }).catch((err) => {
      console.error('Ensure playback after join failed:', err.message);
    });
  });

  socket.on('rename_user', ({ nickname }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'rename', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const userId = getSocketUserId(socket);
    const result = renameUser(roomId, userId, nickname);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_user_avatar', ({ avatar_url }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'avatar', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const userId = getSocketUserId(socket);
    const result = setUserAvatar(roomId, userId, avatar_url);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('ack_error_report_solution', async ({ id } = {}, callback) => {
    const userId = getSocketUserId(socket)
      || resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '')?.userId;
    if (!userId) {
      callback?.({ success: false, error: '会话无效' });
      return;
    }
    const result = await ackErrorReportSolution(id, userId);
    callback?.(result.success ? { success: true } : { success: false, error: result.error });
  });

  socket.on('rename_room', ({ name }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'rename_room', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = renameRoom(roomId, getSocketUserId(socket), name, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_lock', ({ locked, password }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_lock', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomLock(roomId, getSocketUserId(socket), { locked, password }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('apply_room_permanent', async ({ note } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'apply_room_permanent', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await requestRoomPermanent(
      roomId,
      getSocketUserId(socket),
      socket.id,
      note,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({
      success: true,
      room: getViewerRoomPayload(socket, roomId),
      application: result.application,
    });
  });

  socket.on('cancel_room_permanent', async (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'cancel_room_permanent', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await cancelRoomPermanentRequest(
      roomId,
      getSocketUserId(socket),
      socket.id,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('ack_room_permanent_decision', async ({ id } = {}, callback) => {
    const userId = getSocketUserId(socket);
    if (!userId) {
      callback?.({ success: false, error: '会话无效' });
      return;
    }
    const result = await ackPermanentDecisionNotice(id, userId);
    if (!result.success) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true });
  });

  socket.on('set_room_fm_mode', async ({ mode, source } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_fm_mode', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    if (source === 'qishui') {
      const room = getRoomInternal(roomId);
      const roomCookie = String(room?.musicAccountSecrets?.qishui || '').trim();
      if (!roomCookie) {
        const capability = await hasMetingVipAccount('qishui');
        if (!capability.ok || !capability.hasVip) {
          callback?.({ success: false, error: '当前没有可用的汽水账号，请先绑定房间汽水账号或等待服务器提供汽水会员账号' });
          return;
        }
      }
    }

    const result = setRoomFmMode(roomId, getSocketUserId(socket), mode, socket.id, source);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  /** 房主：创建网易/QQ 扫码会话（Cookie 最终写入 Meting） */
  socket.on('music_account_qr_create', async ({ platform } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'music_account_qr_create', callback)) return;
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }
    const room = getRoomInternal(roomId);
    if (!room || room.creatorId !== getSocketUserId(socket)) {
      callback?.({ success: false, error: '仅房主可绑定音源账号' });
      return;
    }
    const result = await createManagedMusicQrSession({
      ownerId: getSocketUserId(socket),
      roomId,
      platform,
      purpose: 'room',
    });
    if (!result.ok) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, data: result.data });
  });

  socket.on('music_account_qr_check', async (payload = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'music_account_qr_check', callback)) return;
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }
    const room = getRoomInternal(roomId);
    if (!room || room.creatorId !== getSocketUserId(socket)) {
      callback?.({ success: false, error: '仅房主可绑定音源账号' });
      return;
    }
    const context = {
      sessionId: limitText(payload?.sessionId, 128),
      ownerId: getSocketUserId(socket),
      roomId,
      purpose: 'room',
    };
    const result = await checkManagedMusicQrSession(context);
    if (!result.ok) {
      await releaseManagedMusicQrCredential(context);
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, data: result.data });
  });

  /** 扫码成功后绑定：VIP→Meting；无 VIP 网易→仅本地漫游 */
  socket.on('music_account_bind', async ({ sessionId, shared } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'music_account_bind', callback)) return;
    if (shared && !getRuntimeConfig().sharedMembershipEnabled) {
      callback?.({ success: false, error: '共享会员功能当前已关闭' });
      return;
    }
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }
    const room = getRoomInternal(roomId);
    if (!room || room.creatorId !== getSocketUserId(socket)) {
      callback?.({ success: false, error: '仅房主可绑定音源账号' });
      return;
    }
    const ownerId = getSocketUserId(socket);
    const context = {
      sessionId: limitText(sessionId, 128),
      ownerId,
      roomId,
      purpose: 'room',
    };
    const credential = await getManagedMusicQrCredential(context);
    if (!credential.ok) {
      callback?.({ success: false, error: credential.error });
      return;
    }
    if (!hasRoomCredentialEncryptionKey()) {
      await releaseManagedMusicQrCredential(context);
      callback?.({ success: false, error: '服务端未配置 ROOM_CREDENTIAL_ENCRYPTION_KEY，暂不能保存房间账号' });
      return;
    }
    try {
      const result = await bindRoomMusicAccount({
        roomId,
        platform: credential.platform,
        cookie: credential.cookie,
        shared: Boolean(shared),
        note: buildMusicAccountNote(room, ownerId),
        providerName: getMusicAccountProviderName(room, ownerId),
      });
      if (!result.ok) {
        await releaseManagedMusicQrCredential(context);
        callback?.({ success: false, error: result.error });
        return;
      }
      const plat = credential.platform;
      patchRoomMusicAccountCache(roomId, plat, result.data, {
        localCookie: result.cookie || credential.cookie,
      });
      broadcastRoomUpdate(roomId);
      refreshRoomPlaybackAfterMusicAccountChange(roomId);
      await finalizeManagedMusicQrCredential(context);
      callback?.({
        success: true,
        account: result.data,
        message: result.message,
        room: getViewerRoomPayload(socket, roomId),
      });
    } catch (err) {
      await releaseManagedMusicQrCredential(context);
      console.error('[Music Account] 房间账号绑定失败:', err?.message || err);
      callback?.({ success: false, error: err?.message || '房间账号绑定失败，请稍后重试' });
    }
  });

  socket.on('music_account_list', async (_payload, callback) => {
    if (rejectRateLimited(socket, limitSocketAction, 'music_account_list', callback)) return;
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }
    const room = getRoomInternal(roomId);
    if (!room || room.creatorId !== getSocketUserId(socket)) {
      callback?.({ success: false, error: '仅房主可查看音源账号' });
      return;
    }
    let localAccounts = room.musicAccounts || { netease: null, tencent: null, qishui: null };
    const credentials = await fetchRoomMusicAccountCredentials(roomId);
    if (credentials.ok) {
      for (const plat of ['netease', 'tencent', 'qishui']) {
        const migrated = credentials.data?.[plat];
        if (!migrated?.cookie) continue;
        patchRoomMusicAccountCache(
          roomId,
          plat,
          migrated.account || localAccounts[plat],
          { localCookie: migrated.cookie },
        );
      }
      localAccounts = getRoomInternal(roomId)?.musicAccounts || localAccounts;
    }
    const result = await fetchRoomMusicAccounts(roomId);
    if (!result.ok) {
      callback?.({ success: true, data: localAccounts });
      return;
    }
    // Meting 只返回已共享账号；未共享账号以房间本地缓存为准。
    const merged = {
      netease: result.data.netease || localAccounts.netease || null,
      tencent: result.data.tencent || localAccounts.tencent || null,
      qishui: result.data.qishui || localAccounts.qishui || null,
    };
    setRoomMusicAccountsCache(roomId, merged);
    broadcastRoomUpdate(roomId);
    callback?.({ success: true, data: merged, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('music_account_set_shared', async ({ platform, shared } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'music_account_set_shared', callback)) return;
    if (shared && !getRuntimeConfig().sharedMembershipEnabled) {
      callback?.({ success: false, error: '共享会员功能当前已关闭' });
      return;
    }
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }
    const room = getRoomInternal(roomId);
    if (!room || room.creatorId !== getSocketUserId(socket)) {
      callback?.({ success: false, error: '仅房主可设置共享' });
      return;
    }
    const plat = platform === 'tencent' ? 'tencent' : platform === 'qishui' ? 'qishui' : 'netease';
    const current = room.musicAccounts?.[plat];
    if (current && !current.hasVip) {
      callback?.({ success: false, error: '这个账号目前是漫游专用，不能加入共享池；留在当前房间里听歌还是可以的哦～' });
      return;
    }
    const credential = getRoomMusicAccountCookie(roomId, plat);
    if (shared && !credential) {
      callback?.({ success: false, error: '房间未保存该账号凭证，请重新扫码' });
      return;
    }
    const result = await setRoomMusicAccountShared(
      roomId,
      platform,
      Boolean(shared),
      credential || '',
      buildMusicAccountNote(room, getSocketUserId(socket)),
      getMusicAccountProviderName(room, getSocketUserId(socket)),
    );
    if (!result.ok) {
      callback?.({ success: false, error: result.error });
      return;
    }
    const nextAccount = shared
      ? result.data
      : current
        ? {
            ...current,
            cookieId: `local-${roomId}-${plat}`,
            shared: false,
            updatedAt: Date.now(),
          }
        : null;
    patchRoomMusicAccountCache(roomId, plat, nextAccount, {
      localCookie: credential || null,
    });
    broadcastRoomUpdate(roomId);
    refreshRoomPlaybackAfterMusicAccountChange(roomId);
    callback?.({
      success: true,
      account: nextAccount,
      room: getViewerRoomPayload(socket, roomId),
    });
  });

  socket.on('music_account_unbind', async ({ platform } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'music_account_unbind', callback)) return;
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }
    const room = getRoomInternal(roomId);
    if (!room || room.creatorId !== getSocketUserId(socket)) {
      callback?.({ success: false, error: '仅房主可解绑音源账号' });
      return;
    }
    const plat = platform === 'tencent' ? 'tencent' : platform === 'qishui' ? 'qishui' : 'netease';
    const current = room.musicAccounts?.[plat];
    if (current?.hasVip || plat === 'tencent' || plat === 'qishui') {
      const result = await unbindRoomMusicAccount(roomId, platform);
      if (!result.ok) {
        callback?.({ success: false, error: result.error });
        return;
      }
    }
    patchRoomMusicAccountCache(roomId, plat, null, { localCookie: null });
    broadcastRoomUpdate(roomId);
    refreshRoomPlaybackAfterMusicAccountChange(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_play_mode', ({ mode }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_play_mode', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomPlayMode(roomId, getSocketUserId(socket), mode, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_announcement', ({ enabled, text }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_announcement', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomAnnouncement(roomId, getSocketUserId(socket), { enabled, text }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_custom_cover', ({ coverUrl }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_custom_cover', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomCustomCover(roomId, getSocketUserId(socket), coverUrl, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_chat_history', ({ enabled }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_chat_history', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setChatHistoryVisibleOnJoin(
      roomId,
      getSocketUserId(socket),
      enabled,
      socket.id,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_chat_avatars', ({ enabled } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_chat_avatars', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setChatShowAvatars(
      roomId,
      getSocketUserId(socket),
      enabled,
      socket.id,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_join_notice', ({ enabled, cooldownSec } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_join_notice', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomJoinNotice(
      roomId,
      getSocketUserId(socket),
      { enabled, cooldownSec },
      socket.id,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_ai_settings', ({ enabled, botName } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_ai_settings', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomAiSettings(
      roomId,
      getSocketUserId(socket),
      { enabled, botName },
      socket.id,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    const room = getRoomInternal(roomId);
    const roomAi = getPublicRoomAiConfig(getRuntimeConfig(), room);
    io.to(roomId).emit('room_ai_update', roomAi);
    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId), roomAi });
  });

  socket.on('set_room_playback_rate', ({ playbackRate } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_playback_rate', callback)) return;
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) { callback?.({ success: false, error: '未加入房间' }); return; }
    const result = setRoomPlaybackRate(roomId, getSocketUserId(socket), playbackRate, socket.id);
    if (result.error) { callback?.({ success: false, error: result.error }); return; }
    emitPlaybackOnly(roomId);
    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId), playbackRate: result.playbackRate });
  });

  socket.on('set_room_max_admins', ({ maxAdmins } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_max_admins', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomMaxAdmins(roomId, getSocketUserId(socket), maxAdmins, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId), maxAdmins: result.maxAdmins });
  });

  socket.on('set_room_song_request', ({ enabled, minStaySec, maxPerUser, cooldownSec, queueMaxLength, memberJumpEnabled, memberSeekEnabled, memberPauseEnabled, systemMediaPlayBound, systemMediaSkipBound, dislikeSkipMode, dislikeSkipThreshold, dislikeSkipPercent, clearSongsOnLeaveEnabled, clearSongsOnLeaveDelaySec }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_song_request', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setSongRequestEnabled(roomId, getSocketUserId(socket), {
      enabled,
      minStaySec,
      maxPerUser,
      cooldownSec,
      queueMaxLength,
      memberJumpEnabled,
      memberSeekEnabled,
      memberPauseEnabled,
      systemMediaPlayBound,
      systemMediaSkipBound,
      dislikeSkipMode,
      dislikeSkipThreshold,
      dislikeSkipPercent,
      clearSongsOnLeaveEnabled,
      clearSongsOnLeaveDelaySec,
    }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('ban_room_song', ({ song }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'ban_room_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = banRoomSong(roomId, getSocketUserId(socket), song, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('unban_room_song', ({ name }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'unban_room_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = unbanRoomSong(roomId, getSocketUserId(socket), name, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('add_room_forbidden_word', ({ word }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'add_room_forbidden_word', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = addRoomForbiddenWord(roomId, getSocketUserId(socket), word, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('remove_room_forbidden_word', ({ word }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'remove_room_forbidden_word', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = removeRoomForbiddenWord(roomId, getSocketUserId(socket), word, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_member_tier', ({ userId, tier }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_member_tier', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomMemberTier(roomId, getSocketUserId(socket), userId, tier, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('remove_room_member_tier', ({ userId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'remove_room_member_tier', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = removeRoomMemberTier(roomId, getSocketUserId(socket), userId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_member_settings', (settings, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_member_settings', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomMemberSettings(roomId, getSocketUserId(socket), settings, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_chat_mute', ({ muteAll, userId, muted }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_chat_mute', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setChatMute(roomId, getSocketUserId(socket), { muteAll, userId, muted }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('kick_user', async ({ userId: targetUserId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'kick_user', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const actorId = getSocketUserId(socket);
    const result = await kickUser(roomId, actorId, targetUserId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);

    for (const [sid, rid] of socketToRoom.entries()) {
      if (rid !== roomId || socketToUserId.get(sid) !== targetUserId) continue;
      const kickedSocket = io.sockets.sockets.get(sid);
      socketToRoom.delete(sid);
      socketToUserId.delete(sid);
      kickedSocket?.leave(roomId);
      kickedSocket?.emit('kicked', {
        message: '你已被房主移出房间，无法再次进入',
      });
    }

    callback?.({
      success: true,
      room: getViewerRoomPayload(socket, roomId),
      message: `已移出「${result.kickedNickname}」，该用户将无法再次进入本房间`,
    });
  });

  socket.on('transfer_owner', ({ userId: targetUserId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'transfer_owner', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const actorId = getSocketUserId(socket);
    const result = transferOwner(roomId, actorId, targetUserId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId), message: result.message });
  });

  socket.on('destroy_room', (_payload, callback) => {
    // 故意忽略客户端 payload（不可信）：房间仅以本连接已加入的 room 为准
    if (rejectReadOnly(socket, callback)) return;

    const roomId = socketToRoom.get(socket.id);
    const actorId = getSocketUserId(socket);
    const clientIp = getClientIp(socket);
    const deny = (error, detail = {}) => {
      appendAdminAudit('owner_destroy_room_denied', {
        roomId: roomId || '',
        userId: actorId || '',
        error,
        ...detail,
      }, clientIp);
      callback?.({ success: false, error });
    };

    // 三重限流：连接 / 用户 / IP，任一触顶即拒
    if (
      !limitOwnerDestroyRoom(`destroy:sid:${socket.id}`)
      || (actorId && !limitOwnerDestroyRoom(`destroy:uid:${actorId}`))
      || (clientIp && !limitOwnerDestroyRoom(`destroy:ip:${clientIp}`))
    ) {
      deny('操作过于频繁，请稍后再试', { reason: 'rate_limit' });
      return;
    }

    if (!roomId) {
      deny('未加入房间');
      return;
    }
    if (!actorId) {
      deny('会话无效，请刷新后重试', { reason: 'no_actor' });
      return;
    }

    // Cookie 会话必须与进房绑定的 userId 一致，防止仅污染 socket 映射提权
    const cookieIdentity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!cookieIdentity?.userId || cookieIdentity.userId !== actorId) {
      deny('会话无效，请刷新后重试', { reason: 'cookie_mismatch' });
      return;
    }

    // 房主身份 + 本连接属于房主（与转让房主等同级）
    const auth = assertOwnerCanDestroyRoom(roomId, actorId, socket.id);
    if (!auth.ok) {
      deny(auth.error || '仅房主可解散房间', { reason: 'not_owner' });
      return;
    }

    // 再读一次映射，防止鉴权与执行之间被换房
    if (socketToRoom.get(socket.id) !== auth.roomId || getSocketUserId(socket) !== actorId) {
      deny('会话已变更，请重试', { reason: 'session_race' });
      return;
    }

    const sidsToKick = [];
    for (const [sid, rid] of socketToRoom.entries()) {
      if (rid === auth.roomId) sidsToKick.push(sid);
    }

    const result = adminDestroyRoom(auth.roomId);
    if (!result.success) {
      deny(result.error || '解散失败', { reason: 'destroy_failed' });
      return;
    }

    callback?.({ success: true, message: '房间已解散' });

    for (const sid of sidsToKick) {
      const s = io.sockets.sockets.get(sid);
      socketToRoom.delete(sid);
      socketToUserId.delete(sid);
      s?.leave(auth.roomId);
      s?.emit('kicked', { message: '房主已解散房间' });
    }

    appendAdminAudit('owner_destroy_room', {
      roomId: auth.roomId,
      name: result.name || auth.name || '',
      userId: actorId,
      kicked: sidsToKick.length,
    }, clientIp);
  });

  socket.on('set_room_admin', ({ userId: targetUserId, admin }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_admin', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const actorId = getSocketUserId(socket);
    const result = setRoomAdmin(roomId, actorId, targetUserId, Boolean(admin), socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId), message: result.message });
  });

  socket.on('leave_room', (_payload, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: true });
      return;
    }

    socket.leave(roomId);
    socketToRoom.delete(socket.id);
    const userId = getSocketUserId(socket);
    socketToUserId.delete(socket.id);
    if (userId) {
      const result = removeUser(roomId, userId, socket.id);
      if (result?.userRemoved && !result.empty) {
        broadcastRoomPresence(roomId);
      }
    }
    callback?.({ success: true });
  });

  socket.on('add_song', async (payload, callback) => {
    const { song } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'add_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const clean = sanitizeClientSong(song);
    if (clean.error) {
      callback?.({ success: false, error: clean.error });
      return;
    }

    const room = getRoomInternal(roomId);
    const userId = getSocketUserId(socket);
    const user = room?.users.get(userId);
    const result = await addToQueue(roomId, clean.song, {
      id: userId,
      nickname: user?.nickname || '匿名',
    });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitRoomAndPlayback(roomId, result.room);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true });

  });

  socket.on('remove_song', (payload, callback) => {
    const { queueId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'remove_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = removeFromQueue(roomId, getSocketUserId(socket), queueId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true });
  });

  socket.on('clear_queue', (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'clear_queue', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = clearQueue(roomId, getSocketUserId(socket), socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true });
  });

  socket.on('report_playback_media', (payload, callback) => {
    const {
      trackId,
      url,
      qualityLabel,
      crossSource,
      crossSourceFrom,
      loudness,
      duration,
    } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'report_playback_media', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setSharedPlaybackMedia(roomId, {
      trackId,
      url,
      qualityLabel,
      crossSource,
      crossSourceFrom,
      loudness,
      duration,
    });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    if (result.updated && result.media) {
      io.to(roomId).emit('playback_media', result.media);
    }
    callback?.({ success: true, updated: Boolean(result.updated) });
  });

  socket.on('skip_song', async ({ reason } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'skip_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await skipSong(roomId, getSocketUserId(socket), socket.id, { reason });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitRoomAndPlayback(roomId, result.room);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true });
  });

  socket.on('finish_song', async (payload, callback) => {
    const { queueId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'finish_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const expectedQueueId = String(queueId || '');
    const advanced = await advanceEndedRoomNow(roomId, expectedQueueId);
    if (advanced) {
      emitRoomAndPlayback(roomId, advanced);
      callback?.({ success: true });
      return;
    }

    const result = await finishCurrentSong(roomId, getSocketUserId(socket), socket.id, expectedQueueId);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitRoomAndPlayback(roomId, result.room);
    callback?.({ success: true });
  });

  socket.on('request_jump', async (payload, callback) => {
    const { queueId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'request_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await requestJump(roomId, getSocketUserId(socket), queueId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true });
  });

  socket.on('reorder_queue', (payload, callback) => {
    const { orderedQueueIds, movedQueueId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'reorder_queue', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = reorderQueue(roomId, getSocketUserId(socket), orderedQueueIds, movedQueueId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitQueueSnapshot(roomId);
    callback?.({ success: true });
  });

  socket.on('toggle_queue_like', (payload, callback) => {
    const { queueId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'toggle_queue_like', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = toggleQueueLike(roomId, getSocketUserId(socket), queueId);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    // 点赞会改队列排序：只推 queue/current，不下发整包 users；高频点击合并广播
    emitQueueSnapshot(roomId);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true, liked: result.liked });
  });

  socket.on('toggle_current_dislike', async (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'toggle_current_dislike', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await toggleCurrentDislike(roomId, getSocketUserId(socket));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    if (result.skipped) {
      emitRoomAndPlayback(roomId, result.room);
    } else {
      emitQueueSnapshot(roomId);
    }
    emitSystemChat(roomId, result.systemMessage);
    callback?.({
      success: true,
      disliked: result.disliked,
      skipped: result.skipped,
      dislikeCount: result.dislikeCount,
      threshold: result.threshold,
    });
  });

  socket.on('approve_jump', async (payload, callback) => {
    const { requestId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'approve_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await approveJump(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true });
  });

  socket.on('reject_jump', (payload, callback) => {
    const { requestId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'reject_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = rejectJump(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true });
  });

  socket.on('request_skip', (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'request_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = requestSkip(roomId, getSocketUserId(socket));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true });
  });

  socket.on('approve_skip', async (payload, callback) => {
    const { requestId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'approve_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await approveSkip(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitRoomAndPlayback(roomId, result.room);
    callback?.({ success: true });
  });

  socket.on('reject_skip', (payload, callback) => {
    const { requestId } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'reject_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = rejectSkip(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true });
  });

  socket.on('send_chat', async (payload, callback) => {
    const { text, mentions, replyTo, imageUrl, imageKey, asSticker } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketChat, 'send_chat', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = addChatMessage(roomId, getSocketUserId(socket), text, {
      mentions,
      replyTo,
      imageUrl,
      imageKey,
      asSticker,
    });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    // 先 ACK 再广播，避免大图表情包推给全员时发送方超时
    callback?.({ success: true, message: result.message });

    const rawUrl = String(result.message?.imageUrl || '');
    const hugeDataUrl = rawUrl.startsWith('data:') && rawUrl.length > 12 * 1024;
    if (hugeDataUrl) {
      // 超大 data URL：其他人只收占位，发送者收完整图（socket.to 不含自己）
      socket.to(roomId).emit('chat_message', { ...result.message, imageUrl: null });
      socket.emit('chat_message', result.message);
    } else {
      io.to(roomId).emit('chat_message', result.message);
    }

    // 聊天室 AI：触发词 /小音、@小音 等；有图时先视觉识图再文本工具调用
    const userId = getSocketUserId(socket);
    const nickname = String(result.message?.nickname || '').trim() || '用户';
    const triggerText = String(result.message?.text || '').trim();
    const hasImage = Boolean(result.message?.imageUrl) && !result.message?.asSticker;
    const chatRoom = getRoomInternal(roomId);
    const botName = resolveRoomAiBotName(chatRoom);
    setImmediate(async () => {
      // 明确的普通“切歌/下一首”控制词直接执行，不要求 AI 开启或昵称触发。
      if (!hasImage) {
        const commandText = stripAiTriggerPrefix(triggerText, botName)
          .replace(/[，,。.!！?？：:;；、\s]+$/g, '')
          .trim();
        const isDirectSkip = /^(?:切歌|下一首|下首|跳过(?:这首|当前歌曲)?|换一首|换首歌|skip)$/i.test(commandText);
        if (isDirectSkip) {
          void (async () => {
            const direct = await skipSongOnBehalfOfUser(roomId, userId, { botName, reason: 'ai_direct_command' });
            const requested = direct?.error && direct.canRequestSkip;
            const result = requested ? requestSkipOnBehalfOfUser(roomId, userId) : direct;
            const text = result?.error
              || result?.message
              || (requested ? '已提交切歌申请，等待房主或管理员处理' : '已处理切歌请求');
            const posted = postBotChatMessage(roomId, { text });
            if (posted.message) io.to(roomId).emit('chat_message', posted.message);
            if (!result?.error) emitRoomAndPlayback(roomId, result.room);
          })();
          return;
        }
      }
      if (!isRoomAiEnabledForRoom(chatRoom)) return;
      if (!shouldTriggerRoomAi(triggerText, botName, [], { hasImage })) return;
      const aiRate = await consumeDistributedSocketRate(socket, 'room-ai', {
        windowMs: 60_000,
        max: 8,
      });
      if (!aiRate.allowed) {
        incrementMetric('socket_rate_limit_rejected_total', { event: 'room_ai' });
        const posted = postBotChatMessage(roomId, {
          text: '问得太快啦，稍等一下再叫我～',
          replyTo: result.message,
        });
        if (posted.message) io.to(roomId).emit('chat_message', posted.message);
        return;
      }
      const requestId = `${result.message.id}:ai`;
      enqueueRoomAiChat({
        requestId,
        roomId,
        triggerMessage: result.message,
        userId,
        userNickname: nickname,
        emitChat: (message) => {
          if (message) io.to(roomId).emit('chat_message', message);
        },
        emitSystem: (message) => emitSystemChat(roomId, message),
        broadcastRoom: () => emitRoomAndPlayback(roomId, getRoomInternal(roomId)),
      }, ({ status, queuePosition, pendingCount, attempt, maxAttempts, error }) => io.to(roomId).emit('room_ai_processing', {
        status,
        requestId,
        sourceMessageId: result.message.id,
        userId,
        nickname,
        queuePosition,
        pendingCount,
        attempt,
        maxAttempts,
        error,
        startedAt: Date.now(),
      }));
    });
  });

  socket.on('recall_chat', ({ messageId }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = recallChatMessage(roomId, getSocketUserId(socket), messageId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    callback?.({ success: true });
    if (result.recalledMessageId) {
      io.to(roomId).emit('chat_message_recall', { messageId: result.recalledMessageId });
    }
    if (result.recallMessage) {
      io.to(roomId).emit('chat_message', result.recallMessage);
    }
  });

  socket.on('toggle_chat_reaction', ({ messageId, emoji }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = toggleChatReaction(roomId, getSocketUserId(socket), messageId, emoji);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('chat_reaction_update', {
      messageId: result.messageId,
      reactions: result.reactions,
    });
    callback?.({ success: true, messageId: result.messageId, reactions: result.reactions });
  });

  socket.on('load_chat_history', ({ before, beforeId, limit }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = getChatHistoryForUser(roomId, getSocketUserId(socket), { before, beforeId, limit });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    callback?.({
      success: true,
      messages: result.messages,
      hasMore: Boolean(result.hasMore),
    });
  });

  socket.on('load_song_history', ({ limit }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = getSongHistory(roomId, { limit });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    callback?.({ success: true, songs: result.songs });
  });

  socket.on('report_track_duration', async (payload, callback) => {
    const { queueId, durationMs } = socketPayload(payload);
    if (rejectRateLimited(socket, limitSocketAction, 'report_track_duration', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = reportTrackDuration(
      roomId,
      getSocketUserId(socket),
      queueId,
      durationMs,
      socket.id,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, skipped: Boolean(result.skipped) });

    // 补种/缩短时长后，若时钟已越过真实尽头则立刻切歌（不必等 500ms 轮询）
    if (!result.skipped) {
      await advanceEndedRoomNow(roomId, queueId || '');
    }
  });


  socket.on('list_favorites', async (_payload, callback) => {
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
      return;
    }
    const favorites = await listFavoriteSongs(identity.userId);
    callback?.({ success: true, favorites });
  });

  socket.on('set_favorite', async (payload, callback) => {
    const { song, favorite } = socketPayload(payload);
    if (rejectRateLimited(socket, limitSocketAction, 'set_favorite', callback)) return;

    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
      return;
    }

    const clean = sanitizeClientSong(song);
    if (clean.error) {
      callback?.({ success: false, error: clean.error });
      return;
    }

    const result = await setFavoriteSong(identity.userId, clean.song, Boolean(favorite));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, favorites: result.favorites, favorite: result.favorite });
  });

  socket.on('import_favorites', async (payload, callback) => {
    const { songs } = socketPayload(payload);
    if (rejectRateLimited(socket, limitSocketAction, 'import_favorites', callback)) return;

    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
      return;
    }

    if (!Array.isArray(songs) || songs.length === 0 || songs.length > 1000) {
      callback?.({ success: false, error: '收藏数据格式无效' });
      return;
    }

    const cleanSongs = [];
    for (const song of songs) {
      const clean = sanitizeClientSong(song);
      if (!clean.error) cleanSongs.push(clean.song);
    }

    const result = await importFavoriteSongs(identity.userId, cleanSongs);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, favorites: result.favorites, imported: result.imported, dropped: result.dropped, maxFavorites: result.maxFavorites });
  });
  socket.on('toggle_play', (payload, callback) => {
    const { isPlaying } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'toggle_play', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const updated = setPlaying(roomId, getSocketUserId(socket), isPlaying, socket.id);
    if (!updated) {
      callback?.({ success: false, error: '房间未允许成员暂停/播放' });
      return;
    }
    emitPlaybackOnly(roomId);
    callback?.({ success: true });
  });

  socket.on('seek', (payload, callback) => {
    const { time } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'seek', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const updated = seekTo(roomId, getSocketUserId(socket), time, socket.id);
    if (!updated) {
      callback?.({ success: false, error: '房间未允许成员调节进度' });
      return;
    }
    emitPlaybackOnly(roomId);
    callback?.({ success: true });
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;

    const userId = getSocketUserId(socket);
    socketToRoom.delete(socket.id);
    socketToUserId.delete(socket.id);
    if (!userId) return;

    setTimeout(() => {
      const result = removeUser(roomId, userId, socket.id);
      // 多端同用户仍在线、或房间已空：不必全房推送
      if (!result?.userRemoved || result.empty) return;
      broadcastRoomPresence(roomId);
    }, DISCONNECT_GRACE_MS);
  });
});

let autoAdvanceRunning = false;

async function checkAutoAdvance() {
  if (autoAdvanceRunning) return;
  autoAdvanceRunning = true;

  try {
    for (const roomId of listRoomIds()) {
      const internal = getRoomInternal(roomId);
      if (!internal || internal.users.size === 0) continue;

      if (internal.randomLoading && !internal.current) {
        const retried = await retryStuckRandomLoading(roomId);
        if (retried) {
          emitRoomAndPlayback(roomId, retried);
        }
        continue;
      }

      if (!internal.isPlaying || !internal.current) continue;

      const advanced = await advancePlaybackIfEnded(roomId);
      if (advanced) {
        emitRoomAndPlayback(roomId, advanced);
      }
    }
  } finally {
    autoAdvanceRunning = false;
  }
}

setInterval(() => {
  void checkAutoAdvance();
}, AUTO_ADVANCE_INTERVAL_MS);

registerMetingRoomResolver(getRoomInternal);
await initRooms();

const setupRequired = isSetupRequired();
if (!isRedisEnabled()) {
  if (setupRequired && !hasRedisEnvConfig()) {
    console.warn('🛠️ OpenMusic 尚未初始化，请访问 /setup 完成首次部署（需配置 Redis）');
  } else {
    console.error('❌ Redis 为必需依赖：未连接时无法启动。请检查 REDIS_URL / REDIS_HOST 后重试。');
    process.exit(1);
  }
} else {
  await initSiteAnnouncement();
  await initDonations();
  await initSiteBans();
  if (!setupRequired) {
    await initAdminCredentials();
  } else {
    console.warn('🛠️ OpenMusic 尚未初始化，请访问 /setup 完成首次部署');
  }
}

httpServer.listen(PORT, () => {
  console.log(`🎵 OpenMusic 服务运行在 http://localhost:${PORT}`);
  console.log(`📡 Meting API: ${getMetingUpstreamBases().join(', ') || '未配置'}`);
  const customMusic = getCustomMusicApiStatus();
  console.log(`🔌 自定义音源接口: ${customMusic.configured ? `${customMusic.routes.length} 条路由` : '未配置'}`);
  console.log(`💾 持久化存储: ${isRedisEnabled() ? 'Redis' : '未连接（仅安装向导）'}`);
  startMetingHealthProbe();
});

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: 正在优雅退出，通知客户端重连并刷写房间…`);

  const forceTimer = setTimeout(() => {
    console.error('优雅退出超时，强制结束进程');
    process.exit(1);
  }, 25_000);
  forceTimer.unref?.();

  try {
    // 先断开 Socket，让客户端立刻进入重连；再关 HTTP
    try {
      io.close();
    } catch (err) {
      console.warn('关闭 Socket.IO 失败:', err?.message || err);
    }
    await new Promise((resolve) => {
      httpServer.close(() => resolve());
    });
  } catch (err) {
    console.warn('关闭 HTTP 服务失败:', err?.message || err);
  }

  try {
    await flushAllPendingRoomPersists();
  } catch (err) {
    console.warn('刷写房间状态失败:', err?.message || err);
  }

  clearTimeout(forceTimer);
  console.log('优雅退出完成');
  process.exit(0);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});
