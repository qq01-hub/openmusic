import type { LyricData } from './upstream/src/types';
import { parseLyricsByFormat, type LyricParseFormat } from './upstream/src/utils/lyrics/parserCore';
import { annotateLyricLines } from './upstream/src/utils/lyrics/renderHints';

const wordFormats = new Set(['yrc', 'qrc', 'krc', 'ttml', 'enhanced-lrc']);
const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const offsetLinePattern = /^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im;
const offsetLineGlobalPattern = /^\s*\[offset\s*:\s*[^\]]*\]\s*$/gim;
const qrcXmlContentPattern = /<Lyric_\d+\b[^>]*\bLyricContent="([\s\S]*?)"\s*\/>/i;

function decodeXmlEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (match, hex, dec, named) => {
    if (hex) {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    if (dec) {
      const codePoint = Number.parseInt(dec, 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    switch (named.toLowerCase()) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: return match;
    }
  });
}

export function unwrapQrcContent(content: string): string {
  const stripped = content.replace(/^\uFEFF/, '');
  const xmlMatch = stripped.match(qrcXmlContentPattern);
  if (!xmlMatch) return stripped;
  return decodeXmlEntities(xmlMatch[1]);
}

export function extractLyricOffsetMs(content: string): number {
  const raw = content.match(offsetLinePattern)?.[1];
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function applyWordLyricOffset(format: string, content: string): string {
  const cleaned = format === 'qrc' ? unwrapQrcContent(content) : content.replace(/^\uFEFF/, '');
  if (format !== 'yrc' && format !== 'qrc' && format !== 'krc') return cleaned;
  const offsetMs = extractLyricOffsetMs(cleaned);
  if (offsetMs === 0) return cleaned;

  return cleaned.replace(offsetLineGlobalPattern, '').split(/\r?\n/).map((rawLine) => {
    const lineMatch = rawLine.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!lineMatch) return rawLine;
    const rawLineStart = Number.parseInt(lineMatch[1], 10);
    const rawLineDuration = Number.parseInt(lineMatch[2], 10);
    const rest = lineMatch[3];
    const shiftedStart = rawLineStart - offsetMs;
    const nextLineStart = Math.max(0, shiftedStart);
    const clippedMs = shiftedStart < 0 ? -shiftedStart : 0;
    const nextLineDuration = Math.max(0, rawLineDuration - clippedMs);

    if (format === 'yrc') {
      const shiftedRest = rest.replace(/\((\d+),(\d+),(\d+)\)/g, (_tag, start, duration, flag) => {
        const rawWordStart = Number.parseInt(start, 10);
        const rawWordDuration = Number.parseInt(duration, 10);
        const wordShifted = rawWordStart - offsetMs;
        const nextWordStart = Math.max(0, wordShifted);
        const wordClipped = wordShifted < 0 ? -wordShifted : 0;
        return `(${nextWordStart},${Math.max(0, rawWordDuration - wordClipped)},${flag})`;
      });
      return `[${nextLineStart},${nextLineDuration}]${shiftedRest}`;
    }

    if (format === 'qrc') {
      const shiftedRest = rest.replace(/\((\d+),(\d+)(,\d+)?\)/g, (_tag, start, duration, extra = '') => {
        const rawWordStart = Number.parseInt(start, 10);
        const rawWordDuration = Number.parseInt(duration, 10);
        const wordShifted = rawWordStart - offsetMs;
        const nextWordStart = Math.max(0, wordShifted);
        const wordClipped = wordShifted < 0 ? -wordShifted : 0;
        return `(${nextWordStart},${Math.max(0, rawWordDuration - wordClipped)}${extra})`;
      });
      return `[${nextLineStart},${nextLineDuration}]${shiftedRest}`;
    }

    const shiftedRest = clippedMs > 0
      ? rest.replace(/<(\d+),(\d+)(,\d+)?>/g, (_tag, startOffset, duration, extra = '') => {
        const rawWordOffset = Number.parseInt(startOffset, 10);
        const rawWordDuration = Number.parseInt(duration, 10);
        const nextOffset = rawWordOffset - clippedMs;
        const wordClipped = nextOffset < 0 ? -nextOffset : 0;
        return `<${Math.max(0, nextOffset)},${Math.max(0, rawWordDuration - wordClipped)}${extra}>`;
      })
      : rest;
    return `[${nextLineStart},${nextLineDuration}]${shiftedRest}`;
  }).join('\n');
}

function normalizeLrc(content: string): string {
  const offsetMs = extractLyricOffsetMs(content);
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
  const wordFormat = text('wordFormat');
  const normalizeAlternateTrack = (content: string) => {
    if (wordFormat === 'qrc') {
      const unwrapped = unwrapQrcContent(content);
      if (/^\[\d+,\d+\]/m.test(unwrapped)) return applyWordLyricOffset('qrc', unwrapped);
    }
    return normalizeLrc(content);
  };
  const translation = normalizeLrc(text('translation'));
  const romanization = normalizeLrc(text('romanization'));
  const fallback = () => parseLyricsByFormat('lrc', normalizeLrc(text('lyric')), translation, {}, romanization);
  let parsed: LyricData;
  try {
    parsed = wordFormats.has(wordFormat) && text('wordLyric')
      ? parseLyricsByFormat(
        wordFormat as LyricParseFormat,
        applyWordLyricOffset(wordFormat, text('wordLyric')),
        normalizeAlternateTrack(text('translation')),
        {},
        normalizeAlternateTrack(text('romanization')),
      )
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
