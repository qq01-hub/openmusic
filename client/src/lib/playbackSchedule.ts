import type { PlaybackState } from '../types';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { getSharedAudio } from './audioElement';
import { getAudioBoundQueueId } from './audioTrackBinding';
import { debugLine, debugLog } from './debugTools';
import {
  applyPlaybackState,
  getClientPlaybackVersion,
  getPlaybackTime,
  playbackStateFromRoom,
  resetPlaybackStateCache,
} from './playbackState';
import type { RoomState } from '../types';

type PendingSnapshot = {
  state: PlaybackState;
  receivedAt: number;
};

let pendingSnapshot: PendingSnapshot | null = null;

function syncRoomPlaybackFromState(state: PlaybackState) {
  const { room } = useRoomStore.getState();
  if (!room || room.id !== state.roomId) return;
  if (!room.current || room.current.queueId !== state.trackId) return;

  const nextPlaying = state.status === 'playing';
  const nextTime = getPlaybackTime(state);
  // 纯进度漂移只原地同步 currentTime，避免 playback_state 产生新 room 引用触发整页重渲染
  if (room.isPlaying === nextPlaying) {
    room.currentTime = nextTime;
    return;
  }

  useRoomStore.getState().setRoom({
    ...room,
    currentTime: nextTime,
    isPlaying: nextPlaying,
  });
}

/** 用户已乐观暂停时，丢弃仍标记 playing 的过期 pending，避免缓冲完成后误续播 */
function shouldDropPendingAgainstOptimisticPause(state: PlaybackState): boolean {
  const room = useRoomStore.getState().room;
  if (!room || room.id !== state.roomId) return false;
  if (room.isPlaying) return false;
  if (state.status !== 'playing') return false;

  // 仅丢弃不新于本地已知版本的旧 playing 快照。暂停后房主再次播放
  // 会产生更高版本的服务端快照，不能因为本地仍是暂停态而误丢弃。
  return state.version <= getClientPlaybackVersion();
}

function isAudioReadyForSnapshot(trackId: string): boolean {
  const audio = getSharedAudio();
  if (!audio.src) return false;
  // HAVE_METADATA 即可 seek；与 waitForAudioMinimumReady 对齐，避免 load 完成后 flush 失败从 0 开播
  if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return false;
  const duration = audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const { room } = useRoomStore.getState();
  if (!room?.current || room.current.queueId !== trackId) return false;
  if (getAudioBoundQueueId(audio) !== trackId) return false;
  return true;
}

function queueSnapshot(state: PlaybackState, receivedAt: number): void {
  if (!pendingSnapshot || state.version >= pendingSnapshot.state.version) {
    pendingSnapshot = { state, receivedAt };
  }
}

function logPlaybackCommit(
  state: PlaybackState,
  receivedAt: number,
  committedAt: number,
  via: 'live' | 'flush_pending',
): void {
  const snapshotAgeMs = committedAt - receivedAt;
  const serverAgeMs = committedAt - (state.serverNowMs || state.updatedAt || committedAt);
  debugLog('playback_state_commit', debugLine({
    via,
    version: state.version,
    trackId: state.trackId,
    positionSec: Number(state.positionSec.toFixed(3)),
    snapshotAgeMs,
    serverAgeMs,
    receivedAt,
    committedAt,
    startedAt: state.startedAt || 0,
  }));
}

/** 立即应用（加入房间等初始同步） */
export function commitPlaybackState(
  state: PlaybackState,
  receivedAt = Date.now(),
): boolean {
  const committedAt = Date.now();
  if (!applyPlaybackState(state, { receivedAt, committedAt })) return false;
  useAudioStore.getState().setPlaybackVersion(state.version);
  syncRoomPlaybackFromState(state);
  return true;
}

/** 应用服务端播放状态；audio 未 ready 时先入队，避免 currentTime=0 跳秒 */
export function schedulePlaybackState(state: PlaybackState): void {
  const receivedAt = Date.now();
  if (shouldDropPendingAgainstOptimisticPause(state)) {
    debugLog('playback_state_drop_optimistic_pause', debugLine({
      version: state.version,
      trackId: state.trackId,
      positionSec: Number(state.positionSec.toFixed(3)),
      receivedAt,
    }));
    return;
  }
  if (!isAudioReadyForSnapshot(state.trackId)) {
    queueSnapshot(state, receivedAt);
    debugLog('playback_state_queued', debugLine({
      version: state.version,
      trackId: state.trackId,
      positionSec: Number(state.positionSec.toFixed(3)),
      receivedAt,
    }));
    return;
  }
  pendingSnapshot = null;
  const committedAt = Date.now();
  logPlaybackCommit(state, receivedAt, committedAt, 'live');
  commitPlaybackState(state, receivedAt);
}

/** audio ready 后刷入待处理的 snapshot */
export function flushPendingPlaybackSnapshot(): boolean {
  if (!pendingSnapshot) return false;
  const { state, receivedAt } = pendingSnapshot;
  if (shouldDropPendingAgainstOptimisticPause(state)) {
    pendingSnapshot = null;
    return false;
  }
  if (!isAudioReadyForSnapshot(state.trackId)) return false;
  pendingSnapshot = null;
  const committedAt = Date.now();
  logPlaybackCommit(state, receivedAt, committedAt, 'flush_pending');
  return commitPlaybackState(state, receivedAt);
}

export function hasPendingPlaybackSnapshot(): boolean {
  return pendingSnapshot !== null;
}

export function resetPlaybackScheduling(): void {
  pendingSnapshot = null;
}

export function seedPlaybackFromRoom(room: RoomState): void {
  if (!room.current) {
    resetPlaybackStateCache();
    resetPlaybackScheduling();
    useAudioStore.getState().setPlaybackVersion(0);
    return;
  }
  const state = playbackStateFromRoom(
    room.id,
    room.current.queueId,
    room.isPlaying,
    room.currentTime,
    0,
    room.current.duration ?? 0,
    room.playbackRate ?? 1,
  );
  schedulePlaybackState(state);
}
