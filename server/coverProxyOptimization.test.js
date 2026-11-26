import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Readable } from 'node:stream';
import { resizeNeteaseCoverForProxy, stripNeteaseParam } from './coverUrl.js';
import { isAccountPublicPath } from './accountAccess.js';
import { serveUpstreamMedia } from './mediaProxy.js';
import { createRedisMaintenance } from './redisMaintenance.js';

function createMockRes() {
  const emitter = new EventEmitter();
  const headers = new Map([['vary', 'Origin, Cookie']]);
  return Object.assign(emitter, {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    body: null,
    set(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
      return this;
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    removeHeader(name) {
      headers.delete(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    end() {
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    header(name) {
      return headers.get(String(name).toLowerCase());
    },
  });
}

test('网易云代理缩略图按档位生成参数并保护带签名参数的地址', () => {
  assert.equal(
    resizeNeteaseCoverForProxy('https://p1.music.126.net/abc==/10995116.jpg', 96),
    'https://p1.music.126.net/abc==/10995116.jpg?param=96y96',
  );
  assert.equal(
    resizeNeteaseCoverForProxy('https://p2.music.126.net/abc==/10995116.jpg?param=50y50', 300),
    'https://p2.music.126.net/abc==/10995116.jpg?param=320y320',
  );
  assert.equal(
    resizeNeteaseCoverForProxy('https://p1.music.126.net/abc==/10995116.jpg?sig=123', 96),
    'https://p1.music.126.net/abc==/10995116.jpg?sig=123',
  );
  assert.equal(
    stripNeteaseParam('https://p1.music.126.net/abc==/10995116.jpg?param=96y96'),
    'https://p1.music.126.net/abc==/10995116.jpg',
  );
});

test('公开房间自定义封面路径放行 GET 且拒绝非 GET 与非法房间号', () => {
  assert.equal(isAccountPublicPath('/api/rooms/vcka7k/cover', 'GET'), true);
  assert.equal(isAccountPublicPath('/api/rooms/VCKA7K/cover', 'GET'), true);
  assert.equal(isAccountPublicPath('/api/rooms/vcka7k/cover', 'POST'), false);
  assert.equal(isAccountPublicPath('/api/rooms/x/cover', 'GET'), false);
});

test('公开封面缩略图拉取失败时自动回退原图并输出 CDN 可缓存响应头', async (t) => {
  const fetchedPaths = [];
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  t.mock.method(https, 'request', (requestOptions, onResponse) => {
    const reqPath = String(requestOptions?.path || '');
    fetchedPaths.push(reqPath);
    const clientReq = new EventEmitter();
    clientReq.setTimeout = () => clientReq;
    clientReq.destroy = () => clientReq;
    clientReq.end = () => {
      queueMicrotask(() => {
        const isThumb = reqPath.includes('param=96y96');
        const payload = isThumb ? Buffer.from('bad param') : imageBytes;
        const response = Readable.from([payload]);
        response.statusCode = isThumb ? 400 : 200;
        response.headers = isThumb
          ? { 'content-type': 'text/plain', 'content-length': String(payload.length) }
          : { 'content-type': 'image/jpeg', 'content-length': String(payload.length) };
        onResponse(response);
      });
    };
    return clientReq;
  });

  const resPublic = createMockRes();
  const ok = await serveUpstreamMedia(
    'https://93.184.216.34/fallback-test-1/cover.jpg?param=96y96',
    resPublic,
    null,
    {
      requireAllowlist: false,
      imageOnly: true,
      fallbackUrl: 'https://93.184.216.34/fallback-test-1/cover.jpg',
      publicCache: true,
      publicCacheMaxAgeSec: 86400,
    },
  );
  assert.equal(ok, true);
  assert.deepEqual(fetchedPaths, [
    '/fallback-test-1/cover.jpg?param=96y96',
    '/fallback-test-1/cover.jpg',
  ]);
  assert.equal(resPublic.statusCode, 200);
  assert.match(resPublic.header('cache-control') || '', /^public, max-age=86400,/);
  assert.equal(resPublic.header('cdn-cache-control'), 'public, max-age=86400');
  assert.equal(resPublic.header('surrogate-control'), undefined);
  assert.equal(resPublic.header('vary'), 'Origin');

  const resPrivate = createMockRes();
  const okCachedPrivate = await serveUpstreamMedia(
    'https://93.184.216.34/fallback-test-1/cover.jpg?param=96y96',
    resPrivate,
    null,
    {
      requireAllowlist: false,
      imageOnly: true,
      publicCache: false,
    },
  );
  assert.equal(okCachedPrivate, true);
  assert.equal(fetchedPaths.length, 2);
  assert.match(resPrivate.header('cache-control') || '', /^private, max-age=/);
  assert.equal(resPrivate.header('cdn-cache-control'), 'no-store');
  assert.equal(resPrivate.header('surrogate-control'), 'no-store');
});

test('Redis 维护任务完成全库 SCAN 一轮后在冷却期内不重复触发全库扫描', async () => {
  let nowMs = 1_000_000;
  let scanCalls = 0;
  const client = {
    isReady: true,
    async scan() {
      scanCalls += 1;
      return { cursor: '0', keys: [] };
    },
    async hScan() { return { cursor: '0', entries: [] }; },
    async sScan() { return { cursor: '0', members: [] }; },
    async eval() { return 0; },
    async zCard() { return 0; },
    async zRange() { return []; },
    async hKeys() { return []; },
  };
  const maintenance = createRedisMaintenance({ getClient: () => client, now: () => nowMs });
  await maintenance.runOnce();
  const firstRunScans = scanCalls;
  assert.ok(firstRunScans >= 2);

  nowMs += 60_000;
  await maintenance.runOnce();
  assert.equal(scanCalls, firstRunScans);

  nowMs += 31 * 60_000;
  await maintenance.runOnce();
  assert.ok(scanCalls > firstRunScans);
});
