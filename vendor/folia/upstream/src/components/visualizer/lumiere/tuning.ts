// Copyright (c) 2026 chthollyphile
import { DEFAULT_LUMIERE_TUNING, type LumiereTuning } from '../../../types';
import { normalizeLumiereTuning } from '../../../utils/lumiereTuning';
import { defineVisualizerTuning, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/lumiere/tuning.ts
// 绘光's tuning: its defaults, the settings store fields it lives in, where it is stored and how
// a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'lumiereTuning', 'handleSetLumiereTuning', 'handleResetLumiereTuning', LumiereTuning> {}
}

export default defineVisualizerTuning<LumiereTuning>({
    mode: 'lumiere',
    defaults: DEFAULT_LUMIERE_TUNING,
    settingsKey: 'lumiereTuning',
    settingsSetterKey: 'handleSetLumiereTuning',
    settingsResetterKey: 'handleResetLumiereTuning',
    storage: {
        key: 'lumiere_tuning',
        read: normalizeLumiereTuning,
        // Merge then normalize: the same clamp runs for slider drags, imports, sync and Folium.
        merge: (held, patch) => normalizeLumiereTuning({ ...held, ...patch }),
        resetNotice: 'notifications.lumiereReset',
    },
    apply: (props, tuning) => ({ ...props, lumiereTuning: tuning }),
});
