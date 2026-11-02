import { memo, useRef, useCallback, useState, useEffect } from 'react';

interface Props {
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
  disabled?: boolean;
  className?: string;
  trackClassName?: string;
  fillClassName?: string;
  thumbClassName?: string;
  showThumb?: boolean;
  variant?: 'default' | 'mineradio';
}

function ProgressBar({
  progress,
  duration,
  onSeek,
  disabled = false,
  className = 'h-1',
  trackClassName = 'bg-white/20',
  fillClassName = 'bg-white',
  thumbClassName = 'w-3 h-3',
  showThumb = false,
  variant = 'default',
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const releaseTimer = useRef<number | null>(null);
  const [dragProgress, setDragProgress] = useState<number | null>(null);

  const calcRatio = useCallback((clientX: number) => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const clearReleaseTimer = useCallback(() => {
    if (releaseTimer.current == null) return;
    window.clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    dragging.current = true;
    clearReleaseTimer();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragProgress(calcRatio(e.clientX) * 100);
  };

  useEffect(() => {
    if (disabled) return;
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      setDragProgress(calcRatio(e.clientX) * 100);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      const ratio = calcRatio(e.clientX);
      const nextProgress = ratio * 100;
      setDragProgress(nextProgress);
      clearReleaseTimer();
      releaseTimer.current = window.setTimeout(() => {
        releaseTimer.current = null;
        setDragProgress(null);
      }, 1200);
      if (duration > 0) onSeek(ratio * duration);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [calcRatio, clearReleaseTimer, disabled, duration, onSeek]);

  useEffect(() => {
    if (dragging.current || dragProgress == null) return;
    if (Math.abs(progress - dragProgress) > 0.75) return;
    clearReleaseTimer();
    setDragProgress(null);
  }, [clearReleaseTimer, dragProgress, progress]);

  useEffect(() => () => clearReleaseTimer(), [clearReleaseTimer]);

  const displayProgress = Math.max(0, Math.min(100, dragProgress ?? progress));
  const draggingActive = dragProgress !== null;
  const scale = displayProgress / 100;

  if (variant === 'mineradio') {
    return (
      <div
        ref={barRef}
        className={`mineradio-progress-bar ${draggingActive ? 'is-dragging' : ''} ${disabled ? 'cursor-default' : ''}`}
        onPointerDown={handlePointerDown}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={displayProgress}
      >
        <div className="mineradio-progress-fill" style={{ width: `${displayProgress}%` }} />
        <div className="mineradio-progress-thumb" style={{ left: `${displayProgress}%` }} aria-hidden />
      </div>
    );
  }

  return (
    <div
      ref={barRef}
      className={`relative rounded-full touch-none select-none before:absolute before:-inset-y-2 before:inset-x-0 before:content-[''] ${showThumb ? 'overflow-visible' : 'overflow-hidden'} ${disabled ? 'cursor-default' : 'cursor-pointer'} ${trackClassName} ${className}`}
      onPointerDown={handlePointerDown}
    >
      <div className="h-full w-full overflow-hidden rounded-full">
        <div
          className={`h-full w-full origin-left rounded-full relative ${fillClassName}`}
          style={{ transform: `scaleX(${scale})` }}
        />
      </div>
      {showThumb && (
        <div
          className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-full shadow opacity-100 ${thumbClassName}`}
          style={{ left: `${displayProgress}%` }}
        />
      )}
    </div>
  );
}

export default memo(ProgressBar);
