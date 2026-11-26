import { evalRedisScript } from './redisScripts.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  DEVICE_BINDING_TTL_SEC,
  GUEST_ACTIVE_BINDING_TTL_SEC,
  GUEST_INITIAL_BINDING_TTL_SEC,
} from './deviceIdentity.js';
import {
  CLIENT_NETWORK_BINDING_TTL_SEC,
  GUEST_CLIENT_NETWORK_BINDING_TTL_SEC,
  createClientNetworkBindingStore,
} from './clientIpBinding.js';
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

function guestBootstrapFixture({
  anonymousLoginEnabled = true,
  limitSession = () => true,
  limitNewSession = () => true,
} = {}) {
  const deviceId = 'guest_device_123';
  const originalUserId = 'guest_original_123';
  const records = new Map([[`openmusic:device:${deviceId}`, originalUserId]]);
  const sets = new Map([[`openmusic:user_devices:${originalUserId}`, new Set([deviceId])]]);
  const ttls = new Map([[`openmusic:device:${deviceId}`, GUEST_INITIAL_BINDING_TTL_SEC]]);
  const recordedTtls = [];
  const audits = [];
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
    eval: async (script, { keys, arguments: args }) => {
      if (unavailable) throw new Error('offline');
      if (script.includes("redis.call('SMEMBERS', KEYS[1])")) {
        const set = sets.get(keys[0]) || new Set();
        let removed = 0;
        for (const did of set) {
          const devKey = `${args[1]}${did}`;
          if (records.get(devKey) === args[0]) {
            records.delete(devKey);
            ttls.delete(devKey);
            removed += 1;
          }
          records.delete(`${args[2]}${args[0]}:${did}`);
        }
        sets.delete(keys[0]);
        return removed;
      }
      if (script.includes("redis.call('DEL', KEYS[1])")) {
        const owner = records.get(keys[0]);
        records.delete(keys[0]);
        ttls.delete(keys[0]);
        if (owner) {
          const setKey = `${args[1]}${owner}`;
          const set = sets.get(setKey);
          if (set) {
            set.delete(args[0]);
            if (set.size === 0) sets.delete(setKey);
          }
          records.delete(`${args[2]}${owner}:${args[0]}`);
        }
        return 1;
      }
      if (keys.length === 1) {
        const owner = await redis.get(keys[0]);
        if (owner) {
          const renew = Number(args[0] || 0);
          const fallbackTtl = Number(args[2] || 0);
          const currentTtl = ttls.has(keys[0]) ? ttls.get(keys[0]) : -1;
          if (renew > 0 && (currentTtl < 0 || currentTtl < renew)) {
            ttls.set(keys[0], renew);
          } else if (renew === 0 && currentTtl === -1 && fallbackTtl > 0) {
            ttls.set(keys[0], fallbackTtl);
          }
        }
        return owner;
      }
      assert.equal(keys.length, 2, '设备换绑脚本应包含正向与反向键');
      await redis.set(keys[0], args[1]);
      const ttlSec = Number(args[2]);
      ttls.set(keys[0], ttlSec);
      const set = sets.get(keys[1]) || new Set();
      set.add(args[0]);
      sets.set(keys[1], set);
      recordedTtls.push({ key: keys[0], ttlSec });
      return 1;
    },
    sAdd: async () => {}, sRem: async () => {}, expire: async () => {},
    sMembers: async (key) => Array.from(sets.get(key) || []),
  };
  const context = vm.createContext({
    evalRedisScript, getRedisClient: () => redis, isRedisEnabled: () => true,
    console: { error() {} },
    app: { post: (_path, handler) => { bootstrap = handler; } },
    getRequestIp: () => '127.0.0.1',
    limitSessionBootstrap: limitSession, limitNewSessionBootstrap: limitNewSession,
    SOFT_BLOCK_CODES: { SESSION_BOOTSTRAP_LIMIT: 'E_BOOT', SESSION_NEW_LIMIT: 'E_NEW' },
    setSoftBlockHeaders: () => {},
    softBlockPayload: (code) => ({ error: code, code }),
    appendAdminAudit: (action, detail, ip) => { audits.push({ action, detail, ip }); },
    resolveDeviceIdFromCookieHeader: (cookie) => cookie ? deviceId : '',
    resolveBodyDeviceId: (req) => req.body?.deviceId || '',
    resolveIdentityFromRequest: (req) => req.identity || null,
    resolveAccountFromRequest: async () => null,
    getRoomIdentityOwnerAccountId: async () => null,
    getRuntimeConfig: () => ({ anonymousLoginEnabled }),
    SESSION_RENEW_WITHIN_SEC: 3600,
    createServerClientId: () => { created += 1; return 'guest_new_123'; },
    signClientId: () => 'fixture-signature',
    incrementMetric() {},
    sendBootstrapResponse: (res, userId) => { issued += 1; return res.json({ clientId: userId }); },
  });
  const deviceSource = readFileSync(new URL('./deviceIdentity.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
  vm.runInContext(deviceSource, context);
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const start = source.indexOf('const SESSION_BLOCK_AUDIT_COOLDOWN_MS');
  vm.runInContext(source.slice(start, source.indexOf('// ---------- 普通用户账户', start)), context);
  return {
    context, records, sets, ttls, recordedTtls, audits, deviceId, originalUserId,
    setUnavailable: (value) => { unavailable = value; },
    setWriteFailed: (value) => { writeFailed = value; },
    issued: () => issued, created: () => created,
    request: async (req = { headers: { cookie: 'present' } }) => {
      const res = {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
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
  assert.equal(fixture.recordedTtls.at(-1)?.ttlSec, GUEST_INITIAL_BINDING_TTL_SEC);
});

test('首次陌生游客使用 3 天短期绑定，回访恢复后使用 30 天活跃游客绑定而非 180 天', async () => {
  const fixture = guestBootstrapFixture();
  const returning = await fixture.request({ headers: { cookie: 'present' } });
  assert.equal(returning.statusCode, 200);
  assert.equal(fixture.recordedTtls.at(-1)?.ttlSec, GUEST_ACTIVE_BINDING_TTL_SEC);
  assert.ok(GUEST_ACTIVE_BINDING_TTL_SEC < DEVICE_BINDING_TTL_SEC);

  fixture.records.clear();
  const fresh = await fixture.request({ headers: {} });
  assert.equal(fresh.statusCode, 200);
  assert.equal(fixture.recordedTtls.at(-1)?.ttlSec, GUEST_INITIAL_BINDING_TTL_SEC);
  assert.ok(GUEST_INITIAL_BINDING_TTL_SEC < GUEST_ACTIVE_BINDING_TTL_SEC);
});

test('关闭游客登录后未登录 bootstrap 直接返回 loginRequired，不写 Redis 键也不产生限流审计', async () => {
  const fixture = guestBootstrapFixture({ anonymousLoginEnabled: false });
  fixture.records.clear();
  const res = await fixture.request({ headers: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.authenticated, false);
  assert.equal(res.body?.loginRequired, true);
  assert.equal(fixture.records.size, 0);
  assert.equal(fixture.recordedTtls.length, 0);
  assert.equal(fixture.issued(), 0);
  assert.equal(fixture.created(), 0);
  assert.equal(fixture.audits.length, 0);
});

test('bootstrap 限流审计按 IP 与原因 5 分钟节流，防止 session_blocked 刷满审计列表', async () => {
  const fixture = guestBootstrapFixture({ anonymousLoginEnabled: false, limitSession: () => false });
  const first = await fixture.request({ headers: {} });
  const second = await fixture.request({ headers: {} });
  assert.equal(first.statusCode, 500);
  assert.equal(second.statusCode, 500);
  assert.equal(fixture.audits.length, 1);
  assert.equal(fixture.audits[0].action, 'session_blocked');
});

test('读取设备绑定默认不把 3 天游客静默续期为 180 天，且能修复 TTL=-1 与完整解绑', async () => {
  const fixture = guestBootstrapFixture();
  const uid = await fixture.context.getUserIdForDevice(fixture.deviceId, { authoritative: true });
  assert.equal(uid, fixture.originalUserId);
  assert.equal(fixture.ttls.get(`openmusic:device:${fixture.deviceId}`), GUEST_INITIAL_BINDING_TTL_SEC);

  fixture.ttls.set(`openmusic:device:${fixture.deviceId}`, -1);
  await fixture.context.getUserIdForDevice(fixture.deviceId, { authoritative: true });
  assert.equal(fixture.ttls.get(`openmusic:device:${fixture.deviceId}`), GUEST_ACTIVE_BINDING_TTL_SEC);

  fixture.records.set(`openmusic:client_network_binding:${fixture.originalUserId}:${fixture.deviceId}`, '{"ip":"1.2.3.4"}');
  assert.equal(await fixture.context.unlinkDevice(fixture.deviceId), true);
  assert.equal(fixture.records.has(`openmusic:device:${fixture.deviceId}`), false);
  assert.equal(fixture.records.has(`openmusic:client_network_binding:${fixture.originalUserId}:${fixture.deviceId}`), false);
  assert.equal(fixture.sets.has(`openmusic:user_devices:${fixture.originalUserId}`), false);

  await fixture.context.linkDeviceToUser(fixture.deviceId, fixture.originalUserId, { ttlSec: GUEST_INITIAL_BINDING_TTL_SEC });
  fixture.records.set(`openmusic:client_network_binding:${fixture.originalUserId}:${fixture.deviceId}`, '{"ip":"1.2.3.4"}');
  assert.equal(await fixture.context.unlinkAllDevicesForUser(fixture.originalUserId), 1);
  assert.equal(fixture.records.has(`openmusic:device:${fixture.deviceId}`), false);
  assert.equal(fixture.records.has(`openmusic:client_network_binding:${fixture.originalUserId}:${fixture.deviceId}`), false);
});

test('客户端网络绑定支持账户 30 天与游客 3 天分级 TTL', async () => {
  const writes = [];
  const values = new Map();
  const store = createClientNetworkBindingStore({
    getRedisClient: () => ({
      async get(key) { return values.get(key) ?? null; },
      async set(key, value, options) {
        writes.push({ key, options });
        if (!values.has(key)) values.set(key, value);
      },
    }),
  });
  await store.resolve({ userId: 'acct_user_123456', deviceId: 'dev_account_1234' }, { ip: '203.0.113.10', location: '上海' });
  await store.resolve(
    { userId: 'guest_user_12345', deviceId: 'dev_guest_123456' },
    { ip: '198.51.100.8', location: '新加坡' },
    { ttlSec: GUEST_CLIENT_NETWORK_BINDING_TTL_SEC },
  );
  assert.equal(writes[0].options.EX, CLIENT_NETWORK_BINDING_TTL_SEC);
  assert.equal(writes[1].options.EX, GUEST_CLIENT_NETWORK_BINDING_TTL_SEC);
});
