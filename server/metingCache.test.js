import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetingResponseCache } from './metingCache.js';
import { __test as metingUpstreamTest, runWithMetingRequestContext } from './metingUpstream.js';

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

test('不同房间的 URL 缓存键保持隔离', async () => {
  const makeKey = (roomId) => runWithMetingRequestContext(
    { roomId },
    () => metingUpstreamTest.buildMetingCacheKey(
      { server: 'netease', type: 'url', id: '1', quality: 'high' },
      {},
    ),
  );

  assert.notEqual(await makeKey('ROOM1'), await makeKey('ROOM2'));
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
