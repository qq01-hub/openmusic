import assert from 'node:assert/strict';
import test from 'node:test';

const module = await import('./accountMusic.js').catch(() => ({}));
const accountId = 'acct_abcdefghijklmnopqrstuvwx';
const otherId = 'acct_zyxwvutsrqponmlkjihgfedcba';
const metadata = {
  cookieId: 'local-ROOM-netease', platform: 'netease', hasVip: true, hasSvip: true,
  nickname: '音乐账号', avatarUrl: '', userId: '123', isValid: true,
  shared: true, updatedAt: 123, canSearchSongs: true, canSearchPlaylists: true,
};

function setup(options = {}) {
  const hashes = new Map();
  const locks = new Map();
  const upstream = new Map();
  const store = {
    async hGet(key, field) { return hashes.get(key)?.[field] ?? null; },
    async hGetAll(key) { return { ...hashes.get(key) }; },
    async hSet(key, field, value) {
      hashes.set(key, { ...hashes.get(key), [field]: value });
      return 1;
    },
    async hSetNX(key, field, value) {
      if (hashes.get(key)?.[field] !== undefined) return false;
      await this.hSet(key, field, value);
      return true;
    },
    async hDel(key, field) {
      const next = { ...hashes.get(key) };
      delete next[field];
      hashes.set(key, next);
      return 1;
    },
    async set(key, value) {
      if (locks.has(key)) return null;
      locks.set(key, value);
      return 'OK';
    },
    async eval(_script, { keys, arguments: args }) {
      if (locks.get(keys[0]) !== args[0]) return 0;
      locks.delete(keys[0]);
      return 1;
    },
  };
  assert.equal(typeof module.createAccountMusicService, 'function', '账户音乐凭证服务尚未实现');
  const service = module.createAccountMusicService({
    getStore: () => store,
    getConfig: () => ({ sharedMembershipEnabled: true, musicSourcesEnabled: { netease: true } }),
    share: async ({ accountId: ownerId, platform }) => {
      upstream.set(`${ownerId}:${platform}`, true);
      return { ok: true, data: { ...metadata, shared: true } };
    },
    unshare: async (roomId, platform) => {
      upstream.delete(`${roomId}:${platform}`);
      upstream.delete(`${accountId}:${platform}`);
      return { ok: true };
    },
    ...options,
  });
  return { service, hashes, upstream };
}

process.env.ROOM_CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);

test('音乐凭证随账户加密持久化且公开响应不包含凭证', async () => {
  const { service, hashes } = setup();
  await service.save(accountId, 'netease', metadata, 'private-cookie');
  const accounts = await service.list(accountId);
  assert.equal(accounts.netease.nickname, '音乐账号');
  assert.equal(accounts.netease.hasSvip, true);
  assert.equal(accounts.netease.shared, false);
  assert.equal(JSON.stringify([...hashes.values()]).includes('private-cookie'), false);
  assert.equal(JSON.stringify(accounts).includes('private-cookie'), false);
  assert.equal((await service.list(otherId)).netease, null);
});

test('重建服务后新房间复用会员且原房间记录保持独立', async () => {
  const { service } = setup();
  const original = {
    id: 'ROOM1', ownerAccountId: accountId, musicAccounts: { netease: metadata },
    musicAccountSecrets: { netease: 'private-cookie' },
  };
  await service.rememberRoom(accountId, original);
  const room = { id: 'ROOM2', ownerAccountId: accountId, musicAccounts: {}, musicAccountSecrets: {} };
  const applied = [];
  await service.restoreRoom(accountId, room, (...args) => applied.push(args));
  assert.equal(applied[0][0], 'ROOM2');
  assert.equal(applied[0][1], 'netease');
  assert.equal(applied[0][2].hasVip, true);
  assert.equal(applied[0][2].shared, false);
  assert.equal(applied[0][3].localCookie, 'private-cookie');
  await service.remove(accountId, 'netease');
  assert.equal((await service.list(accountId)).netease, null);
  assert.equal(original.musicAccountSecrets.netease, 'private-cookie');
  const afterDelete = [];
  await service.restoreRoom(accountId, room, (...args) => afterDelete.push(args));
  assert.equal(afterDelete.length, 0);
});

test('不能通过其他账户的房间读取或复用音乐凭证', async () => {
  const { service } = setup();
  const room = {
    id: 'ROOM1', ownerAccountId: otherId, musicAccounts: { netease: metadata },
    musicAccountSecrets: { netease: 'other-cookie' },
  };
  await service.rememberRoom(accountId, room);
  assert.equal((await service.list(accountId)).netease, null);
  await service.save(accountId, 'netease', metadata, 'private-cookie');
  await assert.rejects(service.restoreRoom(accountId, room, () => assert.fail('不得写入其他账户房间')), { code: 'ROOM_ACCOUNT_CONFLICT' });
});

test('共享直接使用保存的凭证且关闭或删除不移除原房间共享', async () => {
  const { service, upstream } = setup();
  upstream.set('ROOM1:netease', true);
  await service.save(accountId, 'netease', metadata, 'private-cookie');
  await service.setShared(accountId, 'netease', true);
  assert.equal((await service.list(accountId)).netease.shared, true);
  assert.equal(upstream.size, 2);
  await service.remove(accountId, 'netease');
  assert.equal(upstream.size, 1);
  assert.equal(upstream.has('ROOM1:netease'), true);
});

test('拒绝无效账户、平台、无会员共享和后台关闭的共享', async () => {
  const { service } = setup();
  await assert.rejects(service.list(''), { code: 'ACCOUNT_AUTH_REQUIRED' });
  await assert.rejects(service.remove(accountId, 'invalid'), { code: 'INVALID_MUSIC_PLATFORM' });
  await service.save(accountId, 'netease', { ...metadata, hasVip: false }, 'private-cookie');
  await assert.rejects(service.setShared(accountId, 'netease', true), { code: 'MUSIC_VIP_REQUIRED' });
  const disabled = setup({ getConfig: () => ({ sharedMembershipEnabled: false }) }).service;
  await disabled.save(accountId, 'netease', metadata, 'private-cookie');
  await assert.rejects(disabled.setShared(accountId, 'netease', true), { code: 'SHARED_MEMBERSHIP_DISABLED' });
});

test('上游共享失败保留账号凭证和原共享状态', async () => {
  const { service } = setup({ share: async () => ({ ok: false, error: 'upstream failed' }) });
  await service.save(accountId, 'netease', metadata, 'private-cookie');
  await assert.rejects(service.setShared(accountId, 'netease', true), { code: 'MUSIC_SHARE_FAILED' });
  assert.equal((await service.list(accountId)).netease.shared, false);
});

test('Redis 不可用时明确失败，不使用本地缓存保存账户凭证', async () => {
  const { service } = setup({ getStore: () => null });
  await assert.rejects(service.list(accountId), { code: 'REDIS_UNAVAILABLE' });
  await assert.rejects(service.save(accountId, 'netease', metadata, 'private-cookie'), { code: 'REDIS_UNAVAILABLE' });
});
