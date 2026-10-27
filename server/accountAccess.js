import { riskRequestOperation } from './riskErrors.js';

const PUBLIC_GET = new Set([
  '/api/health', '/api/app-version', '/api/site-seo', '/api/auth/session', '/api/auth/providers',
  '/api/auth/linuxdo/start', '/api/auth/linuxdo/callback', '/api/auth/github/start', '/api/auth/github/callback',
  '/api/auth/wechat/qr',
  '/api/site-announcement', '/api/donations', '/api/rooms',
]);
const PUBLIC_POST = new Set([
  '/api/session/bootstrap', '/api/auth/email/code', '/api/auth/email/register', '/api/auth/email/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/wechat/start', '/api/auth/wechat/poll', '/api/auth/wechat/account',
]);

export function isAccountPublicPath(path, method) {
  return (method === 'GET' && PUBLIC_GET.has(path)) || (method === 'POST' && PUBLIC_POST.has(path));
}

export function createAccountAccessMiddleware({ resolveAccount, resolveIdentity, ensureIdentity, risk, getIp, withContext, metric }) {
  return async (req, res, next) => {
    const path = req.path.toLowerCase();
    const publicLobby = req.method === 'GET' && path === '/api/rooms';
    const protectedProxy = /^\/(?:wx-proxy|cgi-bin)(?:\/|$)/u.test(path);
    if ((!path.startsWith('/api/') && !protectedProxy) || path.startsWith('/api/admin/') || path.startsWith('/api/setup/') || (!publicLobby && isAccountPublicPath(path, req.method))) return next();
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.vary?.('Cookie');
    try {
      const account = await resolveAccount(req);
      if (!account) {
        if (publicLobby) {
          req.publicLobbyPreview = true;
          return next();
        }
        metric('account_access_rejected_total', { reason: 'anonymous' });
        return res.status(401).json({ error: '请先登录账户', code: 'ACCOUNT_AUTH_REQUIRED' });
      }
      const ip = getIp(req);
      const kind = /^\/api\/(?:meting|music(?:\/|$)|media-proxy|qishui-source)/u.test(path) ? 'music' : 'api';
      const operation = path === '/api/qishui-source' ? 'source' : path === '/api/media-proxy' ? 'media' : req.query?.type;
      const result = await risk.consume(account, { ip, kind, operation, userAgent: req.headers?.['user-agent'] || '' });
      const fallback = result.code === 'ACCOUNT_RISK_BLOCKED' && !result.limited && req.method === 'GET' && path === '/api/meting' && req.query?.type === 'url';
      metric('account_request_total', { kind, outcome: fallback ? 'substituted' : result.allowed ? 'allowed' : result.code });
      if (!result.allowed && !fallback) {
        const status = result.limited ? 429 : result.status;
        const code = result.limited ? 'ACCOUNT_RATE_LIMITED' : result.code;
        if (status === 429) res.setHeader('Retry-After', String(result.retryAfter));
        return res.status(status).json({ error: status === 403 ? '账户访问已受限，请联系管理员复核' : '请求额度已达上限，请稍后重试', code, retryAfterSec: status === 429 ? result.retryAfter : undefined });
      }
      const identity = resolveIdentity(req);
      const roomUserId = account.roomUserId || await ensureIdentity(account.id);
      if (!identity?.userId || identity.userId !== roomUserId) return res.status(401).json({ error: '账户身份已变化，请刷新页面后重试', code: 'ACCOUNT_IDENTITY_MISMATCH' });
      req.account = account;
      req.apiIdentity = identity;
      if (fallback) {
        req.riskMetingFallback = true;
        req.metingQueryOverride = Object.freeze({ server: 'netease', type: 'url', id: '2094958154', quality: 'jyeffect' });
      }
      const outcome = { operation: riskRequestOperation(path, req.query?.type), source: path.startsWith('/api/qishui') ? 'qishui' : req.query?.server, method: req.method };
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
      return res.status(Number(error.status) || 503).json({ error: error.code === 'ACCOUNT_RISK_BLOCKED' ? '账户访问已受限，请联系管理员复核' : '账户验证暂不可用，请稍后重试', code: error.code || 'ACCOUNT_SESSION_UNAVAILABLE' });
    }
  };
}
