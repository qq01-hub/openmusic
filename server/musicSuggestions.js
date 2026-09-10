import { fetchMetingApi } from './metingUpstream.js';
import { isMusicSourceEnabled } from './musicSources.js';

const SOURCE_PRIORITY = ['netease', 'tencent', 'kugou', 'qishui'];

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function readArtist(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const text = value
        .map((item) => typeof item === 'object' ? firstText(item?.name, item?.title) : item)
        .filter(Boolean)
        .join(' / ')
        .trim();
      if (text) return text;
      continue;
    }
    if (value && typeof value === 'object') {
      const text = firstText(value.name, value.title);
      if (text) return text;
      continue;
    }
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function normalizeMusicSuggestion(song, source) {
  if (!song || typeof song !== 'object' || !SOURCE_PRIORITY.includes(source)) return null;
  const name = firstText(song.name, song.title, song.songname, song.songName, song.song_name, song.musicName);
  const artist = readArtist(
    song.artist,
    song.author,
    song.singer,
    song.singername,
    song.singerName,
    song.singer_name,
    song.artists,
    song.artistName,
    song.artistname,
    song.artist_name,
  );
  if (!name || !artist) return null;
  return { name, artist, source };
}

/**
 * 并发查询四个平台的搜索建议
 * @param {string} keyword - 搜索关键词
 * @param {object} enabledSources - 启用的音乐源配置
 * @returns {Promise<Array>} 聚合后的建议列表
 */
export async function fetchMusicSuggestions(keyword, enabledSources = {}) {
  const trimmed = String(keyword || '').trim();
  if (!trimmed || trimmed.length < 1) {
    return [];
  }

  // 限制关键词长度，避免过长查询
  const searchKeyword = trimmed.slice(0, 50);

  // 构建四源查询任务
  const tasks = [];
  const sourceMap = new Map();

  if (isMusicSourceEnabled('netease', enabledSources)) {
    tasks.push(
      fetchMetingApi({ server: 'netease', type: 'search', id: searchKeyword, limit: 8 })
        .then(async (res) => {
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data) ? data.slice(0, 8) : [];
        })
        .catch(() => [])
    );
    sourceMap.set(tasks.length - 1, 'netease');
  }

  if (isMusicSourceEnabled('tencent', enabledSources)) {
    tasks.push(
      fetchMetingApi({ server: 'tencent', type: 'search', id: searchKeyword, limit: 8 })
        .then(async (res) => {
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data) ? data.slice(0, 8) : [];
        })
        .catch(() => [])
    );
    sourceMap.set(tasks.length - 1, 'tencent');
  }

  if (isMusicSourceEnabled('kugou', enabledSources)) {
    tasks.push(
      fetchMetingApi({ server: 'kugou', type: 'search', id: searchKeyword, limit: 8 })
        .then(async (res) => {
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data) ? data.slice(0, 8) : [];
        })
        .catch(() => [])
    );
    sourceMap.set(tasks.length - 1, 'kugou');
  }

  if (isMusicSourceEnabled('qishui', enabledSources)) {
    tasks.push(
      fetchMetingApi({ server: 'qishui', type: 'search', id: searchKeyword, limit: 8 })
        .then(async (res) => {
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data) ? data.slice(0, 8) : [];
        })
        .catch(() => [])
    );
    sourceMap.set(tasks.length - 1, 'qishui');
  }

  if (tasks.length === 0) {
    return [];
  }

  // 并发查询所有平台
  const results = await Promise.all(tasks);


  // 按"歌曲名 + 歌手"聚合去重
  const aggregated = new Map();

  // 平台优先级：网易 > QQ > 酷狗 > 汽水
  const platformPriority = { netease: 1, tencent: 2, kugou: 3, qishui: 4 };

  results.forEach((songs, index) => {
    const source = sourceMap.get(index);
    if (!source || !Array.isArray(songs)) return;

    songs.forEach((song) => {
      const normalized = normalizeMusicSuggestion(song, source);
      if (!normalized) return;

      const { name, artist } = normalized;

      // 使用歌曲名+歌手作为聚合键，移除空格以提高去重准确性
      const normalizedName = name.toLowerCase().replace(/\s+/g, '');
      const normalizedArtist = artist.toLowerCase().replace(/\s+/g, '');
      const key = `${normalizedName}|||${normalizedArtist}`;

      if (!aggregated.has(key)) {
        aggregated.set(key, {
          name,
          artist,
          source, // 只保留第一个遇到的平台（优先级最高的）
          hits: 1,
          firstRank: songs.indexOf(song),
          priority: platformPriority[source] || 99,
        });
      } else {
        const entry = aggregated.get(key);
        // 如果新平台优先级更高，替换平台
        const newPriority = platformPriority[source] || 99;
        if (newPriority < entry.priority) {
          entry.source = source;
          entry.priority = newPriority;
        }
        entry.hits += 1;
        entry.firstRank = Math.min(entry.firstRank, songs.indexOf(song));
      }
    });
  });

  // 综合排序：多平台命中 > 平台排名 > 匹配度
  const sorted = Array.from(aggregated.values()).sort((a, b) => {
    // 优先：命中平台数量
    if (b.hits !== a.hits) return b.hits - a.hits;
    // 其次：首次出现排名
    if (a.firstRank !== b.firstRank) return a.firstRank - b.firstRank;
    // 最后：字母序
    return a.name.localeCompare(b.name);
  });


  // 返回前 6-8 条
  return sorted.slice(0, 8).map((item) => ({
    name: item.name,
    artist: item.artist,
    source: item.source, // 单个优先平台
  }));
}
