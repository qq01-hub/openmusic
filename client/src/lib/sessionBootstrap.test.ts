import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureSessionBootstrap,
  isSessionBootstrapLoginRequired,
  requireSessionBootstrap,
  resetSessionBootstrap,
} from './sessionBootstrap';

test('服务端返回 loginRequired 时立刻停止重试并抛出 ACCOUNT_AUTH_REQUIRED', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  let calls = 0;
  (globalThis as { window?: unknown }).window = {
    location: { origin: 'https://music.qqovo.cn' },
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
