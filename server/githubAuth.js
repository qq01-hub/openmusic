import { getRuntimeConfig, isGithubConfigured } from './runtimeConfig.js';
import { createOAuthProvider, fetchOAuthJson, sanitizeReturnPath, oauthUpstreamError } from './oauthProvider.js';

// GitHub OAuth2（房主身份绑定 / 找回，后台登录见 adminApi.js 的绑定部分）。
// GitHub 的授权 / 令牌 / 用户信息接口是公开且长期稳定的固定地址，直接写死；
// 只有 client_id / client_secret / 回调地址需要管理员去
// https://github.com/settings/developers 注册 OAuth App 后自行配置。
// 通用的 state 签名/验证、Redis 绑定存取逻辑见 oauthProvider.js。

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USERINFO_URL = 'https://api.github.com/user';

const BIND_PREFIX = 'openmusic:github:bind:'; // githubId -> userId
const PROFILE_PREFIX = 'openmusic:github:profile:'; // userId -> { githubId, username, avatarUrl, boundAt }

export { isGithubConfigured, sanitizeReturnPath as sanitizeGithubReturnPath };

export function buildGithubAuthorizeUrl(state) {
  const config = getRuntimeConfig();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', config.githubRedirectUri);
  url.searchParams.set('scope', config.githubScope || 'read:user');
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

export async function exchangeGithubCode(code) {
  const config = getRuntimeConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: config.githubRedirectUri,
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
  });

  const data = await fetchOAuthJson(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'OpenMusic',
    },
    body: body.toString(),
  });
  const accessToken = String(data?.access_token || '').trim();
  if (!accessToken) throw oauthUpstreamError(200, data?.error || 'OAUTH_RESPONSE_INVALID');
  return accessToken;
}

export async function fetchGithubProfile(accessToken) {
  const data = await fetchOAuthJson(USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OpenMusic',
    },
  });
  const id = String(data?.id ?? '').trim();
  if (!id) throw oauthUpstreamError(200, 'OAUTH_RESPONSE_INVALID');

  return {
    id,
    username: String(data?.login ?? '').trim(),
    avatarUrl: String(data?.avatar_url ?? '').trim(),
  };
}

const provider = createOAuthProvider({
  idField: 'githubId',
  bindPrefix: BIND_PREFIX,
  profilePrefix: PROFILE_PREFIX,
  buildAuthorizeUrl: buildGithubAuthorizeUrl,
  exchangeCode: exchangeGithubCode,
  fetchProfile: fetchGithubProfile,
});

export const signGithubState = provider.signState;
export const verifyGithubState = provider.verifyState;
export const bindGithubToUser = provider.bindToUser;
export const getUserIdForGithub = provider.getUserIdFor;
export const getGithubProfileForUser = provider.getProfileForUser;
export const unbindGithubForUser = provider.unbindForUser;
export const clearGithubBindingsForRoom = provider.clearBindingsForRoom;
