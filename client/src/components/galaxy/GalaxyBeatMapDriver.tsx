import { useEffect, useRef } from 'react';
import type { QueueItem } from '../../types';
import { getSharedAudio } from '../../lib/audioElement';
import { isAudioBoundToQueue } from '../../lib/audioTrackBinding';
import { isProxiedMediaUrl, isSameOriginMediaUrl, toProxiedMediaUrl } from '../../lib/mediaProxyUrl';
import {
  bindBeatMapToSong,
  cancelBeatMapAnalysis,
  resetGalaxyBeatMapState,
} from './lib/galaxyBeatMap';
import { resetGalaxyAudioVisualStateForSongChange } from './lib/galaxyAudio';

interface Props {
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'> | null | undefined;
  isPlaying: boolean;
}

function resolveAnalyzableAudioUrl(queueId: string, source: string | undefined): string | null {
  const audio = getSharedAudio();
  if (!isAudioBoundToQueue(audio, queueId)) return null;
  const src = audio.currentSrc || audio.src || '';
  if (!src) return null;
  if (src.startsWith('blob:') || isProxiedMediaUrl(src) || isSameOriginMediaUrl(src)) return src;
  if ((source || 'netease') === 'qishui') return null;
  if (/^https?:\/\//i.test(src)) {
    return toProxiedMediaUrl(src) || null;
  }
  return null;
}

/** 绑定当前曲目并后台分析离线 BeatMap */
export default function GalaxyBeatMapDriver({ song, isPlaying }: Props) {
  const lastQueueIdRef = useRef<string | null>(null);
  const attachedQueueIdRef = useRef<string | null>(null);
  const queueId = song?.queueId ?? null;
  const songId = song?.id ?? null;
  const songSource = song?.source ?? 'netease';

  useEffect(() => {
    if (!queueId || !songId) {
      lastQueueIdRef.current = null;
      attachedQueueIdRef.current = null;
      cancelBeatMapAnalysis();
      resetGalaxyBeatMapState();
      return;
    }

    if (lastQueueIdRef.current !== queueId) {
      lastQueueIdRef.current = queueId;
      attachedQueueIdRef.current = null;
      resetGalaxyAudioVisualStateForSongChange();
      resetGalaxyBeatMapState(true);
    }

    const songRef = { queueId, id: songId, source: songSource };

    const attach = () => {
      if (attachedQueueIdRef.current === queueId && isPlaying) return;
      const audioUrl = resolveAnalyzableAudioUrl(queueId, songSource);
      if (audioUrl && isPlaying) {
        attachedQueueIdRef.current = queueId;
      }
      bindBeatMapToSong(songRef, audioUrl, isPlaying);
    };

    attach();

    const audio = getSharedAudio();
    const onAudioReady = () => {
      if (!isPlaying) return;
      attach();
    };
    audio.addEventListener('loadeddata', onAudioReady);
    audio.addEventListener('canplay', onAudioReady);
    audio.addEventListener('playing', onAudioReady);

    return () => {
      audio.removeEventListener('loadeddata', onAudioReady);
      audio.removeEventListener('canplay', onAudioReady);
      audio.removeEventListener('playing', onAudioReady);
    };
  }, [queueId, songId, songSource, isPlaying]);

  useEffect(() => () => cancelBeatMapAnalysis(), []);

  return null;
}
