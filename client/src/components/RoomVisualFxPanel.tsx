import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, X } from 'lucide-react';
import type { RoomVisualFxSettings } from '../lib/roomVisualPreset';
import RoomVisualFxSettingsBody from './RoomVisualFxSettingsBody';

interface Props {
  open: boolean;
  value: RoomVisualFxSettings;
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void;
  onReset: () => void;
  onClose: () => void;
  onDraggingChange?: (dragging: boolean) => void;
}

export default function RoomVisualFxPanel({
  open,
  value,
  onPatch,
  onReset,
  onClose,
  onDraggingChange,
}: Props) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) setDragging(false);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      {!dragging ? (
        <button
          type="button"
          className="absolute inset-0 cursor-default bg-transparent"
          onClick={onClose}
          aria-label="关闭参数面板"
        />
      ) : null}

      <div
        className={`absolute right-2 top-[3.75rem] bottom-20 z-10 flex max-h-[min(78vh,calc(100%-5.5rem))] w-[13rem] flex-col overflow-hidden sm:right-3 sm:w-[13.5rem] ${
          dragging
            ? 'rounded-2xl border border-transparent bg-transparent shadow-none'
            : 'om-glass-popover rounded-2xl border'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex shrink-0 items-center justify-between px-3.5 py-2.5 ${
            dragging ? 'pointer-events-none invisible border-b border-transparent' : 'border-b border-white/10'
          }`}
        >
          <h2 className="flex items-center gap-1.5 text-xs font-semibold text-white/90">
            <Settings2 className="h-3.5 w-3.5 text-netease-red" />
            视觉参数
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
            tabIndex={dragging ? -1 : 0}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex max-h-[min(68vh,calc(100vh-8rem))] flex-col overflow-y-auto px-3.5 py-3">
          <RoomVisualFxSettingsBody
            value={value}
            onPatch={onPatch}
            onReset={onReset}
            onDraggingChange={(next) => {
              setDragging(next);
              onDraggingChange?.(next);
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
