/**
 * 轻量进程内响应缓存：同一 key 的并发加载共享同一个 Promise。
 * 失败不写入缓存，避免上游短暂故障被放大成缓存故障。
 */
export function createMetingResponseCache({ ttlMs = 30_000, maxEntries = 2048, shouldCache = () => true } = {}) {
  const values = new Map();
  const inflight = new Map();

  function prune(now = Date.now()) {
    for (const [key, entry] of values) {
      if (entry.expiresAt <= now) values.delete(key);
    }
    while (values.size > maxEntries) {
      const oldest = values.keys().next().value;
      if (oldest === undefined) break;
      values.delete(oldest);
    }
  }

  async function get(key, loader, requestedTtlMs = ttlMs) {
    const cacheKey = String(key);
    const now = Date.now();
    const cached = values.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) values.delete(cacheKey);

    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const request = Promise.resolve()
      .then(loader)
      .then((value) => {
        const effectiveTtlMs = Math.max(0, Number(requestedTtlMs) || 0);
        if (effectiveTtlMs > 0 && shouldCache(value)) {
          values.set(cacheKey, { value, expiresAt: Date.now() + effectiveTtlMs });
          prune();
        }
        return value;
      })
      .finally(() => {
        inflight.delete(cacheKey);
      });
    inflight.set(cacheKey, request);
    return request;
  }

  return {
    get,
    clear() {
      values.clear();
      inflight.clear();
    },
    size() {
      prune();
      return values.size;
    },
  };
}
