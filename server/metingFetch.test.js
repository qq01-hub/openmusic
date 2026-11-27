import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { fetchMeting, isAllowedMetingUrl } from './metingFetch.js';

test('Docker Meting 可信别名允许 HTTP，其他非本机地址仍拒绝', async (context) => {
  const originalEnv = { DOCKER_REDIS_URL: process.env.DOCKER_REDIS_URL, DOCKER_METING_URL: process.env.DOCKER_METING_URL };
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: 'http://public.example/api' });
        response.end();
        return;
      }
      response.writeHead(request.headers.authorization === 'Bearer test-token' ? 200 : 401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ path: request.url, method: request.method, body: Buffer.concat(chunks).toString() }));
    });
  });
  try {
    process.env.DOCKER_REDIS_URL = 'redis://redis:6379/0';
    process.env.DOCKER_METING_URL = 'http://meting-api:3000';
    const trustedUrls = ['http://meting-api:3000/api?type=song', 'http://meting:3000/api/admin/cookies'];
    for (const url of trustedUrls) assert.equal(isAllowedMetingUrl(url), true, url);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const originalRequest = http.request;
    const requestedHosts = [];
    context.mock.method(http, 'request', (options, callback) => {
      requestedHosts.push(options.hostname);
      assert.equal(String(options.port), '3000');
      return originalRequest({ ...options, hostname: '127.0.0.1', port: server.address().port }, callback);
    });
    const headers = { Authorization: 'Bearer test-token' };
    const songResponse = await fetchMeting(trustedUrls[0], { headers }, 1000);
    assert.equal(songResponse.status, 200);
    assert.deepEqual(await songResponse.json(), { path: '/api?type=song', method: 'GET', body: '' });
    const adminResponse = await fetchMeting(trustedUrls[1], { method: 'POST', headers, body: '{"platform":"netease"}' }, 1000);
    assert.equal(adminResponse.status, 200);
    assert.deepEqual(await adminResponse.json(), { path: '/api/admin/cookies', method: 'POST', body: '{"platform":"netease"}' });
    const unauthenticated = await fetchMeting(trustedUrls[0], {}, 1000);
    assert.equal(unauthenticated.status, 401);
    const redirect = await fetchMeting('http://meting-api:3000/redirect', { headers }, 1000);
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'http://public.example/api');
    const requestCount = requestedHosts.length;
    const deniedUrls = [
      'http://public.example/api', 'http://192.168.1.10:3000/api', 'http://169.254.169.254/',
      'http://meting-api.evil.example:3000/api', 'http://meting-api:3001/api', 'http://meting-api/api',
      'http://meting-api:3000@public.example/api', 'http://user:password@meting-api:3000/api',
      'http://meting-api-audio-loudness:3100/analyze',
    ];
    for (const url of deniedUrls) {
      assert.equal(isAllowedMetingUrl(url), false, url);
      await assert.rejects(fetchMeting(url, { headers }), /禁止使用 HTTP/);
    }
    assert.equal(requestedHosts.length, requestCount);
    for (const configuredUrl of ['http://meting:3000', 'http://meting-api:3000']) {
      process.env.DOCKER_METING_URL = configuredUrl;
      for (const url of trustedUrls) assert.equal(isAllowedMetingUrl(url), true, url);
    }
    for (const configuredUrl of ['', 'invalid', 'http://public.example:3000', 'http://192.168.1.10:3000', 'https://meting-api:3000', 'http://meting-api:3001', 'http://user:password@meting-api:3000']) {
      process.env.DOCKER_METING_URL = configuredUrl;
      for (const url of trustedUrls) assert.equal(isAllowedMetingUrl(url), false, configuredUrl);
    }
    process.env.DOCKER_METING_URL = 'http://meting-api:3000';
    delete process.env.DOCKER_REDIS_URL;
    for (const url of trustedUrls) assert.equal(isAllowedMetingUrl(url), false, url);
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://public.example/api']) assert.equal(isAllowedMetingUrl(url), true, url);
    assert.equal(isAllowedMetingUrl('ftp://meting-api:3000'), false);
  } finally {
    context.mock.restoreAll();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});

test('fetchMeting 默认声明压缩传输并透明解压 gzip/br/deflate 响应且限制解压体积', async () => {
  const payload = JSON.stringify({ ok: true, items: Array.from({ length: 40 }, (_, index) => ({ id: index, title: `曲目-${index}` })) });
  const receivedAcceptEncodings = [];
  const server = http.createServer((request, response) => {
    receivedAcceptEncodings.push({ url: request.url, acceptEncoding: request.headers['accept-encoding'] || '' });
    if (request.url === '/gzip') {
      const compressed = gzipSync(Buffer.from(payload));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': String(compressed.length) });
      response.end(compressed);
      return;
    }
    if (request.url === '/br') {
      const compressed = brotliCompressSync(Buffer.from(payload));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'br', 'Content-Length': String(compressed.length) });
      response.end(compressed);
      return;
    }
    if (request.url === '/deflate') {
      const compressed = deflateSync(Buffer.from(payload));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'deflate' });
      response.end(compressed);
      return;
    }
    if (request.url === '/empty-gzip') {
      response.writeHead(302, { Location: 'https://cdn.example/song.mp3', 'Content-Encoding': 'gzip' });
      response.end();
      return;
    }
    if (request.url === '/bomb') {
      const compressed = gzipSync(Buffer.alloc(16 * 1024, 'a'));
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
      response.end(compressed);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(payload);
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    for (const pathName of ['/gzip', '/br', '/deflate']) {
      const response = await fetchMeting(`${baseUrl}${pathName}`, {}, 2000);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-encoding'), null);
      assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(payload)));
      assert.deepEqual(await response.json(), JSON.parse(payload));
    }

    const emptyRedirect = await fetchMeting(`${baseUrl}/empty-gzip`, {}, 2000);
    assert.equal(emptyRedirect.status, 302);
    assert.equal(emptyRedirect.headers.get('location'), 'https://cdn.example/song.mp3');
    assert.equal(await emptyRedirect.text(), '');

    const customIdentity = await fetchMeting(`${baseUrl}/plain`, { headers: { 'Accept-Encoding': 'identity' } }, 2000);
    assert.equal(customIdentity.status, 200);
    assert.deepEqual(await customIdentity.json(), JSON.parse(payload));

    await assert.rejects(fetchMeting(`${baseUrl}/bomb`, { maxResponseBytes: 1024 }, 2000), /Meting 响应过大/);

    assert.match(receivedAcceptEncodings[0].acceptEncoding, /br/);
    assert.match(receivedAcceptEncodings[0].acceptEncoding, /gzip/);
    assert.equal(receivedAcceptEncodings.find((item) => item.url === '/plain')?.acceptEncoding, 'identity');
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchMeting 在复用的空闲长连接被对端重置时自动重试一次', async () => {
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    if (requestCount === 2) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'keep-alive' });
    response.end(JSON.stringify({ attempt: requestCount }));
  });
  server.keepAliveTimeout = 60_000;

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const first = await fetchMeting(`${baseUrl}/warm`, {}, 2000);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { attempt: 1 });

    const second = await fetchMeting(`${baseUrl}/reused`, {}, 2000);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { attempt: 3 });
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});
