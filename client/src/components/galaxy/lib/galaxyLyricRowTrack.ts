import * as THREE from 'three';

import type { RoomVisualFxSettings } from '../../../lib/roomVisualPreset';
import {
  LYRIC_ROW_FIT_BUDGET_W,
  applyLyricPaletteToMesh,
  buildLyricMaskAsset,
  buildLyricMesh,
  disposeLyricMesh,
  primeLyricMeshTextures,
  wrapLyricTrackText,
  type LyricMeshGroup,
} from './galaxyStageLyricMaterial';

/**
 * Mineradio 12-lyrics-row-layers：每行一个常驻 mesh，滚动只改相位。
 * 这里的上下文行永远不发光，因此只烤文字层；当前行仍由 GalaxyStageLyrics
 * 的 hero mesh 负责（它要溢光/描边/日冕），但也只有一行，代价是旧整块方案的 1/8。
 */

export interface LyricTrackLine {
  text: string;
  translation?: string | null;
}

const BASE_FONT = 96;
const LINE_HEIGHT = 1.04;
/** 与 galaxyStageLyricMaterial 的 worldScale:'row' 基准保持一致 */
const WORLD_PER_LOGICAL_PX = 6.1 / 1200;
/** 一个 em 的世界高度，行距全部以它为单位 */
export const LYRIC_ROW_WORLD_EM = WORLD_PER_LOGICAL_PX * BASE_FONT;
/** Mineradio normalizeStageLyricEntry：上下文行 scale 0.86 */
export const LYRIC_CONTEXT_SCALE = 0.86;
/** 当前行在舞台里的固定高度 */
export const LYRIC_TRACK_ANCHOR_Y = 0.18;
const ROW_PLANE_Z = 1.46;
/** 超出可视窗口这么多行就释放，避免长歌把纹理堆满 */
const KEEP_MARGIN = 3;

interface TrackSlot {
  key: string;
  lineIndex: number;
  isTranslation: boolean;
  text: string;
  /** 相对首行的纵向位置，单位 em（向下为负） */
  unitY: number;
  height: number;
}

interface TrackRow {
  mesh: LyricMeshGroup;
  opacity: number;
}

export interface LyricRowTrack {
  group: THREE.Group;
  slots: TrackSlot[];
  slotByLine: Map<number, TrackSlot>;
  translationByLine: Map<number, TrackSlot>;
  rows: Map<string, TrackRow>;
  scrollUnit: number;
  primed: boolean;
  layoutSignature: string;
  meshSignature: string;
  lineHeights: Map<string, number>;
  fitBudgetW: number;
}

export function createLyricRowTrack(): LyricRowTrack {
  const group = new THREE.Group();
  group.renderOrder = 41;
  return {
    group,
    slots: [],
    slotByLine: new Map(),
    translationByLine: new Map(),
    rows: new Map(),
    scrollUnit: 0,
    primed: false,
    layoutSignature: '',
    meshSignature: '',
    lineHeights: new Map(),
    fitBudgetW: LYRIC_ROW_FIT_BUDGET_W,
  };
}

function normalizedTranslation(line: LyricTrackLine | undefined): string | null {
  const raw = line?.translation?.trim();
  if (!raw) return null;
  if (raw === line?.text?.trim()) return null;
  return `（${raw.replace(/^[（(]|[）)]$/g, '').trim()}）`;
}

function translationSlotAllowed(
  mode: RoomVisualFxSettings['lyricTranslationMode'],
  lineIndex: number,
  activeIndex: number,
): boolean {
  if (mode === 'off') return false;
  if (mode === 'multi') return true;
  if (mode === 'current') return lineIndex === activeIndex;
  return lineIndex === activeIndex || lineIndex === activeIndex + 1;
}

function contextGapScale(visibleCount: number): number {
  if (visibleCount >= 8) return 0.42;
  if (visibleCount >= 6) return 0.62;
  return 1;
}

function translationRowScale(fx: RoomVisualFxSettings, active: boolean): number {
  return active
    ? Math.max(0.7, Math.min(1.12, fx.lyricTranslationScale * 1.08))
    : Math.max(0.42, Math.min(1.12, fx.lyricTranslationScale * 0.88));
}

/**
 * 重排轨道槽位。只算数字，不碰画布，所以每次窗口/翻译模式变化都可以直接重算。
 */
export function syncLyricRowTrackLayout(
  track: LyricRowTrack,
  lines: LyricTrackLine[],
  fx: RoomVisualFxSettings,
  activeIndex: number,
  visibleCount: number,
  contentSignature: string,
  fitBudgetW = LYRIC_ROW_FIT_BUDGET_W,
): void {
  const mode = fx.lyricTranslationMode;
  const translationAnchor = mode === 'multi' || mode === 'off' ? -1 : activeIndex;
  const signature = `${contentSignature}|${mode}|${fx.lyricContextSpread}|${fx.lyricTranslationGap}`
    + `|${fx.lyricTranslationScale}|${visibleCount}|${translationAnchor}|${fitBudgetW}`;
  if (track.layoutSignature === signature) return;
  track.layoutSignature = signature;
  if (track.fitBudgetW !== fitBudgetW) track.lineHeights.clear();
  track.fitBudgetW = fitBudgetW;

  const gapScale = contextGapScale(visibleCount);
  const primaryStep = LINE_HEIGHT + (0.08 + fx.lyricContextSpread * 0.08) * gapScale;
  const visualGap = Math.max(
    0.92,
    Math.min(2.2, 0.98 + (fx.lyricTranslationGap - 0.28) * 0.36 + Math.max(0, fx.lyricTranslationScale - 0.66) * 0.12),
  );
  const translationGap = Math.max(0.03, (visualGap - 0.92) * 0.22) * gapScale;

  const slots: TrackSlot[] = [];
  const slotByLine = new Map<number, TrackSlot>();
  const translationByLine = new Map<number, TrackSlot>();
  let cursor = 0;
  let prevStep = 0;
  const measureCtx = document.createElement('canvas').getContext('2d');
  const lineHeight = (text: string) => {
    const cached = track.lineHeights.get(text);
    if (cached !== undefined) return cached;
    const height = LINE_HEIGHT * (measureCtx ? wrapLyricTrackText(measureCtx, text, BASE_FONT, fitBudgetW).length : 1);
    track.lineHeights.set(text, height);
    return height;
  };

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]?.text?.trim();
    if (!text) continue;

    const height = lineHeight(text);
    const step = primaryStep + height - LINE_HEIGHT;
    if (slots.length) cursor -= (prevStep + step) / 2;
    const primary: TrackSlot = { key: `${i}:p`, lineIndex: i, isTranslation: false, text, unitY: cursor, height };
    slots.push(primary);
    slotByLine.set(i, primary);
    prevStep = step;

    const translation = translationSlotAllowed(mode, i, activeIndex) ? normalizedTranslation(lines[i]) : null;
    if (!translation) continue;
    const transHeight = lineHeight(translation) * translationRowScale(fx, i === activeIndex);
    const transStep = transHeight + translationGap;
    cursor -= (prevStep + transStep) / 2;
    const transSlot: TrackSlot = { key: `${i}:t`, lineIndex: i, isTranslation: true, text: translation, unitY: cursor, height: transHeight };
    slots.push(transSlot);
    translationByLine.set(i, transSlot);
    prevStep = transStep;
  }

  track.slots = slots;
  track.slotByLine = slotByLine;
  track.translationByLine = translationByLine;
}

function buildTrackRowMesh(text: string, renderOrderBoost: number, fitBudgetW: number): LyricMeshGroup {
  const mask = buildLyricMaskAsset(text, null, false, {
    rows: [{ text, alpha: 1, scale: 1, active: false }],
    translationMode: 'off',
    worldScale: 'row',
    fitBudgetW,
  });
  const mesh = buildLyricMesh(mask, { decorations: false });
  mesh.position.set(0, 0, ROW_PLANE_Z);
  mesh.visible = false;
  mesh.userData.lyric.textMat.uniforms.uOpacity.value = 0;
  mesh.userData.lyric.textMat.uniforms.uActiveMix.value = 0;
  if (renderOrderBoost > 0) {
    // 地形预设把歌词整体抬到覆盖层，之后新建的行也得跟上，否则会沉到地形下面
    mesh.traverse((obj) => {
      obj.frustumCulled = false;
      obj.renderOrder += renderOrderBoost;
    });
  }
  applyLyricPaletteToMesh(mesh);
  return mesh;
}

/** 换歌 / 换字体 / 换清晰度：整条轨道的纹理都作废 */
export function invalidateLyricRowTrack(track: LyricRowTrack, meshSignature: string): void {
  if (track.meshSignature === meshSignature) return;
  track.meshSignature = meshSignature;
  track.rows.forEach((row) => {
    track.group.remove(row.mesh);
    disposeLyricMesh(row.mesh);
  });
  track.rows.clear();
  track.primed = false;
  track.layoutSignature = '';
  track.lineHeights.clear();
}

export function refreshLyricRowTrackPalette(track: LyricRowTrack): void {
  track.rows.forEach((row) => applyLyricPaletteToMesh(row.mesh));
}

export interface LyricRowTrackFrame {
  fx: RoomVisualFxSettings;
  activeIndex: number;
  visibleIndexes: number[];
  /** 由 hero mesh 接管的行：轨道让位，避免同一句画两遍 */
  ownedLines: Set<number>;
  dt: number;
  time: number;
  renderer?: { initTexture?: (texture: THREE.Texture) => void } | null;
  /** 每帧最多烤一行，切歌那阵子直接停烤 */
  allowBuild: boolean;
  /** 地形预设的 renderOrder 抬升量 */
  renderOrderBoost?: number;
}

export interface LyricRowTrackMetrics {
  /** 当前行应处的锚点 Y，hero mesh 用它对齐同一条滚动相位 */
  activeAnchorY: number;
  /** 可见行里最宽的世界宽度，整叠视口适配用 */
  stackWidth: number;
  /** 可见行叠起来的世界高度 */
  stackHeight: number;
  activeHeight: number;
}

export function updateLyricRowTrack(track: LyricRowTrack, frame: LyricRowTrackFrame): LyricRowTrackMetrics {
  const { fx, activeIndex, visibleIndexes, ownedLines, dt, time, allowBuild } = frame;
  const activeSlot = track.slotByLine.get(activeIndex);
  const targetUnit = activeSlot ? activeSlot.unitY : track.scrollUnit;

  if (!track.primed || Math.abs(targetUnit - track.scrollUnit) > 6) {
    track.scrollUnit = targetUnit;
    track.primed = true;
  } else {
    // 与 tickLyricMesh 同源的 0.075/帧 指数缓动，保证 hero 与上下文行同步
    track.scrollUnit += (targetUnit - track.scrollUnit) * (1 - Math.pow(1 - 0.075, Math.min(3, dt * 60)));
  }

  const visible = new Set(visibleIndexes);
  const maxDistance = Math.max(1, ...visibleIndexes.map((index) => Math.abs(index - activeIndex)));
  const contextOpacity = Math.max(0.25, Math.min(1, fx.lyricContextOpacity));
  const translationContextAlpha = Math.max(0, Math.min(0.72, fx.lyricContextOpacity * 0.58));
  const activeTranslationAlpha = Math.max(0.48, Math.min(1, fx.lyricTranslationOpacity + 0.08));
  const fade = 1 - Math.exp(-9 * dt);
  const rowWobbleAmp = fx.lyricVerticalFloat
    ? fx.lyricMotionStyle === 'float'
      ? 0.012
      : 0.004
    : 0;
  const keepMin = (visibleIndexes[0] ?? activeIndex) - KEEP_MARGIN;
  const keepMax = (visibleIndexes[visibleIndexes.length - 1] ?? activeIndex) + KEEP_MARGIN;

  let buildBudget = allowBuild ? 1 : 0;
  let stackWidth = 0;
  let stackTop = Number.NEGATIVE_INFINITY;
  let stackBottom = Number.POSITIVE_INFINITY;

  for (const slot of track.slots) {
    if (slot.lineIndex < keepMin || slot.lineIndex > keepMax) continue;
    const shown = visible.has(slot.lineIndex)
      && (slot.isTranslation || !ownedLines.has(slot.lineIndex));
    if (visible.has(slot.lineIndex)) {
      stackTop = Math.max(stackTop, slot.unitY + slot.height / 2);
      stackBottom = Math.min(stackBottom, slot.unitY - slot.height / 2);
    }
    let row = track.rows.get(slot.key);

    if (!row) {
      if (!shown || buildBudget <= 0) continue;
      buildBudget -= 1;
      const mesh = buildTrackRowMesh(slot.text, frame.renderOrderBoost ?? 0, track.fitBudgetW);
      primeLyricMeshTextures(frame.renderer, mesh);
      track.group.add(mesh);
      row = { mesh, opacity: 0 };
      track.rows.set(slot.key, row);
    }

    const isActiveLine = slot.lineIndex === activeIndex;
    const distance = Math.abs(slot.lineIndex - activeIndex);
    const edgeAlpha = 1 - fx.lyricEdgeFade * (distance / maxDistance) * 0.28;
    let target = 0;
    if (shown) {
      if (slot.isTranslation) {
        target = isActiveLine ? activeTranslationAlpha : translationContextAlpha * edgeAlpha;
      } else {
        target = contextOpacity * edgeAlpha;
      }
    }

    row.opacity += (target - row.opacity) * fade;
    if (row.opacity < 0.0025 && target <= 0) row.opacity = 0;

    const mesh = row.mesh;
    const rowScale = slot.isTranslation ? translationRowScale(fx, isActiveLine) : LYRIC_CONTEXT_SCALE;
    if (shown) {
      stackWidth = Math.max(stackWidth, (mesh.userData.lyric.textWorldW || 0) * rowScale);
    }
    mesh.visible = row.opacity > 0.004;
    if (!mesh.visible) continue;

    const uniforms = mesh.userData.lyric.textMat.uniforms;
    uniforms.uOpacity.value = row.opacity;
    uniforms.uTime.value = time;
    // Mineradio 的行级微呼吸：整叠的浮动在 stageRoot 上，这里只给每行错开一点相位
    const rowBreathe = rowWobbleAmp
      ? 1 + Math.sin(time * 0.68 + slot.unitY * 0.71) * rowWobbleAmp
      : 1;
    mesh.scale.setScalar(rowScale * rowBreathe);
    mesh.position.y = LYRIC_TRACK_ANCHOR_Y + (slot.unitY - track.scrollUnit) * LYRIC_ROW_WORLD_EM;
  }

  track.rows.forEach((row, key) => {
    const lineIndex = Number(key.split(':')[0]);
    if (lineIndex >= keepMin && lineIndex <= keepMax) return;
    track.group.remove(row.mesh);
    disposeLyricMesh(row.mesh);
    track.rows.delete(key);
  });

  const spanEm = stackTop > stackBottom ? stackTop - stackBottom : 0;
  const translationSlot = track.translationByLine.get(activeIndex);
  const activeHalfHeight = (activeSlot?.height ?? LINE_HEIGHT) / 2;
  const activeBottom = translationSlot
    ? (activeSlot?.unitY ?? 0) - translationSlot.unitY + translationSlot.height / 2
    : activeHalfHeight;
  return {
    activeAnchorY:
      LYRIC_TRACK_ANCHOR_Y + ((activeSlot?.unitY ?? track.scrollUnit) - track.scrollUnit) * LYRIC_ROW_WORLD_EM,
    stackWidth,
    stackHeight: Math.max(spanEm, LINE_HEIGHT) * LYRIC_ROW_WORLD_EM,
    activeHeight: 2 * Math.max(activeHalfHeight, activeBottom) * LYRIC_ROW_WORLD_EM,
  };
}

/** hero mesh 需要知道任意一行的锚点（退场行也要跟着滚） */
export function lyricRowTrackAnchorY(track: LyricRowTrack, lineIndex: number): number | null {
  const slot = track.slotByLine.get(lineIndex);
  if (!slot) return null;
  return LYRIC_TRACK_ANCHOR_Y + (slot.unitY - track.scrollUnit) * LYRIC_ROW_WORLD_EM;
}

export function disposeLyricRowTrack(track: LyricRowTrack): void {
  track.rows.forEach((row) => {
    track.group.remove(row.mesh);
    disposeLyricMesh(row.mesh);
  });
  track.rows.clear();
  track.slots = [];
  track.slotByLine.clear();
  track.translationByLine.clear();
  track.lineHeights.clear();
}
