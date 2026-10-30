import type { RoomState, SearchResult, Song } from '../types';
import { isSongInRoomQueue } from './roomSongStatus';

function toSongPayload(song: SearchResult): Song {
  return {
    id: song.id,
    source: song.source,
    name: song.name,
    artist: song.artist,
    album: song.album,
    pic: song.pic,
    duration: song.duration,
    url: song.url,
    lrc: song.lrc,
  };
}

export interface BulkAddResult {
  added: number;
  skipped: number;
  failed: number;
}

export async function addSongsToQueue(
  songs: SearchResult[],
  options: {
    getRoom: () => RoomState | null;
    addSong: (song: Song) => Promise<{ success: boolean; error?: string }>;
    addSongs?: (songs: Song[]) => Promise<{ success: boolean; added?: number; skipped?: number; failed?: number }>;
  },
): Promise<BulkAddResult> {
  let added = 0;
  let skipped = 0;
  let failed = 0;

  if (options.addSongs) {
    const pending = songs.filter(song => {
      const room = options.getRoom();
      if (room && isSongInRoomQueue(room, song)) { skipped++; return false; }
      return true;
    });
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100);
      const result = await options.addSongs(batch.map(toSongPayload));
      added += result.added || 0;
      skipped += result.skipped || 0;
      failed += result.failed ?? (result.success ? 0 : batch.length);
      if (!result.success) { failed += pending.length - offset - batch.length; break; }
    }
    return { added, skipped, failed };
  }

  for (const song of songs) {
    const room = options.getRoom();
    if (room && isSongInRoomQueue(room, song)) {
      skipped += 1;
      continue;
    }

    const res = await options.addSong(toSongPayload(song));
    if (res.success) {
      added += 1;
    } else if (res.error?.includes('已经在歌单')) {
      skipped += 1;
    } else {
      failed += 1;
    }
  }

  return { added, skipped, failed };
}

export function formatBulkAddToast(result: BulkAddResult): { message: string; type: 'success' | 'error' } {
  if (result.added > 0) {
    const parts = [`已添加 ${result.added} 首`];
    if (result.skipped > 0) parts.push(`${result.skipped} 首已在队列`);
    if (result.failed > 0) parts.push(`${result.failed} 首失败`);
    return { message: parts.join('，'), type: 'success' };
  }
  if (result.skipped > 0) {
    return { message: '本页歌曲均已在播放队列中', type: 'error' };
  }
  return { message: '点歌失败，请稍后重试', type: 'error' };
}
