/**
 * Mineradio 摄像头手势 — MediaPipe Tasks HandLandmarker
 * 手掌推开 · 捏合旋转 · 握拳收束
 */
import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { PLANE_SIZE } from './particleGeometry';
import {
  gestureRotation,
  particleSpin,
} from './galaxyGestureRotation';
import { particleLocalPointFromNdc } from './galaxyParticlePointer';
import { unlockGalaxyOrbitCenter, galaxyOrbitRef } from './galaxyOrbit';
import {
  clearGalaxyHandGestureStartup,
  setGalaxyHandGestureStartup,
  type GestureStartupPhase,
} from './galaxyHandGestureStartup';
import { isHostPageHidden, subscribeHostVisibility } from '../../../hooks/useVisualRenderPolicy';

const HAND_SMOOTH_ALPHA = 0.35;
const PARTICLE_HAND_SPIN_X = 4.15;
const PARTICLE_HAND_SPIN_Y = 4.3;
const MODEL_LOAD_TIMEOUT_MS = 30_000;
const VISION_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Landmark = { x: number; y: number; z?: number };

export type GestureHudState = {
  visible: boolean;
  label: string;
  progress: number;
  detail: string;
};

export type HandSkeletonFrame = {
  landmarks: Landmark[];
  isPinch: boolean;
  isFist: boolean;
  openness: number;
};

export const galaxyHandGestureLive = {
  handX: -999,
  handY: -999,
  handActive: 0,
  gestureGrip: 0,
  active: false,
  hud: {
    visible: false,
    label: '待命',
    progress: 0,
    detail: '把手放进视野',
  } as GestureHudState,
  skeleton: null as HandSkeletonFrame | null,
};

let gestureVideo: HTMLVideoElement | null = null;
let handLandmarker: HandLandmarker | null = null;
let landmarkerInitPromise: Promise<HandLandmarker> | null = null;
let rafId = 0;
let lastVideoTime = -1;
let handLmSmooth: Landmark[] | null = null;
let handLmLastSeen = 0;
const pinchState = { active: false, lastX: 0, lastY: 0, lastT: 0 };
const gestureGrip = { value: 0, target: 0, openness: 1, lastState: 'open', pulse: 0 };

let burstCallback: ((amount: number) => void) | null = null;
let cameraRef: THREE.Camera | null = null;

let desiredMode: 'off' | 'gesture' = 'off';
let startPromise: Promise<boolean> | null = null;
let syncGeneration = 0;

const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

function clampRange(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampParticleSpinVelocity(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-6.2, Math.min(6.2, v));
}

export function registerGalaxyGestureCamera(camera: THREE.Camera | null): void {
  cameraRef = camera;
}

export function registerGalaxyGestureBurst(cb: ((amount: number) => void) | null): void {
  burstCallback = cb;
}

function showGestureHUD(label: string, progress: number, detail: string): void {
  galaxyHandGestureLive.hud = {
    visible: true,
    label: label || '待命',
    progress: clampRange(progress, 0, 1),
    detail: detail || '将手放进摄像头视野',
  };
}

function hideGestureHUD(): void {
  galaxyHandGestureLive.hud.visible = false;
}

function palmCenter(lm: Landmark[]): { x: number; y: number } {
  const px = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
  const py = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
  return { x: px, y: py };
}

function handOpenness(lm: Landmark[], palm: { x: number; y: number }): number {
  const span = Math.max(0.055, Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y));
  const tips = [8, 12, 16, 20];
  let avg = 0;
  for (const i of tips) avg += Math.hypot(lm[i].x - palm.x, lm[i].y - palm.y);
  avg /= tips.length;
  return clampRange((avg / span - 0.62) / 0.78, 0, 1);
}

function smoothLandmarks(lm: Landmark[]): Landmark[] {
  if (!handLmSmooth) {
    handLmSmooth = lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z || 0 }));
    return handLmSmooth;
  }
  const a = HAND_SMOOTH_ALPHA;
  for (let i = 0; i < 21; i++) {
    const pt = handLmSmooth[i];
    if (!pt) continue;
    const srcX = 1 - lm[i].x;
    pt.x += (srcX - pt.x) * a;
    pt.y += (lm[i].y - pt.y) * a;
    pt.z = (pt.z ?? 0) + (((lm[i].z || 0) - (pt.z ?? 0)) * a);
  }
  return handLmSmooth;
}

function onHandLost(): void {
  if (pinchState.active) pinchState.active = false;
  gestureGrip.target = 0;
  galaxyHandGestureLive.handActive *= 0.9;
  if (galaxyHandGestureLive.handActive < 0.02) galaxyHandGestureLive.handActive = 0;
  if (performance.now() - handLmLastSeen > 600) {
    handLmSmooth = null;
    galaxyHandGestureLive.skeleton = null;
    showGestureHUD('待命', 0, '把手放进视野');
  }
}

function processHandFrame(rawLm: Landmark[]): void {
  handLmLastSeen = performance.now();
  const lm = smoothLandmarks(rawLm);
  const palm = palmCenter(lm);
  const openness = handOpenness(lm, palm);
  gestureGrip.openness += (openness - gestureGrip.openness) * 0.28;
  const gripTarget = clampRange(1 - openness, 0, 1);
  gestureGrip.target = gripTarget > 0.55 ? gripTarget : 0;

  const ndcX = palm.x * 2 - 1;
  const ndcY = -(palm.y * 2 - 1);
  let handLocalX = ndcX * PLANE_SIZE * 0.62;
  let handLocalY = ndcY * PLANE_SIZE * 0.62;
  const localHit = new THREE.Vector3();
  if (cameraRef && particleLocalPointFromNdc(ndcX, ndcY, localHit, cameraRef)) {
    handLocalX = localHit.x;
    handLocalY = localHit.y;
  }

  galaxyHandGestureLive.handX += (handLocalX - galaxyHandGestureLive.handX) * 0.48;
  galaxyHandGestureLive.handY += (handLocalY - galaxyHandGestureLive.handY) * 0.48;
  const tgtActive = 0.44 + openness * 0.56;
  galaxyHandGestureLive.handActive += (tgtActive - galaxyHandGestureLive.handActive) * 0.26;

  const pinchDist = Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y);
  const isPinch = pinchDist < 0.075 && openness > 0.28;
  const isFist = !isPinch && gripTarget > 0.68;

  if (isPinch && !pinchState.active) {
    unlockGalaxyOrbitCenter(galaxyOrbitRef.current);
    pinchState.active = true;
    pinchState.lastX = palm.x;
    pinchState.lastY = palm.y;
    pinchState.lastT = performance.now();
    particleSpin.vx = 0;
    particleSpin.vy = 0;
    gestureGrip.target = Math.min(0.34, gestureGrip.target);
    showGestureHUD('捏合拖动', 1, '移动手掌 -> 旋转封面');
  } else if (isPinch && pinchState.active) {
    unlockGalaxyOrbitCenter(galaxyOrbitRef.current);
    const dx = palm.x - pinchState.lastX;
    const dy = palm.y - pinchState.lastY;
    const nowPinch = performance.now();
    const pinchDt = Math.max(1 / 120, Math.min(0.08, (nowPinch - pinchState.lastT) / 1000 || 1 / 60));
    const spinY = dx * PARTICLE_HAND_SPIN_Y;
    const spinX = dy * PARTICLE_HAND_SPIN_X;
    gestureRotation.y += spinY;
    gestureRotation.x += spinX;
    particleSpin.vy = clampParticleSpinVelocity(spinY / pinchDt * 0.48);
    particleSpin.vx = clampParticleSpinVelocity(spinX / pinchDt * 0.48);
    pinchState.lastX = palm.x;
    pinchState.lastY = palm.y;
    pinchState.lastT = nowPinch;
    gestureGrip.target = Math.min(0.34, gestureGrip.target);
    showGestureHUD('拖动中', 1, '松手后保留惯性');
  } else if (!isPinch && pinchState.active) {
    pinchState.active = false;
    showGestureHUD('松开', 0.4, '可继续触碰或捏合');
  } else if (isFist) {
    if (gestureGrip.lastState !== 'fist') {
      gestureGrip.pulse = 1;
      burstCallback?.(0.26);
    }
    gestureGrip.lastState = 'fist';
    showGestureHUD('握拳收束', Math.max(0.55, gripTarget), '粒子向中心收缩');
  } else {
    if (gestureGrip.lastState === 'fist' && openness > 0.58) {
      burstCallback?.(0.18);
    }
    gestureGrip.lastState = openness > 0.62 ? 'open' : 'hover';
    showGestureHUD(
      openness > 0.62 ? '张开恢复' : '悬停',
      0.3 + openness * 0.34,
      '手掌推开粒子 / 捏合旋转 / 握拳收束',
    );
  }

  galaxyHandGestureLive.skeleton = { landmarks: lm.map((p) => ({ ...p })), isPinch, isFist, openness };
}

function toLandmarks(points: NormalizedLandmark[]): Landmark[] {
  return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

function publishStartup(phase: GestureStartupPhase, progress: number, label: string, gen: number): void {
  if (gen !== syncGeneration || desiredMode !== 'gesture') return;
  setGalaxyHandGestureStartup(phase, progress, label);
  showGestureHUD(label, progress, '首次开启需下载模型并授权摄像头');
}

async function ensureHandLandmarker(): Promise<HandLandmarker> {
  if (handLandmarker) return handLandmarker;
  if (!landmarkerInitPromise) {
    landmarkerInitPromise = (async () => {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(VISION_WASM_BASE);
      const create = (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: HAND_MODEL_URL,
            delegate,
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.7,
          minHandPresenceConfidence: 0.7,
          minTrackingConfidence: 0.7,
        });
      let marker: HandLandmarker;
      try {
        marker = await create('GPU');
      } catch {
        marker = await create('CPU');
      }
      handLandmarker = marker;
      return marker;
    })().catch((err) => {
      landmarkerInitPromise = null;
      handLandmarker = null;
      throw err;
    });
  }
  return withTimeout(
    landmarkerInitPromise,
    MODEL_LOAD_TIMEOUT_MS,
    '手势模型加载超时，请检查网络后重试',
  );
}

function detectLoop(): void {
  rafId = 0;
  if (!galaxyHandGestureLive.active || !gestureVideo || !handLandmarker) return;
  if (isHostPageHidden()) return;
  const video = gestureVideo;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      const result = handLandmarker.detectForVideo(video, performance.now());
      const raw = result.landmarks?.[0];
      if (!raw) {
        onHandLost();
      } else {
        processHandFrame(toLandmarks(raw));
      }
    } catch (e) {
      console.warn('Hand detect failed:', e);
    }
  }
  rafId = requestAnimationFrame(detectLoop);
}

let unsubscribeHostVisibility: (() => void) | null = null;

function syncDetectLoopVisibility(): void {
  if (!galaxyHandGestureLive.active || !gestureVideo || !handLandmarker) return;
  if (isHostPageHidden()) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    return;
  }
  if (!rafId) {
    rafId = requestAnimationFrame(detectLoop);
  }
}

/** 每帧衰减（GalaxyParticles useFrame 调用） */
export function tickGalaxyHandGesture(dt: number): void {
  gestureGrip.value +=
    (gestureGrip.target - gestureGrip.value) * (gestureGrip.target > gestureGrip.value ? 0.18 : 0.1);
  gestureGrip.pulse *= Math.pow(0.84, dt * 60);
  galaxyHandGestureLive.gestureGrip = clampRange(gestureGrip.value + gestureGrip.pulse * 0.16, 0, 1);

  if (galaxyHandGestureLive.active && handLmSmooth && performance.now() - handLmLastSeen > 200) {
    galaxyHandGestureLive.handActive *= 0.94;
    gestureGrip.target *= 0.92;
    if (galaxyHandGestureLive.handActive < 0.02) galaxyHandGestureLive.handActive = 0;
  }
}

type GestureModeListener = (mode: 'off' | 'gesture', failed?: boolean) => void;
const modeListeners = new Set<GestureModeListener>();

export function onGalaxyGestureModeChange(listener: GestureModeListener): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

function notifyModeChange(mode: 'off' | 'gesture', failed = false): void {
  modeListeners.forEach((l) => l(mode, failed));
}

function stopHardware(): void {
  unsubscribeHostVisibility?.();
  unsubscribeHostVisibility = null;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  lastVideoTime = -1;
  try {
    const stream = gestureVideo?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
  } catch {
    // ignore
  }
  try {
    gestureVideo?.remove();
  } catch {
    // ignore
  }
  gestureVideo = null;
  galaxyHandGestureLive.active = false;
  pinchState.active = false;
  handLmSmooth = null;
  galaxyHandGestureLive.handActive = 0;
  galaxyHandGestureLive.gestureGrip = 0;
  galaxyHandGestureLive.skeleton = null;
  gestureGrip.value = 0;
  gestureGrip.target = 0;
  gestureGrip.openness = 1;
  hideGestureHUD();
}

export function stopGalaxyHandGesture(): void {
  const wasActive = galaxyHandGestureLive.active;
  stopHardware();
  startPromise = null;
  clearGalaxyHandGestureStartup();
  if (wasActive) notifyModeChange('off', false);
}

async function startGalaxyHandGesture(): Promise<boolean> {
  if (galaxyHandGestureLive.active) return true;
  const gen = syncGeneration;
  try {
    publishStartup('loading-model', 0.18, '正在加载手势模型…', gen);
    await ensureHandLandmarker();
    if (gen !== syncGeneration || desiredMode !== 'gesture') return false;

    publishStartup('requesting-camera', 0.58, '正在请求摄像头权限…', gen);
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.style.display = 'none';
    document.body.appendChild(video);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: 'user' },
      audio: false,
    });
    if (gen !== syncGeneration || desiredMode !== 'gesture') {
      stream.getTracks().forEach((t) => t.stop());
      video.remove();
      return false;
    }

    publishStartup('starting', 0.86, '正在启动识别…', gen);
    video.srcObject = stream;
    await video.play();
    if (gen !== syncGeneration || desiredMode !== 'gesture') {
      stream.getTracks().forEach((t) => t.stop());
      video.remove();
      return false;
    }

    gestureVideo = video;
    galaxyHandGestureLive.active = true;
    setGalaxyHandGestureStartup('ready', 1, '手势已就绪');
    showGestureHUD('待命', 0, '把手放进视野');
    unsubscribeHostVisibility?.();
    unsubscribeHostVisibility = subscribeHostVisibility(syncDetectLoopVisibility);
    syncDetectLoopVisibility();
    clearGalaxyHandGestureStartup();
    notifyModeChange('gesture', false);

    window.dispatchEvent(
      new CustomEvent('openmusic:visual-toast', {
        detail: { message: '手势已开启: 手掌推开 · 捏合旋转 · 握拳收束', type: 'success' },
      }),
    );
    return true;
  } catch (e) {
    console.warn('Gesture failed:', e);
    stopHardware();
    if (gen === syncGeneration) clearGalaxyHandGestureStartup();
    return false;
  }
}

export async function syncGalaxyHandGestureMode(mode: 'off' | 'gesture'): Promise<void> {
  desiredMode = mode;
  syncGeneration += 1;
  const gen = syncGeneration;

  if (mode === 'off') {
    stopGalaxyHandGesture();
    return;
  }

  if (galaxyHandGestureLive.active) return;

  // 等待进行中的启动结束后，若仍需开启则重试（修复代际竞态导致的假死）
  while (startPromise) {
    await startPromise;
    if (gen !== syncGeneration) return;
    if (galaxyHandGestureLive.active || desiredMode !== 'gesture') return;
  }

  if (galaxyHandGestureLive.active || desiredMode !== 'gesture' || gen !== syncGeneration) return;

  const run = startGalaxyHandGesture();
  startPromise = run.finally(() => {
    if (startPromise === run) startPromise = null;
  });
  const ok = await startPromise;
  if (!ok && gen === syncGeneration && desiredMode === 'gesture' && !galaxyHandGestureLive.active) {
    clearGalaxyHandGestureStartup();
    notifyModeChange('off', true);
  }
}

export function getHandBonePairs(): [number, number][] {
  return HAND_BONES;
}
