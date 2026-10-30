const MUSIC_BUSINESS_CODES = new Set([
  'MUSIC_ACCOUNT_INVALID',
  'MUSIC_ACCOUNT_UNAVAILABLE',
  'MUSIC_VERIFICATION_REQUIRED',
  'MUSIC_URL_UNAVAILABLE',
]);

export function isMetingBusinessFailure(code) {
  return MUSIC_BUSINESS_CODES.has(code);
}

/** 上游鉴权属于服务间故障，不能冒充本站用户会话失效 */
export function normalizeMetingFailure(data, upstreamStatus = 0) {
  const rawStatus = Number(upstreamStatus) || 0;
  let code = typeof data?.code === 'string' ? data.code : '';
  let status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 502;
  let error = typeof data?.error === 'string' ? data.error : '音源操作失败，请稍后重试';
  if (code === 'MUSIC_ACCOUNT_INVALID') {
    status = 422;
    error = '账号已无法使用，请重新登录';
  } else if (code === 'MUSIC_VERIFICATION_REQUIRED') {
    status = 422;
    error = '音乐账号需要完成官方验证';
  } else if (code === 'MUSIC_URL_UNAVAILABLE') {
    status = 403;
    error = 'no url';
  } else if (code === 'MUSIC_ACCOUNT_UNAVAILABLE') {
    status = 503;
    error = '音源暂无可用账号，请稍后重试';
  } else if (code === 'OPENMUSIC_AUTH_BUSY') {
    code = 'METING_BUSY';
    status = 503;
    error = '音源授权服务暂时繁忙，请稍后重试';
  } else if (rawStatus === 401 || rawStatus === 403 || code.startsWith('OPENMUSIC_')) {
    code = 'METING_AUTH_FAILED';
    status = 502;
    error = '音源服务授权失败，请联系管理员检查 Meting 授权配置';
  } else if (code === 'UPSTREAM_TIMEOUT') {
    status = 504;
  } else if (!code) {
    code = rawStatus === 400 ? 'METING_INVALID_REQUEST'
      : rawStatus === 404 ? 'METING_RESOURCE_NOT_FOUND'
      : rawStatus === 429 ? 'METING_RATE_LIMITED'
      : rawStatus === 503 ? 'METING_UNAVAILABLE'
      : rawStatus === 504 ? 'UPSTREAM_TIMEOUT'
      : 'METING_OPERATION_FAILED';
  }
  return { ok: false, status, code, error, upstreamStatus: rawStatus };
}
