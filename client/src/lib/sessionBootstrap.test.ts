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
