import { createPortal } from 'react-dom';
import { Megaphone, X } from 'lucide-react';

interface Props {
  open: boolean;
  text: string;
  onClose: () => void;
}

export default function RoomAnnouncementPopup({ open, text, onClose }: Props) {
  if (!open || !text.trim()) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 room-feature-scrim"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="room-feature-dialog relative w-full max-w-md animate-fade-in rounded-2xl border border-amber-400/20 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-amber-300">
            <Megaphone className="h-5 w-5" />
            <h2 className="text-base font-semibold text-white">房间公告</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="max-h-[min(50vh,320px)] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">
          {text}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-netease-red py-2.5 text-sm font-medium text-white transition-colors hover:bg-netease-red/90"
        >
          我知道了
        </button>
      </div>
    </div>,
    document.body,
  );
}
