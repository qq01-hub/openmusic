export type CoverSize = 'tiny' | 'thumb' | 'medium' | 'full';

export const COVER_SIZE_PX: Record<Exclude<CoverSize, 'full'>, number> = {
  tiny: 48,
  thumb: 96,
  medium: 320,
};

const FALLBACK_COVER =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect fill="%23333" width="48" height="48"/><text x="24" y="28" text-anchor="middle" fill="%23666" font-size="16">♪</text></svg>';

function appendMetingThumbParam(url: string, px = 320): string {
  const idx = url.indexOf('?');
  const params = new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '');
  if (params.get('type') !== 'pic') return url;
  // 按尺寸分桶请求封面：列表缩略图统一走 96px，房间/播放器走 320px，全屏舞台走 512px
  const bucket = px <= 96 ? 96 : px <= 320 ? 320 : 512;
  params.set('size', String(bucket));
  return `${url.split('?')[0]}?${params.toString()}`;
}

function resizeMediaProxyUrl(url: string, px: number): string {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return url;

  const params = new URLSearchParams(url.slice(queryStart + 1));
  if (!params.get('url')) return url;

  params.set('size', String(px));
  return `${url.slice(0, queryStart)}?${params.toString()}`;
}

function stripNeteaseParam(url: string): string {
  if (!/param=\d+y\d+/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('param');
    return parsed.toString();
  } catch {
    return url
      .replace(/([?&])param=\d+y\d+/gi, '$1')
      .replace(/\?&/, '?')
      .replace(/[?&]$/, '')
      .replace(/\?$/, '');
  }
}

function resizeQqCover(url: string, px: number): string {
  if (!/\.gtimg\.com\/music\/photo_new\//i.test(url) && !/y\.qq\.com\/music\/photo_new\//i.test(url)) {
    return url;
  }
  const code = px <= 58 ? 'T001R' : px <= 300 ? 'T002R' : 'T003R';
  if (/T00\dR/i.test(url)) return url.replace(/T00\dR/i, code);
  if (/\d+x\d+/.test(url)) return url.replace(/\d+x\d+/g, `${px}x${px}`);
  return url;
}

const KUGOU_COVER_HOST_RE = /(?:^|\.|\/)(?:kugou\.com|kugou\.net|kgimg\.com|kgimg\.net|kgcdn\.com)(?:\/|:|$)/i;

function resizeKugouCover(url: string, px: number): string {
  if (!KUGOU_COVER_HOST_RE.test(url)) return url;
  const bucket = px <= 64 ? 64 : px <= 120 ? 120 : px <= 240 ? 240 : 400;
  const resized = url.replace(/\/(\d+)\//, `/${bucket}/`);
  if (resized !== url) return resized;
  return url.replace(/\/(480|400|240|200|150)\//, `/${bucket}/`);
}

function resizeDirectCoverUrl(url: string, px: number): string {
  if (!url) return url;

  if (/music\.126\.net|126\.net/i.test(url)) {
    return stripNeteaseParam(url);
  }

  let next = resizeQqCover(url, px);
  if (next !== url) return next;

  next = resizeKugouCover(url, px);
  if (next !== url) return next;

  if (/param=\d+y\d+/i.test(url)) {
    return stripNeteaseParam(url);
  }

  if (/thumbnail=\d+/i.test(url)) {
    return url.replace(/thumbnail=\d+/gi, `thumbnail=${px}`);
  }

  return url;
}

/**
 * HTTPS 页面上的 http 封面直链会被手机浏览器按混合内容拦截（桌面 Chrome 会自动升级图片协议，
 * 手机端多数浏览器不会，表现为热榜/队列封面整片空白）
 * 网易/QQ 等音乐 CDN 支持 https，直接升协议；酷狗部分节点 https 证书不可靠（与服务端
 * preferHttpsMediaUrl 保持一致），改走同源 media-proxy
 */
export function upgradeInsecureCoverUrl(url: string): string {
  if (!/^http:\/\//i.test(url)) return url;
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return url;
  if (KUGOU_COVER_HOST_RE.test(url)) {
    return `/api/media-proxy?url=${encodeURIComponent(url)}`;
  }
  return `https://${url.slice('http://'.length)}`;
}

export function resizeCoverUrl(url: string, size: CoverSize = 'full'): string {
  if (!url) return url;

  url = upgradeInsecureCoverUrl(url);

  // 任意尺寸都先去掉 NetEase ?param=NyN，避免原图链自带缩略参数导致不显示
  let next = /music\.126\.net|126\.net|param=\d+y\d+/i.test(url) ? stripNeteaseParam(url) : url;
  if (next.startsWith('/api/meting')) {
    try {
      const parsed = new URL(next, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      if (parsed.searchParams.get('type') === 'pic') {
        const targetPx = size === 'full' ? 512 : COVER_SIZE_PX[size] <= 96 ? 96 : 320;
        parsed.searchParams.set('size', String(targetPx));
        return `${parsed.pathname}?${parsed.searchParams.toString()}`;
      }
    } catch {
      // Keep the original URL if it cannot be parsed.
    }
  }
  if (size === 'full') return next;

  const px = COVER_SIZE_PX[size];

  if (next.startsWith('/api/meting')) {
    return appendMetingThumbParam(next, px);
  }

  if (next.includes('/api/media-proxy')) {
    return resizeMediaProxyUrl(next, px);
  }

  return resizeDirectCoverUrl(next, px);
}

export function getFallbackCoverUrl(): string {
  return FALLBACK_COVER;
}

export function getCoverPixelSize(size: CoverSize): number | undefined {
  if (size === 'full') return undefined;
  return COVER_SIZE_PX[size];
}
