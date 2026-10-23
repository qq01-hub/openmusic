export function normalizeArtistFilterKeywords(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('歌手过滤最多支持 100 个关键词，请以列表提交');
  }
  const keywords = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 80 || /[\u0000-\u001f\u007f]/u.test(item)) {
      throw new Error('歌手过滤关键词必须是最多 80 个字符的文本，不能包含控制字符');
    }
    const keyword = item.trim();
    const key = keyword.normalize('NFKC').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

function artistText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(artistText).join(' / ');
  if (value && typeof value === 'object') return artistText(value.name);
  return '';
}

export function isSongArtistBlocked(song, keywords = []) {
  if (!song || typeof song !== 'object' || !keywords.length) return false;
  const artist = [song.artist, song.author, song.artists, song.ar, song.singer,
    song.singers, song.singername, song.singerName, song.singer_name,
    song.artistName, song.artistname, song.artist_name]
    .map(artistText).filter(Boolean).join(' / ').normalize('NFKC').toLowerCase();
  return keywords.some((keyword) => {
    const text = String(keyword || '').trim().normalize('NFKC').toLowerCase();
    return Boolean(text) && artist.includes(text);
  });
}

export function filterSongPayloadByArtist(payload, keywords = [], onFiltered = null) {
  if (!keywords.length || !payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((song) => filterSongPayloadByArtist(song, keywords, onFiltered))
      .filter((song) => song !== null);
  }
  const result = { ...payload };
  const collectionKeys = ['songs', 'tracks', 'list', 'data', 'result']
    .filter((key) => result[key] && typeof result[key] === 'object');
  if (!collectionKeys.length && isSongArtistBlocked(payload, keywords)) {
    onFiltered?.();
    return null;
  }
  for (const key of collectionKeys) {
    result[key] = filterSongPayloadByArtist(result[key], keywords, onFiltered);
  }
  return result;
}
