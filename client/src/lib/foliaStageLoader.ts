type FoliaStageModule = { mountFolia: (container: Element) => () => void; preloadFoliaAssets?: () => Promise<unknown> };
type FoliaStageResources = { css: string[]; module: Promise<FoliaStageModule> };
let pending: Promise<FoliaStageResources> | undefined;
let importAttempt = 0;

const safeAsset = (value: unknown): value is string =>
  typeof value === 'string' && /^assets\/[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(value);

export function loadFoliaStage(): Promise<FoliaStageResources> {
  if (pending) return pending;
  const task: Promise<FoliaStageResources> = (async () => {
    const response = await fetch('/vendor/folia/stage.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Folia stage manifest unavailable');
    const manifest = await response.json() as { script?: unknown; css?: unknown; preload?: unknown };
    if (!safeAsset(manifest.script) || !manifest.script.endsWith('.js')
      || !Array.isArray(manifest.css) || !manifest.css.length || !manifest.css.every(value => safeAsset(value) && value.endsWith('.css'))
      || manifest.preload !== undefined && (!Array.isArray(manifest.preload) || !manifest.preload.every(value => safeAsset(value) && value.endsWith('.js')))) {
      throw new Error('Folia stage manifest invalid');
    }
    const css = manifest.css as string[];
    const imports = (manifest.preload || []) as string[];
    for (const asset of [...css, ...imports]) {
      const href = `/vendor/folia/${asset}`;
      if (document.head.querySelector(`link[data-folia-preload][href="${href}"]`)) continue;
      const link = document.createElement('link');
      link.dataset.foliaPreload = '';
      link.href = href;
      link.rel = asset.endsWith('.css') ? 'preload' : 'modulepreload';
      if (asset.endsWith('.css')) link.as = 'style';
      document.head.append(link);
      link.onerror = () => link.remove();
    }
    const url = new URL(`/vendor/folia/${manifest.script}`, location.origin);
    const attempt = importAttempt++;
    // 失败的动态导入可能被浏览器缓存，重试使用新 URL
    if (attempt > 0) url.searchParams.set('om_retry', String(attempt));
    const moduleUrl = url.href;
    let timer: number | undefined;
    const module = Promise.race([
      import(/* @vite-ignore */ moduleUrl) as Promise<FoliaStageModule>,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error('Folia stage module timeout')), 20000);
      }),
    ]).then(stage => {
      if (typeof stage.mountFolia !== 'function') throw new Error('Folia stage module invalid');
      return stage;
    }).finally(() => window.clearTimeout(timer));
    void module.catch(() => { if (pending === task) pending = undefined; });
    return { css, module };
  })();
  pending = task;
  void task.catch(() => { if (pending === task) pending = undefined; });
  return task;
}

export function preloadFoliaStage(): Promise<FoliaStageModule> {
  return loadFoliaStage().then(async resources => {
    const stage = await resources.module;
    // 主题预热是可选加速，主题仍由舞台自身的 Suspense 和错误边界负责加载
    void Promise.resolve().then(() => stage.preloadFoliaAssets?.()).catch(() => {
      console.warn('Folia 主题预热失败，将在舞台内加载');
    });
    return stage;
  });
}

export function resetFoliaStageLoader(): void {
  pending = undefined;
}
