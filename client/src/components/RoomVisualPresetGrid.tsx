import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ROOM_VISUAL_DISPLAY_ORDER,
  ROOM_VISUAL_MODE_META,
  type RoomVisualMode,
} from '../lib/roomVisualPreset';
import { preloadFoliaStage } from '../lib/foliaStageLoader';

const PRESET_DESC: Record<RoomVisualMode, string> = {
  folia: '15 种歌词主题 · 6 类背景',
  off: '关闭粒子背景',
  'cover-bg': '封面铺满背景',
  emily: '专辑封面粒子',
  galaxy: '星河漫游',
  topography: 'Sonic-Topography · Ajin',
  'topography-we': '实例柱阵 · 波纹流星',
  vinyl: '旋转唱片',
  planet: '星球 · 雕塑感',
  tunnel: '滚筒隧道',
  void: '无粒子 · 自定义背景',
};

const PULSE_MS = 760;

interface Props {
  value: RoomVisualMode;
  onChange: (mode: RoomVisualMode) => void;
}

export default function RoomVisualPresetGrid({ value, onChange }: Props) {
  const [switchingMode, setSwitchingMode] = useState<RoomVisualMode | null>(null);
  const timerRef = useRef<number | null>(null);
  const warmPreset = (mode: RoomVisualMode) => {
    if (mode === 'folia') void preloadFoliaStage().catch(() => {});
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleSelect = useCallback(
    (mode: RoomVisualMode) => {
      if (mode === value) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      setSwitchingMode(mode);
      warmPreset(mode);
      timerRef.current = window.setTimeout(() => {
        setSwitchingMode(null);
        timerRef.current = null;
      }, PULSE_MS);
      onChange(mode);
    },
    [onChange, value],
  );

  return (
    <div className="preset-grid" role="listbox" aria-label="视觉预设">
      {ROOM_VISUAL_DISPLAY_ORDER.filter((mode) => ROOM_VISUAL_MODE_META[mode].hasSettings).map((mode) => {
        const meta = ROOM_VISUAL_MODE_META[mode];
        const active = value === mode;
        const switching = switchingMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="option"
            aria-selected={active}
            className={`preset-card ${active ? 'active' : ''} ${switching ? 'switching' : ''}`}
            onClick={() => handleSelect(mode)}
            onPointerEnter={() => warmPreset(mode)}
            onFocus={() => warmPreset(mode)}
          >
            <div className="pc-name">{meta.name}</div>
            <div className="pc-desc">{PRESET_DESC[mode]}</div>
          </button>
        );
      })}
    </div>
  );
}
