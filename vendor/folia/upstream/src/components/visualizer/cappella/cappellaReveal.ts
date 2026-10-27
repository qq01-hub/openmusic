import { type Line } from '../../../types';
import { buildLineGraphemeTimeline, buildWordGraphemeTimings, splitLyricGraphemes } from '../../../utils/lyrics/graphemeTiming';
import type { CharacterRevealPlan, PreparedBubbleMetrics } from './cappellaTypes';
import { DEFAULT_CHAR_FADE_MS, MIN_CHAR_FADE_MS } from './cappellaConstants';

// src/components/visualizer/cappella/cappellaReveal.ts
// 逐字出现的时间表：每个字素的出现时刻、淡入时长与时间戳就绪时刻。

export const getLineCharacters = (line: Line) => splitLyricGraphemes(line.fullText);

const getWordTextRanges = (line: Line) => {
    const ranges: Array<{ start: number; end: number; } | null> = [];
    let searchCursor = 0;

    line.words.forEach(word => {
        const start = line.fullText.indexOf(word.text, searchCursor);
        if (start < 0) {
            ranges.push(null);
            return;
        }

        const end = start + word.text.length;
        ranges.push({ start, end });
        searchCursor = end;
    });

    return ranges;
};

// Builds a per-character reveal timeline from parser word timings.
// The visual text is rendered per character, but the parser timing is per word;
// this bridges the two without rebuilding text ranges during playback.
export const buildCharacterRevealTimes = (line: Line, characters: string[]) => {
    const revealTimes = characters.map(() => Number.POSITIVE_INFINITY);
    const lineTimeline = buildLineGraphemeTimeline(line);
    if (lineTimeline.length === characters.length) {
        lineTimeline.forEach((timing, index) => {
            revealTimes[index] = timing.startTime;
        });
        return revealTimes;
    }

    const ranges = getWordTextRanges(line);
    let previousWordEndCharacterIndex = 0;
    let lastResolvedRevealTime = line.startTime;
    let hasResolvedRevealTime = false;

    line.words.forEach((word, index) => {
        const range = ranges[index];
        if (!range) {
            return;
        }

        const startCharacterIndex = splitLyricGraphemes(line.fullText.slice(0, range.start)).length;
        const endCharacterIndex = splitLyricGraphemes(line.fullText.slice(0, range.end)).length;
        const wordTimings = buildWordGraphemeTimings(word);

        // Characters between two timed words are usually spaces or sticky punctuation.
        // Reveal them with the next word so the visible text remains contiguous.
        for (let characterIndex = previousWordEndCharacterIndex; characterIndex < startCharacterIndex; characterIndex += 1) {
            revealTimes[characterIndex] = word.startTime;
        }

        wordTimings.forEach((timing, characterIndex) => {
            const targetIndex = startCharacterIndex + characterIndex;
            if (targetIndex >= revealTimes.length) {
                return;
            }

            revealTimes[targetIndex] = timing.startTime;
            lastResolvedRevealTime = Math.max(lastResolvedRevealTime, revealTimes[targetIndex]);
            hasResolvedRevealTime = true;
        });

        previousWordEndCharacterIndex = endCharacterIndex;
    });

    // Any unmatched trailing characters still belong to this line visually.
    // Attach them to the last timed character instead of waiting for line.endTime,
    // otherwise the timestamp can appear only when the next line starts.
    const trailingRevealTime = hasResolvedRevealTime ? lastResolvedRevealTime : line.endTime;
    for (let characterIndex = previousWordEndCharacterIndex; characterIndex < revealTimes.length; characterIndex += 1) {
        revealTimes[characterIndex] = trailingRevealTime;
    }

    return revealTimes;
};

// revealTimes is monotonic, so playback can resolve the visible count with O(log n)
// binary search instead of rebuilding the visible substring every frame.
export const getCharacterCountAtTime = (revealTimes: number[], currentTime: number) => {
    let low = 0;
    let high = revealTimes.length;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (revealTimes[mid] <= currentTime) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
};

export const getBubbleTargetCharacterCount = (metrics: PreparedBubbleMetrics, currentTime: number) =>
    getCharacterCountAtTime(metrics.bubbleTargetTimes, currentTime);

export const getTimestampReadyTime = (metrics: PreparedBubbleMetrics | null, line: Line) =>
    metrics?.timestampReadyTime ?? line.endTime;

// Builds the CSS fade duration for each character. The timestamp uses the same
// values so it appears after the last visible character has finished fading in.
export const buildCharacterFadeDurationsMs = (line: Line, characters: string[]) => {
    const fadeDurationsMs = characters.map(() => DEFAULT_CHAR_FADE_MS);
    const lineTimeline = buildLineGraphemeTimeline(line);
    if (lineTimeline.length === characters.length) {
        lineTimeline.forEach((timing, index) => {
            fadeDurationsMs[index] = Math.max((timing.endTime - timing.startTime) * 1000, MIN_CHAR_FADE_MS);
        });
        return fadeDurationsMs;
    }

    const ranges = getWordTextRanges(line);

    line.words.forEach((word, index) => {
        const range = ranges[index];
        if (!range) {
            return;
        }

        const startCharacterIndex = splitLyricGraphemes(line.fullText.slice(0, range.start)).length;
        const wordTimings = buildWordGraphemeTimings(word);

        for (let characterIndex = 0; characterIndex < wordTimings.length; characterIndex += 1) {
            const targetIndex = startCharacterIndex + characterIndex;
            if (targetIndex >= fadeDurationsMs.length) {
                break;
            }

            const timing = wordTimings[characterIndex];
            fadeDurationsMs[targetIndex] = timing
                ? Math.max((timing.endTime - timing.startTime) * 1000, MIN_CHAR_FADE_MS)
                : DEFAULT_CHAR_FADE_MS;
        }
    });

    return fadeDurationsMs;
};

export const getTimestampReadyTimeFromMetrics = (
    line: Line,
    revealTimes: number[],
    fadeDurationsMs: number[]
) => {
    if (revealTimes.length === 0) {
        return line.endTime;
    }

    return revealTimes.reduce((latest, time, index) => {
        if (!Number.isFinite(time)) {
            return latest;
        }

        return Math.max(latest, time + (fadeDurationsMs[index] ?? DEFAULT_CHAR_FADE_MS) / 1000);
    }, line.startTime);
};

// Builds per-character fade durations while keeping the existing reveal order and entry timing.
export const getCharacterRevealPlan = (line: Line): CharacterRevealPlan => {
    const characters = Array.from(line.fullText);
    const fadeDurationsMs = buildCharacterFadeDurationsMs(line, characters);

    return { characters, fadeDurationsMs };
};

// Disabled for now: AI semantic word coloring reduced bubble-text readability in cappella.
// const getActiveColor = (wordText: string, theme: Theme) => {
//     if (!theme.wordColors || theme.wordColors.length === 0) {
//         return null;
//     }
//
//     const cleanCurrent = wordText.trim();
//     const matched = theme.wordColors.find(entry => {
//         const target = entry.word;
//         if (isCJK(cleanCurrent)) {
//             return target.includes(cleanCurrent) || cleanCurrent.includes(target);
//         }
//
//         const targetWords = target.split(/\s+/).map(value => value.toLowerCase().replace(/[^\w]/g, ''));
//         const normalizedCurrent = cleanCurrent.toLowerCase().replace(/[^\w]/g, '');
//         return targetWords.includes(normalizedCurrent);
//     });
//
//     return matched?.color ?? null;
// };
