export function roomPasswordStorageKey(roomId: string, accountId?: string): string {
  const scope = String(accountId || '').trim();
  return scope
    ? `openmusic:room-password:${scope}:${roomId.toUpperCase()}`
    : `openmusic:room-password:${roomId.toUpperCase()}`;
}

export function getStoredRoomPassword(roomId?: string, accountId?: string | null): string | undefined {
  if (!roomId) return undefined;
  try {
    if (accountId) return localStorage.getItem(roomPasswordStorageKey(roomId, accountId)) || undefined;
    return sessionStorage.getItem(roomPasswordStorageKey(roomId)) || undefined;
  } catch {
    return undefined;
  }
}

export function rememberRoomPassword(roomId: string, password?: string, accountId?: string | null): void {
  if (!password?.trim()) return;
  try {
    if (accountId) localStorage.setItem(roomPasswordStorageKey(roomId, accountId), password.trim());
    else sessionStorage.setItem(roomPasswordStorageKey(roomId), password.trim());
  } catch {
    // sessionStorage may be unavailable in private browsing.
  }
}

export function clearStoredRoomPassword(roomId?: string, accountId?: string | null): void {
  if (!roomId) return;
  try {
    if (accountId) localStorage.removeItem(roomPasswordStorageKey(roomId, accountId));
    else sessionStorage.removeItem(roomPasswordStorageKey(roomId));
  } catch {
    // ignore
  }
}

/** 从分享链接 query 读取房间密码（支持 pwd / password） */
export function parseRoomPasswordFromSearch(search: string): string | undefined {
  if (!search) return undefined;
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const pwd = params.get('pwd') ?? params.get('password');
  const trimmed = pwd?.trim();
  return trimmed || undefined;
}

export function buildRoomEntryUrl(
  roomId: string,
  options?: { password?: string; origin?: string },
): string {
  const origin = options?.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const url = new URL(`${origin}/room/${encodeURIComponent(roomId)}`);
  const pwd = options?.password?.trim();
  if (pwd) url.searchParams.set('pwd', pwd);
  return url.toString();
}

export function stripRoomPasswordFromSearch(search: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  params.delete('pwd');
  params.delete('password');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
