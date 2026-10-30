import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';

import { getSharedAudio } from '../../lib/audioElement';
import { roomVisualFxLive, subscribeRoomVisualFx } from '../../lib/roomVisualFxLive';
import { stageLyricPaletteLive, subscribeStageLyricPalette } from '../../lib/stageLyricPaletteLive';
import type { QueueItem } from '../../types';
import {
  getTopographyFrequencyBins512,
  readGalaxyAudioBands,
  resumeGalaxyAudioContext,
} from '../galaxy/lib/galaxyAudio';
import GalaxyOrbitControls from '../galaxy/GalaxyOrbitControls';
import GalaxyStageLyrics from '../galaxy/GalaxyStageLyrics';
import GalaxyFloatingSongCard from '../galaxy/GalaxyFloatingSongCard';
import TopographyCameraRig, { TOPOGRAPHY_ORBIT_BASELINE } from './TopographyCameraRig';
import TopographyStarField from './TopographyStarField';
import TopographyVisualRoot from './TopographyVisualRoot';
import { useVisualRenderPolicy } from '../../hooks/useVisualRenderPolicy';
import VisualFrameScheduler from '../visual/VisualFrameScheduler';

interface Props {
  song: Pick<QueueItem, 'id' | 'source' | 'name' | 'artist' | 'pic' | 'duration'> | null | undefined;
  isPlaying: boolean;
}

const THEME_COLORS = {
  'coral-mirage': '#cb6c89',
  'ocean-deep': '#1b6fb8',
  'arctic-aurora': '#79e1c4',
  'cyber-forest': '#3fc78a',
  'minimal-monochrome': '#d9dde3',
} as const;

function normalizeHex(value: string | undefined, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

function hexRgb(hex: string): [number, number, number] {
  const raw = normalizeHex(hex, '#ffffff').slice(1);
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}

function mixHex(a: string, b: string, amount: number): string {
  const ca = hexRgb(a);
  const cb = hexRgb(b);
  const t = Math.max(0, Math.min(1, amount));
  return `#${ca.map((value, index) => Math.round(value + (cb[index]! - value) * t).toString(16).padStart(2, '0')).join('')}`;
}

function schemeColor(hex: string): string {
  return hexRgb(hex).map((value) => String(value / 255)).join(' ');
}

function customTheme(primary: string, base: string, warm: string, cool: string, ripple: string, peak: string) {
  return {
    name: 'Mineradio Region Palette',
    id: 'mineradio-custom',
    __primaryColor: primary,
    uBaseColor1: mixHex('#000000', base, 0.2),
    uBaseColor2: mixHex(base, primary, 0.22),
    uCoolCore: cool,
    uCoolEdge: mixHex('#000000', cool, 0.48),
    uWarmCore: warm,
    uWarmEdge: mixHex('#000000', warm, 0.56),
    uRippleColor: ripple,
    uPeakColor: peak,
    uGlowIntensity: 0.72,
  };
}

/** Mineradio WORKSHOP_DEFAULT_PROPERTIES.cameraDistance，桥接场景的镜头是固定的 */
const WE_CAMERA_DISTANCE = 80;

function buildProperties(cameraDistance = WE_CAMERA_DISTANCE) {
  const fx = roomVisualFxLive.current;
  const palette = stageLyricPaletteLive.coverPalette || stageLyricPaletteLive.palette;
  const themeColor = THEME_COLORS[fx.sonicWorkshopTheme];
  const primary = fx.sonicWorkshopColorMode === 'custom'
    ? normalizeHex(fx.sonicWorkshopCustomColor, themeColor)
    : normalizeHex(palette.primary, themeColor);
  const region = (mode: 'cover' | 'custom', custom: string, cover: string, fallback: string) =>
    mode === 'custom' ? normalizeHex(custom, fallback) : normalizeHex(cover, fallback);
  const base = region(fx.sonicWorkshopBaseColorMode, fx.sonicWorkshopBaseColor, palette.shadow, mixHex('#000000', primary, 0.12));
  const warm = region(fx.sonicWorkshopWarmColorMode, fx.sonicWorkshopWarmColor, palette.secondary, primary);
  const cool = region(fx.sonicWorkshopCoolColorMode, fx.sonicWorkshopCoolColor, palette.highlight, '#99c4ff');
  const ripple = region(fx.sonicWorkshopRippleColorMode, fx.sonicWorkshopRippleColor, palette.glowColor || palette.glow, '#f8d8ff');
  const peak = region(fx.sonicWorkshopPeakColorMode, fx.sonicWorkshopPeakColor, palette.highlight, '#99c4ff');
  const gridSize = 320;
  return {
    schemecolor: schemeColor(primary),
    theme: 'mineradio-custom',
    mineradioCustomTheme: customTheme(primary, base, warm, cool, ripple, peak),
    themeCycleInterval: 50,
    peakColorEnabled: true,
    peakColorIntensity: fx.sonicWorkshopPeakIntensity,
    gridSize,
    audioIntensity: fx.sonicWorkshopAudioIntensity,
    responseRange: fx.sonicWorkshopResponseRange,
    pulseEnabled: true,
    pulseSensitivity: 0.05,
    pulseCooldown: 0,
    meteorEnabled: true,
    meteorSensitivity: 0.3,
    meteorCooldown: 60,
    meteorClickEnabled: true,
    idleWaveEnabled: true,
    idleWaveDebounce: 1,
    idleWaveFadeDuration: 1,
    cameraDistance,
    autoRotateEnabled: true,
    autoRotateSpeed: 7,
    cameraAngleX: 150,
    cameraAngleY: 30,
    showPlayerController: false,
    showAlbumCover: false,
    controllerSize: 'large',
    controllerX: 2,
    controllerY: 3,
  };
}

function buildAudioSamples(
  raw: Uint8Array | null,
  inputGain: number,
  isPlaying: boolean,
  beat = 0,
  bass = 0,
): number[] {
  if (!raw?.length) return new Array(512).fill(0);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < 512; i++) {
    const value = (raw[Math.min(raw.length - 1, i)] || 0) / 255;
    sum += value;
    max = Math.max(max, value);
  }
  const mean = sum / 512;
  const floor = Math.max(0.035, Math.min(0.2, mean * 0.48));
  const peakFloor = Math.max(0.38, Math.min(0.76, mean * 1.72));
  const bodyGain = Math.max(0.28, 0.33 - mean * 0.1);
  const gain = Math.max(0.4, Math.min(1, inputGain / 100)) * (isPlaying ? 1 : 0.12);
  return Array.from({ length: 512 }, (_, i) => {
    const value = (raw[Math.min(raw.length - 1, i)] || 0) / 255;
    const body = Math.pow(Math.max(0, Math.min(1, (value - floor) / Math.max(0.001, 1 - floor))), 1.55);
    const peak = Math.pow(Math.max(0, Math.min(1, (value - peakFloor) / Math.max(0.001, 1 - peakFloor))), 1.08);
    const lowLift = i < 36 ? (1 - i / 36) * (beat * 0.035 + bass * 0.022) : 0;
    return Math.max(0, Math.min(0.52, body * bodyGain + peak * 0.12 + lowLift)) * gain;
  });
}

export default function SonicWorkshopBackground({ song, isPlaying }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const renderPolicy = useVisualRenderPolicy(isPlaying);

  useEffect(() => subscribeRoomVisualFx(() => setRevision((value) => value + 1)), []);
  useEffect(() => subscribeStageLyricPalette(() => setRevision((value) => value + 1)), []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow && event.data?.type === 'mineradio-sonic-workshop-ready') {
        setReady(true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    iframeRef.current?.contentWindow?.postMessage({
      type: 'mineradio-sonic-workshop-properties',
      properties: buildProperties(),
    }, '*');
  }, [ready, revision]);

  useEffect(() => {
    if (!ready) return;
    const audio = getSharedAudio();
    const pushMedia = () => {
      if (document.hidden) return;
      iframeRef.current?.contentWindow?.postMessage({
        type: 'mineradio-sonic-workshop-media',
        media: {
          title: song?.name || '',
          artist: song?.artist || '',
          // 播放器和专辑封面均已关闭，避免 iframe 再请求未签名的 /api/meting 封面。
          thumbnail: '',
          primaryColor: stageLyricPaletteLive.palette.primary,
          textColor: stageLyricPaletteLive.palette.highlight,
          isPlaying,
          position: audio.currentTime || 0,
          duration: Number.isFinite(audio.duration) ? audio.duration : (song?.duration || 0),
        },
      }, '*');
    };
    pushMedia();
    const timer = window.setInterval(pushMedia, 250);
    return () => window.clearInterval(timer);
  }, [ready, song, isPlaying, revision]);

  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    let lastPush = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || now - lastPush < 33) return;
      lastPush = now;
      if (isPlaying) resumeGalaxyAudioContext();
      const bands = readGalaxyAudioBands(1 / 30);
      const samples = buildAudioSamples(
        getTopographyFrequencyBins512(),
        roomVisualFxLive.current.sonicWorkshopInputGain,
        isPlaying,
        bands.beat,
        bands.bass,
      );
      iframeRef.current?.contentWindow?.postMessage({ type: 'mineradio-sonic-workshop-audio', samples }, '*');
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, isPlaying]);

  const dpr = roomVisualFxLive.current.performanceQuality === 'eco' ? 0.75 : roomVisualFxLive.current.performanceQuality === 'ultra' ? 1.5 : 1;
  if (!renderPolicy.mounted) return null;
  return (
    <>
      <iframe
        ref={iframeRef}
        title="音域回响 Wallpaper Engine"
        src="/vendor/sonic-workshop/mineradio-bridge.html"
        sandbox="allow-scripts"
        className="pointer-events-none absolute inset-0 h-full w-full border-0"
        tabIndex={-1}
        aria-hidden
        onLoad={() => setReady(true)}
      />
      {/* WE 地形只是 iframe 背板（Mineradio 同样固定 cameraDistance），
          星空 / 歌词 / 歌单架跑在这台真实相机上，推拉缩放的是它们 */}
      <div className="pointer-events-auto absolute inset-0 z-[1]">
        <Canvas
          dpr={dpr}
          frameloop={renderPolicy.frameloop}
          style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'auto' }}
          camera={{ fov: 45, near: 0.1, far: 200, position: [0, 1.1, TOPOGRAPHY_ORBIT_BASELINE.radius] }}
          gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <VisualFrameScheduler fps={renderPolicy.targetFps} />
          <GalaxyOrbitControls preset={6} />
          <TopographyCameraRig maxRadius={16} />
          <TopographyVisualRoot>
            <TopographyStarField />
            <GalaxyStageLyrics isPlaying={isPlaying} spatialAnchor="topography" />
            <GalaxyFloatingSongCard />
          </TopographyVisualRoot>
        </Canvas>
      </div>
    </>
  );
}
