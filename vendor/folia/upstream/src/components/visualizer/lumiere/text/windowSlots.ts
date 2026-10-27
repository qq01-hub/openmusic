// Copyright (c) 2026 chthollyphile
import type { Slot } from './windowLines';
import type { WindowRegion, WindowTypography } from './windowTypes';

// src/components/visualizer/lumiere/text/windowSlots.ts
// 槽位（纯函数）：横排 / 竖排的固定槽位、纵横交错的自由落点，以及堆叠方向与槽位比较。

/**
 * 纵横交错时一行的自由落点：上一行（−1）在上半圈、下一行（+1）在下半圈，角度与远近按种子；
 * 横竖都可能，横排的行倾斜得多一些。更远的位置（±2）沿同一方向再推出去、透明。
 */
export const freePlacements = (random: () => number, region: WindowRegion, nextAlpha: number): Map<number, Slot> => {
    const placement = (upper: boolean, alpha: number): Slot => {
        const angle = upper ? Math.PI * (1.12 + random() * 0.76) : Math.PI * (0.12 + random() * 0.76);
        const rx = region.w * (0.24 + random() * 0.22);
        const ry = region.h * (0.3 + random() * 0.18);
        const vertical = random() < 0.5;
        return {
            dx: Math.cos(angle) * rx,
            dy: Math.sin(angle) * ry,
            scale: 0.5 + random() * 0.2,
            alpha,
            orient: vertical ? 1 : 0,
            rotation: (random() - 0.5) * (vertical ? 0.3 : 0.7),
            wrap: 0,
        };
    };
    const farther = (slot: Slot): Slot => ({ ...slot, dx: slot.dx * 1.45, dy: slot.dy * 1.45, scale: slot.scale * 0.85, alpha: 0 });
    const previous = placement(true, 0.9);
    const next = placement(false, nextAlpha);
    return new Map([[-1, previous], [1, next], [-2, farther(previous)], [2, farther(next)]]);
};

/**
 * 固定槽位里邻行与当前行之间的空隙（以字号为单位）：near 是 ±1 与当前行之间，far 是 ±2 与 ±1 之间。
 * 按单行单列（厚度一个字号）反推，单行时与原来的固定偏移完全一样。
 */
const STACK_GAP = {
    vertical: { previous: 0.95, next: 0.88, farPrevious: 0.78, farNext: 0.7 },
    horizontal: { previous: 0.93, next: 0.735, farPrevious: 0.56, farNext: 0.56 },
};

/**
 * 横排、竖排两种排版的固定槽位（相对文字区中心，高度单位）。relative = 行号 − 当前行号。
 * 邻行按实际厚度排开（竖排看宽度、横排看高度），折成两列 / 两行的行不会压到旁边的行：
 * across(offset, scale) 是「当前行 + offset」那一行在这个槽位缩放下垂直于行方向的厚度（高度单位）。
 */
export const fixedSlot = (
    typography: WindowTypography,
    relative: number,
    region: WindowRegion,
    fontH: number,
    nextAlpha: number,
    across: (offset: number, scale: number) => number,
): Slot => {
    const slot = (dx: number, dy: number, scale: number, alpha: number, orient: number): Slot => ({ dx, dy, scale, alpha, orient, rotation: 0, wrap: 0 });
    const vertical = typography === 'vertical';
    const orient = vertical ? 1 : 0;
    if (relative === 0) return slot(0, 0, 1, 1, orient);
    const previous = relative < 0;
    const far = Math.abs(relative) > 1;
    const nearScale = vertical ? 0.58 : 0.52;
    const scale = far ? (vertical ? 0.48 : 0.44) : nearScale;
    const gap = STACK_GAP[vertical ? 'vertical' : 'horizontal'];
    const sign = previous ? -1 : 1;
    let offset = across(0, 1) / 2 + (previous ? gap.previous : gap.next) * fontH;
    if (far) offset += across(sign, nearScale) + (previous ? gap.farPrevious : gap.farNext) * fontH;
    offset += across(relative, scale) / 2;
    const alpha = previous ? (far ? 0 : 0.9) : (far ? 0 : nextAlpha);
    if (vertical) {
        // 竖排从右往左读：上一行在右、下一行在左。
        return slot(-sign * offset, sign * (far ? 0.07 : 0.03), scale, alpha, orient);
    }
    return slot(sign * region.w * (far ? 0.24 : 0.16), sign * offset, scale, alpha, orient);
};

/** 纵横交错时邻行与当前行之间至少留的空隙（以字号为单位）。 */
export const CROSSED_CLEARANCE = 0.5;

/** 堆叠轴：横排与纵横交错时各行上下排开（y），竖排时左右排开（x）。 */
export const stackX = (kind: WindowTypography) => (kind === 'vertical' ? 1 : 0);
/**
 * 当前行为 c、排版为 kind 时第 index 行背离当前行的方向（堆叠轴上的 ±1，当前行为 0）：横排与纵横交错时
 * 上一行在上、下一行在下；竖排右起，上一行在右、下一行在左。
 */
export const awayOf = (index: number, c: number, kind: WindowTypography) => (
    (index === c ? 0 : index < c ? -1 : 1) * (kind === 'vertical' ? -1 : 1)
);

export const sameSlot = (a: Slot, b: Slot) => a.dx === b.dx && a.dy === b.dy && a.scale === b.scale
    && a.alpha === b.alpha && a.orient === b.orient && a.rotation === b.rotation && a.wrap === b.wrap;
