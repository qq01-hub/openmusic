import { riskRequestOperation } from './riskErrors.js';
import { DeviceProofError } from './deviceProof.js';
import { musicRequestContext, summarizeMusicResponse } from './riskMusicResponse.js';

const PUBLIC_GET = new Set([
  '/api/health', '/api/app-version', '/api/site-seo', '/api/auth/session', '/api/auth/providers',
  '/api/auth/linuxdo/start', '/api/auth/linuxdo/callback', '/api/auth/github/start', '/api/auth/github/callback',
  '/api/auth/wechat/qr', '/api/auth/human-challenge',
  '/api/site-announcement', '/api/donations', '/api/rooms',
]);
const PUBLIC_POST = new Set([
  '/api/session/bootstrap', '/api/auth/email/code', '/api/auth/email/register', '/api/auth/email/login',
  '/api/auth/logout', '/api/auth/human-challenge',
  '/api/auth/refresh', '/api/auth/device-login', '/api/auth/device-migrate',
  '/api/auth/wechat/start', '/api/auth/wechat/poll', '/api/auth/wechat/account',
]);

export function isAccountPublicPath(path, method) {
  return (method === 'GET' && PUBLIC_GET.has(path)) || (method === 'POST' && PUBLIC_POST.has(path));
}

export function isPublicMetingCoverRequest(req) {
  const query = req.query || {};
  return req.method === 'GET' && req.path.toLowerCase() === '/api/meting'
    && query.type === 'pic' && ['netease', 'tencent', 'kugou', 'qishui'].includes(query.server)
    && typeof query.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(query.id)
    && Object.keys(query).every(key => ['type', 'server', 'id', 'size'].includes(key))
    && (query.size === undefined || typeof query.size === 'string' && /^[1-9]\d{0,3}$/u.test(query.size) && Number(query.size) <= 2048);
}

export function createAccountAccessMiddleware({ resolveAccount, resolveIdentity, ensureIdentity, risk, getIp, getNetworkContext = () => ({}), withContext, metric, verifyDevice = async () => { throw new DeviceProofError(); }, onHumanChallenge = () => {}, resolveAnonymous = async () => null }) {
  return async (req, res, next) => {
    const startedAt = performance.now();
    // Express 默认忽略路由大小写及尾斜杠，权限分类必须采用相同语义，签名仍绑定原始 URL
    const path = req.path.toLowerCase().replace(/\/+$/u, '');
    const publicLobby = req.method === 'GET' && path === '/api/rooms';
    const publicCover = isPublicMetingCoverRequest(req);
    if (publicCover) req.publicMetingCover = true;
    const protectedProxy = /^\/(?:wx-proxy|cgi-bin)(?:\/|$)/u.test(path);
    if ((!path.startsWith('/api/') && !protectedProxy) || path.startsWith('/api/admin/') || path.startsWith('/api/setup/') || (!publicLobby && isAccountPublicPath(path, req.method))) return next();
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.vary?.('Cookie');
    try {
      const account = await resolveAccount(req) || (!protectedProxy ? await resolveAnonymous(req) : null);
      if (!account) {
        if (publicLobby || publicCover) {
          if (publicLobby) req.publicLobbyPreview = true;
          return next();
        }
        metric('account_access_rejected_total', { reason: 'anonymous' });
        return res.status(401).json({ error: '请先登录账户', code: 'ACCOUNT_AUTH_REQUIRED' });
      }
      if (!account.anonymous && !publicCover && (/^\/api\/(?:meting$|music(?:\/|$)|qishui-source$)/u.test(path) || path.startsWith('/api/auth/') && req.method === 'POST')) await verifyDevice(req);
      const ip = getIp(req);
      const kind = publicCover ? 'image' : /^\/api\/(?:meting|music(?:\/|$)|media-proxy|qishui-source)/u.test(path) ? 'music' : 'api';
      const musicContext = kind === 'music' ? musicRequestContext(path, req.query) : null;
      // 未识别的 Meting 操作也计入取链预算，防止上游接受别名、缺省值或重复参数后绕过额度
      const operation = musicContext?.operation || (path === '/api/meting' ? 'url' : req.query?.type);
      const result = await risk.consume(account, { ip, kind, operation, userAgent: req.headers?.['user-agent'] || '', network: getNetworkContext(req) });
      if (publicCover && result.code !== 'ACCOUNT_HUMAN_CHECK_REQUIRED') return next();
      if (musicContext) {
        let summary;
        let recorded = false;
        const summarize = body => summarizeMusicResponse(musicContext, body, { status: res.statusCode, substituted: Boolean(req.riskMetingFallback) });
        const originalMusicJson = res.json;
        const originalMusicSend = res.send;
        res.json = function (body) {
          summary = summarize(body);
          return originalMusicJson.call(this, body);
        };
        res.send = function (body) {
          // Express 的 json 会调用 send，不能以序列化文本覆盖已经提取的歌曲摘要
          if (!summary) summary = summarize(body);
          return originalMusicSend.call(this, body);
        };
        const record = aborted => {
          if (recorded) return;
          recorded = true;
          const event = { ...(summary || summarize(undefined)), requestId: result.requestId, at: result.at, ip,
            status: res.statusCode, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
          if (aborted) { event.outcome = 'aborted'; event.songs = []; }
          void risk.recordMusicResponse(account.id, event).catch(() => metric('risk_storage_error_total', { operation: 'music_response' }));
        };
        res.once('finish', () => record(false));
        res.once('close', () => { if (!res.writableFinished) record(true); });
      }
      const fallback = result.code === 'ACCOUNT_RISK_BLOCKED' && !result.limited && req.method === 'GET' && path === '/api/meting' && req.query?.type === 'url';
      metric('account_request_total', { kind, outcome: fallback ? 'substituted' : result.allowed ? 'allowed' : result.code });
      if (!result.allowed && !fallback) {
        if (result.code === 'ACCOUNT_HUMAN_CHECK_REQUIRED') onHumanChallenge(account.id);
        const status = result.code === 'ACCOUNT_HUMAN_CHECK_REQUIRED' ? 403 : result.limited ? 429 : result.status;
        const code = result.limited ? 'ACCOUNT_RATE_LIMITED' : result.code;
        if (status === 429) res.setHeader('Retry-After', String(result.retryAfter));
        return res.status(status).json({ error: result.code === 'ACCOUNT_HUMAN_CHECK_REQUIRED' ? '访问行为异常，请先完成人机验证' : status === 403 ? '账户访问已受限，请联系管理员复核' : '请求额度已达上限，请稍后重试', code, retryAfterSec: status === 429 ? result.retryAfter : undefined });
      }
      const identity = resolveIdentity(req);
      const roomUserId = account.roomUserId || await ensureIdentity(account.id);
      if (!identity?.userId || identity.userId !== roomUserId) return res.status(401).json({ error: '账户身份已变化，请刷新页面后重试', code: 'ACCOUNT_IDENTITY_MISMATCH' });
      if (!account.anonymous) req.account = account;
      req.riskAccount = account;
      req.apiIdentity = identity;
      if (fallback) {
        req.riskMetingFallback = true;
        req.metingQueryOverride = Object.freeze({ server: 'netease', type: 'url', id: '2094958154', quality: 'standard' });
      }
      const outcome = { operation: musicContext?.operation || riskRequestOperation(path, req.query?.type), source: musicContext?.source || (path.startsWith('/api/qishui') ? 'qishui' : req.query?.server), method: req.method };
      const originalJson = res.json;
      res.json = function (body) {
        if (this.statusCode >= 400 && body && typeof body === 'object') {
          outcome.code = body.code;
          outcome.message = typeof body.error === 'string' ? body.error.slice(0, 256) : undefined;
        }
        return originalJson.call(this, body);
      };
      res.once('finish', () => {
        if (res.statusCode < 400) return;
        void risk.recordOutcome(account.id, res.statusCode, result.at, outcome).catch(() => metric('risk_storage_error_total', { operation: 'outcome' }));
      });
      return withContext({ accountId: account.id, userId: identity.userId, clientIp: ip }, () => next());
    } catch (error) {
      metric('account_access_rejected_total', { reason: error.code || 'storage' });
      if (publicCover) return next();
      return res.status(Number(error.status) || 503).json({ error: error.code === 'ACCOUNT_RISK_BLOCKED' ? '账户访问已受限，请联系管理员复核' : error.code === 'ACCOUNT_DEVICE_RATE_LIMITED' ? '设备请求过于频繁，请稍后重试' : error.code?.startsWith('ACCOUNT_DEVICE_') ? '设备验证失败，请重新登录' : '账户验证暂不可用，请稍后重试', code: error.code || 'ACCOUNT_SESSION_UNAVAILABLE' });
    }
  };
}
