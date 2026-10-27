import { hashVisualizerSeed } from '../visualizerSeedHash';

// src/components/visualizer/tempera/temperaRandom.ts
// Supplies deterministic selection without relying on process-global random state.
export {
    hashVisualizerSeed as hashTemperaSeed,
    // Mixes a numeric seed with a salt so different sub-systems (blocks, decor,
    // per-glyph jitter) stay decorrelated.
    mixVisualizerSeed as mixTemperaSeed,
    // Deterministic 0..1 jitter per element index; seek-safe and rebuild-stable.
    visualizerHash01 as temperaHash01,
} from '../visualizerSeedHash';

// Picks a deterministic choice that differs from the previous pick when possible.
export const chooseWithoutRepeat = <T extends string>(choices: readonly T[], seed: string, previous: T | null): T => {
    const start = hashVisualizerSeed(seed) % choices.length;
    for (let offset = 0; offset < choices.length; offset += 1) {
        const candidate = choices[(start + offset) % choices.length];
        if (candidate !== previous) return candidate;
    }
    return choices[start];
};
