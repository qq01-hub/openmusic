import { ACCOUNT_SESSION_REVISION_KEY, announceAccountTokenRefreshed, isAccountSessionRevisionEvent } from './accountSessionSignal';

export type AccountSessionMetadata = { expiresAt: number; refreshExpiresAt: number; serverTime: number };

let accessDeadline = 0;
let refreshDeadline = 0;
let refreshPromise: Promise<boolean> | null = null;
let generation = 0;
let refreshAllowed = true;
let sessionTask: Promise<unknown> = Promise.resolve();

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
  accessDeadline = Date.now() + session.expiresAt - session.serverTime;
  refreshDeadline = Date.now() + session.refreshExpiresAt - session.serverTime;
  refreshAllowed = true;
}

export function forgetAccountAccess(): void {
  generation += 1;
  updateAccountAccess(null);
}

export async function waitForAccountRefresh(): Promise<void> {
  if (refreshPromise) await refreshPromise.catch(() => false);
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
        const state = await current.json().catch(() => ({})) as { authenticated?: boolean; session?: AccountSessionMetadata };
        if (currentGeneration !== getAccountSessionGeneration()) return false;
        if (current.ok && state.authenticated && state.session && state.session.expiresAt - state.session.serverTime > 15 * 60_000) {
          updateAccountAccess(state.session);
          announceAccountTokenRefreshed();
          return true;
        }
        if (!current.ok && current.status !== 401) throw new Error('账户状态读取失败，请稍后重试');
      }
      const response = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'X-OpenMusic-Request': '1' }, signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; session?: AccountSessionMetadata; error?: string };
      if (currentGeneration !== getAccountSessionGeneration()) return false;
      if (response.status === 401 || response.status === 403) {
        updateAccountAccess(null);
        return false;
      }
      if (!response.ok || !data.ok || !data.session) throw new Error(data.error || '账户续期暂不可用，请稍后重试');
      updateAccountAccess(data.session);
      announceAccountTokenRefreshed();
      return true;
    } finally { window.clearTimeout(timer); }
  };
  refreshPromise = runAccountSessionTask(request).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function ensureFreshAccountAccess(): Promise<boolean> {
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
