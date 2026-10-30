/**
 * 调用 Meting-API 管理接口（扫码登录 / VIP Cookie 绑定 / 一次性漫游）。
 *
 * VIP 不共享：Cookie 仅存 OpenMusic 房间，通过定制接口私有取歌。
 * VIP 共享：加入 Meting Cookie 池（等同后台新增 Cookie），全站可用。
 * 无 VIP：不上传 Meting，Cookie 仅存 OpenMusic 房间，只用于网易漫游。
 *
 * 鉴权：Authorization: Bearer <metingApiAuth>（需与 Meting「API Token」一致）
 */
import { fetchMeting, formatMetingFetchError } from './metingFetch.js';
import { createMetingAssertion } from './metingAssertion.js';
import { getMetingRequestContext } from './metingUpstream.js';
import { getMetingUpstreamBases } from './metingUpstream.js';
import { getRuntimeConfig } from './runtimeConfig.js';
import { normalizeMetingFailure } from './metingError.js';

export const MUSIC_ACCOUNT_PLATFORMS = ['netease', 'tencent', 'kugou', 'qishui'];

export function isMusicAccountPlatform(platform) {
  return MUSIC_ACCOUNT_PLATFORMS.includes(platform);
}

function normalizeMusicAccountPlatform(platform) {
  return isMusicAccountPlatform(platform) ? platform : 'netease';
}

/** 兼容 Meting 管理接口的常见响应包装。 */
export function extractMetingAdminPayload(response) {
  if (response && typeof response === 'object' && response.data !== undefined) {
    return response.data;
  }
  if (response && typeof response === 'object' && response.account !== undefined) {
    return response.account;
  }
  return response;
}

/** 兼容 Cookie 管理接口返回数组、{ cookies } 和多层 data 包装。 */
export function extractMetingCookieList(response) {
  let payload = response;
  for (let i = 0; i < 3; i += 1) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.cookies)) return payload.cookies;
    if (payload.data !== undefined) {
      payload = payload.data;
      continue;
    }
    return [];
  }
  return Array.isArray(payload) ? payload : [];
}

function getAdminEndpoint() {
  const config = getRuntimeConfig();
  const bases = getMetingUpstreamBases();
  const auths = String(config.metingApiAuth || '')
    .split(',')
    .map((s) => s.trim());
  const endpoints = bases.map((base, index) => ({
    base,
    auth: auths.length === 1 ? auths[0] : (auths[index] || ''),
  }));
  return endpoints.find((endpoint) => endpoint.auth) || endpoints[0] || { base: '', auth: '' };
}

async function metingAdminFetch(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  const { base, auth } = getAdminEndpoint();
  if (!base) {
    return { ok: false, status: 503, code: 'METING_NOT_CONFIGURED', error: '未配置 METING_API_URL' };
  }
  if (!auth) {
    return {
      ok: false,
      status: 503,
      code: 'METING_NOT_CONFIGURED',
      error: '未配置 Meting API Token：请在管理后台填写与 Meting「API Token」一致的令牌',
    };
  }

  const url = `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const response = await fetchMeting(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...createMetingAssertion(auth, url, getMetingRequestContext(), { method, body: body === undefined ? '' : JSON.stringify(body) }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      timeoutMs,
    );
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      return {
        ...normalizeMetingFailure(data, response.status),
        data,
      };
    }
    if (data && (data.success === false || data.code === 'MUSIC_ACCOUNT_INVALID')) {
      return { ...normalizeMetingFailure(data, response.status), data };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, status: 502, code: 'METING_INVALID_RESPONSE', error: '音源服务返回了无效响应' };
    }
    return { ok: true, data };
  } catch (err) {
    const timedOut = /timeout|超时/iu.test(formatMetingFetchError(err));
    return { ok: false, status: timedOut ? 504 : 502, code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_REQUEST_FAILED', error: timedOut ? '音源服务请求超时' : '音源服务连接失败' };
  }
}

function userInfoHasVip(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') return false;
  if (userInfo.canPlaySvip === true) return true;
  if (userInfo.canPlayVip === true) return true;
  if (userInfo.canPlayVip === false) return false;
  return Boolean(
    userInfo.isSvip
    || (Number(userInfo.svipType) || 0) > 0
    || userInfo.isVip
    || (Number(userInfo.vipType) || 0) > 0,
  );
}

function userInfoHasSvip(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') return false;
  return Boolean(userInfo.canPlaySvip || userInfo.isSvip || (Number(userInfo.svipType) || 0) > 0);
}

export function toPublicMusicAccount(cookie, extras = {}) {
  if (!cookie || typeof cookie !== 'object') return null;
  const info = cookie.userInfo || {};
  const platform = normalizeMusicAccountPlatform(cookie.platform);
  const hasVip = Boolean(
    extras.hasVip ?? cookie.hasVip ?? userInfoHasVip(info),
  );
  return {
    cookieId: String(cookie.id || cookie.cookieId || extras.cookieId || ''),
    platform,
    shared: hasVip ? Boolean(extras.shared ?? cookie.shared) : false,
    hasVip,
    hasSvip: hasVip && Boolean(extras.hasSvip ?? cookie.hasSvip ?? userInfoHasSvip(info)),
    canSearchSongs: info.canSearchSongs !== false,
    canSearchPlaylists: info.canSearchPlaylists !== false,
    /** vip=搜索/播放；fm=仅网易漫游（不入 Meting） */
    usage: hasVip ? 'vip' : 'fm',
    nickname: String(info.nickname || cookie.nickname || cookie.note || ''),
    providerName: String(cookie.providerName || ''),
    avatarUrl: String(info.avatarUrl || cookie.avatarUrl || ''),
    userId: info.userId != null ? String(info.userId) : String(cookie.userId || ''),
    isValid: cookie.isValid !== false,
    updatedAt: Number(cookie.updatedAt) || Date.now(),
  };
}

export async function createMusicQrSession(platform) {
  if (!isMusicAccountPlatform(platform)) {
    return { ok: false, error: '不支持的音源平台' };
  }
  const result = await metingAdminFetch('/admin/qr/create', {
    method: 'POST',
    body: { platform },
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data || result.data };
}

export async function checkMusicQrSession(payload) {
  const platform = payload?.platform;
  if (!isMusicAccountPlatform(platform)) {
    return { ok: false, error: '不支持的音源平台' };
  }
  const key = String(payload?.key || '').trim();
  const qrsig = String(payload?.qrsig || key).trim();
  if (platform === 'tencent' ? !qrsig : !key) {
    return { ok: false, error: '扫码会话无效，请重新生成二维码' };
  }
  const body =
    platform === 'qishui'
      ? { platform, key }
      : platform === 'tencent'
      ? {
          platform,
          qrsig,
          ptqrtoken: payload.ptqrtoken,
        }
      : { platform, key };
  // QQ 授权换 Cookie 可能较慢，单独加长超时
  const result = await metingAdminFetch('/admin/qr/check', {
    method: 'POST',
    body,
    timeoutMs: 45000,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data || result.data };
}

async function metingAdminAsset(path, timeoutMs = 20000) {
  const { base, auth } = getAdminEndpoint();
  if (!base) return { ok: false, status: 503, code: 'METING_NOT_CONFIGURED', error: '未配置 METING_API_URL' };
  if (!auth) return { ok: false, status: 503, code: 'METING_NOT_CONFIGURED', error: '未配置 Meting API Token' };

  const url = `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const response = await fetchMeting(url, {
      headers: {
        Authorization: `Bearer ${auth}`,
        Accept: '*/*',
        ...createMetingAssertion(auth, url, getMetingRequestContext()),
      },
    }, timeoutMs);
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      let payload;
      try { payload = JSON.parse(body.toString('utf8')); } catch { payload = null; }
      return normalizeMetingFailure(payload, response.status);
    }
    return {
      ok: true,
      body,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
    };
  } catch (err) {
    const timedOut = /timeout|超时/iu.test(formatMetingFetchError(err));
    return { ok: false, status: timedOut ? 504 : 502, code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_REQUEST_FAILED', error: timedOut ? '音源服务请求超时' : '音源服务连接失败' };
  }
}

export async function startQishuiVerification(key) {
  const result = await metingAdminFetch('/admin/qr/qishui/verify/start', {
    method: 'POST',
    body: { key },
    timeoutMs: 45_000,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data || result.data };
}

export async function requestQishuiVerification(key, request) {
  const result = await metingAdminFetch('/admin/qr/qishui/request', {
    method: 'POST',
    body: { key, request },
    timeoutMs: 180_000,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data || result.data };
}

export async function completeQishuiVerification(key) {
  const result = await metingAdminFetch('/admin/qr/qishui/verify/complete', {
    method: 'POST',
    body: { key },
    timeoutMs: 180_000,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data || result.data };
}

export async function fetchQishuiVerificationAsset(name) {
  return metingAdminAsset(`/admin/qr/qishui/security/${encodeURIComponent(String(name || ''))}`, 45_000);
}

export async function validateMusicCookie(platform, cookie) {
  if (!isMusicAccountPlatform(platform)) {
    return { ok: false, error: '不支持的音源平台' };
  }
  const credential = typeof cookie === 'string' ? cookie.trim() : '';
  if (!credential) return { ok: false, error: '登录凭证为空，请重新扫码' };
  const result = await metingAdminFetch('/admin/cookies/validate', {
    method: 'POST',
    body: {
      platform,
      cookie: credential,
    },
  });
  if (!result.ok) return result;
  const payload = result.data?.data || result.data;
  return {
    ok: true,
    data: {
      valid: Boolean(payload?.valid),
      error: payload?.error || '',
      userInfo: payload?.userInfo || null,
      hasVip: userInfoHasVip(payload?.userInfo),
      hasSvip: userInfoHasSvip(payload?.userInfo),
    },
  };
}

/**
 * 扫码成功后绑定：
 * - VIP 共享 → 加入 Meting Cookie 池（全站可用）
 * - VIP 不共享 → 写入 Meting，仅本房间
 * - 无 VIP 网易 → 不上传 Meting，由调用方本地存 Cookie，仅漫游
 * - 无 VIP QQ → 拒绝（无漫游用途）
 */
export async function bindRoomMusicAccount({ roomId, platform, cookie, shared, note, providerName = '' }) {
  if (!isMusicAccountPlatform(platform)) {
    return { ok: false, error: '不支持的音源平台' };
  }
  const plat = platform;
  const validation = await validateMusicCookie(plat, cookie);
  if (!validation.ok) return validation;
  if (!validation.data.valid) {
    return { ok: false, error: validation.data.error || '账号验证失败' };
  }

  const hasVip = validation.data.hasVip;
  const userInfo = validation.data.userInfo;

  if (!hasVip) {
    if (plat === 'tencent') {
      return {
        ok: false,
        error: '账号无vip权限，要不先去开个会员？嘻嘻~',
      };
    }
    // 无 VIP 网易/汽水：不上传 Meting，仅保留房间私有漫游凭证。
    return {
      ok: true,
      localOnly: true,
      cookie,
      data: toPublicMusicAccount(
        {
          id: `local-${String(roomId || '').toUpperCase()}-${plat}`,
          platform: plat,
          shared: false,
          userInfo,
          isValid: true,
          updatedAt: Date.now(),
        },
        { hasVip: false },
      ),
      message: '账号无vip权限，仅作用在漫游',
    };
  }

  if (!shared) {
    // 未共享账号不写入 Meting，并清理该房间在共享池中的账号记录。
    await unbindRoomMusicAccount(roomId, plat);
    return {
      ok: true,
      localOnly: true,
      cookie,
      data: toPublicMusicAccount(
        {
          id: `local-${String(roomId || '').toUpperCase()}-${plat}`,
          platform: plat,
          shared: false,
          userInfo,
          isValid: true,
          updatedAt: Date.now(),
        },
        { hasVip: true, hasSvip: validation.data.hasSvip },
      ),
    };
  }

  const result = await metingAdminFetch('/admin/cookies', {
    method: 'POST',
    body: {
      platform: plat,
      cookie,
      note: note || `房间 ${String(roomId || '').trim().toUpperCase()}`,
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    localOnly: false,
    data: toPublicMusicAccount(extractMetingAdminPayload(result.data), {
      hasVip: true,
      hasSvip: validation.data.hasSvip,
      shared: Boolean(shared),
    }),
    cookie,
    message: result.data?.message || (shared ? '已共享到全站' : '已绑定仅本房间'),
  };
}

/** 一次性漫游：Cookie 不入库 */
export async function fetchEphemeralFmSong(cookie, mode = '', platform = 'netease', excludeIds = []) {
  const plat = normalizeMusicAccountPlatform(platform);
  const result = await metingAdminFetch('/admin/fm', {
    method: 'POST',
    body: { cookie, mode, platform: plat, excludeIds },
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data ?? result.data };
}

export async function fetchRoomMusicAccounts(roomId) {
  const id = String(roomId || '').trim().toUpperCase();
  if (!id) return { ok: false, error: '缺少房间 ID' };
  const result = await metingAdminFetch('/admin/cookies');
  if (!result.ok) return result;
  const roomMarker = '\uFF08' + id + '\uFF09';
  const legacyRoomMarker = '(' + id + ')';
  const accounts = extractMetingCookieList(result.data)
    .filter((cookie) => String(cookie?.note || '').includes(roomMarker)
      || String(cookie?.note || '').includes(legacyRoomMarker))
    .reduce((mapped, cookie) => {
      const platform = normalizeMusicAccountPlatform(cookie?.platform);
      if (!mapped[platform]) mapped[platform] = toPublicMusicAccount(cookie, { shared: true });
      return mapped;
    }, {});
  return {
    ok: true,
    data: {
      netease: accounts.netease || null,
      tencent: accounts.tencent || null,
      kugou: accounts.kugou || null,
      qishui: accounts.qishui || null,
    },
  };
}

async function removeRoomCookieRecords(roomId, platform) {
  const id = String(roomId || '').trim().toUpperCase();
  const plat = normalizeMusicAccountPlatform(platform);
  const result = await metingAdminFetch('/admin/cookies');
  if (!result.ok) return result;
  const roomMarker = '\uFF08' + id + '\uFF09';
  const legacyRoomMarker = '(' + id + ')';
  const records = extractMetingCookieList(result.data).filter((item) => (
    normalizeMusicAccountPlatform(item?.platform) === plat
      && (String(item?.note || '').includes(roomMarker) || String(item?.note || '').includes(legacyRoomMarker))
  ));
  for (const record of records) {
    const path = '/admin/cookies/' + encodeURIComponent(String(record.id || ''));
    const deleted = await metingAdminFetch(path, { method: 'DELETE' });
    if (!deleted.ok && deleted.status !== 404) return deleted;
  }
  return { ok: true };
}

export async function setRoomMusicAccountShared(roomId, platform, shared, cookie = '', note = '') {
  const id = String(roomId || '').trim().toUpperCase();
  const plat = normalizeMusicAccountPlatform(platform);
  if (shared) {
    return bindRoomMusicAccount({
      roomId: id,
      platform: plat,
      cookie,
      shared: true,
      note: note || ('房间：' + id + ' / 提供人：未知'),
    });
  }
  return removeRoomCookieRecords(id, plat);
}

export async function unbindRoomMusicAccount(roomId, platform) {
  return removeRoomCookieRecords(roomId, platform);
}

export async function fetchMusicContributions(limit = 20) {
  const result = await metingAdminFetch(`/admin/contributions?limit=${encodeURIComponent(String(limit))}`);
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data || [] };
}

/** 检查 Meting 当前 Cookie 池是否存在有效 SVIP，包含基础账号和共享账号。 */
export async function hasMetingSvipAccount() {
  const result = await getMetingQualityCapabilities();
  if (!result.ok) return result;
  return { ok: true, hasSvip: result.hasSvip };
}

/**
 * 按平台检查当前 Cookie 池的会员能力。
 * 各平台高级音质均按对应账号实际会员等级判断，汽水只读取 PC 会员接口明确返回的 SVIP 字段。
 */
export async function getMetingQualityCapabilities() {
  const result = await metingAdminFetch('/admin/cookies');
  if (!result.ok) return result;
  const cookies = extractMetingCookieList(result.data);
  const capabilities = {
    neteaseSvip: false,
    tencentSvip: false,
    qishuiVip: false,
    qishuiSvip: false,
  };
  cookies.forEach((cookie) => {
    if (cookie?.isActive === false || cookie?.isValid === false) return false;
    const info = cookie?.userInfo || {};
    const hasSvip = cookie?.platform === 'qishui'
      ? Boolean(info.isSvip || info.canPlaySvip || (Number(info.svipType) || 0) > 0)
      : Boolean(
        info.isSvip
        || info.canPlaySvip
        || (Number(info.svipType) || 0) > 0
        || cookie.hasSvip,
      );
    const hasVip = Boolean(
      cookie.hasVip
      || info.isVip
      || info.canPlayVip
      || info.isSvip
      || info.canPlaySvip
      || (Number(info.vipType) || 0) > 0
      || (Number(info.svipType) || 0) > 0,
    );
    if (cookie?.platform === 'netease' && hasSvip) capabilities.neteaseSvip = true;
    if (cookie?.platform === 'tencent' && hasSvip) capabilities.tencentSvip = true;
    if (cookie?.platform === 'qishui' && hasVip) capabilities.qishuiVip = true;
    if (cookie?.platform === 'qishui' && hasSvip) capabilities.qishuiSvip = true;
  });
  return {
    ok: true,
    hasSvip: capabilities.neteaseSvip || capabilities.tencentSvip,
    ...capabilities,
  };
}

/** 检查 Meting Cookie 池是否存在指定平台的有效会员账号。 */
export async function hasMetingVipAccount(platform) {
  const target = normalizeMusicAccountPlatform(platform);
  const result = await metingAdminFetch('/admin/cookies');
  if (!result.ok) return result;
  const cookies = extractMetingCookieList(result.data);
  const hasVip = cookies.some((cookie) => {
    if (cookie?.platform !== target || cookie?.isActive === false || cookie?.isValid === false) return false;
    const info = cookie?.userInfo || {};
    return Boolean(cookie.hasVip || info.isVip || info.canPlayVip || info.isSvip || info.canPlaySvip || Number(info.vipType) > 0);
  });
  return { ok: true, hasVip };
}

/** 首页贡献会员 Cookie：Meting 端负责验证、VIP 拦截和账号去重更新。 */
export async function contributeMusicAccount(platform, cookie, providerName = '', revokeToken = '') {
  if (!isMusicAccountPlatform(platform)) {
    return { ok: false, error: '不支持的音源平台' };
  }
  const result = await metingAdminFetch('/admin/contribute', {
    method: 'POST',
    body: { platform, cookie, providerName, revokeToken },
    timeoutMs: 45000,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data?.data || result.data,
    updated: Boolean(result.data?.updated),
    message: result.data?.message || '共享成功，谢谢你帮大家点亮更多好歌 ♪',
    revokeToken: String(result.data?.revokeToken || revokeToken || ''),
  };
}

export async function revokeMusicContribution(revokeToken) {
  const token = String(revokeToken || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { ok: false, error: '撤销 ID 无效' };
  const result = await metingAdminFetch('/admin/contributions/revoke', {
    method: 'POST',
    body: { revokeToken: token },
  });
  if (!result.ok) return result;
  return { ok: true, message: result.data?.message || '共享已取消' };
}

/** 服务启动/房间刷新时迁移旧的“未共享房间 Cookie”到 OpenMusic 私有存储。 */
export async function fetchRoomMusicAccountCredentials(roomId) {
  const id = String(roomId || '').trim().toUpperCase();
  if (!id) return { ok: false, error: '缺少房间 ID' };
  const result = await metingAdminFetch(`/admin/room-cookies/${encodeURIComponent(id)}/credentials`);
  if (!result.ok) return result;
  const raw = extractMetingAdminPayload(result.data) || {};
  return {
    ok: true,
    data: Object.fromEntries(
      Object.entries(raw).map(([platform, item]) => [
        platform,
        {
          cookie: String(item?.cookie || ''),
          shared: Boolean(item?.shared),
          account: toPublicMusicAccount(item?.account, {
            hasVip: Boolean(item?.account?.hasVip),
            hasSvip: Boolean(item?.account?.hasSvip),
          }),
        },
      ]),
    ),
  };
}
