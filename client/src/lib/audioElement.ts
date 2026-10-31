import { configureInlineAudio, isIOS } from './audioUnlock';
import { useAudioStore } from '../stores/audioStore';
import { getAudioController } from './audioController';
import { clearAudioQueueBinding } from './audioTrackBinding';
import { resetGalaxyAudioWireIfLoaded } from './galaxyAudioBridge';
import { isSameOriginMediaUrl } from './mediaProxyUrl';

type AudioOutputNode = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

let sharedAudio: HTMLAudioElement | null = null;
let loudnessMultiplier = 1;
let outputContext: AudioContext | null = null;
let output: AudioOutputNode | null = null;
const independentOutputs = new WeakMap<HTMLAudioElement, AudioOutputNode>();
const trackedIndependentAudios = new Set<HTMLAudioElement>();
let gestureListenersInstalled = false;
let audioRoutingEnabled = isIOS();

/** 通知 useAudioPlayer：共享 audio 已替换，需重新绑定事件 */
export let sharedAudioGeneration = 0;

function getAudioContextClass(): (typeof AudioContext) | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext
    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function applyAudioVolume(volume: number): void {
  const audio = sharedAudio;
  if (!audio) return;
  const userVolume = Math.min(1, Math.max(0, volume));
  const effectiveVolume = Math.min(1, Math.max(0, userVolume * loudnessMultiplier));
  if (!output && isIOS() && outputContext?.state === 'running') {
    getSharedAudioOutput();
  }
  if (output) {
    audio.muted = false;
    audio.volume = 1;
    // iOS 静音时保持输出管线活跃，避免丢失耳机键焦点
    output.gain.gain.value = isIOS() && userVolume === 0 ? 0.00001 : effectiveVolume;
    if (!audio.paused && !audio.ended && outputContext?.state !== 'running') resumeSharedAudioOutput();
  } else {
    audio.muted = false;
    audio.volume = effectiveVolume;
  }
}

function ensureIndependentAudioOutput(audio: HTMLAudioElement): AudioOutputNode | null {
  const existing = independentOutputs.get(audio);
  if (existing) return existing;
  if (!isIOS() || outputContext?.state !== 'running') return null;
  try {
    const gain = outputContext.createGain();
    gain.gain.value = 1;
    gain.connect(outputContext.destination);
    const source = outputContext.createMediaElementSource(audio);
    source.connect(gain);
    const node: AudioOutputNode = { context: outputContext, source, gain };
    independentOutputs.set(audio, node);
    return node;
  } catch {
    return null;
  }
}

/** 独立试听与聊天卡片音频在 iOS 下同样通过 Web Audio GainNode 调节音量 */
export function applyIndependentAudioVolume(audio: HTMLAudioElement, volume: number): void {
  const userVolume = Math.min(1, Math.max(0, volume));
  if (isIOS()) {
    trackedIndependentAudios.add(audio);
    installAudioOutputGestures();
    const node = ensureIndependentAudioOutput(audio);
    if (node) {
      audio.muted = false;
      audio.volume = 1;
      node.gain.gain.value = userVolume === 0 ? 0.00001 : userVolume;
      if (!audio.paused && !audio.ended && outputContext?.state !== 'running') resumeSharedAudioOutput();
      return;
    }
  }
  audio.muted = false;
  audio.volume = userVolume;
}

/** 音量与频谱共用唯一媒体源，防止重复接管 audio */
export function getSharedAudioOutput(): typeof output {
  if (output) return output;
  if (!audioRoutingEnabled && !isIOS()) return null;
  if (isIOS() && outputContext?.state !== 'running') return null;
  const audio = getSharedAudio();
  if (!isIOS()) {
    const src = audio.currentSrc || audio.src;
    if (!src || !isSameOriginMediaUrl(src)) return null;
  }
  try {
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) return null;
    outputContext ??= new AudioContextClass();
    const gain = outputContext.createGain();
    gain.gain.value = Math.max(0.00001, useAudioStore.getState().volume * loudnessMultiplier);
    gain.connect(outputContext.destination);
    if (!audio.src && !audio.crossOrigin) {
      audio.crossOrigin = 'anonymous';
    }
    const source = outputContext.createMediaElementSource(audio);
    source.connect(gain);
    output = { context: outputContext, source, gain };
    applyAudioVolume(useAudioStore.getState().volume);
    return output;
  } catch {
    return null;
  }
}

/** 设置当前曲目的 Web Audio 路由，切换时重建媒体元素避免复用旧 source */
export function setSharedAudioRouting(enabled: boolean): void {
  const next = isIOS() || Boolean(enabled);
  if (audioRoutingEnabled === next) return;
  audioRoutingEnabled = next;
  if (sharedAudio) resetSharedAudioElement();
}

let syncingOutputs = false;

function syncAllIosOutputs(): void {
  if (syncingOutputs || !isIOS() || outputContext?.state !== 'running') return;
  syncingOutputs = true;
  try {
    if (sharedAudio) {
      getSharedAudioOutput();
      applyAudioVolume(useAudioStore.getState().volume);
    }
    const currentVolume = useAudioStore.getState().volume;
    for (const audio of trackedIndependentAudios) {
      applyIndependentAudioVolume(audio, currentVolume);
    }
  } finally {
    syncingOutputs = false;
  }
}

export function resumeSharedAudioOutput(): void {
  if (!outputContext) {
    if (!isIOS()) return;
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) return;
    try {
      outputContext = new AudioContextClass();
    } catch {
      return;
    }
  }
  if (outputContext.state === 'running') {
    syncAllIosOutputs();
    return;
  }
  void outputContext.resume().then(() => {
    syncAllIosOutputs();
  }).catch(() => {});
}

function installAudioOutputGestures(): void {
  if (!isIOS() || gestureListenersInstalled || typeof document === 'undefined') return;
  gestureListenersInstalled = true;
  const unlockOutput = () => {
    try {
      const AudioContextClass = getAudioContextClass();
      if (!AudioContextClass) return;
      outputContext ??= new AudioContextClass();
      if (outputContext.state === 'running') {
        syncAllIosOutputs();
      } else {
        void outputContext.resume().then(() => {
          syncAllIosOutputs();
        }).catch(() => {});
      }
    } catch {
      // 保留原生输出，等待下一次手势重试
    }
  };
  for (const event of ['pointerdown', 'touchend', 'click', 'touchstart', 'keydown']) {
    document.addEventListener(event, unlockOutput, { capture: true, passive: true });
  }
}

installAudioOutputGestures();

function releaseAudioOutput(): void {
  output?.source.disconnect();
  output?.gain.disconnect();
  output = null;
}

export function applyTrackLoudness(
  loudness?: { gain?: number; peak?: number; lra?: number } | null,
  source?: string,
  qishuiVolumeDeltaPercent = -30,
): void {
  const gain = Number(loudness?.gain);
  const peak = Number(loudness?.peak);
  const safeGainDb = Number.isFinite(gain) ? Math.min(0, Math.max(-24, gain)) : 0;
  const gainMultiplier = 10 ** (safeGainDb / 20);
  const peakMultiplier = Number.isFinite(peak) && peak > 1 ? 0.98 / peak : 1;
  const rawDelta = Number.isFinite(Number(qishuiVolumeDeltaPercent))
    ? (Number(qishuiVolumeDeltaPercent) === 100 ? -30 : Number(qishuiVolumeDeltaPercent))
    : -30;
  const qishuiMultiplier = Math.min(1.5, Math.max(0.1, 1 + Math.min(50, Math.max(-90, rawDelta)) / 100));
  const sourceMultiplier = source === 'qishui' ? qishuiMultiplier : source === 'kugou' ? 1.2 : 1;
  loudnessMultiplier = Math.min(1.5, Math.max(0.05, Math.min(1, gainMultiplier, peakMultiplier) * sourceMultiplier));
  applyAudioVolume(useAudioStore.getState().volume);
}

export function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    configureInlineAudio(sharedAudio);
    if (audioRoutingEnabled || isIOS()) sharedAudio.crossOrigin = 'anonymous';
    sharedAudio.addEventListener('play', resumeSharedAudioOutput);
    installAudioOutputGestures();
    if (isIOS() && outputContext?.state === 'running') getSharedAudioOutput();
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
  if (sharedAudio) {
    sharedAudio.pause();
    clearAudioQueueBinding(sharedAudio);
  }
  resetGalaxyAudioWireIfLoaded();
  releaseAudioOutput();
  sharedAudio = new Audio();
  sharedAudioGeneration += 1;
  configureInlineAudio(sharedAudio);
  if (audioRoutingEnabled || isIOS()) sharedAudio.crossOrigin = 'anonymous';
  sharedAudio.addEventListener('play', resumeSharedAudioOutput);
  if (isIOS() && outputContext?.state === 'running') getSharedAudioOutput();
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
  releaseAudioOutput();
  loudnessMultiplier = 1;
  sharedAudio = null;
  sharedAudioGeneration += 1;
}
