import { fetchMetingApi, runWithMetingRequestContext } from './metingUpstream.js';

export function normalizeNeteasePlaylistSearchItems(data) {
  const playlists = Array.isArray(data) ? data : [];
  return playlists.map((item) => ({
    id: String(item.id || ''),
    name: String(item.name || item.title || '未命名歌单'),
    coverImgUrl: String(item.cover || item.coverImgUrl || item.pic || ''),
    creatorName: String(item.creator?.nickname || item.creator?.name || item.user?.nickname || ''),
    trackCount: Number(item.trackCount || item.track_count || item.song_count || 0),
    playCount: Number(item.playCount || item.playcount || 0),
  })).filter((item) => item.id);
}

export async function searchNeteasePlaylists({
  identity,
  presence,
  keyword,
  page,
  limit,
  fetchApi = fetchMetingApi,
  withContext = runWithMetingRequestContext,
}) {
  const response = await withContext(
    {
      userId: identity.userId,
      userNickname: presence?.userNickname || '',
      roomId: presence?.roomId || '',
      roomName: presence?.roomName || '',
      // 歌单搜索没有具体歌曲，不能引用歌曲查询变量。
      songId: '',
    },
    () => fetchApi(
      { server: 'netease', type: 'search_playlist', id: keyword },
      {},
      10000,
    ),
  );

  if (!response.ok) return { ok: false, status: response.status };
  const playlists = normalizeNeteasePlaylistSearchItems(await response.json());
  const start = (page - 1) * limit;
  return {
    ok: true,
    payload: {
      page,
      limit,
      total: playlists.length,
      playlists: playlists.slice(start, start + limit),
    },
  };
}

export function createNeteasePlaylistSearchHandler({
  requireIdentity,
  consumeLimit,
  findPresence,
  search = searchNeteasePlaylists,
  logError = (error) => console.error('Netease playlist search error:', error.message),
}) {
  return async function handleNeteasePlaylistSearch(req, res) {
    const identity = requireIdentity(req, res);
    if (!identity) return;
    if (!consumeLimit(req)) {
      res.status(429).json({ error: '请求过于频繁，请稍后再试' });
      return;
    }

    const keyword = String(req.query?.keyword || req.query?.s || '').trim().slice(0, 80);
    const page = Math.max(1, parseInt(String(req.query?.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(
      1,
      parseInt(String(req.query?.limit || '20'), 10) || 20,
    ));
    if (!keyword) {
      res.json({ playlists: [], total: 0, page, limit });
      return;
    }

    try {
      const result = await search({
        identity,
        presence: findPresence(identity.userId),
        keyword,
        page,
        limit,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: '网易歌单搜索失败' });
        return;
      }
      res.json(result.payload);
    } catch (error) {
      logError(error);
      res.status(502).json({ error: '网易歌单搜索失败' });
    }
  };
}
