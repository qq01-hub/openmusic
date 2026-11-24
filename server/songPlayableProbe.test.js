import test from 'node:test';
import assert from 'node:assert/strict';
import { __test, isSongPlayableOnServer } from './songPlayableProbe.js';

function makeMockResponse(status, body, headers = {}) {
  const headerMap = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headerMap.get(String(name).toLowerCase()) || null },
    text: async () => body,
    body: { cancel: async () => {} },
  };
}

test('服务端核实 source_error 时绕过缓存并探测 CDN，确认坏链后淘汰缓存并允许切歌', async () => {
  const invalidated = [];
  const seenOptions = [];
  const playable = await isSongPlayableOnServer(
    { id: '21038564', source: 'netease' },
    {
      invalidateUrlCache: (source, id) => {
        invalidated.push(`${source}:${id}`);
      },
      fetchMeting: async (_query, options) => {
        seenOptions.push(options);
        return makeMockResponse(200, JSON.stringify({ url: 'https://m801.music.126.net/broken.mp3' }));
      },
      probeCdn: async () => false,
    },
  );

  assert.equal(playable, false);
  assert.equal(seenOptions.length, 1);
  assert.equal(seenOptions[0]?.bypassCache, true);
  assert.ok(invalidated.length >= 2);
  assert.equal(invalidated[0], 'netease:21038564');
});

test('服务端核实拿到有效音频 CDN 响应时判定可播，避免误切正常歌曲', async () => {
  const probedUrls = [];
  const playable = await isSongPlayableOnServer(
    { id: '21038564', source: 'netease' },
    {
      invalidateUrlCache: () => {},
      fetchMeting: async () => makeMockResponse(302, '', { location: 'https://m801.music.126.net/ok.mp3' }),
      probeCdn: async (url) => {
        probedUrls.push(url);
        return true;
      },
    },
  );

  assert.equal(playable, true);
  assert.deepEqual(probedUrls, ['https://m801.music.126.net/ok.mp3']);
});

test('非音频 Content-Type 判定拦截伪装视频与错误页响应', () => {
  assert.equal(__test.isNonAudioContentType('video/mp4'), true);
  assert.equal(__test.isNonAudioContentType('text/html; charset=utf-8'), true);
  assert.equal(__test.isNonAudioContentType('application/json'), true);
  assert.equal(__test.isNonAudioContentType('audio/mpeg'), false);
  assert.equal(__test.isNonAudioContentType('audio/flac'), false);
  assert.equal(__test.isNonAudioContentType('application/octet-stream'), false);
  assert.equal(__test.isNonAudioContentType(''), false);
});
