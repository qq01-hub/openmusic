import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSkipSessionRefresh,
  didSessionExpiryAdvance,
  ensureFreshAccountAccess,
  forgetAccountAccess,
  isSessionMetadataRefreshNeeded,
  MIN_REFRESH_EXTEND_MS,
  PROACTIVE_REFRESH_WINDOW_MS,
  refreshAccountAccess,
  shouldProactivelyRefreshAccess,
  updateAccountAccess,
} from './accountAccessSession';
import { ACCOUNT_TOKEN_REVISION_KEY } from './accountSessionSignal';
import { createAccountSessionSupersededError, isAccountSessionSupersededError, isExplicitAccountDenial } from './accountSessionRecovery';
import { fetchAccountSession } from './accountAuth';
import { fetchWithTimeout } from '../api/http';

const SESSION_ID = 'abcdefghijklmnopqrstuvwx';
const sharedKeyPairPromise = crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);

function createMemoryIndexedDb() {
  const storeData = new Map<string, unknown>();
  const makeRequest = <T>(compute: () => T) => {
    const req: { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
    queueMicrotask(() => {
      try {
        req.result = compute();
        req.onsuccess?.();
      } catch (error) {
        req.error = error;
        req.onerror?.();
      }
    });
    return req;
  };
  return {
    open() {
      const openReq: {
        result?: unknown;
        onupgradeneeded?: () => void;
        onsuccess?: () => void;
        onerror?: () => void;
        onblocked?: () => void;
      } = {};
      const db = {
        createObjectStore() {},
        close() {},
        transaction(_name: string, mode?: string) {
          const tx: {
            oncomplete?: () => void;
            onabort?: () => void;
            onerror?: () => void;
            objectStore: () => {
              get: (key: string) => unknown;
              add: (value: unknown, key: string) => unknown;
            };
          } = {
            objectStore() {
              return {
                get: (key: string) => makeRequest(() => storeData.get(key)),
                add: (value: unknown, key: string) => {
                  storeData.set(key, value);
                  return makeRequest(() => key);
                },
              };
            },
          };
          if (mode === 'readwrite') {
            setTimeout(() => tx.oncomplete?.(), 0);
          }
          return tx;
        },
      };
      queueMicrotask(() => {
        openReq.result = db;
        openReq.onupgradeneeded?.();
        openReq.onsuccess?.();
      });
      return openReq;
    },
    storeData,
  };
}

async function computeDeviceKeyId(publicKey: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  const normalized = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalized))));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function setupBrowserEnv(options: { withLocks?: boolean } = {}) {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const originalIndexedDb = globalThis.indexedDB;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const storage = new Map<string, string>();
  const storageWrites: string[] = [];
  const dispatchedEvents: string[] = [];
  const fakeDb = createMemoryIndexedDb();
  const keyPair = await sharedKeyPairPromise;
  const deviceKeyId = await computeDeviceKeyId(keyPair.publicKey);
  fakeDb.storeData.set('primary:https://openmusic.test', keyPair);

  const fakeWindow = {
    isSecureContext: true,
    location: { origin: 'https://openmusic.test' },
    indexedDB: fakeDb,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event: Event) {
      dispatchedEvents.push(event.type);
      return true;
    },
  };
  const fakeStorage = {
    getItem(key: string) { return storage.get(key) ?? null; },
    setItem(key: string, value: string) { storage.set(key, value); storageWrites.push(key); },
    removeItem(key: string) { storage.delete(key); },
  };

  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: fakeDb, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', {
    value: options.withLocks === false
      ? {}
      : { locks: { request: async (_name: string, task: () => Promise<unknown>) => await task() } },
    configurable: true,
    writable: true,
  });

  return {
    deviceKeyId,
    dispatchedEvents,
    storageWrites,
    restore() {
      forgetAccountAccess();
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'indexedDB', { value: originalIndexedDb, configurable: true, writable: true });
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    },
  };
}

test('续期判定：30 天会话进入最后 15 分钟且无法继续延长时不再触发主动续期', () => {
  const now = 1_700_000_000_000;
  const tenMinLater = now + 10 * 60_000;

  assert.equal(shouldProactivelyRefreshAccess(tenMinLater, tenMinLater, now), false);
  assert.equal(shouldProactivelyRefreshAccess(tenMinLater, tenMinLater + MIN_REFRESH_EXTEND_MS, now), false);
  assert.equal(canSkipSessionRefresh({ expiresAt: tenMinLater, refreshExpiresAt: tenMinLater, serverTime: now }), true);
  assert.equal(isSessionMetadataRefreshNeeded({ expiresAt: tenMinLater, refreshExpiresAt: tenMinLater, serverTime: now }), false);
});

test('续期判定：普通 3 天令牌临期或访问令牌已过期但刷新凭据有效时允许续期', () => {
  const now = 1_700_000_000_000;
  const tenMinLater = now + 10 * 60_000;
  const twentyDaysLater = now + 20 * 86_400_000;

  // 正常期（超过 15 分钟）不需要续期
  assert.equal(shouldProactivelyRefreshAccess(now + PROACTIVE_REFRESH_WINDOW_MS + 1000, twentyDaysLater, now), false);
  // 普通 3 天令牌临期且刷新凭据充足，需要续期
  assert.equal(shouldProactivelyRefreshAccess(tenMinLater, twentyDaysLater, now), true);
  assert.equal(canSkipSessionRefresh({ expiresAt: tenMinLater, refreshExpiresAt: twentyDaysLater, serverTime: now }), false);
  // 访问令牌已过期但刷新凭据还在最后 15 分钟内，仍允许续期一次
  assert.equal(shouldProactivelyRefreshAccess(now - 1000, tenMinLater, now), true);
  // 访问令牌与刷新凭据均已过期，不再续期
  assert.equal(shouldProactivelyRefreshAccess(now - 1000, now - 1000, now), false);
});

test('续期通知判定：只有截止时间真正延后才算刷新推进', () => {
  assert.equal(didSessionExpiryAdvance(0, 1000), true);
  assert.equal(didSessionExpiryAdvance(1000, 1000), false);
  assert.equal(didSessionExpiryAdvance(2000, 1000), false);
  assert.equal(didSessionExpiryAdvance(1000, 2000), true);
});

test('30 天会话最后 15 分钟内反复调用 ensureFreshAccountAccess 与 refreshAccountAccess 不产生空刷和事件循环', async () => {
  const env = await setupBrowserEnv();
  try {
    const now = Date.now();
    const session = {
      sessionId: SESSION_ID,
      deviceKeyId: env.deviceKeyId,
      expiresAt: now + 10 * 60_000,
      refreshExpiresAt: now + 10 * 60_000,
      serverTime: now,
    };
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      if (url === '/api/auth/session') {
        return new Response(JSON.stringify({
          authenticated: true,
          account: { id: 'acct_test_1234567890' },
          session,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    updateAccountAccess(session);
    for (let index = 0; index < 5; index += 1) {
      assert.equal(await ensureFreshAccountAccess(), true);
    }
    assert.deepEqual(requestedUrls, []);
    assert.deepEqual(env.dispatchedEvents, []);

    // 即使显式调用 refreshAccountAccess，锁内预检也应跳过 /api/auth/refresh 且不广播刷新事件
    assert.equal(await refreshAccountAccess(), true);
    assert.deepEqual(requestedUrls, ['/api/auth/session']);
    assert.deepEqual(env.dispatchedEvents, []);
    assert.deepEqual(env.storageWrites, []);
  } finally {
    env.restore();
  }
});

test('会话代际切换错误不会被误判为明确拒绝，且 fetchAccountSession 在途切换后自动衔接最新代际', async () => {
  const superseded = createAccountSessionSupersededError('账户已变化，请重新验证');
  assert.equal(isAccountSessionSupersededError(superseded), true);
  assert.equal(isExplicitAccountDenial(superseded), false);

  const env = await setupBrowserEnv();
  try {
    const now = Date.now();
    let sessionCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/auth/providers')) {
        // 模拟登录切换在 providers 请求在途发生，不应抛会话切换异常
        forgetAccountAccess();
        return new Response(JSON.stringify({ linuxdo: true, github: true, wechat: true, serverTime: now }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/session')) {
        sessionCalls += 1;
        if (sessionCalls === 1) {
          // 首次读取在途时模拟登录完成导致会话代际推进
          forgetAccountAccess();
          return new Response(JSON.stringify({
            authenticated: false,
            account: null,
            anonymousAllowed: false,
            refreshAvailable: false,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          authenticated: true,
          account: {
            id: 'acc_after_login',
            email: 'user@example.com',
            emailVerifiedAt: now,
            hasPassword: true,
            nickname: '测试用户',
            identities: [],
            createdAt: now,
          },
          session: {
            sessionId: SESSION_ID,
            deviceKeyId: env.deviceKeyId,
            expiresAt: now + 3 * 86_400_000,
            refreshExpiresAt: now + 30 * 86_400_000,
            serverTime: now,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const providersRes = await fetchWithTimeout('/api/auth/providers');
    assert.equal(providersRes.status, 200);

    const account = await fetchAccountSession();
    assert.equal(account?.id, 'acc_after_login');
    assert.equal(sessionCalls, 2);
    assert.equal(await ensureFreshAccountAccess(), true);
  } finally {
    env.restore();
  }
});

test('访问令牌已过期但 30 天刷新凭据剩 10 分钟时只续期一次，随后不再循环续期', async () => {
  const env = await setupBrowserEnv();
  try {
    const now = Date.now();
    const renewedSession = {
      sessionId: SESSION_ID,
      deviceKeyId: env.deviceKeyId,
      expiresAt: now + 10 * 60_000,
      refreshExpiresAt: now + 10 * 60_000,
      serverTime: now,
    };
    let refreshed = false;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      if (url === '/api/auth/session') {
        return new Response(JSON.stringify(refreshed
          ? { authenticated: true, account: { id: 'acct_test_1234567890' }, session: renewedSession }
          : { authenticated: false, account: null, refreshAvailable: true, deviceSessionId: SESSION_ID }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/auth/refresh') {
        refreshed = true;
        return new Response(JSON.stringify({ ok: true, session: renewedSession }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    updateAccountAccess(null, true);
    assert.equal(await refreshAccountAccess(), true);
    assert.equal(requestedUrls.filter(url => url === '/api/auth/refresh').length, 1);
    assert.deepEqual(env.dispatchedEvents, ['openmusic:account-token-refreshed']);
    assert.deepEqual(env.storageWrites, [ACCOUNT_TOKEN_REVISION_KEY]);

    requestedUrls.length = 0;
    env.dispatchedEvents.length = 0;
    env.storageWrites.length = 0;

    // 续期后已贴紧 30 天上限，后续检查零请求、零事件
    assert.equal(await ensureFreshAccountAccess(), true);
    assert.deepEqual(requestedUrls, []);
    assert.deepEqual(env.dispatchedEvents, []);
  } finally {
    env.restore();
  }
});

test('跨标签锁内发现其他标签已完成续期时，只通知当前标签而不重复写 localStorage 引发互刷', async () => {
  const env = await setupBrowserEnv();
  try {
    const now = Date.now();
    const oldSession = {
      sessionId: SESSION_ID,
      deviceKeyId: env.deviceKeyId,
      expiresAt: now + 5 * 60_000,
      refreshExpiresAt: now + 20 * 86_400_000,
      serverTime: now,
    };
    const freshSession = {
      sessionId: SESSION_ID,
      deviceKeyId: env.deviceKeyId,
      expiresAt: now + 3 * 86_400_000,
      refreshExpiresAt: now + 20 * 86_400_000,
      serverTime: now,
    };
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      if (url === '/api/auth/session') {
        return new Response(JSON.stringify({
          authenticated: true,
          account: { id: 'acct_test_1234567890' },
          session: freshSession,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    updateAccountAccess(oldSession);
    assert.equal(await ensureFreshAccountAccess(), true);
    assert.deepEqual(requestedUrls, ['/api/auth/session']);
    assert.deepEqual(env.dispatchedEvents, ['openmusic:account-token-refreshed']);
    assert.deepEqual(env.storageWrites, []);
  } finally {
    env.restore();
  }
});

test('无锁环境续期返回未延后的宽限期会话时，不广播 token-refreshed 事件', async () => {
  const env = await setupBrowserEnv({ withLocks: false });
  try {
    const now = Date.now();
    const cappedSession = {
      sessionId: SESSION_ID,
      deviceKeyId: env.deviceKeyId,
      expiresAt: now + 10 * 60_000,
      refreshExpiresAt: now + 10 * 60_000,
      serverTime: now,
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/auth/refresh') {
        return new Response(JSON.stringify({ ok: true, session: cappedSession }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    updateAccountAccess(cappedSession);
    assert.equal(await refreshAccountAccess(), true);
    assert.deepEqual(env.dispatchedEvents, []);
    assert.deepEqual(env.storageWrites, []);
  } finally {
    env.restore();
  }
});
