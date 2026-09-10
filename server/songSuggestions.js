const SOURCE_PRIORITY = ['netease', 'tencent', 'kugou', 'qishui'];
const ALLOWED_SOURCES = new Set(SOURCE_PRIORITY);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function rawArtist(raw) {
  const value = raw?.artist ?? raw?.author ?? raw?.singer ?? raw?.singername ?? raw?.artists;
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === 'object' ? item?.name || item?.title || '' : item).filter(Boolean).join(' / ');
  }
  return String(value || '').trim();
}

function rawId(raw) {
  return String(raw?.id ?? raw?.songid ?? raw?.songId ?? raw?.mid ?? raw?.hash ?? '').trim();
}

export function normalizeSuggestionSong(raw, source) {
  if (!raw || typeof raw !== 'object' || !ALLOWED_SOURCES.has(source)) return null;
  const id = rawId(raw);
  const name = String(raw.name ?? raw.title ?? raw.songname ?? '').trim();
  const artist = rawArtist(raw) || '未知歌手';
  if (!id || !name) return null;
  return {
    id,
    source,
    name,
    artist,
    album: String(raw.album ?? raw.album_name ?? raw.albumname ?? '').trim(),
    pic: String(raw.pic ?? raw.picture ?? raw.cover ?? raw.album_pic ?? '').trim(),
  };
}

function suggestionKey(song) {
  return `${normalizeText(song.name)}|${normalizeText(song.artist)}`;
}

function relevanceScore(song, keyword) {
  const query = normalizeText(keyword);
  const name = normalizeText(song.name);
  const artist = normalizeText(song.artist);
  let score = 0;
  if (name === query) score += 1200;
  else if (name.startsWith(query)) score += 1000;
  else if (name.includes(query)) score += 800;
  if (artist === query) score += 700;
  else if (artist.includes(query)) score += 500;
  return score;
}

export function aggregateSongSuggestions(groups, keyword, limit = 8) {
  const merged = new Map();
  for (const source of SOURCE_PRIORITY) {
    const songs = Array.isArray(groups?.[source]) ? groups[source] : [];
    songs.forEach((raw, index) => {
      const song = raw?.source ? raw : normalizeSuggestionSong(raw, source);
      if (!song) return;
      const key = suggestionKey(song);
      const existing = merged.get(key);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        existing.candidates.push({ id: song.id, source });
        if (!existing.pic && song.pic) existing.pic = song.pic;
        if (!existing.album && song.album) existing.album = song.album;
        return;
      }
      merged.set(key, {
        id: song.id,
        source,
        sources: [source],
        candidates: [{ id: song.id, source }],
        name: song.name,
        artist: song.artist,
        album: song.album,
        pic: song.pic,
        providerRank: index,
      });
    });
  }
  return [...merged.values()]
    .map((item, index) => ({
      ...item,
      score: relevanceScore(item, keyword) + (item.sources.length - 1) * 80 - item.providerRank * 2,
      index,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 8)))
    .map(({ score, index, providerRank, ...item }) => item);
}

export async function fetchSongSuggestions(keyword, sources, fetchProvider) {
  const query = String(keyword || '').trim();
  if (!query) return [];
  const selected = (Array.isArray(sources) ? sources : SOURCE_PRIORITY)
    .filter((source, index, list) => ALLOWED_SOURCES.has(source) && list.indexOf(source) === index);
  const settled = await Promise.allSettled(selected.map(async (source) => [
    source,
    await fetchProvider(source, query),
  ]));
  const groups = {};
  settled.forEach((result) => {
    if (result.status === 'fulfilled') groups[result.value[0]] = result.value[1];
  });
  return aggregateSongSuggestions(groups, query);
}

export { ALLOWED_SOURCES, SOURCE_PRIORITY };
