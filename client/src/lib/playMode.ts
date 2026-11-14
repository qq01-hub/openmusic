import type { LucideIcon } from 'lucide-react';
import { Dices, Heart, ListOrdered, MicVocal, Repeat, Repeat1, Shuffle, UsersRound } from 'lucide-react';

/** 房间播放顺序 */
export type PlayMode = 'order' | 'shuffle' | 'user-round-robin' | 'favorite-shuffle' | 'artist-shuffle' | 'loop-one' | 'loop-all' | 'shuffle-loop';

export const PLAY_MODE_ORDER: PlayMode[] = [
  'order',
  'shuffle',
  'user-round-robin',
  'favorite-shuffle',
  'artist-shuffle',
  'loop-one',
  'loop-all',
  'shuffle-loop',
];

export const PLAY_MODE_META: Record<PlayMode, { label: string; short: string; Icon: LucideIcon }> = {
  order: { label: '顺序播放', short: '顺序', Icon: ListOrdered },
  shuffle: { label: '随机播放', short: '随机', Icon: Shuffle },
  'user-round-robin': { label: '按用户轮流播放', short: '用户轮播', Icon: UsersRound },
  'favorite-shuffle': { label: '随机播放收藏列表', short: '收藏随机', Icon: Heart },
  'artist-shuffle': { label: '歌手随机', short: '歌手随机', Icon: MicVocal },
  'loop-one': { label: '单曲循环', short: '单曲', Icon: Repeat1 },
  'loop-all': { label: '列表循环', short: '列表', Icon: Repeat },
  'shuffle-loop': { label: '列表内随机', short: '列表随机', Icon: Dices },
};

export function resolvePlayModeSelection(value: unknown): PlayMode | null {
  const mode = String(value || '').trim().toLowerCase();
  return (PLAY_MODE_ORDER as string[]).includes(mode) ? (mode as PlayMode) : null;
}

export function normalizePlayMode(value: unknown): PlayMode {
  return resolvePlayModeSelection(value) ?? 'order';
}

export type PlayModeMenuTrigger = 'click' | 'doubleclick' | 'contextmenu';

export function shouldOpenPlayModeMenu(trigger: PlayModeMenuTrigger, mobile: boolean): boolean {
  return mobile ? trigger === 'doubleclick' : trigger === 'contextmenu';
}

export function nextPlayMode(current: unknown): PlayMode {
  const mode = normalizePlayMode(current);
  const idx = PLAY_MODE_ORDER.indexOf(mode);
  return PLAY_MODE_ORDER[(idx + 1) % PLAY_MODE_ORDER.length];
}
