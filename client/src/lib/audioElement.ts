import { configureInlineAudio, getNativeAudioSession, isIOS, markAudioSessionUnlocked, registerAudioOutputContext, resetAudioSessionUnlocked } from './audioUnlock';
import { interruptAudioFocus, isAudioFocusInterrupted } from './audioFocus';
import { useAudioStore } from '../stores/audioStore';
import { getAudioController } from './audioController';
import { clearAudioQueueBinding } from './audioTrackBinding';
import { resetGalaxyAudioWireIfLoaded } from './galaxyAudioBridge';
import { debugLog } from './debugTools';

let sharedAudio: HTMLAudioElement | null = null;
let loudnessMultiplier = 1;
type AudioOutput = { audio: HTMLAudioElement; context: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode; cleanup: () => void };
let output: AudioOutput | null = null;
const independentOutputs = new WeakMap<HTMLAudioElement, AudioOutput>();

/** 通知 useAudioPlayer：共享 audio 已替换，需重新绑定事件 */
export let sharedAudioGeneration = 0;

export function applyAudioVolume(volume: number): void {
  const audio = sharedAudio;
  if (!audio) return;
  const userVolume = Math.min(1, Math.max(0, volume));
  const current = isIOS() ? ensureSharedAudioOutput(audio) : output?.audio === audio ? output : null;
  audio.muted = userVolume === 0;
  if (current) {
    // 用户音量与响度补偿共同经过增益节点，兼容 iOS 忽略 element.volume
    audio.volume = 1;
    current.gain.gain.value = userVolume * loudnessMultiplier;
  } else {
    audio.volume = Math.min(1, userVolume * loudnessMultiplier);
  }
}

/** 独立试听音频不共享主播放器的媒体源，避免被频谱或换曲重置影响 */
export function applyIndependentAudioVolume(audio: HTMLAudioElement, volume: number): void {
  const userVolume = Math.min(1, Math.max(0, volume));
  let current = independentOutputs.get(audio);
  if (!current && isIOS()) {
    current = createAudioOutput(audio) || undefined;
    if (current) {
      independentOutputs.set(audio, current);
      const attached = current;
      current.cleanup = attachOutputRecovery(audio, current.context, () => independentOutputs.get(audio) === attached);
    }
  }
  audio.muted = userVolume === 0;
  audio.volume = current ? 1 : userVolume;
  if (current) {
    current.gain.gain.value = userVolume;
    // 首次点击创建试听输出时，在异步取链之前恢复上下文以保留用户手势
    if (!isAudioFocusInterrupted(audio)) resumeAudioOutput(current.context);
  }
}

export function hasSharedAudioOutput(): boolean {
  return output?.audio === sharedAudio;
}

export function resumeSharedAudioOutput(): void {
  const current = output;
  if (!current || current.audio !== sharedAudio || isAudioFocusInterrupted(current.audio)) return;
  resumeAudioOutput(current.context);
}

function resumeAudioOutput(context: AudioContext): void {
  if (context.state === 'running' || context.state === 'closed') return;
  void context.resume().then(() => {
    if (context.state === 'running') {
      debugLog('audio_output_resumed');
    }
  }).catch(() => {
    debugLog('audio_output_resume_failed', `state=${context.state}`);
  });
}

function attachOutputRecovery(audio: HTMLAudioElement, context: AudioContext, isCurrent: () => boolean, shared = false): () => void {
  const session = getNativeAudioSession();
  let lastAttemptAt = -Infinity;
  let recoveryAttempts = 0;
  const recover = (event?: Event) => {
    if (!isCurrent()) return;
    if (context.state === 'closed') return;
    const outputInterrupted = String(context.state) === 'interrupted';
    const focusInterrupted = session?.state === 'interrupted'
      || (!session?.state && outputInterrupted);
    if (event?.type === 'statechange') {
      debugLog('audio_output_state', `context=${context.state} session=${session?.state ?? 'unsupported'} hidden=${document.hidden}`);
      // 普通 suspended 不代表用户撤销授权，有原生会话时以会话中断为准
      if (focusInterrupted && audio.src && !audio.ended && (!audio.paused || outputInterrupted)) {
        interruptAudioFocus(audio);
        if (shared) {
          resetAudioSessionUnlocked();
          useAudioStore.getState().setNeedsAudioUnlock(true);
        }
      }
    }
    if (isAudioFocusInterrupted(audio) || focusInterrupted) return;
    if (context.state === 'running') {
      recoveryAttempts = 0;
      if (shared && audio.src && !audio.paused && !audio.ended && !isAudioFocusInterrupted(audio)) {
        markAudioSessionUnlocked();
        useAudioStore.getState().setNeedsAudioUnlock(false);
      }
      return;
    }
    const userGesture = event?.type === 'pointerdown'
      || event?.type === 'pointerup'
      || event?.type === 'touchend'
      || event?.type === 'keydown';
    if ((audio.paused || audio.ended) && !userGesture) return;
    const now = Date.now();
    // 后台无输出时只作有限恢复，不用持续 resume 对抗系统音频管理
    if (!userGesture && (recoveryAttempts >= 2 || now - lastAttemptAt < 1000)) return;
    recoveryAttempts += 1;
    lastAttemptAt = now;
    resumeAudioOutput(context);
  };
  const onForeground = (event: Event) => {
    if (document.hidden) return;
    recoveryAttempts = 0;
    lastAttemptAt = -Infinity;
    recover(event);
  };
  const bindings: [EventTarget, string, EventListener][] = [
    [audio, 'play', recover],
    [audio, 'playing', recover],
    [audio, 'timeupdate', recover],
    [context, 'statechange', recover],
    [document, 'visibilitychange', onForeground],
    [window, 'pageshow', onForeground],
    [window, 'focus', onForeground],
    [document, 'pointerdown', recover],
    [document, 'pointerup', recover],
    [document, 'touchend', recover],
    [document, 'keydown', recover],
  ];
  if (session) bindings.push([session, 'statechange', recover]);
  for (const [target, type, listener] of bindings) {
    target.addEventListener(type, listener, { capture: true, passive: true });
  }
  recover();
  return () => {
    for (const [target, type, listener] of bindings) {
      target.removeEventListener(type, listener, true);
    }
  };
}

export function getSharedAudioOutputSource(): { context: AudioContext; source: MediaElementAudioSourceNode } | null {
  const current = ensureSharedAudioOutput(getSharedAudio());
  if (current) applyAudioVolume(useAudioStore.getState().volume);
  return current;
}

function ensureSharedAudioOutput(audio: HTMLAudioElement): AudioOutput | null {
  if (output?.audio === audio) return output;
  const current = createAudioOutput(audio);
  if (!current) return null;
  output = current;
  output.cleanup = attachOutputRecovery(audio, current.context, () => output === current && sharedAudio === audio, true);
  return output;
}

function createAudioOutput(audio: HTMLAudioElement): AudioOutput | null {
  const Context = globalThis.AudioContext
    || (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  let context: AudioContext;
  try {
    context = new Context();
  } catch {
    return null;
  }
  try {
    const gain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    gain.connect(limiter);
    limiter.connect(context.destination);
    const source = context.createMediaElementSource(audio);
    source.connect(gain);
    registerAudioOutputContext(audio, context);
    return { audio, context, source, gain, cleanup: () => {} };
  } catch {
    void context.close();
    return null;
  }
}

export function applyTrackLoudness(
  loudness?: { gain?: number; peak?: number; lra?: number } | null,
  source?: string,
): void {
  const gain = Number(loudness?.gain);
  const safeGainDb = Number.isFinite(gain) ? Math.min(12, Math.max(-24, gain)) : 0;
  const gainMultiplier = 10 ** (safeGainDb / 20);
  // 酷狗播放始终经过同源 Web Audio，给主播放器保留 20% 的内部增益余量
  loudnessMultiplier = gainMultiplier * (source === 'kugou' ? 1.2 : source === 'qishui' ? 0.7 : 1);
  applyAudioVolume(useAudioStore.getState().volume);
}

function closeSharedAudioOutput(): void {
  if (!output) return;
  output.cleanup();
  void output.context.close();
  output = null;
}

export function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    configureInlineAudio(sharedAudio);
    applyAudioVolume(useAudioStore.getState().volume);
  }
  return sharedAudio;
}

/**
 * 释放 Web Audio 劫持并重建共享 audio 元素。
 * 在离开房间或从频谱/代理模式切回直链播放时必须调用，否则可能永久无声。
 */
export function resetSharedAudioElement(): HTMLAudioElement {
  getAudioController().clearQueue();
  return replaceSharedAudioElement();
}

export function replaceSharedAudioElement(): HTMLAudioElement {
  const interrupted = sharedAudio ? isAudioFocusInterrupted(sharedAudio) : false;
  if (sharedAudio) {
    sharedAudio.pause();
    clearAudioQueueBinding(sharedAudio);
  }
  resetGalaxyAudioWireIfLoaded();
  closeSharedAudioOutput();
  sharedAudio = new Audio();
  if (interrupted) interruptAudioFocus(sharedAudio);
  sharedAudioGeneration += 1;
  configureInlineAudio(sharedAudio);
  applyAudioVolume(useAudioStore.getState().volume);
  return sharedAudio;
}

export function stopSharedAudio(): void {
  getAudioController().clearQueue();
  if (sharedAudio) {
    sharedAudio.pause();
    clearAudioQueueBinding(sharedAudio);
  }
  resetGalaxyAudioWireIfLoaded();
  closeSharedAudioOutput();
  loudnessMultiplier = 1;
  sharedAudio = null;
  sharedAudioGeneration += 1;
}
