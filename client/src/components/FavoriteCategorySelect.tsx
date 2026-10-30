import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface FavoriteCategoryOption {
  value: string;
  label: string;
}

export function getFavoriteCategoryOptions(categories: string[], currentCategory = ''): FavoriteCategoryOption[] {
  const values = [currentCategory, ...categories].filter(Boolean);
  const unique = [...new Set(values)];
  return [
    { value: '', label: '未分类' },
    ...unique.map((category) => ({ value: category, label: category })),
  ];
}

interface Props {
  value: string;
  categories: string[];
  songName: string;
  disabled?: boolean;
  openOnMount?: boolean;
  onChange: (category: string) => void;
}

export default function FavoriteCategorySelect({
  value,
  categories,
  songName,
  disabled = false,
  openOnMount = false,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const options = getFavoriteCategoryOptions(categories, value);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? '未分类';

  useEffect(() => {
    if (openOnMount) setOpen(true);
  }, [openOnMount]);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const menuHeight = Math.min(options.length * 32 + 8, 280);
    const top = rect.bottom + menuHeight <= window.innerHeight - 8
      ? rect.bottom + 4
      : Math.max(8, rect.top - menuHeight - 4);
    setMenuStyle({ left: rect.left, top, minWidth: Math.max(rect.width, 128) });
  }, [options.length]);

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
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const menu = open && menuStyle && createPortal(
    <div
      ref={menuRef}
      id={listboxId}
      role="listbox"
      aria-label={`为 ${songName} 选择收藏分类`}
      className="fixed z-[130] max-h-[280px] overflow-y-auto rounded-xl border border-white/10 bg-netease-bg/95 py-1 shadow-xl backdrop-blur-md animate-fade-in"
      style={menuStyle}
    >
      {options.map((option) => (
        <button
          key={option.value || 'uncategorized'}
          type="button"
          role="option"
          aria-selected={value === option.value}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
            value === option.value
              ? 'bg-netease-red/10 text-netease-red'
              : 'text-white/80 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Check className={`h-3.5 w-3.5 flex-shrink-0 ${value === option.value ? 'opacity-100' : 'opacity-0'}`} />
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );

  return (
    <div ref={rootRef} className="relative max-w-[11rem]">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-label={`为 ${songName} 选择收藏分类`}
        className="flex w-full items-center justify-between gap-1 rounded-md border border-netease-border bg-netease-dark px-1.5 py-1 text-left text-[11px] text-netease-muted transition-colors hover:border-netease-red/50 hover:text-white focus:border-netease-red/50 focus:outline-none disabled:opacity-50"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  );
}
