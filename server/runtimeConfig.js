import fs from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { isBlockedMediaHostname } from './mediaProxy.js';
import { normalizeMusicApis } from './customMusicApi.js';
import { buildPublicSiteSeo } from './seoFiles.js';
import { normalizeMusicSourcesEnabled } from './musicSources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'runtimeConfig.json');
const SECRET_FIELDS = new Set([
  'metingApiAuth',
  'qiniuAccessKey',
  'qiniuSecretKey',
  'apihzId',
  'apihzKey',
  'linuxdoClientSecret',
  'githubClientSecret',
  'smtpPass',
  'roomCredentialEncryptionKey',
  'aiApiKey',
]);
const QINIU_ZONES = new Set(['z0', 'z1', 'z2', 'na0', 'as0']);
const ENC_PREFIX = 'enc:v1:';
const FAVORITE_SHARE_TTL_DEFAULT_MS = 30 * 24 * 60 * 60 * 1000;
const FAVORITE_SHARE_TTL_MIN_MS = 60 * 60 * 1000;
const FAVORITE_SHARE_TTL_MAX_MS = 90 * 24 * 60 * 60 * 1000;
/** 管理后台回显：保留首尾，中间用 ...... 隐藏 */
const MASK_GAP = '......';

let cached = { mtimeMs: -1, persisted: {} };

export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return `${text.slice(0, 1)}${MASK_GAP}`;
  if (text.length <= 8) return `${text.slice(0, 2)}${MASK_GAP}${text.slice(-1)}`;
  return `${text.slice(0, 3)}${MASK_GAP}${text.slice(-3)}`;
}

function envText(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function envNumber(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.round(value), max));
}

function envRoomEmptyTtlMs() {
  const value = Number(process.env.ROOM_EMPTY_TTL_MS);
  if (!Number.isFinite(value)) return 10 * 60 * 1000;
  return Math.max(0, Math.min(Math.round(value), 24 * 60 * 60 * 1000));
}

// 服务重启后，恢复出的「有内容」空房（队列/当前曲/点歌历史）会短暂无人。
// 此项为重连宽限期（毫秒）：默认与空房 TTL 相同；设大一点可给用户更久重连时间。
// 设为 0 时同样回退到 ROOM_EMPTY_TTL_MS，不会永久保留。
function envRoomRestartGraceMs() {
  const value = Number(process.env.ROOM_RESTART_GRACE_MS);
  if (!Number.isFinite(value)) return 0; // 0 = 使用 roomEmptyTtlMs
  return Math.max(0, Math.min(Math.round(value), 7 * 24 * 60 * 60 * 1000));
}

/** 收藏分享有效期仅由管理后台运行配置维护。 */
export function normalizeFavoriteShareTtlMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return FAVORITE_SHARE_TTL_DEFAULT_MS;
  return Math.max(FAVORITE_SHARE_TTL_MIN_MS, Math.min(Math.round(numeric), FAVORITE_SHARE_TTL_MAX_MS));
}

function envDefaults() {
  return {
    roomEmptyTtlMs: envRoomEmptyTtlMs(),
    roomRestartGraceMs: envRoomRestartGraceMs(),
    /** 同一用户/设备建房冷却（毫秒）；0 = 关闭冷却 */
    roomCreateCooldownMs: 5 * 60 * 1000,
    /** 同一用户/设备最多同时保留的自建房数；0 = 不限制 */
    roomCreateMaxOwned: 2,
    /** 无设备/用户标识时按 IP 的宽松冷却（毫秒）；0 = 关闭 */
    roomCreateIpLooseCooldownMs: 60 * 1000,
    /** 收藏分享固定快照的有效期；在管理后台运行配置中维护。 */
    favoriteShareTtlMs: FAVORITE_SHARE_TTL_DEFAULT_MS,
    // 注册邮箱验证码 SMTP：仅由管理后台维护；密码作为密钥字段加密落盘。
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    // Linux.do OAuth2（房主身份绑定 / 后台登录）：全部留空表示未配置、功能自动关闭。
    // 需要先在 https://connect.linux.do 注册应用拿到 client_id / secret / 回调地址，
    // 并向 Linux.do 核实真实的授权 / 令牌 / 用户信息接口地址后再填写，不要照抄示例值。
    linuxdoClientId: envText('LINUXDO_CLIENT_ID'),
    linuxdoClientSecret: envText('LINUXDO_CLIENT_SECRET'),
    linuxdoRedirectUri: envText('LINUXDO_REDIRECT_URI'),
    linuxdoAuthorizeUrl: envText('LINUXDO_AUTHORIZE_URL'),
    linuxdoTokenUrl: envText('LINUXDO_TOKEN_URL'),
    linuxdoUserInfoUrl: envText('LINUXDO_USERINFO_URL'),
    linuxdoScope: envText('LINUXDO_SCOPE', 'user'),
    // GitHub OAuth（房主身份绑定 / 后台登录）：只需在 https://github.com/settings/developers
    // 注册一个 OAuth App 拿到 client_id / secret，授权 / 令牌 / 用户信息接口地址是 GitHub
    // 公开且稳定的固定地址，写死在 server/githubAuth.js 里，不需要在这里配置。
    githubClientId: envText('GITHUB_CLIENT_ID'),
    githubClientSecret: envText('GITHUB_CLIENT_SECRET'),
    githubRedirectUri: envText('GITHUB_REDIRECT_URI'),
    githubScope: envText('GITHUB_SCOPE', 'read:user'),
    roomCredentialEncryptionKey: envText('ROOM_CREDENTIAL_ENCRYPTION_KEY'),
    /** 各平台是否开放 SVIP/高级音质选项；旧 SVIP_QUALITY_ENABLED 会作为全平台兼容默认值。 */
    svipQualityEnabled: (() => { const enabled = envText('SVIP_QUALITY_ENABLED') === '1' || envText('SVIP_QUALITY_ENABLED').toLowerCase() === 'true'; return { netease: enabled, tencent: enabled, kugou: enabled, qishui: enabled }; })(),
    /** 是否开放全站共享会员入口 */
    sharedMembershipEnabled: true,
    qqGroupUrl: '',
    metingApiUrl: envText('METING_API_URL'),
    metingApiAuth: envText('METING_API_AUTH'),
    musicApis: [],
    musicSourcesEnabled: { netease: true, tencent: true, kugou: true, qishui: true },
    qiniuAccessKey: envText('QINIU_ACCESS_KEY'),
    qiniuSecretKey: envText('QINIU_SECRET_KEY'),
    qiniuBucket: envText('QINIU_BUCKET'),
    qiniuDomain: envText('QINIU_DOMAIN'),
    qiniuZone: envText('QINIU_ZONE', 'z0'),
    apihzBaseUrl: envText('APIHZ_BASE_URL', 'https://cn.apihz.cn/api'),
    apihzId: envText('APIHZ_ID', envText('APIHZ_IMG_ID', envText('APIHZ_MGC_ID'))),
    apihzKey: envText('APIHZ_KEY', envText('APIHZ_IMG_KEY', envText('APIHZ_MGC_KEY'))),
    // SEO：空字符串 = 使用内置默认文案；可在管理后台覆盖
    seoTitle: '',
    seoDescription: '',
    seoKeywords: '',
    seoSiteName: '',
    seoCanonicalUrl: envText('SITE_CANONICAL_URL'),
    seoBaiduVerification: '',
    seoOgImage: '',
    seoHeroHeadline: '',
    seoHeroSubline: '',
    seoAboutTitle: '',
    seoAboutText: '',
    // AI 模型服务（聊天室助手）
    aiApiKey: envText('AI_API_KEY'),
    aiApiBaseUrl: envText('AI_API_BASE_URL', envText('AI_API_URL', 'https://api.siliconflow.cn/v1')),
    aiApiProtocol: envText('AI_API_PROTOCOL', 'chat_completions'),
    aiEnabled: false,
    aiBotName: '小音',
    aiTextModel: envText('AI_TEXT_MODEL', 'Qwen/Qwen3-8B'),
    aiVisionModel: envText('AI_VISION_MODEL', 'Qwen/Qwen3.5-4B'),
    aiMaxRequestsPerMinute: envNumber('AI_MAX_RPM', 1000, 1, 10_000),
    aiMaxTokensPerMinute: envNumber('AI_MAX_TPM', 50_000, 1_000, 2_000_000),
  };
}

/** 用 CLIENT_ID_SECRET 派生 AES-256 密钥；未配置时密钥字段不落盘 */
function getSecretKey() {
  const secret = String(process.env.CLIENT_ID_SECRET || '').trim();
  if (!secret) return null;
  return createHash('sha256').update(`om-runtime-cfg:${secret}`).digest();
}

function encryptSecret(plain) {
  const text = String(plain || '');
  if (!text) return '';
  const key = getSecretKey();
  if (!key) return null; // 无法加密 → 调用方跳过落盘
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

function decryptSecret(raw) {
  const value = String(raw || '');
  if (!value) return '';
  if (!value.startsWith(ENC_PREFIX)) return value; // 兼容旧版明文
  const key = getSecretKey();
  if (!key) {
    console.warn('runtime-config: 无法解密密钥字段（缺少 CLIENT_ID_SECRET）');
    return '';
  }
  try {
    const parts = value.slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 3) return '';
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('runtime-config 密钥解密失败:', err?.message || err);
    return '';
  }
}

function decodePersisted(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = { ...raw };
  for (const field of SECRET_FIELDS) {
    if (typeof out[field] === 'string' && out[field]) {
      out[field] = decryptSecret(out[field]);
    }
  }
  if (typeof out.musicApis === 'string' && out.musicApis.startsWith(ENC_PREFIX)) {
    const decrypted = decryptSecret(out.musicApis);
    try {
      out.musicApis = JSON.parse(decrypted);
    } catch {
      console.error('runtime-config: 自定义音乐接口配置解密失败');
      out.musicApis = [];
    }
  }
  if (typeof out.aiModelPools === 'string' && out.aiModelPools.startsWith(ENC_PREFIX)) {
    try {
      out.aiModelPools = JSON.parse(decryptSecret(out.aiModelPools));
    } catch {
      out.aiModelPools = [];
    }
  }
  return out;
}

function encodeForDisk(config) {
  const out = { ...config };
  for (const field of SECRET_FIELDS) {
    const plain = String(out[field] || '');
    if (!plain) {
      out[field] = '';
      continue;
    }
    const encrypted = encryptSecret(plain);
    if (encrypted === null) {
      // 无 CLIENT_ID_SECRET：密钥不写入磁盘，仅保留环境变量 / 进程内存
      delete out[field];
    } else {
      out[field] = encrypted;
    }
  }
  if (Array.isArray(out.musicApis) && out.musicApis.length > 0) {
    const encrypted = encryptSecret(JSON.stringify(out.musicApis));
    if (encrypted === null) {
      console.warn('runtime-config: 缺少 CLIENT_ID_SECRET，自定义音乐接口配置将以明文保存');
    } else {
      // URL、参数、请求头和 Body 都可能含第三方密钥，整体加密避免遗漏。
      out.musicApis = encrypted;
    }
  }
  if (Array.isArray(out.aiModelPools) && out.aiModelPools.length > 0) {
    const encrypted = encryptSecret(JSON.stringify(out.aiModelPools));
    if (encrypted === null) {
      out.aiModelPools = out.aiModelPools.map(({ apiKey: _apiKey, ...pool }) => pool);
    } else {
      out.aiModelPools = encrypted;
    }
  }
  return out;
}

function readPersisted() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return decodePersisted(parsed);
  } catch (err) {
    console.error('runtime-config read error:', err?.message || err);
    return {};
  }
}

function getPersisted() {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    if (cached.mtimeMs !== 0) cached = { mtimeMs: 0, persisted: {} };
    return cached.persisted;
  }
  if (cached.mtimeMs !== mtimeMs) {
    cached = { mtimeMs, persisted: readPersisted() };
  }
  return cached.persisted;
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function normalizeQqGroupUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1000 || /[\r\n]/.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (url.hostname !== 'qq.com' && !url.hostname.endsWith('.qq.com')) return '';
    return url.href;
  } catch {
    return '';
  }
}

function normalize(config) {
  const roomEmptyTtlMs = Number(config.roomEmptyTtlMs);
  const roomRestartGraceMs = Number(config.roomRestartGraceMs);
  const roomCreateCooldownMs = Number(config.roomCreateCooldownMs);
  const roomCreateMaxOwned = Number(config.roomCreateMaxOwned);
  const roomCreateIpLooseCooldownMs = Number(config.roomCreateIpLooseCooldownMs);
  const favoriteShareTtlMs = normalizeFavoriteShareTtlMs(config.favoriteShareTtlMs);
  let musicApis = [];
  try {
    musicApis = normalizeMusicApis(config.musicApis);
  } catch {
    // 旧文件或手工编辑产生的非法配置不进入运行时；保存时会返回明确校验错误。
  }
  const aiModelPools = normalizeAiModelPools(config.aiModelPools);
  const musicSourcesEnabled = normalizeMusicSourcesEnabled(config.musicSourcesEnabled);
  return {
    roomEmptyTtlMs: Number.isFinite(roomEmptyTtlMs)
      ? Math.max(0, Math.min(Math.round(roomEmptyTtlMs), 24 * 60 * 60 * 1000))
      : 10 * 60 * 1000,
    roomRestartGraceMs: Number.isFinite(roomRestartGraceMs)
      ? Math.max(0, Math.min(Math.round(roomRestartGraceMs), 7 * 24 * 60 * 60 * 1000))
      : 0,
    roomCreateCooldownMs: Number.isFinite(roomCreateCooldownMs)
      ? Math.max(0, Math.min(Math.round(roomCreateCooldownMs), 24 * 60 * 60 * 1000))
      : 5 * 60 * 1000,
    roomCreateMaxOwned: Number.isFinite(roomCreateMaxOwned)
      ? Math.max(0, Math.min(Math.round(roomCreateMaxOwned), 50))
      : 2,
    roomCreateIpLooseCooldownMs: Number.isFinite(roomCreateIpLooseCooldownMs)
      ? Math.max(0, Math.min(Math.round(roomCreateIpLooseCooldownMs), 60 * 60 * 1000))
      : 60 * 1000,
    favoriteShareTtlMs,
    smtpHost: String(config.smtpHost || '').trim().replace(/[\r\n]/g, '').slice(0, 253),
    smtpPort: (() => {
      const port = Number(config.smtpPort);
      return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : 587;
    })(),
    smtpSecure: config.smtpSecure === true
      || config.smtpSecure === 1
      || String(config.smtpSecure || '').trim().toLowerCase() === 'true'
      || String(config.smtpSecure || '').trim() === '1',
    smtpUser: String(config.smtpUser || '').trim().replace(/[\r\n]/g, '').slice(0, 254),
    smtpPass: String(config.smtpPass || ''),
    smtpFrom: String(config.smtpFrom || '').trim().replace(/[\r\n]/g, '').slice(0, 320),
    linuxdoClientId: String(config.linuxdoClientId || '').trim(),
    linuxdoClientSecret: String(config.linuxdoClientSecret || '').trim(),
    linuxdoRedirectUri: String(config.linuxdoRedirectUri || '').trim(),
    linuxdoAuthorizeUrl: String(config.linuxdoAuthorizeUrl || '').trim(),
    linuxdoTokenUrl: String(config.linuxdoTokenUrl || '').trim(),
    linuxdoUserInfoUrl: String(config.linuxdoUserInfoUrl || '').trim(),
    linuxdoScope: String(config.linuxdoScope || 'user').trim() || 'user',
    githubClientId: String(config.githubClientId || '').trim(),
    githubClientSecret: String(config.githubClientSecret || '').trim(),
    githubRedirectUri: String(config.githubRedirectUri || '').trim(),
    githubScope: String(config.githubScope || 'read:user').trim() || 'read:user',
    roomCredentialEncryptionKey: String(config.roomCredentialEncryptionKey || '').trim(),
    svipQualityEnabled: (() => {
      const legacy = config.svipQualityEnabled === true
        || config.svipQualityEnabled === 1
        || String(config.svipQualityEnabled || '').trim().toLowerCase() === 'true'
        || String(config.svipQualityEnabled || '').trim() === '1';
      const value = config.svipQualityEnabled && typeof config.svipQualityEnabled === 'object'
        ? config.svipQualityEnabled
        : {};
      return {
        netease: value.netease === undefined ? legacy : Boolean(value.netease),
        tencent: value.tencent === undefined ? legacy : Boolean(value.tencent),
        kugou: value.kugou === undefined ? legacy : Boolean(value.kugou),
        qishui: value.qishui === undefined ? legacy : Boolean(value.qishui),
      };
    })(),
    sharedMembershipEnabled: config.sharedMembershipEnabled !== false
      && config.sharedMembershipEnabled !== 0
      && String(config.sharedMembershipEnabled || '').trim().toLowerCase() !== 'false'
      && String(config.sharedMembershipEnabled || '').trim() !== '0',
    qqGroupUrl: normalizeQqGroupUrl(config.qqGroupUrl),
    metingApiUrl: String(config.metingApiUrl || '').trim(),
    metingApiAuth: String(config.metingApiAuth || '').trim(),
    musicApis,
    musicSourcesEnabled,
    qiniuAccessKey: String(config.qiniuAccessKey || '').trim(),
    qiniuSecretKey: String(config.qiniuSecretKey || '').trim(),
    qiniuBucket: String(config.qiniuBucket || '').trim(),
    qiniuDomain: trimTrailingSlash(config.qiniuDomain),
    qiniuZone: QINIU_ZONES.has(String(config.qiniuZone || '').trim()) ? String(config.qiniuZone).trim() : 'z0',
    apihzBaseUrl: trimTrailingSlash(config.apihzBaseUrl) || 'https://cn.apihz.cn/api',
    apihzId: String(config.apihzId || '').trim(),
    apihzKey: String(config.apihzKey || '').trim(),
    seoTitle: String(config.seoTitle || '').trim().slice(0, 120),
    seoDescription: String(config.seoDescription || '').trim().slice(0, 300),
    seoKeywords: String(config.seoKeywords || '').trim().slice(0, 400),
    seoSiteName: String(config.seoSiteName || '').trim().slice(0, 80),
    seoCanonicalUrl: trimTrailingSlash(config.seoCanonicalUrl).slice(0, 200),
    seoBaiduVerification: String(config.seoBaiduVerification || '').trim().slice(0, 120),
    seoOgImage: String(config.seoOgImage || '').trim().slice(0, 500),
    seoHeroHeadline: String(config.seoHeroHeadline || '').trim().slice(0, 40),
    seoHeroSubline: String(config.seoHeroSubline || '').trim().slice(0, 80),
    seoAboutTitle: String(config.seoAboutTitle || '').trim().slice(0, 80),
    seoAboutText: String(config.seoAboutText || '').trim().slice(0, 800),
    aiApiKey: String(config.aiApiKey || '').trim(),
    aiApiBaseUrl: normalizeAiApiBaseUrl(config.aiApiBaseUrl || config.aiApiUrl),
    aiApiProtocol: normalizeAiApiProtocol(config.aiApiProtocol),
    aiEnabled: config.aiEnabled === true
      || config.aiEnabled === 1
      || String(config.aiEnabled || '').trim().toLowerCase() === 'true'
      || String(config.aiEnabled || '').trim() === '1',
    aiBotName: String(config.aiBotName || '小音').trim().slice(0, 20) || '小音',
    aiTextModel: normalizeAiModelField(config.aiTextModel || config.aiModel, 'Qwen/Qwen3-8B'),
    aiVisionModel: normalizeAiModelField(config.aiVisionModel, 'Qwen/Qwen3.5-4B'),
    aiMaxRequestsPerMinute: normalizeAiRateLimit(config.aiMaxRequestsPerMinute, 1000, 1, 10_000),
    aiMaxTokensPerMinute: normalizeAiRateLimit(config.aiMaxTokensPerMinute, 50_000, 1_000, 2_000_000),
    aiModelPools,
  };
}

function normalizeAiRateLimit(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.round(numeric), max));
}

function normalizeAiModelPools(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item, index) => {
    const type = item?.type === 'vision' ? 'vision' : 'text';
    return {
      id: String(item?.id || `pool-${index + 1}`).trim().slice(0, 80) || `pool-${index + 1}`,
      enabled: item?.enabled !== false,
      type,
      name: String(item?.name || '').trim().slice(0, 40),
      apiBaseUrl: normalizeAiApiBaseUrl(item?.apiBaseUrl || item?.apiUrl, ''),
      apiProtocol: normalizeAiApiProtocol(item?.apiProtocol),
      apiKey: String(item?.apiKey || '').trim(),
      // 模型池是用户显式添加的配置；空模型必须保留为空，不能悄悄写入默认模型。
      // 否则后台新增模型后尚未填写模型 ID 即保存，会被错误变成 Qwen/Qwen3-8B。
      model: normalizeAiModelField(item?.model, ''),
      ...(type === 'text' ? { enableThinking: item?.enableThinking === true } : {}),
      contextWindowTokens: normalizeAiRateLimit(item?.contextWindowTokens, 256 * 1024, 4 * 1024, 2048 * 1024),
      maxRequestsPerMinute: normalizeAiRateLimit(item?.maxRequestsPerMinute, 1000, 1, 10_000),
      maxTokensPerMinute: normalizeAiRateLimit(item?.maxTokensPerMinute, 50_000, 1_000, 2_000_000),
      priority: normalizeAiRateLimit(item?.priority, 100, 1, 1000),
    };
  });
}

function normalizeAiModelField(value, fallback) {
  const model = String(value || '').trim();
  if (!model) return fallback;
  if (model.length > 64) return fallback;
  if (!/^[A-Za-z0-9._+:\-/]+$/.test(model)) return fallback;
  return model;
}

function normalizeAiApiBaseUrl(value, fallback = 'https://api.siliconflow.cn/v1') {
  const url = String(value || '').trim();
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallback;
    const pathname = parsed.pathname.replace(/\/(?:chat\/completions|responses)\/?$/i, '').replace(/\/$/, '');
    parsed.pathname = pathname || '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function normalizeAiApiProtocol(value) {
  return String(value || '').trim().toLowerCase() === 'responses'
    ? 'responses'
    : 'chat_completions';
}

export function getRuntimeConfig() {
  const persisted = getPersisted();
  const env = envDefaults();
  const merged = { ...env, ...persisted };
  // 房间凭证主密钥一旦通过环境变量提供，始终以环境变量为准，
  // 便于从后台配置故障中恢复，且不会被旧的加密配置覆盖。
  if (env.roomCredentialEncryptionKey) {
    merged.roomCredentialEncryptionKey = env.roomCredentialEncryptionKey;
  }
  if (env.aiApiKey) {
    merged.aiApiKey = env.aiApiKey;
  }
  return normalize(merged);
}

function persistedSecretState(field) {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return 'missing';
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!Object.hasOwn(parsed, field) || !String(parsed[field] || '').trim()) return 'missing';
    return String(parsed[field]).startsWith(ENC_PREFIX) ? 'encrypted' : 'plain';
  } catch {
    return 'unreadable';
  }
}

export function ensureRoomCredentialEncryptionKey() {
  const config = getRuntimeConfig();
  if (config.roomCredentialEncryptionKey) return { created: false, config };
  const persistedState = persistedSecretState('roomCredentialEncryptionKey');
  if (persistedState === 'encrypted' || persistedState === 'unreadable') {
    return {
      created: false,
      error: '房间凭证密钥已存在但无法解密，请恢复原 CLIENT_ID_SECRET 后再启动，禁止自动生成新密钥',
      unavailable: true,
    };
  }
  const key = randomBytes(32).toString('base64');
  const result = setRuntimeConfig({ roomCredentialEncryptionKey: key });
  return result.success
    ? { created: true, config: getRuntimeConfig() }
    : { created: false, error: result.error };
}

/** 公开 SEO 视图：后台留空字段回退内置默认文案 */
export function getPublicSiteSeo() {
  return buildPublicSiteSeo(getRuntimeConfig());
}

/** Linux.do OAuth 是否已具备可用配置（客户端凭据 + 三个接口地址均已填写） */
export function isLinuxdoConfigured(config = getRuntimeConfig()) {
  return Boolean(
    config.linuxdoClientId
    && config.linuxdoClientSecret
    && config.linuxdoRedirectUri
    && config.linuxdoAuthorizeUrl
    && config.linuxdoTokenUrl
    && config.linuxdoUserInfoUrl,
  );
}

/** GitHub OAuth 是否已具备可用配置（只需要客户端凭据 + 回调地址，接口地址是固定的） */
export function isGithubConfigured(config = getRuntimeConfig()) {
  return Boolean(config.githubClientId && config.githubClientSecret && config.githubRedirectUri);
}

function validateHttpUrl(value, label, { allowEmpty = false, allowList = false, allowPrivate = false } = {}) {
  const values = allowList ? String(value || '').split(',') : [String(value || '')];
  for (let raw of values) {
    raw = raw.trim();
    if (!raw && allowEmpty) continue;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `${label}必须是 http/https 地址${allowList ? '，多个地址用英文逗号分隔' : ''}`;
      }
      // Meting 上游常部署在本机或局域网，配置校验允许内网；媒体代理 SSRF 另有拦截
      if (!allowPrivate && isBlockedMediaHostname(parsed.hostname)) {
        return `${label}不允许指向内网、本机或云元数据地址`;
      }
    } catch {
      return `${label}必须是 http/https 地址${allowList ? '，多个地址用英文逗号分隔' : ''}`;
    }
  }
  return '';
}

export function getRuntimeConfigForAdmin() {
  const config = getRuntimeConfig();
  const result = { ...config, configuredSecrets: {} };
  result.musicApis = config.musicApis.map((api) => ({
    ...api,
    headers: Object.keys(api.headers).length ? JSON.stringify(api.headers, null, 2) : '',
  }));
  const urls = String(config.metingApiUrl || '').split(',').map((value) => value.trim()).filter(Boolean);
  const auths = String(config.metingApiAuth || '').split(',').map((value) => value.trim());
  result.metingSources = urls.map((url, index) => {
    const auth = auths.length === 1 ? auths[0] : (auths[index] || '');
    return {
      url,
      type: 'meting',
      configuredAuth: Boolean(auth),
      auth: auth ? maskSecret(auth) : '',
    };
  });
  for (const field of SECRET_FIELDS) {
    result.configuredSecrets[field] = Boolean(config[field]);
    result[field] = config[field] ? maskSecret(config[field]) : '';
  }
  result.aiModelPools = config.aiModelPools.map(({ apiKey, ...pool }) => ({
    ...pool,
    apiKey: '',
    configuredApiKey: Boolean(apiKey),
  }));
  return result;
}

export function setRuntimeConfig(raw = {}) {
  if (Object.hasOwn(raw, 'qqGroupUrl') && String(raw.qqGroupUrl || '').trim() && !normalizeQqGroupUrl(raw.qqGroupUrl)) {
    return { success: false, error: 'QQ群链接必须是 qq.com 域名下的 HTTPS 地址（最多 1000 字符）' };
  }
  const current = getRuntimeConfig();
  const next = { ...current };
  const clearSecrets = new Set(Array.isArray(raw.clearSecrets) ? raw.clearSecrets : []);

  // 管理后台使用结构化源列表；磁盘和环境变量格式仍保持逗号分隔，兼容旧部署。
  if (Array.isArray(raw.metingSources)) {
    const oldUrls = String(current.metingApiUrl || '').split(',').map((value) => value.trim()).filter(Boolean);
    const oldAuths = String(current.metingApiAuth || '').split(',').map((value) => value.trim());
    const oldAuthByUrl = new Map(oldUrls.map((url, index) => {
      const auth = oldAuths.length === 1 ? oldAuths[0] : (oldAuths[index] || '');
      return [trimTrailingSlash(url), auth];
    }));
    const sources = raw.metingSources.slice(0, 20).map((source) => {
      const url = trimTrailingSlash(source?.url);
      const submittedAuth = typeof source?.auth === 'string' ? source.auth.trim() : '';
      const auth = source?.clearAuth ? '' : (submittedAuth || oldAuthByUrl.get(url) || '');
      return { url, type: 'meting', auth };
    }).filter((source) => source.url);
    next.metingApiUrl = sources.map((source) => source.url).join(',');
    next.metingApiAuth = sources.some((source) => source.auth)
      ? sources.map((source) => source.auth).join(',')
      : '';
  }

  if (Object.hasOwn(raw, 'musicApis')) {
    try {
      next.musicApis = normalizeMusicApis(raw.musicApis);
    } catch (err) {
      return { success: false, error: err?.message || 'musicApis 配置无效' };
    }
  }
  if (Array.isArray(raw.aiModelPools)) {
    const invalidIndex = raw.aiModelPools.findIndex((pool) => {
      const model = String(pool?.model || '').trim();
      return !model || /\s/.test(model) || model.length > 64 || !/^[A-Za-z0-9._+:\-/]+$/.test(model);
    });
    if (invalidIndex >= 0) {
      const model = String(raw.aiModelPools[invalidIndex]?.model || '').trim();
      return { success: false, error: model
        ? `第 ${invalidIndex + 1} 个 AI 模型的模型 ID 不支持空格或其它非法字符`
        : `第 ${invalidIndex + 1} 个 AI 模型的模型 ID 不能为空` };
    }
    const existingById = new Map(current.aiModelPools.map((pool) => [pool.id, pool]));
    next.aiModelPools = raw.aiModelPools.map((pool) => ({
      ...pool,
      apiKey: String(pool?.apiKey || '').trim() || existingById.get(String(pool?.id || ''))?.apiKey || '',
    }));
  }

  for (const field of Object.keys(current)) {
    // 管理后台提交结构化音源列表时，旧的扁平字段只是回显兼容值，
    // 不能覆盖上面刚由 metingSources 合并出的新列表。
    if (Array.isArray(raw.metingSources) && (field === 'metingApiUrl' || field === 'metingApiAuth')) {
      continue;
    }
    if (field === 'aiModelPools') continue;
    if (SECRET_FIELDS.has(field)) {
      if (clearSecrets.has(field)) next[field] = '';
      else if (typeof raw[field] === 'string' && raw[field].trim()) next[field] = raw[field].trim();
    } else if (Object.hasOwn(raw, field)) {
      // 结构化音源列表已写回 metingApiUrl；勿用前端草稿里残留的旧逗号串盖掉
      if (Array.isArray(raw.metingSources) && field === 'metingApiUrl') continue;
      next[field] = raw[field];
    }
  }

  const normalized = normalize(next);
  const urlChecks = [
    validateHttpUrl(normalized.metingApiUrl, 'Meting API 地址', {
      allowEmpty: true,
      allowList: true,
      allowPrivate: true,
    }),
    validateHttpUrl(normalized.qiniuDomain, '七牛云域名', { allowEmpty: true }),
    validateHttpUrl(normalized.apihzBaseUrl, '接口盒子地址'),
    validateHttpUrl(normalized.seoCanonicalUrl, 'SEO 规范域名', { allowEmpty: true }),
    validateHttpUrl(normalized.aiApiBaseUrl, 'AI Base URL', { allowPrivate: true }),
  ].filter(Boolean);
  if (urlChecks.length) return { success: false, error: urlChecks[0] };

  try {
    const forDisk = encodeForDisk(normalized);
    const tempPath = `${CONFIG_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(forDisk, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tempPath, CONFIG_PATH);
    } catch (err) {
      // Docker 单文件 bind mount 不能被 rename 覆盖，回退为原位写入。
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(err?.code) || !fs.existsSync(CONFIG_PATH)) throw err;
      fs.copyFileSync(tempPath, CONFIG_PATH);
      fs.unlinkSync(tempPath);
    }
    // 内存缓存保留明文，供运行时使用；磁盘为加密形态
    cached = { mtimeMs: fs.statSync(CONFIG_PATH).mtimeMs, persisted: normalized };
    return { success: true, config: getRuntimeConfigForAdmin() };
  } catch (err) {
    console.error('runtime-config write error:', err?.message || err);
    return { success: false, error: '运行配置保存失败' };
  }
}
