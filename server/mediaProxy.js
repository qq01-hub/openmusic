import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import http from 'node:http';
import https from 'node:https';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

export const DEFAULT_MEDIA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MAX_MEDIA_REDIRECTS = 5;
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

async function assertPublicDnsTarget(hostname) {
  const host = String(hostname).replace(/^\[|\]$/gu, '');
  if (isIP(host)) {
    if (isBlockedIpAddress(host)) {
      const err = new Error('禁止访问内网地址');
      err.statusCode = 403;
      throw err;
    }
    return [{ address: host, family: isIP(host) }];
  }

  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    const err = new Error('媒体域名解析失败');
    err.statusCode = 502;
    throw err;
  }
  if (!records.length || records.some((record) => isBlockedIpAddress(record.address))) {
    const err = new Error('禁止访问内网地址');
    err.statusCode = 403;
    throw err;
  }
  return records;
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

/** 流式响应只透传 Range 相关头；不写 Content-Length，避免 HTTP/2 字节数承诺与实际 DATA 帧不一致 */
function applyStreamingMediaHeaders(response, res, contentType) {
  if (contentType) res.set('Content-Type', contentType);
  for (const header of ['accept-ranges', 'content-range']) {
    const value = response.headers.get(header);
    if (value) res.set(header, value);
  }
  res.status(response.status);
}

async function assertSafeMediaUrl(rawUrl, extraAllowedHosts, { requireAllowlist }) {
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
  const addresses = await assertPublicDnsTarget(parsed.hostname);
  return { parsed, addresses };
}

function requestPinnedMedia({ parsed, addresses }, headers, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const transport = parsed.protocol === 'https:' ? https : http;
    let deadline;
    const request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname.replace(/^\[|\]$/gu, ''),
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET', headers, signal,
      lookup: (_hostname, options, callback) => options?.all
        ? callback(null, addresses)
        : callback(null, addresses[0].address, addresses[0].family),
    }, (response) => {
      clearTimeout(deadline);
      try {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value));
        }
        const status = response.statusCode || 502;
        let stream = response;
        if (![204, 205, 304].includes(status) && !(status >= 300 && status < 400)) {
          const encodings = (responseHeaders.get('content-encoding') || '').split(',').map((value) => value.trim().toLowerCase()).filter((value) => value && value !== 'identity');
          const decoders = encodings.reverse().map((encoding) => {
            if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip();
            if (encoding === 'deflate') return createInflate();
            if (encoding === 'br') return createBrotliDecompress();
            throw new Error('Unsupported media encoding');
          });
          if (decoders.length) {
            stream = decoders.at(-1);
            pipeline(response, ...decoders).catch((error) => stream.destroy(error));
            responseHeaders.delete('content-encoding');
            responseHeaders.delete('content-length');
          }
        }
        const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(stream);
        if (!body) response.resume();
        resolve(new Response(body, { status, headers: responseHeaders }));
      } catch (error) {
        response.destroy();
        request.destroy();
        reject(error);
      }
    });
    request.on('error', reject);
    request.once('close', () => clearTimeout(deadline));
    const timeout = () => request.destroy(new Error('媒体请求超时'));
    deadline = setTimeout(timeout, timeoutMs);
    request.setTimeout(timeoutMs, timeout);
    request.end();
  });
}

/**
 * 手动跟随重定向，每一跳重新校验主机名，避免公网 302 跳内网绕过 SSRF 检查。
 */
export async function fetchMediaWithSafeRedirects(fetchWithTimeout, rawUrl, fetchOptions = {}, timeoutMs = 20000) {
  const extraAllowedHosts = fetchOptions.extraAllowedHosts || [];
  const requireAllowlist = fetchOptions.requireAllowlist !== false;
  const headers = { ...(fetchOptions.headers || {}) };

  let currentUrl = preferHttpsMediaUrl(rawUrl);
  for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop += 1) {
    const target = await assertSafeMediaUrl(currentUrl, extraAllowedHosts, { requireAllowlist });
    const response = await requestPinnedMedia(target, headers, fetchOptions.signal, timeoutMs);

    if (response.status >= 300 && response.status < 400) {
      const location = String(response.headers.get('location') || '').trim();
      try {
        await response.body?.cancel?.();
      } catch {
        // 忽略 drain 失败，继续跟随 Location
      }
      if (!location) {
        const err = new Error('上游返回空重定向');
        err.statusCode = 502;
        throw err;
      }
      try {
        currentUrl = preferHttpsMediaUrl(new URL(location, currentUrl).toString());
      } catch {
        const err = new Error('上游重定向地址无效');
        err.statusCode = 502;
        throw err;
      }
      for (const name of Object.keys(headers)) {
        if (['authorization', 'cookie', 'proxy-authorization'].includes(name.toLowerCase()) || name.toLowerCase().startsWith('x-openmusic-')) delete headers[name];
      }
      continue;
    }

    return response;
  }

  const err = new Error('上游重定向次数过多');
  err.statusCode = 502;
  throw err;
}

async function readBoundedMediaResponse(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.byteLength;
      if (total > maxBytes) {
        const error = new Error('媒体过大');
        error.statusCode = 413;
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * 从上游拉取媒体并返回给客户端。
 * 图片/缩略图整包缓冲；音频 Range 流式转发（勿中途 abort body）。
 */
export async function serveUpstreamMedia(rawUrl, res, fetchWithTimeout, options = {}) {
  const fetchUrl = preferHttpsMediaUrl(rawUrl);
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

  let response;
  try {
    response = await fetchMediaWithSafeRedirects(
      fetchWithTimeout,
      fetchUrl,
      {
        headers,
        extraAllowedHosts: options.extraAllowedHosts || [],
        requireAllowlist: options.requireAllowlist !== false,
        trustedInitialUrl: options.trustedInitialUrl,
      },
      options.timeoutMs || 20000,
    );
  } catch (err) {
    if (!res.headersSent) {
      const status = Number(err?.statusCode) || 502;
      res.status(status).json({ error: err?.message || '媒体代理失败' });
    }
    return false;
  }

  // 少数汽水 CDN 对带 Range 的请求返回 403/416，但完整 GET 可以正常返回。
  // 仅在已走代理且上游明确拒绝 Range 时重试一次，不影响普通直链和正常分段播放。
  if (range && (response.status === 403 || response.status === 416)) {
    try {
      await response.body?.cancel?.();
    } catch {
      // 忽略上游错误响应的释放失败，继续尝试无 Range 请求。
    }
    const fallbackHeaders = { ...headers };
    delete fallbackHeaders.Range;
    try {
      response = await fetchMediaWithSafeRedirects(
        fetchWithTimeout,
        fetchUrl,
        {
          ...options,
          headers: fallbackHeaders,
          range: '',
        },
        options.timeoutMs || 20000,
      );
    } catch (err) {
      if (!res.headersSent) {
        const status = Number(err?.statusCode) || 502;
        res.status(status).json({ error: err?.message || '媒体代理失败' });
      }
      return false;
    }
  }

  if (!response.ok && response.status !== 206) {
    await response.body?.cancel?.().catch(() => {});
    if (!res.headersSent) res.status(response.status).json({ error: '上游媒体请求失败' });
    return false;
  }

  const rawType = response.headers.get('content-type') || '';
  const mediaType = rawType.split(';')[0].trim().toLowerCase();
  if (!/^(?:audio|video)\//u.test(mediaType) && !/^image\/(?:jpeg|png|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/u.test(mediaType) && !['application/octet-stream', 'application/ogg', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'].includes(mediaType)) {
    await response.body?.cancel?.().catch(() => {});
    if (!res.headersSent) res.status(415).json({ error: '上游未返回支持的媒体类型' });
    return false;
  }
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', 'sandbox');
  const contentType = normalizeAudioContentType(rawType);
  const useBuffer = shouldBufferResponse(rawType, options) && !isAudioStream(rawType, range);

  // 流式音频禁止 CDN/Nginx 缓冲或分段缓存（酷狗等 HTTP 代理链路易因此卡顿）
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Surrogate-Control', 'no-store');
  if (!useBuffer) {
    res.set('X-Accel-Buffering', 'no');
  }
  res.set('X-OpenMusic-Proxy', '1');

  if (useBuffer) {
    try {
      const isImage = /^image\//i.test(rawType);
      const maxBufferedBytes = isImage ? MAX_BUFFERED_IMAGE_BYTES : MAX_BUFFERED_MEDIA_BYTES;
      const declaredLen = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(declaredLen) && declaredLen > maxBufferedBytes) {
        await response.body?.cancel?.().catch(() => {});
        if (!res.headersSent) res.status(413).json({ error: '媒体过大' });
        return false;
      }
      const buffer = await readBoundedMediaResponse(response, maxBufferedBytes);
      if (res.writableEnded || res.destroyed) return false;
      if (contentType) res.set('Content-Type', contentType);
      res.status(200).send(buffer);
      return true;
    } catch (error) {
      if (!res.headersSent) res.status(error?.statusCode === 413 ? 413 : 502).json({ error: error?.statusCode === 413 ? '媒体过大' : '媒体代理失败' });
      return false;
    }
  }

  if (!response.body) {
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      applyStreamingMediaHeaders(response, res, contentType);
      res.set('Content-Length', String(buffer.length));
      res.send(buffer);
      return true;
    } catch {
      if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
      return false;
    }
  }

  const stream = Readable.fromWeb(response.body);
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
    stream.destroy();
  });

  applyStreamingMediaHeaders(response, res, contentType);
  if (!res.headersSent) res.flushHeaders?.();
  try {
    await pipeline(stream, res);
    return true;
  } catch {
    if (clientGone) return false;
    if (!res.headersSent) res.status(502).end();
    return false;
  }
}

/** @deprecated 使用 serveUpstreamMedia */
export const pipeUpstreamMedia = serveUpstreamMedia;
