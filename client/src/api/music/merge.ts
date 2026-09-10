import type { MusicSource, SearchResult } from '../../types';

const SOURCE_PRIORITY: Record<MusicSource, number> = {
  netease: 0,
  tencent: 1,
  kugou: 2,
  qishui: 3,
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '').trim();
}

/** 搜索相关度规范化：去大小写、括号附注与标点 */
function normalizeRelevanceText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\b(?:feat\.?|ft\.?|with)\b.*$/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

/** 最长连续公共子串长度 */
function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  const maxProbe = Math.min(short.length, 16);
  for (let len = maxProbe; len >= 2; len -= 1) {
    for (let i = 0; i + len <= short.length; i += 1) {
      if (long.includes(short.slice(i, i + len))) return len;
    }
  }
  return 0;
}

function artistRelevanceBonus(keyword: string, artist: string): number {
  if (!artist) return 0;
  if (artist === keyword) return 40;
  if (artist.includes(keyword) || keyword.includes(artist)) return 20;
  const overlap = longestCommonSubstringLength(keyword, artist);
  if (overlap >= 2 && overlap / keyword.length >= 0.5) return 10;
  return 0;
}

/** 歌名是否与关键词强匹配（不含弱公共子串，用于判断「是不是在搜歌手」） */
function titleStronglyMatchesKeyword(keyword: string, name: string): boolean {
  const kw = normalizeRelevanceText(keyword);
  const n = normalizeRelevanceText(name);
  if (!kw || !n) return false;
  if (n === kw || n.includes(kw) || n.startsWith(kw)) return true;
  if (kw.includes(n) && n.length >= 2) return true;
  if (kw.startsWith(n) && n.length >= 2) return true;
  return false;
}

/**
 * 前两首歌名都匹配不到关键词 → 视为搜歌手。
 * 仅看列表最前面的样本（上游/合并后的前排），避免误伤歌名搜索。
 */
export function shouldPreferArtistMatch(
  songs: Array<Pick<SearchResult, 'name'>>,
  keyword: string,
): boolean {
  const kw = normalizeRelevanceText(keyword);
  if (!kw || songs.length === 0) return false;
  const sample = songs.slice(0, 2);
  return sample.every((song) => !titleStronglyMatchesKeyword(kw, song.name));
}

function scoreNameRelevance(kw: string, name: string): number {
  if (!name) return 0;
  if (name === kw) return 1000;
  if (name.startsWith(kw)) return 880;
  if (kw.startsWith(name) && name.length >= 2) return 820;
  if (name.includes(kw)) return 760;
  if (kw.includes(name) && name.length >= 2) return 700;
  const overlap = longestCommonSubstringLength(kw, name);
  const coverage = overlap / kw.length;
  if (overlap >= 2 && (coverage >= 0.4 || overlap >= 4)) {
    return Math.round(280 + coverage * 420 + overlap * 8);
  }
  return 0;
}

function scoreArtistPrimary(kw: string, artist: string): number {
  if (!artist) return 0;
  if (artist === kw) return 1000;
  if (artist.includes(kw)) return 920;
  if (kw.includes(artist) && artist.length >= 2) return 860;
  const overlap = longestCommonSubstringLength(kw, artist);
  const coverage = overlap / kw.length;
  if (overlap >= 2 && (coverage >= 0.5 || overlap >= 3)) {
    return Math.round(620 + coverage * 200 + overlap * 6);
  }
  return 0;
}

function titleBonusForArtistMode(kw: string, name: string): number {
  if (!name) return 0;
  if (name === kw) return 80;
  if (name.includes(kw) || (kw.includes(name) && name.length >= 2)) return 40;
  const overlap = longestCommonSubstringLength(kw, name);
  if (overlap >= 2) return Math.min(30, overlap * 5);
  return 0;
}

/**
 * 通用搜索相关度（所有歌曲共用）：
 * 默认歌名优先；preferArtist 时歌手命中压过歌名，用于「前两首不像歌名搜索」的启发式。
 */
export function scoreTitleRelevance(
  keyword: string,
  song: Pick<SearchResult, 'name' | 'artist'>,
  options: { preferArtist?: boolean } = {},
): number {
  const kw = normalizeRelevanceText(keyword);
  if (!kw) return 0;

  const name = normalizeRelevanceText(song.name);
  const artist = normalizeRelevanceText(song.artist);
  if (!name && !artist) return 0;

  if (options.preferArtist) {
    const artistScore = scoreArtistPrimary(kw, artist);
    if (artistScore > 0) {
      return artistScore + titleBonusForArtistMode(kw, name);
    }
    // 无歌手命中：保留弱歌名分但压低，避免噪声抢前排
    return Math.min(scoreNameRelevance(kw, name), 200);
  }

  const nameScore = scoreNameRelevance(kw, name);
  if (nameScore > 0) {
    return nameScore + artistRelevanceBonus(kw, artist);
  }

  // 歌名不相关时：搜歌手名仍应靠前
  if (artist) {
    if (artist === kw) return 520;
    if (artist.includes(kw)) return 460;
    if (kw.includes(artist) && artist.length >= 2) return 400;
  }

  return 0;
}

/** 按关键词相关度稳定排序；所有搜索结果共用 */
export function rankSearchResultsByKeyword(songs: SearchResult[], keyword: string): SearchResult[] {
  const trimmed = keyword.trim();
  if (!trimmed || songs.length <= 1) return songs;

  const preferArtist = shouldPreferArtistMatch(songs, trimmed);

  return songs
    .map((song, index) => ({
      song,
      index,
      score: scoreTitleRelevance(trimmed, song, { preferArtist }),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.song);
}

/**
 * 联想项是用户明确选择的「歌名 + 歌手」组合，不能按普通文本搜索处理。
 * 同时命中两者的结果优先，随后才是同歌手或同歌名的结果。
 */
export function rankSearchResultsBySuggestion(
  songs: SearchResult[],
  suggestion: Pick<SearchResult, 'name' | 'artist'>,
): SearchResult[] {
  const name = normalizeRelevanceText(suggestion.name);
  const artist = normalizeRelevanceText(suggestion.artist);
  if ((!name && !artist) || songs.length <= 1) return songs;

  return songs
    .map((song, index) => {
      const songName = normalizeRelevanceText(song.name);
      const songArtist = normalizeRelevanceText(song.artist);
      const nameScore = name ? scoreNameRelevance(name, songName) : 0;
      const artistScore = artist ? scoreArtistPrimary(artist, songArtist) : 0;
      const score = nameScore > 0 && artistScore > 0
        ? 3_000 + nameScore + artistScore
        : artistScore > 0
          ? 2_000 + artistScore
          : nameScore;
      return { song, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.song);
}

/** 歌手名 + 歌名（跨平台去重键） */
export function trackTitleKey(song: Pick<SearchResult, 'name' | 'artist'>): string {
  return `${normalize(song.name)}|${normalize(song.artist)}`;
}

/** 去除完全相同的条目（同平台同 ID） */
function dedupExact(songs: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = `${song.source}:${song.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 跨平台去重：歌名 + 歌手一致视为同一首
 * 保留优先级：网易 > QQ > 酷狗（先丢酷狗，再丢QQ）
 */
function dedupeCrossSource(songs: SearchResult[]): SearchResult[] {
  const best = new Map<string, SearchResult>();

  for (const song of songs) {
    const key = trackTitleKey(song);
    const prev = best.get(key);
    if (!prev || SOURCE_PRIORITY[song.source] < SOURCE_PRIORITY[prev.source]) {
      best.set(key, song);
    }
  }

  const emitted = new Set<string>();
  const result: SearchResult[] = [];

  for (const song of songs) {
    const key = trackTitleKey(song);
    const winner = best.get(key)!;
    if (song.source !== winner.source || song.id !== winner.id) continue;
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push(song);
  }

  return result;
}

export interface InterleaveOptions {
  /** 跨平台按歌名+歌手去重，优先级：网易 > QQ > 酷狗 */
  dedupeCrossSource?: boolean;
  /** 仅保留指定平台结果 */
  sourceOnly?: MusicSource;
  /** 搜索关键词：合并后按相关度重排（所有歌曲） */
  keyword?: string;
  /** 用户从联想列表明确选择的歌名与歌手，用于结果精排。 */
  suggestion?: Pick<SearchResult, 'name' | 'artist'>;
}

/**
 * 多平台结果交替合并；可选跨平台去重；
 * 传入 keyword 时对全部结果按相关度重排（智能去重 / 单平台筛选均适用）。
 */
export function interleaveSearchResults(
  groups: Partial<Record<MusicSource, SearchResult[]>>,
  options: InterleaveOptions = {},
): SearchResult[] {
  const keyword = options.keyword?.trim() || '';

  // 各平台先按相关度排好，再交替，避免某一平台噪声占满前排槽位
  const prepare = (songs: SearchResult[]) => {
    const exact = dedupExact(songs);
    return keyword ? rankSearchResultsByKeyword(exact, keyword) : exact;
  };

  let merged: SearchResult[];

  if (options.sourceOnly) {
    merged = prepare(groups[options.sourceOnly] ?? []);
  } else {
    const netease = prepare(groups.netease ?? []);
    const tencent = prepare(groups.tencent ?? []);
    const kugou = prepare(groups.kugou ?? []);
    const qishui = prepare(groups.qishui ?? []);
    merged = [];
    const max = Math.max(netease.length, tencent.length, kugou.length, qishui.length);

    for (let i = 0; i < max; i++) {
      if (i < netease.length) merged.push(netease[i]);
      if (i < tencent.length) merged.push(tencent[i]);
      if (i < kugou.length) merged.push(kugou[i]);
      if (i < qishui.length) merged.push(qishui[i]);
    }

    if (options.dedupeCrossSource) {
      merged = dedupeCrossSource(merged);
    }
  }

  if (options.suggestion) return rankSearchResultsBySuggestion(merged, options.suggestion);
  return keyword ? rankSearchResultsByKeyword(merged, keyword) : merged;
}
export function songKey(song: Pick<SearchResult, 'source' | 'id'>): string {
  return `${song.source}-${song.id}`;
}

/** 歌手名规范化，用于分组标题去重 */
export function artistGroupKey(artist: string): string {
  return normalize(artist);
}
