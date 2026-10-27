export const ACCOUNT_SESSION_REVISION_KEY = 'openmusic:account-session-revision:v1';
export const ACCOUNT_TOKEN_REVISION_KEY = 'openmusic:account-token-revision:v1';

export function isAccountTokenRevisionEvent(event: Pick<StorageEvent, 'key' | 'newValue'>): boolean {
  return event.key === ACCOUNT_TOKEN_REVISION_KEY && Boolean(event.newValue);
}

export function announceAccountTokenRefreshed(): void {
  try { localStorage.setItem(ACCOUNT_TOKEN_REVISION_KEY, `${Date.now()}:${Math.random()}`); } catch {}
  window.dispatchEvent(new Event('openmusic:account-token-refreshed'));
}

export function isAccountSessionRevisionEvent(event: Pick<StorageEvent, 'key' | 'newValue'>): boolean {
  return event.key === ACCOUNT_SESSION_REVISION_KEY && Boolean(event.newValue);
}

export function announceAccountSessionChanged(): void {
  try {
    localStorage.setItem(ACCOUNT_SESSION_REVISION_KEY, `${Date.now()}:${Math.random()}`);
  } catch {
    // 当前标签页事件仍然可用。
  }
  window.dispatchEvent(new Event('openmusic:account-session-changed'));
}
