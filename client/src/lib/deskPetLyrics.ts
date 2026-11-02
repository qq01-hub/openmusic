export interface LyricReactionMemory {
  songKey: string;
  seen: Set<string>;
  nextAt: number;
}

export interface LyricReaction {
  text: string;
  action: string;
}

export function sampleLyricReaction(
  memory: LyricReactionMemory,
  songKey: string,
  lyric: string,
  now: number,
  random = Math.random,
): LyricReaction | null {
  if (memory.songKey !== songKey) {
    memory.songKey = songKey;
    memory.seen.clear();
  }
  const text = lyric.replace(/\s+/g, ' ').trim();
  if (!songKey || !/\p{L}/u.test(text)
    || /^(?:纯音乐|作词|作曲|编曲|演唱|制作|词|曲|lyrics?|composer|arranger)\s*[:：]?/i.test(text)) return null;
  if (memory.seen.has(text)) return null;
  memory.seen.add(text);
  if (now < memory.nextAt || random() >= 0.18) return null;
  memory.nextAt = now + 45000 + random() * 30000;

  const chars = Array.from(text);
  const quote = chars.slice(0, 28).join('') + (chars.length > 28 ? '…' : '');
  const mood = /眼泪|泪|难过|孤独|寂寞|伤心|离开|再见|悲伤|\b(sad|cry|lonely|goodbye)\b/i.test(text)
    ? { action: UPSTREAM_ANIM.sad[0], lines: ['这句听着有点心酸，陪你安静听一会儿', '抱抱，难过的这句本鱼也听见啦'] }
    : /爱|喜欢|想你|思念|拥抱|温柔|\b(love|miss you)\b/i.test(text)
      ? { action: UPSTREAM_ANIM.clicks[1], lines: ['这句好温柔呀，悄悄收藏在心里', '听到这句，想把耳机分你一半'] }
      : /快乐|开心|笑|跳舞|阳光|欢喜|\b(happy|dance|smile)\b/i.test(text)
        ? { action: '轻快摇摆舞', lines: ['这句一响，尾巴就忍不住打拍子啦', '跟着这一句，一起摇摆一下 ♪'] }
        : { action: '悠闲哼歌', lines: ['本鱼也想轻轻跟唱这一句 ♪', '这句有点入耳，陪你再听一会儿'] };
  return {
    text: `「${quote}」\n${mood.lines[Math.floor(random() * mood.lines.length)]}`,
    action: mood.action,
  };
}
import { UPSTREAM_ANIM } from './deskPetUpstream';

