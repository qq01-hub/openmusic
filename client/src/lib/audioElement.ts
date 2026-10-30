import { configureInlineAudio, isIOS } from './audioUnlock';
import { useAudioStore } from '../stores/audioStore';
import { getAudioController } from './audioController';
import { clearAudioQueueBinding } from './audioTrackBinding';
import { resetGalaxyAudioWireIfLoaded } from './galaxyAudioBridge';
import { isSameOriginMediaUrl } from './mediaProxyUrl';

let sharedAudio: HTMLAudioElement | null = null;
let loudnessMultiplier = 1;
let outputContext: AudioContext | null = null;
let output: { context: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode } | null = null;
let gestureListenersInstalled = false;
let audioRoutingEnabled = false;

/** 通知 useAudioPlayer：共享 audio 已替换，需重新绑定事件 */
export let sharedAudioGeneration = 0;

export function applyAudioVolume(volume: number): void {
  const audio = sharedAudio;
  if (!audio) return;
  const userVolume = Math.min(1, Math.max(0, volume));
  const effectiveVolume = Math.min(1, Math.max(0, userVolume * loudnessMultiplier));
  if (output) {
    audio.muted = false;
    audio.volume = 1;
    // iOS 静音时保持输出管线活跃，避免丢失耳机键焦点
    output.gain.gain.value = isIOS() && userVolume === 0 ? 0.00001 : effectiveVolume;
    if (!audio.paused && !audio.ended) resumeSharedAudioOutput();
  } else {
    audio.volume = effectiveVolume;
    if (isIOS()) audio.muted = userVolume === 0;
  }
}

/** 音量与频谱共用唯一媒体源，防止重复接管 audio */
export function getSharedAudioOutput(): typeof output {
  if (output) return output;
  if (!audioRoutingEnabled) return null;
  if (isIOS() && outputContext?.state !== 'running') return null;
  const audio = getSharedAudio();
  const src = audio.currentSrc || audio.src;
  if (!src || !isSameOriginMediaUrl(src)) return null;
  try {
    outputContext ??= new AudioContext();
    const gain = outputContext.createGain();
    gain.gain.value = 0;
    gain.connect(outputContext.destination);
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
  const next = Boolean(enabled);
  if (audioRoutingEnabled === next) return;
  audioRoutingEnabled = next;
  if (sharedAudio) resetSharedAudioElement();
}

export function resumeSharedAudioOutput(): void {
  if (!outputContext) return;
  const audio = sharedAudio;
  if (outputContext.state === 'running') {
    if (isIOS()) getSharedAudioOutput();
    return;
  }
  void outputContext.resume().then(() => {
    if (isIOS() && audio === sharedAudio) getSharedAudioOutput();
  }).catch(() => {});
}

function installAudioOutputGestures(): void {
  if (!isIOS() || gestureListenersInstalled) return;
  gestureListenersInstalled = true;
  const unlockOutput = () => {
    const audio = sharedAudio;
    if (!audio || !audioRoutingEnabled) return;
    try {
      const AudioContextClass = window.AudioContext
        || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      outputContext ??= new AudioContextClass();
      if (outputContext.state === 'running') {
        getSharedAudioOutput();
      } else {
        void outputContext.resume().then(() => {
          if (audio === sharedAudio) getSharedAudioOutput();
        }).catch(() => {});
      }
    } catch {
      // 保留原生输出，等待下一次手势重试
    }
  };
  for (const event of ['pointerdown', 'touchend', 'click']) {
    document.addEventListener(event, unlockOutput, { capture: true, passive: true });
  }
}

function releaseAudioOutput(): void {
  output?.source.disconnect();
  output?.gain.disconnect();
  output = null;
}

export function applyTrackLoudness(
  loudness?: { gain?: number; peak?: number; lra?: number } | null,
): void {
  const gain = Number(loudness?.gain);
  const peak = Number(loudness?.peak);
  const safeGainDb = Number.isFinite(gain) ? Math.min(0, Math.max(-24, gain)) : 0;
  const gainMultiplier = 10 ** (safeGainDb / 20);
  const peakMultiplier = Number.isFinite(peak) && peak > 1 ? 0.98 / peak : 1;
  loudnessMultiplier = Math.min(1, gainMultiplier, peakMultiplier);
  applyAudioVolume(useAudioStore.getState().volume);
}

export function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    configureInlineAudio(sharedAudio);
    if (audioRoutingEnabled) sharedAudio.crossOrigin = 'anonymous';
    applyAudioVolume(useAudioStore.getState().volume);
    sharedAudio.addEventListener('play', resumeSharedAudioOutput);
    installAudioOutputGestures();
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
  if (audioRoutingEnabled) sharedAudio.crossOrigin = 'anonymous';
  applyAudioVolume(useAudioStore.getState().volume);
  sharedAudio.addEventListener('play', resumeSharedAudioOutput);
  if (isIOS() && outputContext?.state === 'running') getSharedAudioOutput();
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
