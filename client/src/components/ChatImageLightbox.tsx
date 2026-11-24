import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
  RefreshCw,
} from 'lucide-react';

interface Props {
  imageUrl: string | null;
  onClose: () => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 7;
const SCALE_RATIO = 1.2;

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export default function ChatImageLightbox({ imageUrl, onClose }: Props) {
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const resetView = useCallback(() => {
    setScale(1);
    setRotate(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!imageUrl) return;
    resetView();
  }, [imageUrl, resetView]);

  useEffect(() => {
    if (!imageUrl) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setScale((current) => clampScale(current * SCALE_RATIO));
      }
      if (event.key === '-') {
        event.preventDefault();
        setScale((current) => clampScale(current / SCALE_RATIO));
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [imageUrl, onClose]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 1 / SCALE_RATIO : SCALE_RATIO;
    setScale((current) => clampScale(current * delta));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (!isDragging || !dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    setOffset({
      x: dragRef.current.ox + dx,
      y: dragRef.current.oy + dy,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!imageUrl) return null;

  const toolbarButtonClass =
    'flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-35';

  return createPortal(
    <div
      className="image-viewer-root fixed inset-0 z-[80] animate-fade-in select-none"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <button
        type="button"
        className="image-viewer-mask absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="关闭图片预览"
      />

      <button
        type="button"
        onClick={onClose}
        className="image-viewer-close absolute right-6 top-6 z-20 flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-all hover:bg-white/10 hover:text-white sm:right-10 sm:top-10"
        aria-label="关闭"
      >
        <X className="h-7 w-7" strokeWidth={1.75} />
      </button>

      <div
        className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <img
          src={imageUrl}
          alt="聊天图片预览"
          draggable={false}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale}) rotate(${rotate}deg)`,
            transition: isDragging ? 'none' : 'transform 0.28s ease',
          }}
          className="max-h-[88vh] max-w-[92vw] cursor-grab object-contain active:cursor-grabbing"
          onClick={(event) => event.stopPropagation()}
        />
      </div>

      <div className="image-viewer-actions pointer-events-none absolute inset-x-0 bottom-8 z-20 flex justify-center px-4 sm:bottom-10">
        <div className="om-glass-popover pointer-events-auto flex h-11 items-center gap-1 rounded-full border px-3">
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => setScale((current) => clampScale(current / SCALE_RATIO))}
            aria-label="缩小"
          >
            <ZoomOut className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => setScale((current) => clampScale(current * SCALE_RATIO))}
            aria-label="放大"
          >
            <ZoomIn className="h-5 w-5" strokeWidth={1.75} />
          </button>

          <span className="mx-1 h-6 w-px bg-white/25" aria-hidden />

          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => setRotate((current) => current - 90)}
            aria-label="逆时针旋转"
          >
            <RotateCcw className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            onClick={() => setRotate((current) => current + 90)}
            aria-label="顺时针旋转"
          >
            <RotateCw className="h-5 w-5" strokeWidth={1.75} />
          </button>

          <span className="mx-1 h-6 w-px bg-white/25" aria-hidden />

          <button
            type="button"
            className={toolbarButtonClass}
            onClick={resetView}
            aria-label="还原"
          >
            <RefreshCw className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
