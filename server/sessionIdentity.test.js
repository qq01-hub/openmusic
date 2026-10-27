import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { shouldIssueGuestHandoff, shouldMigrateFavorites } from './sessionIdentity.js';

test('同一稳定房间身份重新登录时仍需签发游客收藏迁移凭证', () => {
  assert.equal(shouldIssueGuestHandoff({ userId: 'guest_same' }, 'guest_same', true), true);
});

test('登录切换到新的房间身份时迁移旧身份的 Redis 收藏', () => {
  assert.equal(shouldMigrateFavorites({ userId: 'guest_old' }, 'account_new', false), true);
  assert.equal(shouldMigrateFavorites({ userId: 'same_user' }, 'same_user'), false);
  assert.equal(shouldMigrateFavorites(null, 'account_new'), false);
});

test('切换账户时不能把前一个账户的收藏迁入新账户', () => {
  assert.equal(shouldMigrateFavorites({ userId: 'account_old' }, 'account_new', true), false);
});

test('账户会话虽已过期，已绑定账户的房间身份仍不能作为游客迁移', () => {
  assert.equal(shouldMigrateFavorites({ userId: 'account_old' }, 'account_new', false, true), false);
});

test('已绑定其他账户的源身份不能获得游客本地补迁移凭证', () => {
  assert.equal(shouldIssueGuestHandoff({ userId: 'account_old' }, 'account_new', false, true), false);
  assert.equal(shouldIssueGuestHandoff({ userId: 'guest_same' }, 'guest_same', false, true), true);
});

function guestBootstrapFixture() {
  const deviceId = 'guest_device_123';
  const originalUserId = 'guest_original_123';
  const records = new Map([[`openmusic:device:${deviceId}`, originalUserId]]);
  let unavailable = false;
  let writeFailed = false;
  let issued = 0;
  let created = 0;
  let bootstrap;
  const redis = {
    get: async (key) => {
      if (unavailable) throw new Error('offline');
      return records.get(key) ?? null;
    },
    set: async (key, value) => {
      if (writeFailed) throw new Error('write failed');
      records.set(key, value);
    },
    sAdd: async () => {}, sRem: async () => {}, expire: async () => {},
    sMembers: async () => [deviceId],
  };
  const context = vm.createContext({
    getRedisClient: () => redis, isRedisEnabled: () => true,
    console: { error() {} },
    app: { post: (_path, handler) => { bootstrap = handler; } },
    getRequestIp: () => '127.0.0.1',
    limitSessionBootstrap: () => true, limitNewSessionBootstrap: () => true,
    resolveDeviceIdFromCookieHeader: (cookie) => cookie ? deviceId : '',
    resolveBodyDeviceId: (req) => req.body?.deviceId || '',
    resolveIdentityFromRequest: (req) => req.identity || null,
    resolveAccountFromRequest: async () => null,
    SESSION_RENEW_WITHIN_SEC: 3600,
    createServerClientId: () => { created += 1; return 'guest_new_123'; },
    signClientId: () => 'fixture-signature',
    incrementMetric() {},
    sendBootstrapResponse: (res, userId) => { issued += 1; return res.json({ clientId: userId }); },
  });
  const deviceSource = readFileSync(new URL('./deviceIdentity.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/m, '').replace(/\bexport /g, '');
  vm.runInContext(deviceSource, context);
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/session/bootstrap'");
  vm.runInContext(source.slice(start, source.indexOf('// ---------- 普通用户账户', start)), context);
  return {
    context, records, deviceId, originalUserId,
    setUnavailable: (value) => { unavailable = value; },
    setWriteFailed: (value) => { writeFailed = value; },
    issued: () => issued, created: () => created,
    request: async (req = { headers: { cookie: 'present' } }) => {
      const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await bootstrap(req, res);
      return res;
    },
  };
}

test('游客设备恢复遇到 Redis 故障时不创建新身份，恢复后仍读取原身份', async () => {
  const fixture = guestBootstrapFixture();
  fixture.setUnavailable(true);
  const failed = await fixture.request();
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.code, 'SESSION_STORAGE_UNAVAILABLE');
  assert.equal(fixture.issued(), 0);
  assert.equal(fixture.created(), 0);
  assert.equal(fixture.records.get(`openmusic:device:${fixture.deviceId}`), fixture.originalUserId);
  fixture.setUnavailable(false);
  const restored = await fixture.request();
  assert.equal(restored.body.clientId, fixture.originalUserId);
});

test('新游客身份未持久化时不签发 Cookie，也不留进程内绑定', async () => {
  const fixture = guestBootstrapFixture();
  fixture.records.clear();
  fixture.setWriteFailed(true);
  const failed = await fixture.request();
  assert.equal(failed.statusCode, 503);
  assert.equal(fixture.issued(), 0);
  assert.equal(fixture.context.getDeviceIdsForUser('guest_new_123').length, 0);
  fixture.setWriteFailed(false);
  const retried = await fixture.request();
  assert.equal(retried.statusCode, 200);
  assert.equal(fixture.records.get(`openmusic:device:${fixture.deviceId}`), retried.body.clientId);
});

test('无可信设备 Cookie 时不能使用 body 中的设备标识找回他人游客身份', async () => {
  const fixture = guestBootstrapFixture();
  const result = await fixture.request({ headers: {}, body: { deviceId: fixture.deviceId } });
  assert.equal(result.statusCode, 200);
  assert.notEqual(result.body.clientId, fixture.originalUserId);
  assert.equal(fixture.records.get(`openmusic:device:${fixture.deviceId}`), fixture.originalUserId);
});
