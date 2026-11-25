import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetingResponseCache } from './metingCache.js';
import {
  __test as metingUpstreamTest,
  invalidateMetingUrlCache,
  registerMetingRoomResolver,
  runWithMetingRequestContext,
} from './metingUpstream.js';
import { fetchCustomMusicApi, getJsonPath, normalizeMusicApis } from './customMusicApi.js';

test('搜索联想的 Meting 500 不写后台错误记录，但保留失败计数和冷却', () => {
  const upstream = { failCount: 0, recentErrors: [], lastError: '已有错误', lastErrorAt: 1 };
  runWithMetingRequestContext({ musicSuggestions: true }, () => {
    metingUpstreamTest.markFailure(upstream, '上游返回 500', { type: 'search' }, 500);
  });
  assert.equal(upstream.failCount, 1);
  assert.ok(upstream.cooldownUntil > Date.now());
  assert.deepEqual(upstream.recentErrors, []);
  assert.equal(upstream.lastError, '已有错误');
  assert.equal(upstream.lastErrorAt, 1);

  for (const { context, type, status } of [
    { context: {}, type: 'search', status: 500 },
    { context: { musicSuggestions: true }, type: 'search', status: 502 },
    { context: { musicSuggestions: true }, type: 'search', status: 403 },
    { context: { musicSuggestions: true }, type: 'search', status: 0 },
    { context: { musicSuggestions: true }, type: 'url', status: 500 },
  ]) {
    runWithMetingRequestContext(context, () => {
      metingUpstreamTest.markFailure(upstream, `上游返回 ${status}`, { type }, status);
    });
  }
  assert.equal(upstream.recentErrors.length, 5);
  assert.equal(upstream.failCount, 6);
});

test('相同 Meting 请求并发时只执行一次加载，并复用响应', async () => {
  const cache = createMetingResponseCache({ ttlMs: 60_000 });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { status: 200, body: '{"url":"https://cdn.example/song.mp3"}' };
  };

  const [first, second] = await Promise.all([
    cache.get('netease:url:1', loader),
    cache.get('netease:url:1', loader),
  ]);

  assert.equal(loads, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(await cache.get('netease:url:1', loader), first);
  assert.equal(loads, 1);
});

test('切歌瞬间同一房间的大量 URL 请求只触发一次上游加载', async () => {
  const cache = createMetingResponseCache({ ttlMs: 60_000 });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { status: 200, body: 'url' };
  };

  const requests = await runWithMetingRequestContext(
    { roomId: 'ROOM1' },
    () => Promise.all(Array.from({ length: 100 }, () => cache.get('netease:url:1:high', loader))),
  );

  assert.equal(loads, 1);
  assert.equal(requests.length, 100);
  assert.ok(requests.every((result) => result.body === 'url'));
});

test('未绑定私有账号的公共房间共享 URL 缓存键并剥离敏感透传参数', () => {
  const makeKey = (roomId, extra = {}) => runWithMetingRequestContext(
    { roomId },
    () => metingUpstreamTest.buildMetingCacheKey(
      { server: 'netease', type: 'url', id: '1', quality: 'high', ...extra },
      {},
    ),
  );

  assert.equal(makeKey('ROOM1', { roomId: 'ROOM1', auth: 'secret-a' }), makeKey('ROOM2', { room_id: 'ROOM2', token: 'secret-b' }));
});

test('绑定私有音乐账号的房间按账号和房间隔离缓存键', () => {
  registerMetingRoomResolver((roomId) => ({
    musicAccounts: roomId === 'PRIV1'
      ? { netease: { hasVip: true, isValid: true } }
      : null,
    musicAccountSecrets: roomId === 'PRIV1'
      ? { netease: 'MUSIC_U=room-private-cookie-1' }
      : null,
  }));
  try {
    const privateKey = runWithMetingRequestContext(
      { roomId: 'PRIV1' },
      () => metingUpstreamTest.buildMetingCacheKey({ server: 'netease', type: 'url', id: '1', quality: 'high' }, {}),
    );
    const publicKey = runWithMetingRequestContext(
      { roomId: 'PUB2' },
      () => metingUpstreamTest.buildMetingCacheKey({ server: 'netease', type: 'url', id: '1', quality: 'high' }, {}),
    );
    assert.notEqual(privateKey, publicKey);
  } finally {
    registerMetingRoomResolver(null);
  }
});

test('空播放链、JSON 包装的网易云 outer/url 假直链与空搜索数组不会写入缓存', async () => {
  const fakeOuterSnapshot = await metingUpstreamTest.snapshotMetingResponse(
    new Response(JSON.stringify({ url: 'https://music.163.com/song/media/outer/url?id=12345.mp3' }), { status: 200 }),
    'url',
  );
  assert.equal(fakeOuterSnapshot.cacheable, false);
  assert.equal(metingUpstreamTest.isNeteaseFakeOuterUrl(metingUpstreamTest.extractUrlCandidateFromPayload(fakeOuterSnapshot.body)), true);

  const emptyUrlSnapshot = await metingUpstreamTest.snapshotMetingResponse(
    new Response(JSON.stringify({ url: '' }), { status: 200 }),
    'url',
  );
  assert.equal(emptyUrlSnapshot.cacheable, false);

  const emptySearchSnapshot = await metingUpstreamTest.snapshotMetingResponse(
    new Response('[]', { status: 200 }),
    'search',
  );
  assert.equal(emptySearchSnapshot.cacheable, false);

  const validUrlSnapshot = await metingUpstreamTest.snapshotMetingResponse(
    new Response(JSON.stringify({ url: 'https://m701.music.126.net/real-song.mp3' }), { status: 200 }),
    'url',
  );
  assert.equal(validUrlSnapshot.cacheable, true);
});

test('自定义音乐接口拦截原型链访问、内网 SSRF 地址并在多操作间共享响应缓存', async () => {
  assert.equal(getJsonPath({ data: { url: 'ok' } }, '$.__proto__.polluted'), undefined);
  assert.equal(getJsonPath({ data: { url: 'ok' } }, '$.constructor.name'), undefined);
  assert.equal(getJsonPath({ data: { url: 'ok' } }, '$.data.url'), 'ok');

  assert.throws(() => normalizeMusicApis([{
    id: 'local-ssrf',
    platforms: ['netease'],
    operations: ['url'],
    url: 'http://169.254.169.254/latest/meta-data/',
    mapping: { url: '$.url' },
  }]), /内网|元数据/);

  let upstreamCalls = 0;
  const config = {
    musicApis: normalizeMusicApis([{
      id: 'shared-multi-op',
      platforms: ['netease'],
      operations: ['url', 'lrc'],
      url: 'https://api.example.com/song?id={id}',
      mapping: { url: '$.url', lrc: '$.lrc' },
    }]),
  };
  const mockFetch = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({
      url: 'https://cdn.example.com/track.mp3',
      lrc: '[00:00.00]测试歌词',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const urlRes = await fetchCustomMusicApi(
    { server: 'netease', type: 'url', id: '42' },
    { config, fetchImpl: mockFetch },
  );
  const lrcRes = await fetchCustomMusicApi(
    { server: 'netease', type: 'lrc', id: '42' },
    { config, fetchImpl: mockFetch },
  );
  assert.equal(await urlRes.text(), 'https://cdn.example.com/track.mp3');
  assert.equal(await lrcRes.text(), '[00:00.00]测试歌词');
  assert.equal(upstreamCalls, 1);
});

test('加载失败不会污染缓存，下一次请求可以重试', async () => {
  const cache = createMetingResponseCache({ ttlMs: 60_000 });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    if (loads === 1) throw new Error('upstream down');
    return { status: 200, body: 'ok' };
  };

  await assert.rejects(cache.get('netease:search:test', loader), /upstream down/);
  assert.deepEqual(await cache.get('netease:search:test', loader), { status: 200, body: 'ok' });
  assert.equal(loads, 2);
});

test('歌曲 URL 缓存键区分不同音质', () => {
  const standard = metingUpstreamTest.buildMetingCacheKey(
    { server: 'netease', type: 'url', id: '1', quality: 'standard' },
    {},
  );
  const high = metingUpstreamTest.buildMetingCacheKey(
    { server: 'netease', type: 'url', id: '1', quality: 'high' },
    {},
  );

  assert.notEqual(standard, high);
});

test('缓存支持按条件淘汰单曲 URL，不影响同曲歌词及其他歌曲缓存', () => {
  const cache = metingUpstreamTest.metingResponseCache;
  cache.clear();
  const targetStandard = runWithMetingRequestContext(
    { roomId: 'ROOM1' },
    () => metingUpstreamTest.buildMetingCacheKey({ server: 'netease', type: 'url', id: '21038564', quality: 'standard' }, {}),
  );
  const targetLossless = runWithMetingRequestContext(
    { roomId: 'ROOM2' },
    () => metingUpstreamTest.buildMetingCacheKey({ server: 'netease', type: 'url', id: '21038564', quality: 'lossless' }, {}),
  );
  const targetLyrics = runWithMetingRequestContext(
    { roomId: 'ROOM1' },
    () => metingUpstreamTest.buildMetingCacheKey({ server: 'netease', type: 'lrc', id: '21038564' }, {}),
  );
  const otherSongUrl = runWithMetingRequestContext(
    { roomId: 'ROOM1' },
    () => metingUpstreamTest.buildMetingCacheKey({ server: 'netease', type: 'url', id: '999999', quality: 'standard' }, {}),
  );

  cache.set(targetStandard, { status: 200, body: '{"url":"https://cdn.example/1.mp3"}' }, 60_000);
  cache.set(targetLossless, { status: 200, body: '{"url":"https://cdn.example/2.flac"}' }, 60_000);
  cache.set(targetLyrics, { status: 200, body: '[00:00.00]test' }, 60_000);
  cache.set(otherSongUrl, { status: 200, body: '{"url":"https://cdn.example/other.mp3"}' }, 60_000);

  const removed = invalidateMetingUrlCache('netease', '21038564');
  assert.equal(removed, 2);
  assert.equal(cache.size(), 2);
  cache.clear();
});
