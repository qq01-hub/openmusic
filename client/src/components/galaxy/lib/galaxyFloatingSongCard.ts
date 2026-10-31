import * as THREE from 'three';
import { toProxiedMediaUrl } from '../../../lib/mediaProxyUrl';
import { needsApiSign } from '../../../lib/apiSign';
import { signApiUrl } from '../../../lib/signedApiUrl';

export type FloatingSongCardActionId = 'favorite' | 'like' | 'dislike' | 'jump' | 'remove' | 'ban';

export interface FloatingSongCardAction {
  id: FloatingSongCardActionId;
  label: string;
  active?: boolean;
  tone?: 'rose' | 'amber' | 'sky' | 'red' | 'neutral';
  badge?: string;
}

export interface FloatingSongCardItem {
  title: string;
  sub: string;
  coverUrl: string | null;
  tag: string;
  progress: number;
  bass: number;
  meta?: string;
  isCurrent?: boolean;
  /** 歌单架当前居中选中 */
  isShelfCenter?: boolean;
  actions: FloatingSongCardAction[];
}

export interface FloatingSongCardActionRegion {
  id: FloatingSongCardActionId;
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_FLOATING_COVER_CACHE = 48;
const coverCache = new Map<string, HTMLImageElement | 'loading' | 'failed'>();

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return { r: 0, g: 245, b: 212 };
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

function accentRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fillTone(ctx: CanvasRenderingContext2D, action: FloatingSongCardAction, accentHex: string, hovered: boolean): void {
  if (action.active) {
    if (action.tone === 'rose') {
      ctx.fillStyle = hovered ? 'rgba(251,113,133,0.28)' : 'rgba(251,113,133,0.2)';
      return;
    }
    if (action.tone === 'amber') {
      ctx.fillStyle = hovered ? 'rgba(251,191,36,0.28)' : 'rgba(251,191,36,0.18)';
      return;
    }
    if (action.tone === 'sky') {
      ctx.fillStyle = hovered ? 'rgba(56,189,248,0.28)' : 'rgba(56,189,248,0.18)';
      return;
    }
    if (action.tone === 'red') {
      ctx.fillStyle = hovered ? 'rgba(239,68,68,0.36)' : 'rgba(239,68,68,0.26)';
      return;
    }
  }
  if (action.tone === 'red') {
    ctx.fillStyle = hovered ? 'rgba(239,68,68,0.24)' : 'rgba(239,68,68,0.14)';
    return;
  }
  ctx.fillStyle = hovered ? accentRgba(accentHex, 0.22) : 'rgba(255,255,255,0.08)';
}

function strokeTone(ctx: CanvasRenderingContext2D, action: FloatingSongCardAction, accentHex: string, hovered: boolean): void {
  if (action.active) {
    if (action.tone === 'rose') {
      ctx.strokeStyle = hovered ? 'rgba(251,113,133,0.72)' : 'rgba(251,113,133,0.52)';
      return;
    }
    if (action.tone === 'amber') {
      ctx.strokeStyle = hovered ? 'rgba(251,191,36,0.72)' : 'rgba(251,191,36,0.52)';
      return;
    }
    if (action.tone === 'sky') {
      ctx.strokeStyle = hovered ? 'rgba(56,189,248,0.72)' : 'rgba(56,189,248,0.52)';
      return;
    }
    if (action.tone === 'red') {
      ctx.strokeStyle = hovered ? 'rgba(248,113,113,0.88)' : 'rgba(248,113,113,0.66)';
      return;
    }
  }
  if (action.tone === 'red') {
    ctx.strokeStyle = hovered ? 'rgba(248,113,113,0.7)' : 'rgba(248,113,113,0.45)';
    return;
  }
  ctx.strokeStyle = hovered ? accentRgba(accentHex, 0.62) : 'rgba(255,255,255,0.16)';
}

function textTone(action: FloatingSongCardAction): string {
  if (action.active && action.tone === 'rose') return 'rgba(253,164,175,0.96)';
  if (action.active && action.tone === 'amber') return 'rgba(253,230,138,0.96)';
  if (action.active && action.tone === 'sky') return 'rgba(186,230,253,0.96)';
  if (action.active && action.tone === 'red') return 'rgba(254,226,226,0.98)';
  if (action.tone === 'red') return 'rgba(254,202,202,0.94)';
  return 'rgba(255,255,255,0.86)';
}

function makeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const chars = String(text || '').split('');
  let line = '';
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = chars[i];
      if (lines.length >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  for (let j = 0; j < lines.length; j++) ctx.fillText(lines[j], x, y + j * lineHeight);
}

function requestCover(url: string, onReady: () => void): void {
  const cached = coverCache.get(url);
  if (cached instanceof HTMLImageElement) {
    onReady();
    return;
  }
  if (cached === 'loading' || cached === 'failed') return;
  coverCache.set(url, 'loading');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    coverCache.delete(url);
    coverCache.set(url, img);
    while (coverCache.size > MAX_FLOATING_COVER_CACHE) {
      const oldest = coverCache.keys().next().value;
      if (!oldest) break;
      coverCache.delete(oldest);
    }
    onReady();
  };
  img.onerror = () => {
    coverCache.set(url, 'failed');
  };
  void (async () => {
    let loadUrl = toProxiedMediaUrl(url);
    if (needsApiSign(loadUrl)) {
      loadUrl = await signApiUrl(loadUrl);
    }
    img.src = loadUrl;
  })();
}

function paintShelfCardChrome(
  ctx: CanvasRenderingContext2D,
  layout: {
    pad: number;
    cardW: number;
    cardH: number;
    coverCx: number;
    coverCy: number;
    coverSize: number;
    textPanelX: number;
    canvasW: number;
  },
  cardBgOpacity: number,
): void {
  const { pad, cardW, cardH, coverCx, coverCy, coverSize, textPanelX, canvasW } = layout;
  makeRoundRect(ctx, pad, pad, cardW, cardH, 32);
  ctx.fillStyle = `rgba(0,0,0,${cardBgOpacity.toFixed(3)})`;
  ctx.fill();

  ctx.save();
  makeRoundRect(ctx, pad, pad, cardW, cardH, 32);
  ctx.clip();
  const grad = ctx.createLinearGradient(textPanelX, pad, canvasW, pad + cardH);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(255,255,255,0.018)');
  ctx.fillStyle = grad;
  ctx.fillRect(textPanelX, pad, canvasW - textPanelX - pad, cardH);
  ctx.restore();

  // 封面区只保留纯黑底，避免白色渐变 / 景深洗白专辑图
  ctx.save();
  makeRoundRect(ctx, coverCx, coverCy, coverSize, coverSize, 26);
  ctx.clip();
  ctx.fillStyle = `rgba(0,0,0,${cardBgOpacity.toFixed(3)})`;
  ctx.fillRect(coverCx, coverCy, coverSize, coverSize);
  ctx.restore();
}

function paintShelfCover(
  ctx: CanvasRenderingContext2D,
  item: FloatingSongCardItem,
  coverCx: number,
  coverCy: number,
  coverSize: number,
  onCoverRequest: () => void,
): void {
  const rec = item.coverUrl ? coverCache.get(item.coverUrl) : null;
  if (rec instanceof HTMLImageElement) {
    ctx.save();
    makeRoundRect(ctx, coverCx, coverCy, coverSize, coverSize, 26);
    ctx.clip();
    ctx.drawImage(rec, coverCx, coverCy, coverSize, coverSize);
    ctx.restore();
    return;
  }

  makeRoundRect(ctx, coverCx, coverCy, coverSize, coverSize, 26);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fill();
  if (item.coverUrl && rec !== 'failed') {
    requestCover(item.coverUrl, onCoverRequest);
  }
}

/** Mineradio shelfManager drawCard — 当前播放队列卡 */
export function drawFloatingSongCard(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  item: FloatingSongCardItem,
  accentHex: string,
  time: number,
  bgOpacity: number,
  hoveredActionId: FloatingSongCardActionId | null,
  onCoverRequest: () => void,
  dofBlur = 0,
): FloatingSongCardActionRegion[] {
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const pad = 18;
  const isNow = item.tag === '正在播放';
  const highlighted = Boolean(item.isShelfCenter || isNow);
  const cardBgOpacity = Math.min(0.98, Math.max(0.25, bgOpacity));
  const regions: FloatingSongCardActionRegion[] = [];

  const coverSize = H - pad * 2 - 8;
  const coverCx = pad + 6;
  const coverCy = pad + 4;
  const tx = pad + coverSize + 22;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;
  const textPanelX = tx - 10;
  const chromeLayout = {
    pad,
    cardW,
    cardH,
    coverCx,
    coverCy,
    coverSize,
    textPanelX,
    canvasW: W,
  };

  paintShelfCardChrome(ctx, chromeLayout, cardBgOpacity);

  if (highlighted) {
    ctx.strokeStyle = accentRgba(accentHex, isNow ? 0.72 : 0.68);
    ctx.lineWidth = isNow ? 1.8 + Math.sin(time * 3) * 0.28 + item.bass * 1.2 : 1.65;
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.1;
  }
  makeRoundRect(ctx, pad, pad, cardW, cardH, 32);
  ctx.stroke();

  paintShelfCover(ctx, item, coverCx, coverCy, coverSize, onCoverRequest);

  const rightPad = 24;
  const textMaxWidth = W - tx - pad - rightPad;
  ctx.font = '700 16px Inter, "Noto Sans SC", Arial';
  ctx.fillStyle = isNow ? accentRgba(accentHex, 0.92) : 'rgba(255,255,255,0.92)';
  ctx.fillText(item.tag || '', tx, pad + 34);

  ctx.font = '700 27px Inter, "Noto Sans SC", Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  wrapText(ctx, item.title || '', tx, pad + 70, textMaxWidth, 31, 2);

  ctx.font = '400 16px Inter, "Noto Sans SC", Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.52)';
  wrapText(ctx, item.sub || '', tx, pad + 138, textMaxWidth, 22, 2);

  if (item.meta) {
    ctx.font = '500 13px Inter, "Noto Sans SC", Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    wrapText(ctx, item.meta, tx, pad + 188, textMaxWidth, 18, 1);
  }

  const progressLen = Math.min(textMaxWidth - 2, 104 + item.progress * 160 + item.bass * 30);
  ctx.strokeStyle = isNow ? accentRgba(accentHex, 0.9) : 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(tx, H - pad - 22);
  ctx.lineTo(tx + progressLen, H - pad - 22);
  ctx.stroke();

  const actions = item.actions || [];
  if (actions.length > 0) {
    const actionY = H - pad - 68;
    const actionH = 34;
    const gap = 10;
    let cursorX = tx;
    ctx.font = '600 13px Inter, "Noto Sans SC", Arial';
    for (const action of actions) {
      const badge = action.badge ? ` ${action.badge}` : '';
      const label = `${action.label}${badge}`;
      const w = Math.max(58, Math.min(114, ctx.measureText(label).width + 24));
      const hovered = hoveredActionId === action.id;
      makeRoundRect(ctx, cursorX, actionY, w, actionH, 16);
      fillTone(ctx, action, accentHex, hovered);
      ctx.fill();
      strokeTone(ctx, action, accentHex, hovered);
      ctx.lineWidth = hovered ? 1.8 : 1.2;
      ctx.stroke();
      ctx.fillStyle = textTone(action);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cursorX + w / 2, actionY + actionH / 2 + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      regions.push({ id: action.id, x: cursorX, y: actionY, w, h: actionH });
      cursorX += w + gap;
      if (cursorX > W - pad - 52) break;
    }
  }

  if (dofBlur > 0.12) {
    ctx.save();
    makeRoundRect(ctx, pad, pad, cardW, cardH, 32);
    ctx.clip();
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.28, dofBlur * 0.18).toFixed(3)})`;
    ctx.fillRect(textPanelX, pad, W - textPanelX - pad, cardH);
    ctx.restore();
  }

  return regions;
}

export function createFloatingSongCardMesh(): {
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.96,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
    // 地形预设的场景雾只该罩地形，歌单架和歌词一样属于前景层
    fog: false,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(2.05, 1.025, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 55;
  return { mesh, texture, canvas, ctx };
}

export function disposeFloatingSongCardMesh(mesh: THREE.Mesh): void {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (mat.map) mat.map.dispose();
  mat.dispose();
  mesh.geometry.dispose();
}

export function getFloatingSongCardSideLayout(): {
  sideX: number;
  sideY: number;
  sideZ: number;
  sideYStep: number;
  sideZStep: number;
} {
  const narrow = typeof window !== 'undefined' && window.innerWidth < 980;
  const portrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
  return {
    sideX: portrait ? 1.56 : narrow ? 2.48 : 3.18,
    sideY: 0,
    sideZ: portrait ? 0.78 : 0.86,
    sideYStep: portrait ? 0.58 : 0.74,
    sideZStep: portrait ? 0.15 : 0.19,
  };
}

/** 歌单架 side 模式交互锚点（居中卡片），用于屏幕命中区域推算 */
export function getShelfSideAnchor(
  offsetX = 0,
  offsetY = 0,
  offsetZ = 0,
): THREE.Vector3 {
  const layout = getFloatingSongCardSideLayout();
  return new THREE.Vector3(
    layout.sideX + offsetX,
    layout.sideY + offsetY,
    layout.sideZ + offsetZ,
  );
}

export function projectWorldToNdc(
  world: THREE.Vector3,
  camera: THREE.Camera,
): THREE.Vector3 {
  return world.clone().project(camera);
}

/** Mineradio shelf side 布局 — 桌面 emily 预设 */
export function applyFloatingSongCardPose(
  mesh: THREE.Mesh,
  time: number,
  hover = 0,
  config?: {
    mode?: 'side' | 'stage';
    cardIndex?: number;
    centerSmooth?: number;
    active?: number;
    pulse?: number;
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    offsetZ?: number;
    angleY?: number;
    breathWeight?: number;
    reveal?: number;
    entry?: number;
    pointerX?: number;
    pointerY?: number;
    parallax?: number;
    summonScale?: number;
  },
): { visible: boolean; absD: number } {
  const layout = getFloatingSongCardSideLayout();
  const narrow = typeof window !== 'undefined' && window.innerWidth < 980;
  const portrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
  const mode = config?.mode ?? 'side';
  const sideX = layout.sideX;
  const sideY = layout.sideY;
  const sideZ = layout.sideZ;
  const sideRotY = portrait ? 0.12 : 0.28;
  const sideRotX = portrait ? 0.022 : 0.042;
  const sideScale = portrait ? 0.7 : narrow ? 0.86 : 1.0;
  const cardIndex = config?.cardIndex ?? 0;
  const centerSmooth = config?.centerSmooth ?? cardIndex;
  const delta = cardIndex - centerSmooth;
  const absD = Math.abs(delta);
  const active = Math.max(0, Math.min(1, config?.active ?? 0));
  const pulse = Math.max(0, config?.pulse ?? 0);
  const scale = config?.scale ?? 1;
  const offsetX = config?.offsetX ?? 0;
  const offsetY = config?.offsetY ?? 0;
  const offsetZ = config?.offsetZ ?? 0;
  const angleY = (config?.angleY ?? -15) * (Math.PI / 180);
  const breathWeight = config?.breathWeight ?? 1;
  const reveal = Math.max(0, Math.min(1, config?.reveal ?? 1));
  const entry = Math.max(0, config?.entry ?? 0);
  const pointerX = config?.pointerX ?? 0;
  const pointerY = config?.pointerY ?? 0;
  const parallax = config?.parallax ?? 1;
  const summonScale = config?.summonScale ?? 1;

  if (absD > 5.5) {
    mesh.visible = false;
    return { visible: false, absD };
  }
  mesh.visible = true;

  const breath = Math.sin(time * 0.92 + cardIndex * 0.64) * 0.052 * breathWeight;
  const breathZ = Math.cos(time * 0.78 + cardIndex * 0.52) * 0.03 * breathWeight;

  if (mode === 'stage') {
    const stageY = portrait ? -2.46 : -2.2;
    const stageZ = portrait ? 0.84 : 1.0;
    const stageScale = portrait ? 0.72 : narrow ? 0.86 : 1.0;
    const pxStage = offsetX + delta * 1.08 + entry * delta * 0.18;
    const pyStage = stageY + offsetY - entry * 0.22 + pointerY * 0.06 * parallax;
    const pzStage = stageZ + offsetZ - Math.min(2, absD) * 0.52 - entry * 0.28 + pointerX * 0.04 * parallax;
    mesh.position.set(
      pxStage - hover * 0.06,
      pyStage + breath * 0.7,
      pzStage + hover * 0.08 + breathZ,
    );
    mesh.rotation.y = -delta * 0.22;
    mesh.rotation.x = 0.1 - absD * 0.04 - hover * 0.015;
    mesh.rotation.z = 0;
    mesh.scale.setScalar(
      (absD < 0.5 ? 1.2 : Math.max(0.45, 1 - absD * 0.22)) *
        stageScale *
        scale *
        (1 + pulse * 0.06 + hover * 0.04 + active * 0.04) *
        (1 - (1 - reveal) * 0.18 * summonScale),
    );
    return { visible: true, absD };
  }

  const sideXStep = portrait ? 0.15 : 0.18;
  const sideYStep = layout.sideYStep;
  const sideZStep = layout.sideZStep;
  let px = sideX + absD * sideXStep + entry * 0.22 + offsetX + pointerX * 0.055 * parallax;
  let py = sideY - delta * sideYStep + (1 - reveal) * (delta < 0 ? -0.18 : 0.18) + offsetY;
  let pz = sideZ - absD * sideZStep - (1 - reveal) * 0.2 + offsetZ + pointerY * 0.045 * parallax;
  py += pointerY * 0.07 * Math.max(0.2, 1 - absD * 0.14) * parallax;
  if (active > 0.001 || hover > 0.001) {
    px -= (portrait ? 0.065 : 0.145) * Math.max(active, hover);
    py += (portrait ? 0.075 : 0.105) * Math.max(active, hover);
    pz += 0.22 * Math.max(active, hover);
  }
  py += breath * Math.max(0.2, 1 - absD * 0.16);
  pz += breathZ * Math.max(0, 1 - absD * 0.16);
  mesh.position.set(px, py, pz);
  mesh.rotation.y = sideRotY + angleY + hover * -0.08;
  mesh.rotation.x = -delta * sideRotX;
  mesh.rotation.z = 0;
  mesh.scale.setScalar(
    (absD < 0.5 ? 1.12 : Math.max(0.55, 1.04 - absD * 0.14)) *
      sideScale *
      scale *
      (1 + pulse * 0.056 + hover * 0.05 + active * 0.05) *
      (1 - (1 - reveal) * 0.2 * summonScale),
  );
  return { visible: true, absD };
}

export function hitTestFloatingSongCardAction(
  regions: FloatingSongCardActionRegion[],
  x: number,
  y: number,
): FloatingSongCardActionId | null {
  for (const region of regions) {
    if (x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h) {
      return region.id;
    }
  }
  return null;
}
