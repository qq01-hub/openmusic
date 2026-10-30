import { createHash, createPublicKey, verify } from 'node:crypto';

export class DeviceProofError extends Error {
  constructor(code = 'ACCOUNT_DEVICE_PROOF_REQUIRED', status = 401) {
    super('设备验证失败，请在当前设备重新登录');
    this.code = code;
    this.status = status;
  }
}

export function normalizeDeviceKey(key) {
  if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || key.d !== undefined
    || !/^[A-Za-z0-9_-]{43}$/u.test(key.x || '') || !/^[A-Za-z0-9_-]{43}$/u.test(key.y || '')) throw new DeviceProofError();
  const normalized = { kty: 'EC', crv: 'P-256', x: key.x, y: key.y };
  try { createPublicKey({ key: normalized, format: 'jwk' }); } catch { throw new DeviceProofError(); }
  return normalized;
}

export function deviceProofMessage(req, proof) {
  const digest = createHash('sha256').update(req.rawBody || Buffer.alloc(0)).digest('base64url');
  return ['openmusic-device-v1', proof.sid, req.method.toUpperCase(), req.originalUrl, digest, proof.ts, proof.nonce].join('\n');
}

export function verifyDeviceProof(req, encoded, expectedKey, sessionId, now = Date.now()) {
  try {
    if (typeof encoded !== 'string' || encoded.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error();
    const proof = JSON.parse(Buffer.from(encoded, 'base64url'));
    const key = normalizeDeviceKey(expectedKey);
    if (proof.v !== 1 || proof.sid !== sessionId || !Number.isSafeInteger(proof.ts) || Math.abs(now - proof.ts) > 60000
      || !/^[A-Za-z0-9_-]{32}$/u.test(proof.nonce) || !/^[A-Za-z0-9_-]{86}$/u.test(proof.sig)) throw new Error();
    if (!verify('sha256', Buffer.from(deviceProofMessage(req, proof)), { key: createPublicKey({ key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(proof.sig, 'base64url'))) throw new Error();
    return { nonce: proof.nonce, timestamp: proof.ts, key };
  } catch { throw new DeviceProofError(); }
}

// 仅供凭密码、注册验证码或 OAuth 重新认证时绑定，不能给现有会话更换公钥
export function loginDeviceKey(req) {
  const encoded = req.headers?.['x-openmusic-device'];
  let key;
  try { key = normalizeDeviceKey(JSON.parse(Buffer.from(encoded, 'base64url')).key); }
  catch { throw new DeviceProofError(); }
  return verifyDeviceProof(req, encoded, key, 'login').key;
}

// 一个会话一个有界重放窗口，拒绝重放和超量，不淘汰仍在有效期内的 nonce
export const CONSUME_DEVICE_PROOF = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if redis.call('ZSCORE', KEYS[2], ARGV[2]) then return -1 end
if redis.call('ZCARD', KEYS[2]) >= 2048 then return -2 end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2])
local lifetime = math.max(1, redis.call('TTL', KEYS[1]))
redis.call('EXPIRE', KEYS[2], math.min(125, lifetime))
local now = tonumber(ARGV[1])
local ip = ARGV[4]
if ip ~= '' then
  local last = redis.call('HGET', KEYS[3], 'lastIp')
  local seen = tonumber(redis.call('HGET', KEYS[3], 'lastSeenAt') or '0')
  if last ~= ip or now - seen >= 15000 then
    if now - tonumber(redis.call('HGET', KEYS[3], 'windowAt') or '0') >= 600000 then
      redis.call('HSET', KEYS[3], 'windowAt', now, 'ipChanges', 0)
      redis.call('DEL', KEYS[4])
      last = false
    end
    if last and last ~= ip then redis.call('HINCRBY', KEYS[3], 'ipChanges', 1) end
    redis.call('ZADD', KEYS[4], now, ip)
    redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now - 600000)
    redis.call('ZREMRANGEBYRANK', KEYS[4], 0, -9)
    local count = redis.call('ZCARD', KEYS[4])
    local changes = tonumber(redis.call('HGET', KEYS[3], 'ipChanges') or '0')
    redis.call('HSET', KEYS[3], 'lastIp', ip, 'lastSeenAt', now, 'ipCount', count)
    if count >= 3 and changes >= 6 then redis.call('HSET', KEYS[3], 'sharedAt', now) end
    redis.call('EXPIRE', KEYS[3], lifetime)
    redis.call('EXPIRE', KEYS[4], math.min(600, lifetime))
  end
end
return 1
`;
