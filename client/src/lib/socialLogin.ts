import { fetchWithTimeout } from '../api/http';
import { acceptAccountProfile, type AccountProfile } from './accountAuth';

export type SocialProvider = 'wechat_scan' | 'qq_scan';
export const socialProviders = ['wechat_scan', 'qq_scan'] as const;
export const socialLabels: Record<SocialProvider, string> = {
  wechat_scan: '微信扫码登录',
  qq_scan: 'QQ扫码登录',
};
export type SocialStatus = Record<SocialProvider, { enabled: boolean; bound: { username: string; boundAt: number } | null }>;
export const emptySocialStatus: SocialStatus = {
  wechat_scan: { enabled: false, bound: null },
  qq_scan: { enabled: false, bound: null },
};
export type SocialResult = { ok: boolean; account?: AccountProfile };

export async function requestSocialLogin<T>(
  audience: 'account' | 'admin',
  provider: SocialProvider,
  operation: 'start' | 'poll' | 'complete',
  action: 'login' | 'bind',
  signal: AbortSignal,
  flowId?: string,
): Promise<T> {
  const response = await fetchWithTimeout(`/api/${audience === 'admin' ? 'admin' : 'auth'}/social/${provider}/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, flowId }),
    signal,
  }, operation === 'start' ? 25000 : 15000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || '扫码操作失败，请重新获取二维码'), { code: data.code, status: response.status });
  if (audience === 'account' && operation === 'complete' && data.account) acceptAccountProfile(data.account);
  return data as T;
}
