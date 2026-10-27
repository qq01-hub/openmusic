import { layoutWithLines, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext';
import { Line, Theme } from '../../../types';
import { buildWordGraphemeTimings } from '../../../utils/lyrics/graphemeTiming';
import { resolveWordColor } from '../wordColoring';
import type { SegmentMeta, WordRange } from './cadenzaTypes';
import { clamp, splitGraphemes } from './cadenzaEnvelopes';

// src/components/visualizer/cadenza/cadenzaFragments.ts
// 把 pretext 的分段 / 换行结果换算成全局字素偏移，再切成按词、按行的片段（含跨行拆开的词）。

const getActiveColor = (wordText: string, theme: Theme) => {
    return resolveWordColor(wordText, theme.wordColors, theme.accentColor);
};

export const buildSegmentMetas = (prepared: PreparedTextWithSegments) => {
    // pretext works in segments, but most animation logic wants global grapheme offsets.
    // This bridge lets us move back and forth between those two coordinate systems.
    const segmentMetas: SegmentMeta[] = [];
    const graphemes: string[] = [];
    let graphemeCursor = 0;

    for (const segment of prepared.segments) {
        const segmentGraphemes = splitGraphemes(segment);
        segmentMetas.push({
            graphemeStart: graphemeCursor,
            graphemeEnd: graphemeCursor + segmentGraphemes.length,
            graphemeCount: segmentGraphemes.length,
        });
        graphemes.push(...segmentGraphemes);
        graphemeCursor += segmentGraphemes.length;
    }

    return { segmentMetas, graphemes };
};

export const findWordRanges = (line: Line, graphemes: string[], theme: Theme) => {
    // We have to remap lyric words back onto the grapheme stream after pretext segmentation.
    // If this goes wrong, glow/highlight gets assigned to the wrong text slice.
    const ranges: WordRange[] = [];
    let cursor = 0;

    for (let wordIndex = 0; wordIndex < line.words.length; wordIndex++) {
        const word = line.words[wordIndex]!;
        const target = splitGraphemes(word.text);
        let start = -1;

        for (let i = cursor; i <= graphemes.length - target.length; i++) {
            let isMatch = true;
            for (let j = 0; j < target.length; j++) {
                if (graphemes[i + j] !== target[j]) {
                    isMatch = false;
                    break;
                }
            }
            if (isMatch) {
                start = i;
                break;
            }
        }

        if (start === -1) {
            start = clamp(cursor, 0, graphemes.length);
        }

        const end = clamp(start + target.length, start, graphemes.length);

        ranges.push({
            wordIndex,
            word,
            start,
            end,
            color: getActiveColor(word.text, theme),
            graphemeTimings: buildWordGraphemeTimings(word),
        });

        cursor = end;
    }

    return ranges;
};

const cursorToGlobalOffset = (cursor: LayoutCursor, segmentMetas: SegmentMeta[]) => {
    if (segmentMetas.length === 0) return 0;
    const segment = segmentMetas[cursor.segmentIndex];

    if (!segment) {
        return segmentMetas[segmentMetas.length - 1]!.graphemeEnd;
    }

    return clamp(segment.graphemeStart + cursor.graphemeIndex, segment.graphemeStart, segment.graphemeEnd);
};

const getPartialSegmentWidth = (
    prepared: PreparedTextWithSegments,
    segmentIndex: number,
    segmentMeta: SegmentMeta,
    startOffset: number,
    endOffset: number,
) => {
    const localStart = clamp(startOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount);
    const localEnd = clamp(endOffset - segmentMeta.graphemeStart, 0, segmentMeta.graphemeCount);

    if (localEnd <= localStart) return 0;
    if (localStart === 0 && localEnd === segmentMeta.graphemeCount) {
        return prepared.widths[segmentIndex] ?? 0;
    }

    const breakableFitAdvances = prepared.breakableFitAdvances[segmentIndex];
    if (breakableFitAdvances && breakableFitAdvances.length > 0) {
        let width = 0;
        for (let i = localStart; i < localEnd; i++) {
            width += breakableFitAdvances[i] ?? 0;
        }
        return width;
    }

    const fullWidth = prepared.widths[segmentIndex] ?? 0;
    if (segmentMeta.graphemeCount === 0) return fullWidth;
    return fullWidth * ((localEnd - localStart) / segmentMeta.graphemeCount);
};

const widthBetweenOffsets = (
    prepared: PreparedTextWithSegments,
    segmentMetas: SegmentMeta[],
    startOffset: number,
    endOffset: number,
) => {
    if (endOffset <= startOffset) return 0;

    let width = 0;

    for (let segmentIndex = 0; segmentIndex < segmentMetas.length; segmentIndex++) {
        const meta = segmentMetas[segmentIndex]!;
        if (endOffset <= meta.graphemeStart) break;
        if (startOffset >= meta.graphemeEnd) continue;

        const sliceStart = Math.max(startOffset, meta.graphemeStart);
        const sliceEnd = Math.min(endOffset, meta.graphemeEnd);
        width += getPartialSegmentWidth(prepared, segmentIndex, meta, sliceStart, sliceEnd);
    }

    return width;
};

export const buildLineFragments = (
    prepared: PreparedTextWithSegments,
    segmentMetas: SegmentMeta[],
    graphemes: string[],
    layout: ReturnType<typeof layoutWithLines>,
    ranges: WordRange[],
) => {
    // Wrapped layout lines can cut straight through a lyric word.
    // So first build fragments per wrapped line, then later decide which fragments are still "the same word".
    const lineViews = layout.lines.map(line => {
        const lineStart = cursorToGlobalOffset(line.start, segmentMetas);
        const lineEnd = cursorToGlobalOffset(line.end, segmentMetas);

        const fragments = ranges.flatMap(range => {
            if (range.end <= lineStart || range.start >= lineEnd) {
                return [];
            }

            const fragmentStart = Math.max(range.start, lineStart);
            const fragmentEnd = Math.min(range.end, lineEnd);
            return [{
                wordIndex: range.wordIndex,
                lineIndex: 0,
                word: range.word,
                text: graphemes.slice(fragmentStart, fragmentEnd).join(''),
                color: range.color,
                startX: widthBetweenOffsets(prepared, segmentMetas, lineStart, fragmentStart),
                endX: widthBetweenOffsets(prepared, segmentMetas, lineStart, fragmentEnd),
                fragmentStartInWord: fragmentStart - range.start,
                fragmentEndInWord: fragmentEnd - range.start,
                wordGraphemeCount: Math.max(range.end - range.start, 1),
                wordGraphemeTimings: range.graphemeTimings,
                fragmentIndexInWord: 0,
                fragmentCountInWord: 1,
                isPrimaryFragment: true,
                isSplitAcrossLines: false,
            }];
        });

        return { line, lineStart, lineEnd, fragments };
    });

    const fragmentCountByWord = new Map<number, number>();
    lineViews.forEach(lineView => {
        lineView.fragments.forEach(fragment => {
            fragmentCountByWord.set(
                fragment.wordIndex,
                (fragmentCountByWord.get(fragment.wordIndex) ?? 0) + 1,
            );
        });
    });

    const seenFragmentsByWord = new Map<number, number>();

    return lineViews.map((lineView, lineIndex) => ({
        ...lineView,
        fragments: lineView.fragments.map(fragment => {
            const fragmentCountInWord = fragmentCountByWord.get(fragment.wordIndex) ?? 1;
            const fragmentIndexInWord = seenFragmentsByWord.get(fragment.wordIndex) ?? 0;
            seenFragmentsByWord.set(fragment.wordIndex, fragmentIndexInWord + 1);

            return {
                ...fragment,
                lineIndex,
                fragmentIndexInWord,
                fragmentCountInWord,
                isPrimaryFragment: fragmentIndexInWord === 0,
                isSplitAcrossLines: fragmentCountInWord > 1,
            };
        }),
    }));
};
