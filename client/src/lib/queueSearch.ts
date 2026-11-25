import type { QueueItem } from '../types';

export type QueueRowSong = QueueItem & { isCurrent: boolean };

export interface QueueSearchMatch {
  song: QueueRowSong;
  queueIndex: number;
  score: number;
}

function normalizeText(value: string | undefined | null): string {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function compactText(value: string): string {
  return value.replace(/[\s\-_·.,，。/\\()（）【】[\]'"`~!@#$%^&*+=?:;]+/g, '');
}

function subsequenceScore(target: string, token: string): number {
  if (token.length < 2 || !target) return 0;
  const compactTarget = compactText(target);
  const compactToken = compactText(token);
  if (compactToken.length < 2 || compactToken.length > compactTarget.length) return 0;

  let firstMatch = -1;
  let lastMatch = -1;
  let cursor = 0;
  for (let i = 0; i < compactToken.length; i += 1) {
    const found = compactTarget.indexOf(compactToken[i], cursor);
    if (found < 0) return 0;
    if (firstMatch < 0) firstMatch = found;
    lastMatch = found;
    cursor = found + 1;
  }

  const span = lastMatch - firstMatch + 1;
  const gap = span - compactToken.length;
  return Math.max(20, 45 - Math.min(gap * 3, 25));
}

function matchFieldScore(fieldValue: string, token: string, fieldBonus: number, allowSubsequence: boolean): number {
  if (!fieldValue) return 0;
  if (fieldValue === token) return 100 + fieldBonus;
  if (fieldValue.startsWith(token)) return 85 + fieldBonus;
  if (fieldValue.includes(token)) return 70 + fieldBonus;
  if (!allowSubsequence) return 0;
  const fuzzy = subsequenceScore(fieldValue, token);
  return fuzzy > 0 ? fuzzy + Math.floor(fieldBonus / 2) : 0;
}

export function scoreQueueSong(song: QueueRowSong, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const name = normalizeText(song.name);
  const artist = normalizeText(song.artist);
  const album = normalizeText(song.album);
  const requester = normalizeText(song.requestedBy);
  const combined = `${name} ${artist}`.trim();

  let total = 0;
  for (const token of tokens) {
    const best = Math.max(
      matchFieldScore(name, token, 20, true),
      matchFieldScore(artist, token, 20, true),
      matchFieldScore(album, token, 6, false),
      matchFieldScore(requester, token, 0, false),
      subsequenceScore(combined, token),
    );
    if (best <= 0) return 0;
    total += best;
  }
  return total;
}

export function filterQueueSongs(songs: QueueRowSong[], query: string): QueueSearchMatch[] {
  const normalized = normalizeText(query);
  if (!normalized) {
    return songs.map((song, queueIndex) => ({ song, queueIndex, score: 1 }));
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const matches: QueueSearchMatch[] = [];

  for (let queueIndex = 0; queueIndex < songs.length; queueIndex += 1) {
    const song = songs[queueIndex];
    const score = scoreQueueSong(song, tokens);
    if (score > 0) {
      matches.push({ song, queueIndex, score });
    }
  }

  matches.sort((a, b) => {
    const tierA = Math.floor(a.score / 25);
    const tierB = Math.floor(b.score / 25);
    if (tierB !== tierA) return tierB - tierA;
    return a.queueIndex - b.queueIndex;
  });
  return matches;
}
