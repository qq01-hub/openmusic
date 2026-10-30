import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const serverSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../client/src/components/MusicContributionModal.tsx', import.meta.url), 'utf8');
const roomPanelSource = readFileSync(new URL('../client/src/components/RoomMusicAccountPanel.tsx', import.meta.url), 'utf8');
// 普通网页需要同源存储能力，鸿蒙媒体桥接模式必须隔离顶层令牌
const secondVerifyEmbeds = [['MusicContributionModal.tsx', modalSource], ['RoomMusicAccountPanel.tsx', roomPanelSource]];
const sandboxSource = readFileSync(new URL('../client/src/lib/harmonyMediaSession.ts', import.meta.url), 'utf8');

function verificationSandbox(harmony) {
  const marker = 'export function getMusicVerificationSandbox(): string {';
  const start = sandboxSource.indexOf(marker);
  assert.ok(start >= 0, '缺少验证 iframe 权限函数');
  const end = sandboxSource.indexOf('\n}', start);
  assert.ok(end > start, '验证 iframe 权限函数不完整');
  const fn = sandboxSource.slice(start, end + 2).replace(marker, 'function getMusicVerificationSandbox() {');
  return runInNewContext(`${fn}\ngetMusicVerificationSandbox()`, { window: { __OPENMUSIC_HARMONY_APP__: harmony } });
}

const assetRouteStart = serverSource.indexOf("app.get('/api/music-account-contribution/qr/verify/:asset'");

function routeBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const end = source.indexOf('\n});', start);
  return source.slice(start, end < 0 ? source.length : end);
}

test('二次验证静态资源路由与会话身份解耦，iframe 子资源不会因 401 中断脚本', () => {
  assert.ok(assetRouteStart >= 0, '缺少汽水验证静态资源路由');
  const block = routeBlock(serverSource, "app.get('/api/music-account-contribution/qr/verify/:asset'");
  assert.equal(block.includes('requireSessionIdentity('), false);
  for (const asset of ['security_host.html', 'react.js', 'react-dom.js', 'sdk-glue.js', 'bdms.js']) {
    assert.ok(block.includes(`'${asset}'`), `白名单缺少 ${asset}`);
  }
});

test('扫码验证桥接接口仍然强制校验会话身份', () => {
  for (const route of ['start', 'request', 'complete']) {
    const block = routeBlock(serverSource, `app.post('/api/music-account-contribution/qr/verify/${route}'`);
    assert.ok(block.length > 0, `缺少 /verify/${route} 路由`);
    assert.equal(block.includes('requireSessionIdentity('), true, `/verify/${route} 必须校验会话身份`);
  }
});

test('普通网页二次验证 iframe 保留官方 SDK 所需的脚本与同源权限', () => {
  for (const [name, source] of secondVerifyEmbeds) {
    assert.ok(source.includes("import { getMusicVerificationSandbox } from '../lib/harmonyMediaSession'"), `${name} 未导入统一权限函数`);
    assert.ok(source.includes('sandbox={getMusicVerificationSandbox()}'), `${name} 未使用统一权限函数`);
    const sandbox = verificationSandbox(false);
    const tokens = sandbox.split(/\s+/).filter(Boolean);
    for (const token of ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox']) {
      assert.ok(tokens.includes(token), `${name} 的验证 iframe 缺少 ${token}`);
    }
    assert.equal(tokens.includes('allow-same-origin'), true, `${name} 的验证 iframe 仍是 opaque origin`);
  }
});

test('鸿蒙二次验证 iframe 保留交互能力并隔离顶层媒体令牌', () => {
  const tokens = verificationSandbox(true).split(/\s+/).filter(Boolean);
  for (const token of ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox']) {
    assert.ok(tokens.includes(token), `鸿蒙验证 iframe 缺少 ${token}`);
  }
  assert.equal(tokens.includes('allow-same-origin'), false, '鸿蒙验证 iframe 不得访问顶层令牌');
});
