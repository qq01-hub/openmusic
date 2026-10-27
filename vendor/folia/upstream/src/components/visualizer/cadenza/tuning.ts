import { DEFAULT_CADENZA_TUNING, type CadenzaTuning } from '../../../types';
import { defineVisualizerTuning, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/cadenza/tuning.ts
// Cadenza's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'cadenzaTuning', 'handleSetCadenzaTuning', 'handleResetCadenzaTuning', CadenzaTuning> {}
}

export default defineVisualizerTuning<CadenzaTuning>({
    mode: 'cadenza',
    defaults: DEFAULT_CADENZA_TUNING,
    settingsKey: 'cadenzaTuning',
    settingsSetterKey: 'handleSetCadenzaTuning',
    settingsResetterKey: 'handleResetCadenzaTuning',
    storage: {
        key: 'cadenza_tuning',
        // The style was once spelled "cadenze".
        olderKeys: ['cadenze_tuning'],
        // The beam is gone from the style: whatever was stored or is asked for, it stays 0.
        read: (stored: Partial<CadenzaTuning>) => ({ ...DEFAULT_CADENZA_TUNING, ...stored, beamIntensity: 0 }),
        merge: (held, patch) => ({ ...held, ...patch, beamIntensity: 0 }),
        resetNotice: 'notifications.cadenzaReset',
    },
    apply: (props, tuning) => ({ ...props, cadenzaTuning: tuning }),
});
