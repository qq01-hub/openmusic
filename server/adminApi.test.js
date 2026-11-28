import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const ADMIN_USER = 'testadmin';
const ADMIN_PASSWORD = 'correct-horse-9';
const CREDENTIALS_KEY = 'openmusic:admin:credentials';

const { createFakeRedis } = await import('./testFakeRedis.js');
const fake = createFakeRedis();

const { _setRoomStorageClientForTests } = await import('./roomStorage.js');
_setRoomStorageClientForTests(fake);

// 先种入管理员凭据记录，再走正式 init 路径加载（scrypt 口径与 adminCredentials 一致）
const salt = randomBytes(16).toString('hex');
const hash = (await scrypt(ADMIN_PASSWORD, salt, 32)).toString('hex');
await fake.set(CREDENTIALS_KEY, JSON.stringify({
  username: ADMIN_USER, salt, hash, updatedAt: Date.now(), mustChange: false,
}));
const { initAdminCredentials, isAdminEnabled } = await import('./adminCredentials.js');
await initAdminCredentials();
assert.equal(isAdminEnabled(), true, '测试前置：管理员凭据应已启用');

const express = (await import('express')).default;
const { mountAdminApi } = await import('./adminApi.js');

async function withAdminServer(run) {
  const app = express();
  app.use(express.json());
  mountAdminApi(app, {
    io: { engine: { clientsCount: 0 }, sockets: { sockets: new Map() } },
    socketToRoom: new Map(),
    socketToUserId: new Map(),
    // 每个用例用独立 IP 隔离进程内登录限流/锁定状态
    getClientIp: (req) => String(req.headers['x-test-ip'] || '127.0.0.1'),
    issueOAuthState: async () => { throw new Error('not used'); },
    deleteAccount: async () => { throw new Error('not used'); },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(base, pathName, { method = 'GET', ip, cookie, body } = {}) {
  const headers = { 'x-test-ip': ip || '10.0.0.1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  return fetch(`${base}${pathName}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function login(base, ip) {
  const res = await request(base, '/api/admin/login', {
    method: 'POST',
    ip,
    body: { username: ADMIN_USER, password: ADMIN_PASSWORD },
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/om_admin_sid=[^;]+/);
  assert.ok(match, '登录应下发 om_admin_sid Cookie');
  return match[0];
}

test('未登录访问受保护接口一律 401（session/overview/audit/rooms）', async () => {
  await withAdminServer(async (base) => {
    for (const pathName of ['/api/admin/session', '/api/admin/overview', '/api/admin/audit', '/api/admin/rooms']) {
      const res = await request(base, pathName, { ip: '10.1.0.1' });
      assert.equal(res.status, 401, pathName);
      assert.match((await res.json()).error, /未登录/);
    }
    const bogus = await request(base, '/api/admin/overview', { ip: '10.1.0.1', cookie: 'om_admin_sid=bogus-session-id' });
    assert.equal(bogus.status, 401, '伪造会话 Cookie 应被拒');
  });
});

test('gate 入口校验：配置路径命中、随机路径不命中（不泄露真实入口）', async () => {
  await withAdminServer(async (base) => {
    // 仓库无 adminConfig.json 时配置入口为默认 /admin
    const hit = await request(base, '/api/admin/gate', { method: 'POST', ip: '10.2.0.1', body: { path: '/admin' } });
    assert.equal(hit.status, 200);
    assert.equal((await hit.json()).match, true);

    const miss = await request(base, '/api/admin/gate', { method: 'POST', ip: '10.2.0.1', body: { path: '/x7k9-random-entry' } });
    assert.equal(miss.status, 200, '不命中也返回 200 + match:false，不以 404 泄露启用态');
    assert.equal((await miss.json()).match, false);
  });
});

test('登录成功后会话可访问代表性管理路由，登出后立即失效', async () => {
  await withAdminServer(async (base) => {
    const ip = '10.3.0.1';
    const cookie = await login(base, ip);

    const session = await request(base, '/api/admin/session', { ip, cookie });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).ok, true);

    const overview = await request(base, '/api/admin/overview', { ip, cookie });
    assert.equal(overview.status, 200);
    const overviewBody = await overview.json();
    assert.equal(overviewBody.roomCount, 0);
    assert.equal(overviewBody.adminUsername, ADMIN_USER);

    const audit = await request(base, '/api/admin/audit', { ip, cookie });
    assert.equal(audit.status, 200);
    const auditBody = await audit.json();
    assert.ok(auditBody.items.some((entry) => entry.action === 'login_ok'), '审计应记录本次登录');

    const rooms = await request(base, '/api/admin/rooms', { ip, cookie });
    assert.equal(rooms.status, 200);

    const logout = await request(base, '/api/admin/logout', { method: 'POST', ip, cookie, body: {} });
    assert.equal(logout.status, 200);
    const after = await request(base, '/api/admin/overview', { ip, cookie });
    assert.equal(after.status, 401, '登出后旧会话应立即失效');
  });
});

test('登录失败锁定：连续 5 次失败触发锁定，锁定期间正确口令也被拒', async () => {
  await withAdminServer(async (base) => {
    const ip = '10.4.0.1';
    for (let i = 0; i < 4; i += 1) {
      const res = await request(base, '/api/admin/login', {
        method: 'POST', ip, body: { username: ADMIN_USER, password: 'wrong-password' },
      });
      assert.equal(res.status, 403, `第 ${i + 1} 次失败应为 403`);
      assert.match((await res.json()).error, /账号或密码错误/);
    }
    const fifth = await request(base, '/api/admin/login', {
      method: 'POST', ip, body: { username: ADMIN_USER, password: 'wrong-password' },
    });
    assert.equal(fifth.status, 429, '第 5 次失败应触发锁定');
    const fifthBody = await fifth.json();
    assert.ok(fifthBody.retryAfterSec >= 1 && fifthBody.retryAfterSec <= 60);

    const during = await request(base, '/api/admin/login', {
      method: 'POST', ip, body: { username: ADMIN_USER, password: ADMIN_PASSWORD },
    });
    assert.equal(during.status, 429, '锁定期间即使口令正确也应被拒');
  });
});

test('错误口令与未知用户返回统一 403，不泄露后台启用态', async () => {
  await withAdminServer(async (base) => {
    const res = await request(base, '/api/admin/login', {
      method: 'POST', ip: '10.5.0.1', body: { username: 'nobody', password: 'whatever-123' },
    });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: '账号或密码错误' });
  });
});
