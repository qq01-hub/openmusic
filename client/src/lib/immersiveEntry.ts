import { getCoverUrl } from '../api/music';
import { resolveSignedApiUrl } from './signedApiUrl';
import { cacheCoverImage, getCachedCoverImage } from './coverImageCache';
import { loadSharedCoverResource } from './sharedCoverResource';
import type { QueueItem } from '../types';
import type { RoomVisualMode } from './roomVisualPreset';
import {
  isTrustedMediaDurationSeconds,
  resolveAutoSkipThresholdSeconds,
  resolveDisplayDurationSeconds,
  resolveReferenceDurationSeconds,
  resolveTrackDurationSeconds,
} from '../hooks/useTrackDuration';
import { getSharedAudio } from './audioElement';
import { isAudioBoundToQueue } from './audioTrackBinding';
import { waitForAudioMinimumReady } from './audioReady';
import { isProxiedMediaUrl, isSameOriginMediaUrl, toProxiedMediaUrl } from './mediaProxyUrl';
import { flushPendingPlaybackSnapshot } from './playbackSchedule';
import { applyFollowerSync } from './playbackSync';
import { getClientPlaybackState, getPlaybackTime } from './playbackState';
import { invalidateTrackUrlCache, resolveSongUrl } from './songPreloadCache';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { ensureGalaxyAudioOutput } from '../components/galaxy/lib/galaxyAudio';

const TRACK_READY_POLL_MS = 50;
const TRACK_READY_TIMEOUT_MS = 20000;

async function preloadImage(url: string): Promise<void> {
  if (!url) return;
  const proxied = toProxiedMediaUrl(url);
  if (getCachedCoverImage(proxied)) return;
  try {
    const signed = (await resolveSignedApiUrl(proxied)) || proxied;
    const sharedUrl = await loadSharedCoverResource(signed);
    if (!sharedUrl) return;
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        cacheCoverImage(proxied, img);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = sharedUrl;
    });
  } catch {
    // 封面预加载失败不阻断沉浸进入，由 GalaxyParticles 内部继续回退
  }
}

export { preloadImage };

export function preloadGalaxyBackground(): Promise<unknown> {
  return import('../components/galaxy/GalaxyBackground3D');
}

export function preloadSonicWorkshopBackground(): Promise<unknown> {
  return import('../components/topography/SonicWorkshopBackground');
}

export function preloadImmersiveBackground(mode: RoomVisualMode): Promise<unknown> {
  const shellPromise = import('../components/immersive/RoomImmersiveShell');
  const settingsPromise = import('../components/immersive/ImmersiveFxSettingsPanel');
  const stagePromise = mode === 'folia'
    ? import('../components/immersive/FoliaBackground').then(module => module.preloadFoliaStage())
    : mode === 'topography'
      ? import('../components/topography/TopographyBackground3D')
      : mode === 'topography-we'
        ? preloadSonicWorkshopBackground()
        : preloadGalaxyBackground();
  return Promise.all([stagePromise, shellPromise, settingsPromise]);
}

async function waitForCurrentTrackProxyReady(
  timeoutMs = TRACK_READY_TIMEOUT_MS,
): Promise<QueueItem | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const song = useRoomStore.getState().room?.current;
    if (!song) return null;
    const audio = getSharedAudio();
    const loading = useAudioStore.getState().trackLoading;
    const src = audio.currentSrc || audio.src || '';
    const bound = isAudioBoundToQueue(audio, song.queueId);
    const proxied = Boolean(src && (
      isProxiedMediaUrl(src) || isSameOriginMediaUrl(src)
      || (song.source === 'qishui' && src.startsWith('blob:'))
    ));

    if (!loading && bound && proxied && audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return song;
    }

    await new Promise((resolve) => window.setTimeout(resolve, TRACK_READY_POLL_MS));
  }

  console.warn('沉浸模式音频代理等待超时，将继续加载视觉舞台');
  return null;
}

/** 曲目 load 完成（进入/退出过渡通用） */
export async function waitForCurrentTrackReady(
  song: QueueItem,
  timeoutMs = TRACK_READY_TIMEOUT_MS,
): Promise<void> {
  const audio = getSharedAudio();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const loading = useAudioStore.getState().trackLoading;
    const src = audio.currentSrc || audio.src || '';
    const bound = isAudioBoundToQueue(audio, song.queueId);

    if (!loading && bound && src && audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, TRACK_READY_POLL_MS));
  }

  throw new Error('immersive track ready timeout');
}

function capSeekTime(time: number, song: QueueItem, mediaDur: number): number {
  const audioStore = useAudioStore.getState();
  const sources = {
    lrcDurationMs: audioStore.lrcDurationMs,
    lrcTrackKey: audioStore.lrcTrackKey,
    mediaDurationMs: audioStore.mediaDurationMs,
    mediaTrackKey: audioStore.mediaTrackKey,
  };
  const referenceDur = resolveReferenceDurationSeconds(song, sources);
  const fileDur = isTrustedMediaDurationSeconds(mediaDur, referenceDur) ? mediaDur : 0;
  const trackDur = resolveTrackDurationSeconds(song, sources);
  const displayDur = resolveDisplayDurationSeconds(song, sources);
  const capBase = fileDur || trackDur || resolveAutoSkipThresholdSeconds(song, sources, fileDur) || displayDur;
  const cap = capBase > 0 ? capBase - 0.05 : time;
  return Math.max(0, Math.min(time, cap));
}

/** 代理音源就绪后，将播放进度对齐到房间当前进度 */
async function syncRoomPlaybackAfterProxyReload(song: QueueItem): Promise<void> {
  const audio = getSharedAudio();
  if (!audio.src || !isAudioBoundToQueue(audio, song.queueId)) return;

  flushPendingPlaybackSnapshot();

  const liveRoom = useRoomStore.getState().room;
  if (!liveRoom?.current || liveRoom.current.queueId !== song.queueId) return;

  const playbackState = getClientPlaybackState();
  let targetTime = Math.max(0, Number(liveRoom.currentTime) || 0);
  if (playbackState?.trackId === song.queueId) {
    targetTime = getPlaybackTime(playbackState);
  }

  await applyFollowerSync(audio, {
    song,
    capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
    forceTime: targetTime,
  });
}

export interface PrepareImmersiveEnterOptions {
  song: QueueItem | null;
  needsProxyReload: boolean;
  mode?: RoomVisualMode;
}

/** 代理音源切换与播放对齐（进入沉浸专用） */
export async function reloadImmersiveTrackProxy(song: QueueItem): Promise<void> {
  const liveSong = useRoomStore.getState().room?.current;
  if (!liveSong) return;
  song = liveSong;
  // 汽水只用本地解密 blob:，沉浸模式直接接 Web Audio，禁止触发代理重载
  if ((song.source || '') === 'qishui') {
    await waitForCurrentTrackProxyReady();
    ensureGalaxyAudioOutput();
    return;
  }
  invalidateTrackUrlCache(song);
  useAudioStore.getState().requestTrackReload();
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
  try {
    await resolveSongUrl(song, { refresh: true });
  } catch (error) {
    console.warn('沉浸模式音频预加载失败，将由播放器继续恢复', error);
    return;
  }
  const readySong = await waitForCurrentTrackProxyReady();
  if (!readySong) return;
  await waitForAudioMinimumReady(getSharedAudio());
  await syncRoomPlaybackAfterProxyReload(readySong);
  ensureGalaxyAudioOutput();
}

/** 进入沉浸模式前预加载 Galaxy chunk、封面与（如需）代理音源 */
export async function prepareImmersiveEnter(options: PrepareImmersiveEnterOptions): Promise<void> {
  const { song, needsProxyReload, mode = 'emily' } = options;
  const coverUrl = song ? getCoverUrl(song, 'medium') : null;

  const tasks: Promise<unknown>[] = [preloadImmersiveBackground(mode)];

  if (coverUrl) {
    tasks.push(resolveSignedApiUrl(coverUrl).then((signed) => preloadImage(signed || coverUrl)));
  }

  if (needsProxyReload && song) {
    tasks.push(reloadImmersiveTrackProxy(song));
  }

  await Promise.all(tasks);
  ensureGalaxyAudioOutput();
}
