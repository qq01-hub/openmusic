import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { getCoverUrl } from '../api/music';
import type { QueueItem } from '../types';
import { ROOM_VISUAL_MODE_META, type RoomVisualMode } from '../lib/roomVisualPreset';
import { roomVisualFxLive, subscribeRoomVisualFx } from '../lib/roomVisualFxLive';
import { effectiveBackgroundColor } from '../lib/roomVisualAppearance';
import { syncGalaxyHandGestureMode } from './galaxy/lib/galaxyHandGesture';
import AmbientCoverLayers from './AmbientCoverLayers';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { LOCAL_BACKGROUND_MEDIA_REF, readLocalBackgroundMedia } from '../lib/localBackgroundMedia';

const GalaxyBackground = lazyWithRetry(() => import('./galaxy/GalaxyBackground3D'), 'GalaxyBackground3D');
const FoliaBackground = lazyWithRetry(() => import('./immersive/FoliaBackground'), 'FoliaBackground');
const TopographyBackground = lazyWithRetry(() => import('./topography/TopographyBackground3D'), 'TopographyBackground3D');
const SonicWorkshopBackground = lazyWithRetry(() => import('./topography/SonicWorkshopBackground'), 'SonicWorkshopBackground');

interface Props {
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'name' | 'artist' | 'pic' | 'url' | 'duration'> | null | undefined;
  visualMode: RoomVisualMode;
  isPlaying: boolean;
  immersivePanelFocus?: 'search' | 'queue' | 'chat' | null;
}

export default function RoomAmbientBackground({
  song,
  visualMode,
  isPlaying,
  immersivePanelFocus = null,
}: Props) {
  const coverUrl = song ? getCoverUrl(song, 'medium') : null;
  const effectiveVisualMode = visualMode;
  const meta = ROOM_VISUAL_MODE_META[effectiveVisualMode];
  const shaderPreset = meta.shaderPreset;
  const showShaderBackground = shaderPreset !== undefined;
  const isTopography = effectiveVisualMode === 'topography';
  const isSonicWorkshop = effectiveVisualMode === 'topography-we';
  const showCoverUnderlay = effectiveVisualMode === 'cover-bg' && Boolean(coverUrl);

  const [bgStyle, setBgStyle] = useState(() => {
    const fx = roomVisualFxLive.current;
    return {
      color: effectiveBackgroundColor(fx),
      opacity: fx.backgroundOpacity,
      media: fx.backgroundMedia,
    };
  });
  const [localMedia, setLocalMedia] = useState<{ url: string; type: string } | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const objectUrlRef = useRef('');

  const revokeLocalMediaUrl = useCallback(() => {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = '';
  }, []);

  useEffect(() => {
    const sync = () => {
      const fx = roomVisualFxLive.current;
      setBgStyle({
        color: effectiveBackgroundColor(fx),
        opacity: fx.backgroundOpacity,
        media: fx.backgroundMedia,
      });
    };
    sync();
    return subscribeRoomVisualFx(sync);
  }, []);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (bgStyle.media !== LOCAL_BACKGROUND_MEDIA_REF) {
        revokeLocalMediaUrl();
        setLocalMedia(null);
        return;
      }
      try {
        const record = await readLocalBackgroundMedia();
        if (disposed) return;
        if (!record) {
          revokeLocalMediaUrl();
          setLocalMedia(null);
          return;
        }
        const nextUrl = URL.createObjectURL(record.blob);
        // 先挂新的再回收旧的，避免 DOM 上短暂指向一个已经失效的 blob
        revokeLocalMediaUrl();
        objectUrlRef.current = nextUrl;
        setLocalMedia({ url: nextUrl, type: record.type || record.blob.type });
      } catch (error) {
        console.warn('Unable to load local background media:', error);
        if (!disposed) {
          revokeLocalMediaUrl();
          setLocalMedia(null);
        }
      }
    };
    void load();
    const refresh = () => void load();
    window.addEventListener('openmusic:local-background-updated', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('openmusic:local-background-updated', refresh);
    };
  }, [bgStyle.media, revokeLocalMediaUrl]);

  // 只在真正卸载时回收；effect 重跑时回收会让还挂在 DOM 上的 blob 变死链
  useEffect(() => revokeLocalMediaUrl, [revokeLocalMediaUrl]);

  useEffect(() => {
    if (!localMedia?.type.startsWith('video/')) return;
    const syncVideoVisibility = () => {
      const video = localVideoRef.current;
      if (!video) return;
      void video.play().catch(() => undefined);
    };
    syncVideoVisibility();
    document.addEventListener('visibilitychange', syncVideoVisibility);
    return () => document.removeEventListener('visibilitychange', syncVideoVisibility);
  }, [localMedia?.type]);

  const showGalaxyShader = shaderPreset !== undefined;
  const hasCustomMedia = Boolean(bgStyle.media && (localMedia?.url || bgStyle.media !== LOCAL_BACKGROUND_MEDIA_REF));
  // 着色器清屏透明，让本机图片/视频作为底层背景透出
  const transparentShaderBg = hasCustomMedia;

  useEffect(() => {
    if (!showGalaxyShader) {
      void syncGalaxyHandGestureMode('off');
      return;
    }
    void syncGalaxyHandGestureMode(roomVisualFxLive.current.cameraInteraction);
    return () => {
      void syncGalaxyHandGestureMode('off');
    };
  }, [showGalaxyShader]);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden={effectiveVisualMode !== 'folia' || undefined}>
      {effectiveVisualMode === 'folia' ? <Suspense fallback={null}><FoliaBackground song={song} isPlaying={isPlaying} /></Suspense> : null}
      {localMedia?.type.startsWith('video/') ? (
        <video
          ref={localVideoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={localMedia.url}
          style={{ opacity: bgStyle.opacity }}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        />
      ) : bgStyle.media ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url("${localMedia?.url || bgStyle.media}")`,
            opacity: bgStyle.opacity,
          }}
        />
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: bgStyle.color,
          // 有本机媒体时只铺一层淡色罩，避免把图片/视频盖死
          opacity: hasCustomMedia ? Math.min(0.42, bgStyle.opacity * 0.45) : bgStyle.opacity,
        }}
      />
      {effectiveVisualMode === 'off' && !hasCustomMedia ? <div className="absolute inset-0 bg-[#08090b]" /> : null}
      {showCoverUnderlay ? (
        <div className="absolute inset-0">
          <AmbientCoverLayers coverUrl={coverUrl!} />
        </div>
      ) : null}
      {showShaderBackground ? (
        <Suspense fallback={null}>
          {isTopography ? (
            <TopographyBackground
              coverUrl={coverUrl}
              isPlaying={isPlaying}
              song={song}
              transparentBg={transparentShaderBg}
            />
          ) : (
            <GalaxyBackground
              coverUrl={coverUrl}
              preset={shaderPreset!}
              isPlaying={isPlaying}
              song={song}
              immersivePanelFocus={immersivePanelFocus}
              transparentBg={transparentShaderBg}
            />
          )}
        </Suspense>
      ) : null}
      {isSonicWorkshop ? (
        <Suspense fallback={null}>
          <div
            className="absolute inset-0"
            style={hasCustomMedia ? { opacity: Math.max(0.55, 1 - (1 - bgStyle.opacity) * 0.55) } : undefined}
          >
            <SonicWorkshopBackground isPlaying={isPlaying} song={song} />
          </div>
        </Suspense>
      ) : null}
      {effectiveVisualMode === 'cover-bg' && !coverUrl && !hasCustomMedia ? (
        <div className="absolute inset-0 bg-[#08090b]" />
      ) : null}
    </div>
  );
}
