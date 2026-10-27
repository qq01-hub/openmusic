import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { getRedisClient, isRedisEnabled } from './roomStorage.js';
import { getRuntimeConfig } from './runtimeConfig.js';
import { ACCOUNT_ACCESS_TTL_SEC, createAccountTokenService } from './accountTokens.js';
import { riskControl } from './riskControl.js';

const scrypt = promisify(scryptCallback);

export const ACCOUNT_SESSION_COOKIE = 'openmusic_account_session';
export const ACCOUNT_SESSION_TTL_SEC = ACCOUNT_ACCESS_TTL_SEC;
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
const IDENTITY_INDEX_PREFIX = `${ACCOUNT_KEY_PREFIX}identity:`;
const EMAIL_CODE_PREFIX = `${ACCOUNT_KEY_PREFIX}email-code:`;
const EMAIL_CODE_ATTEMPTS_PREFIX = `${ACCOUNT_KEY_PREFIX}email-code-attempts:`;
const EMAIL_CODE_COOLDOWN_PREFIX = `${ACCOUNT_KEY_PREFIX}email-code-cooldown:`;
const ROOM_IDENTITY_PREFIX = `${ACCOUNT_KEY_PREFIX}room-identity:`;
const ROOM_IDENTITY_ACCOUNT_PREFIX = `${ACCOUNT_KEY_PREFIX}room-identity-account:`;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_OPTIONS = {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};
const CODE_HASH_SECRET = String(process.env.CLIENT_ID_SECRET || randomBytes(32).toString('hex'));

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const REGISTRATION_EMAIL_DOMAINS = new Set([
  'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net',
  'sina.com', 'sina.cn', 'sohu.com', '139.com', '189.cn', 'wo.cn',
  'gmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'aol.com',
  'proton.me', 'protonmail.com',
]);
const EXTERNAL_IDENTITY_PROVIDERS = new Set(['linuxdo', 'github', 'wechat']);

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

function validateRegistrationEmail(value) {
  const email = normalizeEmail(value);
  if (!email) throw new AccountAuthError('INVALID_EMAIL', '请输入有效的邮箱地址', 400);
  if (!REGISTRATION_EMAIL_DOMAINS.has(email.split('@')[1])) {
    throw new AccountAuthError(
      'EMAIL_DOMAIN_NOT_ALLOWED',
      '注册仅支持 QQ、163、Gmail、Outlook 等常见公共邮箱，不支持自定义域名或企业邮箱',
      400,
    );
  }
  return email;
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

function normalizeRoomUserId(value) {
  const id = String(value ?? '').trim();
  return /^[a-zA-Z0-9_-]{8,64}$/u.test(id) ? id : '';
}

function accountKey(userId) {
  return `${ACCOUNT_KEY_PREFIX}${userId}`;
}

function roomIdentityKey(userId) {
  return `${ROOM_IDENTITY_PREFIX}${userId}`;
}

function accountRoomIdentityKey(accountId) {
  return `${ROOM_IDENTITY_ACCOUNT_PREFIX}${accountId}`;
}

function emailHash(email) {
  return createHash('sha256').update(email).digest('hex');
}

function emailIndexKey(email) {
  return `${EMAIL_INDEX_PREFIX}${emailHash(email)}`;
}

function normalizeExternalProvider(value) {
  const provider = String(value ?? '').trim().toLowerCase();
  return EXTERNAL_IDENTITY_PROVIDERS.has(provider) ? provider : '';
}

function normalizeIdentitySubject(value) {
  const subject = String(value ?? '').trim();
  return subject && subject.length <= 256 ? subject : '';
}

function identityIndexKey(provider, subject) {
  const normalizedProvider = normalizeExternalProvider(provider);
  const normalizedSubject = normalizeIdentitySubject(subject);
  if (!normalizedProvider || !normalizedSubject) return '';
  const digest = createHash('sha256').update(normalizedSubject).digest('hex');
  return `${IDENTITY_INDEX_PREFIX}${normalizedProvider}:${digest}`;
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
  const normalized = normalizeAccountRecord(account);
  if (!normalized) return null;
  return {
    id: normalized.id,
    email: normalized.email,
    emailVerifiedAt: normalized.emailVerifiedAt || null,
    hasPassword: Boolean(normalized.password),
    ...(normalized.roomUserId ? { roomUserId: normalized.roomUserId } : {}),
    identities: normalized.identities.map((identity) => ({
      provider: identity.provider,
      username: identity.username || '',
      avatarUrl: identity.avatarUrl || '',
      linkedAt: identity.linkedAt || 0,
    })),
    createdAt: normalized.createdAt,
  };
}

function createSmtpTransporter(config = getRuntimeConfig()) {
  const host = String(config?.smtpHost || '').trim();
  if (!host) return null;

  const port = Number(config?.smtpPort);
  const normalizedPort = Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : 587;
  const user = String(config?.smtpUser || '').trim();
  const pass = String(config?.smtpPass || '');

  return nodemailer.createTransport({
    host,
    port: normalizedPort,
    secure: config?.smtpSecure === true || normalizedPort === 465,
    ...(user ? { auth: { user, pass } } : {}),
  });
}

async function sendRegistrationCodeBySmtp({ email, code }) {
  const config = getRuntimeConfig();
  const transporter = createSmtpTransporter(config);
  if (!transporter) {
    throw new AccountAuthError('EMAIL_NOT_CONFIGURED', '邮箱服务未配置，请联系管理员在后台完成 SMTP 设置', 503);
  }

  const from = String(config.smtpFrom || config.smtpUser || '').trim();
  if (!from) {
    throw new AccountAuthError('EMAIL_NOT_CONFIGURED', '邮箱发件人未配置，请联系管理员在后台完成 SMTP 设置', 503);
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

function normalizeIdentityRecord(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const provider = String(identity.provider || '').trim().toLowerCase();
  if (provider === 'email') {
    const subject = normalizeEmail(identity.subject);
    if (!subject) return null;
    return {
      provider,
      subject,
      linkedAt: Number(identity.linkedAt || identity.createdAt) || 0,
    };
  }
  const normalizedProvider = normalizeExternalProvider(provider);
  const subject = normalizeIdentitySubject(identity.subject);
  if (!normalizedProvider || !subject) return null;
  return {
    provider: normalizedProvider,
    subject,
    username: String(identity.username || '').trim().slice(0, 128),
    avatarUrl: String(identity.avatarUrl || '').trim().slice(0, 2048),
    linkedAt: Number(identity.linkedAt || identity.createdAt) || 0,
  };
}

function normalizeAccountRecord(account) {
  if (!account || typeof account !== 'object') return null;
  const identities = Array.isArray(account.identities)
    ? account.identities.map(normalizeIdentityRecord).filter(Boolean)
    : [];
  const email = normalizeEmail(account.email);
  if (email && !identities.some((identity) => identity.provider === 'email')) {
    identities.unshift({
      provider: 'email',
      subject: email,
      linkedAt: Number(account.emailVerifiedAt || account.createdAt) || 0,
    });
  }
  return { ...account, email: email || null, identities };
}

function createExternalIdentity(provider, subject, profile, linkedAt) {
  return {
    provider,
    subject,
    username: String(profile?.username || '').trim().slice(0, 128),
    avatarUrl: String(profile?.avatarUrl || '').trim().slice(0, 2048),
    linkedAt,
  };
}

function loginMethodCount(account) {
  const externalCount = account.identities.filter((identity) => identity.provider !== 'email').length;
  return (account.password ? 1 : 0) + externalCount;
}

export function createAccountAuthService({
  getStore = getRedisClient,
  isStoreReady = isRedisEnabled,
  sendCode = sendRegistrationCodeBySmtp,
  now = () => Date.now(),
  randomId,
  randomInt,
  roomRandomId = () => randomBytes(18).toString('base64url'),
} = {}) {
  const createId = () => createAccountId(randomId);
  const createCode = () => createVerificationCode(randomInt);

  async function getAccountById(userId) {
    const id = normalizeAccountId(userId);
    if (!id) return null;
    const store = ensureStore(getStore, isStoreReady);
    return normalizeAccountRecord(parseStoredJson(await store.get(accountKey(id))));
  }

  async function getRoomIdentityOwnerAccountId(userId) {
    const roomUserId = normalizeRoomUserId(userId);
    if (!roomUserId) return null;
    const store = ensureStore(getStore, isStoreReady);
    const rawOwnerId = String(await store.get(roomIdentityKey(roomUserId)) || '').trim();
    if (!rawOwnerId) return null;
    const ownerId = normalizeAccountId(rawOwnerId);
    if (!ownerId) {
      throw new AccountAuthError('ROOM_IDENTITY_CONFLICT', '账户身份数据异常，请联系管理员', 503);
    }
    return ownerId;
  }

  async function requestEmailRegistrationCode({ email: rawEmail } = {}) {
    const email = validateRegistrationEmail(rawEmail);
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
    const email = validateRegistrationEmail(rawEmail);
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
      identities: [{ provider: 'email', subject: email, linkedAt: createdAt }],
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

  async function loginOrRegisterExternalIdentity({ provider: rawProvider, subject: rawSubject, profile } = {}) {
    const provider = normalizeExternalProvider(rawProvider);
    const subject = normalizeIdentitySubject(rawSubject);
    if (!provider || !subject) {
      throw new AccountAuthError('INVALID_IDENTITY', '第三方身份无效', 400);
    }
    const store = ensureStore(getStore, isStoreReady);
    const indexKey = identityIndexKey(provider, subject);
    const existingId = await store.get(indexKey);
    if (existingId) {
      const existingAccount = await getAccountById(existingId);
      if (!existingAccount) {
        throw new AccountAuthError('IDENTITY_DATA_INVALID', '第三方身份数据异常，请联系管理员', 503);
      }
      return { account: existingAccount, created: false };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = createId();
      const createdAt = now();
      const account = {
        id,
        email: null,
        emailVerifiedAt: null,
        password: null,
        identities: [createExternalIdentity(provider, subject, profile, createdAt)],
        createdAt,
        updatedAt: createdAt,
      };
      const result = await store.eval(
        `local existing = redis.call('GET', KEYS[1]) `
          + `if existing then return existing end `
          + `if redis.call('EXISTS', KEYS[2]) == 1 then return '__ACCOUNT_ID_COLLISION__' end `
          + `redis.call('SET', KEYS[1], ARGV[1]) `
          + `redis.call('SET', KEYS[2], ARGV[2]) `
          + `return ARGV[1]`,
        {
          keys: [indexKey, accountKey(id)],
          arguments: [id, JSON.stringify(account)],
        },
      );
      if (result === '__ACCOUNT_ID_COLLISION__') continue;
      if (result !== id) {
        const racedAccount = await getAccountById(result);
        if (!racedAccount) {
          throw new AccountAuthError('IDENTITY_DATA_INVALID', '第三方身份数据异常，请联系管理员', 503);
        }
        return { account: racedAccount, created: false };
      }
      return { account, created: true };
    }
    throw new AccountAuthError('ACCOUNT_CREATE_FAILED', '账户创建失败，请稍后重试', 503);
  }

  async function bindExternalIdentity(userId, { provider: rawProvider, subject: rawSubject, profile } = {}) {
    const id = normalizeAccountId(userId);
    const provider = normalizeExternalProvider(rawProvider);
    const subject = normalizeIdentitySubject(rawSubject);
    if (!id || !provider || !subject) {
      throw new AccountAuthError('INVALID_IDENTITY', '第三方身份无效', 400);
    }
    const store = ensureStore(getStore, isStoreReady);
    const indexKey = identityIndexKey(provider, subject);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const currentRaw = await store.get(accountKey(id));
      const account = normalizeAccountRecord(parseStoredJson(currentRaw));
      if (!account) throw new AccountAuthError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
      const currentProviderIdentity = account.identities.find((identity) => identity.provider === provider);
      if (currentProviderIdentity && currentProviderIdentity.subject !== subject) {
        throw new AccountAuthError('PROVIDER_ALREADY_BOUND', '该账户已绑定同类型的其他身份，请先解绑', 409);
      }
      const ownerId = await store.get(indexKey);
      if (ownerId && ownerId !== id) {
        throw new AccountAuthError('IDENTITY_ALREADY_BOUND', '该第三方身份已被其他账户绑定', 409);
      }

      const linkedAt = now();
      const nextIdentity = createExternalIdentity(provider, subject, profile, linkedAt);
      const identities = account.identities.filter((identity) => identity.provider !== provider);
      const nextAccount = {
        ...account,
        identities: [...identities, nextIdentity],
        updatedAt: linkedAt,
      };
      const result = Number(await store.eval(
        `local owner = redis.call('GET', KEYS[1]) `
          + `if owner and owner ~= ARGV[1] then return -1 end `
          + `if redis.call('GET', KEYS[2]) ~= ARGV[2] then return -2 end `
          + `redis.call('SET', KEYS[1], ARGV[1]) `
          + `redis.call('SET', KEYS[2], ARGV[3]) `
          + `return 1`,
        {
          keys: [indexKey, accountKey(id)],
          arguments: [id, currentRaw, JSON.stringify(nextAccount)],
        },
      ));
      if (result === -1) {
        throw new AccountAuthError('IDENTITY_ALREADY_BOUND', '该第三方身份已被其他账户绑定', 409);
      }
      if (result === -2) continue;
      if (result === 1) return nextAccount;
    }
    throw new AccountAuthError('ACCOUNT_UPDATE_CONFLICT', '账户状态已变化，请重试', 409);
  }

  /**
   * 为账户绑定稳定的房间身份。首次登录优先继承当前游客 userId；
   * 若该身份已属于其他账户，则为账户生成新的身份，避免跨账户串号。
   */
  async function ensureRoomUserId(userId, candidateUserId = '') {
    const id = normalizeAccountId(userId);
    if (!id) throw new AccountAuthError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
    const store = ensureStore(getStore, isStoreReady);
    const candidate = normalizeRoomUserId(candidateUserId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const currentRaw = await store.get(accountKey(id));
      const account = normalizeAccountRecord(parseStoredJson(currentRaw));
      if (!account) throw new AccountAuthError('ACCOUNT_NOT_FOUND', '账户不存在', 404);

      const existing = normalizeRoomUserId(account.roomUserId);
      if (existing) {
        const reverseOwner = await store.get(roomIdentityKey(existing));
        if (reverseOwner && reverseOwner !== id) {
          throw new AccountAuthError('ROOM_IDENTITY_CONFLICT', '账户身份数据异常，请联系管理员', 503);
        }
        if (!reverseOwner) {
          const claimed = await store.set(roomIdentityKey(existing), id, { NX: true });
          if (claimed !== 'OK') {
            const owner = await store.get(roomIdentityKey(existing));
            if (owner && owner !== id) {
              throw new AccountAuthError('ROOM_IDENTITY_CONFLICT', '账户身份数据异常，请联系管理员', 503);
            }
          }
        }
        await store.set(accountRoomIdentityKey(id), existing);
        return existing;
      }

      let roomUserId = candidate;
      if (!roomUserId || (await store.get(roomIdentityKey(roomUserId))) !== null) {
        roomUserId = normalizeRoomUserId(roomRandomId());
      }
      if (!roomUserId) {
        throw new AccountAuthError('ROOM_IDENTITY_CREATE_FAILED', '房间身份创建失败，请稍后重试', 503);
      }

      const updatedAt = now();
      const nextAccount = {
        ...account,
        roomUserId,
        updatedAt,
      };
      const result = Number(await store.eval(
        `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return -1 end `
          + `local owner = redis.call('GET', KEYS[2]) `
          + `if owner and owner ~= ARGV[2] then return -2 end `
          + `redis.call('SET', KEYS[2], ARGV[2]) `
          + `redis.call('SET', KEYS[3], ARGV[2]) `
          + `redis.call('SET', KEYS[1], ARGV[3]) `
          + `return 1`,
        {
          keys: [accountKey(id), roomIdentityKey(roomUserId), accountRoomIdentityKey(id)],
          arguments: [currentRaw, id, JSON.stringify(nextAccount)],
        },
      ));
      if (result === 1) return roomUserId;
      if (result === -2) continue;
    }

    throw new AccountAuthError('ACCOUNT_UPDATE_CONFLICT', '账户状态已变化，请重试', 409);
  }

  async function unbindExternalIdentity(userId, rawProvider) {
    const id = normalizeAccountId(userId);
    const provider = normalizeExternalProvider(rawProvider);
    if (!id || !provider) throw new AccountAuthError('INVALID_IDENTITY', '第三方身份无效', 400);
    const store = ensureStore(getStore, isStoreReady);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const currentRaw = await store.get(accountKey(id));
      const account = normalizeAccountRecord(parseStoredJson(currentRaw));
      if (!account) throw new AccountAuthError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
      const identity = account.identities.find((item) => item.provider === provider);
      if (!identity) throw new AccountAuthError('IDENTITY_NOT_BOUND', '该登录方式尚未绑定', 404);
      if (loginMethodCount(account) <= 1) {
        throw new AccountAuthError('LAST_LOGIN_METHOD', '请至少保留一种可用的登录方式', 409);
      }

      const indexKey = identityIndexKey(provider, identity.subject);
      const updatedAt = now();
      const nextAccount = {
        ...account,
        identities: account.identities.filter((item) => item.provider !== provider),
        updatedAt,
      };
      const result = Number(await store.eval(
        `local owner = redis.call('GET', KEYS[1]) `
          + `if owner and owner ~= ARGV[1] then return -1 end `
          + `if redis.call('GET', KEYS[2]) ~= ARGV[2] then return -2 end `
          + `redis.call('DEL', KEYS[1]) `
          + `redis.call('SET', KEYS[2], ARGV[3]) `
          + `return 1`,
        {
          keys: [indexKey, accountKey(id)],
          arguments: [id, currentRaw, JSON.stringify(nextAccount)],
        },
      ));
      if (result === -1) {
        throw new AccountAuthError('IDENTITY_OWNERSHIP_MISMATCH', '身份归属异常，无法解绑', 409);
      }
      if (result === -2) continue;
      if (result === 1) return nextAccount;
    }
    throw new AccountAuthError('ACCOUNT_UPDATE_CONFLICT', '账户状态已变化，请重试', 409);
  }

  const tokens = createAccountTokenService({
    getStore: () => ensureStore(getStore, isStoreReady),
    getAccount: getAccountById,
    now,
    authorizeRefresh: (account) => riskControl.sessionStatus(account.id),
  });

  return {
    getAccountById,
    getRoomIdentityOwnerAccountId,
    requestEmailRegistrationCode,
    registerWithEmail,
    loginWithEmail,
    loginOrRegisterExternalIdentity,
    bindExternalIdentity,
    ensureRoomUserId,
    unbindExternalIdentity,
    createSession: tokens.issue,
    resolveSession: tokens.resolve,
    inspectSession: tokens.inspect,
    refreshSession: tokens.refresh,
    revokeSession: tokens.revoke,
    publicAccount,
  };
}

const defaultService = createAccountAuthService();

export const requestEmailRegistrationCode = defaultService.requestEmailRegistrationCode;
export const registerWithEmail = defaultService.registerWithEmail;
export const loginWithEmail = defaultService.loginWithEmail;
export const loginOrRegisterExternalIdentity = defaultService.loginOrRegisterExternalIdentity;
export const bindExternalIdentity = defaultService.bindExternalIdentity;
export const ensureRoomUserId = defaultService.ensureRoomUserId;
export const getRoomIdentityOwnerAccountId = defaultService.getRoomIdentityOwnerAccountId;
export const unbindExternalIdentity = defaultService.unbindExternalIdentity;
export const createAccountSession = defaultService.createSession;
export const resolveAccountSession = defaultService.resolveSession;
export const inspectAccountSession = defaultService.inspectSession;
export const refreshAccountSession = defaultService.refreshSession;
export const revokeAccountSession = defaultService.revokeSession;
export { publicAccount };
