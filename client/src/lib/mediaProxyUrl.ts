/** 音乐平台 CDN 域名（与服务端 mediaProxy 的允许列表保持一致） */
const MUSIC_CDN_DOMAINS = [
  '163.com', '126.net', 'netease.com',
  'qq.com', 'gtimg.com', 'gtimg.cn', 'tencentmusic.com',
  'kugou.com', 'kugou.net', 'kgimg.com', 'kgcdn.com', 'kgimg.net',
  // 汽水封面实际域名；必须带点匹配，不能用 includes('douyin')
  'douyinpic.com',
];

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 是否为已知音乐平台 CDN 主机（用于卡片封面白名单；与服务端 mediaProxy 一致） */
export function isAllowedCoverHostname(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  return MUSIC_CDN_DOMAINS.some((domain) => hostMatchesDomain(host, domain));
}

/**
 * 将第三方媒体 URL 转为同源 `/api/media-proxy`。
 * 仅用于：① 着色器背景下的歌曲播放（Web Audio 频谱）；② 封面背景 Canvas 采样（AmbientCoverLayers）。
 * 普通播放（off / cover-bg）与列表封面走直链或 `/api/meting`。
 */

const MEDIA_PROXY_PATH = '/api/media-proxy';

export function isProxiedMediaUrl(url: string): boolean {
  if (!url) return false;
  return url.startsWith(`${MEDIA_PROXY_PATH}?`);
}

/** 汽水鉴权解密端点禁止套 media-proxy：解密只能在浏览器本地完成。 */
function isQishuiAudioEndpoint(url: string): boolean {
  let current = String(url || '').trim();
  for (let depth = 0; depth < 3 && current; depth += 1) {
    try {
      const parsed = new URL(current, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      if (/(?:^|\/)audio\/qishui\/?$/i.test(parsed.pathname)) return true;
      if (!isProxiedMediaUrl(current)) return false;
      current = parsed.searchParams.get('url') || '';
    } catch {
      return false;
    }
  }
  return false;
}

/** 从代理 URL 取出原始外链（测试/调试） */
export function unwrapProxiedMediaUrl(url: string): string {
  if (!isProxiedMediaUrl(url)) return url;
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  return params.get('url') || url;
}

function isRelativeSameOriginUrl(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

function isInlineAssetUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

/** 是否为本站同源、无需再包一层 media-proxy 的地址 */
export function isSameOriginMediaUrl(url: string): boolean {
  if (!url || isInlineAssetUrl(url) || isProxiedMediaUrl(url)) return true;
  if (isRelativeSameOriginUrl(url)) return true;
  if (typeof window === 'undefined') return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

/** 是否需要走 media-proxy（外部 http/https） */
export function shouldProxyMediaUrl(url: string): boolean {
  if (!url || isSameOriginMediaUrl(url)) return false;
  if (isQishuiAudioEndpoint(url)) return false;
  if (toLocalMetingPicUrl(url)) return false;
  return /^https?:\/\//i.test(url);
}

export function isInsecureRemoteMediaUrl(url: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'http:';
  } catch {
    return false;
  }
}

export function isHttpsPageContext(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'https:';
}

/** HTTPS 页面播放 HTTP 直链会被混合内容策略拦截 */
export function shouldProxyInsecurePlaybackUrl(url: string): boolean {
  return isHttpsPageContext() && isInsecureRemoteMediaUrl(url);
}

/**
 * 播放地址是否应走同源代理：
 * - 沉浸/Web Audio 频谱模式
 * - HTTPS 站点上的 HTTP 音频（如酷狗直链）
 */
export function shouldProxyPlaybackUrl(url: string, visualModeProxy = false): boolean {
  return visualModeProxy || shouldProxyInsecurePlaybackUrl(url);
}

/**
 * Meting `type=pic|url` 外链 → 同源 `/api/meting`（勿经 media-proxy 直接包 127.0.0.1）
 */
export function toLocalMetingMediaUrl(url: string): string | null {
  if (!url || url.startsWith('/api/meting')) return url.startsWith('/api/meting') ? url : null;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, base);
    const type = parsed.searchParams.get('type');
    if (type !== 'pic' && type !== 'url') return null;
    const server = parsed.searchParams.get('server');
    const id = parsed.searchParams.get('id');
    if (!server || !id) return null;
    const query = new URLSearchParams({ server, type, id });
    const quality = parsed.searchParams.get('quality');
    if (quality) query.set('quality', quality);
    return `/api/meting?${query.toString()}`;
  } catch {
    return null;
  }
}

/** Meting `type=pic` 外链 → 同源 `/api/meting` */
export function toLocalMetingPicUrl(url: string): string | null {
  const local = toLocalMetingMediaUrl(url);
  if (!local) return null;
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return parsed.searchParams.get('type') === 'pic' ? local : null;
  } catch {
    return null;
  }
}

/** 歌曲播放地址走同源代理（HTTPS 站点避免混合内容） */
export function toProxiedAudioUrl(url: string): string {
  return toProxiedMediaUrl(url);
}

/**
 * 外部媒体走同源代理；本站 `/api/meting` 等相对路径保持原样。
 * 封面背景 Canvas 采样等场景使用；普通 `<img>` 封面请直接用 getCoverUrl。
 */
export function toProxiedMediaUrl(url: string): string {
  if (isQishuiAudioEndpoint(url) && isProxiedMediaUrl(url)) {
    return unwrapProxiedMediaUrl(url);
  }
  if (!url || !shouldProxyMediaUrl(url)) return url;
  const metingPic = toLocalMetingPicUrl(url);
  if (metingPic) return metingPic;
  return `${MEDIA_PROXY_PATH}?url=${encodeURIComponent(url)}`;
}

/** Canvas / WebGL / fetch 分析用，与 toProxiedMediaUrl 相同 */
export function toVisualMediaUrl(url: string): string {
  return toProxiedMediaUrl(url);
}

/** 沉浸式封面默认采样边长（对齐 Mineradio coverResolution 1.55 → 512） */
export const VISUAL_COVER_PIXEL_SIZE = 512;
