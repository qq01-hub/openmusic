import https from 'node:https';
import http from 'node:http';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { isBlockedMediaHostname } from './mediaProxy.js';

const sharedHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 64,
  maxFreeSockets: 16,
});

const sharedHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 64,
  maxFreeSockets: 16,
});

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost'
    || value === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(value);
}

export function isAllowedMetingUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:') return !isBlockedMediaHostname(parsed.hostname);
  if (parsed.protocol !== 'http:') return false;
  if (isLoopbackHostname(parsed.hostname)) return true;
  const dockerHostnames = ['meting-api', 'meting'];
  if (!process.env.DOCKER_REDIS_URL || !dockerHostnames.includes(parsed.hostname) || parsed.port !== '3000' || parsed.username || parsed.password) return false;
  try {
    const configured = new URL(process.env.DOCKER_METING_URL || '');
    return configured.protocol === 'http:' && dockerHostnames.includes(configured.hostname)
      && configured.port === parsed.port && !configured.username && !configured.password;
  } catch {
    return false;
  }
}

function buildRequestHeaders(inputHeaders, method) {
  const headers = { ...(inputHeaders || {}) };
  if (String(method || 'GET').toUpperCase() === 'HEAD') return headers;
  const hasAcceptEncoding = Object.keys(headers).some((name) => name.toLowerCase() === 'accept-encoding');
  if (!hasAcceptEncoding) {
    headers['Accept-Encoding'] = 'br, gzip, deflate';
  }
  return headers;
}

function parseContentEncodings(headerValue) {
  const normalized = String(headerValue || '').trim().toLowerCase();
  if (!normalized || normalized === 'identity') return [];
  const tokens = normalized.split(',').map((item) => item.trim()).filter(Boolean).reverse();
  const encodings = [];
  for (const token of tokens) {
    if (token === 'identity') continue;
    if (token === 'gzip' || token === 'x-gzip' || token === 'br' || token === 'deflate') {
      encodings.push(token);
      continue;
    }
    return null;
  }
  return encodings;
}

function createDecompressStream(encoding) {
  if (encoding === 'br') return createBrotliDecompress();
  if (encoding === 'deflate') return createInflate();
  return createGunzip();
}

function requestOnce(url, options = {}, timeoutMs = 10000) {
  const configuredLimit = Number(options.maxResponseBytes);
  const maxResponseBytes = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? Math.min(configuredLimit, 16 * 1024 * 1024) : 16 * 1024 * 1024;
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Meting 地址协议无效');
  if (!isAllowedMetingUrl(parsed)) {
    throw new Error('非本机 Meting 地址禁止使用 HTTP，请配置 HTTPS');
  }
  const transport = isHttps ? https : http;
  const method = options.method || 'GET';
  const requestHeaders = buildRequestHeaders(options.headers, method);

  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) {
      const error = new Error('请求已取消');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    let settled = false;
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: requestHeaders,
      agent: isHttps ? sharedHttpsAgent : sharedHttpAgent,
    }, (res) => {
      const statusCode = res.statusCode || 0;
      const skipDecompress = statusCode === 204 || statusCode === 304 || String(method).toUpperCase() === 'HEAD';
      const encodings = skipDecompress ? [] : parseContentEncodings(res.headers['content-encoding']);
      const shouldDecompress = Array.isArray(encodings) && encodings.length > 0;
      const chunks = [];
      let rawSize = 0;
      let decodedSize = 0;
      let decompressors = null;
      let entryStream = null;

      const failResponse = (error) => {
        if (decompressors) {
          for (const stream of decompressors) {
            stream.destroy();
          }
        }
        res.destroy();
        req.destroy();
        settleReject(error);
      };

      const finishResponse = (body, decompressed) => {
        const text = () => body.toString('utf8');
        settleResolve({
          ok: statusCode >= 200 && statusCode < 300,
          status: statusCode,
          headers: {
            get: (name) => {
              const lower = String(name).toLowerCase();
              if (decompressed && lower === 'content-encoding') return null;
              if (decompressed && lower === 'content-length') return String(body.length);
              return res.headers[lower] ?? null;
            },
          },
          text: async () => text(),
          json: async () => JSON.parse(text()),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        });
      };

      const ensureDecompressPipeline = () => {
        if (entryStream) return entryStream;
        decompressors = encodings.map((encoding) => createDecompressStream(encoding));
        for (let index = 0; index < decompressors.length; index += 1) {
          decompressors[index].on('error', failResponse);
          if (index > 0) {
            decompressors[index - 1].pipe(decompressors[index]);
          }
        }
        const outputStream = decompressors[decompressors.length - 1];
        outputStream.on('data', (decodedChunk) => {
          decodedSize += decodedChunk.length;
          if (decodedSize > maxResponseBytes) {
            failResponse(new Error('Meting 响应过大'));
            return;
          }
          chunks.push(decodedChunk);
        });
        outputStream.on('end', () => {
          finishResponse(Buffer.concat(chunks), true);
        });
        entryStream = decompressors[0];
        return entryStream;
      };

      res.on('data', (chunk) => {
        if (settled) return;
        rawSize += chunk.length;
        if (rawSize > maxResponseBytes) {
          failResponse(new Error('Meting 响应过大'));
          return;
        }
        if (!shouldDecompress) {
          chunks.push(chunk);
          return;
        }
        if (chunk.length === 0) return;
        const inputStream = ensureDecompressPipeline();
        if (!inputStream.write(chunk)) {
          res.pause();
          inputStream.once('drain', () => {
            if (!settled) res.resume();
          });
        }
      });
      res.on('error', failResponse);
      res.on('end', () => {
        if (settled) return;
        if (!shouldDecompress || !entryStream) {
          finishResponse(Buffer.concat(chunks), false);
          return;
        }
        entryStream.end();
      });
    });

    req.on('error', (error) => {
      if (error && typeof error === 'object' && req.reusedSocket) {
        error.reusedSocket = true;
      }
      settleReject(error);
    });
    const abortRequest = () => {
      const error = new Error('请求已取消');
      error.name = 'AbortError';
      req.destroy(error);
    };
    signal?.addEventListener('abort', abortRequest, { once: true });
    const deadline = timeoutMs > 0 ? setTimeout(() => {
      req.destroy(new Error('Meting 请求超时'));
    }, timeoutMs) : null;
    req.once('close', () => {
      if (deadline) clearTimeout(deadline);
      signal?.removeEventListener('abort', abortRequest);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Meting 请求超时'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function fetchMeting(url, options = {}, timeoutMs = 10000) {
  const method = String(options.method || 'GET').toUpperCase();
  const canRetryStaleSocket = (method === 'GET' || method === 'HEAD') && !options.signal?.aborted;
  try {
    return await requestOnce(url, options, timeoutMs);
  } catch (error) {
    const isStaleSocketReset = Boolean(error?.reusedSocket) && (error?.code === 'ECONNRESET' || error?.code === 'EPIPE');
    if (!canRetryStaleSocket || !isStaleSocketReset || options.signal?.aborted) {
      throw error;
    }
    return requestOnce(url, options, timeoutMs);
  }
}

export function formatMetingFetchError(err) {
  const cause = err?.cause;
  if (cause?.code) return `${err?.message || 'fetch failed'} (${cause.code})`;
  if (cause?.message) return `${err?.message || 'fetch failed'} (${cause.message})`;
  return err?.message || 'fetch failed';
}
