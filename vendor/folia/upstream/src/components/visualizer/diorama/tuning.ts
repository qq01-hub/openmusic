import { DEFAULT_DIORAMA_TUNING, DIORAMA_PARTICLE_DENSITY_MAX, DIORAMA_PARTICLE_DENSITY_MIN, DIORAMA_PARTICLE_GLOW_INTENSITY_MAX, DIORAMA_PARTICLE_GLOW_INTENSITY_MIN, DIORAMA_PARTICLE_SIZE_MAX, DIORAMA_PARTICLE_SIZE_MIN, type DioramaTuning } from '../../../types';
import { defineVisualizerTuning, type StoredTuningFields } from '../tuningDefinition';
import { resolveDioramaMoteCircumference, resolveDioramaMoteRadial } from './dioramaMoteField';

// src/components/visualizer/diorama/tuning.ts
// Diorama's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'dioramaTuning', 'handleSetDioramaTuning', 'handleResetDioramaTuning', DioramaTuning> {}
}

/** A stored tuning, or a part of one, as a whole valid tuning: what is missing is the default, every number inside its range. */
export const resolveStoredDioramaTuning = (parsed: Partial<DioramaTuning>): DioramaTuning => ({
    cameraSpeed: Math.min(1.85, Math.max(0.55, parsed.cameraSpeed ?? DEFAULT_DIORAMA_TUNING.cameraSpeed)),
    motionAmount: Math.min(1.6, Math.max(0.4, parsed.motionAmount ?? DEFAULT_DIORAMA_TUNING.motionAmount)),
    audioReactivity: Math.min(1.5, Math.max(0, parsed.audioReactivity ?? DEFAULT_DIORAMA_TUNING.audioReactivity)),
    geometryVisibility: {
        enabled: parsed.geometryVisibility?.enabled ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.enabled,
        mode: parsed.geometryVisibility?.mode ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.mode,
        strands: parsed.geometryVisibility?.strands ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.strands,
        blobs: parsed.geometryVisibility?.blobs ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.blobs,
        ribbons: parsed.geometryVisibility?.ribbons ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.ribbons,
        rings: parsed.geometryVisibility?.rings ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.rings,
    },
    particleDensity: Math.round(Math.min(
        DIORAMA_PARTICLE_DENSITY_MAX,
        Math.max(DIORAMA_PARTICLE_DENSITY_MIN, parsed.particleDensity ?? DEFAULT_DIORAMA_TUNING.particleDensity),
    )),
    particleScale: Math.min(
        DIORAMA_PARTICLE_SIZE_MAX,
        Math.max(DIORAMA_PARTICLE_SIZE_MIN, parsed.particleScale ?? DEFAULT_DIORAMA_TUNING.particleScale),
    ),
    particleGlowEnabled: parsed.particleGlowEnabled ?? DEFAULT_DIORAMA_TUNING.particleGlowEnabled,
    particleGlowIntensity: Math.min(
        DIORAMA_PARTICLE_GLOW_INTENSITY_MAX,
        Math.max(
            DIORAMA_PARTICLE_GLOW_INTENSITY_MIN,
            parsed.particleGlowIntensity ?? DEFAULT_DIORAMA_TUNING.particleGlowIntensity,
        ),
    ),
    showParticles: parsed.showParticles ?? DEFAULT_DIORAMA_TUNING.showParticles,
    backgroundParticleCircumference: resolveDioramaMoteCircumference(
        parsed.backgroundParticleCircumference ?? DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
    ),
    backgroundParticleRadial: resolveDioramaMoteRadial(
        parsed.backgroundParticleRadial ?? DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
    ),
    glowEnabled: parsed.glowEnabled ?? DEFAULT_DIORAMA_TUNING.glowEnabled,
    glowIntensity: Math.min(1.5, Math.max(0.1, parsed.glowIntensity ?? DEFAULT_DIORAMA_TUNING.glowIntensity)),
    soulEnabled: parsed.soulEnabled ?? DEFAULT_DIORAMA_TUNING.soulEnabled,
    soulIntensity: Math.min(1.5, Math.max(0.1, parsed.soulIntensity ?? DEFAULT_DIORAMA_TUNING.soulIntensity)),
    soulActiveEnabled: parsed.soulActiveEnabled ?? DEFAULT_DIORAMA_TUNING.soulActiveEnabled,
    gradientEnabled: parsed.gradientEnabled ?? DEFAULT_DIORAMA_TUNING.gradientEnabled,
    gradientIntensity: Math.min(1.5, Math.max(0.1, parsed.gradientIntensity ?? DEFAULT_DIORAMA_TUNING.gradientIntensity)),
    keywordColoringEnabled: parsed.keywordColoringEnabled ?? DEFAULT_DIORAMA_TUNING.keywordColoringEnabled,
});

export default defineVisualizerTuning<DioramaTuning>({
    mode: 'diorama',
    defaults: DEFAULT_DIORAMA_TUNING,
    settingsKey: 'dioramaTuning',
    settingsSetterKey: 'handleSetDioramaTuning',
    settingsResetterKey: 'handleResetDioramaTuning',
    storage: {
        key: 'diorama_tuning',
        read: resolveStoredDioramaTuning,
        // A change may name some of the geometry's kinds only: the others stay as they are held.
        merge: (held, patch) => resolveStoredDioramaTuning({
            ...held,
            ...patch,
            geometryVisibility: patch.geometryVisibility
                ? { ...held.geometryVisibility, ...patch.geometryVisibility }
                : held.geometryVisibility,
        }),
        resetNotice: 'notifications.dioramaReset',
    },
    apply: (props, tuning) => ({ ...props, dioramaTuning: tuning }),
});
