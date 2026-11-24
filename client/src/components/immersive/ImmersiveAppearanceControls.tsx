import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomVisualFxSettings } from '../../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX } from '../../lib/roomVisualPreset';
import { FxSectionLabel } from '../RoomVisualFxSettingsBody';
import CoverColorPickerPopover from './CoverColorPickerPopover';
import Tooltip from '../Tooltip';
import {
  clearLocalBackgroundMedia,
  LOCAL_BACKGROUND_MEDIA_REF,
  readLocalBackgroundMedia,
  saveLocalBackgroundMedia,
} from '../../lib/localBackgroundMedia';

interface Props {
  value: RoomVisualFxSettings;
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void;
  coverUrl?: string | null;
  dragging: boolean;
}

function ColorRow({
  label,
  color,
  small,
  onChange,
  onReset,
  resetLabel = '默认',
  extraButton,
  disabled,
}: {
  label: string;
  color: string;
  small: string;
  onChange: (hex: string) => void;
  onReset: () => void;
  resetLabel?: string;
  extraButton?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`lyric-color-row ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      <Tooltip content={label} side="top">
        <input
          type="color"
          className="lyric-color-picker"
          value={color}
          aria-label={label}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
      </Tooltip>
      <div className="fx-color-row-label">
        {label}
        <small>{small}</small>
      </div>
      {extraButton}
      <button type="button" className="fx-mini-btn ghost" onClick={onReset}>
        {resetLabel}
      </button>
    </div>
  );
}

export default function ImmersiveAppearanceControls({
  value,
  onPatch,
  coverUrl,
  dragging,
}: Props) {
  const [coverPickerTarget, setCoverPickerTarget] = useState<'visualTint' | 'backgroundColor' | null>(null);
  const [localMediaLabel, setLocalMediaLabel] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const hidden = dragging ? 'pointer-events-none invisible' : '';

  const refreshLocalMediaLabel = useCallback(async () => {
    if (value.backgroundMedia !== LOCAL_BACKGROUND_MEDIA_REF) {
      setLocalMediaLabel(null);
      return;
    }
    try {
      const record = await readLocalBackgroundMedia();
      if (!record) {
        setLocalMediaLabel(null);
        return;
      }
      const kind = record.type.startsWith('video/') ? '视频' : '图片';
      setLocalMediaLabel(`${kind} · ${record.name || '本机文件'}`);
    } catch {
      setLocalMediaLabel('本机文件');
    }
  }, [value.backgroundMedia]);

  useEffect(() => {
    void refreshLocalMediaLabel();
    const onUpdate = () => void refreshLocalMediaLabel();
    window.addEventListener('openmusic:local-background-updated', onUpdate);
    return () => window.removeEventListener('openmusic:local-background-updated', onUpdate);
  }, [refreshLocalMediaLabel]);

  const applyCoverColor = useCallback(
    (hex: string) => {
      if (coverPickerTarget === 'visualTint') {
        onPatch({ visualTintColor: hex, visualTintMode: 'custom' });
      } else if (coverPickerTarget === 'backgroundColor') {
        onPatch({ backgroundColor: hex, backgroundColorMode: 'custom' });
      }
      setCoverPickerTarget(null);
    },
    [coverPickerTarget, onPatch],
  );

  const onBgFile = async (file: File | null) => {
    if (!file) return;
    const image = file.type.startsWith('image/');
    const video = file.type === 'video/mp4' || file.type === 'video/webm';
    const maxBytes = image ? 30 * 1024 * 1024 : 600 * 1024 * 1024;
    if ((!image && !video) || file.size > maxBytes) {
      window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
        detail: {
          message: !image && !video
            ? '仅支持图片或 MP4/WebM 视频'
            : `文件过大，${image ? '图片上限 30MB' : '视频上限 600MB'}`,
          type: 'error',
        },
      }));
      return;
    }
    try {
      await saveLocalBackgroundMedia(file);
      onPatch({ backgroundMedia: LOCAL_BACKGROUND_MEDIA_REF });
      window.dispatchEvent(new CustomEvent('openmusic:local-background-updated'));
      window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
        detail: { message: '已导入本机背景（仅保存在浏览器，不上传服务器）', type: 'success' },
      }));
    } catch (error) {
      console.error('Unable to save local background media:', error);
      window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
        detail: { message: '本机背景保存失败，请检查浏览器存储空间', type: 'error' },
      }));
    }
  };

  const clearBackgroundMedia = async () => {
    if (value.backgroundMedia === LOCAL_BACKGROUND_MEDIA_REF) {
      try { await clearLocalBackgroundMedia(); } catch (error) { console.warn(error); }
    }
    onPatch({ backgroundMedia: null });
    setLocalMediaLabel(null);
    window.dispatchEvent(new CustomEvent('openmusic:local-background-updated'));
  };

  return (
    <>
      <FxSectionLabel>本机背景</FxSectionLabel>
      <div className={hidden}>
        <div className="lyric-color-row image-pick-row">
          <button type="button" className="fx-mini-btn ghost" onClick={() => bgInputRef.current?.click()}>
            导入
          </button>
          <div className="fx-color-row-label">
            图片 / MP4
            <small>{localMediaLabel || (value.backgroundMedia ? '已设置' : '未设置 · 仅存本机')}</small>
          </div>
          <button
            type="button"
            className="fx-mini-btn ghost"
            onClick={() => void clearBackgroundMedia()}
            disabled={!value.backgroundMedia}
          >
            清除
          </button>
          <input
            ref={bgInputRef}
            type="file"
            accept="image/*,video/mp4,video/webm"
            className="hidden"
            onChange={(e) => {
              void onBgFile(e.target.files?.[0] || null);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <FxSectionLabel>自定义颜色</FxSectionLabel>
      <div className={hidden}>
        <ColorRow
          label="界面高亮"
          color={value.uiAccentColor}
          small={value.uiAccentColor.toUpperCase()}
          onChange={(uiAccentColor) => onPatch({ uiAccentColor })}
          onReset={() => onPatch({ uiAccentColor: DEFAULT_ROOM_VISUAL_FX.uiAccentColor })}
        />
        <ColorRow
          label="视觉主色"
          color={value.visualTintColor}
          small={value.visualTintMode === 'auto' ? '封面取色' : value.visualTintColor.toUpperCase()}
          onChange={(visualTintColor) => onPatch({ visualTintColor, visualTintMode: 'custom' })}
          onReset={() =>
            onPatch({
              visualTintMode: 'auto',
              visualTintColor: DEFAULT_ROOM_VISUAL_FX.visualTintColor,
            })
          }
          resetLabel="默认"
          extraButton={
            <button
              type="button"
              className="fx-mini-btn ghost"
              onClick={() => setCoverPickerTarget('visualTint')}
              disabled={!coverUrl}
            >
              封面
            </button>
          }
        />
        <ColorRow
          label="背景颜色"
          color={value.backgroundColor}
          small={value.backgroundColorMode === 'cover' ? '封面' : value.backgroundColor.toUpperCase()}
          onChange={(backgroundColor) => onPatch({ backgroundColor, backgroundColorMode: 'custom' })}
          onReset={() =>
            onPatch({
              backgroundColorMode: 'cover',
              backgroundColor: DEFAULT_ROOM_VISUAL_FX.backgroundColor,
            })
          }
          resetLabel="封面"
          extraButton={
            <button
              type="button"
              className="fx-mini-btn ghost"
              onClick={() => setCoverPickerTarget('backgroundColor')}
              disabled={!coverUrl}
            >
              取色
            </button>
          }
        />
      </div>

      {coverPickerTarget && coverUrl ? (
        <CoverColorPickerPopover
          coverUrl={coverUrl}
          onPick={applyCoverColor}
          onClose={() => setCoverPickerTarget(null)}
        />
      ) : null}
    </>
  );
}
