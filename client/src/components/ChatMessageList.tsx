import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import type { ChatMessage, RoomUser } from '../types';
import type { ChatCardActions } from './chatCardActions';
import Tooltip from './Tooltip';
import ChatMessageRow, { type ChatRoomMeta } from './ChatMessageRow';
import { fireWelcomeConfetti } from '../lib/confettiBurst';
import {
  compactReplyText,
  compactSongCardsText,
  hasMentionAllInText,
  hasMentionInText,
} from '../lib/chatPanelUtils';
import { getClientId } from '../lib/clientId';
import { useRoomStore } from '../stores/roomStore';
import {
  normalizeWelcomeCooldownSec,
  resolveMemberWelcomeSettings,
} from '../lib/memberTierPresets';
import { VariableSizeList, type ListChildComponentProps, type ListOnScrollProps } from 'react-window';

const VIRTUAL_LIST_THRESHOLD = 24;
/**
 * VariableSizeList 用绝对定位；动态行高、图片和音乐卡片加载后会让滚动条估算产生偏差。
 * 保留原生列表，先保证滚动位置和实际内容一致。
 */
const VIRTUAL_LIST_ENABLED = false;
const ROW_GAP_PX = 8;
const ESTIMATED_ROW_HEIGHT = 72;
/** 仅对「刚发生」的迎宾放礼花，避免翻历史重放；覆盖进房 ACK 延迟 */
const WELCOME_CONFETTI_MAX_AGE_MS = 30 * 1000;

interface Props {
  roomMeta: ChatRoomMeta;
  myUserId: string;
  mySocketId: string | null;
  nickname: string;
  pureMode: boolean;
  chatMuted: boolean;
  canModerate?: boolean;
  chatPanelRef: React.RefObject<HTMLDivElement | null>;
  reactionPickerMessageId: string | null;
  onReactionPickerChange: (messageId: string | null) => void;
  onReply: (msg: ChatMessage) => void;
  onRecall?: (msg: ChatMessage) => void;
  onMentionUser: (user: RoomUser) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onPreviewImage: (url: string) => void;
  /** 卡片收藏 / 点歌 / 再分享（ChatPanel 统一维护，避免每张卡片各自订阅） */
  cardActions?: ChatCardActions;
  loadChatHistory: (before: number, beforeId: string) => Promise<{
    success: boolean;
    messages?: ChatMessage[];
    hasMore?: boolean;
    error?: string;
  }>;
  onScrollRootChange?: (root: HTMLDivElement | null) => void;
}

export interface ChatMessageListHandle {
  stickToBottom: () => void;
  getScrollRoot: () => HTMLDivElement | null;
}

type VirtualRowData = {
  messages: ChatMessage[];
  roomMeta: ChatRoomMeta;
  myUserId: string;
  pureMode: boolean;
  chatMuted: boolean;
  canModerate?: boolean;
  chatScrollRoot: HTMLDivElement | null;
  chatPanelRef: React.RefObject<HTMLDivElement | null>;
  reactionPickerMessageId: string | null;
  processingMessages: Map<string, { status: 'queued' | 'processing' | 'error'; queuePosition: number; pendingCount: number; attempt: number; maxAttempts: number; error?: string }>;
  revealedPureImages: Set<string>;
  onReply: (msg: ChatMessage) => void;
  onRecall?: (msg: ChatMessage) => void;
  onMentionUser: (user: RoomUser) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onReactionPickerChange: (messageId: string | null) => void;
  onRevealPureImage: (messageId: string) => void;
  onPreviewImage: (url: string) => void;
  cardActions?: ChatCardActions;
  setRowHeight: (index: number, messageId: string, height: number) => void;
};

function estimateMessageHeight(msg: ChatMessage): number {
  if (msg.kind === 'welcome') {
    return msg.text?.trim() ? 120 : 0;
  }
  if (msg.kind === 'recall' || msg.kind === 'notice') return 36;
  // 头像行 + 昵称行余量（宁可偏高出现空隙，也不要偏低导致重叠）
  let height = 56;
  if (msg.replyTo) height += 44;
  // 音乐卡片高度：未播放约 76px，播放中含歌词行与进度条约 120px
  const cardCount = msg.songs?.length || 0;
  if (cardCount > 0) height += 118 + (cardCount - 1) * 118;
  if (msg.imageUrl) {
    // 贴纸 max-h-28≈112；普通图 max-h-40≈160
    height += msg.imageKey ? 120 : 168;
  } else if (msg.text) {
    // leading-7 ≈ 28px/行
    height += Math.min(160, Math.max(28, Math.ceil(msg.text.length / 22) * 28));
  }
  if (msg.reactions?.length) height += 32;
  return height + ROW_GAP_PX;
}

function VirtualChatRow({ index, style, data }: ListChildComponentProps<VirtualRowData>) {
  const msg = data.messages[index];
  const rowRef = useRef<HTMLDivElement>(null);
  const setRowHeightRef = useRef(data.setRowHeight);
  setRowHeightRef.current = data.setRowHeight;

  const reportSize = useCallback(() => {
    const el = rowRef.current;
    if (!el || !msg) return;
    const measured = Math.ceil(el.getBoundingClientRect().height) + ROW_GAP_PX;
    if (measured > 0) setRowHeightRef.current(index, msg.id, measured);
  }, [index, msg]);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || !msg) return;
    reportSize();
    const ro = new ResizeObserver(() => reportSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [msg, reportSize]);

  if (!msg) return null;

  return (
    <div style={style} className="overflow-hidden">
      <div ref={rowRef} className="px-3">
        <ChatMessageRow
          msg={msg}
          room={data.roomMeta}
          myUserId={data.myUserId}
          pureMode={data.pureMode}
          pureImageRevealed={data.revealedPureImages.has(msg.id)}
          aiProcessing={data.processingMessages.get(msg.id) || null}
          reactionPickerOpen={data.reactionPickerMessageId === msg.id}
          chatMuted={data.chatMuted}
          canModerate={data.canModerate}
          chatScrollRoot={data.chatScrollRoot}
          chatPanelRef={data.chatPanelRef}
          onReply={data.onReply}
          onRecall={data.onRecall}
          onMentionUser={data.onMentionUser}
          onToggleReaction={data.onToggleReaction}
          onOpenReactionPicker={data.onReactionPickerChange}
          onRevealPureImage={data.onRevealPureImage}
          onPreviewImage={data.onPreviewImage}
          cardActions={data.cardActions}
          onContentResize={reportSize}
        />
      </div>
    </div>
  );
}

const ChatMessageList = forwardRef<ChatMessageListHandle, Props>(function ChatMessageList({
  roomMeta,
  myUserId,
  mySocketId,
  nickname,
  pureMode,
  chatMuted,
  canModerate = false,
  chatPanelRef,
  reactionPickerMessageId,
  onReactionPickerChange,
  onReply,
  onRecall,
  onMentionUser,
  onToggleReaction,
  onPreviewImage,
  cardActions,
  loadChatHistory,
  onScrollRootChange,
}, ref) {
  const messages = useChatStore((s) => s.messages);
  const aiProcessing = useChatStore((s) => s.aiProcessing);
  const processingMessages = useMemo(
    () => new Map(aiProcessing.map((task) => [task.sourceMessageId, {
      status: task.status,
      queuePosition: task.queuePosition,
      pendingCount: task.pendingCount,
      attempt: task.attempt,
      maxAttempts: task.maxAttempts,
      error: task.error,
    }])),
    [aiProcessing],
  );
  const hasMoreOlder = useChatStore((s) => s.hasMoreOlder);
  const loadingOlder = useChatStore((s) => s.loadingOlder);

  const [chatScrollRoot, setChatScrollRoot] = useState<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [revealedPureImages, setRevealedPureImages] = useState<Set<string>>(() => new Set());

  const stickToBottomRef = useRef(true);
  const pinningToBottomRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const reactionPickerOpenRef = useRef(false);
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const welcomeConfettiIdsRef = useRef(new Set<string>());
  const welcomeConfettiCooldownRef = useRef(new Map<string, number>());
  const pendingWelcomeConfettiRef = useRef(false);
  const chatConfettiRootRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<VariableSizeList>(null);
  const scrollRafRef = useRef<number | null>(null);
  const rowHeightsRef = useRef(new Map<string, number>());
  const prevMessageCountRef = useRef(0);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const initialScrollDoneRef = useRef(false);
  const allowLoadOlderRef = useRef(false);
  const [showLoadOlderHint, setShowLoadOlderHint] = useState(false);

  const useVirtualList = VIRTUAL_LIST_ENABLED && messages.length >= VIRTUAL_LIST_THRESHOLD;

  reactionPickerOpenRef.current = reactionPickerMessageId !== null;

  const messagesTailKey = useMemo(() => {
    if (messages.length === 0) return '';
    const tail = messages.slice(-3);
    return tail.map((m) => {
      const reactions = (m.reactions || []).map((r) => `${r.emoji}:${r.users.length}`).join(',');
      return `${m.id}:${m.imageUrl || ''}:${reactions}`;
    }).join('|');
  }, [messages]);

  const bindScrollRoot = useCallback((el: HTMLDivElement | null) => {
    setChatScrollRoot(el);
    onScrollRootChange?.(el);
  }, [onScrollRootChange]);

  const scrollToBottomEnd = useCallback((behavior: ScrollBehavior = 'instant') => {
    if (useVirtualList) {
      const count = useChatStore.getState().messages.length;
      if (count > 0) {
        listRef.current?.scrollToItem(count - 1, 'end');
      }
      return;
    }
    // 只滚聊天列表容器，避免 scrollIntoView 带动外层页面，
    // 移动端会把输入区顶到固定迷你播放器下面被挡住。
    const el = chatScrollRoot;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, [chatScrollRoot, useVirtualList]);

  const flushWelcomeConfetti = useCallback(() => {
    if (pureMode || !pendingWelcomeConfettiRef.current) return;
    if (!initialScrollDoneRef.current || pinningToBottomRef.current) return;

    pendingWelcomeConfettiRef.current = false;
    // 聊天区未展开时回退全屏，保证房内其他人也能看到
    fireWelcomeConfetti(chatConfettiRootRef.current);
  }, [pureMode]);

  const scheduleWelcomeConfetti = useCallback(() => {
    pendingWelcomeConfettiRef.current = true;
    requestAnimationFrame(() => {
      flushWelcomeConfetti();
    });
  }, [flushWelcomeConfetti]);

  const finishInitialScroll = useCallback(() => {
    initialScrollDoneRef.current = true;
    allowLoadOlderRef.current = true;
    stickToBottomRef.current = true;
    setShowLoadOlderHint(false);
    setShowScrollToBottom(false);
    flushWelcomeConfetti();
  }, [flushWelcomeConfetti]);

  const pinToBottomUntilStable = useCallback(() => {
    let frames = 0;
    let lastHeight = -1;
    let rafId = 0;
    let cancelled = false;

    const step = () => {
      if (cancelled || initialScrollDoneRef.current) return;

      const el = chatScrollRoot;
      if (!el) {
        rafId = requestAnimationFrame(step);
        return;
      }

      scrollToBottomEnd('instant');
      const height = el.scrollHeight;
      frames += 1;
      const stable = height === lastHeight && frames >= 2;
      lastHeight = height;

      if (stable || frames >= 12) {
        finishInitialScroll();
        return;
      }
      rafId = requestAnimationFrame(step);
    };

    scrollToBottomEnd('instant');
    rafId = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [chatScrollRoot, finishInitialScroll, scrollToBottomEnd]);

  const pinToBottomWhileSticky = useCallback(() => {
    pinningToBottomRef.current = true;
    let frames = 0;
    let lastHeight = -1;
    let rafId = 0;
    let cancelled = false;

    const finish = () => {
      pinningToBottomRef.current = false;
      flushWelcomeConfetti();
    };

    const step = () => {
      if (cancelled || !stickToBottomRef.current) {
        finish();
        return;
      }

      const el = chatScrollRoot;
      if (!el) {
        rafId = requestAnimationFrame(step);
        return;
      }

      scrollToBottomEnd('instant');
      const height = el.scrollHeight;
      frames += 1;
      const stable = height === lastHeight && frames >= 2;
      lastHeight = height;

      if (stable || frames >= 12) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(step);
    };

    scrollToBottomEnd('instant');
    rafId = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      finish();
    };
  }, [chatScrollRoot, flushWelcomeConfetti, scrollToBottomEnd]);

  const setRowHeight = useCallback((index: number, messageId: string, height: number) => {
    if (!(height > 0)) return;
    const prev = rowHeightsRef.current.get(messageId);
    // 只允许增高：图片未加载时测到的偏矮高度不要写回，否则会重叠
    if (prev !== undefined && height <= prev + 1) return;
    rowHeightsRef.current.set(messageId, height);
    listRef.current?.resetAfterIndex(index);
    // 贴底时任何行高修正（估算行高→实测、图片加载）都要重新贴底，
    // 只在最后一行修正时贴底会让首次进房停在离底部差一小截的位置
    if (stickToBottomRef.current && initialScrollDoneRef.current) {
      requestAnimationFrame(() => {
        if (!stickToBottomRef.current) return;
        listRef.current?.scrollToItem(messages.length - 1, 'end');
      });
    }
  }, [messages.length]);

  const getItemSize = useCallback((index: number) => {
    const msg = messages[index];
    if (!msg) return ESTIMATED_ROW_HEIGHT;
    return rowHeightsRef.current.get(msg.id) ?? estimateMessageHeight(msg);
  }, [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    scrollToBottomEnd(behavior);
  }, [scrollToBottomEnd]);

  useEffect(() => {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setShowLoadOlderHint(false);
    notifiedMessageIdsRef.current.clear();
    welcomeConfettiIdsRef.current.clear();
    welcomeConfettiCooldownRef.current.clear();
    pendingWelcomeConfettiRef.current = false;
    setRevealedPureImages(new Set());
    rowHeightsRef.current.clear();
    prevMessageCountRef.current = 0;
    initialScrollDoneRef.current = false;
    allowLoadOlderRef.current = false;
  }, [roomMeta.id]);

  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.height ?? 0);
      if (next > 0) setListHeight(next);
    });
    ro.observe(container);
    setListHeight(Math.floor(container.clientHeight));
    return () => ro.disconnect();
  }, [useVirtualList]);

  useEffect(() => {
    if (pureMode) {
      pendingWelcomeConfettiRef.current = false;
      for (const msg of messages) {
        if (msg.kind === 'welcome') welcomeConfettiIdsRef.current.add(msg.id);
      }
      return;
    }

    const room = useRoomStore.getState().room;
    const now = Date.now();
    for (const msg of messages) {
      if (msg.kind !== 'welcome') continue;
      if (welcomeConfettiIdsRef.current.has(msg.id)) continue;
      // 过旧迎宾不放礼花（翻历史），也不占冷却
      if (now - msg.timestamp > WELCOME_CONFETTI_MAX_AGE_MS) {
        welcomeConfettiIdsRef.current.add(msg.id);
        continue;
      }
      // 本条未开启礼花（仅欢迎语）则跳过
      if (msg.confettiEnabled === false) {
        welcomeConfettiIdsRef.current.add(msg.id);
        continue;
      }

      const targetId = msg.targetUserId || msg.id;
      const tier = msg.targetUserId ? room?.memberTiers?.[msg.targetUserId] : undefined;
      const cooldownMs = normalizeWelcomeCooldownSec(
        resolveMemberWelcomeSettings(tier, room?.memberSettings).welcomeCooldownSec,
      ) * 1000;
      if (cooldownMs > 0) {
        const lastAt = welcomeConfettiCooldownRef.current.get(targetId) || 0;
        if (now - lastAt < cooldownMs) {
          welcomeConfettiIdsRef.current.add(msg.id);
          continue;
        }
      }

      welcomeConfettiIdsRef.current.add(msg.id);
      welcomeConfettiCooldownRef.current.set(targetId, now);
      // 房内全员可见（含贵宾本人与其他成员）
      scheduleWelcomeConfetti();
    }
  }, [messages, pureMode, scheduleWelcomeConfetti]);

  useLayoutEffect(() => {
    if (reactionPickerOpenRef.current) return;

    const outer = chatScrollRoot;
    if (prependAnchorRef.current && outer) {
      const anchor = prependAnchorRef.current;
      prependAnchorRef.current = null;
      outer.scrollTop = anchor.scrollTop + (outer.scrollHeight - anchor.scrollHeight);
      return;
    }

    const needsInitialScroll = messages.length > 0 && !initialScrollDoneRef.current;
    const grew = messages.length > prevMessageCountRef.current;

    if (needsInitialScroll) {
      if (useVirtualList) {
        if (listHeight > 0 && listRef.current) {
          listRef.current.scrollToItem(messages.length - 1, 'end');
          finishInitialScroll();
        }
      } else if (outer) {
        prevMessageCountRef.current = messages.length;
        return pinToBottomUntilStable();
      }
      prevMessageCountRef.current = messages.length;
      return;
    }

    if (!stickToBottomRef.current) {
      prevMessageCountRef.current = messages.length;
      return;
    }

    if (grew) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.kind === 'welcome') {
        return pinToBottomWhileSticky();
      }
      scrollToBottomEnd('instant');
    }

    prevMessageCountRef.current = messages.length;
  }, [messages.length, messagesTailKey, messages, chatScrollRoot, useVirtualList, listHeight, finishInitialScroll, pinToBottomUntilStable, pinToBottomWhileSticky, scrollToBottomEnd]);

  const handleScroll = useCallback(() => {
    const el = chatScrollRoot;
    if (!el) return;

    if (!initialScrollDoneRef.current || pinningToBottomRef.current) return;

    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceToBottom < 80;
    const nearTop = el.scrollTop < 120;
    stickToBottomRef.current = atBottom;
    setShowScrollToBottom((prev) => (prev === !atBottom ? prev : !atBottom));
    setShowLoadOlderHint((prev) => (prev === (nearTop && hasMoreOlder) ? prev : (nearTop && hasMoreOlder)));

    if (!allowLoadOlderRef.current || !initialScrollDoneRef.current) return;
    if (el.scrollTop > 48 || !hasMoreOlder || loadingOlderRef.current) return;

    const oldest = useChatStore.getState().messages[0];
    if (!oldest) return;

    const requestRoomId = roomMeta.id;
    loadingOlderRef.current = true;
    prependAnchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    useChatStore.getState().setLoadingOlder(true);

    void loadChatHistory(oldest.timestamp, oldest.id).then((res) => {
      loadingOlderRef.current = false;
      if (useChatStore.getState().roomId !== requestRoomId) {
        prependAnchorRef.current = null;
        useChatStore.getState().setLoadingOlder(false);
        return;
      }
      if (!res.success || !res.messages?.length) {
        prependAnchorRef.current = null;
        useChatStore.getState().setLoadingOlder(false);
        if (res.success) useChatStore.getState().prependOlder([], false);
        return;
      }

      useChatStore.getState().prependOlder(res.messages, Boolean(res.hasMore));
      // 高度按 messageId 缓存，加载更早消息时不要清空已有高度
      listRef.current?.resetAfterIndex(0);
    });
  }, [chatScrollRoot, roomMeta.id, hasMoreOlder, loadChatHistory]);

  const scheduleHandleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      handleScroll();
    });
  }, [handleScroll]);

  const onVirtualScroll = useCallback((props: ListOnScrollProps) => {
    if (!initialScrollDoneRef.current && stickToBottomRef.current) return;
    if (!props.scrollUpdateWasRequested) handleScroll();
  }, [handleScroll]);

  useEffect(() => {
    const el = chatScrollRoot;
    if (!el || useVirtualList) return;
    el.addEventListener('scroll', scheduleHandleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', scheduleHandleScroll);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [chatScrollRoot, scheduleHandleScroll, useVirtualList]);

  useEffect(() => {
    if (!messages.length || typeof Notification === 'undefined') return;
    const uid = mySocketId || getClientId();
    const myName = nickname.trim();
    const latestMessages = messages.slice(-5);

    for (const msg of latestMessages) {
      if (notifiedMessageIdsRef.current.has(msg.id) || msg.userId === uid) continue;
      const mentionedById = msg.mentions?.some((mention) => mention.id === uid);
      const mentionedByName = myName ? hasMentionInText(msg.text, myName) : false;
      const mentionedByAll = hasMentionAllInText(msg.text);
      if (!mentionedById && !mentionedByName && !mentionedByAll) continue;

      notifiedMessageIdsRef.current.add(msg.id);
      const notify = () => {
        if (Notification.permission !== 'granted') return;
        const notification = new Notification(`${msg.nickname} 提到了你`, {
          body: compactReplyText(msg.text, msg.imageUrl, msg.imageKey, msg.asSticker)
            || compactSongCardsText(msg.songs),
          tag: `openmusic-mention-${roomMeta.id}-${msg.id}`,
          silent: false,
        });
        notification.onclick = () => window.focus();
      };

      if (Notification.permission === 'default') {
        void Notification.requestPermission().then(notify);
      } else {
        notify();
      }
    }
  }, [mySocketId, nickname, roomMeta.id, messages]);

  const handleRevealPureImage = useCallback((messageId: string) => {
    setRevealedPureImages((prev) => {
      if (prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
  }, []);

  const handleStickyContentResize = useCallback(() => {
    if (!stickToBottomRef.current || !initialScrollDoneRef.current || pinningToBottomRef.current) return;
    scrollToBottomEnd('instant');
  }, [scrollToBottomEnd]);

  const stickToBottomOnSend = useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setShowLoadOlderHint(false);
    scrollToBottom('instant');
  }, [scrollToBottom]);

  useImperativeHandle(ref, () => ({
    stickToBottom: stickToBottomOnSend,
    getScrollRoot: () => chatScrollRoot,
  }), [stickToBottomOnSend, chatScrollRoot]);

  const virtualRowData = useMemo<VirtualRowData>(() => ({
    messages,
    roomMeta,
    myUserId,
    pureMode,
    chatMuted,
    canModerate,
    chatScrollRoot,
    chatPanelRef,
    reactionPickerMessageId,
    processingMessages,
    revealedPureImages,
    onReply,
    onRecall,
    onMentionUser,
    onToggleReaction,
    onReactionPickerChange,
    onRevealPureImage: handleRevealPureImage,
    onPreviewImage,
    cardActions,
    setRowHeight,
  }), [
    messages,
    roomMeta,
    myUserId,
    pureMode,
    chatMuted,
    canModerate,
    chatScrollRoot,
    chatPanelRef,
    reactionPickerMessageId,
    processingMessages,
    revealedPureImages,
    onReply,
    onRecall,
    onMentionUser,
    onToggleReaction,
    onReactionPickerChange,
    handleRevealPureImage,
    onPreviewImage,
      setRowHeight,
  ]);

  const renderPlainList = () => (
    <div
      ref={bindScrollRoot}
      className="h-full space-y-2 overflow-x-hidden overflow-y-auto px-3 py-2 pb-3"
    >
      {messages.map((msg) => {
        // 保留原生滚动容器和真实文档流，只让浏览器跳过视口外消息的布局与绘制
        // contain-intrinsic-size 让滚动条继续使用稳定的占位高度，进入视口后由真实高度接管
        const intrinsicSize = estimateMessageHeight(msg);
        return (
          <div
            key={msg.id}
            data-chat-message-row={msg.id}
            className="chat-message-render-boundary"
            style={{ containIntrinsicSize: `auto ${intrinsicSize}px` }}
          >
            <ChatMessageRow
              msg={msg}
              room={roomMeta}
              myUserId={myUserId}
              pureMode={pureMode}
              pureImageRevealed={revealedPureImages.has(msg.id)}
              aiProcessing={processingMessages.get(msg.id) || null}
              reactionPickerOpen={reactionPickerMessageId === msg.id}
              chatMuted={chatMuted}
              canModerate={canModerate}
              chatScrollRoot={chatScrollRoot}
              chatPanelRef={chatPanelRef}
              onReply={onReply}
              onRecall={onRecall}
              onMentionUser={onMentionUser}
              onToggleReaction={onToggleReaction}
              onOpenReactionPicker={onReactionPickerChange}
              onRevealPureImage={handleRevealPureImage}
              onPreviewImage={onPreviewImage}
              cardActions={cardActions}
              onContentResize={handleStickyContentResize}
            />
          </div>
        );
      })}
      <div className="h-px w-full shrink-0" aria-hidden />
    </div>
  );

  return (
    <div ref={chatConfettiRootRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {(loadingOlder || showLoadOlderHint) && (
        <p className="flex-shrink-0 px-3 py-1 text-center text-[10px] text-netease-muted">
          {loadingOlder ? '加载更早的消息…' : '上滑加载更多'}
        </p>
      )}
      {messages.length === 0 ? (
        <p className="py-8 text-center text-xs text-netease-muted">暂无消息，打个招呼吧</p>
      ) : useVirtualList ? (
        <div ref={listContainerRef} className="min-h-0 flex-1">
          {listHeight > 0 && (
            <VariableSizeList
              ref={listRef}
              outerRef={bindScrollRoot}
              height={listHeight}
              width="100%"
              itemCount={messages.length}
              itemSize={getItemSize}
              itemData={virtualRowData}
              itemKey={(index, data) => data.messages[index]?.id ?? index}
              overscanCount={6}
              onScroll={onVirtualScroll}
            >
              {VirtualChatRow}
            </VariableSizeList>
          )}
        </div>
      ) : (
        renderPlainList()
      )}
      {showScrollToBottom && (
        <Tooltip content="回到底部">
          <button
            type="button"
            onClick={() => {
              stickToBottomRef.current = true;
              setShowScrollToBottom(false);
              scrollToBottom('smooth');
            }}
            className="absolute bottom-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-netease-dark/95 text-white shadow-lg backdrop-blur transition-colors hover:bg-white/15"
            aria-label="回到底部"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
    </div>
  );
});

export default ChatMessageList;
