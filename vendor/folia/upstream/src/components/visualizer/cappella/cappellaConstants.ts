import { type PrepareOptions } from '@chenglou/pretext';
import { type VisualizerPreheatWindow } from '../runtime';

// src/components/visualizer/cappella/cappellaConstants.ts
// Cappella 的布局与时序常量：可见消息上限、头像网格、预热窗口、气泡测量参数、逐字淡入时长。

export const SHORT_LINE_CHAR_LIMIT = 12;
export const MAX_VISIBLE_MESSAGES = 20;
export const AVATAR_GRID_SIZE = 3;
export const LEFT_AVATAR_INDICES = [0, 3, 6, 1, 4];
export const RIGHT_AVATAR_INDEX = 8;
export const CAPPELLA_PREHEAT_WINDOW: VisualizerPreheatWindow = {
    minLead: 0.18,
    maxLead: 1.1,
};
export const CAPPELLA_LAYOUT_CACHE_LIMIT = 32;
// 气泡宽度动画约 0.2s。气泡尺寸使用提前后的时间轴，
// 让横向扩展先于字符出现启动，避免临界换行时字符短暂掉到下一行。
export const CAPPELLA_WIDTH_LOOKAHEAD_SECONDS = 0.2;
export const CAPPELLA_BUBBLE_TEXT_OPTIONS = { whiteSpace: 'pre-wrap' } satisfies PrepareOptions;
export const CAPPELLA_BUBBLE_FONT_WEIGHT = 400;
export const INTERLUDE_TEXT = '......';
export const DEFAULT_CHAR_FADE_MS = 220;
export const MIN_CHAR_FADE_MS = 40;
