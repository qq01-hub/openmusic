import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicOutboundTarget, fetchPinnedPublicUrl } from './mediaProxy.js';
import { isAiApiBaseUrlBlocked, fetchAiProviderModels } from './aiModelService.js';
import { previewCustomMusicApi } from './customMusicApi.js';

const fakeLookup = (records) => async () => records;
const PUBLIC_RECORDS = [{ address: '93.184.216.34', family: 4 }];
const PRIVATE_RECORDS = [{ address: '10.1.2.3', family: 4 }];
const lookupFn = fakeLookup(PUBLIC_RECORDS);

test('外发 POST 按 UTF-8 字节数补充 Content-Length 并保留调用方请求头', async () => {
  const headers = { Accept: 'application/json' };
  const body = '点歌';
  await fetchPinnedPublicUrl('https://api.example.com', {
    method: 'POST', headers, body, lookupFn,
    requestFn: async (_target, sentHeaders) => {
      assert.equal(Number(sentHeaders['Content-Length']), Buffer.byteLength(body));
      return new Response(null);
    },
  });
  assert.deepEqual(headers, { Accept: 'application/json' });
});

test('默认拒绝重定向并取消响应体', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    status: 302, headers: { Location: '/new' },
  });
  await assert.rejects(fetchPinnedPublicUrl('https://api.example.com', {
    lookupFn, requestFn: async () => response,
  }), /不允许重定向/);
  assert.equal(cancelled, true);
});

test('跨域重定向剥离凭据并将 POST 改为 GET', async () => {
  const requests = [];
  const response = await fetchPinnedPublicUrl('https://api.example.com/start', {
    lookupFn, redirect: 'follow', method: 'POST', body: 'data',
    headers: { Authorization: 'test', Cookie: 'test', 'Proxy-Authorization': 'test', 'Content-Type': 'text/plain', Accept: 'text/plain' },
    requestFn: async ({ parsed }, headers, _signal, _timeout, options) => {
      requests.push({ url: parsed.href, headers, ...options });
      if (requests.length === 1) return new Response(null, { status: 302, headers: { Location: 'https://relay.example.com/next' } });
      return new Response('ok');
    },
  });
  assert.equal(await response.text(), 'ok');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], { url: 'https://relay.example.com/next', headers: { Accept: 'text/plain' }, method: 'GET', body: undefined });
});

test('每跳重新校验并拒绝内网和元数据地址', async () => {
  for (const destination of ['http://10.0.0.1', 'http://169.254.169.254/latest/meta-data', 'https://private.example.com']) {
    let requests = 0;
    await assert.rejects(fetchPinnedPublicUrl('https://api.example.com', {
      lookupFn: async (hostname) => hostname === 'private.example.com' ? PRIVATE_RECORDS : PUBLIC_RECORDS,
      redirect: 'follow',
      requestFn: async () => {
        requests += 1;
        return new Response(null, { status: 307, headers: { Location: destination } });
      },
    }), /禁止访问内网地址/);
    assert.equal(requests, 1);
  }
});

test('同源 307 保留方法、认证以及调用方显式设置的请求体传输头', async () => {
  for (const headers of [
    { Authorization: 'test', 'content-length': '4' },
    { Authorization: 'test', 'TRANSFER-ENCODING': 'chunked' },
  ]) {
    let requests = 0;
    await fetchPinnedPublicUrl('https://api.example.com/start', {
      method: 'POST', body: Buffer.from('test'), headers, lookupFn, redirect: 'follow',
      requestFn: async ({ parsed }, sentHeaders, _signal, _timeout, { method, body }) => {
        assert.deepEqual(sentHeaders, headers);
        assert.equal(method, 'POST');
        assert.equal(body.toString(), 'test');
        requests += 1;
        if (parsed.pathname === '/start') return new Response(null, { status: 307, headers: { Location: '/next' } });
        return new Response(null);
      },
    });
    assert.equal(requests, 2);
  }
});

test('外发重定向拒绝缺失 Location 或超过跳数限制', async () => {
  await assert.rejects(fetchPinnedPublicUrl('https://api.example.com', {
    lookupFn, redirect: 'follow', requestFn: async () => new Response(null, { status: 302 }),
  }), /缺少 Location/);
  let requests = 0;
  await assert.rejects(fetchPinnedPublicUrl('https://api.example.com', {
    lookupFn, redirect: 'follow', maxRedirects: 1,
    requestFn: async () => {
      requests += 1;
      return new Response(null, { status: 308, headers: { Location: '/loop' } });
    },
  }), /重定向次数超出限制/);
  assert.equal(requests, 2);
});

test('外发目标校验：IP 字面量内网/元数据地址一律拒绝（不发网络请求）', async () => {
  for (const url of [
    'http://127.0.0.1:8080/v1',
    'http://10.0.0.5/v1',
    'http://172.16.0.9/v1',
    'http://192.168.1.1/v1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/v1',
  ]) {
    await assert.rejects(() => assertPublicOutboundTarget(url), /禁止访问内网地址/, url);
  }
});

test('外发目标校验：元数据与本地域名主机名拒绝', async () => {
  for (const url of [
    'http://metadata.google.internal/v1',
    'http://metadata/v1',
    'http://localhost:11434/v1',
    'https://example.local/v1',
    'https://host.internal/v1',
  ]) {
    await assert.rejects(() => assertPublicOutboundTarget(url), /禁止访问内网地址/, url);
  }
});

test('外发目标校验：域名解析到私网时拒绝（DNS 重绑定/TOCTOU）', async () => {
  await assert.rejects(
    () => assertPublicOutboundTarget('https://evil.example.com/v1', { lookupFn: fakeLookup(PRIVATE_RECORDS) }),
    /禁止访问内网地址/,
  );
  await assert.rejects(
    () => fetchPinnedPublicUrl('http://169.254.169.254/latest/meta-data'),
    /禁止访问内网地址/,
  );
});

test('外发目标校验：公网域名 + 公网解析结果放行并返回钉扎地址', async () => {
  const { parsed, addresses } = await assertPublicOutboundTarget('https://api.example.com/v1/chat', {
    lookupFn: fakeLookup(PUBLIC_RECORDS),
  });
  assert.equal(parsed.hostname, 'api.example.com');
  assert.deepEqual(addresses, PUBLIC_RECORDS);
});

test('外发目标校验：非 http/https 与 URL 内嵌凭据拒绝', async () => {
  await assert.rejects(() => assertPublicOutboundTarget('ftp://api.example.com/v1'), /不支持的协议/);
  await assert.rejects(
    () => assertPublicOutboundTarget('https://user:pass@api.example.com/v1', { lookupFn: fakeLookup(PUBLIC_RECORDS) }),
    /不能包含认证信息/,
  );
});

test('AI baseUrl 黑名单：内网/元数据被拒，公网放行', () => {
  assert.equal(isAiApiBaseUrlBlocked('http://169.254.169.254/v1'), true);
  assert.equal(isAiApiBaseUrlBlocked('http://127.0.0.1:11434/v1'), true);
  assert.equal(isAiApiBaseUrlBlocked('https://metadata.google.internal/v1'), true);
  assert.equal(isAiApiBaseUrlBlocked('http://192.168.1.10:8000/v1'), true);
  assert.equal(isAiApiBaseUrlBlocked('https://api.openai.com/v1'), false);
  assert.equal(isAiApiBaseUrlBlocked('https://api.siliconflow.cn/v1'), false);
});

test('AI 拉模型列表：内网 baseUrl 在发请求前被拒', async () => {
  const result = await fetchAiProviderModels({ apiBaseUrl: 'http://169.254.169.254/v1', apiKey: 'sk-test' });
  assert.equal(result.success, false);
  assert.match(result.error, /Base URL/);
});

test('自定义音源：内网目标在配置/请求前被拒', async () => {
  await assert.rejects(
    () => previewCustomMusicApi({
      platforms: ['netease'],
      operations: ['search'],
      method: 'GET',
      url: 'http://127.0.0.1:9000/search?keyword={{keyword}}',
    }, { keyword: 'x' }),
    /不允许指向内网或云元数据地址/,
  );
});
