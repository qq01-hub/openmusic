// Copyright (c) 2026 chthollyphile
import { clampInto, fitScale, type frameBand, shouldWrap, type LineVariant } from './lineWrap';
import { awayDrift, heldDrift } from './lineClearance';
import type { GlyphView, LineView, Point, Slot } from './windowLines';
import type { LyricWindowOptions } from './lyricWindow';
import type { LineTransform, WindowTypography } from './windowTypes';
import {
    clamp01,
    decayAmount,
    easeInOutCubic,
    easeInOutSine,
    flightPoint,
    flightProgress,
    GATHER,
    GATHER_LEAD,
    LEAD,
    lerp,
    lerpPoint,
    MAX_LAG,
    ORBIT,
    resolveLinePhase,
    resolveWindowCursor,
    SLIDE,
    smooth,
    TRACK_TIME,
} from './windowTiming';
import { awayOf, CROSSED_CLEARANCE, fixedSlot, sameSlot, stackX } from './windowSlots';

// src/components/visualizer/lumiere/text/windowGeometry.ts
// 歌词窗口的几何（只由 t 决定）：每行在当前行、排版下的槽位（含折行与放进画框的整体偏移），
// 叠加式的行变换（滑动、漂移、让开当前行），字在行内的位置（飞行、聚拢、崩解、呼吸），
// 以及这一帧要画哪几行。行按需从行仓库取。

/** 当前行前后各画几行。 */
const WINDOW_REACH = 3;

/** 行内坐标 → 画面坐标（行的转角、缩放、位置）。 */
export const toWorld = (transform: LineTransform, point: Point): Point => {
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    return {
        x: transform.x + (point.x * cos - point.y * sin) * transform.scale,
        y: transform.y + (point.x * sin + point.y * cos) * transform.scale,
    };
};

export interface WindowGeometryDeps {
    options: LyricWindowOptions;
    lineCount: number;
    /** 画框（高度单位）：横排宽度上限、竖排列高上限都从它来。 */
    band: ReturnType<typeof frameBand>;
    columnCap: number;
    maxWidthOf: (kind: WindowTypography) => number;
    nextAlpha: number;
    lineOf: (index: number) => LineView;
}

export type WindowGeometry = ReturnType<typeof createWindowGeometry>;

export const createWindowGeometry = ({
    options, lineCount, band, columnCap, maxWidthOf, nextAlpha, lineOf,
}: WindowGeometryDeps) => {
    const { height, region, heroPx, typography, decay } = options;
    const fontH = heroPx / height;
    const driftScale = options.drift ?? 1;
    /** 第 c 行成为当前行时的排版（c = −1 即第一行之前，按第一行的排版）。 */
    const typographyAt = (c: number): WindowTypography => (
        options.typographyOf ? options.typographyOf(Math.max(0, Math.min(lineCount - 1, c))) : typography
    );

    /**
     * 第 index 行在槽位缩放 scale、朝向 orient 下落定的样子：单行缩到 SINGLE_MIN_FIT 还放不下才折，
     * 折了还放不下再整体缩小（邻行本身已经小，很少需要折）。
     */
    const settle = (index: number, kind: WindowTypography, orient: 0 | 1, scale: number) => {
        const flow = lineOf(index).flow[orient];
        const budget = orient === 1 ? columnCap : maxWidthOf(kind);
        const wrap = shouldWrap(flow, budget, scale) ? 1 : 0;
        const variant: LineVariant = flow[wrap];
        return { wrap, variant, scale: scale * fitScale(variant.along, budget, scale) };
    };
    /** 第 index 行垂直于行方向的厚度（高度单位，已缩放）；不存在的行（第一行之前）按一个字号。 */
    const acrossOf = (index: number, kind: WindowTypography, orient: 0 | 1, scale: number) => {
        if (index < 0 || index >= lineCount) return fontH * scale;
        const settled = settle(index, kind, orient, scale);
        return (settled.variant.across / height) * settled.scale;
    };
    /** 把当前行整块放进画框的偏移（高度单位）：整个窗口一起挪，行距不变。文字区的中心仍是锚点。 */
    const windowShift = (current: number, kind: WindowTypography): Point => {
        if (current < 0 || current >= lineCount) return { x: 0, y: 0 };
        const orient = kind === 'vertical' ? 1 : 0;
        const { variant, scale } = settle(current, kind, orient, 1);
        const w = (variant.inkWidth / height) * scale;
        const h = (variant.inkHeight / height) * scale;
        return {
            x: clampInto(region.cx, w, band.left, band.right) - region.cx,
            y: clampInto(region.cy, h, band.top, band.bottom) - region.cy,
        };
    };

    // 槽位是（行、当前行、排版）的纯函数，每帧会反复查（径迹还要回溯几十个时刻），缓存起来。
    const slotCache = new Map<string, Slot>();
    /** 当前行为 current、排版为 kind 时第 index 行的槽位（含把当前行放进画框的整体偏移与这一行的折行）。 */
    const slotOf = (index: number, current: number, kind: WindowTypography): Slot => {
        const key = `${index}|${current}|${kind}`;
        const cached = slotCache.get(key);
        if (cached) return cached;
        const view = lineOf(index);
        const clamped = Math.max(-2, Math.min(2, index - current));
        const shift = windowShift(current, kind);
        let slot: Slot;
        let wrap: number | null = null;
        if (kind === 'crossed' && clamped !== 0) {
            // 纵横交错：自由落点在当前行的上半圈 / 下半圈，但要让开当前行（折成两行时更高）：邻行整块的上下边
            // 与当前行之间至少留一段空隙。竖着的邻行很长，当前行与画框之间放不下时先折成两列，还放不下再缩小。
            const base = view.placements.get(clamped)!;
            const baseOrient = base.orient >= 0.5 ? 1 : 0;
            const sign = base.dy < 0 ? -1 : 1;
            const currentHalf = current >= 0 && current < lineCount
                ? (() => {
                    const settled = settle(current, kind, 0, 1);
                    return (settled.variant.inkHeight / height) * settled.scale / 2;
                })()
                : fontH / 2;
            const gap = fontH * CROSSED_CLEARANCE;
            const centerY = region.cy + shift.y;
            const room = sign < 0 ? centerY - currentHalf - gap - band.top : band.bottom - (centerY + currentHalf + gap);
            const flow = view.flow[baseOrient];
            const budget = baseOrient === 1 ? columnCap : maxWidthOf(kind);
            /** 在缩放 s、折法 w 下这一行整块（含落点的倾斜）的高度（高度单位）。 */
            const tilt = Math.abs(base.rotation) + 0.03;
            const heightOf = (w: 0 | 1, s: number) => (
                ((flow[w].inkHeight * Math.cos(tilt) + flow[w].inkWidth * Math.sin(tilt)) / height) * s * fitScale(flow[w].along, budget, s)
            );
            let scale = base.scale;
            let w: 0 | 1 = settle(index, kind, baseOrient, scale).wrap ? 1 : 0;
            if (baseOrient === 1 && room > 0) {
                if (w === 0 && flow[1].lines > 1 && heightOf(0, scale) > room) w = 1;
                const tall = heightOf(w, scale);
                if (tall > room) scale = Math.max(base.scale * 0.5, scale * (room / tall));
            }
            wrap = w;
            const clearance = currentHalf + gap + heightOf(w, scale) / 2;
            const dy = sign * Math.max(Math.abs(base.dy), clearance);
            // 竖着的邻行折成两列时更宽，沿原来的方向再推开多出来的那一半。
            const wider = baseOrient === 1 ? Math.max(0, acrossOf(index, kind, 1, scale) - fontH * scale) / 2 : 0;
            slot = { ...base, scale, dy, dx: base.dx + Math.sign(base.dx) * wider };
        } else {
            const orient = kind === 'vertical' ? 1 : 0;
            slot = fixedSlot(kind === 'crossed' ? 'horizontal' : kind, clamped, region, fontH, nextAlpha, (offset, scale) => (
                acrossOf(offset === clamped ? index : current + offset, kind, orient, scale)
            ));
        }
        const result: Slot = {
            ...slot,
            dx: slot.dx + shift.x,
            dy: slot.dy + shift.y,
            wrap: wrap ?? settle(index, kind, slot.orient >= 0.5 ? 1 : 0, slot.scale).wrap,
        };
        slotCache.set(key, result);
        return result;
    };

    /**
     * 时刻 time 起还没「走完多时」的第一次换行（current + 1 = 全都走完了）：更早的换行对每一行都已滑完、径迹也已收拢
     * （按最晚的起步 SLIDE_LAG 估，保守）。行的开始时刻是升序的，从当前行往回找几步就到。
     */
    const firstLiveChange = (time: number, current: number) => {
        let c = current;
        while (c >= 0 && options.lines[c]!.startTime - LEAD + MAX_LAG + SLIDE + TRACK_TIME > time) c -= 1;
        return c + 1;
    };

    /**
     * 第 index 行在时刻 time 的位置（逻辑像素）、缩放、转角、透明度与槽位切换信息。纯函数，径迹与爆闪也用它。
     *
     * 叠加式：位置 = 第一行开始前的槽位 + Σ 每次换行带来的槽位差 × 这次换行对这一行的缓动进度。
     * 每次换行对各行错开起步（离场的先走），两行间隔很短、上一次还没走完时也连续，不会跳。
     * 已经走完多时的换行进度都是 1，前后相消（槽位差首尾相接），所以直接从它们之后的槽位起叠：
     * 与从头叠加结果相同，只用到当前行附近几行的排版（整首歌一个单元时不用构建前面所有的行）。
     */
    const lineTransform = (index: number, time: number): LineTransform => {
        const view = lineOf(index);
        const { current } = resolveWindowCursor(options.lines, time);
        const first = firstLiveChange(time, current);
        const base = first - 1;
        const initialKind = typographyAt(base);
        const initial = slotOf(index, base, initialKind);
        let dx = initial.dx, dy = initial.dy, scale = initial.scale, rotation = initial.rotation;
        let alpha = initial.alpha, orient = initial.orient, wrap = initial.wrap;
        // 最近一次正在（或刚刚）作用于这一行的换行：给字的飞行曲线与径迹用。
        let latest: { before: Slot; after: Slot; phase: number; start: number; kind: WindowTypography } | null = null;
        let restOrient = initial.orient;
        let restWrap = initial.wrap;
        const moves: LineTransform['moves'] = [];
        // 随排版变化的量（宽度上限、错落）也跟着换行叠加，排版切换时不跳。
        let widthCap = maxWidthOf(initialKind);
        let jitterOn = initialKind === 'crossed' ? 0 : 1;
        // 间隙：背离当前行的方向（x、y 各一份，堆叠轴上的 ±1 × 作为邻行的权重）与作为当前行的权重，
        // 同样按换行叠加，换行与排版切换时连续。
        let awayX = stackX(initialKind) * awayOf(index, base, initialKind);
        let awayY = (1 - stackX(initialKind)) * awayOf(index, base, initialKind);
        let hero = index === base ? 1 : 0;
        // 槽位差为 0 的换行直接跳过。
        const last = Math.min(lineCount - 1, current);
        for (let c = first; c <= last; c += 1) {
            const beforeKind = typographyAt(c - 1);
            const afterKind = typographyAt(c);
            const before = slotOf(index, c - 1, beforeKind);
            const after = slotOf(index, c, afterKind);
            const kindChanged = beforeKind !== afterKind;
            if (sameSlot(before, after) && !kindChanged) continue;
            const { phase, start } = resolveLinePhase(options.lines, c, index - c, time);
            const k = easeInOutSine(phase);
            if (kindChanged) {
                widthCap += (maxWidthOf(afterKind) - maxWidthOf(beforeKind)) * k;
                jitterOn += ((afterKind === 'crossed' ? 0 : 1) - (beforeKind === 'crossed' ? 0 : 1)) * k;
            }
            const awayBefore = awayOf(index, c - 1, beforeKind);
            const awayAfter = awayOf(index, c, afterKind);
            awayX += (stackX(afterKind) * awayAfter - stackX(beforeKind) * awayBefore) * k;
            awayY += ((1 - stackX(afterKind)) * awayAfter - (1 - stackX(beforeKind)) * awayBefore) * k;
            hero += ((index === c ? 1 : 0) - (index === c - 1 ? 1 : 0)) * k;
            // 透明度不跟位移同一条曲线：要淡出的先走（前 60%），要淡入的后到（后 60%）。
            const fade = after.alpha < before.alpha
                ? easeInOutCubic(phase / 0.6)
                : after.alpha > before.alpha ? easeInOutCubic((phase - 0.4) / 0.6) : k;
            dx += (after.dx - before.dx) * k;
            dy += (after.dy - before.dy) * k;
            scale += (after.scale - before.scale) * k;
            rotation += (after.rotation - before.rotation) * k;
            alpha += (after.alpha - before.alpha) * fade;
            orient += (after.orient - before.orient) * phase;
            wrap += (after.wrap - before.wrap) * k;
            if (phase > 0) latest = { before, after, phase, start, kind: afterKind };
            if (phase >= 1) {
                restOrient = after.orient;
                restWrap = after.wrap;
                moves.length = 0;
            } else if (phase > 0) {
                moves.push({
                    toOrient: after.orient,
                    toWrap: after.wrap,
                    phase,
                    fly: options.alwaysFly === true || afterKind === 'crossed' || before.orient !== after.orient,
                });
            }
        }
        // 太长时整体缩小，不出画框（横排看宽度、竖排看长度；单行 / 折行按折行程度混合）。
        const o = clamp01(orient);
        const w = clamp01(wrap);
        const [hSingle, hWrapped] = view.flow[0];
        const [vSingle, vWrapped] = view.flow[1];
        const fitH = lerp(fitScale(hSingle.along, widthCap, scale), fitScale(hWrapped.along, widthCap, scale), w);
        const fitV = lerp(fitScale(vSingle.along, columnCap, scale), fitScale(vWrapped.along, columnCap, scale), w);
        const fitted = scale * lerp(fitH, fitV, o);
        // 错落只作用在固定槽位的邻行上（横排时横向、竖排时纵向），当前行居中。
        const jitter = jitterOn * view.jitter * region.w * clamp01((1 - scale) / 0.5);
        // 固定槽位里每一行沿自己的方向不出画框（横排左右、竖排上下）：邻行排在垂直于行的方向上，挪了也压不到
        // 当前行。纵横交错的邻行是自由落点，沿行挪可能挪进当前行里，保持原样（和错落一样只作用在固定槽位上）。
        // 漂移不算在里面，照常漂。
        const baseX = region.cx + dx + jitter * (1 - orient);
        const baseY = region.cy + dy + jitter * 0.5 * orient;
        const alongH = (lerp(hSingle.inkWidth, hWrapped.inkWidth, w) / height) * fitted;
        const alongV = (lerp(vSingle.inkHeight, vWrapped.inkHeight, w) / height) * fitted;
        const x = baseX + (clampInto(baseX, alongH, band.left, band.right) - baseX) * (1 - o) * jitterOn;
        const y = baseY + (clampInto(baseY, alongV, band.top, band.bottom) - baseY) * o * jitterOn;
        // 永不停止的漂移：以这一行开始唱的时刻为零点匀速漂（唱的时候正好在槽位上），再叠一点绕行、摆动与呼吸。
        // 让开当前行（lineClearance）：邻行朝当前行的那一份翻成背离；当前行不越漂越远，绕一个小圆，速度不变。
        const age = time - view.line.startTime;
        const m = view.motionPhase;
        const { x: vx, y: vy } = view.velocity;
        const orbitX = Math.sin(time * 0.52 + m) * ORBIT;
        const orbitY = Math.cos(time * 0.41 + m * 1.3) * ORBIT * 0.7;
        const held = clamp01(hero);
        const driftX = lerp(awayDrift((vx * age + orbitX) * driftScale, awayX), (heldDrift(vx, vy, age, 0) + orbitX) * driftScale, held);
        const driftY = lerp(awayDrift((vy * age + orbitY) * driftScale, awayY), (heldDrift(vx, vy, age, 1) + orbitY) * driftScale, held);
        const settledOrient = latest ? latest.after.orient : initial.orient;
        const settledWrap = latest ? latest.after.wrap : initial.wrap;
        return {
            current,
            x: (x + driftX) * height,
            y: (y + driftY) * height,
            scale: fitted * (1 + 0.025 * Math.sin(time * 0.43 + m)),
            rotation: rotation + 0.03 * Math.sin(time * 0.23 + m * 0.7),
            alpha: clamp01(alpha),
            fromOrient: latest ? latest.before.orient : settledOrient,
            toOrient: settledOrient,
            fromWrap: latest ? latest.before.wrap : settledWrap,
            toWrap: settledWrap,
            wrap: w,
            orient: o,
            phase: latest ? latest.phase : 1,
            // 纵横交错时每次换槽位都飞；另两种排版只在朝向变化时飞。
            fly: latest !== null && latest.phase < 1
                && (options.alwaysFly === true || latest.kind === 'crossed' || latest.before.orient !== latest.after.orient),
            slideStart: latest ? latest.start : Number.NEGATIVE_INFINITY,
            restOrient,
            restWrap,
            moves,
        };
    };

    /**
     * 字在行内的位置（未缩放）、转角与缩放：换槽位时沿自己的贝塞尔曲线飞过去，途中缩小、转动、发亮
     * （flying 为飞行强度 0..1）。再加上聚合、崩解与呼吸。
     */
    const glyphLocal = (view: LineView, glyph: GlyphView, time: number, transform: LineTransform) => {
        const at = (orient: number, wrap: number) => view.flow[orient >= 0.5 ? 1 : 0][wrap >= 0.5 ? 1 : 0].points[glyph.index]!;
        // 从上一次走完的换位的终点出发，依次叠上还在进行的换位：每一次都从上一次此刻的位置起飞（或滑过去），
        // 前一次还没飞完就换行时，字接着从它在曲线上的位置出发，不会跳回起点。
        let point = at(transform.restOrient, transform.restWrap);
        let orientation = transform.restOrient;
        let flying = 0;
        for (const move of transform.moves) {
            const target = at(move.toOrient, move.toWrap);
            if (move.fly) {
                const s = flightProgress(glyph.flight, move.phase);
                point = flightPoint(glyph.flight, point, target, s);
                orientation = lerp(orientation, move.toOrient, s);
                flying = Math.max(flying, Math.sin(Math.PI * s));
            } else {
                // 不飞的时候，单行与折行之间（邻行变成当前行、需要折开时）字随滑动缓动过去。
                const k = easeInOutSine(move.phase);
                point = lerpPoint(point, target, k);
                orientation = lerp(orientation, move.toOrient, k);
            }
        }
        let x = point.x;
        let y = point.y;
        let rotation = glyph.vRotation * orientation + glyph.flight.spin * flying;
        const pulse = 1 - 0.28 * flying;
        // 聚合：未唱的行从散开的位置逐渐收拢。
        const gather = smooth((time - (view.line.startTime - LEAD - GATHER_LEAD)) / GATHER);
        const scatter = (1 - gather) ** 2 * decay.strength;
        x += glyph.scatter.x * heroPx * scatter;
        y += glyph.scatter.y * heroPx * scatter;
        // 崩解：点亮一会儿之后沿各自的方向漂离、转动。
        const amount = decayAmount(decay, glyph.timing.start, time) * glyph.drift.speed;
        x += glyph.drift.dx * heroPx * amount;
        y += glyph.drift.dy * heroPx * amount;
        rotation += glyph.drift.spin * amount * 0.18;
        // 呼吸：一直有一点轻微晃动。
        const breath = heroPx * 0.022 * Math.min(1, decay.strength + 0.3);
        x += Math.sin(time * 0.9 + glyph.phase) * breath;
        y += Math.cos(time * 1.13 + glyph.phase * 1.7) * breath;
        return { x, y, rotation, gather, flying, scale: glyph.scale * pulse };
    };

    /**
     * 这一帧要画的行：当前行前后各 WINDOW_REACH 行，还在滑动（或径迹还没收拢）的换行再往前 WINDOW_REACH 行——
     * 槽位要看当前行 ±2 行的排版，更远的行透明度都是 0。只由时刻决定。
     */
    const activeRange = (time: number) => {
        const { current } = resolveWindowCursor(options.lines, time);
        const first = firstLiveChange(time, current);
        return {
            current,
            low: Math.max(0, Math.min(current, first) - WINDOW_REACH),
            high: Math.min(lineCount - 1, Math.max(current, 0) + WINDOW_REACH),
        };
    };

    return { fontH, lineTransform, glyphLocal, activeRange };
};
