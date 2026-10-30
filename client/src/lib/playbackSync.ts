import type { QueueItem } from '../types';
import { snapSmoothPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import { resolveTrackDurationSeconds } from '../hooks/useTrackDuration';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import {
  getClientPlaybackState,
  getPlaybackTime,
  wasLastPlaybackCommitASeek,
  type ClientPlaybackState,
} from './playbackState';
import { isAudioBuffering } from './audioBuffering';
import { waitForAudioProgress } from './audioReady';
import { getBufferedAheadSeconds } from './audioReadiness';
import { shouldSkipRoutineSync as shouldSkipByBufferingState } from './syncStateMachine';
import { resetDriftController } from './driftController';
import {
  assessPlaybackResult,
  tryPlayWithAutoplayFallback,
  type PlayResult,
} from './audioUnlock';
import { debugLine, debugLog } from './debugTools';
import { recordDriftSample } from './driftHistogram';

/**
 * 离散事件同步：
 * - 播放中途：不 hard-seek（跟本机 audio），避免回前台因时钟滞后倒退
 * - 初次加载（本机仍在曲首、服务端已在中途）：必须 hard-seek，否则刷新后从 0 开播
 * - 曲末 FINAL（≤3s）：允许向前一次性对齐
 * - 房主拖进度：forceTime（本机）或 playback_state 时间轴跳变（远端）→ 立即对齐
 * - 切歌 forceZero / 暂停对齐 / 曲末 beyond_duration：照常处理
 */
const FINAL_WINDOW_SEC = 3;
/** 远端 seek / 暂停对齐阈值 */
const REMOTE_SEEK_THRESHOLD_SEC = 0.5;
/** 本机仍视为「刚加载/曲首」的阈值；刷新进房后 audio 停在 0，需对齐服务端进度 */
const INITIAL_SYNC_AUDIO_SEC = 1;
const BEYOND_DURATION_GRACE_SEC = 0.15;
/** 本机已到媒体末尾的判定窗口（不依赖 audio.ended，规避 seek 卡死） */
const LOCAL_ENDED_WAIT_SEC = 0.35;

export type FollowerSyncResult = PlayResult | 'paused' | 'idle' | 'beyond_duration';

let finalSyncTrackId: string | null = null;
let finalSyncDone = false;

function durationSources() {
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  return { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey };
}

function resolveMediaDurationSec(audio: HTMLAudioElement): number {
  const fromAudio = audio.duration;
  if (Number.isFinite(fromAudio) && fromAudio > 0) return fromAudio;
  return 0;
}

function resolveSyncDurationSec(
  audio: HTMLAudioElement,
  song: QueueItem,
  state?: ClientPlaybackState | null,
): number {
  const fromState = Number(state?.durationSec ?? 0);
  if (Number.isFinite(fromState) && fromState > 0) return fromState;
  const fromTrack = resolveTrackDurationSeconds(song, durationSources());
  if (fromTrack > 0) return fromTrack;
  return resolveMediaDurationSec(audio);
}

export function isEndedWhileServerPlaying(
  audio: HTMLAudioElement,
  song: QueueItem,
): boolean {
  if (!audio.ended) return false;
  const state = getClientPlaybackState();
  if (!state || state.status !== 'playing') return false;
  if (state.trackId && state.trackId !== song.queueId) return false;
  return true;
}

function isPositionBeyondDuration(
  positionSec: number,
  durationSec: number,
): boolean {
  return durationSec > 0 && positionSec >= durationSec + BEYOND_DURATION_GRACE_SEC;
}

function isAudioNearMediaEnd(audio: HTMLAudioElement): boolean {
  const mediaDur = resolveMediaDurationSec(audio);
  if (mediaDur <= 0) return false;
  return audio.currentTime >= mediaDur - LOCAL_ENDED_WAIT_SEC;
}

/**
 * 实际音频已耗尽，但服务端时钟仍在 playing（常见于元数据/歌词时长 > 文件时长，
 * 或 durationSec=0 导致服务端永不 auto-advance）。此时应由播放主控 finishSong。
 */
function shouldAdvanceAfterLocalMediaEnd(
  audio: HTMLAudioElement,
  song: QueueItem,
  state?: ClientPlaybackState | null,
): boolean {
  if (!state || state.status !== 'playing') return false;
  if (state.trackId && state.trackId !== song.queueId) return false;

  const mediaDur = resolveMediaDurationSec(audio);
  if (mediaDur <= 0) return false;
  // 必须靠近文件末尾，避免 mid-track 误触发 ended 时提前切歌
  if (!isAudioNearMediaEnd(audio)) return false;

  const serverPos = getPlaybackTime(state);
  // 单曲循环等：服务端已回到曲首，本机仍停在 ended → 应 seek 重播，不能再 finish
  if (serverPos < 1) return false;

  // 服务端进度已到/超过本机文件 → 再 seek 只会卡在末尾
  if (serverPos >= mediaDur - LOCAL_ENDED_WAIT_SEC) return true;

  const syncDur = resolveSyncDurationSec(audio, song, state);
  // 服务端无时长时不会 auto-advance
  if (syncDur <= 0) return true;
  // 同步时长明显长于文件（截断预览 / 错误元数据）：以文件尽头为准
  if (syncDur > mediaDur + BEYOND_DURATION_GRACE_SEC) return true;

  return false;
}

function playbackStateStillMatchesSong(song: QueueItem): boolean {
  const state = getClientPlaybackState();
  return Boolean(state && (!state.trackId || state.trackId === song.queueId));
}

/** 用户 seek / 切歌：必须立即同步 */
function isMandatorySync(options: ApplySyncOptions): boolean {
  return options.forceZero === true
    || options.forceTime !== undefined;
}

function isStatusCorrection(options: ApplySyncOptions): boolean {
  return options.forceCorrection === true;
}

export interface ApplySyncOptions {
  song: QueueItem;
  capTime: (time: number, mediaDur: number) => number;
  tvMode?: boolean;
  forceTime?: number;
  forceZero?: boolean;
  /** 服务端 playback_state：暂停/远端 seek 时校正，播放中途不追 */
  forceCorrection?: boolean;
}

function resolveTargetTime(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): number {
  const mediaDur = audio.duration;
  if (options.forceZero) return options.capTime(0, mediaDur);
  if (options.forceTime !== undefined) return options.capTime(options.forceTime, mediaDur);
  const state = getClientPlaybackState();
  const t = state ? getPlaybackTime(state) : 0;
  return options.capTime(Math.max(0, t), mediaDur);
}

function getRemainingTimeSec(song: QueueItem, positionSec: number): number {
  const durationSec = resolveTrackDurationSeconds(song, durationSources());
  if (durationSec <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, durationSec - positionSec);
}

function ensureFinalSyncTrack(trackId: string): void {
  if (finalSyncTrackId !== trackId) {
    finalSyncTrackId = trackId;
    finalSyncDone = false;
  }
}

function lockPlaybackRate(audio: HTMLAudioElement): void {
  resetDriftController(audio, useRoomStore.getState().room?.playbackRate ?? 1);
}

async function verifyPlaybackStarted(
  audio: HTMLAudioElement,
  result: PlayResult,
  reason: string,
): Promise<PlayResult> {
  if (result !== 'played') return result;
  const progressed = await waitForAudioProgress(audio);
  if (progressed) return result;
  debugLog('sync_play_stalled', debugLine({
    reason,
    audio: Number(audio.currentTime.toFixed(3)),
    readyState: audio.readyState,
    networkState: audio.networkState,
    bufferedAhead: Number(getBufferedAheadSeconds(audio).toFixed(3)),
  }));
  return 'error';
}
function syncModeLabel(options: ApplySyncOptions): string {
  if (options.forceZero) return 'force_zero';
  if (options.forceTime !== undefined) return 'force_time';
  if (options.forceCorrection) return 'force_correction';
  return 'routine';
}

function recordSyncDrift(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
  mode: string,
): void {
  const target = resolveTargetTime(audio, options);
  const audioTime = audio.ended ? Number.NaN : audio.currentTime;
  const diffSec = audio.ended ? Number.POSITIVE_INFINITY : target - audioTime;
  if (Number.isFinite(diffSec)) {
    recordDriftSample(diffSec);
  }
  const state = getClientPlaybackState();
  debugLog('sync_drift', debugLine({
    mode,
    target: Number(target.toFixed(3)),
    audio: audio.ended ? 'ended' : Number(audioTime.toFixed(3)),
    diffMs: Number.isFinite(diffSec) ? Math.round(diffSec * 1000) : 'inf',
    absDiffMs: Number.isFinite(diffSec) ? Math.round(Math.abs(diffSec) * 1000) : 'inf',
    version: state?.version ?? null,
    trackId: state?.trackId ?? options.song.queueId,
  }));
}

function explicitHardSeek(
  audio: HTMLAudioElement,
  target: number,
  trackId?: string,
  reason = 'hard_seek',
): void {
  const before = audio.currentTime;
  debugLog('sync_seek', debugLine({
    reason,
    target: Number(target.toFixed(3)),
    before: Number(before.toFixed(3)),
    diffMs: Math.round((target - before) * 1000),
    trackId: trackId || null,
    version: getClientPlaybackState()?.version ?? null,
  }));
  if (trackId) ensureFinalSyncTrack(trackId);
  finalSyncDone = false;
  lockPlaybackRate(audio);
  audio.currentTime = target;
  snapSmoothPlaybackTime(target);
  debugLog('sync_seek_done', debugLine({
    reason,
    after: Number(audio.currentTime.toFixed(3)),
    target: Number(target.toFixed(3)),
    seekErrorMs: Math.round((audio.currentTime - target) * 1000),
  }));
}

function shouldSkipRoutineSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): boolean {
  if (isMandatorySync(options)) return false;
  if (shouldSkipByBufferingState(false)) return true;
  return isAudioBuffering(audio);
}

/** 自动播放追赶：NORMAL 不动，FINAL 尾部一次性 seek（无 drift） */
function applyAutoPlaybackSync(
  audio: HTMLAudioElement,
  target: number,
  options: ApplySyncOptions,
): 'played' {
  lockPlaybackRate(audio);

  const trackId = getClientPlaybackState()?.trackId || options.song.queueId;
  ensureFinalSyncTrack(trackId);

  const remaining = getRemainingTimeSec(options.song, target);
  if (remaining > FINAL_WINDOW_SEC) {
    return 'played';
  }

  if (finalSyncDone) {
    return 'played';
  }

  const diff = target - audio.currentTime;
  if (diff > 0) {
    audio.currentTime = target;
    snapSmoothPlaybackTime(target);
    finalSyncDone = true;
  }

  return 'played';
}

/** audio 已 ended 但服务端仍在 playing：重置 ended 状态并对齐进度 */
async function recoverFromEndedAudio(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
  reason: string,
): Promise<FollowerSyncResult> {
  const state = getClientPlaybackState();
  if (!state || state.status !== 'playing') return 'idle';
  if (state.trackId && state.trackId !== options.song.queueId) {
    debugLog('sync_skip', debugLine({
      reason: 'ended_recover_track_changed',
      expectedTrackId: options.song.queueId,
      actualTrackId: state.trackId,
      version: state.version,
    }));
    return 'idle';
  }

  const target = resolveTargetTime(audio, options);
  const durationSec = resolveSyncDurationSec(audio, options.song, state);
  const trackId = state.trackId || options.song.queueId;

  // 真正曲末由 shouldAdvanceAfterLocalMediaEnd 判定；单曲循环重播时服务端已回 0，需落到下方 seek+play
  if (shouldAdvanceAfterLocalMediaEnd(audio, options.song, state)) {
    debugLog('sync_ended_beyond_duration', debugLine({
      reason,
      target: Number(target.toFixed(3)),
      durationSec: Number(durationSec.toFixed(3)),
      trackId,
      version: state.version,
      localEnded: audio.ended,
    }));
    return 'beyond_duration';
  }

  const seekTarget = options.capTime(target, audio.duration);
  debugLog('sync_ended_recover', debugLine({
    reason,
    target: Number(target.toFixed(3)),
    seekTarget: Number(seekTarget.toFixed(3)),
    durationSec: durationSec > 0 ? Number(durationSec.toFixed(3)) : null,
    trackId,
    version: state.version,
  }));

  // 旧任务排队期间如果已经切歌，这里直接放弃，避免对新歌 audio 做 seek/play
  if (!playbackStateStillMatchesSong(options.song)) {
    const latest = getClientPlaybackState();
    debugLog('sync_skip', debugLine({
      reason: 'ended_recover_stale_after_check',
      expectedTrackId: options.song.queueId,
      actualTrackId: latest?.trackId ?? null,
      version: latest?.version ?? null,
    }));
    return 'idle';
  }

  ensureFinalSyncTrack(trackId);
  finalSyncDone = false;
  lockPlaybackRate(audio);
  audio.pause();
  audio.currentTime = seekTarget;
  snapSmoothPlaybackTime(seekTarget);

  const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
  const result = await verifyPlaybackStarted(audio, await assessPlaybackResult(audio, initial), 'sync');
  debugLog('sync_play', debugLine({
    reason: `ended_recover_${reason}`,
    result,
    audio: Number(audio.currentTime.toFixed(3)),
  }));
  if (shouldAdvanceAfterLocalMediaEnd(audio, options.song, getClientPlaybackState())) {
    return 'beyond_duration';
  }
  return result;
}

/** 暂停必对齐；播放中仅房主拖进度 / 曲末 FINAL 可 seek，中途不追 */
async function applyCorrectionSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<FollowerSyncResult> {
  const state = getClientPlaybackState();
  if (state?.trackId && state.trackId !== options.song.queueId) {
    debugLog('sync_skip', debugLine({
      reason: 'correction_track_changed',
      expectedTrackId: options.song.queueId,
      actualTrackId: state.trackId,
      version: state.version,
    }));
    return 'idle';
  }

  if (shouldAdvanceAfterLocalMediaEnd(audio, options.song, state)) {
    const mediaDur = resolveMediaDurationSec(audio);
    debugLog('sync_media_end_advance', debugLine({
      reason: 'force_correction',
      audio: Number(audio.currentTime.toFixed(3)),
      mediaDur: Number(mediaDur.toFixed(3)),
      serverPos: Number(getPlaybackTime(state).toFixed(3)),
      ended: audio.ended,
      trackId: options.song.queueId,
      version: state?.version ?? null,
    }));
    return 'beyond_duration';
  }

  const target = resolveTargetTime(audio, options);
  const trackId = state?.trackId || options.song.queueId;
  const roomPlaying = useRoomStore.getState().room?.isPlaying === true;
  // 房间已乐观暂停时，禁止按旧 playing 缓存把音频拉起来
  const isPlaying = state?.status === 'playing' && roomPlaying;

  if (!isPlaying) {
    lockPlaybackRate(audio);
    if (!audio.paused) audio.pause();
    explicitHardSeek(audio, target, trackId, 'correction_paused');
    return 'paused';
  }

  const mediaDur = resolveMediaDurationSec(audio);
  const rawServerPos = getPlaybackTime(state);
  // 服务端已超过文件时长时禁止再 hard-seek 到末尾（会维持 seeking/buffering 且不触发 ended）
  if (
    mediaDur > 0
    && isPositionBeyondDuration(rawServerPos, mediaDur)
    && isAudioNearMediaEnd(audio)
  ) {
    debugLog('sync_media_end_advance', debugLine({
      reason: 'correction_past_media',
      audio: Number(audio.currentTime.toFixed(3)),
      mediaDur: Number(mediaDur.toFixed(3)),
      serverPos: Number(rawServerPos.toFixed(3)),
      trackId: options.song.queueId,
      version: state?.version ?? null,
    }));
    return 'beyond_duration';
  }

  const diff = target - audio.currentTime;
  const remoteSeek = wasLastPlaybackCommitASeek();
  const remaining = getRemainingTimeSec(options.song, target);

  if (remoteSeek && Math.abs(diff) > REMOTE_SEEK_THRESHOLD_SEC) {
    // 房主拖进度（或单曲循环回 0）：playback_state 时间轴跳变，必须对齐
    explicitHardSeek(audio, target, trackId, 'remote_seek');
  } else if (
    audio.currentTime < INITIAL_SYNC_AUDIO_SEC
    && Math.abs(diff) > REMOTE_SEEK_THRESHOLD_SEC
  ) {
    // 刷新/进房后本机仍在曲首：必须对齐服务端进度（否则会从 0 开播）
    explicitHardSeek(audio, target, trackId, 'initial_sync');
  } else if (remaining <= FINAL_WINDOW_SEC) {
    // 仅曲末允许向前追一次；中途时钟漂移不 seek
    applyAutoPlaybackSync(audio, target, options);
  } else if (Math.abs(diff) > REMOTE_SEEK_THRESHOLD_SEC) {
    debugLog('sync_skip', debugLine({
      reason: 'midtrack_no_seek',
      diffMs: Math.round(diff * 1000),
      remainingMs: Number.isFinite(remaining) ? Math.round(remaining * 1000) : null,
      target: Number(target.toFixed(3)),
      audio: Number(audio.currentTime.toFixed(3)),
      trackId,
      version: state?.version ?? null,
    }));
    lockPlaybackRate(audio);
  } else {
    debugLog('sync_skip', debugLine({
      reason: 'correction_below_threshold',
      diffMs: Math.round(diff * 1000),
      thresholdMs: Math.round(REMOTE_SEEK_THRESHOLD_SEC * 1000),
      target: Number(target.toFixed(3)),
      audio: Number(audio.currentTime.toFixed(3)),
    }));
    lockPlaybackRate(audio);
  }

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await verifyPlaybackStarted(audio, await assessPlaybackResult(audio, initial), 'sync');
    debugLog('sync_play', debugLine({
      reason: 'correction',
      result,
      audio: Number(audio.currentTime.toFixed(3)),
    }));
    if (result !== 'played') return result;
  }

  if (shouldAdvanceAfterLocalMediaEnd(audio, options.song, getClientPlaybackState())) {
    return 'beyond_duration';
  }

  return 'played';
}

async function applyMandatorySync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<PlayResult | 'paused' | 'idle'> {
  const state = getClientPlaybackState();
  if (state?.trackId && state.trackId !== options.song.queueId) {
    debugLog('sync_skip', debugLine({
      reason: 'mandatory_track_changed',
      expectedTrackId: options.song.queueId,
      actualTrackId: state.trackId,
      version: state.version,
    }));
    return 'idle';
  }
  const target = resolveTargetTime(audio, options);
  const trackId = state?.trackId || options.song.queueId;
  const roomPlaying = useRoomStore.getState().room?.isPlaying === true;
  const isPlaying = state?.status === 'playing' && roomPlaying;

  if (!isPlaying) {
    lockPlaybackRate(audio);
    if (!audio.paused) audio.pause();
    explicitHardSeek(audio, target, trackId, 'mandatory_paused');
    return 'paused';
  }

  explicitHardSeek(audio, target, trackId, options.forceZero ? 'force_zero' : 'mandatory');

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await verifyPlaybackStarted(audio, await assessPlaybackResult(audio, initial), 'sync');
    debugLog('sync_play', debugLine({
      reason: options.forceZero ? 'force_zero' : 'mandatory',
      result,
      audio: Number(audio.currentTime.toFixed(3)),
    }));
    if (result !== 'played') return result;
  }

  return 'played';
}

export async function applyFollowerSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<FollowerSyncResult> {
  if (!audio.src) return 'idle';

  const mode = syncModeLabel(options);
  recordSyncDrift(audio, options, mode);

  const earlyState = getClientPlaybackState();
  if (shouldAdvanceAfterLocalMediaEnd(audio, options.song, earlyState)) {
    const mediaDur = resolveMediaDurationSec(audio);
    debugLog('sync_media_end_advance', debugLine({
      reason: mode,
      audio: Number(audio.currentTime.toFixed(3)),
      mediaDur: mediaDur > 0 ? Number(mediaDur.toFixed(3)) : null,
      serverPos: earlyState ? Number(getPlaybackTime(earlyState).toFixed(3)) : null,
      ended: audio.ended,
      trackId: options.song.queueId,
      version: earlyState?.version ?? null,
    }));
    return 'beyond_duration';
  }

  if (isEndedWhileServerPlaying(audio, options.song)) {
    // 误触发的 mid-track ended：尝试恢复；真正曲末已在上方 beyond_duration 处理
    return recoverFromEndedAudio(audio, options, mode);
  }

  if (isMandatorySync(options)) {
    return applyMandatorySync(audio, options);
  }

  if (isStatusCorrection(options)) {
    return applyCorrectionSync(audio, options);
  }

  if (shouldSkipRoutineSync(audio, options)) {
    return 'played';
  }

  const state = getClientPlaybackState();
  const roomPlaying = useRoomStore.getState().room?.isPlaying === true;
  const isPlaying = state?.status === 'playing' && roomPlaying;
  const target = resolveTargetTime(audio, options);

  if (!isPlaying) {
    lockPlaybackRate(audio);
    if (!audio.paused) audio.pause();
    return 'paused';
  }

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await verifyPlaybackStarted(audio, await assessPlaybackResult(audio, initial), 'sync');
    if (result !== 'played') return result;
  }

  if (shouldSkipRoutineSync(audio, options)) {
    return 'played';
  }

  return applyAutoPlaybackSync(audio, target, options);
}

export async function applyVisibilityResume(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<FollowerSyncResult> {
  if (isEndedWhileServerPlaying(audio, options.song)) {
    return recoverFromEndedAudio(audio, options, 'visibility');
  }
  // 切回前台：续播 + 曲末/切歌判定；中途不因时钟漂移 hard-seek（见 applyCorrectionSync）
  return applyFollowerSync(audio, {
    ...options,
    forceCorrection: true,
  });
}

export function resetPlaybackRate(audio: HTMLAudioElement): void {
  resetDriftController(audio, useRoomStore.getState().room?.playbackRate ?? 1);
}

export async function applyPostBufferSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<void> {
  if (!audio.src) return;
  if (getClientPlaybackState()?.status !== 'playing') return;

  if (audio.ended) {
    const result = await recoverFromEndedAudio(audio, options, 'post_buffer');
    if (result === 'beyond_duration' || result === 'blocked' || result === 'error') return;
    if (result !== 'played') return;
    return;
  }

  if (audio.paused) return;
  if (isMandatorySync(options)) {
    await applyMandatorySync(audio, options);
    return;
  }
  if (isStatusCorrection(options)) {
    await applyCorrectionSync(audio, options);
    return;
  }
  if (shouldSkipRoutineSync(audio, options)) return;

  const target = resolveTargetTime(audio, options);
  applyAutoPlaybackSync(audio, target, options);
}

export function resetPhaseSync(): void {
  finalSyncTrackId = null;
  finalSyncDone = false;
}
