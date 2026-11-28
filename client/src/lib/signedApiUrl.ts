import { useEffect, useState } from 'react';
import { needsApiSign } from './apiSign';
import { ensureSessionBootstrap, hasSessionBootstrapReady, isSessionBootstrapLoginRequired } from './sessionBootstrap';
import { ensureFreshAccountAccess, hasVerifiedAccountSession, setAnonymousAccess, updateAccountAccess } from './accountAccessSession';

function createAuthExpiredError(): Error & { code: string; status: number } {
  return Object.assign(new Error('登录已过期，请重新登录'), {
    code: 'ACCOUNT_AUTH_REQUIRED',
    status: 401,
  });
}

function notifyAuthRequired(): void {
  setAnonymousAccess(false);
  updateAccountAccess(null);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('openmusic:account-auth-required'));
  }
}

// API 签名已整体移除：客户端从未真正计算过签名，服务端也从未校验，
// 授权一律以 HttpOnly 会话 Cookie 与服务端会话校验为准。
// 本函数保留为同源 /api URL 规范化工具，供既有调用方继续使用。
export function stripApiSignParams(url: string): string {
  if (!url) return url;
  if (!url.includes('/api/')) return url;
  if (url.startsWith('/api/')) return url;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin || !parsed.pathname.startsWith('/api/')) {
      if (/^https?:\/\//i.test(url)) return url;
      return parsed.href;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return url; }
}

export async function signApiUrl(relativeUrl: string, options?: { force?: boolean }): Promise<string> {
  if (!needsApiSign(relativeUrl)) return relativeUrl;
  if (!options?.force && isSessionBootstrapLoginRequired()) {
    notifyAuthRequired();
    throw createAuthExpiredError();
  }
  if (!await ensureFreshAccountAccess()) {
    notifyAuthRequired();
    throw createAuthExpiredError();
  }
  const clientId = await ensureSessionBootstrap(Boolean(options?.force));
  if (!clientId && isSessionBootstrapLoginRequired()) {
    notifyAuthRequired();
    throw createAuthExpiredError();
  }
  return stripApiSignParams(relativeUrl);
}

export async function refreshSignedApiUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  return signApiUrl(url, { force: true });
}

export async function resolveSignedApiUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  return signApiUrl(url);
}

function canResolveSignedSynchronously(canonical: string | null): boolean {
  if (!canonical) return true;
  if (!needsApiSign(canonical)) return true;
  return hasVerifiedAccountSession() && hasSessionBootstrapReady();
}

export function useSignedApiUrl(url: string | null | undefined): string | null {
  const canonical = url ? stripApiSignParams(url) : null;
  const syncReady = canResolveSignedSynchronously(canonical);
  const [state, setState] = useState<{ url: string | null; signed: string | null }>(() => ({
    url: canonical, signed: syncReady ? canonical : null,
  }));
  useEffect(() => {
    if (!canonical || canResolveSignedSynchronously(canonical)) {
      setState((prev) => (
        prev.url === canonical && prev.signed === canonical
          ? prev
          : { url: canonical, signed: canonical }
      ));
      return;
    }
    let cancelled = false;
    void signApiUrl(canonical).then((next) => {
      if (!cancelled) {
        setState((prev) => (
          prev.url === canonical && prev.signed === next
            ? prev
            : { url: canonical, signed: next }
        ));
      }
    }).catch(() => {
      if (!cancelled) {
        setState((prev) => (
          prev.url === canonical && prev.signed === null
            ? prev
            : { url: canonical, signed: null }
        ));
      }
    });
    return () => { cancelled = true; };
  }, [canonical]);
  return state.url === canonical ? state.signed : null;
}
