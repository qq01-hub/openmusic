import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoomVisualPresetId } from '../../lib/roomVisualPreset';
import { makeDotTexture } from './lib/dotTexture';
import { getCachedGalaxyAudioBands, resumeGalaxyAudioContext } from './lib/galaxyAudio';
import {
  buildGalaxyParticleGeometry,
  galaxyParticleGridForQuality,
  GALAXY_LAYER_COUNT_SCALE,
  PLANE_SIZE,
} from './lib/particleGeometry';
import {
  PARTICLE_BLOOM_FRAGMENT_SHADER,
  PARTICLE_BLOOM_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
} from './lib/shaders';
import { roomVisualFxLive } from '../../lib/roomVisualFxLive';
import { toProxiedMediaUrl } from '../../lib/mediaProxyUrl';
import { loadSharedCoverResource } from '../../lib/sharedCoverResource';
import { useSignedApiUrl } from '../../lib/signedApiUrl';
import { cacheCoverImage, getCachedCoverImage } from '../../lib/coverImageCache';
import { scheduleVisualApply } from '../../lib/scheduleVisualApply';
import { getCoverEdgeCanvas, setCoverEdgeCanvas } from './lib/coverEdgeCache';
import { effectiveBloomStrength, syncGalaxyFxUniforms } from './lib/syncVisualUniforms';
import { buildCoverEdgeTexture } from './lib/buildCoverEdgeTexture';
import {
  cloneCoverCanvas,
  cloneEdgeCanvas,
  coverTextureSizeForResolution,
  makeSquareCoverCanvas,
  sampleCoverAccentColor,
} from './lib/coverCanvas';
import { updateLyricPaletteFromCover } from '../../lib/stageLyricPaletteLive';
import { startCoverColorMixTween } from './lib/coverColorMix';
import { tweenCoverDepthUniforms } from './lib/coverDepthTween';
import { createGalaxyRippleSystem } from './lib/galaxyRipples';
import {
  createPresetTransitionState,
  startPresetParticleTransition,
  tickPresetParticleTransition,
} from './lib/galaxyPresetTransition';
import { PARTICLE_VERTEX_SHADER } from './lib/visualVertexShader';
import {
  galaxyPointerField,
  getParticleRootGroup,
  registerParticleRootGroup,
  syncParticleGroupRotation,
} from './lib/galaxyGestureRotation';
import { updateGalaxyParticlePointerFrame } from './lib/galaxyParticlePointer';
import {
  galaxyHandGestureLive,
  registerGalaxyGestureBurst,
  tickGalaxyHandGesture,
} from './lib/galaxyHandGesture';
import { galaxyOrbitRef } from './lib/galaxyOrbit';
import GalaxyStageLyrics from './GalaxyStageLyrics';
import GalaxyFloatingSongCard from './GalaxyFloatingSongCard';
import GalaxyBackgroundStarRiver from './GalaxyBackgroundStarRiver';

const DEFAULT_COVER = '#1c1c28';
// 基准(=high 1.0 档)粒子量;缓冲区按 ultra 最大尺寸分配,使极致档能真正增粒。
const FLOAT_COUNT_BASE = 1300;
const BACK_COVER_COUNT_BASE = 3000;
const GALAXY_LAYER_MAX_SCALE = 1.16;
const FLOAT_COUNT = Math.ceil(FLOAT_COUNT_BASE * GALAXY_LAYER_MAX_SCALE);
const BACK_COVER_COUNT = Math.ceil(BACK_COVER_COUNT_BASE * GALAXY_LAYER_MAX_SCALE);

type SharedUniforms = {
  uTime: { value: number };
  uBass: { value: number };
  uMid: { value: number };
  uTreble: { value: number };
  uBeat: { value: number };
  uEnergy: { value: number };
  uBurstAmt: { value: number };
  uPreset: { value: number };
  uIntensity: { value: number };
  uDepth: { value: number };
  uPointScale: { value: number };
  uSpeed: { value: number };
  uTwist: { value: number };
  uVinylSpin: { value: number };
  uColorBoost: { value: number };
  uScatter: { value: number };
  uCoverRes: { value: number };
  uBgFade: { value: number };
  uBloomStrength: { value: number };
  uBloomSize: { value: number };
  uHasCover: { value: number };
  uHasDepth: { value: number };
  uEdgeEnabled: { value: number };
  uAiBoost: { value: number };
  uMouseActive: { value: number };
  uMouseXY: { value: THREE.Vector2 };
  uHandXY: { value: THREE.Vector2 };
  uHandActive: { value: number };
  uGestureGrip: { value: number };
  uTintColor: { value: THREE.Color };
  uTintStrength: { value: number };
  uPixel: { value: number };
  uColorMixT: { value: number };
  uLoading: { value: number };
  uCoverTex: { value: THREE.Texture };
  uPrevCoverTex: { value: THREE.Texture };
  uEdgeTex: { value: THREE.Texture };
  uPrevEdgeTex: { value: THREE.Texture };
  uRippleTex: { value: THREE.Texture };
  uRippleCount: { value: number };
  uDotTex: { value: THREE.Texture };
  uAlpha: { value: number };
  uParticleDim: { value: number };
  uFloatAlpha: { value: number };
};

function makePlaceholderTexture(color = DEFAULT_COVER): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 4, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeEdgePlaceholderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(128,0,0,255)';
    ctx.fillRect(0, 0, 4, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function applyCoverTextureSettings(tex: THREE.Texture): void {
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
}

/** 尺寸变化时必须新建纹理，禁止改 image 后 needsUpdate（会触发 copySubTexture 溢出） */
function replacePrevCanvasTexture(
  ref: { current: THREE.Texture },
  canvas: HTMLCanvasElement,
  kind: 'cover' | 'edge',
): THREE.CanvasTexture {
  const next = new THREE.CanvasTexture(canvas);
  if (kind === 'cover') {
    applyCoverTextureSettings(next);
  } else {
    next.minFilter = THREE.LinearFilter;
    next.magFilter = THREE.LinearFilter;
  }
  next.needsUpdate = true;
  const prev = ref.current;
  ref.current = next;
  if (prev && prev !== next) prev.dispose();
  return next;
}

function createFloatLayer(uniforms: SharedUniforms) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(FLOAT_COUNT * 3);
  const phases = new Float32Array(FLOAT_COUNT * 3);
  const colors = new Float32Array(FLOAT_COUNT * 3);
  const rand = new Float32Array(FLOAT_COUNT);
  const amps = new Float32Array(FLOAT_COUNT);
  const sampleU = new Float32Array(FLOAT_COUNT);
  const sampleV = new Float32Array(FLOAT_COUNT);

  for (let i = 0; i < FLOAT_COUNT; i++) {
    const halo = i < FLOAT_COUNT * 0.76;
    let bx: number;
    let by: number;
    let bz: number;
    if (halo) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.62 + Math.pow(Math.random(), 0.72) * 2.75;
      const lane = (Math.random() - 0.5) * 0.62;
      bx = Math.cos(angle) * radius;
      by = Math.sin(angle) * radius * 0.54 + lane;
      bz = (Math.random() - 0.5) * 2.4 - 0.25;
    } else {
      bx = (Math.random() - 0.5) * 8.4;
      by = (Math.random() - 0.5) * 5.8;
      bz = (Math.random() - 0.5) * 5.6;
    }
    positions[i * 3] = bx;
    positions[i * 3 + 1] = by;
    positions[i * 3 + 2] = bz;
    phases[i * 3] = Math.random() * Math.PI * 2;
    phases[i * 3 + 1] = Math.random() * Math.PI * 2;
    phases[i * 3 + 2] = Math.random() * Math.PI * 2;
    amps[i] = 0.15 + Math.random() * 0.35;
    const white = 0.88 + Math.random() * 0.12;
    colors[i * 3] = white;
    colors[i * 3 + 1] = white;
    colors[i * 3 + 2] = white;
    rand[i] = Math.random();
    sampleU[i] = Math.random();
    sampleV[i] = Math.random();
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  geometry.setAttribute('aAmp', new THREE.BufferAttribute(amps, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uBass: uniforms.uBass,
      uPixel: uniforms.uPixel,
      uDotTex: uniforms.uDotTex,
      uFloatAlpha: uniforms.uFloatAlpha,
    },
    vertexShader: `
precision highp float;
uniform float uTime, uBass, uPixel, uFloatAlpha;
attribute vec3 aColor;
attribute vec3 aPhase;
attribute float aRand, aAmp;
varying vec3 vC;
varying float vA;
void main(){
  vec3 pos = position;
  float orbit = uTime * (0.030 + aRand * 0.034);
  float cs = cos(orbit), sn = sin(orbit);
  pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
  float breathe = 1.0 + sin(uTime * 0.34 + aPhase.x) * 0.045;
  pos.xy *= breathe;
  pos.x += sin(uTime * (0.18 + aRand * 0.05) + aPhase.x) * aAmp * 0.34;
  pos.y += cos(uTime * (0.15 + aRand * 0.06) + aPhase.y) * aAmp * 0.30;
  pos.z += sin(uTime * (0.11 + aRand * 0.04) + aPhase.z) * aAmp * 0.68 + uBass * 0.10 * sin(aRand * 12.0);
  vC = aColor;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float dist = -mvPos.z;
  float twinkle = 0.62 + 0.38 * sin(uTime * (0.42 + aRand * 0.34) + aPhase.z);
  vA = clamp(0.22 + (5.0 - dist) * 0.10, 0.055, 0.58) * twinkle;
  float sz = clamp(40.0 / max(0.5, dist), 1.3, 4.1);
  gl_PointSize = sz * uPixel;
  gl_Position = projectionMatrix * mvPos;
}`,
    fragmentShader: `
precision highp float;
uniform sampler2D uDotTex;
uniform float uFloatAlpha;
varying vec3 vC;
varying float vA;
void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  gl_FragColor = vec4(vC, tex.a * vA * uFloatAlpha);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;

  const refreshColorsFromCover = (coverCanvas: HTMLCanvasElement) => {
    const ctx = coverCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
    const w = coverCanvas.width;
    const h = coverCanvas.height;
    for (let i = 0; i < FLOAT_COUNT; i++) {
      const sx = Math.min(w - 1, Math.max(0, Math.floor(sampleU[i] * w)));
      const sy = Math.min(h - 1, Math.max(0, Math.floor(sampleV[i] * h)));
      const di = (sy * w + sx) * 4;
      colors[i * 3] = (img[di] / 255) * 0.95;
      colors[i * 3 + 1] = (img[di + 1] / 255) * 0.95;
      colors[i * 3 + 2] = (img[di + 2] / 255) * 0.95;
    }
    geometry.attributes.aColor.needsUpdate = true;
  };

  return {
    points,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
    refreshColorsFromCover,
  };
}

function createBackCoverLayer(uniforms: SharedUniforms) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(BACK_COVER_COUNT * 3);
  const colors = new Float32Array(BACK_COVER_COUNT * 3);
  const rand = new Float32Array(BACK_COVER_COUNT);
  const uvs = new Float32Array(BACK_COVER_COUNT * 2);

  for (let i = 0; i < BACK_COVER_COUNT; i++) {
    const u = Math.random();
    const v = Math.random();
    positions[i * 3] = (u - 0.5) * PLANE_SIZE;
    positions[i * 3 + 1] = (v - 0.5) * PLANE_SIZE;
    positions[i * 3 + 2] = -1.5 - Math.random() * 0.4;
    uvs[i * 2] = 1 - u;
    uvs[i * 2 + 1] = v;
    rand[i] = Math.random();
    colors[i * 3] = 0.7;
    colors[i * 3 + 1] = 0.6;
    colors[i * 3 + 2] = 0.8;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uBass: uniforms.uBass,
      uPixel: uniforms.uPixel,
      uDotTex: uniforms.uDotTex,
      uAlpha: uniforms.uAlpha,
    },
    vertexShader: `
precision highp float;
uniform float uTime, uBass, uPixel, uAlpha;
attribute vec3 aColor;
attribute vec2 aUv;
attribute float aRand;
varying vec3 vC;
varying float vA;
void main(){
  vec3 pos = position;
  pos.x += sin(uTime * 0.20 + aRand * 8.0) * 0.20;
  pos.y += cos(uTime * 0.18 + aRand * 6.0) * 0.22;
  pos.z += sin(uTime * 0.12 + aRand * 5.0) * 0.18 + uBass * 0.12 * sin(aRand * 11.0);
  vC = aColor;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float dist = -mvPos.z;
  vA = clamp(0.30 + 0.4 * sin(uTime * 0.6 + aRand * 5.0), 0.10, 0.65);
  float sz = clamp(46.0 / max(0.5, dist), 1.4, 4.5);
  gl_PointSize = sz * uPixel;
  gl_Position = projectionMatrix * mvPos;
}`,
    fragmentShader: `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha;
varying vec3 vC;
varying float vA;
void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  gl_FragColor = vec4(vC, tex.a * vA * uAlpha);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 0;

  const refreshColorsFromCover = (coverCanvas: HTMLCanvasElement) => {
    const ctx = coverCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
    const w = coverCanvas.width;
    const h = coverCanvas.height;
    for (let i = 0; i < BACK_COVER_COUNT; i++) {
      const u = uvs[i * 2];
      const v = uvs[i * 2 + 1];
      const sx = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const sy = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
      const di = (sy * w + sx) * 4;
      colors[i * 3] = (img[di] / 255) * 0.85;
      colors[i * 3 + 1] = (img[di + 1] / 255) * 0.85;
      colors[i * 3 + 2] = (img[di + 2] / 255) * 0.85;
    }
    geometry.attributes.aColor.needsUpdate = true;
  };

  return {
    points,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
    refreshColorsFromCover,
  };
}

interface Props {
  coverUrl?: string | null;
  preset: RoomVisualPresetId;
  isPlaying: boolean;
  /** 地形场景里歌词要按地形的锚点排版 */
  spatialAnchor?: 'galaxy' | 'topography';
}

export default function GalaxyParticles({
  coverUrl,
  preset,
  isPlaying,
  spatialAnchor = 'galaxy',
}: Props) {
  const proxiedCover = useMemo(
    () => (coverUrl ? toProxiedMediaUrl(coverUrl) : null),
    [coverUrl],
  );
  const signedCover = useSignedApiUrl(proxiedCover);
  const invalidate = useThree((state) => state.invalidate);
  const [particleGrid, setParticleGrid] = useState(() =>
    galaxyParticleGridForQuality(
      roomVisualFxLive.current.coverResolution,
      roomVisualFxLive.current.performanceQuality,
    ),
  );
  const geometry = useMemo(() => buildGalaxyParticleGeometry(particleGrid), [particleGrid]);
  const bloomGeometry = useMemo(() => geometry.clone(), [geometry]);
  const dotTex = useMemo(() => makeDotTexture(), []);
  const rippleSystem = useMemo(() => createGalaxyRippleSystem(), []);
  const edgeTexRef = useRef<THREE.Texture>(makeEdgePlaceholderTexture());
  const coverTex = useRef<THREE.Texture>(makePlaceholderTexture());
  const prevCoverTex = useRef<THREE.Texture>(makePlaceholderTexture());
  const prevEdgeTex = useRef<THREE.Texture>(makeEdgePlaceholderTexture());
  const presetRef = useRef(preset);
  const bloomRef = useRef<THREE.Points>(null);
  const floatRef = useRef<THREE.Points | null>(null);
  const backCoverRef = useRef<THREE.Points | null>(null);
  const depthTweenCancelRef = useRef<(() => void) | null>(null);
  const colorMixCancelRef = useRef<(() => void) | null>(null);
  const heavyCoverCancelRef = useRef<(() => void) | null>(null);
  const coverTokenRef = useRef(0);
  const coverImageCacheRef = useRef<HTMLImageElement | null>(null);
  const gridRef = useRef(particleGrid);
  const layerQualityRef = useRef<string>('');
  const vinylSpinRef = useRef(0);
  const presetTransitionRef = useRef(createPresetTransitionState());

  const uniforms = useRef<SharedUniforms>({
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uBeat: { value: 0 },
    uEnergy: { value: 0 },
    uBurstAmt: { value: 0 },
    uPreset: { value: preset },
    uIntensity: { value: roomVisualFxLive.current.intensity },
    uDepth: { value: roomVisualFxLive.current.depth },
    uPointScale: { value: roomVisualFxLive.current.point },
    uSpeed: { value: roomVisualFxLive.current.speed },
    uTwist: { value: roomVisualFxLive.current.twist },
    uVinylSpin: { value: 0 },
    uColorBoost: { value: roomVisualFxLive.current.colorBoost },
    uScatter: { value: roomVisualFxLive.current.scatter },
    uCoverRes: { value: roomVisualFxLive.current.coverResolution },
    uBgFade: { value: roomVisualFxLive.current.bgFade },
    uBloomStrength: { value: effectiveBloomStrength(roomVisualFxLive.current) },
    uBloomSize: { value: 2.65 },
    uHasCover: { value: 0 },
    uHasDepth: { value: 0 },
    uEdgeEnabled: { value: roomVisualFxLive.current.edge ? 1 : 0 },
    uAiBoost: { value: 0 },
    uMouseActive: { value: 0 },
    uMouseXY: { value: new THREE.Vector2(-999, -999) },
    uHandXY: { value: new THREE.Vector2(-999, -999) },
    uHandActive: { value: 0 },
    uGestureGrip: { value: 0 },
    uTintColor: { value: new THREE.Color(roomVisualFxLive.current.visualTintColor) },
    uTintStrength: { value: roomVisualFxLive.current.visualTintMode === 'custom' ? 0.42 : 0 },
    uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
    uColorMixT: { value: 1 },
    uLoading: { value: 0 },
    uCoverTex: { value: coverTex.current },
    uPrevCoverTex: { value: prevCoverTex.current },
    uEdgeTex: { value: edgeTexRef.current },
    uPrevEdgeTex: { value: prevEdgeTex.current },
    uRippleTex: { value: rippleSystem.texture },
    uRippleCount: { value: 0 },
    uDotTex: { value: dotTex },
    uAlpha: { value: 0 },
    uParticleDim: { value: 1 },
    uFloatAlpha: { value: 0 },
  }).current;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms],
  );

  const bloomMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_BLOOM_VERTEX_SHADER,
        fragmentShader: PARTICLE_BLOOM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  const floatLayer = useMemo(() => createFloatLayer(uniforms), [uniforms]);
  const backCoverLayer = useMemo(() => createBackCoverLayer(uniforms), [uniforms]);

  useEffect(() => {
    floatRef.current = floatLayer.points;
    backCoverRef.current = backCoverLayer.points;
    return () => {
      floatRef.current = null;
      backCoverRef.current = null;
    };
  }, [backCoverLayer.points, floatLayer.points]);

  useEffect(() => {
    registerGalaxyGestureBurst((amount) => {
      uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value as number, amount);
    });
    return () => registerGalaxyGestureBurst(null);
  }, [uniforms]);

  useEffect(() => {
    if (presetRef.current !== preset) {
      const fromPreset = presetRef.current;
      presetRef.current = preset;
      startPresetParticleTransition(
        presetTransitionRef.current,
        fromPreset,
        preset,
        uniforms.uTime.value,
        uniforms,
        roomVisualFxLive.current,
      );
      if (preset === 0) {
        rippleSystem.burst(3);
      } else {
        rippleSystem.reset();
      }
    }
    uniforms.uPreset.value = preset;
  }, [preset, rippleSystem, uniforms]);

  useEffect(() => {
    const swapEdgeTexture = (canvas: HTMLCanvasElement | null) => {
      const prevEdge = edgeTexRef.current;
      const nextEdge = canvas ? new THREE.CanvasTexture(canvas) : makeEdgePlaceholderTexture();
      nextEdge.minFilter = THREE.LinearFilter;
      nextEdge.magFilter = THREE.LinearFilter;
      nextEdge.needsUpdate = true;
      edgeTexRef.current = nextEdge;
      uniforms.uEdgeTex.value = nextEdge;
      if (prevEdge && prevEdge !== nextEdge && prevEdge !== prevEdgeTex.current) prevEdge.dispose();
    };

    const applyLoadedCover = (img: HTMLImageElement) => {
      const fx = roomVisualFxLive.current;
      const texSize = coverTextureSizeForResolution(fx.coverResolution);
      const token = ++coverTokenRef.current;
      const hasPrevCover = uniforms.uHasCover.value > 0.5 && Boolean(coverTex.current?.image);

      if (hasPrevCover) {
        const prevCoverCv = cloneCoverCanvas(coverTex.current.image as CanvasImageSource);
        if (prevCoverCv) {
          uniforms.uPrevCoverTex.value = replacePrevCanvasTexture(
            prevCoverTex,
            prevCoverCv,
            'cover',
          );
        }
        const prevEdgeImg = edgeTexRef.current?.image;
        if (prevEdgeImg instanceof HTMLCanvasElement && prevEdgeImg.width > 4) {
          const prevEdgeCv = cloneEdgeCanvas(prevEdgeImg);
          if (prevEdgeCv) {
            uniforms.uPrevEdgeTex.value = replacePrevCanvasTexture(
              prevEdgeTex,
              prevEdgeCv,
              'edge',
            );
          }
        }
      }

      // 新封面先上屏。边缘深度图 / 取色 / 浮层染色留到空闲帧：
      // 这几步同步跑完要上百毫秒，挤在切歌这一帧里就是整场一次大跳。
      const cv = makeSquareCoverCanvas(img, texSize);
      const prevMain = coverTex.current;
      const tex = new THREE.CanvasTexture(cv);
      applyCoverTextureSettings(tex);
      tex.needsUpdate = true;
      coverTex.current = tex;
      uniforms.uCoverTex.value = tex;
      uniforms.uHasCover.value = 1;
      if (prevMain && prevMain !== prevCoverTex.current) prevMain.dispose();

      const edgeCacheKey = `${proxiedCover ?? ''}|${texSize}`;
      let cachedEdge = getCoverEdgeCanvas(edgeCacheKey);
      depthTweenCancelRef.current?.();
      if (!cachedEdge && !hasPrevCover) {
        cachedEdge = buildCoverEdgeTexture(cv);
        setCoverEdgeCanvas(edgeCacheKey, cachedEdge);
      }
      if (cachedEdge) {
        swapEdgeTexture(cachedEdge);
        depthTweenCancelRef.current = tweenCoverDepthUniforms(uniforms, 1, 0.55, 120);
      } else {
        // 中性边缘图 = 零深度：先把粒子平顺摊平，等真深度图算好再涨回来
        swapEdgeTexture(null);
        depthTweenCancelRef.current = tweenCoverDepthUniforms(uniforms, 0, 0, 96);
      }

      colorMixCancelRef.current?.();
      if (hasPrevCover) {
        colorMixCancelRef.current = startCoverColorMixTween(uniforms, preset === 0 ? 520 : 960);
      } else {
        uniforms.uColorMixT.value = 1;
      }

      const refreshCoverDependentColors = () => {
        if (token !== coverTokenRef.current) return;
        const liveFx = roomVisualFxLive.current;
        if (liveFx.visualTintMode === 'auto') {
          (uniforms.uTintColor.value as THREE.Color).set(sampleCoverAccentColor(cv));
        }
        updateLyricPaletteFromCover(cv);
        floatLayer.refreshColorsFromCover(cv);
        if (liveFx.backCover) backCoverLayer.refreshColorsFromCover(cv);
        invalidate();
      };

      heavyCoverCancelRef.current?.();
      if (!hasPrevCover) {
        refreshCoverDependentColors();
      } else if (cachedEdge) {
        heavyCoverCancelRef.current = scheduleVisualApply(refreshCoverDependentColors, 90, 700);
      } else {
        heavyCoverCancelRef.current = scheduleVisualApply(() => {
          if (token !== coverTokenRef.current) return;
          const edgeCanvas = buildCoverEdgeTexture(cv);
          setCoverEdgeCanvas(edgeCacheKey, edgeCanvas);
          swapEdgeTexture(edgeCanvas);
          depthTweenCancelRef.current?.();
          depthTweenCancelRef.current = tweenCoverDepthUniforms(uniforms, 1, 0.55, 180);
          refreshCoverDependentColors();
        }, 120, 900);
      }

      invalidate();
    };

    if (!signedCover) {
      if (proxiedCover) {
        const cachedBeforeSign = getCachedCoverImage(proxiedCover);
        if (cachedBeforeSign) {
          coverImageCacheRef.current = cachedBeforeSign;
          applyLoadedCover(cachedBeforeSign);
          invalidate();
        }
        return;
      }
      coverImageCacheRef.current = null;
      uniforms.uHasDepth.value = 0;
      uniforms.uAiBoost.value = 0;
      const placeholder = makePlaceholderTexture();
      applyCoverTextureSettings(placeholder);
      coverTex.current = placeholder;
      uniforms.uCoverTex.value = placeholder;
      uniforms.uHasCover.value = 0;
      return;
    }

    let cancelled = false;

    const reused = getCachedCoverImage(proxiedCover);
    if (reused) {
      coverImageCacheRef.current = reused;
      applyLoadedCover(reused);
      invalidate();
      return () => {
        cancelled = true;
        depthTweenCancelRef.current?.();
        depthTweenCancelRef.current = null;
        colorMixCancelRef.current?.();
        colorMixCancelRef.current = null;
        heavyCoverCancelRef.current?.();
        heavyCoverCancelRef.current = null;
      };
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      coverImageCacheRef.current = img;
      cacheCoverImage(proxiedCover, img);
      applyLoadedCover(img);
      // 暂停时为 demand 帧循环，封面纹理就绪后需请求一帧才能显示。
      invalidate();
    };
    img.onerror = () => {
      if (cancelled) return;
      coverImageCacheRef.current = null;
      const placeholder = makePlaceholderTexture();
      applyCoverTextureSettings(placeholder);
      coverTex.current = placeholder;
      uniforms.uCoverTex.value = placeholder;
      uniforms.uHasCover.value = 0;
      uniforms.uHasDepth.value = 0;
      invalidate();
    };
    void loadSharedCoverResource(signedCover)
      .then((sharedUrl) => {
        if (!cancelled) img.src = sharedUrl;
      })
      .catch(() => {
        img.onerror?.(new Event('error'));
      });

    return () => {
      cancelled = true;
      depthTweenCancelRef.current?.();
      depthTweenCancelRef.current = null;
      colorMixCancelRef.current?.();
      colorMixCancelRef.current = null;
      heavyCoverCancelRef.current?.();
      heavyCoverCancelRef.current = null;
      img.onload = null;
      img.onerror = null;
    };
  }, [backCoverLayer, signedCover, proxiedCover, floatLayer, preset, uniforms, invalidate]);

  useFrame((state, rawDelta) => {
    // 切歌时封面解码 / 边缘纹理 / 调色板都在同一帧里跑，delta 会冲到几百毫秒；
    // 按原值积分会让唱片自转、涟漪、淡入一次性跳一大截，看着就是封面猛地弹一下。
    const delta = Math.min(rawDelta, 1 / 20);
    updateGalaxyParticlePointerFrame(state.camera);
    const currentFx = roomVisualFxLive.current;
    syncGalaxyFxUniforms(uniforms, currentFx);
    (uniforms.uMouseXY.value as THREE.Vector2).set(galaxyPointerField.x, galaxyPointerField.y);
    uniforms.uMouseActive.value = galaxyPointerField.active ? 1 : 0;

    tickGalaxyHandGesture(delta);
    const hand = galaxyHandGestureLive;
    (uniforms.uHandXY.value as THREE.Vector2).lerp(
      new THREE.Vector2(hand.handX, hand.handY),
      Math.min(1, delta * 9),
    );
    uniforms.uHandActive.value += (hand.handActive - (uniforms.uHandActive.value as number)) * Math.min(1, delta * 7.5);
    uniforms.uGestureGrip.value += (hand.gestureGrip - (uniforms.uGestureGrip.value as number)) * Math.min(1, delta * 8);

    const nextGrid = galaxyParticleGridForQuality(
      currentFx.coverResolution,
      currentFx.performanceQuality,
    );
    if (nextGrid !== gridRef.current) {
      gridRef.current = nextGrid;
      setParticleGrid(nextGrid);
      const cached = coverImageCacheRef.current;
      if (cached && uniforms.uHasCover.value > 0.5) {
        const prevCoverCv = cloneCoverCanvas(coverTex.current.image as CanvasImageSource);
        if (prevCoverCv) {
          uniforms.uPrevCoverTex.value = replacePrevCanvasTexture(
            prevCoverTex,
            prevCoverCv,
            'cover',
          );
        }
        const prevEdgeImg = edgeTexRef.current?.image;
        if (prevEdgeImg instanceof HTMLCanvasElement && prevEdgeImg.width > 4) {
          const prevEdgeCv = cloneEdgeCanvas(prevEdgeImg);
          if (prevEdgeCv) {
            uniforms.uPrevEdgeTex.value = replacePrevCanvasTexture(
              prevEdgeTex,
              prevEdgeCv,
              'edge',
            );
          }
        }

        const texSize = coverTextureSizeForResolution(currentFx.coverResolution);
        const cv = makeSquareCoverCanvas(cached, texSize);
        if (currentFx.visualTintMode === 'auto') {
          (uniforms.uTintColor.value as THREE.Color).set(sampleCoverAccentColor(cv));
        }
        const prevMain = coverTex.current;
        const tex = new THREE.CanvasTexture(cv);
        applyCoverTextureSettings(tex);
        tex.needsUpdate = true;
        coverTex.current = tex;
        uniforms.uCoverTex.value = tex;
        floatLayer.refreshColorsFromCover(cv);
        if (currentFx.backCover) backCoverLayer.refreshColorsFromCover(cv);
        // 画质变了要重算深度图，顺手让还挂着的延后任务作废（它算的是旧尺寸的画布）
        coverTokenRef.current += 1;
        const edgeCacheKey = `${proxiedCover ?? ''}|${texSize}`;
        const edgeCanvas = getCoverEdgeCanvas(edgeCacheKey) ?? buildCoverEdgeTexture(cv);
        setCoverEdgeCanvas(edgeCacheKey, edgeCanvas);
        const prevEdge = edgeTexRef.current;
        const nextEdge = new THREE.CanvasTexture(edgeCanvas);
        nextEdge.minFilter = THREE.LinearFilter;
        nextEdge.magFilter = THREE.LinearFilter;
        nextEdge.needsUpdate = true;
        edgeTexRef.current = nextEdge;
        uniforms.uEdgeTex.value = nextEdge;
        colorMixCancelRef.current?.();
        colorMixCancelRef.current = startCoverColorMixTween(
          uniforms,
          preset === 0 ? 300 : 520,
        );
        if (prevMain && prevMain !== prevCoverTex.current) prevMain.dispose();
        if (prevEdge && prevEdge !== nextEdge && prevEdge !== prevEdgeTex.current) prevEdge.dispose();
      }
    }

    resumeGalaxyAudioContext();

    // 浮层 / 背景粒子按画质档用 drawRange 降规模,不重建图层实例(稳定且零分配)。
    if (layerQualityRef.current !== currentFx.performanceQuality) {
      layerQualityRef.current = currentFx.performanceQuality;
      const scale = GALAXY_LAYER_COUNT_SCALE[currentFx.performanceQuality] ?? 1;
      const floatGeo = floatRef.current?.geometry;
      if (floatGeo) {
        const total = floatGeo.getAttribute('position')?.count ?? 0;
        floatGeo.setDrawRange(0, Math.max(1, Math.min(total, Math.round(FLOAT_COUNT_BASE * scale))));
      }
      const backGeo = backCoverRef.current?.geometry;
      if (backGeo) {
        const total = backGeo.getAttribute('position')?.count ?? 0;
        backGeo.setDrawRange(0, Math.max(1, Math.min(total, Math.round(BACK_COVER_COUNT_BASE * scale))));
      }
    }
    const bands = getCachedGalaxyAudioBands();
    const elapsed = state.clock.elapsedTime;
    uniforms.uTime.value = elapsed;
    uniforms.uBass.value = bands.bass;
    uniforms.uMid.value = bands.mid;
    uniforms.uTreble.value = bands.treble;
    uniforms.uBeat.value = bands.beat;
    uniforms.uEnergy.value = bands.energy;
    uniforms.uPixel.value = state.gl.getPixelRatio();

    const vinylSpeedMul = Math.max(0.05, currentFx.speed);
    const vinylSpinSpeed = (0.4 + bands.smoothBass * 0.09) * vinylSpeedMul;
    if (isPlaying) {
      vinylSpinRef.current =
        (vinylSpinRef.current + delta * vinylSpinSpeed) % (Math.PI * 2);
    } else {
      vinylSpinRef.current =
        (vinylSpinRef.current + delta * 0.05 * vinylSpeedMul) % (Math.PI * 2);
    }
    uniforms.uVinylSpin.value = vinylSpinRef.current;

    if (preset === 0) {
      rippleSystem.update(delta, bands.rippleBass, elapsed, uniforms);
    } else {
      uniforms.uRippleCount.value = 0;
    }

    tickPresetParticleTransition(
      presetTransitionRef.current,
      elapsed,
      uniforms,
      currentFx,
    );

    const emilyLayers = preset === 0;
    const floatAlphaTarget = preset === 0 ? 0.92 : preset >= 4 ? 0.72 : 0.82;
    uniforms.uFloatAlpha.value +=
      (floatAlphaTarget - uniforms.uFloatAlpha.value) * Math.min(1, delta * 3.2);

    if (bloomRef.current) {
      bloomRef.current.visible = effectiveBloomStrength(currentFx) > 0;
    }
    if (floatRef.current) {
      floatRef.current.visible = emilyLayers && currentFx.floatLayer;
    }
    if (backCoverRef.current) {
      backCoverRef.current.visible = emilyLayers && currentFx.backCover;
    }

    uniforms.uBurstAmt.value *= 0.9;

    // 淡入不能依赖播放状态：暂停时进入沉浸也必须让粒子可见，否则 uAlpha 停在 0 会黑屏。
    if (uniforms.uAlpha.value < 1) {
      uniforms.uAlpha.value = Math.min(1, uniforms.uAlpha.value + delta / 0.26);
      // demand 帧循环（暂停时）不会自动持续出帧，需主动请求下一帧完成淡入。
      invalidate();
    }

    syncParticleGroupRotation(delta, galaxyOrbitRef.current.centerLocked);

    const particleRoot = getParticleRootGroup();
    if (particleRoot && floatRef.current) {
      floatRef.current.rotation.copy(particleRoot.rotation);
    }
  });

  useEffect(
    () => () => {
      depthTweenCancelRef.current?.();
      colorMixCancelRef.current?.();
      heavyCoverCancelRef.current?.();
      coverTokenRef.current += 1;
      rippleSystem.texture.dispose();
      geometry.dispose();
      bloomGeometry.dispose();
      material.dispose();
      bloomMaterial.dispose();
      floatLayer.dispose();
      backCoverLayer.dispose();
      dotTex.dispose();
      edgeTexRef.current.dispose();
      coverTex.current.dispose();
      prevCoverTex.current.dispose();
      prevEdgeTex.current.dispose();
    },
    [backCoverLayer, bloomGeometry, bloomMaterial, dotTex, floatLayer, geometry, material, rippleSystem],
  );

  return (
    <group ref={(node) => registerParticleRootGroup(node)}>
      <GalaxyFloatingSongCard />
      <GalaxyStageLyrics isPlaying={isPlaying} spatialAnchor={spatialAnchor} />
      <GalaxyBackgroundStarRiver preset={preset} dotTexture={dotTex} />
      <primitive object={backCoverLayer.points} />
      <points
        ref={bloomRef}
        geometry={bloomGeometry}
        material={bloomMaterial}
        frustumCulled={false}
        renderOrder={0}
      />
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />
      <primitive object={floatLayer.points} />
    </group>
  );
}
