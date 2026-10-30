import { create } from 'zustand';
import type { RoomState } from '../types';
import { getSafeAvatarUrl } from '../lib/avatarImage';

interface RoomStore {
  room: RoomState | null;
  nickname: string;
  nicknameAccountId: string | null;
  nicknameDirty: boolean;
  nicknameMigration: boolean;
  avatar_url: string;
  mySocketId: string | null;
  myConnectionId: string | null;
  /** 初创房主身份（creatorId）——仅由 syncRolesFromRoom 根据房间快照计算，不信任 ACK 布尔值 */
  isOwner: boolean;
  isAdmin: boolean;
  /** 可操控播放（房主或管理员） */
  canControlPlayback: boolean;
  /** 当前播放引擎主控（ownerId，初创房主离线时可能为管理员） */
  isPlaybackLeader: boolean;
  showPlayer: boolean;
  exitReason: string | null;
  isReconnecting: boolean;
  setRoom: (room: RoomState | null) => void;
  setNickname: (name: string) => void;
  setNicknameDraft: (name: string) => void;
  bindAccountNickname: (accountId: string | null, nickname: string) => void;
  /** 仅设置身份 ID；特权角色必须经 syncRolesFromRoom 从房间字段推导 */
  setConnectionInfo: (
    socketId: string | null,
    connectionId?: string | null,
  ) => void;
  syncRolesFromRoom: (room: RoomState) => void;
  setShowPlayer: (show: boolean) => void;
  setExitReason: (reason: string | null) => void;
  setReconnecting: (reconnecting: boolean) => void;
  resetSession: () => void;
}

function deriveRoles(room: RoomState, mySocketId: string) {
  const nextIsOwner = room.creatorId === mySocketId;
  const nextIsAdmin = (room.adminIds || []).includes(mySocketId);
  const nextCanControl = nextIsOwner
    || nextIsAdmin
    || (room.autoPromotedAdminIds || []).includes(mySocketId);
  const nextIsLeader = room.ownerId === mySocketId;
  return {
    isOwner: nextIsOwner,
    isAdmin: nextIsAdmin,
    canControlPlayback: nextCanControl,
    isPlaybackLeader: nextIsLeader,
  };
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  room: null,
  nickname: localStorage.getItem('sjb_nickname') || '',
  nicknameAccountId: null,
  nicknameDirty: false,
  nicknameMigration: false,
  mySocketId: null,
  myConnectionId: null,
  isOwner: false,
  isAdmin: false,
  canControlPlayback: false,
  isPlaybackLeader: false,
  showPlayer: false,
  exitReason: null,
  isReconnecting: false,
  avatar_url: getSafeAvatarUrl(localStorage.getItem('avatar_url')),
  setRoom: (room) => set({ room }),
  setNickname: (nickname) => {
    localStorage.setItem('sjb_nickname', nickname);
    set({ nickname, nicknameDirty: false, nicknameMigration: false });
  },
  setNicknameDraft: (nickname) => {
    localStorage.setItem('sjb_nickname', nickname);
    set({ nickname, nicknameDirty: true, nicknameMigration: false });
  },
  bindAccountNickname: (accountId, savedNickname) => {
    const current = get();
    const cacheOwner = localStorage.getItem('sjb_nickname_account');
    if (!accountId && !cacheOwner && !current.nicknameAccountId) return;
    if (accountId && current.nicknameAccountId === accountId && current.nicknameDirty) return;
    const cached = accountId && (cacheOwner === null || cacheOwner === accountId)
      ? localStorage.getItem('sjb_nickname') || '' : '';
    const nickname = savedNickname || cached;
    localStorage.setItem('sjb_nickname_account', accountId || '');
    localStorage.setItem('sjb_nickname', nickname);
    set({ nicknameAccountId: accountId, nickname, nicknameDirty: Boolean(accountId && !savedNickname && nickname), nicknameMigration: Boolean(accountId && !savedNickname && nickname) });
  },
  setConnectionInfo: (mySocketId, myConnectionId = null) => {
    if (!mySocketId || !myConnectionId) {
      set({
        mySocketId: mySocketId || null,
        myConnectionId: null,
        isOwner: false,
        isAdmin: false,
        canControlPlayback: false,
        isPlaybackLeader: false,
      });
      return;
    }
    const room = get().room;
    if (room) {
      set({
        mySocketId,
        myConnectionId,
        ...deriveRoles(room, mySocketId),
      });
      return;
    }
    set({
      mySocketId,
      myConnectionId,
      isOwner: false,
      isAdmin: false,
      canControlPlayback: false,
      isPlaybackLeader: false,
    });
  },
  syncRolesFromRoom: (room) => {
    const { mySocketId, myConnectionId, isOwner, isAdmin, canControlPlayback, isPlaybackLeader } = get();
    if (!mySocketId) return;
    const next = deriveRoles(room, mySocketId);
    if (
      next.isOwner === isOwner
      && next.isAdmin === isAdmin
      && next.canControlPlayback === canControlPlayback
      && next.isPlaybackLeader === isPlaybackLeader
    ) {
      return;
    }
    set({
      ...next,
      myConnectionId,
    });
  },
  setShowPlayer: (showPlayer) => set({ showPlayer }),
  setExitReason: (exitReason) => set({ exitReason }),
  setReconnecting: (isReconnecting) => set({ isReconnecting }),
  resetSession: () => set({
    room: null,
    mySocketId: null,
    myConnectionId: null,
    isOwner: false,
    isAdmin: false,
    canControlPlayback: false,
    isPlaybackLeader: false,
    showPlayer: false,
    exitReason: null,
    isReconnecting: false,
  }),
}));
