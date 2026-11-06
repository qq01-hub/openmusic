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
  processingMessages: Map<string, { status: 'queued' | 'processing' | 'error'; queuePosition: number; pendingCount: number; attempt: number; maxAttempts: number; error?: string; stepText?: string; thoughtSteps?: string[] }>;
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

type ChatScrollAnchor = { messageId: string; offset: number };

function messageHeight(msg: ChatMessage, heights: Map<string, number>): number {
  return heights.get(msg.id) ?? estimateMessageHeight(msg);
}

function captureScrollAnchor(
  messages: ChatMessage[],
  heights: Map<string, number>,
  scrollTop: number,
): ChatScrollAnchor | null {
  let top = 0;
  for (const msg of messages) {
    const height = messageHeight(msg, heights);
    // 视口顶部落在行间距时，以紧接着的消息为锚点
    if (top + height - ROW_GAP_PX > scrollTop) return { messageId: msg.id, offset: scrollTop - top };
    top += height;
  }
  return null;
}

function resolveScrollAnchor(
  messages: ChatMessage[],
  heights: Map<string, number>,
  anchor: ChatScrollAnchor | null,
): number {
  if (!anchor) return 0;
  let top = 0;
  for (const msg of messages) {
    const height = messageHeight(msg, heights);
    if (msg.id === anchor.messageId) return top + Math.min(anchor.offset, Math.max(0, height - 1));
    top += height;
  }
  return 0;
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
    <div style={style} className="overflow-hidden" data-chat-message-row={msg.id}>
      <div ref={rowRef} className="flow-root px-3">
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
      stepText: task.stepText,
      thoughtSteps: task.thoughtSteps,
    }])),
    [aiProcessing],
  );
  const hasMoreOlder = useChatStore((s) => s.hasMoreOlder);
  const loadingOlder = useChatStore((s) => s.loadingOlder);

  const [chatScrollRoot, setChatScrollRoot] = useState<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState(0);
  const [listWidth, setListWidth] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [revealedPureImages, setRevealedPureImages] = useState<Set<string>>(() => new Set());

  const stickToBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const reactionPickerOpenRef = useRef(false);
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const welcomeConfettiIdsRef = useRef(new Set<string>());
  const welcomeConfettiCooldownRef = useRef(new Map<string, number>());
  const pendingWelcomeConfettiRef = useRef(false);
  const chatConfettiRootRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<VariableSizeList>(null);
  const rowHeightsRef = useRef(new Map<string, number>());
  const pendingRowHeightsRef = useRef(new Map<string, number>());
  const measureFrameRef = useRef<number | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef(messages);
  const committedMessagesRef = useRef<ChatMessage[]>([]);
  const measuredWidthRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const allowLoadOlderRef = useRef(false);
  const [showLoadOlderHint, setShowLoadOlderHint] = useState(false);
  const scrollbarHideTimerRef = useRef<number | null>(null);

  const hasMessages = messages.length > 0;
  messagesRef.current = messages;

  reactionPickerOpenRef.current = reactionPickerMessageId !== null;

  const aiProcessingSignature = useMemo(
    () => aiProcessing.map((t) => `${t.sourceMessageId}:${t.status}:${t.stepText || ''}:${t.thoughtSteps?.length || 0}`).join('|'),
    [aiProcessing],
  );

  const messagesTailKey = useMemo(() => {
    if (messages.length === 0) return '';
    const tail = messages.slice(-3);
    return tail.map((m) => {
      const reactions = (m.reactions || []).map((r) => `${r.emoji}:${r.users.length}`).join(',');
      return `${m.id}:${m.imageUrl || ''}:${reactions}`;
    }).join('|') + `||${aiProcessingSignature}`;
  }, [messages, aiProcessingSignature]);

  const hideChatScrollbar = useCallback(() => {
    const el = chatScrollRoot;
    if (!el) return;
    el.classList.remove('chat-scrollbar-active');
  }, [chatScrollRoot]);

  const showChatScrollbar = useCallback(() => {
    const el = chatScrollRoot;
    if (!el) return;
    el.classList.add('chat-scrollbar-active');
    if (scrollbarHideTimerRef.current !== null) window.clearTimeout(scrollbarHideTimerRef.current);
    scrollbarHideTimerRef.current = window.setTimeout(() => {
      scrollbarHideTimerRef.current = null;
      hideChatScrollbar();
    }, 700);
  }, [chatScrollRoot, hideChatScrollbar]);

  const handleChatPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = chatScrollRoot;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight) return;
    const distanceFromRight = el.getBoundingClientRect().right - event.clientX;
    if (distanceFromRight <= 20) showChatScrollbar();
    else hideChatScrollbar();
  }, [chatScrollRoot, hideChatScrollbar, showChatScrollbar]);

  const bindScrollRoot = useCallback((el: HTMLDivElement | null) => {
    scrollRootRef.current = el;
    setChatScrollRoot(el);
    onScrollRootChange?.(el);
  }, [onScrollRootChange]);

  const scrollToBottomEnd = useCallback(() => {
    const count = messagesRef.current.length;
    if (count > 0) {
      listRef.current?.scrollToItem(count - 1, 'end');
    }
  }, []);

  const flushWelcomeConfetti = useCallback(() => {
    if (pureMode || !pendingWelcomeConfettiRef.current) return;
    if (!initialScrollDoneRef.current) return;

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

  const setRowHeight = useCallback((_index: number, messageId: string, height: number) => {
    if (!(height > 0)) return;
    const prev = rowHeightsRef.current.get(messageId);
    if (prev !== undefined && Math.abs(prev - height) < 1) return;
    pendingRowHeightsRef.current.set(messageId, height);
    if (measureFrameRef.current !== null) return;
    // 同一帧的测量一起更新，避免逐行失效缓存、滚动与测量相互触发
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = null;
      const current = messagesRef.current;
      const heights = rowHeightsRef.current;
      const anchor = captureScrollAnchor(current, heights, scrollRootRef.current?.scrollTop ?? 0);
      let firstChanged = current.length;
      current.forEach((msg, index) => {
        const next = pendingRowHeightsRef.current.get(msg.id);
        if (next === undefined || heights.get(msg.id) === next) return;
        heights.set(msg.id, next);
        firstChanged = Math.min(firstChanged, index);
      });
      pendingRowHeightsRef.current.clear();
      if (firstChanged === current.length) return;
      listRef.current?.resetAfterIndex(firstChanged);
      if (stickToBottomRef.current) {
        listRef.current?.scrollToItem(current.length - 1, 'end');
      } else {
        listRef.current?.scrollTo(resolveScrollAnchor(current, heights, anchor));
      }
    });
  }, []);

  const getItemSize = useCallback((index: number) => {
    const msg = messages[index];
    if (!msg) return ESTIMATED_ROW_HEIGHT;
    return rowHeightsRef.current.get(msg.id) ?? estimateMessageHeight(msg);
  }, [messages]);

  useLayoutEffect(() => {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setShowLoadOlderHint(false);
    notifiedMessageIdsRef.current.clear();
    welcomeConfettiIdsRef.current.clear();
    welcomeConfettiCooldownRef.current.clear();
    pendingWelcomeConfettiRef.current = false;
    setRevealedPureImages(new Set());
    rowHeightsRef.current.clear();
    pendingRowHeightsRef.current.clear();
    committedMessagesRef.current = [];
    initialScrollDoneRef.current = false;
    allowLoadOlderRef.current = false;
  }, [roomMeta.id]);

  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      setListHeight(Math.max(0, Math.floor(entries[0]?.contentRect.height ?? 0)));
      setListWidth(Math.max(0, Math.floor(entries[0]?.contentRect.width ?? 0)));
    });
    ro.observe(container);
    setListHeight(Math.floor(container.clientHeight));
    setListWidth(Math.floor(container.clientWidth));
    return () => ro.disconnect();
  }, [hasMessages]);

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
    if (!listRef.current || listHeight <= 0) return;
    const previous = committedMessagesRef.current;
    const heights = rowHeightsRef.current;
    const anchor = captureScrollAnchor(previous, heights, chatScrollRoot?.scrollTop ?? 0);
    const orderChanged = previous.length !== messages.length
      || previous.some((msg, index) => msg.id !== messages[index]?.id);
    const widthChanged = measuredWidthRef.current > 0 && measuredWidthRef.current !== listWidth;
    committedMessagesRef.current = messages;
    measuredWidthRef.current = listWidth;

    // 宽度变化时保留旧高度作为估值，已挂载行由 ResizeObserver 重测
    // 清空全部估值会先移动阅读位置，再因逐行测量发生二次跳动
    if (orderChanged) {
      const ids = new Set(messages.map(msg => msg.id));
      for (const id of heights.keys()) {
        if (!ids.has(id)) heights.delete(id);
      }
    }
    if (orderChanged || widthChanged) listRef.current.resetAfterIndex(0);

    if (!initialScrollDoneRef.current) {
      scrollToBottomEnd();
      finishInitialScroll();
    } else if (stickToBottomRef.current && !reactionPickerOpenRef.current) {
      scrollToBottomEnd();
    } else if (orderChanged || widthChanged) {
      // 用消息 ID 和消息内偏移保住阅读位置，兼容前插历史与头部消息截断
      listRef.current.scrollTo(resolveScrollAnchor(messages, heights, anchor));
    }
  }, [messages, messagesTailKey, chatScrollRoot, listHeight, listWidth, finishInitialScroll, scrollToBottomEnd]);

  const handleScroll = useCallback(() => {
    const el = chatScrollRoot;
    if (!el) return;

    if (!initialScrollDoneRef.current) return;

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
    useChatStore.getState().setLoadingOlder(true);

    void loadChatHistory(oldest.timestamp, oldest.id).then((res) => {
      loadingOlderRef.current = false;
      if (useChatStore.getState().roomId !== requestRoomId) {
        useChatStore.getState().setLoadingOlder(false);
        return;
      }
      if (!res.success || !res.messages?.length) {
        useChatStore.getState().setLoadingOlder(false);
        if (res.success) useChatStore.getState().prependOlder([], false);
        return;
      }

      useChatStore.getState().prependOlder(res.messages, Boolean(res.hasMore));
    });
  }, [chatScrollRoot, roomMeta.id, hasMoreOlder, loadChatHistory]);

  const onVirtualScroll = useCallback((props: ListOnScrollProps) => {
    if (committedMessagesRef.current !== messages) return;
    if (!initialScrollDoneRef.current && stickToBottomRef.current) return;
    if (!props.scrollUpdateWasRequested) handleScroll();
  }, [handleScroll, messages]);

  useEffect(() => () => {
    if (scrollbarHideTimerRef.current !== null) window.clearTimeout(scrollbarHideTimerRef.current);
    if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current);
  }, []);

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

  const stickToBottomOnSend = useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setShowLoadOlderHint(false);
    scrollToBottomEnd();
  }, [scrollToBottomEnd]);

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
    cardActions,
    setRowHeight,
  ]);

  return (
    <div ref={chatConfettiRootRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {(loadingOlder || showLoadOlderHint) && (
        <p className="flex-shrink-0 px-3 py-1 text-center text-[10px] text-netease-muted">
          {loadingOlder ? '加载更早的消息…' : '上滑加载更多'}
        </p>
      )}
      {messages.length === 0 ? (
        <p className="py-8 text-center text-xs text-netease-muted">暂无消息，打个招呼吧</p>
      ) : (
        <div
          ref={listContainerRef}
          className="min-h-0 flex-1"
          onPointerMove={handleChatPointerMove}
          onPointerLeave={hideChatScrollbar}
        >
          {listHeight > 0 && (
            <VariableSizeList
              ref={listRef}
              outerRef={bindScrollRoot}
              height={listHeight}
              width="100%"
              className="chat-scroll-root"
              style={{ overflowX: 'hidden', overflowAnchor: 'none' }}
              itemCount={messages.length}
              itemSize={getItemSize}
              itemData={virtualRowData}
              itemKey={(index, data) => data.messages[index]?.id ?? index}
              overscanCount={2}
              onScroll={onVirtualScroll}
            >
              {VirtualChatRow}
            </VariableSizeList>
          )}
        </div>
      )}
      {showScrollToBottom && (
        <Tooltip content="回到底部">
          <button
            type="button"
            onClick={() => {
              stickToBottomRef.current = true;
              setShowScrollToBottom(false);
              scrollToBottomEnd();
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
