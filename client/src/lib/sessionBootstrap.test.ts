import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureSessionBootstrap,
  isSessionBootstrapLoginRequired,
  requireSessionBootstrap,
  resetSessionBootstrap,
} from './sessionBootstrap';
import { signApiUrl } from './signedApiUrl';
import { classifySongUrlFetchError, isAuthPlaybackError } from './audioPlaybackError';
import { fetchWithTimeout } from '../api/http';
import { forgetAccountAccess, updateAccountAccess } from './accountAccessSession';
import { needsApiSign } from './apiSign';

test('服务端返回 loginRequired 时立刻停止重试并抛出 ACCOUNT_AUTH_REQUIRED', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  let calls = 0;
  (globalThis as { window?: unknown }).window = {
    location: { origin: 'https://openmusic.test' },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    dispatchEvent: () => true,
  };
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ authenticated: false, loginRequired: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    resetSessionBootstrap();
    const ensured = await ensureSessionBootstrap(true);
    assert.equal(ensured, null);
    assert.equal(calls, 1);
    assert.equal(isSessionBootstrapLoginRequired(), true);

    await assert.rejects(
      () => requireSessionBootstrap(false),
      (err: unknown) => Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ACCOUNT_AUTH_REQUIRED'),
    );
    assert.equal(calls, 1);

    resetSessionBootstrap();
    assert.equal(isSessionBootstrapLoginRequired(), false);
    await assert.rejects(
      () => requireSessionBootstrap(true),
      (err: unknown) => Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ACCOUNT_AUTH_REQUIRED'),
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    resetSessionBootstrap();
  }
});

test('bootstrap 返回 loginRequired 后 signApiUrl 与 http 立即熔断且不误判为音源故障', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const dispatched: string[] = [];
  const requestedUrls: string[] = [];
  (globalThis as { window?: unknown }).window = {
    location: { origin: 'https://openmusic.test', href: 'https://openmusic.test/room/TEST01' },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    dispatchEvent: (event: Event) => {
      dispatched.push(event.type);
      return true;
    },
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requestedUrls.push(url);
    return new Response(JSON.stringify({ authenticated: false, loginRequired: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    resetSessionBootstrap();
    const now = Date.now();
    updateAccountAccess({
      sessionId: 'sess_test_1',
      expiresAt: now + 3_600_000,
      refreshExpiresAt: now + 86_400_000,
      serverTime: now,
    });

    await assert.rejects(
      () => signApiUrl('/api/meting?server=kugou&type=url&id=abc', { force: true }),
      (err: unknown) => isAuthPlaybackError(err) && classifySongUrlFetchError(err) === 'auth',
    );
    assert.deepEqual(requestedUrls, ['/api/session/bootstrap']);
    assert.equal(dispatched.includes('openmusic:account-auth-required'), true);

    const response = await fetchWithTimeout('/api/meting?server=kugou&type=url&id=abc');
    assert.equal(response.status, 401);
    assert.deepEqual(requestedUrls, ['/api/session/bootstrap']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    forgetAccountAccess();
    resetSessionBootstrap();
  }
});

test('loginRequired 状态下 GitHub 与 Linux.do 公开登录入口不被本地熔断，仍携带设备证明发起请求', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const storeData = new Map<string, unknown>([['primary:https://openmusic.test', keyPair]]);
  const fakeDb = {
    open() {
      const openReq: { result?: unknown; onsuccess?: () => void } = {};
      const db = {
        close() {},
        transaction() {
          return {
            objectStore() {
              return {
                get(key: string) {
                  const req: { result?: unknown; onsuccess?: () => void } = {};
                  queueMicrotask(() => {
                    req.result = storeData.get(key);
                    req.onsuccess?.();
                  });
                  return req;
                },
              };
            },
          };
        },
      };
      queueMicrotask(() => {
        openReq.result = db;
        openReq.onsuccess?.();
      });
      return openReq;
    },
  };
  const requested: Array<{ url: string; deviceHeader: string | null }> = [];
  (globalThis as { window?: unknown }).window = {
    isSecureContext: true,
    indexedDB: fakeDb,
    location: { origin: 'https://openmusic.test', href: 'https://openmusic.test/' },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    dispatchEvent: () => true,
  };
  Object.defineProperty(globalThis, 'indexedDB', { value: fakeDb, configurable: true, writable: true });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    requested.push({ url, deviceHeader: headers.get('X-OpenMusic-Device') });
    if (url.includes('/api/session/bootstrap')) {
      return new Response(JSON.stringify({ authenticated: false, loginRequired: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/auth/providers')) {
      return new Response(JSON.stringify({ linuxdo: true, github: true, wechat: true, serverTime: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ url: `https://oauth.example/authorize?from=${encodeURIComponent(url)}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    resetSessionBootstrap();
    assert.equal(needsApiSign('/api/auth/github/start?purpose=account-login&returnPath=%2F'), false);
    assert.equal(needsApiSign('/api/auth/linuxdo/start?purpose=account-login&returnPath=%2F'), false);
    assert.equal(needsApiSign('/api/auth/human-challenge'), false);
    assert.equal(needsApiSign('/api/donations'), false);
    assert.equal(needsApiSign('/api/rooms/TEST01/cover', 'GET'), false);
    assert.equal(needsApiSign('/api/rooms/TEST01/cover', 'POST'), true);

    await ensureSessionBootstrap(true);
    assert.equal(isSessionBootstrapLoginRequired(), true);

    const githubRes = await fetchWithTimeout('/api/auth/github/start?purpose=account-login&returnPath=%2F');
    assert.equal(githubRes.status, 200);
    const githubData = await githubRes.json() as { url?: string };
    assert.equal(typeof githubData.url, 'string');

    const linuxdoRes = await fetchWithTimeout('/api/auth/linuxdo/start?purpose=account-login&returnPath=%2F');
    assert.equal(linuxdoRes.status, 200);
    const linuxdoData = await linuxdoRes.json() as { url?: string };
    assert.equal(typeof linuxdoData.url, 'string');

    const githubReq = requested.find(item => item.url.includes('/api/auth/github/start'));
    const linuxdoReq = requested.find(item => item.url.includes('/api/auth/linuxdo/start'));
    assert.ok(githubReq?.deviceHeader, 'GitHub 登录准备请求应携带设备证明');
    assert.ok(linuxdoReq?.deviceHeader, 'Linux.do 登录准备请求应携带设备证明');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    Object.defineProperty(globalThis, 'indexedDB', { value: originalIndexedDb, configurable: true, writable: true });
    forgetAccountAccess();
    resetSessionBootstrap();
  }
});
