import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Plus, Reply, Smile, Sparkles } from 'lucide-react';
import { AI_BOT_USER_ID, isVerifiedAiBotMessage } from '../lib/chatAi';
import type { ChatMessage, ChatReplyRef, RoomMemberTier, RoomUser } from '../types';
import QFaceImage from './QFaceImage';
import Tooltip from './Tooltip';
import MemberTierBadge from './MemberTierBadge';
import UserRoleMarks from './UserRoleMarks';
import { ChatMessageReactions } from './ChatMessageReactions';
import ChatMusicCard from './ChatMusicCard';
import ChatMessageContextMenu, { type ChatMessageMenuPos } from './ChatMessageContextMenu';
import {
  CHAT_PHOTO_CLASS,
  CHAT_STICKER_CLASS,
  canRecallChatMessage,
  formatChatTime,
  isChatStickerMessage,
  tokenizeMentionSegments,
} from '../lib/chatPanelUtils';
import { normalizeAiQqFaceText, parseQQFaceTokens, QFaceLoadPriority } from '../lib/qface';
import { importUserStickerFromChatImage } from '../lib/userStickerStore';
import { getDisplayInitial } from '../lib/displayInitial';
import { resolveRoomAvatarUrl } from '../lib/avatarImage';
import { UPSTREAM_CHARACTER_PREVIEWS } from '../lib/deskPetUpstream';
import { useRoomStore } from '../stores/roomStore';
import { getChatImageDisplayUrl } from '../api/chatImage';
import type { ChatCardActions } from './chatCardActions';

type StickerSaveState = 'idle' | 'saving' | 'done' | 'exists' | 'error';

function StickerSaveButton({ imageUrl, imageKey }: { imageUrl: string; imageKey?: string | null }) {
  const [state, setState] = useState<StickerSaveState>('idle');

  const handleSave = useCallback(async () => {
    if (state === 'saving') return;
    setState('saving');
    try {
      const result = await importUserStickerFromChatImage(imageUrl, imageKey);
      if (result.imported > 0) setState('done');
      else if (result.skipped > 0) setState('exists');
      else setState('error');
    } catch {
      setState('error');
    }
  }, [imageUrl, imageKey, state]);

  const label = state === 'done'
    ? '已添加'
    : state === 'exists'
      ? '已在表情里'
      : state === 'error'
        ? '添加失败'
        : '添加到表情';

  const stateClass = state === 'error'
    ? 'text-amber-300'
    : state === 'done' || state === 'exists'
      ? 'text-emerald-300'
      : 'text-netease-muted hover:bg-white/10 hover:text-white';

  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={() => { void handleSave(); }}
        className={`rounded p-0.5 transition-colors ${stateClass}`}
        aria-label={label}
      >
        {state === 'saving' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === 'done' || state === 'exists' ? (
          <Check className="h-3 w-3" />
        ) : (
          <Plus className="h-3 w-3" />
        )}
      </button>
    </Tooltip>
  );
}

export type ChatRoomMeta = {
  id: string;
  creatorId: string;
  ownerId?: string | null;
  adminIds: string[];
  autoPromotedAdminIds?: string[];
  users: RoomUser[];
  memberTiers?: Record<string, RoomMemberTier>;
  userAvatarUrls?: Record<string, string>;
  chatShowAvatars?: boolean;
  muteAll?: boolean;
};

const roomUserIndexes = new WeakMap<RoomUser[], {
  userMap: Map<string, RoomUser>;
  nicknames: string[];
}>();

function getRoomUserIndex(users: RoomUser[]) {
  let index = roomUserIndexes.get(users);
  if (!index) {
    index = { userMap: new Map(), nicknames: [] };
    for (const user of users) {
      index.userMap.set(user.id, user);
      index.nicknames.push(user.nickname);
    }
    roomUserIndexes.set(users, index);
  }
  return index;
}

function renderMessageText(
  messageText: string,
  variant: 'message' | 'reply',
  chatScrollRoot: HTMLDivElement | null,
  nicknames: string[],
) {
  const isReply = variant === 'reply';
  const faceClass = isReply
    ? 'mx-0.5 inline-block h-4 w-auto max-w-5 object-contain align-middle'
    : 'mx-0.5 inline-block h-7 w-auto max-w-8 object-contain align-middle';
  const facePlaceholderClass = isReply
    ? 'mx-0.5 inline-block h-4 w-4 align-middle'
    : 'mx-0.5 inline-block h-7 w-6 align-middle';
  const keyPrefix = isReply ? 'reply' : 'msg';

    return parseQQFaceTokens(messageText).map((part, index) => {
      if (typeof part === 'string') {
        return tokenizeMentionSegments(part, nicknames).map((segment, segIndex) => (
          segment.type === 'mention'
            ? <span key={`${keyPrefix}-mention-${index}-${segIndex}`} className="break-words text-sky-300 [overflow-wrap:anywhere]">{segment.value}</span>
            : <span key={`${keyPrefix}-text-${index}-${segIndex}`} className="break-words [overflow-wrap:anywhere]">{segment.value}</span>
        ));
      }
    return (
      <QFaceImage
        key={`${keyPrefix}-face-${part.id}-${index}`}
        id={part.id}
        priority={QFaceLoadPriority.MESSAGE}
        nearPriority={QFaceLoadPriority.NEAR}
        observeRoot={chatScrollRoot}
        className={faceClass}
        placeholderClassName={facePlaceholderClass}
      />
    );
  });
}

function normalizeAiRichText(value: string) {
  return normalizeAiQqFaceText(value)
    .replace(/\r\n?/g, '\n');
}

function renderAiInlineText(
  text: string,
  keyPrefix: string,
  chatScrollRoot: HTMLDivElement | null,
  nicknames: string[],
) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map((part, index) => {
    const isBold = part.startsWith('**') && part.endsWith('**');
    const content = isBold ? part.slice(2, -2) : part;
    const node = renderMessageText(content, 'message', chatScrollRoot, nicknames);
    return isBold ? (
      <strong key={`${keyPrefix}-strong-${index}`} className="font-normal text-inherit">
        {node}
      </strong>
    ) : (
      <span key={`${keyPrefix}-text-${index}`}>{node}</span>
    );
  });
}

const animatedAiMessageIds = new Set<string>();

function sliceTextPreserveFaceTokens(raw: string, targetChars: number): string {
  if (targetChars >= raw.length) return raw;
  for (const match of raw.matchAll(/\[qqface:\d+\]/g)) {
    if (match.index >= targetChars) break;
    if (match.index + match[0].length > targetChars) {
      return raw.slice(0, match.index);
    }
  }
  return raw.slice(0, targetChars);
}

function AiMessageContent({
  msgId,
  timestamp,
  messageText: rawMessageText,
  aiThoughts: rawAiThoughts,
  chatScrollRoot,
  nicknames,
  onContentResize,
}: {
  msgId: string;
  timestamp: number;
  messageText: string;
  aiThoughts?: string[];
  chatScrollRoot: HTMLDivElement | null;
  nicknames: string[];
  onContentResize?: () => void;
}) {
  // 先规范完整文本再逐字显示，避免动画暴露半截表情前缀或改变文本长度
  const messageText = normalizeAiRichText(rawMessageText);
  const aiThoughts = (rawAiThoughts || [])
      .map((step) => normalizeAiQqFaceText(String(step || '').trim(), { allowFaces: false }))
      .filter((step) => step && !/^思考推理[：:]/.test(step));
  const shouldAnimate = useRef<boolean>(
    !animatedAiMessageIds.has(msgId) && timestamp > 0 && Date.now() - timestamp < 12_000,
  );
  const resizeCallback = useRef(onContentResize);
  resizeCallback.current = onContentResize;
  const animationProgress = useRef(0);
  const [visibleChars, setVisibleChars] = useState<number>(() =>
    shouldAnimate.current ? 0 : messageText.length,
  );
  const [showThoughts, setShowThoughts] = useState(false);

  useEffect(() => {
    if (!shouldAnimate.current) {
      setVisibleChars(messageText.length);
      return;
    }
    animatedAiMessageIds.add(msgId);
    const total = messageText.length;
    if (total <= 0) {
      shouldAnimate.current = false;
      return;
    }
    const step = Math.max(1, Math.ceil(total / 42));
    let current = animationProgress.current;
    const timer = window.setInterval(() => {
      current = Math.min(total, current + step);
      animationProgress.current = current;
      setVisibleChars(current);
      resizeCallback.current?.();
      if (current >= total) {
        shouldAnimate.current = false;
        window.clearInterval(timer);
      }
    }, 22);
    return () => window.clearInterval(timer);
  }, [msgId, messageText]);

  const displayedText = visibleChars >= messageText.length
    ? messageText
    : sliceTextPreserveFaceTokens(messageText, visibleChars);
  const isTyping = visibleChars < messageText.length;
  const lines = displayedText.split('\n');

  return (
    <div className="space-y-1.5 text-sm font-normal leading-7 tracking-normal">
      {Array.isArray(aiThoughts) && aiThoughts.length > 0 && (
        <div className="mb-1.5 border-b border-white/10 pb-1.5 text-[11px] leading-relaxed text-netease-muted">
          <button
            type="button"
            onClick={() => {
              setShowThoughts((v) => !v);
              requestAnimationFrame(() => onContentResize?.());
            }}
            className="flex w-full items-center justify-between gap-1.5 text-left font-normal transition-colors hover:text-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-netease-red"
            aria-expanded={showThoughts}
          >
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              <span>处理过程 · {aiThoughts.length} 步</span>
            </span>
            {showThoughts ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {showThoughts && (
            <ul className="mt-1.5 space-y-1 text-[11px]">
              {aiThoughts.map((step, idx) => (
                <li key={`thought-${idx}`} className="flex items-start gap-1.5">
                  <span className="mt-0.5 text-[10px] opacity-70">{idx + 1}.</span>
                  <span className="min-w-0 break-words">{normalizeAiQqFaceText(step, { allowFaces: false })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div key={`ai-gap-${index}`} className="h-1" aria-hidden />;
        const numbered = line.match(/^(\d{1,2})[.、]\s+(.+)$/);
        const bullet = line.match(/^[-•]\s+(.+)$/);
        if (numbered) {
          return (
            <div key={`ai-item-${index}`} className="grid grid-cols-[1.4rem_minmax(0,1fr)] gap-1.5 py-0.5">
              <span className="pt-0.5 text-xs font-normal tabular-nums text-netease-muted">{numbered[1]}</span>
              <span className="min-w-0">{renderAiInlineText(numbered[2], `ai-item-${index}`, chatScrollRoot, nicknames)}</span>
            </div>
          );
        }
        if (bullet) {
          return (
            <div key={`ai-bullet-${index}`} className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-1.5 py-0.5">
              <span className="pt-0.5 text-netease-muted">•</span>
              <span className="min-w-0">{renderAiInlineText(bullet[1], `ai-bullet-${index}`, chatScrollRoot, nicknames)}</span>
            </div>
          );
        }
        return (
          <p key={`ai-paragraph-${index}`} className="m-0">
            {renderAiInlineText(line, `ai-paragraph-${index}`, chatScrollRoot, nicknames)}
            {isTyping && index === lines.length - 1 && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-white/60 align-middle" aria-hidden />
            )}
          </p>
        );
      })}
    </div>
  );
}

function renderReplyRefContent(
  reply: ChatReplyRef,
  chatScrollRoot: HTMLDivElement | null,
  nicknames: string[],
  alignEnd = false,
) {
  const text = reply.userId === AI_BOT_USER_ID ? normalizeAiQqFaceText(reply.text) : reply.text;
  const hasText = text.trim().length > 0;
  const isSticker = isChatStickerMessage(reply.imageUrl, reply.imageKey, reply.asSticker);
  const isPhoto = Boolean(reply.imageUrl && !isSticker);

  return (
    <span className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 ${alignEnd ? 'justify-end' : ''}`}>
      {hasText && renderMessageText(text, 'reply', chatScrollRoot, nicknames)}
      {isSticker && reply.imageUrl && (
        <img
          src={getChatImageDisplayUrl(reply.imageUrl, reply.imageKey)}
          alt="表情包"
          loading="lazy"
          className="max-h-8 max-w-[3.5rem] shrink-0 rounded object-contain"
        />
      )}
      {isSticker && !reply.imageUrl && !hasText && <span>[表情包]</span>}
      {isPhoto && !hasText && <span>[图片]</span>}
    </span>
  );
}

export interface ChatMessageRowProps {
  msg: ChatMessage;
  room: ChatRoomMeta;
  myUserId: string;
  pureMode: boolean;
  pureImageRevealed: boolean;
  aiProcessing?: { status: 'queued' | 'processing' | 'error'; queuePosition: number; pendingCount: number; attempt: number; maxAttempts: number; error?: string; stepText?: string; thoughtSteps?: string[] } | null;
  reactionPickerOpen: boolean;
  chatMuted: boolean;
  canModerate?: boolean;
  chatScrollRoot: HTMLDivElement | null;
  chatPanelRef: React.RefObject<HTMLDivElement | null>;
  onReply: (msg: ChatMessage) => void;
  onRecall?: (msg: ChatMessage) => void;
  onMentionUser: (user: RoomUser) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenReactionPicker: (messageId: string | null) => void;
  onRevealPureImage: (messageId: string) => void;
  onPreviewImage: (url: string) => void;
  /** 卡片收藏 / 点歌 / 再分享 */
  cardActions?: ChatCardActions;
  onContentResize?: () => void;
}

function ChatMessageRow({
  msg,
  room,
  myUserId,
  pureMode,
  pureImageRevealed,
  aiProcessing = null,
  reactionPickerOpen,
  chatMuted,
  canModerate = false,
  chatScrollRoot,
  chatPanelRef,
  onReply,
  onRecall,
  onMentionUser,
  onToggleReaction,
  onOpenReactionPicker,
  onRevealPureImage,
  onPreviewImage,
  cardActions,
  onContentResize,
}: ChatMessageRowProps) {
  const [menuPos, setMenuPos] = useState<ChatMessageMenuPos | null>(null);
  const [expandProcessingSteps, setExpandProcessingSteps] = useState(false);
  useLayoutEffect(() => {
    if (!aiProcessing) return;
    onContentResize?.();
  }, [aiProcessing?.status, aiProcessing?.stepText, aiProcessing?.thoughtSteps?.length, onContentResize]);
  const myAvatarUrl = useRoomStore((s) => s.avatar_url);
  const { userMap, nicknames } = getRoomUserIndex(room.users);
  const canRecall = canRecallChatMessage(msg, myUserId, {
    canModerate,
    isOwner: Boolean(room.creatorId && myUserId === room.creatorId),
    creatorId: room.creatorId,
    adminIds: room.adminIds,
  });

  const closeMenu = useCallback(() => setMenuPos(null), []);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuPos({ x: event.clientX, y: event.clientY });
  }, []);

  if (msg.kind === 'welcome') {
    if (pureMode) return null;
    return (
      <WelcomeChatRow msg={msg} onContentResize={onContentResize} />
    );
  }

  if (msg.kind === 'recall' || msg.kind === 'notice') {
    return (
      <div className="flex justify-center px-2 py-1">
        <p className="max-w-[92%] text-center text-[11px] leading-5 text-netease-muted/80">
          {msg.text}
        </p>
      </div>
    );
  }

  const isMe = msg.userId === myUserId;
  const isAiBot = isVerifiedAiBotMessage(msg);
  const isRoomCreator = msg.userId === room.creatorId;
  const isRoomAdmin = room.adminIds.includes(msg.userId)
    || (room.autoPromotedAdminIds || []).includes(msg.userId)
    || (Boolean(room.ownerId) && room.ownerId === msg.userId && !isRoomCreator);
  const userMemberTier = room.memberTiers?.[msg.userId];
  const user = userMap.get(msg.userId);
  const handleMention = useCallback(() => {
    if (user) {
      onMentionUser(user);
      return;
    }
    if (isAiBot) {
      onMentionUser({ id: msg.userId, nickname: msg.nickname } as RoomUser);
    }
  }, [isAiBot, msg.nickname, msg.userId, onMentionUser, user]);
  const showAvatars = Boolean(room.chatShowAvatars);
  const avatarUrl = isAiBot ? UPSTREAM_CHARACTER_PREVIEWS.v2.src : resolveRoomAvatarUrl(
    isMe ? myAvatarUrl : undefined,
    room.userAvatarUrls?.[msg.userId],
  );
  const isStickerImage = isChatStickerMessage(msg.imageUrl, msg.imageKey, msg.asSticker);
  const isPureStickerHidden = pureMode && isStickerImage && !pureImageRevealed;
  const isPhotoOnly = Boolean(
    msg.imageUrl && !msg.text && !isStickerImage && (!pureMode || pureImageRevealed),
  );
  const bubbleClass = `min-w-0 max-w-full rounded-2xl text-sm leading-7 break-words [overflow-wrap:anywhere] ${isPhotoOnly ? 'p-1' : 'px-3.5 py-2'} ${isMe ? 'rounded-tr-none bg-netease-red/20 text-white' : 'rounded-tl-none bg-netease-dark/80 text-white/90'}`;
  const replyBubbleClass = `min-w-0 max-w-full rounded-2xl px-3 py-1.5 text-sm ${isMe ? 'rounded-tr-none bg-netease-red/20 text-white' : 'rounded-tl-none bg-netease-dark/80 text-white/90'}`;

  const renderReplyPreview = () => {
    if (!msg.replyTo) return null;
    const borderClass = isMe ? 'border-r-2 border-white/20' : 'border-l-2 border-white/20';
    return (
      <div className={`min-w-0 max-w-full rounded-lg bg-black/20 px-2 py-1 text-xs leading-5 text-netease-muted ${borderClass}`}>
        <div className={`flex min-w-0 max-w-full flex-col gap-0.5 ${isMe ? 'items-end text-right' : 'items-start'}`}>
          <span>回复 {msg.replyTo.nickname}：</span>
          {renderReplyRefContent(msg.replyTo, chatScrollRoot, nicknames, isMe)}
        </div>
      </div>
    );
  };

  const renderStickerContent = () => {
    if (!isStickerImage) return null;
    if (!msg.imageUrl) {
      return <span className="text-white/70">[表情包]</span>;
    }
    if (isPureStickerHidden) {
      return (
        <button
          type="button"
          onClick={() => onRevealPureImage(msg.id)}
          className="text-sky-300/90 transition-colors hover:text-sky-200"
          aria-label="加载表情包"
        >
          表情包
        </button>
      );
    }
    return (
      <img
        src={getChatImageDisplayUrl(msg.imageUrl, msg.imageKey)}
        alt="表情包"
        loading="lazy"
        className={CHAT_STICKER_CLASS}
        decoding="async"
        fetchPriority="low"
        onLoad={onContentResize}
      />
    );
  };

  const renderPhotoContent = () => {
    if (!msg.imageUrl || isStickerImage) return null;
    if (pureMode && !pureImageRevealed) {
      return (
        <button
          type="button"
          onClick={() => onRevealPureImage(msg.id)}
          className="text-sky-300/90 transition-colors hover:text-sky-200"
          aria-label="加载查看图片"
        >
          图片
        </button>
      );
    }
    if (pureMode && pureImageRevealed) {
      return (
        <div className="overflow-hidden rounded-lg">
          <img
            src={getChatImageDisplayUrl(msg.imageUrl, msg.imageKey)}
            alt="聊天图片"
            loading="lazy"
            className={CHAT_PHOTO_CLASS}
            decoding="async"
            fetchPriority="low"
            onLoad={onContentResize}
          />
        </div>
      );
    }
    return (
      <Tooltip content="点击查看大图">
        <button
          type="button"
          onClick={() => onPreviewImage(msg.imageUrl!)}
          className="block cursor-zoom-in overflow-hidden rounded-lg"
          aria-label="查看聊天图片"
        >
          <img
            src={getChatImageDisplayUrl(msg.imageUrl, msg.imageKey)}
            alt="聊天图片"
            loading="lazy"
            className={CHAT_PHOTO_CLASS}
            decoding="async"
            fetchPriority="low"
            onLoad={onContentResize}
          />
        </button>
      </Tooltip>
    );
  };

  const avatarNode = showAvatars ? (
    <button
      type="button"
      onClick={handleMention}
      className={`mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold text-white ${
        avatarUrl
          ? ''
          : isRoomCreator
            ? 'bg-gradient-to-br from-amber-500 to-orange-600'
            : isMe
              ? 'bg-gradient-to-br from-netease-red to-pink-500'
              : 'bg-gradient-to-br from-zinc-500 to-zinc-700'
      }`}
      aria-label={msg.nickname}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" loading="lazy" decoding="async" className={`h-full w-full ${isAiBot ? 'bg-netease-dark object-contain p-0.5' : 'object-cover'}`} />
      ) : (
        getDisplayInitial(msg.nickname)
      )}
    </button>
  ) : null;

  return (
    <div className={`group flex w-full min-w-0 max-w-full items-start gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
      {avatarNode}
      <div className={`flex min-w-0 flex-1 flex-col ${showAvatars ? 'max-w-[calc(100%-2.5rem)]' : 'max-w-full'} ${isMe ? 'items-end' : 'items-start'}`}>
        <div className={`mb-1 flex max-w-full min-w-0 items-center gap-1.5 ${isMe ? 'flex-row-reverse' : ''}`}>
          <button
            type="button"
            onClick={handleMention}
            className={`min-w-0 truncate text-[10px] ${isMe ? 'text-netease-red/80' : 'text-netease-muted'} hover:text-white/90`}
          >
            {msg.nickname}
          </button>
          {isAiBot && (
            <button
              type="button"
              onClick={handleMention}
              className="inline-flex items-center rounded border border-amber-300/20 bg-amber-300/10 px-1.5 py-px text-[9px] font-medium text-amber-200 transition-colors hover:bg-amber-300/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
              aria-label={`@${msg.nickname}`}
            >
              <span>AI</span>
            </button>
          )}
          <UserRoleMarks
            isOwner={isRoomCreator}
            isAdmin={isRoomAdmin && !isRoomCreator}
            memberTier={userMemberTier}
          />
          {msg.timestamp > 0 && (
            <Tooltip content={new Date(msg.timestamp).toLocaleString('zh-CN')} side="bottom">
              <time
                dateTime={new Date(msg.timestamp).toISOString()}
                className="text-[10px] text-netease-muted/65 tabular-nums whitespace-nowrap"
              >
                {formatChatTime(msg.timestamp)}
              </time>
            </Tooltip>
          )}
        </div>
        <div className={`flex min-w-0 max-w-full items-start gap-1.5 ${isMe ? 'flex-row-reverse justify-end' : ''}`}>
          <div className={`flex min-w-0 max-w-[min(100%,22rem)] flex-col ${isMe ? 'items-end' : 'items-start'}`}>
            {isStickerImage ? (
              <div className={`flex min-w-0 max-w-full flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
                {msg.replyTo && (
                  <div className={replyBubbleClass} onContextMenu={handleContextMenu}>
                    {renderReplyPreview()}
                  </div>
                )}
                <div className="min-w-0 max-w-full" onContextMenu={handleContextMenu}>
                  {renderStickerContent()}
                </div>
              </div>
            ) : (
              <div className={bubbleClass} onContextMenu={handleContextMenu}>
                {msg.replyTo && (
                  <div className={`mb-1 ${isPhotoOnly ? 'mx-1 mt-1' : ''}`}>
                    {renderReplyPreview()}
                  </div>
                )}
                {renderPhotoContent()}
                {isAiBot ? (
                  <AiMessageContent
                    msgId={msg.id}
                    timestamp={msg.timestamp}
                    messageText={msg.text || ''}
                    aiThoughts={msg.aiThoughts}
                    chatScrollRoot={chatScrollRoot}
                    nicknames={nicknames}
                    onContentResize={onContentResize}
                  />
                ) : msg.text ? renderMessageText(msg.text, 'message', chatScrollRoot, nicknames) : null}
                {msg.songs?.length ? (
                  <div className={`flex flex-col gap-1.5 ${msg.text ? 'mt-1.5' : ''}`}>
                    {msg.songs.map((card) => (
                      <ChatMusicCard
                        key={`${card.source}:${card.id}`}
                        song={card}
                        messageId={msg.id}
                        actions={cardActions}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            {aiProcessing && (
              <div
                className={`mt-1.5 flex max-w-full flex-col gap-1 rounded-xl border px-3 py-2 text-[11px] ${
                  aiProcessing.status === 'error'
                    ? 'border-amber-400/30 bg-amber-950/40 text-amber-100'
                    : 'border-white/10 bg-netease-dark/80 text-netease-muted'
                } ${isMe ? 'self-end' : 'self-start'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 font-medium">
                    {aiProcessing.status !== 'error' && (
                      <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-amber-200" aria-hidden="true" />
                    )}
                    <span className="truncate">
                      {aiProcessing.status === 'error'
                        ? `AI 连续重试失败：${aiProcessing.error || '请稍后再试'}`
                        : aiProcessing.status === 'queued'
                          ? `${aiProcessing.attempt > 0 ? `AI 重试中（${aiProcessing.attempt + 1}/${aiProcessing.maxAttempts}）` : 'AI 排队等待中'}${aiProcessing.queuePosition > 0 ? ` · 第 ${aiProcessing.queuePosition} 位` : ''}`
                          : normalizeAiQqFaceText(aiProcessing.stepText || '', { allowFaces: false }) || `AI 正在处理${aiProcessing.attempt > 0 ? `（${aiProcessing.attempt + 1}/${aiProcessing.maxAttempts}）` : ''}…`}
                    </span>
                  </div>
                  {Array.isArray(aiProcessing.thoughtSteps) && aiProcessing.thoughtSteps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setExpandProcessingSteps((v) => !v);
                        requestAnimationFrame(() => onContentResize?.());
                      }}
                      className="flex flex-shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] hover:bg-white/10 hover:text-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      aria-expanded={expandProcessingSteps}
                    >
                      <span>过程({aiProcessing.thoughtSteps.length})</span>
                      {expandProcessingSteps ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                  )}
                </div>
                {expandProcessingSteps && Array.isArray(aiProcessing.thoughtSteps) && aiProcessing.thoughtSteps.length > 0 && (
                  <ul className="mt-1 space-y-1 border-t border-white/10 pt-1.5 text-[10px]">
                    {aiProcessing.thoughtSteps.map((step, idx) => (
                      <li key={`proc-step-${idx}`} className="flex items-start gap-1.5">
                        <span className="opacity-70">{idx + 1}.</span>
                        <span className="min-w-0 break-words">{normalizeAiQqFaceText(step, { allowFaces: false })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <ChatMessageReactions
              reactions={msg.reactions}
              myUserId={myUserId}
              alignEnd={isMe}
              onToggle={(emoji) => onToggleReaction(msg.id, emoji)}
              containerRef={chatPanelRef}
              scrollRoot={chatScrollRoot}
            />
          </div>
          <div
            className={`relative mt-1 flex flex-col gap-0.5 transition-opacity ${
              reactionPickerOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <Tooltip content="回复">
              <button
                type="button"
                onClick={() => onReply(msg)}
                className="rounded p-0.5 text-netease-muted hover:bg-white/10 hover:text-white"
                aria-label="回复"
              >
                <Reply className="h-3 w-3" />
              </button>
            </Tooltip>
            <Tooltip content="点评表情">
              <button
                type="button"
                disabled={chatMuted}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onOpenReactionPicker(reactionPickerOpen ? null : msg.id)}
                className="rounded p-0.5 text-netease-muted hover:bg-white/10 hover:text-white disabled:opacity-40"
                aria-label="点评表情"
              >
                <Smile className="h-3 w-3" />
              </button>
            </Tooltip>
            {isStickerImage && msg.imageUrl && !isPureStickerHidden && (
              <StickerSaveButton imageUrl={msg.imageUrl} imageKey={msg.imageKey} />
            )}
          </div>
        </div>
      </div>

      <ChatMessageContextMenu
        open={menuPos !== null}
        pos={menuPos}
        canRecall={Boolean(canRecall && onRecall)}
        chatMuted={chatMuted}
        containerRef={chatPanelRef}
        onClose={closeMenu}
        onRecall={() => onRecall?.(msg)}
        onReaction={() => onOpenReactionPicker(msg.id)}
        onReply={() => onReply(msg)}
      />
    </div>
  );
}

function WelcomeChatRow({
  msg,
  onContentResize,
}: {
  msg: ChatMessage;
  onContentResize?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const hasText = Boolean(msg.text?.trim());

  useLayoutEffect(() => {
    if (!onContentResize) return;
    const el = rowRef.current;
    if (!el) return;
    onContentResize();
    const ro = new ResizeObserver(() => onContentResize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [msg.id, msg.text, onContentResize]);

  // 仅礼花、无欢迎语：不占聊天气泡，礼花由列表侧触发
  if (!hasText) {
    return <div ref={rowRef} className="h-0 overflow-hidden" aria-hidden />;
  }

  return (
    <div ref={rowRef} className="flex justify-center py-1">
      <div className="welcome-chat-card max-w-[92%] rounded-2xl px-4 py-3 text-center">
        <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
          {msg.memberTier && <MemberTierBadge tier={msg.memberTier} />}
          {msg.targetNickname && (
            <span className="text-sm font-medium text-white">{msg.targetNickname}</span>
          )}
        </div>
        <p className="break-words text-sm leading-6 text-white/95 [overflow-wrap:anywhere]">{msg.text}</p>
        {msg.timestamp > 0 && (
          <p className="mt-2 text-[10px] text-netease-muted/70">{formatChatTime(msg.timestamp)}</p>
        )}
      </div>
    </div>
  );
}

export default memo(ChatMessageRow);

export { renderReplyRefContent };
