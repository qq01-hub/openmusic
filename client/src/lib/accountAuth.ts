import { assertDeviceSession } from './deviceProof';
import { assertAccountSessionResponse, type AccountSessionResponse } from './accountSessionRecovery';
import { fetchWithTimeout } from '../api/http';
import { useRoomStore } from '../stores/roomStore';
import { requireSessionBootstrap } from './sessionBootstrap';
import { ensureFreshAccountAccess, forgetAccountAccess, getAccountSessionGeneration, migrateAccountDevice, refreshAccountAccess, runAccountSessionTask, setAnonymousAccess, updateAccountAccess } from './accountAccessSession';

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
  nickname?: string;
  roomUserId?: string | null;
  identities: AccountIdentity[];
  createdAt: number;
}

export interface AccountProviderStatus {
  turnstile?: { enabled: boolean; siteKey: string };
  linuxdo: boolean;
  github: boolean;
  wechat: boolean;
}

type AccountResponse = { ok?: boolean; account?: AccountProfile; error?: string; code?: string };

function homepageNickname(account: AccountProfile): string {
  const saved = String(account.nickname || '').trim();
  if (saved) return saved;
  if (useRoomStore.getState().nickname.trim()) return '';
  return String(account.identities.find((identity) => identity.provider === 'wechat')?.username || '').trim();
}

export function acceptAccountProfile(account: AccountProfile): AccountProfile {
  useRoomStore.getState().bindAccountNickname(account.id, homepageNickname(account));
  return account;
}

async function readAccountResponse(response: Response): Promise<AccountProfile> {
  const generation = getAccountSessionGeneration();
  const data = await response.json().catch(() => ({})) as AccountResponse;
  if (generation !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新操作');
  if (!response.ok || !data.account) {
    const error = new Error(data.error || '账户操作失败') as Error & { code?: string; status?: number };
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return acceptAccountProfile(data.account);
}

let inflightSessionFetch: { generation: string; promise: Promise<AccountProfile | null> } | null = null;

async function fetchAccountSessionInternal(): Promise<AccountProfile | null> {
  const generation = getAccountSessionGeneration();
  const assertCurrent = () => {
    if (generation !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新验证');
  };
  const read = async () => {
    let result = await fetchWithTimeout('/api/auth/session', { cache: 'no-store' }, 8000);
    if (result.ok) {
      const state = await result.clone().json().catch(() => null) as AccountSessionResponse | null;
      if (state?.authenticated && state.session?.deviceMigrationRequired) {
        assertCurrent();
        await runAccountSessionTask(() => {
          assertCurrent();
          return migrateAccountDevice(AbortSignal.timeout(10000));
        });
        assertCurrent();
        result = await fetchWithTimeout('/api/auth/session', { cache: 'no-store' }, 8000);
      }
    }
    return result;
  };
  let response = await read();
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string; code?: string };
    if (data.code === 'ACCOUNT_DEVICE_PROOF_REQUIRED') {
      const migrated = await fetchWithTimeout('/api/auth/device-migrate', { method: 'POST' }, 10000);
      assertCurrent();
      if (!migrated.ok) {
        const migrationError = await migrated.json().catch(() => ({})) as { error?: string; code?: string };
        // 兼容旧实例的重复迁移响应，重新读取后仍核验本机公钥
        if (migrated.status !== 409 || migrationError.code !== 'ACCOUNT_DEVICE_PROOF_NOT_NEEDED') {
          throw Object.assign(new Error(migrationError.error || data.error || '账户设备升级失败，请重新登录'), {
            code: migrationError.code || data.code,
            status: migrated.status,
          });
        }
      }
      response = await read();
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string; code?: string };
        throw Object.assign(new Error(error.error || '账户状态读取失败，请稍后重试'), { code: error.code, status: response.status });
      }
    } else {
      throw Object.assign(new Error(data.error || '账户状态读取失败，请稍后重试'), { code: data.code, status: response.status });
    }
  }
  const initialData: unknown = await response.json().catch(() => null);
  assertAccountSessionResponse(initialData);
  let data: AccountSessionResponse = initialData;
  assertCurrent();
  if (data.authenticated) await assertDeviceSession(data.session?.deviceKeyId);
  assertCurrent();
  updateAccountAccess(data.session, Boolean(data.refreshAvailable));
  if ((data.authenticated ? !await ensureFreshAccountAccess() : data.refreshAvailable && !await refreshAccountAccess())) {
    assertCurrent();
    setAnonymousAccess(data.anonymousAllowed === true);
    useRoomStore.getState().bindAccountNickname(null, '');
    if (data.anonymousAllowed === true) await requireSessionBootstrap();
    assertCurrent();
    return null;
  }
  if (data.refreshAvailable || (data.session && data.session.expiresAt - data.session.serverTime <= 15 * 60_000)) {
    response = await read();
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: string; code?: string };
      throw Object.assign(new Error(error.error || '账户状态读取失败，请稍后重试'), { code: error.code, status: response.status });
    }
    const nextData: unknown = await response.json().catch(() => null);
    assertAccountSessionResponse(nextData);
    data = nextData;
    assertCurrent();
    updateAccountAccess(data.session);
  }
  assertCurrent();
  const account = data.authenticated && data.account ? data.account : null;
  if (account) await assertDeviceSession(data.session?.deviceKeyId);
  assertCurrent();
  setAnonymousAccess(!account && data.anonymousAllowed === true);
  if (account) useRoomStore.getState().bindAccountNickname(account.id, homepageNickname(account));
  else useRoomStore.getState().bindAccountNickname(null, '');
  if (!account && data.anonymousAllowed === true) await requireSessionBootstrap();
  assertCurrent();
  if (account && useRoomStore.getState().nicknameMigration) {
    // 昵称写入失败保留脏标记，不能把已核验的账户误判为未登录
    void persistAccountNickname().catch(() => {
      if (generation === getAccountSessionGeneration()) window.dispatchEvent(new Event('openmusic:account-nickname-save-failed'));
    });
  }
  return account;
}

export function fetchAccountSession(): Promise<AccountProfile | null> {
  const generation = getAccountSessionGeneration();
  if (inflightSessionFetch && inflightSessionFetch.generation === generation) {
    return inflightSessionFetch.promise;
  }
  const promise = fetchAccountSessionInternal().finally(() => {
    if (inflightSessionFetch?.promise === promise) {
      inflightSessionFetch = null;
    }
  });
  inflightSessionFetch = { generation, promise };
  return promise;
}

let nicknameSave: Promise<void> = Promise.resolve();

export function persistAccountNickname(): Promise<void> {
  const save = async () => {
    const { nickname, nicknameAccountId, nicknameDirty, nicknameMigration } = useRoomStore.getState();
    if (!nicknameAccountId || !nicknameDirty || !nickname.trim()) return;
    const generation = getAccountSessionGeneration();
    if (!await ensureFreshAccountAccess() || generation !== getAccountSessionGeneration()) {
      throw new Error('请先登录账户后保存昵称');
    }
    const response = await fetchWithTimeout('/api/auth/nickname', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, initializeOnly: nicknameMigration }),
    }, 10000);
    const data = await response.json().catch(() => ({})) as AccountResponse;
    if (generation !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新操作');
    if (!response.ok || !data.account) throw new Error(data.error || '昵称保存失败，请稍后重试');
    const current = useRoomStore.getState();
    if (current.nicknameAccountId === nicknameAccountId && current.nickname === nickname) {
      current.setNickname(data.account.nickname || nickname.trim());
    }
  };
  const pending = nicknameSave.then(save, save);
  nicknameSave = pending.catch(() => undefined);
  return pending;
}

export async function fetchAccountProviders(): Promise<AccountProviderStatus> {
  const response = await fetchWithTimeout(`/api/auth/providers?_=${Date.now()}`, { cache: 'no-store' }, 8000);
  if (!response.ok) throw new Error('登录方式暂不可用，请稍后重试');
  const data = await response.json() as Partial<AccountProviderStatus>;
  if (!data || ['linuxdo', 'github', 'wechat'].some(key => typeof data[key as keyof AccountProviderStatus] !== 'boolean')) {
    throw new Error('登录方式返回异常，请稍后重试');
  }
  return {
    turnstile: data.turnstile && typeof data.turnstile.siteKey === 'string' ? { enabled: data.turnstile.enabled === true, siteKey: data.turnstile.siteKey } : undefined,
    linuxdo: Boolean(data.linuxdo),
    github: Boolean(data.github),
    wechat: Boolean(data.wechat),
  };
}

export async function requestAccountEmailCode(email: string, turnstileToken = ''): Promise<{ resendAfterSec: number }> {
  const response = await fetchWithTimeout('/api/auth/email/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, turnstileToken }),
  }, 10000);
  const data = await response.json().catch(() => ({})) as { error?: string; resendAfterSec?: number };
  if (!response.ok) throw new Error(data.error || '验证码发送失败');
  return { resendAfterSec: Number(data.resendAfterSec) || 60 };
}

export async function loginAccountWithEmail(email: string, password: string, turnstileToken = ''): Promise<AccountProfile> {
  const response = await fetchWithTimeout('/api/auth/email/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, turnstileToken }),
  }, 12000);
  return readAccountResponse(response);
}

export async function registerAccountWithEmail(
  email: string,
  password: string,
  code: string,
  turnstileToken = '',
): Promise<AccountProfile> {
  const response = await fetchWithTimeout('/api/auth/email/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, code, turnstileToken }),
  }, 15000);
  return readAccountResponse(response);
}

export async function logoutAccount(): Promise<void> {
  forgetAccountAccess();
  const response = await fetchWithTimeout('/api/auth/logout', { method: 'POST' }, 8000);
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || '退出未完成，请稍后重试');
  }
  forgetAccountAccess();
  useRoomStore.getState().bindAccountNickname(null, '');
}

export async function unbindAccountIdentity(provider: Exclude<AccountIdentityProvider, 'email'>): Promise<AccountProfile> {
  const response = await fetchWithTimeout(`/api/auth/identities/${provider}/unbind`, {
    method: 'POST',
  }, 10000);
  return readAccountResponse(response);
}

export async function completeWechatAccount(
  action: 'login' | 'bind',
  signal?: AbortSignal,
  flowId?: string,
): Promise<AccountProfile> {
  const response = await fetchWithTimeout('/api/auth/wechat/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, flowId }),
    signal,
  }, 30000);
  return readAccountResponse(response);
}

export async function startWechatAccountLogin(signal?: AbortSignal): Promise<{ qrUrl: string; expiresAt: number; flowId?: string }> {
  const response = await fetchWithTimeout('/api/auth/wechat/start', { method: 'POST', signal }, 15000);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '微信二维码获取失败');
  return data;
}

export async function pollWechatAccountLogin(signal?: AbortSignal, flowId?: string): Promise<{ status: 'waiting' | 'scanned' | 'expired' | 'confirmed' }> {
  const response = await fetchWithTimeout('/api/auth/wechat/poll', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flowId }) }, 90000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || '微信身份验证暂不可用'), { code: data.code, status: response.status });
  }
  return data;
}

export async function startAccountOAuth(
  provider: 'linuxdo' | 'github',
  action: 'login' | 'bind',
): Promise<void> {
  const purpose = action === 'bind' ? 'account-bind' : 'account-login';
  const returnPath = window.location.pathname;
  const params = new URLSearchParams({ purpose, returnPath });
  const target = `/api/auth/${provider}/start?${params.toString()}`;
  const response = await fetchWithTimeout(target);
  const result = await response.json();
  if (!response.ok || typeof result.url !== 'string') throw new Error(result.error || '授权准备失败');
  window.location.href = result.url;
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
