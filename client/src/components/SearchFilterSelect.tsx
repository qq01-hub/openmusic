import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { MusicSource } from '../types';
import Tooltip from './Tooltip';

export type SearchFilterMode = 'smart' | MusicSource;

const BASE_OPTIONS: { value: SearchFilterMode; label: string; hint?: string }[] = [
  { value: 'smart', label: '智能去重', hint: '歌名与歌手相同视为同一首' },
  { value: 'netease', label: '网易' },
  { value: 'tencent', label: 'QQ' },
  { value: 'qishui', label: '汽水' },
  { value: 'kugou', label: '酷狗' },
];

function getLabel(mode: SearchFilterMode, options: typeof BASE_OPTIONS): string {
  return options.find((o) => o.value === mode)?.label ?? '智能去重';
}

interface Props {
  value: SearchFilterMode;
  onChange: (mode: SearchFilterMode) => void;
  /** 可搜索平台（来自 /api/music/sources）；未包含 kugou 时不显示酷狗 */
  searchableSourceIds?: MusicSource[];
}

export default function SearchFilterSelect({
  value,
  onChange,
  searchableSourceIds,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    if (!searchableSourceIds) return BASE_OPTIONS;
    const allowed = new Set(searchableSourceIds);
    return BASE_OPTIONS.filter(
      (opt) => opt.value === 'smart' || allowed.has(opt.value as MusicSource),
    );
  }, [searchableSourceIds]);

  useEffect(() => {
    if (value !== 'smart' && !options.some((o) => o.value === value)) {
      onChange('smart');
    }
  }, [value, options, onChange]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const select = (mode: SearchFilterMode) => {
    onChange(mode);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-hasPopup="listbox"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] sm:text-xs text-white/80 hover:bg-white/10 hover:text-white transition-colors"
      >
        <span className="whitespace-nowrap">{getLabel(value, options)}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="搜索结果筛选"
          className="absolute right-0 top-full z-50 mt-1 min-w-[9.5rem] rounded-xl border border-white/10 bg-[#141419]/84 backdrop-blur-xl [-webkit-backdrop-filter:blur(20px)] shadow-xl py-1 animate-fade-in"
        >
          {options.map((opt, i) => (
            <div key={opt.value}>
              {i === 1 && <div className="my-1 border-t border-white/10" />}
              {opt.hint ? (
                <Tooltip content={opt.hint}>
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
                </Tooltip>
              ) : (
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
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
