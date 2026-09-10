const MUSIC_SUGGESTION_SOURCE_LABELS: Record<string, string> = {
  netease: '网易',
  tencent: 'QQ',
  kugou: '酷狗',
  qishui: '汽水',
};

export function getMusicSuggestionSourceLabel(source: unknown): string {
  return MUSIC_SUGGESTION_SOURCE_LABELS[String(source || '').trim().toLowerCase()] || '';
}
