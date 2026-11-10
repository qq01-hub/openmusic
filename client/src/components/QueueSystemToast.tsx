import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useChatSystemToastStore } from '../stores/chatSystemToastStore';
import { useRoomStore } from '../stores/roomStore';
import QueueTip from './queue/QueueTip';

const VISIBLE_MS = 2800;
const FADE_MS = 320;

export function UpcomingSongNotice() {
  const next = useRoomStore((s) => s.room?.upcomingSong);
  const playMode = useRoomStore((s) => s.room?.playMode);

  if (playMode !== 'user-round-robin' || !next) return null;

  const details = `${next.name} · ${next.artist} · 点歌人：${next.requestedBy}`;
  return (
    <div className="min-w-0 flex-1 border-l border-white/15 pl-2.5 text-xs leading-5 [&>span]:min-w-0 [&>span]:max-w-full">
      <QueueTip content={`下一首：${details}`}>
        <span className="flex min-w-0 items-baseline gap-1.5" role="status" aria-live="polite">
          <span className="shrink-0 text-netease-muted">下一首</span>
          <span className="truncate font-medium text-white/85">{details}</span>
        </span>
      </QueueTip>
    </div>
  );
}

/** 队列操作提示与重连状态，居中覆盖在播放队列标题栏 */
export default function QueueSystemToast() {
  const text = useChatSystemToastStore((s) => s.text);
  const seq = useChatSystemToastStore((s) => s.seq);
  const clear = useChatSystemToastStore((s) => s.clear);
  const isReconnecting = useRoomStore((s) => s.isReconnecting);
  const [phase, setPhase] = useState<'hidden' | 'visible' | 'exit'>('hidden');

  useEffect(() => {
    if (!text) {
      setPhase('hidden');
      return;
    }

    setPhase('visible');
    const exitTimer = window.setTimeout(() => setPhase('exit'), VISIBLE_MS);
    const clearTimer = window.setTimeout(() => clear(), VISIBLE_MS + FADE_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(clearTimer);
    };
  }, [text, seq, clear]);

  const showOperation = Boolean(text && phase !== 'hidden');

  return (
    <>
      {isReconnecting ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-2">
          <p
            className="flex max-w-full items-center gap-1.5 truncate rounded-full border border-white/20 bg-black px-3 py-1 text-center text-[11px] leading-4 text-white shadow-lg"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-white/70" />
            <span className="truncate">连接已断开，正在自动重新加入房间…</span>
          </p>
        </div>
      ) : showOperation ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-2">
          <p
            className={`max-w-full truncate rounded-full border border-white/20 bg-black px-3 py-1 text-center text-[11px] leading-4 text-white shadow-lg transition-opacity duration-300 ${
              phase === 'exit' ? 'opacity-0' : 'opacity-100 animate-fade-in'
            }`}
            role="status"
            aria-live="polite"
          >
            {text}
          </p>
        </div>
      ) : null}
    </>
  );
}
