const OPERATIONS = new Set(['url', 'search', 'pic', 'lrc', 'song', 'playlist', 'search_playlist', 'fm', 'source', 'media', 'qr', 'queue', 'rooms', 'favorites', 'wechat', 'api']);
const SOURCES = new Set(['netease', 'tencent', 'qq', 'kugou', 'kuwo', 'migu', 'bilibili', 'qishui']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const REASONS = {
  MUSIC_URL_UNAVAILABLE: ['resource', '没有可用的歌曲地址'],
  COVER_UNAVAILABLE: ['resource', '没有可用的封面'],
  SOURCE_DISABLED: ['configuration', '音源已关闭'],
  METING_NOT_CONFIGURED: ['configuration', 'Meting 服务未配置'],
  METING_CONNECTION_FAILED: ['upstream', '无法连接 Meting 服务'],
  UPSTREAM_UNAVAILABLE: ['upstream', '音源上游暂不可用'],
  LYRIC_UPSTREAM_REDIRECT: ['upstream', '歌词上游返回不支持的重定向'],
  LYRIC_UPSTREAM_INVALID: ['upstream', '歌词上游响应无效'],
  QISHUI_SESSION_INVALID: ['session', '汽水播放会话无效或过期'],
  QISHUI_DECRYPT_FAILED: ['upstream', '汽水解密取链失败'],
  PRIVATE_ADDRESS_DENIED: ['permission', '代理目标为内网地址'],
  ACCOUNT_AUTH_REQUIRED: ['session', '账户未登录'],
  ACCOUNT_IDENTITY_MISMATCH: ['session', '账户身份已变化'],
  ACCOUNT_RATE_LIMITED: ['rate_limit', '账户请求额度已达上限'],
};
const MESSAGES = new Map([
  ['no url', 'MUSIC_URL_UNAVAILABLE'], ['no cover', 'COVER_UNAVAILABLE'],
  ['该音源已关闭', 'SOURCE_DISABLED'], ['网易音源已关闭', 'SOURCE_DISABLED'], ['汽水音源已关闭', 'SOURCE_DISABLED'],
  ['未配置 METING_API_URL', 'METING_NOT_CONFIGURED'],
  ['无法连接 Meting API，请检查 METING_API_URL 配置', 'METING_CONNECTION_FAILED'],
  ['音源上游暂不可用，请稍后重试', 'UPSTREAM_UNAVAILABLE'],
  ['lyric redirect unsupported', 'LYRIC_UPSTREAM_REDIRECT'], ['invalid lyric response', 'LYRIC_UPSTREAM_INVALID'],
  ['汽水播放会话无效或已过期', 'QISHUI_SESSION_INVALID'], ['汽水本地解密取链失败', 'QISHUI_DECRYPT_FAILED'],
  ['禁止访问内网地址', 'PRIVATE_ADDRESS_DENIED'],
]);
const STATUS_REASONS = {
  400: ['input', '请求参数无效'], 401: ['session', '登录或会话失效'], 403: ['permission', '请求被拒绝'],
  404: ['resource', '资源不存在'], 405: ['input', '请求方法不支持'], 408: ['input', '请求超时'],
  409: ['conflict', '业务状态冲突'], 413: ['input', '请求内容过大'], 422: ['input', '请求内容不符合要求'],
  429: ['rate_limit', '请求频率或额度受限'], 500: ['server', '服务端处理失败'],
  502: ['upstream', '上游服务请求失败'], 503: ['unavailable', '服务暂不可用'], 504: ['upstream', '上游服务超时'],
};

export function riskRequestOperation(path, type) {
  if (path === '/api/meting') return OPERATIONS.has(type) ? type : 'api';
  if (path === '/api/qishui-source') return 'source';
  if (path === '/api/media-proxy') return 'media';
  if (/^\/api\/rooms(?:\/|$)/u.test(path)) return 'rooms';
  if (/^\/api\/favorites(?:\/|$)/u.test(path)) return 'favorites';
  if (/^\/(?:wx-proxy|cgi-bin)(?:\/|$)/u.test(path)) return 'wechat';
  return 'api';
}

export function normalizeRiskError(status, context = {}) {
  if (!Number.isInteger(status) || status < 400 || status > 599) return null;
  const knownCode = typeof context.code === 'string' && Object.hasOwn(REASONS, context.code) ? context.code : MESSAGES.get(context.message);
  const code = knownCode || `HTTP_${status}`;
  const [category, label] = knownCode ? REASONS[knownCode] : STATUS_REASONS[status] || (status >= 500 ? ['server', '其他服务端错误'] : ['other', '其他请求错误']);
  return { status, code, category, label,
    operation: OPERATIONS.has(context.operation) ? context.operation : 'api',
    source: SOURCES.has(context.source) ? context.source : '',
    method: METHODS.has(context.method) ? context.method : 'OTHER' };
}
