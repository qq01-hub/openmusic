import { needsApiSign } from '../lib/apiSign';
import { ensureSessionBootstrap, resetSessionBootstrap } from '../lib/sessionBootstrap';
import { ensureFreshAccountAccess, forgetAccountAccess, getAccountSessionGeneration, refreshAccountAccess, runAccountSessionTask, waitForAccountRefresh } from '../lib/accountAccessSession';
import { detectSiteAccessBlockResponse, isSiteAccessBlocked, markSiteAccessBlocked, getSiteAccessBlockCode } from '../lib/siteAccessGate';
import { readSoftBlockCodeFromResponse, softBlockMessage, SOFT_BLOCK_CODES } from '../lib/softBlock';

const DEFAULT_TIMEOUT_MS = 10000;
const PUBLIC_GET_PATHS = new Set(['/api/health', '/api/app-version', '/api/site-seo', '/api/rooms', '/api/site-announcement', '/api/donations']);

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isSameOriginApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!parsed.pathname.startsWith('/api/')) return false;
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function blockedSyntheticResponse(): Response {
  const code = getSiteAccessBlockCode() || SOFT_BLOCK_CODES.SITE_BAN;
  // 本地短路：不发网络请求。DevTools 里看起来像接口返回，实为前端冻结后的假响应。
  return new Response(
    JSON.stringify({
      error: softBlockMessage(code),
      code,
      local: true,
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'X-OpenMusic-Site-Blocked': '1',
        'X-OpenMusic-Block-Code': code,
        'X-OpenMusic-Block-Local': '1',
      },
    },
  );
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (isSiteAccessBlocked()) {
    return blockedSyntheticResponse();
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const url = resolveRequestUrl(input);
  const sameOriginApi = isSameOriginApiUrl(url);

  // 仅同源 /api 默认带 Cookie；外链（如七牛上传）绝不能 credentials:include，否则 CORS 直接 Failed to fetch
  const initFinal: RequestInit = { ...init };
  if (sameOriginApi && initFinal.credentials === undefined) {
    initFinal.credentials = 'include';
  }

  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (sameOriginApi && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const headers = new Headers(initFinal.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-OpenMusic-Request', '1');
    initFinal.headers = headers;
  }

  try {
    const pathname = sameOriginApi ? new URL(url, window.location.origin).pathname.toLowerCase() : '';
    if (['/api/auth/email/login', '/api/auth/email/register', '/api/auth/wechat/account'].includes(pathname) && method === 'POST') forgetAccountAccess();
    const generation = getAccountSessionGeneration();
    const assertCurrent = () => {
      if (generation !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新操作');
      controller.signal.throwIfAborted();
    };
    if (pathname.startsWith('/api/auth/') && pathname !== '/api/auth/refresh' && !['GET', 'HEAD', 'OPTIONS'].includes(method)) await waitForAccountRefresh();
    const businessRequest = sameOriginApi && !pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/admin/') && !pathname.startsWith('/api/setup/') && pathname !== '/api/session/bootstrap' && !(method === 'GET' && PUBLIC_GET_PATHS.has(pathname));
    if (businessRequest) {
      const fresh = await ensureFreshAccountAccess();
      assertCurrent();
      if (!fresh) {
        window.dispatchEvent(new Event('openmusic:account-auth-required'));
        return new Response(JSON.stringify({ code: 'ACCOUNT_AUTH_REQUIRED', error: '请先登录账户' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (needsApiSign(url, method) && sameOriginApi) await ensureSessionBootstrap();
    if (isSiteAccessBlocked()) return blockedSyntheticResponse();
    controller.signal.throwIfAborted();
    if (businessRequest || pathname === '/api/auth/session') assertCurrent();
    const retryInput = input instanceof Request ? input.clone() : input;
    const send = () => {
      if (businessRequest || pathname === '/api/auth/session' || pathname.startsWith('/api/auth/')) assertCurrent();
      return fetch(input, { ...initFinal, signal: controller.signal });
    };
    const serializedAuth = pathname === '/api/auth/session' || (pathname.startsWith('/api/auth/') && pathname !== '/api/auth/refresh' && !['GET', 'HEAD', 'OPTIONS'].includes(method));
    let res = await (serializedAuth ? runAccountSessionTask(send) : send());
    if (businessRequest || pathname === '/api/auth/session') assertCurrent();
    if (businessRequest && res.status === 401) {
      const data = await res.clone().json().catch(() => ({})) as { code?: string };
      assertCurrent();
      if (['ACCOUNT_AUTH_REQUIRED', 'ACCOUNT_SESSION_INVALID', 'ACCOUNT_IDENTITY_MISMATCH'].includes(data.code || '') && await refreshAccountAccess()) {
        resetSessionBootstrap();
        await ensureSessionBootstrap();
        assertCurrent();
        res = await fetch(retryInput, { ...initFinal, signal: controller.signal });
        assertCurrent();
      }
    }
    if (businessRequest && (res.status === 401 || res.status === 403)) {
      const data = await res.clone().json().catch(() => ({})) as { code?: string };
      if (['ACCOUNT_AUTH_REQUIRED', 'ACCOUNT_SESSION_INVALID', 'ACCOUNT_IDENTITY_MISMATCH', 'ACCOUNT_RISK_BLOCKED'].includes(data.code || '')) {
        window.dispatchEvent(new Event('openmusic:account-auth-required'));
      }
    }
    if (sameOriginApi && detectSiteAccessBlockResponse(res)) {
      markSiteAccessBlocked(readSoftBlockCodeFromResponse(res) || SOFT_BLOCK_CODES.SITE_BAN);
    }
    return res;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}
