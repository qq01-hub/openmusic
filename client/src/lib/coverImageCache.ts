/**
 * 已解码封面缓存。
 * 签名 URL 每次挂载都会换发（nonce 一次性），浏览器缓存命中不了，
 * 切标签页导致画布重挂载时封面就会肉眼可见地重新加载一次。
 * 这里按「未签名地址」留住解码后的 Image，重挂载可直接复用。
 */

const CACHE_LIMIT = 12;
const cache = new Map<string, HTMLImageElement>();

function isUsable(img: HTMLImageElement | undefined): img is HTMLImageElement {
  if (!img || !img.complete || img.naturalWidth <= 0) return false;
  const src = img.currentSrc || img.src || '';
  if (!src) return false;
  if (src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('/')) return true;
  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(src, window.location.origin);
      if (parsed.origin === window.location.origin) return true;
    } catch {
      return false;
    }
  }
  return img.crossOrigin === 'anonymous';
}

export function getCachedCoverImage(key: string | null | undefined): HTMLImageElement | null {
  if (!key) return null;
  const img = cache.get(key);
  if (!isUsable(img)) {
    if (img) cache.delete(key);
    return null;
  }
  // LRU：命中后移到队尾
  cache.delete(key);
  cache.set(key, img);
  return img;
}

export function cacheCoverImage(key: string | null | undefined, img: HTMLImageElement): void {
  if (!key || !isUsable(img)) return;
  cache.delete(key);
  cache.set(key, img);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
