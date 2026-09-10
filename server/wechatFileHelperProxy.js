import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const FILEHELPER_ORIGIN = 'https://szfilehelper.weixin.qq.com';

export const WX_PROXY_MOUNT = '/wx-proxy';
export const WX_ROOT_CGI_MOUNT = '/cgi-bin';

const SKIP_REQ_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
  'accept-encoding', 'origin', 'referer',
]);

const SKIP_RES_HEADERS = new Set([
  'content-encoding', 'transfer-encoding', 'connection',
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'frame-options',
  'etag', 'last-modified', 'expires', 'age', 'cache-control', 'cdn-cache-control',
  'surrogate-control', 'x-cache', 'x-cache-lookup',
]);

function isNoCacheWxEndpoint(targetUrl) {
  const path = String(targetUrl?.pathname || '');
  return path.includes('/mmwebwx-bin/login')
    || path.endsWith('/jslogin')
    || path.includes('/webwxsync')
    || path.includes('/webwxinit')
    || path.includes('/webwxnewloginpage');
}

function applyNoCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Surrogate-Control', 'no-store');
}

function isAllowedTarget(url) {
  const host = String(url.hostname || '').toLowerCase();
  // 禁止公网 IP 开放代理；仅允许腾讯系域名后缀
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
  return host === 'qq.com' || host.endsWith('.qq.com');
}

function parseProxyTarget(req) {
  const raw = req.originalUrl || req.url || '';
  const prefix = `${WX_PROXY_MOUNT}/`;
  const idx = raw.indexOf(prefix);
  if (idx < 0) return null;

  let rest = raw.slice(idx + prefix.length);
  // 仅解码被转义的 scheme，避免破坏 query 中 pass_ticket 的 %2F / %3D
  if (/^https?%3A/i.test(rest)) {
    try {
      rest = decodeURIComponent(rest);
    } catch {
      return null;
    }
  }

  try {
    const target = new URL(rest);
    if (!isAllowedTarget(target)) return null;
    return target;
  } catch {
    return null;
  }
}

function proxyWrap(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  const nested = trimmed.match(/\/wx-proxy\/+(https?:\/\/.+)$/i);
  if (nested) return `${WX_PROXY_MOUNT}/${nested[1]}`;

  if (trimmed.includes(`${WX_PROXY_MOUNT}/`)) return trimmed;

  const absolute = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = new URL(absolute);
    if (parsed.hostname === 'szfilehelper.weixin.qq.com') {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    /* fall through */
  }
  return `${WX_PROXY_MOUNT}/${absolute}`;
}

function rewriteRedirect(location, fallbackOrigin) {
  if (!location) return location;
  if (location.includes(`${WX_PROXY_MOUNT}/https://`) || location.includes(`${WX_PROXY_MOUNT}/http://`)) {
    return location.startsWith('http://') || location.startsWith('https://')
      ? new URL(location).pathname + new URL(location).search
      : location;
  }
  if (location.startsWith(WX_PROXY_MOUNT)) return location;
  try {
    const absolute = location.startsWith('http://') || location.startsWith('https://')
      ? new URL(location)
      : location.startsWith('//')
        ? new URL(`https:${location}`)
        : new URL(location, fallbackOrigin);
    if (!isAllowedTarget(absolute)) return null;
    return proxyWrap(absolute.href);
  } catch {
    return null;
  }
}

function shouldSkipBodyRewrite(targetUrl) {
  const path = String(targetUrl.pathname || '');
  if (path.includes('/mmwebwx-bin/login') || path.endsWith('/jslogin')) return true;
  if (path.includes('/mmwebwx-bin/')) return true;
  return false;
}

function rewriteResponseBody(body, upstreamOrigin, contentType, targetUrl) {
  if (targetUrl && shouldSkipBodyRewrite(targetUrl)) {
    return body;
  }
  const origin = upstreamOrigin.replace(/\/$/, '');
  const lowerType = String(contentType || '').toLowerCase();

  if (lowerType.includes('javascript') || lowerType.includes('ecmascript')) {
    return rewriteQqUrls(stripServiceWorkerFromJs(body));
  }

  if (lowerType.includes('text/css')) {
    let next = body;
    next = next.replace(/url\((["']?)(https?:\/\/[^)"'\s]+)\1\)/gi, (match, quote, url) => {
      try {
        const parsed = new URL(url);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return match;
        if (!isAllowedTarget(parsed)) return match;
        return `url(${quote}${proxyWrap(url)}${quote})`;
      } catch {
        return match;
      }
    });
    next = next.replace(/url\((["']?)(\/\/[^)"'\s]+)\1\)/gi, (match, quote, url) => {
      try {
        const parsed = new URL(`https:${url}`);
        if (!isAllowedTarget(parsed)) return match;
        return `url(${quote}${proxyWrap(`https:${url}`)}${quote})`;
      } catch {
        return match;
      }
    });
    return next;
  }

  if (lowerType.includes('html') || lowerType.includes('xml') || lowerType.includes('plain')) {
    const rewrittenAttrs = body.replace(
      /\b(src|href|action|data-src|poster)\s*=\s*(["'])(.*?)\2/gi,
      (match, attr, quote, value) => {
        const trimmed = String(value || '').trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return match;
        if (trimmed.startsWith(`${WX_PROXY_MOUNT}/`)) return match;
        try {
          let absolute = trimmed;
          if (trimmed.startsWith('//')) {
            absolute = `https:${trimmed}`;
          } else if (trimmed.startsWith('/')) {
            absolute = `${origin}${trimmed}`;
          } else if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            absolute = `${origin}/${trimmed.replace(/^\//, '')}`;
          }
          const parsed = new URL(absolute);
          if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return match;
          if (!isAllowedTarget(parsed)) return match;
          return `${attr}=${quote}${proxyWrap(absolute)}${quote}`;
        } catch {
          return match;
        }
      },
    );
    const withUrls = rewriteQqUrls(rewrittenAttrs);
    return isFileHelperOrigin(origin) ? injectFileHelperHtmlShim(withUrls) : withUrls;
  }

  return body;
}

function isUrlAlreadyProxied(text, index) {
  const lookback = text.slice(Math.max(0, index - WX_PROXY_MOUNT.length - 8), index);
  return lookback.includes(WX_PROXY_MOUNT);
}

function rewriteQqUrls(body) {
  const text = String(body || '');
  return text
    .replace(/https?:\/\/[a-z0-9][a-z0-9.-]*\.qq\.com[^\s"'`<>)]*/gi, (url, offset) => {
      if (isUrlAlreadyProxied(text, offset)) return url;
      return proxyWrap(url);
    })
    .replace(/(?<!https:)\/\/[a-z0-9][a-z0-9.-]*\.qq\.com[^\s"'`<>)]*/gi, (url, offset) => {
      if (isUrlAlreadyProxied(text, offset)) return url;
      return proxyWrap(`https:${url}`);
    });
}

function rewriteSetCookie(value, { secure = false } = {}) {
  const paths = [WX_PROXY_MOUNT, WX_ROOT_CGI_MOUNT];
  return value
    .split(/,(?=[^;]+=)/)
    .flatMap((part) => {
      const cookie = part
        .replace(/;\s*Domain=[^;]*/gi, '')
        .replace(/;\s*Secure/gi, '')
        .replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
        .replace(/;\s*Path=[^;]*/gi, '')
        .trim();
      if (!cookie) return [];
      const secureFlag = secure ? '; Secure' : '';
      return paths.map((cookiePath) => `${cookie}; Path=${cookiePath}${secureFlag}`);
    });
}

const WX_COOKIE_NAME = /^(wxuin|wxsid|wxloadtime|mm_lang|skey|_?wx|webwx|MM_)/i;

const wxLoginCookieJar = new Map();
const WX_LOGIN_JAR_TTL_MS = 5 * 60 * 1000;
export const WECHAT_LOGIN_PROOF_COOKIE = 'openmusic_wx_login_proof';
export const WECHAT_LOGIN_PROOF_TTL_SEC = 5 * 60;
const WX_PROOF_FALLBACK_SECRET = randomBytes(32).toString('hex');

function proofSecret() {
  return String(process.env.CLIENT_ID_SECRET || WX_PROOF_FALLBACK_SECRET);
}

export function createWechatLoginProof(uin, { now = () => Date.now(), nonce = () => randomBytes(16).toString('base64url') } = {}) {
  const payload = Buffer.from(JSON.stringify({
    uin: String(uin || ''),
    nonce: nonce(),
    exp: Math.floor(now() / 1000) + WECHAT_LOGIN_PROOF_TTL_SEC,
  }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', proofSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyWechatLoginProof(token) {
  const raw = String(token || '').trim();
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expected = Buffer.from(createHmac('sha256', proofSecret()).update(payload).digest('base64url'));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const uin = String(parsed?.uin || '').trim();
    const nonce = String(parsed?.nonce || '').trim();
    const exp = Number(parsed?.exp);
    if (!/^\d{1,32}$/u.test(uin) || !nonce || !Number.isFinite(exp)) return null;
    if (exp < Math.floor(Date.now() / 1000)) return null;
    return { uin, nonce, exp };
  } catch {
    return null;
  }
}

function appendWechatLoginProofCookie(res, uin, { secure = false } = {}) {
  const secureFlag = secure ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${WECHAT_LOGIN_PROOF_COOKIE}=${encodeURIComponent(createWechatLoginProof(uin))}; Max-Age=${WECHAT_LOGIN_PROOF_TTL_SEC}; Path=/api/auth; HttpOnly; SameSite=Strict${secureFlag}`,
  );
}

function mergeCookieStrings(...parts) {
  const jar = new Map();
  for (const part of parts) {
    if (!part) continue;
    for (const chunk of String(part).split(';')) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      jar.set(trimmed.slice(0, eq).trim(), trimmed);
    }
  }
  return [...jar.values()].join('; ');
}

function collectRawUpstreamCookies(upstream) {
  const cookies = typeof upstream.headers.getSetCookie === 'function'
    ? upstream.headers.getSetCookie()
    : [];
  if (cookies.length > 0) {
    return cookies.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  }
  const single = upstream.headers.get('set-cookie');
  if (!single) return '';
  return single
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function readWechatXmlField(bodyText, field) {
  const escaped = String(field).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cdata = bodyText.match(new RegExp(`<${escaped}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escaped}>`, 'i'));
  const plain = bodyText.match(new RegExp(`<${escaped}>([^<]*)<\\/${escaped}>`, 'i'));
  const value = cdata?.[1] ?? plain?.[1] ?? '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function rememberLoginCookies(pathname, bodyText, upstream) {
  if (!String(pathname || '').includes('webwxnewloginpage')) return null;
  const ret = readWechatXmlField(bodyText, 'ret');
  if (ret && ret !== '0') return null;
  const wxsid = readWechatXmlField(bodyText, 'wxsid');
  const wxuin = readWechatXmlField(bodyText, 'wxuin');
  if (!wxsid || !/^\d{1,32}$/u.test(String(wxuin || '').trim())) return null;
  const cookieStr = collectRawUpstreamCookies(upstream);
  if (cookieStr) {
    const entry = { cookies: cookieStr, at: Date.now() };
    wxLoginCookieJar.set(wxsid, entry);
    wxLoginCookieJar.set(`uin:${wxuin}`, entry);
    for (const [key, jarEntry] of wxLoginCookieJar) {
      if (Date.now() - jarEntry.at > WX_LOGIN_JAR_TTL_MS) wxLoginCookieJar.delete(key);
    }
  }
  return String(wxuin).trim();
}

function resolveUpstreamCookies(req, targetUrl, bodyBuffer) {
  let cookie = filterWechatCookies(req.headers.cookie || '');
  const wxsidMatch = cookie.match(/(?:^|;\s*)wxsid=([^;]+)/);
  const wxsid = wxsidMatch?.[1];
  let jarEntry = wxsid ? wxLoginCookieJar.get(wxsid) : null;
  if (!jarEntry) {
    const wxuinMatch = cookie.match(/(?:^|;\s*)wxuin=([^;]+)/);
    const wxuin = wxuinMatch?.[1];
    if (wxuin) jarEntry = wxLoginCookieJar.get(`uin:${wxuin}`);
  }
  if (jarEntry && Date.now() - jarEntry.at < WX_LOGIN_JAR_TTL_MS) {
    cookie = mergeCookieStrings(jarEntry.cookies, cookie);
  }

  if (bodyBuffer && String(targetUrl.pathname || '').includes('webwxinit')) {
    try {
      const json = JSON.parse(bodyBuffer.toString('utf8'));
      const skey = json?.BaseRequest?.Skey;
      if (skey) cookie = mergeCookieStrings(cookie, `skey=${skey}`);
    } catch {
      /* ignore */
    }
  }

  return cookie;
}

function filterWechatCookies(cookieHeader) {
  if (!cookieHeader) return '';
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      const name = part.split('=')[0]?.trim() || '';
      return WX_COOKIE_NAME.test(name);
    })
    .join('; ');
}

const WX_NETWORK_SHIM = `<script>/* wx-proxy-shim */(function(){var P='/wx-proxy/';function w(u){try{if(typeof u!=='string'||!u||u.indexOf(P)>=0||u.indexOf('data:')===0||u.indexOf('blob:')===0)return u;if(/^https?:\\/\\//i.test(u)&&/\\.qq\\.com/i.test(u))return P+u;if(/^\\/\\//.test(u)&&/\\.qq\\.com/i.test(u))return P+'https:'+u;}catch(e){}return u;}if(window.fetch){var of=window.fetch;window.fetch=function(i,o){if(typeof i==='string')return of(w(i),o);if(i&&i.url){try{return of(new Request(w(i.url),i),o);}catch(e){}}return of(i,o);};}var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,a,us,pw){return xo.call(this,m,w(u),a,us,pw);};if(navigator.serviceWorker){try{navigator.serviceWorker.register=function(){return Promise.resolve();};}catch(e){}}})();</script>`;

function isFileHelperOrigin(origin) {
  return String(origin || '').includes('szfilehelper.weixin.qq.com');
}

function injectFileHelperHtmlShim(body) {
  if (!body || !body.includes('<')) return body;
  const cleaned = body.replace(/navigator\.serviceWorker\.register\([^;]+\);?/g, '/* sw-disabled */');
  if (cleaned.includes('wx-proxy-shim')) return cleaned;
  if (/<head[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<head([^>]*)>/i, `<head$1>${WX_NETWORK_SHIM}`);
  }
  return `${WX_NETWORK_SHIM}${cleaned}`;
}

function stripServiceWorkerFromJs(body) {
  return String(body || '').replace(/navigator\.serviceWorker\.register\([^;]+\);?/g, '/* sw-disabled */');
}

function buildUpstreamHeaders(req, targetUrl, bodyBuffer) {
  const pathname = String(targetUrl.pathname || '');
  const referer = pathname.includes('/mmwebwx-bin/')
    ? `${targetUrl.origin}/cgi-bin/mmwebwx-bin/webwxnewloginpage?fun=new&version=v2&lang=zh_CN`
    : `${targetUrl.origin}/`;

  const headers = {
    'User-Agent': req.headers['user-agent']
      || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: req.headers.accept || '*/*',
    'Accept-Language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9',
    'Accept-Encoding': 'identity',
    Cookie: resolveUpstreamCookies(req, targetUrl, bodyBuffer),
    Host: targetUrl.host,
    Origin: targetUrl.origin,
    Referer: referer,
    mmweb_appid: req.headers.mmweb_appid || 'wx_webfilehelper',
  };

  if (bodyBuffer) {
    headers['Content-Length'] = String(bodyBuffer.length);
  }

  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (SKIP_REQ_HEADERS.has(lower)) continue;
    if (lower in headers) continue;
    if (typeof value === 'string') headers[key] = value;
  }

  return headers;
}

function shouldRewriteBody(contentType) {
  return /text\/|json|xml|plain|html/i.test(contentType || '');
}

function readForwardBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Array.isArray(req.rawBody)) return undefined;
  if (req.body == null) return undefined;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body;
  if (Array.isArray(req.body)) return undefined;
  if (Object.prototype.toString.call(req.body) === '[object Object]') return JSON.stringify(req.body);
  return undefined;
}

function toForwardBodyBuffer(body) {
  if (body == null) return undefined;
  return Buffer.isBuffer(body) ? body : Buffer.from(body);
}

/** 单次 decodeURIComponent，避免 URLSearchParams 把 + 当空格（CDN 解码 query 后常见） */
function decodeQueryComponent(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

/**
 * 将 /cgi-bin 请求的 query 规范为微信上游可接受的编码。
 * 线上 nginx/CDN 可能已部分解码 pass_ticket，若直接转发会导致 1101。
 */
function normalizeFileHelperQuery(search) {
  const raw = String(search || '').startsWith('?') ? String(search).slice(1) : String(search || '');
  if (!raw) return '';
  const parts = [];
  for (const segment of raw.split('&')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    if (eq < 0) continue;
    const key = decodeQueryComponent(segment.slice(0, eq));
    const val = decodeQueryComponent(segment.slice(eq + 1));
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function buildFileHelperUpstreamUrl(req) {
  const requestPath = req.originalUrl || req.url || '';
  const qIdx = requestPath.indexOf('?');
  const pathname = qIdx >= 0 ? requestPath.slice(0, qIdx) : requestPath;
  const search = qIdx >= 0 ? requestPath.slice(qIdx) : '';
  return `${FILEHELPER_ORIGIN}${pathname}${normalizeFileHelperQuery(search)}`;
}

function buildUpstreamUrl(req, targetUrl) {
  const requestPath = req.originalUrl || req.url || '';
  if (requestPath.startsWith('/cgi-bin/')) {
    return buildFileHelperUpstreamUrl(req);
  }
  if (targetUrl?.hostname === 'szfilehelper.weixin.qq.com') {
    return `${FILEHELPER_ORIGIN}${targetUrl.pathname}${targetUrl.search}`;
  }
  return targetUrl.toString();
}

async function fetchUpstream(fetchWithTimeout, upstreamUrl, req, body) {
  const method = req.method || 'GET';
  const parsed = new URL(upstreamUrl);
  const headers = buildUpstreamHeaders(req, parsed, body);
  const init = {
    method,
    headers,
    redirect: 'manual',
  };
  if (body && method !== 'GET' && method !== 'HEAD') {
    init.body = body;
  }
  return fetchWithTimeout(upstreamUrl, init, 60000);
}

function appendUpstreamSetCookies(res, upstream, cookieOptions = {}) {
  const cookies = typeof upstream.headers.getSetCookie === 'function'
    ? upstream.headers.getSetCookie()
    : [];
  if (cookies.length > 0) {
    for (const cookie of cookies) {
      for (const rewritten of rewriteSetCookie(cookie, cookieOptions)) {
        res.append('Set-Cookie', rewritten);
      }
    }
    return;
  }
  const single = upstream.headers.get('set-cookie');
  if (single) {
    for (const rewritten of rewriteSetCookie(single, cookieOptions)) {
      res.append('Set-Cookie', rewritten);
    }
  }
}

async function forwardWxUpstream(fetchWithTimeout, req, res, targetUrl, errorLabel, cookieOptions = {}) {
  const body = toForwardBodyBuffer(readForwardBody(req));
  const upstreamUrl = buildUpstreamUrl(req, targetUrl);
  const upstreamTarget = new URL(upstreamUrl);

  let upstream;
  try {
    upstream = await fetchUpstream(fetchWithTimeout, upstreamUrl, req, body);
  } catch (err) {
    console.error(`${errorLabel}:`, err?.message || err, upstreamTarget.origin + upstreamTarget.pathname);
    if (!res.headersSent) {
      res.status(502).type('text/plain; charset=utf-8').send(`${errorLabel}：${err?.message || 'upstream unreachable'}`);
    }
    return;
  }

  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const location = upstream.headers.get('location') || '';
    const rewritten = rewriteRedirect(location, upstreamTarget.origin);
    if (!rewritten) {
      if (!res.headersSent) res.status(upstream.status).end();
      return;
    }
    res.redirect(upstream.status, rewritten);
    return;
  }

  const contentType = upstream.headers.get('content-type') || '';
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (SKIP_RES_HEADERS.has(lower)) return;
    if (lower === 'set-cookie') return;
    if (lower === 'location') {
      const rewritten = rewriteRedirect(value, upstreamTarget.origin);
      if (rewritten) res.set('Location', rewritten);
      return;
    }
    res.set(key, value);
  });
  appendUpstreamSetCookies(res, upstream, cookieOptions);

  res.set('X-OpenMusic-WxProxy', '1');
  if (isNoCacheWxEndpoint(upstreamTarget)) applyNoCacheHeaders(res);

  const buffer = Buffer.from(await upstream.arrayBuffer());
  const bodyText = buffer.toString('utf8');
  const verifiedWechatUin = rememberLoginCookies(upstreamTarget.pathname, bodyText, upstream);
  if (verifiedWechatUin) appendWechatLoginProofCookie(res, verifiedWechatUin, cookieOptions);

  if (process.env.DEBUG_WX === '1' && upstreamTarget.pathname.includes('webwxinit')) {
    let initRet = '';
    try {
      initRet = String(JSON.parse(bodyText)?.BaseResponse?.Ret ?? '');
    } catch {
      initRet = 'non-json';
    }
    console.info('[wx-proxy] webwxinit', {
      upstream: upstreamUrl,
      status: upstream.status,
      ret: initRet,
      bodyLen: buffer.length,
    });
  }

  if (shouldRewriteBody(contentType) && !shouldSkipBodyRewrite(upstreamTarget)) {
    const text = rewriteResponseBody(bodyText, upstreamTarget.origin, contentType, upstreamTarget);
    if (!res.headersSent) res.status(upstream.status).send(text);
    return;
  }

  if (!res.headersSent) res.status(upstream.status).send(buffer);
}

function createWxIframeProxy(fetchWithTimeout, cookieOptions = {}) {
  return async function handleWxIframeProxy(req, res) {
    const targetUrl = parseProxyTarget(req);
    if (!targetUrl) {
      if (!res.headersSent) {
        res.status(400).type('text/plain; charset=utf-8').send('无效的微信 iframe 代理地址');
      }
      return;
    }

    await forwardWxUpstream(fetchWithTimeout, req, res, targetUrl, '微信 iframe 代理失败', cookieOptions);
  };
}

function createWxRootCgiProxy(fetchWithTimeout, cookieOptions = {}) {
  return async function handleWxRootCgiProxy(req, res) {
    const upstreamUrl = buildFileHelperUpstreamUrl(req);
    const targetUrl = new URL(upstreamUrl);
    await forwardWxUpstream(fetchWithTimeout, req, res, targetUrl, '微信 CGI 代理失败', cookieOptions);
  };
}

export function mountWechatFileHelperProxy(app, fetchWithTimeout, options = {}) {
  const requireAuth = typeof options.requireAuth === 'function' ? options.requireAuth : null;
  const cookieOptions = { secure: Boolean(options.secureCookies) };
  const handler = createWxIframeProxy(fetchWithTimeout, cookieOptions);
  const cgiHandler = createWxRootCgiProxy(fetchWithTimeout, cookieOptions);

  const wrap = (next) => (req, res) => {
    if (requireAuth && !requireAuth(req, res)) return;
    void next(req, res);
  };

  app.use(WX_PROXY_MOUNT, wrap(handler));
  app.use(WX_ROOT_CGI_MOUNT, wrap(cgiHandler));
}

export { FILEHELPER_ORIGIN };
