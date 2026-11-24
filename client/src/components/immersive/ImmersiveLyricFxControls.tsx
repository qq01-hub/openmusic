import type { RoomVisualFxSettings } from '../../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX } from '../../lib/roomVisualPreset';
import {
  LYRIC_COLOR_PRESETS,
  LYRIC_FONT_OPTIONS,
  normalizeLyricFontKey,
} from '../../lib/lyricStyle';
import { recomputeStageLyricPalette } from '../../lib/stageLyricPaletteLive';
import {
  FxMineradioSlider,
  FxSectionLabel,
  LYRIC_FX_SLIDERS,
  LYRIC_TYPOGRAPHY_SLIDERS,
} from '../RoomVisualFxSettingsBody';
import Tooltip from '../Tooltip';

interface Props {
  value: RoomVisualFxSettings;
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void;
  draggingKey: string | null;
  setDraggingKey: (key: string | null) => void;
  dragging: boolean;
}

function patchLyricPalette(onPatch: Props['onPatch'], patch: Partial<RoomVisualFxSettings>) {
  onPatch(patch);
  recomputeStageLyricPalette();
}

export default function ImmersiveLyricFxControls({
  value,
  onPatch,
  draggingKey,
  setDraggingKey,
  dragging,
}: Props) {
  const lyricColor = value.lyricColor;
  const lyricColorAuto = value.lyricColorMode !== 'custom';

  const renderMineradioSliders = (
    defs: typeof LYRIC_FX_SLIDERS,
    defaults: RoomVisualFxSettings,
  ) =>
    defs.map((def) => {
      const hidden = draggingKey !== null && draggingKey !== def.key;
      const key = def.key as keyof RoomVisualFxSettings;
      return (
        <div key={String(def.key)} className={hidden ? 'pointer-events-none invisible' : ''}>
          <FxMineradioSlider
            def={def}
            value={value[key] as number}
            defaultValue={defaults[key] as number}
            onDragStart={() => setDraggingKey(String(def.key))}
            onLiveChange={(v) => {
              onPatch(def.patch ? def.patch(v, value) : { [def.key]: v });
            }}
            onReset={() => {
              onPatch(def.patch ? def.patch(defaults[key] as number, value) : { [def.key]: defaults[key] });
            }}
          />
        </div>
      );
    });

  return (
    <>
      <FxSectionLabel>歌词溢光强度</FxSectionLabel>
      {renderMineradioSliders(
        LYRIC_FX_SLIDERS.filter((d) => d.key === 'lyricGlowStrength'),
        DEFAULT_ROOM_VISUAL_FX,
      )}

      <FxSectionLabel>文字颜色</FxSectionLabel>
      <div className={`lyric-color-grid ${dragging ? 'pointer-events-none invisible' : ''}`}>
        <Tooltip content="封面取色" side="top">
          <button
            type="button"
            className={`lyric-swatch auto${lyricColorAuto ? ' active' : ''}`}
            aria-label="封面取色"
            onClick={() => patchLyricPalette(onPatch, { lyricColorMode: 'auto' })}
          >
            AUTO
          </button>
        </Tooltip>
        {LYRIC_COLOR_PRESETS.map((preset) => {
          const active = !lyricColorAuto && preset.color === lyricColor;
          return (
            <Tooltip key={preset.color} content={preset.name} side="top">
              <button
                type="button"
                className={`lyric-swatch${active ? ' active' : ''}`}
                aria-label={preset.name}
                style={{ ['--swatch' as string]: preset.color }}
                onClick={() =>
                  patchLyricPalette(onPatch, {
                    lyricColorMode: 'custom',
                    lyricColor: preset.color,
                  })
                }
              />
            </Tooltip>
          );
        })}
      </div>
      <div className={`lyric-color-row ${dragging ? 'pointer-events-none invisible' : ''}`}>
        <Tooltip content="色轮取色" side="top">
          <input
            type="color"
            className="lyric-color-picker"
            value={lyricColor}
            aria-label="色轮取色"
            onChange={(e) =>
              patchLyricPalette(onPatch, {
                lyricColorMode: 'custom',
                lyricColor: e.target.value.toLowerCase(),
              })
            }
          />
        </Tooltip>
        <div className="lyric-color-value">
          {lyricColorAuto ? '封面取色' : lyricColor.toUpperCase()}
        </div>
        <button
          type="button"
          className={`fx-mini-btn ghost${lyricColorAuto ? ' active' : ''}`}
          onClick={() => patchLyricPalette(onPatch, { lyricColorMode: 'auto' })}
        >
          封面
        </button>
      </div>

      <FxSectionLabel>跟唱高亮</FxSectionLabel>
      <div className={`lyric-color-row ${dragging ? 'pointer-events-none invisible' : ''}`}>
        <Tooltip content="高亮取色" side="top">
          <input
            type="color"
            className="lyric-color-picker"
            value={value.lyricHighlightColor}
            aria-label="高亮取色"
            onChange={(e) =>
              patchLyricPalette(onPatch, {
                lyricHighlightMode: 'custom',
                lyricHighlightColor: e.target.value.toLowerCase(),
              })
            }
          />
        </Tooltip>
        <div className="lyric-color-value">
          {value.lyricHighlightMode === 'custom'
            ? value.lyricHighlightColor.toUpperCase()
            : '跟随歌词'}
        </div>
        <button
          type="button"
          className={`fx-mini-btn ghost${value.lyricHighlightMode !== 'custom' ? ' active' : ''}`}
          onClick={() => patchLyricPalette(onPatch, { lyricHighlightMode: 'auto' })}
        >
          跟随
        </button>
      </div>

      <FxSectionLabel>歌词溢光颜色</FxSectionLabel>
      <div
        className={`lyric-color-row${value.lyricGlowLinked !== false ? ' linked' : ''} ${dragging ? 'pointer-events-none invisible' : ''}`}
        onClick={() => {
          if (value.lyricGlowLinked !== false) {
            patchLyricPalette(onPatch, { lyricGlowLinked: false });
          }
        }}
      >
        <Tooltip content="溢光取色" side="top">
          <input
            type="color"
            className="lyric-color-picker"
            value={value.lyricGlowColor}
            aria-label="溢光取色"
            disabled={value.lyricGlowLinked !== false}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              patchLyricPalette(onPatch, {
                lyricGlowLinked: false,
                lyricGlowColor: e.target.value.toLowerCase(),
              })
            }
          />
        </Tooltip>
        <div className="lyric-color-value">
          {value.lyricGlowLinked !== false ? '跟随高亮' : value.lyricGlowColor.toUpperCase()}
        </div>
        <button
          type="button"
          className={`fx-mini-btn ghost${value.lyricGlowLinked !== false ? ' active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            const nextLinked = value.lyricGlowLinked === false;
            patchLyricPalette(onPatch, {
              lyricGlowLinked: nextLinked,
              ...(nextLinked
                ? {}
                : { lyricGlowColor: value.lyricGlowColor || value.lyricHighlightColor }),
            });
          }}
        >
          {value.lyricGlowLinked !== false ? '链接' : '独立'}
        </button>
      </div>

      <FxSectionLabel>字体与字距</FxSectionLabel>
      <div className={`fx-font-grid expanded ${dragging ? 'pointer-events-none invisible' : ''}`}>
        {LYRIC_FONT_OPTIONS.map((font) => (
          <button
            key={font.key}
            type="button"
            data-font={font.key}
            className={normalizeLyricFontKey(value.lyricFont) === font.key ? 'active' : ''}
            onClick={() => onPatch({ lyricFont: font.key })}
          >
            {font.label}
          </button>
        ))}
      </div>
      {renderMineradioSliders(LYRIC_TYPOGRAPHY_SLIDERS, DEFAULT_ROOM_VISUAL_FX)}

      <FxSectionLabel>位置与角度</FxSectionLabel>
      {renderMineradioSliders(
        LYRIC_FX_SLIDERS.filter((d) => d.key !== 'lyricGlowStrength'),
        DEFAULT_ROOM_VISUAL_FX,
      )}
    </>
  );
}
