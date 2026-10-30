import { songKey } from '../api/music/merge';
import type { Song } from '../types';

type SongRef = Pick<Song, 'source' | 'id'>;

const indexes = new WeakMap<readonly SongRef[], Set<string>>();
const EMPTY_KEYS = new Set<string>();

/** 按不可变数组引用共享索引，旧快照释放后由 WeakMap 自动回收 */
export function getSongKeyIndex(songs: readonly SongRef[] | undefined): Set<string> {
  if (!songs?.length) return EMPTY_KEYS;
  let keys = indexes.get(songs);
  if (!keys) {
    keys = new Set(songs.map(songKey));
    indexes.set(songs, keys);
  }
  return keys;
}
