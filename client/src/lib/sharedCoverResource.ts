const coverResourceCache = new Map<string, Promise<string>>();
const coverResourceValues = new Map<string, string>();
const MAX_SHARED_COVER_RESOURCES = 36;

/** 同一封面被背景层和 3D 视觉层同时使用时，只下载一次 */
export function loadSharedCoverResource(url: string): Promise<string> {
  const key = String(url || '').trim();
  if (!key) return Promise.resolve('');

  // 外部 CDN 可能不允许 fetch/CORS；这类地址交给浏览器原生图片缓存处理
  if (/^https?:\/\//i.test(key)) {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      if (origin && new URL(key).origin !== origin) return Promise.resolve(key);
    } catch {
      return Promise.resolve(key);
    }
  }

  const cached = coverResourceValues.get(key);
  if (cached) {
    coverResourceValues.delete(key);
    coverResourceValues.set(key, cached);
    return Promise.resolve(cached);
  }

  const pending = coverResourceCache.get(key);
  if (pending) return pending;

  const request = fetch(key, { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error(`封面请求失败: ${response.status}`);
      return response.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      coverResourceValues.delete(key);
      coverResourceValues.set(key, objectUrl);
      while (coverResourceValues.size > MAX_SHARED_COVER_RESOURCES) {
        const oldest = coverResourceValues.keys().next().value;
        if (!oldest) break;
        const oldUrl = coverResourceValues.get(oldest);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        coverResourceValues.delete(oldest);
      }
      return objectUrl;
    })
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      coverResourceCache.delete(key);
    });

  coverResourceCache.set(key, request);
  return request;
}
