import type { LyricData } from './upstream/src/types';
import { parseLyricsByFormat, type LyricParseFormat } from './upstream/src/utils/lyrics/parserCore';
import { annotateLyricLines } from './upstream/src/utils/lyrics/renderHints';

const wordFormats = new Set(['yrc', 'qrc', 'krc', 'ttml', 'enhanced-lrc']);
const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function normalizeLrc(content: string): string {
  const offset = Number(content.match(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im)?.[1] ?? 0);
  const offsetMs = Number.isSafeInteger(offset) ? offset : 0;
  return content.replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/);
    if (!match) return [];
    return Array.from(match[1].matchAll(timestampPattern), tag => {
      const milliseconds = Math.max(0, (Number(tag[1]) * 60 + Number(tag[2])) * 1000 + Number((tag[3] || '').padEnd(3, '0')) - offsetMs);
      const minutes = String(Math.floor(milliseconds / 60000)).padStart(2, '0');
      const seconds = String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0');
      const fraction = String(milliseconds % 1000).padStart(3, '0');
      return `[${minutes}:${seconds}.${fraction}]${match[2]}`;
    });
  }).join('\n');
}

export function parseFoliaLyrics(payload: unknown): LyricData {
  const lyrics = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const text = (key: string) => typeof lyrics[key] === 'string' ? lyrics[key] as string : '';
  const normalizeAlternateTrack = (content: string) => text('wordFormat') === 'qrc' && /^\[\d+,\d+\]/m.test(content.replace(/^\uFEFF/, ''))
    ? content
    : normalizeLrc(content);
  const translation = normalizeLrc(text('translation'));
  const romanization = normalizeLrc(text('romanization'));
  const fallback = () => parseLyricsByFormat('lrc', normalizeLrc(text('lyric')), translation, {}, romanization);
  let parsed: LyricData;
  try {
    parsed = wordFormats.has(text('wordFormat')) && text('wordLyric')
      ? parseLyricsByFormat(text('wordFormat') as LyricParseFormat, text('wordLyric'), normalizeAlternateTrack(text('translation')), {}, normalizeAlternateTrack(text('romanization')))
      : fallback();
    if (!parsed.lines.length) parsed = fallback();
  } catch {
    parsed = fallback();
  }
  if (!parsed.isWordByWord) {
    parsed.lines = annotateLyricLines(parsed.lines.map(line => line.fullText === '......' ? line : {
      ...line,
      words: [{ text: line.fullText, startTime: line.startTime, endTime: line.endTime, timingMode: 'line' as const }],
    }));
  }
  return parsed;
}
