const SIGN_QUERY_KEYS = new Set(['om_ts', 'om_nonce', 'om_sign']);

const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/app-version',
  '/api/site-announcement',
  '/api/site-seo',
  '/api/session/bootstrap',
  '/api/auth/email/code',
  '/api/auth/email/register',
  '/api/auth/email/login',
  '/api/auth/logout',
  '/api/auth/session',
]);

let apiSignKey: string | null = null;

export function setApiSignKey(key: string | null | undefined): void {
  apiSignKey = key?.trim() || null;
}

export function getApiSignKey(): string | null {
  return apiSignKey;
}

function isPublicApiPathname(pathname: string, method = 'GET'): boolean {
  if (PUBLIC_API_PATHS.has(pathname)) return true;
  // 与服务端 isPublicApiPath 对齐：仅 GET 大厅列表免签
  if (pathname === '/api/rooms' && method.toUpperCase() === 'GET') return true;
  return false;
}

export function needsApiSign(url: string, method = 'GET'): boolean {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, origin);
    if (!parsed.pathname.startsWith('/api/')) return false;
    return !isPublicApiPathname(parsed.pathname, method);
  } catch {
    return false;
  }
}

/** 是否为本站媒体代理路径（需 query 签名，且使用更长有效期） */
export function isMediaApiPath(url: string): boolean {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, origin);
    return parsed.pathname === '/api/meting' || parsed.pathname === '/api/media-proxy';
  } catch {
    return false;
  }
}

export function canonicalApiQuery(params: URLSearchParams): string {
  const entries: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (SIGN_QUERY_KEYS.has(key)) return;
    entries.push([key, value]);
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

async function sha256Hex(text: string): Promise<string> {
  if (!text) return '';
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前页面不支持安全请求签名，请使用 HTTPS 访问');
  }
  const encoded = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Base64Url(key: string, message: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前页面不支持安全请求签名，请使用 HTTPS 访问');
  }
  const encoder = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomNonce(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function buildApiSignHeaders(
  method: string,
  path: string,
  query = '',
  body = '',
): Promise<Record<string, string>> {
  const key = apiSignKey;
  if (!key) return {};

  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomNonce();
  const bodyHash = await sha256Hex(body);
  const payload = [method.toUpperCase(), path, query, bodyHash, String(ts), nonce].join('\n');
  const sign = await hmacSha256Base64Url(key, payload);

  return {
    'X-OM-Ts': String(ts),
    'X-OM-Nonce': nonce,
    'X-OM-Sign': sign,
  };
}
