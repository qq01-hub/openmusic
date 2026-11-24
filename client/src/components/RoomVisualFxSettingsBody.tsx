import { useEffect, useState, type ReactNode } from 'react';
import type { RoomVisualFxSettings } from '../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX } from '../lib/roomVisualPreset';
import Tooltip from './Tooltip';

export type VisualFxSliderKey =
  | 'cameraDistance'
  | 'cinemaShake'
  | 'intensity'
  | 'depth'
  | 'coverResolution'
  | 'point'
  | 'speed'
  | 'twist'
  | 'colorBoost'
  | 'scatter'
  | 'bgFade'
  | 'bloomStrength'
  | 'lyricGlowStrength'
  | 'lyricScale'
  | 'lyricOffsetX'
  | 'lyricOffsetY'
  | 'lyricOffsetZ'
  | 'lyricTiltX'
  | 'lyricTiltY'
  | 'lyricLetterSpacing'
  | 'lyricLineHeight'
  | 'lyricWeight';

interface SliderDef {
  key: VisualFxSliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  formatValue?: (v: number) => string;
  patch?: (v: number, current: RoomVisualFxSettings) => Partial<RoomVisualFxSettings>;
}

export const MOTION_FX_SLIDERS: SliderDef[] = [
  { key: 'intensity', label: '律动强度', min: 0.2, max: 1.6, step: 0.01 },
  { key: 'depth', label: '立体感', min: 0.2, max: 1.8, step: 0.01 },
  { key: 'coverResolution', label: '封面清晰度', min: 0.75, max: 1.55, step: 0.01 },
  {
    key: 'cinemaShake',
    label: '镜头晃动',
    min: 0,
    max: 1.8,
    step: 0.01,
    formatValue: (v) => (v < 0.05 ? '关闭' : v < 0.6 ? '轻微' : v < 1.1 ? '标准' : '强烈'),
  },
  {
    key: 'cameraDistance',
    label: '镜头远近',
    min: 0.55,
    max: 1.65,
    step: 0.01,
    formatValue: (v) => (v < 0.9 ? '较近' : v > 1.1 ? '较远' : '默认'),
  },
];

export const LYRIC_FX_SLIDERS: SliderDef[] = [
  { key: 'lyricGlowStrength', label: '歌词溢光', min: 0, max: 0.85, step: 0.01 },
  { key: 'lyricScale', label: '歌词大小', min: 0.35, max: 1.65, step: 0.01 },
  { key: 'lyricOffsetX', label: '左右位置', min: -2, max: 2, step: 0.01 },
  { key: 'lyricOffsetY', label: '上下位置', min: -1.2, max: 1.35, step: 0.01 },
  { key: 'lyricOffsetZ', label: '前后景深', min: -1.6, max: 1.6, step: 0.01 },
  { key: 'lyricTiltX', label: '上下旋转', min: -42, max: 42, step: 1 },
  { key: 'lyricTiltY', label: '左右旋转', min: -42, max: 42, step: 1 },
];

export const LYRIC_TYPOGRAPHY_SLIDERS: SliderDef[] = [
  { key: 'lyricLetterSpacing', label: '字间距', min: -0.04, max: 0.18, step: 0.005 },
  { key: 'lyricLineHeight', label: '行距', min: 0.72, max: 1.8, step: 0.01 },
  { key: 'lyricWeight', label: '字重', min: 500, max: 900, step: 50 },
];

export const ADVANCED_FX_SLIDERS: SliderDef[] = [
  { key: 'point', label: '粒子尺寸', min: 0.5, max: 2.2, step: 0.01 },
  { key: 'speed', label: '流速', min: 0.2, max: 2.5, step: 0.01 },
  { key: 'twist', label: '扭曲', min: 0, max: 0.6, step: 0.01 },
  { key: 'colorBoost', label: '色彩张力', min: 0.5, max: 2, step: 0.01 },
  { key: 'scatter', label: '离散感', min: 0, max: 0.5, step: 0.01 },
  { key: 'bgFade', label: '背景压缩', min: 0, max: 1.2, step: 0.01 },
  {
    key: 'bloomStrength',
    label: '溢光强度',
    min: 0,
    max: 1.6,
    step: 0.01,
    patch: (bloomStrength) => ({
      bloomStrength,
      bloom: bloomStrength > 0.01,
    }),
  },
];

/** @deprecated 沉浸模式请用分 Tab 的 MOTION / LYRIC / ADVANCED 列表 */
export const VISUAL_FX_SLIDERS: SliderDef[] = [
  ...MOTION_FX_SLIDERS,
  ...ADVANCED_FX_SLIDERS,
];

function rangePct(v: number, min: number, max: number): string {
  const pct = ((v - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, pct))}%`;
}

export function FxSectionLabel({ children }: { children: ReactNode }) {
  return <div className="fx-section-label">{children}</div>;
}

export function FxSlider({
  def,
  value,
  onLiveChange,
  onDragStart,
}: {
  def: SliderDef;
  value: number;
  onLiveChange: (v: number) => void;
  onDragStart: () => void;
}) {
  const pct = rangePct(value, def.min, def.max);
  const display = def.formatValue ? def.formatValue(value) : value.toFixed(2);

  return (
    <div className="pointer-events-auto select-none">
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        <label className="text-[10.5px] font-medium text-white/58">{def.label}</label>
        <output className="text-[11px] tabular-nums text-white/50">{display}</output>
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragStart();
        }}
        onInput={(e) => onLiveChange(Number(e.currentTarget.value))}
        onChange={(e) => onLiveChange(Number(e.currentTarget.value))}
        style={{ ['--range-pct' as string]: pct }}
        className="visual-fx-range w-full"
        aria-label={def.label}
      />
    </div>
  );
}

export function FxToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="pointer-events-auto flex items-center justify-between gap-2 px-0.5">
      <span className="text-xs font-medium text-white/75">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-netease-red/90' : 'bg-white/15'}`}
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export function FxMineradioSlider({
  def,
  value,
  defaultValue,
  onLiveChange,
  onDragStart,
  onReset,
}: {
  def: SliderDef;
  value: number;
  defaultValue: number;
  onLiveChange: (v: number) => void;
  onDragStart: () => void;
  onReset: () => void;
}) {
  const display = def.formatValue ? def.formatValue(value) : value.toFixed(def.step < 0.01 ? 3 : def.step < 1 ? 2 : 0);
  const pct = rangePct(value, def.min, def.max);

  return (
    <div className="fx-slider pointer-events-auto select-none">
      <label>{def.label}</label>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        style={{ ['--range-pct' as string]: pct }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragStart();
        }}
        onInput={(e) => onLiveChange(Number(e.currentTarget.value))}
        onChange={(e) => onLiveChange(Number(e.currentTarget.value))}
        aria-label={def.label}
      />
      <output>{display}</output>
      <Tooltip content="恢复当前滑条默认值" side="top">
        <button
          type="button"
          className="fx-reset-one"
          aria-label="恢复当前滑条默认值"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onReset();
            onLiveChange(defaultValue);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}

export function FxMineradioToggle({
  label,
  checked,
  onChange,
  disabled = false,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  const button = (
    <button
      type="button"
      className={`fx-toggle ${checked ? 'on' : ''} ${disabled ? 'opacity-45 cursor-not-allowed' : ''}`}
      aria-pressed={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange(!checked);
      }}
    >
      <span>{label}</span>
      <span className="dot" aria-hidden />
    </button>
  );
  return title ? <Tooltip content={title} side="top">{button}</Tooltip> : button;
}

function preserveSlot(hidden: boolean, children: ReactNode) {
  return <div className={hidden ? 'pointer-events-none invisible' : undefined}>{children}</div>;
}

interface Props {
  value: RoomVisualFxSettings;
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void;
  onReset: () => void;
  onDraggingChange?: (dragging: boolean) => void;
  presetSlot?: ReactNode;
  className?: string;
}

export default function RoomVisualFxSettingsBody({
  value,
  onPatch,
  onReset,
  onDraggingChange,
  presetSlot,
  className = '',
}: Props) {
  const [draggingKey, setDraggingKey] = useState<VisualFxSliderKey | null>(null);
  const dragging = draggingKey !== null;

  useEffect(() => {
    onDraggingChange?.(dragging);
  }, [dragging, onDraggingChange]);

  useEffect(() => {
    if (!draggingKey) return;
    const end = () => setDraggingKey(null);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [draggingKey]);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {presetSlot ? <div className={dragging ? 'pointer-events-none invisible' : undefined}>{presetSlot}</div> : null}

      {preserveSlot(
        dragging,
        <button
          type="button"
          onClick={onReset}
          className="pointer-events-auto self-end text-[10px] text-white/45 transition-colors hover:text-white/80"
          tabIndex={dragging ? -1 : 0}
        >
          恢复默认
        </button>,
      )}

      {VISUAL_FX_SLIDERS.map((def) => {
        const hidden = draggingKey !== null && draggingKey !== def.key;
        return (
          <div key={def.key} className={hidden ? 'pointer-events-none invisible' : undefined}>
            <FxSlider
              def={def}
              value={value[def.key] as number}
              onDragStart={() => setDraggingKey(def.key)}
              onLiveChange={(v) => {
                onPatch(def.patch ? def.patch(v, value) : { [def.key]: v });
              }}
            />
          </div>
        );
      })}

      {preserveSlot(
        dragging,
        <div className="flex flex-col gap-3 border-t border-white/10 pt-3">
          <FxToggle
            label="光晕"
            checked={value.bloom && value.bloomStrength > 0.01}
            onChange={(bloom) =>
              onPatch(
                bloom
                  ? {
                      bloom: true,
                      ...(value.bloomStrength <= 0.01
                        ? { bloomStrength: DEFAULT_ROOM_VISUAL_FX.bloomStrength }
                        : {}),
                    }
                  : { bloom: false },
              )
            }
          />
          <FxToggle label="边缘增强" checked={value.edge} onChange={(edge) => onPatch({ edge })} />
        </div>,
      )}
    </div>
  );
}
