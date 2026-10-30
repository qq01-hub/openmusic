import { createHash, randomBytes } from 'node:crypto';
import { evalRedisScript } from './redisScripts.js';

export const SOCIAL_PROVIDERS = ['wechat_scan', 'qq_scan'];
const TYPES = { wechat_scan: '2', qq_scan: '1' };
const PREFIX = 'openmusic:account:social-login:v1:';
const digest = value => createHash('sha256').update(value).digest('hex');
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const RELEASE = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('DEL', KEYS[1])";

export class SocialLoginError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function apiBase(config) {
  try {
    const url = new URL(config.apihzBaseUrl);
    if (url.protocol === 'https:' && ['cn.apihz.cn', 'vip.apihz.cn'].includes(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/api\/?$/u.test(url.pathname)) return `${url.origin}/api`;
  } catch { /* 配置不完整时保持关闭 */ }
  return '';
}

export function socialProviderEnabled(provider, config) {
  return Boolean(TYPES[provider] && config[provider === 'wechat_scan' ? 'apihzWechatEnabled' : 'apihzQqEnabled']
    && config.apihzId && config.apihzKey && apiBase(config));
}

export function createSocialLogin({ getStore, getConfig, request = fetch, now = Date.now }) {
  const failure = () => new SocialLoginError('SOCIAL_UPSTREAM_INVALID', '扫码服务返回异常，请重新获取二维码', 502);
  const expired = () => new SocialLoginError('SOCIAL_LOGIN_EXPIRED', '二维码已过期或已使用，请重新获取');
  const changed = () => new SocialLoginError('SOCIAL_LOGIN_CHANGED', '扫码会话或账户已变化，请重新获取二维码', 409);

  async function storage(operation) {
    try {
      const store = getStore();
      if (!store) throw new Error('unavailable');
      return await operation(store);
    } catch (error) {
      if (error instanceof SocialLoginError) throw error;
      throw new SocialLoginError('SOCIAL_STORAGE_UNAVAILABLE', '扫码登录存储暂不可用，请稍后重试', 503);
    }
  }

  function configFor(provider) {
    const config = getConfig();
    if (!socialProviderEnabled(provider, config)) throw new SocialLoginError('SOCIAL_LOGIN_DISABLED', '此扫码登录方式暂不可用', 503);
    return config;
  }

  function contextHash(context, config) {
    return digest(JSON.stringify([context.provider, context.action, context.principal, context.audience, config.apihzId, config.apihzKey, apiBase(config)]));
  }

  async function limit(key, maximum) {
    const count = await storage(store => evalRedisScript(store,
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return count",
      { keys: [`${PREFIX}limit:${key}`], arguments: [] }));
    if (!Number.isSafeInteger(count) || count < 1) throw new SocialLoginError('SOCIAL_STORAGE_UNAVAILABLE', '扫码登录存储暂不可用', 503);
    if (count > maximum) throw new SocialLoginError('SOCIAL_LOGIN_RATE_LIMITED', '扫码请求过于频繁，请稍后重试', 429);
  }

  async function upstream(url, options, maxBytes = 128 * 1024) {
    try {
      const response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) throw failure();
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); throw failure(); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      return { buffer: Buffer.concat(chunks), contentType: String(response.headers.get('content-type') || '').split(';')[0] };
    } catch (error) {
      if (error instanceof SocialLoginError) throw error;
      throw new SocialLoginError('SOCIAL_UPSTREAM_UNAVAILABLE', '扫码服务暂不可用，请稍后重试', 502);
    }
  }

  async function api(config, file, params) {
    const result = await upstream(`${apiBase(config)}/user/${file}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ id: config.apihzId, key: config.apihzKey, ...params }).toString(),
    });
    let data;
    try { data = JSON.parse(result.buffer.toString('utf8')); } catch { throw failure(); }
    if (data?.code !== 200) throw failure();
    return data;
  }

  async function qrImage(raw) {
    let url;
    try { url = new URL(raw); } catch { throw failure(); }
    if (url.protocol !== 'https:' || url.hostname !== 'res.apihz.cn' || url.port || url.username || url.password || url.hash || url.search
      || !/^\/ewmapi\/ewm\/[A-Za-z0-9_-]+\.(png|jpg|jpeg)$/u.test(url.pathname)) throw failure();
    const result = await upstream(url.toString(), {}, 512 * 1024);
    if (!['image/png', 'image/jpeg'].includes(result.contentType)) throw failure();
    return `data:${result.contentType};base64,${result.buffer.toString('base64')}`;
  }

  function keyFor(token) {
    if (!TOKEN_PATTERN.test(String(token || ''))) throw expired();
    return `${PREFIX}session:${digest(token)}`;
  }

  async function read(token, flowId, context) {
    const config = configFor(context.provider);
    if (typeof flowId !== 'string' || !/^[a-f0-9]{64}$/u.test(flowId) || digest(String(token || '')) !== flowId) throw changed();
    const key = keyFor(token);
    const raw = await storage(store => store.get(key));
    if (!raw) throw expired();
    let session;
    try { session = JSON.parse(raw); } catch { throw expired(); }
    if (session.version !== 1 || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now()) throw expired();
    if (session.context !== contextHash(context, config)) throw changed();
    return { session, raw, key, config };
  }

  async function start(context, previousToken = '') {
    const config = configFor(context.provider);
    if (!['login', 'bind'].includes(context.action) || !['account', 'admin'].includes(context.audience)
      || typeof context.principal !== 'string' || (context.action === 'bind' && !context.principal)) throw changed();
    await limit(`start:${digest(String(context.ip))}`, 8);
    const data = await api(config, 'jhdl.php', { type: TYPES[context.provider], display: '1' });
    if (typeof data.cxid !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/u.test(data.cxid)) throw failure();
    const qrUrl = await qrImage(data.logqrcode);
    const token = randomBytes(32).toString('base64url');
    const ttl = context.provider === 'wechat_scan' ? 60 : 300;
    const session = { version: 1, cxid: data.cxid, context: contextHash(context, config), expiresAt: now() + ttl * 1000 };
    await storage(async store => {
      if (await store.set(keyFor(token), JSON.stringify(session), { NX: true, EX: ttl }) !== 'OK') throw expired();
      if (TOKEN_PATTERN.test(previousToken)) await store.del(keyFor(previousToken));
    });
    return { token, flowId: digest(token), expiresAt: session.expiresAt, qrUrl };
  }

  async function identity(state, context) {
    await limit(`poll:${digest(state.key)}`, 40);
    const data = await api(state.config, 'jhdlq.php', { cxid: state.session.cxid });
    if (state.session.expiresAt <= now()) throw expired();
    if (contextHash(context, configFor(context.provider)) !== state.session.context) throw changed();
    if (String(data.type) !== TYPES[context.provider]) throw failure();
    if (data.openid === '' || data.openid === null || data.openid === undefined) return null;
    if (typeof data.openid !== 'string' || !data.openid.trim() || data.openid.length > 255 || /[\u0000-\u001f\u007f]/u.test(data.openid)) throw failure();
    return { provider: context.provider, subject: data.openid, profile: {
      username: typeof data.nickname === 'string' ? data.nickname.trim().slice(0, 100) : '',
      // 第三方头像并非身份凭据，不将上游的任意图片地址写入账户
      avatarUrl: '',
    } };
  }

  async function locked(token, flowId, context, operation) {
    const state = await read(token, flowId, context);
    const lockKey = `${state.key}:lock`;
    const lock = randomBytes(24).toString('hex');
    if (await storage(store => store.set(lockKey, lock, { NX: true, EX: 120 })) !== 'OK') {
      throw new SocialLoginError('SOCIAL_LOGIN_BUSY', '扫码验证正在进行，请稍后重试', 409);
    }
    try { return await operation(await read(token, flowId, context)); }
    finally { await storage(store => evalRedisScript(store, RELEASE, { keys: [lockKey], arguments: [lock] })); }
  }

  async function poll(token, flowId, context) {
    return locked(token, flowId, context, async state => ({ status: await identity(state, context) ? 'confirmed' : 'waiting' }));
  }

  async function complete(token, flowId, context, operation) {
    return locked(token, flowId, context, async state => {
      const verified = await identity(state, context);
      if (!verified) throw new SocialLoginError('SOCIAL_LOGIN_UNVERIFIED', '请先完成扫码并在手机上确认');
      const result = await operation(verified);
      const deleted = await storage(store => evalRedisScript(store, RELEASE, { keys: [state.key], arguments: [state.raw] }));
      if (deleted !== 1) throw expired();
      return result;
    });
  }

  return { start, poll, complete };
}

export function mountSocialLoginRoutes(app, { basePath, service, contextFor, complete, metric = () => {} }) {
  const productionSecure = process.env.NODE_ENV === 'production' && !['1', 'true'].includes(process.env.ALLOW_INSECURE_COOKIES);
  for (const provider of SOCIAL_PROVIDERS) {
    const path = `${basePath}/${provider}`;
    const cookieName = `om_social_${basePath.includes('/admin/') ? 'admin' : 'account'}_${provider}`;
    for (const operation of ['start', 'poll', 'complete']) {
      app.post(`${path}/${operation}`, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, private');
        try {
          if (!['login', 'bind'].includes(req.body?.action)) throw new SocialLoginError('SOCIAL_ACTION_INVALID', '无效的扫码操作', 400);
          const context = await contextFor(req, res, req.body.action);
          if (!context) return;
          const cookies = Object.fromEntries(String(req.headers?.cookie || '').split(';').map(item => {
            const index = item.indexOf('=');
            return [item.slice(0, index).trim(), item.slice(index + 1).trim()];
          }));
          const token = cookies[cookieName] || '';
          const input = { ...context, provider, action: req.body.action };
          const setCookie = value => res.append('Set-Cookie', `${cookieName}=${value}; Path=${path}; Max-Age=${value ? 300 : 0}; HttpOnly; SameSite=Strict${productionSecure || req.secure ? '; Secure' : ''}`);
          if (operation === 'start') {
            const { token: nextToken, ...publicFlow } = await service.start(input, token);
            setCookie(nextToken);
            metric(`${provider}_start`, 'success');
            return res.json(publicFlow);
          }
          if (operation === 'poll') return res.json(await service.poll(token, req.body.flowId, input));
          const result = await service.complete(token, req.body.flowId, input, verified => complete(req, res, input, verified));
          setCookie('');
          metric(`${provider}_${input.action}`, 'success');
          return res.json(result);
        } catch (error) {
          const known = error instanceof SocialLoginError || Number.isInteger(error.status) && typeof error.code === 'string';
          metric(`${provider}_${operation}`, known ? error.code : 'error');
          if (error.status === 429) res.setHeader('Retry-After', '60');
          return res.status(known ? error.status : 503).json({
            error: known ? error.message : '扫码登录暂不可用，请稍后重试',
            code: known ? error.code : 'SOCIAL_LOGIN_UNAVAILABLE',
          });
        }
      });
    }
  }
}
