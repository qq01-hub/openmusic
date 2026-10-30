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
  const [switchProgress, setSwitchProgress] = useState(0);
  const [switchError, setSwitchError] = useState<RoomVisualMode | null>(null);
  const timerRef = useRef<number | null>(null);
  const warmPreset = (mode: RoomVisualMode) => {
    if (mode === 'folia') void preloadFoliaStage().catch(() => {});
  };

  useEffect(
    () => {
      const idleWindow = window as unknown as {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      const warmDuringIdle = () => warmPreset('folia');
      const idleHandle = idleWindow.requestIdleCallback
        ? idleWindow.requestIdleCallback(warmDuringIdle, { timeout: 2500 })
        : window.setTimeout(warmDuringIdle, 1200);
      return () => {
        if (idleWindow.cancelIdleCallback && idleWindow.requestIdleCallback) idleWindow.cancelIdleCallback(idleHandle);
        else window.clearTimeout(idleHandle);
      };
    },
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleSelect = useCallback(
    async (mode: RoomVisualMode) => {
      if (mode === value) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      setSwitchError(null);
      setSwitchingMode(mode);
      setSwitchProgress(8);
      const startedAt = Date.now();
      const progressTimer = window.setInterval(() => {
        setSwitchProgress((current) => Math.min(92, Math.max(current, Math.round(8 + (Date.now() - startedAt) / 18))));
      }, 80);
      try {
        if (mode === 'folia') await preloadFoliaStage();
        onChange(mode);
        setSwitchProgress(100);
      } catch {
        setSwitchError(mode);
        return;
      } finally {
        window.clearInterval(progressTimer);
        timerRef.current = window.setTimeout(() => {
          setSwitchingMode(null);
          timerRef.current = null;
        }, PULSE_MS);
      }
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
            <div className="pc-name">{switching ? `${meta.name} · ${switchError === mode ? '加载失败' : `加载 ${switchProgress}%`}` : meta.name}</div>
            <div className="pc-desc">{PRESET_DESC[mode]}</div>
          </button>
        );
      })}
    </div>
  );
}
