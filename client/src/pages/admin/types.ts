export interface MetingUpstreamRecentError {
  at: number;
  message: string;
  type?: string;
  id?: string;
  server?: string;
  userId?: string;
  userNickname?: string;
  clientIp?: string;
  roomId?: string;
  roomName?: string;
}

export interface MetingUpstreamStatus {
  url: string;
  style?: string;
  disabled?: boolean;
  healthy: boolean;
  cooldownRemainingSec: number;
  okCount: number;
  failCount: number;
  softFailCount?: number;
  /** 0–100，按硬失败口径：ok / (ok + fail) */
  successRate?: number;
  lastError: string;
  lastErrorAt?: number;
  recentErrors?: MetingUpstreamRecentError[];
}

export interface AdminAuditEntry {
  id: string;
  accountId?: string;
  at: number;
  action: string;
  ip: string;
  roomId?: string;
  name?: string;
  kicked?: number;
  error?: string;
  path?: string;
  enabled?: boolean;
  announcementId?: string;
  url?: string;
  disabled?: boolean;
  roomCount?: number;
  banType?: string;
  value?: string;
  banId?: string;
  reportId?: string;
  status?: string;
  username?: string;
  via?: string;
  linuxdoUsername?: string;
  githubUsername?: string;
  approved?: boolean;
  reason?: string;
  code?: string;
  recoverable?: boolean;
  deviceId?: string;
  userId?: string;
  nickname?: string;
  previousNickname?: string;
  retryAfterSec?: number;
  ownedCount?: number;
  maxOwnedRooms?: number;
  source?: string;
  trigger?: string;
  success?: boolean;
  model?: string;
  latencyMs?: number;
}

export interface SiteAnnouncementConfig {
  enabled: boolean;
  id: string;
  title: string;
  text: string;
}

export interface RuntimeConfig {
  roomEmptyTtlMs: number;
  roomRestartGraceMs?: number;
  /** 建房冷却（毫秒）；0 = 关闭 */
  roomCreateCooldownMs: number;
  /** 同一身份最多自建房数；0 = 不限制 */
  roomCreateMaxOwned: number;
  /** 无身份时 IP 宽松冷却（毫秒）；0 = 关闭 */
  roomCreateIpLooseCooldownMs: number;
  /** 收藏分享固定快照的有效期（毫秒） */
  favoriteShareTtlMs: number;
  /** 注册邮箱验证码 SMTP，密码字段只以掩码回显。 */
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  linuxdoClientId: string;
  linuxdoClientSecret: string;
  linuxdoRedirectUri: string;
  linuxdoAuthorizeUrl: string;
  linuxdoTokenUrl: string;
  linuxdoUserInfoUrl: string;
  linuxdoScope: string;
  githubClientId: string;
  githubClientSecret: string;
  githubRedirectUri: string;
  githubScope: string;
  roomCredentialEncryptionKey: string;
  /** 是否开放 SVIP 音质选项（需上游 Cookie 具备对应权益） */
  svipQualityEnabled: Record<MusicApiPlatform, boolean>;
  /** 是否开放全站共享会员入口 */
  sharedMembershipEnabled: boolean;
  qqGroupUrl: string;
  metingApiUrl: string;
  metingApiAuth: string;
  metingSources: {
    url: string;
    type: 'meting';
    configuredAuth: boolean;
    auth?: string;
    clearAuth?: boolean;
  }[];
  musicApis: CustomMusicApi[];
  musicSourcesEnabled: Record<MusicApiPlatform, boolean>;
  blockedArtistKeywords: string[];
  qiniuAccessKey: string;
  qiniuSecretKey: string;
  qiniuBucket: string;
  qiniuDomain: string;
  qiniuZone: string;
  apihzBaseUrl: string;
  apihzId: string;
  apihzKey: string;
  /** 硅基流动 API Key（密钥字段，回显掩码） */
  aiApiKey: string;
  /** AI 服务 Base URL，例如 https://api.siliconflow.cn/v1 */
  aiApiBaseUrl: string;
  /** 上游协议 */
  aiApiProtocol: 'chat_completions' | 'responses';
  /** 是否启用聊天室 AI */
  aiEnabled: boolean;
  /** AI 昵称 */
  aiBotName: string;
  /** 文本 / Agent 模型，默认 Qwen/Qwen3-8B，可自填 */
  aiTextModel: string;
  /** 视觉识图模型，默认 Qwen/Qwen3.5-4B，可自填 */
  aiVisionModel: string;
  /** 全站共享的 AI 上游每分钟请求上限 */
  aiMaxRequestsPerMinute: number;
  /** 全站共享的 AI 上游每分钟 Token 上限 */
  aiMaxTokensPerMinute: number;
  aiModelPools: AiModelPool[];
  /** SEO：留空则前端/公开接口回退内置默认 */
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  seoSiteName: string;
  seoCanonicalUrl: string;
  seoBaiduVerification: string;
  seoOgImage: string;
  seoHeroHeadline: string;
  seoHeroSubline: string;
  seoAboutTitle: string;
  seoAboutText: string;
  configuredSecrets: Record<string, boolean>;
}

export interface DonationEntry {
  id: string;
  name: string;
  date: string;
  amount?: number;
  createdAt?: number;
}

export interface AiModelPool {
  id: string;
  enabled: boolean;
  type: 'text' | 'vision';
  name: string;
  apiBaseUrl: string;
  apiProtocol: 'chat_completions' | 'responses';
  apiKey: string;
  configuredApiKey: boolean;
  model: string;
  /** 文本模型是否开启深度思考；视觉模型不使用该字段 */
  enableThinking?: boolean;
  /** 模型上下文窗口 Token 数，默认 256K */
  contextWindowTokens: number;
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  priority: number;
}

export type MusicApiPlatform = 'netease' | 'tencent' | 'kugou' | 'qishui';
export type MusicApiOperation = 'search' | 'song' | 'url' | 'lrc' | 'pic' | 'playlist' | 'search_playlist';

export interface CustomMusicApi {
  id: string;
  name: string;
  remark: string;
  enabled: boolean;
  platforms: MusicApiPlatform[];
  operations: MusicApiOperation[];
  weight: number;
  timeoutMs: number;
  failureThreshold: number;
  cooldownMs: number;
  method: 'GET' | 'POST';
  url: string;
  params: string;
  headers: string;
  body: string;
  mapping: {
    items?: string;
    id?: string;
    name?: string;
    artist?: string;
    album?: string;
    pic?: string;
    duration?: string;
    url?: string;
    lrc?: string;
    value?: string;
  };
}

export interface CustomMusicApiRouteStatus {
  id: string;
  name: string;
  remark: string;
  platform: MusicApiPlatform;
  operation: MusicApiOperation;
  enabled: boolean;
  weight: number;
  circuitState: 'closed' | 'open' | 'half-open' | 'disabled';
  healthy: boolean;
  cooldownRemainingSec: number;
  consecutiveFailures: number;
  okCount: number;
  failCount: number;
  lastError: string;
  lastFailureAt: number;
  lastSuccessAt: number;
}

export interface CustomMusicApiStatus {
  configured: boolean;
  routes: CustomMusicApiRouteStatus[];
}

export interface SiteBanEntry {
  id: string;
  type: 'ip' | 'device';
  value: string;
  reason: string;
  source?: 'manual';
  at: number;
}

export interface ErrorReportSummary {
  id: string;
  type: 'error' | 'feedback';
  status: 'open' | 'resolved';
  description: string;
  ip: string;
  userId: string;
  createdAt: number;
  resolvedAt: number | null;
  note: string;
  solutionAckedAt?: number | null;
  meta: {
    roomId?: string | null;
    nickname?: string | null;
    trackName?: string | null;
    trackSource?: string | null;
    href?: string | null;
  };
  eventCount: number;
  snapshotCount?: number;
  hasSnapshot: boolean;
}

export interface ErrorReportSnapshotSection {
  id: string;
  title: string;
  content: string;
}

export interface ErrorReportDetail extends ErrorReportSummary {
  snapshot: string;
  snapshots?: ErrorReportSnapshotSection[];
  events: { at: string; name: string; line: string }[];
  meta: Record<string, string | number | boolean | null>;
}

export interface AdminOverview {
  roomCount: number;
  onlineUsers: number;
  playingRooms: number;
  connectedSockets: number;
  uptimeSec: number;
  memoryRssMb: number;
  redisEnabled: boolean;
  metingUpstreams: MetingUpstreamStatus[];
  entryPath?: string;
  adminUsername?: string;
  credentialsPersisted?: boolean;
  mustChangeCredentials?: boolean;
  mustChangeEntryPath?: boolean;
  setupRequired?: boolean;
  auditStoredIn?: 'redis' | 'memory';
}

export interface AdminRoom {
  id: string;
  name: string;
  userCount: number;
  users: { id: string; nickname: string; clientIp?: string; deviceId?: string }[];
  hasPassword: boolean;
  isLocked: boolean;
  isPlaying: boolean;
  currentSong: { name: string; artist: string } | null;
  queueLength: number;
  createdAt: number;
  lastJoinedAt?: number | null;
  ownerLastJoinedAt?: number | null;
  protectedFromDestroy: boolean;
  ownerNickname?: string;
  creatorId?: string | null;
  creatorDeviceId?: string | null;
  creatorIp?: string | null;
  creatorNickname?: string | null;
  permanentApplication?: {
    status: 'pending';
    appliedAt: number;
    applicantNickname?: string;
    note?: string;
    applicantId?: string;
  } | null;
}

export type AdminTabId = 'overview' | 'rooms' | 'bans' | 'risk' | 'reports' | 'notify' | 'donations' | 'settings' | 'audit';
