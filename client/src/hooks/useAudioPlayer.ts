import { useEffect, useRef, useCallback, useState, type MutableRefObject } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { useSocket } from '../hooks/useSocket';
import { useMediaSession } from '../hooks/useMediaSession';
import { getTrackKey } from '../api/music';
import { snapSmoothPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import {
  isTrustedMediaDurationSeconds,
  resolveAutoSkipThresholdSeconds,
  resolveDisplayDurationSeconds,
  resolveReferenceDurationSeconds,
  resolveTrackDurationSeconds,
} from '../hooks/useTrackDuration';
import { reportTrackDurationToServer } from '../lib/reportTrackDuration';
import { applyTrackLoudness } from '../lib/audioElement';
import type { QueueItem } from '../types';
import { getAudioController } from '../lib/audioController';
import {
  onWeChatBridgeReady,
  playInUserGesture,
  tryPlayWithAutoplayFallback,
  assessPlaybackResult,
  playbackNeedsUnlock,
  isAudioSessionUnlocked,
  markAudioSessionUnlocked,
  resetAudioSessionUnlocked,
  shouldShowUnlockOverlay,
  shouldPromptAudioUnlock,
  isMobileDevice,
  isRestrictedAutoplayEnv,
  type PlayResult,
} from '../lib/audioUnlock';
import { sharedAudioGeneration } from '../lib/audioElement';
import {
  installBackgroundPlaybackGuards,
  isLikelySystemMediaSuspend,
} from '../lib/backgroundPlayback';
import {
  setBackgroundKeepaliveActive,
} from '../lib/backgroundKeepalive';
import { createWorkerInterval } from '../lib/workerTimer';
import { ensureGalaxyAudioOutputIfLoaded } from '../lib/galaxyAudioBridge';
import { canSeekInRoom } from '../lib/roomPermissions';
import {
  prefetchUpcomingFromRoom,
  rememberSongUrl,
  resolveSongUrl,
  syncActualQualityFromCache,
  isTrackSourceError,
  clearTrackSourceError,
  fetchServiceFallbackUrl,
  invalidateTrackUrlCache,
  invalidateUnloadedSongUrlCache,
  isTrackCrossSource,
  markTrackCrossSource,
  isCachedUrlCrossSource,
  getCachedUrlCrossSourceFrom,
  getTrackCrossSourceFrom,
} from '../lib/songPreloadCache';
import { resolveQishuiLocalPlaybackUrl } from '../lib/qishuiLocalPlayback';
import { refreshSignedApiUrl, stripApiSignParams } from '../lib/signedApiUrl';
import { isProxiedMediaUrl, toProxiedMediaUrl } from '../lib/mediaProxyUrl';
import {
  classifyMediaPlaybackError,
  isSourceUnavailableMessage,
  MAX_TEMP_PLAYBACK_RETRIES,
  SourceUnavailableError,
} from '../lib/audioPlaybackError';
import {
  recordSongPlaybackFailure,
  recordSongPlaybackSuccess,
  isPlaybackQualityLockedToLowest,
  lockPlaybackQualityToLowest,
} from '../lib/playbackQualityLock';
import { waitForAudioCanPlay } from '../lib/audioReady';
import { applyFollowerSync, applyVisibilityResume, applyPostBufferSync, isEndedWhileServerPlaying } from '../lib/playbackSync';
import { resetDriftController } from '../lib/driftController';
import { getClientPlaybackState, getPlaybackTime, optimisticSeekPosition, optimisticSetPlaying, resolveInitialTrackSyncTime } from '../lib/playbackState';
import { attachAudioBufferingListeners, isAudioBuffering, setAudioBufferEndHandler } from '../lib/audioBuffering';
import { flushPendingPlaybackSnapshot } from '../lib/playbackSchedule';
import { isSongPreviewSuppressingRoom, stopSongPreview } from '../lib/songPreviewPlayer';
import {
  bindAudioQueueId,
  clearAudioQueueBinding,
  canSyncAudioForQueue,
  getAudioBoundQueueId,
  isAudioBoundToQueue,
  shouldSkipTrackLoad,
} from '../lib/audioTrackBinding';
import { debugLine, debugLog } from '../lib/debugTools';
import {
  getLowestQuality,
  getQualityLabel,
  getUserPlaybackQuality,
} from '../api/music/quality';

/** 主控本机失败后的本地恢复间隔：不切歌，等网络恢复再重试 */
const LOCAL_PLAYBACK_RECOVERY_MS = 8000;
/** 明确无源时更快重试；仍失败则由主控核实后切歌，避免全屋卡死 */
const SOURCE_UNAVAILABLE_RECOVERY_MS = 2500;
const LOCAL_RECOVERY_TOAST_COOLDOWN_MS = 20000;
/** 同一曲本机取链连续失败多少次后，主控请求服务端核实并切歌 */
const SOURCE_ERROR_SERVER_VERIFY_AFTER = 2;
/** 单次取链（含跨源）总超时，避免卡在 loading 拖死全屋 */
const RESOLVE_URL_TIMEOUT_MS = 15000;
/** 主控 loading 过久仍无结果时强制走音源异常切歌 */
const LEADER_LOAD_STUCK_SKIP_MS = 20000;
/** 主控长时间无法把 audio 绑到当前曲时强制切歌（无 duration 时服务端也不会自动推进） */
const LEADER_BIND_MISMATCH_SKIP_MS = 25000;
/** 汽水客户端解密可能受网络和设备性能影响，不能按普通直链时限误判。 */
const QISHUI_LEADER_LOAD_STUCK_SKIP_MS = 100000;
const QISHUI_LEADER_BIND_MISMATCH_SKIP_MS = 105000;
/** 源异常切歌提示节流，避免 watchdog 反复弹 toast */
const SOURCE_ERROR_SKIP_TOAST_COOLDOWN_MS = 20000;
let localRecoveryTimer: number | null = null;
let localRecoveryQueueId: string | null = null;
let lastLocalRecoveryToastAt = 0;
let lastSourceErrorSkipToastAt = 0;

function notifyPlaybackToast(message: string, type: 'success' | 'error' = 'error') {
  window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
    detail: { message, type },
  }));
}

function isSourceUnavailableReason(reason: string): boolean {
  return reason === 'source_unavailable'
    || reason === 'source_error_marked_local'
    || reason === 'service_fallback_exhausted'
    || reason === 'service_no_fallback';
}

/**
 * 本机播放失败时降到最低音质（仅本机，不影响房间设置），并提示用户。
 * @returns 本次是否新触发了降档
 */
function ensureLowestQualityForLocalRecovery(song: QueueItem): boolean {
  const source = song.source || 'netease';
  const current = getUserPlaybackQuality(source);
  const lowest = getLowestQuality(source);
  if (!lowest) return false;

  const alreadyLowest = Boolean(
    current && (current === lowest || isPlaybackQualityLockedToLowest()),
  );
  if (alreadyLowest) return false;

  lockPlaybackQualityToLowest();
  invalidateTrackUrlCache(song);
  return true;
}

function notifyLocalRecoveryToast(
  song: QueueItem,
  options: { qualityDowngraded: boolean; reason: string },
) {
  const now = Date.now();
  if (now - lastLocalRecoveryToastAt < LOCAL_RECOVERY_TOAST_COOLDOWN_MS) return;
  lastLocalRecoveryToastAt = now;

  if (isSourceUnavailableReason(options.reason)) {
    notifyPlaybackToast('音源异常，正在确认…', 'error');
    return;
  }

  const source = song.source || 'netease';
  const lowestLabel = getQualityLabel(getLowestQuality(source) || undefined, source);
  if (options.qualityDowngraded) {
    notifyPlaybackToast(`网络不稳定，已自动切换为「${lowestLabel}」并重试`, 'error');
    return;
  }
  notifyPlaybackToast('网络不稳定，正在重试加载', 'error');
}

/** 播放出错/卡顿时换发新签名并续播，避免 om_ts 过期后 Range 请求 403 */
async function reloadAudioWithFreshSign(audio: HTMLAudioElement): Promise<void> {
  const prevSrc = audio.currentSrc || audio.src;
  if (!prevSrc) {
    audio.load();
    await audio.play().catch(() => {});
    return;
  }
  const fresh = (await refreshSignedApiUrl(prevSrc)) || prevSrc;
  const resumeAt = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  if (fresh !== prevSrc) {
    audio.src = fresh;
    try {
      if (resumeAt > 0) audio.currentTime = resumeAt;
    } catch {
      // ignore seek failures before metadata
    }
  }
  audio.load();
  try {
    if (resumeAt > 0) audio.currentTime = resumeAt;
  } catch {
    // ignore
  }
  await audio.play().catch(() => {});
}

let audioListenersAttached = false;
let audioListenersTarget: HTMLAudioElement | null = null;
let enforcingFollowerSeek = false;

/** 播放中低频漂移校准（非 RAF，避免高频 seek） */
const CALIBRATION_INTERVAL_MS = 6000;
/** 音源脱节时重试 load 的最小间隔 */
const LOAD_WATCHDOG_INTERVAL_MS = 4000;

type LoadLock = {
  queueId: string | null;
  gen: number;
};

const EMPTY_LOAD_LOCK: LoadLock = { queueId: null, gen: 0 };

function releaseLoadLock(lockRef: { current: LoadLock }, queueId: string, gen: number): void {
  const lock = lockRef.current;
  if (lock.queueId === queueId && lock.gen === gen) {
    lockRef.current = EMPTY_LOAD_LOCK;
  }
}

interface AudioRuntime {
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  endedTrackKey: MutableRefObject<string | null>;
  skippingRef: MutableRefObject<boolean>;
  /** 切歌/换源窗口：禁止 pause/ended/MediaSession 自动 play，避免旧曲被 seek 0 后闪播 */
  suppressAutoResumeRef: MutableRefObject<boolean>;
  tempRetries: MutableRefObject<number>;
  lowestFallbackAttempted: MutableRefObject<boolean>;
  successRecordedTrackKey: MutableRefObject<string | null>;
  stallRetryTimer: MutableRefObject<number | null>;
  /** 首次解密较慢时，metadata 到达后补一次播放和进度对齐 */
  readyRecoveryTimer: MutableRefObject<number | null>;
  /** 主控本机失败：仅本地重试，不触发全屋切歌 */
  scheduleLocalRecovery: (song: QueueItem, reason: string) => void;
  finishSong: (queueId: string) => void;
  playAudio: (audio: HTMLAudioElement) => Promise<PlayResult>;
  applyPlaybackResult: (
    result: PlayResult,
    audio: HTMLAudioElement,
    liveRoom: NonNullable<ReturnType<typeof useRoomStore.getState>['room']>,
  ) => void;
  recoverReadyAudio: (audio: HTMLAudioElement) => void;
}

let activeAudioRuntime: AudioRuntime | null = null;

const UNLOCK_POLL_MS = isMobileDevice() ? 120 : 800;

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function revertUnauthorizedSeek(audio: HTMLAudioElement): void {
  const { room: live, canControlPlayback } = useRoomStore.getState();
  if (canSeekInRoom(live, canControlPlayback)) return;
  const current = live?.current;
  if (!current || !isAudioBoundToQueue(audio, current.queueId)) return;

  const state = getClientPlaybackState();
  const expected = state?.trackId === current.queueId
    ? getPlaybackTime(state)
    : (live.currentTime ?? 0);
  if (!Number.isFinite(expected) || Math.abs(audio.currentTime - expected) < 0.15) return;

  enforcingFollowerSeek = true;
  try {
    audio.currentTime = Math.max(0, expected);
    snapSmoothPlaybackTime(expected);
  } finally {
    enforcingFollowerSeek = false;
  }
}

function durationSources() {
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  return { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey };
}

function capSeekTime(time: number, song: QueueItem | null | undefined, mediaDur: number): number {
  const sources = durationSources();
  const referenceDur = song ? resolveReferenceDurationSeconds(song, sources) : 0;
  const fileDur = isTrustedMediaDurationSeconds(mediaDur, referenceDur) ? mediaDur : 0;
  const trackDur = song ? resolveTrackDurationSeconds(song, sources) : 0;
  const displayDur = song ? resolveDisplayDurationSeconds(song, sources) : fileDur;
  const capBase = fileDur || trackDur || (song ? resolveAutoSkipThresholdSeconds(song, sources, fileDur) : 0) || displayDur;
  const cap = capBase > 0 ? capBase - 0.05 : time;
  return Math.max(0, Math.min(time, cap));
}

function playbackStateMatchesCurrentTrack(song: QueueItem): boolean {
  const state = getClientPlaybackState();
  return !state?.trackId || state.trackId === song.queueId;
}

function tryFlushPendingSnapshot(): boolean {
  return flushPendingPlaybackSnapshot();
}

function syncMediaDuration(audio: HTMLAudioElement, song: QueueItem, trackKey: string) {
  const dur = audio.duration;
  const referenceDur = resolveReferenceDurationSeconds(song, durationSources());
  if (!isTrustedMediaDurationSeconds(dur, referenceDur)) return;
  const durationMs = Math.round(dur * 1000);
  useAudioStore.getState().setMediaDuration(trackKey, durationMs);
  reportTrackDurationToServer(song.queueId, durationMs);
}

interface UseAudioPlayerOptions {
  tvMode?: boolean;
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const tvMode = options.tvMode ?? false;
  const controller = getAudioController();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const room = useRoomStore((s) => s.room);
  const isPlaybackLeader = useRoomStore((s) => s.isPlaybackLeader);
  const trackLoading = useAudioStore((s) => s.trackLoading);
  const setTrackLoading = useAudioStore((s) => s.setTrackLoading);
  const setLrcDuration = useAudioStore((s) => s.setLrcDuration);
  const setMediaDuration = useAudioStore((s) => s.setMediaDuration);
  const setSeekPlayback = useAudioStore((s) => s.setSeekPlayback);
  const setLocalPlayback = useAudioStore((s) => s.setLocalPlayback);
  const setSoftResumeLocalAudio = useAudioStore((s) => s.setSoftResumeLocalAudio);
  const setNeedsAudioUnlock = useAudioStore((s) => s.setNeedsAudioUnlock);
  const needsAudioUnlock = useAudioStore((s) => s.needsAudioUnlock);
  const setRetryPlayback = useAudioStore((s) => s.setRetryPlayback);
  const playbackVersion = useAudioStore((s) => s.playbackVersion);
  const trackReloadNonce = useAudioStore((s) => s.trackReloadNonce);
  const { togglePlay, seek, skipSong, finishSong, requestSkip: requestSkipVote, reportPlaybackMedia } = useSocket();

  useEffect(() => {
    const rate = Number(room?.playbackRate ?? 1);
    const nextRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    controller.enqueue(() => {
      resetDriftController(controller.audio, nextRate);
    });
  }, [controller, room?.playbackRate]);


  const endedTrackKey = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const loadLockRef = useRef<LoadLock>(EMPTY_LOAD_LOCK);
  const lastTrackReloadNonceRef = useRef(0);
  const [loadRetryNonce, setLoadRetryNonce] = useState(0);
  const skippingRef = useRef(false);
  /** 本端主动 pause 时抑制 pause 事件里的自动续播 */
  const intentionalLocalPauseRef = useRef(false);
  /** 切歌取链/换源完成前禁止任何自动 play（后台节流时窗口更长） */
  const suppressAutoResumeRef = useRef(false);
  const justSkippedRef = useRef(false);
  const prevQueueIdRef = useRef<string | null>(null);
  const tempRetries = useRef(0);
  const lowestFallbackAttempted = useRef(false);
  const successRecordedTrackKey = useRef<string | null>(null);
  const stallRetryTimer = useRef<number | null>(null);
  const readyRecoveryTimer = useRef<number | null>(null);
  const lastSkipAt = useRef(0);
  const wasLeaderRef = useRef(isPlaybackLeader);
  const resolveFailCountRef = useRef<{ queueId: string; count: number } | null>(null);
  /** 当前曲目本地汽水解密任务；切歌时立即终止，避免旧曲继续占用浏览器 CPU/带宽。 */
  const qishuiLocalAbortRef = useRef<AbortController | null>(null);

  const shouldSkipForEndedTrackKey = useCallback((song: QueueItem, audio: HTMLAudioElement): boolean => {
    if (isEndedWhileServerPlaying(audio, song)) return false;
    return endedTrackKey.current === trackKeyOf(song);
  }, []);

  const handleBeyondDuration = useCallback((song: QueueItem) => {
    if (!useRoomStore.getState().isPlaybackLeader) return;
    finishSong(song.queueId);
  }, [finishSong]);

  const playAudio = useCallback(async (audio: HTMLAudioElement) => {
    if (isSongPreviewSuppressingRoom()) {
      if (!audio.paused) audio.pause();
      return 'played' as PlayResult;
    }
    const result = await tryPlayWithAutoplayFallback(audio, tvMode);
    return assessPlaybackResult(audio, result);
  }, [tvMode]);

  const applyPlaybackResult = useCallback((
    result: PlayResult,
    audio: HTMLAudioElement,
    liveRoom: NonNullable<typeof room>,
  ) => {
    if (isSongPreviewSuppressingRoom()) {
      if (!audio.paused) audio.pause();
      return;
    }
    const latestRoom = useRoomStore.getState().room;
    if (
      !latestRoom?.current
      || !liveRoom.current
      || trackKeyOf(latestRoom.current) !== trackKeyOf(liveRoom.current)
    ) {
      return;
    }

    if (playbackNeedsUnlock(result, audio)) {
      const stillLoading = useAudioStore.getState().trackLoading;
      if (!stillLoading && skippingRef.current) return;
      if (stillLoading && !isRestrictedAutoplayEnv()) return;
      if (stillLoading && !audio.src) return;

      if (isAudioSessionUnlocked()) {
        controller.enqueue(async () => {
          if (isSongPreviewSuppressingRoom()) {
            if (!audio.paused) audio.pause();
            return;
          }
          await audio.play().catch(() => {});
          if (audio.paused) {
            resetAudioSessionUnlocked();
            if (shouldShowUnlockOverlay()) {
              useAudioStore.getState().setNeedsAudioUnlock(true);
            }
          }
        });
        return;
      }
      if (shouldShowUnlockOverlay()) {
        setNeedsAudioUnlock(true);
      }
      return;
    }
    setNeedsAudioUnlock(false);
  }, [controller, setNeedsAudioUnlock]);

  const handleSyncResult = useCallback((
    result: Awaited<ReturnType<typeof applyFollowerSync>>,
    audio: HTMLAudioElement,
    liveRoom: NonNullable<typeof room>,
    song: QueueItem,
  ) => {
    if (result === 'beyond_duration') {
      const mediaDur = audio.duration;
      if (Number.isFinite(mediaDur) && mediaDur > 0) {
        reportTrackDurationToServer(song.queueId, Math.round(mediaDur * 1000));
      }
      handleBeyondDuration(song);
      return;
    }
    if (result === 'blocked' || result === 'error') {
      applyPlaybackResult(result, audio, liveRoom);
    } else if (result === 'played') {
      endedTrackKey.current = null;
      setNeedsAudioUnlock(false);
    }
  }, [applyPlaybackResult, handleBeyondDuration, setNeedsAudioUnlock]);

  const enqueuePause = useCallback(() => {
    // 先同步抬闸，再入队 pause：后台队列延迟时也能挡住 pause 自动续播
    suppressAutoResumeRef.current = true;
    controller.enqueue(() => {
      clearAudioQueueBinding(controller.audio);
      controller.audio.pause();
    });
  }, [controller]);

  const applySync = useCallback((
    options: { forceZero?: boolean; forceTime?: number; forceCorrection?: boolean } = {},
  ) => {
    controller.enqueue(async () => {
      // 试听占用本机时禁止跟播，否则会 play 主轨把试听挤掉
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || skippingRef.current) return;
      const song = liveRoom.current;
      const audio = controller.audio;
      if (!isAudioBoundToQueue(audio, song.queueId)) return;
      if (shouldSkipForEndedTrackKey(song, audio)) return;
      if (!playbackStateMatchesCurrentTrack(song)) return;
      if (!audio.src) return;
      const result = await applyFollowerSync(audio, {
        song,
        capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
        tvMode,
        forceZero: options.forceZero,
        forceTime: options.forceTime,
        forceCorrection: options.forceCorrection,
      });

      handleSyncResult(result, audio, liveRoom, song);
    });
  }, [controller, tvMode, shouldSkipForEndedTrackKey, handleSyncResult]);

  const recoverReadyAudio = useCallback((audio: HTMLAudioElement) => {
    if (isSongPreviewSuppressingRoom() || skippingRef.current) return;
    const liveRoom = useRoomStore.getState().room;
    if (!liveRoom?.current || !liveRoom.isPlaying) return;
    if (!isAudioBoundToQueue(audio, liveRoom.current.queueId)) return;
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const playbackState = getClientPlaybackState();
    const targetTime = playbackState
      ? getPlaybackTime(playbackState)
      : Math.max(0, Number(liveRoom.currentTime) || 0);
    // applySync 会在 audio 仍暂停时先 play，再执行强制进度对齐。
    applySync({ forceTime: targetTime });
  }, [applySync]);

  const applyVisibilitySync = useCallback(() => {
    controller.enqueue(async () => {
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || !liveRoom.isPlaying || skippingRef.current) return;
      const song = liveRoom.current;
      const audio = controller.audio;
      if (!isAudioBoundToQueue(audio, song.queueId)) return;
      if (shouldSkipForEndedTrackKey(song, audio)) return;
      if (!playbackStateMatchesCurrentTrack(song)) return;
      if (!audio.src) return;

      // 长时间后台后媒体可能 error / 签名失效，先换签再续播
      if (audio.error || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
        await reloadAudioWithFreshSign(audio);
        if (!liveRoom.isPlaying) return;
      }

      const result = await applyVisibilityResume(audio, {
        song,
        capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
        tvMode,
      });

      // 媒体错误时再换签重试（常见于抢焦点后解码器被掐 / 签名过期）
      if (result === 'error' && audio.paused && liveRoom.isPlaying) {
        await reloadAudioWithFreshSign(audio);
        const retry = await applyVisibilityResume(audio, {
          song,
          capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
          tvMode,
        });
        handleSyncResult(retry, audio, liveRoom, song);
        return;
      }

      handleSyncResult(result, audio, liveRoom, song);
    });
  }, [controller, tvMode, shouldSkipForEndedTrackKey, handleSyncResult]);

  const requestSkip = useCallback((options: {
    bypassThrottle?: boolean;
    reason?: 'manual' | 'source_error' | 'system';
  } = {}): boolean => {
    // 早退时绝不留下 loadLock：调用方（源异常路径）可能已依赖「未启动则不占锁」
    if (skippingRef.current) return false;
    const { isPlaybackLeader, room: live } = useRoomStore.getState();
    if (!isPlaybackLeader) return false;

    const now = Date.now();
    if (!options.bypassThrottle && now - lastSkipAt.current < 2000) return false;
    lastSkipAt.current = now;

    const sourceErrorSkip = options.reason === 'source_error';
    const lockedQueueId = live?.current?.queueId || null;

    skippingRef.current = true;
    justSkippedRef.current = true;
    suppressAutoResumeRef.current = true;
    loadGeneration.current += 1;
    // 打断进行中的 loadTrack：必须立刻清 loading，否则 finally 因 gen 不匹配会永久卡在加载中
    setTrackLoading(false);
    // source_error：短暂锁住当前曲，避免 skip 等待期间 effect 又去反复取链
    if (sourceErrorSkip && lockedQueueId) {
      loadLockRef.current = { queueId: lockedQueueId, gen: loadGeneration.current };
    } else {
      loadLockRef.current = EMPTY_LOAD_LOCK;
    }
    useAudioStore.getState().setNeedsAudioUnlock(false);
    controller.clearQueue();
    controller.enqueue(() => {
      clearAudioQueueBinding(controller.audio);
      controller.audio.pause();
    });
    snapSmoothPlaybackTime(0);
    if (live) {
      useRoomStore.getState().setRoom({ ...live, currentTime: 0 });
    }

    const unlockAfterSkipFailure = () => {
      loadLockRef.current = EMPTY_LOAD_LOCK;
      setTrackLoading(false);
      // 允许 watchdog / recovery 再次接手，避免「跳歌失败后整屋卡死」
      if (lockedQueueId && useRoomStore.getState().room?.current?.queueId === lockedQueueId) {
        setLoadRetryNonce((n) => n + 1);
      }
    };

    skipSong({ reason: options.reason || 'manual' }).then(async (res) => {
      if (!res.success && sourceErrorSkip) {
        // 服务端确认音源仍可用时，只能视为主控本机问题；禁止强制切歌影响全房间。
        // 解锁后交给本地恢复/watchdog 重试当前歌曲。
        unlockAfterSkipFailure();
        notifyPlaybackToast('服务端检测音源正常，正在本地重试…', 'error');
        return;
      }
      if (!res.success) {
        unlockAfterSkipFailure();
        if (res.error) notifyPlaybackToast(res.error, 'error');
      }
    }).catch(() => {
      unlockAfterSkipFailure();
    }).finally(() => {
      skippingRef.current = false;
    });
    return true;
  }, [controller, skipSong, setTrackLoading]);

  /**
   * 主控本机加载/播放失败时只做本地恢复，不 skip 全屋。
   * 房主网络抖动不应把其他已正常播放的成员一并切走。
   */
  const scheduleLocalRecovery = useCallback((song: QueueItem, reason: string) => {
    const queueId = song.queueId;
    const sourceIssue = isSourceUnavailableReason(reason);
    const qualityDowngraded = sourceIssue ? false : ensureLowestQualityForLocalRecovery(song);
    notifyLocalRecoveryToast(song, { qualityDowngraded, reason });

    if (localRecoveryTimer && localRecoveryQueueId === queueId) return;

    if (localRecoveryTimer) {
      window.clearTimeout(localRecoveryTimer);
      localRecoveryTimer = null;
    }

    const delayMs = sourceIssue ? SOURCE_UNAVAILABLE_RECOVERY_MS : LOCAL_PLAYBACK_RECOVERY_MS;

    debugLog('local_playback_recovery', debugLine({
      reason,
      queueId,
      delayMs,
      qualityDowngraded,
      skipRoom: false,
    }));

    localRecoveryQueueId = queueId;
    localRecoveryTimer = window.setTimeout(() => {
      localRecoveryTimer = null;
      localRecoveryQueueId = null;

      const live = useRoomStore.getState().room?.current;
      if (!live || live.queueId !== queueId) return;

      clearTrackSourceError(live);
      invalidateTrackUrlCache(live);
      tempRetries.current = 0;
      lowestFallbackAttempted.current = false;
      loadLockRef.current = EMPTY_LOAD_LOCK;
      setLoadRetryNonce((n) => n + 1);
    }, delayMs);
  }, []);

  const initAudio = useCallback(() => {
    const audio = controller.audio;
    audioRef.current = audio;
    activeAudioRuntime = {
      audioRef,
      endedTrackKey,
      skippingRef,
      suppressAutoResumeRef,
      tempRetries,
      lowestFallbackAttempted,
      successRecordedTrackKey,
      stallRetryTimer,
      readyRecoveryTimer,
      scheduleLocalRecovery,
      finishSong,
      playAudio,
      applyPlaybackResult,
      recoverReadyAudio,
    };

    if (!audioListenersAttached || audioListenersTarget !== audio) {
      audioListenersAttached = true;
      audioListenersTarget = audio;
      attachAudioBufferingListeners(audio);

      audio.addEventListener('ended', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        // 息屏时部分 WebView 会误触发 ended（未真正播完），不可据此切歌/停房
        if (document.hidden || isLikelySystemMediaSuspend()) {
          const dur = audio.duration;
          const nearEnd = Number.isFinite(dur) && dur > 0 && audio.currentTime >= dur - 1.5;
          if (!nearEnd) {
            if (runtime.suppressAutoResumeRef.current) return;
            const live = useRoomStore.getState();
            if (live.room?.isPlaying && live.room.current) {
              // ended 状态下 play() 会把进度归零，续播后钉回原处
              const resumeAt = audio.currentTime;
              void audio.play().then(() => {
                if (resumeAt > 1 && audio.currentTime < resumeAt - 1) {
                  audio.currentTime = resumeAt;
                }
              }).catch(() => {});
            }
            return;
          }
        }
        const live = useRoomStore.getState();
        const current = live.room?.current;
        if (!current) return;
        if (!isAudioBoundToQueue(audio, current.queueId)) return;

        const pbState = getClientPlaybackState();
        const serverStillPlaying = pbState?.status === 'playing'
          && (!pbState.trackId || pbState.trackId === current.queueId);

        if (serverStillPlaying) {
          runtime.endedTrackKey.current = null;
        } else {
          runtime.endedTrackKey.current = trackKeyOf(current);
        }

        audio.pause();
        if (useRoomStore.getState().isPlaybackLeader) {
          runtime.finishSong(current.queueId);
        }
      });

      audio.addEventListener('pause', () => {
        // 试听占用本机音频时不自动恢复房间播放
        if (isSongPreviewSuppressingRoom()) return;
        // 仅对抗息屏瞬间的系统挂起；锁屏控件主动暂停不在此窗口内
        if (intentionalLocalPauseRef.current) return;
        // 播完触发的 pause：此时元素处于 ended，play() 会从 0 重放同一首。
        // 后台切歌要等取链，旧曲会被从头顶播两秒；恢复交给 applyFollowerSync。
        if (audio.ended) return;
        const runtime = activeAudioRuntime;
        // 切歌/换源窗口：旧 src 可能被误 play，尤其是后台主线程节流时
        if (runtime?.suppressAutoResumeRef.current) return;
        if (isLikelySystemMediaSuspend()) {
          const live = useRoomStore.getState();
          if (!live.room?.isPlaying || !live.room.current) return;
          if (!isAudioBoundToQueue(audio, live.room.current.queueId)) return;
          void audio.play().catch(() => {});
          return;
        }
        // 系统关掉媒体卡片时可能直接 pause 元素，房间仍在播 → 静默续上，不碰进度条
        const live = useRoomStore.getState();
        if (!live.room?.isPlaying || !live.room.current) return;
        if (!isAudioBoundToQueue(audio, live.room.current.queueId)) return;
        void audio.play().catch(() => {});
      });

      audio.addEventListener('seeking', () => {
        if (enforcingFollowerSeek) return;
        revertUnauthorizedSeek(audio);
      });

      audio.addEventListener('seeked', () => {
        if (enforcingFollowerSeek) return;
        revertUnauthorizedSeek(audio);
      });

      audio.addEventListener('error', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        debugLog('audio_error', debugLine({
          queueId: useRoomStore.getState().room?.current?.queueId ?? null,
          readyState: audio.readyState,
          networkState: audio.networkState,
          errorCode: audio.error?.code ?? null,
          errorMessage: audio.error?.message || null,
          proxied: Boolean(audio.currentSrc && isProxiedMediaUrl(audio.currentSrc)),
        }));
        const live = useRoomStore.getState();
        if (!live.room?.current || runtime.skippingRef.current) return;
        if (!isAudioBoundToQueue(audio, live.room.current.queueId)) return;

        const song = live.room.current;

        recordSongPlaybackFailure();

        // 汽水严禁回退到 media-proxy（那是服务端拉密文/解密路径）；只走本地解密或恢复逻辑。
        if ((song.source || 'netease') === 'qishui') {
          void classifyMediaPlaybackError(audio).then((errorClass) => {
            if (errorClass === 'temporary' && runtime.tempRetries.current < MAX_TEMP_PLAYBACK_RETRIES) {
              runtime.tempRetries.current += 1;
              invalidateTrackUrlCache(song);
              runtime.scheduleLocalRecovery(song, 'qishui_temp_retry');
              return;
            }
            runtime.scheduleLocalRecovery(song, 'qishui_playback_failed');
          });
          return;
        }

        void classifyMediaPlaybackError(audio).then((errorClass) => {
          if (errorClass === 'temporary') {
            if (runtime.tempRetries.current < MAX_TEMP_PLAYBACK_RETRIES) {
              runtime.tempRetries.current += 1;
              controller.enqueue(async () => {
                await reloadAudioWithFreshSign(controller.audio);
              });
              return;
            }
            // 重试耗尽：只本地恢复，不因房主网络差而全屋切歌
            runtime.scheduleLocalRecovery(song, 'temp_retries_exhausted');
            return;
          }

          // 服务端返回了不可播放的媒体（例如伪装成 .flac 的 video/mp4）时，
          // 先清掉各音质旧缓存，避免下一次加载再次命中同一坏链。
          invalidateTrackUrlCache(song);

          if (runtime.lowestFallbackAttempted.current) {
            runtime.scheduleLocalRecovery(song, 'service_fallback_exhausted');
            return;
          }

          runtime.lowestFallbackAttempted.current = true;
          const beforeLocked = isPlaybackQualityLockedToLowest();
          void fetchServiceFallbackUrl(song).then(async (fallbackUrl) => {
            if (fallbackUrl) {
              const qualityDowngraded = ensureLowestQualityForLocalRecovery(song)
                || (!beforeLocked && isPlaybackQualityLockedToLowest());
              notifyLocalRecoveryToast(song, { qualityDowngraded, reason: 'media_quality_fallback' });
              runtime.tempRetries.current = 0;
              if (isCachedUrlCrossSource(song) || isTrackCrossSource(song)) {
                markTrackCrossSource(song, getCachedUrlCrossSourceFrom(song));
              }
              const freshFallback = (await refreshSignedApiUrl(fallbackUrl)) || fallbackUrl;
              controller.enqueue(async () => {
                const a = controller.audio;
                a.pause();
                // 直接换 src，勿对旧媒体 seek 0（否则可能闪播旧源开头）
                a.src = freshFallback;
                bindAudioQueueId(a, song.queueId);
                a.load();
                await a.play().catch(() => {});
              });
              return;
            }
            runtime.scheduleLocalRecovery(song, 'service_no_fallback');
          });
        });
      });

      audio.addEventListener('stalled', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState();
        if (!live.room?.current || runtime.skippingRef.current) return;
        if (!isAudioBoundToQueue(audio, live.room.current.queueId)) return;
        if (audio.paused || audio.ended) return;
        if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
        if (runtime.stallRetryTimer.current) return;

        debugLog('audio_stalled', debugLine({
          queueId: live.room.current.queueId,
          readyState: audio.readyState,
          networkState: audio.networkState,
          currentTime: Number.isFinite(audio.currentTime) ? Number(audio.currentTime.toFixed(3)) : null,
          bufferedAhead: audio.buffered.length > 0
            ? Number((audio.buffered.end(audio.buffered.length - 1) - audio.currentTime).toFixed(3))
            : 0,
          proxied: Boolean(audio.currentSrc && isProxiedMediaUrl(audio.currentSrc)),
          retryCount: runtime.tempRetries.current,
        }));

        runtime.stallRetryTimer.current = window.setTimeout(() => {
          runtime.stallRetryTimer.current = null;
          if (audio.paused || audio.ended) return;
          if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
          if (runtime.tempRetries.current >= MAX_TEMP_PLAYBACK_RETRIES) return;

          runtime.tempRetries.current += 1;
          controller.enqueue(async () => {
            const current = useRoomStore.getState().room?.current;
            const currentSrc = controller.audio.currentSrc || controller.audio.src;
            const canProxy = current
              && current.source !== 'qishui'
              && currentSrc
              && !isProxiedMediaUrl(currentSrc);

            // 直链连续 stalled 时切到同源代理，避免 CDN Range 请求在浏览器侧永久挂起。
            if (canProxy) {
              const proxied = toProxiedMediaUrl(currentSrc);
              if (proxied !== currentSrc) {
                const resumeAt = Number.isFinite(controller.audio.currentTime)
                  ? controller.audio.currentTime
                  : 0;
                controller.audio.pause();
                controller.audio.src = proxied;
                if (current) bindAudioQueueId(controller.audio, current.queueId);
                controller.audio.load();
                debugLog('audio_proxy_fallback', debugLine({
                  queueId: current?.queueId ?? null,
                  retryCount: runtime.tempRetries.current,
                  fromProxied: false,
                }));
                if (resumeAt > 0) {
                  try { controller.audio.currentTime = resumeAt; } catch { /* metadata 尚未就绪 */ }
                }
                await controller.audio.play().catch(() => {});
                return;
              }
            }

            await reloadAudioWithFreshSign(controller.audio);
          });
        }, 2500);
      });

      audio.addEventListener('playing', () => {
        const runtime = activeAudioRuntime;
        if (runtime) {
          runtime.tempRetries.current = 0;
          if (runtime.stallRetryTimer.current) {
            window.clearTimeout(runtime.stallRetryTimer.current);
            runtime.stallRetryTimer.current = null;
          }

          const live = useRoomStore.getState().room?.current;
          if (live) {
            if (localRecoveryTimer && localRecoveryQueueId === live.queueId) {
              window.clearTimeout(localRecoveryTimer);
              localRecoveryTimer = null;
              localRecoveryQueueId = null;
            }
            const trackKey = trackKeyOf(live);
            if (runtime.successRecordedTrackKey.current !== trackKey) {
              runtime.successRecordedTrackKey.current = trackKey;
              const recovered = recordSongPlaybackSuccess();
              if (recovered) {
                invalidateUnloadedSongUrlCache(trackKey);
                const preferred = getUserPlaybackQuality(live.source || 'netease');
                notifyPlaybackToast(
                  `网络已恢复，已切回「${getQualityLabel(preferred, live.source || 'netease')}」`,
                  'success',
                );
              }
            }
          }
        }
        ensureGalaxyAudioOutputIfLoaded();
        markAudioSessionUnlocked();
        useAudioStore.getState().setNeedsAudioUnlock(false);
        const live = useRoomStore.getState().room;
        if (live?.queue.length || live?.nextRandom) {
          prefetchUpcomingFromRoom(live);
        }
      });

      audio.addEventListener('loadedmetadata', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || !isAudioBoundToQueue(audio, live.queueId)) return;
        syncMediaDuration(audio, live, trackKeyOf(live));
        tryFlushPendingSnapshot();
        if (runtime?.readyRecoveryTimer.current == null) {
          runtime.readyRecoveryTimer.current = window.setTimeout(() => {
            runtime.readyRecoveryTimer.current = null;
            runtime.recoverReadyAudio(audio);
          }, 0);
        }
      });

      audio.addEventListener('loadeddata', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || !isAudioBoundToQueue(audio, live.queueId)) return;
        syncMediaDuration(audio, live, trackKeyOf(live));
        tryFlushPendingSnapshot();
        if (runtime?.readyRecoveryTimer.current == null) {
          runtime.readyRecoveryTimer.current = window.setTimeout(() => {
            runtime.readyRecoveryTimer.current = null;
            runtime.recoverReadyAudio(audio);
          }, 0);
        }
      });

      audio.addEventListener('durationchange', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || !isAudioBoundToQueue(audio, live.queueId)) return;
        syncMediaDuration(audio, live, trackKeyOf(live));
      });
    }

    return audio;
  }, [controller, scheduleLocalRecovery, finishSong, playAudio, applyPlaybackResult, recoverReadyAudio]);

  const retryPlayback = useCallback(async (fromUserGesture = false) => {
    const liveRoom = useRoomStore.getState().room;
    if (!liveRoom?.current) return;

    if (!liveRoom.isPlaying && !fromUserGesture) {
      setNeedsAudioUnlock(false);
      return;
    }

    // 用户主动恢复房间播放时结束试听；静默跟播则继续让路给试听
    if (isSongPreviewSuppressingRoom()) {
      if (!fromUserGesture) return;
      stopSongPreview({ resumeRoom: false });
    }

    if (fromUserGesture) {
      markAudioSessionUnlocked();
      setNeedsAudioUnlock(false);
      tryFlushPendingSnapshot();
      if (controller.audio.src) playInUserGesture(controller.audio);
    }

    if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;

    // 解锁/补播：必须先对齐服务端进度，routine 同步 mid-track 不会 seek
    applySync({ forceCorrection: true });
  }, [controller, applySync, setNeedsAudioUnlock]);

  useEffect(() => {
    if (!room?.current) return;
    if (shouldPromptAudioUnlock(Boolean(room.isPlaying))) {
      setNeedsAudioUnlock(true);
    }
  }, [room?.current?.queueId, room?.current?.id, room?.current?.source, room?.isPlaying, setNeedsAudioUnlock]);

  // Layer 1：初始化 — 仅 track 变化时 load，所有音频写操作走队列
  useEffect(() => {
    initAudio();
    const current = room?.current;

    if (!current) {
      loadGeneration.current += 1;
      loadLockRef.current = EMPTY_LOAD_LOCK;
      suppressAutoResumeRef.current = false;
      controller.enqueue(() => {
        const audio = controller.audio;
        audio.pause();
        clearAudioQueueBinding(audio);
        audio.removeAttribute('src');
        audio.load();
      });
      endedTrackKey.current = null;
      prevQueueIdRef.current = null;
      tempRetries.current = 0;
      setTrackLoading(false);
      setLrcDuration(null, null);
      setMediaDuration(null, null);
      return;
    }

    const trackKey = trackKeyOf(current);

    if (trackReloadNonce !== lastTrackReloadNonceRef.current) {
      lastTrackReloadNonceRef.current = trackReloadNonce;
      suppressAutoResumeRef.current = true;
      clearAudioQueueBinding(controller.audio);
      loadLockRef.current = EMPTY_LOAD_LOCK;
    }

    if (prevQueueIdRef.current && prevQueueIdRef.current !== current.queueId) {
      loadGeneration.current += 1;
      loadLockRef.current = EMPTY_LOAD_LOCK;
      justSkippedRef.current = true;
      suppressAutoResumeRef.current = true;
      endedTrackKey.current = null;
      if (localRecoveryTimer) {
        window.clearTimeout(localRecoveryTimer);
        localRecoveryTimer = null;
        localRecoveryQueueId = null;
      }
      enqueuePause();
      // 取链期间不要让旧曲继续占用 audio；新曲加载失败时也应保持明确静音状态。
      controller.enqueue(() => {
        const audio = controller.audio;
        audio.pause();
        clearAudioQueueBinding(audio);
        audio.removeAttribute('src');
        audio.load();
      });
      snapSmoothPlaybackTime(0);
    }
    prevQueueIdRef.current = current.queueId;
    if (endedTrackKey.current && endedTrackKey.current !== trackKey) {
      endedTrackKey.current = null;
    }

    if (shouldSkipTrackLoad(controller.audio, current.queueId)) {
      suppressAutoResumeRef.current = false;
      syncActualQualityFromCache(current);
      return;
    }

    if (loadLockRef.current.queueId === current.queueId) {
      return;
    }

    if (isTrackSourceError(current)) {
      setTrackLoading(false);
      if (useRoomStore.getState().isPlaybackLeader) {
        // 预取已确认无源：主控核实切歌。loadLock 仅由 requestSkip 在真正启动后写入，
        // 避免节流/跳歌中早退时永久占锁导致「源异常不切歌」
        const now = Date.now();
        if (now - lastSourceErrorSkipToastAt >= SOURCE_ERROR_SKIP_TOAST_COOLDOWN_MS) {
          lastSourceErrorSkipToastAt = now;
          notifyPlaybackToast('音源异常，正在跳过…', 'error');
        }
        requestSkip({ reason: 'source_error' });
        return;
      }
      // 成员：角标仅提示，仍尝试取链；房主切歌后会收到 room_update
      clearTrackSourceError(current);
    }

    const gen = ++loadGeneration.current;
    const queueId = current.queueId;

    // 同步占锁：避免 effect 连跑两次时都通过「无锁」检查，导致同曲两次 qishui-source（同 t，第一次被 abort）
    loadLockRef.current = { queueId, gen };
    qishuiLocalAbortRef.current?.abort();
    qishuiLocalAbortRef.current = null;

    const loadTrack = async () => {
      const loadStartedAt = performance.now();
      tempRetries.current = 0;
      lowestFallbackAttempted.current = false;
      successRecordedTrackKey.current = null;
      setTrackLoading(true);
      debugLog('track_load_start', debugLine({
        queueId,
        trackKey,
        source: current.source || 'netease',
        previousAudioBound: getAudioBoundQueueId(controller.audio),
      }));

      try {
        const liveBeforeLoad = useRoomStore.getState().room;
        if (!shouldPromptAudioUnlock(Boolean(liveBeforeLoad?.isPlaying))) {
          setNeedsAudioUnlock(false);
        } else {
          setNeedsAudioUnlock(true);
        }
        setLrcDuration(null, null);
        setMediaDuration(null, null);

        let url: string;
        let playbackUrl: string;
        let qualityLabel: string | undefined;
        let crossSource = false;
        let crossSourceFrom: ReturnType<typeof getTrackCrossSourceFrom>;
        let loudness: { gain?: number; peak?: number; lra?: number } | undefined;
        let duration: number | undefined;
        try {
          let timeoutId = 0;
          const resolved = await Promise.race([
            resolveSongUrl(current),
            new Promise<never>((_, reject) => {
              timeoutId = window.setTimeout(() => {
                reject(new TypeError('取链超时，请稍后重试'));
              }, RESOLVE_URL_TIMEOUT_MS);
            }),
          ]).finally(() => {
            if (timeoutId) window.clearTimeout(timeoutId);
          });
          if (gen !== loadGeneration.current) return;
          url = (await refreshSignedApiUrl(resolved.url)) || resolved.url;
          if (gen !== loadGeneration.current) return;
          playbackUrl = url;
          debugLog('track_resolve_done', debugLine({
            queueId,
            elapsedMs: Math.round(performance.now() - loadStartedAt),
            source: current.source || 'netease',
            proxied: Boolean(url && isProxiedMediaUrl(url)),
            quality: resolved.qualityLabel || null,
            crossSource: Boolean(resolved.crossSource),
          }));
          let resolvedMeta = resolved;
          // 仅汽水播放会话需要本地解密。跨源成功后 current.source 仍是 qishui，
          // 但 resolved.url 已是网易/QQ 直链，不能再误送进汽水解密器。
          if (current.source === 'qishui' && /\/api\/qishui-source(?:\?|$)/i.test(url)) {
            const localAbort = new AbortController();
            qishuiLocalAbortRef.current = localAbort;
            let localResult = await resolveQishuiLocalPlaybackUrl(url, localAbort.signal);
            // 服务重启后旧的汽水播放会话会失效；清掉缓存地址后重取一次。
            if (localResult.status === 'failed' && !localAbort.signal.aborted) {
              invalidateTrackUrlCache(current);
              const refreshed = await resolveSongUrl(current);
              if (gen !== loadGeneration.current) return;
              resolvedMeta = refreshed;
              url = (await refreshSignedApiUrl(refreshed.url)) || refreshed.url;
              localResult = await resolveQishuiLocalPlaybackUrl(url, localAbort.signal);
            }
            if (gen !== loadGeneration.current || localAbort.signal.aborted || localResult.status === 'aborted') {
              return;
            }
            if (localResult.status === 'source-unavailable') {
              invalidateTrackUrlCache(current);
              const fallbackUrl = await fetchServiceFallbackUrl(current);
              if (!fallbackUrl) throw new SourceUnavailableError('no url');
              playbackUrl = (await refreshSignedApiUrl(fallbackUrl)) || fallbackUrl;
              resolvedMeta = {
                ...resolvedMeta,
                url: playbackUrl,
                crossSource: true,
                crossSourceFrom: getCachedUrlCrossSourceFrom(current) || getTrackCrossSourceFrom(current),
              };
            } else if (localResult.status !== 'ok') {
              throw new Error('汽水解密失败，请刷新重试');
            }
            if (localResult.status === 'ok') playbackUrl = localResult.url;
          }
          qualityLabel = resolvedMeta.qualityLabel;
          crossSource = Boolean(resolvedMeta.crossSource)
            || isTrackCrossSource(current)
            || isCachedUrlCrossSource(current);
          crossSourceFrom = resolvedMeta.crossSourceFrom
            || getCachedUrlCrossSourceFrom(current)
            || getTrackCrossSourceFrom(current);
          loudness = resolvedMeta.loudness;
          duration = resolvedMeta.duration;
          if (crossSource) markTrackCrossSource(current, crossSourceFrom);
          if (resolveFailCountRef.current?.queueId === queueId) {
            resolveFailCountRef.current = null;
          }
        } catch (err) {
          console.error('Failed to load song:', err);
          if (gen !== loadGeneration.current) return;
          clearAudioQueueBinding(controller.audio);

          const isLeader = useRoomStore.getState().isPlaybackLeader;
          const errMessage = err instanceof Error ? err.message : '';
          if (errMessage === '汽水解密失败，请刷新重试') {
            notifyPlaybackToast(errMessage, 'error');
            return;
          }
          const timedOut = /取链超时/.test(errMessage);
          const sourceUnavailable = err instanceof SourceUnavailableError
            || isSourceUnavailableMessage(errMessage)
            || isTrackSourceError(current);

          if (isLeader && (sourceUnavailable || timedOut)) {
            const prev = resolveFailCountRef.current;
            const count = prev?.queueId === queueId ? prev.count + 1 : 1;
            resolveFailCountRef.current = { queueId, count };
            if (count >= SOURCE_ERROR_SERVER_VERIFY_AFTER || timedOut) {
              // 多次失败或取链超时：主控切歌，避免 loading 挂死拖垮全屋
              resolveFailCountRef.current = null;
              notifyPlaybackToast(
                timedOut ? '音源加载超时，正在跳过…' : '音源异常，正在跳过…',
                'error',
              );
              requestSkip({ reason: 'source_error' });
              return;
            }
            scheduleLocalRecovery(current, 'source_unavailable');
            return;
          }
          scheduleLocalRecovery(current, sourceUnavailable ? 'source_unavailable' : 'resolve_url_failed');
          return;
        }

        if (gen !== loadGeneration.current) return;

        await controller.exec(async () => {
          if (gen !== loadGeneration.current) return;
          const audio = controller.audio;
          const liveNow = useRoomStore.getState().room?.current;
          if (!liveNow || liveNow.queueId !== current.queueId) return;
          // 换源前保持 suppress：禁止对旧 src seek 0，否则后台竞态 play 会闪播旧曲开头
          suppressAutoResumeRef.current = true;
          applyTrackLoudness(loudness);
          audio.pause();
          clearAudioQueueBinding(audio);
          // 先用已知进度占位，避免换源瞬间进度条跳回 0；真正对齐在 load 完成后 forceTime
          {
            const pb = getClientPlaybackState();
            const previewTime = pb
              ? getPlaybackTime(pb)
              : Math.max(0, Number(useRoomStore.getState().room?.currentTime) || 0);
            snapSmoothPlaybackTime(justSkippedRef.current ? 0 : previewTime);
          }
          audio.src = playbackUrl;
          bindAudioQueueId(audio, current.queueId);
          audio.load();
          debugLog('track_audio_bound', debugLine({
            queueId: current.queueId,
            elapsedMs: Math.round(performance.now() - loadStartedAt),
            proxied: isProxiedMediaUrl(playbackUrl),
          }));
        });

        if (gen !== loadGeneration.current) return;

        const liveAfterSrc = useRoomStore.getState().room;
        if (
          isRestrictedAutoplayEnv()
          && liveAfterSrc?.isPlaying
          && liveAfterSrc.current
          && trackKeyOf(liveAfterSrc.current) === trackKey
        ) {
          await controller.exec(async () => {
            if (gen !== loadGeneration.current) return;
            const audio = controller.audio;
            const earlyProbe = await playAudio(audio);
            if (!playbackNeedsUnlock(earlyProbe, audio)) {
              audio.pause();
            }
            if (playbackNeedsUnlock(earlyProbe, audio) && liveAfterSrc) {
              applyPlaybackResult(earlyProbe, audio, liveAfterSrc);
            }
          });
        }

        await waitForAudioCanPlay(controller.audio);
        if (gen !== loadGeneration.current) return;
        debugLog('track_audio_ready', debugLine({
          queueId: current.queueId,
          elapsedMs: Math.round(performance.now() - loadStartedAt),
          readyState: controller.audio.readyState,
          duration: Number.isFinite(controller.audio.duration) ? Number(controller.audio.duration.toFixed(3)) : null,
          networkState: controller.audio.networkState,
        }));

        // 仅缓存/同步服务端地址；blob: 只属于当前浏览器，不能发给房间内其他用户。
        rememberSongUrl(trackKey, url, qualityLabel, crossSource, crossSourceFrom, loudness, duration);
        if (duration && duration > 0) {
          const live = useRoomStore.getState().room;
          if (live?.current?.queueId === current.queueId) {
            useRoomStore.getState().setRoom({
              ...live,
              current: live.current.duration === duration ? live.current : { ...live.current, duration },
            });
          }
          setMediaDuration(trackKey, duration);
          reportTrackDurationToServer(current.queueId, duration);
        }
        useAudioStore.getState().setActualMedia(trackKey, {
          qualityLabel,
          source: crossSource ? crossSourceFrom : (current.source || 'netease'),
        });
        // 向房间分享当前曲链接，后续进房者可直接命中缓存
        reportPlaybackMedia({
          trackId: current.queueId,
          url: stripApiSignParams(url),
          qualityLabel,
          crossSource,
          crossSourceFrom,
          loudness,
          duration,
        });
        syncMediaDuration(controller.audio, current, trackKey);
        tryFlushPendingSnapshot();

        const liveAfterLoad = useRoomStore.getState().room;
        if (
          isRestrictedAutoplayEnv()
          && liveAfterLoad?.isPlaying
          && liveAfterLoad.current
          && trackKeyOf(liveAfterLoad.current) === trackKey
          && !useAudioStore.getState().needsAudioUnlock
        ) {
          await controller.exec(async () => {
            if (gen !== loadGeneration.current) return;
            const audio = controller.audio;
            const probe = await playAudio(audio);
            if (!playbackNeedsUnlock(probe, audio)) {
              audio.pause();
            }
            if (playbackNeedsUnlock(probe, audio) && liveAfterLoad) {
              applyPlaybackResult(probe, audio, liveAfterLoad);
            }
          });
        }

        const liveRoom = useRoomStore.getState().room;
        if (liveRoom) prefetchUpcomingFromRoom(liveRoom);
      } catch (err) {
        console.error('Failed to load song:', err);
        debugLog('track_load_failed', debugLine({
          queueId: current.queueId,
          elapsedMs: Math.round(performance.now() - loadStartedAt),
          error: err instanceof Error ? err.message : String(err),
        }));
        if (gen !== loadGeneration.current) return;
        clearAudioQueueBinding(controller.audio);
        scheduleLocalRecovery(current, 'load_track_failed');
      } finally {
        releaseLoadLock(loadLockRef, queueId, gen);
        if (gen === loadGeneration.current) {
          setTrackLoading(false);
          debugLog('track_load_end', debugLine({
            queueId,
            elapsedMs: Math.round(performance.now() - loadStartedAt),
            boundQueueId: getAudioBoundQueueId(controller.audio),
            readyState: controller.audio.readyState,
            loadingCleared: true,
          }));
          const live = useRoomStore.getState().room;
          // 新曲已绑定：放开自动续播闸，再走 forceZero/校正同步
          if (live?.current?.queueId === queueId && isAudioBoundToQueue(controller.audio, queueId)) {
            suppressAutoResumeRef.current = false;
          }
          if (
            live?.current
            && live.current.queueId === queueId
            && trackKeyOf(live.current) === trackKey
            && canSyncAudioForQueue(controller.audio, live.current.queueId)
          ) {
            const wasNewTrack = justSkippedRef.current;
            justSkippedRef.current = false;
            // 换源后 audio 停在 0：必须 mandatory seek；若服务端已为同曲建立时间轴，沿用其当前进度。
            tryFlushPendingSnapshot();
            if (wasNewTrack) {
              applySync({ forceTime: resolveInitialTrackSyncTime(queueId, live.currentTime) });
            } else {
              const pb = getClientPlaybackState();
              const targetTime = pb
                ? getPlaybackTime(pb)
                : Math.max(0, Number(live.currentTime) || 0);
              applySync({ forceTime: targetTime });
            }
          }
        }
      }
    };

    void loadTrack();
  }, [
    room?.current?.id,
    room?.current?.queueId,
    room?.current?.source,
    loadRetryNonce,
    trackReloadNonce,
    sharedAudioGeneration,
    tvMode,
    initAudio,
    controller,
    requestSkip,
    scheduleLocalRecovery,
    enqueuePause,
    applySync,
    setTrackLoading,
    setLrcDuration,
    setMediaDuration,
    setNeedsAudioUnlock,
    playAudio,
    applyPlaybackResult,
    reportPlaybackMedia,
  ]);

  // 主控 loading 过久：强制切歌，防止取链挂起/跳歌失败后全屋卡死（刷新才能恢复）
  useEffect(() => {
    if (!trackLoading || !isPlaybackLeader) return;
    const queueId = room?.current?.queueId;
    if (!queueId) return;

    const timeoutMs = room?.current?.source === 'qishui'
      ? QISHUI_LEADER_LOAD_STUCK_SKIP_MS
      : LEADER_LOAD_STUCK_SKIP_MS;
    const timer = window.setTimeout(() => {
      const live = useRoomStore.getState();
      if (!live.isPlaybackLeader || skippingRef.current) return;
      if (!useAudioStore.getState().trackLoading) return;
      if (live.room?.current?.queueId !== queueId) return;

      debugLog('leader_load_stuck_skip', debugLine({
        queueId,
        afterMs: timeoutMs,
      }));
      notifyPlaybackToast('音源加载超时，正在跳过…', 'error');
      requestSkip({ reason: 'source_error', bypassThrottle: true });
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [trackLoading, isPlaybackLeader, room?.current?.queueId, requestSkip]);

  // 主控：房间在播但 audio 长时间绑不上当前曲（后台切歌/源异常/无 duration）→ 强制推进
  useEffect(() => {
    if (!isPlaybackLeader || !room?.isPlaying) return;
    const queueId = room?.current?.queueId;
    if (!queueId) return;
    if (canSyncAudioForQueue(controller.audio, queueId)) return;

    const timeoutMs = room.current?.source === 'qishui'
      ? QISHUI_LEADER_BIND_MISMATCH_SKIP_MS
      : LEADER_BIND_MISMATCH_SKIP_MS;
    const timer = window.setTimeout(() => {
      const live = useRoomStore.getState();
      if (!live.isPlaybackLeader || skippingRef.current) return;
      const current = live.room?.current;
      if (!current || current.queueId !== queueId || !live.room?.isPlaying) return;
      if (canSyncAudioForQueue(controller.audio, queueId)) return;
      // 仍在取链：交给 LEADER_LOAD_STUCK_SKIP；此处专治 loading=false 却永久脱节
      if (useAudioStore.getState().trackLoading) return;

      debugLog('leader_bind_mismatch_skip', debugLine({
        queueId,
        afterMs: timeoutMs,
        sourceError: isTrackSourceError(current),
      }));
      loadLockRef.current = EMPTY_LOAD_LOCK;
      const now = Date.now();
      if (now - lastSourceErrorSkipToastAt >= SOURCE_ERROR_SKIP_TOAST_COOLDOWN_MS) {
        lastSourceErrorSkipToastAt = now;
        notifyPlaybackToast(
          isTrackSourceError(current) ? '音源异常，正在跳过…' : '播放异常，正在跳过…',
          'error',
        );
      }
      requestSkip({ reason: 'source_error', bypassThrottle: true });
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [
    isPlaybackLeader,
    room?.isPlaying,
    room?.current?.queueId,
    requestSkip,
    controller,
  ]);

  // 在房期间开启 Web Lock + Worker，缓解后台节流/冻结（无法真正关闭浏览器节流）
  useEffect(() => {
    const inRoom = Boolean(room?.id);
    setBackgroundKeepaliveActive(inRoom);
    return () => setBackgroundKeepaliveActive(false);
  }, [room?.id]);

  // room.current 与 audio.src 脱节时重试 load；源异常占锁时主动解锁并重试切歌
  // 用共享 Worker 定时器叫醒主线程，避免后台 setInterval 被节流拖垮
  useEffect(() => {
    let lastWatchdogAt = 0;
    const runLoadWatchdog = () => {
      const now = Date.now();
      if (now - lastWatchdogAt < LOAD_WATCHDOG_INTERVAL_MS) return;
      lastWatchdogAt = now;

      const live = useRoomStore.getState();
      const liveRoom = live.room;
      const current = liveRoom?.current;
      if (!current) return;
      const audio = controller.audio;

      // 主控卡在「源异常 + loadLock / 未跳成」：解开锁并触发 load effect 再次 requestSkip
      if (
        live.isPlaybackLeader
        && liveRoom?.isPlaying
        && isTrackSourceError(current)
        && !skippingRef.current
        && !useAudioStore.getState().trackLoading
      ) {
        if (loadLockRef.current.queueId === current.queueId) {
          loadLockRef.current = EMPTY_LOAD_LOCK;
        }
        if (!canSyncAudioForQueue(audio, current.queueId)) {
          setLoadRetryNonce((n) => n + 1);
          return;
        }
      }

      if (shouldSkipTrackLoad(audio, current.queueId)) return;
      if (loadLockRef.current.queueId) return;
      if (useAudioStore.getState().trackLoading) return;
      setLoadRetryNonce((n) => n + 1);
    };

    return createWorkerInterval(runLoadWatchdog, LOAD_WATCHDOG_INTERVAL_MS);
  }, [controller]);

  // 服务端 PlaybackState（150ms 防抖后）→ 统一同步
  useEffect(() => {
    if (trackLoading) return;
    if (isSongPreviewSuppressingRoom()) return;
    const liveRoom = useRoomStore.getState().room;
    if (!liveRoom?.current) return;
    if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
    if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
    if (skippingRef.current) return;

    const wasNewTrack = justSkippedRef.current;
    justSkippedRef.current = false;
    if (!wasNewTrack && shouldSkipForEndedTrackKey(liveRoom.current, controller.audio)) return;

    applySync(wasNewTrack
      ? { forceTime: resolveInitialTrackSyncTime(liveRoom.current.queueId, liveRoom.currentTime) }
      : { forceCorrection: true });
  }, [playbackVersion, trackLoading, applySync, shouldSkipForEndedTrackKey, controller]);

  // 离散同步：NORMAL 不追赶，FINAL（≤3s）一次性对齐；6s 仅检查是否进入 FINAL
  useEffect(() => {
    if (tvMode) return;

    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || !liveRoom.isPlaying) return;
      if (skippingRef.current || controller.isRunning) return;
      if (useAudioStore.getState().trackLoading) return;
      if (isAudioBuffering(controller.audio)) return;
      if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (shouldSkipForEndedTrackKey(liveRoom.current, controller.audio)) return;
      if (!controller.audio.src) return;
      applySync();
    }, CALIBRATION_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [tvMode, controller, applySync, shouldSkipForEndedTrackKey, room?.isPlaying, room?.current?.queueId]);

  useEffect(() => {
    setAudioBufferEndHandler((audio) => {
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || skippingRef.current) return;
      if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (useAudioStore.getState().trackLoading) return;

      const song = liveRoom.current;
      controller.enqueue(async () => {
        if (isSongPreviewSuppressingRoom()) return;
        await applyPostBufferSync(audio, {
          song,
          capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
          tvMode,
        });
      });
    });
    return () => setAudioBufferEndHandler(null);
  }, [controller, tvMode]);

  // 刚成为播放主控：对齐服务端时间轴
  useEffect(() => {
    const becameLeader = isPlaybackLeader && !wasLeaderRef.current;
    wasLeaderRef.current = isPlaybackLeader;
    if (!becameLeader || tvMode || trackLoading) return;

    const current = room?.current;
    if (!current) return;
    if (!canSyncAudioForQueue(controller.audio, current.queueId)) return;

    applySync();
  }, [isPlaybackLeader, tvMode, room?.current?.queueId, trackLoading, applySync, controller]);

  // visibilitychange / pageshow / focus：切走不做任何事；切回强制对齐并续播；脱节则重载/切歌
  useEffect(() => {
    installBackgroundPlaybackGuards();
    let resumeTimer: number | null = null;

    const resumeFromForeground = () => {
      if (document.hidden) return;
      if (isSongPreviewSuppressingRoom()) return;

      const live = useRoomStore.getState();
      const liveRoom = live.room;
      if (!liveRoom?.current || !liveRoom.isPlaying) return;
      if (skippingRef.current) return;

      const current = liveRoom.current;
      if (!canSyncAudioForQueue(controller.audio, current.queueId)) {
        // 回前台发现音源脱节：解开 load 锁；源异常则主控立刻切歌，否则触发重新取链
        loadLockRef.current = EMPTY_LOAD_LOCK;
        if (live.isPlaybackLeader && isTrackSourceError(current)) {
          const now = Date.now();
          if (now - lastSourceErrorSkipToastAt >= SOURCE_ERROR_SKIP_TOAST_COOLDOWN_MS) {
            lastSourceErrorSkipToastAt = now;
            notifyPlaybackToast('音源异常，正在跳过…', 'error');
          }
          requestSkip({ reason: 'source_error', bypassThrottle: true });
          return;
        }
        if (!useAudioStore.getState().trackLoading) {
          setLoadRetryNonce((n) => n + 1);
        }
        return;
      }

      if (!playbackStateMatchesCurrentTrack(current)) return;
      if (shouldSkipForEndedTrackKey(current, controller.audio)) return;
      if (useAudioStore.getState().trackLoading) return;
      if (!controller.audio.src) return;

      tryFlushPendingSnapshot();
      applyVisibilitySync();

      // 部分 Android WebView 抢焦点后首次 play 会静默失败，短延迟再补一次
      if (resumeTimer != null) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        resumeTimer = null;
        if (document.hidden) return;
        const roomNow = useRoomStore.getState().room;
        const audio = controller.audio;
        if (!roomNow?.current || !roomNow.isPlaying || !audio.src) return;
        if (!audio.paused && !audio.ended) return;
        if (!canSyncAudioForQueue(audio, roomNow.current.queueId)) return;
        applyVisibilitySync();
      }, 400);
    };

    const onVisibilityChange = () => {
      if (document.hidden) return;
      resumeFromForeground();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', resumeFromForeground);
    window.addEventListener('focus', resumeFromForeground);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', resumeFromForeground);
      window.removeEventListener('focus', resumeFromForeground);
      if (resumeTimer != null) window.clearTimeout(resumeTimer);
    };
  }, [controller, applyVisibilitySync, shouldSkipForEndedTrackKey, requestSkip]);

  const handlePlayPause = useCallback(() => {
    if (!room) return;
    togglePlay(!room.isPlaying);
  }, [room, togglePlay]);

  const handleLocalPlayback = useCallback((isPlaying: boolean) => {
    const live = useRoomStore.getState().room;
    const audio = controller.audio;
    if (!isPlaying) {
      intentionalLocalPauseRef.current = true;
      audio.pause();
      // pause 事件同步触发后再清，避免被自动续播顶掉
      queueMicrotask(() => {
        intentionalLocalPauseRef.current = false;
      });
      if (live?.current) {
        const pos = Number.isFinite(audio.currentTime) && audio.currentTime > 0
          ? audio.currentTime
          : (live.currentTime || 0);
        optimisticSetPlaying(live.id, live.current.queueId, false, pos);
        useRoomStore.getState().setRoom({ ...live, isPlaying: false, currentTime: pos });
        snapSmoothPlaybackTime(pos);
      } else if (live) {
        useRoomStore.getState().setRoom({ ...live, isPlaying: false });
      }
      return;
    }
    if (live?.current) {
      const pos = Number.isFinite(audio.currentTime) && audio.currentTime > 0
        ? audio.currentTime
        : (live.currentTime || 0);
      optimisticSetPlaying(live.id, live.current.queueId, true, pos);
      useRoomStore.getState().setRoom({ ...live, isPlaying: true, currentTime: pos });
    }
    useAudioStore.getState().retryPlayback?.(true);
  }, [controller]);

  const handleSoftResumeLocalAudio = useCallback(() => {
    if (isSongPreviewSuppressingRoom()) return;
    if (suppressAutoResumeRef.current) return;
    const live = useRoomStore.getState().room;
    const audio = controller.audio;
    if (!live?.isPlaying || !live.current) return;
    if (!isAudioBoundToQueue(audio, live.current.queueId)) return;
    if (!audio.src || audio.ended) return;
    if (!audio.paused) return;
    void audio.play().catch(() => {});
  }, [controller]);

  const handleSeek = useCallback((time: number) => {
    const { room: live, canControlPlayback } = useRoomStore.getState();
    if (!canSeekInRoom(live, canControlPlayback)) return;

    const current = live?.current;
    if (!live || !current) return;

    const capped = capSeekTime(time, current, controller.audio.duration);
    endedTrackKey.current = null;
    const optimistic = optimisticSeekPosition(live.id, current.queueId, capped, live.isPlaying);
    useAudioStore.getState().setPlaybackVersion(optimistic.version);
    snapSmoothPlaybackTime(capped);
    useRoomStore.getState().setRoom({ ...live, currentTime: capped });

    if (canSyncAudioForQueue(controller.audio, current.queueId)) {
      controller.audio.currentTime = capped;
      applySync({ forceTime: capped });
    }
    seek(capped);
  }, [controller, seek, applySync]);

  useMediaSession({
    enabled: !tvMode,
    togglePlay,
    skipSong,
    requestSkip: requestSkipVote,
    seekTo: handleSeek,
  });

  useEffect(() => {
    setSeekPlayback(handleSeek);
    return () => setSeekPlayback(null);
  }, [handleSeek, setSeekPlayback]);

  useEffect(() => {
    setLocalPlayback(handleLocalPlayback);
    return () => setLocalPlayback(null);
  }, [handleLocalPlayback, setLocalPlayback]);

  useEffect(() => {
    setSoftResumeLocalAudio(handleSoftResumeLocalAudio);
    return () => setSoftResumeLocalAudio(null);
  }, [handleSoftResumeLocalAudio, setSoftResumeLocalAudio]);

  useEffect(() => {
    setRetryPlayback(retryPlayback);
    return () => setRetryPlayback(null);
  }, [retryPlayback, setRetryPlayback]);

  useEffect(() => {
    onWeChatBridgeReady(() => {
      const liveRoom = useRoomStore.getState().room;
      if (isSongPreviewSuppressingRoom()) return;
      if (!controller.audio.src || !liveRoom?.current || !liveRoom.isPlaying) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (useAudioStore.getState().trackLoading || skippingRef.current) return;
      applySync();
    });
  }, [applySync]);

  useEffect(() => {
    if (!needsAudioUnlock || !shouldShowUnlockOverlay()) return;
    if (!tvMode) return;

    const unlock = () => {
      markAudioSessionUnlocked();
      useAudioStore.getState().setNeedsAudioUnlock(false);
      useAudioStore.getState().retryPlayback?.(true);
    };

    document.addEventListener('keydown', unlock, { capture: true });
    return () => document.removeEventListener('keydown', unlock, { capture: true });
  }, [tvMode, needsAudioUnlock]);

  useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || !liveRoom.isPlaying) return;
      const loading = useAudioStore.getState().trackLoading;
      if (loading && (!isRestrictedAutoplayEnv() || !controller.audio.src)) return;
      if (skippingRef.current || controller.isRunning) return;
      if (!controller.audio.src || !controller.audio.paused) return;
      if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (shouldSkipForEndedTrackKey(liveRoom.current, controller.audio)) return;

      tryFlushPendingSnapshot();
      // 等待解锁期间也要把暂停的 audio 对齐到服务端，点击后不会从旧进度开播
      applySync({ forceCorrection: true });
    };

    const id = window.setInterval(check, UNLOCK_POLL_MS);
    return () => window.clearInterval(id);
  }, [controller, room?.current?.queueId, room?.isPlaying, applySync, shouldSkipForEndedTrackKey]);

  useEffect(() => {
    const roomState = useRoomStore.getState().room;
    if (!roomState?.current) return;
    if (!canSyncAudioForQueue(controller.audio, roomState.current.queueId)) return;
    prefetchUpcomingFromRoom(roomState);
  }, [room?.queue, room?.nextRandom?.queueId, room?.nextRandom?.id, room?.current?.queueId, room?.current?.id, room?.current?.source]);

  useEffect(() => {
    return () => {
      loadGeneration.current += 1;
      qishuiLocalAbortRef.current?.abort();
      qishuiLocalAbortRef.current = null;
      loadLockRef.current = EMPTY_LOAD_LOCK;
      if (readyRecoveryTimer.current) {
        window.clearTimeout(readyRecoveryTimer.current);
        readyRecoveryTimer.current = null;
      }
      if (activeAudioRuntime?.audioRef === audioRef) {
        activeAudioRuntime = null;
      }
    };
  }, []);

  const handleSkip = useCallback(() => {
    requestSkip({ reason: 'manual' });
  }, [requestSkip]);

  return { handlePlayPause, handleSeek, handleSkip, audioRef };
}
