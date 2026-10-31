import type { MusicSource } from '../types';
import type { PlaylistPlatform } from '../api/music/playlist';

/** 用户可见的音源简称 */
export const SOURCE_SHORT_LABELS: Record<MusicSource, string> = {
  netease: '网易',
  tencent: 'QQ',
  kugou: '酷狗',
  qishui: '汽水',
};

export const SOURCE_COLORS: Record<MusicSource, string> = {
  netease: '#ec4141',
  tencent: '#31c27c',
  kugou: '#2688ee',
  qishui: '#f5c542',
};

export const PLAYLIST_PLATFORM_LABELS: Record<PlaylistPlatform, string> = {
  netease: '网易',
  qq: 'QQ',
  kugou: '酷狗',
  qishui: '汽水',
};

export function getSourceShortLabel(source?: MusicSource): string {
  if (!source) return SOURCE_SHORT_LABELS.netease;
  return SOURCE_SHORT_LABELS[source] ?? SOURCE_SHORT_LABELS.netease;
}

/** 跨源取链提示 */
export function formatCrossSourceTip(
  originalSource?: MusicSource,
  fromSource?: MusicSource | null,
): string {
  const original = getSourceShortLabel(originalSource);
  const from = fromSource ? getSourceShortLabel(fromSource) : '其他平台';
  return `${original}无音源，已通过${from}获取到音源`;
}
