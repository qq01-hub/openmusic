import { getSharedAudio, getSharedAudioOutput } from '../../../lib/audioElement';
import { isProxiedMediaUrl, isSameOriginMediaUrl } from '../../../lib/mediaProxyUrl';
import type { RoomVisualPresetId } from '../../../lib/roomVisualPreset';
import { shouldProxySongPlaybackUrl } from '../../../lib/roomVisualPreset';
import {
  resetGalaxyCinema,
  scheduleLiveBeatCamera,
  updateGalaxyCinemaDynamics,
} from './galaxyCinema';
import {
  isBeatMapAnalysisPending,
  isBeatMapReadyForCamera,
  mergeScheduledBeatPulse,
  tickGalaxyBeatMap,
} from './galaxyBeatMap';

(globalThis as typeof globalThis & { __openmusicGalaxyAudioLoaded?: boolean })
  .__openmusicGalaxyAudioLoaded = true;

const FFT_SIZE = 2048;
const BEAT_FFT_SIZE = 2048;
const REALTIME_MIN_INTERVAL = 0.46;

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let beatAnalyser: AnalyserNode | null = null;
let freqBuf: Uint8Array<ArrayBuffer> | null = null;
let timeBuf: Uint8Array<ArrayBuffer> | null = null;
let beatFreqBuf: Uint8Array<ArrayBuffer> | null = null;
let beatTimeBuf: Uint8Array<ArrayBuffer> | null = null;
let wired = false;
let playListenerAttached = false;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function currentAudioSrc(): string {
  const audio = getSharedAudio();
  return audio.currentSrc || audio.src || '';
}

/** 当前曲目已走同源/代理/本地解密 blob 时，才接入 Web Audio，避免切背景时劫持直链导致无声 */
function canWireGalaxyAudioNow(): boolean {
  if (!shouldProxySongPlaybackUrl()) return false;
  const src = currentAudioSrc();
  if (!src) return false;
  // 汽水解密后的 blob: 同源，沉浸频谱必须接这个，不能再去拉服务端解密流
  if (src.startsWith('blob:')) return true;
  return isProxiedMediaUrl(src) || isSameOriginMediaUrl(src);
}

export interface GalaxyAudioBands {
  /** Mineradio uniforms.uBass */
  bass: number;
  mid: number;
  treble: number;
  beat: number;
  energy: number;
  /** 唱片旋转用 smoothBass（非 shaped） */
  smoothBass: number;
  /** 涟漪触发，同 bass */
  rippleBass: number;
  vocal: number;
  sunEnergy: number;
}

export interface GalaxyAudioReadOptions {
  preset?: RoomVisualPresetId;
  intensity?: number;
}

// 视觉平滑输出
const smooth = { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 };
const sun = { avg: 0, peak: 0.48, hold: 0, energy: 0 };
let bassPeak = 0.12;
let midPeak = 0.1;
let treblePeak = 0.08;
let energyPeak = 0.1;
let prevEnergy = 0;
let beatPulse = 0;
let vocalPeak = 0.12;

// Mineradio 实时节拍引擎状态
const rtBeat = {
  subFast: 0,
  subSlow: 0,
  lowFast: 0,
  lowSlow: 0,
  bodyFast: 0,
  bodySlow: 0,
  vocalFast: 0,
  vocalSlow: 0,
  snapFast: 0,
  snapSlow: 0,
  prevSub: 0,
  prevLow: 0,
  prevBody: 0,
  prevVocal: 0,
  prevSnap: 0,
  prevRms: 0,
  onsetAvg: 0.012,
  onsetPeak: 0.06,
  subPeak: 0.14,
  lowPeak: 0.18,
  bodyPeak: 0.16,
  vocalPeak: 0.16,
  snapPeak: 0.14,
  lastHitAt: -10,
  tempoGap: 0,
  tempoConfidence: 0,
  beatCount: 0,
  primedFrames: 0,
  warmupUntil: 0,
  pulse: 0,
  score: 0,
};

function resetRealtimeBeatEngine(): void {
  rtBeat.subFast = rtBeat.subSlow = rtBeat.lowFast = rtBeat.lowSlow = 0;
  rtBeat.bodyFast = rtBeat.bodySlow = rtBeat.vocalFast = rtBeat.vocalSlow = 0;
  rtBeat.snapFast = rtBeat.snapSlow = 0;
  rtBeat.prevSub = rtBeat.prevLow = rtBeat.prevBody = rtBeat.prevVocal = rtBeat.prevSnap = rtBeat.prevRms = 0;
  rtBeat.onsetAvg = 0.012;
  rtBeat.onsetPeak = 0.06;
  rtBeat.subPeak = 0.14;
  rtBeat.lowPeak = 0.18;
  rtBeat.bodyPeak = 0.16;
  rtBeat.vocalPeak = 0.16;
  rtBeat.snapPeak = 0.14;
  rtBeat.lastHitAt = -10;
  rtBeat.tempoGap = 0;
  rtBeat.tempoConfidence = 0;
  rtBeat.beatCount = 0;
  rtBeat.primedFrames = 0;
  const audio = getSharedAudio();
  rtBeat.warmupUntil = (audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0) + 1.15;
  rtBeat.pulse = 0;
  rtBeat.score = 0;
}

/** 切歌或重置视觉时调用，避免上一首的节拍状态污染新歌 */
export function resetGalaxyAudioVisualState(): void {
  resetGalaxyAudioBandsState();
  resetGalaxyCinema();
}

/** 切歌时只重置与曲目绑定的节拍状态，能量/峰值让它自然跟上，避免画面猛跳 */
export function resetGalaxyAudioVisualStateForSongChange(): void {
  // 把 smooth.* 清零、峰值打回下限会造成两段跳变：
  // 先是粒子位移瞬间塌陷，紧接着新歌头几帧除以极小的峰值被归一化到 1 又炸开，
  // 观感就是每次切歌封面「大幅度跳动」。峰值本身每帧 ×0.99 会自己衰减跟上新歌。
  prevEnergy = smooth.energy;
  beatPulse = 0;
  sun.hold = 0;
  resetRealtimeBeatEngine();
}

function resetGalaxyAudioBandsState(): void {
  smooth.bass = smooth.mid = smooth.treble = smooth.beat = smooth.energy = 0;
  bassPeak = 0.12;
  midPeak = 0.1;
  treblePeak = 0.08;
  energyPeak = 0.1;
  prevEnergy = 0;
  beatPulse = 0;
  vocalPeak = 0.12;
  sun.avg = 0;
  sun.peak = 0.48;
  sun.hold = 0;
  sun.energy = 0;
  lastAdvanceMs = -1;
  cachedBands = { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0, smoothBass: 0, rippleBass: 0, vocal: 0, sunEnergy: 0 };
  resetRealtimeBeatEngine();
}

function resumeAudioContext(): void {
  if (wired && audioCtx) {
    void audioCtx.resume();
    return;
  }
  const node = ensureAnalyser();
  if (node?.context && 'resume' in node.context) {
    void (node.context as AudioContext).resume();
  }
}

function attachPlayListener(): void {
  if (playListenerAttached) return;
  playListenerAttached = true;
  const audio = getSharedAudio();
  audio.addEventListener('play', resumeAudioContext);
  audio.addEventListener('playing', resumeAudioContext);
}

/** Web Audio 已劫持播放元素时，确保输出链路仍通向扬声器（退出沉浸/切回封面后仍需调用） */
export function ensureGalaxyAudioOutput(): void {
  resumeAudioContext();
}

/** 丢弃共享 audio 元素前调用，避免新元素仍被视为已接入 Web Audio */
export function resetGalaxyAudioWire(): void {
  wired = false;
  playListenerAttached = false;
}

export function isGalaxyAudioWired(): boolean {
  return wired;
}

function connectSourceToAnalysers(source: AudioNode): void {
  if (!analyser || !beatAnalyser || !audioCtx) return;
  source.connect(analyser);
  source.connect(beatAnalyser);
}

function wireAnalyser(audio: HTMLAudioElement): boolean {
  if (!audioCtx || !analyser || !beatAnalyser) return false;
  if (wired) return true;

  try {
    const output = getSharedAudioOutput();
    if (!output) return false;
    connectSourceToAnalysers(output.source);
    wired = true;
    return true;
  } catch {
    try {
      const capture = (audio as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
      if (!capture) return false;
      const streamSrc = audioCtx.createMediaStreamSource(capture);
      streamSrc.connect(analyser);
      streamSrc.connect(beatAnalyser);
      wired = true;
      return true;
    } catch {
      return false;
    }
  }
}

function ensureAnalyser(): AnalyserNode | null {
  attachPlayListener();
  if (!canWireGalaxyAudioNow()) return null;

  const audio = getSharedAudio();
  const output = getSharedAudioOutput();
  if (!output) return null;
  audioCtx = output.context;

  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.58;
    analyser.minDecibels = -82;
    analyser.maxDecibels = -8;
  }
  if (!beatAnalyser) {
    beatAnalyser = audioCtx.createAnalyser();
    beatAnalyser.fftSize = BEAT_FFT_SIZE;
    beatAnalyser.smoothingTimeConstant = 0.1;
    beatAnalyser.minDecibels = -82;
    beatAnalyser.maxDecibels = -8;
  }

  if (!wired) wireAnalyser(audio);
  return wired ? analyser : null;
}

export function resumeGalaxyAudioContext(): void {
  ensureGalaxyAudioOutput();
}

function envFollow(prev: number, next: number, attack: number, release: number): number {
  const k = next > prev ? attack : release;
  return prev + (next - prev) * k;
}

function expFollow(cur: number, next: number, upTau: number, downTau: number, dt: number): number {
  const tau = next > cur ? upTau : downTau;
  return cur + (next - cur) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
}

function beatBandRms(data: Uint8Array, sampleRate: number, fftSize: number, hz0: number, hz1: number): number {
  const binHz = sampleRate / fftSize;
  const a = Math.max(1, Math.floor(hz0 / binHz));
  const b = Math.min(data.length - 1, Math.ceil(hz1 / binHz));
  let sum = 0;
  let count = 0;
  for (let i = a; i <= b; i++) {
    const v = data[i] / 255;
    sum += v * v;
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

interface RealtimeBeatResult {
  hit: boolean;
  strength: number;
  confidence: number;
  score: number;
  low: number;
  tempoAssist: boolean;
}

function processRealtimeBeatEngine(dt: number): RealtimeBeatResult | null {
  if (!beatAnalyser || !audioCtx) return null;
  const audio = getSharedAudio();
  if (audio.paused) return null;

  if (!beatFreqBuf || beatFreqBuf.length !== beatAnalyser.frequencyBinCount) {
    beatFreqBuf = new Uint8Array(beatAnalyser.frequencyBinCount);
  }
  if (!beatTimeBuf || beatTimeBuf.length !== beatAnalyser.fftSize) {
    beatTimeBuf = new Uint8Array(beatAnalyser.fftSize);
  }

  beatAnalyser.getByteFrequencyData(beatFreqBuf);
  beatAnalyser.getByteTimeDomainData(beatTimeBuf);

  const sr = audioCtx.sampleRate || 44100;
  const sub = beatBandRms(beatFreqBuf, sr, beatAnalyser.fftSize, 38, 74);
  const kick = beatBandRms(beatFreqBuf, sr, beatAnalyser.fftSize, 52, 165);
  const body = beatBandRms(beatFreqBuf, sr, beatAnalyser.fftSize, 165, 420);
  const vocal = beatBandRms(beatFreqBuf, sr, beatAnalyser.fftSize, 420, 2600);
  const snap = beatBandRms(beatFreqBuf, sr, beatAnalyser.fftSize, 1800, 9200);
  const low = Math.min(1, kick * 0.86 + sub * 0.42);

  let rms = 0;
  for (let i = 0; i < beatTimeBuf.length; i++) {
    const tv = (beatTimeBuf[i] - 128) / 128;
    rms += tv * tv;
  }
  rms = Math.sqrt(rms / beatTimeBuf.length);

  rtBeat.subFast = expFollow(rtBeat.subFast, sub, 0.018, 0.064, dt);
  rtBeat.subSlow = expFollow(rtBeat.subSlow, sub, 0.32, 0.52, dt);
  rtBeat.lowFast = expFollow(rtBeat.lowFast, low, 0.016, 0.07, dt);
  rtBeat.lowSlow = expFollow(rtBeat.lowSlow, low, 0.3, 0.54, dt);
  rtBeat.bodyFast = expFollow(rtBeat.bodyFast, body, 0.02, 0.082, dt);
  rtBeat.bodySlow = expFollow(rtBeat.bodySlow, body, 0.36, 0.6, dt);
  rtBeat.vocalFast = expFollow(rtBeat.vocalFast, vocal, 0.026, 0.09, dt);
  rtBeat.vocalSlow = expFollow(rtBeat.vocalSlow, vocal, 0.34, 0.58, dt);
  rtBeat.snapFast = expFollow(rtBeat.snapFast, snap, 0.012, 0.06, dt);
  rtBeat.snapSlow = expFollow(rtBeat.snapSlow, snap, 0.3, 0.52, dt);

  const peakDecay = 0.99;
  rtBeat.subPeak = Math.max(rtBeat.subPeak * Math.pow(peakDecay, dt * 60), sub, 0.045);
  rtBeat.lowPeak = Math.max(rtBeat.lowPeak * Math.pow(0.989, dt * 60), low, 0.06);
  rtBeat.bodyPeak = Math.max(rtBeat.bodyPeak * Math.pow(peakDecay, dt * 60), body, 0.04);
  rtBeat.vocalPeak = Math.max(rtBeat.vocalPeak * Math.pow(peakDecay, dt * 60), vocal, 0.04);
  rtBeat.snapPeak = Math.max(rtBeat.snapPeak * Math.pow(peakDecay, dt * 60), snap, 0.035);

  const subFlux = Math.max(0, sub - rtBeat.prevSub);
  const lowFlux = Math.max(0, low - rtBeat.prevLow);
  const bodyFlux = Math.max(0, body - rtBeat.prevBody);
  const vocalFlux = Math.max(0, vocal - rtBeat.prevVocal);
  const snapFlux = Math.max(0, snap - rtBeat.prevSnap);
  const rmsFlux = Math.max(0, rms - rtBeat.prevRms);
  const subRise = Math.max(0, rtBeat.subFast - rtBeat.subSlow);
  const lowRise = Math.max(0, rtBeat.lowFast - rtBeat.lowSlow);
  const bodyRise = Math.max(0, rtBeat.bodyFast - rtBeat.bodySlow);
  const vocalRise = Math.max(0, rtBeat.vocalFast - rtBeat.vocalSlow);
  const snapRise = Math.max(0, rtBeat.snapFast - rtBeat.snapSlow);

  const drumOnset = subRise * 0.88 + subFlux * 0.66 + lowRise * 1.62 + lowFlux * 1.34;
  const musicalOnset =
    bodyRise * 0.34 + bodyFlux * 0.24 + vocalRise * 0.52 + vocalFlux * 0.36 + snapRise * 0.08 + snapFlux * 0.06 + rmsFlux * 0.2;
  const onset = drumOnset + musicalOnset * 0.16;

  const avgTau = onset > rtBeat.onsetAvg ? 1.1 : 0.34;
  rtBeat.onsetAvg = expFollow(rtBeat.onsetAvg, onset, avgTau, avgTau, dt);
  rtBeat.onsetPeak = Math.max(rtBeat.onsetPeak * Math.pow(0.988, dt * 60), onset, 0.032);
  const floor = rtBeat.onsetAvg * 0.84;
  const score = clamp01((onset - floor) / Math.max(0.014, rtBeat.onsetPeak - floor));

  const subNorm = clamp01(sub / Math.max(0.045, rtBeat.subPeak * 0.7));
  const lowNorm = clamp01(low / Math.max(0.06, rtBeat.lowPeak * 0.72));
  const vocalNorm = clamp01(vocal / Math.max(0.045, rtBeat.vocalPeak * 0.72));

  const nowT = audio.currentTime || 0;
  rtBeat.primedFrames++;
  const warmingUp = nowT < rtBeat.warmupUntil || rtBeat.primedFrames < 18;
  const gapRaw = nowT - rtBeat.lastHitAt;
  const expectedGap = rtBeat.tempoGap > 0 ? rtBeat.tempoGap : 0;
  const phaseWindow =
    expectedGap > 0 ? Math.max(0.055, Math.min(0.105, expectedGap * 0.16)) : 0;
  const tempoDue =
    expectedGap > 0 && gapRaw > expectedGap - phaseWindow && gapRaw < expectedGap + phaseWindow;

  const lowPresence = Math.max(lowNorm, subNorm * 0.74);
  const lowAttack = lowRise + lowFlux * 0.72 + subRise * 0.58 + subFlux * 0.4;
  const lowDominance = low / Math.max(0.001, vocal * 0.84 + body * 0.36 + snap * 0.1);
  const lowFluxDominance =
    (lowFlux + subFlux * 0.58) / Math.max(0.001, vocalFlux * 0.72 + bodyFlux * 0.42 + snapFlux * 0.16);
  const voiceMask = vocalNorm > 0.58 && lowDominance < 0.86 && lowFluxDominance < 1.1;

  const drumGate =
    lowPresence > 0.38 &&
    lowAttack > Math.max(0.014, rtBeat.onsetAvg * 0.34) &&
    !voiceMask &&
    (lowDominance > 0.72 || lowFluxDominance > 1.02 || subNorm > 0.56);

  const strongTransient = drumGate && score > 0.54 && drumOnset > rtBeat.onsetAvg * 0.84;
  const kickTransient =
    drumGate && score > 0.4 && lowAttack > Math.max(0.018, rtBeat.onsetAvg * 0.46);
  const tempoAssist =
    tempoDue &&
    rtBeat.tempoConfidence > 0.42 &&
    drumGate &&
    score > 0.22 &&
    lowAttack > Math.max(0.016, rtBeat.onsetAvg * 0.34);

  let candidateHit = strongTransient || kickTransient || tempoAssist;
  if (warmingUp) candidateHit = false;

  const hasTempoLock =
    expectedGap >= 0.42 && expectedGap <= 0.88 && rtBeat.tempoConfidence > 0.38;
  const lockedWindow = hasTempoLock ? Math.max(0.07, Math.min(0.11, expectedGap * 0.16)) : 0;

  let rhythmAccept = false;
  if (candidateHit) {
    if (rtBeat.lastHitAt < 0) {
      rhythmAccept = strongTransient && score > 0.62 && lowPresence > 0.48;
    } else if (hasTempoLock) {
      const oneBeatErr = Math.abs(gapRaw - expectedGap);
      const twoBeatErr = Math.abs(gapRaw - expectedGap * 2);
      rhythmAccept = oneBeatErr <= lockedWindow && (kickTransient || strongTransient);
      rhythmAccept =
        rhythmAccept || (twoBeatErr <= lockedWindow * 1.35 && strongTransient && score > 0.58);
      rhythmAccept =
        rhythmAccept || (gapRaw > expectedGap * 1.55 && strongTransient && lowPresence > 0.44);
    } else {
      rhythmAccept =
        gapRaw >= REALTIME_MIN_INTERVAL && strongTransient && score > 0.58 && lowPresence > 0.44;
    }
  }

  let hit = candidateHit && rhythmAccept;
  const minGap = hasTempoLock
    ? Math.max(0.4, Math.min(0.54, expectedGap * 0.72))
    : REALTIME_MIN_INTERVAL;
  if (hit && gapRaw < minGap) hit = false;

  rtBeat.prevSub = sub;
  rtBeat.prevLow = low;
  rtBeat.prevBody = body;
  rtBeat.prevVocal = vocal;
  rtBeat.prevSnap = snap;
  rtBeat.prevRms = rms;
  rtBeat.score = score;
  rtBeat.pulse *= Math.pow(0.18, dt);
  rtBeat.tempoConfidence *= Math.pow(0.996, dt * 60);

  if (!hit) {
    return {
      hit: false,
      strength: 0,
      confidence: rtBeat.tempoConfidence,
      score,
      low: lowPresence,
      tempoAssist: false,
    };
  }

  if (rtBeat.lastHitAt > 0) {
    let gap = nowT - rtBeat.lastHitAt;
    while (gap > 0.88) gap *= 0.5;
    while (gap < 0.42) gap *= 2;
    if (gap >= 0.42 && gap <= 0.88) {
      const tempoEase = hasTempoLock ? 0.1 : 0.22;
      rtBeat.tempoGap = rtBeat.tempoGap ? rtBeat.tempoGap * (1 - tempoEase) + gap * tempoEase : gap;
      rtBeat.tempoConfidence = Math.min(1, rtBeat.tempoConfidence + (tempoAssist ? 0.04 : 0.18));
    }
  }

  rtBeat.lastHitAt = nowT;
  rtBeat.beatCount++;

  const strength = clamp01(
    0.24 + score * 0.36 + lowPresence * 0.34 + Math.min(1.25, lowDominance) * 0.07 + rmsFlux * 0.95,
  );
  rtBeat.pulse = Math.max(rtBeat.pulse, strength);

  return {
    hit: true,
    strength,
    confidence: clamp01(score * 0.62 + lowPresence * 0.26 + rtBeat.tempoConfidence * 0.12),
    score,
    low: Math.max(0.05, lowPresence),
    tempoAssist,
  };
}

export function getRealtimeBeatLockState(currentTime: number): boolean {
  const expectedGap = rtBeat.tempoGap > 0 ? rtBeat.tempoGap : 0;
  const liveFreshWindow = Math.max(0.5, expectedGap ? expectedGap * 1.18 : 0.5);
  return rtBeat.lastHitAt > 0 && currentTime - rtBeat.lastHitAt < liveFreshWindow;
}

function shapeBandsForPreset(
  preset: RoomVisualPresetId | undefined,
  intensity: number,
  smoothBass: number,
  smoothMid: number,
  smoothTreb: number,
  beat: number,
): { bass: number; mid: number; treble: number; beat: number } {
  let bass = Math.min(0.9, smoothBass * 1.05 + beat * 0.18) * intensity;
  let mid = Math.min(0.72, smoothMid * 1.12) * intensity;
  let treble = Math.min(0.62, smoothTreb * 1.2) * intensity;
  let beatOut = beat;

  if (preset !== undefined && preset >= 4) {
    const wallpaperAudio = preset === 5;
    const ringBass =
      smoothBass * (wallpaperAudio ? 1.1 : 1.58) + beat * (wallpaperAudio ? 0.18 : 0.42) - smoothMid * 0.16 - smoothTreb * 0.06;
    const ringMid = smoothMid * (wallpaperAudio ? 1.16 : 1.82) - smoothBass * 0.14 - smoothTreb * 0.07;
    const ringTreble = smoothTreb * (wallpaperAudio ? 1.34 : 2.28) - smoothMid * 0.1 - smoothBass * 0.05;
    bass = Math.pow(clamp01((ringBass - 0.05) / 0.58), 0.72) * intensity;
    mid = Math.pow(clamp01((ringMid - 0.045) / 0.46), 0.78) * intensity;
    treble = Math.pow(clamp01((ringTreble - 0.03) / 0.34), 0.84) * intensity;
    if (wallpaperAudio) {
      bass = Math.min(bass, 0.46 * intensity);
      mid = Math.min(mid, 0.4 * intensity);
      treble = Math.min(treble, 0.36 * intensity);
      beatOut *= 0.34;
    }
  }

  return { bass, mid, treble, beat: beatOut };
}

let lastAdvanceMs = -1;
let cachedBands: GalaxyAudioBands = {
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
  energy: 0,
  smoothBass: 0,
  rippleBass: 0,
  vocal: 0,
  sunEnergy: 0,
};

function advanceGalaxyAudioBands(dt: number, options: GalaxyAudioReadOptions): GalaxyAudioBands {
  const safeDt = Math.max(0.001, Math.min(0.08, dt));
  const intensity = options.intensity ?? 1;
  const preset = options.preset;
  const node = ensureAnalyser();
  const audio = getSharedAudio();

  if (!node || audio.paused) {
    smooth.bass *= 0.91;
    smooth.mid *= 0.91;
    smooth.treble *= 0.91;
    smooth.energy *= 0.91;
    beatPulse *= Math.pow(0.82, safeDt);
    smooth.beat = beatPulse;
    const shaped = shapeBandsForPreset(preset, intensity, smooth.bass, smooth.mid, smooth.treble, beatPulse);
    return {
      bass: shaped.bass,
      mid: shaped.mid,
      treble: shaped.treble,
      beat: shaped.beat,
      energy: smooth.energy,
      smoothBass: smooth.bass,
      rippleBass: shaped.bass,
      vocal: 0,
      sunEnergy: 0,
    };
  }

  if (!freqBuf || freqBuf.length !== node.frequencyBinCount) {
    freqBuf = new Uint8Array(node.frequencyBinCount);
  }
  if (!timeBuf || timeBuf.length !== node.fftSize) {
    timeBuf = new Uint8Array(node.fftSize);
  }

  node.getByteFrequencyData(freqBuf);
  node.getByteTimeDomainData(timeBuf);

  const sampleRate = audioCtx?.sampleRate || 44100;
  const fftSize = node.fftSize || freqBuf.length * 2;
  const subKick = beatBandRms(freqBuf, sampleRate, fftSize, 38, 74);
  const kickCore = beatBandRms(freqBuf, sampleRate, fftSize, 52, 165);
  const kickBody = beatBandRms(freqBuf, sampleRate, fftSize, 165, 420);
  const bKick = Math.min(1, kickCore * 0.86 + subKick * 0.42 + kickBody * 0.1);
  const voc = beatBandRms(freqBuf, sampleRate, fftSize, 420, 2600);
  const mInst = beatBandRms(freqBuf, sampleRate, fftSize, 2600, 6200);
  const tHigh = beatBandRms(freqBuf, sampleRate, fftSize, 6200, Math.min(16000, sampleRate / 2));

  let rms = 0;
  for (let j = 0; j < timeBuf.length; j++) {
    const tv = (timeBuf[j] - 128) / 128;
    rms += tv * tv;
  }
  rms = Math.sqrt(rms / timeBuf.length);

  bassPeak = Math.max(bassPeak * 0.994, bKick, 0.03);
  midPeak = Math.max(midPeak * 0.993, mInst, 0.026);
  treblePeak = Math.max(treblePeak * 0.992, tHigh, 0.018);
  energyPeak = Math.max(energyPeak * 0.995, rms, 0.03);
  vocalPeak = Math.max(vocalPeak * 0.993, voc, 0.028);

  const rb = Math.min(1, (bKick / Math.max(0.038, bassPeak * 0.66)) ** 0.78);
  const rm = Math.min(1, (mInst / Math.max(0.025, midPeak * 0.7)) ** 0.86);
  const rt = Math.min(1, (tHigh / Math.max(0.02, treblePeak * 0.74)) ** 0.92);
  const re = Math.min(1, (rms / Math.max(0.034, energyPeak * 0.68)) ** 0.82);

  const bassOnset = Math.max(0, rb - smooth.bass);
  const energyOnset = Math.max(0, re - prevEnergy);
  prevEnergy = prevEnergy * 0.88 + re * 0.12;

  const nowT = audio.currentTime || 0;
  const beatMapReadyForCamera = isBeatMapReadyForCamera();
  const waitingForBeatMap =
    !beatMapReadyForCamera && (isBeatMapAnalysisPending() || nowT < 18);

  const realtimeBeat = processRealtimeBeatEngine(safeDt);
  if (realtimeBeat?.hit) {
    const liveKickFrame =
      realtimeBeat.low > 0.5 && rb > 0.42 && bassOnset > 0.07 && energyOnset > 0.016;
    const liveStrongHit =
      realtimeBeat.confidence > 0.76 &&
      realtimeBeat.strength > 0.7 &&
      realtimeBeat.score > 0.56 &&
      liveKickFrame;
    const liveTempoHit =
      realtimeBeat.tempoAssist &&
      realtimeBeat.confidence > 0.8 &&
      realtimeBeat.strength > 0.66 &&
      realtimeBeat.low > 0.5 &&
      bassOnset > 0.052;
    const liveFallbackOk = waitingForBeatMap
      ? liveStrongHit || liveTempoHit
      : realtimeBeat.confidence > 0.84 &&
        realtimeBeat.strength > 0.8 &&
        realtimeBeat.low > 0.54 &&
        (liveKickFrame || realtimeBeat.score > 0.68);

    if (!beatMapReadyForCamera && liveFallbackOk) {
      scheduleLiveBeatCamera({
        strength: realtimeBeat.strength,
        confidence: realtimeBeat.confidence,
        score: realtimeBeat.score,
        low: realtimeBeat.low,
        tempoAssist: realtimeBeat.tempoAssist,
      });
    }
    if (!beatMapReadyForCamera && liveFallbackOk) {
      const previewPulseScale = waitingForBeatMap ? 0.68 : 1;
      const rtPulse = Math.min(
        waitingForBeatMap ? 0.46 : 0.62,
        realtimeBeat.strength *
          (realtimeBeat.tempoAssist ? 0.62 : 0.68) *
          previewPulseScale,
      );
      beatPulse = Math.max(beatPulse, rtPulse);
    }
  } else if (
    !beatMapReadyForCamera &&
    bassOnset > 0.075 &&
    rb > 0.32 &&
    energyOnset > 0.02
  ) {
    beatPulse = Math.max(beatPulse, Math.min(0.12, bassOnset * 0.18));
  }

  beatPulse *= Math.pow(0.36, safeDt);

  tickGalaxyBeatMap(getRealtimeBeatLockState(nowT));
  beatPulse = mergeScheduledBeatPulse(beatPulse, safeDt);

  const smoothBass = envFollow(
    smooth.bass,
    Math.min(0.82, rb * 0.78 + re * 0.025),
    0.28,
    0.075,
  );
  const smoothMid = envFollow(
    smooth.mid,
    Math.min(0.68, rm * 0.64 + re * 0.025),
    0.18,
    0.06,
  );
  const smoothTreb = envFollow(smooth.treble, Math.min(0.56, rt * 0.54), 0.18, 0.055);
  const smoothEnergy = envFollow(smooth.energy, Math.min(0.72, re), 0.16, 0.055);

  smooth.bass = smoothBass;
  smooth.mid = smoothMid;
  smooth.treble = smoothTreb;
  smooth.energy = smoothEnergy;
  smooth.beat = beatPulse;
  updateGalaxyCinemaDynamics(re, rb);

  const audioEnergy = Math.max(smoothEnergy, beatPulse * 0.3);
  const shaped = shapeBandsForPreset(preset, intensity, smoothBass, smoothMid, smoothTreb, beatPulse);
  const sunEnergyBand = clamp01((smoothEnergy - 0.18) / 0.38);
  const sunVoice = clamp01((voc - 0.11) / 0.34);
  const sunMelody = clamp01((smoothMid - 0.16) / 0.27);
  const sunAir = clamp01((smoothTreb - 0.105) / 0.17);
  let sunRaw = clamp01(sunEnergyBand * 0.36 + sunVoice * 0.18 + sunMelody * 0.26 + sunAir * 0.20);
  sunRaw = sunRaw * sunRaw * (3 - 2 * sunRaw);
  sun.avg += (sunRaw - sun.avg) * (sunRaw > sun.avg ? 0.006 : 0.014);
  sun.peak = Math.max(0.48, sun.peak * Math.pow(0.9985, safeDt * 60), sunRaw);
  const sunThreshold = Math.max(0.78, sun.avg + 0.20, sun.peak * 0.74);
  const sunGate = clamp01((sunRaw - sunThreshold) / Math.max(0.08, 1 - sunThreshold));
  const smoothGate = sunGate * sunGate * (3 - 2 * sunGate);
  sun.hold += (smoothGate - sun.hold) * (smoothGate > sun.hold ? 0.035 : 0.014);
  const sunTarget = sun.hold > 0.16 ? clamp01((sun.hold - 0.16) / 0.84) : 0;
  sun.energy += (sunTarget - sun.energy) * (sunTarget > sun.energy ? 0.075 : 0.030);

  return {
    bass: shaped.bass,
    mid: shaped.mid,
    treble: shaped.treble,
    beat: shaped.beat,
    energy: audioEnergy,
    smoothBass,
    rippleBass: shaped.bass,
    vocal: voc,
    sunEnergy: sun.energy,
  };
}

/** 同一渲染帧内只推进一次；约 30Hz 采样，减轻沉浸模式 FFT 压力 */
export function readGalaxyAudioBands(dt = 1 / 60, options: GalaxyAudioReadOptions = {}): GalaxyAudioBands {
  const now = performance.now();
  if (now - lastAdvanceMs < 32) {
    return cachedBands;
  }
  const analysisDt = lastAdvanceMs < 0 ? dt : Math.max(0.001, Math.min(0.08, (now - lastAdvanceMs) / 1000));
  lastAdvanceMs = now;
  cachedBands = advanceGalaxyAudioBands(analysisDt, options);
  return cachedBands;
}

/** 供 sonic 地形分析读取当前帧频谱（须先调用 readGalaxyAudioBands） */
export function getGalaxyFrequencyBuffer(): Uint8Array | null {
  if (!ensureAnalyser() || !freqBuf) return null;
  return freqBuf;
}

export function isGalaxyPlaybackActive(): boolean {
  return !getSharedAudio().paused && canWireGalaxyAudioNow();
}

let topographyBins512: Uint8Array | null = null;

/** 将 2048 FFT 频谱下采样为 sonic 原版 512 bin */
export function getTopographyFrequencyBins512(): Uint8Array | null {
  const raw = getGalaxyFrequencyBuffer();
  if (!raw) return null;
  if (!topographyBins512) topographyBins512 = new Uint8Array(512);
  const n = Math.min(512, Math.floor(raw.length / 2));
  for (let i = 0; i < n; i++) {
    topographyBins512[i] = Math.max(raw[i * 2] ?? 0, raw[i * 2 + 1] ?? 0);
  }
  return topographyBins512;
}

export function getCachedGalaxyAudioBands(): GalaxyAudioBands {
  return cachedBands;
}
