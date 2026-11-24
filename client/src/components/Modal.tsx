import { createPortal } from 'react-dom';
import type { SyntheticEvent } from 'react';

export const MODAL_ROOT_ATTR = 'data-modal-root';

const stopModalEvent = (event: SyntheticEvent) => event.stopPropagation();

// Portal 的事件仍会沿 React 父级冒泡，弹窗必须接住完整手势，避免触发页面操作
export const modalEventBoundary = {
  [MODAL_ROOT_ATTR]: '',
  onPointerDown: stopModalEvent,
  onPointerUp: stopModalEvent,
  onMouseDown: stopModalEvent,
  onMouseUp: stopModalEvent,
  onTouchStart: stopModalEvent,
  onTouchEnd: stopModalEvent,
  onClick: stopModalEvent,
  onDoubleClick: stopModalEvent,
  onContextMenu: stopModalEvent,
};

interface Props {
  open: boolean;
  children: React.ReactNode;
  onClose?: () => void;
  /** 是否显示遮罩层，默认 true */
  mask?: boolean;
  /** 点击遮罩是否关闭；mask 为 false 时无效，默认 true */
  closeOnMaskClick?: boolean;
  zIndex?: number;
  panelClassName?: string;
  containerClassName?: string;
}

export function isInsideModalRoot(target: EventTarget | null): boolean {
  return Boolean((target as Element | null)?.closest?.(`[${MODAL_ROOT_ATTR}]`));
}

export default function Modal({
  open,
  children,
  onClose,
  mask = true,
  closeOnMaskClick = true,
  zIndex = 80,
  panelClassName = 'room-feature-dialog relative w-full max-w-sm animate-fade-in rounded-2xl border border-white/10 p-6 shadow-2xl',
  containerClassName = 'fixed inset-0 flex items-center justify-center p-4',
}: Props) {
  if (!open) return null;

  const maskClassName = 'modal-mask pointer-events-auto absolute inset-0 room-feature-scrim';
  const hasSurfaceClass = /\b(room-feature-dialog|account-modal-panel)\b/.test(panelClassName);

  return createPortal(
    <div
      className={containerClassName}
      style={{ zIndex, pointerEvents: 'auto' }}
      {...modalEventBoundary}
    >
      {mask && (
        closeOnMaskClick && onClose ? (
          <button
            type="button"
            className={maskClassName}
            onClick={onClose}
            aria-label="关闭"
          />
        ) : (
          <div className={maskClassName} aria-hidden />
        )
      )}
      <div
        className={`room-modal-panel ${hasSurfaceClass ? '' : 'room-feature-dialog '}${panelClassName}`}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
