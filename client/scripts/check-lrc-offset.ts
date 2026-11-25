import assert from 'node:assert/strict';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });

try {
  const { parseLrc, getActiveLyricLine, getLrcFallbackDurationMs, getDurationFromLrc } = await import('../src/api/music');
  const lyric = '[00:10.000]第一句\n[00:20.000]第二句';
  for (const [tag, times] of [
    ['', [10, 20]],
    ['[offset:0]', [10, 20]],
    ['[offset:1000]', [9, 19]],
    ['[offset:+500]', [9.5, 19.5]],
    ['[offset:-1500]', [11.5, 21.5]],
    [' [OFFSET : +500] ', [9.5, 19.5]],
    ['[offset:invalid]', [10, 20]],
    ['[offset:500ms]', [10, 20]],
    ['[offset:1.5]', [10, 20]],
    ['[offset:999999999999999999999999]', [10, 20]],
  ] as const) {
    for (const lrc of [`${tag}\n${lyric}`, `${lyric}\n${tag}`]) {
      assert.deepEqual(parseLrc(lrc).map((line) => line.time), times, lrc);
    }
  }
  assert.deepEqual(parseLrc('[offset:500]\r\n[00:10.125][00:20:25]重复歌词').map((line) => line.time), [9.625, 19.75]);
  assert.deepEqual(parseLrc('[offset:1000]\n[00:00.100]第一句\n[00:00.200]第二句'), [
    { time: 0, text: '第一句' },
    { time: 0, text: '第二句' },
  ]);
  assert.deepEqual(parseLrc('[offset:500]\n[00:10.000]原文\n[00:10.000]翻译'), [
    { time: 9.5, text: '原文', translation: '翻译' },
  ]);
  assert.equal(parseLrc('[offset:500]\n[99:00.000]推广').length, 0);
  assert.equal(parseLrc('[offset:500]').length, 0);
  assert.equal(parseLrc('[offset:500]\n[offset:1000]\n[00:10.000]歌词')[0].time, 9.5);
  const shifted = `[offset:1000]\n${lyric}`;
  assert.equal(getActiveLyricLine(parseLrc(shifted), 8.71), null);
  assert.equal(getActiveLyricLine(parseLrc(shifted), 8.73)?.text, '第一句');
  assert.equal(getLrcFallbackDurationMs(shifted), 39000);
  assert.equal(getDurationFromLrc(shifted, 60000), 60000);
  assert.equal(getLrcFallbackDurationMs('[offset:1000]\n[00:10.000]纯音乐'), undefined);

  const { parseFoliaLyrics } = await import('../../vendor/folia/lyrics.ts');
  const firstLyricLine = (parsed: ReturnType<typeof parseFoliaLyrics>) => parsed.lines.find(line => line.fullText !== '......');

  const yrcParsed = parseFoliaLyrics({
    wordFormat: 'yrc',
    wordLyric: '[offset:500]\n[10000,2000](10000,800,0)你(10800,1200,0)好',
    translation: '[offset:500]\n[00:10.000]Hello',
  });
  assert.equal(yrcParsed.isWordByWord, true);
  const yrcLine = firstLyricLine(yrcParsed);
  assert.ok(yrcLine);
  assert.equal(yrcLine.startTime, 9.5);
  assert.equal(yrcLine.words[0].startTime, 9.5);
  assert.equal(yrcLine.words[1].startTime, 10.3);
  assert.equal(yrcLine.translation, 'Hello');

  const krcParsed = parseFoliaLyrics({
    wordFormat: 'krc',
    wordLyric: '[offset:200]\n[10200,1000]<0,400,0>晴<400,600,0>天',
    translation: '[offset:200]\n[00:10.200]Sunny',
  });
  assert.equal(krcParsed.isWordByWord, true);
  const krcLine = firstLyricLine(krcParsed);
  assert.ok(krcLine);
  assert.equal(krcLine.startTime, 10);
  assert.equal(krcLine.words[0].startTime, 10);
  assert.equal(krcLine.words[1].startTime, 10.4);
  assert.equal(krcLine.translation, 'Sunny');

  const qrcXml = `<?xml version="1.0" encoding="utf-8"?><QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[offset:-500]\n[10000,1000]I&apos;m (10000,400)&quot;ok&quot;(10400,600)"/></LyricInfo></QrcInfos>`;
  const qrcParsed = parseFoliaLyrics({
    wordFormat: 'qrc',
    wordLyric: qrcXml,
    translation: '[offset:-500]\n[00:10.000]我很好',
  });
  assert.equal(qrcParsed.isWordByWord, true);
  const qrcLine = firstLyricLine(qrcParsed);
  assert.ok(qrcLine);
  assert.equal(qrcLine.startTime, 10.5);
  assert.equal(qrcLine.words[0].startTime, 10.5);
  assert.equal(qrcLine.words[1].startTime, 10.9);
  assert.equal(qrcLine.fullText, `I'm "ok"`);
  assert.equal(qrcLine.translation, '我很好');

  console.log('LRC offset checks passed');
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}
