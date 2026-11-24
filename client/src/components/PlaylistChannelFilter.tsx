import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { PlaylistChannelFilter } from '../api/music/playlist';

const OPTIONS: { value: PlaylistChannelFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'netease', label: '网易' },
  { value: 'qq', label: 'QQ' },
  { value: 'kugou', label: '酷狗' },
  { value: 'qishui', label: '汽水' },
];

function getLabel(mode: PlaylistChannelFilter): string {
  return OPTIONS.find((o) => o.value === mode)?.label ?? '全部';
}

interface Props {
  value: PlaylistChannelFilter;
  onChange: (mode: PlaylistChannelFilter) => void;
}

export default function PlaylistChannelFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const select = (mode: PlaylistChannelFilter) => {
    onChange(mode);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] sm:text-xs text-white/80 hover:bg-white/10 hover:text-white transition-colors"
      >
        <span className="whitespace-nowrap">{getLabel(value)}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="歌单渠道筛选"
          className="absolute right-0 top-full z-50 mt-1 min-w-[8rem] rounded-xl border border-white/10 bg-[#141419]/84 backdrop-blur-xl [-webkit-backdrop-filter:blur(20px)] shadow-xl py-1 animate-fade-in"
        >
          {OPTIONS.map((opt, i) => (
            <div key={opt.value}>
              {i === 1 && <div className="my-1 border-t border-white/10" />}
              <button
                type="button"
                role="option"
                aria-selected={value === opt.value}
                onClick={() => select(opt.value)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  value === opt.value
                    ? 'text-netease-red bg-netease-red/10'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Check
                  className={`w-3.5 h-3.5 flex-shrink-0 ${value === opt.value ? 'opacity-100' : 'opacity-0'}`}
                />
                <span>{opt.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
