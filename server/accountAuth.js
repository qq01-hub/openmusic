import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { getRedisClient, isRedisEnabled } from './roomStorage.js';

const scrypt = promisify(scryptCallback);

export const ACCOUNT_SESSION_COOKIE = 'openmusic_account_session';
export const ACCOUNT_SESSION_TTL_SEC = Math.max(
  60 * 60,
  Number.parseInt(process.env.ACCOUNT_SESSION_TTL_SEC || String(60 * 60 * 24 * 90), 10)
    || 60 * 60 * 24 * 90,
);
export const EMAIL_CODE_TTL_SEC = Math.max(
  60,
  Number.parseInt(process.env.EMAIL_CODE_TTL_SEC || String(10 * 60), 10) || 10 * 60,
);
export const EMAIL_CODE_RESEND_INTERVAL_SEC = Math.max(
  10,
  Number.parseInt(process.env.EMAIL_CODE_RESEND_INTERVAL_SEC || '60', 10) || 60,
);
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const ACCOUNT_ID_PREFIX = 'acct_';
const ACCOUNT_KEY_PREFIX = 'openmusic:account:';
const EMAIL_INDEX_PREFIX = `${ACCOUNT_KEY_PREFIX}email:`;
const EMAIL_CODE_PREFIX = `${ACCOUNT_KEY_PREFIX}email-code:`;
const EMAIL_CODE_ATTEMPTS_PREFIX = `${ACCOUNT_KEY_PREFIX}email-code-attempts:`;
const EMAIL_CODE_COOLDOWN_PREFIX = `${ACCOUNT_KEY_PREFIX}email-code-cooldown:`;
const SESSION_PREFIX = `${ACCOUNT_KEY_PREFIX}session:`;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_OPTIONS = {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};
const CODE_HASH_SECRET = String(process.env.CLIENT_ID_SECRET || randomBytes(32).toString('hex'));

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export class AccountAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AccountAuthError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : '';
}

export function validatePassword(value) {
  const password = typeof value === 'string' ? value : String(value ?? '');
  if (password.length < 8 || password.length > 128) return false;
  return true;
}

function normalizeAccountId(value) {
  const id = String(value ?? '').trim();
  return /^acct_[a-zA-Z0-9_-]{16,64}$/u.test(id) ? id : '';
}

function accountKey(userId) {
  return `${ACCOUNT_KEY_PREFIX}${userId}`;
}

function emailHash(email) {
  return createHash('sha256').update(email).digest('hex');
}

function emailIndexKey(email) {
  return `${EMAIL_INDEX_PREFIX}${emailHash(email)}`;
}

function emailCodeKey(email) {
  return `${EMAIL_CODE_PREFIX}${emailHash(email)}`;
}

function emailCodeAttemptsKey(email) {
  return `${EMAIL_CODE_ATTEMPTS_PREFIX}${emailHash(email)}`;
}

function emailCodeCooldownKey(email) {
  return `${EMAIL_CODE_COOLDOWN_PREFIX}${emailHash(email)}`;
}

function sessionKey(token) {
  return `${SESSION_PREFIX}${createHash('sha256').update(String(token || '')).digest('hex')}`;
}

function createAccountId(randomId = () => randomBytes(24).toString('base64url')) {
  return `${ACCOUNT_ID_PREFIX}${randomId()}`;
}

function createVerificationCode(randomInt = () => randomBytes(4).readUInt32BE(0)) {
  return String(randomInt() % 1_000_000).padStart(6, '0');
}

function hashVerificationCode(email, code) {
  return createHmac('sha256', CODE_HASH_SECRET)
    .update(`${email}:${code}`)
    .digest('hex');
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const normalized = typeof password === 'string' ? password : String(password ?? '');
  const derived = await scrypt(normalized, salt, PASSWORD_KEY_LENGTH, PASSWORD_SCRYPT_OPTIONS);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

export async function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  try {
    const derived = await scrypt(
      typeof password === 'string' ? password : String(password ?? ''),
      String(record.salt),
      PASSWORD_KEY_LENGTH,
      PASSWORD_SCRYPT_OPTIONS,
    );
    return safeEqualText(Buffer.from(derived).toString('hex'), record.hash);
  } catch {
    return false;
  }
}

function publicAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    email: account.email,
    emailVerifiedAt: account.emailVerifiedAt,
    createdAt: account.createdAt,
  };
}

function getSmtpTransporter() {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;

  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10) || 587;
  const secure = process.env.SMTP_SECURE === '1'
    || process.env.SMTP_SECURE === 'true'
    || port === 465;
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');

  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user ? { auth: { user, pass } } : {}),
  });
}

async function sendRegistrationCodeBySmtp({ email, code }) {
  const transporter = getSmtpTransporter();
  if (!transporter) {
    throw new AccountAuthError('EMAIL_NOT_CONFIGURED', '邮箱服务未配置', 503);
  }

  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  if (!from) {
    throw new AccountAuthError('EMAIL_NOT_CONFIGURED', '邮箱发件人未配置', 503);
  }

  try {
    await transporter.sendMail({
      from,
      to: email,
      subject: 'OpenMusic 注册验证码',
      text: `你的 OpenMusic 注册验证码是：${code}\n验证码 ${Math.floor(EMAIL_CODE_TTL_SEC / 60)} 分钟内有效，请勿泄露给他人。`,
    });
  } catch (error) {
    throw new AccountAuthError('EMAIL_SEND_FAILED', '验证码发送失败，请稍后重试', 502, { cause: error });
  }
}

function ensureStore(getStore, isStoreReady) {
  if (!isStoreReady()) {
    throw new AccountAuthError('REDIS_UNAVAILABLE', '账户服务暂不可用，请稍后重试', 503);
  }
  const store = getStore();
  if (!store) {
    throw new AccountAuthError('REDIS_UNAVAILABLE', '账户服务暂不可用，请稍后重试', 503);
  }
  return store;
}

function parseStoredJson(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function createAccountAuthService({
  getStore = getRedisClient,
  isStoreReady = isRedisEnabled,
  sendCode = sendRegistrationCodeBySmtp,
  now = () => Date.now(),
  randomId,
  randomInt,
} = {}) {
  const createId = () => createAccountId(randomId);
  const createCode = () => createVerificationCode(randomInt);

  async function getAccountById(userId) {
    const id = normalizeAccountId(userId);
    if (!id) return null;
    const store = ensureStore(getStore, isStoreReady);
    return parseStoredJson(await store.get(accountKey(id)));
  }

  async function requestEmailRegistrationCode({ email: rawEmail } = {}) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new AccountAuthError('INVALID_EMAIL', '请输入有效的邮箱地址', 400);
    const store = ensureStore(getStore, isStoreReady);

    const existing = await store.get(emailIndexKey(email));
    if (existing) throw new AccountAuthError('EMAIL_ALREADY_REGISTERED', '该邮箱已注册，请直接登录', 409);

    const cooldown = await store.set(
      emailCodeCooldownKey(email),
      '1',
      { NX: true, EX: EMAIL_CODE_RESEND_INTERVAL_SEC },
    );
    if (cooldown !== 'OK') {
      throw new AccountAuthError('EMAIL_CODE_RATE_LIMITED', '验证码发送过于频繁，请稍后重试', 429);
    }

    const code = createCode();
    const record = {
      digest: hashVerificationCode(email, code),
      createdAt: now(),
    };

    try {
      await store.set(emailCodeKey(email), JSON.stringify(record), { EX: EMAIL_CODE_TTL_SEC });
      await store.set(emailCodeAttemptsKey(email), '0', { EX: EMAIL_CODE_TTL_SEC });
      await sendCode({ email, code });
    } catch (error) {
      await store.del(emailCodeKey(email));
      await store.del(emailCodeAttemptsKey(email));
      await store.del(emailCodeCooldownKey(email));
      throw error;
    }

    return { expiresInSec: EMAIL_CODE_TTL_SEC, resendAfterSec: EMAIL_CODE_RESEND_INTERVAL_SEC };
  }

  async function verifyEmailCode(store, email, code) {
    const key = emailCodeKey(email);
    const attemptsKey = emailCodeAttemptsKey(email);
    const record = parseStoredJson(await store.get(key));
    if (!record || !Number.isFinite(Number(record.createdAt))) {
      throw new AccountAuthError('INVALID_EMAIL_CODE', '验证码无效或已过期', 400);
    }

    const attempts = Number(await store.incr(attemptsKey));
    if (attempts > EMAIL_CODE_MAX_ATTEMPTS) {
      throw new AccountAuthError('INVALID_EMAIL_CODE', '验证码无效或已过期', 400);
    }

    const expected = hashVerificationCode(email, code);
    if (!safeEqualText(expected, record.digest)) {
      throw new AccountAuthError('INVALID_EMAIL_CODE', '验证码无效或已过期', 400);
    }

    return { codeKey: key, attemptsKey };
  }

  async function registerWithEmail({ email: rawEmail, password, code } = {}) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new AccountAuthError('INVALID_EMAIL', '请输入有效的邮箱地址', 400);
    if (!validatePassword(password)) {
      throw new AccountAuthError('INVALID_PASSWORD', '密码长度需为 8–128 位', 400);
    }
    const verificationCode = String(code ?? '').trim();
    if (!/^\d{6}$/u.test(verificationCode)) {
      throw new AccountAuthError('INVALID_EMAIL_CODE', '验证码无效或已过期', 400);
    }

    const store = ensureStore(getStore, isStoreReady);
    const verificationKeys = await verifyEmailCode(store, email, verificationCode);
    const existing = await store.get(emailIndexKey(email));
    if (existing) throw new AccountAuthError('EMAIL_ALREADY_REGISTERED', '该邮箱已注册，请直接登录', 409);

    const id = createId();
    const passwordRecord = await hashPassword(password);
    const createdAt = now();
    const account = {
      id,
      email,
      emailVerifiedAt: createdAt,
      password: passwordRecord,
      identities: [{ provider: 'email', subject: email, createdAt }],
      createdAt,
      updatedAt: createdAt,
    };

    // Redis Lua 保证“邮箱索引 + 账户记录”一次性写入，避免并发注册留下半成品。
    const result = await store.eval(
      `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end `
        + `redis.call('SET', KEYS[1], ARGV[1]) `
        + `redis.call('SET', KEYS[2], ARGV[2]) `
        + `return 1`,
      {
        keys: [emailIndexKey(email), accountKey(id)],
        arguments: [id, JSON.stringify(account)],
      },
    );
    if (Number(result) !== 1) {
      throw new AccountAuthError('EMAIL_ALREADY_REGISTERED', '该邮箱已注册，请直接登录', 409);
    }

    await store.del(verificationKeys.codeKey);
    await store.del(verificationKeys.attemptsKey);

    return account;
  }

  async function loginWithEmail({ email: rawEmail, password } = {}) {
    const email = normalizeEmail(rawEmail);
    if (!email || typeof password !== 'string' || password.length === 0) {
      throw new AccountAuthError('AUTH_INVALID', '邮箱或密码错误', 401);
    }
    const store = ensureStore(getStore, isStoreReady);
    const id = await store.get(emailIndexKey(email));
    const account = id ? parseStoredJson(await store.get(accountKey(id))) : null;
    const valid = Boolean(account) && await verifyPassword(password, account.password);
    if (!valid) throw new AccountAuthError('AUTH_INVALID', '邮箱或密码错误', 401);
    return account;
  }

  async function createSession(userId) {
    const account = await getAccountById(userId);
    if (!account) throw new AccountAuthError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
    const store = ensureStore(getStore, isStoreReady);
    const token = randomBytes(32).toString('base64url');
    await store.set(
      sessionKey(token),
      JSON.stringify({ userId: account.id, createdAt: now() }),
      { EX: ACCOUNT_SESSION_TTL_SEC },
    );
    return token;
  }

  async function resolveSession(token) {
    const rawToken = String(token || '').trim();
    if (!/^[a-zA-Z0-9_-]{32,128}$/u.test(rawToken)) return null;
    const store = ensureStore(getStore, isStoreReady);
    const record = parseStoredJson(await store.get(sessionKey(rawToken)));
    if (!record?.userId) return null;
    const account = await getAccountById(record.userId);
    if (!account) {
      await store.del(sessionKey(rawToken));
      return null;
    }
    // 滑动续期只在剩余时间较短时执行，避免每次读取都写 Redis。
    const createdAt = Number(record.createdAt) || 0;
    if (createdAt && now() - createdAt > (ACCOUNT_SESSION_TTL_SEC * 1000) / 2) {
      await store.set(
        sessionKey(rawToken),
        JSON.stringify({ userId: account.id, createdAt: now() }),
        { EX: ACCOUNT_SESSION_TTL_SEC },
      );
    }
    return account;
  }

  async function revokeSession(token) {
    const rawToken = String(token || '').trim();
    if (!/^[a-zA-Z0-9_-]{32,128}$/u.test(rawToken)) return false;
    const store = ensureStore(getStore, isStoreReady);
    await store.del(sessionKey(rawToken));
    return true;
  }

  return {
    getAccountById,
    requestEmailRegistrationCode,
    registerWithEmail,
    loginWithEmail,
    createSession,
    resolveSession,
    revokeSession,
    publicAccount,
  };
}

const defaultService = createAccountAuthService();

export const requestEmailRegistrationCode = defaultService.requestEmailRegistrationCode;
export const registerWithEmail = defaultService.registerWithEmail;
export const loginWithEmail = defaultService.loginWithEmail;
export const createAccountSession = defaultService.createSession;
export const resolveAccountSession = defaultService.resolveSession;
export const revokeAccountSession = defaultService.revokeSession;
export { publicAccount };
