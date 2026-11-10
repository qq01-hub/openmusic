export const SEARCH_HISTORY_LIMIT = 5;

export type SearchHistoryMode = 'song' | 'playlist';

const SEARCH_HISTORY_KEYS: Record<SearchHistoryMode, string> = {
  song: 'openmusic_search_history:song',
  playlist: 'openmusic_search_history:playlist',
};

export function addSearchHistory(history: string[], keyword: string): string[] {
  const trimmed = keyword.trim();
  if (!trimmed) return history;
  return [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, SEARCH_HISTORY_LIMIT);
}

export function readSearchHistory(mode: SearchHistoryMode): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEYS[mode]) || '[]');
    if (!Array.isArray(stored)) return [];
    const keywords = stored
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return [...new Set(keywords)].slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function writeSearchHistory(mode: SearchHistoryMode, history: string[]): void {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEYS[mode], JSON.stringify(history.slice(0, SEARCH_HISTORY_LIMIT)));
  } catch {
    // 本地存储不可用时保留当前页面内的搜索历史
  }
}
