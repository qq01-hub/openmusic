import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSmoothPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackLyrics } from '../../hooks/useTrackLyrics';
import { findActiveLyricIndex } from '../../lib/lyricActiveIndex';
import { immersiveLyricIndexes } from '../../lib/immersiveLyricLines';
import { roomVisualFxLive, subscribeRoomVisualFx } from '../../lib/roomVisualFxLive';
import { subscribeStageLyricPalette } from '../../lib/stageLyricPaletteLive';
import { useRoomStore } from '../../stores/roomStore';
import { ensureLyricFontLoaded } from '../../lib/lyricFonts';
import { getGalaxyBeatCameraKick } from './lib/galaxyCinema';
import { getCachedGalaxyAudioBands, resumeGalaxyAudioContext } from './lib/galaxyAudio';
import {
  LYRIC_ROW_FIT_BUDGET_W,
  buildLyricMaskAsset,
  buildLyricMesh,
  createStageLyricRoot,
  applyLyricPaletteToMesh,
  disposeLyricMesh,
  disposeStageLyricRoot,
  primeLyricMeshTextures,
  type LyricMeshGroup,
} from './lib/galaxyStageLyricMaterial';
import {
  LYRIC_CONTEXT_SCALE,
  LYRIC_ROW_WORLD_EM,
  createLyricRowTrack,
  disposeLyricRowTrack,
  invalidateLyricRowTrack,
  lyricRowTrackAnchorY,
  refreshLyricRowTrackPalette,
  syncLyricRowTrackLayout,
  updateLyricRowTrack,
} from './lib/galaxyLyricRowTrack';
import {
  createStageLyricsRuntime,
  lyricStackViewportFit,
  snapStageLyricCameraLock,
  updateStageLyrics3D,
  type StageLyricStageRoot,
} from './lib/galaxyStageLyrics3D';

interface Props {
  isPlaying: boolean;
  spatialAnchor?: 'galaxy' | 'topography';
}

/** 当前行升格 / 上一行降格的时长，两者严格互补 */
const SWAP_SECONDS = 0.32;
const LYRIC_TEXT_OPACITY = 0.96;
/** tickLyricMesh 的基准 scale 是 0.96，降到上下文大小要按它换算 */
const HERO_DEMOTE_SCALE = LYRIC_CONTEXT_SCALE / 0.96;

function smoothstep(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return t * t * (3 - 2 * t);
}

/** Mineradio stageLyrics + 行图层轨道 — 所有着色器预设共用 */
export default function GalaxyStageLyrics({ isPlaying, spatialAnchor = 'galaxy' }: Props) {
  const current = useRoomStore((s) => s.room?.current ?? null);
  const currentTime = useSmoothPlaybackTime();
  const lyrics = useTrackLyrics(current);
  const activeIndex = findActiveLyricIndex(lyrics, currentTime);
  const activeLine = activeIndex >= 0 ? lyrics[activeIndex] : null;
  const currentLine = activeLine?.text ?? null;
  const { camera, gl, size } = useThree();
  const fitBudgetW = Math.max(480, Math.min(LYRIC_ROW_FIT_BUDGET_W, LYRIC_ROW_FIT_BUDGET_W * size.width / Math.max(1, size.height)));

  const stageRootRef = useRef<StageLyricStageRoot | null>(null);
  const trackRef = useRef(createLyricRowTrack());
  const heroRef = useRef<LyricMeshGroup | null>(null);
  const outgoingRef = useRef<LyricMeshGroup | null>(null);
  const outgoingIndexRef = useRef(-1);
  const ownedLinesRef = useRef(new Set<number>());
  const runtimeRef = useRef(createStageLyricsRuntime());
  const prewarmRef = useRef(new Map<string, LyricMeshGroup>());
  const swapProgressRef = useRef(1);
  const heroKeyRef = useRef<string | null>(null);
  const songIdRef = useRef<string | null>(null);
  const worldPosRef = useRef(new THREE.Vector3());
  const [paletteRevision, setPaletteRevision] = useState(0);
  const [fxRevision, setFxRevision] = useState(0);
  const [fontRevision, setFontRevision] = useState(0);

  useEffect(() => subscribeRoomVisualFx(() => setFxRevision((v) => v + 1)), []);
  useEffect(() => subscribeStageLyricPalette(() => setPaletteRevision((v) => v + 1)), []);

  const fx = roomVisualFxLive.current;

  // 只有真正会改变画布内容的设置才该让纹理作废；配色是运行时 uniform，不算。
  const textureSignature = useMemo(
    () => `${fx.lyricFont}|${fx.lyricWeight}|${fx.lyricLetterSpacing}|${fx.lyricTextureClarity}`
      + `|${fx.performanceQuality}|${fx.lyricEdgeFade}|${fontRevision}|${Math.round(fitBudgetW)}`,
    [fx.lyricFont, fx.lyricWeight, fx.lyricLetterSpacing, fx.lyricTextureClarity, fx.performanceQuality, fx.lyricEdgeFade, fontRevision, fxRevision, fitBudgetW],
  );

  const visibleIndexes = useMemo(
    () => immersiveLyricIndexes(activeIndex, lyrics.length, fx),
    [activeIndex, lyrics.length, fx.lyricDisplayMode, fx.lyricCustomLineCount, fxRevision],
  );

  const heroKey = activeLine?.text
    ? `${activeIndex}:${activeLine.text}:${textureSignature}`
    : null;

  const createHeroMesh = useCallback(
    (index: number): LyricMeshGroup | null => {
      const text = lyrics[index]?.text?.trim();
      if (!text) return null;
      const mask = buildLyricMaskAsset(text, null, false, {
        rows: [{ text, alpha: 1, scale: 1, active: true }],
        translationMode: 'off',
        worldScale: 'row',
        fitBudgetW,
      });
      const mesh = buildLyricMesh(mask);
      mesh.position.x = 0;
      applyLyricPaletteToMesh(mesh);
      return mesh;
    },
    [lyrics, textureSignature, fitBudgetW],
  );

  useEffect(() => {
    let cancelled = false;
    void ensureLyricFontLoaded(fx).then(() => {
      if (!cancelled) setFontRevision((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [fx.lyricFont, fx.lyricWeight, fxRevision]);

  const stageRoot = useMemo(() => {
    const root = createStageLyricRoot();
    root.add(trackRef.current.group);
    stageRootRef.current = root;
    return root;
  }, []);

  // 歌词表 / 字体 / 清晰度变了，整条轨道的纹理才作废；滚动本身永远不重建
  useEffect(() => {
    invalidateLyricRowTrack(trackRef.current, `${current?.queueId ?? ''}|${lyrics.length}|${textureSignature}`);
  }, [current?.queueId, lyrics, textureSignature]);

  useEffect(() => {
    syncLyricRowTrackLayout(
      trackRef.current,
      lyrics,
      fx,
      activeIndex,
      visibleIndexes.length,
      `${current?.queueId ?? ''}|${lyrics.length}`,
      fitBudgetW,
    );
  }, [lyrics, activeIndex, visibleIndexes.length, current?.queueId, fxRevision, textureSignature, fitBudgetW]);

  const heroMesh = useMemo(() => {
    if (!heroKey || !currentLine) return null;
    const warmed = prewarmRef.current.get(heroKey);
    if (warmed) {
      prewarmRef.current.delete(heroKey);
      return warmed;
    }
    return createHeroMesh(activeIndex);
  }, [heroKey]);

  const dropPrewarmed = useCallback(() => {
    prewarmRef.current.forEach((mesh) => disposeLyricMesh(mesh));
    prewarmRef.current.clear();
  }, []);

  // 当前句稳定后用空闲时间把下一句连同 GPU 上传一起备好
  useEffect(() => {
    const nextIndex = activeIndex + 1;
    if (activeIndex < 0 || nextIndex >= lyrics.length) return;
    let cancelled = false;
    let idleHandle = 0;
    const build = () => {
      if (cancelled) return;
      const text = lyrics[nextIndex]?.text?.trim();
      if (!text) return;
      const key = `${nextIndex}:${text}:${textureSignature}`;
      if (prewarmRef.current.has(key)) return;
      const mesh = createHeroMesh(nextIndex);
      if (!mesh) return;
      if (cancelled) {
        disposeLyricMesh(mesh);
        return;
      }
      // 画布烤好还不够，纹理不预先上传的话第一帧仍会卡在 texImage2D
      primeLyricMeshTextures(gl, mesh);
      dropPrewarmed();
      prewarmRef.current.set(key, mesh);
    };
    const idle = window.requestIdleCallback;
    const timer = window.setTimeout(() => {
      if (document.hidden) return;
      if (idle) idleHandle = idle(build, { timeout: 2000 });
      else build();
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle && window.cancelIdleCallback) window.cancelIdleCallback(idleHandle);
    };
  }, [activeIndex, heroKey, lyrics, textureSignature, createHeroMesh, dropPrewarmed, gl]);

  useEffect(() => {
    applyLyricPaletteToMesh(heroRef.current);
    applyLyricPaletteToMesh(outgoingRef.current);
    refreshLyricRowTrackPalette(trackRef.current);
  }, [paletteRevision, heroMesh]);

  const releaseOutgoing = useCallback(() => {
    const root = stageRootRef.current;
    const stale = outgoingRef.current;
    if (!stale) return;
    if (root) root.remove(stale);
    disposeLyricMesh(stale);
    outgoingRef.current = null;
    outgoingIndexRef.current = -1;
  }, []);

  useEffect(() => {
    const root = stageRootRef.current;
    const prev = heroRef.current;
    const prevIndex = Number(heroKeyRef.current?.split(':')[0] ?? -1);
    const lineChanged = heroKey !== heroKeyRef.current;
    const songId = current?.queueId ?? null;
    const sameSong = songIdRef.current === songId;

    if (prev && prev !== heroMesh) {
      releaseOutgoing();
      const canDemote = lineChanged && sameSong && prevIndex >= 0 && prevIndex !== activeIndex;
      if (canDemote && root) {
        outgoingRef.current = prev;
        outgoingIndexRef.current = prevIndex;
        prev.userData.age = 0;
      } else {
        if (root) root.remove(prev);
        disposeLyricMesh(prev);
      }
    }

    heroRef.current = heroMesh;
    songIdRef.current = songId;
    if (heroMesh) {
      // 立刻让轨道让位，否则升格第一帧会和上下文行叠成双影
      const displaced = trackRef.current.rows.get(`${activeIndex}:p`);
      if (displaced) {
        displaced.opacity = 0;
        displaced.mesh.visible = false;
        displaced.mesh.userData.lyric.textMat.uniforms.uOpacity.value = 0;
      }
    }
    if (heroMesh && root) {
      root.add(heroMesh);
      if (lineChanged) {
        heroMesh.userData.age = 0;
        snapStageLyricCameraLock(runtimeRef.current);
      }
      // 位置完全交给行轨道，tickLyricMesh 不再自己缓动 Y
      heroMesh.userData.trackAnchorY = heroMesh.userData.trackAnchorY ?? 0.18;
      swapProgressRef.current = outgoingRef.current ? 0 : 1;
    }
    heroKeyRef.current = heroKey;
  }, [heroKey, heroMesh, activeIndex, current?.queueId, releaseOutgoing]);

  useEffect(() => () => dropPrewarmed(), [lyrics, dropPrewarmed]);

  // 标签页隐藏时渲染循环停摆，降格中的旧行会僵在最后一帧
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) releaseOutgoing();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [releaseOutgoing]);

  useEffect(
    () => () => {
      const root = stageRootRef.current;
      const hero = heroRef.current;
      const outgoing = outgoingRef.current;
      if (hero && root) root.remove(hero);
      if (outgoing && root) root.remove(outgoing);
      disposeLyricMesh(hero);
      disposeLyricMesh(outgoing);
      prewarmRef.current.forEach((warm) => disposeLyricMesh(warm));
      prewarmRef.current.clear();
      disposeLyricRowTrack(trackRef.current);
      disposeStageLyricRoot(root);
      stageRootRef.current = null;
      heroRef.current = null;
      outgoingRef.current = null;
    },
    [],
  );

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const hero = heroRef.current;
    const outgoing = outgoingRef.current;
    const root = stageRootRef.current;
    const track = trackRef.current;
    if (!root) return;

    const liveFx = roomVisualFxLive.current;
    const lyricsEnabled = liveFx.particleLyrics;
    if (!lyricsEnabled || !hero || !currentLine || (!isPlaying && !liveFx.lyricPauseHold)) {
      if (hero?.userData.lyric?.textMat) hero.userData.lyric.textMat.uniforms.uOpacity.value = 0;
      track.rows.forEach((row) => {
        row.opacity = 0;
        row.mesh.visible = false;
      });
      if (root.userData.starRiverMat) root.userData.starRiverMat.uniforms.uOpacity.value = 0;
      return;
    }

    if (isPlaying) resumeGalaxyAudioContext();
    const bands = isPlaying ? getCachedGalaxyAudioBands() : { bass: 0, mid: 0, beat: 0, energy: 0 };
    const kick = isPlaying
      ? getGalaxyBeatCameraKick()
      : { thetaKick: 0, phiKick: 0, radiusKick: 0, rollKick: 0, punch: 0 };

    if (root.userData.starRiverMat) {
      root.userData.starRiverMat.uniforms.uBass.value = bands.bass;
      root.userData.starRiverMat.uniforms.uBeat.value = bands.beat;
    }

    swapProgressRef.current = Math.min(1, swapProgressRef.current + delta / SWAP_SECONDS);
    const promote = smoothstep(swapProgressRef.current);

    // 归属逐帧从实际挂着的 mesh 反推：跨 effect 维护这个集合只要漏掉一次
    // （比如歌词数组重新拉取、文本没变所以 hero 不重建），当前行就会和轨道行叠成两份
    const owned = ownedLinesRef.current;
    owned.clear();
    owned.add(activeIndex);
    if (outgoing && outgoingIndexRef.current >= 0) owned.add(outgoingIndexRef.current);

    const metrics = updateLyricRowTrack(track, {
      fx: liveFx,
      activeIndex,
      visibleIndexes,
      ownedLines: ownedLinesRef.current,
      dt: delta,
      time: state.clock.elapsedTime,
      renderer: gl,
      // 切句那一瞬间别再挤占主线程去烤新行
      allowBuild: rawDelta < 0.05 && swapProgressRef.current >= 1,
    });

    hero.userData.trackAnchorY = metrics.activeAnchorY;

    const heroData = hero.userData.lyric;
    const contextOpacity = Math.max(0.25, Math.min(1, liveFx.lyricContextOpacity));

    root.getWorldPosition(worldPosRef.current);
    const cameraLockDistance =
      spatialAnchor === 'topography' ? camera.position.distanceTo(worldPosRef.current) : undefined;

    const persp = camera as THREE.PerspectiveCamera;
    const fitOverride = persp.isPerspectiveCamera
      ? lyricStackViewportFit({
          camera: persp,
          stackWidth: Math.max(metrics.stackWidth, heroData?.textWorldW ?? 0, 0.6),
          stackHeight: Math.max(0.5, Math.min(metrics.stackHeight, Math.max(
            Math.max(heroData?.textWorldH ?? 0, metrics.activeHeight) * 0.6,
            visibleIndexes.length * LYRIC_ROW_WORLD_EM * 1.3,
          ))),
          layoutScale: Math.max(0.35, Math.min(1.65, liveFx.lyricScale || 1)),
          layoutX: liveFx.lyricOffsetX || 0,
          layoutY: liveFx.lyricOffsetY || 0,
          layoutTiltX: liveFx.lyricTiltX || 0,
          layoutTiltY: liveFx.lyricTiltY || 0,
          distance: cameraLockDistance ?? 4.85 + (liveFx.lyricOffsetZ || 0),
          cameraLocked: spatialAnchor === 'galaxy' && liveFx.lyricCameraLock,
        })
      : null;

    updateStageLyrics3D({
      stageRoot: root,
      currentMesh: hero,
      camera,
      dt: delta,
      time: state.clock.elapsedTime,
      bands,
      kick,
      fx: liveFx,
      runtime: runtimeRef.current,
      spatialAnchor,
      cameraLockDistance,
      fitOverride,
      stackWidth: Math.max(metrics.stackWidth, heroData?.textWorldW ?? 0),
      stackHeight: metrics.stackHeight,
    });

    // 升格：上一帧还是上下文样式的这一行，平滑长到当前行（含溢光）
    if (promote < 1 && heroData) {
      hero.scale.multiplyScalar(HERO_DEMOTE_SCALE + (1 - HERO_DEMOTE_SCALE) * promote);
      heroData.textMat.uniforms.uOpacity.value =
        contextOpacity + (LYRIC_TEXT_OPACITY - contextOpacity) * promote;
      if (heroData.glowMat) heroData.glowMat.opacity *= promote;
      if (heroData.sunMat) heroData.sunMat.opacity *= promote;
      if (heroData.readabilityMat) heroData.readabilityMat.opacity *= promote;
    }

    if (outgoing) {
      const data = outgoing.userData.lyric;
      outgoing.userData.age += Math.min(delta, 0.12);
      const demote = 1 - smoothstep(outgoing.userData.age / SWAP_SECONDS);
      const anchor = lyricRowTrackAnchorY(track, outgoingIndexRef.current);
      if (anchor != null) outgoing.position.y = anchor;
      outgoing.scale.setScalar(LYRIC_CONTEXT_SCALE + (1 - LYRIC_CONTEXT_SCALE) * demote);
      if (data) {
        data.textMat.uniforms.uOpacity.value =
          contextOpacity + (LYRIC_TEXT_OPACITY - contextOpacity) * demote;
        if (data.glowMat) data.glowMat.opacity *= demote;
        if (data.sunMat) data.sunMat.opacity *= demote;
        if (data.readabilityMat) data.readabilityMat.opacity *= demote;
        if (data.sparkMat) data.sparkMat.uniforms.uOpacity.value *= demote;
      }
      // 降到和上下文行一模一样时再交棒，轨道行接手看不出切换
      if (demote <= 0.001) {
        const handoffKey = `${outgoingIndexRef.current}:p`;
        const handoff = track.rows.get(handoffKey);
        if (handoff) {
          handoff.opacity = contextOpacity;
          handoff.mesh.visible = true;
          handoff.mesh.userData.lyric.textMat.uniforms.uOpacity.value = contextOpacity;
          handoff.mesh.scale.setScalar(LYRIC_CONTEXT_SCALE);
          const anchor = lyricRowTrackAnchorY(track, outgoingIndexRef.current);
          if (anchor != null) handoff.mesh.position.y = anchor;
        }
        releaseOutgoing();
      }
    }
  });

  return <primitive object={stageRoot} />;
}
