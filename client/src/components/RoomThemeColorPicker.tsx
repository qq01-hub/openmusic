import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Palette, RotateCcw, X } from 'lucide-react';
import Tooltip from './Tooltip';
import {
  DEFAULT_THEME_COLOR,
  applyRoomThemeColor,
  hexToThemeRgb,
  readRoomThemeColor,
  themeRgbToHex,
  writeRoomThemeColor,
  type ThemeRgb,
} from '../lib/roomThemeColor';

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

const WHEEL_SIZE = 220;

function rgbToHsv({ r, g, b }: ThemeRgb): HsvColor {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * ((blue - red) / delta + 2);
    else h = 60 * ((red - green) / delta + 4);
  }
  return {
    h: (h + 360) % 360,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToRgb({ h, s, v }: HsvColor): ThemeRgb {
  const chroma = v * s;
  const section = h / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (section < 1) [red, green] = [chroma, x];
  else if (section < 2) [red, green] = [x, chroma];
  else if (section < 3) [green, blue] = [chroma, x];
  else if (section < 4) [green, blue] = [x, chroma];
  else if (section < 5) [red, blue] = [x, chroma];
  else [red, blue] = [chroma, x];
  const match = v - chroma;
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

function drawColorWheel(canvas: HTMLCanvasElement, value: number) {
  const cssSize = WHEEL_SIZE;
  const dpr = window.devicePixelRatio || 1;
  const pixelSize = Math.round(cssSize * dpr);
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const radius = pixelSize / 2;
  const image = ctx.createImageData(pixelSize, pixelSize);
  const data = image.data;

  for (let y = 0; y < pixelSize; y += 1) {
    for (let x = 0; x < pixelSize; x += 1) {
      const dx = x + 0.5 - radius;
      const dy = y + 0.5 - radius;
      const distance = Math.hypot(dx, dy);
      const index = (y * pixelSize + x) * 4;
      if (distance > radius) {
        data[index + 3] = 0;
        continue;
      }
      const h = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
      const s = distance / radius;
      const { r, g, b } = hsvToRgb({ h, s, v: value });
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

export default function RoomThemeColorPicker() {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);
  const [panelShiftX, setPanelShiftX] = useState(0);
  const [hsv, setHsv] = useState<HsvColor>(() => rgbToHsv(hexToThemeRgb(readRoomThemeColor())));
  const rgb = hsvToRgb(hsv);
  const color = themeRgbToHex(rgb);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    drawColorWheel(canvasRef.current, 1);
  }, [open]);

  // 手机上按钮靠屏幕边缘时，右对齐弹层会伸出视口外，测量后平移回可视区域
  useLayoutEffect(() => {
    if (!open) {
      setPanelShiftX(0);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const margin = 8;
    const rect = panel.getBoundingClientRect();
    let delta = 0;
    if (rect.left < margin) delta = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) delta = window.innerWidth - margin - rect.right;
    if (delta) setPanelShiftX(delta);
  }, [open]);

  const updateColor = (next: HsvColor) => {
    setHsv(next);
    const hex = themeRgbToHex(hsvToRgb(next));
    applyRoomThemeColor(hex);
    writeRoomThemeColor(hex);
  };

  const updateFromWheel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = event.clientX - (rect.left + radius);
    const dy = event.clientY - (rect.top + radius);
    const distance = Math.min(Math.hypot(dx, dy), radius);
    const h = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    updateColor({ ...hsv, h, s: distance / radius });
  };

  const handleWheelPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromWheel(event);
  };

  const handleWheelPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromWheel(event);
  };

  const handleWheelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const hueStep = event.shiftKey ? 10 : 2;
    let next = hsv;
    if (event.key === 'ArrowLeft') next = { ...hsv, h: (hsv.h - hueStep + 360) % 360 };
    else if (event.key === 'ArrowRight') next = { ...hsv, h: (hsv.h + hueStep) % 360 };
    else if (event.key === 'ArrowUp') next = { ...hsv, s: Math.min(1, hsv.s + 0.02) };
    else if (event.key === 'ArrowDown') next = { ...hsv, s: Math.max(0, hsv.s - 0.02) };
    else return;
    event.preventDefault();
    updateColor(next);
  };

  const reset = () => updateColor(rgbToHsv(hexToThemeRgb(DEFAULT_THEME_COLOR)));
  const markerAngle = (hsv.h - 90) * Math.PI / 180;
  const markerLeft = 50 + Math.cos(markerAngle) * hsv.s * 50;
  const markerTop = 50 + Math.sin(markerAngle) * hsv.s * 50;
  const brightHue = themeRgbToHex(hsvToRgb({ ...hsv, v: 1 }));

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Tooltip side="bottom" content="修改主题色" disabled={open}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-white/[0.08] min-[1200px]:px-2.5 ${
            open ? 'bg-white/[0.08] text-netease-red' : 'text-netease-muted hover:text-white'
          }`}
          aria-label="修改主题色"
          aria-expanded={open}
        >
          <Palette className="h-4 w-4 shrink-0" />
          <span className="hidden min-[1200px]:inline">主题色</span>
        </button>
      </Tooltip>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-[calc(100%+8px)] z-[100] w-[calc(220px+1.5rem)] rounded-2xl border border-white/10 bg-[#18181d]/95 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
          style={panelShiftX ? { transform: `translateX(${panelShiftX}px)` } : undefined}
        >
          <div className="mb-2 flex items-center justify-between px-3">
            <h2 className="text-sm font-medium text-white">房间主题色</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
              aria-label="关闭主题色设置"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            role="slider"
            tabIndex={0}
            aria-label="主题色圆盘"
            aria-valuetext={`RGB ${rgb.r}, ${rgb.g}, ${rgb.b}`}
            onPointerDown={handleWheelPointerDown}
            onPointerMove={handleWheelPointerMove}
            onKeyDown={handleWheelKeyDown}
            className="relative mx-auto cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, touchAction: 'none' }}
          >
            <canvas
              ref={canvasRef}
              className="block rounded-full"
              width={WHEEL_SIZE}
              height={WHEEL_SIZE}
            />
            <span
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_5px_rgba(0,0,0,0.8)]"
              style={{ left: `${markerLeft}%`, top: `${markerTop}%`, backgroundColor: color }}
            />
          </div>

          <div className="mt-3 px-3">
            <div className="flex items-center gap-2.5">
              <span
                className="h-8 w-8 flex-shrink-0 rounded-lg border border-white/20 shadow"
                style={{ backgroundColor: color }}
              />
              <div className="min-w-0 text-xs text-netease-muted">
                <span className="font-mono uppercase text-white">{color}</span>
                <span className="ml-2">RGB({rgb.r}, {rgb.g}, {rgb.b})</span>
              </div>
            </div>

            <label className="mt-3 block">
              <div className="mb-1.5 flex justify-between text-[11px] text-netease-muted">
                <span>亮度</span>
                <span>{Math.round(hsv.v * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(hsv.v * 100)}
                onChange={(event) => updateColor({ ...hsv, v: Number(event.target.value) / 100 })}
                className="h-2 w-full cursor-pointer"
                style={{ accentColor: brightHue }}
                aria-label="主题色亮度"
              />
            </label>

            <button
              type="button"
              onClick={reset}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs text-netease-muted transition-colors hover:bg-white/5 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复默认红色
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
