import { importWechatFileHelperSticker } from './userStickerStore';

export const WX_PROXY_PATH = '/wx-proxy';
const FILEHELPER_CGI_PREFIX = '/cgi-bin';

const FILEHELPER_ORIGIN = 'https://szfilehelper.weixin.qq.com';
const FILEHELPER_NEW_LOGIN_PAGE = `${FILEHELPER_ORIGIN}/cgi-bin/mmwebwx-bin/webwxnewloginpage`;
const WX_WEB_APP_ID = 'wx_webfilehelper';

const STICKER_URL_HINTS = [
  'webwxgetmsgimg',
  'getmsgimg',
  'stodownload',
  'emoji',
  'emotion',
  '/qpic/',
  'tc.qq.com',
  'wx.qq.com',
  'qpic.cn',
];

function decodeStickerXmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeStickerUrl(raw: string): string {
  return decodeStickerXmlText(raw)
    .replace(/\\"/g, '')
    .trim();
}

function isStickerAssetUrl(raw: string): boolean {
  const lower = normalizeStickerUrl(raw).toLowerCase();
  if (!lower || lower.startsWith('data:') || lower.startsWith('blob:')) return false;
  if (lower.includes('.qq.com') || lower.includes('qpic.cn')) return true;
  return STICKER_URL_HINTS.some((hint) => lower.includes(hint));
}

function extractEmojiUrlsFromContent(content: string): string[] {
  const decoded = decodeStickerXmlText(content);
  const urls = new Set<string>();

  const attrPatterns = [
    /cdnurl\s*=\s*\\?"([^"\\]+)\\"?/gi,
    /encrypturl\s*=\s*\\?"([^"\\]+)\\"?/gi,
    /externurl\s*=\s*\\?"([^"\\]+)\\"?/gi,
    /thumburl\s*=\s*\\?"([^"\\]+)\\"?/gi,
  ];

  for (const pattern of attrPatterns) {
    for (const match of decoded.matchAll(pattern)) {
      const url = normalizeStickerUrl(match[1] || '');
      if (url && isStickerAssetUrl(url)) urls.add(url);
    }
  }

  for (const match of decoded.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const url = normalizeStickerUrl(match[0]);
    if (url && isStickerAssetUrl(url)) urls.add(url);
  }

  return [...urls];
}

function extractEmojiMd5FromContent(content: string): string | null {
  const decoded = decodeStickerXmlText(content);
  const match = decoded.match(/md5\s*=\s*\\?"([a-f0-9]{32})\\"?/i);
  return match?.[1]?.toLowerCase() || null;
}

interface WxSyncKeyItem {
  Key: number;
  Val: number;
}

interface WxFileHelperSession {
  uin: string;
  sid: string;
  skey: string;
  passTicket: string;
  /** XML 中的 pass_ticket 原样保留（已单次 URL 编码），用于拼 query */
  passTicketQuery: string;
  apiOrigin: string;
  deviceId: string;
  syncKey: string;
}

let activeSession: WxFileHelperSession | null = null;

function isFileHelperHostname(hostname: string): boolean {
  return hostname === 'szfilehelper.weixin.qq.com';
}

function isAllowedWechatHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return normalized === 'qq.com' || normalized.endsWith('.qq.com');
}

function resolveWechatTargetUrl(raw: string, base: URL): URL {
  const target = new URL(unwrapProxyTargetUrl(raw), base);
  if (target.protocol !== 'https:' || !isAllowedWechatHostname(target.hostname)) {
    throw new Error('微信登录跳转地址不受支持');
  }
  return target;
}

/** 文件传输助手 API 走短路径 /cgi-bin，避免生产环境 nginx 对嵌套 wx-proxy URL 二次解码 */
function fileHelperApiUrl(pathWithQuery: string): string {
  const normalized = pathWithQuery.startsWith('/cgi-bin/')
    ? pathWithQuery
    : pathWithQuery.startsWith('/')
      ? `${FILEHELPER_CGI_PREFIX}${pathWithQuery}`
      : `${FILEHELPER_CGI_PREFIX}/${pathWithQuery}`;
  return `${window.location.origin}${normalized}`;
}

function proxyUrl(target: string): string {
  const trimmed = target.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  const nested = trimmed.match(/\/wx-proxy\/+(https?:\/\/.+)$/i);
  if (nested) {
    try {
      const parsed = new URL(nested[1]);
      if (isFileHelperHostname(parsed.hostname)) {
        return fileHelperApiUrl(`${parsed.pathname}${parsed.search}`);
      }
    } catch {
      /* fall through */
    }
    return `${window.location.origin}${WX_PROXY_PATH}/${nested[1]}`;
  }

  const proxiedOriginPrefix = `${window.location.origin}${WX_PROXY_PATH}/`;
  if (trimmed.startsWith(proxiedOriginPrefix)) {
    return trimmed;
  }
  if (trimmed.startsWith(`${WX_PROXY_PATH}/https://`) || trimmed.startsWith(`${WX_PROXY_PATH}/http://`)) {
    return `${window.location.origin}${trimmed}`;
  }
  if (trimmed.startsWith(`${WX_PROXY_PATH}/`)) {
    return `${window.location.origin}${trimmed}`;
  }
  if (trimmed.startsWith(`${FILEHELPER_CGI_PREFIX}/`)) {
    return trimmed.startsWith('http')
      ? trimmed
      : `${window.location.origin}${trimmed}`;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (isFileHelperHostname(parsed.hostname)) {
        return fileHelperApiUrl(`${parsed.pathname}${parsed.search}`);
      }
    } catch {
      /* fall through */
    }
    return `${window.location.origin}${WX_PROXY_PATH}/${trimmed}`;
  }
  if (trimmed.startsWith('//')) {
    try {
      const parsed = new URL(`https:${trimmed}`);
      if (isFileHelperHostname(parsed.hostname)) {
        return fileHelperApiUrl(`${parsed.pathname}${parsed.search}`);
      }
    } catch {
      /* fall through */
    }
    return `${window.location.origin}${WX_PROXY_PATH}/https:${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    return fileHelperApiUrl(trimmed);
  }
  return fileHelperApiUrl(trimmed.replace(/^\//, ''));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function resolveProxyAssetUrl(raw: string): string {
  return proxyUrl(unwrapProxyTargetUrl(raw));
}

/** 把代理路径还原成真实 https://*.qq.com 地址，避免重复包裹或二次消费错误 URL */
export function unwrapProxyTargetUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return value;

  try {
    if (/%2Fwx-proxy%2F/i.test(value) || value.includes('%3A%2F%2F')) {
      value = decodeURIComponent(value);
    }
  } catch {
    /* ignore */
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    const nestedInFull = value.match(/\/wx-proxy\/+(https?:\/\/.+)$/i);
    if (nestedInFull) return nestedInFull[1];
    return value;
  }

  while (true) {
    if (value.startsWith(`${WX_PROXY_PATH}/https://`) || value.startsWith(`${WX_PROXY_PATH}/http://`)) {
      value = value.slice(`${WX_PROXY_PATH}/`.length);
      continue;
    }
    const nested = value.match(/\/wx-proxy\/+(https?:\/\/.+)$/i);
    if (!nested) break;
    value = nested[1];
  }

  return value;
}

function collectAccessibleDocuments(root: Document | null | undefined): Document[] {
  if (!root) return [];
  const docs: Document[] = [root];
  root.querySelectorAll('iframe').forEach((frame) => {
    try {
      const child = frame.contentDocument;
      if (child) docs.push(...collectAccessibleDocuments(child));
    } catch {
      /* 跨域 iframe 无法读取 */
    }
  });
  return docs;
}

function readImgSrc(img: HTMLImageElement): string {
  return img.getAttribute('src')
    || img.getAttribute('data-src')
    || img.currentSrc
    || img.src
    || '';
}

function readBackgroundUrl(el: Element): string | null {
  const inline = el.getAttribute('style') || '';
  const match = inline.match(/url\(["']?([^"')]+)["']?\)/i);
  if (match?.[1]) return match[1];
  try {
    const bg = getComputedStyle(el).backgroundImage;
    const bgMatch = bg.match(/url\(["']?([^"')]+)["']?\)/i);
    return bgMatch?.[1] || null;
  } catch {
    return null;
  }
}

function wxApiHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    mmweb_appid: WX_WEB_APP_ID,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  if (json) {
    headers['Content-Type'] = 'application/json;charset=UTF-8';
  }
  return headers;
}

function wxFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...wxApiHeaders(),
      ...(init.headers || {}),
    },
  });
}

function parseWxLoginCode(text: string): number | null {
  const match = text.match(/window\.code\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

/** 官方登录页必须带 fun=new&version=v2，且 ticket 中的 @ 需要正确编码 */
function buildLoginPageTargetUrl(redirectUri: string): URL {
  const source = resolveWechatTargetUrl(redirectUri, new URL(FILEHELPER_ORIGIN));
  const url = new URL(source.toString());

  source.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  if (!url.searchParams.has('fun')) url.searchParams.set('fun', 'new');
  if (!url.searchParams.has('version')) url.searchParams.set('version', 'v2');
  if (!url.searchParams.has('lang')) url.searchParams.set('lang', 'zh_CN');

  return url;
}

function parseXmlField(xml: string, tag: string): string {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
  const plain = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = xml.match(cdata) || xml.match(plain);
  if (!match?.[1]) return '';
  const value = match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 保留 XML 字段原始文本（pass_ticket 在 XML 里通常已单次编码，勿再 decode） */
function parseXmlFieldRaw(xml: string, tag: string): string {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
  const plain = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = xml.match(cdata) || xml.match(plain);
  return match?.[1]
    ?.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    || '';
}

function createDeviceId(): string {
  return `e${Math.floor(Math.random() * 1e15)}`;
}

function formatSyncKey(syncKey?: { List?: WxSyncKeyItem[] }): string {
  if (!syncKey?.List?.length) return '';
  return syncKey.List.map((item) => `${item.Key}_${item.Val}`).join('|');
}

function parseSyncKeyString(syncKey: string): { Count: number; List: WxSyncKeyItem[] } {
  const list = syncKey
    .split('|')
    .filter(Boolean)
    .map((pair) => {
      const [key, val] = pair.split('_');
      return { Key: Number(key), Val: Number(val) };
    })
    .filter((item) => Number.isFinite(item.Key) && Number.isFinite(item.Val));

  return { Count: list.length, List: list };
}

function buildBaseRequest(session: WxFileHelperSession) {
  return {
    Uin: Number(session.uin),
    Sid: session.sid,
    Skey: session.skey,
    DeviceID: session.deviceId,
  };
}

function buildWebwxInitUrl(session: WxFileHelperSession): string {
  const r = ~Date.now();
  const params = [
    `r=${r}`,
    'lang=zh_CN',
    `pass_ticket=${session.passTicketQuery}`,
    `skey=${encodeURIComponent(session.skey)}`,
  ].join('&');
  return session.apiOrigin === FILEHELPER_ORIGIN
    ? fileHelperApiUrl(`/mmwebwx-bin/webwxinit?${params}`)
    : resolveProxyAssetUrl(`${session.apiOrigin}/cgi-bin/mmwebwx-bin/webwxinit?${params}`);
}

const MAX_LOGIN_REDIRECTS = 3;

async function establishWechatFileHelperSession(redirectUri: string): Promise<WxFileHelperSession> {
  let targetUrl = buildLoginPageTargetUrl(redirectUri);
  let xml = '';

  for (let redirectCount = 0; redirectCount <= MAX_LOGIN_REDIRECTS; redirectCount += 1) {
    const loginResp = await wxFetch(resolveProxyAssetUrl(targetUrl.toString()), {
      method: 'GET',
      redirect: 'manual',
    });

    if (loginResp.status >= 300 && loginResp.status < 400) {
      const location = loginResp.headers.get('Location') || '';
      if (!location || redirectCount >= MAX_LOGIN_REDIRECTS) {
        throw new Error('webwxnewloginpage 重定向次数过多或缺少目标地址');
      }
      targetUrl = resolveWechatTargetUrl(location, targetUrl);
      continue;
    }

    if (!loginResp.ok) {
      throw new Error(`webwxnewloginpage 请求失败 (${loginResp.status})`);
    }

    xml = await loginResp.text();
    if (!xml.trim()) {
      throw new Error('webwxnewloginpage 返回空响应');
    }

    const ret = parseXmlField(xml, 'ret');
    if (ret && ret !== '0') {
      throw new Error(`webwxnewloginpage 返回错误 (${ret || 'unknown'})`);
    }

    const xmlRedirect = parseXmlField(xml, 'redirecturl');
    if (xmlRedirect) {
      if (redirectCount >= MAX_LOGIN_REDIRECTS) {
        throw new Error('webwxnewloginpage XML 重定向次数过多');
      }
      targetUrl = buildLoginPageTargetUrl(xmlRedirect);
      continue;
    }

    break;
  }

  const passTicketQuery = parseXmlFieldRaw(xml, 'pass_ticket');
  const session: WxFileHelperSession = {
    uin: parseXmlField(xml, 'wxuin'),
    sid: parseXmlField(xml, 'wxsid'),
    skey: parseXmlField(xml, 'skey'),
    passTicket: parseXmlField(xml, 'pass_ticket'),
    passTicketQuery,
    apiOrigin: targetUrl.origin,
    deviceId: createDeviceId(),
    syncKey: '',
  };

  if (!session.uin || !session.sid || !session.skey || !session.passTicketQuery) {
    throw new Error('未解析到完整登录会话（微信未返回必要凭据）');
  }

  const initUrl = buildWebwxInitUrl(session);

  const initResp = await wxFetch(initUrl, {
    method: 'POST',
    headers: wxApiHeaders(true),
    body: JSON.stringify({ BaseRequest: buildBaseRequest(session) }),
  });

  if (!initResp.ok) {
    throw new Error(`webwxinit 请求失败 (${initResp.status})`);
  }

  const initText = await initResp.text();
  if (!initText.trim()) {
    throw new Error('webwxinit 返回空响应');
  }

  let initJson: { SyncKey?: { List?: WxSyncKeyItem[] }; BaseResponse?: { Ret?: number } };
  try {
    initJson = JSON.parse(initText) as typeof initJson;
  } catch {
    throw new Error('webwxinit 响应不是 JSON');
  }

  if (initJson.BaseResponse?.Ret && initJson.BaseResponse.Ret !== 0) {
    const ret = initJson.BaseResponse.Ret;
    if (ret === 1101) {
      throw new Error('登录凭证无效或已过期，请关闭弹窗后重新扫码');
    }
    throw new Error(`webwxinit 返回错误 (${ret})`);
  }

  session.syncKey = formatSyncKey(initJson.SyncKey);
  if (!session.syncKey) {
    throw new Error('webwxinit 未返回 SyncKey');
  }

  activeSession = session;
  return session;
}

function rankEmojiDownloadUrls(urls: string[]): string[] {
  const score = (url: string) => {
    if (url.includes('/20401/')) return 0;
    if (url.includes('/20402/')) return 2;
    if (url.includes('encrypturl')) return 4;
    if (url.includes('thumburl')) return 5;
    return 1;
  };
  return [...new Set(urls.map((url) => normalizeStickerUrl(url)).filter(Boolean))]
    .sort((a, b) => score(a) - score(b));
}

interface WxSyncMessage {
  MsgType?: number;
  Content?: string;
  NewMsgId?: number | string;
  MsgId?: number | string;
  ToUserName?: string;
  ImgStatus?: number;
  HasProductId?: number;
}

export const WECHAT_UNSUPPORTED_STICKER_TIP = '该类型暂不支持，请在手机上查看';

function isFileHelperInboundMessage(msg: WxSyncMessage): boolean {
  return msg.ToUserName === 'filehelper';
}

function isUnsupportedStickerMessage(msg: WxSyncMessage): boolean {
  if (!isFileHelperInboundMessage(msg)) return false;

  const content = typeof msg.Content === 'string' ? msg.Content.trim() : '';
  if (content.includes('该类型暂不支持')) return true;

  // 网页端无法解析的特殊表情：文本占位 + 图片元数据
  if (msg.MsgType === 1 && msg.ImgStatus === 2 && msg.HasProductId === 1) {
    return true;
  }

  return false;
}

function extractUnsupportedStickerKeysFromPayload(payload: unknown): string[] {
  const record = payload as {
    AddMsgList?: WxSyncMessage[];
    MsgList?: WxSyncMessage[];
  };
  const keys: string[] = [];
  const msgLists = [
    ...(Array.isArray(record?.AddMsgList) ? record.AddMsgList : []),
    ...(Array.isArray(record?.MsgList) ? record.MsgList : []),
  ];

  for (const msg of msgLists) {
    if (!isUnsupportedStickerMessage(msg)) continue;
    const msgId = msg.NewMsgId ?? msg.MsgId;
    if (!msgId) continue;
    keys.push(`unsupported:msg:${msgId}`);
  }

  return keys;
}

function extractStickerDedupeKeysFromPayload(payload: unknown): Array<{ key: string; urls: string[] }> {
  const record = payload as {
    AddMsgList?: WxSyncMessage[];
    MsgList?: WxSyncMessage[];
  };
  const items: Array<{ key: string; urls: string[] }> = [];
  const msgLists = [
    ...(Array.isArray(record?.AddMsgList) ? record.AddMsgList : []),
    ...(Array.isArray(record?.MsgList) ? record.MsgList : []),
  ];

  for (const msg of msgLists) {
    if (!isFileHelperInboundMessage(msg)) continue;
    if (isUnsupportedStickerMessage(msg)) continue;
    if (msg?.MsgType !== 47 || typeof msg.Content !== 'string') continue;
    const urls = rankEmojiDownloadUrls(extractEmojiUrlsFromContent(msg.Content));
    if (urls.length === 0) continue;
    const md5 = extractEmojiMd5FromContent(msg.Content);
    const preferred = urls[0];
    const msgId = msg.NewMsgId ?? msg.MsgId;
    const key = md5
      ? `md5:${md5}`
      : msgId
        ? `msg:${msgId}`
        : preferred;
    items.push({ key, urls });
  }

  return items;
}

interface WxSyncResult {
  stickers: Array<{ key: string; urls: string[] }>;
  unsupportedKeys: string[];
}

async function syncWechatMessages(session: WxFileHelperSession): Promise<WxSyncResult> {
  const syncPath = `/mmwebwx-bin/webwxsync?sid=${encodeURIComponent(session.sid)}&skey=${encodeURIComponent(session.skey)}&pass_ticket=${session.passTicketQuery}`;
  const syncUrl = session.apiOrigin === FILEHELPER_ORIGIN
    ? fileHelperApiUrl(syncPath)
    : resolveProxyAssetUrl(`${session.apiOrigin}/cgi-bin${syncPath}`);

  const resp = await wxFetch(syncUrl, {
    method: 'POST',
    headers: wxApiHeaders(true),
    body: JSON.stringify({
      BaseRequest: buildBaseRequest(session),
      SyncKey: parseSyncKeyString(session.syncKey),
      rr: -1,
    }),
  });

  if (!resp.ok) return { stickers: [], unsupportedKeys: [] };

  const text = await resp.text();
  let data: { SyncKey?: { List?: WxSyncKeyItem[] }; AddMsgList?: unknown[]; MsgList?: unknown[] };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return { stickers: [], unsupportedKeys: [] };
  }

  const nextSyncKey = formatSyncKey(data.SyncKey);
  if (nextSyncKey) session.syncKey = nextSyncKey;

  return {
    stickers: extractStickerDedupeKeysFromPayload(data),
    unsupportedKeys: extractUnsupportedStickerKeysFromPayload(data),
  };
}

export function hasWechatFileHelperSession(): boolean {
  return activeSession !== null;
}

/** 返回当前文件传输助手会话的 wxuin；仅用于完成一次绑定请求。 */
export function getWechatFileHelperUin(): string | null {
  return activeSession?.uin || null;
}

const WX_BROWSER_COOKIE_NAMES = [
  'wxuin', 'wxsid', 'wxloadtime', 'mm_lang', 'skey',
  'webwxuvid', 'webwx_data_ticket', 'webwx_auth_ticket',
];

/** 清除浏览器里残留的微信登录 Cookie，避免与新一轮扫码会话冲突 */
export function clearWechatBrowserCookies(): void {
  if (typeof document === 'undefined') return;
  for (const name of WX_BROWSER_COOKIE_NAMES) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

export function clearWechatFileHelperSession(): void {
  activeSession = null;
  clearWechatBrowserCookies();
}

export function describeWechatFileHelperSession(): string {
  if (!activeSession) return 'session=null';
  return `uin=${activeSession.uin} sid=${activeSession.sid.slice(0, 6)}... syncKey=${activeSession.syncKey.slice(0, 24)}...`;
}

export type ScanResult = { imported: number; skipped: number; stickerIds: string[]; unsupported: number };

export type LoginPollResult =
  | 'waiting'
  | 'scanned'
  | 'expired'
  | { ok: true; redirectUri: string };

function parseScriptField(text: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escaped}\\s*=\\s*"([^"]+)"`));
  return match?.[1] ?? null;
}

/** 调用 jslogin 获取扫码 uuid */
export async function fetchWechatLoginUuid(): Promise<string> {
  const redirectUri = encodeURIComponent(encodeURIComponent(FILEHELPER_NEW_LOGIN_PAGE));
  const url = proxyUrl(`https://login.wx2.qq.com/jslogin?appid=${WX_WEB_APP_ID}&redirect_uri=${redirectUri}&fun=new&lang=zh_CN&_=${Date.now()}`);
  const resp = await wxFetch(url);
  if (!resp.ok) throw new Error('jslogin 请求失败');
  const text = await resp.text();
  if (!text.includes('window.QRLogin.code = 200')) throw new Error('jslogin 未返回有效 uuid');
  const uuid = parseScriptField(text, 'window.QRLogin.uuid');
  if (!uuid) throw new Error('未解析到登录 uuid');
  return uuid;
}

/** 拼接二维码图片地址 */
export function buildWechatLoginQrImageUrl(uuid: string): string {
  return proxyUrl(`https://login.weixin.qq.com/qrcode/${uuid}`);
}

/** 轮询扫码状态（tip=0 等待扫码，tip=1 等待手机确认） */
export async function pollWechatLogin(uuid: string, tip: 0 | 1 = 0): Promise<LoginPollResult> {
  const url = proxyUrl(`https://login.wx2.qq.com/cgi-bin/mmwebwx-bin/login?loginicon=true&uuid=${encodeURIComponent(uuid)}&tip=${tip}&appid=${WX_WEB_APP_ID}&_=${Date.now()}`);
  const resp = await wxFetch(url);
  if (!resp.ok) return 'waiting';
  const text = await resp.text();
  const code = parseWxLoginCode(text);
  if (code === 408) return 'expired';
  if (code === 201) return 'scanned';
  if (code === 200) {
    const raw = parseScriptField(text, 'window.redirect_uri');
    if (raw) {
      const decoded = (() => {
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      })();
      return { ok: true, redirectUri: unwrapProxyTargetUrl(decoded) };
    }
  }
  return 'waiting';
}

/** 按官方流程建立会话：webwxnewloginpage → webwxinit */
export async function bootstrapWechatFileHelperSession(
  _iframe: HTMLIFrameElement | null,
  redirectUri: string,
): Promise<void> {
  await establishWechatFileHelperSession(redirectUri);
}

function isFileHelperLoadingPage(doc: Document): boolean {
  for (const accessible of collectAccessibleDocuments(doc)) {
    const bodyText = accessible.body?.textContent || '';
    if (bodyText.includes('正在打开')) return true;
  }
  return false;
}

function isFileHelperLandingPage(doc: Document): boolean {
  for (const accessible of collectAccessibleDocuments(doc)) {
    const bodyText = accessible.body?.textContent || '';
    if (bodyText.includes('使用手机微信扫码传输文件')) return true;
    if (bodyText.includes('微信文件传输助手网页版使用手机微信扫码')) return true;
    const loginPanel = accessible.querySelector('.login-scan__panel, .loginpage') as HTMLElement | null;
    if (loginPanel?.offsetParent !== null) return true;
  }
  return false;
}

export function getFileHelperLoginQrUrl(doc: Document): string | null {
  for (const accessible of collectAccessibleDocuments(doc)) {
    const img = accessible.querySelector('.qrcode-img') as HTMLImageElement | null;
    if (!img) continue;
    const raw = readImgSrc(img);
    if (!raw || raw.includes('placeholder')) continue;
    if (!raw.includes('login.weixin.qq.com') && !raw.includes('/qrcode/') && !raw.includes('/wx-proxy/')) {
      continue;
    }
    return resolveProxyAssetUrl(raw);
  }
  return null;
}

export function isFileHelperLoggedIn(doc: Document): boolean {
  if (hasWechatFileHelperSession()) return true;
  if (isFileHelperLoadingPage(doc)) return false;
  if (isFileHelperLandingPage(doc)) return false;
  if (getFileHelperLoginQrUrl(doc)) return false;

  for (const accessible of collectAccessibleDocuments(doc)) {
    const qr = accessible.querySelector('.qrcode-img') as HTMLElement | null;
    if (qr?.offsetParent !== null) return false;
  }

  for (const accessible of collectAccessibleDocuments(doc)) {
    if (accessible.querySelector('.chat-panel__input, .chat-panel__input-send')) return true;
    if (accessible.querySelector('.chat-panel__body, .msg-list')) return true;
    if (accessible.querySelector('.chat-panel')) return true;
    if (accessible.querySelector('img[src*="icon__loginout"], img[src*="icon__file"]')) return true;
    if (accessible.querySelector('.msg-item, .msg-emotion, .msg-image')) return true;
  }

  return false;
}

export function describeFileHelperDocument(doc: Document | null | undefined): string {
  if (hasWechatFileHelperSession()) return describeWechatFileHelperSession();
  if (!doc) return 'doc=null';

  const title = (doc.title || '').trim() || '(no-title)';
  let href = '';
  try {
    href = doc.location?.href || '';
  } catch {
    href = '(location-inaccessible)';
  }

  const bodyText = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `title=${title} href=${href || '(empty)'} text=${bodyText || '(empty)'}`;
}

function collectStickerUrls(doc: Document): string[] {
  const urls = new Set<string>();

  for (const accessible of collectAccessibleDocuments(doc)) {
    accessible.querySelectorAll('.msg-emotion img, .msg-item__content img, .msg-image img').forEach((node) => {
      const raw = readImgSrc(node as HTMLImageElement);
      if (raw) urls.add(raw);
    });

    accessible.querySelectorAll('.msg-emotion, .msg-image').forEach((node) => {
      const bg = readBackgroundUrl(node);
      if (bg) urls.add(bg);
    });
  }

  return [...urls].filter(isStickerAssetUrl);
}

async function importStickerFromUrls(urls: string[]): Promise<ScanResult> {
  for (const raw of urls) {
    const abs = resolveProxyAssetUrl(raw);
    try {
      const resp = await fetch(abs, { credentials: 'include' });
      if (!resp.ok) continue;
      const blob = await resp.blob();
      if (!blob.size) continue;
      const dataUrl = await blobToDataUrl(blob);
      const result = await importWechatFileHelperSticker(abs, dataUrl);
      if (result.imported > 0 || result.skipped > 0) {
        return {
          imported: result.imported,
          skipped: result.skipped,
          stickerIds: result.stickerId ? [result.stickerId] : [],
          unsupported: 0,
        };
      }
    } catch {
      /* 尝试下一个候选 URL */
    }
  }
  return { imported: 0, skipped: 0, stickerIds: [], unsupported: 0 };
}

async function importStickerUrl(raw: string): Promise<ScanResult> {
  return importStickerFromUrls([raw]);
}

export async function scanFileHelperDocument(
  doc: Document,
  seen: Set<string>,
): Promise<ScanResult> {
  let imported = 0;
  let skipped = 0;
  let unsupported = 0;
  const stickerIds: string[] = [];

  for (const raw of collectStickerUrls(doc)) {
    if (seen.has(raw)) continue;
    seen.add(raw);

    try {
      const result = await importStickerUrl(raw);
      imported += result.imported;
      skipped += result.skipped;
      unsupported += result.unsupported;
      stickerIds.push(...result.stickerIds);
    } catch {
      /* 单张失败不影响其它 */
    }
  }

  return { imported, skipped, stickerIds, unsupported };
}

async function scanFileHelperViaApi(
  session: WxFileHelperSession,
  seen: Set<string>,
): Promise<ScanResult> {
  let imported = 0;
  let skipped = 0;
  let unsupported = 0;
  const stickerIds: string[] = [];

  const { stickers, unsupportedKeys } = await syncWechatMessages(session);

  for (const key of unsupportedKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    unsupported += 1;
  }

  for (const { key, urls } of stickers) {
    if (seen.has(key)) continue;

    try {
      const result = await importStickerFromUrls(urls);
      if (result.imported > 0 || result.skipped > 0) {
        seen.add(key);
      }
      imported += result.imported;
      skipped += result.skipped;
      stickerIds.push(...result.stickerIds);
    } catch {
      /* 单张失败不影响其它 */
    }
  }

  return { imported, skipped, stickerIds, unsupported };
}

export function startFileHelperScanner(
  getDocument: () => Document | null | undefined,
  onScan?: (result: ScanResult) => void,
) {
  const seen = new Set<string>();
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      let result: ScanResult = { imported: 0, skipped: 0, stickerIds: [], unsupported: 0 };
      if (activeSession) {
        result = await scanFileHelperViaApi(activeSession, seen);
      } else {
        const doc = getDocument();
        if (doc) result = await scanFileHelperDocument(doc, seen);
      }
      if ((result.imported > 0 || result.skipped > 0 || result.unsupported > 0) && onScan) onScan(result);
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(() => { void tick(); }, 1500);
  void tick();

  return () => {
    window.clearInterval(timer);
  };
}
