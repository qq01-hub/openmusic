import type { AccountProfile } from './accountAuth';
import type { AccountSessionMetadata } from './accountAccessSession';

const DENIAL_CODES = new Set(['ACCOUNT_DEVICE_PROOF_REQUIRED', 'ACCOUNT_DEVICE_PROOF_REPLAY', 'ACCOUNT_AUTH_REQUIRED', 'ACCOUNT_SESSION_INVALID', 'ACCOUNT_REFRESH_INVALID', 'ACCOUNT_REFRESH_REQUIRED', 'ACCOUNT_RISK_BLOCKED']);
export function isExplicitAccountDenial(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    && error.status !== 401 && error.status !== 403) return false;
  return Boolean(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && DENIAL_CODES.has(error.code));
}
export function accountSessionRetryDelay(attempt: number): number {
  return [1500, 3000, 6000, 12000, 15000, 15000][attempt] ?? 30000;
}
export type AccountSessionResponse = { authenticated: boolean; account?: AccountProfile | null; anonymousAllowed?: boolean; refreshAvailable?: boolean; session?: AccountSessionMetadata };
export function assertAccountSessionResponse(value: unknown): asserts value is AccountSessionResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('authenticated' in value) || typeof value.authenticated !== 'boolean'
    || value.authenticated && (!('account' in value) || !value.account || typeof value.account !== 'object' || !('id' in value.account) || typeof value.account.id !== 'string' || !value.account.id
      || !('session' in value) || !isValidSessionMetadata(value.session))) {
    throw Object.assign(new Error('账户服务暂未就绪，请稍后重试'), { code: 'ACCOUNT_SESSION_UNAVAILABLE', status: 503 });
  }
}
export function isValidSessionMetadata(value: unknown): value is AccountSessionMetadata {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return ['expiresAt', 'refreshExpiresAt', 'serverTime'].every(key => Number.isSafeInteger(data[key]) && Number(data[key]) > 0)
    && Number(data.refreshExpiresAt) >= Number(data.expiresAt);
}
