// Copyright (c) 2026 chthollyphile
import type { Line } from '../../../../types';
import { createProtectBox, PROTECT_MARGIN, protectedAlpha, protectionAt } from './lineClearance';
import type { LineView } from './windowLines';
import type { LineTransform } from './windowTypes';
import { clamp01, easeInOutSine, LEAD, lerp, SLIDE } from './windowTiming';

// src/components/visualizer/lumiere/text/windowProtection.ts
// 当前行的保护框（lineClearance）：每帧按新旧当前行的换行进度建几个墨迹框，非当前行的字、径迹落进去就压暗。

export interface WindowProtectionDeps {
    lines: readonly Line[];
    heroPx: number;
    lineOf: (index: number) => LineView;
}

export type WindowProtection = ReturnType<typeof createWindowProtection>;

export const createWindowProtection = ({ lines, heroPx, lineOf }: WindowProtectionDeps) => {
    // 当前行的保护框：每帧最多几个（换行交接时新旧当前行各一个，两次换行挨得很近时再多一两个），预先建好反复用。
    const protectBoxes = [createProtectBox(), createProtectBox(), createProtectBox(), createProtectBox()];
    let protectCount = 0;

    /**
     * 这一帧的保护框：第 j 行作为当前行的权重 = 它这次换行的缓动进度 − 下一次换行的缓动进度（换行进度都是 t 的
     * 连续函数，所以权重也连续，求和为 1）。框是第 j 行此刻的墨迹框（横竖 × 单行 / 折行按当前的朝向与折行程度混合），
     * 跟着它的位置、缩放与转角。横竖转到一半时（字在飞、混合出来的框又宽又高，框边扫得很快）框渐隐，转完再回来。
     * 要先算好这一帧所有行的变换（frameTransforms）。
     */
    const buildProtectBoxes = (time: number, current: number, low: number, frameTransforms: readonly LineTransform[]) => {
        protectCount = 0;
        let later = 0;
        for (let j = current; j >= low && protectCount < protectBoxes.length; j -= 1) {
            const eased = easeInOutSine((time - (lines[j]!.startTime - LEAD)) / SLIDE);
            const transform = frameTransforms[j]!;
            const o = clamp01(transform.orient);
            const weight = (eased - later) * clamp01(transform.alpha) * (1 - 4 * o * (1 - o));
            later = eased;
            if (weight > 1e-4) {
                const [hSingle, hWrapped] = lineOf(j).flow[0];
                const [vSingle, vWrapped] = lineOf(j).flow[1];
                const w = transform.wrap;
                const inkW = lerp(lerp(hSingle.inkWidth, hWrapped.inkWidth, w), lerp(vSingle.inkWidth, vWrapped.inkWidth, w), transform.orient);
                const inkH = lerp(lerp(hSingle.inkHeight, hWrapped.inkHeight, w), lerp(vSingle.inkHeight, vWrapped.inkHeight, w), transform.orient);
                const box = protectBoxes[protectCount]!;
                box.line = j;
                box.x = transform.x;
                box.y = transform.y;
                box.cos = Math.cos(transform.rotation);
                box.sin = Math.sin(transform.rotation);
                box.halfW = (inkW / 2) * transform.scale;
                box.halfH = (inkH / 2) * transform.scale;
                box.margin = PROTECT_MARGIN * heroPx * transform.scale;
                box.weight = weight;
                protectCount += 1;
            }
            if (eased >= 1) break;
        }
    };

    return {
        build: buildProtectBoxes,
        /** 第 index 行一个字（画面坐标、半径）的保护系数：落进别的行的保护框就压暗，飞行途中按飞行强度不压。 */
        shield: (index: number, x: number, y: number, radius: number, flying: number) => (
            protectCount > 0
                ? protectedAlpha(protectionAt(protectBoxes, protectCount, index, x, y, radius) * (1 - flying))
                : 1
        ),
    };
};
