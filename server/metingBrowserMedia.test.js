import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { isBlockedMediaHostname } from './mediaProxy.js';

test('浏览器媒体不使用 Docker 内部直链，标准解析和汽水保持同源', async () => {
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const functions = [
    ['function parseMetingMediaQuery(', 'function parseMetingPicQuery('],
    ['function normalizeMetingSongIds(', 'function normalizeMetingLoudness('],
    ['function browserMetingMediaUrl(', '/** media-proxy 误收到'],
  ].map(([start, end]) => source.slice(source.indexOf(start), source.indexOf(end))).join('\n');
  const context = vm.createContext({
    URL, URLSearchParams, isBlockedMediaHostname,
    isQishuiPlayUrl: raw => new URL(raw).pathname.endsWith('/audio/qishui'),
    isConfiguredMetingUrl: raw => new URL(raw).origin === 'http://meting-api:3000',
    createQishuiSourceToken: () => 'test-token',
    requestPublicOrigin: () => 'https://music.example.com',
  });
  vm.runInContext(functions, context);
  for (const url of [
    'http://meting-api:3000/files/song.mp3', 'http://meting:3000/files/song.mp3',
    'http://meting-api-audio-loudness:3100/analyze', 'http://redis:6379',
    'http://172.30.80.12:3000/files/song.mp3', 'http://127.0.0.1/song.mp3',
    'http://169.254.169.254/latest/meta-data', 'http://[::1]/song.mp3',
    'https://user:password@cdn.example.com/song.mp3',
  ]) {
    assert.equal(context.browserMetingMediaUrl(url), '', url);
    const payload = await context.localizeQishuiPayload({ url, gain: 1 }, { type: 'url', server: 'netease' });
    assert.equal(payload.url, '');
    assert.equal(payload.gain, 1);
  }
  const cdn = 'https://cdn.example.com/song.mp3';
  assert.equal(context.browserMetingMediaUrl(cdn), cdn);
  const pic = 'http://meting-api:3000/api?server=netease&type=pic&id=123';
  assert.equal(context.browserMetingMediaUrl(pic), '/api/meting?server=netease&id=123&type=pic');
  const song = { id: '123', url: 'http://meting-api:3000/files/song.mp3', pic };
  assert.equal(context.normalizeMetingSongIds(song), song);
  assert.equal(song.url, '');
  assert.ok(song.pic.startsWith('/api/meting?'));
  const legacy = [{ url: '123456', lrc: '[00:01]歌词' }];
  context.normalizeMetingSongIds({ data: legacy });
  assert.equal(legacy[0].id, '123456');
  assert.equal(legacy[0].lrc, '[00:01]歌词');
  const qishui = { url: 'http://meting-api:3000/audio/qishui?t=secret', quality: 'HQ' };
  const localized = await context.localizeQishuiPayload(qishui, { server: 'qishui', type: 'url' });
  assert.equal(localized.url, 'https://music.example.com/api/qishui-source?t=test-token');
  assert.equal(localized.quality, 'HQ');
  const invalid = await context.localizeQishuiPayload({ url: 'http://redis:6379/audio/qishui?t=secret' }, { server: 'qishui', type: 'url' });
  assert.equal(invalid.url, '');
});
