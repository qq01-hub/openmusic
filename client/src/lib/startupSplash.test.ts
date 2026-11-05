import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAuroraSpectrumBars,
  isStartupSplashDismissKey,
  sampleAuroraWaveTarget,
} from './startupSplash';

test('启动页仅接受 Enter 和 Space 键进入应用', () => {
  assert.equal(isStartupSplashDismissKey('Enter'), true);
  assert.equal(isStartupSplashDismissKey(' '), true);
  assert.equal(isStartupSplashDismissKey('Spacebar'), true);
  assert.equal(isStartupSplashDismissKey('Escape'), false);
});

test('K2 极光频谱生成多波峰起伏而非单调静态分布', () => {
  const bars = createAuroraSpectrumBars(74);
  assert.equal(bars.length, 74);
  assert.equal(bars[0]!.edge, 0);
  assert.ok(bars[bars.length - 1]!.edge < 1e-6);
  assert.ok(bars[36]!.edge > 0.95);

  const samples = bars.map((b) => sampleAuroraWaveTarget(b.u, b.edge, 2.8, 0.7, 1));
  const inner = samples.slice(10, -10);
  const maxVal = Math.max(...inner);
  const minVal = Math.min(...inner);
  assert.ok(maxVal - minVal > 0.25, '中间频谱段应具备鲜明的波峰波谷落差');
});
