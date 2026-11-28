import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import {
  createAccountTokenService,
  accountTokenSessionId,
  ACCOUNT_ACCESS_TTL_SEC,
} from './accountTokens.js';

const USER_ID = 'acct_1234567890abcdef';
const OTHER_USER_ID = 'acct_fedcba0987654321';
const PREFIX = 'test:auth:';
const enc = (value) => `enc(${value})`;
const dec = (value) => (typeof value === 'string' && value.startsWith('enc(') && value.endsWith(')'))
  ? value.slice(4, -1)
  : null;

/**
 * 内存版令牌存储：get/set/del/hExists + eval 垫片。
 * eval 只复刻 issue 的建会话脚本与 refresh 的 ROTATE_SCRIPT 的可观察语义
 * （当前/上一代哈希、宽限期缓存、spent 集合、replay 时整族删除），不连真 Redis。
 */
function createFakeTokenStore() {
  const strings = new Map();
  const hashes = new Map();
  const client = {
    options: { database: 0 },
    strings,
    hashes,
    async get(key) { return strings.get(key) ?? null; },
    async set(key, value) { strings.set(key, String(value)); return 'OK'; },
    async del(...keys) {
      let n = 0;
      for (const key of keys.flat()) {
        if (strings.delete(key) || hashes.delete(key)) n += 1;
      }
      return n;
    },
    async hExists(key, field) { return hashes.get(key)?.has(field) ? 1 : 0; },
    async eval(script, { keys, arguments: args }) {
      if (script.includes('ZREMRANGEBYSCORE')) {
        // issue 建会话：账户不存在/已删返回 -2，已有同 sid 返回 0，否则写入返回 1
        const [familyKey, , accountKey] = keys;
        const accountRaw = strings.get(accountKey);
        if (!accountRaw || JSON.parse(accountRaw).deletedAt) return -2;
        if (strings.has(familyKey)) return 0;
        strings.set(familyKey, args[1]);
        return 1;
      }
      if (script.includes("'replay'")) {
        // ROTATE_SCRIPT 语义复刻
        const [familyKey, graceKey, spentKey, , proofKey, activityKey, networkKey] = keys;
        const raw = strings.get(familyKey);
        if (!raw) return ['invalid'];
        const record = JSON.parse(raw);
        const now = Number(args[0]);
        if (Number(record.expiresAt) <= now) return ['invalid'];
        const previous = record.previousHash === args[1];
        const current = record.refreshHash === args[1];
        if ((current || previous) && Number(record.graceUntil || 0) > now) {
          const cached = strings.get(graceKey);
          if (cached) return ['ok', cached];
        }
        if (!current) {
          if (hashes.get(spentKey)?.has(args[1])) {
            for (const key of [familyKey, graceKey, spentKey, proofKey, activityKey, networkKey]) {
              strings.delete(key);
              hashes.delete(key);
            }
            return ['replay'];
          }
          return ['invalid'];
        }
        if (raw !== args[2]) return ['conflict'];
        if (!hashes.has(spentKey)) hashes.set(spentKey, new Map());
        hashes.get(spentKey).set(args[1], '1');
        strings.set(familyKey, args[3]);
        strings.set(graceKey, args[4]);
        return ['ok', args[4]];
      }
      throw new Error('fake token store: 未实现的 eval 脚本');
    },
  };
  return client;
}

function createHarness() {
  const store = createFakeTokenStore();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  store.strings.set(`${PREFIX}signing-key`, JSON.stringify({
    version: 1,
    publicKey: publicPem,
    privateKey: enc(privatePem),
  }));
  store.strings.set(`openmusic:account:${USER_ID}`, JSON.stringify({ id: USER_ID }));
  let nowMs = 1_700_000_000_000;
  const accounts = new Map([[USER_ID, { id: USER_ID }]]);
  const service = createAccountTokenService({
    getStore: () => store,
    getAccount: async (id) => accounts.get(id) || null,
    now: () => nowMs,
    prefix: PREFIX,
    encrypt: enc,
    decrypt: dec,
  });
  return {
    store,
    service,
    familyKey: (sid) => `${PREFIX}family:${sid}`,
    advanceMs(ms) { nowMs += ms; },
    async issue() {
      return service.issue(USER_ID, undefined, { allowLegacy: true });
    },
    editRecord(sid, patch) {
      const key = `${PREFIX}family:${sid}`;
      const record = JSON.parse(store.strings.get(key));
      store.strings.set(key, JSON.stringify({ ...record, ...patch }));
    },
  };
}

test('inspect：签发后可验出会话，字段与令牌一致', async () => {
  const h = createHarness();
  const issued = await h.issue();
  const session = await h.service.inspect(issued.accessToken);
  assert.ok(session);
  assert.equal(session.account.id, USER_ID);
  assert.equal(session.sessionId, issued.sessionId);
  assert.equal(accountTokenSessionId(issued.accessToken), issued.sessionId);
  assert.equal(session.expiresAt, issued.expiresAt);
});

test('inspect：签名被篡改的令牌被拒', async () => {
  const h = createHarness();
  const issued = await h.issue();
  const parts = issued.accessToken.split('.');
  const forgedClaims = Buffer.from(JSON.stringify({
    iss: 'openmusic', aud: 'openmusic-account', sub: OTHER_USER_ID,
    sid: issued.sessionId, iat: 1_700_000_000, exp: 1_700_000_000 + ACCOUNT_ACCESS_TTL_SEC,
  })).toString('base64url');
  assert.equal(await h.service.inspect(`${parts[0]}.${forgedClaims}.${parts[2]}`), null);
  assert.equal(await h.service.inspect('not-a-token'), null);
});

test('inspect：access 令牌过期后被拒', async () => {
  const h = createHarness();
  const issued = await h.issue();
  h.advanceMs((ACCOUNT_ACCESS_TTL_SEC + 60) * 1000);
  assert.equal(await h.service.inspect(issued.accessToken), null);
});

test('inspect：会话记录版本不符 / userId 不符 / 记录过期 / 记录缺失均被拒', async () => {
  const h = createHarness();
  const issued = await h.issue();

  h.editRecord(issued.sessionId, { version: 1 });
  assert.equal(await h.service.inspect(issued.accessToken), null, 'version !== 2 应拒绝');

  h.editRecord(issued.sessionId, { version: 2, userId: OTHER_USER_ID });
  assert.equal(await h.service.inspect(issued.accessToken), null, 'userId 与 claims.sub 不符应拒绝');

  h.editRecord(issued.sessionId, { userId: USER_ID, expiresAt: 1_600_000_000 });
  assert.equal(await h.service.inspect(issued.accessToken), null, '记录已过期应拒绝');

  h.store.strings.delete(h.familyKey(issued.sessionId));
  assert.equal(await h.service.inspect(issued.accessToken), null, '记录缺失应拒绝');
});

test('refresh：轮换后新旧令牌更替，宽限期内旧令牌返回同一新对', async () => {
  const h = createHarness();
  const issued = await h.issue();
  const rotated = await h.service.refresh(issued.refreshToken);
  assert.notEqual(rotated.refreshToken, issued.refreshToken);
  assert.equal(rotated.sessionId, issued.sessionId);
  assert.ok(await h.service.inspect(rotated.accessToken), '新 access 应可验');

  const graceReplay = await h.service.refresh(issued.refreshToken);
  assert.equal(graceReplay.refreshToken, rotated.refreshToken, '宽限期内重复提交旧令牌应返回缓存的新对而非判重放');
});

test('refresh：宽限期后复用旧 refresh 判 replay 并吊销整族会话', async () => {
  const h = createHarness();
  const issued = await h.issue();
  const rotated = await h.service.refresh(issued.refreshToken);

  h.advanceMs(11_000); // 超过 10 秒宽限期
  await assert.rejects(
    () => h.service.refresh(issued.refreshToken),
    (err) => err.code === 'ACCOUNT_REFRESH_REUSED',
  );
  assert.equal(await h.service.inspect(rotated.accessToken), null, 'replay 后整族会话应被吊销');
});

test('refresh：格式非法的令牌直接判无效', async () => {
  const h = createHarness();
  await assert.rejects(
    () => h.service.refresh('garbage'),
    (err) => err.code === 'ACCOUNT_REFRESH_INVALID',
  );
});
