import { useRoomStore } from '../stores/roomStore';
import type { Song } from '../types';

export function useRoomLyricOffset(song: Pick<Song, 'id' | 'source'> | null | undefined): number {
  return useRoomStore(s => {
    const current = s.room?.current;
    if (!song || !current || current.id !== song.id || (current.source || 'netease') !== (song.source || 'netease')) return 0;
    const offset = s.room?.lyricOffsetSeconds;
    return typeof offset === 'number' && Number.isFinite(offset) && Math.abs(offset) <= 30 ? offset : 0;
  });
}
