import { createHash } from 'node:crypto';
import { evalRedisScript } from './redisScripts.js';
import { AccountAuthError } from './accountAuth.js';
import { ACCOUNT_TOKEN_KEY_PREFIX } from './accountTokens.js';
import { riskChallengeChannel } from './riskChallengeBus.js';

const ACCOUNT_PATTERN = /^acct_[A-Za-z0-9_-]{16,64}$/u;
const ACCOUNT_PREFIX = 'openmusic:account:';
const PENDING_KEY = `${ACCOUNT_PREFIX}deletion-pending`;

// 最小注销标记永久保留，旧身份映射不能被游客或新账户重新认领
export const PREPARE_ACCOUNT_DELETION = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('SCARD', KEYS[2]) > 0 then return -1 end
if redis.call('EXISTS', KEYS[5]) == 1 then return -2 end
local uid = cjson.decode(ARGV[2]).roomUserId
if uid and uid ~= '' then
  local share = redis.call('GET', 'openmusic:favorite-share-owner:' .. uid)
  if share and string.match(share, '^[A-Za-z0-9_-]+$') and #share == 8 then
    redis.call('DEL', 'openmusic:favorite-share:' .. share)
  end
  redis.call('DEL', 'openmusic:favorites:' .. uid, 'openmusic:favorite-categories:' .. uid,
    'openmusic:favorite-share-owner:' .. uid)
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SADD', KEYS[3], ARGV[3])
for index = 6, #KEYS do
  if redis.call('GET', KEYS[index]) == ARGV[3] then redis.call('DEL', KEYS[index]) end
end
local sessions = redis.call('ZRANGE', KEYS[4], 0, -1)
for _, sid in ipairs(sessions) do
  for _, kind in ipairs({'family:', 'grace:', 'spent:', 'proof:', 'activity:', 'network:'}) do
    redis.call('DEL', ARGV[4] .. kind .. sid)
  end
  redis.call('PUBLISH', ARGV[5], 'session:' .. sid)
end
redis.call('DEL', KEYS[4])
return 1
`;

export const FINISH_ACCOUNT_DELETION = `
local raw = redis.call('GET', KEYS[1])
if not raw or not cjson.decode(raw).deletedAt then return 0 end
local uid = ARGV[3]
if uid ~= '' then
  local share = redis.call('GET', 'openmusic:favorite-share-owner:' .. uid)
  if share and string.match(share, '^[A-Za-z0-9_-]+$') and #share == 8 then
    redis.call('DEL', 'openmusic:favorite-share:' .. share)
  end
  redis.call('DEL', 'openmusic:favorites:' .. uid, 'openmusic:favorite-categories:' .. uid,
    'openmusic:favorite-share-owner:' .. uid)
end
redis.call('DEL', 'openmusic:account:music:' .. ARGV[1],
  'openmusic:account:room-identity-account:' .. ARGV[1])
redis.call('HDEL', KEYS[3], 'email', 'nickname')
redis.call('DEL', KEYS[4])
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SREM', KEYS[2], ARGV[1])
return 1
`;

export function validateAccountDeletion(input = {}, { admin = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.confirmation !== '注销账户') {
    throw new AccountAuthError('ACCOUNT_DELETION_CONFIRMATION_REQUIRED', '请输入“注销账户”以确认永久注销', 400);
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (admin && (!reason || reason.length > 200)) {
    throw new AccountAuthError('ACCOUNT_DELETION_REASON_INVALID', '请填写 1 至 200 字的注销原因', 400);
  }
  return { reason };
}

export function createAccountDeletionService({
  getStore, beforeDelete = async () => {}, cleanup = async () => {}, onDisabled = () => {}, onResult = () => {}, now = Date.now,
}) {
  const inFlight = new Map();
  const store = () => {
    const client = getStore();
    if (!client) throw new AccountAuthError('REDIS_UNAVAILABLE', '账户注销服务暂不可用，请稍后重试', 503);
    return client;
  };

  async function finish(id, record) {
    try {
      await onDisabled(id);
      await cleanup(id, record.roomUserId || '');
      const finished = await evalRedisScript(store(), FINISH_ACCOUNT_DELETION, {
        keys: [`${ACCOUNT_PREFIX}${id}`, PENDING_KEY, `openmusic:risk:v1:account:${id}`, `openmusic:risk:v1:nicknames:${id}`],
        arguments: [id, JSON.stringify({ id, deletedAt: record.deletedAt, deletionPending: false }), record.roomUserId || ''],
      });
      if (Number(finished) !== 1) throw new Error('Account deletion state changed');
      onResult('completed');
      return { ok: true, deletedAt: record.deletedAt, pending: false };
    } catch {
      onResult('pending');
      return { ok: true, deletedAt: record.deletedAt, pending: true };
    }
  }

  async function removeInternal(id) {
    if (!ACCOUNT_PATTERN.test(id)) throw new AccountAuthError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
    const client = store();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const raw = await client.get(`${ACCOUNT_PREFIX}${id}`);
      if (!raw) throw new AccountAuthError('ACCOUNT_NOT_FOUND', '账户不存在', 404);
      const account = JSON.parse(raw);
      if (account.deletedAt) {
        if (!account.deletionPending) return { ok: true, deletedAt: account.deletedAt, pending: false };
        return finish(id, account);
      }
      await beforeDelete(id);
      const roomUserId = typeof account.roomUserId === 'string' && /^[A-Za-z0-9_-]{8,64}$/u.test(account.roomUserId)
        ? account.roomUserId : '';
      const record = { id, roomUserId, deletedAt: now(), deletionPending: true };
      const indices = [];
      const hash = value => createHash('sha256').update(value).digest('hex');
      if (account.email) indices.push(`${ACCOUNT_PREFIX}email:${hash(String(account.email).trim().toLowerCase())}`);
      for (const identity of account.identities || []) {
        if (['github', 'linuxdo', 'wechat'].includes(identity.provider) && typeof identity.subject === 'string') {
          indices.push(`${ACCOUNT_PREFIX}identity:${identity.provider}:${hash(identity.subject)}`);
        }
      }
      const prepared = Number(await evalRedisScript(client, PREPARE_ACCOUNT_DELETION, {
        keys: [`${ACCOUNT_PREFIX}${id}`, `${ACCOUNT_PREFIX}rooms:${id}`, PENDING_KEY, `${ACCOUNT_TOKEN_KEY_PREFIX}sessions:${id}`, `${ACCOUNT_PREFIX}music-lock:${id}`, ...indices],
        arguments: [raw, JSON.stringify(record), id, ACCOUNT_TOKEN_KEY_PREFIX, riskChallengeChannel(client)],
      }));
      if (prepared === -1) throw new AccountAuthError('ACCOUNT_HAS_OWNED_ROOMS', '请先解散或转让自己创建的房间，再注销账户', 409);
      if (prepared === -2) throw new AccountAuthError('ACCOUNT_MUSIC_BUSY', '音乐账号正在处理中，请稍后再注销', 409);
      if (prepared === 1) return finish(id, record);
    }
    throw new AccountAuthError('ACCOUNT_UPDATE_CONFLICT', '账户状态已变化，请重试', 409);
  }

  function remove(id) {
    if (inFlight.has(id)) return inFlight.get(id);
    const task = removeInternal(id).finally(() => inFlight.delete(id));
    inFlight.set(id, task);
    return task;
  }

  let resuming = false;
  let pendingCursor = '0';
  async function resumePending() {
    if (resuming) return;
    resuming = true;
    try {
      const client = store();
      const { members, cursor } = await client.sScan(PENDING_KEY, pendingCursor, { COUNT: 20 });
      pendingCursor = cursor;
      for (const id of members) await remove(id);
    } catch {
      onResult('retry_failed');
    } finally {
      resuming = false;
    }
  }
  return { remove, resumePending };
}
