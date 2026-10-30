import { useEffect, useState, type ReactNode } from 'react';
import FoliaSettingsSlot from './FoliaSettingsSlot';
import type { RoomVisualFxSettings, RoomVisualMode } from '../../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX, defaultLyricFxPatch } from '../../lib/roomVisualPreset';
import { defaultLyricTypographyPatch } from '../../lib/lyricStyle';
import RoomVisualPresetGrid from '../RoomVisualPresetGrid';
import ImmersiveLyricFxControls from './ImmersiveLyricFxControls';
import ImmersiveAppearanceControls from './ImmersiveAppearanceControls';
import {
  FxMineradioSlider,
  FxMineradioToggle,
  FxSectionLabel,
  MOTION_FX_SLIDERS,
  ADVANCED_FX_SLIDERS,
} from '../RoomVisualFxSettingsBody';
import {
  galaxyHandGestureStartup,
  subscribeGalaxyHandGestureStartup,
} from '../galaxy/lib/galaxyHandGestureStartup';

export type ImmersiveFxTab = 'preset' | 'appearance' | 'lyrics' | 'motion' | 'advanced' | 'folia-theme' | 'folia-background' | 'folia-options';

const TAB_META: { id: ImmersiveFxTab; label: string }[] = [
  { id: 'preset', label: '预设' },
  { id: 'appearance', label: '外观' },
  { id: 'lyrics', label: '歌词' },
  { id: 'motion', label: '动态' },
  { id: 'advanced', label: '高级' },
];

const FOLIA_TABS: { id: ImmersiveFxTab; label: string }[] = [
  { id: 'preset', label: '预设' },
  { id: 'folia-theme', label: '主题' },
  { id: 'folia-background', label: '背景' },
  { id: 'folia-options', label: 'Folia 设置' },
];

interface Props {
  value: RoomVisualFxSettings;
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void;
  onReset: () => void;
  visualMode: RoomVisualMode;
  onVisualModeChange: (mode: RoomVisualMode) => void;
  onDraggingChange?: (dragging: boolean) => void;
  coverUrl?: string | null;
}

type LocalSliderDef = {
  key: keyof RoomVisualFxSettings;
  label: string;
  min: number;
  max: number;
  step: number;
};

const WORKSHOP_THEME_COLORS: Record<RoomVisualFxSettings['sonicWorkshopTheme'], string> = {
  'coral-mirage': '#cb6c89',
  'ocean-deep': '#1b6fb8',
  'arctic-aurora': '#79e1c4',
  'cyber-forest': '#3fc78a',
  'minimal-monochrome': '#d9dde3',
};

const WORKSHOP_COLOR_CONTROLS = [
  { label: '主题基色', modeKey: 'sonicWorkshopColorMode', colorKey: 'sonicWorkshopCustomColor' },
  { label: '地形底色', modeKey: 'sonicWorkshopBaseColorMode', colorKey: 'sonicWorkshopBaseColor' },
  { label: '暖色主体', modeKey: 'sonicWorkshopWarmColorMode', colorKey: 'sonicWorkshopWarmColor' },
  { label: '上层高光', modeKey: 'sonicWorkshopCoolColorMode', colorKey: 'sonicWorkshopCoolColor' },
  { label: '波纹亮区', modeKey: 'sonicWorkshopRippleColorMode', colorKey: 'sonicWorkshopRippleColor' },
  { label: '峰值高光', modeKey: 'sonicWorkshopPeakColorMode', colorKey: 'sonicWorkshopPeakColor' },
] as const;

function motionSlidersForMode(mode: RoomVisualMode) {
  if (mode === 'topography-we') return [];
  if (mode === 'topography') {
    return MOTION_FX_SLIDERS.filter((s) => s.key !== 'coverResolution' && s.key !== 'cinemaShake').map((s) => {
      if (s.key === 'intensity') return { ...s, label: '起伏幅度' };
      if (s.key === 'depth') return { ...s, label: '地形密度' };
      if (s.key === 'speed') return { ...s, label: '起伏速度' };
      if (s.key === 'cameraDistance') return { ...s, label: '镜头远近' };
      return s;
    });
  }
  return MOTION_FX_SLIDERS;
}

function advancedSlidersForMode(mode: RoomVisualMode) {
  if (mode === 'topography-we') return [];
  if (mode === 'topography') {
    return ADVANCED_FX_SLIDERS.filter((s) => s.key === 'colorBoost' || s.key === 'bloomStrength');
  }
  return ADVANCED_FX_SLIDERS;
}

function renderSliders(
  defs: Array<(typeof MOTION_FX_SLIDERS)[number] | LocalSliderDef>,
  value: RoomVisualFxSettings,
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void,
  draggingKey: string | null,
  setDraggingKey: (key: string | null) => void,
) {
  return defs.map((def) => {
    const hidden = draggingKey !== null && draggingKey !== def.key;
    const key = def.key as keyof RoomVisualFxSettings;
    const current = value[key] as number;
    const defaultValue = (DEFAULT_ROOM_VISUAL_FX[key] as number) ?? current;
    return (
      <div key={String(def.key)} className={hidden ? 'pointer-events-none invisible' : ''}>
        <FxMineradioSlider
          def={def as never}
          value={current}
          defaultValue={defaultValue}
          onDragStart={() => setDraggingKey(String(def.key))}
          onLiveChange={(v) => {
            onPatch('patch' in def && def.patch ? def.patch(v, value) : { [def.key]: v });
          }}
          onReset={() => {
            onPatch('patch' in def && def.patch ? def.patch(defaultValue, value) : { [def.key]: defaultValue });
          }}
        />
      </div>
    );
  });
}

function FxSeg({
  value,
  onChange,
  options,
  busy = false,
  busyValue,
  busyLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  busy?: boolean;
  busyValue?: string;
  busyLabel?: string;
}) {
  return (
    <div className={`fx-seg${busy ? ' is-busy' : ''}`} aria-busy={busy || undefined}>
      {options.map((option) => {
        const optionBusy = busy && busyValue === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? 'active' : ''}
            disabled={busy && !optionBusy && option.value !== 'off'}
            onClick={() => {
              if (busy && option.value === value) return;
              onChange(option.value);
            }}
          >
            {optionBusy && busyLabel ? busyLabel : option.label}
          </button>
        );
      })}
    </div>
  );
}

function FxFold({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`fx-fold ${open ? 'open' : ''}`}>
      <button type="button" className="fx-fold-head w-full text-left" onClick={onToggle}>
        <span className="fx-fold-title">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <span className="arrow">▶</span>
      </button>
      <div className="fx-fold-body">{children}</div>
    </div>
  );
}

export default function ImmersiveFxSettingsPanel({
  value,
  onPatch,
  onReset,
  visualMode,
  onVisualModeChange,
  onDraggingChange,
  coverUrl,
}: Props) {
  const TAB_KEY = 'openmusic:immersive-fx-tab';
  const FOLDS_KEY = 'openmusic:immersive-fx-folds';

  const [tab, setTab] = useState<ImmersiveFxTab>(() => {
    try {
      const raw = sessionStorage.getItem(TAB_KEY);
      if (!raw) return 'preset';
      const as = String(raw) as ImmersiveFxTab;
      return ([...TAB_META, ...FOLIA_TABS].map((t) => t.id) as string[]).includes(as) ? as : 'preset';
    } catch {
      return 'preset';
    }
  });
  const tabs = visualMode === 'folia' ? FOLIA_TABS : TAB_META;
  const activeTab = tabs.some(item => item.id === tab) ? tab : 'preset';
  useEffect(() => { if (tab !== activeTab) setTab(activeTab); }, [tab, activeTab]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [gestureStartup, setGestureStartup] = useState(() => ({
    phase: galaxyHandGestureStartup.phase,
    progress: galaxyHandGestureStartup.progress,
    label: galaxyHandGestureStartup.label,
  }));
  const defaultOpenFolds = {
    lyricToggles: true,
    lyricLayout: true,
    lyricPosition: true,
    motionCore: true,
    sonicWorkshop: true,
    lyricMotion: true,
    shelf3d: true,
    advancedCore: true,
    lyricGlitch: false,
    perfQuality: true,

  } as const satisfies Record<string, boolean>;

  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>(() => {
    try {
      const raw = sessionStorage.getItem(FOLDS_KEY);
      if (!raw) return { ...defaultOpenFolds };
      const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
      const next: Record<string, boolean> = { ...defaultOpenFolds };
      for (const key of Object.keys(defaultOpenFolds)) {
        const v = parsed[key];
        if (typeof v === 'boolean') next[key] = v;
      }
      return next;
    } catch {
      return { ...defaultOpenFolds };
    }
  });
  const dragging = draggingKey !== null;
  const gestureBusy =
    gestureStartup.phase === 'loading-model'
    || gestureStartup.phase === 'requesting-camera'
    || gestureStartup.phase === 'starting';

  const toggleFold = (key: string) => {
    setOpenFolds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      sessionStorage.setItem(FOLDS_KEY, JSON.stringify(openFolds));
    } catch {
      // ignore
    }
  }, [openFolds]);

  useEffect(() => {
    const sync = () => {
      setGestureStartup({
        phase: galaxyHandGestureStartup.phase,
        progress: galaxyHandGestureStartup.progress,
        label: galaxyHandGestureStartup.label,
      });
    };
    sync();
    return subscribeGalaxyHandGestureStartup(sync);
  }, []);

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
    <div className="fx-panel-layout">
      <div className="fx-panel-toolbar">
      <div className="fx-panel-tabs" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist" aria-label="视觉设置分类">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeTab === item.id}
            className={activeTab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      </div>

      <div className="fx-tab-scroll">
        {visualMode === 'folia' && activeTab !== 'preset' && <div className="fx-tab-page active" role="tabpanel" aria-label={tabs.find(item => item.id === activeTab)?.label}>
          <FoliaSettingsSlot section={activeTab === 'folia-theme' ? 'lyrics' : activeTab === 'folia-background' ? 'background' : 'appearance'} />
        </div>}
        {activeTab === 'preset' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <FxSectionLabel>视觉预设</FxSectionLabel>
            <div className={dragging ? 'pointer-events-none invisible' : ''}>
              <RoomVisualPresetGrid value={visualMode} onChange={onVisualModeChange} />
            </div>
          </div>
        ) : null}

        {activeTab === 'appearance' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <ImmersiveAppearanceControls
              value={value}
              onPatch={onPatch}
              coverUrl={coverUrl}
              dragging={dragging}
            />
          </div>
        ) : null}

        {activeTab === 'lyrics' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <FxFold
              title="歌词开关"
              subtitle="沉浸歌词与溢光"
              open={openFolds.lyricToggles}
              onToggle={() => toggleFold('lyricToggles')}
            >
              <div className={`fx-toggle-grid ${dragging ? 'pointer-events-none invisible' : ''}`}>
                <FxMineradioToggle
                  label="粒子歌词"
                  checked={value.particleLyrics}
                  onChange={(particleLyrics) => onPatch({ particleLyrics })}
                />
                <FxMineradioToggle
                  label="歌词溢光"
                  checked={value.lyricGlow}
                  onChange={(lyricGlow) => onPatch({ lyricGlow })}
                />
                <FxMineradioToggle
                  label="鼓点溢光"
                  checked={value.lyricGlowBeat}
                  onChange={(lyricGlowBeat) => onPatch({ lyricGlowBeat })}
                />
                <FxMineradioToggle
                  label="歌词光粒"
                  checked={value.lyricGlowParticles}
                  onChange={(lyricGlowParticles) => onPatch({ lyricGlowParticles })}
                />
                <FxMineradioToggle
                  label="歌词镜头绑定"
                  checked={value.lyricCameraLock}
                  onChange={(lyricCameraLock) => onPatch({ lyricCameraLock })}
                />
                <FxMineradioToggle
                  label="纵向漂浮"
                  checked={value.lyricVerticalFloat}
                  onChange={(lyricVerticalFloat) => onPatch({ lyricVerticalFloat })}
                />
                <FxMineradioToggle
                  label="背景星河层"
                  title="整个场景最远处那层流动星点，和歌词后面的光带（歌词光粒）无关"
                  checked={value.backgroundStarRiver}
                  onChange={(backgroundStarRiver) => onPatch({ backgroundStarRiver })}
                />
                <FxMineradioToggle
                  label="暂停保持歌词"
                  checked={value.lyricPauseHold}
                  onChange={(lyricPauseHold) => onPatch({ lyricPauseHold })}
                />
              </div>
            </FxFold>

            <FxFold
              title="歌词布局"
              subtitle="行数 / 翻译 / 清晰度"
              open={openFolds.lyricLayout}
              onToggle={() => toggleFold('lyricLayout')}
            >
              <FxSectionLabel>显示模式</FxSectionLabel>
              <FxSeg
                value={value.lyricDisplayMode}
                onChange={(lyricDisplayMode) =>
                  onPatch({ lyricDisplayMode: lyricDisplayMode as RoomVisualFxSettings['lyricDisplayMode'] })
                }
                options={[
                  { value: 'single', label: '单行' },
                  { value: 'dual', label: '双行' },
                  { value: 'triple', label: '三行' },
                  { value: 'cinema', label: '电影' },
                  { value: 'custom', label: '自定义' },
                ]}
              />

              <FxSectionLabel>翻译模式</FxSectionLabel>
              <FxSeg
                value={value.lyricShowTranslation ? value.lyricTranslationMode : 'off'}
                onChange={(mode) => onPatch({
                  lyricShowTranslation: mode !== 'off',
                  lyricTranslationMode: (mode === 'off' ? 'off' : mode) as RoomVisualFxSettings['lyricTranslationMode'],
                })}
                options={[
                  { value: 'off', label: '关闭' },
                  { value: 'current', label: '当前' },
                  { value: 'dual', label: '双语' },
                  { value: 'multi', label: '多行' },
                ]}
              />

              <FxSectionLabel>纹理清晰度</FxSectionLabel>
              <FxSeg
                value={String(value.lyricTextureClarity)}
                onChange={(clarity) => onPatch({
                  lyricTextureClarity: Number(clarity) as RoomVisualFxSettings['lyricTextureClarity'],
                })}
                options={[
                  { value: '1', label: '1×' },
                  { value: '2', label: '2×' },
                  { value: '3', label: '3×' },
                  { value: '4', label: '4×' },
                ]}
              />

              {value.lyricDisplayMode === 'custom'
                ? renderSliders(
                    [{ key: 'lyricCustomLineCount', label: '自定义行数', min: 1, max: 10, step: 1 }],
                    value,
                    onPatch,
                    draggingKey,
                    setDraggingKey,
                  )
                : null}

              <FxSectionLabel>上下文层次</FxSectionLabel>
              {renderSliders(
                [
                  { key: 'lyricContextOpacity', label: '上下句透明度', min: 0.25, max: 1, step: 0.01 },
                  { key: 'lyricContextSpread', label: '上下句间距', min: 0.6, max: 2.4, step: 0.01 },
                  { key: 'lyricTranslationGap', label: '翻译间距', min: 0.28, max: 2.2, step: 0.01 },
                  { key: 'lyricTranslationScale', label: '翻译字号', min: 0.46, max: 1.12, step: 0.01 },
                  { key: 'lyricTranslationOpacity', label: '翻译透明度', min: 0.2, max: 1, step: 0.01 },
                  { key: 'lyricEdgeFade', label: '边缘淡出', min: 0, max: 1, step: 0.01 },
                  { key: 'lyricBackgroundAdapt', label: '背景适配', min: 0, max: 1, step: 0.01 },
                ],
                value,
                onPatch,
                draggingKey,
                setDraggingKey,
              )}
            </FxFold>

            <FxFold
              title="歌词外观"
              subtitle="颜色 / 字体 / 位置"
              open={openFolds.lyricPosition}
              onToggle={() => toggleFold('lyricPosition')}
            >
              <ImmersiveLyricFxControls
                value={value}
                onPatch={onPatch}
                draggingKey={draggingKey}
                setDraggingKey={setDraggingKey}
                dragging={dragging}
              />
            </FxFold>

            <div className={`fx-actions ${dragging ? 'pointer-events-none invisible' : ''}`}>
              <button
                type="button"
                className="fx-mini-btn"
                onClick={() => onPatch({ ...defaultLyricFxPatch(), ...defaultLyricTypographyPatch() })}
              >
                恢复默认
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === 'motion' ? (
          <div className="fx-tab-page active" role="tabpanel">
            {visualMode === 'topography-we' ? (
              <FxFold
                title="音域回响 · WE"
                subtitle="响应 / 配色 / 网格"
                open={openFolds.sonicWorkshop}
                onToggle={() => toggleFold('sonicWorkshop')}
              >
                {renderSliders(
                  [
                    { key: 'sonicWorkshopInputGain', label: '输入压制', min: 40, max: 100, step: 1 },
                    { key: 'sonicWorkshopAudioIntensity', label: '音频响应', min: 0.3, max: 2.5, step: 0.01 },
                    { key: 'sonicWorkshopResponseRange', label: '响应范围', min: 0.3, max: 2, step: 0.01 },
                    { key: 'sonicWorkshopPeakIntensity', label: '中心高光', min: 0, max: 1.4, step: 0.01 },
                  ],
                  value,
                  onPatch,
                  draggingKey,
                  setDraggingKey,
                )}

                <FxSectionLabel>主题</FxSectionLabel>
                <FxSeg
                  value={value.sonicWorkshopTheme}
                  onChange={(theme) => {
                    const sonicWorkshopTheme = theme as RoomVisualFxSettings['sonicWorkshopTheme'];
                    onPatch({
                      sonicWorkshopTheme,
                      sonicWorkshopColorMode: 'custom',
                      sonicWorkshopCustomColor: WORKSHOP_THEME_COLORS[sonicWorkshopTheme],
                    });
                  }}
                  options={[
                    { value: 'coral-mirage', label: '珊瑚' },
                    { value: 'ocean-deep', label: '深海' },
                    { value: 'arctic-aurora', label: '冰蓝' },
                    { value: 'cyber-forest', label: '翠绿' },
                    { value: 'minimal-monochrome', label: '极简' },
                  ]}
                />

                <FxSectionLabel>区域配色</FxSectionLabel>
                {WORKSHOP_COLOR_CONTROLS.map((item) => {
                  const mode = value[item.modeKey];
                  const color = value[item.colorKey];
                  return (
                    <div key={item.colorKey} className={`lyric-color-row ${dragging ? 'pointer-events-none invisible' : ''}`}>
                      <input
                        type="color"
                        className="lyric-color-picker"
                        value={color}
                        title={item.label}
                        disabled={mode !== 'custom'}
                        onChange={(event) => onPatch({
                          [item.modeKey]: 'custom',
                          [item.colorKey]: event.target.value.toLowerCase(),
                        } as Partial<RoomVisualFxSettings>)}
                      />
                      <div className="fx-color-row-label">
                        {item.label}
                        <small>{mode === 'custom' ? color.toUpperCase() : '封面取色'}</small>
                      </div>
                      <button
                        type="button"
                        className={`fx-mini-btn ghost${mode !== 'custom' ? ' active' : ''}`}
                        onClick={() => onPatch({ [item.modeKey]: mode === 'custom' ? 'cover' : 'custom' } as Partial<RoomVisualFxSettings>)}
                      >
                        {mode === 'custom' ? '自定义' : '封面'}
                      </button>
                    </div>
                  );
                })}
              </FxFold>
            ) : null}

            <FxFold
              title="歌词运动"
              subtitle="入场 / 漂浮 / 高光"
              open={openFolds.lyricMotion}
              onToggle={() => toggleFold('lyricMotion')}
            >
              <FxSectionLabel>运动风格</FxSectionLabel>
              <FxSeg
                value={value.lyricMotionStyle}
                onChange={(lyricMotionStyle) =>
                  onPatch({ lyricMotionStyle: lyricMotionStyle as RoomVisualFxSettings['lyricMotionStyle'] })
                }
                options={[
                  { value: 'float', label: '漂浮' },
                  { value: 'smooth', label: '丝滑' },
                  { value: 'glass', label: '玻璃' },
                  { value: 'quick', label: '迅捷' },
                  { value: 'shine', label: '闪耀' },
                  { value: 'glitch', label: '故障' },
                ]}
              />
              {renderSliders(
                [{ key: 'lyricMotionSoftness', label: '运动柔和度', min: 0.15, max: 1.2, step: 0.01 }],
                value,
                onPatch,
                draggingKey,
                setDraggingKey,
              )}
            </FxFold>

            {visualMode !== 'topography-we' ? <FxFold
              title="画面基础"
              subtitle="律动 / 景深 / 镜头"
              open={openFolds.motionCore}
              onToggle={() => toggleFold('motionCore')}
            >
              {renderSliders(motionSlidersForMode(visualMode), value, onPatch, draggingKey, setDraggingKey)}

              <FxSectionLabel>镜头与叠加</FxSectionLabel>
              <div className={`fx-toggle-grid ${dragging ? 'pointer-events-none invisible' : ''}`}>
                {visualMode !== 'topography' ? (
                  <FxMineradioToggle
                    label="电影镜头"
                    checked={value.cinema}
                    onChange={(cinema) => onPatch({ cinema })}
                  />
                ) : null}
                <FxMineradioToggle
                  label={visualMode === 'topography' ? '浮动方块' : '浮空粒子层'}
                  checked={value.floatLayer}
                  disabled={visualMode !== 'emily' && visualMode !== 'topography'}
                  title={
                    visualMode !== 'emily' && visualMode !== 'topography'
                      ? '仅 emily / Sonic-Topography 可用'
                      : undefined
                  }
                  onChange={(floatLayer) => onPatch({ floatLayer })}
                />
                {visualMode === 'emily' ? (
                  <FxMineradioToggle
                    label="封面背面粒子"
                    checked={value.backCover}
                    onChange={(backCover) => onPatch({ backCover })}
                  />
                ) : null}
                {visualMode !== 'topography' ? (
                  <>
                    <FxMineradioToggle
                      label="粒子溢光"
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
                    <FxMineradioToggle
                      label="轮廓高亮"
                      checked={value.edge}
                      onChange={(edge) => onPatch({ edge })}
                    />
                  </>
                ) : null}
              </div>
            </FxFold> : null}

            {/* WE 地形同样会渲染歌单架（SonicWorkshopBackground 里挂着 GalaxyFloatingSongCard），
                这组设置不能跟着整块隐藏，否则架子在屏幕上却调不了 */}
            <FxFold
              title="3D / 手势"
              subtitle="歌单架 / 摄像头交互"
              open={openFolds.shelf3d}
              onToggle={() => toggleFold('shelf3d')}
            >
              <FxSectionLabel>3D 歌单架</FxSectionLabel>
              <FxSeg
                value={value.shelfMode}
                onChange={(shelfMode) => onPatch({ shelfMode: shelfMode as RoomVisualFxSettings['shelfMode'] })}
                options={[
                  { value: 'off', label: '关闭' },
                  { value: 'side', label: '侧栏' },
                  { value: 'stage', label: '舞台' },
                ]}
              />

              <FxSectionLabel>歌单架镜头</FxSectionLabel>
              <FxSeg
                value={value.shelfCameraMode}
                onChange={(shelfCameraMode) =>
                  onPatch({ shelfCameraMode: shelfCameraMode as RoomVisualFxSettings['shelfCameraMode'] })
                }
                options={[
                  { value: 'dynamic', label: '动态镜头' },
                  { value: 'static', label: '静态镜头' },
                ]}
              />

              <FxSectionLabel>歌单架显示</FxSectionLabel>
              <FxSeg
                value={value.shelfPresence}
                onChange={(shelfPresence) =>
                  onPatch({ shelfPresence: shelfPresence as RoomVisualFxSettings['shelfPresence'] })
                }
                options={[
                  { value: 'auto', label: '自动隐藏' },
                  { value: 'always', label: '常驻' },
                ]}
              />

              <FxSectionLabel>歌单架外观</FxSectionLabel>
              <div className={`lyric-color-row ${dragging ? 'pointer-events-none invisible' : ''}`}>
                <input
                  type="color"
                  className="lyric-color-picker"
                  value={value.shelfAccentColor}
                  title="歌单架颜色"
                  onChange={(e) => onPatch({ shelfAccentColor: e.target.value.toLowerCase() })}
                />
                <div className="fx-color-row-label">
                  歌单架颜色
                  <small>{value.shelfAccentColor}</small>
                </div>
                <button
                  type="button"
                  className="fx-mini-btn ghost"
                  onClick={() => onPatch({ shelfAccentColor: DEFAULT_ROOM_VISUAL_FX.shelfAccentColor })}
                >
                  默认
                </button>
              </div>

              <FxSectionLabel>歌单架参数</FxSectionLabel>
              {renderSliders(
                [
                  { key: 'shelfSize', label: '歌单架大小', min: 0.65, max: 1.45, step: 0.01 },
                  { key: 'shelfOffsetX', label: '左右位置', min: -1.6, max: 1.6, step: 0.01 },
                  { key: 'shelfOffsetY', label: '上下位置', min: -1.6, max: 1.6, step: 0.01 },
                  { key: 'shelfOffsetZ', label: '前后景深', min: -1.6, max: 1.6, step: 0.01 },
                  { key: 'shelfAngleY', label: '侧向角度', min: -35, max: 15, step: 1 },
                  { key: 'shelfOpacity', label: '整体透明度', min: 0.2, max: 1, step: 0.01 },
                  { key: 'shelfBgOpacity', label: '背景透明度', min: 0.15, max: 1, step: 0.01 },
                  { key: 'shelfSummonOpenDuration', label: '召唤入场时长', min: 0.12, max: 2, step: 0.01 },
                  { key: 'shelfSummonCloseDuration', label: '召唤退场时长', min: 0.08, max: 1.5, step: 0.01 },
                  { key: 'shelfSummonSlide', label: '召唤滑入幅度', min: 0, max: 3, step: 0.01 },
                  { key: 'shelfSummonStagger', label: '卡片错峰', min: 0, max: 2, step: 0.01 },
                  { key: 'shelfSummonScale', label: '入场缩放', min: 0, max: 2, step: 0.01 },
                  { key: 'shelfSummonParallax', label: '指针视差', min: 0, max: 2, step: 0.01 },
                  { key: 'shelfCameraEnterSpeed', label: '镜头进入速度', min: 0.08, max: 0.8, step: 0.01 },
                  { key: 'shelfCameraExitSpeed', label: '镜头退出速度', min: 0.08, max: 0.8, step: 0.01 },
                ],
                value,
                onPatch,
                draggingKey,
                setDraggingKey,
              )}

              {/* WE 场景里没有粒子层，也没挂手势桥接，这一项在那儿点了没用 */}
              {visualMode !== 'topography-we' ? (
                <>
                  <FxSectionLabel>摄像头交互</FxSectionLabel>
                  <FxSeg
                    value={value.cameraInteraction}
                    busy={gestureBusy}
                    busyValue="gesture"
                    busyLabel="开启中…"
                    onChange={(cameraInteraction) =>
                      onPatch({ cameraInteraction: cameraInteraction as RoomVisualFxSettings['cameraInteraction'] })
                    }
                    options={[
                      { value: 'off', label: '关闭' },
                      { value: 'gesture', label: '手势触碰' },
                    ]}
                  />
                  {gestureBusy ? (
                    <div className="fx-gesture-startup" aria-live="polite">
                      <div className="fx-gesture-startup-label">
                        {gestureStartup.label || '正在开启手势…'}
                      </div>
                      <div className="fx-gesture-startup-track">
                        <div
                          className="fx-gesture-startup-fill"
                          style={{ width: `${Math.round(gestureStartup.progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </FxFold>
          </div>
        ) : null}

        {activeTab === 'advanced' ? (
          <div className="fx-tab-page active" role="tabpanel">
            <FxFold
              title="歌词故障"
              subtitle="切片 / 色散 / 鼓点"
              open={openFolds.lyricGlitch}
              onToggle={() => toggleFold('lyricGlitch')}
            >
              {renderSliders(
                [
                  { key: 'lyricGlitchIntensity', label: '故障强度', min: 0, max: 1.5, step: 0.01 },
                  { key: 'lyricGlitchSlice', label: '切片密度', min: 0, max: 1.4, step: 0.01 },
                  { key: 'lyricGlitchChroma', label: '色散强度', min: 0, max: 1.6, step: 0.01 },
                  { key: 'lyricGlitchRate', label: '故障频率', min: 0.45, max: 2.2, step: 0.01 },
                  { key: 'lyricGlitchJitter', label: '抖动强度', min: 0, max: 1.8, step: 0.01 },
                ],
                value,
                onPatch,
                draggingKey,
                setDraggingKey,
              )}
              <div className={`fx-toggle-grid ${dragging ? 'pointer-events-none invisible' : ''}`}>
                <FxMineradioToggle
                  label="故障跟鼓点"
                  checked={value.lyricGlitchCameraBind}
                  onChange={(lyricGlitchCameraBind) => onPatch({ lyricGlitchCameraBind })}
                />
              </div>
            </FxFold>

            {advancedSlidersForMode(visualMode).length > 0 ? (
              <FxFold
                title="粒子高级参数"
                subtitle="尺寸 / 流速 / 色彩"
                open={openFolds.advancedCore}
                onToggle={() => toggleFold('advancedCore')}
              >
                {renderSliders(advancedSlidersForMode(visualMode), value, onPatch, draggingKey, setDraggingKey)}
              </FxFold>
            ) : null}

            <FxFold
              title="性能画质"
              subtitle="3D 网格 / 粒子规模"
              open={openFolds.perfQuality}
              onToggle={() => toggleFold('perfQuality')}
            >
              <FxSectionLabel>画质档位</FxSectionLabel>
              <FxSeg
                value={value.performanceQuality}
                onChange={(performanceQuality) =>
                  onPatch({
                    performanceQuality:
                      performanceQuality as RoomVisualFxSettings['performanceQuality'],
                  })
                }
                options={[
                  { value: 'eco', label: '省电' },
                  { value: 'balanced', label: '均衡' },
                  { value: 'high', label: '高' },
                  { value: 'ultra', label: '极致' },
                ]}
              />
            </FxFold>

            <div className={`fx-actions ${dragging ? 'pointer-events-none invisible' : ''}`}>
              <button type="button" className="fx-mini-btn" onClick={onReset}>
                恢复默认
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
