import { isIP } from 'node:net';
import { riskChallengeChannel } from './riskChallengeBus.js';
import { normalizeDeviceKey, verifyDeviceProof, DeviceProofError, CONSUME_DEVICE_PROOF } from './deviceProof.js';
import { evalRedisScript } from './redisScripts.js';
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
    redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[5], KEYS[6], KEYS[7])
    redis.call('ZREM', KEYS[4], ARGV[8])
    redis.call('PUBLISH', ARGV[9], 'session:' .. ARGV[8])
    return {'replay'}
  end
  return {'invalid'}
end
if raw ~= ARGV[3] then return {'conflict'} end
if redis.call('HLEN', KEYS[3]) >= 4096 then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[5], KEYS[6], KEYS[7])
  redis.call('ZREM', KEYS[4], ARGV[8])
  redis.call('PUBLISH', ARGV[9], 'session:' .. ARGV[8])
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
  const sessionsKey = id => `${prefix}sessions:${id}`;
  const proofKey = sid => `${prefix}proof:${sid}`;
  const activityKey = sid => `${prefix}activity:${sid}`;
  const networkKey = sid => `${prefix}network:${sid}`;
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
      if (error instanceof AccountTokenError || error instanceof DeviceProofError || ['ACCOUNT_RISK_BLOCKED', 'REDIS_UNAVAILABLE', 'RISK_STORAGE_UNAVAILABLE'].includes(error.code)) throw error;
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
          raw = await evalRedisScript(client, `
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

  async function issue(userId, deviceKey, { allowLegacy = false } = {}) {
    deviceKey = allowLegacy && deviceKey === undefined ? undefined : normalizeDeviceKey(deviceKey);
    const account = await getAccount(userId);
    if (!account || !ACCOUNT_PATTERN.test(account.id)) throw new AccountTokenError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
    const sid = randomBytes(18).toString('base64url');
    const refreshToken = `${sid}.${randomBytes(32).toString('base64url')}`;
    const expiresAt = timestamp() + ACCOUNT_ACCESS_TTL_SEC;
    const refreshExpiresAt = timestamp() + ACCOUNT_REFRESH_TTL_SEC;
    const accessToken = await signedAccess(account.id, sid, expiresAt);
    const record = { version: 2, deviceKey, userId: account.id, createdAt: timestamp(), expiresAt: refreshExpiresAt, refreshHash: hash(refreshToken) };
    const saved = await run(client => evalRedisScript(client, `
      redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
      if redis.call('ZCARD', KEYS[2]) >= 32 then return -1 end
      if not redis.call('SET', KEYS[1], ARGV[2], 'NX', 'EX', ARGV[3]) then return 0 end
      redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])
      redis.call('EXPIRE', KEYS[2], ARGV[3])
      return 1
    `, { keys: [familyKey(sid), sessionsKey(account.id)], arguments: [String(timestamp()), JSON.stringify(record), String(ACCOUNT_REFRESH_TTL_SEC), String(refreshExpiresAt), sid] }));
    if (Number(saved) === -1) throw new AccountTokenError('ACCOUNT_SESSION_LIMIT', '登录设备过多，请联系管理员撤销闲置会话', 429);
    if (Number(saved) !== 1) throw new AccountTokenError('ACCOUNT_SESSION_UNAVAILABLE', '账户会话建立失败，请重试');
    return { deviceKeyId: deviceKey ? hash(JSON.stringify(deviceKey)) : null, deviceMigrationRequired: !deviceKey, sessionId: sid, accessToken, refreshToken, expiresAt: expiresAt * 1000, refreshExpiresAt: refreshExpiresAt * 1000 };
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
      return { account, expiresAt: claims.exp * 1000, refreshExpiresAt: record.expiresAt * 1000, sessionId: claims.sid, deviceMigrationRequired: !record.deviceKey, deviceKeyId: record.deviceKey ? hash(JSON.stringify(normalizeDeviceKey(record.deviceKey))) : null, deviceKey: record.deviceKey };
    });
  }

  async function bindDeviceKey(token, deviceKey, { refreshToken = '' } = {}) {
    const claims = await verifiedClaims(token);
    const renewal = claims ? null : refreshParts(refreshToken);
    if (!claims && !renewal) throw invalid();
    deviceKey = normalizeDeviceKey(deviceKey);
    const sid = claims?.sid || renewal.sid;
    const raw = await run(client => client.get(familyKey(sid)));
    if (!raw) throw invalid();
    const account = await getAccount(claims?.sub || JSON.parse(raw).userId);
    if (!account) throw invalid();
    const result = await run(client => evalRedisScript(client, `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local record = cjson.decode(raw)
      if record.version ~= 2 or record.userId ~= ARGV[1] or tonumber(record.expiresAt) <= tonumber(ARGV[3]) then return 0 end
      if ARGV[4] ~= '' and record.refreshHash ~= ARGV[4] then return 0 end
      local requested = cjson.decode(ARGV[2])
      if record.deviceKey then
        local existing = record.deviceKey
        if existing.kty == requested.kty and existing.crv == requested.crv and existing.x == requested.x and existing.y == requested.y then return 1 end
        return 2
      end
      record.deviceKey = requested
      redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
      redis.call('DEL', KEYS[2])
      return 1
    `, { keys: [familyKey(sid), graceKey(sid)], arguments: [account.id, JSON.stringify(deviceKey), String(timestamp()), renewal?.hash || ''] }));
    if (Number(result) === 0) throw invalid();
    if (Number(result) === 2) throw new DeviceProofError();
    if (renewal) return { ...await refresh(refreshToken), account };
    const session = await inspect(token);
    if (!session) throw invalid();
    return session;
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
      const pair = { deviceMigrationRequired: !record.deviceKey, deviceKeyId: record.deviceKey ? hash(JSON.stringify(normalizeDeviceKey(record.deviceKey))) : null, sessionId: parsed.sid, accessToken: await signedAccess(account.id, parsed.sid, expiresAt), refreshToken, expiresAt: expiresAt * 1000, refreshExpiresAt: record.expiresAt * 1000 };
      const encrypted = encrypt(JSON.stringify(pair), graceKey(parsed.sid));
      if (!encrypted) throw new AccountTokenError('ACCOUNT_KEY_UNAVAILABLE', '账户续期凭证无法安全保存');
      const next = { ...record, refreshHash: hash(refreshToken), previousHash: record.refreshHash, graceUntil: issuedAt + REFRESH_GRACE_SEC };
      const result = await run((client) => evalRedisScript(client, ROTATE_SCRIPT, { keys: [familyKey(parsed.sid), graceKey(parsed.sid), spentKey(parsed.sid), sessionsKey(record.userId), proofKey(parsed.sid), activityKey(parsed.sid), networkKey(parsed.sid)], arguments: [String(issuedAt), parsed.hash, raw, JSON.stringify(next), encrypted, String(Math.max(1, record.expiresAt - issuedAt)), String(REFRESH_GRACE_SEC), parsed.sid, riskChallengeChannel(store())] }));
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
    return run((client) => evalRedisScript(client, `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local record = cjson.decode(raw)
      if ARGV[1] ~= record.userId and ARGV[2] ~= record.refreshHash and redis.call('HEXISTS', KEYS[3], ARGV[2]) == 0 then return 0 end
      redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6])
      redis.call('ZREM', ARGV[3] .. record.userId, ARGV[4])
      redis.call('PUBLISH', ARGV[5], 'session:' .. ARGV[4])
      return 1
    `, { keys: [familyKey(sid), graceKey(sid), spentKey(sid), proofKey(sid), activityKey(sid), networkKey(sid)], arguments: [claims?.sub || '', parsed?.sid === sid ? parsed.hash : '', `${prefix}sessions:`, sid, riskChallengeChannel(store())] }));
  }

  async function verifyRequest(token, req, { refresh: isRefresh = false, session, ip = '' } = {}) {
    let current = session;
    if (isRefresh) {
      const parsed = refreshParts(token);
      if (!parsed) throw invalid();
      const raw = await run(client => client.get(familyKey(parsed.sid)));
      if (!raw) throw invalid();
      const record = JSON.parse(raw);
      if (record.expiresAt <= timestamp()) throw invalid();
      if (record.refreshHash !== parsed.hash && !await run(client => client.hExists(spentKey(parsed.sid), parsed.hash))) throw invalid();
      current = { sessionId: parsed.sid, deviceKey: record.deviceKey };
    } else if (!current) current = await inspect(token);
    if (!current) throw new DeviceProofError();
    // 只兼容尚未绑定设备的会话，原子重读避免并发绑定后使用旧快照降级
    if (!current.deviceKey && req.headers?.['x-openmusic-device'] === undefined) {
      const accepted = await run(client => evalRedisScript(client, `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return 0 end
        local record = cjson.decode(raw)
        if record.version ~= 2 or record.deviceKey or tonumber(record.expiresAt) <= tonumber(ARGV[1]) then return 0 end
        return 1
      `, { keys: [familyKey(current.sessionId)], arguments: [String(timestamp())] }));
      if (Number(accepted) !== 1) throw new DeviceProofError();
      return { ...current, deviceMigrationRequired: true };
    }
    const proof = verifyDeviceProof(req, req.headers?.['x-openmusic-device'], current.deviceKey, current.sessionId, now());
    const result = await run(client => evalRedisScript(client, CONSUME_DEVICE_PROOF, {
      keys: [familyKey(current.sessionId), proofKey(current.sessionId), activityKey(current.sessionId), networkKey(current.sessionId)],
      arguments: [String(now()), proof.nonce, String(proof.timestamp + 60001), isIP(ip) ? ip : ''],
    }));
    if (Number(result) !== 1) throw new DeviceProofError(Number(result) === -2 ? 'ACCOUNT_DEVICE_RATE_LIMITED' : 'ACCOUNT_DEVICE_PROOF_REPLAY', Number(result) === -2 ? 429 : 401);
    return current;
  }

  async function listSessions(userId) {
    if (!ACCOUNT_PATTERN.test(userId)) throw new AccountTokenError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
    return run(async client => {
      const ids = await client.zRangeByScore(sessionsKey(userId), timestamp(), '+inf', { LIMIT: { offset: 0, count: 32 } });
      if (!ids.length) return [];
      const batch = client.multi();
      for (const id of ids) { batch.get(familyKey(id)); batch.hGetAll(activityKey(id)); }
      const values = await batch.exec();
      return ids.flatMap((id, index) => {
        if (!values[index * 2]) return [];
        const record = JSON.parse(values[index * 2]);
        if (record.userId !== userId || record.expiresAt <= timestamp()) return [];
        const activity = values[index * 2 + 1];
        return [{ id, createdAt: record.createdAt * 1000, expiresAt: record.expiresAt * 1000,
          deviceBound: Boolean(record.deviceKey), lastIp: activity.lastIp || '', lastSeenAt: Number(activity.lastSeenAt || 0),
          ipCount: Number(activity.ipCount || 0), ipChanges: Number(activity.ipChanges || 0), sharedAt: Number(activity.sharedAt || 0) }];
      });
    });
  }

  async function revokeSessionById(userId, sid) {
    if (!ACCOUNT_PATTERN.test(userId) || !SESSION_PATTERN.test(sid)) throw new AccountTokenError('ACCOUNT_SESSION_INVALID', '会话无效', 400);
    return run(client => evalRedisScript(client, `
      local raw = redis.call('GET', KEYS[1])
      if raw and cjson.decode(raw).userId ~= ARGV[1] then return 0 end
      redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6])
      redis.call('ZREM', KEYS[7], ARGV[2])
      redis.call('PUBLISH', ARGV[3], 'session:' .. ARGV[2])
      return 1
    `, { keys: [familyKey(sid), graceKey(sid), spentKey(sid), proofKey(sid), activityKey(sid), networkKey(sid), sessionsKey(userId)],
      arguments: [userId, sid, riskChallengeChannel(client)] }));
  }

  return { issue, inspect, resolve, refresh, revoke, verifyRequest, bindDeviceKey, listSessions, revokeSessionById };
}
