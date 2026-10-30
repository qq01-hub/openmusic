import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDisplayLyrics, getActiveLyricPair } from '../../lib/lyricLookup';
import type { LyricLine } from '../../types';

function makeLines(): LyricLine[] {
  return [
    { time: 0, text: '第一句' },
    { time: 2, text: '第二句' },
    { time: 4, text: '制作: 应被过滤' },
    { time: 6, text: '第三句' },
  ];
}

test('caches filtered lyrics for the same immutable lyric array', () => {
  const lines = makeLines();
  assert.strictEqual(filterDisplayLyrics(lines), filterDisplayLyrics(lines));
});

test('finds the active lyric pair without changing lyric semantics', () => {
  const lines = makeLines();
  assert.deepEqual(getActiveLyricPair(lines, 0.5), { current: '第一句', next: '第二句' });
  assert.deepEqual(getActiveLyricPair(lines, 5), { current: '第二句', next: '第三句' });
  assert.deepEqual(getActiveLyricPair(lines, 8), { current: '第三句', next: null });
});
