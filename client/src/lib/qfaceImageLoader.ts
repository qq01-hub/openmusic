/**
 * QQ 表情统一图片调度器：持久化资源缓存 + 解码并发控制 + LRU + 显示节点池
 *
 * 资源层走 Cache Storage（刷新后仍命中），避免反复下载大体积 APNG。
 * 进房重挂载时优先复用已解码的 <img> DOM 节点，避免 APNG 反复解码。
 *
 * 优先级（数值越小越高）：
 * P0 MESSAGE  — 当前可见消息内的表情
 * P1 NEAR     — 即将进入视野
 * P2 PANEL    — 表情面板可见区域
 * P3 MANIFEST — manifest 预热（常用表情）
 */

import {
  resolveQFaceAssetBlobUrl,
  tryHydrateQFaceAssetBlobUrl,
} from './qfaceAssetCache';

export const QFaceLoadPriority = {
  MESSAGE: 0,
  NEAR: 1,
  PANEL: 2,
  MANIFEST: 3,
} as const;

export type QFaceLoadPriority = typeof QFaceLoadPriority[keyof typeof QFaceLoadPriority];

export type QFaceImageState = 'idle' | 'loading' | 'loaded' | 'decoded' | 'rendered';

const MAX_CONCURRENT_DECODE = 8;
/** 限制常驻解码图与 Blob URL 数量，离屏后按 LRU 回收内存 */
const LRU_MAX_DECODED = 96;
const MAX_POOLED_DISPLAY_PER_ID = 3;

function revokeObjectUrl(url: string): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

interface QueueEntry {
  id: string;
  priority: QFaceLoadPriority;
  resolve: () => void;
  reject: (error: Error) => void;
}

type StateListener = (id: string, state: QFaceImageState) => void;
type UrlForId = (id: string) => string;

class QFaceImageLoader {
  private urlForId: UrlForId = (id) => id;
  private states = new Map<string, QFaceImageState>();
  private entries = new Map<string, QueueEntry>();
  private waitQueue: string[] = [];
  private loadPromises = new Map<string, Promise<void>>();
  private activeDecodes = 0;
  /** 主图：解码结果，不直接挂到多个 DOM 位置 */
  private decodedImages = new Map<string, HTMLImageElement>();
  /** 会话级 blob URL，避免重复网络请求 */
  private objectUrls = new Map<string, string>();
  /** 卸载后停泊的已解码显示节点，进房可直接复用 */
  private displayPool = new Map<string, HTMLImageElement[]>();
  /** 当前挂载展示中的引用计数，避免回收正在显示的节点与 Blob URL */
  private activeDisplayCount = new Map<string, number>();
  private lruOrder: string[] = [];
  private stateListeners = new Set<StateListener>();

  configure(urlForId: UrlForId): void {
    this.urlForId = urlForId;
  }

  private setState(id: string, state: QFaceImageState): void {
    const prev = this.states.get(id) ?? 'idle';
    if (prev === state) return;
    this.states.set(id, state);
    this.stateListeners.forEach((listener) => listener(id, state));
  }

  getState(id: string): QFaceImageState {
    return this.states.get(id) ?? 'idle';
  }

  isDecoded(id: string): boolean {
    const state = this.getState(id);
    return state === 'decoded' || state === 'rendered';
  }

  getDecodedImage(id: string): HTMLImageElement | undefined {
    return this.decodedImages.get(id);
  }

  getObjectUrl(id: string): string | undefined {
    return this.objectUrls.get(id);
  }

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeId(id: string, listener: (state: QFaceImageState) => void): () => void {
    listener(this.getState(id));
    const wrapped: StateListener = (changedId, state) => {
      if (changedId === id) listener(state);
    };
    this.stateListeners.add(wrapped);
    return () => this.stateListeners.delete(wrapped);
  }

  markRendered(id: string): void {
    if (this.getState(id) === 'rendered') return;
    this.touchLru(id);
    this.setState(id, 'rendered');
  }

  /**
   * 借出可用于展示的 <img>。优先返回停泊池中已解码节点（跨房间零成本），
   * 否则从主图 clone（同表情多处同时出现时）。
   */
  acquireDisplayImage(
    id: string,
    options?: { className?: string; alt?: string },
  ): HTMLImageElement | null {
    if (!id || typeof Image === 'undefined') return null;

    const pool = this.displayPool.get(id);
    let img = pool?.pop();

    if (!img) {
      const master = this.decodedImages.get(id);
      if (master) {
        img = master.cloneNode(true) as HTMLImageElement;
      } else {
        const src = this.objectUrls.get(id) || this.urlForId(id);
        img = new Image();
        img.decoding = 'async';
        img.src = src;
      }
    }

    img.className = options?.className || '';
    img.alt = options?.alt || '';
    img.draggable = false;
    this.activeDisplayCount.set(id, (this.activeDisplayCount.get(id) ?? 0) + 1);
    this.touchLru(id);
    return img;
  }

  /** 组件卸载时归还节点，保留解码结果供下次进房复用 */
  releaseDisplayImage(id: string, img: HTMLImageElement): void {
    if (!id || !img) return;
    img.remove();
    img.className = '';
    img.alt = '';
    img.onload = null;
    img.onerror = null;

    const nextActive = (this.activeDisplayCount.get(id) ?? 0) - 1;
    if (nextActive > 0) {
      this.activeDisplayCount.set(id, nextActive);
    } else {
      this.activeDisplayCount.delete(id);
    }

    if (this.decodedImages.has(id) || this.objectUrls.has(id)) {
      let pool = this.displayPool.get(id);
      if (!pool) {
        pool = [];
        this.displayPool.set(id, pool);
      }
      if (pool.length < MAX_POOLED_DISPLAY_PER_ID) {
        pool.push(img);
      }
    }

    if (nextActive <= 0) {
      this.evictLruIfNeeded();
    }
  }

  request(id: string, priority: QFaceLoadPriority): Promise<void> {
    if (!id) return Promise.resolve();

    const state = this.getState(id);
    if (state === 'decoded' || state === 'rendered') return Promise.resolve();

    const existingPromise = this.loadPromises.get(id);
    if (existingPromise) {
      this.bumpPriority(id, priority);
      return existingPromise;
    }

    const promise = new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { id, priority, resolve, reject };
      this.entries.set(id, entry);
      this.enqueueWait(id);
      this.setState(id, 'loading');
      this.pump();
    });

    this.loadPromises.set(id, promise);
    return promise;
  }

  requestMany(ids: string[], priority: QFaceLoadPriority): void {
    const unique = [...new Set(ids.filter(Boolean))];
    unique.forEach((id) => void this.request(id, priority));
  }

  bumpPriority(id: string, priority: QFaceLoadPriority): void {
    const entry = this.entries.get(id);
    if (!entry || priority >= entry.priority) return;
    entry.priority = priority;
    this.enqueueWait(id);
    this.pump();
  }

  private enqueueWait(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    const index = this.waitQueue.indexOf(id);
    if (index >= 0) this.waitQueue.splice(index, 1);

    const effectivePriority = entry.priority;
    let insertAt = this.waitQueue.length;
    for (let i = 0; i < this.waitQueue.length; i += 1) {
      const other = this.entries.get(this.waitQueue[i]);
      const otherPriority = other?.priority ?? QFaceLoadPriority.MANIFEST;
      if (effectivePriority < otherPriority) {
        insertAt = i;
        break;
      }
    }
    this.waitQueue.splice(insertAt, 0, id);
  }

  private pump(): void {
    while (this.activeDecodes < MAX_CONCURRENT_DECODE && this.waitQueue.length > 0) {
      const id = this.waitQueue.shift()!;
      const entry = this.entries.get(id);
      if (!entry) continue;

      const state = this.getState(id);
      if (state === 'decoded' || state === 'rendered') {
        entry.resolve();
        this.entries.delete(id);
        this.loadPromises.delete(id);
        continue;
      }

      if (this.activeDecodes >= MAX_CONCURRENT_DECODE) {
        this.waitQueue.unshift(id);
        break;
      }

      void this.startDecode(id, entry);
    }
  }

  private async startDecode(id: string, entry: QueueEntry): Promise<void> {
    this.activeDecodes += 1;

    try {
      const image = await this.fetchAndDecode(id, this.urlForId(id));
      this.storeDecoded(id, image);
      this.setState(id, 'decoded');
      entry.resolve();
    } catch (error) {
      this.setState(id, 'idle');
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.entries.delete(id);
      this.loadPromises.delete(id);
      this.activeDecodes -= 1;
      this.pump();
    }
  }

  private async resolveObjectUrl(id: string, url: string): Promise<string> {
    const cached = this.objectUrls.get(id);
    if (cached) return cached;

    try {
      const objectUrl = await resolveQFaceAssetBlobUrl(url);
      const existing = this.objectUrls.get(id);
      if (existing) {
        revokeObjectUrl(objectUrl);
        return existing;
      }
      this.objectUrls.set(id, objectUrl);
      this.touchLru(id);
      this.evictLruIfNeeded();
      return objectUrl;
    } catch {
      throw new Error(`QQ 表情加载失败: ${id}`);
    }
  }

  /**
   * 从 Cache Storage 静默灌入会话级 blob URL（不联网）。
   * 刷新后常用表情可立刻有源，打开面板时少转圈。
   */
  async hydrateFromPersistentCache(ids: string[]): Promise<void> {
    const unique = [...new Set(ids.filter(Boolean))];
    await Promise.all(unique.map(async (id) => {
      if (this.objectUrls.has(id)) return;
      const objectUrl = await tryHydrateQFaceAssetBlobUrl(this.urlForId(id));
      if (!objectUrl) return;
      if (this.objectUrls.has(id)) {
        revokeObjectUrl(objectUrl);
        return;
      }
      this.objectUrls.set(id, objectUrl);
      this.touchLru(id);
      this.evictLruIfNeeded();
    }));
  }

  private async fetchAndDecode(id: string, url: string): Promise<HTMLImageElement> {
    const cached = this.decodedImages.get(id);
    if (cached) return cached;

    if (typeof Image === 'undefined') {
      return document.createElement('img');
    }

    const objectUrl = await this.resolveObjectUrl(id, url);
    const image = new Image();
    image.decoding = 'async';

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`QQ 表情加载失败: ${id}`));
      image.src = objectUrl;
    });

    this.setState(id, 'loaded');

    if (image.decode) {
      try {
        await image.decode();
      } catch {
        // decode() 失败时仍使用 onload 结果
      }
    }

    return image;
  }

  private storeDecoded(id: string, image: HTMLImageElement): void {
    this.decodedImages.set(id, image);
    this.touchLru(id);
    this.evictLruIfNeeded();
  }

  private touchLru(id: string): void {
    const index = this.lruOrder.indexOf(id);
    if (index >= 0) this.lruOrder.splice(index, 1);
    this.lruOrder.push(id);
  }

  private evictLruIfNeeded(): void {
    if (this.decodedImages.size <= LRU_MAX_DECODED && this.objectUrls.size <= LRU_MAX_DECODED) {
      return;
    }
    for (
      let index = 0;
      index < this.lruOrder.length
        && (this.decodedImages.size > LRU_MAX_DECODED || this.objectUrls.size > LRU_MAX_DECODED);
    ) {
      const evictId = this.lruOrder[index];
      if ((this.activeDisplayCount.get(evictId) ?? 0) > 0 || this.entries.has(evictId)) {
        index += 1;
        continue;
      }
      this.lruOrder.splice(index, 1);
      this.decodedImages.delete(evictId);
      this.displayPool.delete(evictId);
      const objectUrl = this.objectUrls.get(evictId);
      if (objectUrl) {
        this.objectUrls.delete(evictId);
        revokeObjectUrl(objectUrl);
      }
      this.setState(evictId, 'idle');
    }
  }
}

const loader = new QFaceImageLoader();

export function configureQFaceImageLoader(urlForId: UrlForId): void {
  loader.configure(urlForId);
}

export function getQFaceImageState(id: string): QFaceImageState {
  return loader.getState(id);
}

export function isQFaceImageDecoded(id: string): boolean {
  return loader.isDecoded(id);
}

export function getQFaceDecodedImage(id: string): HTMLImageElement | undefined {
  return loader.getDecodedImage(id);
}

export function getQFaceObjectUrl(id: string): string | undefined {
  return loader.getObjectUrl(id);
}

export function subscribeQFaceImageState(id: string, listener: (state: QFaceImageState) => void): () => void {
  return loader.subscribeId(id, listener);
}

export function requestQFaceImage(id: string, priority: QFaceLoadPriority): Promise<void> {
  return loader.request(id, priority);
}

export function requestQFaceImages(ids: string[], priority: QFaceLoadPriority): void {
  loader.requestMany(ids, priority);
}

export function markQFaceImageRendered(id: string): void {
  loader.markRendered(id);
}

export function bumpQFaceImagePriority(id: string, priority: QFaceLoadPriority): void {
  loader.bumpPriority(id, priority);
}

export function acquireQFaceDisplayImage(
  id: string,
  options?: { className?: string; alt?: string },
): HTMLImageElement | null {
  return loader.acquireDisplayImage(id, options);
}

export function releaseQFaceDisplayImage(id: string, img: HTMLImageElement): void {
  loader.releaseDisplayImage(id, img);
}

/** 从 Cache Storage 预热会话 blob URL（刷新后零网络） */
export function hydrateQFaceImagesFromCache(ids: string[]): Promise<void> {
  return loader.hydrateFromPersistentCache(ids);
}
