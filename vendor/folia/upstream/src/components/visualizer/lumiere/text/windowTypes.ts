// Copyright (c) 2026 chthollyphile

// src/components/visualizer/lumiere/text/windowTypes.ts
// 歌词窗口各模块共用的类型：文字区、排版、崩解参数与每行在某一时刻的变换。

/** 文字区（高度单位，中心 + 宽高）。 */
export interface WindowRegion {
    cx: number;
    cy: number;
    w: number;
    h: number;
}

/** horizontal：横排为主；vertical：竖排为主（右起）；crossed：当前行横排，周围的行自由落点、横竖都有。 */
export type WindowTypography = 'horizontal' | 'vertical' | 'crossed';

export interface DecaySpec {
    /** 崩解强度（0 = 不崩解）。 */
    strength: number;
    /** 字点亮后多久开始漂离（秒）。 */
    delay: number;
}

export interface LineTransform {
    current: number;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    alpha: number;
    /** 槽位切换的起止朝向、起止折行与滑动的线性进度；fly 为这一次切换字要不要沿曲线飞。 */
    fromOrient: number;
    toOrient: number;
    fromWrap: number;
    toWrap: number;
    /** 当前的折行程度（0..1，缓动过的）：不飞的时候字在单行与折行的位置之间滑。 */
    wrap: number;
    /** 当前的朝向（0 横 .. 1 竖，随滑动线性变化）：当前行的保护框按它混合横竖两种墨迹框。 */
    orient: number;
    phase: number;
    fly: boolean;
    /** 字的朝向与字心的起点（上一次已经走完的换位的终点）与此后还在进行的换位（按先后）。 */
    restOrient: number;
    restWrap: number;
    moves: Array<{ toOrient: number; toWrap: number; phase: number; fly: boolean }>;
    /** 这一次滑动开始的时刻（没有滑动时为 −∞）。 */
    slideStart: number;
}
