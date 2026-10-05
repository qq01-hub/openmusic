export const SONG_RESULT_PAGE_SIZE_OPTIONS = [6, 20, 50, 100] as const;
export type SongResultPageSize = (typeof SONG_RESULT_PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_SONG_RESULT_PAGE_SIZE: SongResultPageSize = 20;
const STORAGE_KEY = 'openmusic:song-result-page-size';

export function getStoredSongResultPageSize(): SongResultPageSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = Number(raw);
    if (SONG_RESULT_PAGE_SIZE_OPTIONS.includes(value as SongResultPageSize)) {
      return value as SongResultPageSize;
    }
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_SONG_RESULT_PAGE_SIZE;
}

export function setStoredSongResultPageSize(size: SongResultPageSize) {
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // ignore
  }
}
