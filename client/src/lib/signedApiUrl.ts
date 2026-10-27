import { useEffect, useState } from 'react';
import { needsApiSign } from './apiSign';
import { ensureSessionBootstrap } from './sessionBootstrap';
import { ensureFreshAccountAccess } from './accountAccessSession';

const SIGN_QUERY_KEYS = ['om_ts', 'om_nonce', 'om_sign'] as const;

export function stripApiSignParams(url: string): string {
  if (!url) return url;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, origin);
    const hadSign = SIGN_QUERY_KEYS.some((key) => parsed.searchParams.has(key));
    for (const key of SIGN_QUERY_KEYS) parsed.searchParams.delete(key);
    if (parsed.origin !== origin || !parsed.pathname.startsWith('/api/')) {
      if (!hadSign && /^https?:\/\//i.test(url)) return url;
      return parsed.href;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return url; }
}

export async function signApiUrl(relativeUrl: string, options?: { force?: boolean }): Promise<string> {
  if (!needsApiSign(relativeUrl)) return relativeUrl;
  if (!await ensureFreshAccountAccess()) throw new Error('登录已过期，请重新登录');
  await ensureSessionBootstrap(Boolean(options?.force));
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

export function useSignedApiUrl(url: string | null | undefined): string | null {
  const canonical = url ? stripApiSignParams(url) : null;
  const [state, setState] = useState<{ url: string | null; signed: string | null }>(() => ({
    url: canonical, signed: canonical && !needsApiSign(canonical) ? canonical : null,
  }));
  useEffect(() => {
    if (!canonical || !needsApiSign(canonical)) {
      setState({ url: canonical, signed: canonical });
      return;
    }
    let cancelled = false;
    void signApiUrl(canonical).then((next) => {
      if (!cancelled) setState({ url: canonical, signed: next });
    }).catch(() => {
      if (!cancelled) setState({ url: canonical, signed: null });
    });
    return () => { cancelled = true; };
  }, [canonical]);
  return state.url === canonical ? state.signed : null;
}
