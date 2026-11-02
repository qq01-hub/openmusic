import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Loader2, Search, Send, Smile, X } from 'lucide-react';
import type { ChatMention, ChatReplyRef, RoomAiConfig, RoomUser } from '../types';
import Tooltip from './Tooltip';
import UserRoleMarks from './UserRoleMarks';
import QFaceImage from './QFaceImage';
import StickerSearchPanel, { STICKER_SEARCH_PICKER_HEIGHT } from './StickerSearchPanel';
import { isInsideModalRoot } from './Modal';
import UserStickerPanel from './UserStickerPanel';
import { renderReplyRefContent } from './ChatMessageRow';
import type { ChatRoomMeta } from './ChatMessageRow';
import {
  MAX_CHAT_LENGTH,
  editorHasDraft,
  editorPlainIncludesAt,
  getActiveMentionDeleteCount,
  getActiveSlashDeleteCount,
  getMentionQueryBeforeCursor,
  getSlashQueryBeforeCursor,
  getSelectedTextLength,
  serializeEditorElement,
} from '../lib/chatEditor';
import {
  MENTION_ALL_LABEL,
  buildMentionPrefix,
  hasMentionAllInText,
  hasMentionInText,
  matchesMentionAllQuery,
  mentionQueryMatchesNickname,
  stripLeadingMention,
  isCompletedMentionQuery,
} from '../lib/chatPanelUtils';
import {
  ensureQQFacesLoaded,
  getInitialQQFaces,
  hasFullQQFaces,
  hydrateQFaceImagesFromCache,
  qqFaceToken,
  requestQFaceImage,
  requestQFaceImages,
  subscribeQQFaces,
  QFaceLoadPriority,
  type QFaceItem,
} from '../lib/qface';
import { uploadChatImage } from '../api/chatImage';
import { ensureImageFile } from '../lib/imageMime';
import { readClipboardImageFile } from '../lib/compressChatImage';
import { getClientId } from '../lib/clientId';
type MentionOption =
  | { type: 'all' }
  | { type: 'bot'; botName: string }
  | { type: 'user'; user: RoomUser };

type SendProgress = 'idle' | 'uploading' | 'sending';

function sendProgressLabel(progress: SendProgress): string {
  switch (progress) {
    case 'uploading':
      return '正在压缩并上传…';
    case 'sending':
      return '发送中…';
    default:
      return '';
  }
}

export type PendingChatImage = {
  url: string;
  key: string;
  previewUrl: string;
};

interface Props {
  roomMeta: ChatRoomMeta;
  roomAi?: RoomAiConfig | null;
  nickname: string;
  mySocketId: string | null;
  canControlPlayback: boolean;
  chatMuted: boolean;
  chatUploadEnabled: boolean;
  stickerSearchEnabled: boolean;
  isMobileLayout: boolean;
  replyTo: ChatReplyRef | null;
  onReplyChange: (reply: ChatReplyRef | null) => void;
  pendingImage: PendingChatImage | null;
  onPendingImageChange: (image: PendingChatImage | null, options?: { revoke?: boolean }) => void;
  chatScrollRoot: HTMLDivElement | null;
  sendChat: (
    text: string,
    options?: {
      mentions?: ChatMention[];
      replyTo?: ChatReplyRef | null;
      imageUrl?: string;
      imageKey?: string;
      asSticker?: boolean;
    },
  ) => Promise<{ success: boolean; error?: string }>;
  onStickToBottom: () => void;
  onPreviewImage: (url: string) => void;
}

export interface ChatInputBarHandle {
  applyReplyMention: (targetNickname: string) => void;
  focus: () => void;
}

const ChatInputBar = forwardRef<ChatInputBarHandle, Props>(function ChatInputBar({
  roomMeta,
  roomAi,
  nickname,
  mySocketId,
  canControlPlayback,
  chatMuted,
  chatUploadEnabled,
  stickerSearchEnabled,
  isMobileLayout,
  replyTo,
  onReplyChange,
  pendingImage,
  onPendingImageChange,
  chatScrollRoot,
  sendChat,
  onStickToBottom,
  onPreviewImage,
}, ref) {
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<SendProgress>('idle');
  const [error, setError] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [showSlashPicker, setShowSlashPicker] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [slashQuery, setSlashQuery] = useState('');
  const [qqFaces, setQQFaces] = useState<QFaceItem[]>(() => getInitialQQFaces());
  const [loadingFaces, setLoadingFaces] = useState(() => !hasFullQQFaces());
  const [emojiGridRoot, setEmojiGridRoot] = useState<HTMLDivElement | null>(null);
  const [emojiPickerTab, setEmojiPickerTab] = useState<'faces' | 'search' | 'wechat'>('faces');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  const inputRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const sendProgressTimerRef = useRef<number | null>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const emojiPickerPortalRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const mentionQueryRef = useRef('');
  const slashQueryRef = useRef('');

  const mentionNicknames = useMemo(
    () => roomMeta.users.map((user) => user.nickname),
    [roomMeta.users],
  );

  const mentionOptions = useMemo<MentionOption[]>(() => {
    const uid = mySocketId || getClientId();
    const query = mentionQuery.trim().toLowerCase();
    const options: MentionOption[] = [];

    if (canControlPlayback && matchesMentionAllQuery(query)) {
      options.push({ type: 'all' });
    }

    if (roomAi?.enabled && roomAi.botName) {
      const botName = roomAi.botName;
      const botLower = botName.toLowerCase();
      if (!query || botLower.startsWith(query) || botLower.includes(query)) {
        options.push({ type: 'bot', botName });
      }
    }

    const userLimit = options.length > 0 ? 7 : 8;
    const users = roomMeta.users
      .filter((user) => user.id !== uid)
      .filter((user) => !user.readOnly)
      .filter((user) => mentionQueryMatchesNickname(query, user.nickname))
      .slice(0, userLimit);

    options.push(...users.map((user) => ({ type: 'user' as const, user })));
    return options.slice(0, 8);
  }, [mentionQuery, mySocketId, roomMeta.users, canControlPlayback, roomAi]);

  const slashOptions = useMemo(() => {
    if (!roomAi?.enabled || !roomAi.commands?.length) return [];
    const query = slashQuery.trim().toLowerCase();
    return roomAi.commands.filter((cmd) => {
      if (!query) return true;
      const hay = `${cmd.label} ${cmd.description} ${cmd.insert}`.toLowerCase();
      return hay.includes(query);
    }).slice(0, 8);
  }, [roomAi, slashQuery]);

  const clearSendProgressTimer = useCallback(() => {
    if (sendProgressTimerRef.current !== null) {
      window.clearTimeout(sendProgressTimerRef.current);
      sendProgressTimerRef.current = null;
    }
  }, []);

  const beginSendProgress = useCallback((options?: {
    uploading?: boolean;
  }) => {
    clearSendProgressTimer();
    if (options?.uploading) {
      setSendProgress('uploading');
      return;
    }
    setSendProgress('sending');
  }, [clearSendProgressTimer]);

  const endSendProgress = useCallback(() => {
    clearSendProgressTimer();
    setSendProgress('idle');
    setSending(false);
  }, [clearSendProgressTimer]);

  useEffect(() => () => clearSendProgressTimer(), [clearSendProgressTimer]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(''), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!showEmoji) setEmojiPickerTab('faces');
  }, [showEmoji]);

  useEffect(() => {
    if (roomAi?.enabled) return;
    setShowSlashPicker(false);
    setSlashQuery('');
    slashQueryRef.current = '';
  }, [roomAi?.enabled]);

  useEffect(() => {
    if (!showEmoji) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (emojiPanelRef.current?.contains(target)) return;
      if (emojiPickerPortalRef.current?.contains(target)) return;
      if (isInsideModalRoot(target)) return;
      setShowEmoji(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showEmoji]);

  useEffect(() => subscribeQQFaces((faces) => {
    setQQFaces(faces);
    setLoadingFaces(!hasFullQQFaces());
  }), []);

  useEffect(() => {
    if (!showEmoji) return;
    ensureQQFacesLoaded();
    // 打开面板：先从 Cache Storage 灌入已看过的表情，减少黑块等待
    const ids = qqFaces.map((face) => face.id);
    void hydrateQFaceImagesFromCache(ids).then(() => {
      requestQFaceImages(ids.slice(0, 48), QFaceLoadPriority.PANEL);
    });
  }, [qqFaces, showEmoji]);

  const syncEditorState = useCallback(() => {
    const editor = inputRef.current;
    if (!editor) return;
    const draft = editorHasDraft(editor);
    setHasDraft((prev) => (prev === draft ? prev : draft));

    const activeSlash = roomAi?.enabled ? getSlashQueryBeforeCursor(editor) : null;
    if (activeSlash !== null) {
      const queryChanged = slashQueryRef.current !== activeSlash;
      slashQueryRef.current = activeSlash;
      setSlashQuery(activeSlash);
      setShowSlashPicker(Boolean(roomAi?.commands?.length));
      setShowMentionPicker(false);
      setMentionQuery('');
      mentionQueryRef.current = '';
      if (queryChanged) setSlashIndex(0);
      return;
    }
    setShowSlashPicker(false);
    setSlashQuery('');
    slashQueryRef.current = '';

    const activeQuery = getMentionQueryBeforeCursor(editor);
    if (activeQuery === null) {
      if (!editorPlainIncludesAt(editor)) {
        setShowMentionPicker(false);
        setMentionQuery('');
        mentionQueryRef.current = '';
      }
      return;
    }
    // 已插入完整 @昵称 后（引用回复/点名），不再弹出候选
    if (isCompletedMentionQuery(activeQuery, mentionNicknames)) {
      setShowMentionPicker(false);
      setMentionQuery('');
      mentionQueryRef.current = '';
      return;
    }
    const queryChanged = mentionQueryRef.current !== activeQuery;
    mentionQueryRef.current = activeQuery;
    setMentionQuery(activeQuery);
    const uid = mySocketId || getClientId();
    const filtered = roomMeta.users
      .filter((user) => user.id !== uid)
      .filter((user) => !user.readOnly)
      .filter((user) => mentionQueryMatchesNickname(activeQuery, user.nickname));
    const showAll = canControlPlayback && matchesMentionAllQuery(activeQuery);
    const showBot = Boolean(roomAi?.enabled && roomAi.botName && (
      !activeQuery.trim()
      || roomAi.botName.toLowerCase().includes(activeQuery.trim().toLowerCase())
    ));
    setShowMentionPicker(filtered.length > 0 || showAll || showBot);
    if (queryChanged) setMentionIndex(0);
  }, [canControlPlayback, mentionNicknames, mySocketId, roomMeta.users, roomAi]);

  const focusEditor = useCallback((editor?: HTMLElement | null) => {
    const el = editor ?? inputRef.current;
    // 移动端禁止 focus 默认滚页，否则输入/回复框会被底部迷你播放器挡住
    el?.focus({ preventScroll: isMobileLayout });
  }, [isMobileLayout]);

  const insertPlainText = useCallback((value: string) => {
    const editor = inputRef.current;
    if (!editor) {
      setHasDraft(Boolean(value.trim()));
      setShowMentionPicker(false);
      return;
    }
    focusEditor(editor);
    document.execCommand('insertText', false, value);
    syncEditorState();
  }, [focusEditor, syncEditorState]);

  const setEditorPlainText = useCallback((value: string) => {
    const editor = inputRef.current;
    if (!editor) {
      setHasDraft(Boolean(value.trim()));
      return;
    }
    editor.textContent = value;
    syncEditorState();
    requestAnimationFrame(() => {
      focusEditor(editor);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, [syncEditorState]);

  const clearEditor = useCallback(() => {
    if (inputRef.current) inputRef.current.textContent = '';
    setHasDraft(false);
    setShowMentionPicker(false);
    setShowSlashPicker(false);
    setMentionQuery('');
    setSlashQuery('');
    mentionQueryRef.current = '';
    slashQueryRef.current = '';
    setMentionIndex(0);
    setSlashIndex(0);
  }, []);

  const buildMentions = useCallback((messageText: string) => {
    const uid = mySocketId || getClientId();
    if (hasMentionAllInText(messageText)) {
      return roomMeta.users
        .filter((user) => user.id !== uid && !user.readOnly)
        .map((user) => ({ id: user.id, nickname: user.nickname }));
    }
    return roomMeta.users
      .filter((user) => hasMentionInText(messageText, user.nickname))
      .slice(0, 10)
      .map((user) => ({ id: user.id, nickname: user.nickname }));
  }, [mySocketId, roomMeta.users]);

  const clearPendingImage = useCallback((options?: { revoke?: boolean }) => {
    onPendingImageChange(null, options);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, [onPendingImageChange]);

  const submitChatImage = useCallback(async (file: File) => {
    if (chatMuted || uploadingImage) return;
    setError('');
    setUploadingImage(true);
    setSendProgress('uploading');
    try {
      const uploaded = await uploadChatImage(roomMeta.id, file);
      onPendingImageChange({
        url: uploaded.url,
        key: uploaded.key,
        previewUrl: uploaded.previewUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploadingImage(false);
      setSendProgress('idle');
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  }, [chatMuted, onPendingImageChange, roomMeta.id, uploadingImage]);

  const handleImagePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await submitChatImage(file);
  };

  const handleSend = async () => {
    const messageText = serializeEditorElement(inputRef.current).trim();
    const currentImage = pendingImage;
    if ((!messageText && !currentImage) || sending) return;

    const mentions = buildMentions(messageText);
    const currentReplyTo = replyTo;

    onStickToBottom();
    clearEditor();
    onReplyChange(null);
    // 发送中先藏起预览，但不 revoke；失败时还要回填同一 blob
    clearPendingImage({ revoke: false });
    setSending(true);
    setError('');
    beginSendProgress();

    const res = await sendChat(messageText, {
      mentions,
      replyTo: currentReplyTo,
      imageUrl: currentImage?.url,
      imageKey: currentImage?.key,
    });
    if (!res.success) {
      insertPlainText(messageText);
      onReplyChange(currentReplyTo);
      if (currentImage) onPendingImageChange(currentImage);
      setError(res.error || '发送失败');
    } else if (currentImage?.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(currentImage.previewUrl);
    }
    endSendProgress();
  };

  const finishStickerSend = (currentReplyTo: ChatReplyRef | null, success: boolean, errorMessage?: string) => {
    if (!success) {
      onReplyChange(currentReplyTo);
      setError(errorMessage || '发送失败');
      endSendProgress();
      throw new Error(errorMessage || '发送失败');
    }
    endSendProgress();
    setShowEmoji(false);
    setEmojiPickerTab('faces');
  };

  const handleSendSticker = async (imageUrl: string) => {
    if (chatMuted || sending) throw new Error(chatMuted ? '当前无法发送' : '正在发送');

    const currentReplyTo = replyTo;
    onStickToBottom();
    onReplyChange(null);
    setSending(true);
    setError('');
    beginSendProgress({});

    const res = await sendChat('', { imageUrl, asSticker: true, replyTo: currentReplyTo });
    finishStickerSend(currentReplyTo, res.success, res.error);
  };

  const handleSendWechatSticker = async (imageUrl: string, imageKey: string) => {
    if (chatMuted || sending) throw new Error(chatMuted ? '当前无法发送' : '正在发送');

    const currentReplyTo = replyTo;
    onStickToBottom();
    onReplyChange(null);
    setSending(true);
    setError('');

    try {
      let res: { success: boolean; error?: string };
      // 已配置图床时先上传，避免数 MB 的 data URL 经 WebSocket 广播导致超时
      if (chatUploadEnabled && (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:'))) {
        beginSendProgress({ uploading: true });
        const blob = await (await fetch(imageUrl)).blob();
        const file = await ensureImageFile(blob, 'sticker');
        if (!file) throw new Error('仅支持 JPG、PNG、GIF、WebP 图片');
        const uploaded = await uploadChatImage(roomMeta.id, file);
        beginSendProgress({});
        res = await sendChat('', {
          imageUrl: uploaded.url,
          imageKey: uploaded.key,
          asSticker: true,
          replyTo: currentReplyTo,
        });
      } else {
        beginSendProgress({});
        res = await sendChat('', {
          imageUrl,
          imageKey,
          asSticker: true,
          replyTo: currentReplyTo,
        });
      }
      finishStickerSend(currentReplyTo, res.success, res.error);
    } catch (err) {
      onReplyChange(currentReplyTo);
      const message = err instanceof Error ? err.message : '发送失败';
      setError(message);
      endSendProgress();
      throw (err instanceof Error ? err : new Error(message));
    }
  };

  const deleteTextBeforeCursor = (count: number) => {
    const editor = inputRef.current;
    if (!editor || count <= 0) return;
    focusEditor(editor);
    for (let i = 0; i < count; i += 1) {
      document.execCommand('delete', false, 'Backward');
    }
  };

  const handleMentionOption = (option: MentionOption) => {
    const editor = inputRef.current;
    if (editor) {
      const deleteCount = getActiveMentionDeleteCount(editor);
      if (deleteCount > 0) deleteTextBeforeCursor(deleteCount);
    }
    const token = option.type === 'all'
      ? `@${MENTION_ALL_LABEL} `
      : option.type === 'bot'
        ? `@${option.botName} `
        : `@${option.user.nickname} `;
    insertPlainText(token);
    setShowMentionPicker(false);
    setMentionQuery('');
    mentionQueryRef.current = '';
    setMentionIndex(0);
    requestAnimationFrame(() => focusEditor());
  };

  const handleSlashOption = (insert: string) => {
    const editor = inputRef.current;
    if (editor) {
      const deleteCount = getActiveSlashDeleteCount(editor);
      if (deleteCount > 0) deleteTextBeforeCursor(deleteCount);
    }
    insertPlainText(insert);
    setShowSlashPicker(false);
    setSlashQuery('');
    slashQueryRef.current = '';
    setSlashIndex(0);
    requestAnimationFrame(() => focusEditor());
  };

  const insertEmoji = (face: QFaceItem) => {
    const editor = inputRef.current;
    const token = qqFaceToken(face.id);
    if (!editor) {
      setHasDraft(true);
      return;
    }
    if (serializeEditorElement(editor).length - getSelectedTextLength(editor) + token.length > MAX_CHAT_LENGTH) {
      setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
      focusEditor(editor);
      setShowMentionPicker(false);
      return;
    }
    void requestQFaceImage(face.id, QFaceLoadPriority.MESSAGE).then(() => {
      const img = document.createElement('img');
      img.src = face.url;
      img.alt = face.text;
      img.title = face.text;
      img.dataset.qqFaceId = face.id;
      img.contentEditable = 'false';
      img.className = 'mx-0.5 inline-block h-5 w-auto max-w-6 object-contain align-[-0.2em]';
      const selection = window.getSelection();
      let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const anchorNode = selection?.anchorNode;
      if (!range || !anchorNode || !editor.contains(anchorNode)) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      requestAnimationFrame(() => {
        focusEditor(editor);
        selection?.removeAllRanges();
        selection?.addRange(range);
        syncEditorState();
      });
    });
  };

  const applyReplyMention = useCallback((targetNickname: string) => {
    const nick = String(targetNickname || '').trim();
    if (!nick) return;
    const body = stripLeadingMention(serializeEditorElement(inputRef.current), mentionNicknames);
    const editor = inputRef.current;
    if (!editor) {
      setHasDraft(true);
      return;
    }
    editor.textContent = '';
    setHasDraft(true);
    insertPlainText(`${buildMentionPrefix(nick)}${body}`.slice(0, MAX_CHAT_LENGTH));
    // 引用/点名已是完整 @昵称，强制关掉候选（离线用户可能不在 nicknames 列表里）
    setShowMentionPicker(false);
    setMentionQuery('');
    mentionQueryRef.current = '';
    setMentionIndex(0);
  }, [insertPlainText, mentionNicknames]);

  useImperativeHandle(ref, () => ({
    applyReplyMention,
    focus: () => focusEditor(),
  }), [applyReplyMention, focusEditor]);

  const renderEmojiTabBar = () => (
    <div className="mb-1.5 flex flex-shrink-0 items-center justify-between px-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEmojiPickerTab('faces')}
          className={`rounded-lg px-2 py-0.5 text-[11px] transition-colors ${emojiPickerTab === 'faces' ? 'bg-white/10 text-white' : 'text-netease-muted hover:bg-white/5 hover:text-white'}`}
        >
          QQ
        </button>
        <button
          type="button"
          onClick={() => setEmojiPickerTab('wechat')}
          className={`rounded-lg px-2 py-0.5 text-[11px] transition-colors ${emojiPickerTab === 'wechat' ? 'bg-white/10 text-white' : 'text-netease-muted hover:bg-white/5 hover:text-white'}`}
        >
          表情包
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        {stickerSearchEnabled && emojiPickerTab !== 'search' && (
          <Tooltip content="搜索表情包">
            <button
              type="button"
              onClick={() => setEmojiPickerTab('search')}
              className="rounded-lg p-1 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
              aria-label="搜索表情包"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}
        {emojiPickerTab === 'faces' && loadingFaces && (
          <span className="text-[11px] text-netease-muted/60">正在补全...</span>
        )}
      </div>
    </div>
  );

  const renderEmojiPickerContent = (gridClassName: string) => {
    if (emojiPickerTab === 'search') {
      return (
        <StickerSearchPanel
          disabled={chatMuted || sending}
          onBack={() => setEmojiPickerTab('faces')}
          onPick={handleSendSticker}
        />
      );
    }

    if (emojiPickerTab === 'wechat') {
      return (
        <>
          {renderEmojiTabBar()}
          <UserStickerPanel
            disabled={chatMuted || sending}
            onSendSticker={handleSendWechatSticker}
          />
        </>
      );
    }

    return (
      <>
        {renderEmojiTabBar()}
        <div ref={setEmojiGridRoot} className={gridClassName}>
          {qqFaces.map((face) => (
            <Tooltip key={face.id} content={face.text}>
              <button
                type="button"
                data-face-id={face.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertEmoji(face)}
                className="flex h-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 active:bg-white/15"
                aria-label={face.text}
              >
                <QFaceImage
                  id={face.id}
                  tooltip={false}
                  priority={QFaceLoadPriority.PANEL}
                  nearPriority={QFaceLoadPriority.NEAR}
                  observeRoot={emojiGridRoot}
                  className="h-6 w-auto max-w-7 object-contain"
                  placeholderClassName="h-6 w-6"
                />
              </button>
            </Tooltip>
          ))}
        </div>
      </>
    );
  };

  const mobileEmojiPickerPortal = showEmoji && isMobileLayout ? (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={() => setShowEmoji(false)}
        aria-label="关闭表情"
      />
      <div
        ref={emojiPickerPortalRef}
        className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t border-netease-border/70 bg-netease-dark/98 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-2xl backdrop-blur ${emojiPickerTab === 'search' ? '' : emojiPickerTab === 'wechat' ? 'h-[min(68vh,480px)]' : 'max-h-[min(68vh,480px)]'}`}
        style={emojiPickerTab === 'search' ? { height: STICKER_SEARCH_PICKER_HEIGHT } : undefined}
      >
        {renderEmojiPickerContent('grid min-h-0 flex-1 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain px-0.5 py-0.5')}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="flex-shrink-0 border-t border-netease-border/50 p-2">
        {chatMuted && (
          <p className="mb-1.5 text-center text-xs text-amber-400/90">
            {roomMeta.muteAll ? '房主已开启全体禁言' : '你已被禁言，无法发送消息'}
          </p>
        )}
        {replyTo && (
          <div className="mb-1.5 flex items-center justify-between rounded-xl bg-white/5 px-2 py-1 text-xs text-netease-muted">
            <span className="min-w-0 flex flex-1 items-center gap-1 overflow-hidden leading-5">
              <span className="flex-shrink-0">回复 {replyTo.nickname}：</span>
              <span className="min-w-0 overflow-hidden">{renderReplyRefContent(replyTo, chatScrollRoot, mentionNicknames)}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                if (replyTo) {
                  const current = serializeEditorElement(inputRef.current);
                  const stripped = stripLeadingMention(current, mentionNicknames);
                  if (stripped !== current) setEditorPlainText(stripped);
                }
                onReplyChange(null);
              }}
              className="ml-2 rounded p-0.5 hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {error && <p className="mb-1 text-xs text-netease-red">{error}</p>}
        {(sending || uploadingImage) && sendProgress !== 'idle' && (
          <p className="mb-1 flex items-center gap-1.5 text-xs text-amber-300/90">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            <span>{sendProgressLabel(sendProgress)}</span>
          </p>
        )}
        {pendingImage && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-white/5 px-2 py-1.5">
            <button
              type="button"
              onClick={() => onPreviewImage(pendingImage.previewUrl || pendingImage.url)}
              className="flex-shrink-0 cursor-zoom-in overflow-hidden rounded-lg"
              aria-label="预览待发送图片"
            >
              <img
                src={pendingImage.previewUrl || pendingImage.url}
                alt="待发送图片"
                className="h-14 w-14 object-cover"
              />
            </button>
            <span className="min-w-0 flex-1 truncate text-xs text-netease-muted">
              {uploadingImage ? '正在压缩并上传…' : '已选择图片，可附带文字后发送'}
            </span>
            <button
              type="button"
              onClick={() => clearPendingImage()}
              className="rounded p-0.5 text-netease-muted hover:bg-white/10 hover:text-white"
              aria-label="移除图片"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="relative flex items-center gap-2" ref={emojiPanelRef}>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(event) => { void handleImagePick(event); }}
          />
          {showEmoji && !isMobileLayout && (
            <div
              className={`absolute bottom-full left-0 z-20 mb-2 box-border flex w-full max-w-full flex-col rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-2 shadow-2xl backdrop-blur ${emojiPickerTab === 'search' ? '' : emojiPickerTab === 'wechat' ? 'h-80' : 'max-h-80'}`}
              style={emojiPickerTab === 'search' ? { height: STICKER_SEARCH_PICKER_HEIGHT } : undefined}
            >
              {renderEmojiPickerContent('grid max-h-64 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain px-0.5 py-0.5')}
            </div>
          )}
          <Tooltip content="表情贴纸">
            <button
              type="button"
              onClick={() => setShowEmoji((value) => !value)}
              disabled={chatMuted}
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-netease-border/50 transition-colors disabled:opacity-40 ${showEmoji ? 'border-netease-red/30 bg-netease-red/15 text-netease-red' : 'bg-netease-dark text-netease-muted hover:bg-white/5 hover:text-white'}`}
              aria-label="表情贴纸"
            >
              <Smile className="h-4 w-4" />
            </button>
          </Tooltip>
          {chatUploadEnabled && (
            <Tooltip content="发送图片（支持粘贴截图）">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={chatMuted || uploadingImage || sending}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-netease-border/50 bg-netease-dark text-netease-muted transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
                aria-label="发送图片"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          <div className="relative min-w-0 flex-1">
            {showSlashPicker && slashOptions.length > 0 && (
              <div className="absolute bottom-full left-0 z-20 mb-2 box-border flex max-h-[min(70vh,32rem)] w-full max-w-full flex-col overflow-hidden rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-1.5 shadow-2xl backdrop-blur">
                <p className="px-2 py-1 text-[10px] text-netease-muted/80">
                  {roomAi?.botName ? `${roomAi.botName} · 命令` : 'AI 命令'}
                </p>
                <div className="min-h-0 overflow-y-auto overscroll-contain">
                  {slashOptions.map((cmd, index) => (
                    <button
                      key={cmd.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setSlashIndex(index)}
                      onClick={() => handleSlashOption(cmd.insert)}
                      className={`flex w-full flex-col rounded-xl px-3 py-2 text-left transition-colors ${index === slashIndex ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/10'}`}
                    >
                      <span className="text-sm text-sky-300">{cmd.label}</span>
                      <span className="text-[11px] text-netease-muted">{cmd.description}</span>
                      <span className="mt-0.5 truncate text-[10px] text-white/40">{cmd.example}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {showMentionPicker && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-1.5 shadow-2xl backdrop-blur">
                {mentionOptions.map((option, index) => (
                  option.type === 'all' ? (
                    <button
                      key="mention-all"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setMentionIndex(index)}
                      onClick={() => handleMentionOption(option)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${index === mentionIndex ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/10'}`}
                    >
                      <span className="min-w-0 truncate text-sky-300">@{MENTION_ALL_LABEL}</span>
                      <span className="ml-2 flex-shrink-0 text-[10px] text-sky-400/80">全员</span>
                    </button>
                  ) : option.type === 'bot' ? (
                    <button
                      key={`mention-bot-${option.botName}`}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setMentionIndex(index)}
                      onClick={() => handleMentionOption(option)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${index === mentionIndex ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/10'}`}
                    >
                      <span className="min-w-0 truncate text-emerald-300">@{option.botName}</span>
                      <span className="ml-2 flex-shrink-0 text-[10px] text-emerald-400/80">AI</span>
                    </button>
                  ) : (
                    <button
                      key={option.user.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setMentionIndex(index)}
                      onClick={() => handleMentionOption(option)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${index === mentionIndex ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/10'}`}
                    >
                      <span className="min-w-0 truncate">{option.user.nickname}</span>
                      <UserRoleMarks
                        className="ml-2"
                        isOwner={option.user.id === roomMeta.creatorId}
                        isAdmin={
                          option.user.id !== roomMeta.creatorId && (
                            roomMeta.adminIds.includes(option.user.id)
                            || (roomMeta.autoPromotedAdminIds || []).includes(option.user.id)
                            || roomMeta.ownerId === option.user.id
                          )
                        }
                        memberTier={roomMeta.memberTiers?.[option.user.id]}
                      />
                    </button>
                  )
                ))}
              </div>
            )}
            {!hasDraft && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-netease-muted/50">{nickname || '你'}说点什么...</span>}
            <div
              ref={inputRef}
              role="textbox"
              aria-label="聊天输入框"
              contentEditable={!chatMuted}
              suppressContentEditableWarning
              onBeforeInput={(event) => {
                const nativeEvent = event.nativeEvent as InputEvent;
                const inputType = nativeEvent.inputType ?? '';
                if (inputType.startsWith('delete') || nativeEvent.isComposing) return;
                const editor = inputRef.current;
                if (!editor) return;
                const data = nativeEvent.data || '';
                if (serializeEditorElement(editor).length - getSelectedTextLength(editor) + data.length > MAX_CHAT_LENGTH) {
                  event.preventDefault();
                  setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
                }
              }}
              onInput={syncEditorState}
              onPaste={(event) => {
                if (chatUploadEnabled && !chatMuted && !uploadingImage) {
                  const clipboardFile = readClipboardImageFile(event.clipboardData);
                  if (clipboardFile) {
                    event.preventDefault();
                    void submitChatImage(clipboardFile);
                    return;
                  }
                }

                event.preventDefault();
                const editor = inputRef.current;
                if (!editor) return;
                const remaining = MAX_CHAT_LENGTH - serializeEditorElement(editor).length + getSelectedTextLength(editor);
                if (remaining <= 0) return setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
                document.execCommand('insertText', false, event.clipboardData.getData('text/plain').slice(0, remaining));
                syncEditorState();
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; syncEditorState(); }}
              onKeyDown={(event) => {
                const hasSlashOptions = showSlashPicker && slashOptions.length > 0;
                const hasMentionOptions = showMentionPicker && mentionOptions.length > 0;
                if (hasSlashOptions && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault();
                  setSlashIndex((current) => {
                    const delta = event.key === 'ArrowDown' ? 1 : -1;
                    return (current + delta + slashOptions.length) % slashOptions.length;
                  });
                  return;
                }
                if (hasSlashOptions && (event.key === 'Tab' || event.key === 'Enter')) {
                  event.preventDefault();
                  const cmd = slashOptions[slashIndex];
                  if (cmd) handleSlashOption(cmd.insert);
                  return;
                }
                if (event.key === 'Escape' && showSlashPicker) {
                  event.preventDefault();
                  setShowSlashPicker(false);
                  setSlashIndex(0);
                  return;
                }
                if (hasMentionOptions && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault();
                  setMentionIndex((current) => {
                    const delta = event.key === 'ArrowDown' ? 1 : -1;
                    return (current + delta + mentionOptions.length) % mentionOptions.length;
                  });
                  return;
                }
                if (hasMentionOptions && (event.key === 'Tab' || event.key === 'Enter')) {
                  event.preventDefault();
                  const option = mentionOptions[mentionIndex];
                  if (option) handleMentionOption(option);
                  return;
                }
                if (event.key === 'Escape' && showMentionPicker) {
                  event.preventDefault();
                  setShowMentionPicker(false);
                  setMentionIndex(0);
                  return;
                }
                if (event.key !== 'Enter') return;
                if (event.nativeEvent.isComposing || composingRef.current) return;
                event.preventDefault();
                void handleSend();
              }}
              className={`scrollbar-hide h-9 overflow-x-auto overflow-y-hidden whitespace-nowrap rounded-xl border border-netease-border/50 bg-netease-dark px-3 py-1.5 text-sm leading-6 text-white focus:border-netease-red/40 focus:outline-none ${chatMuted ? 'opacity-50 pointer-events-none' : ''}`}
            />
          </div>
          <button
            onClick={() => { void handleSend(); }}
            disabled={sending || uploadingImage || (!hasDraft && !pendingImage) || chatMuted}
            className="rounded-xl bg-netease-red px-3 py-1.5 text-white transition-colors hover:bg-netease-red/85 disabled:opacity-40"
            aria-label={sending || uploadingImage ? sendProgressLabel(sendProgress) || '发送中' : '发送'}
          >
            {sending || uploadingImage ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {mobileEmojiPickerPortal && createPortal(mobileEmojiPickerPortal, document.body)}
    </>
  );
});

export default ChatInputBar;
