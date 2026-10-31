import { useEffect, useState } from 'react';
import { getLyrics, parseLrc, getLrcFallbackDurationMs, getTrackKey } from '../api/music';
import { useAudioStore } from '../stores/audioStore';
import type { LyricLine, Song } from '../types';

export function useTrackLyrics(song: (Pick<Song, 'id' | 'source' | 'name' | 'lrc' | 'duration'> & Partial<Pick<Song, 'artist' | 'album'>> & { queueId?: string }) | null | undefined) {
  const setLrcDuration = useAudioStore((s) => s.setLrcDuration);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);

  useEffect(() => {
    if (!song) {
      setLyrics([]);
      return;
    }

    let cancelled = false;
    const trackKey = getTrackKey(song);
    setLyrics([]);
    getLyrics({
      id: song.id,
      source: song.source || 'netease',
      name: song.name,
      artist: song.artist,
      lrc: song.lrc,
    })
      .then((lrc) => {
        if (cancelled) return;
        const lines = parseLrc(lrc);
        setLyrics(lines);
        if (!song.duration) {
          const ms = getLrcFallbackDurationMs(lrc);
          if (ms) setLrcDuration(trackKey, ms);
        }
      })
      .catch(() => {
        if (!cancelled) setLyrics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [song?.id, song?.source, song?.queueId, song?.name, song?.lrc, song?.duration, setLrcDuration]);

  return lyrics;
}
