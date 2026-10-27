import { createHash, randomBytes } from 'node:crypto';

export const WECHAT_ACCOUNT_LOGIN_COOKIE = 'openmusic_wechat_account_login';
export const WECHAT_ACCOUNT_LOGIN_TTL_SEC = 300;
const LOGIN_HOSTS = new Set(['szfilehelper.weixin.qq.com', 'filehelper.weixin.qq.com', 'wx.qq.com', 'wx2.qq.com', 'wx8.qq.com']);
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_RESPONSE_BYTES = 512 * 1024;
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

function invalidOfficialResponse() {
  return new WechatAccountLoginError('WECHAT_OFFICIAL_RESPONSE_INVALID', '微信官方身份验证未通过，请重新扫码', 502);
}

function loginTarget(raw, base = LOGIN_PAGE) {
  let url;
  try { url = new URL(raw, base); } catch { throw invalidOfficialResponse(); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !LOGIN_HOSTS.has(url.hostname) || url.pathname !== NEW_LOGIN_PATH) throw invalidOfficialResponse();
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

async function readResponse(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw invalidOfficialResponse();
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_RESPONSE_BYTES) throw invalidOfficialResponse();
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
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw invalidOfficialResponse(); }
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

  async function readSession(token) {
    const key = sessionKey(token);
    const raw = await storeRun(store => store.get(key));
    if (raw === null) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已过期，请重新扫码');
    let session;
    try { session = JSON.parse(raw); } catch { throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503); }
    if (typeof raw !== 'string' || !session || session.version !== 1 || !Number.isSafeInteger(session.expiresAt)
      || typeof session.uuid !== 'string' || !/^[A-Za-z0-9_=-]{8,128}$/u.test(session.uuid)
      || !['waiting', 'scanned', 'confirmed', 'expired'].includes(session.status)
      || (session.status === 'confirmed' && (typeof session.uin !== 'string' || !/^\d{1,16}$/u.test(session.uin) || !Number.isSafeInteger(Number(session.uin)) || Number(session.uin) <= 0))) {
      throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    }
    if (session.expiresAt <= now()) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已过期，请重新扫码');
    return { key, raw, session };
  }

  async function limit(key, maximum) {
    const count = await storeRun(store => store.eval(`local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return count`, { keys: [key], arguments: [] }));
    if (!Number.isSafeInteger(count) || count < 1) throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    if (count > maximum) throw new WechatAccountLoginError('WECHAT_LOGIN_RATE_LIMITED', '微信登录请求过于频繁，请稍后重试', 429);
  }

  async function official(url, options = {}, timeoutMs = 10000) {
    const target = new URL(url);
    const allowed = target.protocol === 'https:' && !target.username && !target.password && !target.port && !target.hash && (
      target.hostname === 'login.wx2.qq.com' && ['/jslogin', '/cgi-bin/mmwebwx-bin/login'].includes(target.pathname)
      || target.hostname === 'login.weixin.qq.com' && /^\/qrcode\/[A-Za-z0-9_=-]{8,128}$/u.test(target.pathname)
      || LOGIN_HOSTS.has(target.hostname) && [NEW_LOGIN_PATH, '/cgi-bin/mmwebwx-bin/webwxinit'].includes(target.pathname)
    );
    if (!allowed) throw invalidOfficialResponse();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await request(target.toString(), { ...options, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Accept-Encoding': 'identity', Origin: target.origin, mmweb_appid: 'wx_webfilehelper', ...options.headers }, redirect: 'manual', signal: controller.signal });
      const buffer = await readResponse(response);
      return { response, buffer, text: buffer.toString('utf8') };
    } catch (error) {
      if (error instanceof WechatAccountLoginError) throw error;
      throw new WechatAccountLoginError('WECHAT_OFFICIAL_UNAVAILABLE', '微信官方验证暂不可用，请稍后重试', 502);
    } finally { clearTimeout(timer); }
  }

  async function start(ip, previousToken = '') {
    await limit(`${prefix}start-ip:${digest(String(ip))}`, 10);
    const params = new URLSearchParams({ appid: 'wx_webfilehelper', redirect_uri: encodeURIComponent(LOGIN_PAGE), fun: 'new', lang: 'zh_CN', _: String(now()) });
    const result = await official(`https://login.wx2.qq.com/jslogin?${params}`);
    const uuid = scriptField(result.text, 'window.QRLogin.uuid');
    if (result.response.status !== 200 || !/window\.QRLogin\.code\s*=\s*200\b/u.test(result.text) || !/^[A-Za-z0-9_=-]{8,128}$/u.test(uuid)) throw invalidOfficialResponse();
    const token = randomBytes(32).toString('base64url');
    const record = { version: 1, uuid, status: 'waiting', expiresAt: now() + WECHAT_ACCOUNT_LOGIN_TTL_SEC * 1000 };
    await storeRun(async store => {
      const saved = await store.set(sessionKey(token), JSON.stringify(record), { NX: true, EX: WECHAT_ACCOUNT_LOGIN_TTL_SEC });
      if (saved !== 'OK') throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
      if (SESSION_PATTERN.test(previousToken)) await store.del(sessionKey(previousToken));
    });
    return { token, expiresAt: record.expiresAt };
  }

  async function qr(token) {
    const state = await readSession(token);
    await limit(`${state.key}:qr`, 10);
    const result = await official(`https://login.weixin.qq.com/qrcode/${state.session.uuid}`);
    const contentType = String(result.response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (result.response.status !== 200 || !['image/jpeg', 'image/png'].includes(contentType)) throw invalidOfficialResponse();
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
        if (!location || hop === 3) throw invalidOfficialResponse();
        target = loginTarget(location, target);
        continue;
      }
      if (result.response.status !== 200 || xmlField(result.text, 'ret') !== '0') throw invalidOfficialResponse();
      const redirect = xmlField(result.text, 'redirecturl');
      if (redirect) {
        if (hop === 3) throw invalidOfficialResponse();
        target = loginTarget(redirect, target);
        continue;
      }
      xml = result.text;
      break;
    }
    if (!xml) throw invalidOfficialResponse();
    const uin = xmlField(xml, 'wxuin');
    const sid = xmlField(xml, 'wxsid');
    const skey = xmlField(xml, 'skey');
    const rawTicket = xmlField(xml, 'pass_ticket');
    if (!/^\d{1,16}$/u.test(uin) || !Number.isSafeInteger(Number(uin)) || Number(uin) <= 0 || !sid || !skey || !rawTicket) throw invalidOfficialResponse();
    cookies.set('wxuin', uin);
    cookies.set('wxsid', sid);
    cookies.set('skey', skey);
    let ticket;
    try { ticket = decodeURIComponent(rawTicket); } catch { throw invalidOfficialResponse(); }
    const init = new URL('/cgi-bin/mmwebwx-bin/webwxinit', target.origin);
    init.search = new URLSearchParams({ r: String(~now()), lang: 'zh_CN', pass_ticket: ticket, skey }).toString();
    const result = await official(init.toString(), { method: 'POST', headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '), 'Content-Type': 'application/json;charset=UTF-8', mmweb_appid: 'wx_webfilehelper', Referer: LOGIN_PAGE }, body: JSON.stringify({ BaseRequest: { Uin: Number(uin), Sid: sid, Skey: skey, DeviceID: `e${String(BigInt(`0x${randomBytes(7).toString('hex')}`)).slice(0, 15).padStart(15, '0')}` } }) });
    let data;
    try { data = JSON.parse(result.text); } catch { throw invalidOfficialResponse(); }
    if (result.response.status !== 200 || data?.BaseResponse?.Ret !== 0 || !/^\d{1,16}$/u.test(String(data?.User?.Uin || '')) || BigInt(data.User.Uin) !== BigInt(uin)) throw invalidOfficialResponse();
    return uin;
  }

  async function poll(token) {
    const state = await readSession(token);
    if (state.session.status === 'confirmed') return { status: 'confirmed' };
    if (state.session.status === 'expired') return { status: 'expired' };
    await limit(`${state.key}:poll`, 90);
    const lock = randomBytes(16).toString('hex');
    const locked = await storeRun(store => store.set(`${state.key}:lock`, lock, { NX: true, EX: 90 }));
    if (locked === null) return { status: 'waiting' };
    if (locked !== 'OK') throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    try {
      const params = new URLSearchParams({ loginicon: 'true', uuid: state.session.uuid, tip: state.session.status === 'scanned' ? '1' : '0', appid: 'wx_webfilehelper', _: String(now()) });
      const result = await official(`https://login.wx2.qq.com/cgi-bin/mmwebwx-bin/login?${params}`, {}, 25000);
      if (result.response.status !== 200) throw invalidOfficialResponse();
      const code = Number(result.text.match(/window\.code\s*=\s*(\d+)/u)?.[1]);
      if (![200, 201, 408, 400].includes(code)) throw invalidOfficialResponse();
      const status = code === 200 ? 'confirmed' : code === 201 ? 'scanned' : code === 400 ? 'expired' : state.session.status;
      const uin = code === 200 ? await verifyOfficialIdentity(scriptField(result.text, 'window.redirect_uri')) : '';
      const updated = { ...state.session, status, ...(uin ? { uin } : {}) };
      const ttl = Math.floor((state.session.expiresAt - now()) / 1000);
      if (ttl < 1) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已过期，请重新扫码');
      const saved = await storeRun(store => store.eval(`if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1`, { keys: [state.key], arguments: [state.raw, JSON.stringify(updated), String(ttl)] }));
      if (saved === 0) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已更新，请重新扫码');
      if (saved !== 1) throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
      return { status };
    } finally {
      await storeRun(store => store.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0`, { keys: [`${state.key}:lock`], arguments: [lock] }));
    }
  }

  async function consume(token) {
    const state = await readSession(token);
    if (state.session.status !== 'confirmed' || !/^\d{1,16}$/u.test(state.session.uin || '')) throw new WechatAccountLoginError('WECHAT_LOGIN_UNVERIFIED', '请先完成微信官方扫码确认');
    const consumed = await storeRun(store => store.eval(`if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('DEL', KEYS[1])`, { keys: [state.key], arguments: [state.raw] }));
    if (consumed === 0) throw new WechatAccountLoginError('WECHAT_LOGIN_INVALID', '微信登录会话已使用，请重新扫码');
    if (consumed !== 1) throw new WechatAccountLoginError('WECHAT_LOGIN_STORAGE_UNAVAILABLE', '微信登录存储暂不可用，请稍后重试', 503);
    return state.session.uin;
  }

  return { start, qr, poll, consume };
}
