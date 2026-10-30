import type { LyricLine } from '../types';
import { findActiveLyricIndex } from './lyricActiveIndex';

const CREDIT_LINE_RE =
  /^(歌手|演唱|原唱|专辑|来源|OP|SP|版权|未经许可|宣传|策划|统筹|发行|出品方?|监制|配唱|监唱|制作|录音|混音|母带|编曲|作曲|作词|吉他|贝斯|鼓|键盘|和声|弦乐|钢琴|打击乐|营销推广|音乐制作|音乐监制|歌曲监制|和声编写|弦乐编写|混音工程师|录音工程师|母带工程师|制作统筹|人声|弦乐演奏|吉他演奏|贝斯演奏|鼓演奏)\s*[:：]/i;
const PROMO_LINE_RE = /(网易飓风计划|现金激励|流量扶持|业务联系|vip\.163\.com|来自〖|〗)/i;
const NON_LYRIC_LINE_RE = /^(?:乐夏|拜拜|谢谢|再见|主唱|吉他(?:\/和声)?|贝斯|鼓(?:\/和声)?|和声|特邀键盘|声音制作人|音乐混音(?:顾问)?|舞台总监|灯光总监)\b/i;

const displayLyricsCache = new WeakMap<LyricLine[], LyricLine[]>();

export function filterDisplayLyrics(lines: LyricLine[]): LyricLine[] {
  const cached = displayLyricsCache.get(lines);
  if (cached) return cached;
  const filtered = lines.filter((line) => {
    const text = line.text.trim();
    if (!text) return false;
    if (CREDIT_LINE_RE.test(text)) return false;
    if (PROMO_LINE_RE.test(text)) return false;
    if (NON_LYRIC_LINE_RE.test(text)) return false;
    return true;
  });
  displayLyricsCache.set(lines, filtered);
  return filtered;
}

export const LYRIC_SYNC_LEAD_SEC = 0.28;

export function getActiveLyricLine(lines: LyricLine[], currentTime: number): LyricLine | null {
  const displayLines = filterDisplayLyrics(lines);
  if (displayLines.length === 0) return null;
  const activeIndex = findActiveLyricIndex(displayLines, currentTime + LYRIC_SYNC_LEAD_SEC);
  if (activeIndex >= 0) return displayLines[activeIndex];
  return currentTime + LYRIC_SYNC_LEAD_SEC < displayLines[0].time ? null : displayLines[displayLines.length - 1];
}

export function getActiveLyricPair(
  lines: LyricLine[],
  currentTime: number,
): { current: string | null; next: string | null } {
  const displayLines = filterDisplayLyrics(lines);
  if (displayLines.length === 0) return { current: null, next: null };

  const syncTime = currentTime + LYRIC_SYNC_LEAD_SEC;
  const activeIndex = findActiveLyricIndex(displayLines, syncTime);
  if (activeIndex >= 0) {
    return {
      current: displayLines[activeIndex].text,
      next: displayLines[activeIndex + 1]?.text ?? null,
    };
  }
  if (syncTime < displayLines[0].time) {
    return { current: null, next: displayLines[0].text };
  }
  return { current: displayLines[displayLines.length - 1].text, next: null };
}
