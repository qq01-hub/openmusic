import type { RoomState } from '../types';
import {
  isRoomStateEquivalent,
  memberTiersEqual,
  roomQueueEqual,
  roomUsersEqual,
  stringArraysEqual,
} from './roomStateEquality';

/** room_update 合并：等价快照保留引用，子结构未变时复用引用减轻 React 重渲染。 */
export function mergeRoomState(incoming: RoomState, current: RoomState | null): RoomState {
  if (!current || current.id !== incoming.id) {
    return incoming;
  }
  if (isRoomStateEquivalent(incoming, current)) {
    return current;
  }

  const merged: RoomState = { ...incoming, currentTime: incoming.currentTime };

  // 后续 room_update 可能省略 chatVisibleSince，保留进房时的值
  if (incoming.chatVisibleSince == null && current.chatVisibleSince != null) {
    merged.chatVisibleSince = current.chatVisibleSince;
  }

  if (roomUsersEqual(incoming.users, current.users)) {
    merged.users = current.users;
  } else {
    // 广播可能省略 location，合并时按 userId 保留已有定位
    const prevById = new Map(current.users.map((user) => [user.id, user]));
    merged.users = incoming.users.map((user) => {
      const prev = prevById.get(user.id);
      if (!prev) return user;
      if (user.location) return user;
      if (!prev.location) return user;
      return { ...user, location: prev.location };
    });
  }
  if (roomQueueEqual(incoming.queue, current.queue)) merged.queue = current.queue;
  if (incoming.current === current.current
    || (incoming.current && current.current && incoming.current.queueId === current.current.queueId
      && incoming.current.id === current.current.id
      && incoming.current.requestedBy === current.current.requestedBy
      && stringArraysEqual(incoming.current.currentLikedByIds, current.current.currentLikedByIds))) {
    merged.current = current.current;
  }
  if (memberTiersEqual(incoming.memberTiers, current.memberTiers)) {
    merged.memberTiers = current.memberTiers;
  }
  if (stringArraysEqual(incoming.adminIds, current.adminIds)) {
    merged.adminIds = current.adminIds;
  }
  if (stringArraysEqual(incoming.autoPromotedAdminIds, current.autoPromotedAdminIds)) {
    merged.autoPromotedAdminIds = current.autoPromotedAdminIds;
  }
  if (stringArraysEqual(incoming.mutedUserIds, current.mutedUserIds)) {
    merged.mutedUserIds = current.mutedUserIds;
  }

  if (!incoming.roomAi && current.roomAi) {
    merged.roomAi = current.roomAi;
  }

  // 广播只带当前相关昵称子集，与已有 Map 合并而非整包替换
  if (incoming.userNicknames && current.userNicknames) {
    merged.userNicknames = { ...current.userNicknames, ...incoming.userNicknames };
  } else if (!incoming.userNicknames && current.userNicknames) {
    merged.userNicknames = current.userNicknames;
  }

  return merged;
}
