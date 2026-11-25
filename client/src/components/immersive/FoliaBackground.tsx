import { useEffect, useRef, useState } from 'react';
import { getCoverUrl, getLyrics, getTrackKey, getTranslatedLyricLines, parseLrc } from '../../api/music';
import { serializeLyricTranslations } from '../../lib/immersiveLyricLines';
import { fetchWithTimeout } from '../../api/http';
import { readLocalPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useRoomLyricOffset } from '../../hooks/useRoomLyricOffset';
import { useAudioStore } from '../../stores/audioStore';
import { useRoomStore } from '../../stores/roomStore';
import { canSeekInRoom } from '../../lib/roomPermissions';
import { resolveSignedApiUrl } from '../../lib/signedApiUrl';
import GalaxyBeatMapDriver from '../galaxy/GalaxyBeatMapDriver';
import { getCurrentBeatMap } from '../galaxy/lib/galaxyBeatMap';
import { readGalaxyAudioBands, getTopographyFrequencyBins512, resumeGalaxyAudioContext } from '../galaxy/lib/galaxyAudio';
import { stageLyricPaletteLive, subscribeStageLyricPalette } from '../../lib/stageLyricPaletteLive';
import type { QueueItem } from '../../types';
import { loadFoliaStage, resetFoliaStageLoader } from '../../lib/foliaStageLoader';
import { isHostPageHidden, subscribeHostVisibility } from '../../hooks/useVisualRenderPolicy';
export { preloadFoliaStage } from '../../lib/foliaStageLoader';

type Track = Pick<QueueItem, 'queueId' | 'id' | 'source' | 'name' | 'artist' | 'pic' | 'url' | 'duration' | 'lrc'>;
type StructuredLyricsCacheEntry = {
  lyrics: Record<string, unknown>;
  expiresAt: number;
};
const STRUCTURED_LYRICS_CACHE_MAX = 40;
const STRUCTURED_LYRICS_CACHE_TTL_MS = 10 * 60_000;
const structuredLyricsCache = new Map<string, StructuredLyricsCacheEntry>();
const SILENT_SPECTRUM = new Uint8Array(512);
const SILENT_AUDIO_BANDS = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0, beat: 0, energy: 0, power: 0 };

function readStructuredLyricsCache(cacheKey: string): Record<string, unknown> | null {
  const entry = structuredLyricsCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    structuredLyricsCache.delete(cacheKey);
    return null;
  }
  structuredLyricsCache.delete(cacheKey);
  structuredLyricsCache.set(cacheKey, entry);
  return entry.lyrics;
}

function writeStructuredLyricsCache(cacheKey: string, lyrics: Record<string, unknown>): void {
  if (![lyrics.lyric, lyrics.wordLyric].some((value) => typeof value === 'string' && value.trim())) return;
  structuredLyricsCache.delete(cacheKey);
  structuredLyricsCache.set(cacheKey, { lyrics, expiresAt: Date.now() + STRUCTURED_LYRICS_CACHE_TTL_MS });
  while (structuredLyricsCache.size > STRUCTURED_LYRICS_CACHE_MAX) {
    const oldestKey = structuredLyricsCache.keys().next().value;
    if (oldestKey === undefined) break;
    structuredLyricsCache.delete(oldestKey);
  }
}

export default function FoliaBackground({ song, isPlaying }: { song: Track | null | undefined; isPlaying: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [reload, setReload] = useState(0);
  const [ready, setReady] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(8);
  const [failed, setFailed] = useState(false);
  const [analyzeBeats, setAnalyzeBeats] = useState(false);
  const stageReady = useRef(false);
  const stageMounted = useRef(false);
  const failStage = useRef<(() => void) | null>(null);
  const clearProgressTimerRef = useRef<(() => void) | null>(null);
  const directReceiverRef = useRef<((data: Record<string, unknown>) => void) | null>(null);
  const playbackVersion = useAudioStore((s) => s.playbackVersion);
  const key = song ? getTrackKey(song) : '';
  const lyricOffsetSeconds = useRoomLyricOffset(song);
  const clock = useRef({ isPlaying, key, lyricOffsetSeconds });
  const songRef = useRef(song);
  songRef.current = song;
  clock.current = { isPlaying, key, lyricOffsetSeconds };
  const send = (type: string, data: Record<string, unknown> = {}) => {
    if (directReceiverRef.current) {
      directReceiverRef.current({ type, ...data });
      return;
    }
    window.postMessage({ type, ...data }, location.origin);
  };
  useEffect(() => {
    let disposed = false;
    let unmount: (() => void) | undefined;
    const controller = new AbortController();
    stageReady.current = false;
    stageMounted.current = false;
    directReceiverRef.current = null;
    setLoadingProgress(8);
    let progressTimer: number | null = window.setInterval(() => setLoadingProgress((value) => Math.min(92, value + 3)), 180);
    const clearProgressTimer = () => {
      if (progressTimer !== null) {
        window.clearInterval(progressTimer);
        progressTimer = null;
      }
    };
    clearProgressTimerRef.current = clearProgressTimer;
    const shadow = host.current!.shadowRoot || host.current!.attachShadow({ mode: 'open' });
    delete host.current!.dataset.ready;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      stageReady.current = false;
      stageMounted.current = false;
      directReceiverRef.current = null;
      controller.abort();
      window.clearTimeout(timeout);
      clearProgressTimer();
      if (clearProgressTimerRef.current === clearProgressTimer) clearProgressTimerRef.current = null;
      unmount?.();
      shadow.replaceChildren();
    };
    const fail = () => {
      if (disposed) return;
      dispose();
      setReady(0);
      setAnalyzeBeats(false);
      setFailed(true);
    };
    const timeout = window.setTimeout(() => { if (!stageReady.current) fail(); }, 45000);
    failStage.current = fail;
    void (async () => {
      const resources = await loadFoliaStage();
      if (disposed) return;
      shadow.replaceChildren();
      const styles = Promise.all(resources.css.map(href => new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = `/vendor/folia/${href}`;
        const finish = (error?: Error) => {
          link.onload = null;
          link.onerror = null;
          controller.signal.removeEventListener('abort', abort);
          if (error) { link.remove(); reject(error); }
          else resolve();
        };
        const abort = () => finish(new DOMException('Stage load cancelled', 'AbortError'));
        link.onload = () => finish();
        link.onerror = () => finish(new Error('stage stylesheet unavailable'));
        controller.signal.addEventListener('abort', abort, { once: true });
        shadow.append(link);
      })));
      const [stage] = await Promise.all([
        resources.module,
        styles,
      ]);
      if (disposed) return;
      const container = document.createElement('div');
      container.style.cssText = 'width:100%;height:100%;position:relative';
      shadow.append(container);
      stageMounted.current = true;
      unmount = stage.mountFolia(container, {
        registerReceiver: (receiver) => {
          directReceiverRef.current = receiver;
        },
      });
    })().catch(fail);
    return () => {
      if (failStage.current === fail) failStage.current = null;
      dispose();
    };
  }, [reload]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (!stageMounted.current) return;
      if (event.data?.type === 'openmusic:folia-ready') {
        if (stageReady.current) return;
        stageReady.current = true;
        clearProgressTimerRef.current?.();
        setLoadingProgress(100);
        setReady(value => value + 1);
        setFailed(false);
      }
      if (event.data?.type === 'openmusic:folia-error') {
        failStage.current?.();
      }
      if (event.data?.type === 'openmusic:folia-analysis') setAnalyzeBeats(event.data.enabled === true);
      if (event.data?.type === 'openmusic:folia-seek') {
        const room = useRoomStore.getState();
        const target = event.data.time;
        if (typeof target === 'number' && Number.isFinite(target) && target >= 0 && canSeekInRoom(room.room, room.canControlPlayback)) {
          useAudioStore.getState().seekPlayback?.(target);
        }
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (host.current) host.current.dataset.ready = 'true';
    let cancelled = false;
    const controller = new AbortController();
    const track = songRef.current;
    send('openmusic:folia-song', { song: { key, name: track?.name || '', artist: track?.artist || '', cover: '', duration: (track?.duration || 0) / 1000 } });
    if (track) void resolveSignedApiUrl(getCoverUrl(track, 'full')).then(cover => {
      if (!cancelled) send('openmusic:folia-cover', { key, cover: cover || '' });
    }).catch(() => {});
    if (track) void (async () => {
      const lyricsCacheKey = `${track.source || 'netease'}:${track.id}`;
      const cachedLyrics = readStructuredLyricsCache(lyricsCacheKey);
      if (cachedLyrics) {
        if (!cancelled) send('openmusic:folia-lyrics', { key, lyrics: cachedLyrics });
        return;
      }
      let lyrics: Record<string, unknown> = {};
      try {
        const query = new URLSearchParams({ server: track.source || 'netease', type: 'lrc', id: track.id, format: 'json' });
        const response = await fetchWithTimeout(`/api/meting?${query}`, { signal: controller.signal }, 30000);
        if (!response.ok) throw new Error('lyrics unavailable');
        const payload: unknown = await response.json();
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) lyrics = payload as Record<string, unknown>;
      } catch {
        if (cancelled) return;
      }
      if (cancelled) return;
      if (![lyrics.lyric, lyrics.wordLyric].some(value => typeof value === 'string' && value.trim())) {
        lyrics = { ...lyrics, lyric: await getLyrics(track).catch(() => '') };
      }
      writeStructuredLyricsCache(lyricsCacheKey, lyrics);
      if (!cancelled) send('openmusic:folia-lyrics', { key, lyrics });
      if (cancelled) return;
      const original = parseLrc(typeof lyrics.lyric === 'string' ? lyrics.lyric : '');
      const existing = parseLrc(typeof lyrics.translation === 'string' ? lyrics.translation : '');
      const lines = original.map(line => ({
        ...line,
        translation: line.translation || existing.find(other => Math.abs(other.time - line.time) < 0.051)?.text,
      }));
      const translated = await getTranslatedLyricLines(track, lines);
      if (!cancelled && translated !== lines) {
        const mergedLyrics = { ...lyrics, translation: serializeLyricTranslations(translated) };
        writeStructuredLyricsCache(lyricsCacheKey, mergedLyrics);
        send('openmusic:folia-lyrics', { key, lyrics: mergedLyrics });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [ready, key]);
  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const palette = stageLyricPaletteLive.palette;
      send('openmusic:folia-theme', { theme: { primaryColor: palette.highlight, accentColor: palette.primary, secondaryColor: palette.secondary, backgroundColor: palette.shadow } });
    };
    sync();
    return subscribeStageLyricPalette(sync);
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    const pushClock = (withAudio: boolean, playingNow: boolean) => {
      let audioPayload: {
        bands: { bass: number; lowMid: number; mid: number; vocal: number; treble: number; beat: number; energy: number; power: number };
        spectrum: Uint8Array | null;
      } | null = null;
      if (withAudio) {
        if (playingNow) {
          resumeGalaxyAudioContext();
          const bands = readGalaxyAudioBands(1 / 30);
          audioPayload = {
            bands: { ...bands, lowMid: bands.mid, power: bands.energy },
            spectrum: getTopographyFrequencyBins512(),
          };
        } else {
          audioPayload = {
            bands: SILENT_AUDIO_BANDS,
            spectrum: SILENT_SPECTRUM,
          };
        }
      }
      send('openmusic:folia-clock', {
        key: clock.current.key,
        time: readLocalPlaybackTime(songRef.current),
        playing: playingNow,
        lyricOffsetSeconds: clock.current.lyricOffsetSeconds,
        ...(audioPayload ?? {}),
      });
    };
    if (!isPlaying) {
      if (!isHostPageHidden()) pushClock(true, false);
      return;
    }
    let raf = 0, lastClock = 0, lastAudio = 0;
    let lastMap: ReturnType<typeof getCurrentBeatMap> = null;
    let lastKey = '';
    const tick = (now: number) => {
      raf = 0;
      if (isHostPageHidden()) return;
      raf = requestAnimationFrame(tick);
      if (now - lastClock < 16) return;
      lastClock = now;
      const includeAudio = now - lastAudio >= 33;
      if (includeAudio) {
        lastAudio = now;
      }
      if (lastKey !== clock.current.key) { lastMap = null; lastKey = clock.current.key; }
      const map = songRef.current ? getCurrentBeatMap(songRef.current) : null;
      if (map && map !== lastMap) {
        lastMap = map;
        send('openmusic:folia-beats', { key: clock.current.key, events: map.beats.map(beat => ({
          t: beat.time, kind: beat.combo === 'downbeat' || beat.combo === 'drop' ? 'downbeat' : 'beat',
          impact: beat.impact, tone: { low: beat.low, mid: beat.body, high: beat.snap },
        })) });
      }
      pushClock(includeAudio, clock.current.isPlaying);
    };
    const syncVisibility = () => {
      if (isHostPageHidden()) {
        cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      if (!raf) {
        lastClock = 0;
        lastAudio = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    const unsubscribe = subscribeHostVisibility(syncVisibility);
    syncVisibility();
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [ready, isPlaying, key, lyricOffsetSeconds, playbackVersion]);
  return <div className="pointer-events-auto absolute inset-0 z-10">
    {analyzeBeats && <GalaxyBeatMapDriver song={song} isPlaying={isPlaying} />}
    <div ref={host} data-folia-stage aria-label="Folia 沉浸歌词舞台" className="absolute inset-0" />
    {!ready && !failed && <div role="status" aria-live="polite" className="absolute inset-0 flex items-center justify-center text-white/70">正在加载 Folia 舞台 · {loadingProgress}%</div>}
    {failed && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#12141c] text-white">
      <p>Folia 舞台暂时无法加载</p><button type="button" onClick={() => { resetFoliaStageLoader(); setReady(0); setFailed(false); setReload(value => value + 1); }}>重新加载</button>
    </div>}
  </div>;
}
