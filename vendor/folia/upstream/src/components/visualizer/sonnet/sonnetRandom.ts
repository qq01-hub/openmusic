// src/components/visualizer/sonnet/sonnetRandom.ts
// Supplies deterministic selection without relying on process-global random state.
export {
    hashVisualizerSeed as hashSonnetSeed,
    // Mixes a numeric seed with a salt so different sub-systems (geo variant,
    // background HUD, fixed geo, decor, per-particle jitter) stay decorrelated.
    mixVisualizerSeed as mixSonnetSeed,
    // Deterministic 0..1 jitter per element index; seek-safe and rebuild-stable.
    visualizerHash01 as sonnetHash01,
} from '../visualizerSeedHash';
