import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  DEFAULT_FM_MODE,
  getFmModeOptions,
  normalizeFmMode,
  normalizeFmSource,
  type FmSource,
} from '../api/music/fmMode';

interface Props {
  open: boolean;
  value: string;
  source?: FmSource;
  enabledSources?: FmSource[];
  saving?: boolean;
  onClose: () => void;
  onSave: (mode: string, source: FmSource) => void;
}

const FM_SOURCE_TABS: Array<{ value: FmSource; label: string }> = [
  { value: 'netease', label: '网易' },
  { value: 'tencent', label: 'QQ' },
  { value: 'kugou', label: '酷狗' },
  { value: 'qishui', label: '汽水' },
];

export default function RoomFmModeModal({
  open,
  value,
  source = 'netease',
  enabledSources,
  saving = false,
  onClose,
  onSave,
}: Props) {
  if (!open) return null;

  const availableSources = FM_SOURCE_TABS.filter((tab) => !enabledSources || enabledSources.includes(tab.value));
  const current = normalizeFmMode(value);
  const normalizedSource = normalizeFmSource(source);
  const currentSource = availableSources.some((tab) => tab.value === normalizedSource)
    ? normalizedSource
    : (availableSources[0]?.value || normalizedSource);
  const options = getFmModeOptions(currentSource);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[#08090c] backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative w-full max-w-md animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-5 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">私人漫游模式</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-xs text-netease-muted">
          队列为空时通过私人漫游自动推荐下一首
        </p>

        <div
          className="mb-4 grid gap-1 rounded-lg border border-white/10 bg-black/20 p-1"
          style={{ gridTemplateColumns: `repeat(${Math.max(availableSources.length, 1)}, minmax(0, 1fr))` }}
        >
          {availableSources.map(({ value: item, label }) => {
            const nextOptions = getFmModeOptions(item);
            const nextMode = nextOptions.some((opt) => opt.value === current)
              ? current
              : DEFAULT_FM_MODE;
            return (
              <button
                key={item}
                type="button"
                disabled={saving}
                onClick={() => onSave(nextMode, item)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium ${
                  currentSource === item
                    ? 'bg-white/10 text-white'
                    : 'text-netease-muted hover:bg-white/5 hover:text-white'
                } disabled:opacity-50`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto pr-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={saving}
              onClick={() => onSave(opt.value, currentSource)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                current === opt.value
                  ? 'border-netease-red/25 bg-netease-red/[0.08]'
                  : 'border-transparent bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <p className={`text-sm font-medium ${current === opt.value ? 'text-white' : 'text-white/90'}`}>
                {opt.label}
              </p>
              {opt.description && (
                <p className="mt-0.5 text-xs text-netease-muted">{opt.description}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
