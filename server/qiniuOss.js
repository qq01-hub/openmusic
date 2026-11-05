import { randomBytes } from 'crypto';
import qiniu from 'qiniu';
import { getRuntimeConfig } from './runtimeConfig.js';
import { isBuiltinStickerUrl } from './builtinStickers.js';

const UPLOAD_URLS = {
  z0: 'https://upload.qiniup.com',
  z1: 'https://upload-z1.qiniup.com',
  z2: 'https://upload-z2.qiniup.com',
  na0: 'https://upload-na0.qiniup.com',
  as0: 'https://upload-as0.qiniup.com',
};

const CHAT_PREFIX = 'openmusic/chat';
const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const TOKEN_EXPIRES = 3600;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const CHAT_IMAGE_MIME_LIMIT = 'image/jpeg;image/png;image/gif;image/webp';

export function isQiniuConfigured() {
  const config = getRuntimeConfig();
  return Boolean(config.qiniuAccessKey && config.qiniuSecretKey && config.qiniuBucket && config.qiniuDomain);
}

function getMac() {
  const config = getRuntimeConfig();
  return new qiniu.auth.digest.Mac(config.qiniuAccessKey, config.qiniuSecretKey);
}

function getConfig() {
  const { qiniuZone } = getRuntimeConfig();
  const zoneMap = {
    z0: qiniu.zone.Zone_z0,
    z1: qiniu.zone.Zone_z1,
    z2: qiniu.zone.Zone_z2,
    na0: qiniu.zone.Zone_na0,
    as0: qiniu.zone.Zone_as0,
  };
  const config = new qiniu.conf.Config();
  config.zone = zoneMap[qiniuZone] || qiniu.zone.Zone_z0;
  return config;
}

function sanitizeRoomId(roomId) {
  return String(roomId || '').replace(/[^A-Za-z0-9]/g, '');
}

export function roomChatPrefix(roomId) {
  return `${CHAT_PREFIX}/${sanitizeRoomId(roomId)}/`;
}

function normalizeExt(ext) {
  const normalized = String(ext || 'jpg').toLowerCase().replace(/^\./, '');
  if (!ALLOWED_EXTS.has(normalized)) return null;
  return normalized === 'jpeg' ? 'jpg' : normalized;
}

export function buildChatImageKey(roomId, ext) {
  const normalizedExt = normalizeExt(ext) || 'jpg';
  const safeRoomId = sanitizeRoomId(roomId);
  const suffix = randomBytes(8).toString('hex');
  return `${CHAT_PREFIX}/${safeRoomId}/${Date.now()}-${suffix}.${normalizedExt}`;
}

export function createChatImageUploadToken(roomId, ext) {
  if (!isQiniuConfigured()) {
    throw new Error('Qiniu not configured');
  }

  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt) {
    throw new Error('不支持的图片格式');
  }

  const key = buildChatImageKey(roomId, normalizedExt);
  const { qiniuBucket, qiniuZone } = getRuntimeConfig();
  const mac = getMac();
  const putPolicy = new qiniu.rs.PutPolicy({
    scope: `${qiniuBucket}:${key}`,
    expires: TOKEN_EXPIRES,
    insertOnly: 1,
    fsizeLimit: MAX_CHAT_IMAGE_BYTES,
    mimeLimit: CHAT_IMAGE_MIME_LIMIT,
    detectMime: 1,
  });

  return {
    token: putPolicy.uploadToken(mac),
    key,
    uploadUrl: UPLOAD_URLS[qiniuZone] || UPLOAD_URLS.z0,
    url: buildChatImageUrl(key),
  };
}

export function buildChatImageUrl(key) {
  return `${getRuntimeConfig().qiniuDomain}/${key}`;
}

const EXTERNAL_CHAT_IMAGE_HOST_RE = /^img[\w.-]*\.baidu\.com$/i;

export function validateExternalChatImage(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url || url.length > 2048) return { error: '图片地址无效' };
  if (isBuiltinStickerUrl(url)) return { ok: true };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: '图片地址无效' };
  }

  if (parsed.protocol !== 'https:' || !EXTERNAL_CHAT_IMAGE_HOST_RE.test(parsed.hostname)) {
    return { error: '图片地址无效' };
  }

  return { ok: true };
}

export function validateChatImageForRoom(roomId, imageUrl, imageKey) {
  if (!isQiniuConfigured()) {
    return { error: '图片上传未配置' };
  }

  const key = String(imageKey || '').trim();
  const url = String(imageUrl || '').trim();
  if (!key || !url) {
    return { error: '图片信息不完整' };
  }

  const expectedPrefix = roomChatPrefix(roomId);
  if (!key.startsWith(expectedPrefix)) {
    return { error: '无效的图片' };
  }

  if (url !== buildChatImageUrl(key)) {
    return { error: '无效的图片地址' };
  }

  return { ok: true };
}

function promisify(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, ...results) => {
      if (err) reject(err);
      else resolve(results.length <= 1 ? results[0] : results);
    });
  });
}

async function listAllKeys(prefix) {
  const { qiniuBucket } = getRuntimeConfig();
  const mac = getMac();
  const config = getConfig();
  const bucketManager = new qiniu.rs.BucketManager(mac, config);
  const keys = [];
  let marker = null;

  do {
    const options = { prefix, limit: 1000, marker };
    const result = await promisify(bucketManager.listPrefix.bind(bucketManager), qiniuBucket, options);
    const items = result?.items || [];
    for (const item of items) {
      if (item.key) keys.push(item.key);
    }
    marker = result?.marker || null;
  } while (marker);

  return keys;
}

async function batchDelete(keys) {
  if (!keys.length) return;

  const { qiniuBucket } = getRuntimeConfig();
  const mac = getMac();
  const config = getConfig();
  const bucketManager = new qiniu.rs.BucketManager(mac, config);
  const BATCH_SIZE = 1000;

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const chunk = keys.slice(i, i + BATCH_SIZE);
    const ops = chunk.map((key) => qiniu.rs.deleteOp(qiniuBucket, key));
    await promisify(bucketManager.batch.bind(bucketManager), ops);
  }
}

export async function deleteRoomChatImages(roomId) {
  if (!isQiniuConfigured()) return { deleted: 0 };

  try {
    const prefix = roomChatPrefix(roomId);
    const keys = await listAllKeys(prefix);
    if (keys.length === 0) return { deleted: 0 };

    await batchDelete(keys);
    console.log(`七牛云: 已删除房间 ${roomId} 的 ${keys.length} 张聊天图片`);
    return { deleted: keys.length };
  } catch (err) {
    console.error(`七牛云: 删除房间 ${roomId} 聊天图片失败:`, err.message);
    return { deleted: 0, error: err.message };
  }
}
