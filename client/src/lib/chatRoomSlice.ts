import { useMemo } from 'react';
import type { RoomState, RoomUser } from '../types';
import { useRoomStore } from '../stores/roomStore';
import type { ChatRoomMeta } from '../components/ChatMessageRow';
import { memberTiersEqual, roomUsersEqual } from './roomStateEquality';

export type ChatRoomSlice = {
  id: string;
  creatorId: string;
  ownerId?: string | null;
  adminIds: string[];
  autoPromotedAdminIds?: string[];
  users: RoomUser[];
  memberTiers?: RoomState['memberTiers'];
  userAvatarUrls?: RoomState['userAvatarUrls'];
  chatShowAvatars?: boolean;
  muteAll?: boolean;
  mutedUserIds?: string[];
};

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function avatarUrlsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true;
  const left = a || {};
  const right = b || {};
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

export function roomToChatSlice(room: RoomState): ChatRoomSlice {
  return {
    id: room.id,
    creatorId: room.creatorId || '',
    ownerId: room.ownerId ?? null,
    adminIds: room.adminIds || [],
    autoPromotedAdminIds: room.autoPromotedAdminIds || [],
    users: room.users,
    memberTiers: room.memberTiers,
    userAvatarUrls: room.userAvatarUrls,
    chatShowAvatars: Boolean(room.chatShowAvatars),
    muteAll: room.muteAll,
    mutedUserIds: room.mutedUserIds || [],
  };
}

export function chatRoomSlicesEqual(a: ChatRoomSlice | null, b: ChatRoomSlice | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.creatorId === b.creatorId
    && a.ownerId === b.ownerId
    && a.muteAll === b.muteAll
    && a.chatShowAvatars === b.chatShowAvatars
    && stringArraysEqual(a.adminIds, b.adminIds)
    && stringArraysEqual(a.autoPromotedAdminIds || [], b.autoPromotedAdminIds || [])
    && stringArraysEqual(a.mutedUserIds || [], b.mutedUserIds || [])
    && roomUsersEqual(a.users, b.users)
    && (a.memberTiers === b.memberTiers || memberTiersEqual(a.memberTiers, b.memberTiers))
    && avatarUrlsEqual(a.userAvatarUrls, b.userAvatarUrls);
}

export function chatSliceToRoomMeta(slice: ChatRoomSlice): ChatRoomMeta {
  return {
    id: slice.id,
    creatorId: slice.creatorId,
    ownerId: slice.ownerId,
    adminIds: slice.adminIds,
    autoPromotedAdminIds: slice.autoPromotedAdminIds,
    users: slice.users,
    memberTiers: slice.memberTiers,
    userAvatarUrls: slice.userAvatarUrls,
    chatShowAvatars: slice.chatShowAvatars,
    muteAll: slice.muteAll,
  };
}

/** 仅在聊天相关字段变化时更新引用，避免 room_update 拖动 ChatPanel 重渲染 */
export function useChatRoomSlice(): ChatRoomSlice | null {
  const selectSlice = useMemo(() => {
    let previousRoom: RoomState | null = null;
    let previousSlice: ChatRoomSlice | null = null;
    return ({ room }: { room: RoomState | null }): ChatRoomSlice | null => {
      if (room === previousRoom) return previousSlice;
      previousRoom = room;
      const next = room ? roomToChatSlice(room) : null;
      if (!chatRoomSlicesEqual(previousSlice, next)) previousSlice = next;
      return previousSlice;
    };
  }, []);
  return useRoomStore(selectSlice);
}

export function useChatRoomMeta(): ChatRoomMeta | null {
  const slice = useChatRoomSlice();
  return useMemo(() => (slice ? chatSliceToRoomMeta(slice) : null), [slice]);
}
