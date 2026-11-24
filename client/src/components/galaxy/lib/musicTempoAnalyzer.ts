function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function medianGap(times: number[], minGap: number, maxGap: number): number {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap >= minGap && gap <= maxGap) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0;
}

export function normalizeMusicTempoBeats(times: number[], duration: number): number[] {
  if (!times.length) return [];
  const sorted = times
    .filter((t) => Number.isFinite(t) && t >= 0.05 && (!duration || t < duration - 0.05))
    .sort((a, b) => a - b);
  if (sorted.length < 4) return sorted;
  const gap = medianGap(sorted, 0.2, 1.2);
  const minMainGap = gap && gap < 0.42 ? Math.min(0.44, gap * 1.65) : 0.36;
  const out: number[] = [];
  let last = -10;
  for (const t of sorted) {
    if (t - last >= minMainGap) {
      out.push(t);
      last = t;
    }
  }
  return out;
}

export function estimateTempoPhaseOffset(
  tempoBeats: number[],
  beatCandidates: Array<{ time: number; strength?: number; camera?: boolean; primary?: boolean; low?: number; mass?: number }>,
  step: number,
  duration: number,
): number {
  if (tempoBeats.length < 8 || beatCandidates.length < 4 || !step) return 0;
  const maxOffset = Math.min(0.26, Math.max(0.12, step * 0.58));
  const binSize = 0.025;
  const bins: Record<number, number> = {};
  const samples: Array<{ offset: number; weight: number; key: number }> = [];
  let totalWeight = 0;
  let ti = 0;
  for (const b of beatCandidates) {
    if (!Number.isFinite(b.time)) continue;
    if (duration && (b.time < 1.0 || b.time > duration - 0.5)) continue;
    const strength = clamp01(b.strength ?? 0);
    if (!b.camera && strength < 0.54) continue;
    if ((b.low ?? 0) < 0.18 && strength < 0.66) continue;
    while (ti < tempoBeats.length - 1 && Math.abs(tempoBeats[ti + 1] - b.time) <= Math.abs(tempoBeats[ti] - b.time)) {
      ti++;
    }
    const offset = b.time - tempoBeats[ti];
    if (!Number.isFinite(offset) || Math.abs(offset) > maxOffset) continue;
    let weight = 0.2 + strength * strength * 1.35;
    if (b.primary) weight *= 1.35;
    if (b.camera) weight *= 1.18;
    if (b.mass != null) weight *= 0.82 + clamp01(b.mass) * 0.42;
    if (Math.abs(offset) < 0.025) weight *= 0.72;
    const key = Math.round(offset / binSize);
    bins[key] = (bins[key] || 0) + weight;
    samples.push({ offset, weight, key });
    totalWeight += weight;
  }
  if (samples.length < 4 || totalWeight <= 0) return 0;
  let bestKey: number | null = null;
  let bestWeight = 0;
  for (const k of Object.keys(bins)) {
    const key = parseInt(k, 10);
    const w = (bins[key] || 0) + (bins[key - 1] || 0) * 0.72 + (bins[key + 1] || 0) * 0.72;
    if (w > bestWeight) {
      bestWeight = w;
      bestKey = key;
    }
  }
  if (bestKey == null || bestWeight < totalWeight * 0.26) return 0;
  let sum = 0;
  let wsum = 0;
  for (const s of samples) {
    if (Math.abs(s.key - bestKey) <= 1) {
      sum += s.offset * s.weight;
      wsum += s.weight;
    }
  }
  if (wsum <= 0) return 0;
  const offsetOut = sum / wsum;
  return Math.abs(offsetOut) >= 0.045 ? Math.max(-maxOffset, Math.min(maxOffset, offsetOut)) : 0;
}

let musicTempoWorkerUrl: string | null = null;

function getMusicTempoWorkerUrl(): string {
  if (musicTempoWorkerUrl) return musicTempoWorkerUrl;
  const code = [
    'self.onmessage=function(e){',
    'var d=e.data||{};',
    'try{',
    'importScripts(d.scriptUrl||"/vendor/music-tempo.min.js");',
    'var C=self.MusicTempo||(typeof MusicTempo!=="undefined"?MusicTempo:null);',
    'if(!C)throw new Error("MusicTempo unavailable");',
    'var mono=new Float32Array(d.mono);',
    'var mt=new C(mono,{bufferSize:2048,hopSize:Math.max(128,Math.round(d.sampleRate*0.010)),timeStep:0.010,minBeatInterval:0.36,maxBeatInterval:0.95,expiryTime:8});',
    'self.postMessage({ok:true,tempo:mt.tempo||0,beats:mt.beats||[]});',
    '}catch(err){self.postMessage({ok:false,error:(err&&err.message)||String(err)});}',
    '};',
  ].join('');
  musicTempoWorkerUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  return musicTempoWorkerUrl;
}

export interface MusicTempoResult {
  tempo: number;
  beats: number[];
}

export async function analyzeMusicTempoInWorker(
  buffer: AudioBuffer,
  signal?: AbortSignal,
): Promise<MusicTempoResult | null> {
  if (typeof Worker === 'undefined' || signal?.aborted) return null;
  const channels = buffer.numberOfChannels;
  const len = buffer.length;
  const mono = new Float32Array(len);
  const chDataList: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) chDataList.push(buffer.getChannelData(ch));
  const chScale = 1 / Math.max(1, channels);
  for (let mi = 0; mi < len; mi++) {
    let sum = 0;
    for (let ci = 0; ci < channels; ci++) sum += chDataList[ci][mi] * chScale;
    mono[mi] = sum;
  }
  if (signal?.aborted) return null;

  const worker = new Worker(getMusicTempoWorkerUrl());
  try {
    return await new Promise<MusicTempoResult | null>((resolve) => {
      let done = false;
      const finish = (result: MusicTempoResult | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        worker.terminate();
        resolve(result);
      };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), 16000);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      worker.onmessage = (ev: MessageEvent<{ ok?: boolean; tempo?: number; beats?: number[] }>) => {
        const data = ev.data;
        if (!data?.ok) {
          finish(null);
          return;
        }
        finish({ tempo: data.tempo ?? 0, beats: data.beats ?? [] });
      };
      worker.onerror = () => {
        finish(null);
      };
      worker.postMessage({
        mono: mono.buffer,
        sampleRate: buffer.sampleRate,
        scriptUrl: `${window.location.origin}/vendor/music-tempo.min.js`,
      }, [mono.buffer]);
    });
  } catch {
    worker.terminate();
    return null;
  }
}
