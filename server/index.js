import { DeviceProofError, loginDeviceKey, normalizeDeviceKey } from './deviceProof.js';
import { verifyAccountDeviceRequest, bindAccountDeviceKey } from './accountAuth.js';
import { createOAuthFailureReporter, oauthFailureDetails } from './oauthProvider.js';
import { createRiskChallengeBus } from './riskChallengeBus.js';
import { createRedisMaintenance } from './redisMaintenance.js';
import { evalRedisScript } from './redisScripts.js';
import { createProxyTrust, observeProxyHeaders } from './trustedProxy.js';
import { createTurnstileVerifier } from './turnstile.js';
import { publicHumanChallengeState } from './riskHumanChallenge.js';
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
  buildMetingAuthHeaders,
} from './metingUpstream.js';
import { fetchCustomMusicApi, hasCustomMusicApi, getCustomMusicApiStatus } from './customMusicApi.js';
import { createMetingResponseCache } from './metingCache.js';
import { filterSongPayloadByArtist } from './songArtistFilter.js';
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
import {
  claimWechatLoginProof,
  mountWechatFileHelperProxy,
  verifyWechatLoginProof,
  WECHAT_LOGIN_PROOF_COOKIE,
} from './wechatFileHelperProxy.js';
import {
  WECHAT_UIN_CONFLICT,
  createWechatUinStore,
} from './wechatUinAuth.js';
import { mountAdminApi, appendAdminAudit } from './adminApi.js';
import { initAdminCredentials } from './adminCredentials.js';
import { riskControl, RiskControlError } from './riskControl.js';
import { createAccountAccessMiddleware } from './accountAccess.js';
import { createAnonymousAccess } from './anonymousAccess.js';
import { createAccountRequestGuard, createAccountSocketOriginGuard } from './accountRequest.js';
import { ACCOUNT_REFRESH_COOKIE, AccountTokenError, accountTokenSessionId } from './accountTokens.js';
import { createWechatAccountLogin, WechatAccountLoginError, WECHAT_ACCOUNT_LOGIN_COOKIE, WECHAT_ACCOUNT_LOGIN_TTL_SEC } from './wechatAccountLogin.js';
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
import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'crypto';
import { isIP } from 'net';
import {
  collectDeviceIdsForUser,
  getUserIdForDevice,
  isAccessBanned,
  linkDeviceToUser,
  sanitizeDeviceId,
} from './deviceIdentity.js';
import { resolveBoundClientNetwork } from './clientIpBinding.js';
import { shouldIssueGuestHandoff, shouldMigrateFavorites, shouldRefreshRoomIdentity } from './sessionIdentity.js';
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
  setRoomAdminSelfManageMemberTier,
  postMemberWelcomeMessage,
  setRoomJoinNotice,
  setRoomAiSettings,
  setRoomMaxAdmins,
  setRoomPlaybackRate,
  postJoinNoticeMessage,
  shouldMuteJoinAnnouncements,
  wasKnownRoomUser,
  setRoomFmMode,
  setQishuiProxyEnabled,
  setRoomPlayMode,
  setRoomMusicAccountsCache,
  patchRoomMusicAccountCache,
  mergeSharedMusicAccount,
  mergeRoomMusicAccountsWithUpstream,
  getRoomMusicAccountCookie,
  setRoomAnnouncement,
  setRoomCustomCover,
  setChatHistoryVisibleOnJoin,
  setChatShowAvatars,
  setRoomHideIpLocation,
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
  shareSongToChat,
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
  recoverRoomOwner,
  setRoomAdmin,
  reportTrackDuration,
  setOnRoomPrefetchReady,
  setOnRoomStructureChanged,
  setRoomPlaylistRoaming,
  serializeRoomForViewer,
  prepareRoomBroadcast,
  roomUpdateForViewer,
  setRoomOwnerAccountId,
  claimRoomsForAccountIdentity,
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
import { importNeteasePlaylist, importQqPlaylist, importKugouPlaylist, importQishuiPlaylist, fetchNeteasePlaylistMetas } from './playlistImport.js';
import { fetchNeteaseHotToplist } from './neteaseToplist.js';
import { createNeteasePlaylistSearchHandler } from './neteasePlaylistSearch.js';
import { getHotSongs } from './songHotRank.js';
import { fetchMusicSuggestions } from './musicSuggestions.js';
import { normalizeMetingFailure } from './metingError.js';
import { hasRedisEnvConfig, createFavoriteShare, revokeFavoriteShare, importFavoriteShare, importFavoriteSongs, importFavoriteCategories, listFavoriteSongs, listFavoriteCategories, createFavoriteCategory, deleteFavoriteCategory, previewFavoriteShare, setFavoriteSong, setFavoriteCategory, getRedisClient, addRoomToAccountIndex, listRoomIdsForAccount, retainMigratedFavoriteSource } from './roomStorage.js';
import { analyzeFavoritesMigration, filterFavoriteCategories } from './favoritesSync.js';
import { sanitizeFavoriteSongInput } from './favoriteSongInput.js';
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
import { isMusicSourceEnabled } from './musicSources.js';
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
  clearLinuxdoBindingsForRoom,
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
  clearGithubBindingsForRoom,
} from './githubAuth.js';
import {
  ACCOUNT_SESSION_COOKIE,
  ACCOUNT_SESSION_TTL_SEC,
  requestEmailRegistrationCode,
  registerWithEmail,
  loginWithEmail,
  loginOrRegisterExternalIdentity,
  bindExternalIdentity,
  ensureRoomUserId,
  updateAccountNickname,
  getRoomIdentityOwnerAccountId,
  unbindExternalIdentity,
  createAccountSession,
  resolveAccountSession,
  inspectAccountSession,
  refreshAccountSession,
  revokeAccountSession,
  publicAccount,
  AccountAuthError,
  normalizeEmail,
} from './accountAuth.js';
import { createAccountMusicService } from './accountMusic.js';

// 由 mountAdminApi() 返回赋值：房主 OAuth 回调路由与后台 OAuth 回调共用同一个
// 已在第三方平台注册的 redirect_uri，只能在这一个路由里按 state.purpose 分发，
// 详见下方 /api/auth/{provider}/callback 路由与 adminApi.js 内的处理函数。
let handleLinuxdoAdminCallback = null;
let handleGithubAdminCallback = null;

const wechatUinStore = createWechatUinStore();
const wechatAccountLogin = createWechatAccountLogin({ getStore: getRedisClient });
const accountMusic = createAccountMusicService({
  getStore: getRedisClient,
  getConfig: getRuntimeConfig,
  share: async ({ platform, cookie, metadata }) => {
    const result = await contributeMusicAccount(platform, cookie, metadata.providerName || '', metadata.revokeToken || '');
    return result.ok ? { ...result, data: { ...(result.data || {}), ...metadata }, revokeToken: result.revokeToken } : result;
  },
  unshare: async (_accountId, _platform, _cookie, metadata) => {
    if (!metadata?.revokeToken) return { ok: true };
    return revokeMusicContribution(metadata.revokeToken);
  },
});

async function restoreAccountMusicToRoom(accountId, room, { ownerUserId } = {}) {
  if (!accountId || !room) return room;
  try {
    // 使用服务端房间归属与凭证，公开快照不包含完整的账户归属字段
    const internal = getRoomInternal(room.id);
    const ownsRoom = (current) => ownerUserId
      ? current && !current.ownerAccountId && current.creatorId === ownerUserId
      : current?.ownerAccountId === accountId;
    const ownedIds = new Set([room.id, ...(ownerUserId ? listRoomIds() : await listRoomIdsForAccount(accountId))]);
    for (const id of ownedIds) {
      const owned = getRoomInternal(id);
      if (ownsRoom(owned)) await accountMusic.rememberRoom(accountId, owned, { ownerUserId });
    }
    await accountMusic.restoreRoom(accountId, internal, (roomId, platform, metadata, options) => {
      const current = getRoomInternal(roomId);
      if (!ownsRoom(current)) {
        throw Object.assign(new Error('房间归属已变化，请重试'), { code: 'ROOM_ACCOUNT_CONFLICT' });
      }
      const result = patchRoomMusicAccountCache(roomId, platform, metadata, options);
      if (result.error) throw new Error('房间会员恢复失败');
    }, { ownerUserId });
    if (!ownsRoom(getRoomInternal(room.id))) {
      throw Object.assign(new Error('房间归属已变化，请重试'), { code: 'ROOM_ACCOUNT_CONFLICT' });
    }
    incrementMetric('account_music_restore_total', { outcome: 'success' });
    return getRoom(room.id);
  } catch (error) {
    incrementMetric('account_music_restore_total', { outcome: 'failed', code: error.code || 'storage' });
    console.error('[Account Music] 房间复用会员失败:', error.code || 'storage');
    throw error;
  }
}

async function clearRoomOwnerBindings(roomId) {
  await Promise.all([
    clearLinuxdoBindingsForRoom(roomId),
    clearGithubBindingsForRoom(roomId),
    wechatUinStore.clearBindingsForRoom(roomId),
  ]);
}

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
const TRUSTED_PROXY_IPS = new Set(
  String(process.env.TRUSTED_PROXY_IPS || '127.0.0.1,::1')
    .split(',')
    .map((ip) => normalizeClientIp(ip))
    .filter(Boolean),
);
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
const isTrustedProxyPeer = createProxyTrust({ enabled: TRUST_PROXY, trustedIps: TRUSTED_PROXY_IPS, normalizeIp: normalizeClientIp });
app.set('trust proxy', isTrustedProxyPeer);
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
  allowRequest: createAccountSocketOriginGuard({ allowedOrigins: ALLOWED_ORIGINS, allowDevelopmentOrigin: (origin) => !IS_PRODUCTION && isLocalDevOrigin(origin) }),
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
  // 缩短心跳间隔，确保在 CDN/代理约 16 秒空闲超时前发出心跳，避免长轮询被掐断
  pingInterval: 10_000,
  // 人多时事件循环偶发阻塞，放宽 ping 超时减少误判断连
  pingTimeout: 60_000,
});

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'X-OpenMusic-Request',
    'X-OpenMusic-Device',
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

app.use(createAccountRequestGuard({ allowedOrigins: ALLOWED_ORIGINS }));
app.use(createAccountAccessMiddleware({
  verifyDevice: req => verifyAccountDeviceRequest(resolveAccountSessionToken(req), req, { session: req.accountSession, ip: getRequestIp(req) }),
  resolveAccount: resolveAccountFromRequest,
  resolveIdentity: resolveIdentityFromRequest,
  ensureIdentity: ensureRoomUserId,
  risk: riskControl,
  getIp: getRequestIp,
  getNetworkContext: req => observeProxyHeaders(req.headers, req.socket?.remoteAddress || '', isTrustedProxyPeer, CLIENT_IP_HEADER),
  withContext: runWithMetingRequestContext,
  metric: incrementMetric,
  onHumanChallenge: suspendAccountSocketsForHumanChallenge,
  resolveAnonymous: resolveAnonymousAccount,
}));

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
  const ip = normalizeClientIp(value);
  return isIP(ip) ? ip : '';
}

/**
 * CDN 回源真实客户端 IP 头（有 CDN 时必填）。
 * Cloudflare: CF-Connecting-IP；EdgeOne: EO-Connecting-IP
 */
const CLIENT_IP_HEADER = String(process.env.CLIENT_IP_HEADER || '').trim().toLowerCase();

function getClientIpFromHeaders(headers = {}, remoteAddress = '') {
  // 只有 TCP 对端在显式可信代理列表中时才接受转发头，避免直连客户端伪造 XFF/X-Real-IP 绕过限流。
  const normalizedRemoteAddress = normalizeClientIp(remoteAddress || '');
  const trustForwarded = isTrustedProxyPeer(normalizedRemoteAddress);
  if (!trustForwarded) {
    return normalizedRemoteAddress;
  }

  // CDN 配置头优先于 Nginx 写入的边缘节点 X-Real-IP
  if (CLIENT_IP_HEADER) {
    const customIp = getHeaderIp(headers, CLIENT_IP_HEADER);
    if (customIp) return customIp;
    // 兼容旧部署指引的 iqp；未配置 CDN 头时不自动信任客户端透传的头
    if (CLIENT_IP_HEADER === 'iqp') {
      const edgeOneIp = getHeaderIp(headers, 'eo-connecting-ip');
      if (edgeOneIp) return edgeOneIp;
    }
  }

  // Nginx 覆盖写入的 X-Real-IP 优先于可被伪造的 XFF 首段
  const realIp = getHeaderIp(headers, 'x-real-ip');
  if (realIp) return realIp;

  const forwarded = headers['x-forwarded-for'];
  const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (rawForwarded) {
    const parts = String(rawForwarded).split(',').map((part) => part.trim()).filter(Boolean);
    // 可信代理追加在末尾；取最后一段
    if (parts.length > 0) {
      const ip = normalizeClientIp(parts[parts.length - 1]);
      if (isIP(ip)) return ip;
    }
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
// 联想一次会扇出多个音源请求；单独限额以保护上游，避免挤占常规搜索配额。
const limitMusicSuggestions = createRateLimiter({ windowMs: 60_000, max: 30 });
const limitSocketAction = createRateLimiter({ windowMs: 60_000, max: 90 });
const limitContributionQr = createRateLimiter({ windowMs: 60_000, max: 45 });
const limitContributionBind = createRateLimiter({ windowMs: 10 * 60_000, max: 8 });
const limitSocketChat = createRateLimiter({ windowMs: 60_000, max: 30 });
const limitOwnerDestroyRoom = createRateLimiter({ windowMs: 60_000, max: 3 });
const limitErrorReport = createRateLimiter({ windowMs: 10 * 60_000, max: 5 });
const limitSessionBootstrap = createRateLimiter({ windowMs: 60_000, max: 90 });
const limitNewSessionBootstrap = createRateLimiter({ windowMs: 60_000, max: 45 });
const limitAccountEmailCodeIp = createRateLimiter({ windowMs: 10 * 60_000, max: 5 });
const limitAccountEmailCodeEmail = createRateLimiter({ windowMs: 10 * 60_000, max: 3 });
const limitAccountLogin = createRateLimiter({ windowMs: 60_000, max: 10 });
const limitAccountLoginEmail = createRateLimiter({ windowMs: 15 * 60_000, max: 12 });
const limitAccountLoginEmailIp = createRateLimiter({ windowMs: 5 * 60_000, max: 6 });
const limitAccountRefresh = createRateLimiter({ windowMs: 60_000, max: 60 });
const limitAccountNickname = createRateLimiter({ windowMs: 60_000, max: 20 });
const accountLoginFailures = new Map();
const ACCOUNT_LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const ACCOUNT_LOGIN_MAX_DELAY_MS = 2_000;

function accountLoginEmailKey(email) {
  const normalized = normalizeEmail(email);
  return normalized ? createHash('sha256').update(normalized).digest('hex') : '';
}

function getAccountLoginPenaltyMs(email) {
  const key = accountLoginEmailKey(email);
  if (!key) return 0;
  const entry = accountLoginFailures.get(key);
  const now = Date.now();
  if (!entry || entry.expiresAt <= now) {
    accountLoginFailures.delete(key);
    return 0;
  }
  return Math.max(0, entry.nextAllowedAt - now);
}

function recordAccountLoginFailure(email) {
  const key = accountLoginEmailKey(email);
  if (!key) return;
  const now = Date.now();
  const previous = accountLoginFailures.get(key);
  const failures = previous && previous.expiresAt > now ? previous.failures + 1 : 1;
  const delayMs = failures < 5 ? 0 : Math.min(ACCOUNT_LOGIN_MAX_DELAY_MS, 100 * (2 ** (failures - 5)));
  accountLoginFailures.set(key, {
    failures,
    nextAllowedAt: now + delayMs,
    expiresAt: now + ACCOUNT_LOGIN_FAILURE_WINDOW_MS,
  });
  if (accountLoginFailures.size > 10_000) accountLoginFailures.delete(accountLoginFailures.keys().next().value);
}

function clearAccountLoginFailures(email) {
  const key = accountLoginEmailKey(email);
  if (key) accountLoginFailures.delete(key);
}

async function applyAccountLoginPenalty(email) {
  const delayMs = getAccountLoginPenaltyMs(email);
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}
const limitLinuxdoAuth = createRateLimiter({ windowMs: 60_000, max: 10 });
const limitGithubAuth = createRateLimiter({ windowMs: 60_000, max: 10 });
const limitWechatUinAuth = createRateLimiter({ windowMs: 10 * 60_000, max: 10 });
const WECHAT_ACCOUNT_AUTH_ENABLED = true;
const socketRateLog = createLogger('socket-rate-limit');
let lastSocketRateRedisErrorAt = 0;
const distributedSocketRateLimiter = createDistributedSocketRateLimiter({
  getRedisClient,
  allowMemoryFallback: !IS_PRODUCTION,
  onRedisError: (error) => {
    incrementMetric('socket_rate_limit_redis_error_total');
    const now = Date.now();
    if (now - lastSocketRateRedisErrorAt >= 60_000) {
      lastSocketRateRedisErrorAt = now;
      socketRateLog.warn('redis_rate_limiter_unavailable', { error });
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
    : (data && Array.isArray(data.data) ? data.data : (data && Array.isArray(data.list) ? data.list : [data]));

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    // 在媒体链接改写为相对地址前补齐歌曲 ID，兼容按 url 提取 ID 的旧客户端。
    if (item.id == null || !String(item.id).trim()) {
      const media = typeof item.url === 'string' ? parseMetingMediaQuery(item.url) : null;
      if (media?.type === 'url') item.id = media.id;
    }
    for (const field of ['url', 'pic', 'lrc']) {
      if (typeof item[field] === 'string' && /^https?:\/\//i.test(item[field])) {
        item[field] = browserMetingMediaUrl(item[field]);
      }
    }
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
function isQishuiPlayUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.pathname.endsWith('/audio/qishui') && Boolean(url.searchParams.get('t'));
  } catch {
    return false;
  }
}

function getQishuiSourceSigningKey() {
  const material = String(getRuntimeConfig().roomCredentialEncryptionKey || process.env.ROOM_CREDENTIAL_ENCRYPTION_KEY || CLIENT_ID_SECRET).trim();
  return createHmac('sha256', 'openmusic:qishui-source').update(material).digest();
}

function createQishuiSourceToken(rawUrl, accountId = '') {
  if (!accountId) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getQishuiSourceSigningKey(), iv);
  cipher.setAAD(Buffer.from(`qishui-source:v4:${accountId}`));
  const body = JSON.stringify({ u: String(rawUrl), e: Date.now() + QISHUI_SOURCE_TOKEN_TTL_MS });
  const encrypted = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return `v4.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`;
}

function verifySignedQishuiSourceToken(token, accountId = '') {
  if (!accountId || typeof token !== 'string' || token.length > 8192 || !/^v4\.[A-Za-z0-9_-]+$/u.test(token)) return '';
  try {
    const payload = Buffer.from(token.slice(3), 'base64url');
    if (payload.length < 29) return '';
    const decipher = createDecipheriv('aes-256-gcm', getQishuiSourceSigningKey(), payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(`qishui-source:v4:${accountId}`));
    decipher.setAuthTag(payload.subarray(12, 28));
    const parsed = JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'));
    return typeof parsed.u === 'string' && Number.isSafeInteger(parsed.e) && parsed.e > Date.now() ? parsed.u : '';
  } catch {
    return '';
  }
}

async function resolveQishuiSourceToken(token, accountId = '') {
  return verifySignedQishuiSourceToken(token, accountId);
}

function browserMetingMediaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    if (isConfiguredMetingUrl(rawUrl)) {
      const query = new URLSearchParams();
      for (const name of ['server', 'id', 'type', 'quality', 'format', 'limit', 'page', 'offset', 'fm']) {
        if (url.searchParams.has(name)) query.set(name, url.searchParams.get(name));
      }
      if (!query.get('server') || !query.get('type') || !query.get('id')) return '';
      return `/api/meting?${query}`;
    }
    if (isBlockedMediaHostname(url.hostname) || !url.hostname.includes('.') && !url.hostname.includes(':')) {
      const query = parseMetingMediaQuery(rawUrl);
      return query ? `/api/meting?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined))}` : '';
    }
    return rawUrl;
  } catch {
    return '';
  }
}

async function localizeQishuiPayload(payload, metingQuery, req) {
  if (metingQuery?.server !== 'qishui' || metingQuery?.type !== 'url' || !isQishuiPlayUrl(payload?.url)) {
    return { ...payload, url: browserMetingMediaUrl(payload?.url) };
  }
  if (!isConfiguredMetingUrl(payload.url)) return { ...payload, url: '' };
  const token = createQishuiSourceToken(payload.url, req?.riskAccount?.id || req?.account?.id || '');
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
        { thumbPx: 0, requireAllowlist: true, imageOnly: true },
      );
    } catch (err) {
      console.error('Meting pic resolve error:', err?.message || err);
      return res.status(404).json({ error: 'no cover' });
    }
  }

  const structuredLyrics = metingType === 'lrc' && metingQuery.format === 'json';
  const response = await fetchMetingApi(metingQuery, { redirect: 'manual', ...(structuredLyrics ? { maxResponseBytes: 4 * 1024 * 1024 } : {}) }, structuredLyrics ? 30000 : 10000);
  for (const name of ['X-OpenMusic-Upstream-Count', 'X-OpenMusic-Upstream-Page']) {
    const value = response.headers.get(name);
    if (value) res.set(name, value);
  }

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
        if (metingQuery.format === 'json') {
          incrementMetric('structured_lyrics_total', { result: 'redirect' });
          return res.status(502).json({ error: 'lyric redirect unsupported', code: 'LYRIC_UPSTREAM_REDIRECT' });
        }
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
  if (!response.ok) {
    if (structuredLyrics) incrementMetric('structured_lyrics_total', { result: 'upstream_error' });
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    const failure = normalizeMetingFailure(payload, response.status);
    return res.status(failure.status).json({ success: false, error: failure.error, code: failure.code });
  }
  if (metingType === 'lrc' && metingQuery.format === 'json') {
    try {
      const { normalizeStructuredLyrics, readStructuredLyricResponse } = await import('./structuredLyrics.js');
      const lyrics = normalizeStructuredLyrics(await readStructuredLyricResponse(response));
      incrementMetric('structured_lyrics_total', { result: 'success', format: lyrics.wordFormat || 'lrc' });
      return res.json(lyrics);
    } catch {
      incrementMetric('structured_lyrics_total', { result: 'invalid_response' });
      return res.status(502).json({ error: 'invalid lyric response', code: 'LYRIC_UPSTREAM_INVALID' });
    }
  }
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
  const platform = ['netease', 'tencent', 'kugou', 'qishui'].includes(req.body?.platform) ? req.body.platform : '';
  if (!platform) return res.status(400).json({ success: false, error: '请选择音乐平台' });
  if (!isMusicSourceEnabled(platform, getRuntimeConfig().musicSourcesEnabled)) {
    return res.status(503).json({ success: false, error: '该音源已关闭' });
  }
  const result = await createManagedMusicQrSession({
    ownerId: identity.userId,
    platform,
    purpose: 'contribution',
  });
  if (!result.ok) return res.status(result.status || 502).json({ success: false, code: result.code, error: result.error || '二维码生成失败' });
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
  if (!result.ok) return res.status(result.status || 502).json({ success: false, code: result.code, error: result.error || '扫码状态查询失败' });
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
  if (!result.ok) return res.status(result.status || 502).json({ success: false, code: result.code, error: result.error || '汽水验证初始化失败' });
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
  if (!result.ok) return res.status(result.status || 502).json({ success: false, code: result.code, error: result.error || '汽水验证请求失败' });
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
  if (!result.ok) return res.status(result.status || 502).json({ success: false, code: result.code, error: result.error || '汽水验证完成失败' });
  return res.json({ success: true, data: result.data });
});

app.get('/api/music-account-contribution/qr/verify/:asset', async (req, res) => {
  // 二次验证页由 iframe 直接导航加载，页面内的 react.js / sdk-glue.js 等子资源请求
  // 不保证携带会话 Cookie（尤其在第三方 iframe 或受限上下文中），一旦 401 就会让
  // _SdkGlueInit 未定义、整段校验脚本中断。这里只暴露白名单静态资源，不涉及任何
  // 用户数据，因此与会话身份解耦；扫码/验证/绑定接口仍然强制校验身份。
  const asset = String(req.params.asset || '');
  if (!['security_host.html', 'react.js', 'react-dom.js', 'sdk-glue.js', 'bdms.js'].includes(asset)) return res.status(404).end();
  const result = await fetchManagedQishuiVerificationAsset(asset);
  if (!result.ok) return res.status(result.status || 502).json({ success: false, code: result.code, error: result.error || '汽水验证资源获取失败' });
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
  if (!isMusicSourceEnabled(credential.platform, getRuntimeConfig().musicSourcesEnabled)) {
    await releaseManagedMusicQrCredential(context);
    return res.status(503).json({ success: false, error: '该音源已关闭' });
  }
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
  if (!result.ok) return res.status(result.status || 400).json({ success: false, code: result.code, error: result.error || '取消共享失败' });
  return res.json({ success: true, message: result.message || '共享已取消' });
});

app.get('/api/music-account-contribution/shared', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  if (!getRuntimeConfig().sharedMembershipEnabled) {
    return res.json({ success: true, data: [] });
  }
  const result = await fetchMusicContributions(Math.min(Number(req.query.limit) || 20, 50));
  if (!result.ok) return res.status(result.status || 502).json({ success: false, code: result.code, error: result.error || '共享记录暂时不可用' });
  return res.json({ success: true, data: result.data });
});

app.get('/api/music/hot', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  const limit = parseInt(String(req.query.limit || ''), 10);
  try {
    const songs = await getHotSongs(Number.isFinite(limit) ? limit : 30);
    res.json(filterSongPayloadByArtist(songs, getRuntimeConfig().blockedArtistKeywords));
  } catch (err) {
    console.error('Hot songs error:', err.message);
    res.status(500).json({ error: '获取热榜失败' });
  }
});

app.get('/api/music/suggestions', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitMusicSuggestions(proxyLimitKey('music-suggestions', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试', suggestions: [] });
  }
  const keyword = String(req.query.q || '').trim();

  if (!keyword || keyword.length < 1) {
    return res.json({ suggestions: [] });
  }

  try {
    const suggestions = await runWithMetingRequestContext(
      { musicSuggestions: true },
      () => fetchMusicSuggestions(keyword, getRuntimeConfig().musicSourcesEnabled),
    );
    res.json({ suggestions: filterSongPayloadByArtist(suggestions, getRuntimeConfig().blockedArtistKeywords) });
  } catch (err) {
    console.error('Music suggestions error:', err.message);
    res.status(500).json({ error: '获取搜索建议失败', suggestions: [] });
  }
});

app.get('/api/music/toplist/netease', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!isMusicSourceEnabled('netease', getRuntimeConfig().musicSourcesEnabled)) {
    return res.status(503).json({ error: '网易音源已关闭' });
  }
  if (!limitProxyRequest(proxyLimitKey('toplist', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  const limit = parseInt(String(req.query.limit || ''), 10);
  try {
    const data = await fetchNeteaseHotToplist(Number.isFinite(limit) ? limit : 200);
    res.json(filterSongPayloadByArtist(data, getRuntimeConfig().blockedArtistKeywords));
  } catch (err) {
    console.error('Netease toplist error:', err.message);
    res.status(502).json({ error: err.message || '获取热榜失败' });
  }
});

app.get('/api/music/netease/playlists/meta', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!isMusicSourceEnabled('netease', getRuntimeConfig().musicSourcesEnabled)) {
    return res.status(503).json({ error: '网易音源已关闭' });
  }
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

app.get('/api/music/netease/playlists/search', (req, res, next) => {
  if (!isMusicSourceEnabled('netease', getRuntimeConfig().musicSourcesEnabled)) {
    return res.status(503).json({ error: '网易音源已关闭' });
  }
  return next();
}, createNeteasePlaylistSearchHandler({
  requireIdentity: requireSessionIdentity,
  consumeLimit: (req) => limitProxyRequest(proxyLimitKey('playlist-search', req)),
  findPresence: findUserRoomPresence,
}));

app.get('/api/music/sources', async (_req, res) => {
  const enabled = getRuntimeConfig().musicSourcesEnabled;
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
  ].filter((source) => isMusicSourceEnabled(source.id, enabled));
  try {
    const metingQishui = await hasMetingVipAccount('qishui');
    if (isMusicSourceEnabled('qishui', enabled) && metingQishui.ok && metingQishui.hasVip) {
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
  if (isMusicSourceEnabled('kugou', enabled)) {
    sources.push({
      id: 'kugou',
      name: '酷狗',
      shortName: '酷狗',
      color: '#2688ee',
      supportsSearch: true,
      supportsIdLookup: true,
      description: '酷狗音乐曲库与会员音源',
    });
  }
  res.json(sources);
});

/** 本机音质能力：是否开放 SVIP 档（管理后台可开关） */
app.get('/api/music/quality-capabilities', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  const { svipQualityEnabled = {} } = getRuntimeConfig();
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
    // 能力探测只反映上游会员状态，是否对前端开放由后台按平台开关决定。
  } catch {
    // 共享池暂时不可用时保留管理后台开关状态。
  }
  res.json({
    svipQualityEnabled: Object.fromEntries(['netease', 'tencent', 'kugou', 'qishui'].map((platform) => [
      platform, Boolean(svipQualityEnabled?.[platform]),
    ])),
    sharedSvip,
    neteaseSvip,
    tencentSvip,
    qishuiVip,
    qishuiSvip,
  });
});

app.get('/api/meting', async (req, res) => {
  if (req.publicMetingCover) {
    const rate = await distributedSocketRateLimiter.consume({ scope: 'http:public-cover', principal: `ip:${getRequestIp(req)}`, windowMs: 60_000, max: 240 });
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
      return res.status(rate.unavailable ? 503 : 429).json({ error: '封面请求暂时繁忙，请稍后重试', code: rate.unavailable ? 'COVER_UNAVAILABLE' : 'COVER_RATE_LIMITED' });
    }
    const { server, id } = req.query;
    if (!isMusicSourceEnabled(server, getRuntimeConfig().musicSourcesEnabled)) return res.status(503).json({ error: '该音源已关闭' });
    return proxyMetingResponse({ server, id, type: 'pic' }, res, Math.min(2048, Number(req.query.size) || 320), 'pic', req);
  }
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;

  const query = { ...(req.metingQueryOverride || req.query) };
  const source = String(query.server || '').trim().toLowerCase();
  const enabled = getRuntimeConfig().musicSourcesEnabled;
  if (!req.riskMetingFallback && !isMusicSourceEnabled(source, enabled)) return res.status(503).json({ error: '该音源已关闭' });

  try {
    const thumbPx = req.riskMetingFallback ? 0 : parseInt(String(req.query.size || ''), 10) || 0;
    delete query.size;
    const presence = req.riskMetingFallback ? null : findUserRoomPresence(identity.userId);
    await runWithMetingRequestContext(
      {
        userId: identity.userId,
        userNickname: presence?.userNickname || '',
        clientIp: getRequestIp(req),
        roomId: presence?.roomId || '',
        roomName: presence?.roomName || '',
      },
      () => proxyMetingResponse(query, res, thumbPx, String(query.type || ''), req),
    );
  } catch (err) {
    const message = formatMetingFetchError(err);
    console.error('Meting proxy error:', message);
    if (err?.code && Number(err.status) >= 400 && Number(err.status) <= 599) {
      return res.status(err.status).json({ success: false, error: message, code: err.code });
    }
    // 仅明确无链才作为曲目业务失败，不能把任意上游 403 当作歌曲无源
    if (/no\s*url|空播放|未返回有效媒体|不可播外链/i.test(message)) {
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

const qishuiPlaybackSourceCache = createMetingResponseCache({
  ttlMs: 10 * 60 * 1000,
  maxEntries: 512,
});

/** 仅从 Meting 获取汽水 CDN 地址和本次音频密钥，解密始终在客户端完成。 */
async function resolveQishuiPlaybackSourceUncached(rawUrl, signal) {
  const sourceEndpoint = new URL(rawUrl);
  sourceEndpoint.searchParams.set('mode', 'source');
  const metadataResponse = await fetchMeting(sourceEndpoint.toString(), { signal, headers: buildMetingAuthHeaders(sourceEndpoint.toString()) }, 15_000);
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

async function resolveQishuiPlaybackSource(rawUrl, signal) {
  return qishuiPlaybackSourceCache.get(
    String(rawUrl || '').trim(),
    () => resolveQishuiPlaybackSourceUncached(rawUrl, signal),
  );
}

/** 浏览器本地解密模式：只返回短时有效的汽水 CDN 地址和本次音频密钥。 */
app.get('/api/qishui-source', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  if (!isMusicSourceEnabled('qishui', getRuntimeConfig().musicSourcesEnabled)) return res.status(503).json({ error: '汽水音源已关闭' });

  const token = String(req.query.t || '').trim();
  const rawUrl = token ? await resolveQishuiSourceToken(token, req.riskAccount?.id || req.account?.id || '') : '';
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
    clientIp: getRequestIp(req),
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
      method: req.method,
      range: req.headers.range,
      ifRange: req.headers['if-range'],
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
  if (!isMusicSourceEnabled('kugou', getRuntimeConfig().musicSourcesEnabled)) return res.status(503).json({ error: '酷狗音源已关闭' });
  if (!limitProxyRequest(proxyLimitKey('kugou', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const keyword = String(req.query.q || '').trim();
  const num = Math.min(Math.max(parseInt(String(req.query.num || '15'), 10) || 15, 1), 30);

  if (!keyword) return res.json([]);

  try {
    const response = await fetchMetingApi({
      server: 'kugou',
      type: 'search',
      id: keyword,
      limit: num,
    });
    if (!response.ok) return res.status(response.status).json({ error: '酷狗音乐搜索失败' });
    return res.json(await response.json());
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
  if (platform !== 'netease' && platform !== 'qq' && platform !== 'kugou' && platform !== 'qishui') {
    return res.status(400).json({ error: '不支持的平台' });
  }
  const source = platform === 'qq' ? 'tencent' : platform;
  if (!isMusicSourceEnabled(source, getRuntimeConfig().musicSourcesEnabled)) {
    return res.status(503).json({ error: `${platform === 'qq' ? 'QQ' : platform === 'kugou' ? '酷狗' : platform === 'qishui' ? '汽水' : '网易'}音源已关闭` });
  }

  try {
    const result = platform === 'netease'
      ? await importNeteasePlaylist(input)
      : platform === 'qq' ? await importQqPlaylist(input)
        : platform === 'kugou' ? await importKugouPlaylist(input)
          : await importQishuiPlaylist(input);
    res.json(result);
  } catch (err) {
    console.error('Playlist import error:', err.message);
    res.status(400).json({ error: err.message || '歌单导入失败' });
  }
});

/** 酷狗音乐详情兼容接口：默认走 Meting，自定义接口由 Meting 上游层兜底。 */
async function handleKugouSong(req, res) {
  if (!requireSessionIdentity(req, res)) return;
  if (!isMusicSourceEnabled('kugou', getRuntimeConfig().musicSourcesEnabled)) return res.status(503).json({ error: '酷狗音源已关闭' });
  if (!limitProxyRequest(proxyLimitKey('kugou-song', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: '缺少歌曲 id' });

  try {
    const response = await fetchMetingApi({ server: 'kugou', type: 'song', id });
    if (!response.ok) return res.status(response.status).json({ error: '歌曲不存在或接口未返回可用结果' });
    const data = await response.json();
    const detail = Array.isArray(data) ? data[0] : data;
    if (!detail || typeof detail !== 'object') {
      return res.status(404).json({ error: '歌曲不存在或接口未返回可用结果' });
    }
    return res.json({ id, source: 'kugou', ...detail });
  } catch (err) {
    console.error('Kugou song error:', err.message);
    res.status(502).json({ error: '酷狗音乐获取失败' });
  }
}

app.get('/api/music/kugou/song', handleKugouSong);

const IDENTITY_UID_COOKIE = 'openmusic_uid';
const IDENTITY_TOKEN_COOKIE = 'openmusic_token';
const DEVICE_ID_COOKIE = 'openmusic_did';
const GUEST_HANDOFF_COOKIE = 'openmusic_guest_handoff';
const GUEST_HANDOFF_TTL_SEC = 10 * 60;
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
  appendSetCookieHeaders(res, cookies);
}

function appendSetCookieHeaders(res, cookies) {
  const existing = res.getHeader('Set-Cookie');
  const current = Array.isArray(existing)
    ? existing
    : existing
      ? [String(existing)]
      : [];
  res.setHeader('Set-Cookie', [...current, ...cookies]);
}

function accountCookieBase(res, maxAgeSec) {
  const useSecureCookie = (IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || res.req?.secure;
  const secure = useSecureCookie ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure}`;
}

function setAccountSessionCookie(res, session) {
  const accessAge = Math.max(0, Math.min(ACCOUNT_SESSION_TTL_SEC, Math.floor((session.expiresAt - Date.now()) / 1000)));
  const refreshAge = Math.max(0, Math.floor((session.refreshExpiresAt - Date.now()) / 1000));
  const secure = ((IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || res.req?.secure) ? '; Secure' : '';
  appendSetCookieHeaders(res, [
    `${ACCOUNT_SESSION_COOKIE}=${encodeURIComponent(session.accessToken)}; ${accountCookieBase(res, accessAge)}`,
    `${ACCOUNT_REFRESH_COOKIE}=${encodeURIComponent(session.refreshToken)}; Path=/api/auth; Max-Age=${refreshAge}; HttpOnly; SameSite=Strict${secure}`,
  ]);
}

function clearAccountSessionCookie(res, clearRefresh = false) {
  appendSetCookieHeaders(res, [
    `${ACCOUNT_SESSION_COOKIE}=; ${accountCookieBase(res, 0)}`,
  ]);
  if (clearRefresh) {
    const secure = ((IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || res.req?.secure) ? '; Secure' : '';
    appendSetCookieHeaders(res, [`${ACCOUNT_REFRESH_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict${secure}`]);
  }
}

function accountOAuthCookieName(provider) {
  return `openmusic_account_oauth_${provider}`;
}

function setAccountOAuthCookie(res, provider, token) {
  const secure = ((IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || res.req?.secure) ? '; Secure' : '';
  appendSetCookieHeaders(res, [`${accountOAuthCookieName(provider)}=${token}; Path=/api/auth/${provider}; Max-Age=${token ? 600 : 0}; HttpOnly; SameSite=Lax${secure}`]);
}

function accountOAuthChallengeKey(provider, token) {
  return `openmusic:account:oauth-challenge:${provider}:${createHash('sha256').update(token).digest('hex')}`;
}

async function issueAccountOAuthState(req, res, provider, signState, payload) {
  const store = getRedisClient();
  if (!isRedisEnabled() || !store) throw new AccountAuthError('REDIS_UNAVAILABLE', '账户登录存储暂不可用，请稍后重试', 503);
  const token = randomBytes(32).toString('base64url');
  const deviceKey = payload.purpose === 'account-login'
    ? (req.headers?.['x-openmusic-device'] !== undefined ? loginDeviceKey(req) : readLoginDeviceCookie(req)) : undefined;
  const state = signState({ ...payload, ...(deviceKey ? { deviceKey } : {}), nonce: randomBytes(24).toString('base64url') });
  try {
    const saved = await store.set(accountOAuthChallengeKey(provider, token), createHash('sha256').update(state).digest('hex'), { NX: true, EX: 600 });
    if (saved !== 'OK') throw new Error('challenge not saved');
  } catch {
    throw new AccountAuthError('REDIS_UNAVAILABLE', '账户登录存储暂不可用，请稍后重试', 503);
  }
  setAccountOAuthCookie(res, provider, token);
  return state;
}

async function consumeAccountOAuthState(req, res, provider, state) {
  const token = parseCookieHeader(req.headers?.cookie || '')[accountOAuthCookieName(provider)];
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(token) || typeof state !== 'string' || state.length > 4096) return false;
  const store = getRedisClient();
  if (!isRedisEnabled() || !store) throw new AccountAuthError('REDIS_UNAVAILABLE', '账户登录存储暂不可用，请稍后重试', 503);
  let consumed;
  try {
    consumed = await evalRedisScript(store, `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('DEL', KEYS[1])`, {
      keys: [accountOAuthChallengeKey(provider, token)],
      arguments: [createHash('sha256').update(state).digest('hex')],
    });
  } catch {
    throw new AccountAuthError('REDIS_UNAVAILABLE', '账户登录存储暂不可用，请稍后重试', 503);
  }
  if (Number(consumed) !== 1) return false;
  setAccountOAuthCookie(res, provider, '');
  return true;
}

async function replaceAccountSession(req, res, session) {
  const previousToken = resolveAccountSessionToken(req);
  if (previousToken || resolveAccountRefreshToken(req)) {
    await revokeAccountSession(previousToken, resolveAccountRefreshToken(req));
    disconnectSocketsForAccountSession(previousToken, 'account_changed');
  }
  setAccountSessionCookie(res, session);
}

function resolveAccountSessionToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  return String(cookies[ACCOUNT_SESSION_COOKIE] || '').trim();
}

function resolveAccountRefreshToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  return String(cookies[ACCOUNT_REFRESH_COOKIE] || '').trim();
}

function accountSessionMetadata(session) {
  return { deviceMigrationRequired: session.deviceMigrationRequired === true, deviceKeyId: session.deviceKeyId, sessionId: session.sessionId, expiresAt: session.expiresAt, refreshExpiresAt: session.refreshExpiresAt, serverTime: Date.now() };
}

async function resolveAccountFromRequest(req) {
  if (req.account) return req.account;
  const token = resolveAccountSessionToken(req);
  if (!token) return null;
  const session = await inspectAccountSession(token);
  req.accountSession = session;
  return session?.account || null;
}

async function resolveAnonymousAccount(req) {
  return createAnonymousAccess({
    getConfig: getRuntimeConfig,
    resolveIdentity: resolveIdentityFromRequest,
    getIdentityOwner: getRoomIdentityOwnerAccountId,
  })(req);
}

async function createTrackedAccountSession(req, account, method, registration = false) {
  await riskControl.recordLogin(account, {
    ip: getRequestIp(req), method, registration,
    userAgent: req.headers['user-agent'] || '', humanVerifiedAt: req.humanVerifiedAt || 0,
  });
  return createAccountSession(account.id, req.oauthDeviceKey || req.loginDeviceKey || optionalLoginDeviceKey(req), { allowLegacy: true });
}

/** 将账户会话绑定到稳定的房间 userId，并把当前设备切换到该身份。 */
async function syncAccountRoomIdentity(req, res, account) {
  if (!account?.id) return null;
  const requestIdentity = resolveIdentityFromRequest(req);
  const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  let currentIdentity = requestIdentity;
  if (!currentIdentity && cookieDeviceId) {
    const userId = await getUserIdForDevice(cookieDeviceId, { authoritative: true });
    if (userId) currentIdentity = { userId };
  }
  const roomUserId = await ensureRoomUserId(account.id, currentIdentity?.userId || '');
  const previousAccount = await resolveAccountFromRequest(req);
  const sourceIdentityOwnerId = currentIdentity?.userId
    ? await getRoomIdentityOwnerAccountId(currentIdentity.userId)
    : null;
  const migrateGuest = shouldMigrateFavorites(
    currentIdentity,
    roomUserId,
    Boolean(previousAccount),
    Boolean(sourceIdentityOwnerId),
  );
  if (migrateGuest) {
    const guestFavorites = await listFavoriteSongs(currentIdentity.userId);
    const accountFavorites = await listFavoriteSongs(roomUserId);
    const guestCategories = await listFavoriteCategories(currentIdentity.userId);
    const accountCategories = await listFavoriteCategories(roomUserId);
    const migration = analyzeFavoritesMigration({
      accountFavorites,
      guestFavorites,
      accountCategories,
      guestCategories,
    });
    if (migration.droppedFavorites > 0 || migration.droppedCategories > 0) {
      incrementMetric('account_favorites_migration_total', { outcome: 'capacity_rejected' });
      throw new AccountAuthError(
        'FAVORITES_MIGRATION_CAPACITY',
        `账户与游客收藏合并后超过容量上限，请先导出并减少当前游客收藏后重试（歌曲超出 ${migration.droppedFavorites || 0} 首，分类超出 ${migration.droppedCategories || 0} 个）`,
        409,
      );
    }
    if (guestCategories.length > 0) {
      const migratedCategories = await importFavoriteCategories(roomUserId, guestCategories);
      if (migratedCategories.error) {
        throw new Error(`登录后收藏分类迁移失败: ${migratedCategories.error}`);
      }
    }
    if (guestFavorites.length > 0) {
      const categories = await listFavoriteCategories(roomUserId);
      const migratedFavorites = await importFavoriteSongs(
        roomUserId,
        filterFavoriteCategories(guestFavorites, categories),
        { preserveExistingOrder: true },
      );
      if (migratedFavorites.error || migratedFavorites.dropped > 0) {
        throw new Error(`登录后收藏迁移失败: ${migratedFavorites.error || `容量不足，仍有 ${migratedFavorites.dropped} 首未迁移`}`);
      }
    }
    if (guestFavorites.length > 0 || guestCategories.length > 0) {
      await retainMigratedFavoriteSource(currentIdentity.userId);
      incrementMetric('account_favorites_migration_total', { outcome: 'redis_to_redis' });
    }
  }
  const roomMigration = currentIdentity?.userId && (currentIdentity.userId === roomUserId || migrateGuest)
    ? claimRoomsForAccountIdentity(currentIdentity.userId, roomUserId, account.id)
    : { claimedRoomIds: [], conflictedRoomIds: [] };
  if (currentIdentity?.userId && (!sourceIdentityOwnerId || sourceIdentityOwnerId === account.id)
    && (currentIdentity.userId === roomUserId || migrateGuest)) {
    await accountMusic.migrateAnonymous(account.id, currentIdentity.userId);
  }
  if (roomMigration.claimedRoomIds.length > 0) {
    await Promise.all(roomMigration.claimedRoomIds.map((roomId) => addRoomToAccountIndex(account.id, roomId)));
    for (const roomId of roomMigration.claimedRoomIds) {
      await accountMusic.rememberRoom(account.id, getRoomInternal(roomId));
    }
    for (let index = 0; index < roomMigration.claimedRoomIds.length; index += 1) incrementMetric('account_room_migration_total', { outcome: 'claimed' });
  }
  if (roomMigration.conflictedRoomIds.length > 0) {
    for (let index = 0; index < roomMigration.conflictedRoomIds.length; index += 1) incrementMetric('account_room_migration_total', { outcome: 'conflict' });
  }
  if (shouldIssueGuestHandoff(
    currentIdentity,
    roomUserId,
    Boolean(previousAccount),
    Boolean(sourceIdentityOwnerId),
  )) {
    setGuestHandoffCookie(res, currentIdentity.userId, roomUserId);
  }
  const deviceId = cookieDeviceId || createServerClientId();
  const now = Math.floor(Date.now() / 1000);
  if (!await linkDeviceToUser(deviceId, roomUserId)) throw new AccountAuthError('SESSION_STORAGE_UNAVAILABLE', '身份存储暂不可用，请稍后重试', 503);
  if (!cookieDeviceId || shouldRefreshRoomIdentity(requestIdentity, roomUserId)) {
    setIdentityCookieHeaders(res, roomUserId, signClientId(roomUserId, now), deviceId);
  }
  account.roomUserId = roomUserId;
  return roomUserId;
}

function signGuestHandoff(sourceUserId, targetUserId, issuedAt = Math.floor(Date.now() / 1000)) {
  const source = sanitizeClientId(sourceUserId);
  const target = sanitizeClientId(targetUserId);
  if (!source || !target) return '';
  const payload = `${source}.${target}.${issuedAt}`;
  const signature = createHmac('sha256', CLIENT_ID_SECRET).update(`guest-handoff:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyGuestHandoff(rawValue, targetUserId) {
  const raw = String(rawValue || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [source, target, issuedAtRaw, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (!sanitizeClientId(source) || !sanitizeClientId(target) || target !== sanitizeClientId(targetUserId)) return null;
  if (!Number.isFinite(issuedAt) || Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > GUEST_HANDOFF_TTL_SEC) return null;
  const expected = createHmac('sha256', CLIENT_ID_SECRET).update(`guest-handoff:${source}.${target}.${issuedAt}`).digest('base64url');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { sourceUserId: source, targetUserId: target, issuedAt };
}

function setGuestHandoffCookie(res, sourceUserId, targetUserId) {
  const value = signGuestHandoff(sourceUserId, targetUserId);
  if (!value) return;
  const secure = ((IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || res.req?.secure) ? '; Secure' : '';
  appendSetCookieHeaders(res, [`${GUEST_HANDOFF_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${GUEST_HANDOFF_TTL_SEC}; HttpOnly; SameSite=Lax${secure}`]);
}

async function requireAccountSession(req, res) {
  const account = await resolveAccountFromRequest(req);
  if (account && !account.anonymous) {
    await riskControl.assertAllowed(account.id);
    return account;
  }
  clearAccountSessionCookie(res);
  res.status(401).json({ error: '请先登录账户', code: 'ACCOUNT_AUTH_REQUIRED' });
  return null;
}

async function requireRiskSession(req, res) {
  const account = await resolveAccountFromRequest(req) || await resolveAnonymousAccount(req);
  if (!account) {
    res.status(401).json({ error: '请先登录账户', code: 'ACCOUNT_AUTH_REQUIRED' });
    return null;
  }
  await riskControl.assertAllowed(account.id);
  if (!account.anonymous) await verifyAccountDeviceRequest(resolveAccountSessionToken(req), req, { ip: getRequestIp(req) });
  return account;
}

function appendAccountAuthResult(returnPath, result) {
  const path = sanitizeReturnPath(returnPath);
  return `${path}?account_auth=${encodeURIComponent(result)}`;
}

function clearWechatLoginProofCookie(res) {
  res.append(
    'Set-Cookie',
    `${WECHAT_LOGIN_PROOF_COOKIE}=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Strict${res.req?.secure ? '; Secure' : ''}`,
  );
}

function readWechatAccountLoginCookie(req) {
  return parseCookieHeader(req.headers?.cookie || '')[WECHAT_ACCOUNT_LOGIN_COOKIE] || '';
}

function setWechatAccountLoginCookie(res, token) {
  const secure = ((IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || res.req?.secure) ? '; Secure' : '';
  res.append('Set-Cookie', `${WECHAT_ACCOUNT_LOGIN_COOKIE}=${encodeURIComponent(token)}; Path=/api/auth/wechat; Max-Age=${token ? WECHAT_ACCOUNT_LOGIN_TTL_SEC : 0}; HttpOnly; SameSite=Strict${secure}`);
}

async function consumeWechatLoginProof(req, res) {
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  const proof = verifyWechatLoginProof(cookies[WECHAT_LOGIN_PROOF_COOKIE]);
  clearWechatLoginProofCookie(res);
  if (!proof) return null;
  const store = getRedisClient();
  if (!isRedisEnabled() || !store) {
    throw new AccountAuthError('REDIS_UNAVAILABLE', '账户服务暂不可用，请稍后重试', 503);
  }
  return claimWechatLoginProof(proof, store);
}

function sendPublicRegistrationError(res, error) {
  // 已注册邮箱与无效/过期验证码统一对外响应，避免注册接口成为账户枚举器。
  if (error instanceof AccountAuthError && ['EMAIL_ALREADY_REGISTERED', 'INVALID_EMAIL_CODE'].includes(error.code)) {
    return res.status(400).json({
      error: '无法完成注册，请检查信息或直接登录',
      code: 'REGISTRATION_UNAVAILABLE',
    });
  }
  return sendAccountAuthError(res, error);
}

function sendAccountAuthError(res, error) {
  if (error instanceof WechatAccountLoginError) {
    if (error.status === 429) res.setHeader('Retry-After', '60');
    return res.status(error.status).json({ error: error.message, code: error.code,
      ...(error instanceof WechatAccountLoginError && error.stage ? { stage: error.stage } : {}) });
  }
  if (error instanceof AccountTokenError || error instanceof DeviceProofError) {
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error instanceof RiskControlError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof AccountAuthError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error('账户认证请求失败:', error?.message || error);
  return res.status(500).json({ error: '账户服务暂不可用，请稍后重试', code: 'ACCOUNT_SERVICE_ERROR' });
}

function logWechatAccountFailure(error, stage = 'request') {
  if (!(error instanceof WechatAccountLoginError)) return;
  console.error('微信账户官方验证失败', {
    stage: error.stage || stage,
    code: error.code,
    ...(Number.isSafeInteger(error.officialCode) ? { officialCode: error.officialCode } : {}),
    ...(Number.isInteger(error.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}),
  });
}

function recordAccountAuthMetric(action, outcome) {
  incrementMetric('account_auth_total', { action, outcome });
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
  res.setHeader('Cache-Control', 'no-store, private');
  const runtime = getRuntimeConfig();
  if (!res.req.account && !runtime.anonymousLoginEnabled) return res.json({ authenticated: false, loginRequired: true });
  const payload = {
    clientId: userId,
    features: {
      svipQualityEnabled: runtime.svipQualityEnabled,
      sharedMembershipEnabled: Boolean(runtime.sharedMembershipEnabled),
      qqGroupUrl: runtime.qqGroupUrl,
      musicSourcesEnabled: runtime.musicSourcesEnabled,
    },
  };
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
  try {
    const account = await resolveAccountFromRequest(req);
    if (account) {
      await riskControl.sessionStatus(account.id);
      const roomUserId = account.roomUserId || await ensureRoomUserId(account.id);
      req.account = account;
      const deviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '') || createServerClientId();
      if (!await linkDeviceToUser(deviceId, roomUserId)) throw new Error('设备绑定未持久化');
      const existing = resolveIdentityFromRequest(req);
      const now = Math.floor(Date.now() / 1000);
      const issuedAt = existing?.userId === roomUserId && existing.expiresAt - now > SESSION_RENEW_WITHIN_SEC ? existing.iat : now;
      return sendBootstrapResponse(res, roomUserId, issuedAt, signClientId(roomUserId, issuedAt), deviceId);
    }
    const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
    const bodyDeviceId = resolveBodyDeviceId(req);
    const now = Math.floor(Date.now() / 1000);

    const existing = resolveIdentityFromRequest(req);
    if (existing && (!getRuntimeConfig().anonymousLoginEnabled || !await getRoomIdentityOwnerAccountId(existing.userId))) {
      // 已认证：可用 body deviceId 对齐绑定；恢复路径不依赖 body
      const deviceId = cookieDeviceId || bodyDeviceId || createServerClientId();
      if (!await linkDeviceToUser(deviceId, existing.userId)) throw new Error('设备绑定未持久化');
      const shouldRenew = existing.expiresAt - now <= SESSION_RENEW_WITHIN_SEC;
      const signIat = shouldRenew ? now : existing.iat;
      const token = signClientId(existing.userId, signIat);
      return sendBootstrapResponse(res, existing.userId, signIat, token, deviceId);
    }

    // 无身份 Cookie：仅允许 HttpOnly openmusic_did 恢复同一 userId
    if (cookieDeviceId) {
      const boundUserId = await getUserIdForDevice(cookieDeviceId, { authoritative: getRuntimeConfig().anonymousLoginEnabled });
      if (boundUserId && (!getRuntimeConfig().anonymousLoginEnabled || !await getRoomIdentityOwnerAccountId(boundUserId))) {
        if (!await linkDeviceToUser(cookieDeviceId, boundUserId)) throw new Error('设备绑定未持久化');
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
    if (!await linkDeviceToUser(deviceId, userId)) throw new Error('设备绑定未持久化');
    const signIat = now;
    return sendBootstrapResponse(res, userId, signIat, signClientId(userId, signIat), deviceId);
  } catch (error) {
    if (['ACCOUNT_RISK_BLOCKED', 'RISK_STORAGE_UNAVAILABLE'].includes(error?.code)) return sendAccountAuthError(res, error);
    incrementMetric('session_bootstrap_storage_error_total');
    return res.status(503).json({
      error: '身份存储暂不可用，请稍后重试',
      code: 'SESSION_STORAGE_UNAVAILABLE',
    });
  }
});

// ---------- 普通用户账户：邮箱验证码注册 / 账号密码登录 ----------
// 账户会话与设备身份分离，匿名访问由后台运行配置裁决

const verifyTurnstile = createTurnstileVerifier({ getConfig: getRuntimeConfig });
const verifyRiskTurnstile = createTurnstileVerifier({ getConfig: getRuntimeConfig, action: 'risk_challenge' });

function readLoginDeviceCookie(req) {
  try {
    const raw = parseCookieHeader(req.headers?.cookie || '').openmusic_login_device || '';
    if (!raw) return undefined;
    const [payload, signature] = raw.split('.');
    const expected = createHmac('sha256', CLIENT_ID_SECRET).update(`login-device:${payload}`).digest('base64url');
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error();
    const data = JSON.parse(Buffer.from(payload, 'base64url'));
    if (!Number.isSafeInteger(data.at) || Math.abs(Date.now() - data.at) > 600000) throw new Error();
    return normalizeDeviceKey(data.key);
  } catch { throw new AccountAuthError('ACCOUNT_DEVICE_PROOF_REQUIRED', '请从登录页面重新开始授权', 401); }
}

function optionalLoginDeviceKey(req) {
  return req.headers?.['x-openmusic-device'] === undefined ? undefined : loginDeviceKey(req);
}

app.post('/api/auth/device-login', (req, res) => {
  if (!limitAccountRefresh(`device-login:${getRequestIp(req)}`)) return res.status(429).json({ code: 'ACCOUNT_DEVICE_RATE_LIMITED', error: '设备验证过于频繁，请稍后重试' });
  try {
    const key = loginDeviceKey(req);
    const payload = Buffer.from(JSON.stringify({ key, at: Date.now() })).toString('base64url');
    const signature = createHmac('sha256', CLIENT_ID_SECRET).update(`login-device:${payload}`).digest('base64url');
    appendSetCookieHeaders(res, [`openmusic_login_device=${payload}.${signature}; Path=/api/auth; Max-Age=600; HttpOnly; SameSite=Lax${((IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || req.secure) ? '; Secure' : ''}`]);
    return res.json({ ok: true });
  } catch (error) { return res.status(error.status || 400).json({ code: error.code || 'ACCOUNT_DEVICE_PROOF_REQUIRED', error: '设备验证失败，请重新登录' }); }
});

app.post('/api/auth/device-migrate', async (req, res) => {
  if (!limitAccountRefresh(`device-migrate:${getRequestIp(req)}`)) return res.status(429).json({ code: 'ACCOUNT_DEVICE_RATE_LIMITED', error: '设备升级过于频繁，请稍后重试' });
  try {
    const token = resolveAccountSessionToken(req);
    const deviceKey = loginDeviceKey(req);
    const session = await bindAccountDeviceKey(token, deviceKey, { refreshToken: resolveAccountRefreshToken(req) });
    if (session.accessToken) setAccountSessionCookie(res, session);
    recordAccountAuthMetric('device_migrate', 'success');
    return res.json({ ok: true, session: accountSessionMetadata(session) });
  } catch (error) {
    recordAccountAuthMetric('device_migrate', error.code || 'error');
    return sendAccountAuthError(res, error);
  }
});

app.get('/api/auth/human-challenge', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Surrogate-Control', 'no-store');
  res.vary('Cookie');
  try {
    const account = await requireRiskSession(req, res);
    if (!account) return;
    const config = getRuntimeConfig();
    const state = await riskControl.humanChallengeStatus(account.id);
    return res.json(publicHumanChallengeState(state, config));
  } catch (error) { return sendAccountAuthError(res, error); }
});

app.post('/api/auth/human-challenge', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Surrogate-Control', 'no-store');
  res.vary('Cookie');
  try {
    const account = await requireRiskSession(req, res);
    if (!account) return;
    const config = getRuntimeConfig();
    if (!config.riskChallengeEnabled || !config.turnstileEnabled) return res.status(409).json({ code: 'HUMAN_CHECK_DISABLED', error: '异常访问验证当前未启用' });
    const ip = getRequestIp(req);
    const rate = await distributedSocketRateLimiter.consume({ scope: 'risk-human-check', principal: `account:${account.id}`, windowMs: 60000, max: 10 });
    if (!rate.allowed) return res.status(rate.unavailable ? 503 : 429).json({ code: 'HUMAN_CHECK_UNAVAILABLE', error: '验证暂不可用或过于频繁，请稍后重试' });
    const state = await riskControl.humanChallengeStatus(account.id);
    if (!state.pending || state.bypass || state.challengeId !== req.body?.challengeId) return res.status(409).json({ code: 'HUMAN_CHECK_CHANGED', error: '验证状态已变化，请重新加载' });
    const verifiedAt = await verifyRiskTurnstile(req.body?.turnstileToken, ip, state.challengeId);
    if (!verifiedAt) return res.status(503).json({ code: 'HUMAN_CHECK_UNAVAILABLE', error: '验证配置已变化，请重新加载' });
    const result = await riskControl.completeHumanChallenge(account.id, state.challengeId);
    incrementMetric('risk_human_check_total', { outcome: 'passed' });
    return res.json({ ok: true, ...publicHumanChallengeState(result, getRuntimeConfig()) });
  } catch (error) {
    incrementMetric('risk_human_check_total', { outcome: 'rejected' });
    if (['HUMAN_CHECK_REQUIRED', 'HUMAN_CHECK_FAILED', 'HUMAN_CHECK_UNAVAILABLE'].includes(error.code)) return res.status(error.status || 503).json({ code: error.code, error: error.message });
    return sendAccountAuthError(res, error);
  }
});

async function verifyAccountChallenge(req, res) {
  if (!getRuntimeConfig().turnstileEnabled) return true;
  try {
    const ip = getRequestIp(req);
    const rate = await distributedSocketRateLimiter.consume({ scope: 'human-check', principal: `ip:${ip}`, windowMs: 60000, max: 20 });
    if (!rate.allowed) {
      incrementMetric('human_check_total', { outcome: rate.unavailable ? 'unavailable' : 'rate_limited' });
      res.setHeader('Retry-After', '60');
      res.status(rate.unavailable ? 503 : 429).json({ error: '人机校验暂不可用或过于频繁，请稍后重试', code: rate.unavailable ? 'HUMAN_CHECK_UNAVAILABLE' : 'HUMAN_CHECK_RATE_LIMITED' });
      return false;
    }
    req.humanVerifiedAt = await verifyTurnstile(req.body?.turnstileToken, ip);
    incrementMetric('human_check_total', { outcome: 'verified' });
    return true;
  } catch (error) {
    incrementMetric('human_check_total', { outcome: error.code === 'HUMAN_CHECK_UNAVAILABLE' ? 'unavailable' : 'rejected' });
    res.status(error.status || 503).json({ error: error.code?.startsWith('HUMAN_CHECK_') ? error.message : '人机校验暂不可用', code: error.code?.startsWith('HUMAN_CHECK_') ? error.code : 'HUMAN_CHECK_UNAVAILABLE' });
    return false;
  }
}

app.post('/api/auth/email/code', async (req, res) => {
  const ip = getRequestIp(req);
  const email = normalizeEmail(req.body?.email);
  if (!limitAccountEmailCodeIp(`account-email-code:${ip}`)) {
    recordAccountAuthMetric('email_code', 'rate_limited');
    return res.status(429).json({ error: '验证码发送过于频繁，请稍后重试', code: 'EMAIL_CODE_RATE_LIMITED' });
  }
  if (email && !limitAccountEmailCodeEmail(`account-email-code:${email}`)) {
    recordAccountAuthMetric('email_code', 'rate_limited');
    return res.status(429).json({ error: '验证码发送过于频繁，请稍后重试', code: 'EMAIL_CODE_RATE_LIMITED' });
  }

  try {
    if (!await verifyAccountChallenge(req, res)) return;
    const result = await requestEmailRegistrationCode({ email: req.body?.email });
    appendAdminAudit('account_email_code_request', {
      outcome: 'accepted',
      emailHash: email ? createHash('sha256').update(email).digest('hex').slice(0, 16) : '',
    }, ip);
    recordAccountAuthMetric('email_code', 'success');
    return res.json({ ok: true, ...result });
  } catch (error) {
    const outcome = error instanceof AccountAuthError ? error.code : 'error';
    appendAdminAudit('account_email_code_request', {
      outcome,
      emailHash: email ? createHash('sha256').update(email).digest('hex').slice(0, 16) : '',
    }, ip);
    recordAccountAuthMetric('email_code', outcome);
    // 已注册账户不发送验证码，但返回与正常受理相同的结构，避免泄露邮箱状态。
    if (error instanceof AccountAuthError && error.code === 'EMAIL_ALREADY_REGISTERED') {
      return res.json({ ok: true, expiresInSec: 10 * 60, resendAfterSec: 60 });
    }
    return sendAccountAuthError(res, error);
  }
});

app.post('/api/auth/email/register', async (req, res) => {
  try {
    req.loginDeviceKey = optionalLoginDeviceKey(req);
    if (!await verifyAccountChallenge(req, res)) return;
    const account = await registerWithEmail({
      email: req.body?.email,
      password: req.body?.password,
      code: req.body?.code,
    });
    const token = await createTrackedAccountSession(req, account, 'email', true);
    await syncAccountRoomIdentity(req, res, account);
    await replaceAccountSession(req, res, token);
    recordAccountAuthMetric('email_register', 'success');
    return res.status(201).json({ ok: true, account: publicAccount(account) });
  } catch (error) {
    const outcome = error instanceof AccountAuthError ? error.code : 'error';
    appendAdminAudit('account_email_register_attempt', {
      outcome,
      emailHash: normalizeEmail(req.body?.email)
        ? createHash('sha256').update(normalizeEmail(req.body?.email)).digest('hex').slice(0, 16)
        : '',
    }, getRequestIp(req));
    recordAccountAuthMetric('email_register', outcome);
    return sendPublicRegistrationError(res, error);
  }
});

app.post('/api/auth/email/login', async (req, res) => {
  const ip = getRequestIp(req);
  const email = normalizeEmail(req.body?.email);
  const emailKey = accountLoginEmailKey(email);
  if (
    !limitAccountLogin(`account-login:${ip}`)
    || (emailKey && !limitAccountLoginEmail(`account-login-email:${emailKey}`))
    || (emailKey && !limitAccountLoginEmailIp(`account-login-email-ip:${emailKey}:${ip}`))
  ) {
    recordAccountAuthMetric('email_login', 'rate_limited');
    return res.status(429).json({ error: '登录尝试过于频繁，请稍后重试', code: 'LOGIN_RATE_LIMITED' });
  }

  await applyAccountLoginPenalty(email);
  try {
    req.loginDeviceKey = optionalLoginDeviceKey(req);
    if (!await verifyAccountChallenge(req, res)) return;
    const account = await loginWithEmail({
      email: req.body?.email,
      password: req.body?.password,
    });
    clearAccountLoginFailures(email);
    const token = await createTrackedAccountSession(req, account, 'email');
    await syncAccountRoomIdentity(req, res, account);
    await replaceAccountSession(req, res, token);
    recordAccountAuthMetric('email_login', 'success');
    return res.json({ ok: true, account: publicAccount(account) });
  } catch (error) {
    if (error instanceof AccountAuthError && error.code === 'AUTH_INVALID') {
      recordAccountLoginFailure(email);
    }
    recordAccountAuthMetric('email_login', error instanceof AccountAuthError ? error.code : 'error');
    void riskControl.recordAuthFailure({ ip, email, code: error.code || 'AUTH_ERROR' }).catch(() => incrementMetric('risk_storage_error_total', { operation: 'auth_failure' }));
    return sendAccountAuthError(res, error);
  }
});

app.get('/api/auth/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Surrogate-Control', 'no-store');
  res.vary('Cookie');
  const token = resolveAccountSessionToken(req);
  if (!token) {
    recordAccountAuthMetric('session', 'anonymous');
    return res.json({ authenticated: false, account: null, anonymousAllowed: getRuntimeConfig().anonymousLoginEnabled, deviceSessionId: resolveAccountRefreshToken(req).split('.')[0], refreshAvailable: Boolean(resolveAccountRefreshToken(req)) });
  }

  try {
    const session = await inspectAccountSession(token);
    if (!session) {
      clearAccountSessionCookie(res);
      recordAccountAuthMetric('session', 'expired');
      return res.json({ authenticated: false, account: null, anonymousAllowed: getRuntimeConfig().anonymousLoginEnabled, deviceSessionId: resolveAccountRefreshToken(req).split('.')[0], refreshAvailable: Boolean(resolveAccountRefreshToken(req)) });
    }
    const account = session.account;
    await riskControl.sessionStatus(account.id);
    await syncAccountRoomIdentity(req, res, account);
    recordAccountAuthMetric('session', session.deviceMigrationRequired ? 'legacy_compatible' : 'authenticated');
    return res.json({ authenticated: true, account: publicAccount(account), session: accountSessionMetadata(session) });
  } catch (error) {
    recordAccountAuthMetric('session', error instanceof AccountAuthError ? error.code : 'error');
    return sendAccountAuthError(res, error);
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  const ip = getRequestIp(req);
  if (!limitAccountRefresh(`account-refresh:${ip}`)) {
    res.setHeader('Retry-After', '60');
    recordAccountAuthMetric('refresh', 'rate_limited');
    return res.status(429).json({ error: '续期过于频繁，请稍后重试', code: 'ACCOUNT_REFRESH_RATE_LIMITED' });
  }
  try {
    await verifyAccountDeviceRequest(resolveAccountRefreshToken(req), req, { refresh: true, ip });
    const session = await refreshAccountSession(resolveAccountRefreshToken(req), async (account) => {
      const result = await riskControl.consume(account, { ip, kind: 'api', operation: 'refresh' });
      if (!result.allowed && (result.code !== 'ACCOUNT_RISK_BLOCKED' || result.limited)) {
        const status = result.limited ? 429 : result.status;
        const error = new AccountTokenError(result.limited ? 'ACCOUNT_RATE_LIMITED' : result.code, status === 403 ? '账户访问已受限，请联系管理员复核' : '请求额度已用尽，请稍后重试', status);
        error.retryAfter = status === 429 ? result.retryAfter : undefined;
        throw error;
      }
    });
    const account = await resolveAccountSession(session.accessToken);
    if (!account) throw new AccountTokenError('ACCOUNT_REFRESH_INVALID', '账户会话已失效，请重新登录', 401);
    await riskControl.sessionStatus(account.id);
    await syncAccountRoomIdentity(req, res, account);
    setAccountSessionCookie(res, session);
    recordAccountAuthMetric('refresh', 'success');
    return res.json({ ok: true, account: publicAccount(account), session: accountSessionMetadata(session) });
  } catch (error) {
    recordAccountAuthMetric('refresh', error.code || 'error');
    if (error.status === 401 && !(error instanceof DeviceProofError)) {
      clearAccountSessionCookie(res, true);
      void riskControl.recordAuthFailure({ ip, code: error.code }).catch(() => incrementMetric('risk_storage_error_total', { operation: 'refresh_failure' }));
    }
    return sendAccountAuthError(res, error);
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const accountSessionToken = resolveAccountSessionToken(req);
  const hadAccountSession = Boolean(accountSessionToken || resolveAccountRefreshToken(req));
  try {
    await revokeAccountSession(accountSessionToken, resolveAccountRefreshToken(req));
    disconnectSocketsForAccountSession(accountSessionToken, 'logout');
  } catch (error) {
    recordAccountAuthMetric('logout', error.code || 'error');
    return sendAccountAuthError(res, error);
  }
  clearAccountSessionCookie(res, true);
  appendSetCookieHeaders(res, [`${GUEST_HANDOFF_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${((IS_PRODUCTION && !ALLOW_INSECURE_COOKIES) || res.req?.secure) ? '; Secure' : ''}`]);
  if (hadAccountSession) {
    // 注销后切换到新的游客身份，避免同一设备在未登录状态继续读取账户数据。
    const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
    const userId = createServerClientId();
    const deviceId = cookieDeviceId || createServerClientId();
    const now = Math.floor(Date.now() / 1000);
    await linkDeviceToUser(deviceId, userId);
    setIdentityCookieHeaders(res, userId, signClientId(userId, now), deviceId);
  }
  recordAccountAuthMetric('logout', 'success');
  return res.json({ ok: true });
});

app.get('/api/auth/providers', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, private, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  res.json({
    turnstile: { enabled: getRuntimeConfig().turnstileEnabled, siteKey: getRuntimeConfig().turnstileEnabled ? getRuntimeConfig().turnstileSiteKey : '' },
    linuxdo: isLinuxdoConfigured(),
    github: isGithubConfigured(),
    // 账户微信登录复用文件传输助手扫码；会话证明由服务端签发。
    wechat: WECHAT_ACCOUNT_AUTH_ENABLED,
  });
});

app.post('/api/auth/nickname', async (req, res) => {
  try {
    const account = await requireAccountSession(req, res);
    if (!account) return;
    if (!limitAccountNickname(`nickname:${account.id}`)) {
      recordAccountAuthMetric('nickname', 'rate_limited');
      return res.status(429).json({ error: '修改昵称过于频繁，请稍后再试', code: 'NICKNAME_RATE_LIMITED' });
    }
    const updated = await updateAccountNickname(account.id, req.body?.nickname, { initializeOnly: req.body?.initializeOnly === true });
    void riskControl.recordNickname(account.id, updated.nickname)
      .catch(() => incrementMetric('risk_storage_error_total', { operation: 'nickname' }));
    recordAccountAuthMetric('nickname', 'success');
    return res.json({ ok: true, account: publicAccount(updated) });
  } catch (error) {
    recordAccountAuthMetric('nickname', error.code || 'error');
    return sendAccountAuthError(res, error);
  }
});

app.post('/api/auth/identities/:provider/unbind', async (req, res) => {
  try {
    const account = await requireAccountSession(req, res);
    if (!account) return;
    const updated = await unbindExternalIdentity(account.id, req.params.provider);
    recordAccountAuthMetric(`${req.params.provider}_unbind`, 'success');
    return res.json({ ok: true, account: publicAccount(updated) });
  } catch (error) {
    recordAccountAuthMetric(`${req.params.provider}_unbind`, error instanceof AccountAuthError ? error.code : 'error');
    return sendAccountAuthError(res, error);
  }
});

app.post('/api/auth/wechat/start', async (req, res) => {
  if (!WECHAT_ACCOUNT_AUTH_ENABLED) return res.status(503).json({ error: '微信账户登录暂未开放', code: 'WECHAT_ACCOUNT_AUTH_DISABLED' });
  try {
    const session = await wechatAccountLogin.start(getRequestIp(req), readWechatAccountLoginCookie(req));
    setWechatAccountLoginCookie(res, session.token);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ qrUrl: `/api/auth/wechat/qr?flow=${session.flowId}`, flowId: session.flowId, expiresAt: session.expiresAt });
  } catch (error) {
    recordAccountAuthMetric('wechat_start', error.code || 'error');
    logWechatAccountFailure(error, 'start');
    return sendAccountAuthError(res, error);
  }
});

app.get('/api/auth/wechat/qr', async (req, res) => {
  if (!WECHAT_ACCOUNT_AUTH_ENABLED) return res.status(503).json({ error: '微信账户登录暂未开放', code: 'WECHAT_ACCOUNT_AUTH_DISABLED' });
  try {
    res.setHeader('Cache-Control', 'no-store, private');
    const image = await wechatAccountLogin.qr(readWechatAccountLoginCookie(req), req.query.flow);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.type(image.contentType).send(image.buffer);
  } catch (error) {
    logWechatAccountFailure(error, 'qr');
    return sendAccountAuthError(res, error);
  }
});

app.post('/api/auth/wechat/poll', async (req, res) => {
  if (!WECHAT_ACCOUNT_AUTH_ENABLED) return res.status(503).json({ error: '微信账户登录暂未开放', code: 'WECHAT_ACCOUNT_AUTH_DISABLED' });
  try {
    return res.json(await wechatAccountLogin.poll(readWechatAccountLoginCookie(req), req.body?.flowId));
  } catch (error) {
    recordAccountAuthMetric('wechat_poll', error.code || 'error');
    logWechatAccountFailure(error, 'poll');
    return sendAccountAuthError(res, error);
  }
});

app.post('/api/auth/wechat/account', async (req, res) => {
  if (!WECHAT_ACCOUNT_AUTH_ENABLED) {
    return res.status(503).json({ error: '微信账户登录暂未开放', code: 'WECHAT_ACCOUNT_AUTH_DISABLED' });
  }
  if (!limitWechatUinAuth(`wechat-account:${getRequestIp(req)}`)) {
    recordAccountAuthMetric('wechat', 'rate_limited');
    return res.status(429).json({ error: '微信登录请求过于频繁，请稍后再试', code: 'LOGIN_RATE_LIMITED' });
  }
  try {
    const action = req.body?.action === 'bind' ? 'bind' : 'login';
    if (action === 'login') req.loginDeviceKey = optionalLoginDeviceKey(req);
    const current = action === 'bind' ? await requireAccountSession(req, res) : null;
    if (action === 'bind' && !current) return;
    if (action === 'bind') await verifyAccountDeviceRequest(resolveAccountSessionToken(req), req, { ip: getRequestIp(req) });
    const account = await wechatAccountLogin.complete(readWechatAccountLoginCookie(req), async ({ uin, nickname: wechatNickname }) => {
      const nickname = String(wechatNickname || '').trim();
      const profile = { username: nickname || `微信用户 ${uin.slice(-4)}` };
      let account;
      if (action === 'bind') {
        account = await bindExternalIdentity(current.id, {
          provider: 'wechat',
          subject: uin,
          profile,
        });
      } else {
        const result = await loginOrRegisterExternalIdentity({
          provider: 'wechat',
          subject: uin,
          profile,
        });
        account = result.account;
        const token = await createTrackedAccountSession(req, account, 'wechat', result.created);
        await syncAccountRoomIdentity(req, res, account);
        await replaceAccountSession(req, res, token);
      }
      return account;
    }, req.body?.flowId);
    setWechatAccountLoginCookie(res, '');
    recordAccountAuthMetric(`wechat_${action}`, 'success');
    return res.json({ ok: true, account: publicAccount(account) });
  } catch (error) {
    recordAccountAuthMetric('wechat', error.code || 'error');
    logWechatAccountFailure(error, 'account');
    return sendAccountAuthError(res, error);
  }
});

// ---------- Linux.do OAuth：房主身份绑定 / 找回 ----------
// 只影响“把当前浏览器身份绑定到一个 Linux.do 账号”这件事，不改变匿名创建/加入房间的既有流程；
// 不登录 Linux.do 完全不受影响。持久化只写 Redis（server/linuxdoAuth.js）。

app.get('/api/auth/linuxdo/status', async (req, res) => {
  const enabled = isLinuxdoConfigured();
  if (!enabled) return res.json({ enabled: false, bound: null });

  const identity = resolveIdentityFromRequest(req);
  const roomId = String(req.query?.roomId || '').trim().toUpperCase();
  const bound = identity?.userId ? await getLinuxdoProfileForUser(identity.userId, roomId) : null;
  res.json({ enabled, bound });
});

app.get('/api/auth/linuxdo/start', async (req, res) => {
  if (!isLinuxdoConfigured()) return res.status(400).json({ error: 'Linux.do 登录未配置' });
  if (!limitLinuxdoAuth(`linuxdo-start:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const requestedPurpose = String(req.query?.purpose || '');
  const purpose = ['recover', 'account-login', 'account-bind'].includes(requestedPurpose)
    ? requestedPurpose
    : 'bind';
  const returnPath = sanitizeReturnPath(req.query?.returnPath);

  if (purpose === 'account-login') {
    try {
      const state = await issueAccountOAuthState(req, res, 'linuxdo', signLinuxdoState, { purpose, returnPath });
      if (req.headers['x-openmusic-device'] !== undefined) return res.json({ url: buildLinuxdoAuthorizeUrl(state) });
      return res.redirect(buildLinuxdoAuthorizeUrl(state));
    } catch (error) {
      return sendAccountAuthError(res, error);
    }
  }

  if (purpose === 'account-bind') {
    try {
      const account = await requireAccountSession(req, res);
      if (!account) return;
      await verifyAccountDeviceRequest(resolveAccountSessionToken(req), req, { ip: getRequestIp(req) });
      const state = await issueAccountOAuthState(req, res, 'linuxdo', signLinuxdoState, { purpose, accountId: account.id, returnPath });
      if (req.headers['x-openmusic-device'] === undefined) return res.redirect(buildLinuxdoAuthorizeUrl(state));
      return res.json({ url: buildLinuxdoAuthorizeUrl(state) });
    } catch (error) {
      return sendAccountAuthError(res, error);
    }
  }

  if (purpose === 'bind') {
    const identity = requireSessionIdentity(req, res);
    if (!identity) return;
    const roomId = String(req.query?.roomId || '').trim().toUpperCase();
    const room = roomId ? getRoomInternal(roomId) : null;
    if (!room || room.creatorId !== identity.userId) {
      return res.status(403).json({ error: '只有房主本人可以绑定 Linux.do 账号' });
    }
    try {
      const state = await issueAccountOAuthState(req, res, 'linuxdo', signLinuxdoState, { purpose: 'bind', userId: identity.userId, roomId, returnPath });
      return res.redirect(buildLinuxdoAuthorizeUrl(state));
    } catch (error) {
      return sendAccountAuthError(res, error);
    }
  }

  // recover：此时大概率已不是原身份，不要求当前必须有身份
  const roomId = String(req.query?.roomId || '').trim().toUpperCase();
  if (!roomId) return res.status(400).json({ error: '房间号不能为空' });
  try {
    const state = await issueAccountOAuthState(req, res, 'linuxdo', signLinuxdoState, { purpose: 'recover', roomId, returnPath });
    return res.redirect(buildLinuxdoAuthorizeUrl(state));
  } catch (error) {
    return sendAccountAuthError(res, error);
  }
});

const reportOAuthFailure = createOAuthFailureReporter({ audit: appendAdminAudit, metric: incrementMetric });

app.get('/api/auth/linuxdo/callback', async (req, res) => {
  const fail = (returnPath, reason) => res.redirect(`${sanitizeReturnPath(returnPath)}?linuxdo=${reason}`);

  if (!isLinuxdoConfigured()) { reportOAuthFailure('linuxdo', { stage: 'configuration', code: 'NOT_CONFIGURED' }); return fail('/', 'error'); }
  if (!limitLinuxdoAuth(`linuxdo-callback:${getRequestIp(req)}`)) {
    return res.status(429).send('请求过于频繁，请稍后再试');
  }

  const state = verifyLinuxdoState(req.query?.state);
  if (!state) { reportOAuthFailure('linuxdo', { stage: 'state_signature', code: 'INVALID_OR_EXPIRED_STATE' }); return fail('/', 'error'); }
  const returnPath = sanitizeReturnPath(state.returnPath);
  const failForPurpose = (reason) => state.purpose === 'account-login' || state.purpose === 'account-bind'
    ? res.redirect(appendAccountAuthResult(returnPath, `linuxdo_${reason}`))
    : fail(returnPath, reason);

  try {
    if (!await consumeAccountOAuthState(req, res, 'linuxdo', req.query?.state)) { reportOAuthFailure('linuxdo', { stage: 'state_binding', code: 'MISSING_OR_USED_CHALLENGE' }); return failForPurpose('expired'); }
  } catch (error) {
    reportOAuthFailure('linuxdo', oauthFailureDetails(error, 'state_binding'));
    return sendAccountAuthError(res, error);
  }

  let profile;
  let oauthStage = 'token';
  try {
    if (typeof req.query?.code !== 'string' || !req.query.code || req.query.code.length > 4096) throw Object.assign(new Error('OAuth code missing'), { code: 'access_denied' });
    const accessToken = await exchangeLinuxdoCode(req.query?.code);
    oauthStage = 'profile';
    profile = await fetchLinuxdoProfile(accessToken);
  } catch (err) {
    reportOAuthFailure('linuxdo', oauthFailureDetails(err, oauthStage));
    return failForPurpose('error');
  }

  if (state.purpose === 'admin-bind' || state.purpose === 'admin-login') {
    // 后台绑定 / 后台登录复用同一个已注册的 redirect_uri，只能在这里按 purpose 转发
    return handleLinuxdoAdminCallback(req, res, state, profile);
  }

  if (state.purpose === 'account-login' || state.purpose === 'account-bind') {
    try {
      let account;
      if (state.purpose === 'account-bind') {
        const current = await resolveAccountFromRequest(req);
        if (!current || current.id !== state.accountId) {
          return res.redirect(appendAccountAuthResult(returnPath, 'linuxdo_expired'));
        }
        account = await bindExternalIdentity(current.id, {
          provider: 'linuxdo',
          subject: profile.id,
          profile,
        });
      } else {
        const result = await loginOrRegisterExternalIdentity({
          provider: 'linuxdo',
          subject: profile.id,
          profile,
        });
        account = result.account;
      req.oauthDeviceKey = state.deviceKey === undefined ? undefined : normalizeDeviceKey(state.deviceKey);
        const token = await createTrackedAccountSession(req, account, 'linuxdo', result.created);
        await syncAccountRoomIdentity(req, res, account);
        await replaceAccountSession(req, res, token);
      }
      recordAccountAuthMetric(state.purpose.replace('account-', 'linuxdo_'), 'success');
      return res.redirect(appendAccountAuthResult(
        returnPath,
        state.purpose === 'account-bind' ? 'linuxdo_bound' : 'linuxdo_logged_in',
      ));
    } catch (error) {
      reportOAuthFailure('linuxdo', oauthFailureDetails(error, 'account_session'));
      const result = error instanceof AccountAuthError && ['IDENTITY_ALREADY_BOUND', 'PROVIDER_ALREADY_BOUND'].includes(error.code)
        ? 'linuxdo_conflict'
        : 'linuxdo_error';
      recordAccountAuthMetric(state.purpose.replace('account-', 'linuxdo_'), error instanceof AccountAuthError ? error.code : 'error');
      return res.redirect(appendAccountAuthResult(returnPath, result));
    }
  }

  if (state.purpose === 'bind') {
    // 二次核验：跳转期间房主可能已变化（转让 / 身份过期），不能只信 state
    const identity = resolveIdentityFromRequest(req);
    if (!identity?.userId || identity.userId !== state.userId) {
      return fail(returnPath, 'expired');
    }
    const room = getRoomInternal(state.roomId);
    if (!room || room.creatorId !== identity.userId) {
      return fail(returnPath, 'denied');
    }
    try {
      await bindLinuxdoToUser(profile.id, identity.userId, profile, state.roomId);
      // 授权跳转期间后台或现房主可能刚完成转让，避免把已清理的旧绑定重新写回。
      if (getRoomInternal(state.roomId)?.creatorId !== identity.userId) {
        await unbindLinuxdoForUser(identity.userId, state.roomId);
        return fail(returnPath, 'denied');
      }
    } catch (err) {
      console.error('Linux.do 绑定写入失败:', err?.message || err);
      return fail(returnPath, 'error');
    }
    return fail(returnPath, 'bound');
  }

  // recover：查已绑定的 userId，转移当前房间房主关系并重新签发身份 Cookie
  const boundUserId = await getUserIdForLinuxdo(profile.id, state.roomId);
  if (!boundUserId) return fail(returnPath, 'notfound');
  const recovery = recoverRoomOwner(state.roomId, boundUserId, resolveDeviceIdFromCookieHeader(req.headers?.cookie || '') || createServerClientId());
  if (recovery.error) return fail(returnPath, recovery.error === '房间不存在' ? 'room-notfound' : 'denied');

  const now = Math.floor(Date.now() / 1000);
  const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  const deviceId = cookieDeviceId || createServerClientId();
  await linkDeviceToUser(deviceId, boundUserId);
  setIdentityCookieHeaders(res, boundUserId, signClientId(boundUserId, now), deviceId);
  broadcastRoomUpdate(state.roomId, { immediate: true });
  if (recovery.systemMessage) emitSystemChat(state.roomId, recovery.systemMessage);
  return fail(returnPath, 'recovered');
});

app.post('/api/auth/linuxdo/unbind', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  await unbindLinuxdoForUser(identity.userId, String(req.body?.roomId || '').trim().toUpperCase());
  res.json({ success: true });
});

// ---------- GitHub OAuth：房主身份绑定 / 找回（与 Linux.do 完全对称的一套流程） ----------

app.get('/api/auth/github/status', async (req, res) => {
  const enabled = isGithubConfigured();
  if (!enabled) return res.json({ enabled: false, bound: null });

  const identity = resolveIdentityFromRequest(req);
  const roomId = String(req.query?.roomId || '').trim().toUpperCase();
  const bound = identity?.userId ? await getGithubProfileForUser(identity.userId, roomId) : null;
  res.json({ enabled: true, bound });
});

app.get('/api/auth/github/start', async (req, res) => {
  if (!isGithubConfigured()) return res.status(400).json({ error: 'GitHub 登录未配置' });
  if (!limitGithubAuth(`github-start:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const requestedPurpose = String(req.query?.purpose || '');
  const purpose = ['recover', 'account-login', 'account-bind'].includes(requestedPurpose)
    ? requestedPurpose
    : 'bind';
  const returnPath = sanitizeGithubReturnPath(req.query?.returnPath);

  if (purpose === 'account-login') {
    try {
      const state = await issueAccountOAuthState(req, res, 'github', signGithubState, { purpose, returnPath });
      if (req.headers['x-openmusic-device'] !== undefined) return res.json({ url: buildGithubAuthorizeUrl(state) });
      return res.redirect(buildGithubAuthorizeUrl(state));
    } catch (error) {
      return sendAccountAuthError(res, error);
    }
  }

  if (purpose === 'account-bind') {
    try {
      const account = await requireAccountSession(req, res);
      if (!account) return;
      await verifyAccountDeviceRequest(resolveAccountSessionToken(req), req, { ip: getRequestIp(req) });
      const state = await issueAccountOAuthState(req, res, 'github', signGithubState, { purpose, accountId: account.id, returnPath });
      if (req.headers['x-openmusic-device'] === undefined) return res.redirect(buildGithubAuthorizeUrl(state));
      return res.json({ url: buildGithubAuthorizeUrl(state) });
    } catch (error) {
      return sendAccountAuthError(res, error);
    }
  }

  if (purpose === 'bind') {
    const identity = requireSessionIdentity(req, res);
    if (!identity) return;
    const roomId = String(req.query?.roomId || '').trim().toUpperCase();
    const room = roomId ? getRoomInternal(roomId) : null;
    if (!room || room.creatorId !== identity.userId) {
      return res.status(403).json({ error: '只有房主本人可以绑定 GitHub 账号' });
    }
    try {
      const state = await issueAccountOAuthState(req, res, 'github', signGithubState, { purpose: 'bind', userId: identity.userId, roomId, returnPath });
      return res.redirect(buildGithubAuthorizeUrl(state));
    } catch (error) {
      return sendAccountAuthError(res, error);
    }
  }

  const roomId = String(req.query?.roomId || '').trim().toUpperCase();
  if (!roomId) return res.status(400).json({ error: '房间号不能为空' });
  try {
    const state = await issueAccountOAuthState(req, res, 'github', signGithubState, { purpose: 'recover', roomId, returnPath });
    return res.redirect(buildGithubAuthorizeUrl(state));
  } catch (error) {
    return sendAccountAuthError(res, error);
  }
});

app.get('/api/auth/github/callback', async (req, res) => {
  const fail = (returnPath, reason) => res.redirect(`${sanitizeGithubReturnPath(returnPath)}?github=${reason}`);

  if (!isGithubConfigured()) { reportOAuthFailure('github', { stage: 'configuration', code: 'NOT_CONFIGURED' }); return fail('/', 'error'); }
  if (!limitGithubAuth(`github-callback:${getRequestIp(req)}`)) {
    return res.status(429).send('请求过于频繁，请稍后再试');
  }

  const state = verifyGithubState(req.query?.state);
  if (!state) { reportOAuthFailure('github', { stage: 'state_signature', code: 'INVALID_OR_EXPIRED_STATE' }); return fail('/', 'error'); }
  const returnPath = sanitizeGithubReturnPath(state.returnPath);
  const failForPurpose = (reason) => state.purpose === 'account-login' || state.purpose === 'account-bind'
    ? res.redirect(appendAccountAuthResult(returnPath, `github_${reason}`))
    : fail(returnPath, reason);

  try {
    if (!await consumeAccountOAuthState(req, res, 'github', req.query?.state)) { reportOAuthFailure('github', { stage: 'state_binding', code: 'MISSING_OR_USED_CHALLENGE' }); return failForPurpose('expired'); }
  } catch (error) {
    reportOAuthFailure('github', oauthFailureDetails(error, 'state_binding'));
    return sendAccountAuthError(res, error);
  }

  let profile;
  let oauthStage = 'token';
  try {
    if (typeof req.query?.code !== 'string' || !req.query.code || req.query.code.length > 4096) throw Object.assign(new Error('OAuth code missing'), { code: 'access_denied' });
    const accessToken = await exchangeGithubCode(req.query?.code);
    oauthStage = 'profile';
    profile = await fetchGithubProfile(accessToken);
  } catch (err) {
    reportOAuthFailure('github', oauthFailureDetails(err, oauthStage));
    return failForPurpose('error');
  }

  if (state.purpose === 'admin-bind' || state.purpose === 'admin-login') {
    // 后台绑定 / 后台登录复用同一个已注册的 redirect_uri，只能在这里按 purpose 转发
    return handleGithubAdminCallback(req, res, state, profile);
  }

  if (state.purpose === 'account-login' || state.purpose === 'account-bind') {
    try {
      let account;
      if (state.purpose === 'account-bind') {
        const current = await resolveAccountFromRequest(req);
        if (!current || current.id !== state.accountId) {
          return res.redirect(appendAccountAuthResult(returnPath, 'github_expired'));
        }
        account = await bindExternalIdentity(current.id, {
          provider: 'github',
          subject: profile.id,
          profile,
        });
      } else {
        const result = await loginOrRegisterExternalIdentity({
          provider: 'github',
          subject: profile.id,
          profile,
        });
        account = result.account;
      req.oauthDeviceKey = state.deviceKey === undefined ? undefined : normalizeDeviceKey(state.deviceKey);
        const token = await createTrackedAccountSession(req, account, 'github', result.created);
        await syncAccountRoomIdentity(req, res, account);
        await replaceAccountSession(req, res, token);
      }
      recordAccountAuthMetric(state.purpose.replace('account-', 'github_'), 'success');
      return res.redirect(appendAccountAuthResult(
        returnPath,
        state.purpose === 'account-bind' ? 'github_bound' : 'github_logged_in',
      ));
    } catch (error) {
      reportOAuthFailure('github', oauthFailureDetails(error, 'account_session'));
      const result = error instanceof AccountAuthError && ['IDENTITY_ALREADY_BOUND', 'PROVIDER_ALREADY_BOUND'].includes(error.code)
        ? 'github_conflict'
        : 'github_error';
      recordAccountAuthMetric(state.purpose.replace('account-', 'github_'), error instanceof AccountAuthError ? error.code : 'error');
      return res.redirect(appendAccountAuthResult(returnPath, result));
    }
  }

  if (state.purpose === 'bind') {
    const identity = resolveIdentityFromRequest(req);
    if (!identity?.userId || identity.userId !== state.userId) {
      return fail(returnPath, 'expired');
    }
    const room = getRoomInternal(state.roomId);
    if (!room || room.creatorId !== identity.userId) {
      return fail(returnPath, 'denied');
    }
    try {
      await bindGithubToUser(profile.id, identity.userId, profile, state.roomId);
      // 授权跳转期间后台或现房主可能刚完成转让，避免把已清理的旧绑定重新写回。
      if (getRoomInternal(state.roomId)?.creatorId !== identity.userId) {
        await unbindGithubForUser(identity.userId, state.roomId);
        return fail(returnPath, 'denied');
      }
    } catch (err) {
      console.error('GitHub 绑定写入失败:', err?.message || err);
      return fail(returnPath, 'error');
    }
    return fail(returnPath, 'bound');
  }

  const boundUserId = await getUserIdForGithub(profile.id, state.roomId);
  if (!boundUserId) return fail(returnPath, 'notfound');
  const recovery = recoverRoomOwner(state.roomId, boundUserId, resolveDeviceIdFromCookieHeader(req.headers?.cookie || '') || createServerClientId());
  if (recovery.error) return fail(returnPath, recovery.error === '房间不存在' ? 'room-notfound' : 'denied');

  const now = Math.floor(Date.now() / 1000);
  const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  const deviceId = cookieDeviceId || createServerClientId();
  await linkDeviceToUser(deviceId, boundUserId);
  setIdentityCookieHeaders(res, boundUserId, signClientId(boundUserId, now), deviceId);
  broadcastRoomUpdate(state.roomId, { immediate: true });
  if (recovery.systemMessage) emitSystemChat(state.roomId, recovery.systemMessage);
  return fail(returnPath, 'recovered');
});

app.post('/api/auth/github/unbind', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  await unbindGithubForUser(identity.userId, String(req.body?.roomId || '').trim().toUpperCase());
  res.json({ success: true });
});


// ---------- 文件传输助手 UIN：房主身份绑定 / 找回 ----------
// 绑定和找回只接收服务端签发的一次性微信登录证明；
// 不上传 sid / skey / pass_ticket，也不把它们写入 Redis。
app.get('/api/auth/wechat-uin/status', async (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  const bound = identity?.userId
    ? await wechatUinStore.getProfileForUser(identity.userId, String(req.query?.roomId || '').trim().toUpperCase())
    : null;
  res.json({ enabled: wechatUinStore.isEnabled(), bound });
});

app.post('/api/auth/wechat-uin/bind', async (req, res) => {
  if (!limitWechatUinAuth(`wechat-uin-bind:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '微信绑定请求过于频繁，请稍后再试' });
  }
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;

  const roomId = String(req.body?.roomId || '').trim().toUpperCase();
  const room = roomId ? getRoomInternal(roomId) : null;
  if (!room || room.creatorId !== identity.userId) {
    return res.status(403).json({ error: '只有房主本人可以绑定微信身份' });
  }

  try {
    const proof = await consumeWechatLoginProof(req, res);
    if (!proof) {
      return res.status(401).json({ error: '微信登录凭证无效或已过期，请重新扫码', code: 'WECHAT_PROOF_INVALID' });
    }
    const binding = await wechatUinStore.bindToUser(proof.uin, identity.userId, roomId);
    return res.json({ success: true, binding });
  } catch (err) {
    if (err?.code === WECHAT_UIN_CONFLICT) {
      return res.status(409).json({ error: err.message });
    }
    console.error('微信 UIN 绑定失败:', err?.message || err);
    return res.status(500).json({ error: err?.message || '微信绑定失败' });
  }
});

app.post('/api/auth/wechat-uin/recover', async (req, res) => {
  const roomId = String(req.body?.roomId || '').trim().toUpperCase();
  if (!roomId) return res.status(400).json({ error: '房间号不能为空' });
  if (!limitWechatUinAuth(`wechat-uin-recover:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '微信找回请求过于频繁，请稍后再试' });
  }
  const proof = await consumeWechatLoginProof(req, res);
  if (!proof) return res.status(401).json({ error: '微信登录凭证无效或已过期，请重新扫码', code: 'WECHAT_PROOF_INVALID' });
  const userId = await wechatUinStore.getUserIdForUin(proof.uin, roomId);
  if (!userId) return res.status(404).json({ error: '这个微信账号还没有绑定过房主身份' });

  const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  const deviceId = cookieDeviceId || createServerClientId();
  const recovery = recoverRoomOwner(roomId, userId, deviceId);
  if (recovery.error) {
    const status = recovery.error === '房间不存在' ? 404 : 403;
    return res.status(status).json({ error: recovery.error });
  }

  const now = Math.floor(Date.now() / 1000);
  await linkDeviceToUser(deviceId, userId);
  setIdentityCookieHeaders(res, userId, signClientId(userId, now), deviceId);
  if (recovery.systemMessage) {
    broadcastRoomUpdate(roomId, { immediate: true });
    emitSystemChat(roomId, recovery.systemMessage);
  }
  return res.json({ success: true, roomId, recoveredUserId: userId });
});

app.post('/api/auth/wechat-uin/unbind', async (req, res) => {
  const identity = requireSessionIdentity(req, res);
  if (!identity) return;
  const roomId = String(req.body?.roomId || '').trim().toUpperCase();
  await wechatUinStore.unbindForUser(identity.userId, roomId);
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
  if (req.publicLobbyPreview) {
    const rate = await distributedSocketRateLimiter.consume({ scope: 'http:public-lobby', principal: `ip:${getRequestIp(req)}`, windowMs: 60_000, max: 60 });
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
      return res.status(rate.unavailable ? 503 : 429).json({ error: '大厅暂时繁忙，请稍后重试', code: rate.unavailable ? 'LOBBY_UNAVAILABLE' : 'LOBBY_RATE_LIMITED' });
    }
    return res.json(await listRooms(''));
  }
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
  const account = await resolveAccountFromRequest(req);
  const musicOwner = account || await resolveAnonymousAccount(req);
  if (!musicOwner) return res.status(401).json({ error: '请先登录账户', code: 'ACCOUNT_AUTH_REQUIRED' });
  const accountRoomUserId = account ? await syncAccountRoomIdentity(req, res, account) : null;
  const identity = resolveIdentityFromRequest(req);
  const creatorId = accountRoomUserId || identity?.userId;
  if (!creatorId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }

  // 先复用空闲自建房，避免冷却把「再建一次」误拦成失败
  const idleOwned = findIdleOwnedRoom({
    creatorId,
    creatorDeviceId: createDeviceId,
  });
  if (idleOwned) {
    const reused = reuseIdleOwnedRoom(idleOwned.id, { name, password });
    if (reused?.error) {
      return res.status(400).json({ error: reused.error });
    }
    let room = reused || idleOwned;
    if (account?.id) {
      const bound = setRoomOwnerAccountId(room.id, creatorId, account.id);
      if (!bound.error) await addRoomToAccountIndex(account.id, room.id);
      if (!bound.error) {
        try {
          room = await restoreAccountMusicToRoom(account.id, room);
        } catch {
          return res.status(503).json({ error: '房间已创建，但账户会员恢复失败，请稍后重新创建以重试', code: 'ACCOUNT_MUSIC_RESTORE_FAILED', roomId: room.id });
        }
      }
    } else {
      try {
        room = await restoreAccountMusicToRoom(musicOwner.id, room, { ownerUserId: creatorId });
      } catch {
        return res.status(503).json({ error: '房间已创建，但设备 Cookie 音乐缓存恢复失败，请稍后重新创建以重试', code: 'MUSIC_COOKIE_CACHE_RESTORE_FAILED', roomId: room.id });
      }
    }
    recordRoomCreate({
      ip: createIp,
      deviceId: createDeviceId,
      userId: creatorId,
    });
    return res.json(room);
  }

  const cooldown = checkRoomCreateCooldown({
    ip: createIp,
    deviceId: createDeviceId,
    userId: creatorId,
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
    creatorId,
    creatorDeviceId: createDeviceId,
  });
  if (maxOwned > 0 && ownedCount >= maxOwned) {
    appendAdminAudit('room_create_blocked', {
      reason: 'max_owned_rooms',
      userId: creatorId,
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
    creatorId,
    creatorDeviceId: createDeviceId,
    creatorIp: createIp,
    ownerAccountId: account?.id || null,
  });
  if (room?.error) {
    return res.status(400).json({ error: room.error });
  }

  recordRoomCreate({
    ip: createIp,
    deviceId: createDeviceId,
    userId: creatorId,
  });

  if (account?.id && room?.id) await addRoomToAccountIndex(account.id, room.id);
  if (account?.id && room?.id) {
    try {
      return res.json(await restoreAccountMusicToRoom(account.id, room));
    } catch {
      return res.status(503).json({ error: '房间已创建，但账户会员恢复失败，请稍后重新创建以重试', code: 'ACCOUNT_MUSIC_RESTORE_FAILED', roomId: room.id });
    }
  }
  if (room?.id) {
    try {
      return res.json(await restoreAccountMusicToRoom(musicOwner.id, room, { ownerUserId: creatorId }));
    } catch {
      return res.status(503).json({ error: '房间已创建，但设备 Cookie 音乐缓存恢复失败，请稍后重新创建以重试', code: 'MUSIC_COOKIE_CACHE_RESTORE_FAILED', roomId: room.id });
    }
  }

  res.json(room);
});

app.get('/api/account/rooms', async (req, res) => {
  const account = await requireAccountSession(req, res);
  if (!account) return;
  const ids = await listRoomIdsForAccount(account.id);
  const rooms = [];
  for (const id of ids) {
    const room = getRoomInternal(id);
    if (!room || room.ownerAccountId !== account.id) continue;
    rooms.push({
      id: room.id,
      name: room.name,
      isLocked: Boolean(room.isLocked || room.passwordHash),
      userCount: room.users?.size || 0,
      createdAt: Number(room.createdAt) || 0,
      ownerAccountId: room.ownerAccountId || null,
    });
  }
  rooms.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return res.json({ rooms });
});

app.post('/api/account/rooms/:id/claim', async (req, res) => {
  const account = await requireAccountSession(req, res);
  if (!account) return;
  const accountRoomUserId = await syncAccountRoomIdentity(req, res, account);
  if (!accountRoomUserId) return res.status(401).json({ error: '账户身份未就绪', code: 'SESSION_REQUIRED' });
  const room = getRoomInternal(req.params.id);
  const identity = resolveIdentityFromRequest(req);
  const deviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  if (!room) return res.status(404).json({ error: '房间不存在', code: 'ROOM_NOT_FOUND' });
  const hasCreatorProof = Boolean(
    identity?.userId && identity.userId === room.creatorId,
  ) || Boolean(deviceId && deviceId === room.creatorDeviceId);
  if (!hasCreatorProof) {
    return res.status(403).json({ error: '当前身份不具备房主认领凭证', code: 'ROOM_CLAIM_FORBIDDEN' });
  }
  const result = setRoomOwnerAccountId(room.id, room.creatorId, account.id, accountRoomUserId);
  if (result.error) {
    const status = result.error === '房间已绑定其他账户' ? 409 : 403;
    return res.status(status).json({ error: result.error, code: status === 409 ? 'ROOM_ACCOUNT_CONFLICT' : 'ROOM_CLAIM_FORBIDDEN' });
  }
  await addRoomToAccountIndex(account.id, room.id);
  await accountMusic.rememberRoom(account.id, getRoomInternal(room.id));
  return res.json({ success: true, changed: Boolean(result.changed) });
});

app.get('/api/account/music-accounts', async (req, res) => {
  const account = await requireAccountSession(req, res);
  if (!account) return;
  try {
    return res.json({ accounts: await accountMusic.list(account.id) });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || '读取账户会员信息失败', code: error.code || 'ACCOUNT_MUSIC_READ_FAILED' });
  }
});

app.post('/api/account/music-accounts/:platform/shared', async (req, res) => {
  const account = await requireAccountSession(req, res);
  if (!account) return;
  try {
    const shared = req.body?.shared === true;
    const metadata = await accountMusic.setShared(account.id, req.params.platform, shared);
    return res.json({ success: true, account: metadata });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || '更新账户会员共享失败', code: error.code || 'ACCOUNT_MUSIC_SHARE_FAILED' });
  }
});

app.delete('/api/account/music-accounts/:platform', async (req, res) => {
  const account = await requireAccountSession(req, res);
  if (!account) return;
  try {
    return res.json({ success: true, accounts: await accountMusic.remove(account.id, req.params.platform) });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || '删除账户会员信息失败', code: error.code || 'ACCOUNT_MUSIC_DELETE_FAILED' });
  }
});

app.post('/api/account/favorites/sync', async (req, res) => {
  const account = await requireAccountSession(req, res);
  if (!account) return;
  if (req.body?.accountId !== undefined && req.body.accountId !== account.id) {
    return res.status(409).json({ error: '账户已变化，请重新登录后迁移收藏', code: 'ACCOUNT_CHANGED' });
  }
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) return res.status(401).json({ error: '会话未就绪', code: 'SESSION_REQUIRED' });
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  const handoff = verifyGuestHandoff(cookies[GUEST_HANDOFF_COOKIE], identity.userId);
  const rawLocalSongs = Array.isArray(req.body?.songs) ? req.body.songs.slice(0, 1000) : [];
  const localCategories = Array.isArray(req.body?.categories) ? req.body.categories.slice(0, 50) : [];
  if (Array.isArray(req.body?.categories) && req.body.categories.length > 50) {
    return res.status(400).json({ error: '收藏分类超过上限，本机缓存会保留，请整理后重试', code: 'FAVORITES_CATEGORY_LIMIT' });
  }
  const localSongs = rawLocalSongs.map(sanitizeFavoriteSongInput).filter(Boolean);
  const rejectedSongs = rawLocalSongs.length - localSongs.length;
  // 旧浏览器缓存仅作为导入内容写入当前已登录身份，不能用于查询或认领任意游客的 Redis 数据
  // handoff 只补充已验证的来源关系，不作为本地内容导入权限，最终读写权威仍是 Redis
  const categoryResult = await importFavoriteCategories(identity.userId, localCategories);
  if (categoryResult.error) return res.status(400).json({ error: categoryResult.error, code: 'FAVORITES_SYNC_FAILED' });
  const storedCategories = new Set((categoryResult.categories || []).map(value => String(value).trim().toLowerCase()));
  if (localCategories.some(value => String(value || '').trim() && !storedCategories.has(String(value).trim().toLowerCase()))) {
    return res.status(409).json({ error: '部分收藏分类未能保存，本机缓存会保留，请整理分类后重试', code: 'FAVORITES_CATEGORY_INCOMPLETE' });
  }
  const result = localSongs.length > 0
    ? await importFavoriteSongs(identity.userId, filterFavoriteCategories(localSongs, categoryResult.categories))
    : { favorites: await listFavoriteSongs(identity.userId), imported: 0, dropped: 0 };
  if (result.error) return res.status(400).json({ error: result.error, code: 'FAVORITES_SYNC_FAILED' });
  return res.json({
    success: true,
    status: handoff?.sourceUserId === identity.userId ? 'identity_same' : 'merged',
    identitySame: Boolean(handoff?.sourceUserId === identity.userId),
    favorites: result.favorites,
    imported: result.imported,
    dropped: (result.dropped || 0) + rejectedSongs,
    maxFavorites: result.maxFavorites,
    categories: categoryResult.categories,
  });
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

function resolveWindowsDesktopClientPath() {
  const candidates = [
    path.join(__dirname, 'downloads/openmusic-desktop-setup.exe'),
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

function sendWindowsDesktopClient(req, res) {
  const clientPath = resolveWindowsDesktopClientPath();
  if (!clientPath) {
    return res.status(404).type('text/plain; charset=utf-8').send(
      'Windows 客户端尚未构建。请在项目根目录执行 npm run build。',
    );
  }
  res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
  res.download(clientPath, 'openmusic-desktop-setup.exe');
}

app.get('/downloads/openmusic.apk', sendAndroidApk);
app.get('/downloads/openmusic-desktop-setup.exe', sendWindowsDesktopClient);

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
    if (['vendor/folia/stage.json', 'vendor/folia/index.html', 'vendor/folia/source.zip', 'vendor/folia/LICENSE.txt'].includes(rel)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }
    if (rel.startsWith('qface/') || rel.startsWith('vendor/')) {
      // QQ 表情几乎不变，浏览器长缓存 1 年
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('/{*splat}', (req, res, next) => {
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
const socketToAccountSessionKey = new Map();
const accountSessionSockets = new Map();

function accountSessionSocketKey(token) {
  const value = accountTokenSessionId(token);
  return value ? createHash('sha256').update(value).digest('hex') : '';
}

function bindSocketAccountSession(socket) {
  const token = resolveAccountSessionToken({ headers: socket.handshake?.headers || {} });
  const key = accountSessionSocketKey(token);
  if (!key) return;
  socketToAccountSessionKey.set(socket.id, key);
  const sockets = accountSessionSockets.get(key) || new Set();
  sockets.add(socket.id);
  accountSessionSockets.set(key, sockets);
}

function unbindSocketAccountSession(socketId) {
  const key = socketToAccountSessionKey.get(socketId);
  socketToAccountSessionKey.delete(socketId);
  if (!key) return;
  const sockets = accountSessionSockets.get(key);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) accountSessionSockets.delete(key);
}

function disconnectSocketsForAccountSession(token, reason = 'session_invalidated') {
  const key = accountSessionSocketKey(token);
  if (!key) return;
  const socketIds = [...(accountSessionSockets.get(key) || [])];
  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    socket.emit('account_session_invalidated', { reason, stopReconnect: false });
    socket.disconnect(true);
  }
}

let riskChallengeBus;

function suspendAccountSocketsForHumanChallenge(accountId) {
  const sockets = io.in(`account:${accountId}`);
  sockets.emit('account_human_check_required');
  sockets.disconnectSockets(true);
}

async function verifySocketAccountSession(socket) {
  try {
    if (socket.data.anonymous) {
      const account = await resolveAnonymousAccount({ headers: socket.handshake?.headers || {} });
      if (!account || account.id !== socket.data.accountId) return { valid: false };
      await riskControl.assertAllowed(account.id, { human: true });
      return { valid: true, account };
    }
    const key = socketToAccountSessionKey.get(socket.id);
    if (!key) return { valid: false };
    const token = resolveAccountSessionToken({ headers: socket.handshake?.headers || {} });
    if (!token || accountSessionSocketKey(token) !== key) return { valid: false };
    const account = await resolveAccountSession(token);
    if (!account || account.id !== socket.data.accountId) return { valid: false };
    await riskControl.assertAllowed(account.id, { human: true });
    return { valid: true, account };
  } catch (error) {
    if (error.code === 'ACCOUNT_HUMAN_CHECK_REQUIRED') return { valid: false, humanRequired: true };
    if ((error instanceof AccountAuthError && error.code === 'REDIS_UNAVAILABLE') || ['RISK_STORAGE_UNAVAILABLE', 'ACCOUNT_SESSION_UNAVAILABLE', 'ACCOUNT_KEY_UNAVAILABLE'].includes(error.code)) {
      return { valid: false, unavailable: true };
    }
    return { valid: false };
  }
}

function monitorSocketAccountSession(socket) {
  let stopped = false;
  let checking = false;
  let deadline;
  let expiry;
  let interval;
  const stop = () => {
    stopped = true;
    clearTimeout(expiry);
    clearTimeout(deadline);
    clearInterval(interval);
  };
  const invalidate = (reason) => {
    if (stopped) return;
    stop();
    incrementMetric('account_socket_rejected_total', { reason });
    socket.emit('account_session_invalidated', { reason, stopReconnect: false });
    socket.disconnect(true);
  };
  socket.once('disconnect', stop);
  const expiresAt = socket.data.accountExpiresAt;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    invalidate('session_expired');
    return;
  }
  expiry = setTimeout(() => invalidate('session_expired'), expiresAt - Date.now());
  interval = setInterval(async () => {
    if (stopped || checking) return;
    checking = true;
    deadline = setTimeout(() => invalidate('session_unavailable'), 5000);
    try {
      const session = await verifySocketAccountSession(socket);
      if (session.humanRequired) { stop(); suspendAccountSocketsForHumanChallenge(socket.data.accountId); }
      else if (!session.valid) invalidate(session.unavailable ? 'session_unavailable' : 'session_invalidated');
    } catch {
      invalidate('session_unavailable');
    } finally {
      clearTimeout(deadline);
      checking = false;
    }
  }, 30000);
  expiry.unref?.();
  interval.unref?.();
}

({ handleLinuxdoAdminCallback, handleGithubAdminCallback } = mountAdminApi(app, {
  io,
  socketToRoom,
  socketToUserId,
  getClientIp: (req) => getClientIpFromHeaders(req.headers, req.socket?.remoteAddress || ''),
  allowedOrigins: ALLOWED_ORIGINS,
  broadcastRoomUpdate,
  clearRoomOwnerBindings,
  issueOAuthState: issueAccountOAuthState,
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

io.use(async (socket, next) => {
  try {
    if (!riskChallengeBus?.isReady()) {
      throw Object.assign(new Error('风控通知服务暂不可用'), { code: 'RISK_STORAGE_UNAVAILABLE' });
    }
    const session = await inspectAccountSession(resolveAccountSessionToken({ headers: socket.handshake.headers }));
    const account = session?.account;
    if (!account) {
      const anonymous = await resolveAnonymousAccount({ headers: socket.handshake.headers });
      if (anonymous) {
        await riskControl.assertAllowed(anonymous.id, { human: true });
        const identity = resolveIdentityFromCookies(socket.handshake.headers.cookie || '');
        socket.data.anonymous = true;
        socket.data.accountId = anonymous.id;
        socket.data.accountExpiresAt = Math.min(identity.expiresAt * 1000, Date.now() + 24 * 60 * 60 * 1000);
        return next();
      }
      const error = new Error('请先登录账户');
      error.data = { code: 'ACCOUNT_AUTH_REQUIRED' };
      return next(error);
    }
    await verifyAccountDeviceRequest(resolveAccountSessionToken({ headers: socket.handshake.headers }), { method: 'SOCKET', originalUrl: '/socket.io', headers: { 'x-openmusic-device': socket.handshake.auth?.deviceProof } }, { session, ip: getClientIp(socket) });
    await riskControl.assertAllowed(account.id, { human: true });
    const identity = resolveIdentityFromCookies(socket.handshake.headers.cookie || '');
    const roomUserId = account.roomUserId || await ensureRoomUserId(account.id);
    if (!identity || identity.userId !== roomUserId) throw new AccountAuthError('ACCOUNT_IDENTITY_MISMATCH', '请刷新账户会话', 401);
    socket.join(`account-session:${session.sessionId}`);
    socket.data.accountId = account.id;
    socket.data.accountExpiresAt = session.expiresAt;
    next();
  } catch (cause) {
    incrementMetric('account_socket_rejected_total', { reason: cause.code || 'storage' });
    const error = new Error('账户会话不可用，请重新登录或联系管理员');
    error.data = { code: cause.code || 'ACCOUNT_SESSION_UNAVAILABLE' };
    next(error);
  }
});

io.on('connection', (socket) => {
  socket.join(`account:${socket.data.accountId}`);
  hardenSocketHandlers(socket);
  bindSocketAccountSession(socket);

  socket.use(async (packet, proceed) => {
    const next = () => runWithMetingRequestContext({ accountId: socket.data.accountId }, proceed);
    const session = await verifySocketAccountSession(socket);
    if (!session.valid) {
      const callback = typeof packet?.[packet.length - 1] === 'function'
        ? packet[packet.length - 1]
        : null;
      callback?.({
        success: false,
        error: session.humanRequired ? '请先完成人机验证' : session.unavailable ? '账户会话暂不可验证，请稍后重试' : '账户会话已失效，请刷新页面后重试',
        code: session.humanRequired ? 'ACCOUNT_HUMAN_CHECK_REQUIRED' : session.unavailable ? 'ACCOUNT_SESSION_UNAVAILABLE' : 'ACCOUNT_SESSION_INVALID',
      });
      if (session.humanRequired) suspendAccountSocketsForHumanChallenge(socket.data.accountId);
      else if (!session.unavailable) socket.disconnect(true);
      return;
    }
    const event = String(packet?.[0] || '');
    try {
      const ip = getClientIpFromHeaders(socket.handshake.headers, socket.handshake.address);
      const music = ['skip_song', 'finish_song', 'music_account_qr_create', 'music_account_qr_check', 'music_account_bind', 'set_room_fm_mode', 'set_room_playlist_roaming'].includes(event);
      const operation = event.startsWith('music_account_qr') ? 'qr' : 'queue';
      const result = await riskControl.consume(session.account, { ip, kind: 'socket', operation: music ? operation : '', music, userAgent: socket.handshake.headers['user-agent'] || '' });
      incrementMetric('account_request_total', { kind: 'socket', outcome: result.allowed ? 'allowed' : result.code });
      if (!result.allowed) {
        const callback = typeof packet?.[packet.length - 1] === 'function' ? packet[packet.length - 1] : null;
        callback?.({ success: false, error: '账户访问受限或请求额度已用尽', code: result.code });
        if (result.code === 'ACCOUNT_HUMAN_CHECK_REQUIRED') suspendAccountSocketsForHumanChallenge(socket.data.accountId);
        else if (result.status === 403) socket.disconnect(true);
        return;
      }
    } catch {
      const callback = typeof packet?.[packet.length - 1] === 'function' ? packet[packet.length - 1] : null;
      callback?.({ success: false, error: '风控存储暂不可用', code: 'RISK_STORAGE_UNAVAILABLE' });
      return;
    }
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
      if (result.unavailable) incrementMetric('socket_rate_limit_unavailable_rejected_total', { event });
      else incrementMetric('socket_rate_limit_rejected_total', { event });
      const callback = typeof packet[packet.length - 1] === 'function'
        ? packet[packet.length - 1]
        : null;
      callback?.({
        success: false,
        error: result.unavailable ? '服务繁忙，请稍后重试' : '操作过于频繁，请稍后再试',
        code: result.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED',
      });
    } catch (error) {
      socketRateLog.error('middleware_failed', { event, error });
      if (IS_PRODUCTION) {
        const callback = typeof packet[packet.length - 1] === 'function'
          ? packet[packet.length - 1]
          : null;
        incrementMetric('socket_rate_limit_unavailable_rejected_total', { event });
        callback?.({ success: false, error: '服务繁忙，请稍后重试', code: 'RATE_LIMIT_UNAVAILABLE' });
        return;
      }
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
    let accountNickname = '';
    if (!readOnly && !socket.data.anonymous) {
      try {
        const saved = await updateAccountNickname(
          socket.data.accountId,
          priorUser?.nickname || joinInternalBefore?.userNicknames?.get(userId) || nickname || `听友${randomBytes(3).toString('hex')}`,
          { initializeOnly: true },
        );
        accountNickname = saved.nickname;
      } catch (error) {
        incrementMetric('account_nickname_error_total', { operation: 'join', reason: error.code || 'storage' });
        callback?.({ success: false, error: error instanceof AccountAuthError ? error.message : '昵称存储暂不可用，请稍后重试', code: error.code || 'NICKNAME_STORAGE_UNAVAILABLE' });
        return;
      }
    }
    const joinedRoom = addUser(id, userId, accountNickname || nickname, {
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

    try {
      await riskControl.recordRoomVisit(socket.data.accountId, {
        roomId: id,
        roomName: getRoomInternal(id)?.name || '',
        nickname: getRoomInternal(id)?.users.get(userId)?.nickname || '',
        ip,
        readOnly: Boolean(readOnly),
      });
      await riskControl.recordNickname(socket.data.accountId, getRoomInternal(id)?.users.get(userId)?.nickname || '');
    } catch {
      incrementMetric('risk_storage_error_total', { operation: 'room_visit' });
    }

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
      accountNickname,
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

  socket.on('rename_user', async ({ nickname }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'rename', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const userId = getSocketUserId(socket);
    if (!getRoomInternal(roomId)?.users.has(userId)) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }
    let account;
    try {
      if (!socket.data.anonymous) account = await updateAccountNickname(socket.data.accountId, nickname);
    } catch (error) {
      incrementMetric('account_nickname_error_total', { operation: 'rename', reason: error.code || 'storage' });
      callback?.({ success: false, error: error instanceof AccountAuthError ? error.message : '昵称保存失败，请稍后重试', code: error.code || 'NICKNAME_STORAGE_UNAVAILABLE' });
      return;
    }
    const result = renameUser(roomId, userId, account ? account.nickname : nickname);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    void riskControl.recordNickname(socket.data.accountId, getRoomInternal(roomId)?.users.get(userId)?.nickname || '')
      .catch(() => incrementMetric('risk_storage_error_total', { operation: 'nickname' }));
    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId), accountNickname: account?.nickname });
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

  socket.on('set_room_playlist_roaming', async (payload = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_playlist_roaming', callback)) return;
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return callback?.({ success: false, error: '未加入房间' });
    const platform = String(payload?.platform || '').trim();
    if (payload?.playlistName != null && (typeof payload.playlistName !== 'string' || payload.playlistName.trim().length > 160)) {
      return callback?.({ success: false, error: '歌单名称无效' });
    }
    if (payload?.dedupeByName != null && typeof payload.dedupeByName !== 'boolean') {
      return callback?.({ success: false, error: '去重设置无效' });
    }
    if (!payload?.clear && typeof payload?.playlistEnabled !== 'boolean' && !['netease', 'qq', 'kugou', 'qishui'].includes(platform) && typeof payload?.dedupeByName !== 'boolean') {
      return callback?.({ success: false, error: '不支持的平台' });
    }
    const source = platform === 'qq' ? 'tencent' : platform;
    if (payload?.clear && payload?.playlistId != null) {
      const playlistId = String(payload.playlistId).trim();
      const playlistSource = String(payload?.playlistSource || '').trim();
      if (!playlistId || playlistId.length > 160 || !['netease', 'tencent', 'kugou', 'qishui'].includes(playlistSource)) {
        return callback?.({ success: false, error: '歌单标识无效' });
      }
    }
    if (!payload?.clear && platform && !isMusicSourceEnabled(source, getRuntimeConfig().musicSourcesEnabled)) {
      return callback?.({ success: false, error: '该音源已关闭' });
    }
    const result = await setRoomPlaylistRoaming(roomId, getSocketUserId(socket), payload, socket.id);
    if (result.error) return callback?.({ success: false, error: result.error });
    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_fm_mode', async ({ mode, source } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_fm_mode', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const fmSource = source === 'qq' ? 'tencent' : source;
    if (!isMusicSourceEnabled(fmSource, getRuntimeConfig().musicSourcesEnabled)) {
      callback?.({ success: false, error: '该音源已关闭' });
      return;
    }

    if (fmSource === 'qishui') {
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

    const result = setRoomFmMode(roomId, getSocketUserId(socket), mode, socket.id, fmSource);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_qishui_proxy', ({ enabled, percent } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_qishui_proxy', callback)) return;
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }
    const result = setQishuiProxyEnabled(roomId, getSocketUserId(socket), enabled, socket.id, percent);
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
    if (!isMusicSourceEnabled(platform, getRuntimeConfig().musicSourcesEnabled)) {
      callback?.({ success: false, error: '该音源已关闭' });
      return;
    }
    const result = await createManagedMusicQrSession({
      ownerId: getSocketUserId(socket),
      roomId,
      platform,
      purpose: 'room',
    });
    if (!result.ok) {
      callback?.({ success: false, error: result.error, code: result.code });
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
      callback?.({ success: false, error: result.error, code: result.code });
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
    if (!isMusicSourceEnabled(credential.platform, getRuntimeConfig().musicSourcesEnabled)) {
      await releaseManagedMusicQrCredential(context);
      callback?.({ success: false, error: '该音源已关闭' });
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
        callback?.({ success: false, error: result.error, code: result.code });
        return;
      }
      const plat = credential.platform;
      const stillOwner = () => getRoomInternal(roomId) === room
        && room.creatorId === ownerId && socketToRoom.get(socket.id) === roomId;
      if (!stillOwner()) {
        await releaseManagedMusicQrCredential(context);
        callback?.({ success: false, error: '房间归属或连接已变化，请重新扫码', code: 'ROOM_ACCOUNT_CONFLICT' });
        return;
      }
      if (socket.data.accountId) {
        try {
          await accountMusic.save(socket.data.accountId, plat, result.data, result.cookie || credential.cookie);
        } catch (error) {
          incrementMetric('account_music_save_total', { outcome: 'failed', code: error.code || 'storage' });
          console.error('[Account Music] 账户会员保存失败:', error.code || 'storage');
          await releaseManagedMusicQrCredential(context);
          callback?.({
            success: false,
            error: socket.data.anonymous ? '设备 Cookie 音乐缓存保存失败，请稍后重试' : '账户会员保存失败，请稍后重试，暂不能保证新建房间自动恢复',
            code: socket.data.anonymous ? 'MUSIC_COOKIE_CACHE_SAVE_FAILED' : 'ACCOUNT_MUSIC_SAVE_FAILED',
          });
          return;
        }
        incrementMetric('account_music_save_total', { outcome: 'success' });
      }
      if (!stillOwner()) {
        await releaseManagedMusicQrCredential(context);
        callback?.({ success: false, error: '房间归属或连接已变化，请重试', code: 'ROOM_ACCOUNT_CONFLICT' });
        return;
      }
      patchRoomMusicAccountCache(roomId, plat, result.data, {
        localCookie: result.cookie || credential.cookie,
      });
      broadcastRoomUpdate(roomId);
      refreshRoomPlaybackAfterMusicAccountChange(roomId);
      await finalizeManagedMusicQrCredential(context);
      callback?.({
        success: true,
        account: result.data,
        message: socket.data.anonymous
          ? [result.message, '已按设备 Cookie 身份加密保存，同一身份新建房间可恢复，清除 Cookie 或换设备后不能自动找回'].filter(Boolean).join('；')
          : result.message,
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
    let localAccounts = room.musicAccounts || { netease: null, tencent: null, kugou: null, qishui: null };
    const credentials = await fetchRoomMusicAccountCredentials(roomId);
    if (credentials.ok) {
      for (const plat of ['netease', 'tencent', 'kugou', 'qishui']) {
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
    if (socket.data.anonymous ? !room.ownerAccountId : room.ownerAccountId === socket.data.accountId) {
      try {
        await accountMusic.rememberRoom(socket.data.accountId, getRoomInternal(roomId), {
          ownerUserId: socket.data.anonymous ? getSocketUserId(socket) : undefined,
        });
      } catch (error) {
        incrementMetric('account_music_save_total', { outcome: 'failed', code: error.code || 'storage' });
        callback?.({
          success: false,
          error: socket.data.anonymous ? '设备 Cookie 音乐缓存保存失败，请稍后刷新重试' : '房间会员可用，但账户备份失败，请稍后刷新重试',
          code: socket.data.anonymous ? 'MUSIC_COOKIE_CACHE_SAVE_FAILED' : 'ACCOUNT_MUSIC_SAVE_FAILED',
        });
        return;
      }
    }
    const result = await fetchRoomMusicAccounts(roomId);
    if (!result.ok) {
      callback?.({ success: true, data: localAccounts });
      return;
    }
    // 重新读取最新缓存，避免本次请求开始后的共享切换被旧快照覆盖。
    const latestAccounts = getRoomInternal(roomId)?.musicAccounts || localAccounts;
    // Meting 只返回已共享账号；未共享账号以房间本地缓存为准。
    const merged = mergeRoomMusicAccountsWithUpstream(latestAccounts, result.data);
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
    const plat = ['netease', 'tencent', 'kugou', 'qishui'].includes(platform) ? platform : '';
    if (!plat) {
      callback?.({ success: false, error: '不支持的音源平台' });
      return;
    }
    if (!isMusicSourceEnabled(plat, getRuntimeConfig().musicSourcesEnabled)) {
      callback?.({ success: false, error: '该音源已关闭' });
      return;
    }
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
      callback?.({ success: false, error: result.error, code: result.code });
      return;
    }
    const nextAccount = shared
      ? mergeSharedMusicAccount(current, result.data)
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
    const plat = ['netease', 'tencent', 'kugou', 'qishui'].includes(platform) ? platform : '';
    if (!plat) {
      callback?.({ success: false, error: '不支持的音源平台' });
      return;
    }
    if (!isMusicSourceEnabled(plat, getRuntimeConfig().musicSourcesEnabled)) {
      callback?.({ success: false, error: '该音源已关闭' });
      return;
    }
    const current = room.musicAccounts?.[plat];
    if (current?.hasVip || plat === 'tencent' || plat === 'kugou' || plat === 'qishui') {
      const result = await unbindRoomMusicAccount(roomId, platform);
      if (!result.ok) {
        callback?.({ success: false, error: result.error });
        return;
      }
    }
    if (socket.data.anonymous) {
      try {
        await accountMusic.remove(socket.data.accountId, plat);
      } catch {
        callback?.({ success: false, error: '设备 Cookie 音乐缓存清理失败，请稍后重试', code: 'MUSIC_COOKIE_CACHE_SAVE_FAILED' });
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

  socket.on('set_room_hide_ip_location', ({ hidden } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_hide_ip_location', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomHideIpLocation(
      roomId,
      getSocketUserId(socket),
      hidden,
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

  socket.on('set_room_song_request', ({ enabled, queueLikeSortEnabled, minStaySec, maxPerUser, cooldownSec, queueMaxLength, memberJumpEnabled, memberSeekEnabled, memberPauseEnabled, systemMediaPlayBound, systemMediaSkipBound, dislikeSkipMode, dislikeSkipThreshold, dislikeSkipPercent, clearSongsOnLeaveEnabled, clearSongsOnLeaveDelaySec, deferOfflineRequesterSongs }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_song_request', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setSongRequestEnabled(roomId, getSocketUserId(socket), {
      enabled,
      queueLikeSortEnabled,
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
      deferOfflineRequesterSongs,
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

  socket.on('set_room_admin_self_manage_member_tier', ({ enabled }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_admin_self_manage_member_tier', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomAdminSelfManageMemberTier(roomId, getSocketUserId(socket), enabled, socket.id);
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

  socket.on('transfer_owner', async ({ userId: targetUserId }, callback) => {
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

    try {
      await clearRoomOwnerBindings(roomId);
    } catch (err) {
      console.error('房主转让后清理 Linux.do 绑定失败:', err?.message || err);
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

  socket.on('add_songs', async (payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    const { songs } = socketPayload(payload);
    if (!Array.isArray(songs) || !songs.length || songs.length > 100) {
      callback?.({ success: false, error: '每批点歌限 1 至 100 首', code: 'INVALID_PAYLOAD' });
      return;
    }
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) { callback?.({ success: false, error: '未加入房间' }); return; }
    if (socket.data.bulkAdding) { callback?.({ success: false, error: '上一批歌曲正在添加' }); return; }
    const cleaned = songs.map(sanitizeClientSong);
    if (cleaned.some(item => item.error)) { callback?.({ success: false, error: '歌曲参数无效', code: 'INVALID_PAYLOAD' }); return; }
    socket.data.bulkAdding = true;
    let added = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const userId = getSocketUserId(socket);
      for (const item of cleaned) {
        if (!socket.connected || socketToRoom.get(socket.id) !== roomId) { failed += cleaned.length - added - skipped - failed; break; }
        const user = getRoomInternal(roomId)?.users.get(userId);
        if (!user) { failed += cleaned.length - added - skipped; break; }
        const result = await addToQueue(roomId, item.song, { id: userId, nickname: user?.nickname || '匿名' }, { connectionId: socket.id });
        if (result.error) {
          if (result.error.includes('已经在歌单')) skipped++;
          else { failed += cleaned.length - added - skipped; break; }
        } else { added++; emitSystemChat(roomId, result.systemMessage); }
      }
      callback?.({ success: failed === 0, added, skipped, failed });
    } catch {
      callback?.({ success: false, added, skipped, failed: cleaned.length - added - skipped, error: '批量点歌暂未完成，请稍后重试' });
    } finally {
      socket.data.bulkAdding = false;
      const room = getRoomInternal(roomId);
      if (added && room) emitRoomAndPlayback(roomId, getRoom(roomId));
    }
  });

  socket.on('add_song', async (payload, callback) => {
    const { song, jump } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'add_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    if (jump !== undefined && typeof jump !== 'boolean') {
      callback?.({ success: false, error: '插队参数无效', code: 'INVALID_PAYLOAD' });
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
    }, { jump: jump === true, connectionId: socket.id });
    if (result.error) {
      callback?.({ success: false, error: result.error, ...(result.code ? { code: result.code } : {}) });
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

  socket.on('skip_song', async ({ reason, queueId } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'skip_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await skipSong(roomId, getSocketUserId(socket), socket.id, { reason, queueId });
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

    // 待播点赞参与排序，当前曲点赞仅计数；只推 queue/current 并合并高频广播
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

  socket.on('share_song_to_chat', async (payload, callback) => {
    const { songs, text } = socketPayload(payload);
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketChat, 'send_chat', callback)) return;
    const shareRate = await consumeDistributedSocketRate(socket, 'chat-song-card', {
      windowMs: 60_000,
      max: 20,
    });
    if (!shareRate.allowed) {
      incrementMetric('socket_rate_limit_rejected_total', { event: 'chat_song_card' });
      callback?.({ success: false, error: '分享太快啦，稍等一下再试' });
      return;
    }

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = shareSongToChat(roomId, getSocketUserId(socket), songs, { text });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    callback?.({ success: true, message: result.message });
    io.to(roomId).emit('chat_message', result.message);
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
            if (!result?.error) {
              emitRoomAndPlayback(roomId, result.room);
            }
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

  socket.on('list_favorite_categories', async (_payload, callback) => {
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
      return;
    }
    const categories = await listFavoriteCategories(identity.userId);
    callback?.({ success: true, categories });
  });

  socket.on('create_favorite_category', async (payload, callback) => {
    if (rejectRateLimited(socket, limitSocketAction, 'create_favorite_category', callback)) return;
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) return callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
    const { name } = socketPayload(payload);
    const result = await createFavoriteCategory(identity.userId, name);
    callback?.(result.error ? { success: false, error: result.error } : { success: true, ...result });
  });

  socket.on('set_favorite_category', async (payload, callback) => {
    if (rejectRateLimited(socket, limitSocketAction, 'set_favorite_category', callback)) return;
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) return callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
    const { song, category } = socketPayload(payload);
    const clean = sanitizeFavoriteSongInput(song);
    if (!clean) return callback?.({ success: false, error: '收藏歌曲数据无效' });
    const result = await setFavoriteCategory(identity.userId, clean, category);
    callback?.(result.error ? { success: false, error: result.error } : { success: true, ...result });
  });

  socket.on('delete_favorite_category', async (payload, callback) => {
    if (rejectRateLimited(socket, limitSocketAction, 'delete_favorite_category', callback)) return;
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      incrementMetric('favorite_category_delete_total', { outcome: 'auth_rejected' });
      return callback?.({ success: false, error: '会话未就绪，请刷新页面后重试', code: 'AUTH_REQUIRED' });
    }
    const { name, keepSongs } = socketPayload(payload);
    if (typeof name !== 'string' || typeof keepSongs !== 'boolean') {
      incrementMetric('favorite_category_delete_total', { outcome: 'invalid_input' });
      return callback?.({ success: false, error: '收藏分类参数无效', code: 'INVALID_FAVORITE_CATEGORY' });
    }
    const result = await deleteFavoriteCategory(identity.userId, name, keepSongs);
    incrementMetric('favorite_category_delete_total', { outcome: result.error ? 'failed' : 'success' });
    callback?.(result.error ? { success: false, error: result.error, code: result.code } : { success: true, ...result });
  });

  socket.on('set_favorite', async (payload, callback) => {
    const { song, favorite } = socketPayload(payload);
    if (rejectRateLimited(socket, limitSocketAction, 'set_favorite', callback)) return;

    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
      return;
    }

    const clean = sanitizeFavoriteSongInput(song);
    if (!clean) {
      callback?.({ success: false, error: '收藏歌曲数据无效' });
      return;
    }

    const result = await setFavoriteSong(identity.userId, clean, Boolean(favorite));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, favorites: result.favorites, favorite: result.favorite });
  });

  socket.on('create_favorite_share', async (_payload, callback) => {
    if (rejectRateLimited(socket, limitSocketAction, 'create_favorite_share', callback)) return;
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) return callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
    const result = await createFavoriteShare(identity.userId);
    callback?.(result.error ? { success: false, error: result.error } : { success: true, ...result });
  });

  socket.on('revoke_favorite_share', async (_payload, callback) => {
    if (rejectRateLimited(socket, limitSocketAction, 'revoke_favorite_share', callback)) return;
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) return callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
    const result = await revokeFavoriteShare(identity.userId);
    callback?.(result.error ? { success: false, error: result.error } : { success: true, ...result });
  });

  socket.on('preview_favorite_share', async (payload, callback) => {
    const { code } = socketPayload(payload);
    if (rejectRateLimited(socket, limitSocketAction, 'preview_favorite_share', callback)) return;
    const shareCodeDigest = createHash('sha256').update(String(code || '').trim()).digest('hex');
    const codeRate = await distributedSocketRateLimiter.consume({
      scope: 'favorite-share-preview',
      principal: `share:${shareCodeDigest}`,
      windowMs: 60_000,
      max: 20,
    });
    if (!codeRate.allowed) {
      incrementMetric(codeRate.unavailable ? 'favorite_share_rate_limit_unavailable_total' : 'favorite_share_rate_limit_rejected_total');
      callback?.({
        success: false,
        error: codeRate.unavailable ? '服务繁忙，请稍后重试' : '分享码访问过于频繁，请稍后重试',
        code: codeRate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'FAVORITE_SHARE_RATE_LIMITED',
      });
      return;
    }
    const result = await previewFavoriteShare(code);
    callback?.(result.error ? { success: false, error: result.error } : { success: true, songs: result.songs, code: result.code });
  });

  socket.on('import_favorite_share', async (payload, callback) => {
    const { code, selectedIds } = socketPayload(payload);
    if (rejectRateLimited(socket, limitSocketAction, 'import_favorites', callback)) return;
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) return callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
    const result = await importFavoriteShare(identity.userId, code, selectedIds);
    callback?.(result.error ? { success: false, error: result.error } : { success: true, favorites: result.favorites, imported: result.imported, dropped: result.dropped, maxFavorites: result.maxFavorites });
  });

  socket.on('import_favorites', async (payload, callback) => {
    const { songs, sourceUserId } = socketPayload(payload);
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
      const clean = sanitizeFavoriteSongInput(song);
      if (clean) cleanSongs.push(clean);
    }

    if (cleanSongs.length === 0) return callback?.({ success: false, error: '收藏数据格式无效' });

    const result = await importFavoriteSongs(identity.userId, cleanSongs);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({
      success: true,
      favorites: result.favorites,
      imported: result.imported,
      dropped: (result.dropped || 0) + (songs.length - cleanSongs.length),
      maxFavorites: result.maxFavorites,
      // 仅作为客户端展示状态；目标身份仍由当前已验证 Cookie 决定，绝不按该字段读取数据。
      identitySame: Boolean(sourceUserId && String(sourceUserId).trim() === identity.userId),
    });
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
    emitSystemChat(roomId, updated.systemMessage);
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
    unbindSocketAccountSession(socket.id);
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
  monitorSocketAccountSession(socket);
});

let autoAdvanceRunning = false;

async function checkAutoAdvance() {
  if (autoAdvanceRunning) return;
  autoAdvanceRunning = true;

  try {
    for (const roomId of listRoomIds()) {
      const internal = getRoomInternal(roomId);
      if (!internal || internal.users.size === 0) continue;

      if ((internal.randomLoading || internal.randomError) && !internal.current) {
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

registerMetingRoomResolver(getRoomInternal, (roomId, platform, failedCookie) => {
  if (!failedCookie || getRoomMusicAccountCookie(roomId, platform) !== failedCookie) return;
  const account = getRoomInternal(roomId)?.musicAccounts?.[platform];
  if (!account) return;
  patchRoomMusicAccountCache(roomId, platform, { ...account, isValid: false }, { localCookie: null });
  broadcastRoomUpdate(roomId);
});
await initRooms();
const redisMaintenance = createRedisMaintenance({ getClient: getRedisClient, isRoomKnown: roomExists });

const setupRequired = isSetupRequired();
if (!isRedisEnabled()) {
  if (setupRequired && !hasRedisEnvConfig()) {
    console.warn('🛠️ OpenMusic 尚未初始化，请访问 /setup 完成首次部署（需配置 Redis）');
  } else {
    console.error('❌ Redis 为必需依赖：未连接时无法启动。请检查 REDIS_URL / REDIS_HOST 后重试。');
    process.exit(1);
  }
} else {
  riskChallengeBus = createRiskChallengeBus({
    client: getRedisClient(), onChallenge: id => {
      const config = getRuntimeConfig();
      if (config.riskChallengeEnabled && config.turnstileEnabled) suspendAccountSocketsForHumanChallenge(id);
    },
    onSessionRevoked: sid => {
      io.local.to(`account-session:${sid}`).emit('account_session_invalidated', { reason: 'session_revoked', stopReconnect: true });
      io.local.in(`account-session:${sid}`).disconnectSockets(true);
    },
    onUnavailable: () => { io.local.disconnectSockets(true); },
    onRecovered: () => { io.local.disconnectSockets(true); },
    metric: incrementMetric,
  });
  await riskChallengeBus.start();
  redisMaintenance.start();
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
  riskChallengeBus?.stop();
  console.log(`${signal}: 正在优雅退出，通知客户端重连并刷写房间…`);

  const forceTimer = setTimeout(() => {
    console.error('优雅退出超时，强制结束进程');
    process.exit(1);
  }, 25_000);
  forceTimer.unref?.();

  try {
    await redisMaintenance.stop();
    // 先通知发布重启，再断开连接，旧客户端可忽略新增事件继续普通重连
    try {
      io.emit('server_restarting');
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
