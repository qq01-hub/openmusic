import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ChatReactionGroup } from '../types';
import QFaceImage from './QFaceImage';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  ensureQQFacesLoaded,
  getInitialQQFaces,
  getReactionPickerFaces,
  hasFullQQFaces,
  parseQQFaceToken,
  PINNED_REACTION_FACE_IDS,
  QFaceLoadPriority,
  qqFaceToken,
  subscribeQQFaces,
  type QFaceItem,
} from '../lib/qface';
import Tooltip from './Tooltip';

const MAX_VISIBLE_GROUPS = 3;

function ReactionFaceButton({
  face,
  onPick,
}: {
  face: QFaceItem;
  onPick: (emoji: string) => void;
}) {
  return (
    <Tooltip content={face.text}>
      <button
        key={face.id}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(qqFaceToken(face.id))}
        className="flex h-10 w-full items-center justify-center overflow-hidden rounded-lg transition-colors hover:bg-white/10 active:bg-white/15"
        aria-label={face.text}
      >
        <QFaceImage
          id={face.id}
          tooltip={false}
          priority={QFaceLoadPriority.PANEL}
          className="h-7 w-7 max-w-full object-contain"
          placeholderClassName="h-7 w-7"
        />
      </button>
    </Tooltip>
  );
}

function ReactionEmoji({ emoji, className = 'h-4 w-4' }: { emoji: string; className?: string }) {
  const faceId = parseQQFaceToken(emoji);
  if (faceId) {
    return (
      <QFaceImage
        id={faceId}
        priority={QFaceLoadPriority.MESSAGE}
        className={`${className} object-contain`}
        placeholderClassName={className}
      />
    );
  }
  return <span className="text-sm leading-none">{emoji}</span>;
}

interface ChatOverlayPortalProps {
  isMobileLayout: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  overlayHostRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  ariaLabel: string;
  panelRef: RefObject<HTMLDivElement | null>;
  desktopPanelClassName: string;
  mobilePanelClassName: string;
  children: ReactNode;
  /** 限制在聊天室容器内（不挂到 document.body）；手机端居中弹窗时忽略 */
  contained?: boolean;
  /** 手机端全屏遮罩 + 居中弹窗（挂 document.body） */
  mobileCentered?: boolean;
}

function ChatOverlayPortal({
  isMobileLayout,
  containerRef,
  overlayHostRef,
  onClose,
  ariaLabel,
  panelRef,
  desktopPanelClassName,
  mobilePanelClassName,
  children,
  contained = false,
  mobileCentered = false,
}: ChatOverlayPortalProps) {
  const useContained = contained && !isMobileLayout;
  const mountNode = useContained
    ? (overlayHostRef?.current ?? containerRef.current)
    : (isMobileLayout ? document.body : containerRef.current);
  if (!mountNode) return null;

  const overlay = isMobileLayout ? (
    <div
      className={`${mobileCentered || !useContained ? 'fixed' : 'absolute'} inset-0 z-[80] pointer-events-auto ${
        mobileCentered ? 'flex items-center justify-center p-4' : ''
      }`}
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#08090c] backdrop-blur-sm"
        onClick={onClose}
        aria-label={ariaLabel}
      />
      <div ref={panelRef as Ref<HTMLDivElement>} className={mobilePanelClassName}>
        {children}
      </div>
    </div>
  ) : (
    <div className="absolute inset-0 z-[60] flex items-center justify-center p-3 pointer-events-auto">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        aria-label={ariaLabel}
      />
      <div ref={panelRef as Ref<HTMLDivElement>} className={desktopPanelClassName}>
        {children}
      </div>
    </div>
  );

  return createPortal(overlay, mountNode);
}

function useOverlayDismiss(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLDivElement | null>,
  scrollRoot?: HTMLElement | null,
  dismissOnScroll = true,
  dismissOnPointerDownOutside = true,
) {
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !scrollRoot || !dismissOnScroll) return;
    const onScroll = () => onClose();
    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollRoot.removeEventListener('scroll', onScroll);
  }, [open, scrollRoot, onClose, dismissOnScroll]);

  useEffect(() => {
    if (!open || !dismissOnPointerDownOutside) return;
    const onPointerDown = (event: PointerEvent) => {
      if (Date.now() - openedAtRef.current < 120) return;
      if (panelRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose, dismissOnPointerDownOutside]);
}

interface ReactionDetailModalProps {
  title: string;
  groups: ChatReactionGroup[];
  myUserId: string;
  onClose: () => void;
  onToggle: (emoji: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  scrollRoot?: HTMLElement | null;
  isMobileLayout: boolean;
}

function ReactionDetailModal({
  title,
  groups,
  myUserId,
  onClose,
  onToggle,
  containerRef,
  scrollRoot = null,
  isMobileLayout,
}: ReactionDetailModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useOverlayDismiss(true, onClose, panelRef, scrollRoot);

  return (
    <ChatOverlayPortal
      isMobileLayout={isMobileLayout}
      containerRef={containerRef}
      mobileCentered
      onClose={onClose}
      ariaLabel="关闭点评详情"
      panelRef={panelRef}
      desktopPanelClassName="relative z-10 flex w-[min(280px,92%)] max-h-[min(72%,320px)] flex-col rounded-2xl border border-netease-border/70 bg-netease-dark/98 p-3 shadow-2xl backdrop-blur"
      mobilePanelClassName="relative z-10 flex w-[min(300px,calc(100%-2rem))] max-h-[min(70vh,360px)] flex-col rounded-2xl border border-netease-border/70 bg-netease-dark/98 p-3 shadow-2xl backdrop-blur"
    >
      <div className="mb-2 flex flex-shrink-0 items-center justify-between">
        <span className="text-sm text-white">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-netease-muted hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {groups.map((group) => {
          const reacted = group.users.some((user) => user.userId === myUserId);
          return (
            <button
              key={group.emoji}
              type="button"
              onClick={() => {
                onToggle(group.emoji);
                onClose();
              }}
              className="flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/10 active:bg-white/15"
            >
              <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center">
                <ReactionEmoji emoji={group.emoji} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1 text-xs leading-5 text-white/90">
                {group.users.map((user) => user.nickname).join('、')}
              </span>
              <span className="flex-shrink-0 text-[10px] text-netease-muted tabular-nums">
                {reacted ? '已点评' : group.users.length}
              </span>
            </button>
          );
        })}
      </div>
    </ChatOverlayPortal>
  );
}

interface ReactionChipProps {
  group: ChatReactionGroup;
  reacted: boolean;
  myUserId: string;
  overflowGroups?: ChatReactionGroup[];
  displayCount?: number;
  onToggle: (emoji: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  scrollRoot?: HTMLElement | null;
  isMobileLayout: boolean;
}

function ReactionChip({
  group,
  reacted,
  myUserId,
  overflowGroups,
  displayCount,
  onToggle,
  containerRef,
  scrollRoot,
  isMobileLayout,
}: ReactionChipProps) {
  const isOverflow = Boolean(overflowGroups?.length);
  const [open, setOpen] = useState(false);
  const count = displayCount ?? group.users.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${
          reacted
            ? 'border-netease-red/40 bg-netease-red/15 text-white'
            : 'border-white/10 bg-black/20 text-white/80 hover:bg-white/10'
        }`}
      >
        {isOverflow ? (
          <span className="px-0.5 text-xs leading-none">…</span>
        ) : (
          <ReactionEmoji emoji={group.emoji} className="h-3.5 w-3.5" />
        )}
        <span className="tabular-nums">{count}</span>
      </button>
      {open && (
        <ReactionDetailModal
          title={isOverflow ? '全部点评' : '点评详情'}
          groups={isOverflow ? overflowGroups! : [group]}
          myUserId={myUserId}
          onClose={() => setOpen(false)}
          onToggle={onToggle}
          containerRef={containerRef}
          scrollRoot={scrollRoot}
          isMobileLayout={isMobileLayout}
        />
      )}
    </>
  );
}

interface ChatMessageReactionsProps {
  reactions?: ChatReactionGroup[];
  myUserId: string;
  alignEnd?: boolean;
  onToggle: (emoji: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  scrollRoot?: HTMLElement | null;
}

export function ChatMessageReactions({
  reactions = [],
  myUserId,
  alignEnd = false,
  onToggle,
  containerRef,
  scrollRoot = null,
}: ChatMessageReactionsProps) {
  const isMobileLayout = useMediaQuery('(max-width: 1023px)');
  const groups = reactions.filter((group) => group.users.length > 0);
  if (groups.length === 0) return null;

  const visible = groups.slice(0, MAX_VISIBLE_GROUPS);
  const hidden = groups.slice(MAX_VISIBLE_GROUPS);

  return (
    <div className={`mt-1 flex flex-wrap items-center gap-1 ${alignEnd ? 'justify-end' : 'justify-start'}`}>
      {visible.map((group) => (
        <ReactionChip
          key={group.emoji}
          group={group}
          reacted={group.users.some((user) => user.userId === myUserId)}
          myUserId={myUserId}
          onToggle={onToggle}
          containerRef={containerRef}
          scrollRoot={scrollRoot}
          isMobileLayout={isMobileLayout}
        />
      ))}
      {hidden.length > 0 && (
        <ReactionChip
          group={{
            emoji: '…',
            users: hidden.flatMap((item) => item.users),
          }}
          reacted={groups.some((group) => group.users.some((user) => user.userId === myUserId))}
          myUserId={myUserId}
          overflowGroups={groups}
          displayCount={groups.length}
          onToggle={onToggle}
          containerRef={containerRef}
          scrollRoot={scrollRoot}
          isMobileLayout={isMobileLayout}
        />
      )}
    </div>
  );
}

interface ChatReactionPickerProps {
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  scrollRoot?: HTMLElement | null;
  containerRef: RefObject<HTMLDivElement | null>;
  overlayHostRef?: RefObject<HTMLDivElement | null>;
}

export function ChatReactionPicker({
  open,
  disabled = false,
  onClose,
  onPick,
  scrollRoot = null,
  containerRef,
  overlayHostRef,
}: ChatReactionPickerProps) {
  const isMobileLayout = useMediaQuery('(max-width: 1023px)');
  const panelRef = useRef<HTMLDivElement>(null);
  const [faces, setFaces] = useState<QFaceItem[]>(() => getInitialQQFaces());
  const [loadingFaces, setLoadingFaces] = useState(() => !hasFullQQFaces());

  useEffect(() => subscribeQQFaces((nextFaces) => {
    setFaces(nextFaces);
    setLoadingFaces(!hasFullQQFaces());
  }), []);

  useEffect(() => {
    if (!open) return;
    ensureQQFacesLoaded();
  }, [open]);

  // 仅通过遮罩 / Esc 关闭，避免新消息渲染或滚动时误触 document pointerdown
  useOverlayDismiss(open, onClose, panelRef, scrollRoot, false, false);

  const sortedFaces = useMemo(() => getReactionPickerFaces(faces), [faces]);
  const pinnedFaces = sortedFaces.slice(0, PINNED_REACTION_FACE_IDS.length);
  const restFaces = sortedFaces.slice(PINNED_REACTION_FACE_IDS.length);

  if (!open || disabled) return null;

  return (
    <ChatOverlayPortal
      isMobileLayout={isMobileLayout}
      containerRef={containerRef}
      overlayHostRef={overlayHostRef}
      contained={!isMobileLayout}
      mobileCentered={isMobileLayout}
      onClose={onClose}
      ariaLabel="关闭点评表情"
      panelRef={panelRef}
      desktopPanelClassName="relative z-10 box-border flex w-[min(280px,calc(100%-1.5rem))] max-h-[min(72%,360px)] flex-col overflow-hidden rounded-2xl border border-netease-border/70 bg-netease-dark/98 p-2.5 shadow-2xl backdrop-blur"
      mobilePanelClassName="relative z-10 box-border flex w-[min(300px,calc(100%-2rem))] max-h-[min(70vh,400px)] flex-col overflow-hidden rounded-2xl border border-netease-border/70 bg-netease-dark/98 p-2.5 shadow-2xl backdrop-blur"
    >
      <div className="mb-1.5 flex flex-shrink-0 items-center justify-between px-0.5">
        <span className="text-[11px] text-netease-muted">点评表情</span>
        <span className="text-[10px] text-netease-muted/60">
          {loadingFaces ? '正在加载…' : '点击选择'}
        </span>
      </div>
      <div className="grid flex-shrink-0 grid-cols-4 gap-1">
        {pinnedFaces.map((face) => (
          <ReactionFaceButton
            key={face.id}
            face={face}
            onPick={(emoji) => {
              onPick(emoji);
              onClose();
            }}
          />
        ))}
      </div>
      {restFaces.length > 0 && (
        <>
          <div className="my-1.5 flex-shrink-0 border-t border-white/10" />
          <div className="grid min-h-0 flex-1 grid-cols-4 gap-1 overflow-y-auto overscroll-contain pb-0.5">
            {restFaces.map((face) => (
              <ReactionFaceButton
                key={face.id}
                face={face}
                onPick={(emoji) => {
                  onPick(emoji);
                  onClose();
                }}
              />
            ))}
          </div>
        </>
      )}
    </ChatOverlayPortal>
  );
}
