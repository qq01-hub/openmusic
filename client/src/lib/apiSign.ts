const PUBLIC_API_PATHS = new Set([
  '/api/health', '/api/app-version', '/api/site-announcement', '/api/site-seo',
  '/api/session/bootstrap', '/api/auth/email/code', '/api/auth/email/register',
  '/api/auth/email/login', '/api/auth/logout', '/api/auth/session',
  '/api/auth/providers', '/api/auth/wechat/account', '/api/auth/refresh',
  '/api/auth/device-login', '/api/auth/device-migrate', '/api/auth/wechat/start', '/api/auth/wechat/qr', '/api/auth/wechat/poll',
  '/api/auth/social/wechat_scan/start', '/api/auth/social/wechat_scan/poll', '/api/auth/social/wechat_scan/complete',
  '/api/auth/social/qq_scan/start', '/api/auth/social/qq_scan/poll', '/api/auth/social/qq_scan/complete',
]);

export function isPublicCoverUrl(url: string, method = 'GET'): boolean {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, origin);
    return method.toUpperCase() === 'GET' && parsed.origin === origin && parsed.pathname === '/api/meting'
      && parsed.searchParams.getAll('type').length === 1 && parsed.searchParams.get('type') === 'pic'
      && ['netease', 'tencent', 'kugou', 'qishui'].includes(parsed.searchParams.get('server') || '')
      && /^[A-Za-z0-9_-]{1,200}$/u.test(parsed.searchParams.get('id') || '')
      && [...parsed.searchParams.keys()].every(key => ['server', 'type', 'id', 'size'].includes(key));
  } catch { return false; }
}

export function needsApiSign(url: string, method = 'GET'): boolean {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, origin);
    const pathname = parsed.pathname.toLowerCase();
    if (parsed.origin !== origin || !pathname.startsWith('/api/')) return false;
    if (PUBLIC_API_PATHS.has(pathname)) return false;
    if (isPublicCoverUrl(url, method)) return false;
    if (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/setup/')) return false;
    if (pathname === '/api/rooms' && method.toUpperCase() === 'GET') return false;
    return true;
  } catch { return false; }
}
