import * as THREE from 'three';

import { roomVisualFxLive } from '../../../lib/roomVisualFxLive';
import { stageLyricPaletteLive } from '../../../lib/stageLyricPaletteLive';
import { resolveImmersiveLyricLines } from '../../../lib/immersiveLyricLines';
import {
  drawTextWithLetterSpacing,
  lyricFontCss,
  lyricLetterSpacingPx,
  measureTextWithLetterSpacing,
  normalizeLyricFontKey,
} from '../../../lib/lyricStyle';
import { normalizeHexColor } from '../../../lib/roomVisualPreset';
import { makeDotTexture } from './dotTexture';
import type { StageLyricStageRoot } from './galaxyStageLyrics3D';

export type LyricMaskAsset = {
  texture: THREE.CanvasTexture;
  textMin: number;
  textMax: number;
  planeWidth: number;
  planeHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  /** CSS/排版坐标尺寸；canvasWidth/Height 是实际上传到 GPU 的像素尺寸 */
  logicalWidth: number;
  logicalHeight: number;
  renderScale: number;
  fontSize: number;
  text: string;
  lines: string[];
  rows: LyricMaskRow[];
  /** 当前行中心相对画布中心的偏移（逻辑 px，向下为正） */
  activeCenterOffset: number;
  /** 当前行的行高（逻辑 px），多行滚动一次的位移量 */
  activeRowStep: number;
};

export type LyricMaskRow = {
  text: string;
  alpha?: number;
  scale?: number;
  gapBefore?: number;
  active?: boolean;
  translation?: boolean;
};

export type BuildLyricMaskOptions = {
  rows?: LyricMaskRow[];
  translationMode?: 'off' | 'current' | 'dual' | 'multi';
  /**
   * stage：整块歌词固定 6.1 世界宽（旧行为）。
   * row：世界宽随画布宽线性变化，这样每一行单独成 mesh 时字号在世界空间里仍然一致。
   */
  worldScale?: 'stage' | 'row';
  /** 排版可用宽度上限（逻辑 px）；行轨道用更窄的预算，避免长句撑出视口 */
  fitBudgetW?: number;
};

const LYRIC_CANVAS_MAX_W = 2048;
const LYRIC_CANVAS_MIN_W = 480;
/** 溢光/描边都是模糊图层，按逻辑尺寸满分辨率重绘会在切句时卡主线程 */
const LYRIC_GLOW_RASTER_BUDGET = 1024;
const LYRIC_STROKE_RASTER_BUDGET = 1280;
/** Mineradio fitBaseSize=128；我们世界面略窄，基准取 96 再自适应 */
const LYRIC_BASE_FONT = 96;
const LYRIC_MIN_FONT_SINGLE = 42;
const LYRIC_MIN_FONT_MULTI = 46;
const LYRIC_MIN_FONT_WRAP = 34;
const LYRIC_LINE_HEIGHT = 1.04;
const LYRIC_WORLD_W = 6.1;
/** worldScale='row' 的基准画布宽：逻辑 1200px ↔ 6.1 世界宽 */
const LYRIC_ROW_REF_W = 1200;
/** 行轨道排版预算：约 7.8 世界宽，长句换行而不是缩小整叠歌词 */
export const LYRIC_ROW_FIT_BUDGET_W = 1536;

/** Mineradio 按行数阶梯抬高画布，避免多行把字号压到糊成白板 */
function lyricCanvasHeightBudget(rowCount: number): number {
  if (rowCount > 9) return 1344;
  if (rowCount > 8) return 1216;
  if (rowCount > 7) return 1088;
  if (rowCount > 6) return 960;
  if (rowCount > 5) return 832;
  if (rowCount > 4) return 704;
  if (rowCount > 3) return 608;
  if (rowCount > 2) return 512;
  return 384;
}

const LYRIC_PALETTE_FALLBACK = {
  primary: new THREE.Color('#d6f8ff'),
  highlight: new THREE.Color('#eef7ff'),
  glow: new THREE.Color('#9cffdf'),
  solar: new THREE.Color('#fff0b8'),
  sunWarm: new THREE.Color('#ffe7a6'),
  sunHot: new THREE.Color('#fff4cc'),
};

function cssColorToThreeColor(css: string, fallback: string): THREE.Color {
  const c = new THREE.Color(fallback || '#d6f8ff');
  const value = String(css || fallback || '#d6f8ff').trim();
  try {
    if (/^#[0-9a-f]{3}$/i.test(value) || /^#[0-9a-f]{6}$/i.test(value)) {
      c.set(normalizeHexColor(value, '#d6f8ff'));
      return c;
    }
    const m = value.match(/^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)/i);
    if (m) {
      c.setRGB(
        Math.max(0, Math.min(255, parseFloat(m[1]))) / 255,
        Math.max(0, Math.min(255, parseFloat(m[2]))) / 255,
        Math.max(0, Math.min(255, parseFloat(m[3]))) / 255,
      );
      return c;
    }
    c.setStyle(value);
  } catch {
    try {
      c.set(normalizeHexColor(fallback || '#d6f8ff', '#d6f8ff'));
    } catch {
      // ignore
    }
  }
  return c;
}

/** Mineradio lyricThreeColor */
function lyricThreeColor(css: string, fallback: string, minLum?: number): THREE.Color {
  const c = cssColorToThreeColor(css, fallback || '#d6f8ff');
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  const floor = minLum == null ? 0.34 : minLum;
  if (lum < floor) {
    const lift = floor - lum;
    c.r = Math.min(1, c.r + lift);
    c.g = Math.min(1, c.g + lift);
    c.b = Math.min(1, c.b + lift);
  }
  return c;
}

/** Mineradio applyLyricPaletteToMesh */
export function applyLyricPaletteToMesh(mesh: LyricMeshGroup | null | undefined): void {
  if (!mesh?.userData?.lyric) return;
  const pal = stageLyricPaletteLive.palette;
  const data = mesh.userData.lyric;
  if (data.textMat?.uniforms) {
    const u = data.textMat.uniforms;
    if (u.uBaseColor) u.uBaseColor.value.copy(lyricThreeColor(pal.primary, '#d6f8ff', 0.38));
    if (u.uHiColor) u.uHiColor.value.copy(lyricThreeColor(pal.highlight || pal.primary, '#fff0b8', 0.48));
    if (u.uGlowColor) {
      u.uGlowColor.value.copy(
        lyricThreeColor(pal.glowColor || pal.secondary || pal.primary, '#9cffdf', 0.36),
      );
    }
    if (u.uSolarColor) {
      u.uSolarColor.value.copy(
        lyricThreeColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5),
      );
    }
    data.textMat.needsUpdate = true;
  }
  if (data.glowMat) {
    data.glowMat.color.copy(
      lyricThreeColor(pal.glowColor || pal.secondary || pal.primary, '#9cffdf', 0.36),
    );
  }
  if (data.sparkMat?.uniforms?.uColor) {
    data.sparkMat.uniforms.uColor.value.copy(
      lyricThreeColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.46),
    );
  }
  if (data.sunMat) {
    data.sunMat.color.copy(
      lyricThreeColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5),
    );
  }
}

function applyStonePrintTexture(ctx: CanvasRenderingContext2D, W: number, H: number, _fontSize: number): void {
  if (normalizeLyricFontKey(roomVisualFxLive.current.lyricFont) !== 'stone-song') return;
  const bandTop = H * 0.1;
  const bandH = H * 0.8;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const noiseW = 300;
  const noiseH = 110;
  const noise = document.createElement('canvas');
  noise.width = noiseW;
  noise.height = noiseH;
  const nctx = noise.getContext('2d');
  if (!nctx) {
    ctx.restore();
    return;
  }
  const img = nctx.createImageData(noiseW, noiseH);
  for (let p = 0; p < noiseW * noiseH; p++) {
    const x0 = p % noiseW;
    const y0 = Math.floor(p / noiseW);
    const vein = Math.sin(x0 * 0.19 + y0 * 0.043) * 0.1 + Math.sin(y0 * 0.31) * 0.06;
    const r = Math.random() + vein;
    let a = 0;
    if (r > 0.82) a = 78 + Math.random() * 92;
    else if (r > 0.62) a = 22 + Math.random() * 54;
    else if (r > 0.48) a = 4 + Math.random() * 24;
    img.data[p * 4] = 255;
    img.data[p * 4 + 1] = 255;
    img.data[p * 4 + 2] = 255;
    img.data[p * 4 + 3] = a;
  }
  nctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.34;
  ctx.drawImage(noise, 0, bandTop, W, bandH);
  ctx.restore();
}

let sunBloomTexture: THREE.CanvasTexture | null = null;
let sharedDotTexture: THREE.CanvasTexture | null = null;

function lyricFont(fontSize: number): string {
  return lyricFontCss(roomVisualFxLive.current, fontSize);
}

function measuredTextWidth(mask: LyricMaskAsset): number {
  return (mask.textMax - mask.textMin) * mask.logicalWidth;
}

function measureLyricLineWidth(
  ctx: CanvasRenderingContext2D,
  line: string,
  fontSize: number,
): number {
  const spacing = lyricLetterSpacingPx(roomVisualFxLive.current, fontSize);
  ctx.font = lyricFont(fontSize);
  return measureTextWithLetterSpacing(ctx, line, spacing);
}

function measureLyricBlockWidth(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  fontSize: number,
): number {
  let max = 0;
  for (const line of lines) {
    max = Math.max(max, measureLyricLineWidth(ctx, line, fontSize));
  }
  return Math.max(1, max);
}

function lyricRowsBlockHeight(rows: LyricMaskRow[], fontSize: number): number {
  return rows.reduce((height, row, index) => {
    const scale = Math.max(0.46, Math.min(1.12, row.scale ?? 1));
    const gap = index > 0 ? Math.max(0, row.gapBefore ?? 0) * fontSize : 0;
    return height + gap + fontSize * scale * LYRIC_LINE_HEIGHT;
  }, 0);
}

/** 当前行在整块里的几何位置：多行滚动要靠它把当前行钉在同一位置 */
function activeRowMetrics(
  rows: LyricMaskRow[],
  fontSize: number,
): { centerOffset: number; step: number } {
  const blockH = lyricRowsBlockHeight(rows, fontSize);
  let cursor = -blockH / 2;
  let fallback = { centerOffset: 0, step: fontSize * LYRIC_LINE_HEIGHT };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i > 0) cursor += Math.max(0, row.gapBefore ?? 0) * fontSize;
    const rowStep = fontSize * Math.max(0.46, Math.min(1.12, row.scale ?? 1)) * LYRIC_LINE_HEIGHT;
    if (row.active && !row.translation) {
      return { centerOffset: cursor + rowStep / 2, step: rowStep };
    }
    if (row.active) fallback = { centerOffset: cursor + rowStep / 2, step: rowStep };
    cursor += rowStep;
  }
  return fallback;
}

function measureLyricRowsWidth(
  ctx: CanvasRenderingContext2D,
  rows: LyricMaskRow[],
  fontSize: number,
): number {
  let max = 1;
  for (const row of rows) {
    const rowSize = fontSize * Math.max(0.46, Math.min(1.12, row.scale ?? 1));
    max = Math.max(max, measureLyricLineWidth(ctx, row.text, rowSize));
  }
  return max;
}

function fitLyricRowsLayout(
  ctx: CanvasRenderingContext2D,
  rows: LyricMaskRow[],
  budgetW?: number,
): { rows: LyricMaskRow[]; fontSize: number; measured: number; blockH: number } {
  const normalized = rows
    .map((row) => ({ ...row, text: String(row.text || '').trim() }))
    .filter((row) => row.text)
    .slice(0, 24)
    .flatMap((row) => budgetW
      ? wrapLyricTrackText(ctx, row.text, LYRIC_BASE_FONT * Math.max(0.46, Math.min(1.12, row.scale ?? 1)), budgetW)
        .map((text, index) => ({ ...row, text, gapBefore: index === 0 ? row.gapBefore : 0 }))
      : [row]);
  const maxContentW = Math.min(LYRIC_CANVAS_MAX_W - 88, budgetW || LYRIC_CANVAS_MAX_W - 88);
  const rowCount = Math.max(1, normalized.length);
  // Mineradio：行数越多画布越高，字号下限保持 42/46，不靠压到 18px 硬塞
  const maxContentH = lyricCanvasHeightBudget(rowCount) - 76;
  const minFont = rowCount > 2 ? LYRIC_MIN_FONT_MULTI : LYRIC_MIN_FONT_SINGLE;
  for (let size = LYRIC_BASE_FONT; size >= minFont; size -= 4) {
    const measured = measureLyricRowsWidth(ctx, normalized, size);
    const blockH = lyricRowsBlockHeight(normalized, size);
    if (measured <= maxContentW && blockH <= maxContentH) {
      return { rows: normalized, fontSize: size, measured, blockH };
    }
  }
  const fontSize = minFont;
  return {
    rows: normalized,
    fontSize,
    measured: measureLyricRowsWidth(ctx, normalized, fontSize),
    blockH: lyricRowsBlockHeight(normalized, fontSize),
  };
}

/** 过长单行：按空白/标点，最后中点硬拆（翻译分行已在 resolveImmersiveLyricLines 处理） */
function splitLyricForWrap(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [trimmed];

  const mid = Math.floor(trimmed.length / 2);
  const breakChars = /[\s、，,。．.!！?？:：;；\-—/／]/u;
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < trimmed.length; i++) {
    if (!breakChars.test(trimmed[i]!)) continue;
    const dist = Math.abs(i - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  if (best > 0 && best < trimmed.length - 1) {
    const left = trimmed.slice(0, best + 1).trim();
    const right = trimmed.slice(best + 1).trim();
    if (left && right) return [left, right];
  }

  const hard = Math.max(1, Math.min(trimmed.length - 1, mid));
  return [trimmed.slice(0, hard).trim(), trimmed.slice(hard).trim()].filter(Boolean);
}

export function wrapLyricTrackText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize = LYRIC_BASE_FONT,
  budgetW = LYRIC_ROW_FIT_BUDGET_W,
): string[] {
  const wrapped: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    let current = '';
    const tokens = line.trim().match(/\s+|[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*|[^\s]/gu) ?? [];
    for (const token of tokens) {
      const parts = measureLyricLineWidth(ctx, token, fontSize) <= budgetW ? [token] : Array.from(token);
      for (const part of parts) {
        const candidate = current + part;
        if (current && measureLyricLineWidth(ctx, candidate, fontSize) > budgetW) {
          if (current.trim()) wrapped.push(current.trim());
          current = part.trimStart();
        } else {
          current = candidate;
        }
      }
    }
    if (current.trim()) wrapped.push(current.trim());
  }
  return wrapped;
}

function fitWrappedLyricLayout(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  startSize: number,
): { lines: string[]; fontSize: number; measured: number } {
  const maxContentW = LYRIC_CANVAS_MAX_W - 120;
  for (let size = startSize; size >= LYRIC_MIN_FONT_WRAP; size -= 2) {
    const measured = measureLyricBlockWidth(ctx, lines, size);
    if (measured <= maxContentW) {
      return { lines, fontSize: size, measured };
    }
  }

  let fontSize = LYRIC_MIN_FONT_WRAP;
  let measured = measureLyricBlockWidth(ctx, lines, fontSize);
  while (measured > maxContentW && fontSize > 22) {
    fontSize -= 2;
    measured = measureLyricBlockWidth(ctx, lines, fontSize);
  }
  return { lines, fontSize, measured };
}

function fitLyricLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  translation?: string | null,
  showTranslation = true,
): { lines: string[]; fontSize: number; measured: number } {
  const maxContentW = LYRIC_CANVAS_MAX_W - 120;
  const resolved = resolveImmersiveLyricLines(text, translation, { showTranslation });

  // 有翻译 / 已拆多行：始终按多行排版（所有沉浸预设共用）
  if (resolved.length > 1) {
    return fitWrappedLyricLayout(ctx, resolved, Math.min(LYRIC_BASE_FONT, 68));
  }

  const single = resolved[0] || '';
  for (let size = LYRIC_BASE_FONT; size >= LYRIC_MIN_FONT_SINGLE; size -= 2) {
    const measured = measureLyricBlockWidth(ctx, [single], size);
    if (measured <= maxContentW) {
      return { lines: [single], fontSize: size, measured };
    }
  }

  return fitWrappedLyricLayout(ctx, splitLyricForWrap(single), Math.min(LYRIC_BASE_FONT, 68));
}

/**
 * 行级绘制：字号 / 透明度都跟随 row，溢光与描边层必须复用，
 * 否则待播放行会被满字号的光晕副本撑成和当前行一样大。
 */
function drawLyricRowsStyled(
  ctx: CanvasRenderingContext2D,
  rows: LyricMaskRow[],
  fontSize: number,
  centerX: number,
  centerY: number,
  options: {
    stroke?: boolean;
    alphaFor?: (row: LyricMaskRow) => number;
    lineWidthFor?: (rowScale: number) => number;
    /** 把「是否当前行」写进红通道，着色器据此只高亮/溢光当前句 */
    markActiveChannel?: boolean;
  } = {},
): void {
  const blockH = lyricRowsBlockHeight(rows, fontSize);
  let cursorY = centerY - blockH / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i > 0) cursorY += Math.max(0, row.gapBefore ?? 0) * fontSize;
    const rowScale = Math.max(0.46, Math.min(1.12, row.scale ?? 1));
    const rowSize = fontSize * rowScale;
    const rowStep = rowSize * LYRIC_LINE_HEIGHT;
    const alpha = options.alphaFor ? options.alphaFor(row) : (row.alpha ?? 1);
    if (alpha > 0.002) {
      const spacing = lyricLetterSpacingPx(roomVisualFxLive.current, rowSize);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = lyricFont(rowSize);
      if (options.markActiveChannel) ctx.fillStyle = row.active ? '#ffffff' : '#00ffff';
      if (options.lineWidthFor) ctx.lineWidth = options.lineWidthFor(rowScale);
      drawTextWithLetterSpacing(ctx, row.text, centerX, cursorY + rowStep / 2, spacing, options.stroke);
      ctx.restore();
    }
    cursorY += rowStep;
  }
}

function drawLyricRows(
  ctx: CanvasRenderingContext2D,
  rows: LyricMaskRow[],
  fontSize: number,
  centerX: number,
  centerY: number,
): void {
  drawLyricRowsStyled(ctx, rows, fontSize, centerX, centerY, { markActiveChannel: true });
}

function applyLyricEdgeFade(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  measured: number,
  fontSize: number,
  lineCount: number,
): void {
  const intensity = Math.max(0, Math.min(1, roomVisualFxLive.current.lyricEdgeFade ?? 0.6));
  if (intensity <= 0.001) return;
  const padX = Math.max(24, (W - measured) / 2);
  const fadeX = Math.min(0.12, Math.max(0.03, (padX * 0.72) / W)) * intensity;
  const blockH = fontSize * LYRIC_LINE_HEIGHT * lineCount;
  const padY = Math.max(16, (H - blockH) / 2);
  // 多行时减弱纵向羽化，避免自定义 8~10 行外圈被「裁没」
  const yCap = lineCount >= 8 ? 0.06 : lineCount >= 5 ? 0.12 : 0.2;
  const yFloor = lineCount >= 8 ? 0.02 : 0.06;
  const fadeY = Math.min(yCap, Math.max(yFloor, (padY * 0.7) / H)) * intensity;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const xMask = ctx.createLinearGradient(0, 0, W, 0);
  xMask.addColorStop(0, 'rgba(255,255,255,0)');
  xMask.addColorStop(fadeX, 'rgba(255,255,255,1)');
  xMask.addColorStop(1 - fadeX, 'rgba(255,255,255,1)');
  xMask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = xMask;
  ctx.fillRect(0, 0, W, H);
  const yMask = ctx.createLinearGradient(0, 0, 0, H);
  yMask.addColorStop(0, 'rgba(255,255,255,0)');
  yMask.addColorStop(fadeY, 'rgba(255,255,255,1)');
  yMask.addColorStop(1 - fadeY, 'rgba(255,255,255,1)');
  yMask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = yMask;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export function buildLyricMaskAsset(
  text: string,
  translation?: string | null,
  showTranslation = true,
  options?: BuildLyricMaskOptions,
): LyricMaskAsset {
  const canvas = document.createElement('canvas');
  const measureCtx = canvas.getContext('2d');
  if (!measureCtx) throw new Error('canvas 2d unavailable');

  const fallbackLayout = options?.rows?.length ? null : fitLyricLayout(
    measureCtx,
    text,
    translation,
    showTranslation && (options?.translationMode ?? roomVisualFxLive.current.lyricTranslationMode) !== 'off',
  );
  const fallbackRows = (fallbackLayout?.lines ?? []).map((line, index) => ({
    text: line,
    alpha: 1,
    scale: index === 0 ? 1 : 0.74,
    gapBefore: index === 0 ? 0 : 0.12,
    active: index === 0,
    translation: index > 0,
  }));
  const rowLayout = fitLyricRowsLayout(
    measureCtx,
    options?.rows?.length ? options.rows : fallbackRows,
    options?.fitBudgetW,
  );
  const { rows, fontSize, measured, blockH } = rowLayout;
  const activeMetrics = options?.worldScale === 'row'
    ? { centerOffset: 0, step: blockH }
    : activeRowMetrics(rows, fontSize);
  const lines = rows.map((row) => row.text);
  const padX = Math.max(96, fontSize * 1.15);
  const padY = Math.max(36, fontSize * 0.55);
  const logicalW = Math.min(LYRIC_CANVAS_MAX_W, Math.max(LYRIC_CANVAS_MIN_W, Math.ceil(measured + padX)));
  const logicalH = Math.min(1344, Math.max(144, Math.ceil(blockH + padY * 2)));
  const qualityCap = ({ eco: 1, balanced: 2, high: 3, ultra: 4 } as const)[roomVisualFxLive.current.performanceQuality] ?? 2;
  const requestedScale = Math.max(1, Math.min(qualityCap, Math.round(roomVisualFxLive.current.lyricTextureClarity || 2)));
  const renderScale = Math.max(
    1,
    Math.min(requestedScale, LYRIC_CANVAS_MAX_W / logicalW, 1344 / logicalH),
  );
  const W = Math.max(1, Math.floor(logicalW * renderScale));
  const H = Math.max(1, Math.floor(logicalH * renderScale));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.scale(renderScale, renderScale);
  ctx.fillStyle = '#ffffff';
  drawLyricRows(ctx, rows, fontSize, logicalW / 2, logicalH / 2);
  applyStonePrintTexture(ctx, logicalW, logicalH, fontSize);
  applyLyricEdgeFade(ctx, logicalW, logicalH, measured, fontSize, lines.length);

  const textMin = (logicalW / 2 - measured / 2) / logicalW;
  const textMax = (logicalW / 2 + measured / 2) / logicalW;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  // 行轨道模式下每行是独立 mesh，若仍用固定世界宽，短句会被放大成巨字
  const worldW = options?.worldScale === 'row'
    ? LYRIC_WORLD_W * (logicalW / LYRIC_ROW_REF_W)
    : LYRIC_WORLD_W;
  const worldH = worldW * (logicalH / logicalW);
  const displayText = lines.join('\n');

  return {
    texture,
    textMin,
    textMax,
    planeWidth: worldW,
    planeHeight: worldH,
    canvasWidth: W,
    canvasHeight: H,
    logicalWidth: logicalW,
    logicalHeight: logicalH,
    renderScale,
    fontSize,
    text: displayText,
    lines,
    rows,
    activeCenterOffset: activeMetrics.centerOffset,
    activeRowStep: activeMetrics.step,
  };
}

function getSunBloomTexture(): THREE.CanvasTexture {
  if (sunBloomTexture) return sunBloomTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(2.05, 1);
  const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, canvas.height * 0.43);
  radial.addColorStop(0, 'rgba(255,246,186,0.92)');
  radial.addColorStop(0.18, 'rgba(255,219,126,0.44)');
  radial.addColorStop(0.46, 'rgba(255,186,82,0.15)');
  radial.addColorStop(1, 'rgba(255,186,82,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(-canvas.width, -canvas.height, canvas.width * 2, canvas.height * 2);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(34px)';
  ctx.fillStyle = 'rgba(255,235,168,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, canvas.width * 0.33, canvas.height * 0.14, -0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  sunBloomTexture = new THREE.CanvasTexture(canvas);
  sunBloomTexture.minFilter = THREE.LinearFilter;
  sunBloomTexture.magFilter = THREE.LinearFilter;
  sunBloomTexture.generateMipmaps = false;
  return sunBloomTexture;
}

function buildGlowTexture(mask: LyricMaskAsset): THREE.CanvasTexture {
  const { fontSize, lines, rows } = mask;
  const measuredWidth = Math.max(1, measuredTextWidth(mask));
  const padX = Math.max(160, fontSize * 1.45);
  const padY = Math.max(86, fontSize * 0.78);
  const blockH = lyricRowsBlockHeight(rows, fontSize);
  const W = Math.ceil(measuredWidth + padX * 2);
  const H = Math.ceil(blockH + padY * 2);

  // Mineradio pixelScale = clamp(rasterScale, 0.20, 1)：溢光是纯模糊光晕，
  // 按逻辑尺寸满分辨率跑 12 遍大半径模糊会在每次切句卡住主线程。
  const ps = Math.max(0.2, Math.min(1, LYRIC_GLOW_RASTER_BUDGET / Math.max(W, H)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(W * ps));
  canvas.height = Math.max(1, Math.floor(H * ps));
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'lighter';

  // 每个字使用独立的离屏画布做模糊，避免大半径描边把整句连接成矩形光块。
  const drawGlyphGlow = (
    glyph: string,
    centerX: number,
    centerY: number,
    rowSize: number,
    alpha: number,
  ) => {
    if (!glyph.trim() || alpha <= 0.002) return;
    const scaledSize = rowSize * ps;
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = lyricFont(scaledSize);
    const glyphWidth = Math.max(scaledSize * 0.38, measure.measureText(glyph).width);
    const maxBlur = Math.max(4, scaledSize * 0.34);
    const pad = Math.ceil(maxBlur * 2.8 + scaledSize * 0.18);
    const glyphCanvas = document.createElement('canvas');
    glyphCanvas.width = Math.max(1, Math.ceil(glyphWidth + pad * 2));
    glyphCanvas.height = Math.max(1, Math.ceil(scaledSize * 1.55 + pad * 2));
    const glyphCtx = glyphCanvas.getContext('2d')!;
    glyphCtx.font = lyricFont(scaledSize);
    glyphCtx.textAlign = 'center';
    glyphCtx.textBaseline = 'middle';
    glyphCtx.lineJoin = 'round';
    glyphCtx.lineCap = 'round';
    glyphCtx.fillStyle = '#fff';
    glyphCtx.strokeStyle = '#fff';
    const gx = glyphCanvas.width / 2;
    const gy = glyphCanvas.height / 2;
    const passes = [
      { blur: Math.max(1, scaledSize * 0.08), opacity: 0.52, stroke: scaledSize * 0.075 },
      { blur: Math.max(1.5, scaledSize * 0.17), opacity: 0.34, stroke: scaledSize * 0.1 },
      { blur: Math.max(2, scaledSize * 0.28), opacity: 0.2, stroke: scaledSize * 0.12 },
    ];
    for (const pass of passes) {
      glyphCtx.save();
      glyphCtx.filter = `blur(${pass.blur.toFixed(2)}px)`;
      glyphCtx.globalAlpha = alpha * pass.opacity;
      glyphCtx.lineWidth = Math.max(1, pass.stroke);
      glyphCtx.strokeText(glyph, gx, gy);
      glyphCtx.fillText(glyph, gx, gy);
      glyphCtx.restore();
    }
    glyphCtx.save();
    glyphCtx.filter = `blur(${Math.max(0.8, scaledSize * 0.045).toFixed(2)}px)`;
    glyphCtx.globalAlpha = alpha * 0.34;
    glyphCtx.fillText(glyph, gx, gy);
    glyphCtx.restore();
    ctx.drawImage(
      glyphCanvas,
      centerX * ps - glyphCanvas.width / 2,
      centerY * ps - glyphCanvas.height / 2,
    );
  };

  const blockHeight = lyricRowsBlockHeight(rows, fontSize);
  let cursorY = H / 2 - blockHeight / 2;
  const measureCtx = document.createElement('canvas').getContext('2d')!;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (index > 0) cursorY += Math.max(0, row.gapBefore ?? 0) * fontSize;
    const rowScale = Math.max(0.46, Math.min(1.12, row.scale ?? 1));
    const rowSize = fontSize * rowScale;
    const rowStep = rowSize * LYRIC_LINE_HEIGHT;
    if (row.active) {
      const alphaBase = Math.max(0.22, Math.min(1, row.alpha ?? 1));
      const alpha = row.translation ? Math.max(0.08, alphaBase * 0.34) : alphaBase;
      const spacing = lyricLetterSpacingPx(roomVisualFxLive.current, rowSize);
      measureCtx.font = lyricFont(rowSize);
      const glyphs = Array.from(row.text);
      const widths = glyphs.map((glyph) => measureCtx.measureText(glyph).width);
      const totalWidth = widths.reduce((sum, width) => sum + width, 0)
        + Math.max(0, glyphs.length - 1) * spacing;
      let cursorX = W / 2 - totalWidth / 2;
      for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
        const glyphWidth = widths[glyphIndex] || 0;
        drawGlyphGlow(
          glyphs[glyphIndex]!,
          cursorX + glyphWidth / 2,
          cursorY + rowStep / 2,
          rowSize,
          alpha,
        );
        cursorX += glyphWidth + spacing;
      }
    }
    cursorY += rowStep;
  }

  applyLyricEdgeFade(
    ctx,
    canvas.width,
    canvas.height,
    measuredWidth * ps,
    fontSize * ps,
    lines.length,
  );

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  (tex as THREE.CanvasTexture & { userData: { width: number; height: number; textWidth: number } }).userData = {
    width: W,
    height: H,
    textWidth: measuredWidth,
  };
  return tex;
}

function buildReadabilityTexture(
  rows: LyricMaskRow[],
  fontSize: number,
  W: number,
  H: number,
): THREE.CanvasTexture {
  const ps = Math.max(0.2, Math.min(1, LYRIC_STROKE_RASTER_BUDGET / Math.max(W, H)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(W * ps));
  canvas.height = Math.max(1, Math.floor(H * ps));
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ps, ps);
  ctx.lineJoin = 'round';
  const stroke = (
    blur: number,
    alpha: number,
    width: number,
    color: string,
    dy = 0,
    activeOnly = false,
  ) => {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.strokeStyle = color;
    drawLyricRowsStyled(ctx, rows, fontSize, W / 2, H / 2 + dy, {
      stroke: true,
      alphaFor: (row) => {
        if (activeOnly && !row.active) return 0;
        // Mineradio：翻译行描边再乘 0.62，alpha 下限更低
        const base = Math.max(row.translation ? 0.1 : 0.22, Math.min(1, row.alpha ?? 1));
        return alpha * base * (row.translation ? 0.62 : 1);
      },
      lineWidthFor: (rowScale) => {
        const scaled = Math.max(1, width * rowScale);
        return rowScale < 0.98 ? Math.max(1.8, scaled * (rowScale < 0.7 ? 0.52 : 1)) : scaled;
      },
    });
    ctx.restore();
  };
  // Mineradio stepLyricReadabilityTextureBuild 原值（模糊走设备像素，线宽留逻辑坐标）
  stroke(Math.max(1, 14 * ps), 0.18, Math.max(18, fontSize * 0.16), 'rgba(0,0,0,1)', fontSize * 0.018);
  stroke(Math.max(0.8, 5 * ps), 0.32, Math.max(9, fontSize * 0.075), 'rgba(0,0,0,1)', fontSize * 0.012);
  // 白描边只给当前句，避免多行糊成白板
  stroke(Math.max(0.7, 4 * ps), 0.15, Math.max(9, fontSize * 0.07), 'rgba(255,255,255,1)', 0, true);
  stroke(Math.max(0.45, 1.2 * ps), 0.26, Math.max(3.2, fontSize * 0.03), 'rgba(255,255,255,1)', 0, true);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function createStageLyricShaderMaterial(mask: LyricMaskAsset): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: mask.texture },
      uTime: { value: 0 },
      uProgress: { value: 1 },
      uTextMin: { value: mask.textMin },
      uTextMax: { value: mask.textMax },
      uOpacity: { value: 0 },
      uBaseColor: { value: LYRIC_PALETTE_FALLBACK.primary.clone() },
      uHiColor: { value: LYRIC_PALETTE_FALLBACK.highlight.clone() },
      uGlowColor: { value: LYRIC_PALETTE_FALLBACK.glow.clone() },
      uSolarColor: { value: LYRIC_PALETTE_FALLBACK.solar.clone() },
      uFeather: { value: 0.045 },
      uSolar: { value: 0 },
      uSweep: { value: 0.36 },
      uShimmer: { value: 0.14 },
      uGlitch: { value: 0 },
      uGlitchSlice: { value: 0 },
      uGlitchChroma: { value: 0 },
      uGlitchRate: { value: 1 },
      uGlitchSeed: { value: Math.random() * 997 },
      uGlitchBurst: { value: 0 },
      uEdgeBoost: { value: 1.04 },
      uActiveMix: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform float uTime, uProgress, uTextMin, uTextMax, uOpacity, uFeather, uSolar;
      uniform float uSweep, uShimmer, uGlitch, uGlitchSlice, uGlitchChroma, uGlitchRate;
      uniform float uGlitchSeed, uGlitchBurst, uEdgeBoost, uActiveMix;
      uniform vec3 uBaseColor, uHiColor, uGlowColor, uSolarColor;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453123); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      void main() {
        vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
        float sliceRows = mix(16.0, 38.0, clamp(uGlitchSlice / 1.4, 0.0, 1.0));
        float row = floor((uv.y + hash(uGlitchSeed) * 0.035) * sliceRows);
        float timeSlot = floor(uTime * mix(7.0, 24.0, clamp(uGlitchRate / 2.2, 0.0, 1.0)) + hash(uGlitchSeed * 1.37) * 5.0);
        float rowRnd = hash2(vec2(row + uGlitchSeed, timeSlot));
        float phaseRnd = hash2(vec2(timeSlot + uGlitchSeed * 0.71, row * 3.17));
        float glitchGate = smoothstep(0.74, 0.99, rowRnd + uGlitchBurst * 0.28) * step(0.001, uGlitch);
        float glitchDir = hash2(vec2(row * 5.11, timeSlot + uGlitchSeed)) < 0.5 ? -1.0 : 1.0;
        float micro = hash2(vec2(floor(uv.x * 19.0) + row, timeSlot * 1.31 + uGlitchSeed));
        float glitchWave = (phaseRnd * 2.0 - 1.0) * (0.55 + micro * 0.95);
        float glitchWidth = (0.0020 + rowRnd * rowRnd * 0.0085) * (0.55 + uGlitchBurst * 1.85);
        vec2 sampleUv = uv + vec2(glitchGate * glitchDir * glitchWave * uGlitch * uGlitchSlice * glitchWidth, 0.0);
        vec4 texel = texture2D(uMap, sampleUv);
        float mask = texel.a;
        if (mask < 0.01) discard;
        // 红通道标记当前行：待播放行不吃高亮/溢光，和 Mineradio 一致
        float rowActive = smoothstep(0.35, 0.65, texel.r);
        float activeMix = clamp(uActiveMix, 0.0, 1.0) * rowActive;
        float denom = max(0.001, uTextMax - uTextMin);
        float p = clamp((uv.x - uTextMin) / denom, 0.0, 1.0);
        float filled = (1.0 - smoothstep(uProgress, uProgress + uFeather, p)) * activeMix;
        float edge = (1.0 - smoothstep(0.0, uFeather * 2.8, abs(p - uProgress))) * activeMix;
        float sweepPhase = fract(uTime * (0.28 + uSweep * 0.10));
        float sweepLine = (1.0 - smoothstep(0.0, 0.080, abs((uv.x + uv.y * 0.42) - (sweepPhase * 1.42 - 0.18)))) * activeMix;
        float fineLine = pow(max(0.0, sin((uv.x - uv.y * 0.18 + uTime * 0.82) * 42.0)), 24.0) * uShimmer * activeMix;
        float chromaR = mask;
        float chromaB = mask;
        if (uGlitch > 0.001) {
          float chromaOffset = (0.0028 + phaseRnd * 0.0048 + uGlitchBurst * 0.0038) * uGlitch * uGlitchChroma;
          chromaR = texture2D(uMap, sampleUv + vec2(chromaOffset * glitchDir, 0.0)).a;
          chromaB = texture2D(uMap, sampleUv - vec2(chromaOffset * glitchDir, 0.0)).a;
        }
        vec3 color = mix(uBaseColor, uHiColor, filled * 0.88);
        color += uGlowColor * edge * 0.14 * uEdgeBoost;
        color += uSolarColor * sweepLine * uSweep * (0.12 + filled * 0.30);
        color += uGlowColor * fineLine * (0.08 + filled * 0.18);
        color += vec3(chromaR, mask * 0.18, chromaB) * glitchGate * uGlitch * uGlitchChroma * activeMix * (0.20 + uGlitchBurst * 0.22);
        vec3 solar = uSolarColor;
        color = mix(color, color + solar * 0.34, uSolar * activeMix * (0.25 + filled * 0.45));
        color += solar * edge * uSolar * 0.22;
        float lum = dot(color, vec3(0.299, 0.587, 0.114));
        color += vec3(max(0.0, 0.30 - lum));
        float alpha = max(mask, max(chromaR, chromaB) * glitchGate * uGlitch * (0.30 + uGlitchBurst * 0.32));
        gl_FragColor = vec4(color, alpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.DoubleSide,
  });
}

export type LyricMeshGroup = THREE.Group & {
  userData: {
    lyric: {
      textMat: THREE.ShaderMaterial;
      /** 上下文行（decorations: false）只有文字层，装饰材质缺席 */
      readabilityMat?: THREE.MeshBasicMaterial;
      glowMat?: THREE.MeshBasicMaterial;
      sparkMat?: THREE.ShaderMaterial;
      sunMat?: THREE.MeshBasicMaterial;
      sun?: THREE.Mesh;
      glow?: THREE.Mesh;
      sparks?: THREE.Points;
      basePositions?: Float32Array;
      textWorldW: number;
      textWorldH: number;
      worldW: number;
      worldH: number;
    };
    age: number;
    floatSeed: number;
    scrollDir?: number;
    /** 一行歌词的世界位移量，多行滚动用 */
    rowStepWorld?: number;
    /** 退场时的目标 Y，和进场块用同一条缓动保持行对齐 */
    exitTargetY?: number;
    /** 由行轨道下发的纵向锚点；存在时 tickLyricMesh 不再自己缓动 Y */
    trackAnchorY?: number;
    glitchBurst?: number;
    glitchNextAt?: number;
    glitchSeed?: number;
  };
};

function createStarRiver(dotTex: THREE.CanvasTexture): THREE.Points {
  const count = 300;
  const geo = new THREE.BufferGeometry();
  const seeds = new Float32Array(count);
  const lanes = new Float32Array(count);
  const depths = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    seeds[i] = Math.random() * 1000;
    lanes[i] = Math.random();
    depths[i] = Math.random();
  }
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('lane', new THREE.BufferAttribute(lanes, 1));
  geo.setAttribute('depthSeed', new THREE.BufferAttribute(depths, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTex },
      uTime: { value: 0 },
      uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
      uBass: { value: 0 },
      uBeat: { value: 0 },
      uWidth: { value: 3.4 },
      uHeight: { value: 0.58 },
      uOpacity: { value: 0 },
      uColorA: { value: LYRIC_PALETTE_FALLBACK.glow.clone() },
      uColorB: { value: LYRIC_PALETTE_FALLBACK.highlight.clone() },
    },
    vertexShader: `
      precision highp float;
      attribute float seed, lane, depthSeed;
      uniform float uTime, uPixel, uBass, uBeat, uWidth, uHeight;
      varying float vSeed, vLane, vGlow;
      float hash(float n) { return fract(sin(n) * 43758.5453123); }
      void main() {
        float laneBand = floor(lane * 5.0);
        float laneLocal = fract(lane * 5.0);
        float speed = 0.030 + hash(seed * 1.71) * 0.055 + laneBand * 0.005;
        float flow = fract(hash(seed * 2.13) + uTime * speed);
        float x = (flow - 0.5) * uWidth * (1.08 + hash(seed * 5.1) * 0.18);
        float curve = sin(flow * 6.2831853 * (0.92 + hash(seed * 4.0) * 0.46) + seed * 0.071 + uTime * 0.34);
        float breath = sin(uTime * (0.42 + hash(seed * 6.9) * 0.42) + seed * 0.093);
        float y = (laneBand - 2.0) * uHeight * 0.135 + curve * uHeight * (0.20 + hash(seed * 9.0) * 0.18)
          + (laneLocal - 0.5) * uHeight * 0.16 + breath * uHeight * 0.10;
        float z = -0.08 + (depthSeed - 0.5) * 0.44 + sin(uTime * (0.18 + hash(seed) * 0.24) + seed) * 0.08;
        float edge = smoothstep(0.0, 0.18, flow) * (1.0 - smoothstep(0.82, 1.0, flow));
        vSeed = seed;
        vLane = lane;
        vGlow = edge * (0.62 + 0.38 * sin(uTime * (0.9 + hash(seed * 8.0) * 0.7) + seed));
        vec4 mv = modelViewMatrix * vec4(vec3(x, y, z), 1.0);
        float dist = max(0.45, -mv.z);
        float size = (0.030 + hash(seed * 12.0) * 0.040 + vGlow * 0.024 + uBeat * 0.010) * (1.0 + uBass * 0.18);
        gl_PointSize = clamp(size * uPixel * 120.0 / dist, 1.0, 7.2);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uColorA, uColorB;
      uniform float uOpacity, uTime, uBeat;
      varying float vSeed, vLane, vGlow;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.02) discard;
        float tw = pow(0.5 + 0.5 * sin(uTime * (0.55 + fract(vSeed) * 0.35) + vSeed), 4.0);
        vec3 col = mix(uColorA, uColorB, smoothstep(0.12, 0.92, vLane) * 0.45 + tw * 0.42 + vGlow * 0.26);
        float alpha = tex.a * uOpacity * (0.20 + vGlow * 0.78 + tw * 0.32 + uBeat * 0.10);
        gl_FragColor = vec4(col * (0.82 + vGlow * 0.72 + tw * 0.32), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.renderOrder = 45;
  points.position.set(0, 0.2, 1.53);
  points.frustumCulled = false;
  return points;
}

/** Mineradio createLyricsParticles / ensureLyricStarRiver — 舞台根组 + 星河流 */
export function createStageLyricRoot(): StageLyricStageRoot {
  if (!sharedDotTexture) sharedDotTexture = makeDotTexture();
  const group = new THREE.Group() as StageLyricStageRoot;
  group.renderOrder = 38;
  const starRiver = createStarRiver(sharedDotTexture);
  group.add(starRiver);
  group.userData.starRiver = starRiver;
  group.userData.starRiverMat = starRiver.material as THREE.ShaderMaterial;
  return group;
}

/**
 * Mineradio buildLyricMesh — 单句歌词 mesh（呼吸动画在 mesh 层）
 * decorations=false 只建文字层，用于行轨道里的上下文行：
 * 它们永远不发光，省掉溢光/描边/星尘三张纹理后才敢常驻十几行。
 */
export function buildLyricMesh(
  mask: LyricMaskAsset,
  options: { decorations?: boolean } = {},
): LyricMeshGroup {
  const decorations = options.decorations !== false;
  if (!sharedDotTexture) sharedDotTexture = makeDotTexture();

  const {
    planeWidth: worldW,
    planeHeight: worldH,
    logicalWidth: W,
    logicalHeight: H,
    fontSize,
  } = mask;
  const textWorldW = worldW * (mask.textMax - mask.textMin);
  const textBlockH = lyricRowsBlockHeight(mask.rows, fontSize);
  const textWorldH = worldH * (textBlockH / H);
  const geo = new THREE.PlaneGeometry(worldW, worldH, 1, 1);

  const group = new THREE.Group() as LyricMeshGroup;
  group.renderOrder = 42;
  group.position.set((Math.random() - 0.5) * 0.08, 0.2, 1.46);
  group.scale.setScalar(0.96);
  group.userData.age = 0;
  group.userData.floatSeed = Math.random() * 100;

  let sunMat: THREE.MeshBasicMaterial | undefined;
  let sun: THREE.Mesh | undefined;
  let glowMat: THREE.MeshBasicMaterial | undefined;
  let glow: THREE.Mesh | undefined;
  let readabilityMat: THREE.MeshBasicMaterial | undefined;
  let sparkMat: THREE.ShaderMaterial | undefined;
  let sparks: THREE.Points | undefined;
  let basePositions: Float32Array | undefined;

  if (decorations) {
    // 行轨道下 mesh 只有一行，画布高度里大半是留白；日冕若按 worldH 走，
    // 会长成一条横贯全屏的亮带（观感就是「歌词框」）。基准改回文字自身高度。
    const bloomBaseH = Math.min(worldH, textWorldH * 1.18);
    const sunWorldW = Math.min(worldW * 1.16, Math.max(textWorldW + bloomBaseH * 1.1, textWorldW * 1.18));
    const sunWorldH = Math.max(bloomBaseH * 1.02, Math.min(bloomBaseH * 1.54, bloomBaseH + textWorldW * 0.07));
    sunMat = new THREE.MeshBasicMaterial({
      map: getSunBloomTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      color: LYRIC_PALETTE_FALLBACK.sunWarm.clone(),
    });
    sun = new THREE.Mesh(new THREE.PlaneGeometry(sunWorldW, sunWorldH), sunMat);
    sun.renderOrder = 40;
    sun.position.set(0, 0.02, -0.03);
    sun.scale.set(0.78, 0.58, 1);
    group.add(sun);

    const glowTex = buildGlowTexture(mask);
    const glowMeta = (glowTex as THREE.CanvasTexture & { userData?: { width?: number; height?: number; textWidth?: number } }).userData || {};
    const glowWorldW =
      textWorldW * ((glowMeta.width || mask.logicalWidth) / Math.max(1, glowMeta.textWidth || measuredTextWidth(mask)));
    // 溢光图是文字自身的模糊副本，宽度必须按纹理比例铺满，压窄会让光晕和字错位
    const glowWorldWClamped = Math.min(worldW * 1.45, Math.max(textWorldW + worldH * 0.38, glowWorldW));
    const glowWorldH =
      worldH * ((glowMeta.height || mask.logicalHeight) / mask.logicalHeight);
    const glowWorldHClamped = Math.min(worldH * 1.42, Math.max(worldH * 0.92, glowWorldH));
    glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      color: LYRIC_PALETTE_FALLBACK.glow.clone(),
      alphaTest: 0.02,
    });
    glow = new THREE.Mesh(new THREE.PlaneGeometry(glowWorldWClamped, glowWorldHClamped, 1, 1), glowMat);
    glow.renderOrder = 41;
    glow.scale.set(1, 1.06, 1);
    group.add(glow);

    const readabilityTex = buildReadabilityTexture(mask.rows, fontSize, W, H);
    readabilityMat = new THREE.MeshBasicMaterial({
      map: readabilityTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const readability = new THREE.Mesh(geo.clone(), readabilityMat);
    readability.renderOrder = 42;
    readability.position.set(0, 0, -0.012);
    group.add(readability);
  }

  const textMat = createStageLyricShaderMaterial(mask);
  const textMesh = new THREE.Mesh(geo, textMat);
  textMesh.renderOrder = 43;
  group.add(textMesh);

  if (decorations) {
    const sparkCount = 132;
    const pgeo = new THREE.BufferGeometry();
    const ppos = new Float32Array(sparkCount * 3);
    const pseed = new Float32Array(sparkCount);
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const ring = 0.78 + Math.pow(Math.random(), 1.45) * 0.58;
      const rx = textWorldW * (0.5 + Math.random() * 0.22) + 0.1;
      const ry = worldH * (0.42 + Math.random() * 0.22) + 0.08;
      ppos[i * 3] = Math.cos(angle) * rx * ring + (Math.random() - 0.5) * textWorldW * 0.12;
      ppos[i * 3 + 1] = Math.sin(angle) * ry * ring + (Math.random() - 0.5) * worldH * 0.14;
      ppos[i * 3 + 2] = (Math.random() - 0.5) * 0.24;
      pseed[i] = Math.random() * 1000;
    }
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    pgeo.setAttribute('seed', new THREE.BufferAttribute(pseed, 1));
    basePositions = ppos.slice();
    sparkMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: sharedDotTexture },
        uSize: { value: 0.052 },
        uOpacity: { value: 0 },
        uColor: { value: LYRIC_PALETTE_FALLBACK.highlight.clone() },
        uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
      },
      vertexShader: `
        attribute float seed;
        uniform float uSize;
        uniform float uPixel;
        varying float vSeed;
        void main(){
          vSeed = seed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float jitter = 0.58 + fract(sin(seed * 19.17) * 43758.5453) * 1.18;
          float depth = clamp(2.2 / max(0.35, -mv.z), 0.54, 1.55);
          gl_PointSize = uSize * jitter * depth * uPixel * 120.0;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vSeed;
        void main(){
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float twinkle = 0.72 + fract(sin(vSeed * 7.31) * 91.7) * 0.28;
          gl_FragColor = vec4(uColor * twinkle, tex.a * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    sparks = new THREE.Points(pgeo, sparkMat);
    sparks.renderOrder = 44;
    sparks.visible = false;
    group.add(sparks);
  }

  // 把当前行钉到 group 原点：多行时窗口滑动只让上下文行动，当前行不跳
  const anchorY = (mask.activeCenterOffset / H) * worldH;
  if (Math.abs(anchorY) > 0.0005) {
    const content = new THREE.Group();
    content.position.y = anchorY;
    for (const child of [...group.children]) content.add(child);
    group.add(content);
  }
  group.userData.rowStepWorld = (mask.activeRowStep / H) * worldH;

  group.userData.lyric = {
    textMat,
    readabilityMat,
    glowMat,
    sparkMat,
    sunMat,
    sun,
    glow,
    sparks,
    basePositions,
    textWorldW,
    textWorldH,
    worldW,
    worldH,
  };

  applyLyricPaletteToMesh(group);
  return group;
}

/**
 * 画布烤好只是 CPU 侧；纹理真正上传 GPU 发生在第一次渲染，
 * 十几 MB 的 texImage2D 就是切句那一下的掉帧源头。空闲时先传上去。
 */
export function primeLyricMeshTextures(
  renderer: { initTexture?: (texture: THREE.Texture) => void } | null | undefined,
  group: THREE.Object3D | null | undefined,
): void {
  if (!renderer?.initTexture || !group) return;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if ('map' in mat && mat.map) renderer.initTexture!(mat.map as THREE.Texture);
      if ('uniforms' in mat && mat.uniforms) {
        const tex = (mat.uniforms as { uMap?: { value?: THREE.Texture } }).uMap?.value;
        if (tex) renderer.initTexture!(tex);
      }
    }
  });
}

export function disposeLyricMesh(group: THREE.Group | null): void {
  if (!group) return;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if ('map' in m && m.map && m.map !== sunBloomTexture && m.map !== sharedDotTexture) {
          (m.map as THREE.Texture).dispose();
        }
        if ('uniforms' in m && m.uniforms) {
          const uniforms = m.uniforms as { uMap?: { value?: THREE.Texture } };
          const tex = uniforms.uMap?.value;
          if (tex && tex !== sharedDotTexture && tex !== sunBloomTexture) tex.dispose();
        }
        m.dispose();
      });
    }
    mesh.geometry?.dispose();
  });
}

export function disposeStageLyricRoot(root: THREE.Group | null): void {
  if (!root) return;
  disposeLyricMesh(root);
}
