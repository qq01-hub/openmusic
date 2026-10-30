import { fetchWithTimeout } from './http';
import type { RoomMusicAccount, RoomMusicAccounts } from '../types';

type ResponseData = { success?: boolean; accounts?: RoomMusicAccounts; account?: RoomMusicAccount; error?: string; code?: string };

async function read(response: Response): Promise<ResponseData> {
  const data = await response.json().catch(() => ({})) as ResponseData;
  if (!response.ok || data.success === false) throw Object.assign(new Error(data.error || '账户会员操作失败'), { code: data.code });
  return data;
}

export async function fetchAccountMusicAccounts(): Promise<RoomMusicAccounts> {
  const response = await fetchWithTimeout('/api/account/music-accounts', { cache: 'no-store' }, 8000);
  const data = await read(response);
  return data.accounts || { netease: null, tencent: null, kugou: null, qishui: null };
}

export async function setAccountMusicShared(platform: keyof RoomMusicAccounts, shared: boolean): Promise<RoomMusicAccount | null> {
  const response = await fetchWithTimeout(`/api/account/music-accounts/${encodeURIComponent(platform)}/shared`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shared }),
  }, 10000);
  const data = await read(response);
  return data.account || null;
}

export async function deleteAccountMusicAccount(platform: keyof RoomMusicAccounts): Promise<RoomMusicAccounts> {
  const response = await fetchWithTimeout(`/api/account/music-accounts/${encodeURIComponent(platform)}`, { method: 'DELETE' }, 10000);
  const data = await read(response);
  return data.accounts || { netease: null, tencent: null, kugou: null, qishui: null };
}
