import { fetchMetingApi } from './metingUpstream.js';
import { normalizeSuggestionSong } from './songSuggestions.js';

export const MAX_ARTIST_SHUFFLE_SONGS = 2000;
const SOURCES = new Set(['netease', 'tencent', 'kugou', 'qishui']);
const artistKey = (value) => String(value || '').normalize('NFKC').trim().toLowerCase();
const songKey = (song) => `${song.source}:${song.id}`;

export function normalizeArtistShuffleOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.artist !== 'string' || !value.artist.trim() || value.artist.length > 80
    || /[\u0000-\u001f\u007f]/u.test(value.artist) || !SOURCES.has(value.source)
    || (value.includeCollaborations !== undefined && typeof value.includeCollaborations !== 'boolean')) {
    return null;
  }
  return { artist: value.artist.trim(), source: value.source, includeCollaborations: value.includeCollaborations === true };
}

export function matchesShuffleArtist(song, options) {
  if (!options) return false;
  const target = artistKey(options.artist);
  const credit = artistKey(song?.artist);
  if (!target || !credit) return false;
  if (credit === target) return true;
  return options.includeCollaborations === true
    && credit.split(/\s*(?:[/、,，;&＆]|\bfeat\.?\s+|\bft\.?\s+|\bfeaturing\s+)\s*/iu).includes(target);
}

export function normalizeArtistShuffleSongs(value, source) {
  if (!Array.isArray(value) || !SOURCES.has(source)) return [];
  const songs = new Map();
  for (const raw of value.slice(0, MAX_ARTIST_SHUFFLE_SONGS)) {
    if (!raw || typeof raw !== 'object') continue;
    let id = raw.id ?? raw.songid ?? raw.songId ?? raw.mid ?? raw.hash;
    if (!String(id ?? '').trim()) {
      try {
        id = new URL(String(raw.url || ''), 'https://openmusic.invalid').searchParams.get('id');
      } catch {
        continue;
      }
    }
    const song = normalizeSuggestionSong({ ...raw, id }, source);
    if (song) songs.set(songKey(song), song);
  }
  return [...songs.values()];
}

/** 复用音乐搜索的分页协议，重复页终止，超大结果拒绝而不静默截断 */
export async function fetchArtistShuffleSongs(options, fetchProvider = fetchMetingApi) {
  const songs = new Map();
  const seenPages = new Set();
  const deadline = Date.now() + 40_000;
  let offset = 0;
  while (offset < MAX_ARTIST_SHUFFLE_SONGS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('ARTIST_LOOKUP_TIMEOUT');
    const response = await fetchProvider({ server: options.source, type: 'search', id: options.artist, limit: 100, offset }, {}, Math.min(10_000, remaining));
    if (!response.ok) throw new Error('ARTIST_LOOKUP_FAILED');
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('ARTIST_LOOKUP_FAILED');
    const page = response.headers?.get('x-openmusic-upstream-page') || '';
    if (page && seenPages.has(page)) break;
    if (page) seenPages.add(page);
    let added = 0;
    for (const song of normalizeArtistShuffleSongs(payload, options.source)) {
      if (songs.has(songKey(song))) continue;
      songs.set(songKey(song), song);
      added++;
    }
    const count = Number(response.headers?.get('x-openmusic-upstream-count')) || payload.length;
    const consumed = Math.max(payload.length, count);
    if (consumed < 100 || (payload.length > 0 && added === 0)) break;
    offset += consumed;
    if (offset >= MAX_ARTIST_SHUFFLE_SONGS) throw new Error('ARTIST_CATALOG_TOO_LARGE');
  }
  return [...songs.values()].filter((song) => matchesShuffleArtist(song, { ...options, includeCollaborations: true }));
}

/** 已播放歌曲权重为未播放的十分之一，全部播过后开始新一轮 */
export function selectArtistShuffleSong(songs, options, currentSong, playedKeys = new Set(), random = Math.random) {
  const usable = songs.filter((song) => matchesShuffleArtist(song, options));
  if (!usable.length) return null;
  const currentKey = currentSong ? songKey(currentSong) : '';
  if (usable.every((song) => playedKeys.has(songKey(song)) || songKey(song) === currentKey)) {
    for (const song of usable) playedKeys.delete(songKey(song));
  }
  const otherSongs = usable.filter((song) => songKey(song) !== currentKey);
  const pool = otherSongs.length ? otherSongs : usable;
  const weight = (song) => playedKeys.has(songKey(song)) ? 0.1 : 1;
  let cursor = random() * pool.reduce((sum, song) => sum + weight(song), 0);
  for (const song of pool) {
    cursor -= weight(song);
    if (cursor < 0) return song;
  }
  return pool[pool.length - 1];
}
