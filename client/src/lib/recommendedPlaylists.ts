import {
  fetchNeteasePlaylistMetas,
  searchNeteasePlaylists,
  searchTencentPlaylists,
  type PlaylistSearchItem,
} from '../api/music/playlist';

export const CURATED_NETEASE: PlaylistSearchItem[] = [
  {
    id: '3778678',
    platform: 'netease',
    name: '云音乐热歌榜',
    coverImgUrl: 'https://p1.music.126.net/0SUEG8yDACfx0Bw2MYFv4Q==/109951170048519512.jpg',
    trackCount: 0,
    playCount: 0,
  },
  {
    id: '19723756',
    platform: 'netease',
    name: '云音乐飙升榜',
    coverImgUrl: 'https://p2.music.126.net/rIi7Qzy2i2Y_1QD7cd0MYA==/109951170048506929.jpg',
    trackCount: 0,
    playCount: 0,
  },
  {
    id: '2250011882',
    platform: 'netease',
    name: '抖音排行榜',
    coverImgUrl: 'https://p2.music.126.net/8sRm2fQNh_KZeWmJ1sRhQQ==/109951165611408950.jpg',
    trackCount: 0,
    playCount: 0,
  },
  {
    id: '3779629',
    platform: 'netease',
    name: '云音乐新歌榜',
    coverImgUrl: 'https://p1.music.126.net/5guhqPBTcIrrhLBotgaT6w==/109951170048511751.jpg',
    trackCount: 0,
    playCount: 0,
  },
];

const CURATED_NETEASE_IDS = new Set(CURATED_NETEASE.map((item) => item.id));
const NETEASE_RECOMMEND_KEYWORD = '推荐';
const QQ_RECOMMEND_KEYWORD = '热歌';
/** 各平台推荐歌单条数（不含网易固定 curated 榜） */
export const PLATFORM_PLAYLIST_LIMIT = 12;
const NETEASE_EXTRA_LIMIT = PLATFORM_PLAYLIST_LIMIT;
const QQ_EXTRA_LIMIT = PLATFORM_PLAYLIST_LIMIT;

export const CURATED_COUNT = CURATED_NETEASE.length;

export type RecommendedPlaylistsData = {
  neteasePlaylists: PlaylistSearchItem[];
  qqPlaylists: PlaylistSearchItem[];
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cache: { data: RecommendedPlaylistsData; expires: number } | null = null;
let inflight: Promise<RecommendedPlaylistsData> | null = null;

function mergePlaylistMeta(
  base: PlaylistSearchItem[],
  meta: PlaylistSearchItem[],
): PlaylistSearchItem[] {
  const metaMap = new Map(meta.map((item) => [item.id, item]));
  return base.map((item) => {
    const remote = metaMap.get(item.id);
    if (!remote) return item;
    return {
      ...item,
      name: remote.name || item.name,
      coverImgUrl: remote.coverImgUrl || item.coverImgUrl,
      creatorName: remote.creatorName || item.creatorName,
      trackCount: remote.trackCount || item.trackCount,
      playCount: remote.playCount || item.playCount,
    };
  });
}

async function loadRecommendedPlaylists(): Promise<RecommendedPlaylistsData> {
  const [curatedMetaResult, neteaseSearchResult, qqSearchResult] = await Promise.allSettled([
    fetchNeteasePlaylistMetas(CURATED_NETEASE.map((item) => item.id)),
    searchNeteasePlaylists(NETEASE_RECOMMEND_KEYWORD, 1, NETEASE_EXTRA_LIMIT + 4),
    searchTencentPlaylists(QQ_RECOMMEND_KEYWORD, 1, QQ_EXTRA_LIMIT + 4),
  ]);

  const curatedMeta = curatedMetaResult.status === 'fulfilled' ? curatedMetaResult.value : [];
  const neteaseSearch = neteaseSearchResult.status === 'fulfilled'
    ? neteaseSearchResult.value
    : { playlists: [], total: 0, page: 1, limit: NETEASE_EXTRA_LIMIT + 4 };
  const qqSearch = qqSearchResult.status === 'fulfilled'
    ? qqSearchResult.value
    : { playlists: [], total: 0, page: 1, limit: QQ_EXTRA_LIMIT + 4 };

  const curated = mergePlaylistMeta(CURATED_NETEASE, curatedMeta);
  const neteaseExtras = neteaseSearch.playlists
    .filter((item) => !CURATED_NETEASE_IDS.has(item.id))
    .slice(0, NETEASE_EXTRA_LIMIT)
    .map((item) => ({ ...item, platform: 'netease' as const }));

  const qqItems = qqSearch.playlists
    .slice(0, QQ_EXTRA_LIMIT)
    .map((item) => ({ ...item, platform: 'qq' as const }));

  return {
    neteasePlaylists: [...curated, ...neteaseExtras],
    qqPlaylists: qqItems,
  };
}

export function peekRecommendedPlaylists(): RecommendedPlaylistsData | null {
  if (cache && cache.expires > Date.now()) return cache.data;
  return null;
}

export async function getRecommendedPlaylists(): Promise<RecommendedPlaylistsData> {
  const hit = peekRecommendedPlaylists();
  if (hit) return hit;
  if (inflight) return inflight;

  inflight = loadRecommendedPlaylists()
    .then((data) => {
      cache = { data, expires: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function getRecommendedPlaylistsFallback(): RecommendedPlaylistsData {
  return {
    neteasePlaylists: CURATED_NETEASE,
    qqPlaylists: [],
  };
}
