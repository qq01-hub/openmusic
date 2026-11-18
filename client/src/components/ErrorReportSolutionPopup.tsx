import { createPortal } from 'react-dom';
import { CheckCircle2, X } from 'lucide-react';

export interface ErrorReportSolutionNotice {
  id: string;
  description: string;
  solution: string;
  resolvedAt?: number | null;
}

interface Props {
  open: boolean;
  notice: ErrorReportSolutionNotice | null;
  onClose: () => void;
}

export default function ErrorReportSolutionPopup({ open, notice, onClose }: Props) {
  if (!open || !notice) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[#08090c] backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative w-full max-w-md animate-fade-in rounded-2xl border border-emerald-400/20 bg-netease-dark p-5 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            <h2 className="text-base font-semibold text-white">问题已处理</h2>
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
        {notice.description ? (
          <div className="mb-3 rounded-xl border border-white/8 bg-white/5 px-3 py-2">
            <p className="text-[11px] text-white/40">你上报的问题</p>
            <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm text-white/70">
              {notice.description}
            </p>
          </div>
        ) : null}
        <p className="text-[11px] text-white/40">解决方案</p>
        <p className="mt-1 max-h-[min(40vh,280px)] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">
          {notice.solution}
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
