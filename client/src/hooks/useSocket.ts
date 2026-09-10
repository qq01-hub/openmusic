import { useEffect, useRef, useCallback } from 'react';

import { io, Socket } from 'socket.io-client';

import { useRoomStore } from '../stores/roomStore';
import { useChatStore } from '../stores/chatStore';
import { useChatSystemToastStore } from '../stores/chatSystemToastStore';
import { useSongHistoryStore } from '../stores/songHistoryStore';
import { useAudioStore } from '../stores/audioStore';
import { songKey } from '../api/music';

import type { ChatMention, ChatReplyRef, ChatMessage, FavoriteSong, PlaybackMediaShare, PlaybackState, RoomAiConfig, RoomState, Song, SongHistoryItem } from '../types';
import { sanitizeIncomingChatMessage } from '../lib/chatAi';

import { stopSharedAudio } from '../lib/audioElement';
import { resetDriftController } from '../lib/driftController';
import { resetPhaseSync } from '../lib/playbackSync';
import { resetSyncStateMachine } from '../lib/syncStateMachine';
import {
  applySharedPlaybackMedia,
  applySharedPlaybackMediaFromState,
  prefetchUpcomingFromRoom,
} from '../lib/songPreloadCache';
import { stripApiSignParams } from '../lib/signedApiUrl';
import { resetPlaybackStateCache } from '../lib/playbackState';
import {
  schedulePlaybackState,
  seedPlaybackFromRoom,
  resetPlaybackScheduling,
} from '../lib/playbackSchedule';
import { rememberClientIdentity } from '../lib/clientId';
import { requireSessionBootstrap, resetSessionBootstrap } from '../lib/sessionBootstrap';
import { mergeRoomState } from '../lib/mergeRoomState';
import { debugLine, debugLog, resetDriftHistogram, setDebugSocketProvider } from '../lib/debugTools';
import { bindReportTrackDurationSocket } from '../lib/reportTrackDuration';
import {
  getClientNetworkInfo,
  type ClientNetworkInfo,
} from '../lib/clientNetworkInfo';
import {
  cacheOwnerRoomConfigFromRoom,
  consumePendingRoomConfigApply,
  readCachedOwnerRoomConfig,
} from '../lib/roomConfigCache';



let socket: Socket | null = null;
let socketListenersAttached = false;
let socketConnectRequested = false;

const SOCKET_ACK_TIMEOUT_MS = 8000;
// Socket.IO 最长重连退避为 8 秒；首次进房还需要给下一次握手留出余量，
// 否则正好落在退避窗口内时会被误判为网络超时。
const SOCKET_CONNECT_TIMEOUT_MS = 15_000;
const SOCKET_IMAGE_ACK_TIMEOUT_MS = 20000;
/** 扫码走 Meting 上游，创建/校验/绑定可能较慢 */
const SOCKET_MUSIC_ACCOUNT_ACK_TIMEOUT_MS = 50000;

type JoinSession = {
  roomId: string;
  nickname: string;
  password?: string;
  readOnly?: boolean;
  networkInfo?: ClientNetworkInfo;
};

let lastJoinSession: JoinSession | null = null;
let lastTvJoinSession: JoinSession | null = null;
let activeJoinMode: 'normal' | 'tv' | null = null;
let rejoinInFlight = false;
let joinGeneration = 0;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
/** 断线后短暂保留旧成员列表，避免服务重启时「全员消失再逐个回来」 */
let usersStabilizeUntil = 0;
const USERS_STABILIZE_MS = 18_000;

function getSocket(): Socket {

  if (!socket) {

    socket = io({

      transports: ['websocket', 'polling'],

      tryAllTransports: true,

      autoConnect: false,

      withCredentials: true,

      auth: { presenceUpdates: true },

      reconnection: true,

      reconnectionAttempts: Infinity,

      reconnectionDelay: 1000,

      reconnectionDelayMax: 8000,

    });

  }

  return socket;

}

function waitForSocketConnect(s: Socket, timeoutMs = SOCKET_CONNECT_TIMEOUT_MS): Promise<void> {
  if (s.connected) return Promise.resolve();
  try {
    // 若曾因全站封禁关掉自动重连，正常进房时重新打开
    s.io.reconnection(true);
  } catch {
    // ignore
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      s.off('connect', onConnect);
      s.off('connect_error', onConnectError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const timer = window.setTimeout(() => {
      finish(new Error('连接超时，请检查网络'));
    }, timeoutMs);
    const onConnect = () => {
      finish();
    };
    const onConnectError = (error: Error) => {
      const message = String(error?.message || '').trim();
      finish(new Error(message || '无法连接到服务器，请检查网络或服务状态'));
    };
    s.once('connect', onConnect);
    s.once('connect_error', onConnectError);
    if (!s.active) s.connect();
  });
}

/** 确保会话已 bootstrap，并在需要时建立 socket 连接（不无故重连） */
async function ensureSocketReady(forceBootstrap = false): Promise<Socket> {
  await requireSessionBootstrap(forceBootstrap);
  const s = getSocket();
  if (s.connected) return s;
  socketConnectRequested = true;
  await waitForSocketConnect(s);
  return s;
}

/** 仅在会话失效时重建 socket，确保握手携带 Cookie */
async function reconnectSocketSession(forceBootstrap = false): Promise<Socket> {
  await requireSessionBootstrap(forceBootstrap);
  const s = getSocket();
  if (s.connected || s.active) {
    // 不等待 disconnect 事件：当底层握手已失败或正处于重连退避时，事件不一定会再
    // 到达，等待它会把这个 Socket 永久卡住，直到浏览器整页刷新。
    s.disconnect();
  }
  socketConnectRequested = true;
  await waitForSocketConnect(s);
  return s;
}

/** 应用启动后预热 socket，缩短首次进房等待 */
export async function warmUpSocketSession(): Promise<void> {
  try {
    await ensureSocketReady(false);
  } catch {
    // 首次预热失败不影响后续进房重试
  }
}

bindReportTrackDurationSocket(getSocket);

export interface ErrorReportSolutionNoticePayload {
  id: string;
  description: string;
  solution: string;
  resolvedAt?: number | null;
}

/** 订阅管理员下发的问题上报解决方案（在线推送 / 进房补推） */
export function subscribeErrorReportSolution(
  handler: (notice: ErrorReportSolutionNoticePayload) => void,
): () => void {
  const s = getSocket();
  s.on('error_report_solution', handler);
  return () => {
    s.off('error_report_solution', handler);
  };
}

export interface PermanentDecisionNoticePayload {
  id: string;
  roomId: string;
  roomName: string;
  approved: boolean;
  reason?: string;
  at?: number;
}

/** 订阅常驻申请审核结果 */
export function subscribePermanentDecision(
  handler: (notice: PermanentDecisionNoticePayload) => void,
): () => void {
  const s = getSocket();
  s.on('room_permanent_decision', handler);
  return () => {
    s.off('room_permanent_decision', handler);
  };
}


function emitWithAck<TResponse>(
  event: string,
  payload: unknown,
  fallback: TResponse,
  timeoutMs = SOCKET_ACK_TIMEOUT_MS,
): Promise<TResponse> {
  return new Promise((resolve) => {
    getSocket().timeout(timeoutMs).emit(
      event,
      payload,
      (err: Error | null, res: TResponse | undefined) => {
        resolve(err || !res ? fallback : res);
      },
    );
  });
}

function joinPayload(session: JoinSession, options: { rejoin?: boolean } = {}) {
  return {
    roomId: session.roomId,
    nickname: session.nickname,
    password: session.password?.trim() || undefined,
    readOnly: Boolean(session.readOnly),
    rejoin: Boolean(options.rejoin),
    clientIp: session.networkInfo?.ip,
    clientLocation: session.networkInfo?.location,
  };
}

type JoinAckResponse = {
  success: boolean;
  error?: string;
  needsPassword?: boolean;
  room?: RoomState;
  messages?: ChatMessage[];
  chatHasMore?: boolean;
  playbackState?: PlaybackState;
  roomAi?: RoomAiConfig;
  socketId?: string;
  connectionId?: string;
  clientId?: string;
  clientToken?: string;
  needsSession?: boolean;
  nickname?: string;
};

type RoomConfigApplyResponse = {
  success: boolean;
  error?: string;
  room?: RoomState;
};

function cacheCurrentOwnerRoomConfig(
  room: RoomState | null | undefined,
  options: { force?: boolean } = {},
) {
  cacheOwnerRoomConfigFromRoom(room, useRoomStore.getState().mySocketId, options);
}

async function applyCachedOwnerRoomConfigAfterJoin(room: RoomState, socketId?: string) {
  if (!socketId || room.creatorId !== socketId) return;
  if (!consumePendingRoomConfigApply(room.id)) return;

  const cached = readCachedOwnerRoomConfig();
  if (!cached) return;

  const config = cached.settings;
  let latestRoom: RoomState | null = null;

  const applySetting = async (event: string, payload: unknown) => {
    const res = await emitWithAck<RoomConfigApplyResponse>(
      event,
      payload,
      { success: false, error: '连接超时，请重试' },
    );
    if (!res.success || !res.room) return;
    latestRoom = res.room;
    applyRoomSnapshot(res.room);
  };

  if (config.fmMode) {
    await applySetting('set_room_fm_mode', { mode: config.fmMode, source: config.fmSource });
  }

  await applySetting('set_room_chat_history', { enabled: config.chatHistoryVisibleOnJoin });
  await applySetting('set_room_chat_avatars', { enabled: config.chatShowAvatars });

  if (config.maxAdmins !== undefined) {
    await applySetting('set_room_max_admins', { maxAdmins: config.maxAdmins });
  }
  await applySetting('set_room_song_request', {
    enabled: config.songRequestEnabled,
    minStaySec: config.songRequestMinStaySec,
    maxPerUser: config.songRequestMaxPerUser,
    cooldownSec: config.songRequestCooldownSec,
    queueMaxLength: config.queueMaxLength,
    memberJumpEnabled: config.memberJumpEnabled,
    memberSeekEnabled: config.memberSeekEnabled,
    memberPauseEnabled: config.memberPauseEnabled,
    systemMediaPlayBound: config.systemMediaPlayBound,
    systemMediaSkipBound: config.systemMediaSkipBound,
    dislikeSkipMode: config.dislikeSkipMode,
    dislikeSkipThreshold: config.dislikeSkipThreshold,
    dislikeSkipPercent: config.dislikeSkipPercent,
    clearSongsOnLeaveEnabled: config.clearSongsOnLeaveEnabled,
    clearSongsOnLeaveDelaySec: config.clearSongsOnLeaveDelaySec,
  });

  cacheCurrentOwnerRoomConfig(latestRoom || useRoomStore.getState().room || room, { force: true });
}

function applyJoinResponse(session: JoinSession, res: JoinAckResponse) {
  if (!res.success || !res.room) return;

  const room = res.roomAi ? { ...res.room, roomAi: res.roomAi } : res.room;

  // 先写入身份，再应用房间快照（角色只从 room 字段推导，不读 ACK 特权布尔）
  if (res.socketId) {
    const connectionId = res.connectionId || getSocket().id || null;
    useRoomStore.getState().setConnectionInfo(res.socketId, connectionId);
  }

  applyRoomSnapshot(room, true);
  applyJoinSnapshot(room, res.playbackState);
  applyJoinExtras(room, { messages: res.messages, chatHasMore: res.chatHasMore });

  // 进房优先注入房间已分享的当前曲链接，再预取（命中缓存则免打上游）
  if (res.playbackState) {
    applySharedPlaybackMediaFromState(room, res.playbackState);
  }

  const isTvSession = Boolean(session.readOnly);
  if (isTvSession) {
    activeJoinMode = 'tv';
    lastTvJoinSession = session;
  } else {
    activeJoinMode = 'normal';
    lastJoinSession = session;
    lastTvJoinSession = null;
    rememberClientIdentity(res.socketId);
  }

  const resolvedNickname = res.nickname?.trim()
    || room.users.find((user) => user.id === res.socketId)?.nickname?.trim();
  if (!isTvSession && resolvedNickname) {
    useRoomStore.getState().setNickname(resolvedNickname);
    lastJoinSession = { ...session, nickname: resolvedNickname };
  }

  if (room.current || room.nextRandom || (room.queue?.length ?? 0) > 0) {
    prefetchUpcomingFromRoom(room);
  }

  clearReconnectSchedule();
  reconnectAttempt = 0;
  useRoomStore.getState().setReconnecting(false);
}

function applyRoomSnapshot(room: RoomState, force = false) {
  const current = useRoomStore.getState().room;
  let merged = force ? room : mergeRoomState(room, current);

  // 部署/断线重连窗口内：成员只增不减，避免服务端空表覆盖导致「全员消失」
  if (
    current
    && current.id === merged.id
    && Date.now() < usersStabilizeUntil
    && Array.isArray(current.users)
    && Array.isArray(merged.users)
    && merged.users.length < current.users.length
  ) {
    const byId = new Map(current.users.map((user) => [user.id, user]));
    for (const user of merged.users) byId.set(user.id, user);
    const users = Array.from(byId.values());
    merged = {
      ...merged,
      users,
      userCount: Math.max(Number(merged.userCount) || 0, users.length),
    };
  }

  useRoomStore.getState().setRoom(merged);
  useRoomStore.getState().syncRolesFromRoom(merged);

  // 房主开启「进房可看历史」后，放开本地聊天截断，允许上滑拉取更早消息
  if (
    merged.chatHistoryVisibleOnJoin
    && useChatStore.getState().roomId === merged.id
  ) {
    useChatStore.getState().unlockChatHistory();
  }
}

function applyJoinSnapshot(room: RoomState, playbackState?: PlaybackState) {
  if (playbackState) {
    schedulePlaybackState(playbackState);
  } else {
    seedPlaybackFromRoom(room);
  }
}

function applyJoinChat(room: RoomState, messages?: ChatMessage[], chatHasMore?: boolean) {
  useChatSystemToastStore.getState().clear();
  useChatStore.getState().reset(
    room.id,
    messages || [],
    Boolean(chatHasMore),
    room.chatVisibleSince ?? null,
  );
}

function prefetchSongHistory(roomId: string) {
  void emitWithAck<{ success: boolean; songs?: SongHistoryItem[] }>(
    'load_song_history',
    { limit: 150 },
    { success: false },
  ).then((res) => {
    if (useRoomStore.getState().room?.id !== roomId) return;
    if (res.success && res.songs) {
      useSongHistoryStore.getState().setSongs(roomId, res.songs);
    }
  });
}

function applyJoinExtras(
  room: RoomState,
  extras: { messages?: ChatMessage[]; chatHasMore?: boolean },
) {
  applyJoinChat(room, extras.messages, extras.chatHasMore);
  prefetchSongHistory(room.id);
}

function getActiveJoinSession(): JoinSession | null {
  if (activeJoinMode === 'tv' && lastTvJoinSession) return lastTvJoinSession;
  if (lastJoinSession) return lastJoinSession;

  const room = useRoomStore.getState().room;
  const nickname = useRoomStore.getState().nickname.trim();
  if (room && nickname) {
    return { roomId: room.id, nickname };
  }
  return null;
}

function shouldMaintainRoomSession(): boolean {
  return Boolean(getActiveJoinSession() && useRoomStore.getState().room);
}

function clearReconnectSchedule() {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function isPermanentRejoinError(error?: string): boolean {
  const message = String(error || '').trim();
  if (!message) return false;
  return (
    message.includes('房间不存在')
    || message.includes('无法再次进入')
    || message.includes('密码')
    || message.includes('禁止')
  );
}

function scheduleRoomRejoin(trigger: string) {
  if (!shouldMaintainRoomSession()) return;
  if (reconnectTimer != null) return;

  const jitter = Math.floor(Math.random() * 600);
  const delay = Math.min(800 + reconnectAttempt * 500, 8000) + jitter;
  reconnectAttempt += 1;
  useRoomStore.getState().setReconnecting(true);
  debugLog('room_rejoin_scheduled', debugLine({ trigger, delay, attempt: reconnectAttempt }));

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void attemptRoomRejoin(trigger);
  }, delay);
}

function emitJoinRoom(s: Socket, session: JoinSession): Promise<JoinAckResponse> {
  return new Promise((resolve) => {
    s.timeout(SOCKET_ACK_TIMEOUT_MS).emit(
      'join_room',
      joinPayload(session, { rejoin: true }),
      (err: Error | null, res: JoinAckResponse | undefined) => {
        if (err || !res) {
          resolve({ success: false, error: err?.message || '加入房间失败' });
          return;
        }
        resolve(res);
      },
    );
  });
}

async function attemptRoomRejoin(trigger: string) {
  const session = getActiveJoinSession();
  const currentRoom = useRoomStore.getState().room;
  if (!session || !currentRoom) {
    useRoomStore.getState().setReconnecting(false);
    return;
  }
  if (rejoinInFlight) return;

  rejoinInFlight = true;
  useRoomStore.getState().setReconnecting(true);
  debugLog('room_rejoin_attempt', debugLine({ trigger, roomId: session.roomId, attempt: reconnectAttempt }));

  try {
    resetSessionBootstrap();
    await requireSessionBootstrap(true);

    let s = getSocket();
    if (!s.connected) {
      socketConnectRequested = true;
      if (!s.active) s.connect();
      await waitForSocketConnect(s);
    }

    let res = await emitJoinRoom(s, session);

    if (!res.success && res.needsSession && !session.readOnly) {
      s = await reconnectSocketSession(true);
      res = await emitJoinRoom(s, session);
    }

    if (res.success && res.room) {
      reconnectAttempt = 0;
      applyJoinResponse(session, res);
      useRoomStore.getState().setReconnecting(false);
      clearReconnectSchedule();
      // 重连后自动同步本地头像
      const localAvatar = localStorage.getItem('avatar_url') || '';
      if (localAvatar && !res.room.userAvatarUrls?.[res.socketId || '']) {
        emitWithAck('set_user_avatar', { avatar_url: localAvatar }, { success: false }).catch(() => { });
      }
      return;
    }

    if (isPermanentRejoinError(res.error)) {
      useRoomStore.getState().setReconnecting(false);
      clearReconnectSchedule();
      return;
    }

    scheduleRoomRejoin('join_failed');
  } catch (err) {
    debugLog('room_rejoin_error', debugLine({
      trigger,
      message: err instanceof Error ? err.message : String(err),
    }));
    scheduleRoomRejoin('error');
  } finally {
    rejoinInFlight = false;
  }
}

function handleSocketDisconnect(reason: string) {
  debugLog('socket_disconnect', debugLine({ reason }));
  const { mySocketId } = useRoomStore.getState();
  useRoomStore.getState().setConnectionInfo(mySocketId, null);

  if (!shouldMaintainRoomSession()) return;

  // 普通断线不等于会话失效；40+ 人同时 bootstrap + join 会打爆服务端
  usersStabilizeUntil = Date.now() + USERS_STABILIZE_MS;
  useRoomStore.getState().setReconnecting(true);

  if (reason === 'io server disconnect') {
    const s = getSocket();
    socketConnectRequested = true;
    s.connect();
  }
  // 依赖 Socket.IO 自动重连，成功后由 connect 事件触发 attemptRoomRejoin
}



export function useSocket() {

  const setConnectionInfo = useRoomStore((s) => s.setConnectionInfo);

  const resetSession = useRoomStore((s) => s.resetSession);

  const connected = useRef(false);



  useEffect(() => {

    const s = getSocket();

    setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
      active: s.active,
      recovered: s.recovered,
      engineReadyState: s.io.engine?.readyState,
    }));
    if (socketListenersAttached) return;
    socketListenersAttached = true;



    let prefetchDebounceTimer = 0;

    const onRoomUpdate = (room: RoomState) => {
      debugLog('room_update', debugLine({
        roomId: room.id,
        current: room.current?.queueId || null,
        isPlaying: room.isPlaying,
        currentTime: Number(room.currentTime.toFixed(3)),
        users: room.users?.length ?? 0,
        randomLoading: room.randomLoading,
      }));
      const { room: prevRoom } = useRoomStore.getState();

      if (prevRoom?.id === room.id && room.current) {
        const prevKey = prevRoom.current ? songKey(prevRoom.current) : null;
        const nextKey = songKey(room.current);
        if (prevKey !== nextKey) {
          const current = room.current;
          useSongHistoryStore.getState().appendSong(room.id, {
            id: current.id,
            source: current.source,
            name: current.name,
            artist: current.artist,
            album: current.album,
            pic: current.pic,
            duration: current.duration,
            requestedBy: current.requestedBy,
            requestedById: current.requestedById,
            requestedAt: Date.now(),
          });
        }
      }

      applyRoomSnapshot(room);

      window.clearTimeout(prefetchDebounceTimer);
      prefetchDebounceTimer = window.setTimeout(() => {
        const live = useRoomStore.getState().room;
        if (!live || live.id !== room.id) return;
        prefetchUpcomingFromRoom(live);
      }, 400);
    };

    const onPresenceUpdate = (presence: Partial<RoomState> & Pick<RoomState, 'id' | 'users' | 'userCount'>) => {
      const current = useRoomStore.getState().room;
      if (!current || current.id !== presence.id) return;
      debugLog('presence_update', debugLine({
        roomId: presence.id,
        users: presence.userCount,
        ownerId: presence.ownerId,
      }));
      applyRoomSnapshot({
        ...current,
        ...presence,
        users: presence.users,
        userCount: presence.userCount,
      });
    };

    const onPlaybackState = (state: PlaybackState) => {
      const live = useRoomStore.getState().room;
      if (live) applySharedPlaybackMediaFromState(live, state);
      schedulePlaybackState(state);
    };

    const onPlaybackMedia = (media: PlaybackMediaShare) => {
      const live = useRoomStore.getState().room;
      if (!live || live.id !== media.roomId) return;
      applySharedPlaybackMedia(live, media);
    };

    const onQueueSnapshot = (payload: { queue?: RoomState['queue']; current?: RoomState['current'] }) => {
      const current = useRoomStore.getState().room;
      if (!current) return;
      const nextQueue = Array.isArray(payload.queue) ? payload.queue : current.queue;
      const nextCurrent = payload.current === undefined ? current.current : payload.current;
      useRoomStore.getState().setRoom({
        ...current,
        queue: nextQueue,
        current: nextCurrent,
      });
    };

    const onChatMessage = (message: ChatMessage) => {
      if (message.kind === 'system') {
        useChatSystemToastStore.getState().show(message.text);
        return;
      }
      useChatStore.getState().append(sanitizeIncomingChatMessage(message));
    };

    const onRoomAiProcessing = (payload: {
      status?: 'queued' | 'start' | 'end' | 'error';
      requestId?: string;
      sourceMessageId?: string;
      userId?: string;
      nickname?: string;
      startedAt?: number;
      queuePosition?: number;
      pendingCount?: number;
      attempt?: number;
      maxAttempts?: number;
      error?: string;
    }) => {
      const requestId = String(payload.requestId || '').trim();
      if (!requestId) return;
      const store = useChatStore.getState();
      if (payload.status === 'queued' || payload.status === 'start' || payload.status === 'error') {
        const sourceMessageId = String(payload.sourceMessageId || '').trim();
        if (!sourceMessageId) return;
        store.startAiProcessing({
          requestId,
          sourceMessageId,
          userId: String(payload.userId || '').trim(),
          nickname: String(payload.nickname || '').trim(),
          startedAt: Number(payload.startedAt) || Date.now(),
          status: payload.status === 'error' ? 'error' : payload.status === 'queued' ? 'queued' : 'processing',
          queuePosition: Math.max(0, Number(payload.queuePosition) || 0),
          pendingCount: Math.max(0, Number(payload.pendingCount) || 0),
          attempt: Math.max(0, Number(payload.attempt) || 0),
          maxAttempts: Math.max(1, Number(payload.maxAttempts) || 3),
          error: String(payload.error || '').trim() || undefined,
        });
      } else if (payload.status === 'end') {
        store.endAiProcessing(requestId);
      }
    };

    const onChatMessageRecall = ({ messageId }: { messageId: string }) => {
      if (!messageId) return;
      useChatStore.getState().remove(messageId);
    };

    const onChatReactionUpdate = ({
      messageId,
      reactions,
    }: {
      messageId: string;
      reactions: ChatMessage['reactions'];
    }) => {
      useChatStore.getState().updateReactions(messageId, reactions);
    };

    const onKicked = ({ message, stopReconnect }: { message?: string; stopReconnect?: boolean }) => {
      joinGeneration += 1;
      lastJoinSession = null;
      lastTvJoinSession = null;
      activeJoinMode = null;
      clearReconnectSchedule();
      reconnectAttempt = 0;
      useChatStore.getState().clear();
      useChatSystemToastStore.getState().clear();
      useSongHistoryStore.getState().clear();
      stopSharedAudio();
      resetSyncStateMachine();
      resetPhaseSync();
      resetDriftController();
      resetPlaybackScheduling();
      resetDriftHistogram();
      resetPlaybackStateCache();
      useAudioStore.getState().setPlaybackVersion(0);
      useAudioStore.getState().setTrackLoading(false);
      useAudioStore.getState().setNeedsAudioUnlock(false);
      useAudioStore.getState().setSmoothPlaybackTime(0);
      resetSession();
      // 全站封禁等场景：彻底停掉自动重连，避免每 10 秒刷进房
      if (stopReconnect) {
        try {
          s.io.reconnection(false);
          if (s.connected) s.disconnect();
        } catch {
          // ignore
        }
        socketConnectRequested = false;
      }
      useRoomStore.getState().setExitReason(
        message || '你已被房主移出房间，无法再次进入',
      );
    };

    const onUserLocation = ({ userId, location }: { userId?: string; location?: string }) => {
      const nextLocation = String(location || '').trim();
      const targetUserId = String(userId || '').trim();
      if (!targetUserId || !nextLocation) return;
      const { room } = useRoomStore.getState();
      if (!room?.users?.length) return;
      let changed = false;
      const users = room.users.map((user) => {
        if (user.id !== targetUserId || user.location === nextLocation) return user;
        changed = true;
        return { ...user, location: nextLocation };
      });
      if (changed) useRoomStore.getState().setRoom({ ...room, users });
    };

    s.on('room_update', onRoomUpdate);

    const onRoomAiUpdate = (roomAi: RoomAiConfig) => {
      const { room } = useRoomStore.getState();
      if (!room || !roomAi) return;
      useRoomStore.getState().setRoom({
        ...room,
        roomAi,
        roomAiEnabled: roomAi.roomAiEnabled !== false,
        roomAiBotName: roomAi.roomAiBotName || '',
      });
    };
    s.on('room_ai_update', onRoomAiUpdate);

    s.on('presence_update', onPresenceUpdate);

    s.on('playback_state', onPlaybackState);

    s.on('playback_media', onPlaybackMedia);

    s.on('queue_snapshot', onQueueSnapshot);

    s.on('chat_message', onChatMessage);

    s.on('room_ai_processing', onRoomAiProcessing);

    s.on('chat_message_recall', onChatMessageRecall);

    s.on('chat_reaction_update', onChatReactionUpdate);

    s.on('user_location', onUserLocation);

    s.on('kicked', onKicked);

    s.on('connect', () => {
      debugLog('socket_connect', debugLine({
        id: s.id,
        transport: s.io.engine?.transport?.name,
      }));
      void attemptRoomRejoin('connect');
    });
    s.on('disconnect', handleSocketDisconnect);
    s.on('connect_error', (err) => {
      debugLog('socket_connect_error', debugLine({ message: err?.message }));
      const { mySocketId } = useRoomStore.getState();
      useRoomStore.getState().setConnectionInfo(mySocketId, null);
      if (shouldMaintainRoomSession()) {
        scheduleRoomRejoin('connect_error');
      }
    });

  }, [setConnectionInfo, resetSession]);



  const connect = useCallback(() => {

    const s = getSocket();

    setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
      active: s.active,
      recovered: s.recovered,
      engineReadyState: s.io.engine?.readyState,
    }));
    if (!connected.current && !socketConnectRequested) {

      s.connect();

      connected.current = true;
      socketConnectRequested = true;

    }

  }, []);



  const joinRoom = useCallback(

    (
      roomId: string,
      nickname: string,
      password?: string,
      options: { readOnly?: boolean } = {},
    ): Promise<{ success: boolean; error?: string; needsPassword?: boolean; room?: RoomState }> => {
      const session: JoinSession = {
        roomId,
        nickname,
        password,
        readOnly: Boolean(options.readOnly),
      };
      const generation = ++joinGeneration;

      const attemptJoin = () => emitWithAck<JoinAckResponse>(
        'join_room',
        joinPayload(session),
        { success: false, error: '连接超时，请检查网络' },
      );

      const runJoin = async () => {
        session.networkInfo = await getClientNetworkInfo();
        try {
          await ensureSocketReady(false);
        } catch {
          resetSessionBootstrap();
          try {
            await reconnectSocketSession(true);
          } catch (err) {
            const message = err instanceof Error ? err.message : '会话未就绪，请刷新页面后重试';
            return { success: false, error: message, needsSession: true };
          }
        }

        let res = await attemptJoin();
        if (!res.success && res.needsSession && !options.readOnly) {
          resetSessionBootstrap();
          try {
            await reconnectSocketSession(true);
          } catch (err) {
            const message = err instanceof Error ? err.message : '会话未就绪，请刷新页面后重试';
            return { success: false, error: message, needsSession: true };
          }
          res = await attemptJoin();
        }
        if (res.success && res.room) {
          if (generation !== joinGeneration) return res;
          applyJoinResponse(session, res);
          void applyCachedOwnerRoomConfigAfterJoin(res.room, res.socketId);
          // 加入后自动同步本地头像到服务器（非阻塞）
          const localAvatar = localStorage.getItem('avatar_url') || '';
          if (localAvatar && !res.room.userAvatarUrls?.[res.socketId || '']) {
            emitWithAck('set_user_avatar', { avatar_url: localAvatar }, { success: false }).catch(() => { });
          }
        }
        return res;
      };

      return runJoin();
    },

    [connect, setConnectionInfo],

  );



  const leaveRoom = useCallback((): Promise<void> => {
    joinGeneration += 1;
    lastJoinSession = null;
    lastTvJoinSession = null;
    activeJoinMode = null;
    clearReconnectSchedule();
    reconnectAttempt = 0;
    useRoomStore.getState().setReconnecting(false);
    useChatStore.getState().clear();
    useChatSystemToastStore.getState().clear();
    useSongHistoryStore.getState().clear();
    stopSharedAudio();
    resetSyncStateMachine();
    resetPhaseSync();
    resetDriftController();
    resetPlaybackScheduling();
    resetPlaybackStateCache();
    useAudioStore.getState().setPlaybackVersion(0);
    useAudioStore.getState().setTrackLoading(false);
    useAudioStore.getState().setNeedsAudioUnlock(false);
    useAudioStore.getState().setSmoothPlaybackTime(0);
    resetSession();

    const s = getSocket();
    setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
      active: s.active,
      recovered: s.recovered,
      engineReadyState: s.io.engine?.readyState,
    }));
    if (s.connected) {
      s.timeout(SOCKET_ACK_TIMEOUT_MS).emit('leave_room', {}, () => { });
    }
    return Promise.resolve();
  }, [resetSession]);



  const addSong = useCallback((song: Song): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('add_song', { song }, { success: false, error: '连接超时，请重试' });

  }, []);



  const skipSong = useCallback((options?: { reason?: 'manual' | 'source_error' | 'system' }): Promise<{ success: boolean; error?: string }> => {
    // source_error 需等服务端探测（上游可达 12s），ack 超时必须更长，否则客户端误判失败并卡锁
    const timeoutMs = options?.reason === 'source_error' ? 90000 : SOCKET_ACK_TIMEOUT_MS;
    return emitWithAck(
      'skip_song',
      { reason: options?.reason || 'manual' },
      { success: false, error: '连接超时，请重试' },
      timeoutMs,
    );
  }, []);

  const finishSong = useCallback((queueId: string): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('finish_song', { queueId }, { success: false, error: '连接超时，请重试' });
  }, []);

  /** 取链成功后上报当前曲媒体地址，供后续进房者免二次取链 */
  const reportPlaybackMedia = useCallback((payload: {
    trackId: string;
    url: string;
    qualityLabel?: string;
    crossSource?: boolean;
    crossSourceFrom?: string;
    loudness?: { gain?: number; peak?: number; lra?: number };
    duration?: number;
  }): void => {
    const url = stripApiSignParams(String(payload.url || '').trim());
    const trackId = String(payload.trackId || '').trim();
    if (!url || !trackId) return;
    void emitWithAck(
      'report_playback_media',
      {
        trackId,
        url,
        qualityLabel: payload.qualityLabel,
        crossSource: Boolean(payload.crossSource),
        crossSourceFrom: payload.crossSourceFrom,
        loudness: payload.loudness,
        duration: payload.duration,
      },
      { success: false },
    );
  }, []);

  const togglePlay = useCallback((isPlaying: boolean): Promise<boolean> => {
    return emitWithAck('toggle_play', { isPlaying }, { success: false }).then((res) => res.success);

  }, []);



  const seek = useCallback((time: number): Promise<boolean> => {
    return emitWithAck('seek', { time }, { success: false }).then((res) => res.success);

  }, []);



  const removeSong = useCallback((queueId: string): Promise<boolean> => {
    return emitWithAck('remove_song', { queueId }, { success: false }).then((res) => res.success);

  }, []);

  const clearQueue = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('clear_queue', {}, { success: false, error: '连接超时，请重试' });
  }, []);



  const requestJump = useCallback((queueId: string): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('request_jump', { queueId }, { success: false, error: '连接超时，请重试' });

  }, []);

  const reorderQueue = useCallback((orderedQueueIds: string[], movedQueueId: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'reorder_queue',
      { orderedQueueIds, movedQueueId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const toggleQueueLike = useCallback((queueId: string): Promise<{ success: boolean; liked?: boolean; error?: string }> => {
    return emitWithAck('toggle_queue_like', { queueId }, { success: false, error: '连接超时，请重试' });

  }, []);

  const toggleCurrentDislike = useCallback((): Promise<{
    success: boolean;
    disliked?: boolean;
    skipped?: boolean;
    dislikeCount?: number;
    threshold?: number;
    error?: string;
    room?: RoomState;
  }> => {
    return emitWithAck<{
      success: boolean;
      disliked?: boolean;
      skipped?: boolean;
      dislikeCount?: number;
      threshold?: number;
      error?: string;
      room?: RoomState;
    }>(
      'toggle_current_dislike',
      {},
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);



  const approveJump = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('approve_jump', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const rejectJump = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('reject_jump', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const requestSkip = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('request_skip', {}, { success: false, error: '连接超时，请重试' });

  }, []);



  const approveSkip = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('approve_skip', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const rejectSkip = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('reject_skip', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const sendChat = useCallback((
    text: string,
    options: {
      mentions?: ChatMention[];
      replyTo?: ChatReplyRef | null;
      imageUrl?: string;
      imageKey?: string;
      asSticker?: boolean;
    } = {},
  ): Promise<{ success: boolean; error?: string }> => {
    const hasImage = Boolean(options.imageUrl);
    const timeoutMs = hasImage ? SOCKET_IMAGE_ACK_TIMEOUT_MS : SOCKET_ACK_TIMEOUT_MS;
    return emitWithAck(
      'send_chat',
      { text, ...options },
      { success: false, error: '连接超时，请重试' },
      timeoutMs,
    );

  }, []);

  const toggleChatReaction = useCallback((
    messageId: string,
    emoji: string,
  ): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck(
      'toggle_chat_reaction',
      { messageId, emoji },
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const recallChat = useCallback((
    messageId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck(
      'recall_chat',
      { messageId },
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const listFavorites = useCallback((): Promise<{ success: boolean; favorites?: FavoriteSong[]; error?: string }> => {
    return emitWithAck('list_favorites', {}, { success: false, error: '连接超时，请重试' });
  }, []);

  const setFavorite = useCallback((song: Song, favorite: boolean): Promise<{ success: boolean; favorites?: FavoriteSong[]; favorite?: boolean; error?: string }> => {
    return emitWithAck('set_favorite', { song, favorite }, { success: false, error: '连接超时，请重试' });
  }, []);

  const importFavorites = useCallback((songs: Song[]): Promise<{ success: boolean; favorites?: FavoriteSong[]; imported?: number; dropped?: number; maxFavorites?: number; error?: string }> => {
    return emitWithAck('import_favorites', { songs }, { success: false, error: '导入超时，请稍后重试' });
  }, []);

  const createFavoriteShare = useCallback(() => emitWithAck<{ success: boolean; code?: string; count?: number; error?: string }>('create_favorite_share', {}, { success: false, error: '分享码创建失败，请重试' }), []);
  const previewFavoriteShare = useCallback((code: string) => emitWithAck<{ success: boolean; code?: string; songs?: FavoriteSong[]; error?: string }>('preview_favorite_share', { code }, { success: false, error: '分享码无效' }), []);
  const importFavoriteShare = useCallback((code: string, selectedIds: string[]) => emitWithAck<{ success: boolean; favorites?: FavoriteSong[]; imported?: number; dropped?: number; maxFavorites?: number; error?: string }>('import_favorite_share', { code, selectedIds }, { success: false, error: '分享收藏导入失败，请重试' }), []);



  const renameUser = useCallback((nickname: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'rename_user',
      { nickname },
      { success: false, error: '连接超时，请重试' },
    )
      .then((res) => {
        if (res.success && res.room) {
          applyRoomSnapshot(res.room);
          const myUserId = useRoomStore.getState().mySocketId;
          const resolvedNickname = (myUserId
            ? res.room.users.find((user) => user.id === myUserId)?.nickname
            : undefined)?.trim() || nickname.trim();
          useRoomStore.getState().setNickname(resolvedNickname);
          if (lastJoinSession) {
            lastJoinSession = { ...lastJoinSession, nickname: resolvedNickname };
          }
        }
        return res;
      });

  }, []);

  const setUserAvatar = useCallback((avatar_url: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_user_avatar',
      { avatar_url },
      { success: false, error: '连接超时，请重试' },
    )
      .then((res) => {
        if (res.success && res.room) {
          applyRoomSnapshot(res.room);
          useRoomStore.setState({ avatar_url: avatar_url.trim() });
        }
        return res;
      });
  }, []);

  const transferOwner = useCallback((userId: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'transfer_owner',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const destroyRoom = useCallback((): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string }>(
      'destroy_room',
      {},
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const setRoomAdmin = useCallback((userId: string, admin: boolean): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'set_room_admin',
      { userId, admin },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const kickUser = useCallback((userId: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'kick_user',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const renameRoomName = useCallback((name: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'rename_room',
      { name },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomLock = useCallback((locked: boolean, password?: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_lock',
      { locked, password },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const applyRoomPermanent = useCallback((note?: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'apply_room_permanent',
      { note: note || '' },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const cancelRoomPermanent = useCallback((): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'cancel_room_permanent',
      {},
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomFmMode = useCallback((mode: string, source?: 'netease' | 'tencent' | 'kugou' | 'qishui'): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_fm_mode',
      { mode, source },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
        cacheCurrentOwnerRoomConfig(res.room);
      }
      return res;
    });
  }, []);

  const setRoomPlaylistRoaming = useCallback((payload: { platform?: 'netease' | 'qq' | 'kugou' | 'qishui'; input?: string; clear?: boolean; playlistId?: string; playlistSource?: 'netease' | 'tencent' | 'kugou' | 'qishui'; playlistName?: string; dedupeByName?: boolean; playlistEnabled?: boolean }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_playlist_roaming',
      payload,
      { success: false, error: '连接超时，请重试' },
      SOCKET_MUSIC_ACCOUNT_ACK_TIMEOUT_MS,
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
        cacheCurrentOwnerRoomConfig(res.room);
      }
      return res;
    });
  }, []);

  const createMusicAccountQr = useCallback((platform: 'netease' | 'tencent' | 'kugou' | 'qishui') => {
    return emitWithAck<{ success: boolean; error?: string; data?: Record<string, unknown> }>(
      'music_account_qr_create',
      { platform },
      { success: false, error: '生成二维码超时，请重试' },
      SOCKET_MUSIC_ACCOUNT_ACK_TIMEOUT_MS,
    );
  }, []);

  const checkMusicAccountQr = useCallback((payload: Record<string, unknown>) => {
    return emitWithAck<{ success: boolean; error?: string; data?: Record<string, unknown> }>(
      'music_account_qr_check',
      payload,
      { success: false, error: '连接超时，请重试' },
      SOCKET_MUSIC_ACCOUNT_ACK_TIMEOUT_MS,
    );
  }, []);

  const bindMusicAccount = useCallback((payload: {
    sessionId: string;
    shared?: boolean;
  }) => {
    return emitWithAck<{
      success: boolean;
      error?: string;
      account?: import('../types').RoomMusicAccount;
      message?: string;
      room?: RoomState;
    }>(
      'music_account_bind',
      payload,
      { success: false, error: '绑定超时，请重试' },
      SOCKET_MUSIC_ACCOUNT_ACK_TIMEOUT_MS,
    ).then((res) => {
      if (res.success && res.room) applyRoomSnapshot(res.room);
      return res;
    });
  }, []);

  const listMusicAccounts = useCallback(() => {
    return emitWithAck<{
      success: boolean;
      error?: string;
      data?: import('../types').RoomMusicAccounts;
      room?: RoomState;
    }>(
      'music_account_list',
      {},
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) applyRoomSnapshot(res.room);
      return res;
    });
  }, []);

  const setMusicAccountShared = useCallback((platform: 'netease' | 'tencent' | 'kugou' | 'qishui', shared: boolean) => {
    return emitWithAck<{
      success: boolean;
      error?: string;
      account?: import('../types').RoomMusicAccount;
      room?: RoomState;
    }>(
      'music_account_set_shared',
      { platform, shared },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) applyRoomSnapshot(res.room);
      return res;
    });
  }, []);

  const unbindMusicAccount = useCallback((platform: 'netease' | 'tencent' | 'kugou' | 'qishui') => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'music_account_unbind',
      { platform },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) applyRoomSnapshot(res.room);
      return res;
    });
  }, []);

  const setRoomPlayMode = useCallback((mode: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_play_mode',
      { mode },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAnnouncement = useCallback((options: { enabled?: boolean; text?: string }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_announcement',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomCustomCover = useCallback((coverUrl: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_custom_cover',
      { coverUrl },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setChatHistoryVisibleOnJoin = useCallback((enabled: boolean): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_chat_history',
      { enabled },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
        cacheCurrentOwnerRoomConfig(res.room);
      }
      return res;
    });
  }, []);

  const setChatShowAvatars = useCallback((enabled: boolean): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_chat_avatars',
      { enabled },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
        cacheCurrentOwnerRoomConfig(res.room);
      }
      return res;
    });
  }, []);

  const setRoomJoinNotice = useCallback((options: {
    enabled: boolean;
    cooldownSec: number;
  }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_join_notice',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAiSettings = useCallback((options: {
    enabled: boolean;
    botName: string;
  }): Promise<{ success: boolean; error?: string; room?: RoomState; roomAi?: RoomAiConfig }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState; roomAi?: RoomAiConfig }>(
      'set_room_ai_settings',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        const merged = res.roomAi ? { ...res.room, roomAi: res.roomAi } : res.room;
        applyRoomSnapshot(merged);
      }
      return res;
    });
  }, []);

  const setRoomPlaybackRate = useCallback((playbackRate: number): Promise<{ success: boolean; error?: string; room?: RoomState; playbackRate?: number }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState; playbackRate?: number }>(
      'set_room_playback_rate',
      { playbackRate },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) applyRoomSnapshot(res.room);
      return res;
    });
  }, []);

  const setRoomMaxAdmins = useCallback((maxAdmins: number): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_max_admins',
      { maxAdmins },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
        cacheCurrentOwnerRoomConfig(res.room);
      }
      return res;
    });
  }, []);

  const setSongRequestEnabled = useCallback((options: {
    enabled?: boolean;
    memberJumpEnabled?: boolean;
    memberSeekEnabled?: boolean;
    memberPauseEnabled?: boolean;
    systemMediaPlayBound?: boolean;
    systemMediaSkipBound?: boolean;
    dislikeSkipMode?: 'count' | 'percent';
    dislikeSkipThreshold?: number;
    dislikeSkipPercent?: number;
    clearSongsOnLeaveEnabled?: boolean;
    clearSongsOnLeaveDelaySec?: number;
    minStaySec?: number;
    maxPerUser?: number;
    cooldownSec?: number;
    queueMaxLength?: number;
  }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_song_request',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const banRoomSong = useCallback((song: Song): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'ban_room_song',
      { song },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const unbanRoomSong = useCallback((
    name: string,
  ): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'unban_room_song',
      { name },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const addRoomForbiddenWord = useCallback((
    word: string,
  ): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'add_room_forbidden_word',
      { word },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const removeRoomForbiddenWord = useCallback((
    word: string,
  ): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'remove_room_forbidden_word',
      { word },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomMemberTier = useCallback((
    userId: string,
    tier: {
      badgeLabel: string;
      badgeColor: string;
      borderStyleId: string;
      borderColor: string;
      welcomeEnabled?: boolean;
      welcomeTemplateId?: string;
      welcomeCustomText?: string;
      confettiEnabled?: boolean;
      welcomeCooldownSec?: number;
    },
  ): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_member_tier',
      { userId, tier },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const removeRoomMemberTier = useCallback((userId: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'remove_room_member_tier',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAdminSelfManageMemberTier = useCallback((enabled: boolean): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_admin_self_manage_member_tier',
      { enabled },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomMemberSettings = useCallback((settings: {
    welcomeEnabled: boolean;
    welcomeTemplateId: string;
    welcomeCustomText?: string;
    confettiEnabled?: boolean;
    welcomeCooldownSec?: number;
  }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_member_settings',
      settings,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setChatMute = useCallback((options: { muteAll?: boolean; userId?: string; muted?: boolean }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_chat_mute',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);



  const loadChatHistory = useCallback((before: number, beforeId: string): Promise<{
    success: boolean;
    messages?: ChatMessage[];
    hasMore?: boolean;
    error?: string;
  }> => {
    return emitWithAck<{ success: boolean; messages?: ChatMessage[]; hasMore?: boolean; error?: string }>(
      'load_chat_history',
      { before, beforeId, limit: 50 },
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const loadSongHistory = useCallback((): Promise<{
    success: boolean;
    songs?: SongHistoryItem[];
    error?: string;
  }> => {
    const roomId = useRoomStore.getState().room?.id;
    if (!roomId) return Promise.resolve({ success: false, error: '未加入房间' });
    useSongHistoryStore.getState().setLoading(true);
    return emitWithAck<{ success: boolean; songs?: SongHistoryItem[]; error?: string }>(
      'load_song_history',
      { limit: 150 },
      { success: false, error: '连接超时，请重试' },
    )
      .then((res) => {
        if (useRoomStore.getState().room?.id !== roomId) {
          if (useSongHistoryStore.getState().roomId === roomId) {
            useSongHistoryStore.getState().setLoading(false);
          }
          return res;
        }
        if (res.success && res.songs) {
          useSongHistoryStore.getState().setSongs(roomId, res.songs);
        } else {
          useSongHistoryStore.getState().setLoading(false);
        }
        return res;
      });
  }, []);

  return {

    joinRoom,

    leaveRoom,

    addSong,

    skipSong,
    finishSong,
    reportPlaybackMedia,

    togglePlay,

    seek,

    removeSong,

    clearQueue,

    requestJump,
    reorderQueue,
    toggleQueueLike,
    toggleCurrentDislike,

    approveJump,

    rejectJump,

    requestSkip,

    approveSkip,

    rejectSkip,

    sendChat,

    toggleChatReaction,

    recallChat,

    listFavorites,

    setFavorite,
    importFavorites,
    createFavoriteShare,
    previewFavoriteShare,
    importFavoriteShare,
    renameUser,
    setUserAvatar,

    kickUser,

    transferOwner,

    destroyRoom,

    setRoomAdmin,

    renameRoomName,

    setRoomLock,

    applyRoomPermanent,
    cancelRoomPermanent,

    setRoomFmMode,
    setRoomPlaylistRoaming,

    createMusicAccountQr,
    checkMusicAccountQr,
    bindMusicAccount,
    listMusicAccounts,
    setMusicAccountShared,
    unbindMusicAccount,

    setRoomPlayMode,

    setRoomAnnouncement,

    setRoomCustomCover,

    setChatHistoryVisibleOnJoin,

    setChatShowAvatars,

    setRoomJoinNotice,
    setRoomAiSettings,
    setRoomMaxAdmins,
    setRoomPlaybackRate,

    setSongRequestEnabled,

    banRoomSong,

    unbanRoomSong,

    addRoomForbiddenWord,

    removeRoomForbiddenWord,

    setRoomMemberTier,

    removeRoomMemberTier,

    setRoomMemberSettings,
    setRoomAdminSelfManageMemberTier,

    setChatMute,

    loadChatHistory,

    loadSongHistory,

    connect,

  };

}
