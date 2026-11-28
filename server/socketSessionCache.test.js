import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocketSessionVerifier } from './socketSessionCache.js';

function fakeSocket(id, sessionKey = 'key-a') {
  return { id, data: { accountId: 'acct_1', sessionKey } };
}

function makeVerifier({ ttlMs = 8000, result = { valid: true, account: { id: 'acct_1' } } } = {}) {
  let nowValue = 1_000_000;
  let calls = 0;
  const verifier = createSocketSessionVerifier({
    ttlMs,
    now: () => nowValue,
    getSessionKey: (socket) => socket.data.sessionKey || '',
    verify: async () => { calls += 1; return typeof result === 'function' ? result() : result; },
  });
  return { verifier, calls: () => calls, advance: (ms) => { nowValue += ms; } };
}

test('同一 socket 连续多包只核验一次', async () => {
  const { verifier, calls } = makeVerifier();
  const socket = fakeSocket('s1');
  for (let i = 0; i < 5; i += 1) {
    const result = await verifier.verifySocket(socket, { skipRiskCheck: true });
    assert.equal(result.valid, true);
  }
  assert.equal(calls(), 1);
  const again = await verifier.verifySocket(socket);
  assert.equal(again.cached, true);
  assert.equal(calls(), 1);
});

test('TTL 过期后重新核验', async () => {
  const { verifier, calls, advance } = makeVerifier({ ttlMs: 8000 });
  const socket = fakeSocket('s1');
  await verifier.verifySocket(socket);
  advance(7999);
  await verifier.verifySocket(socket);
  assert.equal(calls(), 1);
  advance(2);
  await verifier.verifySocket(socket);
  assert.equal(calls(), 2);
});

test('TTL 被钳制在 10 秒以内', () => {
  const { verifier } = makeVerifier({ ttlMs: 60_000 });
  assert.ok(verifier.ttlMs <= 10_000);
});

test('会话吊销（按 sessionKey 失效）后不放行缓存，必须重新核验', async () => {
  let revoked = false;
  const { verifier, calls } = makeVerifier({
    result: () => (revoked ? { valid: false } : { valid: true, account: { id: 'acct_1' } }),
  });
  const socket = fakeSocket('s1', 'key-revoked');
  assert.equal((await verifier.verifySocket(socket)).valid, true);
  assert.equal(calls(), 1);
  revoked = true;
  verifier.invalidateSessionKey('key-revoked');
  const result = await verifier.verifySocket(socket);
  assert.equal(result.valid, false);
  assert.equal(calls(), 2);
});

test('按账户失效与单 socket 失效都会触发重新核验', async () => {
  const { verifier, calls } = makeVerifier();
  const a = fakeSocket('s1');
  const b = fakeSocket('s2');
  await verifier.verifySocket(a);
  await verifier.verifySocket(b);
  assert.equal(calls(), 2);
  verifier.invalidateAccount('acct_1');
  await verifier.verifySocket(a);
  assert.equal(calls(), 3);
  verifier.invalidateSocket(b);
  await verifier.verifySocket(b);
  // b 的缓存已被 invalidateAccount 一并清掉，此前已重新核验并回填；
  // invalidateSocket 后再次核验
  assert.equal(calls(), 4);
});

test('核验未通过的结果不缓存，逐包复核', async () => {
  const { verifier, calls } = makeVerifier({ result: { valid: false, unavailable: true } });
  const socket = fakeSocket('s1');
  await verifier.verifySocket(socket);
  await verifier.verifySocket(socket);
  assert.equal(calls(), 2);
});

test('会话键变化（账户切换/重登换会话）时不复用旧缓存', async () => {
  const { verifier, calls } = makeVerifier();
  const socket = fakeSocket('s1', 'key-old');
  await verifier.verifySocket(socket);
  socket.data.sessionKey = 'key-new';
  await verifier.verifySocket(socket);
  assert.equal(calls(), 2);
});
