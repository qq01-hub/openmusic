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
  const service = createAccountAuthService({
    getStore: () => store,
    isStoreReady: () => true,
    now: () => now,
    randomId: () => 'a'.repeat(24),
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
