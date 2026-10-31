import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

export const DEFAULT_MEDIA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MAX_MEDIA_REDIRECTS = 5;
const DNS_CACHE_TTL_MS = 60_000;
const MAX_DNS_CACHE_ENTRIES = 512;
const validatedDnsCache = new Map();
const REDIRECT_CACHE_TTL_MS = 180_000;
const MAX_REDIRECT_CACHE_ENTRIES = 512;
const validatedRedirectCache = new Map();
const httpMediaAgent = new http.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 32, timeout: 60_000 });
const httpsMediaAgent = new https.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 32, timeout: 60_000 });

/**
 * 多人共享同源代理音频缓存（磁盘文件 + 极小内存滑动窗口，适配 2GB 内存服务器多房间并发）：
 * - 磁盘缓存池：最多 32 首 / 320MB（存放在系统临时目录，自动 LRU 清理与进程退出清理）
 * - 内存滑动窗口：仅流式下载进行中保留最近 2MB 热数据供实时跟读，下载完成后立即释放为 0 内存占用
 */
const MAX_SHARED_AUDIO_FILE_BYTES = 48 * 1024 * 1024;
const MAX_SHARED_AUDIO_TOTAL_BYTES = 320 * 1024 * 1024;
const MAX_SHARED_AUDIO_TRACKS = 32;
const SHARED_AUDIO_MEM_TAIL_BYTES = 2 * 1024 * 1024;
const SHARED_AUDIO_DISK_READ_CHUNK_BYTES = 64 * 1024;
const SHARED_AUDIO_TTL_MS = 15 * 60 * 1000;
const SHARED_AUDIO_AHEAD_SLACK_BYTES = 2 * 1024 * 1024;
const SHARED_AUDIO_TAIL_PROBE_BYTES = 131_072;
const MAX_WARM_CONCURRENCY = 2;
const SHARED_AUDIO_CACHE_DIR = path.join(
  os.tmpdir(),
  `openmusic-shared-audio-${globalThis.process?.pid ?? 'shared'}`,
);
const sharedAudioCache = new Map();
const sharedAudioInflight = new Map();
let sharedAudioTotalBytes = 0;
let activeWarmCount = 0;
let sharedAudioCacheSeq = 0;
/** 缓冲类响应（封面图等）体积上限，防止代理内存耗尽 */
const MAX_BUFFERED_MEDIA_BYTES = 8 * 1024 * 1024;
/** 部分网易云封面 CDN 即使请求 size=96 仍会返回原图，允许图片使用更高但有限的上限。 */
const MAX_BUFFERED_IMAGE_BYTES = 32 * 1024 * 1024;

function hostnameOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 精确或后缀匹配：`a.com` / `x.a.com`，拒绝 `evil-a.com` / `a.com.evil` */
function hostMatchesDomain(host, domain) {
  const h = String(host || '').toLowerCase();
  const d = String(domain || '').toLowerCase();
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

function hostMatchesAnyDomain(host, domains) {
  return domains.some((domain) => hostMatchesDomain(host, domain));
}

function isKugouHost(host) {
  return hostMatchesAnyDomain(host, [
    'kugou.com',
    'kugou.net',
    'kgimg.com',
    'kgcdn.com',
    'kgimg.net',
  ]);
}

function isQqMusicHost(host) {
  return hostMatchesAnyDomain(host, [
    'qq.com',
    'gtimg.com',
    'gtimg.cn',
    'tencentmusic.com',
  ]);
}

function isNeteaseMusicHost(host) {
  return hostMatchesAnyDomain(host, [
    '163.com',
    '126.net',
    'netease.com',
  ]);
}

function isQishuiHost(host) {
  return hostMatchesAnyDomain(host, ['douyinpic.com', 'douyinvod.com']);
}

/** 拒绝内网 / 链路本地 / 元数据主机，防止 SSRF */
export function isBlockedMediaHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/u, '');
  if (!host || host === 'localhost') return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;
  if (host === 'metadata.google.internal' || host === 'metadata') return true;

  return isIP(host) ? isBlockedIpAddress(host) : false;
}

function isBlockedIpAddress(address) {
  const value = String(address || '').toLowerCase().replace(/%.+$/, '');
  const family = isIP(value);
  if (!family) return true;

  if (family === 4) {
    const parts = value.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224
    );
  }

  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/u);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return isBlockedIpAddress([high >> 8, high & 255, low >> 8, low & 255].join('.'));
  }
  return !/^[23][0-9a-f]{3}:/u.test(normalized) || normalized.startsWith('2001:db8:') || normalized.startsWith('2002:');
}

async function assertPublicDnsTarget(hostname, timeoutMs) {
  const host = String(hostname).replace(/^\[|\]$/gu, '');
  if (isIP(host)) {
    if (isBlockedIpAddress(host)) {
      const err = new Error('禁止访问内网地址');
      err.statusCode = 403;
      throw err;
    }
    return [{ address: host, family: isIP(host) }];
  }

  const cacheKey = host.toLowerCase();
  const cached = validatedDnsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.records;
  }

  let records;
  let deadline;
  try {
    records = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        deadline = setTimeout(() => {
          reject(Object.assign(new Error('媒体域名解析超时'), { code: 'ETIMEDOUT' }));
        }, timeoutMs);
      }),
    ]);
  } catch (cause) {
    const err = new Error('媒体域名解析失败', { cause });
    err.statusCode = 502;
    throw err;
  } finally {
    clearTimeout(deadline);
  }
  if (!records.length || records.some((record) => isBlockedIpAddress(record.address))) {
    const err = new Error('禁止访问内网地址');
    err.statusCode = 403;
    throw err;
  }
  // 优先使用 IPv4，规避容器或宿主无 IPv6 出口时的连接等待
  const sorted = [...records].sort((a, b) => (a.family === 4 ? 0 : 1) - (b.family === 4 ? 0 : 1));
  validatedDnsCache.delete(cacheKey);
  validatedDnsCache.set(cacheKey, { records: sorted, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
  while (validatedDnsCache.size > MAX_DNS_CACHE_ENTRIES) {
    const oldest = validatedDnsCache.keys().next().value;
    if (!oldest) break;
    validatedDnsCache.delete(oldest);
  }
  return sorted;
}

/**
 * 仅允许音乐 CDN / 已知媒体域名（可附带 Meting 主机名例外，用于解析前的中间跳）。
 * @param {string} hostname
 * @param {string[]} [extraAllowedHosts]
 */
export function isAllowedMediaHostname(hostname, extraAllowedHosts = []) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  for (const extra of extraAllowedHosts) {
    if (extra && host === String(extra).toLowerCase()) return true;
  }
  return isKugouHost(host) || isQqMusicHost(host) || isNeteaseMusicHost(host) || isQishuiHost(host);
}

/**
 * 按 CDN 域名选 Referer（酷狗 CDN 对 Referer 不敏感，但其它源可能需要）。
 */
export function refererForMediaUrl(rawUrl) {
  const host = hostnameOf(rawUrl);
  if (isKugouHost(host)) return 'https://www.kugou.com/';
  if (isQqMusicHost(host)) return 'https://y.qq.com/';
  if (isNeteaseMusicHost(host)) return 'https://music.163.com/';
  if (isQishuiHost(host)) return 'https://www.qishui.com/';
  return 'https://music.163.com/';
}

/**
 * 部分 CDN 可用 https；酷狗 youthandroid 等节点证书不可靠，禁止升协议（升了会 502/反复重试表现为卡顿）。
 */
export function preferHttpsMediaUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url.toLowerCase().startsWith('http://')) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (isKugouHost(host)) return url;
    const canUpgrade = isNeteaseMusicHost(host) || isQqMusicHost(host);
    if (!canUpgrade) return url;
    parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeAudioContentType(contentType) {
  if (!contentType) return contentType;
  // 网易封面 CDN 返回 image/jpg，统一为浏览器标准 JPEG 类型
  if (contentType.split(';')[0].trim().toLowerCase() === 'image/jpg') return 'image/jpeg';
  // 部分浏览器对 audio/x-flac 支持更差
  if (/^audio\/x-flac\b/i.test(contentType)) return 'audio/flac';
  return contentType;
}

function shouldBufferResponse(contentType, options) {
  if (options.forceBuffer) return true;
  if (options.thumbPx > 0) return true;
  if (contentType && /^image\//i.test(contentType)) return true;
  return false;
}

function isAudioStream(contentType, range) {
  if (range) return true;
  return Boolean(contentType && /^(audio|video|application\/octet-stream)\b/i.test(contentType));
}

/** 解压路径已移除原始长度，仅透传仍与输出字节一致的长度和范围信息 */
function applyStreamingMediaHeaders(response, res, contentType) {
  if (contentType) res.set('Content-Type', contentType);
  for (const header of ['accept-ranges', 'content-range', 'etag', 'last-modified']) {
    const value = response.headers.get(header);
    if (value) res.set(header, value);
  }
  const length = response.headers.get('content-length');
  if (length && /^\d+$/u.test(length)) res.set('Content-Length', length);
  res.status(response.status);
}

async function assertSafeMediaUrl(rawUrl, extraAllowedHosts, { requireAllowlist, timeoutMs }) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    const err = new Error('无效地址');
    err.statusCode = 400;
    throw err;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err = new Error('不支持的协议');
    err.statusCode = 400;
    throw err;
  }
  if (parsed.username || parsed.password) {
    const err = new Error('媒体地址不能包含认证信息');
    err.statusCode = 400;
    throw err;
  }
  if (parsed.port && !['80', '443'].includes(parsed.port)) {
    const err = new Error('媒体地址端口不被允许');
    err.statusCode = 403;
    throw err;
  }
  if (isBlockedMediaHostname(parsed.hostname)) {
    const err = new Error('禁止访问内网地址');
    err.statusCode = 403;
    throw err;
  }
  if (requireAllowlist && !isAllowedMediaHostname(parsed.hostname, extraAllowedHosts)) {
    const err = new Error('媒体域名不在允许列表');
    err.statusCode = 403;
    throw err;
  }
  const addresses = await assertPublicDnsTarget(parsed.hostname, timeoutMs);
  return { parsed, addresses };
}

function requestPinnedMedia({ parsed, addresses }, headers, signal, timeoutMs, { method = 'GET', nodeStream = false } = {}) {
  return new Promise((resolve, reject) => {
    const transport = parsed.protocol === 'https:' ? https : http;
    const agent = parsed.protocol === 'https:' ? httpsMediaAgent : httpMediaAgent;
    let deadline;
    const timeout = () => request.destroy(Object.assign(new Error('媒体请求超时'), { code: 'ETIMEDOUT' }));
    const request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname.replace(/^\[|\]$/gu, ''),
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method, headers, signal, agent,
      lookup: (_hostname, options, callback) => options?.all
        ? callback(null, addresses)
        : callback(null, addresses[0].address, addresses[0].family),
    }, (response) => {
      clearTimeout(deadline);
      request.off('timeout', timeout);
      // 响应头到达后移除首包超时，改为较长流式空闲超时，避免播放中途因背压在 20s 被掐断
      request.setTimeout(120_000, () => {
        response.destroy(Object.assign(new Error('媒体流读取超时'), { code: 'ETIMEDOUT' }));
      });
      try {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value));
        }
        const status = response.statusCode || 502;
        const noBody = method === 'HEAD' || [204, 205, 304].includes(status);
        let stream = response;
        if (!(status >= 300 && status < 400)) {
          const encodings = (responseHeaders.get('content-encoding') || '').split(',').map((value) => value.trim().toLowerCase()).filter((value) => value && value !== 'identity');
          const decoders = (noBody ? [] : encodings.reverse()).map((encoding) => {
            if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip();
            if (encoding === 'deflate') return createInflate();
            if (encoding === 'br') return createBrotliDecompress();
            throw new Error('Unsupported media encoding');
          });
          if (encodings.length) {
            if (decoders.length) {
              stream = decoders.at(-1);
              pipeline(response, ...decoders).catch((error) => stream.destroy(error));
            }
            responseHeaders.delete('content-encoding');
            responseHeaders.delete('content-length');
          }
        }
        const body = noBody ? null : nodeStream ? stream : Readable.toWeb(stream);
        if (!body) response.resume();
        // 歌曲直接使用 Node 流，公开 fetch 接口仍返回标准 Web Response
        resolve(nodeStream
          ? { status, ok: status >= 200 && status < 300, headers: responseHeaders, body }
          : new Response(body, { status, headers: responseHeaders }));
      } catch (error) {
        response.destroy();
        request.destroy();
        reject(error);
      }
    });
    request.on('error', reject);
    request.once('close', () => clearTimeout(deadline));
    deadline = setTimeout(timeout, timeoutMs);
    request.setTimeout(timeoutMs, timeout);
    request.end();
  });
}

async function cancelMediaBody(response) {
  try {
    if (response.body instanceof Readable) response.body.destroy();
    else await response.body?.cancel?.();
  } catch {
    // 释放已结束或已取消的上游响应无需再次报错
  }
}

/**
 * 手动跟随重定向，每一跳重新校验主机名，避免公网 302 跳内网绕过 SSRF 检查。
 */
export async function fetchMediaWithSafeRedirects(fetchWithTimeout, rawUrl, fetchOptions = {}, timeoutMs = 20000) {
  const extraAllowedHosts = fetchOptions.extraAllowedHosts || [];
  const requireAllowlist = fetchOptions.requireAllowlist !== false;
  const headers = { ...(fetchOptions.headers || {}) };

  const initialUrl = preferHttpsMediaUrl(rawUrl);
  const cachedRedirect = validatedRedirectCache.get(initialUrl);
  let usedCachedRedirect = Boolean(cachedRedirect && cachedRedirect.expiresAt > Date.now());
  let currentUrl = usedCachedRedirect ? cachedRedirect.targetUrl : initialUrl;
  for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop += 1) {
    fetchOptions.signal?.throwIfAborted();
    const target = await assertSafeMediaUrl(currentUrl, extraAllowedHosts, { requireAllowlist, timeoutMs });
    fetchOptions.signal?.throwIfAborted();
    let response;
    try {
      response = await requestPinnedMedia(target, headers, fetchOptions.signal, timeoutMs, fetchOptions);
    } catch (err) {
      if (usedCachedRedirect) {
        validatedRedirectCache.delete(initialUrl);
        usedCachedRedirect = false;
        currentUrl = initialUrl;
        continue;
      }
      throw err;
    }

    if (usedCachedRedirect && response.status >= 400 && response.status !== 416) {
      await cancelMediaBody(response);
      validatedRedirectCache.delete(initialUrl);
      usedCachedRedirect = false;
      currentUrl = initialUrl;
      continue;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = String(response.headers.get('location') || '').trim();
      await cancelMediaBody(response);
      if (!location) {
        const err = new Error('上游返回空重定向');
        err.statusCode = 502;
        err.code = 'MEDIA_REDIRECT_FAILED';
        throw err;
      }
      try {
        currentUrl = preferHttpsMediaUrl(new URL(location, currentUrl).toString());
      } catch {
        const err = new Error('上游重定向地址无效');
        err.statusCode = 502;
        err.code = 'MEDIA_REDIRECT_FAILED';
        throw err;
      }
      for (const name of Object.keys(headers)) {
        if (['authorization', 'cookie', 'proxy-authorization'].includes(name.toLowerCase()) || name.toLowerCase().startsWith('x-openmusic-')) delete headers[name];
      }
      continue;
    }

    if (currentUrl !== initialUrl && (response.ok || response.status === 206)) {
      validatedRedirectCache.delete(initialUrl);
      validatedRedirectCache.set(initialUrl, { targetUrl: currentUrl, expiresAt: Date.now() + REDIRECT_CACHE_TTL_MS });
      while (validatedRedirectCache.size > MAX_REDIRECT_CACHE_ENTRIES) {
        const oldest = validatedRedirectCache.keys().next().value;
        if (!oldest) break;
        validatedRedirectCache.delete(oldest);
      }
    }

    return response;
  }

  const err = new Error('上游重定向次数过多');
  err.statusCode = 502;
  err.code = 'MEDIA_REDIRECT_FAILED';
  throw err;
}

function respondMediaProxyFailure(res, error) {
  if (res.headersSent) return;
  const status = Number(error?.statusCode) || 502;
  if (status < 500) {
    res.status(status).json({ error: error?.message || '媒体代理请求被拒绝' });
    return;
  }
  const failures = [error, error?.cause, ...(Array.isArray(error?.errors) ? error.errors.slice(0, 8) : [])];
  const codes = failures.map(failure => String(failure?.code || ''));
  let code = 'MEDIA_PROXY_FAILED';
  let message = '媒体代理失败';
  if (codes.some(value => ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(value))) {
    code = 'MEDIA_DNS_FAILED';
    message = '媒体代理域名解析失败';
  } else if (codes.some(value => ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(value))) {
    code = 'MEDIA_TIMEOUT';
    message = '媒体代理请求上游超时';
  } else if (codes.some(value => value.startsWith('ERR_TLS_') || value.startsWith('ERR_SSL_')
    || ['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(value))) {
    code = 'MEDIA_TLS_FAILED';
    message = '媒体代理上游证书或 TLS 校验失败';
  } else if (codes.some(value => ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(value))) {
    code = 'MEDIA_CONNECT_FAILED';
    message = '媒体代理连接上游失败';
  } else if (codes.includes('MEDIA_REDIRECT_FAILED')) {
    code = 'MEDIA_REDIRECT_FAILED';
    message = '媒体代理上游重定向失败';
  } else if (error?.message === '媒体域名解析失败') {
    code = 'MEDIA_DNS_FAILED';
    message = '媒体代理域名解析失败';
  }
  // 仅返回固定文案和错误码，避免上游异常携带的完整地址、签名或凭据进入响应
  res.status(status).json({ error: message, code });
}

async function readBoundedMediaResponse(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const stream = response.body instanceof Readable ? response.body : Readable.fromWeb(response.body);
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      const error = new Error('媒体过大');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function isLikelyImageMediaUrl(rawUrl, options = {}) {
  if (options.imageOnly || options.thumbPx > 0 || options.forceBuffer) return true;
  try {
    const parsed = new URL(rawUrl);
    if (/\.(?:jpe?g|png|gif|webp|avif|bmp|ico)$/iu.test(parsed.pathname)) return true;
    const host = parsed.hostname.toLowerCase();
    return ['imge.kugou.com', 'imgessl.kugou.com', 'kgimg.com', 'kgimg.net', 'douyinpic.com', 'gtimg.cn', 'gtimg.com'].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

export function sharedAudioCacheKey(rawUrl) {
  const normalized = preferHttpsMediaUrl(rawUrl);
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (
      (isKugouHost(host) || isQishuiHost(host) || isNeteaseMusicHost(host) || isQqMusicHost(host))
      && parsed.pathname.length > 16
      && !/\/(?:index|api|play|song\/media\/outer)\b/iu.test(parsed.pathname)
      && !/\.(?:jpe?g|png|gif|webp|avif|bmp)$/iu.test(parsed.pathname)
    ) {
      return `${parsed.protocol}//${host}${parsed.pathname}`;
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

let sharedAudioDirReady = false;
function ensureSharedAudioCacheDir() {
  if (sharedAudioDirReady) return true;
  try {
    fs.mkdirSync(SHARED_AUDIO_CACHE_DIR, { recursive: true });
    sharedAudioDirReady = true;
    return true;
  } catch {
    return false;
  }
}

globalThis.process?.once?.('exit', () => {
  try {
    fs.rmSync(SHARED_AUDIO_CACHE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
});

function notifySharedAudioWaiters(entry) {
  for (const wake of [...entry.waiters]) {
    entry.waiters.delete(wake);
    try { wake(); } catch { /* ignore */ }
  }
}

function closeSharedAudioFd(entry) {
  if (entry.fd === null || entry.fd === undefined) return;
  const fd = entry.fd;
  entry.fd = null;
  try { fs.closeSync(fd); } catch { /* ignore */ }
}

function unlinkSharedAudioFile(filePath) {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

function finalizeSharedAudioFileCleanup(entry) {
  if (entry.activeReaders > 0 || entry.writing) return;
  closeSharedAudioFd(entry);
  unlinkSharedAudioFile(entry.filePath);
  entry.filePath = '';
}

function removeSharedAudioEntry(key) {
  const existing = sharedAudioCache.get(key);
  if (!existing) return;
  sharedAudioCache.delete(key);
  sharedAudioTotalBytes = Math.max(0, sharedAudioTotalBytes - existing.countedBytes);
  existing.countedBytes = 0;
  existing.tailChunks = [];
  existing.tailBytes = 0;
  existing.evicted = true;
  finalizeSharedAudioFileCleanup(existing);
}

function releaseSharedAudioReader(entry) {
  entry.activeReaders = Math.max(0, entry.activeReaders - 1);
  if (entry.evicted || entry.failed) {
    finalizeSharedAudioFileCleanup(entry);
  }
}

function evictSharedAudioCacheIfNeeded(incomingBytes = 0) {
  const now = Date.now();
  for (const [key, entry] of [...sharedAudioCache.entries()]) {
    if ((entry.expiresAt <= now || entry.failed) && entry.activeReaders <= 0) {
      removeSharedAudioEntry(key);
    }
  }
  while (
    sharedAudioCache.size >= MAX_SHARED_AUDIO_TRACKS
    || (sharedAudioTotalBytes + incomingBytes > MAX_SHARED_AUDIO_TOTAL_BYTES && sharedAudioCache.size > 0)
  ) {
    const candidate = [...sharedAudioCache.entries()].find(
      ([, entry]) => entry.activeReaders <= 0 && (entry.complete || entry.failed),
    ) || [...sharedAudioCache.entries()].find(([, entry]) => entry.activeReaders <= 0);
    if (!candidate) break;
    removeSharedAudioEntry(candidate[0]);
  }
}

function writeFdBuffer(fd, buffer, position) {
  return new Promise((resolve, reject) => {
    fs.write(fd, buffer, 0, buffer.byteLength, position, (err, written) => {
      if (err) reject(err);
      else resolve(written);
    });
  });
}

function readFdSlice(fd, position, length) {
  const target = Buffer.allocUnsafe(length);
  return new Promise((resolve, reject) => {
    fs.read(fd, target, 0, length, position, (err, bytesRead) => {
      if (err) reject(err);
      else resolve(bytesRead === length ? target : target.subarray(0, bytesRead));
    });
  });
}

function appendTailSlidingWindow(entry, buf) {
  const offset = entry.downloadedBytes;
  entry.tailChunks.push({ offset, end: offset + buf.byteLength, buf });
  entry.tailBytes += buf.byteLength;
  while (entry.tailBytes > SHARED_AUDIO_MEM_TAIL_BYTES && entry.tailChunks.length > 1) {
    const removed = entry.tailChunks.shift();
    if (removed) entry.tailBytes = Math.max(0, entry.tailBytes - removed.buf.byteLength);
  }
  entry.tailStartOffset = entry.tailChunks[0]?.offset ?? (offset + buf.byteLength);
}

function readFromTailSlidingWindow(entry, cursor, maxEnd) {
  if (!entry.tailChunks.length || cursor < entry.tailStartOffset) return null;
  for (let i = 0; i < entry.tailChunks.length; i += 1) {
    const item = entry.tailChunks[i];
    if (cursor >= item.end) continue;
    if (cursor < item.offset) return null;
    const sliceStart = cursor - item.offset;
    const sliceEnd = Math.min(item.buf.byteLength, maxEnd + 1 - item.offset);
    return item.buf.subarray(sliceStart, sliceEnd);
  }
  return null;
}

function pumpSharedAudioStream(entry, response) {
  const stream = response.body instanceof Readable ? response.body : Readable.fromWeb(response.body);
  entry.writing = true;
  (async () => {
    try {
      for await (const chunk of stream) {
        if (entry.evicted || entry.failed) {
          stream.destroy?.();
          break;
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!buf.byteLength) continue;
        if (entry.downloadedBytes + buf.byteLength > MAX_SHARED_AUDIO_FILE_BYTES) {
          throw new Error('共享音频超出单曲缓存上限');
        }
        if (entry.fd !== null) {
          await writeFdBuffer(entry.fd, buf, entry.downloadedBytes);
        }
        appendTailSlidingWindow(entry, buf);
        entry.downloadedBytes += buf.byteLength;
        if (!entry.evicted && sharedAudioCache.get(entry.key) === entry) {
          entry.countedBytes += buf.byteLength;
          sharedAudioTotalBytes += buf.byteLength;
        }
        notifySharedAudioWaiters(entry);
      }
      if (!entry.evicted && !entry.failed && entry.downloadedBytes > 0) {
        entry.totalLength = entry.downloadedBytes;
        entry.complete = true;
        // 整曲落盘完成后立即清空内存滑动窗口，实现常驻 0 内存占用
        if (entry.fd !== null) {
          entry.tailChunks = [];
          entry.tailBytes = 0;
          entry.tailStartOffset = entry.downloadedBytes;
        }
      } else {
        entry.failed = true;
        removeSharedAudioEntry(entry.key);
      }
    } catch (err) {
      entry.failed = true;
      entry.error = err;
      removeSharedAudioEntry(entry.key);
    } finally {
      entry.writing = false;
      if (entry.evicted || entry.failed) {
        finalizeSharedAudioFileCleanup(entry);
      }
      notifySharedAudioWaiters(entry);
    }
  })();
}

async function getOrCreateSharedAudioEntry(rawUrl, fetchWithTimeout, options = {}) {
  const fetchUrl = preferHttpsMediaUrl(rawUrl);
  const key = sharedAudioCacheKey(fetchUrl);
  const now = Date.now();
  const cached = sharedAudioCache.get(key);
  if (cached) {
    if (!cached.failed && !cached.evicted && cached.expiresAt > now) {
      cached.lastAccessedAt = now;
      cached.expiresAt = now + SHARED_AUDIO_TTL_MS;
      sharedAudioCache.delete(key);
      sharedAudioCache.set(key, cached);
      return { entry: cached, fallbackResponse: null };
    }
    if (cached.activeReaders <= 0) removeSharedAudioEntry(key);
  }

  const inflight = sharedAudioInflight.get(key);
  if (inflight) {
    const sharedEntry = await inflight;
    if (sharedEntry && !sharedEntry.failed) {
      return { entry: sharedEntry, fallbackResponse: null };
    }
  }

  let resolveInflight;
  const inflightPromise = new Promise((resolve) => { resolveInflight = resolve; });
  sharedAudioInflight.set(key, inflightPromise);

  try {
    const headers = {
      'User-Agent': DEFAULT_MEDIA_UA,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      Referer: options.referer || refererForMediaUrl(fetchUrl),
      ...(options.headers || {}),
    };
    delete headers.Range;
    delete headers.range;
    delete headers['If-Range'];
    delete headers['if-range'];

    let response = await fetchMediaWithSafeRedirects(
      fetchWithTimeout,
      fetchUrl,
      {
        headers,
        extraAllowedHosts: options.extraAllowedHosts || [],
        requireAllowlist: options.requireAllowlist !== false,
        trustedInitialUrl: options.trustedInitialUrl,
        method: 'GET',
        nodeStream: true,
      },
      options.timeoutMs || 20000,
    );

    const rawType = normalizeAudioContentType(response.headers.get('content-type') || '');
    const declaredLen = Number(response.headers.get('content-length') || 0);
    const canShare = response.status === 200
      && response.body
      && isAudioStream(rawType, '')
      && !/^image\//i.test(rawType)
      && Number.isFinite(declaredLen)
      && declaredLen > 0
      && declaredLen <= MAX_SHARED_AUDIO_FILE_BYTES;

    if (!canShare) {
      resolveInflight(null);
      return { entry: null, fallbackResponse: response };
    }

    evictSharedAudioCacheIfNeeded(declaredLen);
    let filePath = '';
    let fd = null;
    if (ensureSharedAudioCacheDir()) {
      const digest = createHash('sha1').update(key).digest('hex');
      filePath = path.join(SHARED_AUDIO_CACHE_DIR, `${digest}-${++sharedAudioCacheSeq}.bin`);
      try {
        fd = fs.openSync(filePath, 'w+');
      } catch {
        filePath = '';
        fd = null;
      }
    }

    const entry = {
      key,
      sourceUrl: fetchUrl,
      contentType: rawType || 'audio/mpeg',
      etag: response.headers.get('etag') || '',
      lastModified: response.headers.get('last-modified') || '',
      totalLength: declaredLen,
      filePath,
      fd,
      tailChunks: [],
      tailBytes: 0,
      tailStartOffset: 0,
      downloadedBytes: 0,
      countedBytes: 0,
      writing: false,
      complete: false,
      failed: false,
      evicted: false,
      error: null,
      waiters: new Set(),
      activeReaders: 0,
      lastAccessedAt: Date.now(),
      expiresAt: Date.now() + SHARED_AUDIO_TTL_MS,
    };
    sharedAudioCache.set(key, entry);
    pumpSharedAudioStream(entry, response);
    resolveInflight(entry);
    return { entry, fallbackResponse: null };
  } catch (err) {
    resolveInflight(null);
    throw err;
  } finally {
    sharedAudioInflight.delete(key);
  }
}

function parseSharedByteRange(rangeHeader, totalLength) {
  const raw = String(rangeHeader || '').trim();
  if (!raw) return { isPartial: false, start: 0, end: totalLength - 1 };
  const match = raw.match(/^bytes=(\d*)-(\d*)$/iu);
  if (!match) return { invalid: true };
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return { invalid: true };
  let start;
  let end;
  if (!startStr) {
    const suffix = Number(endStr);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, totalLength - suffix);
    end = totalLength - 1;
  } else {
    start = Number(startStr);
    end = endStr ? Math.min(Number(endStr), totalLength - 1) : totalLength - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= totalLength || start > end) {
    return { unsatisfiable: true };
  }
  return { isPartial: true, start, end };
}

async function serveFromSharedAudioEntry(entry, res, options = {}) {
  const method = options.method === 'HEAD' ? 'HEAD' : 'GET';
  let parsedRange = parseSharedByteRange(options.range, entry.totalLength);
  if (parsedRange.invalid) {
    parsedRange = { isPartial: false, start: 0, end: entry.totalLength - 1 };
  }
  if (parsedRange.unsatisfiable) {
    res.set('Content-Range', `bytes */${entry.totalLength}`);
    res.set('Cache-Control', 'no-store, private');
    res.status(416).end();
    return true;
  }
  if (
    parsedRange.isPartial
    && options.ifRange
    && entry.etag
    && String(options.ifRange).trim() !== entry.etag
    && String(options.ifRange).trim() !== entry.lastModified
  ) {
    parsedRange = { isPartial: false, start: 0, end: entry.totalLength - 1 };
  }

  let { isPartial, start, end } = parsedRange;
  // 浏览器探测文件末尾 ID3v1/索引块或拖动跳到尚未下载的远端位置时，回退走单次上游 Range 请求
  if (!entry.complete) {
    const isTailProbe = isPartial
      && start >= Math.max(256 * 1024, entry.totalLength - SHARED_AUDIO_TAIL_PROBE_BYTES)
      && (end - start + 1) <= SHARED_AUDIO_TAIL_PROBE_BYTES;
    if (isTailProbe && start > entry.downloadedBytes) {
      return null;
    }
    if (start > entry.downloadedBytes + SHARED_AUDIO_AHEAD_SLACK_BYTES) {
      return null;
    }
  }

  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', 'sandbox');
  if (entry.contentType) res.set('Content-Type', entry.contentType);
  res.set('Accept-Ranges', 'bytes');
  if (entry.etag) res.set('ETag', entry.etag);
  if (entry.lastModified) res.set('Last-Modified', entry.lastModified);
  res.set('Cache-Control', 'private, max-age=600, no-transform');
  res.removeHeader?.('Pragma');
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Surrogate-Control', 'no-store');
  res.set('X-Accel-Buffering', 'no');
  res.set('X-OpenMusic-Proxy', entry.complete ? 'hit' : 'shared');

  if (isPartial) {
    res.set('Content-Range', `bytes ${start}-${end}/${entry.totalLength}`);
    res.set('Content-Length', String(end - start + 1));
    res.status(206);
  } else {
    res.set('Content-Length', String(entry.totalLength));
    res.status(200);
  }

  if (method === 'HEAD') {
    res.end();
    return true;
  }

  if (!res.headersSent) res.flushHeaders?.();

  let clientClosed = false;
  let wakeReader = null;
  const onClose = () => {
    clientClosed = true;
    if (wakeReader) {
      entry.waiters.delete(wakeReader);
      wakeReader();
    }
  };
  res.once('close', onClose);
  entry.activeReaders += 1;

  try {
    let cursor = start;

    while (cursor <= end && !clientClosed) {
      while (cursor < entry.downloadedBytes && cursor <= end && !clientClosed) {
        const availableEnd = Math.min(end, entry.downloadedBytes - 1);
        let slice = readFromTailSlidingWindow(entry, cursor, availableEnd);
        if (!slice) {
          if (entry.fd === null) {
            clientClosed = true;
            break;
          }
          const readLen = Math.min(SHARED_AUDIO_DISK_READ_CHUNK_BYTES, availableEnd - cursor + 1);
          slice = await readFdSlice(entry.fd, cursor, readLen);
          if (!slice.byteLength) break;
        }
        cursor += slice.byteLength;
        if (!res.write(slice) && !clientClosed) {
          await new Promise((resolve) => {
            const done = () => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.once('drain', done);
            res.once('close', done);
          });
        }
      }

      if (cursor > end || clientClosed) break;
      if (entry.complete) {
        if (cursor < entry.downloadedBytes) continue;
        break;
      }
      if (entry.failed) {
        if (!res.headersSent) res.status(502).end();
        else res.destroy?.();
        return false;
      }

      await new Promise((resolve) => {
        wakeReader = () => {
          wakeReader = null;
          resolve();
        };
        entry.waiters.add(wakeReader);
      });
    }

    if (!clientClosed && !res.writableEnded) {
      res.end();
    }
    return !clientClosed;
  } finally {
    releaseSharedAudioReader(entry);
    if (wakeReader) entry.waiters.delete(wakeReader);
    res.off('close', onClose);
  }
}

/** 后台预热同源代理音频到多人共享缓存池（带并发上限保护，防止多房间同时切歌打满带宽） */
export function warmSharedUpstreamMedia(rawUrl, options = {}) {
  const url = String(rawUrl || '').trim();
  if (!url || !/^https?:\/\//iu.test(url)) return;
  if (isLikelyImageMediaUrl(url, options)) return;
  try {
    const parsed = new URL(url);
    if (/(?:^|\/)audio\/qishui\/?$/iu.test(parsed.pathname)) return;
    if (isBlockedMediaHostname(parsed.hostname)) return;
    if (!isAllowedMediaHostname(parsed.hostname)) return;
  } catch {
    return;
  }
  const key = sharedAudioCacheKey(url);
  if (sharedAudioCache.has(key) || sharedAudioInflight.has(key)) return;
  if (activeWarmCount >= MAX_WARM_CONCURRENCY) return;
  activeWarmCount += 1;
  void getOrCreateSharedAudioEntry(url, null, {
    ...options,
    requireAllowlist: true,
  }).then((result) => {
    if (result?.fallbackResponse) {
      void cancelMediaBody(result.fallbackResponse);
    }
  }).catch(() => {}).finally(() => {
    activeWarmCount = Math.max(0, activeWarmCount - 1);
  });
}

/**
 * 从上游拉取媒体并返回给客户端。
 * 图片/缩略图整包缓冲；音频优先走多人共享流式缓存池，未命中或远端跳转时走 Range 流式转发
 */
export async function serveUpstreamMedia(rawUrl, res, fetchWithTimeout, options = {}) {
  if (res.destroyed || res.writableEnded) return false;
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.once('close', onClose);
  try {
    return await serveConnectedMedia(rawUrl, res, fetchWithTimeout, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
    });
  } finally {
    res.off('close', onClose);
  }
}

async function serveConnectedMedia(rawUrl, res, fetchWithTimeout, options) {
  const fetchUrl = preferHttpsMediaUrl(rawUrl);
  const method = options.method === 'HEAD' ? 'HEAD' : 'GET';
  const headers = {
    'User-Agent': DEFAULT_MEDIA_UA,
    Accept: '*/*',
    // 避免上游错误地压缩音频流
    'Accept-Encoding': 'identity',
    Referer: options.referer || refererForMediaUrl(fetchUrl),
    ...(options.headers || {}),
  };

  const range = String(options.range || '').trim();
  if (range) headers.Range = range;
  if (range && options.ifRange) headers['If-Range'] = String(options.ifRange);

  let prefetchedFallbackResponse = null;
  if (!isLikelyImageMediaUrl(fetchUrl, options)) {
    try {
      const shared = await getOrCreateSharedAudioEntry(fetchUrl, fetchWithTimeout, options);
      if (options.signal.aborted) {
        if (shared?.fallbackResponse) await cancelMediaBody(shared.fallbackResponse);
        return false;
      }
      if (shared?.entry) {
        const served = await serveFromSharedAudioEntry(shared.entry, res, options);
        if (served !== null) return served;
      } else if (shared?.fallbackResponse) {
        if (!range) {
          prefetchedFallbackResponse = shared.fallbackResponse;
        } else {
          await cancelMediaBody(shared.fallbackResponse);
        }
      }
    } catch (err) {
      if (options.signal.aborted) return false;
      respondMediaProxyFailure(res, err);
      return false;
    }
  }

  let response = prefetchedFallbackResponse;
  if (!response) try {
    response = await fetchMediaWithSafeRedirects(
      fetchWithTimeout,
      fetchUrl,
      {
        headers,
        extraAllowedHosts: options.extraAllowedHosts || [],
        requireAllowlist: options.requireAllowlist !== false,
        trustedInitialUrl: options.trustedInitialUrl,
        signal: options.signal,
        method,
        nodeStream: true,
      },
      options.timeoutMs || 20000,
    );
  } catch (err) {
    if (options.signal.aborted) return false;
    respondMediaProxyFailure(res, err);
    return false;
  }

  // 部分 CDN 拒绝 Range 但允许完整 GET，保留一次兼容重试
  // 416 表示请求范围不可满足，必须保留状态与总长度，不能重新下载整首歌曲
  if (method === 'GET' && range && response.status === 403) {
    await cancelMediaBody(response);
    const fallbackHeaders = { ...headers };
    delete fallbackHeaders.Range;
    delete fallbackHeaders['If-Range'];
    try {
      response = await fetchMediaWithSafeRedirects(
        fetchWithTimeout,
        fetchUrl,
        {
          ...options,
          headers: fallbackHeaders,
          range: '',
          method,
          nodeStream: true,
        },
        options.timeoutMs || 20000,
      );
    } catch (err) {
      if (options.signal.aborted) return false;
      respondMediaProxyFailure(res, err);
      return false;
    }
  }

  if (options.signal.aborted) {
    await cancelMediaBody(response);
    return false;
  }
  if (response.status === 416) {
    await cancelMediaBody(response);
    const contentRange = response.headers.get('content-range');
    if (contentRange && /^bytes \*\/\d+$/iu.test(contentRange)) res.set('Content-Range', contentRange);
    res.set('Cache-Control', 'no-store, private');
    res.status(416).end();
    return false;
  }
  if (!response.ok && response.status !== 206) {
    await cancelMediaBody(response);
    if (!res.headersSent) res.status(response.status).json({ error: '上游媒体返回 HTTP 错误', code: 'MEDIA_UPSTREAM_HTTP_ERROR' });
    return false;
  }

  const rawType = normalizeAudioContentType(response.headers.get('content-type') || '');
  const mediaType = rawType.split(';')[0].trim().toLowerCase();
  if (options.imageOnly && !mediaType.startsWith('image/')) {
    await cancelMediaBody(response);
    if (!res.headersSent) res.status(415).json({ error: '上游未返回支持的图片类型' });
    return false;
  }
  if (!/^(?:audio|video)\//u.test(mediaType) && !/^image\/(?:jpeg|png|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/u.test(mediaType) && !['application/octet-stream', 'application/ogg', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'].includes(mediaType)) {
    await cancelMediaBody(response);
    if (!res.headersSent) res.status(415).json({ error: '上游未返回支持的媒体类型' });
    return false;
  }
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', 'sandbox');
  const contentType = rawType;
  const useBuffer = shouldBufferResponse(rawType, options) && !isAudioStream(rawType, range);

  // 允许浏览器本地缓存私有音频分片以支持预取和跳转复用，同时禁止公网 CDN 与 Nginx 缓冲阻塞
  res.set('Cache-Control', useBuffer ? 'no-store, no-cache, must-revalidate, private, max-age=0' : 'private, max-age=600, no-transform');
  if (useBuffer) res.set('Pragma', 'no-cache');
  else res.removeHeader?.('Pragma');
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Surrogate-Control', 'no-store');
  if (!useBuffer) {
    res.set('X-Accel-Buffering', 'no');
  }
  res.set('X-OpenMusic-Proxy', '1');

  if (method === 'HEAD') {
    applyStreamingMediaHeaders(response, res, contentType);
    res.end();
    return true;
  }

  if (useBuffer) {
    try {
      const isImage = /^image\//i.test(rawType);
      const maxBufferedBytes = isImage ? MAX_BUFFERED_IMAGE_BYTES : MAX_BUFFERED_MEDIA_BYTES;
      const declaredLen = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(declaredLen) && declaredLen > maxBufferedBytes) {
        await cancelMediaBody(response);
        if (!res.headersSent) res.status(413).json({ error: '媒体过大' });
        return false;
      }
      const buffer = await readBoundedMediaResponse(response, maxBufferedBytes);
      if (res.writableEnded || res.destroyed) return false;
      if (contentType) res.set('Content-Type', contentType);
      const upstreamCacheControl = response.headers.get('cache-control') || '';
      const upstreamMaxAge = upstreamCacheControl.match(/\bmax-age\s*=\s*"?(\d+)/iu);
      const maxAge = upstreamMaxAge ? Math.min(3600, Math.max(300, Number(upstreamMaxAge[1]))) : 3600;
      if (isImage && response.status === 200 && maxAge > 0) {
        // 仅复用浏览器内的封面，避免翻页/切歌重复拉图占用 2GB 服务器带宽
        res.set('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=86400, no-transform`);
        res.removeHeader('Pragma');
      }
      res.status(200).send(buffer);
      return true;
    } catch (error) {
      if (!res.headersSent && !options.signal.aborted) {
        if (error?.statusCode === 413) res.status(413).json({ error: '媒体过大' });
        else res.status(502).json({ error: '媒体代理读取上游响应失败', code: 'MEDIA_STREAM_FAILED' });
      }
      return false;
    }
  }

  if (!response.body) {
    try {
      const buffer = Buffer.alloc(0);
      applyStreamingMediaHeaders(response, res, contentType);
      res.set('Content-Length', String(buffer.length));
      res.send(buffer);
      return true;
    } catch {
      if (!res.headersSent) res.status(502).json({ error: '媒体代理读取上游响应失败', code: 'MEDIA_STREAM_FAILED' });
      return false;
    }
  }

  const stream = response.body instanceof Readable ? response.body : Readable.fromWeb(response.body);
  let clientGone = false;
  const onClose = () => {
    clientGone = true;
    stream.destroy();
  };
  res.once('close', onClose);

  applyStreamingMediaHeaders(response, res, contentType);
  if (!res.headersSent) res.flushHeaders?.();
  try {
    await pipeline(stream, res);
    return true;
  } catch {
    if (clientGone) return false;
    if (!res.headersSent) res.status(502).end();
    return false;
  } finally {
    res.off('close', onClose);
  }
}

/** @deprecated 使用 serveUpstreamMedia */
export const pipeUpstreamMedia = serveUpstreamMedia;
