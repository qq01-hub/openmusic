import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

interface Props<T extends number> {
  value: T;
  options: readonly T[];
  onChange: (size: T) => void;
}

export default function PageSizeSelect<T extends number>({
  value,
  options,
  onChange,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ left: number; bottom: number; minWidth: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setMenuStyle({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 6,
      minWidth: Math.max(rect.width, 88),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const menu = open && menuStyle && createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label="每页条数"
      className="fixed z-[100] rounded-xl border border-white/10 bg-[#141419]/84 py-1 shadow-xl backdrop-blur-xl [-webkit-backdrop-filter:blur(20px)] animate-fade-in"
      style={{
        left: menuStyle.left,
        bottom: menuStyle.bottom,
        minWidth: menuStyle.minWidth,
      }}
    >
      {options.map((size) => (
        <button
          key={size}
          type="button"
          role="option"
          aria-selected={value === size}
          onClick={() => {
            onChange(size);
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
            value === size
              ? 'bg-netease-red/10 text-netease-red'
              : 'text-white/80 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Check className={`h-3.5 w-3.5 flex-shrink-0 ${value === size ? 'opacity-100' : 'opacity-0'}`} />
          <span>{size} 条</span>
        </button>
      ))}
    </div>,
    document.body,
  );

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5">
      <span className="whitespace-nowrap text-[11px] text-netease-muted">每页</span>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1 rounded-lg border border-netease-border/60 bg-netease-card px-2 py-1 text-xs text-white/90 transition-colors hover:border-netease-red/40 hover:text-white"
      >
        <span>{value} 条</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  );
}
