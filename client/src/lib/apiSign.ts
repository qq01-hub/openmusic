const PUBLIC_API_PATHS = new Set([
  '/api/health', '/api/app-version', '/api/site-announcement', '/api/site-seo',
  '/api/session/bootstrap', '/api/auth/email/code', '/api/auth/email/register',
  '/api/auth/email/login', '/api/auth/logout', '/api/auth/session',
  '/api/auth/providers', '/api/auth/wechat/account', '/api/auth/refresh',
]);

export function needsApiSign(url: string, method = 'GET'): boolean {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, origin);
    const pathname = parsed.pathname.toLowerCase();
    if (parsed.origin !== origin || !pathname.startsWith('/api/')) return false;
    if (PUBLIC_API_PATHS.has(pathname)) return false;
    if (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/setup/')) return false;
    if (pathname === '/api/rooms' && method.toUpperCase() === 'GET') return false;
    return true;
  } catch { return false; }
}
