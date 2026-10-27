import { DEFAULT_PENDOLO_TUNING, type PendoloTuning } from '../../../types';
import { defineVisualizerTuning, numberWithin, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/pendolo/tuning.ts
// Pendolo's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'pendoloTuning', 'handleSetPendoloTuning', 'handleResetPendoloTuning', PendoloTuning> {}
}

/** The tuning `values` ask for, with `base` where they say nothing or something that cannot be: every number inside its range. */
const resolve = (values: Partial<PendoloTuning>, base: PendoloTuning): PendoloTuning => ({
    arcRadius: numberWithin(values.arcRadius, base.arcRadius, 0.25, 0.80),
    arcAngleDeg: numberWithin(values.arcAngleDeg, base.arcAngleDeg, 40, 160),
    wheelCenterX: numberWithin(values.wheelCenterX, base.wheelCenterX, -0.30, 0.50),
    wheelCenterY: numberWithin(values.wheelCenterY, base.wheelCenterY, 0.20, 0.80),
    tickSnappiness: numberWithin(values.tickSnappiness, base.tickSnappiness, 0.5, 2.0),
    activeScale: numberWithin(values.activeScale, base.activeScale, 1.00, 1.60),
    showGearDecor: values.showGearDecor === 'none' || values.showGearDecor === 'subtle' || values.showGearDecor === 'full'
        ? values.showGearDecor
        : base.showGearDecor,
    showCenterGradient: typeof values.showCenterGradient === 'boolean'
        ? values.showCenterGradient
        : base.showCenterGradient ?? DEFAULT_PENDOLO_TUNING.showCenterGradient,
    showCoverOnWatchFace: typeof values.showCoverOnWatchFace === 'boolean'
        ? values.showCoverOnWatchFace
        : base.showCoverOnWatchFace ?? DEFAULT_PENDOLO_TUNING.showCoverOnWatchFace,
    enableLineGlow: typeof values.enableLineGlow === 'boolean'
        ? values.enableLineGlow
        : base.enableLineGlow ?? DEFAULT_PENDOLO_TUNING.enableLineGlow,
});

export default defineVisualizerTuning<PendoloTuning>({
    mode: 'pendolo',
    defaults: DEFAULT_PENDOLO_TUNING,
    settingsKey: 'pendoloTuning',
    settingsSetterKey: 'handleSetPendoloTuning',
    settingsResetterKey: 'handleResetPendoloTuning',
    storage: {
        key: 'pendolo_tuning',
        read: (stored: Partial<PendoloTuning>) => resolve(stored, DEFAULT_PENDOLO_TUNING),
        merge: (held, patch) => resolve(patch, held),
        resetNotice: 'notifications.pendoloReset',
    },
    apply: (props, tuning) => ({ ...props, pendoloTuning: tuning }),
});
