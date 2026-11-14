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

// 首次指引只保留入门操作，详细规则放在对应功能内说明
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'room-header',
    scope: 'room',
    title: '房间信息与操作',
    body: '房间名下方查看房间号与公告，在线人数、漫游模式与音质在同一行，点歌限制按需显示\n主题色、模式切换、分享和退出入口位于工具条，较窄窗口显示图标，悬停可查看说明',
    side: 'bottom',
  },
  {
    id: 'home-account',
    scope: 'home',
    title: '先登录',
    body: '登录后一起听歌，收藏随账号同步',
    side: 'bottom',
  },
  {
    id: 'home-create',
    scope: 'home',
    title: '创建房间',
    body: '创建房间，分享房间号邀请好友',
    side: 'bottom',
  },
  {
    id: 'home-join',
    scope: 'home',
    title: '加入房间',
    body: '输入房间号，或在大厅选房间',
    side: 'bottom',
  },
  {
    id: 'room-search',
    scope: 'room',
    title: '搜索点歌',
    body: '搜歌后点「+」点歌，点心形收藏；清空搜索框后点击输入框，可选最近 5 条搜索历史快速重搜，歌曲与歌单分别记录\n播放历史复播成功后显示「已点播」\n选中自定义收藏分类后显示笔和删除图标，点笔可改名',
    side: 'bottom',
  },
  {
    id: 'room-queue',
    scope: 'room',
    title: '播放队列',
    body: '查看待播歌曲，用户轮播时标题右侧常驻显示下一首，悬停可查看完整歌曲信息',
    side: 'top',
  },
  {
    id: 'room-chat',
    scope: 'room',
    title: '边听边聊',
    body: '聊天、发表情，@ 房间 AI 帮你找歌点歌',
    side: 'left',
  },
  {
    id: 'room-player',
    scope: 'room',
    title: '播放与声音',
    body: '点封面展开播放器，音量只影响自己；点音量图标展开后，在音量控件上滚动鼠标滚轮，每次增减 1%\n房主和正式管理员可用展开歌词页右上角、电视图标左侧的两个旋转箭头图标将歌词提前或延后，每次 0.5 秒，悬停查看当前偏移，全房间同步，房间会记住每首歌的调整\n播放模式支持歌手随机，右键播放模式按钮（手机双击）进入设置，填写歌手并选择音源，默认不含合唱，可开启「包含其他歌手合唱」；禁播歌曲排除，已播放歌曲降权，全部播过后重置，歌手无有效歌曲时保留原模式\n没声音时点「开启声音」\n浏览器桌面歌词使用歌曲封面背景色，译文独立分行，窗口内容不显示操作按钮',
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
