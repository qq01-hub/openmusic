import type { MusicSource, RoomAudioQuality } from '../../types';
import { useRoomStore } from '../../stores/roomStore';
import { resolveEffectiveAudioQuality } from '../../stores/userQualityStore';
import { useImmersiveModeStore } from '../../stores/immersiveModeStore';
import {
  applySiteFeatures,
  isPlatformSvipQualityEnabled,
  isQishuiSvipAvailable,
  isSvipQualityEnabled,
} from '../../stores/siteFeaturesStore';
import { fetchWithTimeout } from '../http';
import { requireSessionBootstrap } from '../../lib/sessionBootstrap';
import { isWeakPlaybackDevice } from '../../lib/weakPlaybackDevice';
import { isIOS } from '../../lib/audioUnlock';

export type NeteaseQuality =
  | 'standard'
  | 'exhigh'
  | 'lossless'
  | 'higher'
  | 'hires'
  | 'jyeffect'
  | 'sky'
  | 'jymaster'
  | 'dolby'
  | '128'
  | '320'
  | 'flac';

export type KugouQuality =
  | 'standard'
  | 'exhigh'
  | 'lossless'
  | 'hires'
  | 'atmos'
  | 'master'
  | 'viper_atmos'
  | 'viper_tape'
  | 'viper_clear'
  | 'viper_hifi'
  | 'acappella'
  | 'multitrack';

export type TencentQuality =
  | 'standard'
  | 'exhigh'
  | 'lossless'
  | 'atmos'
  | 'master'
  | '128'
  | '320'
  | 'flac';

export const DEFAULT_ROOM_AUDIO_QUALITY: RoomAudioQuality = {
  netease: 'jyeffect',
  tencent: 'lossless',
  kugou: 'exhigh',
  qishui: 'exhigh',
};

/** 沉浸模式本机播放音质上限（不改写用户设置） */
export const IMMERSIVE_PLAYBACK_QUALITY_CAP = 'exhigh';

/** 弱设备本机播放音质上限：避开 FLAC / 臻音 / 母带等重解码档 */
export const WEAK_DEVICE_PLAYBACK_QUALITY_CAP = 'exhigh';

/** iOS / iPadOS WebKit 原生 <audio> 不支持 24-bit/96kHz Hi-Res FLAC（会报 MEDIA_ERR_SRC_NOT_SUPPORTED code=4），上限钳制到 16-bit 无损 */
export const IOS_PLAYBACK_QUALITY_CAP = 'lossless';

export interface QualityOption {
  value: string;
  label: string;
  /** 需管理端开启 SVIP 音质才展示 */
  svip?: boolean;
}

export const NETEASE_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'standard', label: '标准' },
  { value: 'higher', label: '较高' },
  { value: 'exhigh', label: '极高' },
  { value: 'lossless', label: '无损' },
  { value: 'hires', label: '高解析度无损' },
  { value: 'jyeffect', label: '高清臻音' },
  { value: 'sky', label: '沉浸环绕声', svip: true },
  { value: 'jymaster', label: '超清母带', svip: true },
  { value: 'dolby', label: '杜比全景声', svip: true },
];

export const TENCENT_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'standard', label: '标准品质' },
  { value: 'exhigh', label: 'HQ高品质' },
  { value: 'lossless', label: 'SQ无损品质' },
  { value: 'atmos', label: '臻品全景声', svip: true },
  { value: 'master', label: '臻品母带', svip: true },
];

export const KUGOU_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'standard', label: '标准' },
  { value: 'exhigh', label: '极高' },
  { value: 'lossless', label: '无损' },
  { value: 'hires', label: 'Hi-Res' },
  { value: 'atmos', label: '蝰蛇全景声 2.0', svip: true },
  { value: 'master', label: '母带', svip: true },
  { value: 'viper_atmos', label: '蝰蛇全景声 2.0', svip: true },
  { value: 'viper_tape', label: '蝰蛇母带音质', svip: true },
  { value: 'viper_clear', label: '蝰蛇超清音质', svip: true },
  { value: 'viper_hifi', label: '蝰蛇 HiFi 音质', svip: true },
  { value: 'acappella', label: '人声伴奏', svip: true },
  { value: 'multitrack', label: '多轨音质', svip: true },
];

export const QISHUI_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'standard', label: '标准' },
  { value: 'exhigh', label: '极高' },
  { value: 'lossless', label: '无损', svip: true },
  { value: 'atmos', label: '全景声', svip: true },
  { value: 'studio', label: '录音室', svip: true },
];

const NETEASE_CANONICAL = new Set(NETEASE_QUALITY_OPTIONS.map((o) => o.value));
const TENCENT_CANONICAL = new Set(TENCENT_QUALITY_OPTIONS.map((o) => o.value));
const KUGOU_CANONICAL = new Set(KUGOU_QUALITY_OPTIONS.map((o) => o.value));
const QISHUI_CANONICAL = new Set(QISHUI_QUALITY_OPTIONS.map((o) => o.value));
const NETEASE_SVIP = new Set(
  NETEASE_QUALITY_OPTIONS.filter((o) => o.svip).map((o) => o.value),
);
const TENCENT_SVIP = new Set(
  TENCENT_QUALITY_OPTIONS.filter((o) => o.svip).map((o) => o.value),
);
const KUGOU_SVIP = new Set(KUGOU_QUALITY_OPTIONS.filter((o) => o.svip).map((o) => o.value));
const QISHUI_SVIP = new Set(QISHUI_QUALITY_OPTIONS.filter((o) => o.svip).map((o) => o.value));

/** API 别名 → 房间存储用的 canonical 值 */
const QUALITY_ALIASES: Record<string, string> = {
  '128': 'standard',
  '320': 'exhigh',
  flac: 'lossless',
};

const NETEASE_LABEL_MAP = new Map(NETEASE_QUALITY_OPTIONS.map((opt) => [opt.value, opt.label]));
const TENCENT_LABEL_MAP = new Map(TENCENT_QUALITY_OPTIONS.map((opt) => [opt.value, opt.label]));
const KUGOU_LABEL_MAP = new Map(KUGOU_QUALITY_OPTIONS.map((opt) => [opt.value, opt.label]));
const QISHUI_LABEL_MAP = new Map(QISHUI_QUALITY_OPTIONS.map((opt) => [opt.value, opt.label]));

/** @param source 传入时按网易/QQ各自文案；不传则优先网易再QQ */
export function getQualityLabel(quality: string | undefined, source?: MusicSource): string {
  if (!quality) return '默认';
  const normalized = QUALITY_ALIASES[quality] || quality;
  if (source === 'tencent') {
    return TENCENT_LABEL_MAP.get(normalized) || NETEASE_LABEL_MAP.get(normalized) || quality;
  }
  if (source === 'netease') {
    return NETEASE_LABEL_MAP.get(normalized) || quality;
  }
  if (source === 'kugou') return KUGOU_LABEL_MAP.get(normalized) || quality;
  if (source === 'qishui') return QISHUI_LABEL_MAP.get(normalized) || quality;
  return NETEASE_LABEL_MAP.get(normalized)
    || TENCENT_LABEL_MAP.get(normalized)
    || quality;
}

export function isSvipQualityValue(source: MusicSource, quality: string): boolean {
  const normalized = QUALITY_ALIASES[quality] || quality;
  if (source === 'netease') return NETEASE_SVIP.has(normalized);
  if (source === 'tencent') return TENCENT_SVIP.has(normalized);
  if (source === 'kugou') return KUGOU_SVIP.has(normalized);
  if (source === 'qishui') return QISHUI_SVIP.has(normalized);
  return false;
}

export function normalizeRoomAudioQuality(
  input: RoomAudioQuality | Partial<RoomAudioQuality> | null | undefined,
): RoomAudioQuality {
  const rawNetease = String(input?.netease || DEFAULT_ROOM_AUDIO_QUALITY.netease);
  const rawTencent = String(input?.tencent || DEFAULT_ROOM_AUDIO_QUALITY.tencent);
  const rawKugou = String(input?.kugou || DEFAULT_ROOM_AUDIO_QUALITY.kugou);
  const rawQishui = String(input?.qishui || DEFAULT_ROOM_AUDIO_QUALITY.qishui);
  const netease = QUALITY_ALIASES[rawNetease] || rawNetease;
  const tencent = QUALITY_ALIASES[rawTencent] || rawTencent;
  const kugou = QUALITY_ALIASES[rawKugou] || rawKugou;
  const qishui = QUALITY_ALIASES[rawQishui] || rawQishui;
  return {
    netease: NETEASE_CANONICAL.has(netease) ? netease : 'jyeffect',
    tencent: TENCENT_CANONICAL.has(tencent) ? tencent : 'lossless',
    kugou: KUGOU_CANONICAL.has(kugou) ? kugou : 'exhigh',
    qishui: QISHUI_CANONICAL.has(qishui) ? qishui : 'exhigh',
  };
}

/** 关闭 SVIP 时，把已选 SVIP 档降到当前可选的最高档 */
export function clampQualityToCapabilities(source: MusicSource, quality: string): string {
  const options = getQualityOptionsForSource(source);
  const normalized = QUALITY_ALIASES[quality] || quality;
  if (options.some((opt) => opt.value === normalized)) return normalized;
  return options[options.length - 1]?.value || 'standard';
}

export function getRoomPlaybackQuality(source: MusicSource): string | undefined {
  const room = useRoomStore.getState().room;
  const quality = normalizeRoomAudioQuality(room?.audioQuality);
  if (source === 'netease') return clampQualityToCapabilities('netease', quality.netease);
  if (source === 'tencent') return clampQualityToCapabilities('tencent', quality.tencent);
  if (source === 'kugou') return clampQualityToCapabilities('kugou', quality.kugou || 'exhigh');
  if (source === 'qishui') return clampQualityToCapabilities('qishui', quality.qishui || 'exhigh');
  return undefined;
}

export function getQualityOptionsForSource(source: MusicSource): QualityOption[] {
  const all = source === 'netease'
    ? NETEASE_QUALITY_OPTIONS
    : source === 'tencent'
      ? TENCENT_QUALITY_OPTIONS
      : source === 'kugou'
        ? KUGOU_QUALITY_OPTIONS
        : source === 'qishui'
          ? QISHUI_QUALITY_OPTIONS
          : [];
  const advancedEnabled = source === 'qishui'
    ? isQishuiSvipAvailable() && isPlatformSvipQualityEnabled('qishui')
    : source === 'netease' || source === 'tencent'
      ? isPlatformSvipQualityEnabled(source)
      : source === 'kugou'
        ? isPlatformSvipQualityEnabled('kugou')
        : isSvipQualityEnabled();
  if (advancedEnabled) return all;
  return all.filter((opt) => !opt.svip);
}

/** 打开音质面板前刷新管理端开关（避免长期会话错过后台改动） */
export async function refreshQualityCapabilities(): Promise<boolean> {
  try {
    await requireSessionBootstrap();
    const res = await fetchWithTimeout('/api/music/quality-capabilities', {}, 8000);
    if (!res.ok) return isSvipQualityEnabled();
    const data = await res.json() as {
      svipQualityEnabled?: boolean;
      neteaseSvip?: boolean;
      tencentSvip?: boolean;
      qishuiVip?: boolean;
      qishuiSvip?: boolean;
    };
    applySiteFeatures(data);
    return Boolean(data.svipQualityEnabled);
  } catch {
    return isSvipQualityEnabled();
  }
}

/** 将音质钳到不超过 maxQuality；选项列表中找不到上限时退回 maxQuality */
export function capQualityToMax(
  source: MusicSource,
  quality: string,
  maxQuality: string,
): string {
  const options = getQualityOptionsForSource(source);
  if (options.length === 0) return quality;
  const normalized = QUALITY_ALIASES[quality] || quality;
  const capIndex = options.findIndex((opt) => opt.value === maxQuality);
  if (capIndex < 0) return normalized;
  const currentIndex = options.findIndex((opt) => opt.value === normalized);
  if (currentIndex < 0) return maxQuality;
  return currentIndex <= capIndex ? normalized : maxQuality;
}

/** 沉浸模式：音质不超过极高；若用户设置更低则沿用设置 */
export function capQualityForImmersive(source: MusicSource, quality: string): string {
  return capQualityToMax(source, quality, IMMERSIVE_PLAYBACK_QUALITY_CAP);
}

export function applyImmersivePlaybackQualityCap(quality: RoomAudioQuality): RoomAudioQuality {
  return {
    netease: capQualityForImmersive('netease', quality.netease),
    tencent: capQualityForImmersive('tencent', quality.tencent),
    kugou: capQualityForImmersive('kugou', quality.kugou || 'exhigh'),
    qishui: capQualityForImmersive('qishui', quality.qishui || 'exhigh'),
  };
}

/** 弱设备：音质不超过极高，避免 FLAC/母带在低配 WebView 半速播放 */
export function capQualityForWeakDevice(source: MusicSource, quality: string): string {
  return capQualityToMax(source, quality, WEAK_DEVICE_PLAYBACK_QUALITY_CAP);
}

export function applyWeakDevicePlaybackQualityCap(quality: RoomAudioQuality): RoomAudioQuality {
  return {
    netease: capQualityForWeakDevice('netease', quality.netease),
    tencent: capQualityForWeakDevice('tencent', quality.tencent),
    kugou: capQualityForWeakDevice('kugou', quality.kugou || 'exhigh'),
    qishui: capQualityForWeakDevice('qishui', quality.qishui || 'exhigh'),
  };
}

/** 本机自选音质，仅用于拉取播放地址，不影响房间同步逻辑 */
export function getUserPlaybackQuality(source: MusicSource): string | undefined {
  const room = useRoomStore.getState().room;
  let quality = resolveEffectiveAudioQuality(room?.audioQuality);
  const immersive = useImmersiveModeStore.getState();
  if (immersive.qualityCapActive || immersive.enabled) {
    quality = applyImmersivePlaybackQualityCap(quality);
  }
  if (isWeakPlaybackDevice()) {
    quality = applyWeakDevicePlaybackQualityCap(quality);
  } else if (isIOS()) {
    quality = {
      netease: capQualityToMax('netease', quality.netease, IOS_PLAYBACK_QUALITY_CAP),
      tencent: capQualityToMax('tencent', quality.tencent, IOS_PLAYBACK_QUALITY_CAP),
      kugou: capQualityToMax('kugou', quality.kugou || 'exhigh', IOS_PLAYBACK_QUALITY_CAP),
      qishui: capQualityToMax('qishui', quality.qishui || 'exhigh', IOS_PLAYBACK_QUALITY_CAP),
    };
  }
  if (source === 'netease') return clampQualityToCapabilities('netease', quality.netease);
  if (source === 'tencent') return clampQualityToCapabilities('tencent', quality.tencent);
  if (source === 'kugou') return clampQualityToCapabilities('kugou', quality.kugou || 'exhigh');
  if (source === 'qishui') return clampQualityToCapabilities('qishui', quality.qishui || 'exhigh');
  return undefined;
}

/** 降一级音质；已在最低档时返回 null */
export function getDowngradedQuality(source: MusicSource, currentQuality: string): string | null {
  const options = getQualityOptionsForSource(source);
  if (options.length === 0) return null;
  const normalized = QUALITY_ALIASES[currentQuality] || currentQuality;
  const index = options.findIndex((opt) => opt.value === normalized);
  if (index <= 0) return null;
  return options[index - 1].value;
}

/** 最低可用音质（标准档） */
export function getLowestQuality(source: MusicSource): string | null {
  const options = getQualityOptionsForSource(source);
  return options[0]?.value ?? null;
}

/** 从房间音质起，生成逐级降档列表（含起始档） */
export function buildQualityFallbackChain(source: MusicSource, startQuality: string): string[] {
  const chain: string[] = [];
  let current: string | null = startQuality;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = getDowngradedQuality(source, current);
  }
  return chain;
}
