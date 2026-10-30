import type { RoomVisualFxSettings } from './roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX } from './roomVisualPreset';
import { lyricFontCss, normalizeLyricFontKey, type LyricFontKey } from './lyricStyle';

export const LYRIC_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900' +
  '&family=Inter:wght@400;500;600;700;900' +
  '&family=JetBrains+Mono:wght@400;500;600;700' +
  '&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400' +
  '&family=LXGW+WenKai&family=Noto+Sans+SC:wght@400;500;700;900' +
  '&family=Noto+Serif+SC:wght@400;700;900' +
  '&family=UnifrakturCook:wght@700&display=swap';

const FONT_LINK_ID = 'openmusic-lyric-fonts';
const CANVAS_FONT_SIZES = [42, 48, 76, 128];

function fxForFontLoad(fx?: RoomVisualFxSettings): RoomVisualFxSettings {
  if (fx) return fx;
  return DEFAULT_ROOM_VISUAL_FX;
}

function fontLoadCacheKey(fx: RoomVisualFxSettings): string {
  const key = normalizeLyricFontKey(fx.lyricFont);
  const weight = lyricFontCss(fx, 48).split(' ')[0];
  return `${key}:${weight}`;
}

/** 注入 Google Fonts（对齐 Mineradio + 中文楷体/宋体 Web 字体） */
export function injectLyricFontStylesheet(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = LYRIC_FONTS_HREF;
  document.head.appendChild(link);
}

const fontLoadCache = new Map<string, Promise<void>>();

/** 等待歌词 Canvas/DOM 实际使用的 font 字符串就绪 */
export function ensureLyricFontLoaded(fx?: RoomVisualFxSettings): Promise<void> {
  const settings = fxForFontLoad(fx);
  const cacheKey = fontLoadCacheKey(settings);
  const cached = fontLoadCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    injectLyricFontStylesheet();
    if (typeof document === 'undefined' || !document.fonts?.load) return;

    const tasks = CANVAS_FONT_SIZES.map((size) =>
      document.fonts.load(lyricFontCss(settings, size)).catch(() => undefined),
    );
    await Promise.all(tasks);
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  })();

  fontLoadCache.set(cacheKey, promise);
  return promise;
}

export function lyricFontDataAttr(key: LyricFontKey): LyricFontKey {
  return normalizeLyricFontKey(key);
}
