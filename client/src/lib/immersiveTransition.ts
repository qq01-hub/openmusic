import type { QueueItem } from '../types';
import type { RoomVisualMode } from './roomVisualPreset';
import { shouldProxySongPlaybackUrl } from './roomVisualPreset';
import {
  preloadImmersiveBackground,
  preloadImage,
  reloadImmersiveTrackProxy,
  type PrepareImmersiveEnterOptions,
} from './immersiveEntry';
import { getCoverUrl } from '../api/music';
import { ensureGalaxyAudioOutput } from '../components/galaxy/lib/galaxyAudio';
import { resetSharedAudioElement } from './audioElement';
import { useAudioStore } from '../stores/audioStore';
import { waitForCurrentTrackReady } from './immersiveEntry';

/** 沉浸过渡时序（JS 等待与 CSS 动画共用） */
export const IMMERSIVE_TIMING = {
  // 适当保留转场质感，但避免进入/退出沉浸时出现明显“人为卡顿”
  revealInMs: 920,
  revealOutMs: 860,
  minLoadingMs: 220,
  fadeInMs: 520,
  panelInMs: 680,
  stepTransitionMs: 320,
} as const;

export const IMMERSIVE_REVEAL_IN_MS = IMMERSIVE_TIMING.revealInMs;
export const IMMERSIVE_REVEAL_OUT_MS = IMMERSIVE_TIMING.revealOutMs;
export const IMMERSIVE_MIN_LOADING_MS = IMMERSIVE_TIMING.minLoadingMs;

export function immersiveTimingCssVars(): Record<string, string> {
  return {
    '--immersive-fade-in': `${IMMERSIVE_TIMING.fadeInMs}ms`,
    '--immersive-reveal-in': `${IMMERSIVE_TIMING.revealInMs}ms`,
    '--immersive-reveal-out': `${IMMERSIVE_TIMING.revealOutMs}ms`,
    '--immersive-panel-in': `${IMMERSIVE_TIMING.panelInMs}ms`,
    '--immersive-step-transition': `${IMMERSIVE_TIMING.stepTransitionMs}ms`,
  };
}

export type ImmersiveStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface ImmersiveStep {
  id: string;
  label: string;
  status: ImmersiveStepStatus;
}

export type ImmersiveTransitionDirection = 'enter' | 'exit';

export interface ImmersiveTransitionState {
  direction: ImmersiveTransitionDirection;
  phase: 'loading' | 'reveal';
  steps: ImmersiveStep[];
}

export function createEnterSteps(needsCover: boolean, needsAudioPrep: boolean): ImmersiveStep[] {
  const steps: ImmersiveStep[] = [{ id: 'visual', label: '视觉引擎', status: 'pending' }];
  if (needsCover) steps.push({ id: 'cover', label: '封面纹理', status: 'pending' });
  if (needsAudioPrep) {
    steps.push({ id: 'audio', label: '音频分析', status: 'pending' });
    steps.push({ id: 'sync', label: '播放同步', status: 'pending' });
  } else {
    steps.push({ id: 'audio', label: '音频链路', status: 'pending' });
  }
  return steps;
}

export function createExitSteps(switchToCover: boolean): ImmersiveStep[] {
  if (switchToCover) {
    return [
      { id: 'ui', label: '界面收束', status: 'pending' },
      { id: 'audio', label: '音频重建', status: 'pending' },
      { id: 'bg', label: '背景切换', status: 'pending' },
    ];
  }
  return [
    { id: 'ui', label: '界面收束', status: 'pending' },
    { id: 'audio', label: '音频链路', status: 'pending' },
  ];
}

export function patchImmersiveStep(
  steps: ImmersiveStep[],
  id: string,
  status: ImmersiveStepStatus,
): ImmersiveStep[] {
  return steps.map((step) => (step.id === id ? { ...step, status } : step));
}

export function advanceImmersiveStep(
  steps: ImmersiveStep[],
  nextId: string,
): ImmersiveStep[] {
  let foundNext = false;
  return steps.map((step) => {
    if (step.id === nextId) {
      foundNext = true;
      return { ...step, status: 'active' };
    }
    if (!foundNext && step.status === 'active') {
      return { ...step, status: 'done' };
    }
    return step;
  });
}

export function finishImmersiveSteps(steps: ImmersiveStep[]): ImmersiveStep[] {
  return steps.map((step) =>
    step.status === 'error' ? step : { ...step, status: 'done' as const },
  );
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function ensureMinimumLoadingDuration(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  const remaining = IMMERSIVE_MIN_LOADING_MS - elapsed;
  if (remaining > 0) await waitMs(remaining);
}

export interface RunImmersiveEnterPrepOptions extends PrepareImmersiveEnterOptions {
  needsCover: boolean;
  needsModeSwitch: boolean;
  mode?: RoomVisualMode;
  onStepsChange: (steps: ImmersiveStep[]) => void;
  steps: ImmersiveStep[];
  applyVisualMode: (
    mode: RoomVisualMode,
    options?: { notifyProxyChange?: boolean; reloadAudio?: boolean },
  ) => void;
}

/** 分步就绪：全部完成后才允许进入 reveal 阶段 */
export async function runImmersiveEnterPrep(options: RunImmersiveEnterPrepOptions): Promise<void> {
  const {
    song,
    needsProxyReload,
    needsCover,
    needsModeSwitch,
    mode,
    onStepsChange,
    steps,
    applyVisualMode,
  } = options;

  let current = advanceImmersiveStep(steps, 'visual');
  onStepsChange(current);

  try {
    if (needsModeSwitch) {
      applyVisualMode('emily', { notifyProxyChange: false });
    }

    await preloadImmersiveBackground(mode ?? 'emily');
    current = patchImmersiveStep(current, 'visual', 'done');
    onStepsChange(current);

    if (needsCover && song) {
      current = advanceImmersiveStep(current, 'cover');
      onStepsChange(current);
      await preloadImage(getCoverUrl(song, 'medium'));
      current = patchImmersiveStep(current, 'cover', 'done');
      onStepsChange(current);
    }

    current = advanceImmersiveStep(current, 'audio');
    onStepsChange(current);

    if (needsProxyReload && song) {
      await reloadImmersiveTrackProxy(song);
      current = patchImmersiveStep(current, 'audio', 'done');
      current = advanceImmersiveStep(current, 'sync');
      onStepsChange(current);
      current = patchImmersiveStep(current, 'sync', 'done');
    } else {
      ensureGalaxyAudioOutput();
      current = patchImmersiveStep(current, 'audio', 'done');
    }

    onStepsChange(finishImmersiveSteps(current));
    ensureGalaxyAudioOutput();
  } catch (error) {
    const failed = current.map((step) =>
      step.status === 'active' ? { ...step, status: 'error' as const } : step,
    );
    onStepsChange(failed);
    throw error;
  }
}

export type ImmersiveExitKind = 'keep-bg' | 'cover-bg';

export interface RunImmersiveExitPrepOptions {
  kind: ImmersiveExitKind;
  song: QueueItem | null;
  visualMode: RoomVisualMode;
  onStepsChange: (steps: ImmersiveStep[]) => void;
  steps: ImmersiveStep[];
  applyVisualMode: (
    mode: RoomVisualMode,
    options?: { notifyProxyChange?: boolean; reloadAudio?: boolean },
  ) => void;
}

export async function runImmersiveExitPrep(options: RunImmersiveExitPrepOptions): Promise<void> {
  const { kind, song, visualMode, onStepsChange, steps, applyVisualMode } = options;
  let current = advanceImmersiveStep(steps, 'ui');
  onStepsChange(current);
  await waitMs(260);

  current = advanceImmersiveStep(current, 'audio');
  onStepsChange(current);

  try {
    if (kind === 'cover-bg') {
      const prevNeedsProxy = shouldProxySongPlaybackUrl(visualMode);
      const nextNeedsProxy = shouldProxySongPlaybackUrl('cover-bg');
      const currentIsQishui = (song?.source || '') === 'qishui';
      const currentIsKugou = (song?.source || '') === 'kugou';
      if (prevNeedsProxy !== nextNeedsProxy && song && !currentIsQishui && !currentIsKugou) {
        // 只做一次 reload，避免和 applyVisualMode 内部的 reload 叠加造成二次等待
        resetSharedAudioElement();
        useAudioStore.getState().requestTrackReload();
        applyVisualMode('cover-bg', { notifyProxyChange: false, reloadAudio: false });
        await waitForCurrentTrackReady(song, 4000);
      } else {
        applyVisualMode('cover-bg', { notifyProxyChange: false, reloadAudio: false });
      }

      current = patchImmersiveStep(current, 'audio', 'done');
      current = advanceImmersiveStep(current, 'bg');
      onStepsChange(current);
      await waitMs(220);
      current = patchImmersiveStep(current, 'bg', 'done');
    } else {
      await waitMs(160);
      current = patchImmersiveStep(current, 'audio', 'done');
    }

    ensureGalaxyAudioOutput();
    onStepsChange(finishImmersiveSteps(current));
  } catch (error) {
    const failed = current.map((step) =>
      step.status === 'active' ? { ...step, status: 'error' as const } : step,
    );
    onStepsChange(failed);
    throw error;
  }
}
