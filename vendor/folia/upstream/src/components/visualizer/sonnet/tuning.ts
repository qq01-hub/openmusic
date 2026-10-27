import { DEFAULT_SONNET_TUNING, type SonnetTuning } from '../../../types';
import { defineVisualizerTuning, numberWithin, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/sonnet/tuning.ts
// Sonnet's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'sonnetTuning', 'handleSetSonnetTuning', 'handleResetSonnetTuning', SonnetTuning> {}
}

const switchOr = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/** The tuning `values` ask for, with `base` where they say nothing or something that cannot be: every number inside its range. */
const resolve = (values: Partial<SonnetTuning>, base: SonnetTuning): SonnetTuning => ({
    cameraIntensity: numberWithin(values.cameraIntensity, base.cameraIntensity, 0, 2),
    typographyMotion: numberWithin(values.typographyMotion, base.typographyMotion, 0, 2),
    mgDensity: numberWithin(values.mgDensity, base.mgDensity, 0, 2),
    showOnlyText: switchOr(values.showOnlyText, base.showOnlyText),
    showGuide: switchOr(values.showGuide, base.showGuide),
    showBackgroundMg: switchOr(values.showBackgroundMg, base.showBackgroundMg),
    showFixedGeo: switchOr(values.showFixedGeo, base.showFixedGeo),
    showGiantDecorativeText: switchOr(values.showGiantDecorativeText, base.showGiantDecorativeText),
    showBackgroundDecor: switchOr(values.showBackgroundDecor, base.showBackgroundDecor),
    enableTransitions: switchOr(values.enableTransitions, base.enableTransitions),
    outerFrameMode: values.outerFrameMode === 'none'
        || values.outerFrameMode === 'frame'
        || values.outerFrameMode === 'full'
        ? values.outerFrameMode
        : base.outerFrameMode,
    textureResolution: numberWithin(values.textureResolution, base.textureResolution, 0.5, 4),
    postProcessEnabled: switchOr(values.postProcessEnabled, base.postProcessEnabled),
    postProcessGrain: numberWithin(values.postProcessGrain, base.postProcessGrain, 0, 1),
    postProcessContrast: numberWithin(values.postProcessContrast, base.postProcessContrast, 0, 1),
    postProcessRgbShift: numberWithin(values.postProcessRgbShift, base.postProcessRgbShift, 0, 1),
    postProcessHalftone: numberWithin(values.postProcessHalftone, base.postProcessHalftone, 0, 1),
    postProcessVignette: numberWithin(values.postProcessVignette, base.postProcessVignette, 0, 2),
    postProcessLensDistortion: numberWithin(values.postProcessLensDistortion, base.postProcessLensDistortion, 0, 2),
    postProcessLensDispersion: numberWithin(values.postProcessLensDispersion, base.postProcessLensDispersion, 0, 1),
});

export default defineVisualizerTuning<SonnetTuning>({
    mode: 'sonnet',
    defaults: DEFAULT_SONNET_TUNING,
    settingsKey: 'sonnetTuning',
    settingsSetterKey: 'handleSetSonnetTuning',
    settingsResetterKey: 'handleResetSonnetTuning',
    storage: {
        key: 'sonnet_tuning',
        read: (stored: Partial<SonnetTuning>) => resolve(stored, DEFAULT_SONNET_TUNING),
        merge: (held, patch) => resolve(patch, held),
        resetNotice: 'notifications.sonnetReset',
    },
    apply: (props, tuning) => ({ ...props, sonnetTuning: tuning }),
});
