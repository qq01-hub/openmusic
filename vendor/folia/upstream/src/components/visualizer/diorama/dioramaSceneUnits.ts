import * as THREE from 'three';
import { type DioramaFrame } from './cameraPath';
import {
    DEG_TO_RAD,
    GRADIENT_HOLD_SECONDS,
    GRADIENT_TRAIL_SECONDS,
    MIN_FIT_SCALE,
    TARGET_FRAME_WIDTH_FRACTION,
    TEXT_DISSOLVE_END,
    TEXT_DISSOLVE_START,
    TEXT_FADE_IN_END,
    TEXT_FADE_IN_START,
    clamp01,
    smoothstep01,
} from './dioramaSceneConstants';

// src/components/visualizer/diorama/dioramaSceneUnits.ts
// 逐单元跟唱的纯函数（渐变能量、填色、状态重置、文字生命周期、取景缩放）与行朝向四元数。

/**
 * 渐变跟唱 energy for ONE unit at ONE instant: 0 before it is sung, easing to 1 across its own span,
 * holding, then decaying one-way to 0 - 出现 / 保持 / 衰减 / 回到底色.
 *
 * Reads ONLY this unit's own start/end time. It deliberately knows nothing about the line's progress:
 * the previous version summed a `0.25 * lineProgress` term into every sung unit, so each finished word
 * was re-tinted, brighter and brighter, by later words still being sung (measured: a line's first word
 * decayed to 0.42 and then climbed back to 0.60 over a 12s line). It also had a 0.35 floor, so a
 * finished word never reached its base colour - the whole line un-tinted together when a line-level
 * gate released, instead of each word settling on its own.
 *
 * PURE, and carries no frame-to-frame state. That is what makes seeking, looping, pausing and song
 * changes correct BY CONSTRUCTION: the colour is a function of the playback clock, so there is nothing
 * to reset and nothing that can drift out of step with it. The gate it replaces was an envelope
 * advanced by real frame delta, which kept fading the tint for seconds after a pause froze the clock.
 */
export const resolveGradientEnergy = (
    now: number,
    unit: { startTime: number; endTime: number },
): number => {
    if (now <= unit.startTime) return 0;
    if (now < unit.endTime) {
        const span = Math.max(unit.endTime - unit.startTime, 0.001);
        return smoothstep01(clamp01((now - unit.startTime) / span));
    }
    const sinceSung = now - unit.endTime;
    if (sinceSung <= GRADIENT_HOLD_SECONDS) return 1;
    return 1 - smoothstep01(clamp01((sinceSung - GRADIENT_HOLD_SECONDS) / GRADIENT_TRAIL_SECONDS));
};

/**
 * The fill colour of ONE lyric unit: its resting colour, dyed toward `target` by its OWN sung progress.
 *
 * Every unit rests at `primary` - keyword or not. `target` is the ONLY thing 关键字着色 changes, and that
 * is precisely what keeps an AI keyword hidden until the singing reaches it: at progress 0 this returns
 * exactly `primary`, so no target colour can leak ahead of the read-head, whatever colour it is. An AI
 * keyword marks what colour a word BECOMES when sung, never what colour it starts as.
 *
 * One base, one target, one interpolation - so keyword colour and follow-sing colour can never be two
 * finished colours fighting to overwrite each other. Writes into `out`; allocates nothing per frame.
 */
export const resolveDioramaUnitFill = (
    out: THREE.Color,
    primary: THREE.Color,
    target: THREE.Color,
    progress: number,
): THREE.Color => out.copy(primary).lerp(target, clamp01(progress));

/**
 * Whether the active line's per-unit state (the light/soul envelope arrays and the material ref slots)
 * must be reallocated this frame.
 *
 * The obvious trigger is a new active line. The second one is not obvious and was missing: a lyric swap
 * under a LIVE index. updateActiveSegmentLines rebuilds the active corridor IN PLACE - same globalStart,
 * same index, different words - when a slow load's lyrics arrive late or a provider reprocesses them. The
 * line changes, its unit count changes with it, and the global index does not move, so keying the reset on
 * the index alone left the envelope arrays sized for the PREVIOUS line.
 *
 * That failed silently, which is why it has a test. A Float32Array read past its end is `undefined`, not an
 * error; `undefined` then flows through the envelope step into NaN, a write of NaN past the end is
 * swallowed, and the unit's fill lerps by NaN - so every unit past the old length renders a NaN colour for
 * the rest of the line. Comparing the LENGTH catches it directly and covers the first allocation too
 * (`undefined !== count`), so there is no separate init path.
 */
export const shouldResetDioramaUnitState = (
    previousGlobalIndex: number,
    globalIndex: number,
    unitStateLength: number | undefined,
    unitCount: number,
): boolean => previousGlobalIndex !== globalIndex || unitStateLength !== unitCount;

/**
 * Distance lifecycle for a lyric plane, BOTH ends - the same shape resolveShapeLifeOpacity gives the
 * set-pieces: 0 beyond the far haze, 1 through the mid-range, dissolving again as it passes the lens.
 */
export const resolveTextLife = (distanceToCamera: number): number => {
    const farT = clamp01((TEXT_FADE_IN_END - distanceToCamera) / (TEXT_FADE_IN_END - TEXT_FADE_IN_START));
    const nearT = clamp01((distanceToCamera - TEXT_DISSOLVE_END) / (TEXT_DISSOLVE_START - TEXT_DISSOLVE_END));
    return (farT * farT * (3 - 2 * farT)) * (nearT * nearT * (3 - 2 * nearT));
};

// Uniform scale that shrinks a rendered line so it occupies at most TARGET_FRAME_WIDTH_FRACTION of
// the visible frame width at `distance`. three.js `fov` is the VERTICAL field of view.
export const resolveFrameFitScale = (
    renderedWidth: number,
    distance: number,
    verticalFovDeg: number,
    aspect: number
): number => {
    if (renderedWidth <= 0 || distance <= 0) return 1;
    const frameWidth = 2 * distance * Math.tan((verticalFovDeg * DEG_TO_RAD) / 2) * aspect;
    const targetWidth = frameWidth * TARGET_FRAME_WIDTH_FRACTION;
    return Math.min(1, Math.max(MIN_FIT_SCALE, targetWidth / renderedWidth));
};

// Reusable temporaries for building a line's text orientation from its path frame (no per-call alloc).
const _basisMatrix = new THREE.Matrix4();
const _basisQuat = new THREE.Quaternion();
const _tiltQuat = new THREE.Quaternion();
const _basisRight = new THREE.Vector3();
const _basisUp = new THREE.Vector3();
const _basisFwd = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

// Orient a line's text to face back along the path toward the trailing camera (local +X -> frame
// right, +Y -> frame up, +Z -> -forward: a proper rotation, never mirrored), then stage it with the
// placement's slight yaw and in-plane roll so the typography sits expressively rather than level.
export const frameQuaternion = (frame: DioramaFrame, roll = 0, yaw = 0): [number, number, number, number] => {
    _basisRight.set(frame.right.x, frame.right.y, frame.right.z);
    _basisUp.set(frame.up.x, frame.up.y, frame.up.z);
    _basisFwd.set(-frame.forward.x, -frame.forward.y, -frame.forward.z);
    _basisMatrix.makeBasis(_basisRight, _basisUp, _basisFwd);
    _basisQuat.setFromRotationMatrix(_basisMatrix);
    if (yaw !== 0) _basisQuat.multiply(_tiltQuat.setFromAxisAngle(_axisY, yaw));
    if (roll !== 0) _basisQuat.multiply(_tiltQuat.setFromAxisAngle(_axisZ, roll));
    return [_basisQuat.x, _basisQuat.y, _basisQuat.z, _basisQuat.w];
};
