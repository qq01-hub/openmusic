import { type Theme } from '../../../types';
import type { CappellaIntensityConfig } from './cappellaTypes';

// src/components/visualizer/cappella/cappellaIntensity.ts
// 按主题动画强度（calm / normal / chaotic）给出气泡动画、缩放、glow 等参数。

export const getCappellaIntensityConfig = (animationIntensity: Theme['animationIntensity']): CappellaIntensityConfig => {
    if (animationIntensity === 'calm') {
        return {
            sequencing: {
                forceRightEveryLines: 7,
                shortLineCarryChance: 0.92,
                sideSequence: ['left', 'left', 'right', 'left', 'right'],
                sideFlipChance: 0.08,
                randomEmoChance: 0,
                minLinesBetweenRandomEmos: 6,
                maxRandomEmoRatio: 0,
            },
            motion: {
                rowEnterY: 14,
                rowEnterScale: 0.992,
                rowEnterDuration: 0.28,
                rowExitY: -10,
                rowExitScale: 0.985,
                rowExitDuration: 0.22,
                avatarSpring: { stiffness: 280, damping: 30, mass: 0.78 },
                activeScale: 1.07,
                passedScale: 0.96,
                passedOpacity: 0.88,
                activeFontMultiplier: 1.22,
                inactiveFontMultiplier: 0.96,
                activePaddingX: 18,
                activePaddingY: 14,
                inactivePaddingX: 16,
                inactivePaddingY: 12,
                activeMinHeight: 58,
                inactiveMinHeight: 44,
                glowOpacity: 0.26,
                glowDuration: 2.2,
                glowRightAlpha: 0.26,
                glowLeftAlpha: 0.14,
                activeShadowAlpha: 0.24,
                emoActiveSize: 132,
                emoInactiveSize: 96,
                emoEnterScale: 0.74,
                emoSizeTransitionDuration: 0.22,
            },
        };
    }

    if (animationIntensity === 'chaotic') {
        return {
            sequencing: {
                forceRightEveryLines: 3,
                shortLineCarryChance: 0.36,
                sideSequence: ['left', 'right', 'right', 'left', 'right', 'left'],
                sideFlipChance: 0.42,
                randomEmoChance: 0.22,
                minLinesBetweenRandomEmos: 2,
                maxRandomEmoRatio: 1 / 6,
            },
            motion: {
                rowEnterY: 30,
                rowEnterScale: 0.968,
                rowEnterDuration: 0.38,
                rowExitY: -26,
                rowExitScale: 0.94,
                rowExitDuration: 0.28,
                avatarSpring: { stiffness: 360, damping: 24, mass: 0.68 },
                activeScale: 1.18,
                passedScale: 0.88,
                passedOpacity: 0.76,
                activeFontMultiplier: 1.4,
                inactiveFontMultiplier: 0.92,
                activePaddingX: 22,
                activePaddingY: 17,
                inactivePaddingX: 15,
                inactivePaddingY: 11,
                activeMinHeight: 68,
                inactiveMinHeight: 42,
                glowOpacity: 0.52,
                glowDuration: 1.35,
                glowRightAlpha: 0.42,
                glowLeftAlpha: 0.24,
                activeShadowAlpha: 0.42,
                emoActiveSize: 178,
                emoInactiveSize: 122,
                emoEnterScale: 0.54,
                emoSizeTransitionDuration: 0.28,
            },
        };
    }

    return {
        sequencing: {
            forceRightEveryLines: 5,
            shortLineCarryChance: 0.68,
            sideSequence: ['left', 'right', 'left', 'right', 'right'],
            sideFlipChance: 0.18,
            randomEmoChance: 0.1,
            minLinesBetweenRandomEmos: 3,
            maxRandomEmoRatio: 1 / 8,
        },
        motion: {
            rowEnterY: 22,
            rowEnterScale: 0.98,
            rowEnterDuration: 0.32,
            rowExitY: -18,
            rowExitScale: 0.965,
            rowExitDuration: 0.24,
            avatarSpring: { stiffness: 340, damping: 28, mass: 0.72 },
            activeScale: 1.12,
            passedScale: 0.92,
            passedOpacity: 0.82,
            activeFontMultiplier: 1.34,
            inactiveFontMultiplier: 0.94,
            activePaddingX: 20,
            activePaddingY: 16,
            inactivePaddingX: 16,
            inactivePaddingY: 12,
            activeMinHeight: 64,
            inactiveMinHeight: 44,
            glowOpacity: 0.4,
            glowDuration: 1.8,
            glowRightAlpha: 0.34,
            glowLeftAlpha: 0.18,
            activeShadowAlpha: 0.34,
            emoActiveSize: 160,
            emoInactiveSize: 110,
            emoEnterScale: 0.6,
            emoSizeTransitionDuration: 0.25,
        },
    };
};
