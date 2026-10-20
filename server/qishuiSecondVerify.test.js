import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../client/src/components/MusicContributionModal.tsx', import.meta.url), 'utf8');
const roomPanelSource = readFileSync(new URL('../client/src/components/RoomMusicAccountPanel.tsx', import.meta.url), 'utf8');
// 汽水安全验证页有两个入口：贡献弹窗和房间音乐账号面板，两个 iframe 都必须同源。
const secondVerifyEmbeds = [['MusicContributionModal.tsx', modalSource], ['RoomMusicAccountPanel.tsx', roomPanelSource]];

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

test('二次验证 iframe 必须同源，官方 SDK 才能读写 localStorage / Cookie', () => {
  for (const [name, source] of secondVerifyEmbeds) {
    const sandbox = (source.match(/sandbox="([^"]*)"/) || [])[1] || '';
    const tokens = sandbox.split(/\s+/).filter(Boolean);
    for (const token of ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox']) {
      assert.ok(tokens.includes(token), `${name} 的验证 iframe 缺少 ${token}`);
    }
    assert.equal(tokens.includes('allow-same-origin'), true, `${name} 的验证 iframe 仍是 opaque origin`);
  }
});
