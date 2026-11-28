/**
 * 账户到房间的索引服务。
 *
 * 这里刻意不直接依赖 Redis：HTTP/Redis 接线由 index.js/roomStorage.js 完成，
 * 本模块提供可测试的索引语义，生产接线可将同样的操作映射为 Redis Set。
 */

function normalizeAccountId(value) {
  const id = String(value || '').trim();
  return id.length >= 4 && id.length <= 128 ? id : '';
}

function normalizeRoomId(value) {
  const id = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9_-]{4,64}$/.test(id) ? id : '';
}

export function accountRoomsKey(accountId) {
  const id = normalizeAccountId(accountId);
  return id ? `openmusic:account:rooms:${id}` : '';
}

function roomSummary(room) {
  return {
    id: room.id,
    name: String(room.name || room.id),
    isLocked: Boolean(room.isLocked),
    userCount: Number(room.userCount ?? room.users?.size ?? 0) || 0,
    createdAt: Number(room.createdAt) || 0,
  };
}

export function createAccountRoomIndex() {
  const byAccount = new Map();

  function getSet(accountId, create = false) {
    const id = normalizeAccountId(accountId);
    if (!id) return null;
    let set = byAccount.get(id);
    if (!set && create) {
      set = new Set();
      byAccount.set(id, set);
    }
    return set || null;
  }

  return {
    add(accountId, roomId) {
      const id = normalizeRoomId(roomId);
      const set = getSet(accountId, true);
      if (!set || !id) return false;
      const had = set.has(id);
      set.add(id);
      return !had;
    },
    remove(accountId, roomId) {
      const id = normalizeRoomId(roomId);
      const set = getSet(accountId);
      if (!set || !id) return false;
      const removed = set.delete(id);
      if (set.size === 0) byAccount.delete(normalizeAccountId(accountId));
      return removed;
    },
    list(accountId, roomsById = new Map()) {
      const set = getSet(accountId);
      if (!set) return [];
      const result = [];
      for (const roomId of set) {
        const room = roomsById.get(roomId);
        if (!room) continue;
        if (room.ownerAccountId !== normalizeAccountId(accountId)) continue;
        result.push(roomSummary(room));
      }
      return result.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    },
    clear() {
      byAccount.clear();
    },
  };
}


/** 幂等的匿名房间认领判定；调用方必须先在服务端验证 creatorId/device proof。 */
export function claimAccountRoom({ room, accountId, verifiedCreatorId, accountRoomUserId, index }) {
  const aid = normalizeAccountId(accountId);
  const creator = String(verifiedCreatorId || '').trim();
  const accountCreator = String(accountRoomUserId || '').trim();
  if (!room || !aid || !index) return { ok: false, error: '参数无效', code: 'INVALID_INPUT' };
  if (room.ownerAccountId && room.ownerAccountId !== aid) {
    return { ok: false, error: '房间已被其他账户绑定', code: 'ROOM_ACCOUNT_CONFLICT' };
  }
  if (!creator || creator !== room.creatorId) {
    return { ok: false, error: '无权认领该房间', code: 'ROOM_CLAIM_FORBIDDEN' };
  }
  let changed = false;
  if (room.ownerAccountId !== aid) {
    room.ownerAccountId = aid;
    changed = true;
  }
  if (accountCreator && room.creatorId !== accountCreator) {
    room.creatorId = accountCreator;
    changed = true;
  }
  index.add(aid, room.id);
  return { ok: true, changed };
}

export function claimAccountRooms({ rooms, accountId, verifiedCreatorId, accountRoomUserId, index }) {
  const claimedRoomIds = [];
  const conflictedRoomIds = [];
  for (const room of Array.isArray(rooms) ? rooms : []) {
    if (room?.creatorId !== String(verifiedCreatorId || '').trim()) continue;
    const result = claimAccountRoom({ room, accountId, verifiedCreatorId, accountRoomUserId, index });
    if (result.ok && result.changed) claimedRoomIds.push(room.id);
    else if (result.code === 'ROOM_ACCOUNT_CONFLICT') conflictedRoomIds.push(room.id);
  }
  return { claimedRoomIds, conflictedRoomIds };
}

export { normalizeAccountId, normalizeRoomId, roomSummary };
