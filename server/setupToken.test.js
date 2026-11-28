import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_TOKEN = 'test-setup-token-0123456789abcdef';
process.env.SETUP_TOKEN = TEST_TOKEN;

const express = (await import('express')).default;
const { mountSetupApi, setupTokensEqual, checkSetupAuthorization, extractSetupToken } = await import('./setupApi.js');

test('setupTokensEqual 只接受完全一致的令牌', () => {
  assert.equal(setupTokensEqual(TEST_TOKEN, TEST_TOKEN), true);
  assert.equal(setupTokensEqual(TEST_TOKEN, 'wrong-token'), false);
  assert.equal(setupTokensEqual(TEST_TOKEN, ''), false);
  assert.equal(setupTokensEqual('', TEST_TOKEN), false);
});

test('extractSetupToken 依次读请求头、body 与 Cookie', () => {
  assert.equal(extractSetupToken({ headers: { 'x-setup-token': 'h1' }, body: { setupToken: 'b1' } }), 'h1');
  assert.equal(extractSetupToken({ headers: {}, body: { setupToken: 'b1' } }), 'b1');
  assert.equal(extractSetupToken({ headers: { cookie: 'a=1; openmusic_setup_token=c1; b=2' } }), 'c1');
  assert.equal(extractSetupToken({ headers: {} }), '');
});

test('checkSetupAuthorization：无令牌可用时仅回环放行', () => {
  const loopbackReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const remoteReq = { headers: {}, socket: { remoteAddress: '203.0.113.9' } };
  assert.equal(checkSetupAuthorization(loopbackReq, { token: '', setupRequired: true }).ok, true);
  assert.equal(checkSetupAuthorization(remoteReq, { token: '', setupRequired: true }).ok, false);
  assert.equal(checkSetupAuthorization(remoteReq, { token: '', setupRequired: false }).ok, true);
});

async function withSetupServer(run) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  mountSetupApi(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(base, pathName, { token, cookie, body = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: base, Host: new URL(base).host };
  if (token) headers['X-Setup-Token'] = token;
  if (cookie) headers.Cookie = cookie;
  return fetch(`${base}${pathName}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual' });
}

test('setup 接口：无令牌/错令牌被拒，对令牌放行到业务校验', async () => {
  await withSetupServer(async (base) => {
    const redisBody = { redis: { mode: 'host', host: '127.0.0.1', port: 6399, database: 0 } };

    let res = await post(base, '/api/setup/test-redis', { body: redisBody });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'SETUP_TOKEN_REQUIRED');

    res = await post(base, '/api/setup/test-redis', { token: 'wrong-token', body: redisBody });
    assert.equal(res.status, 403);

    // 对令牌：越过令牌门禁后到达 Redis 连接校验（本机 6399 无 Redis，返回 400 连接失败）
    res = await post(base, '/api/setup/test-redis', { token: TEST_TOKEN, body: redisBody });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Redis 连接失败/);

    res = await post(base, '/api/setup/complete', { body: {} });
    assert.equal(res.status, 403);

    // 对令牌：越过门禁后到达参数校验（管理入口不合法返回 400），不触发真实安装
    res = await post(base, '/api/setup/complete', { token: TEST_TOKEN, body: {} });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /管理入口/);
  });
});

test('setup authorize：令牌换 HttpOnly Cookie 后向导请求可通过', async () => {
  await withSetupServer(async (base) => {
    let res = await fetch(`${base}/api/setup/authorize?token=wrong`, { redirect: 'manual' });
    assert.equal(res.status, 403);

    res = await fetch(`${base}/api/setup/authorize?token=${TEST_TOKEN}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/setup');
    const setCookie = res.headers.get('set-cookie') || '';
    assert.match(setCookie, /openmusic_setup_token=/);
    assert.match(setCookie, /HttpOnly/);

    const cookie = setCookie.split(';')[0];
    const redisBody = { redis: { mode: 'host', host: '127.0.0.1', port: 6399, database: 0 } };
    res = await post(base, '/api/setup/test-redis', { cookie, body: redisBody });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Redis 连接失败/);
  });
});

test('安装完成后 setup 接口保持关闭（404）', async () => {
  const lockPath = path.join(__dirname, 'setup.lock');
  assert.equal(fs.existsSync(lockPath), false, '测试前置：仓库内不应存在 setup.lock');
  fs.writeFileSync(lockPath, '{"installedAt":"test"}\n', 'utf8');
  try {
    await withSetupServer(async (base) => {
      const redisBody = { redis: { mode: 'host', host: '127.0.0.1', port: 6399, database: 0 } };
      const res = await post(base, '/api/setup/test-redis', { token: TEST_TOKEN, body: redisBody });
      assert.equal(res.status, 404);

      const completeRes = await post(base, '/api/setup/complete', { token: TEST_TOKEN, body: {} });
      assert.equal(completeRes.status, 404);
    });
  } finally {
    fs.unlinkSync(lockPath);
  }
});

test('POST 安装令牌要求同源，使用 HTTPS Cookie 授权后状态同步', async () => {
  await withSetupServer(async (base) => {
    const authorizeUrl = `${base}/api/setup/authorize`;
    const headers = { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-Proto': 'https' };
    const status = (headers) => fetch(`${base}/api/setup/status`, { headers }).then((res) => res.json());
    assert.equal((await status()).setupAuthorized, false);
    let res = await fetch(authorizeUrl, {
      method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: JSON.stringify({ token: TEST_TOKEN }),
    });
    assert.equal(res.status, 403);
    res = await fetch(authorizeUrl, { method: 'POST', headers, body: JSON.stringify({ token: 'wrong' }) });
    assert.equal(res.status, 403);
    assert.equal(res.headers.has('set-cookie'), false);

    res = await fetch(authorizeUrl, { method: 'POST', headers, body: JSON.stringify({ token: TEST_TOKEN }) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; Secure/);
    assert.equal((await status({ Cookie: cookie.split(';')[0] })).setupAuthorized, true);
  });
});

test('GET 安装令牌授权超过尝试上限后返回 429', async () => {
  await withSetupServer(async (base) => {
    const url = `${base}/api/setup/authorize?token=wrong`;
    for (let i = 0; i < 10; i += 1) {
      const response = await fetch(url, { redirect: 'manual', headers: { 'X-Forwarded-For': '203.0.113.10' } });
      assert.equal(response.status, 403);
      await response.json();
    }
    const response = await fetch(url, { redirect: 'manual', headers: { 'X-Forwarded-For': '203.0.113.10' } });
    assert.equal(response.status, 429);
    assert.equal(response.headers.has('set-cookie'), false);
  });
});
