import { getSharedAudio } from '../../../lib/audioElement';
import type { QueueItem } from '../../../types';
import { analyzeAudioBeatMap } from './beatMapAnalyzer';
import type { BeatMap, BeatMapEvent, BeatMapPulseEvent } from './beatMapTypes';
import { getCameraDynamicsScale, resetGalaxyCinema, scheduleMapBeatCamera } from './galaxyCinema';

const beatMapCache = new Map<string, BeatMap>();
let currentBeatMap: BeatMap | null = null;
let currentBeatMapKey = '';
let beatMapToken = 0;
let beatMapBusy = false;
let beatMapNextIdx = 0;
let cameraBeatNextIdx = 0;
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledBeatPulse = 0;
let scheduledBeatFlag = false;

const LOOKAHEAD = 0.075;
const ANALYSIS_DELAY_MS = 1600;
const MIN_PLAYBACK_SEC = 1.2;

export function beatMapSongKey(song: Pick<QueueItem, 'queueId' | 'id' | 'source'> | null | undefined): string {
  if (!song?.queueId) return '';
  return `q:${song.queueId}`;
}

export function isBeatMapReadyForCamera(): boolean {
  return Boolean(currentBeatMap?.cameraBeats && currentBeatMap.cameraBeats.length >= 4);
}

export function isBeatMapGridLocked(): boolean {
  if (!currentBeatMap || (currentBeatMap.cameraBeats?.length ?? 0) < 4) return false;
  if (currentBeatMap.tempoSource === 'music-tempo') return true;
  return Boolean(
    currentBeatMap.gridStep > 0 &&
      (currentBeatMap.tempoSource === 'local-grid' || currentBeatMap.pulseBeats.length >= 4),
  );
}

/** @deprecated 使用 isBeatMapGridLocked */
export function isBeatMapReady(): boolean {
  return isBeatMapGridLocked();
}

export function isBeatMapAnalysisPending(): boolean {
  return beatMapBusy || analysisTimer != null;
}

export function getCurrentBeatMap(song?: Pick<QueueItem, 'queueId' | 'id' | 'source'>): BeatMap | null {
  if (song && beatMapSongKey(song) !== currentBeatMapKey) return beatMapCache.get(beatMapSongKey(song)) ?? null;
  return currentBeatMap;
}

export function resetGalaxyBeatMapState(soft = false): void {
  beatMapToken++;
  if (analysisTimer) {
    clearTimeout(analysisTimer);
    analysisTimer = null;
  }
  currentBeatMap = null;
  currentBeatMapKey = '';
  beatMapNextIdx = 0;
  cameraBeatNextIdx = 0;
  scheduledBeatPulse = 0;
  scheduledBeatFlag = false;
  if (!soft) resetGalaxyCinema();
}

function beatEventTime(ev: BeatMapEvent | BeatMapPulseEvent | number): number {
  return typeof ev === 'number' ? ev : ev.time;
}

function syncBeatMapPlaybackCursor(t: number, preserveVisual = false): void {
  const pulseEvents = currentBeatMap?.pulseBeats ?? currentBeatMap?.kicks;
  beatMapNextIdx = 0;
  if (pulseEvents) {
    while (beatMapNextIdx < pulseEvents.length && beatEventTime(pulseEvents[beatMapNextIdx]) < t) {
      beatMapNextIdx++;
    }
  }
  cameraBeatNextIdx = 0;
  const cameraEvents = currentBeatMap?.cameraBeats ?? [];
  while (cameraBeatNextIdx < cameraEvents.length) {
    const bt = beatEventTime(cameraEvents[cameraBeatNextIdx]);
    if (bt >= t + LOOKAHEAD) break;
    cameraBeatNextIdx++;
  }
  if (!preserveVisual) {
    resetGalaxyCinema();
  }
}

function applyBeatMap(key: string, map: BeatMap): void {
  beatMapCache.set(key, map);
  currentBeatMap = map;
  currentBeatMapKey = key;
  const audio = getSharedAudio();
  syncBeatMapPlaybackCursor(audio.currentTime || 0, true);
}

function triggerScheduledBeat(beat: BeatMapPulseEvent | number): void {
  const strength =
    typeof beat === 'number' ? 0.42 : Math.max(0, Math.min(1, beat.strength ?? 0.42));
  const impact =
    typeof beat === 'number' ? strength : Math.max(0, Math.min(1, beat.impact ?? strength));
  if (impact < 0.18 && strength < 0.52) return;
  const body = typeof beat === 'number' ? 0 : Math.max(0, Math.min(1, beat.body ?? 0));
  const combo = typeof beat === 'number' ? undefined : beat.combo;
  const comboLift = combo === 'downbeat' ? 0.08 : combo === 'drop' ? 0.04 : 0;
  const dynScale = getCameraDynamicsScale(0.88 + impact * 0.16);
  const pulse = (0.14 + strength * 0.46 + impact * 0.18 + body * 0.08 + comboLift) * dynScale;
  scheduledBeatPulse = Math.max(scheduledBeatPulse, Math.min(0.78, pulse));
  scheduledBeatFlag = true;
}

/** 每帧调用：按 beatMap 时间轴触发镜头与粒子脉冲（对齐 Mineradio tickBeatMap） */
export function tickGalaxyBeatMap(realtimeHasLock: boolean): void {
  const audio = getSharedAudio();
  if (!currentBeatMap || audio.paused) return;

  const t = audio.currentTime;
  const beatEvents = currentBeatMap.cameraBeats ?? [];
  const pulseEvents = currentBeatMap.pulseBeats ?? currentBeatMap.kicks ?? [];
  const gridTimingLocked =
    (currentBeatMap.tempoSource === 'music-tempo' && beatEvents.length >= 4) ||
    (currentBeatMap.tempoSource === 'local-grid' &&
      beatEvents.length >= 4 &&
      currentBeatMap.gridStep > 0);
  const shouldDriveFromMap = gridTimingLocked || !realtimeHasLock;

  while (cameraBeatNextIdx < beatEvents.length) {
    const beat = beatEvents[cameraBeatNextIdx];
    const beatTime = beatEventTime(beat);
    if (beatTime > t + LOOKAHEAD) break;
    if (shouldDriveFromMap) scheduleMapBeatCamera(beat);
    cameraBeatNextIdx++;
  }

  while (beatMapNextIdx < pulseEvents.length && beatEventTime(pulseEvents[beatMapNextIdx]) <= t) {
    if (shouldDriveFromMap) triggerScheduledBeat(pulseEvents[beatMapNextIdx]);
    beatMapNextIdx++;
  }
}

export function mergeScheduledBeatPulse(beatPulse: number, dt: number): number {
  let next = beatPulse;
  if (scheduledBeatFlag) {
    scheduledBeatFlag = false;
  }
  if (scheduledBeatPulse > next) next = scheduledBeatPulse;
  scheduledBeatPulse *= Math.pow(0.32, Math.max(0.001, dt));
  return next;
}

/** @deprecated 使用 mergeScheduledBeatPulse */
export function consumeScheduledBeatPulse(dt: number): number {
  const pulse = scheduledBeatPulse;
  if (scheduledBeatFlag) scheduledBeatFlag = false;
  scheduledBeatPulse *= Math.pow(0.32, Math.max(0.001, dt));
  return pulse;
}

export function cancelBeatMapAnalysis(): void {
  beatMapToken++;
  if (analysisTimer) {
    clearTimeout(analysisTimer);
    analysisTimer = null;
  }
  beatMapBusy = false;
}

export function scheduleBeatMapAnalysis(
  key: string,
  audioUrl: string,
  options?: { isPlaying?: boolean },
): void {
  if (!key || !audioUrl) return;

  if (beatMapCache.has(key)) {
    applyBeatMap(key, beatMapCache.get(key)!);
    return;
  }

  if (currentBeatMapKey === key && (beatMapBusy || analysisTimer !== null)) {
    return;
  }

  if (currentBeatMapKey !== key) {
    cancelBeatMapAnalysis();
    currentBeatMapKey = key;
  }

  const token = beatMapToken;

  const waitForStart = () => {
    if (token !== beatMapToken) return;
    const audio = getSharedAudio();
    if (!options?.isPlaying || audio.paused) return;

    const current = audio.currentTime || 0;
    if (current < MIN_PLAYBACK_SEC) {
      analysisTimer = setTimeout(waitForStart, Math.max(500, (MIN_PLAYBACK_SEC - current) * 1000));
      return;
    }

    const startAnalysis = async () => {
      if (token !== beatMapToken || beatMapBusy || beatMapCache.has(key)) return;
      beatMapBusy = true;
      try {
        const map = await analyzeAudioBeatMap(audioUrl);
        if (token !== beatMapToken || !map) return;
        applyBeatMap(key, map);
      } catch (err) {
        console.warn('beat map analysis failed:', err);
      } finally {
        beatMapBusy = false;
      }
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => void startAnalysis(), { timeout: 1200 });
    } else {
      setTimeout(() => void startAnalysis(), 200);
    }
  };

  analysisTimer = setTimeout(waitForStart, ANALYSIS_DELAY_MS);
}

export function bindBeatMapToSong(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source'> | null | undefined,
  audioUrl: string | null | undefined,
  isPlaying: boolean,
): void {
  const key = beatMapSongKey(song);
  if (!key) {
    resetGalaxyBeatMapState();
    return;
  }

  if (beatMapCache.has(key)) {
    applyBeatMap(key, beatMapCache.get(key)!);
    return;
  }

  if (currentBeatMap && currentBeatMapKey === key) {
    return;
  }

  if (currentBeatMapKey !== key) {
    currentBeatMapKey = key;
    currentBeatMap = null;
    beatMapNextIdx = 0;
    cameraBeatNextIdx = 0;
    cancelBeatMapAnalysis();
  }

  if (beatMapBusy || analysisTimer) {
    return;
  }

  if (audioUrl && isPlaying) {
    scheduleBeatMapAnalysis(key, audioUrl, { isPlaying: true });
  }
}
