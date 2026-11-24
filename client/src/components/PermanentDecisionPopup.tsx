import { createPortal } from 'react-dom';
import { CheckCircle2, X, XCircle } from 'lucide-react';

export interface PermanentDecisionNotice {
  id: string;
  roomId: string;
  roomName: string;
  approved: boolean;
  reason?: string;
  at?: number;
}

interface Props {
  open: boolean;
  notice: PermanentDecisionNotice | null;
  onClose: () => void;
}

export default function PermanentDecisionPopup({ open, notice, onClose }: Props) {
  if (!open || !notice) return null;

  const approved = Boolean(notice.approved);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 room-feature-scrim"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className={`room-feature-dialog relative w-full max-w-md animate-fade-in rounded-2xl border p-5 shadow-2xl ${
          approved ? 'border-emerald-400/20' : 'border-amber-400/20'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className={`flex items-center gap-2 ${approved ? 'text-emerald-300' : 'text-amber-300'}`}>
            {approved ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            <h2 className="text-base font-semibold text-white">
              {approved ? '常驻申请已通过' : '常驻申请未通过'}
            </h2>
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

        <div className="mb-3 rounded-xl border border-white/8 bg-white/5 px-3 py-2">
          <p className="text-[11px] text-white/40">房间</p>
          <p className="mt-1 text-sm text-white/90">
            {notice.roomName || notice.roomId}
            <span className="ml-2 font-mono text-[11px] text-white/40">{notice.roomId}</span>
          </p>
        </div>

        {approved ? (
          <p className="text-sm leading-relaxed text-white/80">
            房间已设为常驻：无人时也不会被自动销毁。
          </p>
        ) : (
          <>
            <p className="text-[11px] text-white/40">拒绝原因</p>
            <p className="mt-1 max-h-[min(40vh,280px)] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">
              {notice.reason?.trim() || '管理员未填写具体原因'}
            </p>
          </>
        )}

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
