import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertCircle } from 'lucide-react';

interface Props {
  message: string;
  type?: 'success' | 'error';
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, type = 'success', onClose, duration = 3000 }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCloseRef.current(), duration);
    return () => clearTimeout(timerRef.current);
  }, [message, type, duration]);

  const isSuccess = type === 'success';

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[130] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div
        className={`animate-slide-up inline-flex max-w-[min(22rem,calc(100vw-2rem))] items-center gap-2.5 rounded-2xl px-4 py-2.5 text-sm leading-snug shadow-[0_12px_40px_rgba(0,0,0,0.55)] ${
          isSuccess
            ? 'border border-emerald-400/35 bg-[#0c1210] text-emerald-100'
            : 'border border-amber-400/40 bg-[#14110c] text-amber-50'
        }`}
      >
        <span
          className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
            isSuccess ? 'bg-emerald-500/25 text-emerald-300' : 'bg-amber-400/25 text-amber-300'
          }`}
        >
          {isSuccess ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.25} />}
        </span>
        <span className="min-w-0 truncate font-medium">{message}</span>
      </div>
    </div>,
    document.body,
  );
}
