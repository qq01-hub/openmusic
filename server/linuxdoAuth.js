import { getRuntimeConfig, isLinuxdoConfigured } from './runtimeConfig.js';
import { createOAuthProvider, fetchWithTimeout, sanitizeReturnPath } from './oauthProvider.js';

// Linux.do OAuth2（房主身份绑定 / 找回，后台登录见 adminApi.js 的绑定部分）。
// 具体授权 / 令牌 / 用户信息接口地址由运行时配置提供（LINUXDO_* 环境变量），
// 本模块不写死任何 linux.do 的真实接口地址，需要管理员在拿到 OAuth 应用后自行核实填写。
// 通用的 state 签名/验证、Redis 绑定存取逻辑见 oauthProvider.js。

const BIND_PREFIX = 'openmusic:linuxdo:bind:'; // linuxdoId -> userId
const PROFILE_PREFIX = 'openmusic:linuxdo:profile:'; // userId -> { linuxdoId, username, avatarUrl, boundAt }

export { isLinuxdoConfigured, sanitizeReturnPath };

export function buildLinuxdoAuthorizeUrl(state) {
  const config = getRuntimeConfig();
  const url = new URL(config.linuxdoAuthorizeUrl);
  url.searchParams.set('client_id', config.linuxdoClientId);
  url.searchParams.set('redirect_uri', config.linuxdoRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.linuxdoScope || 'user');
  url.searchParams.set('state', state);
  return url.toString();
}

/** 用授权码换取 access_token（标准 OAuth2 Authorization Code 流程） */
export async function exchangeLinuxdoCode(code) {
  const config = getRuntimeConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: config.linuxdoRedirectUri,
    client_id: config.linuxdoClientId,
    client_secret: config.linuxdoClientSecret,
  });

  const response = await fetchWithTimeout(config.linuxdoTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Linux.do 令牌接口返回 ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }
  const data = await response.json();
  const accessToken = String(data?.access_token || '').trim();
  if (!accessToken) throw new Error('Linux.do 未返回 access_token');
  return accessToken;
}

/**
 * 获取用户信息；字段名未经真实接口验证前做了常见形态的兼容读取
 * （标准 OAuth2 常见 id/sub，Discourse 系常见 username/avatar_template）。
 * 拿到真实响应后如字段不一致，只需要调整这一处。
 */
export async function fetchLinuxdoProfile(accessToken) {
  const config = getRuntimeConfig();
  const response = await fetchWithTimeout(config.linuxdoUserInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Linux.do 用户信息接口返回 ${response.status}`);
  }
  const data = await response.json();
  const id = String(data?.id ?? data?.sub ?? data?.user_id ?? '').trim();
  if (!id) throw new Error('Linux.do 用户信息缺少 id');

  const username = String(data?.username ?? data?.login ?? data?.name ?? '').trim();
  let avatarUrl = String(data?.avatar_url ?? '').trim();
  const avatarTemplate = String(data?.avatar_template ?? '').trim();
  if (!avatarUrl && avatarTemplate) {
    avatarUrl = avatarTemplate.includes('{size}') ? avatarTemplate.replace('{size}', '96') : avatarTemplate;
  }

  return { id, username, avatarUrl };
}

const provider = createOAuthProvider({
  idField: 'linuxdoId',
  bindPrefix: BIND_PREFIX,
  profilePrefix: PROFILE_PREFIX,
  buildAuthorizeUrl: buildLinuxdoAuthorizeUrl,
  exchangeCode: exchangeLinuxdoCode,
  fetchProfile: fetchLinuxdoProfile,
});

export const signLinuxdoState = provider.signState;
export const verifyLinuxdoState = provider.verifyState;
export const bindLinuxdoToUser = provider.bindToUser;
export const getUserIdForLinuxdo = provider.getUserIdFor;
export const getLinuxdoProfileForUser = provider.getProfileForUser;
export const unbindLinuxdoForUser = provider.unbindForUser;
export const clearLinuxdoBindingsForRoom = provider.clearBindingsForRoom;
