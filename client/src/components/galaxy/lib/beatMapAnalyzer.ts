import type { BeatCombo, BeatMap, BeatMapEvent, BeatMapPulseEvent } from './beatMapTypes';
import {
  analyzeMusicTempoInWorker,
  estimateTempoPhaseOffset,
  medianGap,
  normalizeMusicTempoBeats,
} from './musicTempoAnalyzer';
import { resolveSignedApiUrl } from '../../../lib/signedApiUrl';

const HOP_SEC = 0.01;
const MAX_BEATMAP_AUDIO_BYTES = 24 * 1024 * 1024;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0.001;
  const copy = [...arr].sort((a, b) => a - b);
  return copy[Math.max(0, Math.min(copy.length - 1, Math.floor(copy.length * p)))] || 0.001;
}

function bandAt(arr: Float32Array, f: number, nFrames: number): number {
  const a = arr[Math.max(0, f - 1)] || 0;
  const b = arr[f] || 0;
  const c = arr[Math.min(nFrames - 1, f + 1)] || 0;
  return (a + b * 2 + c) * 0.25;
}

function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function renderBand(
  buffer: AudioBuffer,
  hpFreq: number | null,
  lpFreq: number | null,
): Promise<Float32Array> {
  const TmpCtx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!TmpCtx) throw new Error('OfflineAudioContext unavailable');

  const sr = buffer.sampleRate;
  const off = new TmpCtx(1, buffer.length, sr);
  const src = off.createBufferSource();
  src.buffer = buffer;
  let node: AudioNode = src;

  if (hpFreq != null) {
    const hp = off.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = Math.min(hpFreq, sr * 0.45);
    hp.Q.value = 0.85;
    node.connect(hp);
    node = hp;
  }
  if (lpFreq != null) {
    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(lpFreq, sr * 0.45);
    lp.Q.value = 0.9;
    node.connect(lp);
    node = lp;
  }
  node.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

function makeFrameEnergy(pcm: Float32Array, winSize: number): Float32Array {
  const frames = Math.floor(pcm.length / winSize);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const off = f * winSize;
    for (let i = 0; i < winSize; i++) {
      const v = pcm[off + i];
      s += v * v;
    }
    out[f] = Math.sqrt(s / winSize);
  }
  return out;
}

function makeOnset(arr: Float32Array): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 1; i < arr.length; i++) {
    out[i] = Math.max(0, arr[i] - arr[i - 1]);
  }
  return out;
}

interface Candidate {
  frame: number;
  time: number;
  score: number;
  lowTone: number;
  bodyTone: number;
  vocalTone: number;
  snapTone: number;
}

function thinPulseCameraBeats(events: BeatMapEvent[], gridStep: number): BeatMapEvent[] {
  const strong = events.filter(
    (b) =>
      b.camera !== false &&
      b.primary !== false &&
      b.pulse !== false &&
      (b.impact >= 0.24 || b.strength >= 0.44 || b.combo === 'downbeat'),
  );
  if (strong.length >= 8) return strong;

  const rail = Math.max(0.42, gridStep || 0.55);
  const sparse: BeatMapEvent[] = [];
  let lastT = -10;
  for (const b of events) {
    if (b.camera === false || b.pulse === false) continue;
    if (b.time - lastT < rail * 0.72) continue;
    if ((b.impact ?? 0) < 0.18 && (b.strength ?? 0) < 0.4) continue;
    sparse.push(b);
    lastT = b.time;
  }
  return sparse.length >= 4 ? sparse : events.filter((b) => b.camera !== false);
}
export async function analyzeAudioBeatMap(
  audioUrl: string,
  options?: { signal?: AbortSignal; onProgress?: (msg: string) => void },
): Promise<BeatMap | null> {
  const signal = options?.signal;
  const progress = options?.onProgress;

  if (signal?.aborted) return null;
  progress?.('下载音频…');
  const signedUrl = (await resolveSignedApiUrl(audioUrl)) || audioUrl;
  const resp = await fetch(signedUrl, { signal, credentials: 'same-origin' });
  if (!resp.ok) return null;
  const declaredBytes = Number(resp.headers.get('content-length') || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BEATMAP_AUDIO_BYTES) {
    try { await resp.body?.cancel?.(); } catch { /* ignore */ }
    return null;
  }
  const ab = await resp.arrayBuffer();
  if (signal?.aborted || ab.byteLength > MAX_BEATMAP_AUDIO_BYTES) return null;

  progress?.('解码音频…');
  const DecodeCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!DecodeCtx) return null;
  const dc = new DecodeCtx();
  let buffer: AudioBuffer | null = null;
  try {
    buffer = await new Promise<AudioBuffer | null>((resolve) => {
      void dc.decodeAudioData(
        ab,
        (b) => resolve(b),
        () => resolve(null),
      );
    });
  } finally {
    void dc.close?.().catch(() => {});
  }
  if (!buffer || signal?.aborted) return null;

  const musicTempoTask = analyzeMusicTempoInWorker(buffer, signal);

  progress?.('分离频段…');
  const lowPcm = await renderBand(buffer, 38, 155);
  if (signal?.aborted) return null;
  await yieldToPaint();
  const bodyPcm = await renderBand(buffer, 130, 420);
  if (signal?.aborted) return null;
  await yieldToPaint();
  const vocalPcm = await renderBand(buffer, 420, 2600);
  if (signal?.aborted) return null;
  await yieldToPaint();
  const snapPcm = await renderBand(buffer, 1800, 9000);
  if (signal?.aborted) return null;

  const sr = buffer.sampleRate;
  const winSize = Math.floor(sr * HOP_SEC);
  progress?.('提取鼓点能量…');
  const energy = makeFrameEnergy(lowPcm, winSize);
  const bodyEnergy = makeFrameEnergy(bodyPcm, winSize);
  const vocalEnergy = makeFrameEnergy(vocalPcm, winSize);
  const snapEnergy = makeFrameEnergy(snapPcm, winSize);
  const nFrames = Math.min(energy.length, bodyEnergy.length, vocalEnergy.length, snapEnergy.length);

  const lowRef = Math.max(0.0008, percentile([...energy], 0.86));
  const bodyRef = Math.max(0.0008, percentile([...bodyEnergy], 0.86));
  const vocalRef = Math.max(0.0008, percentile([...vocalEnergy], 0.86));
  const snapRef = Math.max(0.0008, percentile([...snapEnergy], 0.86));

  const onset = makeOnset(energy);
  const bodyOnset = makeOnset(bodyEnergy);
  const vocalOnset = makeOnset(vocalEnergy);
  const lowOnsetRef = Math.max(0.00025, percentile([...onset], 0.88));
  const bodyOnsetRef = Math.max(0.00025, percentile([...bodyOnset], 0.88));
  const vocalOnsetRef = Math.max(0.00025, percentile([...vocalOnset], 0.88));

  progress?.('检测鼓点…');
  const winN = 50;
  const candidates: Candidate[] = [];
  let lastKickFrame = -winN;
  const minIntervalFrames = 12;

  for (let f = winN; f < nFrames - 5; f++) {
    let sum = 0;
    let sqSum = 0;
    for (let k = f - winN; k < f; k++) {
      sum += onset[k];
      sqSum += onset[k] * onset[k];
    }
    const mean = sum / winN;
    const std = Math.sqrt(Math.max(0, sqSum / winN - mean * mean));
    const thresh = mean + std * 2.35 + 0.0045;
    if (onset[f] > thresh && onset[f] > onset[f - 1] && onset[f] >= onset[f + 1]) {
      if (f - lastKickFrame >= minIntervalFrames) {
        const localScore = (onset[f] - thresh) / Math.max(0.006, std + mean * 0.35);
        candidates.push({
          frame: f,
          time: f * HOP_SEC,
          score: localScore,
          lowTone: Math.min(2, bandAt(energy, f, nFrames) / lowRef),
          bodyTone: Math.min(2, bandAt(bodyEnergy, f, nFrames) / bodyRef),
          vocalTone: Math.min(2, bandAt(vocalEnergy, f, nFrames) / vocalRef),
          snapTone: Math.min(2, bandAt(snapEnergy, f, nFrames) / snapRef),
        });
        lastKickFrame = f;
      }
    }
    if (f > winN && f % 900 === 0) {
      await yieldToPaint();
      if (signal?.aborted) return null;
    }
  }

  if (!candidates.length) {
    return {
      kicks: [],
      beats: [],
      pulseBeats: [],
      cameraBeats: [],
      gridStep: 0,
      tempoSource: 'onset-grid',
      duration: buffer.duration,
      visualBeatCount: 0,
      analyzedAt: Date.now(),
    };
  }

  const scores = candidates.map((b) => b.score).sort((a, b) => a - b);
  const p75 = scores[Math.floor(scores.length * 0.75)] ?? 1;
  const p92 = scores[Math.floor(scores.length * 0.92)] ?? Math.max(1, p75);

  const strongTimes: number[] = [];
  const beats: BeatMapEvent[] = candidates.map((b, i) => {
    const strength = Math.max(0.18, Math.min(1, (b.score - p75 * 0.36) / Math.max(0.001, p92 - p75 * 0.36)));
    const lowDominance = b.lowTone / Math.max(0.001, b.vocalTone * 0.84 + b.bodyTone * 0.36 + b.snapTone * 0.1);
    const toneTotal = Math.max(0.001, b.lowTone + b.bodyTone * 0.72 + b.snapTone * 0.58);
    const lowMix = b.lowTone / toneTotal;
    const bodyMix = (b.bodyTone * 0.72) / toneTotal;
    const snapMix = (b.snapTone * 0.58) / toneTotal;
    const drumLike = b.lowTone > 0.38 && (lowMix > 0.42 || lowDominance > 0.72);
    if (strength > 0.55 && drumLike) strongTimes.push(b.time);
    const sharpness = Math.max(0.08, Math.min(1, snapMix * 1.55 + strength * 0.1));
    const mass = Math.max(0.25, Math.min(1, lowMix * 0.72 + bodyMix * 0.36 + strength * 0.2));
    const slot = i % 4;
    const combo: BeatCombo =
      slot === 0 ? 'downbeat' : slot === 1 ? 'push' : slot === 2 ? 'drop' : 'rebound';
    const impact = clamp01(0.022 + strength ** 1.62 * 0.86 + (combo === 'downbeat' ? 0.016 : 0));
    return {
      time: b.time,
      strength,
      confidence: Math.max(0.22, Math.min(1, b.score / Math.max(0.001, p92))),
      impact,
      primary: drumLike && strength >= 0.5,
      camera: drumLike && strength >= 0.42,
      pulse: impact > 0.16 || combo === 'downbeat',
      combo,
      low: lowMix,
      body: bodyMix,
      snap: snapMix,
      mass,
      sharpness,
      index: i,
    };
  });

  const gaps: number[] = [];
  for (let gi = 1; gi < strongTimes.length; gi++) {
    const gap = strongTimes[gi] - strongTimes[gi - 1];
    if (gap >= 0.26 && gap <= 0.86) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  let gridStep = gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0;
  let cameraBeats: BeatMapEvent[] = beats.filter((b) => b.camera);

  if (gridStep > 0) {
    for (let bi = 0; bi < beats.length; bi++) {
      const prevGap = bi > 0 ? beats[bi].time - beats[bi - 1].time : gridStep;
      const nextGap = bi < beats.length - 1 ? beats[bi + 1].time - beats[bi].time : gridStep;
      const gridLike =
        Math.abs(prevGap - gridStep) < gridStep * 0.32 || Math.abs(nextGap - gridStep) < gridStep * 0.32;
      beats[bi].primary = Boolean(beats[bi].camera && beats[bi].strength >= (gridLike ? 0.42 : 0.58));
    }

    if (gridStep >= 0.38 && gridStep <= 0.88 && strongTimes.length >= 4) {
      progress?.('对齐节拍网格…');
      let anchor = strongTimes[0];
      while (anchor - gridStep > 0.2) anchor -= gridStep;
      const gridBeats: BeatMapEvent[] = [];
      const windowSec = Math.min(0.18, gridStep * 0.3);
      let gridIndex = 0;

      for (let gt = anchor; gt < buffer.duration - 0.05; gt += gridStep) {
        let best: BeatMapEvent | null = null;
        let bestDist = windowSec;
        for (let ci = 0; ci < beats.length; ci++) {
          const dist = Math.abs(beats[ci].time - gt);
          if (dist < bestDist) {
            best = beats[ci];
            bestDist = dist;
          }
        }
        const slot = gridIndex % 4;
        const combo: BeatCombo =
          slot === 0 ? 'downbeat' : slot === 1 ? 'push' : slot === 2 ? 'drop' : 'rebound';

        if (best && best.camera) {
          const aligned: BeatMapEvent = {
            ...best,
            primary: true,
            strength: Math.max(best.strength, 0.54),
            confidence: Math.max(best.confidence, 0.58),
            combo,
            index: gridIndex,
          };
          gridBeats.push(aligned);
        } else {
          const gf = Math.max(0, Math.min(nFrames - 1, Math.round(gt / HOP_SEC)));
          const lowTone = Math.min(2, bandAt(energy, gf, nFrames) / lowRef);
          const bodyTone = Math.min(2, bandAt(bodyEnergy, gf, nFrames) / bodyRef);
          const vocalTone = Math.min(2, bandAt(vocalEnergy, gf, nFrames) / vocalRef);
          const snapTone = Math.min(2, bandAt(snapEnergy, gf, nFrames) / snapRef);
          const lowDominance = lowTone / Math.max(0.001, vocalTone * 0.84 + bodyTone * 0.36 + snapTone * 0.1);
          const toneTotal = Math.max(0.001, lowTone + bodyTone * 0.72 + snapTone * 0.58);
          const lowMix = lowTone / toneTotal;
          const bodyMix = (bodyTone * 0.72) / toneTotal;
          const snapMix = (snapTone * 0.58) / toneTotal;
          if (lowTone <= 0.38 || (lowMix <= 0.42 && lowDominance <= 0.72)) {
            gridIndex++;
            continue;
          }
          const strength = 0.53;
          gridBeats.push({
            time: gt,
            strength,
            confidence: 0.6,
            impact: clamp01(0.022 + strength ** 1.5 * 0.7),
            primary: true,
            camera: true,
            pulse: combo === 'downbeat' || combo === 'drop',
            combo,
            low: lowMix,
            body: bodyMix,
            snap: snapMix,
            mass: Math.max(0.35, Math.min(0.82, lowMix * 0.72 + bodyMix * 0.36 + 0.16)),
            sharpness: Math.max(0.08, Math.min(0.65, snapMix * 1.25)),
            index: gridIndex,
          });
        }
        gridIndex++;
      }
      if (gridBeats.length >= 4) {
        cameraBeats = gridBeats;
      }
    }
  }

  progress?.('锁定 BPM 网格…');
  const musicTempoResult = await musicTempoTask;
  if (signal?.aborted) return null;

  let tempoSource: BeatMap['tempoSource'] = gridStep > 0 && cameraBeats.length >= 4 ? 'local-grid' : 'onset-grid';

  if (musicTempoResult?.beats?.length) {
    let musicTempoBeats = normalizeMusicTempoBeats(musicTempoResult.beats, buffer.duration);
    let musicTempoGridStep = medianGap(musicTempoBeats, 0.36, 1.0);

    if (musicTempoBeats.length >= 4) {
      const phaseOffset = estimateTempoPhaseOffset(musicTempoBeats, beats, musicTempoGridStep || gridStep, buffer.duration);
      if (phaseOffset) {
        musicTempoBeats = musicTempoBeats
          .map((t) => t + phaseOffset)
          .filter((t) => Number.isFinite(t) && t >= 0.05 && t < buffer.duration - 0.05);
      }

      const tempoWindow = Math.min(0.16, Math.max(0.095, (musicTempoGridStep || 0.6) * 0.24));
      const tempoCameraBeats: BeatMapEvent[] = [];

      for (let ti = 0; ti < musicTempoBeats.length; ti++) {
        const mtTime = musicTempoBeats[ti];
        let nearest: BeatMapEvent | null = null;
        let nearestDist = tempoWindow;
        for (const b of beats) {
          const nd = Math.abs(b.time - mtTime);
          if (nd < nearestDist) {
            nearest = b;
            nearestDist = nd;
          }
        }

        const mf = Math.max(0, Math.min(nFrames - 1, Math.round(mtTime / HOP_SEC)));
        const mtLowTone = Math.min(2, bandAt(energy, mf, nFrames) / lowRef);
        const mtBodyTone = Math.min(2, bandAt(bodyEnergy, mf, nFrames) / bodyRef);
        const mtVocalTone = Math.min(2, bandAt(vocalEnergy, mf, nFrames) / vocalRef);
        const mtSnapTone = Math.min(2, bandAt(snapEnergy, mf, nFrames) / snapRef);
        const mtLowRise = Math.min(2.5, (onset[mf] || 0) / lowOnsetRef);
        const mtBodyRise = Math.min(2.5, (bodyOnset[mf] || 0) / bodyOnsetRef);
        const mtVocalRise = Math.min(2.5, (vocalOnset[mf] || 0) / vocalOnsetRef);
        const mtLowDominance = mtLowTone / Math.max(0.001, mtVocalTone * 0.84 + mtBodyTone * 0.36 + mtSnapTone * 0.1);
        const mtToneTotal = Math.max(0.001, mtLowTone + mtBodyTone * 0.72 + mtSnapTone * 0.58);
        const mtLowMix = mtLowTone / mtToneTotal;
        const mtBodyMix = (mtBodyTone * 0.72) / mtToneTotal;
        const mtSnapMix = (mtSnapTone * 0.58) / mtToneTotal;
        const vocalLeak = Math.max(
          0,
          mtVocalRise + mtVocalTone * 0.22 - (mtLowRise + mtBodyRise) * 0.5 - 0.14,
        );
        const mtPower =
          mtLowTone * 0.26 +
          mtBodyTone * 0.24 +
          mtLowRise * 0.34 +
          mtBodyRise * 0.32 +
          Math.min(1.7, mtLowDominance) * 0.1 +
          (nearest ? nearest.strength * 0.3 : 0) -
          vocalLeak * 0.16;

        const mtSlot = ti % 4;
        const mtImpact = clamp01(mtPower / 1.35);
        const activeCamera = mtImpact >= 0.2 || (mtSlot === 0 && mtImpact >= 0.15);
        const activePulse = mtImpact >= 0.24 || (mtSlot === 0 && mtImpact >= 0.18);
        let mtStrength = 0.26 + mtImpact * 0.42;
        if (nearest) mtStrength = Math.max(mtStrength, 0.42 + nearest.strength * 0.28);
        if (mtSlot === 0 && activeCamera) mtStrength = Math.max(mtStrength, 0.54 + mtImpact * 0.16);
        if (!activeCamera) mtStrength = Math.min(mtStrength, 0.36);
        mtStrength = Math.max(0.3, Math.min(0.82, mtStrength));

        const combo: BeatCombo =
          mtSlot === 0 ? 'downbeat' : mtSlot === 1 ? 'push' : mtSlot === 2 ? 'drop' : 'rebound';
        if (!activeCamera || !activePulse) continue;
        tempoCameraBeats.push({
          time: mtTime,
          strength: mtStrength,
          confidence: nearest ? Math.max(0.6, nearest.confidence) : Math.max(0.52, 0.48 + mtImpact * 0.28),
          impact: mtImpact,
          primary: activeCamera,
          camera: activeCamera,
          pulse: activePulse,
          combo,
          low: Math.max(0.22, Math.min(0.78, mtLowMix * 0.82)),
          body: mtBodyMix,
          snap: mtSnapMix,
          mass: Math.max(0.35, Math.min(0.86, mtLowMix * 0.68 + mtBodyMix * 0.24 + mtStrength * 0.16)),
          sharpness: Math.max(0.08, Math.min(0.65, mtSnapMix * 1.18)),
          index: ti,
        });
      }

      if (tempoCameraBeats.length >= 4) {
        cameraBeats = tempoCameraBeats;
        gridStep = musicTempoGridStep || gridStep;
        tempoSource = 'music-tempo';
      }
    }
  }

  cameraBeats = thinPulseCameraBeats(cameraBeats, gridStep);

  const pulseBeats: BeatMapPulseEvent[] = cameraBeats
    .filter((b) => b.primary !== false && b.camera !== false && b.pulse !== false)
    .filter((b) => b.strength >= 0.38 || b.impact >= 0.2)
    .map((b) => ({
      time: b.time,
      strength: b.strength,
      impact: b.impact,
      combo: b.combo,
      low: b.low,
      body: b.body,
      snap: b.snap,
    }));

  return {
    kicks: beats.map((b) => b.time),
    beats,
    pulseBeats,
    cameraBeats,
    gridStep,
    tempoSource,
    duration: buffer.duration,
    visualBeatCount: pulseBeats.length,
    analyzedAt: Date.now(),
  };
}
