function trustedOrigin(origin, host, allowedOrigins) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin && (parsed.host === host || Boolean(allowedOrigins?.has(origin)));
  } catch { return false; }
}

export function createAccountSocketOriginGuard({ allowedOrigins = null, allowDevelopmentOrigin = () => false } = {}) {
  return (req, callback) => {
    const origin = req.headers?.origin;
    const allowed = origin
      ? trustedOrigin(origin, req.headers?.host, allowedOrigins) || allowDevelopmentOrigin(origin)
      : req.headers?.['sec-fetch-site'] !== 'cross-site';
    callback(null, Boolean(allowed));
  };
}

export function createAccountRequestGuard({ allowedOrigins = null } = {}) {
  return (req, res, next) => {
    const path = req.path.toLowerCase();
    const protectedProxy = /^\/(?:wx-proxy|cgi-bin)(?:\/|$)/u.test(path);
    if ((!path.startsWith('/api/') && !protectedProxy) || path.startsWith('/api/admin/') || path.startsWith('/api/setup/')) return next();
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.vary?.('Cookie');
    res.vary?.('Origin');
    if (req.method === 'GET' && OAUTH_NAVIGATION_PATHS.has(path)) return next();
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const origin = req.headers.origin;
    const trusted = trustedOrigin(origin, req.headers.host, allowedOrigins);
    if ((origin && !trusted) || (!trusted && req.headers['sec-fetch-site'] === 'cross-site') || (unsafe && !trusted && req.headers['x-openmusic-request'] !== '1')) {
      return res.status(403).json({ error: '请求来源校验失败，请从本站重新操作', code: 'ACCOUNT_CSRF_REJECTED' });
    }
    return next();
  };
}
const OAUTH_NAVIGATION_PATHS = new Set([
  '/api/auth/linuxdo/start', '/api/auth/linuxdo/callback',
  '/api/auth/github/start', '/api/auth/github/callback',
]);

