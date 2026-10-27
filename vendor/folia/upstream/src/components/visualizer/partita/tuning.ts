import { DEFAULT_PARTITA_TUNING, type PartitaTuning } from '../../../types';
import { defineVisualizerTuning, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/partita/tuning.ts
// Partita's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'partitaTuning', 'handleSetPartitaTuning', 'handleResetPartitaTuning', PartitaTuning> {}
}

/** A stagger runs from 0 to 180. */
const stagger = (value: number, fallback: number) => (Number.isFinite(value) ? Math.min(180, Math.max(0, value)) : fallback);

/** The tuning `values` ask for, with `base` where they say nothing: the two staggers in range, the smaller one first. */
const resolve = (values: Partial<PartitaTuning>, base: PartitaTuning): PartitaTuning => {
    const rawMin = stagger(values.staggerMin ?? base.staggerMin, base.staggerMin);
    const rawMax = stagger(values.staggerMax ?? base.staggerMax, base.staggerMax);

    return {
        showGuideLines: values.showGuideLines ?? base.showGuideLines,
        useSemanticLayout: values.useSemanticLayout ?? base.useSemanticLayout,
        staggerMin: Math.min(rawMin, rawMax),
        staggerMax: Math.max(rawMin, rawMax),
    };
};

export default defineVisualizerTuning<PartitaTuning>({
    mode: 'partita',
    defaults: DEFAULT_PARTITA_TUNING,
    settingsKey: 'partitaTuning',
    settingsSetterKey: 'handleSetPartitaTuning',
    settingsResetterKey: 'handleResetPartitaTuning',
    storage: {
        key: 'partita_tuning',
        read: (stored: Partial<PartitaTuning>) => resolve(stored, DEFAULT_PARTITA_TUNING),
        merge: (held, patch) => resolve(patch, held),
        resetNotice: 'notifications.partitaReset',
    },
    apply: (props, tuning) => ({ ...props, partitaTuning: tuning }),
});
