import { createPortal } from 'react-dom';

export const MODAL_ROOT_ATTR = 'data-modal-root';

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
  panelClassName = 'relative w-full max-w-sm animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-6 shadow-2xl',
  containerClassName = 'fixed inset-0 flex items-center justify-center p-4',
}: Props) {
  if (!open) return null;

  const maskClassName = 'modal-mask absolute inset-0 bg-black/70 backdrop-blur-sm';

  return createPortal(
    <div
      className={containerClassName}
      style={{ zIndex }}
      {...{ [MODAL_ROOT_ATTR]: '' }}
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
        className={`room-modal-panel ${panelClassName}`}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
