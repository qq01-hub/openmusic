import { memo, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  content: string;
  children: ReactNode;
}

const TIP_CLASS = 'pointer-events-none z-[220] max-w-[min(280px,calc(100vw-24px))] rounded-lg border border-white/10 bg-[#1a1a1a]/95 px-2.5 py-1.5 text-xs leading-snug text-white/90 shadow-xl backdrop-blur-md';

function QueueTip({ content, children }: Props) {
  const [show, setShow] = useState(false);
  const posRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleEnter = useCallback((e: React.PointerEvent) => {
    clearTimeout(timerRef.current);
    posRef.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      setPos(posRef.current);
      setShow(true);
    }, 400);
  }, []);

  const handleMove = useCallback((e: React.PointerEvent) => {
    posRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleLeave = useCallback(() => {
    clearTimeout(timerRef.current);
    setShow(false);
  }, []);

  return (
    <span
      onPointerEnter={handleEnter}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
    >
      {children}
      {show && createPortal(
        <div className={TIP_CLASS} style={{ position: 'fixed', left: pos.x, top: pos.y - 32, transform: 'translateX(-50%)' }}>{content}</div>,
        document.body,
      )}
    </span>
  );
}

export default memo(QueueTip);
