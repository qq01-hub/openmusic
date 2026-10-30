const SOURCES = new Set(['netease', 'tencent', 'qq', 'kugou', 'kuwo', 'migu', 'bilibili', 'qishui']);
const OPERATIONS = new Set(['url', 'lrc', 'song', 'search', 'playlist', 'search_playlist', 'fm', 'source', 'media']);
const OUTCOMES = new Set(['ok', 'empty', 'failed', 'substituted', 'aborted']);
const sourceName = value => SOURCES.has(value) ? value : '';
const songId = value => (typeof value === 'string' || Number.isSafeInteger(value)) && /^[A-Za-z0-9_-]{1,128}$/u.test(String(value)) ? String(value) : '';
const text = value => typeof value === 'string' ? value.slice(0, 256).replace(/[\x00-\x1f\x7f]/gu, '').replace(/https?:\/\/\S+/giu, '[地址已隐藏]').slice(0, 96) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function songSummary(value, source) {
  if (!object(value)) return null;
  const id = songId(value.id ?? value.songId ?? value.hash);
  if (!id) return null;
  const artist = value.artist ?? value.artists ?? value.ar ?? value.singer;
  return { id, source: sourceName(value.source) || sourceName(source), name: text(value.name ?? value.title),
    artist: Array.isArray(artist) ? artist.slice(0, 3).map(item => text(object(item) ? item.name : item)).filter(Boolean).join(' / ').slice(0, 96) : text(artist) };
}

export function musicRequestContext(path, query = {}) {
  let operation = path === '/api/meting' ? query.type : '';
  let source = sourceName(query.server);
  if (path === '/api/music/kugou/search' || path === '/api/music/kugou/song') { operation = path.endsWith('/song') ? 'song' : 'search'; source = 'kugou'; }
  if (path === '/api/music/hot') operation = 'fm';
  if (path === '/api/music/suggestions') operation = 'search';
  if (path === '/api/music/toplist/netease') { operation = 'fm'; source = 'netease'; }
  if (path === '/api/music/netease/playlists/search') { operation = 'search_playlist'; source = 'netease'; }
  if (path === '/api/music/playlist/import') operation = 'playlist';
  if (path === '/api/qishui-source') { operation = 'source'; source = 'qishui'; }
  if (path === '/api/media-proxy') operation = 'media';
  if (!OPERATIONS.has(operation)) return null;
  return { operation, source, requestedSongId: ['song', 'url', 'lrc'].includes(operation) ? songId(query.id) : '' };
}

export function summarizeMusicResponse(context, body, { status = 0, durationMs = 0, substituted = false, aborted = false } = {}) {
  let payload = body;
  // 仅展开已知容器两层，不递归遍历歌词、URL、任意响应字段或整个歌单
  for (let depth = 0; depth < 2 && object(payload); depth++) {
    const nested = payload.songs ?? payload.tracks ?? payload.data
      ?? (context.operation === 'search_playlist' ? payload.playlists : context.operation === 'search' ? payload.suggestions : undefined);
    if (!Array.isArray(nested) && !object(nested)) break;
    payload = nested;
  }
  let songs = [];
  let resultCount;
  if (['search', 'playlist', 'search_playlist', 'song', 'fm', 'url', 'lrc', 'source'].includes(context.operation)) {
    const list = Array.isArray(payload) ? payload : object(payload) ? [payload] : [];
    if (['search', 'playlist', 'search_playlist', 'song', 'fm'].includes(context.operation)) resultCount = list.length;
    if (context.operation !== 'search_playlist') songs = list.slice(0, 3).map(value => songSummary(value, context.source)).filter(Boolean);
  }
  const empty = Array.isArray(payload) && payload.length === 0 || typeof payload === 'string' && !payload.trim()
    || object(payload) && (context.operation === 'url' && Object.hasOwn(payload, 'url') && !payload.url
      || context.operation === 'lrc' && (Object.hasOwn(payload, 'lrc') && !payload.lrc || Object.hasOwn(payload, 'lyric') && !payload.lyric && !payload.wordLyric));
  const failed = status >= 400 || status < 200 || object(body) && (Boolean(body.error) || body.success === false);
  return { operation: context.operation, source: sourceName(context.source), requestedSongId: songId(context.requestedSongId),
    status, durationMs: Math.min(86400000, Math.max(0, Math.round(Number(durationMs) || 0))),
    outcome: aborted ? 'aborted' : failed ? 'failed' : substituted ? 'substituted' : empty ? 'empty' : 'ok',
    ...(resultCount === undefined ? {} : { resultCount }), songs: failed || aborted ? [] : songs };
}

export function normalizeMusicResponseEvent(input) {
  if (!input || !/^[a-f0-9]{32}$/u.test(input.requestId || '') || !OPERATIONS.has(input.operation)
    || !OUTCOMES.has(input.outcome) || !Number.isSafeInteger(input.at) || !Number.isInteger(input.status) || input.status < 0 || input.status > 599) return null;
  return { requestId: input.requestId, at: input.at, operation: input.operation, source: sourceName(input.source), requestedSongId: songId(input.requestedSongId),
    status: input.status, outcome: input.outcome, durationMs: Math.min(86400000, Math.max(0, Math.round(Number(input.durationMs) || 0))),
    ...(Number.isSafeInteger(input.resultCount) && input.resultCount >= 0 ? { resultCount: Math.min(1000000, input.resultCount) } : {}),
    songs: ['ok', 'substituted'].includes(input.outcome) && Array.isArray(input.songs) ? input.songs.slice(0, 3).map(value => songSummary(value, input.source)).filter(Boolean) : [] };
}

export function summarizeMusicSamples(samples) {
  const targets = new Map();
  let targetedResponses = 0;
  for (const sample of samples.slice(0, 200)) {
    if (sample.outcome !== 'ok' || !['url', 'lrc', 'song'].includes(sample.operation)) continue;
    const returned = sample.songs?.[0];
    const id = returned?.id || sample.requestedSongId;
    const source = returned?.source || sample.source;
    if (!id || !source) continue;
    targetedResponses++;
    const key = `${source}:${id}`;
    const previous = targets.get(key) || { id, source, name: '', artist: '', requests: 0 };
    if (returned?.name) { previous.name = returned.name; previous.artist = returned.artist; }
    previous.requests++;
    targets.set(key, previous);
  }
  return { sampleCount: Math.min(200, samples.length), targetedResponses, distinctSongs: targets.size,
    topSongs: [...targets.values()].sort((a, b) => b.requests - a.requests).slice(0, 5) };
}
