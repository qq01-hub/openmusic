import { decryptSensitiveValue, encryptSensitiveValue } from './roomCredentialCrypto.js';
import { anonymousAccountId } from './anonymousAccess.js';

const PLATFORM_SET = new Set(['netease', 'tencent', 'kugou', 'qishui']);
const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9_-]{16,64}$/u;
const ROOM_ID_PATTERN = /^[A-Z0-9_-]{4,64}$/u;
const KEY_PREFIX = 'openmusic:account:music:';

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function accountId(value) {
  const id = String(value || '').trim();
  return ACCOUNT_ID_PATTERN.test(id) ? id : '';
}

function platform(value) {
  const valueText = String(value || '').trim().toLowerCase();
  return PLATFORM_SET.has(valueText) ? valueText : '';
}

function roomId(value) {
  const id = String(value || '').trim().toUpperCase();
  return ROOM_ID_PATTERN.test(id) ? id : '';
}

function key(id) {
  return `${KEY_PREFIX}${id}`;
}

function normalizeMetadata(raw, fallbackPlatform = '') {
  if (!raw || typeof raw !== 'object') return null;
  const plat = platform(raw.platform || fallbackPlatform);
  if (!plat) return null;
  const cookieId = String(raw.cookieId || raw.id || '').trim();
  if (!cookieId) return null;
  return {
    cookieId,
    platform: plat,
    shared: Boolean(raw.shared),
    hasVip: Boolean(raw.hasVip),
    hasSvip: Boolean(raw.hasVip && raw.hasSvip),
    canSearchSongs: raw.canSearchSongs !== false,
    canSearchPlaylists: raw.canSearchPlaylists !== false,
    usage: raw.hasVip ? 'vip' : 'fm',
    nickname: String(raw.nickname || '').slice(0, 64),
    providerName: String(raw.providerName || '').slice(0, 64),
    avatarUrl: String(raw.avatarUrl || '').slice(0, 512),
    userId: String(raw.userId || '').slice(0, 64),
    revokeToken: String(raw.revokeToken || '').slice(0, 128),
    isValid: raw.isValid !== false,
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function emptyAccounts() {
  return { netease: null, tencent: null, kugou: null, qishui: null };
}

function publicMetadata(metadata) {
  if (!metadata) return null;
  const { revokeToken: _revokeToken, ...result } = metadata;
  return result;
}

function requireAccount(rawId) {
  const id = accountId(rawId);
  if (!id) throw fail('ACCOUNT_AUTH_REQUIRED', '请先登录账户', 401);
  return id;
}

function requirePlatform(rawPlatform) {
  const plat = platform(rawPlatform);
  if (!plat) throw fail('INVALID_MUSIC_PLATFORM', '不支持的音源平台');
  return plat;
}

function requireStore(getStore) {
  const store = typeof getStore === 'function' ? getStore() : null;
  if (!store) throw fail('REDIS_UNAVAILABLE', '账户服务暂不可用，请稍后重试', 503);
  return store;
}

function ownsRoom(id, room, ownerUserId) {
  if (!room) return false;
  if (ownerUserId) {
    return id === anonymousAccountId(ownerUserId)
      && !room.ownerAccountId && room.creatorId === ownerUserId;
  }
  return !id.startsWith('acct_anon_') && room.ownerAccountId === id;
}

function readRecord(store, id, plat) {
  return store.hGet(key(id), plat).then((raw) => {
    if (!raw) return null;
    try {
      const record = JSON.parse(raw);
      const metadata = normalizeMetadata(record.metadata, plat);
      if (!metadata) return null;
      const cookie = decryptSensitiveValue(record.cookie, `account-music:${id}:${plat}`);
      return { metadata, cookie };
    } catch {
      return null;
    }
  });
}

export function createAccountMusicService({
  getStore,
  getConfig = () => ({}),
  share = async () => ({ ok: false, error: '共享服务不可用' }),
  unshare = async () => ({ ok: true }),
} = {}) {
  async function list(rawAccountId) {
    const id = requireAccount(rawAccountId);
    const store = requireStore(getStore);
    const all = typeof store.hGetAll === 'function' ? await store.hGetAll(key(id)) : {};
    const result = emptyAccounts();
    for (const plat of PLATFORM_SET) {
      if (!all?.[plat]) continue;
      try {
        const record = JSON.parse(all[plat]);
        result[plat] = publicMetadata(normalizeMetadata(record.metadata, plat));
      } catch {
        result[plat] = null;
      }
    }
    return result;
  }

  async function save(rawAccountId, rawPlatform, rawMetadata, cookie) {
    const id = requireAccount(rawAccountId);
    const plat = requirePlatform(rawPlatform);
    const metadata = normalizeMetadata(rawMetadata, plat);
    const secret = String(cookie || '').trim();
    if (!metadata || !secret) throw fail('INVALID_MUSIC_ACCOUNT', '音乐会员账号数据无效');
    const encrypted = encryptSensitiveValue(secret, `account-music:${id}:${plat}`);
    if (!encrypted) throw fail('MUSIC_CREDENTIAL_ENCRYPTION_UNAVAILABLE', '服务端未配置凭证加密密钥', 503);
    const store = requireStore(getStore);
    await store.hSet(key(id), plat, JSON.stringify({ metadata: { ...metadata, shared: false }, cookie: encrypted }));
    return publicMetadata({ ...metadata, shared: false });
  }

  async function remove(rawAccountId, rawPlatform) {
    const id = requireAccount(rawAccountId);
    const plat = requirePlatform(rawPlatform);
    const store = requireStore(getStore);
    const current = await readRecord(store, id, plat);
    if (current?.metadata.shared) {
      const result = await unshare(id, plat, current.cookie, current.metadata);
      if (result?.ok === false) throw fail(result.code || 'MUSIC_UNSHARE_FAILED', result.error || '删除共享会员失败', result.status || 502);
    }
    // 保留无凭证的删除标记，防止仍存活的旧房间补存时复活已删除的会员
    await store.hSet(key(id), plat, JSON.stringify({ deleted: true, updatedAt: Date.now() }));
    return list(id);
  }

  async function setShared(rawAccountId, rawPlatform, shared) {
    const id = requireAccount(rawAccountId);
    const plat = requirePlatform(rawPlatform);
    const current = await readRecord(requireStore(getStore), id, plat);
    if (!current) throw fail('MUSIC_ACCOUNT_NOT_FOUND', '账户中没有该音乐会员账号', 404);
    if (!shared) {
      const result = await unshare(id, plat, current.cookie, current.metadata);
      if (result?.ok === false) throw fail(result.code || 'MUSIC_UNSHARE_FAILED', result.error || '取消共享失败', result.status || 502);
      const store = requireStore(getStore);
      await store.hSet(key(id), plat, JSON.stringify({ metadata: { ...current.metadata, shared: false, updatedAt: Date.now() }, cookie: encryptSensitiveValue(current.cookie, `account-music:${id}:${plat}`) }));
      return publicMetadata({ ...current.metadata, shared: false });
    }
    const config = getConfig() || {};
    if (config.sharedMembershipEnabled === false) throw fail('SHARED_MEMBERSHIP_DISABLED', '共享会员功能当前已关闭', 403);
    if (!current.metadata.hasVip) throw fail('MUSIC_VIP_REQUIRED', '只有会员账号可以共享');
    const result = await share({ accountId: id, platform: plat, cookie: current.cookie, metadata: current.metadata });
    if (!result?.ok) throw fail(result?.code || 'MUSIC_SHARE_FAILED', result?.error || '共享会员失败', result?.status || 502);
    const metadata = normalizeMetadata({ ...(result.data || {}), ...current.metadata, shared: true, revokeToken: result.revokeToken || result.data?.revokeToken }, plat) || { ...current.metadata, shared: true, revokeToken: result.revokeToken || '' };
    const store = requireStore(getStore);
    await store.hSet(key(id), plat, JSON.stringify({ metadata: { ...metadata, shared: true, updatedAt: Date.now() }, cookie: encryptSensitiveValue(current.cookie, `account-music:${id}:${plat}`) }));
    return publicMetadata({ ...metadata, shared: true });
  }

  async function rememberRoom(rawAccountId, room, { ownerUserId } = {}) {
    const id = requireAccount(rawAccountId);
    if (!ownsRoom(id, room, ownerUserId)) return false;
    const accounts = room.musicAccounts || {};
    const secrets = room.musicAccountSecrets || {};
    const store = requireStore(getStore);
    for (const plat of PLATFORM_SET) {
      const metadata = normalizeMetadata(accounts[plat], plat);
      const cookie = String(secrets[plat] || '').trim();
      if (!metadata || !cookie) continue;
      const encrypted = encryptSensitiveValue(cookie, `account-music:${id}:${plat}`);
      if (!encrypted) throw fail('MUSIC_CREDENTIAL_ENCRYPTION_UNAVAILABLE', '服务端未配置凭证加密密钥', 503);
      // 补存只填空，不覆盖主动绑定、共享状态或删除标记
      await store.hSetNX(key(id), plat, JSON.stringify({ metadata: { ...metadata, shared: false }, cookie: encrypted }));
    }
    return true;
  }

  async function restoreRoom(rawAccountId, room, apply, { ownerUserId } = {}) {
    const id = requireAccount(rawAccountId);
    if (!ownsRoom(id, room, ownerUserId)) throw fail('ROOM_ACCOUNT_CONFLICT', '房间不属于当前身份', 409);
    if (typeof apply !== 'function') return false;
    const accounts = await list(id);
    for (const plat of PLATFORM_SET) {
      if (room.musicAccounts?.[plat] || !accounts[plat]) continue;
      const record = await readRecord(requireStore(getStore), id, plat);
      if (!record?.cookie) {
        throw fail('MUSIC_CREDENTIAL_UNAVAILABLE', '账户会员凭证无法读取，请重新绑定或联系管理员检查加密配置', 503);
      }
      await apply(room.id, plat, {
        ...record.metadata,
        cookieId: `local-${room.id}-${plat}`,
        shared: false,
        revokeToken: '',
      }, { localCookie: record.cookie });
    }
    return true;
  }

  async function migrateAnonymous(rawAccountId, verifiedUserId) {
    const id = requireAccount(rawAccountId);
    const sourceId = anonymousAccountId(verifiedUserId);
    if (!sourceId || id.startsWith('acct_anon_')) throw fail('ACCOUNT_AUTH_REQUIRED', '请先登录账户', 401);
    const store = requireStore(getStore);
    for (const plat of PLATFORM_SET) {
      const record = await readRecord(store, sourceId, plat);
      if (!record) continue;
      if (!record.cookie) throw fail('MUSIC_CREDENTIAL_UNAVAILABLE', '旧设备音乐凭证无法读取，请检查加密配置', 503);
      const encrypted = encryptSensitiveValue(record.cookie, `account-music:${id}:${plat}`);
      if (!encrypted) throw fail('MUSIC_CREDENTIAL_ENCRYPTION_UNAVAILABLE', '服务端未配置凭证加密密钥', 503);
      await store.hSetNX(key(id), plat, JSON.stringify({
        metadata: { ...record.metadata, shared: false, revokeToken: '' }, cookie: encrypted,
      }));
    }
  }

  return { list, save, remove, setShared, rememberRoom, restoreRoom, migrateAnonymous };
}

export { accountId, platform, roomId };
