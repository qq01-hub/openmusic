import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AccountAuthError,
  createAccountAuthService,
  normalizeEmail,
  validatePassword,
} from './accountAuth.js';

class FakeRedis {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async set(key, value, options = {}) {
    if (options.NX && this.values.has(key)) return null;
    this.values.set(key, String(value));
    return 'OK';
  }

  async del(key) {
    return this.values.delete(key) ? 1 : 0;
  }

  async incr(key) {
    const next = (Number(this.values.get(key)) || 0) + 1;
    this.values.set(key, String(next));
    return next;
  }

  async eval(_script, { keys, arguments: args }) {
    if (_script.includes("redis.call('GET', KEYS[1]) ~= ARGV[1]")) {
      if ((this.values.get(keys[0]) ?? null) !== args[0]) return -1;
      const owner = this.values.get(keys[1]);
      if (owner && owner !== args[1]) return -2;
      this.values.set(keys[1], String(args[1]));
      this.values.set(keys[2], String(args[1]));
      this.values.set(keys[0], String(args[2]));
      return 1;
    }
    if (_script.includes("owner and owner ~= ARGV[1]")) {
      const owner = this.values.get(keys[0]);
      if (owner && owner !== args[0]) return -1;
      if ((this.values.get(keys[1]) ?? null) !== args[1]) return -2;
      if (_script.includes("redis.call('DEL', KEYS[1])")) this.values.delete(keys[0]);
      else this.values.set(keys[0], String(args[0]));
      this.values.set(keys[1], String(args[2]));
      return 1;
    }
    if (_script.includes('__ACCOUNT_ID_COLLISION__')) {
      const existing = this.values.get(keys[0]);
      if (existing) return existing;
      if (this.values.has(keys[1])) return '__ACCOUNT_ID_COLLISION__';
      this.values.set(keys[0], String(args[0]));
      this.values.set(keys[1], String(args[1]));
      return args[0];
    }
    if (this.values.has(keys[0])) return 0;
    this.values.set(keys[0], String(args[0]));
    this.values.set(keys[1], String(args[1]));
    return 1;
  }
}

function createTestService() {
  const store = new FakeRedis();
  const sent = [];
  let now = 1_700_000_000_000;
  let idCounter = 0;
  const service = createAccountAuthService({
    getStore: () => store,
    isStoreReady: () => true,
    now: () => now,
    randomId: () => `${'a'.repeat(20)}${String(++idCounter).padStart(4, '0')}`,
    randomInt: () => 123456,
    sendCode: async (message) => {
      sent.push(message);
    },
  });
  return {
    service,
    sent,
    advance(ms) {
      now += ms;
    },
  };
}

test('邮箱和密码基础校验', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(normalizeEmail('not-an-email'), '');
  assert.equal(validatePassword('12345678'), true);
  assert.equal(validatePassword('short'), false);
});

test('验证码注册、登录和会话注销闭环', async () => {
  const { service, sent } = createTestService();
  const email = 'user@example.com';

  const codeResult = await service.requestEmailRegistrationCode({ email });
  assert.equal(codeResult.expiresInSec > 0, true);
  assert.deepEqual(sent, [{ email, code: '123456' }]);

  const account = await service.registerWithEmail({ email, password: 'correct-horse', code: '123456' });
  assert.match(account.id, /^acct_/u);
  assert.equal(account.email, email);
  assert.equal(account.password.hash.length > 0, true);

  const publicProfile = service.publicAccount(account);
  assert.deepEqual(publicProfile, {
    id: account.id,
    email,
    emailVerifiedAt: account.createdAt,
    hasPassword: true,
    identities: [{
      provider: 'email',
      username: '',
      avatarUrl: '',
      linkedAt: account.createdAt,
    }],
    createdAt: account.createdAt,
  });
  assert.equal(Object.hasOwn(publicProfile, 'password'), false);

  await assert.rejects(
    () => service.requestEmailRegistrationCode({ email }),
    (error) => error instanceof AccountAuthError && error.code === 'EMAIL_ALREADY_REGISTERED',
  );

  await assert.rejects(
    () => service.loginWithEmail({ email, password: 'wrong-password' }),
    (error) => error instanceof AccountAuthError && error.code === 'AUTH_INVALID',
  );
  const loggedIn = await service.loginWithEmail({ email, password: 'correct-horse' });
  assert.equal(loggedIn.id, account.id);

  const token = await service.createSession(account.id);
  const sessionAccount = await service.resolveSession(token);
  assert.equal(sessionAccount.id, account.id);
  assert.equal(await service.revokeSession(token), true);
  assert.equal(await service.resolveSession(token), null);
});

test('第三方登录按 provider 与 subject 创建和复用账户，不按邮箱合并', async () => {
  const { service } = createTestService();
  await service.requestEmailRegistrationCode({ email: 'same@example.com' });
  const emailAccount = await service.registerWithEmail({
    email: 'same@example.com',
    password: 'correct-horse',
    code: '123456',
  });
  const first = await service.loginOrRegisterExternalIdentity({
    provider: 'github',
    subject: '10001',
    profile: { username: 'octocat', avatarUrl: 'https://example.com/avatar.png', email: 'same@example.com' },
  });
  assert.equal(first.created, true);
  assert.equal(first.account.email, null);
  assert.notEqual(first.account.id, emailAccount.id);

  const second = await service.loginOrRegisterExternalIdentity({
    provider: 'github',
    subject: '10001',
    profile: { username: 'changed' },
  });
  assert.equal(second.created, false);
  assert.equal(second.account.id, first.account.id);
});

test('一个账户可绑定多个提供方，已属于其他账户的身份不能被抢绑', async () => {
  const { service } = createTestService();
  await service.requestEmailRegistrationCode({ email: 'owner@example.com' });
  const owner = await service.registerWithEmail({
    email: 'owner@example.com',
    password: 'correct-horse',
    code: '123456',
  });
  const other = await service.loginOrRegisterExternalIdentity({
    provider: 'github',
    subject: 'already-owned',
    profile: { username: 'other' },
  });

  await service.bindExternalIdentity(owner.id, {
    provider: 'linuxdo',
    subject: 'linuxdo-owner',
    profile: { username: 'linuxdo-user' },
  });
  const account = await service.bindExternalIdentity(owner.id, {
    provider: 'github',
    subject: 'github-owner',
    profile: { username: 'github-user' },
  });
  assert.deepEqual(account.identities.map((identity) => identity.provider).sort(), ['email', 'github', 'linuxdo']);

  await assert.rejects(
    () => service.bindExternalIdentity(owner.id, {
      provider: 'github',
      subject: 'already-owned',
      profile: { username: 'other' },
    }),
    (error) => error instanceof AccountAuthError && error.code === 'PROVIDER_ALREADY_BOUND',
  );
  await assert.rejects(
    () => service.bindExternalIdentity(other.account.id, {
      provider: 'linuxdo',
      subject: 'linuxdo-owner',
      profile: { username: 'linuxdo-user' },
    }),
    (error) => error instanceof AccountAuthError && error.code === 'IDENTITY_ALREADY_BOUND',
  );
});

test('解绑会保留至少一种登录方式，并清理身份索引', async () => {
  const { service } = createTestService();
  const created = await service.loginOrRegisterExternalIdentity({
    provider: 'github',
    subject: 'solo',
    profile: { username: 'solo' },
  });
  await assert.rejects(
    () => service.unbindExternalIdentity(created.account.id, 'github'),
    (error) => error instanceof AccountAuthError && error.code === 'LAST_LOGIN_METHOD',
  );

  await service.bindExternalIdentity(created.account.id, {
    provider: 'linuxdo',
    subject: 'backup',
    profile: { username: 'backup' },
  });
  const afterUnbind = await service.unbindExternalIdentity(created.account.id, 'github');
  assert.deepEqual(afterUnbind.identities.map((identity) => identity.provider), ['linuxdo']);

  const newGithubAccount = await service.loginOrRegisterExternalIdentity({
    provider: 'github',
    subject: 'solo',
    profile: { username: 'new-owner' },
  });
  assert.notEqual(newGithubAccount.account.id, created.account.id);
});

test('账户首次登录继承游客身份，后续登录恢复同一房间身份', async () => {
  const { service } = createTestService();
  const created = await service.loginOrRegisterExternalIdentity({
    provider: 'wechat',
    subject: 'uin-1',
    profile: { username: '微信用户' },
  });

  const adopted = await service.ensureRoomUserId(created.account.id, 'guest-user-1');
  assert.equal(adopted, 'guest-user-1');
  assert.equal(await service.ensureRoomUserId(created.account.id, 'guest-user-2'), 'guest-user-1');

  const second = await service.loginOrRegisterExternalIdentity({
    provider: 'wechat',
    subject: 'uin-2',
    profile: { username: '另一个微信用户' },
  });
  const other = await service.ensureRoomUserId(second.account.id, 'guest-user-1');
  assert.notEqual(other, 'guest-user-1');
});

test('验证码错误会计数并在超过尝试次数后失效', async () => {
  const { service } = createTestService();
  const email = 'another@example.com';
  await service.requestEmailRegistrationCode({ email });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      () => service.registerWithEmail({ email, password: 'correct-horse', code: '000000' }),
      (error) => error instanceof AccountAuthError && error.code === 'INVALID_EMAIL_CODE',
    );
  }

  await assert.rejects(
    () => service.registerWithEmail({ email, password: 'correct-horse', code: '123456' }),
    (error) => error instanceof AccountAuthError && error.code === 'INVALID_EMAIL_CODE',
  );
});
