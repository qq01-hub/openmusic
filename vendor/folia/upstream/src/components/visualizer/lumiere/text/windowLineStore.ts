// Copyright (c) 2026 chthollyphile
import type { Container } from 'pixi.js';
import { createRng, createRngAt } from '../lumiereRandom';
import type { Rgb } from '../color';
import { keywordTints } from './keywordColors';
import { buildLineMetas, buildLineView, type LineView } from './windowLines';
import { DRIFT_SPEED } from './windowTiming';
import { freePlacements } from './windowSlots';
import type { LyricWindowOptions } from './lyricWindow';
import type { TextMeasurer } from './lineWrap';
import type { WordColorMatcher } from '../../wordColoring';

// src/components/visualizer/lumiere/text/windowLineStore.ts
// 歌词窗口里按需构建的行：建（按行号插进各层）、藏、释放、往后预建，以及关键字在当前光色下的着色。
// 构建结果只由（行、种子）决定，与构建顺序无关。
type PixiModule = typeof import('pixi.js');

/** 按需构建：当前行前后各画几行、往后预先建几行、离开窗口多远才释放。 */
const PREBUILD = 2;
const KEEP_MARGIN = 2;

export interface WindowLineStoreDeps {
    pixi: PixiModule;
    options: LyricWindowOptions;
    lineCount: number;
    measurer: TextMeasurer;
    limits: { horizontal: number; vertical: number };
    keywords: readonly WordColorMatcher[] | undefined;
    nextAlpha: number;
    /** 各层：字、光晕、闪点、光斑；每个已构建的行在每层各有一个子节点，按行号排。 */
    glyphLayer: Container;
    halos: Container;
    stars: Container;
    spots: Container;
}

export type WindowLineStore = ReturnType<typeof createWindowLineStore>;

/** 歌词窗口的行仓库：metas 每行都有，LineView 按需构建、离开窗口后释放。 */
export const createWindowLineStore = ({
    pixi, options, lineCount, measurer, limits, keywords: KEYWORDS, nextAlpha, glyphLayer, halos, stars, spots,
}: WindowLineStoreDeps) => {
    const { region, heroPx, sprites } = options;
    const spacing = options.letterSpacing ?? 0;
    const metas = buildLineMetas(options.lines);
    /** 已构建的行（没建的是 null）与它们的行号（升序）：各层里的子节点按行号排，画的先后与构建顺序无关。 */
    const views: Array<LineView | null> = new Array<LineView | null>(lineCount).fill(null);
    const built: number[] = [];
    const buildContext = {
        pixi,
        font: options.font,
        weight: options.weight,
        resolution: options.resolution,
        heroPx,
        spacing,
        seed: options.seed,
        sprites,
        measurer,
        limits,
        keywords: KEYWORDS,
        driftSpeed: DRIFT_SPEED,
        placementsOf: (lineIndex: number) => freePlacements(createRng(`${options.seed}:placements:${lineIndex}`), region, nextAlpha),
    };
    let tintedFor: Rgb | null = null;
    /** 把 child 插到 parent 里行号 lineIndex 该在的位置（parent 里每个已构建的行各有一个子节点）。 */
    const insertByLine = (parent: Container, child: Container, position: number) => {
        if (position >= parent.children.length) parent.addChild(child);
        else parent.addChildAt(child, position);
    };
    /** 构建第 index 行：随机流跳到这一行的起点，结果与从第一行起顺序构建时一样。 */
    const buildLine = (index: number): LineView => {
        const meta = metas[index]!;
        const lineView = buildLineView(buildContext, index, meta, createRngAt(`${options.seed}:window`, meta.randomOffset));
        let position = 0;
        while (position < built.length && built[position]! < index) position += 1;
        built.splice(position, 0, index);
        insertByLine(glyphLayer, lineView.holder, position);
        insertByLine(halos, lineView.haloLayer, position);
        insertByLine(stars, lineView.starLayer, position);
        insertByLine(spots, lineView.spot, position);
        if (tintedFor) for (const glyph of lineView.keywordGlyphs) glyph.tints = keywordTints(tintedFor, glyph.keyword!);
        views[index] = lineView;
        return lineView;
    };
    const releaseLine = (index: number) => {
        const lineView = views[index];
        if (!lineView) return;
        views[index] = null;
        built.splice(built.indexOf(index), 1);
        for (const item of [lineView.holder, lineView.haloLayer, lineView.starLayer, lineView.spot]) {
            item.parent?.removeChild(item);
            item.destroy({ children: true });
        }
        lineView.layout.destroy();
    };
    const lineOf = (index: number): LineView => views[index] ?? buildLine(index);

    /** 关键字在当前光色下的颜色：光色不变时（通常整个单元都不变）只算一次；之后新建的行在构建时按它上色。 */
    const refreshKeywordTints = (litColor: Rgb) => {
        if (tintedFor && tintedFor[0] === litColor[0] && tintedFor[1] === litColor[1] && tintedFor[2] === litColor[2]) return;
        tintedFor = [litColor[0], litColor[1], litColor[2]];
        for (const index of built) {
            for (const glyph of views[index]!.keywordGlyphs) glyph.tints = keywordTints(litColor, glyph.keyword!);
        }
    };

    /** 窗口外的行藏起来，离得更远的释放（留一点余量，来回拖动进度时不反复重建）。 */
    const syncBuilt = (low: number, high: number) => {
        for (let k = built.length - 1; k >= 0; k -= 1) {
            const index = built[k]!;
            if (index >= low && index <= high) continue;
            if (index < low - KEEP_MARGIN || index > high + KEEP_MARGIN) {
                releaseLine(index);
                continue;
            }
            const lineView = views[index]!;
            lineView.holder.visible = false;
            lineView.haloLayer.visible = false;
            lineView.starLayer.visible = false;
            lineView.spot.visible = false;
        }
    };
    /** 往后预先建几行（每帧最多一行），当前行换过去时不用当场构建。 */
    const prebuild = (high: number) => {
        for (let index = high + 1; index <= Math.min(lineCount - 1, high + PREBUILD); index += 1) {
            if (views[index]) continue;
            buildLine(index);
            const lineView = views[index]!;
            lineView.holder.visible = false;
            lineView.haloLayer.visible = false;
            lineView.starLayer.visible = false;
            lineView.spot.visible = false;
            return;
        }
    };

    return {
        metas,
        lineOf,
        /** 已构建的第 index 行（没建的是 null）。 */
        viewAt: (index: number) => views[index],
        refreshKeywordTints,
        syncBuilt,
        prebuild,
        /** 释放全部已构建的行。 */
        releaseAll: () => {
            for (let k = built.length - 1; k >= 0; k -= 1) releaseLine(built[k]!);
        },
    };
};
