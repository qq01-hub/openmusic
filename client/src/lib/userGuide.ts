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
    body: '登录：用邮箱或第三方账号登录，在账户安全中绑定身份\n游客：无需注册也能建房、进房和点歌；登录后收藏会并入账户\n我的房间：登录后可跨设备查看；认领匿名房间需原房主凭证',
    side: 'bottom',
  },
  {
    id: 'home-nickname',
    scope: 'home',
    title: '设置昵称',
    body: '输入想让房间成员看到的昵称。',
    side: 'bottom',
  },
  {
    id: 'home-match',
    scope: 'home',
    title: '快速匹配',
    body: '点击快速匹配，自动加入公开房间；暂无房间时可自己创建。',
    side: 'bottom',
  },
  {
    id: 'home-create',
    scope: 'home',
    title: '创建房间',
    body: '创建后分享房间号，邀请朋友一起听。\n下次创建会沿用上次的点歌、队列和聊天规则。',
    side: 'bottom',
  },
  {
    id: 'home-join',
    scope: 'home',
    title: '加入房间',
    body: '输入房间号即可加入；密码房还需输入密码。',
    side: 'bottom',
  },
  {
    id: 'home-lobby',
    scope: 'home',
    title: '大厅房间',
    body: '点击开场画面（或按 Enter）进入大厅，再点房间卡片加入。',
    side: 'top',
  },
  {
    id: 'room-search',
    scope: 'room',
    title: '点歌入口',
    body: '搜索：输入歌名找歌，或粘贴歌单链接导入\n发现：从播放历史、热榜歌单和音乐电台找歌\n我的收藏：按分类筛歌，也可生成可撤销的分享码\n分页：搜索结果、歌单和收藏可选择每页 100 条\n分享：把搜索结果发成聊天音乐卡片',
    side: 'bottom',
  },
  {
    id: 'room-hot',
    scope: 'room',
    title: '热榜点歌',
    body: '双击热榜歌曲，或点「+」加入播放队列。',
    side: 'right',
  },
  {
    id: 'room-queue',
    scope: 'room',
    title: '播放队列',
    body: '待播：看下一首，点心形收藏喜欢的歌\n踩歌：达到人数后切歌；排序、切歌和清空需控播权限\n分享：将歌曲发到聊天；点卡片封面可在本机试听',
    side: 'top',
  },
  {
    id: 'room-chat',
    scope: 'room',
    title: '聊天室',
    body: '发消息：可用表情和贴纸；右键消息（手机长按）撤回\n音乐卡片：点封面在本机试听，再点封面暂停并返回房间播放\n房主/管理：可管理禁言和成员消息',
    side: 'left',
  },
  {
    id: 'room-header',
    scope: 'room',
    title: '顶栏功能',
    body: '自己设置：调音质、昵称、头像或主题；纯净/沉浸模式切换视图\n邀请朋友：打开分享二维码，复制邀请文案\n房主/管理：在房间设置改点歌规则，修改后自动保存\n仅房主：在「漫游」选私人漫游或指定歌单；绑定微信 UIN 可扫码找回身份（转让后失效）',
    side: 'bottom',
  },
  {
    id: 'room-player',
    scope: 'room',
    title: '底部播放器',
    body: '展开：点封面或歌词，打开大播放器；音量只影响本机\n播控：房主/管理可暂停或切歌，成员可申请切歌\n播放模式：可顺序、随机、轮流或循环；随机播收藏时，选择者离房会恢复顺序播放\n收藏：点心形保存歌曲，之后在「我的收藏」点播',
    side: 'top',
  },
  {
    id: 'room-desktop-lyrics',
    scope: 'room',
    title: '桌面歌词',
    body: '点击歌词按钮，在桌面显示同步歌词；拖动歌词条调整位置。\n右键歌词条可改样式；再点歌词按钮关闭。浏览器需支持文档画中画。',
    side: 'top',
    desktopOnly: true,
  },
  {
    id: 'room-report',
    scope: 'room',
    title: '意见与错误上报',
    body: '遇到故障点「上报错误」，会附调试快照。\n想提建议点「提交意见」，只发送文字。',
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
