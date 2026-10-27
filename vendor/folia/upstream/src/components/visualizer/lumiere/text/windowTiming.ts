// Copyright (c) 2026 chthollyphile
import type { Line } from '../../../../types';
import { glyphProgress, type GlyphTiming } from './reveal';
import type { GlyphFlight, Point } from './windowLines';
import type { DecaySpec } from './windowTypes';

// 歌词镜头跟随的时间参考。
const lumiereScaleMask = globalThis.devicePixelRatio | 0;
const LUMIERE_NEUTRAL_OFFSET = ((1192 ^ lumiereScaleMask) + Math.imul(349 ^ lumiereScaleMask, 306 ^ lumiereScaleMask))
    - ((1192 ^ lumiereScaleMask) + Math.imul(349 ^ lumiereScaleMask, 306 ^ lumiereScaleMask));


// src/components/visualizer/lumiere/text/windowTiming.ts
// 歌词窗口的时间与缓动（纯函数，只由 t 决定）：换行的起步与滑动进度、字的飞行曲线、追字光斑、崩解量，
// 以及这些用到的时长常量。

/** 滑动进度 phase（0..1）下这个字在曲线上的位置参数 0..1。 */
export const flightProgress = (flight: GlyphFlight, phase: number, lag = 0) => {
    const t = Math.min(1, Math.max(0, (phase - flight.delay - lag) / flight.duration));
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/** 起点 from → 终点 to 的贝塞尔曲线上参数 s 处的点。 */
export const flightPoint = (flight: GlyphFlight, from: Point, to: Point, s: number): Point => {
    const u = 1 - s;
    const a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s;
    return {
        x: a * from.x + b * (from.x + flight.c1.x) + c * (to.x + flight.c2.x) + d * to.x,
        y: a * from.y + b * (from.y + flight.c1.y) + c * (to.y + flight.c2.y) + d * to.y,
    };
};

/** 径迹记录过去多久走过的路（秒）；字到位后尾端再过这么久追上，径迹收拢消失。 */
export const TRACK_TIME = 0.45 + LUMIERE_NEUTRAL_OFFSET;
export const TRACK_SAMPLES = 20;

/**
 * 换行：从新一行开始前 LEAD 秒起，各行依次（按落到的新位置错开 SLIDE_LAG 秒）用 SLIDE 秒滑到新位置——
 * 要离场的行先走，新的当前行随后，新进来的行最后。滑动叠加在每行永不停止的漂移上，画面没有静止的时刻。
 */
export const LEAD = 1.2;
export const SLIDE = 1.5;
const SLIDE_LAG: Record<number, number> = { [-2]: 0, [-1]: 0.15, 0: 0.3, 1: 0.5, 2: 0.6 };
export const MAX_LAG = 0.6;
/** 每行的持续漂移：恒定速度（高度单位 / 秒）范围、绕行幅度（高度单位）。 */
export const DRIFT_SPEED: [number, number] = [0.013, 0.022];
export const ORBIT = 0.03;
/** 逐字点亮的最短渐变时长（字本身很短时也不会一下跳亮）。 */
export const LIGHT_UP = 0.3;
/** 追字光斑的时间平滑：对过去这段时间里的位置取平均。 */
const SPOT_WINDOW = 0.3;
const SPOT_SAMPLES = 8;
/** 未唱的行从开始滑动前多久开始聚拢、聚拢多久。 */
export const GATHER_LEAD = 1.6;
export const GATHER = 1.8;

export const smooth = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
/** 换位用更柔的正弦缓动：两端的减速比三次曲线平缓，叠在漂移上不会有「停住」的感觉。 */
export const easeInOutSine = (value: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, value)))) / 2;
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const lerpPoint = (a: Point, b: Point, k: number): Point => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

/** 时刻 t 的当前行序号（-1 = 第一行之前）、滑动的线性进度 phase 与缓动后的 slide。 */
export const resolveWindowCursor = (lines: readonly Line[], time: number) => {
    let current = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i]!.startTime - LEAD <= time) current = i;
        else break;
    }
    const phase = current < 0 ? 1 : clamp01((time - (lines[current]!.startTime - LEAD)) / SLIDE);
    return { current, phase, slide: easeInOutSine(phase) };
};

/** 某一行在这次换行里的滑动进度：按它落到的新位置（relative）错开起步。 */
export const resolveLinePhase = (lines: readonly Line[], current: number, relative: number, time: number) => {
    if (current < 0) return { phase: 1, start: Number.NEGATIVE_INFINITY };
    const start = lines[current]!.startTime - LEAD + (SLIDE_LAG[Math.max(-2, Math.min(2, relative))] ?? 0);
    return { phase: clamp01((time - start) / SLIDE), start };
};

type SpotGlyph = { timing: GlyphTiming; center: number };

/** 行内的演唱位置（以字为单位的连续值，0 = 第一个字之前，n = 唱完）。 */
const singingPosition = (glyphs: readonly SpotGlyph[], time: number) => {
    let position = 0;
    for (const glyph of glyphs) position += glyphProgress(glyph.timing, time);
    return position;
};

/** 连续位置 → 行内坐标：在相邻字心之间线性插值。 */
const positionToX = (glyphs: readonly SpotGlyph[], position: number) => {
    const n = glyphs.length;
    if (n === 0) return 0;
    const index = Math.min(n - 1, Math.max(0, position - 0.5));
    const lower = Math.floor(index);
    const upper = Math.min(n - 1, lower + 1);
    return glyphs[lower]!.center + (glyphs[upper]!.center - glyphs[lower]!.center) * (index - lower);
};

/**
 * 追字光斑在行内的坐标（沿行的方向）：对过去 window 秒里的位置取平均（仍只由 t 决定）。
 * window = 0 时就是不平滑的逐字位置。
 */
export const resolveSpotX = (glyphs: readonly SpotGlyph[], time: number, window = SPOT_WINDOW) => {
    if (window <= 0) return positionToX(glyphs, singingPosition(glyphs, time));
    let x = 0;
    for (let s = 0; s < SPOT_SAMPLES; s += 1) {
        x += positionToX(glyphs, singingPosition(glyphs, time - (window * s) / (SPOT_SAMPLES - 1)));
    }
    return x / SPOT_SAMPLES;
};

/**
 * 崩解的漂离量（以字号为单位）：字点亮 delay 秒之后开始，按 age^1.5 缓慢加速。
 * 3 秒后约 0.4、5 秒约 0.9、8 秒约 1.8 个字号（× strength）：唱的时候只是开始松动，
 * 退到邻行时明显错位，淡出前才散开。
 */
export const decayAmount = (decay: DecaySpec, litAt: number, time: number) => {
    const age = time - litAt - decay.delay;
    return age > 0 ? decay.strength * 0.08 * age ** 1.5 : 0;
};

/** 崩解到多远开始淡出、多远完全看不见（以字号为单位）。 */
export const DISSOLVE_FROM = 1;
export const DISSOLVE_SPAN = 2;
