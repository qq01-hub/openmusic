import {
  createBeatDetectorState,
  stepBeatDetector,
} from './topographyBeatDetector';
import {
  getTopographyFrequencyBins512,
  isGalaxyPlaybackActive,
} from '../../galaxy/lib/galaxyAudio';

export interface TopographyAudioData {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  subBass: number;
  lowMid: number;
  highMid: number;
  presence: number;
  brilliance: number;
  air: number;
  warmth: number;
  brightness: number;
  sharpness: number;
  smoothness: number;
  density: number;
  spectralCentroid: number;
  kickLevel: number;
  kickFlux: number;
  kickThreshold: number;
  kickOnset: number;
  kickEnvelope: number;
  kickConfidence: number;
  kickWindowName: string;
  kickWindowStart: number;
  kickWindowEnd: number;
}

export type TriggerPreset = 'Auto Beat' | 'Advanced';

export class TriggerConfig {
  public enabled: boolean = false;
  public mode: TriggerPreset = 'Auto Beat';
  public autoTrack: boolean = true; // Add auto-track feature
  
  // Advanced parameters
  public freqIndex: number = -1;
  public threshold: number = 0.5;
  
  // Auto Beat parameters
  public sensitivity: number = 0.15;
  public cooldown: number = 60;
  public bandStart: number = 0;
  public bandEnd: number = 16;
  public pulseStrength: number = 0.2;

  // Internal evaluation state
  public currentCooldown: number = 0;
  public beatHold: number = 0;
  public lastEvalEnergy: number = 0;
  public lastEvalThresh: number = 0;
  
  public fluxHistory: number[] = new Array(40).fill(0);
  public fluxHistoryIndex: number = 0;
  public smoothedFlux: number = 0;
  public prevSmoothedFlux: number = 0;

  constructor(public action: 'Pulse' | 'Meteor' | 'Snare') {
      this.enabled = true; // Both Pulse and Meteor enabled by default
      this.mode = 'Auto Beat';
      this.bandStart = 0;
      this.bandEnd = 16;
      
      if (action === 'Pulse') {
          // Focus exclusively on the true 'Kick' punch range (approx 40Hz - 120Hz)
          // Bin 1 (43-86Hz) and Bin 2 (86-129Hz). This avoids low-mid vocals.
          this.bandStart = 1;
          this.bandEnd = 2;
          this.sensitivity = 0.85; // Highly sensitive to ensure the white line stays low
          this.cooldown = 15; // Prevent rapid double-firing (spasms)
      } else if (action === 'Meteor') {
          // meteor default params matching user request
          this.bandStart = 159;
          this.bandEnd = 174;
          this.sensitivity = 0.45; 
          this.cooldown = 241; 
          this.pulseStrength = 0.50;
      } else if (action === 'Snare') {
          // High-mid and presence frequencies for claps/snares (approx 2kHz - 5kHz)
          this.bandStart = 47;
          this.bandEnd = 120;
          this.sensitivity = 0.6; // Increased to trigger more easily
          this.cooldown = 30;
          this.pulseStrength = 0.3;
      }
  }

  public getTriggerRange(): [number, number] {
    if (this.mode === 'Auto Beat') return [this.bandStart, this.bandEnd];
    const c = this.freqIndex >= 0 ? this.freqIndex : Math.floor(0.2 * 512);
    return [Math.max(0, c - 2), Math.min(511, c + 2)];
  }
}


export class TopographyAudioEngine {
  private dataArray: Uint8Array = new Uint8Array(512);

  private visualReleaseUntil = 0;
  private frameCacheId = 0;
  private currentFrameId = 0;
  private cachedFrameData: TopographyAudioData | null = null;
  private invalidationScheduled = false;
  private cachedAtMs = 0;

  private beatDetectorState = createBeatDetectorState();
  private lastKickAnalysisTime = 0;

  private scheduleNextFrameInvalidation() {
    if (this.invalidationScheduled || typeof requestAnimationFrame !== 'function') return;
    this.invalidationScheduled = true;
    requestAnimationFrame(() => {
      this.invalidationScheduled = false;
      this.currentFrameId += 1;
      this.cachedFrameData = null;
    });
  }

  private prevData: number[] = new Array(512).fill(0);
  private prevBrightness: number = 0;

  private smoothedData: TopographyAudioData = {
    bass: 0, mid: 0, treble: 0, energy: 0,
    subBass: 0, lowMid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0,
    warmth: 0, brightness: 0, sharpness: 0, smoothness: 0, density: 0, spectralCentroid: 0,
    kickLevel: 0, kickFlux: 0, kickThreshold: 0, kickOnset: 0, kickEnvelope: 0,
    kickConfidence: 0, kickWindowName: 'Classic', kickWindowStart: 1, kickWindowEnd: 4,
  };

  public pulseTrigger = new TriggerConfig('Pulse');
  public meteorTrigger = new TriggerConfig('Meteor');
  public snareTrigger = new TriggerConfig('Snare');
  
  public onFreqTrigger?: (strength: number, type: 'Kick' | 'Snare' | 'Advanced', action: 'Pulse' | 'Meteor' | 'Snare') => void;
  public onAutoTrackUpdate?: (start: number, end: number, sensitivity: number) => void;

  private pulseTrackerData: { time: number, data: number[] }[] = [];
  private lastAutoTrackTime: number = 0;

  private trackAutoPulse(rawData: Uint8Array, now: number) {
      if (!this.pulseTrigger.autoTrack) return;
      
      this.pulseTrackerData.push({ time: now, data: Array.from(rawData.slice(0, 30)) });
      
      // Remove frames older than 3 seconds to guarantee strict 3000ms window regardless of Hz
      while (this.pulseTrackerData.length > 0 && now - this.pulseTrackerData[0].time > 3000) {
          this.pulseTrackerData.shift();
      }

      if (now - this.lastAutoTrackTime > 1000) { // Evaluate every 1 second
          this.lastAutoTrackTime = now;
          this.evaluateAutoPulse();
      }
  }

  private evaluateAutoPulse() {
      const frames = this.pulseTrackerData;
      if (frames.length < 30) return;

      const numFrames = frames.length;
      const numBins = frames[0].data.length;
      const binDiffs = Array.from({ length: numBins }, () => [] as number[]);
      
      for (let f = 1; f < numFrames; f++) {
          for (let b = 0; b < numBins; b++) {
              const val = frames[f].data[b] / 255.0;
              const prevVal = frames[f-1].data[b] / 255.0;
              const diff = val - prevVal;
              if (diff > 0.01) binDiffs[b].push(diff);
          }
      }

      const results = [];
      for (let b = 0; b < numBins; b++) {
          const maxDiff = binDiffs[b].length > 0 ? Math.max(...binDiffs[b]) : 0;
          results.push({ bin: b, maxDiff });
      }

      results.sort((a, b) => b.maxDiff - a.maxDiff);
      const topBinDiff = results[0].maxDiff;
      
      // Intro / Silence / Mud Protection:
      // If the top transient is very weak, there's no punchy kick happening in the last 3s.
      // Ignore this window and keep previous settings to prevent locking onto mud.
      if (topBinDiff < 0.15) return; 

      const bestBins = results.slice(0, 2).map(r => r.bin);
      const start = Math.min(...bestBins);
      const end = Math.max(...bestBins);

      this.pulseTrigger.bandStart = start;
      this.pulseTrigger.bandEnd = end;
      this.pulseTrigger.sensitivity = 0.85; // Optimal for isolated band
      
      if (this.onAutoTrackUpdate) {
          this.onAutoTrackUpdate(start, end, 0.85);
      }
  }

  private evaluateTrigger(config: TriggerConfig, fluxScore: number) {
      if (!config.enabled || !isGalaxyPlaybackActive()) return false;
      
      const binCount = this.dataArray.length;
      let eVal = 0;
      let triggered = false;
      const [startBin, endBin] = config.getTriggerRange();

      if (config.mode === 'Advanced') {
          if (config.freqIndex >= 0 && config.freqIndex < binCount) {
             let sum = 0;
             let count = 0;
             for (let k = startBin; k <= endBin; k++) {
                sum += this.dataArray[k] / 255.0;
                count++;
             }
             eVal = sum / count;
             
             config.lastEvalThresh = config.threshold;
             if (config.currentCooldown <= 0 && eVal > config.threshold) {
                 triggered = true;
             }
          }
         config.lastEvalEnergy = eVal;
         if (triggered) {
              if (this.onFreqTrigger) this.onFreqTrigger(eVal, 'Advanced', config.action);
              config.currentCooldown = 60; // 1s
          }
      }

      if (config.currentCooldown > 0) config.currentCooldown--;

      // Auto Beat Evaluation
      if (config.mode === 'Auto Beat') {
         config.smoothedFlux += (fluxScore - config.smoothedFlux) * 0.4;
         config.fluxHistory[config.fluxHistoryIndex] = config.smoothedFlux;
         config.fluxHistoryIndex = (config.fluxHistoryIndex + 1) % config.fluxHistory.length;

         let avgFlux = 0, fluxVariance = 0;
         for (let i = 0; i < config.fluxHistory.length; i++) avgFlux += config.fluxHistory[i];
         avgFlux /= config.fluxHistory.length;

         for (let i = 0; i < config.fluxHistory.length; i++) {
             fluxVariance += Math.pow(config.fluxHistory[i] - avgFlux, 2);
         }
         fluxVariance /= config.fluxHistory.length;
         const fluxStdDev = Math.sqrt(fluxVariance);

         const thresholdMultiplier = Math.max(0.1, 5.0 - config.sensitivity * 4.0);
         const adaptiveThreshold = Math.max(0.01, avgFlux + fluxStdDev * thresholdMultiplier);

         const isPeak = config.prevSmoothedFlux > adaptiveThreshold && config.prevSmoothedFlux >= config.smoothedFlux;

         if (config.beatHold > 0) {
            config.beatHold--;
         } else if (isPeak && config.prevSmoothedFlux - config.smoothedFlux > 0.0001) {
            // Multiply by 30 (instead of 3) to compensate for the flux normalization by pulseBins, so it passes MapScene's 0.1 strength threshold
            if (this.onFreqTrigger) this.onFreqTrigger(config.prevSmoothedFlux * 30.0 * config.pulseStrength, 'Kick', config.action);
            triggered = true;
            config.beatHold = config.cooldown;
         }

         config.lastEvalEnergy = config.smoothedFlux * 10.0;
         config.lastEvalThresh = adaptiveThreshold * 10.0;
         config.prevSmoothedFlux = config.smoothedFlux;
      }

      return triggered;
  }

  public getRawFrequencyData(): Uint8Array {
    return this.dataArray;
  }


  public getAudioData(): TopographyAudioData {
    const canUseRaf = typeof requestAnimationFrame === 'function';
    const nowForCache = canUseRaf ? 0 : performance.now();
    if (
      this.cachedFrameData
      && this.frameCacheId === this.currentFrameId
      && (canUseRaf || nowForCache - this.cachedAtMs < 12)
    ) {
      return { ...this.cachedFrameData };
    }

    const bins = getTopographyFrequencyBins512();
    if (!bins) {
      const fallback = { ...this.smoothedData };
      this.cachedFrameData = fallback;
      this.frameCacheId = this.currentFrameId;
      this.cachedAtMs = performance.now();
      this.scheduleNextFrameInvalidation();
      return { ...fallback };
    }

    const isVisualReleasing = performance.now() < this.visualReleaseUntil;
    const isPlaying = isGalaxyPlaybackActive();
    let energySum = 0;
    let centroidNum = 0;
    let centroidDen = 0;

    let subBassSum = 0, bassSum = 0, lowMidSum = 0, midSum = 0;
    let highMidSum = 0, presenceSum = 0, brillianceSum = 0, airSum = 0;
    let jumpVolatilitySum = 0;
    const now = performance.now();
    const kickDeltaSeconds = this.lastKickAnalysisTime > 0
      ? Math.max(0, Math.min(0.25, (now - this.lastKickAnalysisTime) / 1000))
      : 1 / 60;
    this.lastKickAnalysisTime = now;

    const binCount = this.dataArray.length; // 512

    if (isPlaying) {
      this.dataArray.set(bins);

      let fluxPulse = 0;
      let fluxMeteor = 0;
      let fluxSnare = 0;
      if (isPlaying) {
          this.trackAutoPulse(this.dataArray, now);
      }

      for (let i = 0; i < binCount; i++) {
          const val = this.dataArray[i] / 255.0; // normalize 0-1
          energySum += val;
          
          centroidNum += i * val;
          centroidDen += val;

          const prevVal = this.prevData[i] || 0;
          jumpVolatilitySum += Math.abs(val - prevVal);
          
          // Flux for pulse
          if (i >= this.pulseTrigger.bandStart && i <= this.pulseTrigger.bandEnd) {
             const diff = val - prevVal;
             if (diff > 0.01) fluxPulse += diff; // 1% noise gate
          }

          // Flux for snare
          if (i >= this.snareTrigger.bandStart && i <= this.snareTrigger.bandEnd) {
             const diff = val - prevVal;
             if (diff > 0.01) fluxSnare += diff;
          }

          // Flux for meteor
          if (i >= this.meteorTrigger.bandStart && i <= this.meteorTrigger.bandEnd) {
             const diff = val - prevVal;
             if (diff > 0.01) fluxMeteor += diff;
          }

          this.prevData[i] = val;

          if (i <= 1) subBassSum += val;
          else if (i <= 3) bassSum += val;
          else if (i <= 7) lowMidSum += val;
          else if (i <= 18) midSum += val;
          else if (i <= 46) highMidSum += val;
          else if (i <= 93) presenceSum += val;
          else if (i <= 186) brillianceSum += val;
          else if (i <= 372) airSum += val;
      }
      
      // Normalize flux scores by the number of bins in each band.
      // This ensures the value is an average flux per bin (0.0 to 1.0),
      // making the threshold math work perfectly regardless of band size.
      const pulseBins = Math.max(1, this.pulseTrigger.bandEnd - this.pulseTrigger.bandStart + 1);
      this.evaluateTrigger(this.pulseTrigger, fluxPulse / pulseBins);
      
      const snareBins = Math.max(1, this.snareTrigger.bandEnd - this.snareTrigger.bandStart + 1);
      this.evaluateTrigger(this.snareTrigger, fluxSnare / snareBins);
      
      const meteorBins = Math.max(1, this.meteorTrigger.bandEnd - this.meteorTrigger.bandStart + 1);
      this.evaluateTrigger(this.meteorTrigger, fluxMeteor / meteorBins);
    } else {
      // When playback stops or switches, decay raw and smoothed values instead of snapping to zero.
      for (let i = 0; i < binCount; i++) {
          this.dataArray[i] = isVisualReleasing ? Math.floor(this.dataArray[i] * 0.94) : 0;
          this.prevData[i] = 0;
      }
    }

    const beatDetectorOutput = stepBeatDetector({
      state: this.beatDetectorState,
      frequencyData: this.dataArray,
      deltaSeconds: kickDeltaSeconds,
      settings: { sensitivity: 100 },
    });
    this.beatDetectorState = beatDetectorOutput.state;

    const energy = energySum / binCount;
    
    // Average amplitudes per band
    const subBass = subBassSum / 2;
    const bass = bassSum / 2;
    const lowMid = lowMidSum / 4;
    const mid = midSum / 11;
    const highMid = highMidSum / 28;
    const presence = presenceSum / 47;
    const brilliance = brillianceSum / 93;
    const air = airSum / 186;

    // Legacy mapping for compatibility
    const oldBass = (subBassSum + bassSum + lowMidSum) / 8;
    const oldMid = (midSum + highMidSum) / 39;
    const oldTreble = (presenceSum + brillianceSum + airSum) / 326;

    // Timbral Metrics
    const warmth = energySum > 0 ? (subBassSum + bassSum + lowMidSum + midSum) / energySum : 0;
    const brightness = energySum > 0 ? (presenceSum + brillianceSum + airSum) / energySum : 0;
    
    const sharpness = Math.max(0, brightness - this.prevBrightness) * 10;
    this.prevBrightness = brightness;

    const smoothnessVal = Math.max(0, 1.0 - (jumpVolatilitySum / binCount) * 2.0);
    
    const activeThreshold = energy * 1.5;
    let activeBands = 0;
    if (subBass > activeThreshold) activeBands++;
    if (bass > activeThreshold) activeBands++;
    if (lowMid > activeThreshold) activeBands++;
    if (mid > activeThreshold) activeBands++;
    if (highMid > activeThreshold) activeBands++;
    if (presence > activeThreshold) activeBands++;
    if (brilliance > activeThreshold) activeBands++;
    if (air > activeThreshold) activeBands++;
    const density = activeBands / 8;

    const spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0;

    // Apply Exponential Smoothing to prevent sudden jumping/explosions
    const hasIncomingAudio = isPlaying && energySum > 0;
    const dt = hasIncomingAudio ? 0.15 : (isVisualReleasing ? 0.035 : 0.08); // smoothing factor (0 = stuck, 1 = instant jump)
    
    this.smoothedData.bass += (oldBass - this.smoothedData.bass) * dt;
    this.smoothedData.mid += (oldMid - this.smoothedData.mid) * dt;
    this.smoothedData.treble += (oldTreble - this.smoothedData.treble) * dt;
    this.smoothedData.energy += (energy - this.smoothedData.energy) * dt;
    
    this.smoothedData.subBass += (subBass - this.smoothedData.subBass) * dt;
    this.smoothedData.lowMid += (lowMid - this.smoothedData.lowMid) * dt;
    this.smoothedData.highMid += (highMid - this.smoothedData.highMid) * dt;
    this.smoothedData.presence += (presence - this.smoothedData.presence) * dt;
    this.smoothedData.brilliance += (brilliance - this.smoothedData.brilliance) * dt;
    this.smoothedData.air += (air - this.smoothedData.air) * dt;
    
    this.smoothedData.warmth += (warmth - this.smoothedData.warmth) * dt;
    this.smoothedData.brightness += (brightness - this.smoothedData.brightness) * dt;
    this.smoothedData.sharpness += (sharpness - this.smoothedData.sharpness) * dt;
    this.smoothedData.smoothness += (smoothnessVal - this.smoothedData.smoothness) * dt;
    this.smoothedData.density += (density - this.smoothedData.density) * dt;
    this.smoothedData.spectralCentroid += (spectralCentroid - this.smoothedData.spectralCentroid) * dt;
    this.smoothedData.kickLevel = beatDetectorOutput.kickLevel;
    this.smoothedData.kickFlux = beatDetectorOutput.kickFlux;
    this.smoothedData.kickThreshold = beatDetectorOutput.kickThreshold;
    this.smoothedData.kickOnset = beatDetectorOutput.kickOnset;
    this.smoothedData.kickEnvelope = beatDetectorOutput.kickEnvelope;
    this.smoothedData.kickConfidence = beatDetectorOutput.kickConfidence;
    this.smoothedData.kickWindowName = beatDetectorOutput.activeWindow.name;
    this.smoothedData.kickWindowStart = beatDetectorOutput.activeWindow.start;
    this.smoothedData.kickWindowEnd = beatDetectorOutput.activeWindow.end;

    const snapshot = { ...this.smoothedData };
    this.cachedFrameData = snapshot;
    this.frameCacheId = this.currentFrameId;
    this.cachedAtMs = now;
    this.scheduleNextFrameInvalidation();
    return { ...snapshot };
  }
}

export const topographyEngine = new TopographyAudioEngine();
