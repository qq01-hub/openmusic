import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicOutboundTarget, fetchPinnedPublicUrl } from './mediaProxy.js';
import { isAiApiBaseUrlBlocked, fetchAiProviderModels } from './aiModelService.js';
import { previewCustomMusicApi } from './customMusicApi.js';

const fakeLookup = (records) => async () => records;
const PUBLIC_RECORDS = [{ address: '93.184.216.34', family: 4 }];
const PRIVATE_RECORDS = [{ address: '10.1.2.3', family: 4 }];

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
