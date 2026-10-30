import { useEffect, useRef, useState } from 'react';
import { getCoverUrl, getLyrics, getTrackKey } from '../../api/music';
import { fetchWithTimeout } from '../../api/http';
import { readLocalPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
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
export { preloadFoliaStage } from '../../lib/foliaStageLoader';

type Track = Pick<QueueItem, 'queueId' | 'id' | 'source' | 'name' | 'artist' | 'pic' | 'url' | 'duration' | 'lrc'>;
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
  const key = song ? getTrackKey(song) : '';
  const clock = useRef({ isPlaying, key });
  const songRef = useRef(song);
  songRef.current = song;
  clock.current = { isPlaying, key };
  const send = (type: string, data: Record<string, unknown> = {}) => window.postMessage({ type, ...data }, location.origin);
  useEffect(() => {
    let disposed = false;
    let unmount: (() => void) | undefined;
    const controller = new AbortController();
    stageReady.current = false;
    stageMounted.current = false;
    setLoadingProgress(8);
    const progressTimer = window.setInterval(() => setLoadingProgress((value) => Math.min(92, value + 3)), 180);
    const shadow = host.current!.shadowRoot || host.current!.attachShadow({ mode: 'open' });
    delete host.current!.dataset.ready;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      stageReady.current = false;
      stageMounted.current = false;
      controller.abort();
      window.clearTimeout(timeout);
      window.clearInterval(progressTimer);
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
      unmount = stage.mountFolia(container);
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
      if (!cancelled) send('openmusic:folia-lyrics', { key, lyrics });
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
    let raf = 0, last = 0;
    let lastMap: ReturnType<typeof getCurrentBeatMap> = null;
    let lastKey = '';
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - last < 33) return;
      last = now;
      if (clock.current.isPlaying) resumeGalaxyAudioContext();
      const bands = readGalaxyAudioBands(1 / 30);
      if (lastKey !== clock.current.key) { lastMap = null; lastKey = clock.current.key; }
      const map = songRef.current ? getCurrentBeatMap(songRef.current) : null;
      if (map && map !== lastMap) {
        lastMap = map;
        send('openmusic:folia-beats', { key: clock.current.key, events: map.beats.map(beat => ({
          t: beat.time, kind: beat.combo === 'downbeat' || beat.combo === 'drop' ? 'downbeat' : 'beat',
          impact: beat.impact, tone: { low: beat.low, mid: beat.body, high: beat.snap },
        })) });
      }
      send('openmusic:folia-clock', { key: clock.current.key, time: readLocalPlaybackTime(songRef.current), playing: clock.current.isPlaying,
        bands: { ...bands, lowMid: bands.mid, power: bands.energy }, spectrum: getTopographyFrequencyBins512() });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);
  return <div className="pointer-events-auto absolute inset-0 z-10">
    {analyzeBeats && <GalaxyBeatMapDriver song={song} isPlaying={isPlaying} />}
    <div ref={host} data-folia-stage aria-label="Folia 沉浸歌词舞台" className="absolute inset-0" />
    {!ready && !failed && <div role="status" aria-live="polite" className="absolute inset-0 flex items-center justify-center text-white/70">正在加载 Folia 舞台 · {loadingProgress}%</div>}
    {failed && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#12141c] text-white">
      <p>Folia 舞台暂时无法加载</p><button type="button" onClick={() => { resetFoliaStageLoader(); setReady(0); setFailed(false); setReload(value => value + 1); }}>重新加载</button>
    </div>}
  </div>;
}
