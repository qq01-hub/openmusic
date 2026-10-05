import https from 'node:https';
import http from 'node:http';

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost'
    || value === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(value);
}

export function isAllowedMetingUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') return true;
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

function requestOnce(url, options = {}, timeoutMs = 10000) {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Meting 地址协议无效');
  if (!isAllowedMetingUrl(parsed)) {
    throw new Error('非本机 Meting 地址禁止使用 HTTP，请配置 HTTPS');
  }
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) {
      const error = new Error('请求已取消');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      // 使用 Node 系统 CA 校验证书，不允许关闭 TLS 校验。
      agent: undefined,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const text = () => body.toString('utf8');
        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          headers: {
            get: (name) => res.headers[String(name).toLowerCase()] ?? null,
          },
          text: async () => text(),
          json: async () => JSON.parse(text()),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        });
      });
    });

    req.on('error', reject);
    const abortRequest = () => {
      const error = new Error('请求已取消');
      error.name = 'AbortError';
      req.destroy(error);
    };
    signal?.addEventListener('abort', abortRequest, { once: true });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Meting 请求超时'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function fetchMeting(url, options = {}, timeoutMs = 10000) {
  return requestOnce(url, options, timeoutMs);
}

export function formatMetingFetchError(err) {
  const cause = err?.cause;
  if (cause?.code) return `${err?.message || 'fetch failed'} (${cause.code})`;
  if (cause?.message) return `${err?.message || 'fetch failed'} (${cause.message})`;
  return err?.message || 'fetch failed';
}
