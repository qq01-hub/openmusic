// 仅合并可被最新状态替代的房间快照，不用于收藏、计数或鉴权写入
export function createLatestWriteQueue({ write, concurrency = 8, retryMs = 1000, idleDelayMs = 0, onError = () => {} }) {
  const pending = new Map();
  const active = new Map();
  let scheduled;
  let scheduledAsTimeout = false;
  let retryTimer;
  let flushWaiter;
  const limit = Math.max(1, Math.min(32, Math.floor(concurrency) || 8));

  function schedule() {
    if (scheduled || retryTimer) return;
    const callback = () => { scheduled = undefined; pump(); };
    scheduledAsTimeout = idleDelayMs > 0 && active.size === 0;
    scheduled = scheduledAsTimeout ? setTimeout(callback, idleDelayMs) : setImmediate(callback);
    if (scheduledAsTimeout) scheduled.unref?.();
  }
  function settled() {
    if (flushWaiter?.error && !active.size) {
      const waiter = flushWaiter; flushWaiter = undefined; waiter.reject(waiter.error);
    }
    if (pending.size || active.size) return;
    if (scheduled) { if (scheduledAsTimeout) clearTimeout(scheduled); else clearImmediate(scheduled); scheduled = undefined; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
    const waiter = flushWaiter;
    flushWaiter = undefined;
    waiter?.resolve();
  }
  function pump() {
    if (retryTimer) return;
    for (const [key, value] of pending) {
      if (active.size >= limit) break;
      if (active.has(key)) continue;
      pending.delete(key);
      const job = { cancelled: false };
      active.set(key, job);
      void Promise.resolve().then(() => job.cancelled ? undefined : write(key, value)).catch(error => {
        if (!job.cancelled && !pending.has(key)) pending.set(key, value);
        if (flushWaiter && !flushWaiter.error) flushWaiter.error = error;
        if (pending.size && !retryTimer) {
          retryTimer = setTimeout(() => { retryTimer = undefined; schedule(); }, retryMs);
          retryTimer.unref?.();
        }
        onError(error, key);
      }).finally(() => {
        active.delete(key);
        settled();
        if (pending.size) schedule();
      });
    }
    settled();
  }
  return {
    enqueue(key, value) { const replaced = pending.has(key); pending.set(key, value); schedule(); return replaced; },
    cancel(key) { pending.delete(key); const job = active.get(key); if (job) job.cancelled = true; settled(); },
    flush() {
      if (flushWaiter) return flushWaiter.promise;
      if (!pending.size && !active.size) return Promise.resolve();
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
      if (scheduled) { if (scheduledAsTimeout) clearTimeout(scheduled); else clearImmediate(scheduled); scheduled = undefined; }
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      flushWaiter = { promise, resolve, reject };
      pump();
      return promise;
    },
    get pendingCount() { return pending.size; },
    get activeCount() { return active.size; },
  };
}
