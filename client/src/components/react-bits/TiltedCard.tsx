import {
  useCallback,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from 'react';

export interface TiltedCardProps {
  children: ReactNode;
  className?: string;
  /** 最大倾斜角度，默认 12 */
  rotateAmplitude?: number;
  /** hover 放大，默认 1.02 */
  scaleOnHover?: number;
  /** 跟手红色聚光（与卡片同层变换，避免外层描边错位） */
  spotlightColor?: string;
  disabled?: boolean;
  onClick?: () => void;
  'data-guide'?: string;
}

/**
 * React Bits TiltedCard — 3D 倾斜 + 高光跟随（button 形态，用于房间卡片）。
 */
export default function TiltedCard({
  children,
  className = '',
  rotateAmplitude = 12,
  scaleOnHover = 1.02,
  spotlightColor,
  disabled = false,
  onClick,
  'data-guide': dataGuide,
}: TiltedCardProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const rafRef = useRef<number | null>(null);
  const reduceRef = useRef(false);

  useEffect(() => {
    reduceRef.current =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || window.matchMedia('(pointer: coarse)').matches;
  }, []);

  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    el.style.setProperty('--tc-rx', '0deg');
    el.style.setProperty('--tc-ry', '0deg');
    el.style.setProperty('--tc-scale', '1');
    el.style.setProperty('--tc-mx', '50%');
    el.style.setProperty('--tc-my', '50%');
    el.style.willChange = '';
  }, []);

  const onMove: MouseEventHandler<HTMLButtonElement> = (e) => {
    if (disabled || reduceRef.current) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.style.willChange = 'transform';
      el.style.setProperty('--tc-rx', `${((0.5 - py) * rotateAmplitude).toFixed(2)}deg`);
      el.style.setProperty('--tc-ry', `${((px - 0.5) * rotateAmplitude * 1.15).toFixed(2)}deg`);
      el.style.setProperty('--tc-scale', String(scaleOnHover));
      el.style.setProperty('--tc-mx', `${px * 100}%`);
      el.style.setProperty('--tc-my', `${py * 100}%`);
    });
  };

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const style: CSSProperties | undefined = disabled
    ? undefined
    : {
        transform:
          'perspective(900px) rotateX(var(--tc-rx, 0deg)) rotateY(var(--tc-ry, 0deg)) scale(var(--tc-scale, 1))',
        transition: 'transform 0.18s ease-out, border-color 0.3s ease, box-shadow 0.3s ease',
        transformStyle: 'preserve-3d',
      };

  const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
    type: 'button',
    onClick,
    onMouseMove: onMove,
    onMouseLeave: reset,
    className: `rb-tilted-card relative ${className}`.trim(),
    style,
  };

  return (
    <button ref={ref} data-guide={dataGuide} {...buttonProps}>
      {!disabled && spotlightColor && (
        <div
          aria-hidden
          className="rb-tilted-card__spotlight pointer-events-none absolute inset-0 z-[1] opacity-0 transition-opacity duration-300"
          style={{
            background: `radial-gradient(520px circle at var(--tc-mx, 50%) var(--tc-my, 50%), ${spotlightColor}, transparent 55%)`,
          }}
        />
      )}
      {!disabled && (
        <div
          aria-hidden
          className="rb-tilted-card__glare pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-300"
        />
      )}
      <div className="relative z-[2]" style={{ transformStyle: 'preserve-3d' }}>
        {children}
      </div>
    </button>
  );
}
