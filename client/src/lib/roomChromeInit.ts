
let chromeInitDone = false;

function initMineradioControlGlassSurface() {
  const normalizeOffset = (value: number) => String(-Math.round(value));

  const supportsControlGlassSvgFilter = () => {
    try {
      const ua = navigator.userAgent || '';
      if ((/Safari/.test(ua) && !/Chrome/.test(ua)) || /Firefox/.test(ua)) return false;
      const div = document.createElement('div');
      div.style.backdropFilter = 'url(#mineradio-control-glass-filter)';
      return div.style.backdropFilter !== '';
    } catch {
      return false;
    }
  };

  const generateControlGlassDisplacementMap = (width: number, height: number, radius: number) => {
    const safeWidth = Math.max(240, Math.round(width || 400));
    const safeHeight = Math.max(48, Math.round(height || 92));
    const safeRadius = Math.max(12, Math.round(radius || 50));
    const borderWidth = 0.07;
    const edge = Math.min(safeWidth, safeHeight) * (borderWidth * 0.5);
    const innerW = Math.max(1, safeWidth - edge * 2);
    const innerH = Math.max(1, safeHeight - edge * 2);
    const svg =
      `<svg viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg">` +
      '<defs>' +
      '<linearGradient id="glass-red" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>' +
      '<linearGradient id="glass-blue" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient>' +
      '</defs>' +
      `<rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" fill="black"/>` +
      `<rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" rx="${safeRadius}" fill="url(#glass-red)"/>` +
      `<rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" rx="${safeRadius}" fill="url(#glass-blue)" style="mix-blend-mode:difference"/>` +
      `<rect x="${edge.toFixed(2)}" y="${edge.toFixed(2)}" width="${innerW.toFixed(2)}" height="${innerH.toFixed(2)}" rx="${safeRadius}" fill="hsl(0 0% 50% / 1)" style="filter:blur(11px)"/>` +
      '</svg>';
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };

  const controlGlassState = { key: '', searchBoxKey: '', searchPillKey: '' };

  const updateGlassDisplacementMapForElement = (
    element: HTMLElement | null,
    image: SVGImageElement | null,
    stateKey: keyof typeof controlGlassState,
  ) => {
    if (!element || !image) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const radius = parseFloat(getComputedStyle(element).borderRadius) || 24;
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}:${Math.round(radius)}`;
    if (key === controlGlassState[stateKey]) return;
    controlGlassState[stateKey] = key;
    const href = generateControlGlassDisplacementMap(rect.width, rect.height, radius);
    image.setAttribute('href', href);
    try {
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
    } catch {
      // ignore
    }
  };

  const applyControlGlassChromaticOffset = (offset = 90) => {
    const filter = document.getElementById('mineradio-control-glass-filter');
    if (!filter) return;
    const dx = normalizeOffset(offset);
    filter.querySelectorAll('feOffset').forEach((node) => {
      node.setAttribute('dx', dx);
      node.setAttribute('dy', '0');
    });
  };

  const updateControlGlassDisplacementMap = () => {
    updateGlassDisplacementMapForElement(
      document.getElementById('bottom-bar') as HTMLElement | null,
      document.getElementById('control-glass-map') as SVGImageElement | null,
      'key',
    );
  };

  const updateSearchBoxGlassDisplacementMap = () => {
    updateGlassDisplacementMapForElement(
      document.getElementById('search-box') as HTMLElement | null,
      document.getElementById('search-box-glass-map') as SVGImageElement | null,
      'searchBoxKey',
    );
  };

  const updateSearchPillGlassDisplacementMap = () => {
    const image = document.getElementById('search-pill-glass-map') as SVGImageElement | null;
    if (!image) return;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('#search-mode-tabs button,.search-history-chip'));
    if (!nodes.length) return;
    let maxW = 0;
    let maxH = 0;
    let maxRadius = 14;
    nodes.forEach((element) => {
      if (element.offsetParent === null) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      maxW = Math.max(maxW, rect.width);
      maxH = Math.max(maxH, rect.height);
      maxRadius = Math.max(
        maxRadius,
        parseFloat(getComputedStyle(element).borderRadius) || Math.round(rect.height / 2) || 14,
      );
    });
    if (maxW < 2 || maxH < 2) return;
    const width = Math.max(96, Math.round(maxW));
    const height = Math.max(32, Math.round(maxH));
    const radius = Math.max(12, Math.min(Math.round(maxRadius), Math.round(height / 2) + 10));
    const key = `${width}x${height}:${radius}`;
    if (key === controlGlassState.searchPillKey) return;
    controlGlassState.searchPillKey = key;
    const href = generateControlGlassDisplacementMap(width, height, radius);
    image.setAttribute('href', href);
    try {
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
    } catch {
      // ignore
    }
  };

  const refreshAll = () => {
    updateControlGlassDisplacementMap();
    updateSearchBoxGlassDisplacementMap();
    updateSearchPillGlassDisplacementMap();
  };

  // Replacing an feImage data URL makes DevTools register a new resource load.
  // Wait for a resize gesture to settle so dragging a panel does not reload it every frame.
  let resizeRefreshTimer: number | undefined;
  let searchPillRefreshFrame = 0;
  const scheduleSearchPillRefresh = () => {
    if (searchPillRefreshFrame) return;
    searchPillRefreshFrame = requestAnimationFrame(() => {
      searchPillRefreshFrame = 0;
      updateSearchPillGlassDisplacementMap();
    });
  };
  const refreshAfterResizeSettles = () => {
    if (resizeRefreshTimer !== undefined) {
      window.clearTimeout(resizeRefreshTimer);
    }
    resizeRefreshTimer = window.setTimeout(() => {
      resizeRefreshTimer = undefined;
      refreshAll();
    }, 180);
  };

  if (supportsControlGlassSvgFilter()) {
    document.documentElement.classList.add('control-glass-svg-ok');
  }
  applyControlGlassChromaticOffset();
  refreshAll();

  const bottomBar = document.getElementById('bottom-bar');
  const searchBox = document.getElementById('search-box');
  const searchTabs = document.getElementById('search-mode-tabs');
  const searchResults = document.getElementById('search-results');

  if (window.ResizeObserver && (bottomBar || searchBox || searchTabs || searchResults)) {
    const observer = new ResizeObserver(() => {
      refreshAfterResizeSettles();
    });
    if (bottomBar) observer.observe(bottomBar);
    if (searchBox) observer.observe(searchBox);
    if (searchTabs) observer.observe(searchTabs);
    if (searchResults) observer.observe(searchResults);
  }

  if (window.MutationObserver && (searchTabs || searchResults)) {
    const observer = new MutationObserver(() => {
      scheduleSearchPillRefresh();
    });
    if (searchTabs) observer.observe(searchTabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (searchResults) observer.observe(searchResults, { childList: true, subtree: true });
  }

  window.addEventListener('resize', () => {
    refreshAfterResizeSettles();
  });

  [0, 80, 240, 800, 1600].forEach((delay) => {
    window.setTimeout(refreshAll, delay);
  });
}

/** 房间页专用：底栏玻璃位移图（仅初始化一次） */
export function ensureRoomChromeInit() {
  if (chromeInitDone) return;
  chromeInitDone = true;
  initMineradioControlGlassSurface();
}

/** TV 模式保留独立初始化入口 */
export function ensureTvChromeInit() {
  if (chromeInitDone) return;
  chromeInitDone = true;
}
