import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountAuthService } from './accountAuth.js';

function createReadStore(entries = []) {
  const values = new Map(entries);
  return { get: async (key) => values.get(key) ?? null };
}

test('按房间身份反查账户所有者，不能把会话过期的账户身份当游客', async () => {
  const ownerId = 'acct_aaaaaaaaaaaaaaaa';
  const service = createAccountAuthService({
    getStore: () => createReadStore([
      ['openmusic:account:room-identity:account_room_123', ownerId],
    ]),
    isStoreReady: () => true,
  });

  assert.equal(await service.getRoomIdentityOwnerAccountId('account_room_123'), ownerId);
  assert.equal(await service.getRoomIdentityOwnerAccountId('guest_room_123'), null);
});

function createMemoryAuthStore() {
  const values = new Map();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value, options = {}) => {
      if (options?.NX && values.has(key)) return null;
      values.set(key, String(value));
      return 'OK';
    },
    del: async (key) => {
      const keys = Array.isArray(key) ? key : [key];
      let removed = 0;
      for (const item of keys) {
        if (values.delete(item)) removed += 1;
      }
      return removed;
    },
    incr: async (key) => {
      const next = Number(values.get(key) || '0') + 1;
      values.set(key, String(next));
      return next;
    },
    eval: async (script, { keys = [], arguments: args = [] } = {}) => {
      if (script.includes('__ACCOUNT_ID_COLLISION__')) {
        const existing = values.get(keys[0]);
        if (existing) return existing;
        if (values.has(keys[1])) return '__ACCOUNT_ID_COLLISION__';
        values.set(keys[0], args[0]);
        values.set(keys[1], args[1]);
        return args[0];
      }
      if (script.includes('if redis.call(\'EXISTS\', KEYS[1]) == 1 then return 0 end')) {
        if (values.has(keys[0])) return 0;
        values.set(keys[0], args[0]);
        values.set(keys[1], args[1]);
        return 1;
      }
      if (script.includes('if tonumber(redis.call(\'GET\', KEYS[4]) or \'0\') > 5 then return -2 end')) {
        const owner = values.get(keys[0]);
        if (owner && owner !== args[0]) return -1;
        if (values.get(keys[2]) !== args[2]) return -2;
        if (Number(values.get(keys[3]) || '0') > 5) return -2;
        if (values.get(keys[1]) !== args[1]) return 0;
        values.set(keys[0], args[0]);
        values.set(keys[1], args[3]);
        values.delete(keys[2]);
        values.delete(keys[3]);
        return 1;
      }
      if (script.includes('redis.call(\'DEL\', KEYS[1])')) {
        const owner = values.get(keys[0]);
        if (owner && owner !== args[0]) return -1;
        if (values.get(keys[1]) !== args[1]) return -2;
        values.delete(keys[0]);
        values.set(keys[1], args[2]);
        return 1;
      }
      throw new Error(`Unexpected script: ${script}`);
    },
  };
}

test('第三方登录创建的账户可后补绑定邮箱与密码，并支持使用绑定邮箱登录或解绑第三方身份', async () => {
  const store = createMemoryAuthStore();
  const sentCodes = [];
  let idCounter = 0;
  const service = createAccountAuthService({
    getStore: () => store,
    isStoreReady: () => true,
    sendCode: async (payload) => { sentCodes.push(payload); },
    randomId: () => `test_account_${String(++idCounter).padStart(8, '0')}`,
    randomInt: () => 123456,
  });

  const { account: wechatAccount, created } = await service.loginOrRegisterExternalIdentity({
    provider: 'wechat',
    subject: 'wx_filehelper_user_1',
    profile: { username: '微信用户' },
  });
  assert.equal(created, true);
  assert.equal(service.publicAccount(wechatAccount).hasPassword, false);
  assert.equal(service.publicAccount(wechatAccount).email, null);

  await service.requestEmailBindCode(wechatAccount.id, { email: 'binduser@qq.com' });
  assert.equal(sentCodes.length, 1);
  assert.equal(sentCodes[0].purpose, 'bind');
  assert.equal(sentCodes[0].code, '123456');

  const { account: otherAccount } = await service.loginOrRegisterExternalIdentity({
    provider: 'github',
    subject: 'gh_user_2',
    profile: { username: 'gh2' },
  });
  await assert.rejects(
    () => service.bindEmailWithPassword(otherAccount.id, {
      email: 'binduser@qq.com',
      password: 'Password123!',
      code: '123456',
    }),
    (err) => err?.code === 'INVALID_EMAIL_CODE',
  );

  const bound = await service.bindEmailWithPassword(wechatAccount.id, {
    email: 'binduser@qq.com',
    password: 'Password123!',
    code: '123456',
  });
  const publicBound = service.publicAccount(bound);
  assert.equal(publicBound.email, 'binduser@qq.com');
  assert.equal(publicBound.hasPassword, true);
  assert.equal(publicBound.identities.length, 2);

  await assert.rejects(
    () => service.requestEmailBindCode(wechatAccount.id, { email: 'another@qq.com' }),
    (err) => err?.code === 'EMAIL_ALREADY_BOUND',
  );
  await assert.rejects(
    () => service.requestEmailBindCode(otherAccount.id, { email: 'binduser@qq.com' }),
    (err) => err?.code === 'EMAIL_ALREADY_REGISTERED',
  );

  const loggedIn = await service.loginWithEmail({
    email: 'binduser@qq.com',
    password: 'Password123!',
  });
  assert.equal(loggedIn.id, wechatAccount.id);

  const afterUnbind = await service.unbindExternalIdentity(wechatAccount.id, 'wechat');
  assert.equal(service.publicAccount(afterUnbind).identities.length, 1);
  assert.equal(service.publicAccount(afterUnbind).identities[0].provider, 'email');

  await assert.rejects(
    () => service.requestPasswordResetCode({ email: 'not_registered@qq.com' }),
    (err) => err?.code === 'EMAIL_NOT_REGISTERED' && err?.message === '该邮箱未注册' && err?.status === 404,
  );
});
