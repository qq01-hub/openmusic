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
    title: '登录与我的账户',
    body: '登录后一起听歌，收藏和房间随账户同步\n已有账户？登录后可绑定其他方式，微信扫码与文件传输助手需分别绑定\n聚合微信或 QQ 扫码后，点击「我已完成扫码，检查登录」，页面不会自动查询\n手机拦截跳转时可先手动检查，仍未收到确认可改用其他方式并联系管理员',
    side: 'bottom',
  },
  {
    id: 'home-nickname',
    scope: 'home',
    title: '设置昵称',
    body: '输入大家看到的昵称，登录后自动保存',
    side: 'bottom',
  },
  {
    id: 'home-match',
    scope: 'home',
    title: '快速匹配',
    body: '点击「快速匹配」加入公开房间，暂无房间时可自己创建',
    side: 'bottom',
  },
  {
    id: 'home-create',
    scope: 'home',
    title: '创建房间',
    body: '创建房间后，分享房间号邀请朋友一起听\n点歌和聊天规则可在房间设置中调整',
    side: 'bottom',
  },
  {
    id: 'home-join',
    scope: 'home',
    title: '加入房间',
    body: '输入房间号加入，密码房还需填写密码',
    side: 'bottom',
  },
  {
    id: 'home-lobby',
    scope: 'home',
    title: '大厅房间',
    body: '点击房间卡片加入，或用「加载更多房间」继续浏览',
    side: 'top',
  },
  {
    id: 'room-search',
    scope: 'room',
    title: '点歌入口',
    body: '输入歌名、歌手找歌，也可粘贴歌单链接导入\n点「+」加入队列，点心形收藏，在「我的收藏」查看',
    side: 'bottom',
  },
  {
    id: 'room-hot',
    scope: 'room',
    title: '热榜点歌',
    body: '双击歌曲，或点「+」加入播放队列',
    side: 'right',
  },
  {
    id: 'room-queue',
    scope: 'room',
    title: '播放队列',
    body: '查看待播歌曲，点赞支持喜欢的歌，点心形收藏\n房主或管理员可调整顺序、切歌和清空队列',
    side: 'top',
  },
  {
    id: 'room-chat',
    scope: 'room',
    title: '聊天室',
    body: '发送消息、表情或分享歌曲，右键消息（手机长按）可撤回\n点音乐卡片封面试听，再点暂停',
    side: 'left',
  },
  {
    id: 'room-header',
    scope: 'room',
    title: '顶栏功能',
    body: '在这里调整音质、外观和昵称，查看成员或邀请朋友\n房主和管理员可打开房间设置，调整点歌与聊天规则',
    side: 'bottom',
  },
  {
    id: 'room-player',
    scope: 'room',
    title: '底部播放器',
    body: '点封面或歌词展开播放器，音量只影响自己\n没有声音时点「开启声音」，iPhone 和 iPad 首次需点击页面授权声音\n关闭系统播放绑定或没有暂停权限时，耳机播放与暂停键只切换本机静音，再按可恢复音量\n房主和管理员可暂停或切歌',
    side: 'top',
  },
  {
    id: 'room-desktop-lyrics',
    scope: 'room',
    title: '桌面歌词',
    body: '点歌词按钮打开或关闭桌面歌词，拖动调整位置\n右键可改样式，需要浏览器支持文档画中画',
    side: 'top',
    desktopOnly: true,
  },
  {
    id: 'room-report',
    scope: 'room',
    title: '意见与错误上报',
    body: '遇到故障点「上报错误」，会附带调试信息\n有建议点「提交意见」',
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
