/**
 * 新用户功能指引。
 *
 * 重部署后本模块的 storage 为空，不能据此把老用户当新人。
 * 首次初始化时用既有本地痕迹推断「已经会用」，直接跳过全套指引。
 *
 * 房间页只保留合并后的重要步骤；沉浸模式不做指引。
 */

export type GuideFeatureId =
  | 'home-account'
  | 'home-nickname'
  | 'home-match'
  | 'home-create'
  | 'home-join'
  | 'home-lobby'
  | 'room-search'
  | 'room-hot'
  | 'room-queue'
  | 'room-chat'
  | 'room-header'
  | 'room-player'
  | 'room-desktop-lyrics'
  | 'room-report';

export type GuideScope = 'home' | 'room';

export type GuideSide = 'top' | 'bottom' | 'left' | 'right';

export interface GuideStep {
  id: GuideFeatureId;
  scope: GuideScope;
  title: string;
  body: string;
  side?: GuideSide;
  /** 桌面宽屏才有意义的步骤（如侧栏热榜） */
  desktopOnly?: boolean;
}

interface GuideState {
  /** 已跳过或被推断为老用户，永不再弹 */
  skipped: boolean;
  /** 已完整走完的场景 */
  completedScopes: GuideScope[];
  /** 点过/用过的功能，对应步骤自动跳过 */
  used: GuideFeatureId[];
  /** 是否已跑过老用户推断（只跑一次） */
  bootstrapped: boolean;
}

const STORAGE_KEY = 'openmusic:user-guide:v1';
const GUIDE_EVENT = 'openmusic:guide-feature-used';

const ALL_FEATURE_IDS: GuideFeatureId[] = [
  'home-account',
  'home-nickname',
  'home-match',
  'home-create',
  'home-join',
  'home-lobby',
  'room-search',
  'room-hot',
  'room-queue',
  'room-chat',
  'room-header',
  'room-player',
  'room-desktop-lyrics',
  'room-report',
];

/** 旧版细粒度 id → 合并后的步骤 */
const LEGACY_FEATURE_MAP: Record<string, GuideFeatureId> = {
  'room-history': 'room-search',
  'room-playlists': 'room-search',
  'room-radio': 'room-search',
  'room-favorites': 'room-search',
  'room-import': 'room-search',
  'room-users': 'room-header',
  'room-quality': 'room-header',
  'room-settings': 'room-header',
  'room-theme': 'room-header',
  'room-pure': 'room-header',
  'room-immersive': 'room-header',
  'room-share': 'room-header',
};

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'home-account',
    scope: 'home',
    title: '账户与游客身份',
    body: '登录：可使用邮箱、Linux Do、GitHub 或微信扫码，并在账户安全中绑定多个身份\n游客：无需注册，原有建房、进房和点歌功能保持可用；登录后可恢复跨设备的账户收藏',
    side: 'bottom',
  },
  {
    id: 'home-nickname',
    scope: 'home',
    title: '设置昵称',
    body: '昵称：进房后其他人能看到你',
    side: 'bottom',
  },
  {
    id: 'home-match',
    scope: 'home',
    title: '快速匹配',
    body: '匹配：自动加入一个可进入的公开房间\n没有可加入的房间：会提示你创建房间或稍后重试',
    side: 'bottom',
  },
  {
    id: 'home-create',
    scope: 'home',
    title: '创建房间',
    body: '创建房间：开一个专属房间，邀请朋友一起听\n常用规则：再次创建时，会沿用最近一次创建房间的点歌、队列和聊天设置',
    side: 'bottom',
  },
  {
    id: 'home-join',
    scope: 'home',
    title: '加入房间',
    body: '加入：输入房间号进入\n密码房：会再要求输入密码',
    side: 'bottom',
  },
  {
    id: 'home-lobby',
    scope: 'home',
    title: '大厅房间',
    body: '房间卡片：点卡片即可加入活跃房间',
    side: 'top',
  },
  {
    id: 'room-search',
    scope: 'room',
    title: '点歌入口',
    body: '搜索：搜歌名或粘贴歌单链接\n播放历史：找回播过的歌\n热榜歌单：浏览精选歌单\n音乐电台：按电台听歌\n我的收藏：收藏过的歌\n导入歌单：粘贴链接整单导入',
    side: 'bottom',
  },
  {
    id: 'room-hot',
    scope: 'room',
    title: '热榜点歌',
    body: '热榜：双击或点「+」加入播放队列',
    side: 'right',
  },
  {
    id: 'room-queue',
    scope: 'room',
    title: '播放队列',
    body: '待播列表：查看当前排队歌曲\n排序/切歌/清空：需房主/管理（或获授权控播）\n踩歌：达到人数会触发切歌\n收藏：心形收藏当前队列里的歌',
    side: 'top',
  },
  {
    id: 'room-chat',
    scope: 'room',
    title: '聊天室',
    body: '聊天：支持表情与贴纸\n撤回：右键消息（手机长按）\n自己：2 分钟内可撤回\n房主/管理：可撤他人（不能撤房主/其他管理）\n禁言：房主/管理可开禁言管理',
    side: 'left',
  },
  {
    id: 'room-header',
    scope: 'room',
    title: '顶栏功能',
    body: '音质：改本机听到的音质\n在线用户：查看成员，改昵称/头像\n主题色：换房间氛围色\n纯净模式：隐藏动效，标签页伪装\n沉浸模式：全屏视觉体验\n分享：打开二维码与邀请文案，一键复制\n房主/管理：踢人、进房间设置\n仅房主：在「漫游」设置私人漫游或多个指定歌单，歌单可跨平台；指定后队列为空时仅从合并曲库循环取歌，可搜索或粘贴链接，并可选择是否按歌名去重\n仅房主：任命/取消管理员、允许管理员自助设置自己的贵宾标识\n身份绑定：当前房主可绑定微信 UIN，换设备后可扫码恢复自己的房主身份；房主转让后，原绑定不再具备找回权限',
    side: 'bottom',
  },
  {
    id: 'room-player',
    scope: 'room',
    title: '底部播放器',
    body: '展开：点封面或歌词，打开大播放器\n播控：房主/管理可播放、暂停和切歌；普通成员可申请切歌\n播放模式：顺序播放（按队列顺序）；随机播放（随机抽取待播歌曲）；按用户轮流播放（每轮尽量让每位点歌用户播放一首，在线用户优先）；随机播放收藏列表（从当前用户收藏中随机点播）；单曲循环（自然播放结束后重播当前歌曲，手动切歌仍会前进）；列表循环（播放后回收到队尾）；列表内随机（随机播放并循环队列，避免立即重复）；音量只影响本机\n收藏：点心形收藏，可在「我的收藏」再次点播',
    side: 'top',
  },
  {
    id: 'room-desktop-lyrics',
    scope: 'room',
    title: '桌面歌词',
    body: '桌面歌词：把同步歌词固定显示在任务栏上方；可拖动歌词条，右键打开「歌词样式」分别调整主歌词和翻译歌词的颜色、字号。开关：再次点击底栏的歌词按钮即可关闭。浏览器端使用支持文档画中画的最新版 Chrome 或 Edge；客户端会使用原生桌面歌词窗口。',
    side: 'top',
    desktopOnly: true,
  },
  {
    id: 'room-report',
    scope: 'room',
    title: '意见与错误上报',
    body: '上报错误：附带调试快照，方便排查问题\n提交意见：只交文字建议',
    side: 'top',
  },
];

function emptyState(): GuideState {
  return {
    skipped: false,
    completedScopes: [],
    used: [],
    bootstrapped: false,
  };
}

function normalizeFeatureId(id: unknown): GuideFeatureId | null {
  if (typeof id !== 'string') return null;
  if (ALL_FEATURE_IDS.includes(id as GuideFeatureId)) return id as GuideFeatureId;
  return LEGACY_FEATURE_MAP[id] ?? null;
}

function normalizeScopes(scopes: unknown): GuideScope[] {
  if (!Array.isArray(scopes)) return [];
  const next = new Set<GuideScope>();
  for (const scope of scopes) {
    if (scope === 'home' || scope === 'room') next.add(scope);
    // 旧版 immersive 完成态忽略即可
  }
  return [...next];
}

function readRaw(): GuideState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<GuideState>;
    const used = Array.isArray(parsed.used)
      ? [...new Set(parsed.used.map(normalizeFeatureId).filter((id): id is GuideFeatureId => Boolean(id)))]
      : [];
    return {
      skipped: Boolean(parsed.skipped),
      completedScopes: normalizeScopes(parsed.completedScopes),
      used,
      bootstrapped: Boolean(parsed.bootstrapped),
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: GuideState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable.
  }
}

function hasLocalKey(key: string): boolean {
  try {
    return localStorage.getItem(key) != null;
  } catch {
    return false;
  }
}

function hasRecentRooms(): boolean {
  try {
    const raw = localStorage.getItem('openmusic_recent_rooms');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function hasAnnouncementSeenKeys(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('openmusic_announcement_seen:')) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * 用部署前就存在的本地痕迹判断「已经会用」。
 * 只要命中较强信号，就视为老用户，整套指引直接跳过。
 */
export function isLikelyReturningUser(): boolean {
  if (hasRecentRooms()) return true;

  const nickname = (() => {
    try {
      return (localStorage.getItem('sjb_nickname') || '').trim();
    } catch {
      return '';
    }
  })();

  const veteranSignals = [
    hasLocalKey('openmusic_client_id'),
    hasLocalKey('openmusic_device_id'),
    hasLocalKey('avatar_url'),
    hasLocalKey('openmusic:user-audio-quality'),
    hasLocalKey('openmusic:volume'),
    hasLocalKey('openmusic:room-theme-color'),
    hasLocalKey('openmusic:room-pure-mode') || hasLocalKey('openmusic:room-focus-mode'),
    hasLocalKey('openmusic:playlist-import-history'),
    hasLocalKey('openmusic:site-announcement-seen-id'),
    hasLocalKey('openmusic:update-dismissed-build'),
    hasAnnouncementSeenKeys(),
  ].filter(Boolean).length;

  if (nickname && veteranSignals >= 1) return true;
  if (veteranSignals >= 2) return true;
  return false;
}

/** 按已有偏好，把「明显用过」的合并步骤记上 */
function inferUsedFeatures(): GuideFeatureId[] {
  const used: GuideFeatureId[] = [];
  if (hasRecentRooms()) {
    used.push('home-create', 'home-join', 'home-lobby', 'home-nickname', 'room-header');
  }
  try {
    if ((localStorage.getItem('sjb_nickname') || '').trim()) used.push('home-nickname');
  } catch {
    // ignore
  }
  if (
    hasLocalKey('avatar_url')
    || hasLocalKey('openmusic:user-audio-quality')
    || hasLocalKey('openmusic:room-theme-color')
    || hasLocalKey('openmusic:room-pure-mode')
    || hasLocalKey('openmusic:room-focus-mode')
  ) {
    used.push('room-header');
  }
  if (hasLocalKey('openmusic:playlist-import-history')) used.push('room-search');
  if (hasLocalKey('openmusic:volume')) used.push('room-player');
  return [...new Set(used)];
}

/** 首次读取时跑一次：老用户整套跳过；否则只预填已用过的功能 */
export function ensureGuideBootstrapped(): GuideState {
  const state = readRaw();
  if (state.bootstrapped) return state;

  if (isLikelyReturningUser()) {
    const next: GuideState = {
      skipped: true,
      completedScopes: ['home', 'room'],
      used: [...ALL_FEATURE_IDS],
      bootstrapped: true,
    };
    writeState(next);
    return next;
  }

  const next: GuideState = {
    skipped: false,
    completedScopes: [],
    used: inferUsedFeatures(),
    bootstrapped: true,
  };
  writeState(next);
  return next;
}

export function getGuideState(): GuideState {
  return ensureGuideBootstrapped();
}

export function isGuideSkipped(): boolean {
  return getGuideState().skipped;
}

export function isGuideScopeCompleted(scope: GuideScope): boolean {
  const state = getGuideState();
  return state.skipped || state.completedScopes.includes(scope);
}

export function isGuideFeatureUsed(id: GuideFeatureId): boolean {
  const state = getGuideState();
  return state.skipped || state.used.includes(id);
}

export function markGuideSkipped(): void {
  const state = getGuideState();
  writeState({
    ...state,
    skipped: true,
    bootstrapped: true,
  });
}

export function markGuideScopeCompleted(scope: GuideScope): void {
  const state = getGuideState();
  if (state.skipped || state.completedScopes.includes(scope)) return;
  writeState({
    ...state,
    completedScopes: [...state.completedScopes, scope],
    bootstrapped: true,
  });
}

export function markGuideFeatureUsed(
  id: GuideFeatureId,
  opts?: { emit?: boolean },
): void {
  const state = getGuideState();
  if (state.skipped || state.used.includes(id)) return;
  writeState({
    ...state,
    used: [...state.used, id],
    bootstrapped: true,
  });
  if (opts?.emit === false) return;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: { id } }));
  }
}

export function getGuideSelector(id: GuideFeatureId): string {
  return `[data-guide="${id}"]`;
}

export function getPendingGuideSteps(scope: GuideScope, opts?: { isDesktop?: boolean }): GuideStep[] {
  const state = getGuideState();
  if (state.skipped || state.completedScopes.includes(scope)) return [];
  const used = new Set(state.used);
  const isDesktop = opts?.isDesktop ?? (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
  return GUIDE_STEPS.filter((step) => {
    if (step.scope !== scope) return false;
    if (used.has(step.id)) return false;
    if (step.desktopOnly && !isDesktop) return false;
    return true;
  });
}

/** 点击带 data-guide 的控件时记为已用 */
let guideTourActive = false;

/** 指引进行中时，避免点到其它锚点被提前记成「已用」从而跳过步骤 */
export function setGuideTourActive(active: boolean): void {
  guideTourActive = Boolean(active);
}

export function installGuideUsageTracking(): void {
  if (typeof document === 'undefined') return;
  const w = window as Window & { __openmusicGuideTracking?: boolean };
  if (w.__openmusicGuideTracking) return;
  w.__openmusicGuideTracking = true;

  ensureGuideBootstrapped();

  document.addEventListener(
    'click',
    (event) => {
      if (guideTourActive) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest('[data-guide]');
      if (!el) return;
      const id = normalizeFeatureId(el.getAttribute('data-guide'));
      if (id) markGuideFeatureUsed(id);
    },
    true,
  );
}

export function subscribeGuideFeatureUsed(handler: (id: GuideFeatureId) => void): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ id?: GuideFeatureId }>).detail;
    if (detail?.id) handler(detail.id);
  };
  window.addEventListener(GUIDE_EVENT, onEvent);
  return () => window.removeEventListener(GUIDE_EVENT, onEvent);
}
