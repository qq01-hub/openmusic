import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, MicOff } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { ChatMessage, ChatReplyRef, ChatSongCard, RoomUser, Song } from '../types';
import { isChatMutedForUser } from '../lib/chatMute';
import { getClientId } from '../lib/clientId';
import Tooltip from './Tooltip';
import { usePureModeStore } from '../stores/pureModeStore';
import { useImmersiveModeStore } from '../stores/immersiveModeStore';
import { ChatReactionPicker } from './ChatMessageReactions';
import ChatImageLightbox from './ChatImageLightbox';
import ChatMessageList, { type ChatMessageListHandle } from './ChatMessageList';
import ChatInputBar, { type ChatInputBarHandle, type PendingChatImage } from './ChatInputBar';
import ChatMutePicker from './ChatMutePicker';
import RoomAiDesktopPet from './RoomAiDesktopPet';
import { compactReplyText, compactSongCardsText } from '../lib/chatPanelUtils';
import { useChatRoomMeta, useChatRoomSlice } from '../lib/chatRoomSlice';
import { fetchChatUploadEnabled } from '../api/chatImage';
import { fetchStickerSearchEnabled } from '../api/stickerSearch';
import type { ChatCardActions } from './chatCardActions';
import { useFavorites } from '../hooks/useFavorites';
import { useRoomSongKeySets } from '../hooks/useRoomSongKeySets';
import { songKey } from '../api/music';

export default function ChatPanel({ className = '' }: { className?: string }) {
  const chatRoomSlice = useChatRoomSlice();
  const roomMeta = useChatRoomMeta();
  const rawRoomAi = useRoomStore((s) => s.room?.roomAi);
  const roomAiEnabledFlag = useRoomStore((s) => s.room?.roomAiEnabled);
  const roomAiDeskPetEnabledFlag = useRoomStore((s) => s.room?.roomAiDeskPetEnabled);
  const roomAi = useMemo(() => {
    if (!rawRoomAi) return undefined;
    const deskPetEnabled = (roomAiDeskPetEnabledFlag ?? rawRoomAi.roomAiDeskPetEnabled ?? rawRoomAi.deskPetEnabled) === true
      && rawRoomAi.roomAiDeskPetEnabled !== false && rawRoomAi.deskPetEnabled !== false;
    if (roomAiEnabledFlag === false || rawRoomAi.roomAiEnabled === false || !rawRoomAi.enabled) {
      return {
        ...rawRoomAi,
        enabled: false,
        roomAiEnabled: false,
        deskPetEnabled,
        roomAiDeskPetEnabled: deskPetEnabled,
        wakePrefixes: [],
        commands: [],
      };
    }
    return {
      ...rawRoomAi,
      deskPetEnabled,
      roomAiDeskPetEnabled: deskPetEnabled,
    };
  }, [rawRoomAi, roomAiEnabledFlag, roomAiDeskPetEnabledFlag]);
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const isOwner = useRoomStore((s) => s.isOwner);
  const isAdmin = useRoomStore((s) => s.isAdmin);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const canModerate = isOwner || isAdmin;
  const { sendChat, recallChat, setChatMute, loadChatHistory, toggleChatReaction, addSong } = useSocket();
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { queueKeys } = useRoomSongKeySets();

  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [showMutePicker, setShowMutePicker] = useState(false);
  const [muteSaving, setMuteSaving] = useState(false);
  const [muteError, setMuteError] = useState('');
  const [chatUploadEnabled, setChatUploadEnabled] = useState(false);
  const [stickerSearchEnabled, setStickerSearchEnabled] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingChatImage | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [chatScrollRoot, setChatScrollRoot] = useState<HTMLDivElement | null>(null);
  const [cardPendingKeys, setCardPendingKeys] = useState<Set<string>>(() => new Set());

  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatOverlayHostRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<ChatMessageListHandle>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const isMobileLayout = useMediaQuery('(max-width: 1023px)');
  const pureMode = usePureModeStore((s) => s.enabled);
  const immersiveMode = useImmersiveModeStore((s) => s.enabled);

  const myUserId = mySocketId || getClientId();
  const chatMuted = chatRoomSlice ? isChatMutedForUser(chatRoomSlice, myUserId) : false;

  useEffect(() => {
    void fetchChatUploadEnabled().then(setChatUploadEnabled);
    void fetchStickerSearchEnabled().then(setStickerSearchEnabled);
  }, []);

  useEffect(() => {
    if (!chatRoomSlice?.id) return;
    setMuteError('');
    setCardPendingKeys(new Set());
    setReplyTo(null);
    setPendingImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setReactionPickerMessageId(null);
  }, [chatRoomSlice?.id]);

  useEffect(() => {
    if (!showMutePicker) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMutePicker(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showMutePicker]);

  const handleStickToBottom = useCallback(() => {
    messageListRef.current?.stickToBottom();
  }, []);

  const ensureComposerAboveMiniPlayer = useCallback(() => {
    if (!isMobileLayout) return;
    const panel = chatPanelRef.current;
    if (!panel) return;
    // 根据底栏实际高度避让，歌词独立行等移动端布局变化也能自动适配
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(probe);
    const safeBottom = probe.getBoundingClientRect().height;
    probe.remove();
    const bottomBar = document.getElementById('bottom-bar');
    const bottomBarRect = bottomBar?.getBoundingClientRect();
    const fallbackTop = window.innerHeight - 4.75 * rem - safeBottom;
    const limit = (bottomBarRect ? bottomBarRect.top : fallbackTop) - 8;
    const overflow = panel.getBoundingClientRect().bottom - limit;
    if (overflow <= 1) return;
    let node: HTMLElement | null = panel.parentElement;
    while (node && node !== document.body) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        node.scrollTop += overflow;
        return;
      }
      node = node.parentElement;
    }
  }, [isMobileLayout]);

  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyTo({
      id: msg.id,
      userId: msg.userId,
      nickname: msg.nickname,
      text: compactReplyText(msg.text, msg.imageUrl, msg.imageKey, msg.asSticker)
        || compactSongCardsText(msg.songs),
      imageUrl: msg.imageUrl?.startsWith('data:') ? null : (msg.imageUrl || null),
      imageKey: msg.imageKey || null,
      asSticker: Boolean(msg.asSticker || (msg.imageKey && msg.imageKey.startsWith('local-sticker:'))),
    });
    const isSelf = msg.userId === mySocketId || msg.nickname === nickname;
    requestAnimationFrame(() => {
      ensureComposerAboveMiniPlayer();
      if (!isSelf) {
        inputBarRef.current?.applyReplyMention(msg.nickname);
        return;
      }
      inputBarRef.current?.focus();
    });
  }, [ensureComposerAboveMiniPlayer, mySocketId, nickname]);

  const handleMentionUser = useCallback((user: RoomUser) => {
    inputBarRef.current?.applyReplyMention(user.nickname);
  }, []);

  const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const res = await toggleChatReaction(messageId, emoji);
    if (!res.success && res.error) {
      setMuteError(res.error);
    }
  }, [toggleChatReaction]);

  /** 卡片键 → 收藏 / 点歌接口使用的 Song（封面沿用服务端校验过的直链） */
  const cardSong = useCallback((card: ChatSongCard): Song => ({
    id: card.id,
    source: card.source,
    name: card.name,
    artist: card.artist,
    album: card.album,
    duration: card.duration,
    pic: card.pic,
  }), []);

  const markCardPending = useCallback((key: string, pending: boolean) => {
    setCardPendingKeys((prev) => {
      const next = new Set(prev);
      if (pending) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  const handleCardFavorite = useCallback(async (card: ChatSongCard) => {
    const key = songKey(card);
    markCardPending(`fav:${key}`, true);
    const res = await toggleFavorite(cardSong(card));
    markCardPending(`fav:${key}`, false);
    if (!res.success && res.error) setMuteError(res.error);
  }, [cardSong, markCardPending, toggleFavorite]);

  const handleCardAddToQueue = useCallback(async (card: ChatSongCard) => {
    const key = songKey(card);
    markCardPending(`add:${key}`, true);
    // 服务端仍会按房规 / 冷却 / 上限再校验一次
    const res = await addSong(cardSong(card));
    markCardPending(`add:${key}`, false);
    if (!res.success && res.error) setMuteError(res.error);
  }, [addSong, cardSong, markCardPending]);

  const cardActions = useMemo<ChatCardActions>(() => ({
    favoriteKeys: favoriteIds,
    queueKeys,
    pendingKeys: cardPendingKeys,
    onToggleFavorite: (card) => { void handleCardFavorite(card); },
    onAddToQueue: (card) => { void handleCardAddToQueue(card); },
  }), [cardPendingKeys, favoriteIds, handleCardAddToQueue, handleCardFavorite, queueKeys]);

  const handleRecall = useCallback(async (msg: ChatMessage) => {
    const res = await recallChat(msg.id);
    if (!res.success && res.error) {
      setMuteError(res.error);
    }
  }, [recallChat]);

  const handlePendingImageChange = useCallback((
    image: PendingChatImage | null,
    options?: { revoke?: boolean },
  ) => {
    setPendingImage((current) => {
      const shouldRevoke = options?.revoke !== false;
      if (
        shouldRevoke
        && current?.previewUrl
        && current.previewUrl.startsWith('blob:')
        && current.previewUrl !== image?.previewUrl
      ) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return image;
    });
  }, []);

  const toggleMuteAll = async () => {
    if (muteSaving || !chatRoomSlice) return;
    setMuteSaving(true);
    const res = await setChatMute({ muteAll: !chatRoomSlice.muteAll });
    setMuteSaving(false);
    if (!res.success) setMuteError(res.error || '操作失败');
  };

  const toggleUserMute = async (user: RoomUser) => {
    if (muteSaving || user.id === myUserId || !chatRoomSlice) return;
    setMuteSaving(true);
    const muted = !(chatRoomSlice.mutedUserIds || []).includes(user.id);
    const res = await setChatMute({ userId: user.id, muted });
    setMuteSaving(false);
    if (!res.success) setMuteError(res.error || '操作失败');
  };

  if (!chatRoomSlice || !roomMeta) return null;

  const desktopMutePickerPortal = showMutePicker && !isMobileLayout && chatPanelRef.current ? (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-3">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        onClick={() => setShowMutePicker(false)}
        aria-label="关闭禁言管理"
      />
      <div className="relative z-10 flex w-[min(320px,92%)] max-h-[min(72%,360px)] flex-col rounded-2xl border border-white/10 glass p-4 shadow-2xl animate-fade-in">
        <ChatMutePicker
          slice={chatRoomSlice}
          myUserId={myUserId}
          muteSaving={muteSaving}
          onClose={() => setShowMutePicker(false)}
          onToggleMuteAll={() => { void toggleMuteAll(); }}
          onToggleUserMute={(user) => { void toggleUserMute(user); }}
        />
      </div>
    </div>
  ) : null;

  const mobileMutePickerPortal = showMutePicker && isMobileLayout ? (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setShowMutePicker(false)}
        aria-label="关闭禁言管理"
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[min(75vh,480px)] flex-col rounded-t-2xl border-t border-white/10 glass p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl animate-fade-in">
        <ChatMutePicker
          slice={chatRoomSlice}
          myUserId={myUserId}
          muteSaving={muteSaving}
          onClose={() => setShowMutePicker(false)}
          onToggleMuteAll={() => { void toggleMuteAll(); }}
          onToggleUserMute={(user) => { void toggleUserMute(user); }}
        />
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={chatPanelRef}
      className={`surface-panel relative flex h-full flex-col overflow-hidden rounded-2xl ${className}`}
      onContextMenu={(event) => {
        // 空白区域：禁用浏览器默认菜单；消息体自行 stopPropagation 并弹出自定义菜单
        event.preventDefault();
      }}
    >
      <div className="room-panel-divider flex flex-shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle className="h-4 w-4 text-netease-muted" />
          <h3 className="text-sm font-medium">聊天室</h3>
          {chatRoomSlice.muteAll && (
            <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400/90">全体禁言</span>
          )}
        </div>
        {canModerate && (
          <Tooltip side="bottom" content="禁言管理">
            <button
              type="button"
              onClick={() => setShowMutePicker(true)}
              className="rounded-lg p-1.5 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
              aria-label="禁言管理"
            >
              <MicOff className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>

      {muteError && (
        <p className="flex-shrink-0 px-3 py-1 text-xs text-netease-red">{muteError}</p>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatMessageList
          ref={messageListRef}
          roomMeta={roomMeta}
          myUserId={myUserId}
          mySocketId={mySocketId}
          nickname={nickname}
          pureMode={pureMode}
          chatMuted={chatMuted}
          canModerate={canModerate}
          chatPanelRef={chatPanelRef}
          reactionPickerMessageId={reactionPickerMessageId}
          onReactionPickerChange={setReactionPickerMessageId}
          onReply={handleReply}
          onRecall={handleRecall}
          onMentionUser={handleMentionUser}
          onToggleReaction={handleToggleReaction}
          onPreviewImage={setPreviewImageUrl}
          cardActions={cardActions}
          loadChatHistory={loadChatHistory}
          onScrollRootChange={setChatScrollRoot}
        />
      </div>

      <div ref={chatOverlayHostRef} className="pointer-events-none absolute inset-0 z-30" />

      {!immersiveMode && (
        <RoomAiDesktopPet
          botName={roomAi?.botName || '小肥鱼'}
          deskPetEnabled={roomAi ? roomAi.deskPetEnabled === true : roomAiDeskPetEnabledFlag === true}
          aiEnabled={Boolean(roomAi?.enabled)}
          onQuickWake={(botName) => inputBarRef.current?.applyReplyMention(botName)}
        />
      )}

      <ChatReactionPicker
        open={reactionPickerMessageId !== null}
        disabled={chatMuted}
        scrollRoot={chatScrollRoot}
        containerRef={chatPanelRef}
        overlayHostRef={chatOverlayHostRef}
        onClose={() => setReactionPickerMessageId(null)}
        onPick={(emoji) => {
          if (reactionPickerMessageId) {
            void handleToggleReaction(reactionPickerMessageId, emoji);
          }
        }}
      />

      <ChatInputBar
        ref={inputBarRef}
        roomMeta={roomMeta}
        roomAi={roomAi}
        nickname={nickname}
        mySocketId={mySocketId}
        canControlPlayback={canControlPlayback}
        chatMuted={chatMuted}
        chatUploadEnabled={chatUploadEnabled}
        stickerSearchEnabled={stickerSearchEnabled}
        isMobileLayout={isMobileLayout}
        replyTo={replyTo}
        onReplyChange={setReplyTo}
        pendingImage={pendingImage}
        onPendingImageChange={handlePendingImageChange}
        chatScrollRoot={chatScrollRoot}
        sendChat={sendChat}
        onStickToBottom={handleStickToBottom}
        onPreviewImage={setPreviewImageUrl}
      />

      {desktopMutePickerPortal && createPortal(desktopMutePickerPortal, chatPanelRef.current!)}
      {mobileMutePickerPortal && createPortal(mobileMutePickerPortal, document.body)}

      <ChatImageLightbox
        imageUrl={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    </div>
  );
}
