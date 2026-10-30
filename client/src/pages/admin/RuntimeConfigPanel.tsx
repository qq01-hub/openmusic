import { useEffect, useState, type ReactNode } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import AdminLoading from './AdminLoading';
import JsonPathTree from './JsonPathTree';
import SettingsSection from './SettingsSection';
import type {
  CustomMusicApi,
  CustomMusicApiStatus,
  AiModelPool,
  MusicApiOperation,
  MusicApiPlatform,
  RuntimeConfig,
} from './types';
import { adminFetch } from './utils';

type RuntimeTextField = Exclude<
  keyof RuntimeConfig,
  | 'roomEmptyTtlMs'
  | 'roomRestartGraceMs'
  | 'roomCreateCooldownMs'
  | 'roomCreateMaxOwned'
  | 'roomCreateIpLooseCooldownMs'
  | 'favoriteShareTtlMs'
  | 'smtpPort'
  | 'smtpSecure'
  | 'anonymousLoginEnabled'
  | 'apihzWechatEnabled'
  | 'apihzQqEnabled'
  | 'turnstileEnabled'
  | 'riskChallengeEnabled'
  | 'riskChallengeCooldownMinutes'
  | 'svipQualityEnabled'
  | 'sharedMembershipEnabled'
  | 'qqGroupUrl'
  | 'aiEnabled'
  | 'aiApiProtocol'
  | 'aiMaxRequestsPerMinute'
  | 'aiMaxTokensPerMinute'
  | 'aiModelPools'
  | 'configuredSecrets'
  | 'metingApiUrl'
  | 'metingApiAuth'
  | 'metingSources'
  | 'musicApis'
  | 'musicSourcesEnabled'
  | 'blockedArtistKeywords'
  | 'seoTitle'
  | 'seoDescription'
  | 'seoKeywords'
  | 'seoSiteName'
  | 'seoCanonicalUrl'
  | 'seoBaiduVerification'
  | 'seoOgImage'
  | 'seoHeroHeadline'
  | 'seoHeroSubline'
  | 'seoAboutTitle'
  | 'seoAboutText'
>;

interface RuntimeFieldDef {
  key: RuntimeTextField;
  label: string;
  placeholder?: string;
  secret?: boolean;
  tip?: string;
}

interface RuntimeFieldGroup {
  id: string;
  title: string;
  purpose: ReactNode;
  fields: RuntimeFieldDef[];
  includeQiniuZone?: boolean;
  includeSmtpOptions?: boolean;
  includeAiProtocol?: boolean;
  includeAiLimits?: boolean;
}

const RUNTIME_FIELD_GROUPS: RuntimeFieldGroup[] = [
  {
    id: 'turnstile', title: '人机校验 · Cloudflare Turnstile',
    purpose: <Space orientation="vertical"><span>保护邮箱发码、注册和登录，默认关闭，启用前先填写密钥和允许主机名，服务异常时拒绝本次受保护操作，不影响现有房间播放，也不解除账户限制</span><Space wrap><Typography.Link href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">申请 Site Key / Secret Key ↗</Typography.Link><Typography.Link href="https://developers.cloudflare.com/turnstile/get-started/" target="_blank" rel="noopener noreferrer">配置说明 ↗</Typography.Link><Typography.Link href="https://developers.cloudflare.com/turnstile/plans/" target="_blank" rel="noopener noreferrer">免费方案与限额 ↗</Typography.Link></Space></Space>,
    fields: [
      { key: 'turnstileSiteKey', label: 'Site Key', tip: '公开站点标识，Cloudflare 控制台选择 Managed 类型' },
      { key: 'turnstileSecretKey', label: 'Secret Key', secret: true, tip: '仅在服务端验证使用，加密保存，不回显' },
      { key: 'turnstileHostnames', label: '允许的精确主机名', placeholder: 'music.example.com,www.example.com', tip: '与 Cloudflare 控制台一致，以英文逗号分隔，不含 https://、端口或路径，最多 10 个' },
    ],
  },
  {
    id: 'smtp',
    title: '注册邮箱（SMTP）',
    purpose: '用于发送注册验证码。密码会加密保存且不会回显；端口 465 自动使用 TLS。',
    includeSmtpOptions: true,
    fields: [
      { key: 'smtpHost', label: 'SMTP 服务器', placeholder: 'smtp.example.com' },
      { key: 'smtpUser', label: '用户名', placeholder: 'your-mail@example.com' },
      { key: 'smtpPass', label: '密码或应用专用密码', secret: true },
      { key: 'smtpFrom', label: '发件人', placeholder: 'OpenMusic <your-mail@example.com>', tip: '留空时使用 SMTP 用户名' },
    ],
  },
  {
    id: 'linuxdo',
    title: 'Linux.do 登录',
    purpose: (
      <>
        申请：
        <Typography.Link href="https://connect.linux.do" target="_blank" rel="noreferrer">
          connect.linux.do
        </Typography.Link>
        ；填齐后启用，接口地址以官方为准
      </>
    ),
    fields: [
      { key: 'linuxdoClientId', label: 'Client ID' },
      { key: 'linuxdoClientSecret', label: 'Client Secret', secret: true },
      { key: 'linuxdoRedirectUri', label: '回调地址', placeholder: 'https://你的域名/api/auth/linuxdo/callback', tip: '须与 Linux.do 应用登记一致' },
      { key: 'linuxdoAuthorizeUrl', label: '授权接口地址' },
      { key: 'linuxdoTokenUrl', label: '令牌接口地址' },
      { key: 'linuxdoUserInfoUrl', label: '用户信息接口地址' },
      { key: 'linuxdoScope', label: 'Scope', placeholder: 'user' },
    ],
  },
  {
    id: 'github',
    title: 'GitHub 登录',
    purpose: (
      <>
        申请：
        <Typography.Link href="https://github.com/settings/developers" target="_blank" rel="noreferrer">
          github.com/settings/developers
        </Typography.Link>
        ；创建 OAuth App 后填入即可
      </>
    ),
    fields: [
      { key: 'githubClientId', label: 'Client ID' },
      { key: 'githubClientSecret', label: 'Client Secret', secret: true },
      { key: 'githubRedirectUri', label: '回调地址', placeholder: 'https://你的域名/api/auth/github/callback', tip: '须与 GitHub App 回调地址一致' },
      { key: 'githubScope', label: 'Scope', placeholder: 'read:user' },
    ],
  },
  {
    id: 'qiniu',
    title: '七牛云存储',
    purpose: '聊天发图；四项齐全才可用',
    includeQiniuZone: true,
    fields: [
      { key: 'qiniuAccessKey', label: 'Access Key', secret: true },
      { key: 'qiniuSecretKey', label: 'Secret Key', secret: true },
      { key: 'qiniuBucket', label: 'Bucket' },
      { key: 'qiniuDomain', label: 'CDN 域名', placeholder: 'https://cdn.example.com', tip: '需带 https://' },
    ],
  },
  {
    id: 'apihz',
    title: '接口盒子',
    purpose: '表情包搜索与微信、QQ 聚合扫码登录共用此处 ID 和密钥',
    fields: [
      { key: 'apihzBaseUrl', label: 'API 地址', placeholder: 'https://cn.apihz.cn/api' },
      { key: 'apihzId', label: '用户 ID', secret: true },
      { key: 'apihzKey', label: '密钥', secret: true },
    ],
  },
  {
    id: 'aiModel',
    title: 'AI 模型服务',
    purpose: (
      <>
        聊天室助手；兼容 OpenAI 风格的 Chat Completions 与 Responses API。文本模型负责对话和工具调用，视觉模型用于识图。
      </>
    ),
    fields: [
      { key: 'aiBotName', label: '助手昵称', placeholder: '小音' },
    ],
  },
  {
    id: 'roomCredential',
    title: '房间凭证安全存储',
    purpose: '用于加密 Redis 中的房间音乐登录凭证；首次部署会自动生成，配置后请勿重复更换',
    fields: [
      { key: 'roomCredentialEncryptionKey', label: '房间凭证加密密钥', secret: true, tip: '首次部署会自动生成；只有密钥丢失或确认轮换时才使用随机生成，修改后旧房间账号将无法解密。' },
    ],
  },
];

const MUSIC_API_PLATFORMS: { value: MusicApiPlatform; label: string }[] = [
  { value: 'netease', label: '网易云' },
  { value: 'tencent', label: 'QQ 音乐' },
  { value: 'kugou', label: '酷狗' },
  { value: 'qishui', label: '汽水' },
];

const MUSIC_API_OPERATIONS: { value: MusicApiOperation; label: string }[] = [
  { value: 'search', label: '歌曲搜索' },
  { value: 'song', label: '歌曲详情' },
  { value: 'url', label: '播放地址' },
  { value: 'lrc', label: '歌词' },
  { value: 'pic', label: '封面' },
  { value: 'playlist', label: '歌单详情' },
  { value: 'search_playlist', label: '歌单搜索' },
];

const SONG_MAPPING_FIELDS: { key: keyof CustomMusicApi['mapping']; label: string; placeholder: string }[] = [
  { key: 'id', label: '歌曲 ID', placeholder: 'id' },
  { key: 'name', label: '歌曲名', placeholder: 'name' },
  { key: 'artist', label: '歌手', placeholder: 'artist.name' },
  { key: 'album', label: '专辑', placeholder: 'album.name' },
  { key: 'pic', label: '封面 URL', placeholder: 'album.picUrl' },
  { key: 'duration', label: '时长', placeholder: 'duration' },
  { key: 'url', label: '播放 URL', placeholder: 'url' },
  { key: 'lrc', label: '歌词', placeholder: 'lyric' },
];

/** 解析形如 data.songs[0].url 的路径；与服务端 getJsonPath 语义一致 */
function getByPath(value: unknown, path: string): unknown {
  const trimmed = String(path || '').trim();
  if (!trimmed) return value;
  if (trimmed === '$') return value;
  const tokens: (string | number)[] = [];
  for (const match of trimmed.matchAll(/([A-Za-z_$][\w$]*)|\[(\d+)\]/g)) {
    tokens.push(match[1] ?? Number(match[2]));
  }
  let current: unknown = value;
  for (const token of tokens) {
    if (token === '$') continue;
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string | number, unknown>)[token];
  }
  return current;
}

function pickLabel(field: string, scalar: boolean): string {
  if (field === 'items') return '结果列表';
  const operation = MUSIC_API_OPERATIONS.find((item) => item.value === field);
  if (scalar && operation) return operation.label;
  const songField = SONG_MAPPING_FIELDS.find((item) => item.key === field);
  return songField?.label || field;
}

/** 结算点选树的根：标量功能与 items 用整个响应，歌曲字段用结果列表的第一条（点选得相对路径） */
function pickTreeValue(api: CustomMusicApi, field: string, scalar: boolean, response: unknown): unknown {
  if (scalar || field === 'items') return response;
  const base = api.mapping.items ? getByPath(response, api.mapping.items) : response;
  return Array.isArray(base) ? base[0] : base;
}

function createMusicApi(): CustomMusicApi {
  return {
    id: globalThis.crypto?.randomUUID?.() || `api-${Date.now()}`,
    name: '',
    remark: '',
    enabled: true,
    platforms: ['netease'],
    operations: ['search'],
    weight: 100,
    timeoutMs: 10_000,
    failureThreshold: 3,
    cooldownMs: 60_000,
    method: 'GET',
    url: '',
    params: '',
    headers: '',
    body: '',
    mapping: {
      items: 'data',
      id: 'id',
      name: 'name',
      artist: 'artist',
      album: 'album',
      pic: 'pic',
      duration: 'duration',
      url: 'url',
      lrc: 'lrc',
    },
  };
}

function createAiModelPool(): AiModelPool {
  return {
    id: globalThis.crypto?.randomUUID?.() || `ai-pool-${Date.now()}`,
    enabled: true,
    type: 'text',
    name: '',
    apiBaseUrl: '',
    apiProtocol: 'chat_completions',
    apiKey: '',
    configuredApiKey: false,
    model: '',
    enableThinking: false,
    contextWindowTokens: 256 * 1024,
    maxRequestsPerMinute: 1000,
    maxTokensPerMinute: 50_000,
    priority: 100,
  };
}

function formatJsonResponse(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export default function RuntimeConfigPanel({
  onError,
  securityTab,
  initialTab,
}: {
  onError: (message: string) => void;
  securityTab?: ReactNode;
  initialTab?: 'identity';
}) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<RuntimeConfig | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab || (securityTab ? 'security' : 'music'));
  const [dirtySecrets, setDirtySecrets] = useState<Set<string>>(new Set());
  const [dirtyMetingAuth, setDirtyMetingAuth] = useState<Set<number>>(new Set());
  const [baselineSecrets, setBaselineSecrets] = useState<Record<string, string>>({});
  const [baselineMetingAuth, setBaselineMetingAuth] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [parsingApiId, setParsingApiId] = useState('');
  const [apiPreviews, setApiPreviews] = useState<Record<string, { response: unknown; paths: string[] }>>({});
  const [musicApiStatus, setMusicApiStatus] = useState<CustomMusicApiStatus | null>(null);
  const [previewPlatforms, setPreviewPlatforms] = useState<Record<string, MusicApiPlatform>>({});
  const [picking, setPicking] = useState<{ apiId: string; field: string } | null>(null);
  const [aiTestLoading, setAiTestLoading] = useState(false);
  const [aiTestingPoolId, setAiTestingPoolId] = useState('');
  const [aiTestResult, setAiTestResult] = useState<{
    success?: boolean;
    reply?: string;
    model?: string;
    latencyMs?: number;
    error?: string;
    usage?: unknown;
    rawResponse?: string;
    curl?: string;
  } | null>(null);

  const applyLoadedConfig = (config: RuntimeConfig) => {
    setDraft({
      ...config,
      anonymousLoginEnabled: config.anonymousLoginEnabled === true,
      svipQualityEnabled: Object.assign({ netease: false, tencent: false, kugou: false, qishui: false }, typeof config.svipQualityEnabled === 'object' ? config.svipQualityEnabled : { netease: Boolean(config.svipQualityEnabled), tencent: Boolean(config.svipQualityEnabled), kugou: Boolean(config.svipQualityEnabled), qishui: Boolean(config.svipQualityEnabled) }),
      sharedMembershipEnabled: config.sharedMembershipEnabled !== false,
      favoriteShareTtlMs: Number(config.favoriteShareTtlMs) || 30 * 24 * 60 * 60 * 1000,
      musicSourcesEnabled: Object.assign({ netease: true, tencent: true, kugou: true, qishui: true }, config.musicSourcesEnabled || {}),
      blockedArtistKeywords: Array.isArray(config.blockedArtistKeywords) ? config.blockedArtistKeywords : [],
      aiEnabled: Boolean(config.aiEnabled),
      aiApiBaseUrl: config.aiApiBaseUrl || 'https://api.siliconflow.cn/v1',
      aiApiProtocol: config.aiApiProtocol || 'chat_completions',
      aiBotName: config.aiBotName || '小音',
      aiTextModel: config.aiTextModel || 'Qwen/Qwen3-8B',
      aiVisionModel: config.aiVisionModel || 'Qwen/Qwen3.5-4B',
      aiMaxRequestsPerMinute: Number(config.aiMaxRequestsPerMinute) || 1000,
      aiMaxTokensPerMinute: Number(config.aiMaxTokensPerMinute) || 50_000,
      aiModelPools: Array.isArray(config.aiModelPools)
        ? config.aiModelPools.map((pool) => ({
            ...pool,
            ...(pool.type === 'text' ? { enableThinking: pool.enableThinking === true } : {}),
            contextWindowTokens: Number(pool.contextWindowTokens) || 256 * 1024,
          }))
        : [],
      seoTitle: config.seoTitle || '',
      seoDescription: config.seoDescription || '',
      seoKeywords: config.seoKeywords || '',
      seoSiteName: config.seoSiteName || '',
      seoCanonicalUrl: config.seoCanonicalUrl || '',
      seoBaiduVerification: config.seoBaiduVerification || '',
      seoOgImage: config.seoOgImage || '',
      seoHeroHeadline: config.seoHeroHeadline || '',
      seoHeroSubline: config.seoHeroSubline || '',
      seoAboutTitle: config.seoAboutTitle || '',
      seoAboutText: config.seoAboutText || '',
      musicApis: Array.isArray(config.musicApis)
        ? config.musicApis.map((api) => ({
            ...api,
            platforms: Array.isArray(api.platforms) ? api.platforms : [],
            operations: Array.isArray(api.operations) ? api.operations : [],
            weight: Number(api.weight) || 100,
            timeoutMs: Number(api.timeoutMs) || 10_000,
            failureThreshold: Number(api.failureThreshold) || 3,
            cooldownMs: Number(api.cooldownMs) || 60_000,
            params: typeof api.params === 'string'
              ? api.params
              : JSON.stringify(api.params || {}, null, 2),
            headers: typeof api.headers === 'string'
              ? api.headers
              : JSON.stringify(api.headers || {}, null, 2),
          }))
        : [],
    });
    setDirtySecrets(new Set());
    setDirtyMetingAuth(new Set());
    const secrets: Record<string, string> = {};
    for (const group of RUNTIME_FIELD_GROUPS) {
      for (const field of group.fields) {
        if (field.secret) secrets[field.key] = config[field.key] || '';
      }
    }
    setBaselineSecrets(secrets);
    setBaselineMetingAuth(config.metingSources.map((source) => source.auth || ''));
  };

  const loadMusicApiStatus = async () => {
    try {
      setMusicApiStatus(await adminFetch<CustomMusicApiStatus>('/api/admin/runtime-config/music-api-status'));
    } catch {
      // 状态面板是辅助能力，不阻塞配置加载/保存。
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{ config: RuntimeConfig }>('/api/admin/runtime-config');
        if (!cancelled) {
          applyLoadedConfig(res.config);
          void loadMusicApiStatus();
        }
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : '加载运行配置失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const save = async () => {
    if (!draft || saving) return;
    const invalidModelIndex = draft.aiModelPools.findIndex((pool) => {
      const model = pool.model.trim();
      return !model || /\s/.test(model);
    });
    if (invalidModelIndex >= 0) {
      const model = draft.aiModelPools[invalidModelIndex].model;
      onError(model.trim()
        ? `第 ${invalidModelIndex + 1} 个模型的模型 ID 不支持空格`
        : `请填写第 ${invalidModelIndex + 1} 个模型的模型 ID 后再保存`);
      setActiveTab('ai');
      return;
    }
    setSaving(true);
    try {
      const clearSecrets: string[] = [];
      const { metingApiUrl: _ignoredUrl, metingApiAuth: _ignoredAuth, ...draftRest } = draft;
      const payload: Omit<RuntimeConfig, 'metingApiUrl' | 'metingApiAuth'> & {
        clearSecrets: string[];
        metingSources: RuntimeConfig['metingSources'];
      } = {
        ...draftRest,
        clearSecrets,
        metingSources: draft.metingSources.map((source, index) => {
          if (!dirtyMetingAuth.has(index)) {
            return { ...source, auth: '', clearAuth: false };
          }
          if (!String(source.auth || '').trim()) {
            return { ...source, auth: '', clearAuth: true };
          }
          return { ...source, clearAuth: false };
        }),
      };

      for (const group of RUNTIME_FIELD_GROUPS) {
        for (const field of group.fields) {
          if (!field.secret) continue;
          if (!dirtySecrets.has(field.key)) {
            payload[field.key] = '';
            continue;
          }
          if (!String(payload[field.key] || '').trim()) {
            clearSecrets.push(field.key);
            payload[field.key] = '';
          }
        }
      }

      const res = await adminFetch<{ config: RuntimeConfig }>('/api/admin/runtime-config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      applyLoadedConfig(res.config);
      void loadMusicApiStatus();
      message.success('已保存并立即生效');
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存运行配置失败');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <>
        {securityTab && (
          <Tabs
            activeKey="security"
            items={[{ key: 'security', label: '安全与账号', children: securityTab }]}
          />
        )}
        <AdminLoading tip="加载运行配置…" minHeight={200} />
      </>
    );
  }

  const markSecretDirty = (key: RuntimeTextField, nextValue: string) => {
    setDirtySecrets((prev) => {
      const next = new Set(prev);
      if (nextValue === (baselineSecrets[key] || '')) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderField = (field: RuntimeFieldDef) => {
    const configured = Boolean(draft.configuredSecrets[field.key]);
    const dirty = dirtySecrets.has(field.key);
    const FieldInput = field.secret ? Input.Password : Input;
    return (
      <Col xs={24} sm={12} key={field.key}>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {field.label}
          {field.secret && configured && !dirty && (
            <Tag color="success" style={{ marginLeft: 6 }}>已保存（已隐藏）</Tag>
          )}
          {field.secret && dirty && !String(draft[field.key] || '').trim() && (
            <Tag color="warning" style={{ marginLeft: 6 }}>保存后关闭</Tag>
          )}
        </Typography.Text>
        <Space.Compact style={{ width: '100%' }}>
        <FieldInput
          value={field.secret && configured && !dirty ? '' : draft[field.key]}
          onChange={(e) => {
            const nextValue = e.target.value;
            setDraft({ ...draft, [field.key]: nextValue });
            if (field.secret) markSecretDirty(field.key, nextValue);
          }}
          placeholder={field.secret
            ? (configured ? '已保存，输入新值可替换' : '填入后启用')
            : field.placeholder}
          autoComplete="off"
          spellCheck={false}
          style={{ fontFamily: 'monospace' }}
        />
        {field.key === 'turnstileSecretKey' && configured && <Button danger onClick={() => { setDraft({ ...draft, turnstileEnabled: false, riskChallengeEnabled: false, turnstileSecretKey: '' }); setDirtySecrets(previous => new Set([...previous, 'turnstileSecretKey'])); }}>清除并停用</Button>}
        {field.key === 'roomCredentialEncryptionKey' && (
          <Button
            onClick={() => {
              const bytes = new Uint8Array(32);
              crypto.getRandomValues(bytes);
              let binary = '';
              for (const byte of bytes) binary += String.fromCharCode(byte);
              const value = btoa(binary);
              setDraft({ ...draft, [field.key]: value });
              markSecretDirty(field.key, value);
            }}
          >
            随机生成
          </Button>
        )}
        </Space.Compact>
        {field.secret && configured && !dirty && (
          <Typography.Text type="success" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            {field.key === 'roomCredentialEncryptionKey'
              ? '当前密钥已保存并正在使用，出于安全原因不会回显完整内容。'
              : '当前敏感配置已保存，出于安全原因不会回显完整内容。'}
          </Typography.Text>
        )}
        {field.tip && (
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            {field.tip}
          </Typography.Text>
        )}
      </Col>
    );
  };

  const updateMetingSource = (
    index: number,
    patch: Partial<RuntimeConfig['metingSources'][number]>,
  ) => {
    const metingSources = draft.metingSources.map((source, sourceIndex) => (
      sourceIndex === index ? { ...source, ...patch } : source
    ));
    setDraft({ ...draft, metingSources });
  };

  const updateMusicApi = (index: number, patch: Partial<CustomMusicApi>) => {
    setDraft({
      ...draft,
      musicApis: draft.musicApis.map((api, apiIndex) => (
        apiIndex === index ? { ...api, ...patch } : api
      )),
    });
  };

  const previewMusicApi = async (api: CustomMusicApi) => {
    if (parsingApiId) return;
    setParsingApiId(api.id);
    try {
      const result = await adminFetch<{ response: unknown; paths: string[] }>('/api/admin/runtime-config/music-api-preview', {
        method: 'POST',
        body: JSON.stringify({
          api,
          variables: {
            id: '123456',
            keyword: '周杰伦',
            quality: '320',
            limit: '10',
            server: previewPlatforms[api.id] || api.platforms[0],
          },
        }),
      });
      setApiPreviews((prev) => ({ ...prev, [api.id]: result }));
      message.success('响应解析成功，请选择字段路径');
    } catch (err) {
      onError(err instanceof Error ? err.message : '接口解析失败');
    } finally {
      setParsingApiId('');
    }
  };

  const resetMusicApiCircuit = async (id: string) => {
    try {
      const status = await adminFetch<CustomMusicApiStatus>('/api/admin/runtime-config/music-api-circuit/reset', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      setMusicApiStatus(status);
      message.success('熔断状态已重置');
    } catch (err) {
      onError(err instanceof Error ? err.message : '重置熔断状态失败');
    }
  };

  const roomSection = (
      <SettingsSection
        title="房间"
        description="0 表示关闭对应限制"
      >
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <InputNumber
              min={0}
              max={1440}
              step={1}
              value={Math.round(draft.roomEmptyTtlMs / 60000)}
              onChange={(val) => setDraft({ ...draft, roomEmptyTtlMs: Math.max(0, Number(val) || 0) * 60000 })}
              aria-label="空房销毁时间（分钟）"
              style={{ width: 100 }}
            />
            <Typography.Text type="secondary">分钟后销毁空房</Typography.Text>
          </Space>

          <Space wrap>
            <InputNumber
              min={0}
              max={1440}
              step={1}
              value={Math.round((draft.roomCreateCooldownMs ?? 300000) / 60000)}
              onChange={(val) => setDraft({
                ...draft,
                roomCreateCooldownMs: Math.max(0, Number(val) || 0) * 60000,
              })}
              aria-label="建房冷却（分钟）"
              style={{ width: 100 }}
            />
            <Typography.Text type="secondary">分钟建房冷却（按用户/设备）</Typography.Text>
          </Space>

          <Space wrap>
            <InputNumber
              min={0}
              max={50}
              step={1}
              value={draft.roomCreateMaxOwned ?? 2}
              onChange={(val) => setDraft({
                ...draft,
                roomCreateMaxOwned: Math.max(0, Math.min(50, Number(val) || 0)),
              })}
              aria-label="最多自建房间数"
              style={{ width: 100 }}
            />
            <Typography.Text type="secondary">每人最多同时保留自建房数</Typography.Text>
          </Space>

          <Space wrap>
            <InputNumber
              min={0}
              max={3600}
              step={10}
              value={Math.round((draft.roomCreateIpLooseCooldownMs ?? 60000) / 1000)}
              onChange={(val) => setDraft({
                ...draft,
                roomCreateIpLooseCooldownMs: Math.max(0, Number(val) || 0) * 1000,
              })}
              aria-label="无身份 IP 冷却（秒）"
              style={{ width: 100 }}
            />
            <Typography.Text type="secondary">秒无身份时按 IP 冷却</Typography.Text>
          </Space>

          <Space wrap>
            <InputNumber
              min={1}
              max={90}
              step={1}
              value={Math.round((draft.favoriteShareTtlMs ?? 30 * 24 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000))}
              onChange={(val) => setDraft({
                ...draft,
                favoriteShareTtlMs: Math.max(1, Math.min(90, Number(val) || 1)) * 24 * 60 * 60 * 1000,
              })}
              aria-label="收藏分享有效期（天）"
              style={{ width: 100 }}
            />
            <Typography.Text type="secondary">天收藏分享有效期（创建时固定，1 至 90 天）</Typography.Text>
          </Space>
        </Space>
      </SettingsSection>
  );

  const qualitySection = (
    <SettingsSection
      title="SVIP 音质能力"
      description="需 Meting Cookie 有对应会员"
    >
      <Space wrap>
        {([
          ['netease', '网易'],
          ['tencent', 'QQ'],
          ['kugou', '酷狗'],
          ['qishui', '汽水'],
        ] as const).map(([platform, label]) => (
          <Space key={platform} align="center">
            <Switch
              checked={Boolean(draft.svipQualityEnabled?.[platform])}
              onChange={(checked) => setDraft({
                ...draft,
                svipQualityEnabled: { ...draft.svipQualityEnabled, [platform]: checked },
              })}
              aria-label={`切换${label}平台 SVIP 音质能力`}
            />
            <Typography.Text>{label}</Typography.Text>
          </Space>
        ))}
      </Space>
    </SettingsSection>
  );

  const sharedMembershipSection = (
    <SettingsSection
      title="会员共享"
      description="关闭后隐藏首页共享入口和房间共享开关"
    >
      <Space align="center">
        <Switch
          checked={Boolean(draft.sharedMembershipEnabled)}
          onChange={(checked) => setDraft({ ...draft, sharedMembershipEnabled: checked })}
          aria-label="开放共享会员"
        />
        <Typography.Text>开放共享会员</Typography.Text>
      </Space>
    </SettingsSection>
  );

  const musicSourcesSection = (
    <SettingsSection
      title="平台音源开关"
      description="关闭后，前台会隐藏该平台入口，服务端也会拒绝对应音源请求。"
    >
      <Row gutter={[12, 12]}>
        {MUSIC_API_PLATFORMS.map((platform) => (
          <Col xs={24} sm={12} key={platform.value}>
            <Space align="start">
              <Switch
                checked={draft.musicSourcesEnabled[platform.value] !== false}
                checkedChildren="启用"
                unCheckedChildren="关闭"
                onChange={(checked) => setDraft({
                  ...draft,
                  musicSourcesEnabled: { ...draft.musicSourcesEnabled, [platform.value]: checked },
                })}
                aria-label={`启用${platform.label}音源`}
              />
              <div>
                <Typography.Text>{platform.label}</Typography.Text>
                {platform.value === 'netease' && (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                    网易被热歌榜、电台等功能使用，不建议关闭。
                  </Typography.Text>
                )}
              </div>
            </Space>
          </Col>
        ))}
      </Row>
    </SettingsSection>
  );

  const artistFilterSection = (
    <SettingsSection
      title="歌手过滤"
      description="歌手字段包含任一关键词时过滤该歌曲，不区分大小写，适用于所有平台的搜索、歌单、电台和点歌"
    >
      <Space orientation="vertical" style={{ width: '100%' }} size={8}>
        <label htmlFor="blocked-artist-keywords">歌手关键词，每行一个</label>
        <Input.TextArea
          id="blocked-artist-keywords"
          value={draft.blockedArtistKeywords.join('\n')}
          onChange={(event) => setDraft({ ...draft, blockedArtistKeywords: event.target.value.split(/\r?\n/) })}
          autoSize={{ minRows: 4, maxRows: 10 }}
          maxLength={8099}
          placeholder={'例如：\n歌手甲\n歌手乙'}
          aria-describedby="blocked-artist-keywords-help"
        />
        <Typography.Text id="blocked-artist-keywords-help" type="secondary" style={{ fontSize: 12 }}>
          最多 100 个关键词，每个最多 80 个字符，合唱中包含匹配歌手也会过滤
          <br />
          点击下方保存后生效，留空并保存可取消过滤，不会中断正在播放的歌曲
        </Typography.Text>
      </Space>
    </SettingsSection>
  );

  const metingSection = (
      <SettingsSection
        title="Meting 音源"
        description="多源轮询，故障自动切换；API Token 与 Meting 后台「API Token 管理」中创建的令牌一致"
      >
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          {draft.metingSources.length === 0 && (
            <Empty description="暂无音源，点击下方按钮添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
          {draft.metingSources.map((source, index) => (
            <Card key={`${index}-${source.type}`} size="small" style={{ background: '#fafafa' }}>
              <Row gutter={[8, 8]} align="middle">
                <Col xs={24} sm={6}>
                  <Select
                    value={source.type}
                    aria-label={`音源 ${index + 1} 类型`}
                    style={{ width: '100%' }}
                    options={[
                      { value: 'meting', label: 'Meting' },
                    ]}
                    onChange={(type) => updateMetingSource(index, { type })}
                  />
                </Col>
                <Col xs={24} sm={16}>
                  <Input
                    value={source.url}
                    onChange={(e) => updateMetingSource(index, { url: e.target.value })}
                    placeholder="API 地址，如 https://music-api.example.com"
                    aria-label={`音源 ${index + 1} 地址`}
                    spellCheck={false}
                    style={{ fontFamily: 'monospace' }}
                  />
                </Col>
                <Col xs={24} sm={2} style={{ textAlign: 'right' }}>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`删除音源 ${index + 1}`}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        metingSources: draft.metingSources.filter((_, sourceIndex) => sourceIndex !== index),
                      });
                      setDirtyMetingAuth((prev) => {
                        const next = new Set<number>();
                        for (const dirtyIndex of prev) {
                          if (dirtyIndex < index) next.add(dirtyIndex);
                          else if (dirtyIndex > index) next.add(dirtyIndex - 1);
                        }
                        return next;
                      });
                      setBaselineMetingAuth((prev) => prev.filter((_, sourceIndex) => sourceIndex !== index));
                    }}
                  />
                </Col>
              </Row>
              <Space wrap style={{ marginTop: 8, width: '100%' }}>
                <Input
                  value={source.auth || ''}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    updateMetingSource(index, { auth: nextValue, clearAuth: false });
                    setDirtyMetingAuth((prev) => {
                      const next = new Set(prev);
                      if (nextValue === (baselineMetingAuth[index] || '')) next.delete(index);
                      else next.add(index);
                      return next;
                    });
                  }}
                  placeholder={source.configuredAuth
                    ? '留空并保存可清除 Token'
                    : 'API Token（Authorization: Bearer）'}
                  aria-label={`音源 ${index + 1} API Token`}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ fontFamily: 'monospace', flex: 1, minWidth: 200 }}
                />
                {source.configuredAuth && !dirtyMetingAuth.has(index) && (
                  <Tag color="success">已配置</Tag>
                )}
                {dirtyMetingAuth.has(index) && !String(source.auth || '').trim() && (
                  <Tag color="warning">保存后关闭</Tag>
                )}
              </Space>
            </Card>
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              if (draft.metingSources.length >= 20) return;
              setDraft({
                ...draft,
                metingSources: [
                  ...draft.metingSources,
                  { type: 'meting', url: '', auth: '', configuredAuth: false },
                ],
              });
            }}
            disabled={draft.metingSources.length >= 20}
          >
            添加音源
          </Button>
        </Space>
      </SettingsSection>
  );

  const customApiSection = (
      <SettingsSection
        title="自定义音乐接口"
        description="留空则网易/QQ 走上方 Meting；多接口自动轮询切换"
      >
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            先「解析响应」，再点字段旁「选择」映射；URL/参数支持 {'{id}'} {'{keyword}'} {'{quality}'} 等变量
          </Typography.Text>
          {draft.musicApis.length === 0 && (
            <Empty description="暂无自定义接口" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
          {draft.musicApis.map((api, index) => {
            const scalarOperation = api.operations.length > 0
              && api.operations.every((operation) => operation === 'url' || operation === 'lrc' || operation === 'pic');
            const preview = apiPreviews[api.id];
            const routeStatuses = musicApiStatus?.routes.filter((route) => route.id === api.id) || [];
            const openRouteCount = routeStatuses.filter((route) => route.circuitState === 'open').length;
            const halfOpenRouteCount = routeStatuses.filter((route) => route.circuitState === 'half-open').length;
            const activePick = picking && picking.apiId === api.id ? picking.field : null;
            const mapping = api.mapping as Record<string, string | undefined>;
            const clearMapping = (field: string) => {
              const next = { ...mapping };
              delete next[field];
              updateMusicApi(index, { mapping: next as CustomMusicApi['mapping'] });
            };
            const renderPickerRow = (field: string, current: string | undefined, emptyHint = '未选择') => (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {current
                  ? <Tag color="blue" style={{ fontFamily: 'monospace', margin: 0 }}>{current}</Tag>
                  : <Typography.Text type="secondary" style={{ fontSize: 12 }}>{emptyHint}</Typography.Text>}
                <Tooltip title={preview ? '' : '请先点「解析响应」'}>
                  <Button
                    size="small"
                    type={activePick === field ? 'primary' : 'default'}
                    disabled={!preview}
                    onClick={() => setPicking(activePick === field ? null : { apiId: api.id, field })}
                  >
                    选择
                  </Button>
                </Tooltip>
                {current && (
                  <Button size="small" type="link" style={{ padding: 0 }} onClick={() => clearMapping(field)}>
                    清除
                  </Button>
                )}
              </div>
            );
            return (
              <Card
                key={api.id || index}
                size="small"
                title={api.name.trim() || `自定义接口 ${index + 1}`}
                extra={(
                  <Space wrap>
                    {openRouteCount > 0 ? (
                      <Tag color="error">熔断 {openRouteCount}</Tag>
                    ) : halfOpenRouteCount > 0 ? (
                      <Tag color="warning">半开探测</Tag>
                    ) : routeStatuses.length > 0 ? (
                      <Tag color="success">运行正常</Tag>
                    ) : null}
                    {(openRouteCount > 0 || halfOpenRouteCount > 0) && (
                      <Button size="small" onClick={() => void resetMusicApiCircuit(api.id)}>重置熔断</Button>
                    )}
                    <Switch
                      size="small"
                      checked={api.enabled}
                      onChange={(enabled) => updateMusicApi(index, { enabled })}
                    />
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`删除自定义接口 ${index + 1}`}
                      onClick={() => setDraft({
                        ...draft,
                        musicApis: draft.musicApis.filter((_, apiIndex) => apiIndex !== index),
                      })}
                    />
                  </Space>
                )}
                style={{ background: '#fafafa' }}
              >
                <Row gutter={[8, 8]}>
                  <Col xs={24} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>名称</Typography.Text>
                    <Input
                      value={api.name}
                      placeholder="例如：网易播放解析 1"
                      onChange={(e) => updateMusicApi(index, { name: e.target.value })}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>支持平台（可多选）</Typography.Text>
                    <Select
                      mode="multiple"
                      value={api.platforms}
                      options={MUSIC_API_PLATFORMS}
                      style={{ width: '100%' }}
                      onChange={(platforms) => updateMusicApi(index, { platforms })}
                    />
                  </Col>
                  <Col xs={24} sm={7}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>功能（可多选）</Typography.Text>
                    <Select
                      mode="multiple"
                      value={api.operations}
                      options={MUSIC_API_OPERATIONS}
                      style={{ width: '100%' }}
                      onChange={(operations) => updateMusicApi(index, { operations })}
                    />
                  </Col>
                  <Col xs={24} sm={3}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求方法</Typography.Text>
                    <Select
                      value={api.method}
                      options={[
                        { value: 'GET', label: 'GET' },
                        { value: 'POST', label: 'POST' },
                      ]}
                      style={{ width: '100%' }}
                      onChange={(method) => updateMusicApi(index, { method })}
                    />
                  </Col>
                  <Col span={24}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>备注（可选）</Typography.Text>
                    <Input.TextArea
                      value={api.remark || ''}
                      rows={2}
                      maxLength={1000}
                      showCount
                      placeholder="例如：供应商、套餐限制、联系人、用途或维护说明"
                      onChange={(e) => updateMusicApi(index, { remark: e.target.value })}
                    />
                  </Col>
                  <Col span={24}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>接口 URL 模板</Typography.Text>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        value={api.url}
                        placeholder="https://api.example.com/song"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace' }}
                        onChange={(e) => updateMusicApi(index, { url: e.target.value })}
                      />
                      {api.platforms.length > 1 && (
                        <Select
                          value={previewPlatforms[api.id] || api.platforms[0]}
                          options={MUSIC_API_PLATFORMS.filter((option) => api.platforms.includes(option.value))}
                          style={{ width: 120 }}
                          aria-label="解析测试平台"
                          onChange={(platform) => setPreviewPlatforms((prev) => ({ ...prev, [api.id]: platform }))}
                        />
                      )}
                      <Button
                        loading={parsingApiId === api.id}
                        disabled={!api.url.trim() || api.platforms.length === 0 || api.operations.length === 0 || Boolean(parsingApiId)}
                        onClick={() => void previewMusicApi(api)}
                      >
                        解析响应
                      </Button>
                    </Space.Compact>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>流量权重</Typography.Text>
                    <InputNumber
                      min={1}
                      max={1000}
                      value={api.weight}
                      style={{ width: '100%' }}
                      onChange={(value) => updateMusicApi(index, { weight: Number(value) || 1 })}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求超时</Typography.Text>
                    <InputNumber
                      min={1}
                      max={60}
                      value={Math.round(api.timeoutMs / 1000)}
                      addonAfter="秒"
                      style={{ width: '100%' }}
                      onChange={(value) => updateMusicApi(index, { timeoutMs: Math.max(1, Number(value) || 10) * 1000 })}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>连续失败熔断</Typography.Text>
                    <InputNumber
                      min={1}
                      max={20}
                      value={api.failureThreshold}
                      addonAfter="次"
                      style={{ width: '100%' }}
                      onChange={(value) => updateMusicApi(index, { failureThreshold: Number(value) || 1 })}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>熔断恢复等待</Typography.Text>
                    <InputNumber
                      min={5}
                      max={600}
                      value={Math.round(api.cooldownMs / 1000)}
                      addonAfter="秒"
                      style={{ width: '100%' }}
                      onChange={(value) => updateMusicApi(index, { cooldownMs: Math.max(5, Number(value) || 60) * 1000 })}
                    />
                  </Col>
                  <Col span={24}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      同一平台和功能下按权重分流（例如 100:50 约为 2:1）；达到失败阈值后仅熔断该接口的对应平台/功能，等待后自动半开探测。
                    </Typography.Text>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求参数 JSON（可选）</Typography.Text>
                    <Input.TextArea
                      value={api.params}
                      rows={3}
                      placeholder={'{"id":"{id}","limit":"{limit}"}'}
                      spellCheck={false}
                      style={{ fontFamily: 'monospace' }}
                      onChange={(e) => updateMusicApi(index, { params: e.target.value })}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求头 JSON（可选）</Typography.Text>
                    <Input.TextArea
                      value={api.headers}
                      rows={3}
                      placeholder={'{"Authorization":"Bearer token"}'}
                      spellCheck={false}
                      style={{ fontFamily: 'monospace' }}
                      onChange={(e) => updateMusicApi(index, { headers: e.target.value })}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>请求 Body JSON（POST 可选）</Typography.Text>
                    <Input.TextArea
                      value={api.body}
                      rows={3}
                      placeholder={'{"id":"{id}","keyword":"{keyword}"}'}
                      spellCheck={false}
                      style={{ fontFamily: 'monospace' }}
                      onChange={(e) => updateMusicApi(index, { body: e.target.value })}
                    />
                  </Col>
                  {scalarOperation ? api.operations.map((operation) => (
                    <Col xs={24} sm={8} key={operation}>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {MUSIC_API_OPERATIONS.find((item) => item.value === operation)?.label || operation}响应路径
                      </Typography.Text>
                      {renderPickerRow(operation, mapping[operation])}
                    </Col>
                  )) : (
                    <>
                      <Col span={24}>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>结果列表所在路径（数组或对象）</Typography.Text>
                        {renderPickerRow('items', api.mapping.items, '未选择（默认整个响应）')}
                      </Col>
                      {SONG_MAPPING_FIELDS.map((field) => (
                        <Col xs={12} sm={6} key={field.key}>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{field.label}</Typography.Text>
                          {renderPickerRow(field.key, mapping[field.key])}
                        </Col>
                      ))}
                    </>
                  )}
                  {preview && (
                    <Col span={24}>
                      {activePick ? (
                        <>
                          <Typography.Text style={{ fontSize: 12 }}>
                            正在为「{pickLabel(activePick, scalarOperation)}」选择字段：在下方点「选这个」
                            {activePick !== 'items' && !scalarOperation && (
                              <Typography.Text type="secondary" style={{ fontSize: 11 }}>（已展开结果列表中的第一条）</Typography.Text>
                            )}
                          </Typography.Text>
                          <div style={{ marginTop: 6 }}>
                            <JsonPathTree
                              value={pickTreeValue(api, activePick, scalarOperation, preview.response)}
                              containerOnly={activePick === 'items'}
                              activePath={mapping[activePick]}
                              onPick={(path) => {
                                if (!path) return;
                                const next = { ...mapping };
                                next[activePick] = path;
                                updateMusicApi(index, { mapping: next as CustomMusicApi['mapping'] });
                                setPicking(null);
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            格式化响应预览（点上方字段的「选择」后，可在此直接点选）
                          </Typography.Text>
                          <pre style={{
                            maxHeight: 280,
                            overflow: 'auto',
                            margin: '4px 0 0',
                            padding: 12,
                            borderRadius: 6,
                            background: '#111827',
                            color: '#e5e7eb',
                            fontSize: 11,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                          }}>
                            {JSON.stringify(preview.response, null, 2)}
                          </pre>
                        </>
                      )}
                    </Col>
                  )}
                </Row>
              </Card>
            );
          })}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            disabled={draft.musicApis.length >= 100}
            onClick={() => setDraft({
              ...draft,
              musicApis: [...draft.musicApis, createMusicApi()],
            })}
          >
            添加自定义接口
          </Button>
        </Space>
      </SettingsSection>
  );

  const renderFieldGroup = (group: RuntimeFieldGroup) => (
    <SettingsSection key={group.id} title={group.title} description={group.purpose}>
      <Row gutter={[16, 16]}>
        {group.fields.map(renderField)}
        {group.includeSmtpOptions && (
          <>
            <Col xs={24} sm={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                SMTP 端口
              </Typography.Text>
              <InputNumber
                value={draft.smtpPort}
                min={1}
                max={65_535}
                precision={0}
                aria-label="SMTP 端口"
                style={{ width: '100%' }}
                onChange={(smtpPort) => setDraft({ ...draft, smtpPort: Number(smtpPort) || 587 })}
              />
            </Col>
            <Col xs={24} sm={12}>
              <Space size="small" style={{ marginTop: 24 }}>
                <Switch
                  checked={Boolean(draft.smtpSecure)}
                  checkedChildren="TLS"
                  unCheckedChildren="普通连接"
                  aria-label="SMTP TLS"
                  onChange={(smtpSecure) => setDraft({ ...draft, smtpSecure })}
                />
                <Typography.Text>使用 TLS（465 端口会自动启用）</Typography.Text>
              </Space>
            </Col>
          </>
        )}
        {group.includeQiniuZone && (
          <Col xs={24} sm={12}>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              存储区域
            </Typography.Text>
            <Select
              value={draft.qiniuZone}
              aria-label="七牛存储区域"
              style={{ width: '100%' }}
              options={[
                { value: 'z0', label: '华东 z0' },
                { value: 'z1', label: '华北 z1' },
                { value: 'z2', label: '华南 z2' },
                { value: 'na0', label: '北美 na0' },
                { value: 'as0', label: '东南亚 as0' },
              ]}
              onChange={(zone) => setDraft({ ...draft, qiniuZone: zone })}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              与 Bucket 区域一致
            </Typography.Text>
          </Col>
        )}
        {group.includeAiProtocol && (
          <Col xs={24} sm={12}>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              上游协议
            </Typography.Text>
            <Select
              value={draft.aiApiProtocol}
              aria-label="AI 上游协议"
              style={{ width: '100%' }}
              options={[
                { value: 'chat_completions', label: 'Chat Completions' },
                { value: 'responses', label: 'Responses API' },
              ]}
              onChange={(aiApiProtocol) => setDraft({ ...draft, aiApiProtocol })}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              系统会自动拼接对应的接口路径
            </Typography.Text>
          </Col>
        )}
        {group.includeAiLimits && (
          <>
            <Col xs={24} sm={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                最高 RPM
              </Typography.Text>
              <InputNumber
                value={draft.aiMaxRequestsPerMinute}
                min={1}
                max={10_000}
                precision={0}
                aria-label="AI 最高 RPM"
                style={{ width: '100%' }}
                onChange={(value) => setDraft({ ...draft, aiMaxRequestsPerMinute: Number(value) || 1 })}
              />
            </Col>
            <Col xs={24} sm={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                最高 TPM
              </Typography.Text>
              <InputNumber
                value={draft.aiMaxTokensPerMinute}
                min={1_000}
                max={2_000_000}
                precision={0}
                step={1_000}
                aria-label="AI 最高 TPM"
                style={{ width: '100%' }}
                onChange={(value) => setDraft({ ...draft, aiMaxTokensPerMinute: Number(value) || 1_000 })}
              />
              <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                全站共享额度；请求队列会按同时活跃的房间数动态分配并发。
              </Typography.Text>
            </Col>
          </>
        )}
      </Row>
    </SettingsSection>
  );

  const fieldGroup = (id: string) => {
    const group = RUNTIME_FIELD_GROUPS.find((item) => item.id === id);
    return group ? renderFieldGroup(group) : null;
  };

  const runAiTest = async (pool: AiModelPool) => {
    if (aiTestLoading) return;
    const model = pool.model.trim();
    if (!model) {
      onError('请先填写模型 ID，再进行测试');
      return;
    }
    if (/\s/.test(model)) {
      onError('模型 ID 不支持空格，请删除空格后再测试');
      return;
    }
    setAiTestLoading(true);
    setAiTestingPoolId(pool.id);
    setAiTestResult(null);
    try {
      const payload: {
        message: string;
        poolId: string;
        type: 'text' | 'vision';
        apiKey?: string;
        model?: string;
        apiBaseUrl?: string;
        apiProtocol?: 'chat_completions' | 'responses';
        maxRequestsPerMinute?: number;
        maxTokensPerMinute?: number;
        enableThinking?: boolean;
        contextWindowTokens?: number;
      } = {
        message: '你好',
        poolId: pool.id,
        type: pool.type,
        model,
        apiBaseUrl: pool.apiBaseUrl,
        apiProtocol: pool.apiProtocol,
        maxRequestsPerMinute: pool.maxRequestsPerMinute,
        maxTokensPerMinute: pool.maxTokensPerMinute,
        ...(pool.type === 'text' ? { enableThinking: pool.enableThinking === true } : {}),
        contextWindowTokens: pool.contextWindowTokens,
      };
      // 仅当用户正在编辑密钥时，把草稿 Key 带给测试接口（不落盘）
      if (String(pool.apiKey || '').trim()) {
        payload.apiKey = pool.apiKey.trim();
      }
      setAiTestResult({
        success: undefined,
        rawResponse: '',
      });
      const response = await fetch('/api/admin/ai/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const res = await response.json().catch(() => ({
        success: false,
        error: `请求失败（${response.status}）`,
      })) as {
        success: boolean;
        reply?: string;
        model?: string;
        latencyMs?: number;
        error?: string;
        usage?: unknown;
        rawResponse?: string;
        curl?: string;
      };
      setAiTestResult(res);
      if (res.success) message.success('测试成功');
      else onError(res.error || '测试失败');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '测试失败';
      setAiTestResult({ success: false, error: msg });
      onError(msg);
    } finally {
      setAiTestLoading(false);
      setAiTestingPoolId('');
    }
  };

  const aiModelSection = (
    <>
      <SettingsSection title="聊天室 AI" description={`开启后可用「@${draft.aiBotName || '小音'}」「/${draft.aiBotName || '小音'}」唤醒；图片识图走视觉模型。改完后点下方保存。`}>
        <Switch
          checked={Boolean(draft.aiEnabled)}
          checkedChildren="已启用"
          unCheckedChildren="未启用"
          onChange={(checked) => setDraft({ ...draft, aiEnabled: checked })}
          aria-label="启用聊天室 AI"
        />
      </SettingsSection>
      {fieldGroup('aiModel')}
      <SettingsSection title="模型池" description="文本与识图分别调度；同优先级模型按当前并发负载均衡。">
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          {draft.aiModelPools.map((pool, index) => (
            <Card
              key={pool.id}
              size="small"
              title={`模型 ${index + 1}`}
              extra={<Space size={0}><Button type="text" loading={aiTestLoading && aiTestingPoolId === pool.id} onClick={() => void runAiTest(pool)}>测试</Button><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除模型 ${index + 1}`} onClick={() => setDraft({ ...draft, aiModelPools: draft.aiModelPools.filter((_, poolIndex) => poolIndex !== index) })} /></Space>}
            >
              <Row gutter={[12, 12]}>
                <Col xs={24} sm={8}><Select value={pool.type} style={{ width: '100%' }} options={[{ value: 'text', label: '文本处理' }, { value: 'vision', label: '图片处理' }]} onChange={(type) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, type, ...(type === 'text' ? { enableThinking: item.enableThinking === true } : { enableThinking: undefined }) } : item) })} /></Col>
                <Col xs={24} sm={8}><Input placeholder="名称（可选）" value={pool.name} onChange={(e) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, name: e.target.value } : item) })} /></Col>
                <Col xs={24} sm={8}><Switch checked={pool.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={(enabled) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, enabled } : item) })} /></Col>
                <Col xs={24} sm={12}><Input placeholder="Base URL" value={pool.apiBaseUrl} onChange={(e) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, apiBaseUrl: e.target.value } : item) })} /></Col>
                <Col xs={24} sm={12}><Input.Password placeholder={pool.configuredApiKey ? '已保存；留空保持不变' : 'API Key'} value={pool.apiKey} onChange={(e) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, apiKey: e.target.value } : item) })} /></Col>
                <Col xs={24} sm={12}><Input placeholder="模型 ID" value={pool.model} onChange={(e) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, model: e.target.value } : item) })} /></Col>
                <Col xs={24} sm={12}><Select value={pool.apiProtocol} style={{ width: '100%' }} options={[{ value: 'chat_completions', label: 'Chat Completions' }, { value: 'responses', label: 'Responses API' }]} onChange={(apiProtocol) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, apiProtocol } : item) })} /></Col>
                {pool.type === 'text' && (
                  <Col xs={24} sm={8}>
                    <Space size="small">
                      <Switch checked={pool.enableThinking === true} onChange={(enableThinking) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, enableThinking } : item) })} aria-label="启用深度思考" />
                      <Typography.Text>深度思考</Typography.Text>
                    </Space>
                  </Col>
                )}
                <Col xs={24} sm={8}><Space.Compact style={{ width: '100%' }}><Typography.Text style={{ padding: '4px 8px', border: '1px solid #d9d9d9', whiteSpace: 'nowrap' }}>上下文</Typography.Text><InputNumber value={Math.round(pool.contextWindowTokens / 1024)} min={4} max={2048} step={1} precision={0} addonAfter="K" style={{ width: '100%' }} onChange={(contextWindowK) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, contextWindowTokens: (Number(contextWindowK) || 256) * 1024 } : item) })} /></Space.Compact></Col>
                <Col xs={12} sm={8}><Space.Compact style={{ width: '100%' }}><Typography.Text style={{ padding: '4px 8px', border: '1px solid #d9d9d9', whiteSpace: 'nowrap' }}>RPM</Typography.Text><InputNumber value={pool.maxRequestsPerMinute} min={1} max={10_000} style={{ width: '100%' }} onChange={(maxRequestsPerMinute) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, maxRequestsPerMinute: Number(maxRequestsPerMinute) || 1 } : item) })} /></Space.Compact></Col>
                <Col xs={12} sm={8}><Space.Compact style={{ width: '100%' }}><Typography.Text style={{ padding: '4px 8px', border: '1px solid #d9d9d9', whiteSpace: 'nowrap' }}>TPM</Typography.Text><InputNumber value={pool.maxTokensPerMinute} min={1_000} max={2_000_000} step={1_000} style={{ width: '100%' }} onChange={(maxTokensPerMinute) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, maxTokensPerMinute: Number(maxTokensPerMinute) || 1_000 } : item) })} /></Space.Compact></Col>
                <Col xs={24} sm={8}><Space.Compact style={{ width: '100%' }}><Typography.Text style={{ padding: '4px 8px', border: '1px solid #d9d9d9', whiteSpace: 'nowrap' }}>优先级</Typography.Text><InputNumber value={pool.priority} min={1} max={1000} style={{ width: '100%' }} onChange={(priority) => setDraft({ ...draft, aiModelPools: draft.aiModelPools.map((item, poolIndex) => poolIndex === index ? { ...item, priority: Number(priority) || 100 } : item) })} /></Space.Compact></Col>
              </Row>
            </Card>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} disabled={draft.aiModelPools.length >= 20} onClick={() => setDraft({ ...draft, aiModelPools: [...draft.aiModelPools, createAiModelPool()] })}>添加模型</Button>
        </Space>
      </SettingsSection>
      {aiTestResult && (
        <SettingsSection title="测试结果">
          {aiTestResult.success !== true && (
            <Typography.Paragraph type={aiTestResult.success === false ? 'danger' : undefined} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {aiTestResult.success === undefined ? '正在测试…' : (aiTestResult.error || '未知错误')}
            </Typography.Paragraph>
          )}
          {(aiTestResult.curl || aiTestResult.rawResponse) && (
            <Row gutter={[12, 12]} style={{ marginTop: aiTestResult.success === true ? 0 : 12 }}>
              <Col xs={24} lg={12}>
                <Typography.Text strong>cURL 请求</Typography.Text>
                <pre style={{ margin: '6px 0 0', padding: 12, overflow: 'auto', maxHeight: 360, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 4 }}>
                  {aiTestResult.curl || '请求尚未发出'}
                </pre>
              </Col>
              <Col xs={24} lg={12}>
                <Typography.Text strong>响应原文</Typography.Text>
                <pre style={{ margin: '6px 0 0', padding: 12, overflow: 'auto', maxHeight: 360, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 4 }}>
                  {aiTestResult.rawResponse ? formatJsonResponse(aiTestResult.rawResponse) : '等待上游响应'}
                </pre>
              </Col>
            </Row>
          )}
        </SettingsSection>
      )}
    </>
  );

  const qqGroupSection = (
    <SettingsSection title="QQ 群入口" description="填写后首页右上角显示企鹅图标；留空则不显示。仅支持 qq.com 域名下的 HTTPS 群邀请链接。">
      <Input
        aria-label="QQ 群邀请链接"
        type="url"
        value={draft.qqGroupUrl}
        maxLength={1000}
        placeholder="https://qm.qq.com/q/..."
        onChange={(e) => setDraft({ ...draft, qqGroupUrl: e.target.value })}
      />
    </SettingsSection>
  );

  const seoSection = (
    <SettingsSection
      title="搜索引擎优化"
      description="只影响搜索引擎抓取，不影响首页界面"
    >
      <Row gutter={[12, 12]}>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>页面标题</Typography.Text>
          <Input
            value={draft.seoTitle}
            maxLength={120}
            placeholder="一起听歌 - 和喜欢的人 听同一首歌 | OpenMusic"
            onChange={(e) => setDraft({ ...draft, seoTitle: e.target.value })}
          />
        </Col>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>站点名称</Typography.Text>
          <Input
            value={draft.seoSiteName}
            maxLength={80}
            placeholder="OpenMusic"
            onChange={(e) => setDraft({ ...draft, seoSiteName: e.target.value })}
          />
        </Col>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>页面描述</Typography.Text>
          <Input.TextArea
            value={draft.seoDescription}
            maxLength={300}
            rows={3}
            showCount
            placeholder="想和朋友一起听歌？OpenMusic 免费在线一起听歌……"
            onChange={(e) => setDraft({ ...draft, seoDescription: e.target.value })}
          />
        </Col>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>关键词（逗号分隔）</Typography.Text>
          <Input.TextArea
            value={draft.seoKeywords}
            maxLength={400}
            rows={2}
            showCount
            placeholder="一起听歌,多人听歌,异地一起听歌"
            onChange={(e) => setDraft({ ...draft, seoKeywords: e.target.value })}
          />
        </Col>
        <Col xs={24} sm={12}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>规范主域</Typography.Text>
          <Input
            value={draft.seoCanonicalUrl}
            maxLength={200}
            placeholder="https://your-host"
            onChange={(e) => setDraft({ ...draft, seoCanonicalUrl: e.target.value })}
          />
        </Col>
        <Col xs={24} sm={12}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>百度站长验证码</Typography.Text>
          <Input
            value={draft.seoBaiduVerification}
            maxLength={120}
            placeholder="codeva-xxxx"
            onChange={(e) => setDraft({ ...draft, seoBaiduVerification: e.target.value })}
          />
        </Col>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>OG 分享图</Typography.Text>
          <Input
            value={draft.seoOgImage}
            maxLength={500}
            placeholder="/og-cover.png"
            onChange={(e) => setDraft({ ...draft, seoOgImage: e.target.value })}
          />
        </Col>
        <Col xs={24} sm={12}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>爬虫主标题</Typography.Text>
          <Input
            value={draft.seoHeroHeadline}
            maxLength={40}
            placeholder="和喜欢的人"
            onChange={(e) => setDraft({ ...draft, seoHeroHeadline: e.target.value })}
          />
        </Col>
        <Col xs={24} sm={12}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>爬虫副标题</Typography.Text>
          <Input
            value={draft.seoHeroSubline}
            maxLength={80}
            placeholder="听同一首歌"
            onChange={(e) => setDraft({ ...draft, seoHeroSubline: e.target.value })}
          />
        </Col>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>爬虫介绍标题</Typography.Text>
          <Input
            value={draft.seoAboutTitle}
            maxLength={80}
            placeholder="和喜欢的人听同一首歌，就用 OpenMusic"
            onChange={(e) => setDraft({ ...draft, seoAboutTitle: e.target.value })}
          />
        </Col>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>爬虫介绍正文</Typography.Text>
          <Input.TextArea
            value={draft.seoAboutText}
            maxLength={800}
            rows={3}
            showCount
            placeholder="OpenMusic 是免费的一起听歌网站。网页建房，邀请好友进来……"
            onChange={(e) => setDraft({ ...draft, seoAboutText: e.target.value })}
          />
        </Col>
      </Row>
    </SettingsSection>
  );

  const tabItems = [
    ...(securityTab
      ? [{
          key: 'security',
          label: '安全与账号',
          children: (
            <>
              {securityTab}
              <Divider style={{ margin: 0 }} />
              {fieldGroup('roomCredential')}
            </>
          ),
        }]
      : []),
    {
      key: 'seo',
      label: '站点展示',
      children: <>{qqGroupSection}<Divider style={{ margin: 0 }} />{seoSection}</>,
    },
    {
      key: 'music',
      label: '音源接入',
      children: (
        <>
          {musicSourcesSection}
          <Divider style={{ margin: 0 }} />
          {artistFilterSection}
          <Divider style={{ margin: 0 }} />
          {metingSection}
          <Divider style={{ margin: 0 }} />
          {qualitySection}
          <Divider style={{ margin: 0 }} />
          {sharedMembershipSection}
          <Divider style={{ margin: 0 }} />
          {customApiSection}
        </>
      ),
    },
    {
      key: 'identity',
      label: '身份登录',
      children: (
        <>
          <SettingsSection
            title="匿名登录"
            description="默认关闭，开启后访客无需注册或登录即可创建和加入房间、点歌、播放及收藏，身份和收藏依赖当前设备 Cookie，跨设备同步仍需登录账户，后台管理员仍须登录"
          >
            <Space align="center">
              <Switch
                checked={draft.anonymousLoginEnabled}
                onChange={anonymousLoginEnabled => setDraft({ ...draft, anonymousLoginEnabled })}
                aria-label="允许匿名登录"
              />
              <Typography.Text>允许匿名登录 · 保存后生效</Typography.Text>
            </Space>
          </SettingsSection>
          <Divider style={{ margin: 0 }} />
          <SettingsSection title="人机校验开关" description="免费方案不等于承诺全球可达或提供 SLA，请先验证部署地区、WebView 和服务端网络，再启用"><Switch checked={Boolean(draft.turnstileEnabled)} onChange={turnstileEnabled => setDraft({ ...draft, turnstileEnabled, riskChallengeEnabled: turnstileEnabled && draft.riskChallengeEnabled })} /> <span>保护邮箱登录与注册 · 保存后生效</span></SettingsSection>
          {fieldGroup('turnstile')}
          <SettingsSection title="异常访问验证" description="服务端按账户拦截异常资源请求，未通过时不返回资源，每个北京时间自然日最多两轮，两轮都通过后自动放行验证码闸门，不解除封禁或重置配额">
            <Space orientation="vertical"><Space><Switch checked={Boolean(draft.riskChallengeEnabled)} disabled={!draft.turnstileEnabled} onChange={riskChallengeEnabled => setDraft({ ...draft, riskChallengeEnabled })} /><span>启用异常访问验证</span></Space><Space><span>通过后冷却（分钟）</span><InputNumber min={1} max={1440} precision={0} value={draft.riskChallengeCooldownMinutes || 30} onChange={value => setDraft({ ...draft, riskChallengeCooldownMinutes: value || 30 })} /></Space></Space>
          </SettingsSection>

          <Divider style={{ margin: 0 }} />
          {fieldGroup('smtp')}
          <Divider style={{ margin: 0 }} />
          <SettingsSection title="微信与 QQ 扫码登录" description="登录列表中微信第一、QQ 第二，前台用户与后台管理员均可绑定，复用第三方服务中接口盒子的 ID 和密钥，登录仅支持 https://cn.apihz.cn/api 或 https://vip.apihz.cn/api，微信扫码身份与文件传输助手独立">
            <Space orientation="vertical">
              <Space><Switch checked={draft.apihzWechatEnabled === true} onChange={apihzWechatEnabled => setDraft({ ...draft, apihzWechatEnabled })} aria-label="启用微信扫码登录" /><Typography.Text>微信扫码登录 · 保存后生效</Typography.Text></Space>
              <Space><Switch checked={draft.apihzQqEnabled === true} onChange={apihzQqEnabled => setDraft({ ...draft, apihzQqEnabled })} aria-label="启用QQ扫码登录" /><Typography.Text>QQ扫码登录 · 保存后生效</Typography.Text></Space>
              {(!draft.configuredSecrets.apihzId || !draft.configuredSecrets.apihzKey) && <Typography.Text type="warning">请先在第三方服务中保存接口盒子 ID 和密钥</Typography.Text>}
            </Space>
          </SettingsSection>
          <Divider style={{ margin: 0 }} />
          {fieldGroup('linuxdo')}
          <Divider style={{ margin: 0 }} />
          {fieldGroup('github')}
        </>
      ),
    },
    {
      key: 'ai',
      label: '聊天室 AI',
      children: aiModelSection,
    },
    {
      key: 'integration',
      label: '第三方服务',
      children: (
        <>
          {fieldGroup('qiniu')}
          <Divider style={{ margin: 0 }} />
          {fieldGroup('apihz')}
        </>
      ),
    },
    {
      key: 'room',
      label: '房间',
      children: roomSection,
    },
  ];

  return (
    <>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />

      <div
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            marginTop: 'auto',
            marginLeft: -20,
            marginRight: -20,
            padding: '12px 20px',
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(8px)',
            borderTop: '1px solid #f0f0f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.04)',
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            密钥：未改保持原值；清空保存则关闭
          </Typography.Text>
          <Button type="primary" onClick={() => void save()} loading={saving}>
            保存配置
          </Button>
      </div>
    </>
  );
}
