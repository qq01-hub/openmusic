export const CHAT_RECALL_WINDOW_MS = 2 * 60 * 1000;

export function canRecallChatMessage(
  msg: { userId: string; kind?: string; timestamp: number },
  myUserId: string,
  options: {
    canModerate?: boolean;
    isOwner?: boolean;
    creatorId?: string | null;
    adminIds?: string[];
    now?: number;
  } = {},
): boolean {
  if (!myUserId) return false;
  if (msg.kind && msg.kind !== 'chat') return false;
  const isSelf = msg.userId === myUserId;
  if (!isSelf && !options.canModerate) return false;
  if (!isSelf && options.canModerate) {
    if (options.creatorId && msg.userId === options.creatorId) return false;
    if (
      !options.isOwner
      && Array.isArray(options.adminIds)
      && options.adminIds.includes(msg.userId)
    ) {
      return false;
    }
  }
  if (isSelf && !options.canModerate) {
    const now = options.now ?? Date.now();
    return now - (msg.timestamp || 0) <= CHAT_RECALL_WINDOW_MS;
  }
  return true;
}

export function formatChatTime(timestamp: number): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const time = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

    if (date.toDateString() === now.toDateString()) return time;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;

    if (date.getFullYear() === now.getFullYear()) {
      const md = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
      return `${md} ${time}`;
    }

    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '';
  }
}

export function isChatStickerMessage(
  imageUrl?: string | null,
  imageKey?: string | null,
  asSticker?: boolean | null,
) {
  if (asSticker) return true;
  if (imageKey && String(imageKey).startsWith('local-sticker:')) return true;
  if (!imageUrl) return false;
  if (!imageKey) return true;
  return false;
}

export function compactReplyText(
  text: string,
  imageUrl?: string | null,
  imageKey?: string | null,
  asSticker?: boolean | null,
) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized) return normalized.slice(0, 48);
  if (imageUrl || imageKey || asSticker) {
    return isChatStickerMessage(imageUrl, imageKey, asSticker) ? '[表情包]' : '[图片]';
  }
  return '';
}

/** 聊天音乐卡片的可读文案（回复引用、通知、撤回提示都用它） */
function compactSongCardText(song?: { name?: string; artist?: string } | null): string {
  if (!song?.name) return '[音乐卡片]';
  const artist = String(song.artist || '').trim();
  return `[音乐] ${song.name}${artist ? ` - ${artist}` : ''}`.slice(0, 48);
}

/** 一条消息可能带多张卡片，取首张作为引用/通知文案 */
export function compactSongCardsText(
  songs?: Array<{ name?: string; artist?: string }> | null,
): string {
  if (!songs?.length) return '';
  const first = compactSongCardText(songs[0]);
  return songs.length > 1 ? `${first} 等 ${songs.length} 首`.slice(0, 48) : first;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const MENTION_ALL_LABEL = '全体成员';

export function buildMentionPrefix(nickname: string) {
  return `@${nickname} `;
}

export function collectMentionLabels(nicknames: string[]): string[] {
  const labels = [MENTION_ALL_LABEL, ...nicknames.filter(Boolean)];
  return [...new Set(labels)].sort((a, b) => b.length - a.length);
}

/** 从光标前文本提取 @ 后的查询串（允许昵称含空格） */
export function getMentionQueryFromTail(text: string): string | null {
  const atIndex = text.lastIndexOf('@');
  if (atIndex < 0) return null;
  return text.slice(atIndex + 1);
}

/** 文本开头是否为已知 @提及，返回剥离后的正文 */
export function stripLeadingMention(value: string, nicknames: string[] = []) {
  const labels = collectMentionLabels(nicknames);
  for (const label of labels) {
    const prefix = `@${label}`;
    if (!value.startsWith(prefix)) continue;
    const tail = value.slice(prefix.length);
    if (tail === '' || tail.startsWith(' ')) {
      return tail.trimStart();
    }
  }
  return value;
}

export function hasMentionInText(messageText: string, targetNickname: string) {
  const prefix = `@${targetNickname}`;
  let from = 0;
  while (from < messageText.length) {
    const at = messageText.indexOf(prefix, from);
    if (at < 0) return false;
    const tail = messageText.slice(at + prefix.length);
    if (tail === '' || tail.startsWith(' ')) return true;
    from = at + 1;
  }
  return false;
}

export function hasMentionAllInText(messageText: string) {
  return hasMentionInText(messageText, MENTION_ALL_LABEL);
}

export function matchesMentionAllQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  return !normalized || MENTION_ALL_LABEL.toLowerCase().startsWith(normalized)
    || normalized.startsWith(MENTION_ALL_LABEL.toLowerCase());
}

export type MentionTextSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string };

const mentionLabelsByNicknames = new WeakMap<string[], string[]>();

/** 按房间昵称最长匹配拆分 @ 提及（支持昵称含空格） */
export function tokenizeMentionSegments(text: string, nicknames: string[]): MentionTextSegment[] {
  if (!text.includes('@')) return [{ type: 'text', value: text }];
  let labels = mentionLabelsByNicknames.get(nicknames);
  if (!labels) {
    labels = collectMentionLabels(nicknames);
    mentionLabelsByNicknames.set(nicknames, labels);
  }
  const segments: MentionTextSegment[] = [];
  let i = 0;

  while (i < text.length) {
    const at = text.indexOf('@', i);
    if (at < 0) {
      if (i < text.length) segments.push({ type: 'text', value: text.slice(i) });
      break;
    }
    if (at > i) segments.push({ type: 'text', value: text.slice(i, at) });

    const after = text.slice(at + 1);
    let matched: string | null = null;
    for (const label of labels) {
      if (!after.startsWith(label)) continue;
      const tail = after.slice(label.length);
      if (tail === '' || tail.startsWith(' ')) {
        matched = label;
        break;
      }
    }

    if (matched) {
      segments.push({ type: 'mention', value: `@${matched}` });
      i = at + 1 + matched.length;
      continue;
    }

    const partial = after.match(/^([^\s@]+)/);
    if (partial) {
      segments.push({ type: 'mention', value: `@${partial[1]}` });
      i = at + 1 + partial[1].length;
    } else {
      segments.push({ type: 'text', value: '@' });
      i = at + 1;
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

export function mentionQueryMatchesNickname(query: string, nickname: string): boolean {
  const q = query.trim().toLowerCase();
  const name = nickname.toLowerCase();
  if (!q) return true;
  return name.includes(q) || name.startsWith(q);
}

/**
 * 光标前 @ 后已是完整提及（`@昵称 `），不再弹出选择框。
 * 用于引用回复 / 点击名字插入后，避免只剩一人还挂着候选列表。
 */
export function isCompletedMentionQuery(query: string, nicknames: string[]): boolean {
  const labels = collectMentionLabels(nicknames);
  for (const label of labels) {
    if (query.startsWith(`${label} `)) return true;
  }
  return false;
}

export const CHAT_PHOTO_CLASS = 'max-h-40 max-w-[220px] object-contain';
export const CHAT_STICKER_CLASS = 'max-h-28 max-w-[8.5rem] rounded-xl object-contain';
