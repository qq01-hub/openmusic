import type { PlaybackState } from '../types';

/** 客户端缓存：服务端快照 + 本地收/提交时间 */
export type ClientPlaybackState = PlaybackState & {
  /** 收到 playback_state（或入 pending 队列）时刻，Date.now() */
  receivedAt: number;
  /** apply 到客户端缓存时刻，Date.now() */
  committedAt: number;
  basePositionSec: number;
};

/** 同曲连续播放时，服务端时间轴跳变超过此值才视为远端 seek（房主拖进度 / 循环回 0） */
const SERVER_SEEK_DETECT_SEC = 0.75;

const clientState = {
  server: null as ClientPlaybackState | null,
  localVersion: 0,
  /** 最近一次成功 commit 是否为同曲远端 seek（含循环回 0） */
  lastCommitWasSeek: false,
};

function playbackRateOf(state: PlaybackState | null | undefined): number {
  const value = Number(state?.playbackRate);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function statePositionSeconds(state: PlaybackState): number {
  const position = Number(state.positionSec ?? state.currentTime ?? 0);
  return Number.isFinite(position) && position > 0 ? position : 0;
}

/** 仅用服务端时间戳推算快照时刻进度，避免 client/server 时钟偏差 */
function positionSecAtServerSnapshot(state: PlaybackState): number {
  const base = statePositionSeconds(state);
  const startedAt = Number(state.startedAt);
  const serverNowMs = Number(state.serverNowMs);
  if (Number.isFinite(startedAt) && startedAt > 0 && Number.isFinite(serverNowMs) && serverNowMs > 0) {
    const rate = playbackRateOf(state);
    return Math.max(0, ((serverNowMs - startedAt) / 1000) * rate);
  }
  if (Number.isFinite(serverNowMs) && serverNowMs > 0) {
    return base;
  }
  return base;
}

function deriveBasePositionSec(
  state: PlaybackState,
  receivedAt: number,
  committedAt: number,
): number {
  if (state.status !== 'playing') {
    return statePositionSeconds(state);
  }
  const atReceive = positionSecAtServerSnapshot(state);
  const queueDelaySec = Math.max(0, (committedAt - receivedAt) / 1000);
  return Math.max(0, atReceive + queueDelaySec * playbackRateOf(state));
}

/**
 * 判断新快照是否相对上一快照发生了真实远端 seek（含单曲循环回 0）。
 * 标签页冻结后迟到的连续播放快照不应命中此处。
 */
function isServerTimelineSeek(
  prev: ClientPlaybackState,
  next: PlaybackState,
): boolean {
  if (prev.trackId !== next.trackId) return true;
  if (prev.status !== 'playing' || next.status !== 'playing') return false;

  const prevSnap = positionSecAtServerSnapshot(prev);
  const nextSnap = positionSecAtServerSnapshot(next);
  const prevServerNow = Number(prev.serverNowMs);
  const nextServerNow = Number(next.serverNowMs);
  const serverElapsedSec = Number.isFinite(prevServerNow) && prevServerNow > 0
    && Number.isFinite(nextServerNow) && nextServerNow > 0
    ? (nextServerNow - prevServerNow) / 1000
    : Number.NaN;

  if (Number.isFinite(serverElapsedSec)) {
    const expectedSnap = prevSnap + Math.max(0, serverElapsedSec) * playbackRateOf(prev);
    return Math.abs(nextSnap - expectedSnap) > SERVER_SEEK_DETECT_SEC;
  }

  return Math.abs(nextSnap - prevSnap) > SERVER_SEEK_DETECT_SEC;
}

/**
 * 同曲 playing→playing：禁止迟到快照把本机外推时钟往回拨。
 * 真实远端 seek（房主拖进度 / 单曲循环）仍允许跳变。
 */
function clampMonotonicPlayingBase(
  prev: ClientPlaybackState | null,
  state: PlaybackState,
  basePositionSec: number,
  committedAt: number,
): number {
  if (
    !prev
    || prev.trackId !== state.trackId
    || prev.status !== 'playing'
    || state.status !== 'playing'
  ) {
    return basePositionSec;
  }

  const continuousSec = Math.max(
    0,
    prev.basePositionSec + ((committedAt - prev.committedAt) / 1000) * playbackRateOf(prev),
  );
  if (basePositionSec >= continuousSec - 0.05) return basePositionSec;
  if (isServerTimelineSeek(prev, state)) return basePositionSec;
  return continuousSec;
}

/** 最近一次 playback_state commit 是否为远端 seek（房主拖进度等） */
export function wasLastPlaybackCommitASeek(): boolean {
  return clientState.lastCommitWasSeek;
}

/** 新曲媒体就绪时，只采用同一队列项的服务端时间轴；不同曲目则使用初始回退位置。 */
export function resolveInitialTrackSyncTime(trackId: string, fallbackTime = 0): number {
  const fallback = Number(fallbackTime);
  const safeFallback = Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
  const state = clientState.server;
  if (!state || (state.trackId && state.trackId !== trackId)) return safeFallback;
  return Math.max(0, getPlaybackTime(state));
}

/**
 * 播放进度：在 commit 时用服务端自洽时间戳定锚，之后仅用本机单调时钟外推。
 * 禁止 Date.now() - startedAt（client/server 时钟不一致时会跳秒，日志里常见 ~45s 固定偏差）。
 */
export function getPlaybackTime(state: PlaybackState | null | undefined): number {
  if (!state) return 0;
  if (state.status !== 'playing') {
    return statePositionSeconds(state);
  }
  const cached = state as Partial<ClientPlaybackState>;
  const base = cached.basePositionSec ?? statePositionSeconds(state);
  const anchor = cached.committedAt ?? cached.receivedAt ?? 0;
  if (anchor > 0) {
    return Math.max(0, base + ((Date.now() - anchor) / 1000) * playbackRateOf(state));
  }
  return positionSecAtServerSnapshot(state);
}

export function getClientPlaybackState(): ClientPlaybackState | null {
  return clientState.server;
}

export function getClientPlaybackVersion(): number {
  return clientState.localVersion;
}

export function getPlaybackSnapshotTiming(): {
  receivedAt: number;
  committedAt: number;
  snapshotAgeMs: number;
} | null {
  const s = clientState.server;
  if (!s) return null;
  return {
    receivedAt: s.receivedAt,
    committedAt: s.committedAt,
    snapshotAgeMs: Math.max(0, s.committedAt - s.receivedAt),
  };
}

export type ApplyPlaybackTiming = {
  receivedAt: number;
  committedAt?: number;
};

export function applyPlaybackState(
  state: PlaybackState,
  timing?: ApplyPlaybackTiming,
): boolean {
  if (state.version < clientState.localVersion) return false;
  const committedAt = timing?.committedAt ?? Date.now();
  const receivedAt = timing?.receivedAt ?? committedAt;
  const prev = clientState.server;
  const rawBase = deriveBasePositionSec(state, receivedAt, committedAt);
  const seekCommit = Boolean(
    prev
    && prev.trackId === state.trackId
    && isServerTimelineSeek(prev, state),
  );
  const basePositionSec = clampMonotonicPlayingBase(prev, state, rawBase, committedAt);
  clientState.server = {
    ...state,
    positionSec: statePositionSeconds(state),
    basePositionSec,
    receivedAt,
    committedAt,
  };
  clientState.localVersion = state.version;
  clientState.lastCommitWasSeek = seekCommit;
  return true;
}

export function resetPlaybackStateCache(): void {
  clientState.server = null;
  clientState.localVersion = 0;
  clientState.lastCommitWasSeek = false;
}

export function optimisticSeekPosition(
  roomId: string,
  trackId: string,
  positionSec: number,
  isPlaying: boolean,
): PlaybackState {
  const version = clientState.localVersion;
  const now = Date.now();
  const state = playbackStateFromRoom(roomId, trackId, isPlaying, positionSec, version);
  applyPlaybackState(state, { receivedAt: now, committedAt: now });
  return state;
}

/** 本地点暂停/播放：立刻改缓存状态，避免 forceCorrection 仍按 playing 把音频拉起来 */
export function optimisticSetPlaying(
  roomId: string,
  trackId: string,
  isPlaying: boolean,
  positionSec: number,
): PlaybackState {
  const version = clientState.localVersion;
  const now = Date.now();
  const pos = Math.max(0, Number(positionSec) || 0);
  const state = playbackStateFromRoom(roomId, trackId, isPlaying, pos, version);
  applyPlaybackState(state, { receivedAt: now, committedAt: now });
  return state;
}

export function playbackStateFromRoom(
  roomId: string,
  trackId: string,
  isPlaying: boolean,
  currentTime: number,
  version = 0,
  durationMs = 0,
  playbackRate = 1,
): PlaybackState {
  const now = Date.now();
  const positionSec = Math.max(0, Number(currentTime) || 0);
  const durationSec = Number(durationMs) > 0 ? Number(durationMs) / 1000 : 0;
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return {
    roomId,
    playbackRate: rate,
    version,
    trackId,
    status: isPlaying ? 'playing' : 'paused',
    positionSec,
    durationSec: durationSec > 0 ? durationSec : undefined,
    serverNowMs: now,
    startedAt: isPlaying ? now - (positionSec / rate) * 1000 : 0,
    currentTime: positionSec,
    updatedAt: now,
  };
}
