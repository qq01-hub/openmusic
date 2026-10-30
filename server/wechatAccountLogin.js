import { evalRedisScript } from './redisScripts.js';
import { createHash, randomBytes } from 'node:crypto';

export const WECHAT_ACCOUNT_LOGIN_COOKIE = 'openmusic_wechat_account_login';
export const WECHAT_ACCOUNT_LOGIN_TTL_SEC = 300;
const LOGIN_HOSTS = new Set(['szfilehelper.weixin.qq.com', 'filehelper.weixin.qq.com', 'wx.qq.com', 'wx2.qq.com', 'wx8.qq.com']);
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const INIT_RESPONSE_BYTES = 16 * 1024 * 1024;
const NEW_LOGIN_PATH = '/cgi-bin/mmwebwx-bin/webwxnewloginpage';
const LOGIN_PAGE = `https://szfilehelper.weixin.qq.com${NEW_LOGIN_PATH}`;
const digest = (value) => createHash('sha256').update(value).digest('hex');

export class WechatAccountLoginError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function invalidOfficialResponse(stage = 'response', officialCode, upstreamStatus) {
  const messages = {
    qr_start: '微信二维码服务返回异常，请重新获取二维码',
    qr_image: '微信二维码图片返回异常，请重新获取二维码',
    redirect_target: '微信登录跳转地址异常，请重新获取二维码',
    ticket_redirect: '微信登录跳转次数异常，请重新扫码',
    ticket_body: '微信登录凭据响应为空，请重新扫码',
    ticket_fields: '微信登录凭据字段不完整，请重新扫码',
    ticket_encoding: '微信登录凭据编码异常，请重新扫码',
    ticket: '微信登录凭据未通过验证，请稍后重新扫码',
    init: '微信登录初始化未通过，请稍后重新扫码',
    identity: '微信返回的身份信息不一致，请重新扫码',
    poll_response: '微信扫码状态响应异常，请重新扫码',
    poll_code: '微信扫码状态码异常，请重新扫码',
    request_target: '微信官方请求地址异常，请重新扫码',
    response_size: '微信官方响应过大，请重新扫码',
  };
  return Object.assign(new WechatAccountLoginError('WECHAT_OFFICIAL_RESPONSE_INVALID', messages[stage] || '微信官方身份验证未通过，请重新扫码', 502), {
    stage,
    ...(Number.isSafeInteger(Number(officialCode)) && /^-?\d{1,9}$/u.test(String(officialCode)) ? { officialCode: Number(officialCode) } : {}),
    ...(Number.isInteger(upstreamStatus) ? { upstreamStatus } : {}),
  });
}

function loginTarget(raw, base = LOGIN_PAGE) {
  let url;
  try { url = new URL(raw, base); } catch { throw invalidOfficialResponse('redirect_target'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !LOGIN_HOSTS.has(url.hostname) || url.pathname !== NEW_LOGIN_PATH) throw invalidOfficialResponse('redirect_target');
  return url;
}

function scriptField(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = text.match(new RegExp(`${escaped}\\s*=\\s*["']([^"']+)["']`, 'u'));
  return match?.[1]?.replace(/\\\//gu, '/') || '';
}

function xmlField(text, name) {
  const match = text.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`, 'u'));
  return String(match?.[1] ?? match?.[2] ?? '').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'");
}

async function readResponse(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw invalidOfficialResponse('response_size');
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw invalidOfficialResponse('response_size');
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw invalidOfficialResponse('response_size'); }
      chunks.push(Buffer.from(result.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function createWechatAccountLogin({ getStore, request = fetch, now = () => Date.now(), prefix = 'openmusic:account:wechat-login:v1:' }) {
  async function storeRun(operation) {
    const store = getStore();
    if (!store) throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    try { return await operation(store); }
    catch (error) {
      if (error instanceof WechatAccountLoginError) throw error;
      throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    }
  }

  function sessionKey(token) {
    if (!SESSION_PATTERN.test(String(token || ''))) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已过期，请重新扫码');
    return `${prefix}session:${digest(token)}`;
  }

  function assertFlow(token, flowId) {
    sessionKey(token);
    // 轮次摘要不是凭据，仍须匹配 HttpOnly Cookie，缺省仅兼容旧网页
    if (flowId !== undefined && (typeof flowId !== 'string' || !/^[a-f0-9]{64}$/u.test(flowId) || digest(token) !== flowId)) {
      throw new WechatAccountLoginError('WECHAT_LOGIN_REPLACED', '二维码已被刷新或其他页面替换，请重新获取', 409);
    }
  }

  async function readSession(token) {
    const key = sessionKey(token);
    const raw = await storeRun(store => store.get(key));
    if (raw === null) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已过期，请重新扫码');
    let session;
    try { session = JSON.parse(raw); } catch { throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503); }
    if (typeof raw !== 'string' || !session || session.version !== 1 || !Number.isSafeInteger(session.expiresAt)
      || typeof session.uuid !== 'string' || !/^[A-Za-z0-9_=-]{8,128}$/u.test(session.uuid)
      || !['waiting', 'scanned', 'confirmed', 'expired'].includes(session.status)
      || (session.status === 'confirmed' && (typeof session.uin !== 'string' || !/^\d{1,16}$/u.test(session.uin) || !Number.isSafeInteger(Number(session.uin)) || Number(session.uin) <= 0 || (session.nickname !== undefined && (typeof session.nickname !== 'string' || session.nickname.length > 200))))) {
      throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    }
    if (session.expiresAt <= now()) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已过期，请重新扫码');
    return { key, raw, session };
  }

  async function limit(key, maximum) {
    const count = await storeRun(store => evalRedisScript(store, `local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return count`, { keys: [key], arguments: [] }));
    if (!Number.isSafeInteger(count) || count < 1) throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    if (count > maximum) throw new WechatAccountLoginError('WECHAT_LOGIN_RATE_LIMITED', '微信登录请求过于频繁，请稍后重试', 429);
  }

  async function official(url, options = {}, timeoutMs = 10000) {
    const maxBytes = options.maxResponseBytes === INIT_RESPONSE_BYTES ? INIT_RESPONSE_BYTES : MAX_RESPONSE_BYTES;
    const { maxResponseBytes: _ignoredMaxResponseBytes, ...requestOptions } = options;
    const target = new URL(url);
    const allowed = target.protocol === 'https:' && !target.username && !target.password && !target.port && !target.hash && (
      target.hostname === 'login.wx2.qq.com' && ['/jslogin', '/cgi-bin/mmwebwx-bin/login'].includes(target.pathname)
      || target.hostname === 'login.weixin.qq.com' && /^\/qrcode\/[A-Za-z0-9_=-]{8,128}$/u.test(target.pathname)
      || LOGIN_HOSTS.has(target.hostname) && [NEW_LOGIN_PATH, '/cgi-bin/mmwebwx-bin/webwxinit'].includes(target.pathname)
    );
    if (!allowed) throw invalidOfficialResponse('request_target');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await request(target.toString(), { ...requestOptions, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Accept-Encoding': 'identity', Origin: target.origin, mmweb_appid: 'wx_webfilehelper', ...requestOptions.headers }, redirect: 'manual', signal: controller.signal });
      const buffer = await readResponse(response, maxBytes);
      return { response, buffer, text: buffer.toString('utf8') };
    } catch (error) {
      if (error instanceof WechatAccountLoginError) throw error;
      throw Object.assign(new WechatAccountLoginError('WECHAT_OFFICIAL_UNAVAILABLE', '微信官方验证暂不可用，请稍后重试', 502), { stage: 'official_request' });
    } finally { clearTimeout(timer); }
  }

  async function start(ip, previousToken = '') {
    await limit(`${prefix}start-ip:${digest(String(ip))}`, 10);
    const params = new URLSearchParams({ appid: 'wx_webfilehelper', redirect_uri: LOGIN_PAGE, fun: 'new', lang: 'zh_CN', _: String(now()) });
    const result = await official(`https://login.wx2.qq.com/jslogin?${params}`);
    const uuid = scriptField(result.text, 'window.QRLogin.uuid');
    if (result.response.status !== 200 || !/window\.QRLogin\.code\s*=\s*200\b/u.test(result.text) || !/^[A-Za-z0-9_=-]{8,128}$/u.test(uuid)) throw invalidOfficialResponse('qr_start', result.response.status, result.response.status);
    const token = randomBytes(32).toString('base64url');
    const record = { version: 1, uuid, status: 'waiting', expiresAt: now() + WECHAT_ACCOUNT_LOGIN_TTL_SEC * 1000 };
    await storeRun(async store => {
      const saved = await store.set(sessionKey(token), JSON.stringify(record), { NX: true, EX: WECHAT_ACCOUNT_LOGIN_TTL_SEC });
      if (saved !== 'OK') throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
      if (SESSION_PATTERN.test(previousToken)) await store.del(sessionKey(previousToken));
    });
    return { token, flowId: digest(token), expiresAt: record.expiresAt };
  }

  async function qr(token, flowId) {
    assertFlow(token, flowId);
    const state = await readSession(token);
    await limit(`${state.key}:qr`, 10);
    const result = await official(`https://login.weixin.qq.com/qrcode/${state.session.uuid}`);
    const contentType = String(result.response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (result.response.status !== 200 || !['image/jpeg', 'image/png'].includes(contentType)) throw invalidOfficialResponse('qr_image', undefined, result.response.status);
    return { buffer: result.buffer, contentType };
  }

  async function verifyOfficialIdentity(rawRedirect) {
    let target = loginTarget(rawRedirect);
    const cookies = new Map();
    let xml;
    for (let hop = 0; hop <= 3; hop += 1) {
      target.searchParams.set('fun', 'new');
      target.searchParams.set('version', 'v2');
      target.searchParams.set('lang', 'zh_CN');
      const result = await official(target.toString(), { headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } });
      const setCookies = result.response.headers.getSetCookie?.() || [result.response.headers.get('set-cookie') || ''];
      for (const entry of setCookies) {
        for (const item of entry.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_]*=)/u)) {
          const pair = item.trim().split(';')[0];
          const separator = pair.indexOf('=');
          if (separator > 0 && /^[A-Za-z0-9_]+$/u.test(pair.slice(0, separator)) && !/[\r\n]/u.test(pair)) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
      }
      if ([301, 302, 303, 307, 308].includes(result.response.status)) {
        const location = result.response.headers.get('location');
        if (!location || hop === 3) throw invalidOfficialResponse('ticket_redirect', undefined, result.response.status);
        target = loginTarget(location, target);
        continue;
      }
      if (result.response.status !== 200 || xmlField(result.text, 'ret') !== '0') throw invalidOfficialResponse('ticket', xmlField(result.text, 'ret'), result.response.status);
      const redirect = xmlField(result.text, 'redirecturl');
      if (redirect) {
        if (hop === 3) throw invalidOfficialResponse('ticket_redirect', undefined, result.response.status);
        target = loginTarget(redirect, target);
        continue;
      }
      xml = result.text;
      break;
    }
    if (!xml) throw invalidOfficialResponse('ticket_body');
    const uin = xmlField(xml, 'wxuin');
    const sid = xmlField(xml, 'wxsid');
    const skey = xmlField(xml, 'skey');
    const rawTicket = xmlField(xml, 'pass_ticket');
    if (!/^\d{1,16}$/u.test(uin) || !Number.isSafeInteger(Number(uin)) || Number(uin) <= 0 || !sid || !skey || !rawTicket) throw invalidOfficialResponse('ticket_fields');
    cookies.set('wxuin', uin);
    cookies.set('wxsid', sid);
    cookies.set('skey', skey);
    let ticket;
    try { ticket = decodeURIComponent(rawTicket); } catch { throw invalidOfficialResponse('ticket_encoding'); }
    const init = new URL('/cgi-bin/mmwebwx-bin/webwxinit', target.origin);
    init.search = new URLSearchParams({ r: String(~now()), lang: 'zh_CN', pass_ticket: ticket, skey }).toString();
    const initOptions = { method: 'POST', headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '), 'Content-Type': 'application/json;charset=UTF-8', mmweb_appid: 'wx_webfilehelper', Referer: LOGIN_PAGE }, body: JSON.stringify({ BaseRequest: { Uin: Number(uin), Sid: sid, Skey: skey, DeviceID: `e${String(BigInt(`0x${randomBytes(7).toString('hex')}`)).slice(0, 15).padStart(15, '0')}` } }) };
    let result;
    // 初始化故障只复用本次已兑换的凭据重试，不重新消费一次性扫码票据
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = await official(init.toString(), { ...initOptions, maxResponseBytes: INIT_RESPONSE_BYTES });
        if (result.response.status < 500 || attempt === 1) break;
      } catch (error) {
        if (error.code !== 'WECHAT_OFFICIAL_UNAVAILABLE') throw error;
        if (attempt === 1) throw Object.assign(new WechatAccountLoginError('WECHAT_OFFICIAL_INIT_UNAVAILABLE', '微信确认后连接暂时中断，请稍后重新扫码', 502), { stage: 'init' });
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    let data;
    try { data = JSON.parse(result.text); } catch { throw invalidOfficialResponse('init', undefined, result.response.status); }
    if (result.response.status !== 200 || data?.BaseResponse?.Ret !== 0) throw invalidOfficialResponse('init', data?.BaseResponse?.Ret, result.response.status);
    if (!/^\d{1,16}$/u.test(String(data?.User?.Uin || '')) || BigInt(data.User.Uin) !== BigInt(uin)) throw invalidOfficialResponse('identity');
    const nickname = typeof data?.User?.NickName === 'string' ? data.User.NickName.trim().slice(0, 200) : '';
    return { uin, nickname };
  }

  async function poll(token, flowId) {
    assertFlow(token, flowId);
    let state = await readSession(token);
    if (state.session.status === 'confirmed') return { status: 'confirmed' };
    if (state.session.status === 'expired') return { status: 'expired' };
    await limit(`${state.key}:poll`, 90);
    const lock = randomBytes(16).toString('hex');
    const locked = await storeRun(store => store.set(`${state.key}:lock`, lock, { NX: true, EX: 90 }));
    if (locked === null) return { status: 'waiting' };
    if (locked !== 'OK') throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    try {
      state = await readSession(token);
      if (state.session.status === 'confirmed' || state.session.status === 'expired') return { status: state.session.status };
      const params = new URLSearchParams({ loginicon: 'true', uuid: state.session.uuid, tip: state.session.status === 'scanned' ? '1' : '0', appid: 'wx_webfilehelper', _: String(now()) });
      const result = await official(`https://login.wx2.qq.com/cgi-bin/mmwebwx-bin/login?${params}`, {}, 25000);
      if (result.response.status !== 200) throw invalidOfficialResponse('poll_response', undefined, result.response.status);
      const code = Number(result.text.match(/window\.code\s*=\s*(\d+)/u)?.[1]);
      if (![200, 201, 408, 400].includes(code)) throw invalidOfficialResponse('poll_code', code, result.response.status);
      const status = code === 200 ? 'confirmed' : code === 201 ? 'scanned' : code === 400 ? 'expired' : state.session.status;
      const identity = code === 200 ? await verifyOfficialIdentity(scriptField(result.text, 'window.redirect_uri')) : null;
      const updated = { ...state.session, status, ...(identity ? { uin: identity.uin, nickname: identity.nickname } : {}) };
      const ttl = Math.floor((state.session.expiresAt - now()) / 1000);
      if (ttl < 1) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已过期，请重新扫码');
      const saved = await storeRun(store => evalRedisScript(store, `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1`, { keys: [state.key], arguments: [state.raw, JSON.stringify(updated), String(ttl)] }));
      if (saved === 0) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已更新，请重新扫码');
      if (saved !== 1) throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
      return { status };
    } finally {
      await storeRun(store => evalRedisScript(store, `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0`, { keys: [`${state.key}:lock`], arguments: [lock] }));
    }
  }

  async function consume(token) {
    const state = await readSession(token);
    if (state.session.status !== 'confirmed' || !/^\d{1,16}$/u.test(state.session.uin || '')) throw new WechatAccountLoginError('WECHAT_LOGIN_UNVERIFIED', '请先完成微信官方扫码确认');
    const consumed = await storeRun(store => evalRedisScript(store, `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('DEL', KEYS[1])`, { keys: [state.key], arguments: [state.raw] }));
    if (consumed === 0) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已使用，请重新扫码');
    if (consumed !== 1) throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    return { uin: state.session.uin, nickname: state.session.nickname || '' };
  }

  async function complete(token, operation, flowId) {
    assertFlow(token, flowId);
    const key = sessionKey(token);
    const lockKey = `${key}:complete`;
    const lock = randomBytes(16).toString('hex');
    const locked = await storeRun(store => store.set(lockKey, lock, { NX: true, EX: WECHAT_ACCOUNT_LOGIN_TTL_SEC }));
    if (locked === null) throw new WechatAccountLoginError('WECHAT_LOGIN_BUSY', '账户验证正在完成，请稍候', 409);
    if (locked !== 'OK') throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    try {
      const state = await readSession(token);
      if (state.session.status !== 'confirmed') throw new WechatAccountLoginError('WECHAT_LOGIN_UNVERIFIED', '请先完成微信官方扫码确认');
      // 下游账户或会话写入失败时保留确认结果，避免短暂故障迫使用户重新扫码
      const result = await operation({ uin: state.session.uin, nickname: state.session.nickname || '' });
      await consume(token);
      return result;
    } finally {
      await storeRun(store => evalRedisScript(store, `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0`, { keys: [lockKey], arguments: [lock] }))
        .catch(error => console.error('微信登录完成锁释放失败:', error.code || 'storage'));
    }
  }

  return { start, qr, poll, consume, complete };
}
