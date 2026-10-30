import type { FavoriteSong } from '../types';

export type FavoriteDuplicateMode = 'none' | 'name' | 'nameArtist';

export function filterCrossPlatformDuplicates(songs: FavoriteSong[], mode: FavoriteDuplicateMode): FavoriteSong[] {
  if (mode === 'none') return songs;
  const keyFor = (song: FavoriteSong) => {
    const name = song.name.trim().toLowerCase();
    const artist = song.artist.trim().toLowerCase();
    if (!name || (mode === 'nameArtist' && !artist)) return '';
    return mode === 'name' ? name : JSON.stringify([name, artist]);
  };
  const groups = new Map<string, { songs: FavoriteSong[]; sources: Set<string> }>();
  for (const song of songs) {
    const key = keyFor(song);
    if (!key) continue;
    const group = groups.get(key) || { songs: [], sources: new Set<string>() };
    group.songs.push(song);
    group.sources.add(song.source);
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.sources.size > 1).flatMap(group => group.songs);
}
