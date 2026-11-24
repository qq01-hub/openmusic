import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG_PREFIX = 'om-chunk-reload:';

function readReloadFlag(flagKey: string): boolean {
  try {
    return Boolean(sessionStorage.getItem(flagKey));
  } catch {
    return false;
  }
}

function writeReloadFlag(flagKey: string): boolean {
  try {
    sessionStorage.setItem(flagKey, '1');
    return true;
  } catch {
    return false;
  }
}

function clearReloadFlag(flagKey: string): void {
  try {
    sessionStorage.removeItem(flagKey);
  } catch {}
}

/**
 * 包一层 React.lazy：chunk 加载失败（常见于刚发版、旧页面还引用着已被替换掉的
 * 带 hash 文件名）时，Suspense 本身接不住 rejected promise，会一直卡在 fallback
 * 上——只有手动刷新才能拿到新版本 index.html 里正确的 chunk 地址。这里在失败时
 * 自动刷新一次；用 sessionStorage 记一次性标记，避免真的资源缺失时无限刷新循环。
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  key: string,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    const flagKey = `${RELOAD_FLAG_PREFIX}${key}`;
    try {
      const mod = await factory();
      // 加载成功后清掉标记：不然同一个 tab 里这个 chunk 之后再出现一次
      // 真正的临时性加载失败（网络抖动、下一次发版），就不会再自动刷新了。
      clearReloadFlag(flagKey);
      return mod;
    } catch (err) {
      if (!readReloadFlag(flagKey) && writeReloadFlag(flagKey)) {
        window.location.reload();
        // 刷新是异步的，这里返回一个永远不 resolve 的 promise 撑住 Suspense，
        // 避免刷新完成前还渲染出错误边界或过期界面。
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
