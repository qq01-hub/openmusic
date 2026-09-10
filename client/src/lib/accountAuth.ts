import { fetchWithTimeout } from '../api/http';

export type AccountIdentityProvider = 'email' | 'linuxdo' | 'github' | 'wechat';

export interface AccountIdentity {
  provider: AccountIdentityProvider;
  username: string;
  avatarUrl: string;
  linkedAt: number;
}

export interface AccountProfile {
  id: string;
  email: string | null;
  emailVerifiedAt: number | null;
  hasPassword: boolean;
  identities: AccountIdentity[];
  createdAt: number;
}

export interface AccountProviderStatus {
  linuxdo: boolean;
  github: boolean;
  wechat: boolean;
}

type AccountResponse = { ok?: boolean; account?: AccountProfile; error?: string; code?: string };

async function readAccountResponse(response: Response): Promise<AccountProfile> {
  const data = await response.json().catch(() => ({})) as AccountResponse;
  if (!response.ok || !data.account) {
    const error = new Error(data.error || '账户操作失败') as Error & { code?: string };
    error.code = data.code;
    throw error;
  }
  return data.account;
}

export async function fetchAccountSession(): Promise<AccountProfile | null> {
  const response = await fetchWithTimeout('/api/auth/session', { cache: 'no-store' }, 8000);
  if (!response.ok) throw new Error('账户状态读取失败');
  const data = await response.json().catch(() => ({})) as {
    authenticated?: boolean;
    account?: AccountProfile | null;
  };
  return data.authenticated && data.account ? data.account : null;
}

export async function fetchAccountProviders(): Promise<AccountProviderStatus> {
  const response = await fetchWithTimeout('/api/auth/providers', { cache: 'no-store' }, 8000);
  if (!response.ok) return { linuxdo: false, github: false, wechat: false };
  const data = await response.json().catch(() => ({})) as Partial<AccountProviderStatus>;
  return {
    linuxdo: Boolean(data.linuxdo),
    github: Boolean(data.github),
    wechat: Boolean(data.wechat),
  };
}

export async function requestAccountEmailCode(email: string): Promise<{ resendAfterSec: number }> {
  const response = await fetchWithTimeout('/api/auth/email/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }, 10000);
  const data = await response.json().catch(() => ({})) as { error?: string; resendAfterSec?: number };
  if (!response.ok) throw new Error(data.error || '验证码发送失败');
  return { resendAfterSec: Number(data.resendAfterSec) || 60 };
}

export async function loginAccountWithEmail(email: string, password: string): Promise<AccountProfile> {
  const response = await fetchWithTimeout('/api/auth/email/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, 12000);
  return readAccountResponse(response);
}

export async function registerAccountWithEmail(
  email: string,
  password: string,
  code: string,
): Promise<AccountProfile> {
  const response = await fetchWithTimeout('/api/auth/email/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, code }),
  }, 15000);
  return readAccountResponse(response);
}

export async function logoutAccount(): Promise<void> {
  await fetchWithTimeout('/api/auth/logout', { method: 'POST' }, 8000);
}

export async function unbindAccountIdentity(provider: Exclude<AccountIdentityProvider, 'email'>): Promise<AccountProfile> {
  const response = await fetchWithTimeout(`/api/auth/identities/${provider}/unbind`, {
    method: 'POST',
  }, 10000);
  return readAccountResponse(response);
}

export async function completeWechatAccount(
  action: 'login' | 'bind',
  uin: string,
): Promise<AccountProfile> {
  const response = await fetchWithTimeout('/api/auth/wechat/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, uin }),
  }, 12000);
  return readAccountResponse(response);
}

export function startAccountOAuth(
  provider: 'linuxdo' | 'github',
  action: 'login' | 'bind',
): void {
  const purpose = action === 'bind' ? 'account-bind' : 'account-login';
  const returnPath = window.location.pathname;
  const params = new URLSearchParams({ purpose, returnPath });
  window.location.href = `/api/auth/${provider}/start?${params.toString()}`;
}

const ACCOUNT_AUTH_MESSAGES: Record<string, { message: string; type: 'success' | 'error' }> = {
  linuxdo_logged_in: { message: '已使用 Linux Do 登录', type: 'success' },
  linuxdo_bound: { message: 'Linux Do 已绑定到账户', type: 'success' },
  linuxdo_conflict: { message: '这个 Linux Do 身份已被其他账户绑定', type: 'error' },
  linuxdo_expired: { message: '账户会话已变化，请重新绑定', type: 'error' },
  linuxdo_error: { message: 'Linux Do 登录失败，请稍后重试', type: 'error' },
  github_logged_in: { message: '已使用 GitHub 登录', type: 'success' },
  github_bound: { message: 'GitHub 已绑定到账户', type: 'success' },
  github_conflict: { message: '这个 GitHub 身份已被其他账户绑定', type: 'error' },
  github_expired: { message: '账户会话已变化，请重新绑定', type: 'error' },
  github_error: { message: 'GitHub 登录失败，请稍后重试', type: 'error' },
};

export function consumeAccountAuthReturn(): { message: string; type: 'success' | 'error' } | null {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('account_auth');
  if (!result) return null;
  url.searchParams.delete('account_auth');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return ACCOUNT_AUTH_MESSAGES[result] || { message: '账户操作已完成', type: 'success' };
}
