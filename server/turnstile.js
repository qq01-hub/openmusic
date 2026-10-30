import { isIP } from 'node:net';

export function validateTurnstileConfig(config) {
  if (!config.turnstileEnabled) return '';
  if (![config.turnstileSiteKey, config.turnstileSecretKey].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/u.test(value))) return '启用人机校验前请填写有效的 Site Key 和 Secret Key';
  const hosts = String(config.turnstileHostnames || '').split(',').map(value => value.trim().toLowerCase());
  if (!hosts.length || hosts.length > 10 || hosts.some(host => !/^(?:localhost|(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/u.test(host))) return '请填写 1 至 10 个精确主机名，以英文逗号分隔，不含协议、端口、路径或通配符';
  return '';
}

class HumanCheckError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

export function createTurnstileVerifier({ getConfig, fetchImpl = fetch, now = Date.now, action = 'account_auth' }) {
  return async (token, ip, expectedCdata) => {
    const config = getConfig();
    if (!config.turnstileEnabled) return null;
    if (validateTurnstileConfig(config)) throw new HumanCheckError('HUMAN_CHECK_UNAVAILABLE', '人机校验配置暂不可用，请联系管理员', 503);
    if (typeof token !== 'string' || !token.trim() || token.length > 2048) throw new HumanCheckError('HUMAN_CHECK_REQUIRED', '请先完成人机校验', 400);
    let data;
    try {
      const body = new URLSearchParams({ secret: config.turnstileSecretKey, response: token });
      if (isIP(ip || '')) body.set('remoteip', ip);
      const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(6500),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Unavailable'); }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16384) { await reader.cancel(); throw new Error('Oversized'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HumanCheckError('HUMAN_CHECK_UNAVAILABLE', '人机校验服务暂不可用，请稍后重试', 503);
    }
    const hosts = config.turnstileHostnames.split(',').map(value => value.trim().toLowerCase());
    const challengeAt = Date.parse(data?.challenge_ts);
    if (data?.success !== true || !hosts.includes(String(data.hostname || '').toLowerCase()) || data.action !== action
      || (expectedCdata !== undefined && data.cdata !== expectedCdata)
      || !Number.isFinite(challengeAt) || challengeAt < now() - 300000 || challengeAt > now() + 30000) {
      throw new HumanCheckError('HUMAN_CHECK_FAILED', '人机校验未通过或已过期，请重新验证', 403);
    }
    return now();
  };
}
