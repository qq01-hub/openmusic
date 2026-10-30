import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { useChatStore } from '../stores/chatStore';
import { useImmersiveModeStore } from '../stores/immersiveModeStore';
import { useSiteFeaturesStore } from '../stores/siteFeaturesStore';
import { useSongHistoryStore } from '../stores/songHistoryStore';
import { getStoredUserAudioQuality } from '../stores/userQualityStore';
import { getTrackKey } from '../api/music';
import {
  getQualityLabel,
  getRoomPlaybackQuality,
  getUserPlaybackQuality,
  normalizeRoomAudioQuality,
  WEAK_DEVICE_PLAYBACK_QUALITY_CAP,
} from '../api/music/quality';
import { getSharedAudio } from './audioElement';
import { canSyncAudioForQueue, getAudioBoundQueueId } from './audioTrackBinding';
import { getClientId } from './clientId';
import { getDeviceId } from './deviceId';
import {
  getClientPlaybackState,
  getClientPlaybackVersion,
  getPlaybackSnapshotTiming,
  getPlaybackTime,
} from './playbackState';
import {
  formatDriftHistogram,
  getDriftHistogramTotal,
  resetDriftHistogram,
} from './driftHistogram';
import { getRateBias } from './driftController';
import { isAudioBuffering } from './audioBuffering';
import {
  isHttpsPageContext,
  isInsecureRemoteMediaUrl,
  isProxiedMediaUrl,
  isSameOriginMediaUrl,
  unwrapProxiedMediaUrl,
} from './mediaProxyUrl';
import {
  getTrackCrossSourceFrom,
  isTrackCrossSource,
  isTrackSourceError,
} from './songPreloadCache';
import { getDeviceProbe, isWeakPlaybackDevice } from './weakPlaybackDevice';
import { isPlaybackQualityLockedToLowest } from './playbackQualityLock';
import {
  getSyncState,
  isInForceCorrectionCooldown,
  isInRecoveryCooldown,
} from './syncStateMachine';
import {
  isAudioSessionUnlocked,
  isIOS,
  isMobileDevice,
  isRestrictedAutoplayEnv,
  isWeChatBrowser,
} from './audioUnlock';
import {
  isLikelySystemMediaSuspend,
  shouldIgnoreBackgroundRoomPause,
} from './backgroundPlayback';
import { getBackgroundKeepaliveDebug } from './backgroundKeepalive';
import { readRoomVisualMode, shouldProxySongPlaybackUrl } from './roomVisualPreset';
import { LOCAL_APP_BUILD_ID } from './appVersion';
import type { MusicSource, QueueItem } from '../types';

const DEBUG_FLAG_KEY = 'openmusic:debug';
const DEBUG_INTERVAL_MS = 2000;
const MAX_EVENTS = 200;
const ERROR_REPORT_EVENT_LIMIT = 60;
const ERROR_REPORT_SNAPSHOT_COUNT = 5;
const ERROR_REPORT_SNAPSHOT_INTERVAL_MS = 400;
const SESSION_STARTED_AT = Date.now();

type DebugEvent = {
  at: string;
  ts: number;
  name: string;
  line: string;
};

export type SocketSnapshot = {
  id?: string;
  connected?: boolean;
  transport?: string;
  active?: boolean;
  recovered?: boolean;
  engineReadyState?: string;
};

type DebugScalar = string | number | boolean | null | undefined;

const state = {
  enabled: false,
  timer: 0,
  events: [] as DebugEvent[],
  getSocket: null as null | (() => SocketSnapshot | null),
};

function nowLabel(): string {
  return new Date().toISOString().slice(11, 23);
}

function fmtNum(value: number | null | undefined, digits = 3): string {
  return Number.isFinite(value) ? Number(value!.toFixed(digits)).toString() : 'null';
}

function fmtMs(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? Math.round(value as number) : null;
}

/** key=value 单行，便于整段复制 */
export function debugLine(parts: Record<string, DebugScalar>): string {
  return Object.entries(parts)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v ?? 'null'}`)
    .join(' ');
}

export function debugLog(name: string, line?: string): void {
  const text = line ?? '';
  const event: DebugEvent = {
    at: nowLabel(),
    ts: Date.now(),
    name,
    line: text,
  };
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
  if (state.enabled) {
    console.log(text ? `[openmusic:${name}] ${text}` : `[openmusic:${name}]`);
  }
}

function shortSrc(src: string): string {
  if (!src) return '';
  try {
    const url = new URL(src);
    return `${url.host}${url.pathname.slice(0, 24)}…`;
  } catch {
    return src.slice(0, 48);
  }
}

function readyStateLabel(value: number): string {
  switch (value) {
    case HTMLMediaElement.HAVE_NOTHING: return 'HAVE_NOTHING';
    case HTMLMediaElement.HAVE_METADATA: return 'HAVE_METADATA';
    case HTMLMediaElement.HAVE_CURRENT_DATA: return 'HAVE_CURRENT_DATA';
    case HTMLMediaElement.HAVE_FUTURE_DATA: return 'HAVE_FUTURE_DATA';
    case HTMLMediaElement.HAVE_ENOUGH_DATA: return 'HAVE_ENOUGH_DATA';
    default: return `unknown(${value})`;
  }
}

function networkStateLabel(value: number): string {
  switch (value) {
    case HTMLMediaElement.NETWORK_EMPTY: return 'NETWORK_EMPTY';
    case HTMLMediaElement.NETWORK_IDLE: return 'NETWORK_IDLE';
    case HTMLMediaElement.NETWORK_LOADING: return 'NETWORK_LOADING';
    case HTMLMediaElement.NETWORK_NO_SOURCE: return 'NETWORK_NO_SOURCE';
    default: return `unknown(${value})`;
  }
}

function mediaErrorLabel(error: MediaError | null): string | null {
  if (!error) return null;
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED: return 'MEDIA_ERR_ABORTED';
    case MediaError.MEDIA_ERR_NETWORK: return 'MEDIA_ERR_NETWORK';
    case MediaError.MEDIA_ERR_DECODE: return 'MEDIA_ERR_DECODE';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
    default: return `unknown(${error.code})`;
  }
}

function upstreamHostOf(src: string): string | null {
  if (!src) return null;
  const raw = isProxiedMediaUrl(src) ? unwrapProxiedMediaUrl(src) : src;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function formatBufferedAhead(audio: HTMLAudioElement): string {
  const ranges = audio.buffered;
  if (!ranges || ranges.length === 0) return '0';
  let maxEnd = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    maxEnd = Math.max(maxEnd, ranges.end(i));
  }
  const aheadSec = Math.max(0, maxEnd - audio.currentTime);
  return `${fmtNum(aheadSec)}s/${ranges.length}rng`;
}

function formatTimeRanges(ranges: TimeRanges | undefined, currentTime: number): string {
  if (!ranges || ranges.length === 0) return '0';
  let covered = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (end > currentTime) covered += end - Math.max(start, currentTime);
    else if (end > start) covered += 0;
  }
  return `${ranges.length}rng/+${fmtNum(Math.max(0, covered))}s`;
}

type NetInfoSnapshot = {
  effectiveType: string | null;
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean | null;
  type: string | null;
};

function readNetworkInformation(): NetInfoSnapshot {
  const conn = (navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
      type?: string;
    };
  }).connection;
  if (!conn) {
    return {
      effectiveType: null,
      downlinkMbps: null,
      rttMs: null,
      saveData: null,
      type: null,
    };
  }
  return {
    effectiveType: conn.effectiveType ?? null,
    downlinkMbps: Number.isFinite(conn.downlink) ? Number(conn.downlink) : null,
    rttMs: Number.isFinite(conn.rtt) ? Number(conn.rtt) : null,
    saveData: typeof conn.saveData === 'boolean' ? conn.saveData : null,
    type: conn.type ?? null,
  };
}

type HeapSnapshot = {
  usedMb: number | null;
  totalMb: number | null;
  limitMb: number | null;
};

function readHeapSnapshot(): HeapSnapshot {
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  }).memory;
  if (!memory) return { usedMb: null, totalMb: null, limitMb: null };
  const toMb = (bytes?: number) => (
    Number.isFinite(bytes) ? Number(((bytes as number) / (1024 * 1024)).toFixed(1)) : null
  );
  return {
    usedMb: toMb(memory.usedJSHeapSize),
    totalMb: toMb(memory.totalJSHeapSize),
    limitMb: toMb(memory.jsHeapSizeLimit),
  };
}

function trackKeyOfCurrent(current: Pick<QueueItem, 'queueId' | 'id' | 'source'> | null | undefined): string | null {
  if (!current) return null;
  return getTrackKey(current);
}

function qualityParts(source: MusicSource | null | undefined) {
  const room = useRoomStore.getState().room;
  const roomQuality = normalizeRoomAudioQuality(room?.audioQuality);
  const userQuality = getStoredUserAudioQuality();
  const immersive = useImmersiveModeStore.getState();
  const site = useSiteFeaturesStore.getState();
  const weak = isWeakPlaybackDevice();
  const request = source ? getUserPlaybackQuality(source) : undefined;
  const roomForSource = source ? getRoomPlaybackQuality(source) : undefined;
  const audioStore = useAudioStore.getState();
  const trackKey = trackKeyOfCurrent(room?.current);
  const actual = trackKey ? (audioStore.actualQualityByTrack[trackKey] ?? null) : null;

  return {
    roomNetease: roomQuality.netease,
    roomTencent: roomQuality.tencent,
    userNetease: userQuality?.netease ?? null,
    userTencent: userQuality?.tencent ?? null,
    roomQualityForSource: roomForSource ?? null,
    playbackQualityRequest: request ?? null,
    playbackQualityRequestLabel: request
      ? getQualityLabel(request, source || undefined)
      : null,
    trackActualQuality: actual,
    weakPlaybackDevice: weak,
    weakQualityCap: weak ? WEAK_DEVICE_PLAYBACK_QUALITY_CAP : null,
    qualityLockedToLowest: isPlaybackQualityLockedToLowest(),
    immersiveEnabled: immersive.enabled,
    immersiveQualityCapActive: immersive.qualityCapActive,
    svipQualityEnabled: JSON.stringify(site.svipQualityEnabled),
    siteFeaturesHydrated: site.hydrated,
  };
}

function collectEnvFields(): Record<string, DebugScalar> {
  const heap = readHeapSnapshot();
  return {
    buildId: LOCAL_APP_BUILD_ID,
    href: typeof location !== 'undefined' ? location.href : '',
    origin: typeof location !== 'undefined' ? location.origin : '',
    path: typeof location !== 'undefined' ? location.pathname : '',
    clientId: getClientId(),
    deviceId: getDeviceId(),
    sessionUptimeSec: fmtNum((Date.now() - SESSION_STARTED_AT) / 1000, 1),
    timeOriginMs: fmtMs(performance.timeOrigin),
    perfNowMs: fmtMs(performance.now()),
    httpsPage: isHttpsPageContext(),
    jsHeapUsedMb: heap.usedMb,
    jsHeapTotalMb: heap.totalMb,
    jsHeapLimitMb: heap.limitMb,
  };
}

function collectDeviceFields(): Record<string, DebugScalar> {
  const probe = getDeviceProbe();
  return {
    ua: probe.userAgent.slice(0, 220),
    language: probe.language || null,
    platform: probe.platform || null,
    vendor: probe.vendor || null,
    isMobile: probe.isMobile || isMobileDevice(),
    isAndroid: probe.isAndroid,
    isAndroidWebView: probe.isAndroidWebView,
    isIOS: probe.isIOS || isIOS(),
    isWeChat: probe.isWeChat || isWeChatBrowser(),
    weakUaMatch: probe.weakUaMatch,
    weakPlaybackDevice: isWeakPlaybackDevice(),
    deviceMemoryGb: probe.deviceMemoryGb,
    hardwareConcurrency: probe.hardwareConcurrency,
    maxTouchPoints: probe.maxTouchPoints,
    cookieEnabled: probe.cookieEnabled,
    restrictedAutoplay: isRestrictedAutoplayEnv(),
    audioSessionUnlocked: isAudioSessionUnlocked(),
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio : null,
    viewport: typeof window !== 'undefined'
      ? `${window.innerWidth}x${window.innerHeight}`
      : null,
    screen: typeof screen !== 'undefined'
      ? `${screen.width}x${screen.height}`
      : null,
  };
}

function collectNetworkFields(socket: SocketSnapshot | null | undefined): Record<string, DebugScalar> {
  const net = readNetworkInformation();
  const keepalive = getBackgroundKeepaliveDebug();
  return {
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    hidden: typeof document !== 'undefined' ? document.hidden : null,
    visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    netEffectiveType: net.effectiveType,
    netDownlinkMbps: net.downlinkMbps,
    netRttMs: net.rttMs,
    netSaveData: net.saveData,
    netType: net.type,
    socketId: socket?.id ?? null,
    socketConnected: socket?.connected ?? null,
    socketTransport: socket?.transport ?? null,
    socketActive: socket?.active ?? null,
    socketRecovered: socket?.recovered ?? null,
    socketEngineReadyState: socket?.engineReadyState ?? null,
    bgSystemSuspend: isLikelySystemMediaSuspend(),
    ignoreBgRoomPause: shouldIgnoreBackgroundRoomPause(),
    bgKeepaliveActive: keepalive.active,
    bgWebLockHeld: keepalive.webLockHeld,
    bgWorkerAlive: keepalive.workerAlive,
    bgWakeLockHeld: keepalive.wakeLockHeld,
  };
}

function collectRoomFields(): Record<string, DebugScalar> {
  const {
    room,
    nickname,
    mySocketId,
    myConnectionId,
    isOwner,
    isAdmin,
    canControlPlayback,
    isPlaybackLeader,
    isReconnecting,
    exitReason,
    avatar_url,
  } = useRoomStore.getState();

  return {
    roomId: room?.id ?? null,
    roomName: room?.name ?? null,
    nickname: nickname || null,
    mySocketId: mySocketId || null,
    myConnectionId: myConnectionId || null,
    isOwner: isOwner ?? null,
    isAdmin,
    canControlPlayback,
    isPlaybackLeader,
    isReconnecting,
    exitReason: exitReason || null,
    avatar_url: avatar_url || null,
    isPlaying: room?.isPlaying ?? null,
    roomCurrentTime: fmtNum(room?.currentTime),
    users: room?.users?.length ?? 0,
    queueLen: room?.queue?.length ?? 0,
    songHistoryLen: useSongHistoryStore.getState().songs.length,
    roomSongHistoryLen: room?.songHistory?.length ?? 0,
    chatMsgs: useChatStore.getState().messages.length,
    randomLoading: room?.randomLoading ?? null,
    muteAll: room?.muteAll ?? null,
    playMode: room?.playMode ?? null,
    neteaseFmMode: room?.neteaseFmMode ?? null,
    visualMode: readRoomVisualMode(),
    visualProxySong: shouldProxySongPlaybackUrl(),
  };
}

function collectTrackFields(
  current: QueueItem | null | undefined,
  audioStore: ReturnType<typeof useAudioStore.getState>,
): Record<string, DebugScalar> {
  if (!current) {
    return { track: null };
  }
  const trackKey = getTrackKey(current);
  return {
    trackQueueId: current.queueId,
    trackId: current.id,
    trackSource: current.source,
    trackName: current.name,
    trackArtist: current.artist ?? null,
    trackAlbum: current.album ?? null,
    trackDuration: current.duration ?? null,
    trackKey,
    trackPic: current.pic ? shortSrc(current.pic) : null,
    trackUrl: current.url ? shortSrc(current.url) : null,
    trackSourceError: isTrackSourceError(current),
    trackCrossSource: isTrackCrossSource(current),
    trackCrossSourceFrom: getTrackCrossSourceFrom(current) ?? null,
    trackActualQuality: audioStore.actualQualityByTrack[trackKey] ?? null,
    lrcDurationMs: audioStore.lrcDurationMs,
    lrcTrackKey: audioStore.lrcTrackKey,
    mediaDurationMs: audioStore.mediaDurationMs,
    mediaTrackKey: audioStore.mediaTrackKey,
    durationMismatchMs: (
      Number.isFinite(audioStore.lrcDurationMs)
      && Number.isFinite(audioStore.mediaDurationMs)
      && audioStore.lrcDurationMs != null
      && audioStore.mediaDurationMs != null
    )
      ? Math.round(audioStore.lrcDurationMs - audioStore.mediaDurationMs)
      : null,
  };
}

function collectAudioFields(
  audio: HTMLAudioElement,
  audioStore: ReturnType<typeof useAudioStore.getState>,
  current: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'> | null | undefined,
): { element: Record<string, DebugScalar>; media: Record<string, DebugScalar> } {
  const src = audio.currentSrc || audio.src || '';
  const boundQueueId = getAudioBoundQueueId(audio);
  const upstream = src
    ? (isProxiedMediaUrl(src) ? unwrapProxiedMediaUrl(src) : src)
    : '';

  return {
    element: {
      audioBound: boundQueueId || null,
      audioBindMatch: current ? boundQueueId === current.queueId : null,
      audioCanSync: current ? canSyncAudioForQueue(audio, current.queueId) : null,
      audioTime: fmtNum(audio.currentTime),
      audioDuration: fmtNum(audio.duration),
      audioPaused: audio.paused,
      audioEnded: audio.ended,
      audioSeeking: audio.seeking,
      audioReadyState: `${audio.readyState}:${readyStateLabel(audio.readyState)}`,
      audioNetworkState: `${audio.networkState}:${networkStateLabel(audio.networkState)}`,
      audioRate: fmtNum(audio.playbackRate),
      audioRateBias: fmtNum(getRateBias(), 4),
      audioMuted: audio.muted,
      audioVolume: fmtNum(audioStore.volume),
      audioElementVolume: fmtNum(audio.volume),
      audioBuffering: isAudioBuffering(audio),
      audioBufferedAhead: formatBufferedAhead(audio),
      audioSeekable: formatTimeRanges(audio.seekable, audio.currentTime),
      audioPlayed: formatTimeRanges(audio.played, 0),
      trackLoading: audioStore.trackLoading,
      needsUnlock: audioStore.needsAudioUnlock,
      smoothTime: fmtNum(audioStore.smoothPlaybackTime),
      playbackVersion: audioStore.playbackVersion,
      clientPlaybackVersion: getClientPlaybackVersion(),
      trackReloadNonce: audioStore.trackReloadNonce,
      hasSeekPlayback: Boolean(audioStore.seekPlayback),
      hasRetryPlayback: Boolean(audioStore.retryPlayback),
      hasLocalPlayback: Boolean(audioStore.localPlayback),
    },
    media: {
      audioSrc: shortSrc(src),
      audioSrcProxied: src ? isProxiedMediaUrl(src) : null,
      audioSrcSameOrigin: src ? isSameOriginMediaUrl(src) : null,
      audioSrcInsecureUpstream: upstream ? isInsecureRemoteMediaUrl(upstream) : null,
      audioUpstreamHost: upstreamHostOf(src),
      audioCrossOrigin: audio.crossOrigin || 'default',
      audioPreload: audio.preload,
      audioError: mediaErrorLabel(audio.error),
      audioErrorMessage: audio.error?.message || null,
      trackOriginalUrl: current?.url ? shortSrc(current.url) : null,
      visualMode: readRoomVisualMode(),
      visualProxySong: shouldProxySongPlaybackUrl(),
    },
  };
}

function collectSyncFields(
  audio: HTMLAudioElement,
): Record<string, DebugScalar> {
  const pb = getClientPlaybackState();
  if (!pb) {
    return {
      playback_state: null,
      syncState: getSyncState(),
      syncRecoveryCooldown: isInRecoveryCooldown(),
      syncForceCorrectionCooldown: isInForceCorrectionCooldown(),
      driftSampleTotal: getDriftHistogramTotal(),
      rateBias: fmtNum(getRateBias(), 4),
    };
  }

  const derived = getPlaybackTime(pb);
  const driftMs = audio.ended
    ? null
    : Math.round((derived - audio.currentTime) * 1000);
  const timing = getPlaybackSnapshotTiming();
  const serverNowMs = Number(pb.serverNowMs);
  const receivedAt = timing?.receivedAt ?? pb.receivedAt;
  const committedAt = timing?.committedAt ?? pb.committedAt;
  const clockSkewAtReceiveMs = Number.isFinite(serverNowMs) && serverNowMs > 0 && receivedAt > 0
    ? Math.round(receivedAt - serverNowMs)
    : null;
  const clientAgeSinceCommitMs = committedAt > 0 ? Date.now() - committedAt : null;

  return {
    syncState: getSyncState(),
    syncRecoveryCooldown: isInRecoveryCooldown(),
    syncForceCorrectionCooldown: isInForceCorrectionCooldown(),
    pbVersion: pb.version,
    pbTrackId: pb.trackId,
    pbStatus: pb.status,
    pbPositionSec: fmtNum(pb.positionSec),
    pbDurationSec: fmtNum(pb.durationSec),
    pbDerivedSec: fmtNum(derived),
    pbDriftMs: audio.ended ? 'inf' : driftMs,
    pbStartedAt: pb.startedAt || 0,
    pbServerNowMs: pb.serverNowMs,
    pbReceivedAt: receivedAt,
    pbCommittedAt: committedAt,
    snapshotAgeMs: timing?.snapshotAgeMs ?? null,
    clockSkewAtReceiveMs,
    clientAgeSinceCommitMs,
    driftSampleTotal: getDriftHistogramTotal(),
    rateBias: fmtNum(getRateBias(), 4),
  };
}

function formatEventCounts(limit = 14): string {
  const counts = new Map<string, number>();
  for (const event of state.events) {
    counts.set(event.name, (counts.get(event.name) || 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => `${name}:${count}`);
  return top.length > 0 ? top.join(' ') : 'none';
}

function pushSection(lines: string[], title: string, fields: Record<string, DebugScalar>): void {
  lines.push(`[${title}]`);
  lines.push(debugLine(fields));
}

function formatSnapshotText(reason: string): string {
  const lines: string[] = [];
  const at = new Date().toISOString();
  lines.push(`--- openmusic debug ${reason} ${at} ---`);

  const socket = state.getSocket?.() ?? null;
  const { room } = useRoomStore.getState();
  const audio = getSharedAudio();
  const audioStore = useAudioStore.getState();
  const current = room?.current;
  const source = current?.source || null;
  const audioParts = collectAudioFields(audio, audioStore, current);

  pushSection(lines, 'env', collectEnvFields());
  pushSection(lines, 'device', collectDeviceFields());
  pushSection(lines, 'network', collectNetworkFields(socket));
  pushSection(lines, 'room', collectRoomFields());
  pushSection(lines, 'quality', qualityParts(source));
  pushSection(lines, 'track', collectTrackFields(current, audioStore));
  pushSection(lines, 'audio', audioParts.element);
  pushSection(lines, 'media', audioParts.media);
  pushSection(lines, 'sync', collectSyncFields(audio));
  lines.push(formatDriftHistogram());
  lines.push(`event_counts ${formatEventCounts()}`);

  const recent = state.events.slice(
    reason.startsWith('report') ? -ERROR_REPORT_EVENT_LIMIT : -16,
  );
  if (recent.length > 0) {
    lines.push('recent_events:');
    for (const event of recent) {
      lines.push(`  ${event.at} ${event.name} ${event.line}`.trimEnd());
    }
  }

  lines.push('--- end ---');
  return lines.join('\n');
}

/** 结构化快照（控制台 / 自动化用） */
export function getDebugSnapshotObject(reason = 'snapshot'): Record<string, unknown> {
  const socket = state.getSocket?.() ?? null;
  const { room } = useRoomStore.getState();
  const audio = getSharedAudio();
  const audioStore = useAudioStore.getState();
  const current = room?.current;
  const audioParts = collectAudioFields(audio, audioStore, current);

  return {
    reason,
    at: new Date().toISOString(),
    env: collectEnvFields(),
    device: collectDeviceFields(),
    network: collectNetworkFields(socket),
    room: collectRoomFields(),
    quality: qualityParts(current?.source || null),
    track: collectTrackFields(current, audioStore),
    audio: audioParts.element,
    media: audioParts.media,
    sync: collectSyncFields(audio),
    driftHistogramTotal: getDriftHistogramTotal(),
    eventCounts: formatEventCounts(30),
    recentEvents: state.events.slice(-40).map((event) => ({
      at: event.at,
      ts: event.ts,
      name: event.name,
      line: event.line,
    })),
  };
}

export type ErrorReportSnapshotSection = {
  id: string;
  title: string;
  content: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function getDebugSnapshot(): string {
  return formatSnapshotText('snapshot');
}

export function getDebugEvents(): DebugEvent[] {
  return state.events.slice();
}

export type ErrorReportType = 'error' | 'feedback';

function buildErrorReportMeta(): Record<string, DebugScalar> {
  const socket = state.getSocket?.() ?? null;
  const { room } = useRoomStore.getState();
  const audio = getSharedAudio();
  const audioStore = useAudioStore.getState();
  const current = room?.current;
  const audioParts = collectAudioFields(audio, audioStore, current);
  const quality = qualityParts(current?.source || null);
  const sync = collectSyncFields(audio);

  return {
    ...collectEnvFields(),
    ...collectDeviceFields(),
    ...collectNetworkFields(socket),
    ...collectRoomFields(),
    ...quality,
    ...collectTrackFields(current, audioStore),
    audioSrcProxied: audioParts.media.audioSrcProxied ?? null,
    audioUpstreamHost: audioParts.media.audioUpstreamHost ?? null,
    audioError: audioParts.media.audioError ?? null,
    audioPaused: audioParts.element.audioPaused ?? null,
    audioTime: audioParts.element.audioTime ?? null,
    audioDuration: audioParts.element.audioDuration ?? null,
    audioBuffering: audioParts.element.audioBuffering ?? null,
    trackLoading: audioStore.trackLoading,
    needsAudioUnlock: audioStore.needsAudioUnlock,
    syncState: sync.syncState ?? null,
    pbDriftMs: sync.pbDriftMs ?? null,
    pbDerivedSec: sync.pbDerivedSec ?? null,
    clockSkewAtReceiveMs: sync.clockSkewAtReceiveMs ?? null,
    driftSampleTotal: sync.driftSampleTotal ?? null,
    eventCount: state.events.length,
  };
}

/** 错误上报：连续采集多份完整 debug 快照 */
async function collectReportSnapshots(): Promise<ErrorReportSnapshotSection[]> {
  const snapshots: ErrorReportSnapshotSection[] = [];
  for (let i = 0; i < ERROR_REPORT_SNAPSHOT_COUNT; i += 1) {
    if (i > 0) {
      await sleep(ERROR_REPORT_SNAPSHOT_INTERVAL_MS);
    }
    snapshots.push({
      id: `snapshot-${i + 1}`,
      title: `快照 ${i + 1}`,
      content: formatSnapshotText(`report-${i + 1}`),
    });
  }
  return snapshots;
}

/** 错误上报用：快照 + 最近事件 + 基础环境信息 */
export async function collectErrorReportBundle(
  description = '',
  type: ErrorReportType = 'error',
): Promise<{
  type: ErrorReportType;
  description: string;
  snapshot: string;
  snapshots: ErrorReportSnapshotSection[];
  events: DebugEvent[];
  meta: Record<string, string | number | boolean | null>;
}> {
  const meta = buildErrorReportMeta();
  const normalizedMeta: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    normalizedMeta[key] = value === undefined ? null : value;
  }

  if (type === 'feedback') {
    return {
      type: 'feedback',
      description: String(description || '').trim().slice(0, 500),
      snapshot: '',
      snapshots: [],
      events: [],
      meta: normalizedMeta,
    };
  }
  const snapshots = await collectReportSnapshots();
  const snapshot = snapshots
    .map((section) => `=== ${section.title} ===\n${section.content}`)
    .join('\n\n')
    .slice(0, 96_000);
  return {
    type: 'error',
    description: String(description || '').trim().slice(0, 500),
    snapshot,
    snapshots,
    events: state.events.slice(-120),
    meta: normalizedMeta,
  };
}

function printSnapshot(reason = 'tick'): void {
  console.log(formatSnapshotText(reason));
}

function printDriftHistogram(): void {
  console.log(formatDriftHistogram());
}

function printSnapshotJson(reason = 'manual-json'): void {
  console.log(getDebugSnapshotObject(reason));
}

/** URL ?debug=1 或 ?om_debug=1 自动开启（并从地址栏移除参数） */
function consumeDebugUrlParam(): boolean {
  try {
    const params = new URLSearchParams(location.search);
    const enabled = params.get('debug') === '1' || params.get('om_debug') === '1';
    if (!enabled) return false;
    params.delete('debug');
    params.delete('om_debug');
    const query = params.toString();
    const next = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    history.replaceState(null, '', next);
    return true;
  } catch {
    return false;
  }
}

export function setDebugSocketProvider(provider: (() => SocketSnapshot | null) | null): void {
  state.getSocket = provider;
}

export function enableOpenMusicDebug(): void {
  if (state.enabled) {
    printSnapshot('already-on');
    return;
  }
  state.enabled = true;
  localStorage.setItem(DEBUG_FLAG_KEY, '1');
  printSnapshot('enabled');
  state.timer = window.setInterval(() => printSnapshot('tick'), DEBUG_INTERVAL_MS);
}

export function disableOpenMusicDebug(): void {
  state.enabled = false;
  localStorage.removeItem(DEBUG_FLAG_KEY);
  if (state.timer) window.clearInterval(state.timer);
  state.timer = 0;
  resetDriftHistogram();
  console.log('[openmusic:debug] disabled');
}

export function installOpenMusicDebug(): void {
  const target = window as unknown as {
    debug?: () => void;
    debugOff?: () => void;
    debugNow?: () => void;
    debugJson?: () => void;
    debugHist?: () => void;
    debugHistReset?: () => void;
    openMusicDebug?: {
      on: () => void;
      off: () => void;
      now: () => void;
      json: () => void;
      hist: () => void;
      histReset: () => void;
      snapshot: typeof getDebugSnapshot;
      snapshotObject: typeof getDebugSnapshotObject;
      event: typeof debugLog;
    };
  };

  target.debug = enableOpenMusicDebug;
  target.debugOff = disableOpenMusicDebug;
  target.debugNow = () => printSnapshot('manual');
  target.debugJson = () => printSnapshotJson('manual-json');
  target.debugHist = printDriftHistogram;
  target.debugHistReset = () => {
    resetDriftHistogram();
    console.log('[openmusic:debug] drift histogram reset');
  };
  target.openMusicDebug = {
    on: enableOpenMusicDebug,
    off: disableOpenMusicDebug,
    now: target.debugNow,
    json: target.debugJson,
    hist: target.debugHist,
    histReset: target.debugHistReset,
    snapshot: getDebugSnapshot,
    snapshotObject: getDebugSnapshotObject,
    event: debugLog,
  };

  window.addEventListener('visibilitychange', () => {
    debugLog('visibilitychange', debugLine({
      hidden: document.hidden,
      visibility: document.visibilityState,
      bgSystemSuspend: isLikelySystemMediaSuspend(),
      ignoreBgRoomPause: shouldIgnoreBackgroundRoomPause(),
    }));
  });
  window.addEventListener('online', () => {
    const net = readNetworkInformation();
    debugLog('online', debugLine({
      effectiveType: net.effectiveType,
      downlinkMbps: net.downlinkMbps,
      rttMs: net.rttMs,
    }));
  });
  window.addEventListener('offline', () => debugLog('offline'));
  window.addEventListener('error', (event) => {
    debugLog('window-error', debugLine({
      message: event.message,
      file: event.filename,
      line: event.lineno,
      col: event.colno,
    }));
  });
  window.addEventListener('unhandledrejection', (event) => {
    debugLog('unhandled-rejection', String(event.reason));
  });

  if (localStorage.getItem(DEBUG_FLAG_KEY) === '1' || consumeDebugUrlParam()) {
    enableOpenMusicDebug();
  }
}

export { resetDriftHistogram };
