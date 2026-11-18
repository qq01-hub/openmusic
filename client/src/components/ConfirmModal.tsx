import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { modalEventBoundary } from './Modal';

interface Props {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  confirmVariant = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmClass = confirmVariant === 'danger'
    ? 'bg-netease-red hover:bg-netease-red/85'
    : 'bg-amber-500 hover:bg-amber-400 text-black';

  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center p-4" {...modalEventBoundary}>
      <button
        type="button"
        className="pointer-events-auto absolute inset-0 bg-[#08090c] backdrop-blur-sm"
        onClick={onCancel}
        aria-label="关闭"
      />
      <div className="relative w-full max-w-sm glass rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="text-sm text-white/75 leading-relaxed mb-6">{message}</div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm text-white/70 hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-xl text-sm text-white transition-colors disabled:opacity-40 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
