import type { RoomState } from '../types';

const CONFIG_STORAGE_KEY = 'openmusic:last-owner-room-config:v1';
const PENDING_APPLY_STORAGE_KEY = 'openmusic:pending-room-config-apply:v1';
const LATEST_CREATED_ROOM_STORAGE_KEY = 'openmusic:latest-created-room:v1';

export interface CachedOwnerRoomConfigSettings {
  fmMode?: string;
  fmSource?: RoomState['fmSource'];
  chatHistoryVisibleOnJoin?: boolean;
  chatShowAvatars?: boolean;
  maxAdmins?: number;
  songRequestEnabled?: boolean;
  queueLikeSortEnabled?: boolean;
  memberJumpEnabled?: boolean;
  memberSeekEnabled?: boolean;
  memberPauseEnabled?: boolean;
  systemMediaPlayBound?: boolean;
  systemMediaSkipBound?: boolean;
  dislikeSkipMode?: RoomState['dislikeSkipMode'];
  dislikeSkipThreshold?: number;
  dislikeSkipPercent?: number;
  clearSongsOnLeaveEnabled?: boolean;
  clearSongsOnLeaveDelaySec?: number;
  deferOfflineRequesterSongs?: boolean;
  songRequestMinStaySec?: number;
  songRequestMaxPerUser?: number;
  songRequestCooldownSec?: number;
  queueMaxLength?: number;
}

export interface CachedOwnerRoomConfig {
  version: 1;
  sourceRoomId: string;
  updatedAt: number;
  settings: CachedOwnerRoomConfigSettings;
}

function storage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asFmSource(value: unknown): RoomState['fmSource'] | undefined {
  return value === 'netease' || value === 'tencent' || value === 'kugou' || value === 'qishui' ? value : undefined;
}

function asDislikeSkipMode(value: unknown): RoomState['dislikeSkipMode'] | undefined {
  return value === 'count' || value === 'percent' ? value : undefined;
}

function sanitizeSettings(raw: unknown): CachedOwnerRoomConfigSettings {
  const obj = asObject(raw) || {};
  return {
    fmMode: asString(obj.fmMode),
    fmSource: asFmSource(obj.fmSource),
    chatHistoryVisibleOnJoin: asBoolean(obj.chatHistoryVisibleOnJoin),
    chatShowAvatars: asBoolean(obj.chatShowAvatars),
    maxAdmins: asNumber(obj.maxAdmins),
    songRequestEnabled: asBoolean(obj.songRequestEnabled),
    queueLikeSortEnabled: asBoolean(obj.queueLikeSortEnabled),
    memberJumpEnabled: asBoolean(obj.memberJumpEnabled),
    memberSeekEnabled: asBoolean(obj.memberSeekEnabled),
    memberPauseEnabled: asBoolean(obj.memberPauseEnabled),
    systemMediaPlayBound: asBoolean(obj.systemMediaPlayBound),
    systemMediaSkipBound: asBoolean(obj.systemMediaSkipBound),
    dislikeSkipMode: asDislikeSkipMode(obj.dislikeSkipMode),
    dislikeSkipThreshold: asNumber(obj.dislikeSkipThreshold),
    dislikeSkipPercent: asNumber(obj.dislikeSkipPercent),
    clearSongsOnLeaveEnabled: asBoolean(obj.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelaySec: asNumber(obj.clearSongsOnLeaveDelaySec),
    deferOfflineRequesterSongs: asBoolean(obj.deferOfflineRequesterSongs),
    songRequestMinStaySec: asNumber(obj.songRequestMinStaySec),
    songRequestMaxPerUser: asNumber(obj.songRequestMaxPerUser),
    songRequestCooldownSec: asNumber(obj.songRequestCooldownSec),
    queueMaxLength: asNumber(obj.queueMaxLength),
  };
}

export function readCachedOwnerRoomConfig(): CachedOwnerRoomConfig | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = asObject(JSON.parse(store.getItem(CONFIG_STORAGE_KEY) || 'null'));
    const sourceRoomId = asString(raw?.sourceRoomId)?.toUpperCase();
    if (!sourceRoomId) return null;
    return {
      version: 1,
      sourceRoomId,
      updatedAt: asNumber(raw?.updatedAt) || 0,
      settings: sanitizeSettings(raw?.settings),
    };
  } catch {
    return null;
  }
}

export function rememberLatestCreatedRoom(roomId: string) {
  const store = storage();
  const normalized = roomId.trim().toUpperCase();
  if (!store || !normalized) return;
  store.setItem(LATEST_CREATED_ROOM_STORAGE_KEY, normalized);
}

export function markRoomConfigApplyPending(roomId: string) {
  const store = storage();
  const normalized = roomId.trim().toUpperCase();
  if (!store || !normalized) return;
  store.setItem(PENDING_APPLY_STORAGE_KEY, normalized);
}

export function consumePendingRoomConfigApply(roomId: string) {
  const store = storage();
  const normalized = roomId.trim().toUpperCase();
  if (!store || !normalized) return false;
  const pending = (store.getItem(PENDING_APPLY_STORAGE_KEY) || '').trim().toUpperCase();
  if (pending !== normalized) return false;
  store.removeItem(PENDING_APPLY_STORAGE_KEY);
  return true;
}

function shouldWriteConfigForRoom(room: RoomState, myUserId: string | null | undefined) {
  if (!room?.id || !myUserId || room.creatorId !== myUserId) return false;
  const store = storage();
  if (!store) return false;
  const roomId = room.id.toUpperCase();
  const latestCreatedRoomId = (store.getItem(LATEST_CREATED_ROOM_STORAGE_KEY) || '').trim().toUpperCase();
  if (latestCreatedRoomId) return latestCreatedRoomId === roomId;
  const cached = readCachedOwnerRoomConfig();
  return !cached || cached.sourceRoomId === roomId;
}

export function extractOwnerRoomConfig(room: RoomState): CachedOwnerRoomConfigSettings {
  return {
    fmMode: room.neteaseFmMode,
    fmSource: room.fmSource,
    chatHistoryVisibleOnJoin: Boolean(room.chatHistoryVisibleOnJoin),
    chatShowAvatars: Boolean(room.chatShowAvatars),
    maxAdmins: room.maxAdmins,
    songRequestEnabled: room.songRequestEnabled !== false,
    queueLikeSortEnabled: room.queueLikeSortEnabled !== false,
    memberJumpEnabled: Boolean(room.memberJumpEnabled),
    memberSeekEnabled: Boolean(room.memberSeekEnabled),
    memberPauseEnabled: Boolean(room.memberPauseEnabled),
    systemMediaPlayBound: room.systemMediaPlayBound !== false,
    systemMediaSkipBound: room.systemMediaSkipBound !== false,
    dislikeSkipMode: room.dislikeSkipMode,
    dislikeSkipThreshold: room.dislikeSkipThreshold,
    dislikeSkipPercent: room.dislikeSkipPercent,
    clearSongsOnLeaveEnabled: Boolean(room.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelaySec: room.clearSongsOnLeaveDelaySec,
    deferOfflineRequesterSongs: room.deferOfflineRequesterSongs !== false,
    songRequestMinStaySec: room.songRequestMinStaySec,
    songRequestMaxPerUser: room.songRequestMaxPerUser,
    songRequestCooldownSec: room.songRequestCooldownSec,
    queueMaxLength: room.queueMaxLength,
  };
}

export function cacheOwnerRoomConfigFromRoom(
  room: RoomState | null | undefined,
  myUserId: string | null | undefined,
  options: { force?: boolean } = {},
) {
  const store = storage();
  if (!store || !room?.id || !myUserId || room.creatorId !== myUserId) return;
  if (!options.force && !shouldWriteConfigForRoom(room, myUserId)) return;
  const payload: CachedOwnerRoomConfig = {
    version: 1,
    sourceRoomId: room.id.toUpperCase(),
    updatedAt: Date.now(),
    settings: extractOwnerRoomConfig(room),
  };
  store.setItem(CONFIG_STORAGE_KEY, JSON.stringify(payload));
}
