import type {
  BannedSong,
  ForbiddenWord,
  JumpRequest,
  QueueItem,
  RoomMemberTier,
  RoomState,
  RoomUser,
  SkipRequest,
} from '../types';

export function stringArraysEqual(a?: string[], b?: string[]): boolean {
  const left = a || [];
  const right = b || [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function roomUsersEqual(a: RoomUser[], b: RoomUser[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    // 故意忽略 location：广播常省略，且定位变化不应拖垮整树重渲染
    if (
      left.id !== right.id
      || left.nickname !== right.nickname
      || left.readOnly !== right.readOnly
      || left.joinedAt !== right.joinedAt
    ) {
      return false;
    }
  }
  return true;
}

function queueItemEqual(a: QueueItem, b: QueueItem): boolean {
  return a.queueId === b.queueId
    && a.id === b.id
    && a.source === b.source
    && a.name === b.name
    && a.requestedById === b.requestedById
    && a.ownerPriority === b.ownerPriority
    && a.priorityBy === b.priorityBy
    && a.manualOrder === b.manualOrder
    && stringArraysEqual(a.likedByIds, b.likedByIds)
    && stringArraysEqual(a.currentLikedByIds, b.currentLikedByIds)
    && stringArraysEqual(a.dislikedByIds, b.dislikedByIds);
}

export function roomQueueEqual(a: QueueItem[], b: QueueItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!queueItemEqual(a[i], b[i])) return false;
  }
  return true;
}

function currentSongEqual(a: QueueItem | null, b: QueueItem | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return queueItemEqual(a, b) && a.requestedBy === b.requestedBy;
}

function jumpRequestsEqual(a: JumpRequest[], b: JumpRequest[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].queueId !== b[i].queueId) return false;
  }
  return true;
}

function skipRequestsEqual(a: SkipRequest[], b: SkipRequest[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

function bannedSongsEqual(a: BannedSong[] | undefined, b: BannedSong[] | undefined): boolean {
  const left = a || [];
  const right = b || [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l.source !== r.source || l.id !== r.id) return false;
  }
  return true;
}

function forbiddenWordsEqual(a: ForbiddenWord[] | undefined, b: ForbiddenWord[] | undefined): boolean {
  const left = a || [];
  const right = b || [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l.word !== r.word || Boolean(l.isDefault) !== Boolean(r.isDefault)) return false;
  }
  return true;
}

function memberTierEqual(a: RoomMemberTier, b: RoomMemberTier): boolean {
  return a.userId === b.userId
    && a.badgeLabel === b.badgeLabel
    && a.badgeColor === b.badgeColor
    && a.borderStyleId === b.borderStyleId
    && a.borderColor === b.borderColor
    && (a.welcomeEnabled !== false) === (b.welcomeEnabled !== false)
    && (a.welcomeTemplateId || 'royal') === (b.welcomeTemplateId || 'royal')
    && (a.welcomeCustomText || '') === (b.welcomeCustomText || '')
    && Boolean(a.confettiEnabled) === Boolean(b.confettiEnabled)
    && (a.welcomeCooldownSec ?? 300) === (b.welcomeCooldownSec ?? 300);
}

export function memberTiersEqual(
  a: Record<string, RoomMemberTier> | undefined,
  b: Record<string, RoomMemberTier> | undefined,
): boolean {
  const left = a || {};
  const right = b || {};
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    const lv = left[key];
    const rv = right[key];
    if (!lv || !rv || !memberTierEqual(lv, rv)) return false;
  }
  return true;
}

function recordShallowEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const left = a || {};
  const right = b || {};
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function audioQualityEqual(a: RoomState['audioQuality'], b: RoomState['audioQuality']): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.netease === b.netease && a.tencent === b.tencent;
}

function memberSettingsEqual(a: RoomState['memberSettings'], b: RoomState['memberSettings']): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.welcomeEnabled === b.welcomeEnabled
    && a.welcomeTemplateId === b.welcomeTemplateId
    && a.welcomeCustomText === b.welcomeCustomText
    && Boolean(a.confettiEnabled) === Boolean(b.confettiEnabled)
    && (a.welcomeCooldownSec ?? 300) === (b.welcomeCooldownSec ?? 300);
}

/** 忽略 currentTime 漂移，判断房间快照是否等价 */
export function isRoomStateEquivalent(a: RoomState, b: RoomState): boolean {
  return a.id === b.id
    && a.name === b.name
    && a.hasPassword === b.hasPassword
    && a.isLocked === b.isLocked
    && a.muteAll === b.muteAll
    && stringArraysEqual(a.mutedUserIds, b.mutedUserIds)
    && a.chatMuted === b.chatMuted
    && a.ownerId === b.ownerId
    && a.creatorId === b.creatorId
    && stringArraysEqual(a.adminIds, b.adminIds)
    && a.maxAdmins === b.maxAdmins
    && stringArraysEqual(a.autoPromotedAdminIds, b.autoPromotedAdminIds)
    && recordShallowEqual(a.userNicknames, b.userNicknames)
    && a.ownerConnectionId === b.ownerConnectionId
    && roomQueueEqual(a.queue, b.queue)
    && currentSongEqual(a.current, b.current)
    && a.isPlaying === b.isPlaying
    && roomUsersEqual(a.users, b.users)
    && a.userCount === b.userCount
    && jumpRequestsEqual(a.jumpRequests, b.jumpRequests)
    && skipRequestsEqual(a.skipRequests, b.skipRequests)
    && a.chatVisibleSince === b.chatVisibleSince
    && currentSongEqual(a.nextRandom ?? null, b.nextRandom ?? null)
    && a.randomLoading === b.randomLoading
    && a.randomError === b.randomError
    && audioQualityEqual(a.audioQuality, b.audioQuality)
    && a.playMode === b.playMode
    && a.neteaseFmMode === b.neteaseFmMode
    && a.announcementEnabled === b.announcementEnabled
    && a.announcementText === b.announcementText
    && a.chatHistoryVisibleOnJoin === b.chatHistoryVisibleOnJoin
    && a.chatShowAvatars === b.chatShowAvatars
    && a.joinNoticeEnabled === b.joinNoticeEnabled
    && a.joinNoticeCooldownSec === b.joinNoticeCooldownSec
    && a.roomAiEnabled === b.roomAiEnabled
    && a.roomAiBotName === b.roomAiBotName
    && a.songRequestEnabled === b.songRequestEnabled
    && a.queueLikeSortEnabled === b.queueLikeSortEnabled
    && a.memberJumpEnabled === b.memberJumpEnabled
    && a.memberSeekEnabled === b.memberSeekEnabled
    && a.memberPauseEnabled === b.memberPauseEnabled
    && a.systemMediaPlayBound === b.systemMediaPlayBound
    && a.systemMediaSkipBound === b.systemMediaSkipBound
    && a.dislikeSkipMode === b.dislikeSkipMode
    && a.dislikeSkipThreshold === b.dislikeSkipThreshold
    && a.dislikeSkipPercent === b.dislikeSkipPercent
    && a.clearSongsOnLeaveEnabled === b.clearSongsOnLeaveEnabled
    && a.clearSongsOnLeaveDelaySec === b.clearSongsOnLeaveDelaySec
    && a.deferOfflineRequesterSongs === b.deferOfflineRequesterSongs
    && a.songRequestMinStaySec === b.songRequestMinStaySec
    && a.songRequestMaxPerUser === b.songRequestMaxPerUser
    && a.songRequestCooldownSec === b.songRequestCooldownSec
    && a.queueMaxLength === b.queueMaxLength
    && bannedSongsEqual(a.bannedSongs, b.bannedSongs)
    && forbiddenWordsEqual(a.forbiddenWords, b.forbiddenWords)
    && memberTiersEqual(a.memberTiers, b.memberTiers)
    && memberSettingsEqual(a.memberSettings, b.memberSettings)
    && a.adminSelfManageMemberTierEnabled === b.adminSelfManageMemberTierEnabled;
}
