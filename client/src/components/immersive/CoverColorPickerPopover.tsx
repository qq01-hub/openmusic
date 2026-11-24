import { useCallback, useEffect, useRef, useState } from 'react';
import Tooltip from '../Tooltip';

interface Props {
  coverUrl: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export default function CoverColorPickerPopover({ coverUrl, onPick, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [swatches, setSwatches] = useState<string[]>([]);
  const [preview, setPreview] = useState('#ffffff');

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const size = 180;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (img.width <= 0 || img.height <= 0) return;
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      const colors: string[] = [];
      const pts = [
        [0.2, 0.2], [0.5, 0.2], [0.8, 0.2],
        [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
        [0.2, 0.8], [0.5, 0.8], [0.8, 0.8],
      ];
      try {
        for (const [ux, uy] of pts) {
          const d = ctx.getImageData(Math.floor(ux * size), Math.floor(uy * size), 1, 1).data;
          colors.push(rgbToHex(d[0], d[1], d[2]));
        }
        setSwatches([...new Set(colors)]);
        setPreview(colors[4] || '#ffffff');
      } catch {
        setSwatches([]);
      }
    };
    img.src = coverUrl;
    return () => {
      cancelled = true;
      img.onload = null;
    };
  }, [coverUrl]);

  const pickFromCanvas = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) return;
      const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height)));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      try {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const hex = rgbToHex(d[0], d[1], d[2]);
        setPreview(hex);
        onPick(hex);
      } catch {
        // 跨域封面污染画布时安全忽略取色
      }
    },
    [onPick],
  );

  return (
    <div className="cover-color-pop show" role="dialog" aria-label="封面取色">
      <div className="cover-color-head">
        <span>Cover Picker</span>
        <button type="button" className="cover-color-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="cover-color-body">
        <Tooltip content="点击封面取色" side="top">
          <canvas
            ref={canvasRef}
            className="cover-color-art"
            onClick={pickFromCanvas}
            aria-label="点击封面取色"
          />
        </Tooltip>
        <div className="cover-color-side">
          <div className="cover-color-preview" style={{ background: preview }} />
          <div className="cover-color-hint">点击专辑封面任意位置取色，或使用推荐色。</div>
          <div className="cover-color-swatches">
            {swatches.map((c) => (
              <Tooltip key={c} content={c} side="top">
                <button
                  type="button"
                  className="cover-color-swatch"
                  style={{ background: c }}
                  onClick={() => onPick(c)}
                  aria-label={`选择颜色 ${c}`}
                />
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
