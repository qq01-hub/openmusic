/**
 * QQ 表情资源持久化缓存（Cache Storage）
 * 刷新页面后仍可命中，避免反复下载合计约 27MB 的 APNG。
 */
const QFACE_CACHE_NAME = 'openmusic-qface-assets-v1';

let cachePromise: Promise<Cache | null> | null = null;

function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return Promise.resolve(null);
  if (!cachePromise) {
    cachePromise = caches.open(QFACE_CACHE_NAME).catch(() => null);
  }
  return cachePromise;
}

/** 从持久化缓存读取 Response；未命中返回 null */
export async function matchQFaceAsset(url: string): Promise<Response | null> {
  try {
    const cache = await openCache();
    if (!cache) return null;
    const hit = await cache.match(url);
    return hit && hit.ok ? hit : null;
  } catch {
    return null;
  }
}

/** 写入持久化缓存（失败静默） */
export async function putQFaceAsset(url: string, response: Response): Promise<void> {
  if (!response.ok) return;
  let cloned: Response;
  try {
    cloned = response.clone();
  } catch {
    return;
  }
  try {
    const cache = await openCache();
    if (!cache) return;
    await cache.put(url, cloned);
  } catch {
    // quota / private mode
  }
}

/**
 * 解析为可用的 blob URL：
 * 1) Cache Storage 命中 → 零网络
 * 2) 否则 fetch（优先 HTTP 缓存）并回写 Cache Storage
 */
export async function resolveQFaceAssetBlobUrl(url: string): Promise<string> {
  const cached = await matchQFaceAsset(url);
  if (cached) {
    return URL.createObjectURL(await cached.blob());
  }

  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error(`QQ 表情资源加载失败: ${res.status}`);
  }
  void putQFaceAsset(url, res);
  return URL.createObjectURL(await res.blob());
}

/** 仅当缓存已有时返回 blob URL，不触发网络（用于启动预热） */
export async function tryHydrateQFaceAssetBlobUrl(url: string): Promise<string | null> {
  const cached = await matchQFaceAsset(url);
  if (!cached) return null;
  try {
    return URL.createObjectURL(await cached.blob());
  } catch {
    return null;
  }
}
