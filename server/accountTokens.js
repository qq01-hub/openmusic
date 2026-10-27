import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { encryptSensitiveValue, decryptSensitiveValue } from './roomCredentialCrypto.js';

export const ACCOUNT_ACCESS_TTL_SEC = 3 * 86_400;
export const ACCOUNT_REFRESH_TTL_SEC = 30 * 86_400;
export const ACCOUNT_REFRESH_COOKIE = 'openmusic_account_refresh';
const REFRESH_GRACE_SEC = 10;
const ACCOUNT_PATTERN = /^acct_[A-Za-z0-9_-]{16,64}$/u;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{24}$/u;
const hash = (value) => createHash('sha256').update(value).digest('hex');

export class AccountTokenError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function tokenParts(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const pieces = token.split('.');
  if (pieces.length !== 3 || pieces.some((piece) => !/^[A-Za-z0-9_-]+$/u.test(piece))) return null;
  try {
    return { pieces, header: JSON.parse(Buffer.from(pieces[0], 'base64url')), claims: JSON.parse(Buffer.from(pieces[1], 'base64url')) };
  } catch { return null; }
}

export function accountTokenSessionId(token) {
  const id = tokenParts(token)?.claims?.sid;
  return typeof id === 'string' && SESSION_PATTERN.test(id) ? id : '';
}

function refreshParts(token) {
  if (typeof token !== 'string') return null;
  const match = /^([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/u.exec(token);
  return match ? { sid: match[1], hash: hash(token) } : null;
}

const ROTATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'invalid'} end
local record = cjson.decode(raw)
local now = tonumber(ARGV[1])
if tonumber(record.expiresAt) <= now then return {'invalid'} end
local previous = record.previousHash == ARGV[2]
local current = record.refreshHash == ARGV[2]
if (current or previous) and tonumber(record.graceUntil or 0) > now then
  local cached = redis.call('GET', KEYS[2])
  if cached then return {'ok', cached} end
end
if not current then
  if redis.call('HEXISTS', KEYS[3], ARGV[2]) == 1 then
    redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
    return {'replay'}
  end
  return {'invalid'}
end
if raw ~= ARGV[3] then return {'conflict'} end
if redis.call('HLEN', KEYS[3]) >= 4096 then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
  return {'exhausted'}
end
redis.call('HSET', KEYS[3], ARGV[2], '1')
redis.call('EXPIRE', KEYS[3], ARGV[6])
redis.call('SET', KEYS[1], ARGV[4], 'EX', ARGV[6])
redis.call('SET', KEYS[2], ARGV[5], 'EX', ARGV[7])
return {'ok', ARGV[5]}
`;

export function createAccountTokenService({ getStore, getAccount, now = () => Date.now(), prefix = 'openmusic:account:auth:v2:', encrypt = encryptSensitiveValue, decrypt = decryptSensitiveValue, authorizeRefresh = async () => {} }) {
  let keyPromise;
  const scope = `${prefix}signing-key`;
  const familyKey = (sid) => `${prefix}family:${sid}`;
  const graceKey = (sid) => `${prefix}grace:${sid}`;
  const spentKey = (sid) => `${prefix}spent:${sid}`;
  const timestamp = () => Math.floor(now() / 1000);
  const invalid = () => new AccountTokenError('ACCOUNT_REFRESH_INVALID', '登录已过期，请重新登录', 401);

  function store() {
    const client = getStore();
    if (!client) throw new AccountTokenError('ACCOUNT_SESSION_UNAVAILABLE', '账户会话存储暂不可用');
    return client;
  }

  async function run(operation) {
    try { return await operation(store()); }
    catch (error) {
      if (error instanceof AccountTokenError || ['ACCOUNT_RISK_BLOCKED', 'REDIS_UNAVAILABLE', 'RISK_STORAGE_UNAVAILABLE'].includes(error.code)) throw error;
      throw new AccountTokenError('ACCOUNT_SESSION_UNAVAILABLE', '账户会话暂不可用，请稍后重试');
    }
  }

  async function signingKeys() {
    if (!keyPromise) {
      keyPromise = run(async (client) => {
        let raw = await client.get(scope);
        if (!raw) {
          const generated = generateKeyPairSync('ed25519');
          const publicKey = generated.publicKey.export({ type: 'spki', format: 'pem' });
          const privateKey = encrypt(generated.privateKey.export({ type: 'pkcs8', format: 'pem' }), scope);
          if (!privateKey) throw new AccountTokenError('ACCOUNT_KEY_UNAVAILABLE', '账户签名密钥无法安全保存，请检查服务端凭证密钥');
          const candidate = JSON.stringify({ version: 1, publicKey, privateKey });
          raw = await client.eval(`
            local existing = redis.call('GET', KEYS[1])
            if existing then return existing end
            if redis.call('EXISTS', KEYS[2]) == 1 then return '__KEY_MISSING__' end
            redis.call('SET', KEYS[1], ARGV[1])
            redis.call('SET', KEYS[2], '1')
            return ARGV[1]
          `, { keys: [scope, `${scope}:initialized`], arguments: [candidate] });
          if (raw === '__KEY_MISSING__') throw new AccountTokenError('ACCOUNT_KEY_UNAVAILABLE', '账户签名密钥已丢失，请恢复 Redis 密钥备份，禁止自动轮换');
        } else {
          await client.set(`${scope}:initialized`, '1', { NX: true });
        }
        try {
          const record = JSON.parse(raw);
          if (record.version !== 1) throw new Error('version');
          const plain = decrypt(record.privateKey, scope);
          if (!plain || plain === record.privateKey) throw new Error('unencrypted key');
          const privateKey = createPrivateKey(plain);
          const publicKey = createPublicKey(record.publicKey);
          if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519' || createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !== record.publicKey) throw new Error('key mismatch');
          return { privateKey, publicKey, kid: hash(record.publicKey).slice(0, 24) };
        } catch {
          throw new AccountTokenError('ACCOUNT_KEY_UNAVAILABLE', '账户签名密钥不可读取，请恢复原服务端密钥与 Redis 备份');
        }
      }).catch((error) => { keyPromise = null; throw error; });
    }
    return keyPromise;
  }

  async function signedAccess(userId, sid, expiresAt) {
    const keys = await signingKeys();
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'at+jwt', kid: keys.kid })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ iss: 'openmusic', aud: 'openmusic-account', sub: userId, sid, iat: timestamp(), exp: expiresAt, jti: randomBytes(16).toString('base64url') })).toString('base64url');
    const payload = `${header}.${claims}`;
    return `${payload}.${sign(null, Buffer.from(payload), keys.privateKey).toString('base64url')}`;
  }

  async function verifiedClaims(token, allowExpired = false) {
    const parsed = tokenParts(token);
    if (!parsed) return null;
    const { header, claims, pieces } = parsed;
    if (!header || typeof header !== 'object' || Array.isArray(header) || !claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return null;
    if (!header || !claims || header.alg !== 'EdDSA' || header.typ !== 'at+jwt' || claims.iss !== 'openmusic' || claims.aud !== 'openmusic-account' || !ACCOUNT_PATTERN.test(claims.sub) || !SESSION_PATTERN.test(claims.sid) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > timestamp() + 30 || claims.exp <= claims.iat || claims.exp - claims.iat > ACCOUNT_ACCESS_TTL_SEC || (!allowExpired && claims.exp <= timestamp())) return null;
    const keys = await signingKeys();
    if (header.kid !== keys.kid) return null;
    try { return verify(null, Buffer.from(`${pieces[0]}.${pieces[1]}`), keys.publicKey, Buffer.from(pieces[2], 'base64url')) ? claims : null; }
    catch { return null; }
  }

  async function issue(userId) {
    const account = await getAccount(userId);
    if (!account || !ACCOUNT_PATTERN.test(account.id)) throw new AccountTokenError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
    const sid = randomBytes(18).toString('base64url');
    const refreshToken = `${sid}.${randomBytes(32).toString('base64url')}`;
    const expiresAt = timestamp() + ACCOUNT_ACCESS_TTL_SEC;
    const refreshExpiresAt = timestamp() + ACCOUNT_REFRESH_TTL_SEC;
    const accessToken = await signedAccess(account.id, sid, expiresAt);
    const record = { version: 2, userId: account.id, createdAt: timestamp(), expiresAt: refreshExpiresAt, refreshHash: hash(refreshToken) };
    const saved = await run((client) => client.set(familyKey(sid), JSON.stringify(record), { NX: true, EX: ACCOUNT_REFRESH_TTL_SEC }));
    if (saved !== 'OK') throw new AccountTokenError('ACCOUNT_SESSION_UNAVAILABLE', '账户会话建立失败，请重试');
    return { accessToken, refreshToken, expiresAt: expiresAt * 1000, refreshExpiresAt: refreshExpiresAt * 1000 };
  }

  async function inspect(token) {
    const claims = await verifiedClaims(token);
    if (!claims) return null;
    return run(async (client) => {
      const raw = await client.get(familyKey(claims.sid));
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (record.version !== 2 || record.userId !== claims.sub || record.expiresAt <= timestamp() || claims.exp > record.expiresAt) return null;
      const account = await getAccount(record.userId);
      if (!account) return null;
      return { account, expiresAt: claims.exp * 1000, refreshExpiresAt: record.expiresAt * 1000, sessionId: claims.sid };
    });
  }

  async function resolve(token) { return (await inspect(token))?.account || null; }

  async function refresh(token, authorize = authorizeRefresh) {
    const parsed = refreshParts(token);
    if (!parsed) throw invalid();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const raw = await run((client) => client.get(familyKey(parsed.sid)));
      if (!raw) throw invalid();
      let record;
      try { record = JSON.parse(raw); } catch { throw new AccountTokenError('ACCOUNT_SESSION_UNAVAILABLE', '账户会话数据不可读取'); }
      if (record.version !== 2 || record.expiresAt <= timestamp()) throw invalid();
      const known = parsed.hash === record.refreshHash || await run((client) => client.hExists(spentKey(parsed.sid), parsed.hash));
      if (!known) throw invalid();
      const account = await getAccount(record.userId);
      if (!account) throw invalid();
      await authorize(account);
      const issuedAt = timestamp();
      const expiresAt = Math.min(issuedAt + ACCOUNT_ACCESS_TTL_SEC, record.expiresAt);
      const refreshToken = `${parsed.sid}.${randomBytes(32).toString('base64url')}`;
      const pair = { accessToken: await signedAccess(account.id, parsed.sid, expiresAt), refreshToken, expiresAt: expiresAt * 1000, refreshExpiresAt: record.expiresAt * 1000 };
      const encrypted = encrypt(JSON.stringify(pair), graceKey(parsed.sid));
      if (!encrypted) throw new AccountTokenError('ACCOUNT_KEY_UNAVAILABLE', '账户续期凭证无法安全保存');
      const next = { ...record, refreshHash: hash(refreshToken), previousHash: record.refreshHash, graceUntil: issuedAt + REFRESH_GRACE_SEC };
      const result = await run((client) => client.eval(ROTATE_SCRIPT, { keys: [familyKey(parsed.sid), graceKey(parsed.sid), spentKey(parsed.sid)], arguments: [String(issuedAt), parsed.hash, raw, JSON.stringify(next), encrypted, String(Math.max(1, record.expiresAt - issuedAt)), String(REFRESH_GRACE_SEC)] }));
      if (result[0] === 'conflict') continue;
      if (result[0] === 'replay') throw new AccountTokenError('ACCOUNT_REFRESH_REUSED', '检测到旧续期凭证重复使用，请重新登录', 401);
      if (result[0] === 'exhausted') throw new AccountTokenError('ACCOUNT_REFRESH_LIMIT_REACHED', '账户续期次数异常，请重新登录', 401);
      if (result[0] !== 'ok') throw invalid();
      try { return JSON.parse(decrypt(String(result[1]), graceKey(parsed.sid))); }
      catch { throw new AccountTokenError('ACCOUNT_KEY_UNAVAILABLE', '账户续期凭证不可读取'); }
    }
    throw new AccountTokenError('ACCOUNT_REFRESH_BUSY', '账户续期繁忙，请稍后重试');
  }

  async function revoke(accessToken, refreshToken = '') {
    const claims = await verifiedClaims(accessToken, true);
    const parsed = refreshParts(refreshToken);
    const sid = claims?.sid || parsed?.sid;
    if (!sid) return false;
    return run((client) => client.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local record = cjson.decode(raw)
      if ARGV[1] ~= record.userId and ARGV[2] ~= record.refreshHash and redis.call('HEXISTS', KEYS[3], ARGV[2]) == 0 then return 0 end
      redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
      return 1
    `, { keys: [familyKey(sid), graceKey(sid), spentKey(sid)], arguments: [claims?.sub || '', parsed?.sid === sid ? parsed.hash : ''] }));
  }

  return { issue, inspect, resolve, refresh, revoke };
}
