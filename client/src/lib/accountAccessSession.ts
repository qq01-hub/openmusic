import { assertDeviceSession, createDeviceProof, setDeviceSession } from './deviceProof';
import { assertAccountSessionResponse, isExplicitAccountDenial, isValidSessionMetadata } from './accountSessionRecovery';
import { ACCOUNT_SESSION_REVISION_KEY, announceAccountTokenRefreshed, isAccountSessionRevisionEvent } from './accountSessionSignal';

export type AccountSessionMetadata = { sessionId?: string; deviceKeyId?: string | null; deviceMigrationRequired?: boolean; expiresAt: number; refreshExpiresAt: number; serverTime: number };

let accessDeadline = 0;
let refreshDeadline = 0;
let refreshPromise: Promise<boolean> | null = null;
let generation = 0;
let refreshAllowed = true;
let anonymousAccess = false;
let sessionTask: Promise<unknown> = Promise.resolve();

export function hasAnonymousAccess(): boolean {
  return anonymousAccess;
}

export function hasVerifiedAccountSession(): boolean {
  return anonymousAccess || (accessDeadline > Date.now() + 60_000);
}

export function setAnonymousAccess(allowed: boolean): void {
  anonymousAccess = allowed;
}

export function getAccountSessionGeneration(): string {
  let revision = '';
  try { revision = localStorage.getItem(ACCOUNT_SESSION_REVISION_KEY) || ''; } catch {}
  return `${generation}:${revision}`;
}

export function runAccountSessionTask<Result>(task: () => Promise<Result>): Promise<Result> {
  const run = async (): Promise<Result> => typeof navigator !== 'undefined' && navigator.locks
    ? await navigator.locks.request('openmusic:account-session', async () => await task())
    : await task();
  const pending = sessionTask.then(run, run);
  sessionTask = pending.catch(() => undefined);
  return pending;
}

export function updateAccountAccess(session: AccountSessionMetadata | null | undefined, refreshAvailable = false): void {
  if (!session || !Number.isFinite(session.expiresAt) || !Number.isFinite(session.refreshExpiresAt) || !Number.isFinite(session.serverTime)) {
    accessDeadline = 0;
    refreshDeadline = 0;
    refreshAllowed = refreshAvailable;
    return;
  }
  setDeviceSession(session.sessionId || '', session.serverTime);
  anonymousAccess = false;
  accessDeadline = Date.now() + session.expiresAt - session.serverTime;
  refreshDeadline = Date.now() + session.refreshExpiresAt - session.serverTime;
  refreshAllowed = true;
}

export function forgetAccountAccess(): void {
  generation += 1;
  anonymousAccess = false;
  updateAccountAccess(null);
}

export async function waitForAccountRefresh(): Promise<void> {
  if (refreshPromise) await refreshPromise.catch(() => false);
}

// 调用方持有账户任务锁时也可使用，不嵌套获取同一把锁
export async function migrateAccountDevice(signal?: AbortSignal): Promise<AccountSessionMetadata> {
  const revision = getAccountSessionGeneration();
  const response = await fetch('/api/auth/device-migrate', {
    method: 'POST', credentials: 'include', cache: 'no-store', signal,
    headers: { 'X-OpenMusic-Request': '1', 'X-OpenMusic-Device': await createDeviceProof('POST', '/api/auth/device-migrate', '', true) },
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; session?: AccountSessionMetadata; code?: string; error?: string };
  if (revision !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新操作');
  if (!response.ok || !data.ok || !isValidSessionMetadata(data.session)) {
    throw Object.assign(new Error(data.error || '账户设备升级暂不可用，请稍后重试'), { code: data.code, status: response.status });
  }
  await assertDeviceSession(data.session.deviceKeyId);
  if (revision !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新操作');
  return data.session;
}

export function refreshAccountAccess(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  if (!refreshAllowed) return Promise.resolve(false);
  const currentGeneration = getAccountSessionGeneration();
  const request = async () => {
    if (currentGeneration !== getAccountSessionGeneration() || !refreshAllowed) return false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      if (typeof navigator !== 'undefined' && navigator.locks) {
        const current = await fetch('/api/auth/session', {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        const state = await current.json().catch(() => ({})) as { authenticated?: boolean; session?: AccountSessionMetadata; code?: string };
        if (current.ok) assertAccountSessionResponse(state);
        if (currentGeneration !== getAccountSessionGeneration()) return false;
        if (current.ok && state.authenticated && state.session?.deviceMigrationRequired) {
          state.session = await migrateAccountDevice(controller.signal);
          if (currentGeneration !== getAccountSessionGeneration()) return false;
        }
        if (current.ok && state.authenticated && state.session && state.session.expiresAt - state.session.serverTime > 15 * 60_000) {
          await assertDeviceSession(state.session.deviceKeyId);
          updateAccountAccess(state.session);
          announceAccountTokenRefreshed();
          return true;
        }
        if (!current.ok && !(current.status === 401 && isExplicitAccountDenial(state))) throw new Error('账户状态读取失败，请稍后重试');
      }
      const renew = async () => fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'X-OpenMusic-Request': '1', 'X-OpenMusic-Device': await createDeviceProof('POST', '/api/auth/refresh') }, signal: controller.signal,
      });
      const response = await renew();
      const data = await response.json().catch(() => ({})) as { ok?: boolean; session?: AccountSessionMetadata; error?: string; code?: string };
      if (currentGeneration !== getAccountSessionGeneration()) return false;
      if (response.status === 401 && data.code === 'ACCOUNT_DEVICE_PROOF_REQUIRED') {
        // 旧访问令牌过期时，仍可用当前有效的刷新凭据完成绑定和续期
        const session = await migrateAccountDevice(controller.signal);
        if (currentGeneration !== getAccountSessionGeneration()) return false;
        updateAccountAccess(session);
        announceAccountTokenRefreshed();
        return true;
      }
      if ((response.status === 401 || response.status === 403) && isExplicitAccountDenial(data)) {
        updateAccountAccess(null);
        return false;
      }
      if (!response.ok || !data.ok || !isValidSessionMetadata(data.session)) throw new Error(data.error || '账户续期暂不可用，请稍后重试');
      await assertDeviceSession(data.session.deviceKeyId);
      updateAccountAccess(data.session);
      announceAccountTokenRefreshed();
      return true;
    } finally { window.clearTimeout(timer); }
  };
  refreshPromise = runAccountSessionTask(request).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function ensureFreshAccountAccess(): Promise<boolean> {
  if (anonymousAccess) return Promise.resolve(true);
  if (!accessDeadline) return Promise.resolve(false);
  if (accessDeadline - Date.now() > 15 * 60_000) return Promise.resolve(true);
  if (refreshDeadline <= Date.now()) return Promise.resolve(false);
  return refreshAccountAccess();
}

if (typeof window !== 'undefined') {
  window.addEventListener('openmusic:account-session-changed', forgetAccountAccess);
  window.addEventListener('storage', (event) => {
    if (isAccountSessionRevisionEvent(event)) forgetAccountAccess();
  });
}
