import assert from 'node:assert/strict';

const originals = new Map(['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const frames = new Map<number, FrameRequestCallback>();
const canvases = new Set<object>();
const listeners = new Map<string, () => void>();
let frameId = 0;
let paths = 0;
let images = 0;
let reducedMotion = false;
const noop = () => {};
const host = { clientWidth: 480, clientHeight: 640, isConnected: true, appendChild: (canvas: object) => canvases.add(canvas) };
const fakeDocument = {
  hidden: false,
  body: host,
  documentElement: { clientWidth: 480, clientHeight: 640, style: { setProperty: noop } },
  getElementById: () => null,
  addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
  removeEventListener: (name: string) => listeners.delete(name),
  createElement: () => {
    const context = new Proxy({
      font: '96px sans-serif',
      measureText(text: string) { return { width: Array.from(text).reduce((width, character) => width + (/^[\x00-\x7F]$/u.test(character) ? 0.55 : 1), 0) * Number(this.font.match(/([\d.]+)px/)?.[1] ?? 96) }; },
      createLinearGradient: () => ({ addColorStop: noop }),
      beginPath: () => { paths += 1; },
      drawImage: () => { images += 1; },
    }, { get: (target, key) => Reflect.get(target, key) ?? noop });
    const canvas = { width: 0, height: 0, style: {}, getContext: () => context, remove: () => canvases.delete(canvas) };
    return canvas;
  },
};

try {
  Object.assign(globalThis, {
    document: fakeDocument,
    window: { innerWidth: 480, innerHeight: 640, devicePixelRatio: 2, matchMedia: () => ({ matches: reducedMotion }) },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (handle: number) => frames.delete(handle),
  });
  const { buildLyricMaskAsset, wrapLyricTrackText, LYRIC_ROW_FIT_BUDGET_W } = await import('../src/components/galaxy/lib/galaxyStageLyricMaterial');
  const { createLyricRowTrack, syncLyricRowTrackLayout, invalidateLyricRowTrack, updateLyricRowTrack } = await import('../src/components/galaxy/lib/galaxyLyricRowTrack');
  const { roomVisualFxLive } = await import('../src/lib/roomVisualFxLive');
  const { fireWelcomeConfetti } = await import('../src/lib/confettiBurst');
  const short = '短句';
  const long = '长歌词仍然需要清晰可读，不能挤压整叠歌词的字号。'.repeat(3);
  const options = { worldScale: 'row' as const, fitBudgetW: LYRIC_ROW_FIT_BUDGET_W };
  for (const text of [short, long, 'This is a long translated lyric with words that should not break in the middle. '.repeat(3), '😀'.repeat(60)]) {
    const mask = buildLyricMaskAsset(text, null, false, { ...options, rows: [{ text, active: true }] });
    assert.equal(mask.fontSize, 96);
    assert.equal(mask.activeCenterOffset, 0);
    assert.ok(mask.logicalWidth <= LYRIC_ROW_FIT_BUDGET_W + 112);
    assert.equal(mask.lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    assert.ok(!mask.lines.some((line) => /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u.test(line)));
    mask.texture.dispose();
  }
  const ctx = fakeDocument.createElement().getContext() as unknown as CanvasRenderingContext2D;
  assert.deepEqual(wrapLyricTrackText(ctx, ''), []);
  assert.deepEqual(wrapLyricTrackText(ctx, '短句\r\n下一句'), ['短句', '下一句']);
  const narrow = buildLyricMaskAsset(long, null, false, { ...options, fitBudgetW: 640, rows: [{ text: long, active: true }] });
  assert.ok(narrow.fontSize >= 80);
  assert.ok(narrow.lines.length > 3);
  assert.equal(narrow.lines.join(''), long);
  narrow.texture.dispose();
  const track = createLyricRowTrack();
  const fx = { ...roomVisualFxLive.current, lyricTranslationMode: 'multi' as const };
  syncLyricRowTrackLayout(track, [{ text: short }, { text: long, translation: 'A long translation. '.repeat(8) }, { text: short }], fx, 1, 3, 'check');
  for (let index = 1; index < track.slots.length; index += 1) {
    const previous = track.slots[index - 1]!;
    const current = track.slots[index]!;
    assert.ok(previous.unitY - current.unitY >= (previous.height + current.height) / 2);
  }
  const metrics = updateLyricRowTrack(track, { fx, activeIndex: 1, visibleIndexes: [0, 1, 2], ownedLines: new Set([1]), dt: 1 / 60, time: 0, allowBuild: false });
  assert.ok(metrics.stackHeight > 2);
  assert.ok(metrics.activeHeight > track.slotByLine.get(1)!.height * 6.1 / 1200 * 96);
  invalidateLyricRowTrack(track, 'new-font');
  assert.equal(track.layoutSignature, '');
  assert.equal(track.lineHeights.size, 0);
  syncLyricRowTrackLayout(track, [{ text: long }], fx, 0, 1, 'narrow', 640);
  assert.ok(track.slots[0]!.height > 3 * 1.04);
  assert.equal(track.fitBudgetW, 640);

  for (let index = 0; index < 3; index += 1) fireWelcomeConfetti(host as unknown as HTMLElement);
  assert.equal(canvases.size, 1);
  assert.equal(frames.size, 1);
  assert.equal((canvases.values().next().value as { width: number }).width, 480);
  paths = 0;
  const [handle, callback] = frames.entries().next().value!;
  frames.delete(handle);
  callback(performance.now() + 250);
  assert.equal(paths, 0);
  assert.ok(images > 0);
  fakeDocument.hidden = true;
  listeners.get('visibilitychange')?.();
  assert.equal(canvases.size, 0);
  assert.equal(frames.size, 0);
  fakeDocument.hidden = false;
  fireWelcomeConfetti(host as unknown as HTMLElement);
  host.isConnected = false;
  const [detachedHandle, detachedCallback] = frames.entries().next().value!;
  frames.delete(detachedHandle);
  detachedCallback(performance.now() + 16);
  assert.equal(canvases.size, 0);
  assert.equal(frames.size, 0);
  host.isConnected = true;
  assert.equal(listeners.size, 0);
  fakeDocument.hidden = false;
  reducedMotion = true;
  fireWelcomeConfetti(host as unknown as HTMLElement);
  assert.equal(canvases.size, 0);
  reducedMotion = false;
  fireWelcomeConfetti(null, 0);
  const [lastHandle, lastCallback] = frames.entries().next().value!;
  frames.delete(lastHandle);
  lastCallback(performance.now() + 600);
  assert.equal(canvases.size, 0);
  assert.equal(frames.size, 0);
  console.log('Room visuals: lyric wrapping, translation spacing, burst coalescing, sprite rendering and cleanup passed.');
} finally {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
