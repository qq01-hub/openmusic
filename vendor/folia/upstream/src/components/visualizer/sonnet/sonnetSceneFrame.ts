import type { SonnetProgram } from './types';
import { hashSonnetSeed } from './sonnetRandom';
import {
    IDLE_SONNET_TRANSITION_FRAME,
    resolveSonnetEnterTransitionFrame,
    resolveSonnetExitTransitionFrame,
    resolveSonnetShotTransitionFrame,
} from './sonnetTransitions';
import type { SceneView } from './sonnetSceneBuilder';

// src/components/visualizer/sonnet/sonnetSceneFrame.ts
// 段落场景级的逐帧决策（纯函数）：场景内哪个 shot 可见，以及这一帧用 shot 转场还是段落入场 / 出场转场。

/** Strictly determine the single active shot within this scene to avoid intra-scene residues. */
export const findSonnetActiveShotIndex = (scene: SceneView, time: number) => {
    let activeShotIndex = 0;
    for (let i = scene.shots.length - 1; i >= 0; i--) {
        if (time >= scene.shots[i].shot.startTime) {
            activeShotIndex = i;
            break;
        }
    }
    return activeShotIndex;
};

/**
 * The transition frame the active paragraph scene is posed with: a shot-boundary transition
 * when one is running, otherwise the paragraph's own enter or exit transition.
 */
export const resolveSonnetSceneTransitionFrame = (
    program: SonnetProgram,
    scene: SceneView,
    index: number,
    visibleShotIndex: number,
    time: number,
    transitionsEnabled: boolean,
) => {
    const transitionSeed = hashSonnetSeed(`${program.seed}:${scene.paragraph.id}:transition-frame`);
    const previousTransition = index > 0
        ? program.paragraphs[index - 1]?.transitionOut
        : null;
    const enterDuration = previousTransition
        ? Math.max(0.16, Math.min(0.3, previousTransition.endTime - previousTransition.startTime))
        : 0;
    const entering = transitionsEnabled
        && previousTransition !== null
        && time >= scene.paragraph.startTime
        && time <= scene.paragraph.startTime + enterDuration;
    const paragraphTransitionFrame = entering
        ? resolveSonnetEnterTransitionFrame(
            previousTransition.kind,
            time - scene.paragraph.startTime,
            enterDuration,
            true,
            transitionSeed,
        )
        : resolveSonnetExitTransitionFrame(
            scene.paragraph,
            time,
            transitionsEnabled,
            transitionSeed,
        );

    const shotTransitionFrame = resolveSonnetShotTransitionFrame(
        scene.shotTimeline,
        visibleShotIndex,
        time,
        transitionsEnabled,
        transitionSeed,
    );
    return shotTransitionFrame !== IDLE_SONNET_TRANSITION_FRAME
        ? shotTransitionFrame
        : paragraphTransitionFrame;
};
