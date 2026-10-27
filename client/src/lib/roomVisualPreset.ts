import type { LyricFontKey } from './lyricStyle';

const MODE_KEY = 'openmusic:room-visual-mode';
const FX_KEY = 'openmusic:room-visual-fx';

/** Mineradio 着色器预设：0=emily … 5=galaxy，6=topography */
export type RoomVisualPresetId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 房间背景模式 */
export type RoomVisualMode =
  | 'folia'
  | 'emily'
  | 'tunnel'
  | 'vinyl'
  | 'galaxy'
  | 'planet'
  | 'void'
  | 'topography'
  | 'topography-we'
  | 'cover-bg'
  | 'off';

export const ROOM_VISUAL_DISPLAY_ORDER: RoomVisualMode[] = [
  'folia',
  'cover-bg',
  'emily',
  'topography',
  'galaxy',
  'topography-we',
  'vinyl',
  'planet',
  'tunnel',
  'void',
];

export const ROOM_VISUAL_MODES: RoomVisualMode[] = ROOM_VISUAL_DISPLAY_ORDER;

export const ROOM_VISUAL_MODE_META: Record<
  RoomVisualMode,
  {
    name: string;
    hasSettings: boolean;
    shaderPreset?: RoomVisualPresetId;
  }
> = {
  folia: { name: 'Folia · 辞曲新境', hasSettings: true },
  emily: { name: 'emily专辑封面', hasSettings: true, shaderPreset: 0 },
  tunnel: { name: '滚筒', hasSettings: true, shaderPreset: 1 },
  vinyl: { name: '唱片', hasSettings: true, shaderPreset: 4 },
  galaxy: { name: '星河', hasSettings: true, shaderPreset: 5 },
  planet: { name: '星球', hasSettings: true, shaderPreset: 2 },
  void: { name: '虚空', hasSettings: true, shaderPreset: 3 },
  topography: { name: '声波地形', hasSettings: true, shaderPreset: 6 },
  'topography-we': { name: '音域回响 · WE', hasSettings: true },
  'cover-bg': { name: '封面背景', hasSettings: false },
  off: { name: '关闭背景', hasSettings: false },
};

const LEGACY_MODE_ALIASES: Record<string, RoomVisualMode> = {
  cover: 'emily',
  skull: 'topography',
  orbit: 'planet',
  soundwave: 'galaxy',
  vortex: 'galaxy',
  aurora: 'galaxy',
  raindrop: 'galaxy',
};

const LEGACY_NUMERIC_MODE: Record<number, RoomVisualMode> = {
  0: 'emily',
  1: 'tunnel',
  2: 'planet',
  3: 'void',
  4: 'vinyl',
  5: 'galaxy',
  6: 'topography',
  8: 'topography-we',
};

export interface RoomVisualFxSettings {
  intensity: number;
  depth: number;
  point: number;
  speed: number;
  twist: number;
  colorBoost: number;
  scatter: number;
  bgFade: number;
  bloomStrength: number;
  coverResolution: number;
  cinemaShake: number;
  bloom: boolean;
  edge: boolean;
  cinema: boolean;
  floatLayer: boolean;
  backCover: boolean;
  cameraDistance: number;
  visualTintColor: string;
  visualTintMode: 'auto' | 'custom';
  uiAccentColor: string;
  homeAccentColor: string;
  homeIconColor: string;
  visualIconColor: string;
  backgroundColorMode: 'cover' | 'custom';
  backgroundColor: string;
  backgroundOpacity: number;
  controlGlassChromaticOffset: number;
  backgroundMedia: string | null;
  lyricGlowStrength: number;
  lyricScale: number;
  lyricOffsetX: number;
  lyricOffsetY: number;
  lyricOffsetZ: number;
  lyricTiltX: number;
  lyricTiltY: number;
  lyricGlow: boolean;
  lyricGlowBeat: boolean;
  lyricGlowParticles: boolean;
  lyricCameraLock: boolean;
  particleLyrics: boolean;
  /** 是否显示歌词翻译（默认开启） */
  lyricShowTranslation: boolean;
  lyricColorMode: 'auto' | 'custom';
  /** 歌词纹理清晰度倍率（1-4×超采样） */
  lyricTextureClarity: 1 | 2 | 3 | 4;
  /** 翻译显示模式：关闭/仅当前行/成对双行/全部多行 */
  lyricTranslationMode: 'off' | 'current' | 'dual' | 'multi';
  /** 歌词显示行数模式 */
  lyricDisplayMode: 'single' | 'dual' | 'triple' | 'cinema' | 'custom';
  /** custom 模式下的行数（1-10） */
  lyricCustomLineCount: number;
  /** 歌词运动风格 */
  lyricMotionStyle: 'float' | 'smooth' | 'glass' | 'quick' | 'shine' | 'glitch';
  /** 上下句透明度（0.25-1） */
  lyricContextOpacity: number;
  /** 上下句行距（0.6-2.4） */
  lyricContextSpread: number;
  /** 原文与译文间距（0.28-2.2） */
  lyricTranslationGap: number;
  lyricTranslationScale: number;
  lyricTranslationOpacity: number;
  lyricBackgroundAdapt: number;
  /** 上下句边缘淡出强度（0-1） */
  lyricEdgeFade: number;
  /** 运动柔和度（0.15-1.2） */
  lyricMotionSoftness: number;
  /** 故障风格强度（0-1.5） */
  lyricGlitchIntensity: number;
  /** 故障切片幅度（0-1.4） */
  lyricGlitchSlice: number;
  /** 故障色散强度（0-1.6） */
  lyricGlitchChroma: number;
  /** 故障触发速度（0.45-2.2） */
  lyricGlitchRate: number;
  /** 故障抖动幅度（0-1.8） */
  lyricGlitchJitter: number;
  /** 故障跟随鼓点触发 */
  lyricGlitchCameraBind: boolean;
  lyricVerticalFloat: boolean;
  backgroundStarRiver: boolean;
  lyricPauseHold: boolean;
  lyricColor: string;
  lyricHighlightMode: 'auto' | 'custom';
  lyricHighlightColor: string;
  lyricGlowLinked: boolean;
  lyricGlowColor: string;
  lyricFont: LyricFontKey;
  lyricLetterSpacing: number;
  lyricLineHeight: number;
  lyricWeight: number;
  shelfMode: 'off' | 'side' | 'stage';
  shelfCameraMode: 'dynamic' | 'static';
  shelfPresence: 'auto' | 'always';
  shelfAccentColor: string;
  shelfSize: number;
  shelfOffsetX: number;
  shelfOffsetY: number;
  shelfOffsetZ: number;
  shelfAngleY: number;
  shelfOpacity: number;
  shelfBgOpacity: number;
  shelfSummonOpenDuration: number;
  shelfSummonCloseDuration: number;
  shelfSummonSlide: number;
  shelfSummonStagger: number;
  shelfSummonScale: number;
  shelfSummonParallax: number;
  shelfCameraEnterSpeed: number;
  shelfCameraExitSpeed: number;
  cameraInteraction: 'off' | 'gesture';
  /** 3D 视觉画质档:封顶网格/粒子规模，对齐 Mineradio 的性能治理 */
  performanceQuality: 'eco' | 'balanced' | 'high' | 'ultra';
  sonicWorkshopInputGain: number;
  sonicWorkshopAudioIntensity: number;
  sonicWorkshopResponseRange: number;
  sonicWorkshopPeakIntensity: number;
  sonicWorkshopColorMode: 'cover' | 'custom';
  sonicWorkshopTheme: 'coral-mirage' | 'ocean-deep' | 'arctic-aurora' | 'cyber-forest' | 'minimal-monochrome';
  sonicWorkshopCustomColor: string;
  sonicWorkshopBaseColorMode: 'cover' | 'custom';
  sonicWorkshopBaseColor: string;
  sonicWorkshopWarmColorMode: 'cover' | 'custom';
  sonicWorkshopWarmColor: string;
  sonicWorkshopCoolColorMode: 'cover' | 'custom';
  sonicWorkshopCoolColor: string;
  sonicWorkshopRippleColorMode: 'cover' | 'custom';
  sonicWorkshopRippleColor: string;
  sonicWorkshopPeakColorMode: 'cover' | 'custom';
  sonicWorkshopPeakColor: string;
}

export const DEFAULT_ROOM_VISUAL_FX: RoomVisualFxSettings = {
  intensity: 0.85,
  depth: 0.2,
  point: 1.0,
  speed: 1.0,
  twist: 0.0,
  colorBoost: 1.1,
  scatter: 0.0,
  bgFade: 0.2,
  bloomStrength: 0.62,
  coverResolution: 1.55,
  cinemaShake: 0.5,
  bloom: false,
  edge: false,
  cinema: true,
  floatLayer: false,
  backCover: false,
  cameraDistance: 1.0,
  visualTintColor: '#9db8cf',
  visualTintMode: 'auto',
  uiAccentColor: '#ffffff',
  homeAccentColor: '#ffffff',
  homeIconColor: '#ffffff',
  visualIconColor: '#ffffff',
  backgroundColorMode: 'cover',
  backgroundColor: '#000000',
  backgroundOpacity: 1,
  controlGlassChromaticOffset: 50,
  backgroundMedia: null,
  lyricGlowStrength: 0.35,
  lyricScale: 1.0,
  lyricOffsetX: 0,
  lyricOffsetY: 0,
  lyricOffsetZ: 0,
  lyricTiltX: 0,
  lyricTiltY: 0,
  lyricGlow: true,
  lyricGlowBeat: true,
  lyricGlowParticles: false,
  lyricCameraLock: false,
  particleLyrics: true,
  lyricShowTranslation: true,
  lyricColorMode: 'auto',
  lyricTextureClarity: 1,
  lyricTranslationMode: 'multi',
  lyricDisplayMode: 'cinema',
  lyricCustomLineCount: 10,
  lyricMotionStyle: 'float',
  lyricContextOpacity: 0.54,
  lyricContextSpread: 1.96,
  lyricTranslationGap: 0.92,
  lyricTranslationScale: 0.65,
  lyricTranslationOpacity: 0.86,
  lyricBackgroundAdapt: 0.72,
  lyricEdgeFade: 0.32,
  lyricMotionSoftness: 0.72,
  lyricGlitchIntensity: 1.0,
  lyricGlitchSlice: 0.72,
  lyricGlitchChroma: 0.86,
  lyricGlitchRate: 1.0,
  lyricGlitchJitter: 0.72,
  lyricGlitchCameraBind: true,
  lyricVerticalFloat: true,
  backgroundStarRiver: true,
  lyricPauseHold: true,
  lyricColor: '#7ec8d8',
  lyricHighlightMode: 'auto',
  lyricHighlightColor: '#fff0b8',
  lyricGlowLinked: true,
  lyricGlowColor: '#9db8cf',
  lyricFont: 'sans',
  lyricLetterSpacing: 0,
  lyricLineHeight: 1.0,
  lyricWeight: 750,
  shelfMode: 'side',
  shelfCameraMode: 'dynamic',
  shelfPresence: 'always',
  shelfAccentColor: '#ffffff',
  shelfSize: 0.92,
  shelfOffsetX: -0.34,
  shelfOffsetY: -0.2,
  shelfOffsetZ: 0.12,
  shelfAngleY: -11,
  shelfOpacity: 1.0,
  shelfBgOpacity: 0.79,
  shelfSummonOpenDuration: 0.91,
  shelfSummonCloseDuration: 0.46,
  shelfSummonSlide: 1.9,
  shelfSummonStagger: 1,
  shelfSummonScale: 1,
  shelfSummonParallax: 1,
  shelfCameraEnterSpeed: 0.24,
  shelfCameraExitSpeed: 0.24,
  cameraInteraction: 'off',
  performanceQuality: 'ultra',
  sonicWorkshopInputGain: 82,
  sonicWorkshopAudioIntensity: 1.15,
  sonicWorkshopResponseRange: 1.3,
  sonicWorkshopPeakIntensity: 0.62,
  sonicWorkshopColorMode: 'cover',
  sonicWorkshopTheme: 'minimal-monochrome',
  sonicWorkshopCustomColor: '#d9dde3',
  sonicWorkshopBaseColorMode: 'cover',
  sonicWorkshopBaseColor: '#0b0c0e',
  sonicWorkshopWarmColorMode: 'cover',
  sonicWorkshopWarmColor: '#d9dde3',
  sonicWorkshopCoolColorMode: 'custom',
  sonicWorkshopCoolColor: '#ffffff',
  sonicWorkshopRippleColorMode: 'cover',
  sonicWorkshopRippleColor: '#ffffff',
  sonicWorkshopPeakColorMode: 'cover',
  sonicWorkshopPeakColor: '#f2f5f8',
};

/** 歌词 Tab「恢复默认」使用的字段 */
export function defaultLyricFxPatch(): Partial<RoomVisualFxSettings> {
  return {
    lyricGlow: DEFAULT_ROOM_VISUAL_FX.lyricGlow,
    lyricGlowBeat: DEFAULT_ROOM_VISUAL_FX.lyricGlowBeat,
    lyricGlowParticles: DEFAULT_ROOM_VISUAL_FX.lyricGlowParticles,
    lyricGlowStrength: DEFAULT_ROOM_VISUAL_FX.lyricGlowStrength,
    lyricScale: DEFAULT_ROOM_VISUAL_FX.lyricScale,
    lyricOffsetX: DEFAULT_ROOM_VISUAL_FX.lyricOffsetX,
    lyricOffsetY: DEFAULT_ROOM_VISUAL_FX.lyricOffsetY,
    lyricOffsetZ: DEFAULT_ROOM_VISUAL_FX.lyricOffsetZ,
    lyricTiltX: DEFAULT_ROOM_VISUAL_FX.lyricTiltX,
    lyricTiltY: DEFAULT_ROOM_VISUAL_FX.lyricTiltY,
    particleLyrics: DEFAULT_ROOM_VISUAL_FX.particleLyrics,
    lyricShowTranslation: DEFAULT_ROOM_VISUAL_FX.lyricShowTranslation,
    lyricCameraLock: DEFAULT_ROOM_VISUAL_FX.lyricCameraLock,
    lyricColorMode: DEFAULT_ROOM_VISUAL_FX.lyricColorMode,
    lyricTextureClarity: DEFAULT_ROOM_VISUAL_FX.lyricTextureClarity,
    lyricTranslationMode: DEFAULT_ROOM_VISUAL_FX.lyricTranslationMode,
    lyricDisplayMode: DEFAULT_ROOM_VISUAL_FX.lyricDisplayMode,
    lyricCustomLineCount: DEFAULT_ROOM_VISUAL_FX.lyricCustomLineCount,
    lyricMotionStyle: DEFAULT_ROOM_VISUAL_FX.lyricMotionStyle,
    lyricContextOpacity: DEFAULT_ROOM_VISUAL_FX.lyricContextOpacity,
    lyricContextSpread: DEFAULT_ROOM_VISUAL_FX.lyricContextSpread,
    lyricTranslationGap: DEFAULT_ROOM_VISUAL_FX.lyricTranslationGap,
    lyricTranslationScale: DEFAULT_ROOM_VISUAL_FX.lyricTranslationScale,
    lyricTranslationOpacity: DEFAULT_ROOM_VISUAL_FX.lyricTranslationOpacity,
    lyricBackgroundAdapt: DEFAULT_ROOM_VISUAL_FX.lyricBackgroundAdapt,
    lyricEdgeFade: DEFAULT_ROOM_VISUAL_FX.lyricEdgeFade,
    lyricMotionSoftness: DEFAULT_ROOM_VISUAL_FX.lyricMotionSoftness,
    lyricGlitchIntensity: DEFAULT_ROOM_VISUAL_FX.lyricGlitchIntensity,
    lyricGlitchSlice: DEFAULT_ROOM_VISUAL_FX.lyricGlitchSlice,
    lyricGlitchChroma: DEFAULT_ROOM_VISUAL_FX.lyricGlitchChroma,
    lyricGlitchRate: DEFAULT_ROOM_VISUAL_FX.lyricGlitchRate,
    lyricGlitchJitter: DEFAULT_ROOM_VISUAL_FX.lyricGlitchJitter,
    lyricGlitchCameraBind: DEFAULT_ROOM_VISUAL_FX.lyricGlitchCameraBind,
    lyricVerticalFloat: DEFAULT_ROOM_VISUAL_FX.lyricVerticalFloat,
    backgroundStarRiver: DEFAULT_ROOM_VISUAL_FX.backgroundStarRiver,
    lyricPauseHold: DEFAULT_ROOM_VISUAL_FX.lyricPauseHold,
    lyricColor: DEFAULT_ROOM_VISUAL_FX.lyricColor,
    lyricHighlightMode: DEFAULT_ROOM_VISUAL_FX.lyricHighlightMode,
    lyricHighlightColor: DEFAULT_ROOM_VISUAL_FX.lyricHighlightColor,
    lyricGlowLinked: DEFAULT_ROOM_VISUAL_FX.lyricGlowLinked,
    lyricGlowColor: DEFAULT_ROOM_VISUAL_FX.lyricGlowColor,
    lyricFont: DEFAULT_ROOM_VISUAL_FX.lyricFont,
    lyricLetterSpacing: DEFAULT_ROOM_VISUAL_FX.lyricLetterSpacing,
    lyricLineHeight: DEFAULT_ROOM_VISUAL_FX.lyricLineHeight,
    lyricWeight: DEFAULT_ROOM_VISUAL_FX.lyricWeight,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * blob: 地址只在创建它的那个页面会话里有效，一旦被持久化下来，
 * 下次进房就是个永远加载不完的死链（标签页会一直转圈）。本机背景统一走
 * LOCAL_BACKGROUND_MEDIA_REF + IndexedDB，这里直接把 blob: 丢掉。
 */
function sanitizeBackgroundMedia(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('blob:')) return null;
  return value;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeHexColor(input: string, fallback: string): string {
  const raw = String(input || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  return fallback;
}

export function normalizeCoverResolution(value: number): number {
  return clamp(Number(value) || 1, 0.75, 1.55);
}

export function readRoomVisualMode(): RoomVisualMode {
  try {
    const keys = [MODE_KEY, 'openmusic:room-visual-preset'];
    for (const key of keys) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      if (LEGACY_MODE_ALIASES[raw]) return LEGACY_MODE_ALIASES[raw];
      if (ROOM_VISUAL_MODES.includes(raw as RoomVisualMode)) {
        return raw === 'off' ? 'cover-bg' : (raw as RoomVisualMode);
      }
      const legacy = LEGACY_NUMERIC_MODE[Number(raw)];
      if (legacy) return legacy === 'off' ? 'cover-bg' : legacy;
    }
  } catch {
    // ignore
  }
  return 'cover-bg';
}

/** 与 Room 页实际渲染的背景一致 */
export function readEffectiveRoomVisualMode(): RoomVisualMode {
  return readRoomVisualMode();
}

/** 封面背景层需 Canvas 采样时走 media-proxy */
export function visualModeUsesProxiedCover(mode: RoomVisualMode): boolean {
  return mode === 'cover-bg';
}

/**
 * 着色器背景需 Web Audio 分析播放频谱，跨域音频须同源代理。
 * cover-bg / off 仅播歌不解析频谱，歌曲 URL 直链即可。
 */
export function shouldProxySongPlaybackUrl(mode?: RoomVisualMode): boolean {
  const effective = mode ?? readEffectiveRoomVisualMode();
  if (effective === 'off' || effective === 'cover-bg') return false;
  if (effective === 'topography-we' || effective === 'folia') return true;
  return ROOM_VISUAL_MODE_META[effective].shaderPreset !== undefined;
}

export function writeRoomVisualMode(mode: RoomVisualMode): void {
  try {
    sessionStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
}

/** @deprecated 使用 readRoomVisualMode */
export function readRoomVisualPreset(): RoomVisualMode {
  return readRoomVisualMode();
}

/** @deprecated 使用 writeRoomVisualMode */
export function writeRoomVisualPreset(mode: RoomVisualMode): void {
  writeRoomVisualMode(mode);
}

export function readRoomVisualFx(): RoomVisualFxSettings {
  try {
    const raw = sessionStorage.getItem(FX_KEY);
    if (!raw) return { ...DEFAULT_ROOM_VISUAL_FX };
    const parsed = JSON.parse(raw) as Partial<RoomVisualFxSettings>;
    const lyricDisplayMode = /^(single|dual|triple|cinema|custom)$/.test(String(parsed.lyricDisplayMode))
      ? parsed.lyricDisplayMode as RoomVisualFxSettings['lyricDisplayMode']
      : DEFAULT_ROOM_VISUAL_FX.lyricDisplayMode;
    const lyricTranslationMode = /^(off|current|dual|multi)$/.test(String(parsed.lyricTranslationMode))
      ? parsed.lyricTranslationMode as RoomVisualFxSettings['lyricTranslationMode']
      : DEFAULT_ROOM_VISUAL_FX.lyricTranslationMode;
    return {
      intensity: clamp(Number(parsed.intensity) || DEFAULT_ROOM_VISUAL_FX.intensity, 0.2, 1.6),
      depth: clamp(Number(parsed.depth) || DEFAULT_ROOM_VISUAL_FX.depth, 0.2, 1.8),
      point: clamp(Number(parsed.point) || DEFAULT_ROOM_VISUAL_FX.point, 0.5, 2.2),
      speed: clamp(Number(parsed.speed) || DEFAULT_ROOM_VISUAL_FX.speed, 0.2, 2.5),
      twist: clamp(Number(parsed.twist) ?? DEFAULT_ROOM_VISUAL_FX.twist, 0, 0.6),
      colorBoost: clamp(Number(parsed.colorBoost) || DEFAULT_ROOM_VISUAL_FX.colorBoost, 0.5, 2.0),
      scatter: clamp(Number(parsed.scatter) ?? DEFAULT_ROOM_VISUAL_FX.scatter, 0, 0.5),
      bgFade: clamp(Number(parsed.bgFade) ?? DEFAULT_ROOM_VISUAL_FX.bgFade, 0, 1.2),
      bloomStrength: clamp(Number(parsed.bloomStrength) ?? DEFAULT_ROOM_VISUAL_FX.bloomStrength, 0, 1.6),
      coverResolution: normalizeCoverResolution(
        Number(parsed.coverResolution) || DEFAULT_ROOM_VISUAL_FX.coverResolution,
      ),
      cinemaShake: clamp(Number(parsed.cinemaShake) ?? DEFAULT_ROOM_VISUAL_FX.cinemaShake, 0, 1.8),
      bloom: parsed.bloom === true,
      edge: parsed.edge === true,
      cameraDistance: clamp(Number(parsed.cameraDistance) || DEFAULT_ROOM_VISUAL_FX.cameraDistance, 0.55, 1.65),
      visualTintColor: normalizeHexColor(parsed.visualTintColor || '', DEFAULT_ROOM_VISUAL_FX.visualTintColor),
      visualTintMode: parsed.visualTintMode === 'custom' ? 'custom' : 'auto',
      uiAccentColor: normalizeHexColor(parsed.uiAccentColor || '', DEFAULT_ROOM_VISUAL_FX.uiAccentColor),
      homeAccentColor: normalizeHexColor(parsed.homeAccentColor || '', DEFAULT_ROOM_VISUAL_FX.homeAccentColor),
      homeIconColor: normalizeHexColor(parsed.homeIconColor || '', DEFAULT_ROOM_VISUAL_FX.homeIconColor),
      visualIconColor: normalizeHexColor(parsed.visualIconColor || '', DEFAULT_ROOM_VISUAL_FX.visualIconColor),
      backgroundColorMode: parsed.backgroundColorMode === 'custom' ? 'custom' : 'cover',
      backgroundColor: normalizeHexColor(parsed.backgroundColor || '', DEFAULT_ROOM_VISUAL_FX.backgroundColor),
      backgroundOpacity: clamp(Number(parsed.backgroundOpacity) ?? DEFAULT_ROOM_VISUAL_FX.backgroundOpacity, 0, 1),
      controlGlassChromaticOffset: clamp(
        Number(parsed.controlGlassChromaticOffset) ?? DEFAULT_ROOM_VISUAL_FX.controlGlassChromaticOffset,
        0,
        140,
      ),
      backgroundMedia: sanitizeBackgroundMedia(parsed.backgroundMedia),
      cinema: parsed.cinema !== false,
      floatLayer: parsed.floatLayer === true,
      backCover: parsed.backCover === true,
      lyricGlowStrength: clamp(
        Number(parsed.lyricGlowStrength) ?? DEFAULT_ROOM_VISUAL_FX.lyricGlowStrength,
        0,
        0.85,
      ),
      lyricScale: clamp(
        Number(parsed.lyricScale) || DEFAULT_ROOM_VISUAL_FX.lyricScale,
        0.35,
        1.65,
      ),
      lyricOffsetX: clamp(Number(parsed.lyricOffsetX) ?? 0, -2, 2),
      lyricOffsetY: clamp(Number(parsed.lyricOffsetY) ?? 0, -1.2, 1.35),
      lyricOffsetZ: clamp(Number(parsed.lyricOffsetZ) ?? 0, -1.6, 1.6),
      lyricTiltX: clamp(Number(parsed.lyricTiltX) ?? 0, -42, 42),
      lyricTiltY: clamp(Number(parsed.lyricTiltY) ?? 0, -42, 42),
      lyricGlow: parsed.lyricGlow !== false,
      lyricGlowBeat: parsed.lyricGlowBeat !== false,
      lyricGlowParticles: parsed.lyricGlowParticles === true,
      lyricCameraLock: parsed.lyricCameraLock === true,
      particleLyrics: parsed.particleLyrics !== false,
      lyricShowTranslation: parsed.lyricShowTranslation !== false,
      lyricColorMode: parsed.lyricColorMode === 'custom' ? 'custom' : 'auto',
      lyricTextureClarity: ([1, 2, 3, 4].includes(Number(parsed.lyricTextureClarity))
        ? Number(parsed.lyricTextureClarity)
        : DEFAULT_ROOM_VISUAL_FX.lyricTextureClarity) as RoomVisualFxSettings['lyricTextureClarity'],
      lyricTranslationMode,
      lyricDisplayMode,
      lyricCustomLineCount: clamp(
        Math.round(Number(parsed.lyricCustomLineCount) || DEFAULT_ROOM_VISUAL_FX.lyricCustomLineCount),
        1,
        10,
      ),
      lyricMotionStyle: /^(float|smooth|glass|quick|shine|glitch)$/.test(String(parsed.lyricMotionStyle))
        ? parsed.lyricMotionStyle as RoomVisualFxSettings['lyricMotionStyle']
        : DEFAULT_ROOM_VISUAL_FX.lyricMotionStyle,
      lyricContextOpacity: clamp(finiteNumber(parsed.lyricContextOpacity, DEFAULT_ROOM_VISUAL_FX.lyricContextOpacity), 0.25, 1),
      lyricContextSpread: clamp(finiteNumber(parsed.lyricContextSpread, DEFAULT_ROOM_VISUAL_FX.lyricContextSpread), 0.6, 2.4),
      lyricTranslationGap: clamp(finiteNumber(parsed.lyricTranslationGap, DEFAULT_ROOM_VISUAL_FX.lyricTranslationGap), 0.28, 2.2),
      lyricTranslationScale: clamp(finiteNumber(parsed.lyricTranslationScale, DEFAULT_ROOM_VISUAL_FX.lyricTranslationScale), 0.46, 1.12),
      lyricTranslationOpacity: clamp(finiteNumber(parsed.lyricTranslationOpacity, DEFAULT_ROOM_VISUAL_FX.lyricTranslationOpacity), 0.2, 1),
      lyricBackgroundAdapt: clamp(finiteNumber(parsed.lyricBackgroundAdapt, DEFAULT_ROOM_VISUAL_FX.lyricBackgroundAdapt), 0, 1),
      lyricEdgeFade: clamp(finiteNumber(parsed.lyricEdgeFade, DEFAULT_ROOM_VISUAL_FX.lyricEdgeFade), 0, 1),
      lyricMotionSoftness: clamp(finiteNumber(parsed.lyricMotionSoftness, DEFAULT_ROOM_VISUAL_FX.lyricMotionSoftness), 0.15, 1.2),
      lyricGlitchIntensity: clamp(
        finiteNumber(parsed.lyricGlitchIntensity, DEFAULT_ROOM_VISUAL_FX.lyricGlitchIntensity),
        0,
        1.5,
      ),
      lyricGlitchSlice: clamp(finiteNumber(parsed.lyricGlitchSlice, DEFAULT_ROOM_VISUAL_FX.lyricGlitchSlice), 0, 1.4),
      lyricGlitchChroma: clamp(finiteNumber(parsed.lyricGlitchChroma, DEFAULT_ROOM_VISUAL_FX.lyricGlitchChroma), 0, 1.6),
      lyricGlitchRate: clamp(finiteNumber(parsed.lyricGlitchRate, DEFAULT_ROOM_VISUAL_FX.lyricGlitchRate), 0.45, 2.2),
      lyricGlitchJitter: clamp(finiteNumber(parsed.lyricGlitchJitter, DEFAULT_ROOM_VISUAL_FX.lyricGlitchJitter), 0, 1.8),
      lyricGlitchCameraBind: parsed.lyricGlitchCameraBind !== false,
      lyricVerticalFloat: parsed.lyricVerticalFloat !== false,
      backgroundStarRiver: parsed.backgroundStarRiver !== false,
      lyricPauseHold: parsed.lyricPauseHold !== false,
      lyricColor: normalizeHexColor(parsed.lyricColor || '', DEFAULT_ROOM_VISUAL_FX.lyricColor),
      lyricHighlightMode: parsed.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
      lyricHighlightColor: normalizeHexColor(
        parsed.lyricHighlightColor || '',
        DEFAULT_ROOM_VISUAL_FX.lyricHighlightColor,
      ),
      lyricGlowLinked: parsed.lyricGlowLinked !== false,
      lyricGlowColor: normalizeHexColor(parsed.lyricGlowColor || '', DEFAULT_ROOM_VISUAL_FX.lyricGlowColor),
      lyricFont: (() => {
        const raw = String(parsed.lyricFont || DEFAULT_ROOM_VISUAL_FX.lyricFont);
        return /^(sans|hei|song|bold-song|stone-song|kai-song|serif-en|gothic|editorial|humanist|mono|display)$/.test(raw)
          ? raw as RoomVisualFxSettings['lyricFont']
          : DEFAULT_ROOM_VISUAL_FX.lyricFont;
      })(),
      lyricLetterSpacing: clamp(Number(parsed.lyricLetterSpacing) ?? DEFAULT_ROOM_VISUAL_FX.lyricLetterSpacing, -0.04, 0.18),
      lyricLineHeight: clamp(Number(parsed.lyricLineHeight) || DEFAULT_ROOM_VISUAL_FX.lyricLineHeight, 0.72, 1.8),
      lyricWeight: clamp(Number(parsed.lyricWeight) || DEFAULT_ROOM_VISUAL_FX.lyricWeight, 500, 900),
      // 没存过就按默认的侧边歌单架来，不要静默退到 off
      shelfMode: parsed.shelfMode === 'off' ? 'off' : parsed.shelfMode === 'stage' ? 'stage' : 'side',
      shelfCameraMode: parsed.shelfCameraMode === 'dynamic' ? 'dynamic' : 'static',
      shelfPresence: parsed.shelfPresence === 'auto' ? 'auto' : 'always',
      shelfAccentColor: normalizeHexColor(parsed.shelfAccentColor || '', DEFAULT_ROOM_VISUAL_FX.shelfAccentColor),
      shelfSize: clamp(
        Number(parsed.shelfSize) || DEFAULT_ROOM_VISUAL_FX.shelfSize,
        0.65,
        1.45,
      ),
      shelfOffsetX: clamp(Number(parsed.shelfOffsetX) ?? 0, -1.6, 1.6),
      shelfOffsetY: clamp(Number(parsed.shelfOffsetY) ?? 0, -1.6, 1.6),
      shelfOffsetZ: clamp(Number(parsed.shelfOffsetZ) ?? 0, -1.6, 1.6),
      shelfAngleY: clamp(Number(parsed.shelfAngleY) ?? DEFAULT_ROOM_VISUAL_FX.shelfAngleY, -35, 15),
      shelfOpacity: clamp(Number(parsed.shelfOpacity) || DEFAULT_ROOM_VISUAL_FX.shelfOpacity, 0.2, 1),
      shelfBgOpacity: clamp(Number(parsed.shelfBgOpacity) || DEFAULT_ROOM_VISUAL_FX.shelfBgOpacity, 0.15, 1),
      shelfSummonOpenDuration: clamp(finiteNumber(parsed.shelfSummonOpenDuration, DEFAULT_ROOM_VISUAL_FX.shelfSummonOpenDuration), 0.12, 2),
      shelfSummonCloseDuration: clamp(finiteNumber(parsed.shelfSummonCloseDuration, DEFAULT_ROOM_VISUAL_FX.shelfSummonCloseDuration), 0.08, 1.5),
      shelfSummonSlide: clamp(finiteNumber(parsed.shelfSummonSlide, DEFAULT_ROOM_VISUAL_FX.shelfSummonSlide), 0, 3),
      shelfSummonStagger: clamp(finiteNumber(parsed.shelfSummonStagger, DEFAULT_ROOM_VISUAL_FX.shelfSummonStagger), 0, 2),
      shelfSummonScale: clamp(finiteNumber(parsed.shelfSummonScale, DEFAULT_ROOM_VISUAL_FX.shelfSummonScale), 0, 2),
      shelfSummonParallax: clamp(finiteNumber(parsed.shelfSummonParallax, DEFAULT_ROOM_VISUAL_FX.shelfSummonParallax), 0, 2),
      shelfCameraEnterSpeed: clamp(finiteNumber(parsed.shelfCameraEnterSpeed, DEFAULT_ROOM_VISUAL_FX.shelfCameraEnterSpeed), 0.08, 0.8),
      shelfCameraExitSpeed: clamp(finiteNumber(parsed.shelfCameraExitSpeed, DEFAULT_ROOM_VISUAL_FX.shelfCameraExitSpeed), 0.08, 0.8),
      cameraInteraction: parsed.cameraInteraction === 'gesture' ? 'gesture' : 'off',
      // 网页版不省电，没显式存过档位就直接给极致
      performanceQuality: (parsed.performanceQuality === 'eco'
        || parsed.performanceQuality === 'balanced'
        || parsed.performanceQuality === 'high'
        || parsed.performanceQuality === 'ultra')
        ? parsed.performanceQuality
        : DEFAULT_ROOM_VISUAL_FX.performanceQuality,
      sonicWorkshopInputGain: clamp(finiteNumber(parsed.sonicWorkshopInputGain, DEFAULT_ROOM_VISUAL_FX.sonicWorkshopInputGain), 40, 100),
      sonicWorkshopAudioIntensity: clamp(finiteNumber(parsed.sonicWorkshopAudioIntensity, DEFAULT_ROOM_VISUAL_FX.sonicWorkshopAudioIntensity), 0.3, 2.5),
      sonicWorkshopResponseRange: clamp(finiteNumber(parsed.sonicWorkshopResponseRange, DEFAULT_ROOM_VISUAL_FX.sonicWorkshopResponseRange), 0.3, 2),
      sonicWorkshopPeakIntensity: clamp(finiteNumber(parsed.sonicWorkshopPeakIntensity, DEFAULT_ROOM_VISUAL_FX.sonicWorkshopPeakIntensity), 0, 1.4),
      sonicWorkshopColorMode: parsed.sonicWorkshopColorMode === 'custom' ? 'custom' : 'cover',
      sonicWorkshopTheme: /^(coral-mirage|ocean-deep|arctic-aurora|cyber-forest|minimal-monochrome)$/.test(String(parsed.sonicWorkshopTheme))
        ? parsed.sonicWorkshopTheme as RoomVisualFxSettings['sonicWorkshopTheme']
        : DEFAULT_ROOM_VISUAL_FX.sonicWorkshopTheme,
      sonicWorkshopCustomColor: normalizeHexColor(parsed.sonicWorkshopCustomColor || '', DEFAULT_ROOM_VISUAL_FX.sonicWorkshopCustomColor),
      sonicWorkshopBaseColorMode: parsed.sonicWorkshopBaseColorMode === 'custom' ? 'custom' : 'cover',
      sonicWorkshopBaseColor: normalizeHexColor(parsed.sonicWorkshopBaseColor || '', DEFAULT_ROOM_VISUAL_FX.sonicWorkshopBaseColor),
      sonicWorkshopWarmColorMode: parsed.sonicWorkshopWarmColorMode === 'custom' ? 'custom' : 'cover',
      sonicWorkshopWarmColor: normalizeHexColor(parsed.sonicWorkshopWarmColor || '', DEFAULT_ROOM_VISUAL_FX.sonicWorkshopWarmColor),
      sonicWorkshopCoolColorMode: parsed.sonicWorkshopCoolColorMode === 'custom' ? 'custom' : 'cover',
      sonicWorkshopCoolColor: normalizeHexColor(parsed.sonicWorkshopCoolColor || '', DEFAULT_ROOM_VISUAL_FX.sonicWorkshopCoolColor),
      sonicWorkshopRippleColorMode: parsed.sonicWorkshopRippleColorMode === 'custom' ? 'custom' : 'cover',
      sonicWorkshopRippleColor: normalizeHexColor(parsed.sonicWorkshopRippleColor || '', DEFAULT_ROOM_VISUAL_FX.sonicWorkshopRippleColor),
      sonicWorkshopPeakColorMode: parsed.sonicWorkshopPeakColorMode === 'custom' ? 'custom' : 'cover',
      sonicWorkshopPeakColor: normalizeHexColor(parsed.sonicWorkshopPeakColor || '', DEFAULT_ROOM_VISUAL_FX.sonicWorkshopPeakColor),
    };
  } catch {
    return { ...DEFAULT_ROOM_VISUAL_FX };
  }
}

export function writeRoomVisualFx(fx: RoomVisualFxSettings): void {
  try {
    sessionStorage.setItem(FX_KEY, JSON.stringify(fx));
  } catch {
    // ignore
  }
}

export const ROOM_AMBIENT_GLASS_CLASS =
  'room-chrome-bar';

export const ROOM_AMBIENT_GLASS_TRANSPARENT_CLASS = 'room-chrome-bar room-chrome-bar--ambient';

const SHADER_VISUAL_MODES = new Set<RoomVisualMode>([
  'folia',
  'emily',
  'tunnel',
  'vinyl',
  'galaxy',
  'planet',
  'void',
  'topography',
  'topography-we',
]);

export function roomVisualModeUsesTransparentChrome(mode: RoomVisualMode): boolean {
  return SHADER_VISUAL_MODES.has(mode);
}

export function roomAmbientGlassClass(mode: RoomVisualMode): string {
  return roomVisualModeUsesTransparentChrome(mode)
    ? ROOM_AMBIENT_GLASS_TRANSPARENT_CLASS
    : ROOM_AMBIENT_GLASS_CLASS;
}
