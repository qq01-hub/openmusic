import type { Song } from '../types';

const DATABASE_NAME = 'openmusic-song-audio-v1';
const AUDIO_STORE = 'audio';
const META_STORE = 'metadata';
const DESKTOP_MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MOBILE_MAX_CACHE_BYTES = 128 * 1024 * 1024;
const DESKTOP_MAX_SONG_BYTES = 48 * 1024 * 1024;
const MOBILE_MAX_SONG_BYTES = 20 * 1024 * 1024;
const DESKTOP_MAX_CACHE_SONGS = 64;
const MOBILE_MAX_CACHE_SONGS = 24;
const MAX_AUTO_CACHE_DURATION_MS = 12 * 60 * 1000;
const LOSSLESS_QUALITY_PATTERN = /无损|母带|沉浸|环绕|空间|全景|flac|hires|hi-res|jymaster|jyeffect|sky|lossless|dolby/iu;
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

type NetworkConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
};

function isMobileCacheProfile(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS/iu.test(ua)) return true;
  try {
    return window.matchMedia?.('(pointer: coarse)')?.matches === true;
  } catch {
    return false;
  }
}

function getCacheLimits() {
  const mobile = isMobileCacheProfile();
  return {
    mobile,
    maxCacheBytes: mobile ? MOBILE_MAX_CACHE_BYTES : DESKTOP_MAX_CACHE_BYTES,
    maxSongBytes: mobile ? MOBILE_MAX_SONG_BYTES : DESKTOP_MAX_SONG_BYTES,
    maxCacheSongs: mobile ? MOBILE_MAX_CACHE_SONGS : DESKTOP_MAX_CACHE_SONGS,
  };
}

function isConstrainedNetwork(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: NetworkConnectionLike }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  const effectiveType = String(connection.effectiveType || '').toLowerCase();
  return effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g';
}

export function shouldAutoCacheSongAudio(qualityLabel?: string, durationMs?: number): boolean {
  if (typeof indexedDB === 'undefined') return false;
  if (isMobileCacheProfile() || isConstrainedNetwork()) return false;
  if (qualityLabel && LOSSLESS_QUALITY_PATTERN.test(qualityLabel)) return false;
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > MAX_AUTO_CACHE_DURATION_MS) return false;
  return true;
}

async function resolveEffectiveCacheBudget(maxCacheBytes: number): Promise<number> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
    return maxCacheBytes;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const quota = Number(estimate?.quota);
    const usage = Number(estimate?.usage);
    if (!Number.isFinite(quota) || quota <= 0) return maxCacheBytes;
    const reserve = Math.max(128 * 1024 * 1024, Math.floor(quota * 0.15));
    const safeTotal = Math.max(0, quota - reserve);
    const remaining = Number.isFinite(usage) && usage >= 0 ? Math.max(0, safeTotal - usage) : safeTotal;
    return Math.min(maxCacheBytes, Math.max(32 * 1024 * 1024, remaining));
  } catch {
    return maxCacheBytes;
  }
}

type CacheMetadata = { key: string; size: number; createdAt: number; usedAt: number };
type LocalAudioSource = { key: string; objectUrl: string; remoteUrl: string; resolveFallback?: () => Promise<string> };

const pendingDownloads = new Map<string, Promise<void>>();
const rejectedKeys = new Set<string>();
const localSources = new WeakMap<HTMLAudioElement, LocalAudioSource>();
const sourceRecoveries = new WeakMap<HTMLAudioElement, Promise<void>>();
const recoveryListeners = new WeakSet<HTMLAudioElement>();
let downloadChain: Promise<void> = Promise.resolve();
let databasePromise: Promise<IDBDatabase | null> | null = null;

/** 不含用户、房间、queueId 或临时签名，同一设备按平台、歌曲和实际音质复用 */
export function songAudioCacheKey(song: Pick<Song, 'id' | 'source'>, quality?: string): string {
  return JSON.stringify([song.source || 'netease', String(song.id), quality?.trim() || 'default']);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  const pending = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) { db?.close(); return; }
      settled = true;
      clearTimeout(timer);
      if (!db && databasePromise === pending) databasePromise = null;
      resolve(db);
    };
    // 隐私模式、升级阻塞或磁盘故障不能阻塞正常在线播放
    const timer = setTimeout(() => finish(null), 1000);
    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(AUDIO_STORE);
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          if (databasePromise === pending) databasePromise = null;
          db.close();
        };
        db.onclose = () => {
          if (databasePromise === pending) databasePromise = null;
        };
        finish(db);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  databasePromise = pending;
  return pending;
}

export async function getCachedSongAudio(key: string): Promise<Blob | null> {
  if (rejectedKeys.has(key)) return null;
  const db = await openDatabase();
  if (!db) return null;
  try {
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction([AUDIO_STORE, META_STORE], 'readwrite');
      let result: Blob | null = null;
      const timer = setTimeout(() => { tx.abort(); resolve(null); }, 500);
      const metadata = tx.objectStore(META_STORE);
      const audio = tx.objectStore(AUDIO_STORE);
      const request = metadata.get(key);
      request.onsuccess = () => {
        const meta = request.result as CacheMetadata | undefined;
        if (!meta) return;
        if (!Number.isFinite(meta.createdAt) || Date.now() - meta.createdAt > CACHE_TTL_MS) {
          metadata.delete(key);
          audio.delete(key);
          return;
        }
        const content = audio.get(key);
        content.onsuccess = () => {
          const blob = content.result;
          if (blob instanceof Blob && blob.size > 0 && blob.size === meta.size && blob.size <= DESKTOP_MAX_SONG_BYTES) {
            result = blob;
            metadata.put({ ...meta, usedAt: Date.now() });
          } else {
            metadata.delete(key);
            audio.delete(key);
          }
        };
      };
      tx.oncomplete = () => { clearTimeout(timer); resolve(rejectedKeys.has(key) ? null : result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); resolve(null); };
    });
  } catch {
    databasePromise = null;
    return null;
  }
}

async function hasValidCachedSongAudio(db: IDBDatabase, key: string): Promise<boolean> {
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction([AUDIO_STORE, META_STORE], 'readonly');
      let exists = false;
      const timer = setTimeout(() => { tx.abort(); resolve(false); }, 500);
      const metadata = tx.objectStore(META_STORE);
      const audio = tx.objectStore(AUDIO_STORE);
      const request = metadata.get(key);
      request.onsuccess = () => {
        const meta = request.result as CacheMetadata | undefined;
        if (!meta || !Number.isFinite(meta.createdAt) || Date.now() - meta.createdAt > CACHE_TTL_MS || meta.size <= 0 || meta.size > DESKTOP_MAX_SONG_BYTES) {
          return;
        }
        const audioCheck = typeof audio.getKey === 'function' ? audio.getKey(key) : audio.get(key);
        audioCheck.onsuccess = () => {
          exists = audioCheck.result !== undefined && audioCheck.result !== null;
        };
      };
      tx.oncomplete = () => { clearTimeout(timer); resolve(!rejectedKeys.has(key) && exists); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); resolve(false); };
    });
  } catch {
    databasePromise = null;
    return false;
  }
}

async function storeAudio(db: IDBDatabase, key: string, blob: Blob, signal: AbortSignal): Promise<void> {
  if (signal.aborted || rejectedKeys.has(key)) return;
  const { maxCacheBytes, maxCacheSongs } = getCacheLimits();
  const effectiveBudget = await resolveEffectiveCacheBudget(maxCacheBytes);
  if (signal.aborted || rejectedKeys.has(key) || blob.size > effectiveBudget) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([AUDIO_STORE, META_STORE], 'readwrite');
    const abort = () => tx.abort();
    signal.addEventListener('abort', abort, { once: true });
    const metadata = tx.objectStore(META_STORE);
    const audio = tx.objectStore(AUDIO_STORE);
    const request = metadata.getAll();
    request.onsuccess = () => {
      const now = Date.now();
      const entries = (request.result as CacheMetadata[]).filter((entry) => {
        if (entry.key === key || now - entry.createdAt > CACHE_TTL_MS) {
          metadata.delete(entry.key);
          audio.delete(entry.key);
          return false;
        }
        return true;
      }).sort((a, b) => a.usedAt - b.usedAt);
      let total = entries.reduce((size, entry) => size + entry.size, 0);
      while (entries.length >= maxCacheSongs || total + blob.size > effectiveBudget) {
        const oldest = entries.shift();
        if (!oldest) break;
        total -= oldest.size;
        metadata.delete(oldest.key);
        audio.delete(oldest.key);
      }
      if (total + blob.size > effectiveBudget) return;
      audio.put(blob, key);
      metadata.put({ key, size: blob.size, createdAt: now, usedAt: now } satisfies CacheMetadata);
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    tx.oncomplete = () => { cleanup(); resolve(); };
    tx.onabort = tx.onerror = () => { cleanup(); reject(tx.error || new Error('音频缓存写入失败')); };
  });
}

async function downloadAudio(url: string, signal: AbortSignal): Promise<Blob | null> {
  const { maxSongBytes } = getCacheLimits();
  const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache', signal });
  const type = response.headers.get('Content-Type') || '';
  // 206 首包、播放列表和错误页都不是完整音频，禁止当作整曲持久化
  if (response.status !== 200 || response.headers.has('Content-Range')
    || !/^(audio\/|application\/octet-stream(?:;|$))/i.test(type)
    || /mpegurl|playlist/i.test(type) || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const expectedSize = Number(response.headers.get('Content-Length'));
  if (expectedSize > maxSongBytes) { await response.body.cancel(); return null; }
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (signal.aborted || size > maxSongBytes) {
        await reader.cancel();
        return null;
      }
      const chunk = value.buffer instanceof ArrayBuffer
        && value.byteOffset === 0
        && value.byteLength === value.buffer.byteLength
        ? value.buffer
        : value.slice().buffer;
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size || signal.aborted || (expectedSize > 0 && !response.headers.has('Content-Encoding') && size !== expectedSize)) return null;
  return new Blob(chunks, { type: type.split(';')[0] });
}

/** 当前曲可播放后再后台保存，失败不影响播放器，也不额外开启服务端代理 */
export function cacheSongAudio(key: string, url: string, signal?: AbortSignal): Promise<void> {
  if (
    signal?.aborted
    || rejectedKeys.has(key)
    || typeof indexedDB === 'undefined'
    || isMobileCacheProfile()
    || isConstrainedNetwork()
  ) return Promise.resolve();
  const existing = pendingDownloads.get(key);
  if (existing) return existing;
  const task = downloadChain.then(async () => {
    if (signal?.aborted || rejectedKeys.has(key)) return;
    const db = await openDatabase();
    if (!db) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 60_000);
    try {
      if (controller.signal.aborted || await hasValidCachedSongAudio(db, key)) return;
      const blob = await downloadAudio(url, controller.signal);
      if (blob) await storeAudio(db, key, blob, controller.signal);
    } catch {
      // 跨域拒绝、磁盘配额不足和中断均保留原来的在线播放链路
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }).finally(() => pendingDownloads.delete(key));
  pendingDownloads.set(key, task);
  // 同时最多下载一首，限制整曲缓冲占用和带宽竞争
  downloadChain = task.catch(() => undefined);
  return task;
}

async function discardAudio(key: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const tx = db.transaction([AUDIO_STORE, META_STORE], 'readwrite');
    tx.objectStore(AUDIO_STORE).delete(key);
    tx.objectStore(META_STORE).delete(key);
    await new Promise<void>((resolve) => { tx.oncomplete = tx.onabort = tx.onerror = () => resolve(); });
  } catch {
    databasePromise = null;
  }
}

export function releaseSongAudioSource(audio: HTMLAudioElement): void {
  const previous = localSources.get(audio);
  if (previous) URL.revokeObjectURL(previous.objectUrl);
  localSources.delete(audio);
  sourceRecoveries.delete(audio);
}

/** 试听初次 play 因本地缓存损坏被拒绝时，等待在线源恢复后续播 */
export async function playSongAudio(audio: HTMLAudioElement): Promise<void> {
  try {
    await audio.play();
  } catch (error) {
    const recovery = sourceRecoveries.get(audio);
    if (!recovery) throw error;
    await recovery;
    if (sourceRecoveries.get(audio) !== recovery) return;
    sourceRecoveries.delete(audio);
    await audio.play();
  }
}

/** Blob 仅绑定本机 audio，不进入房间共享链接或 sessionStorage */
export function setSongAudioSource(
  audio: HTMLAudioElement,
  remoteUrl: string,
  blob: Blob | null,
  key: string,
  resolveFallback?: () => Promise<string>,
): void {
  releaseSongAudioSource(audio);
  if (!recoveryListeners.has(audio)) {
    recoveryListeners.add(audio);
    audio.addEventListener('error', (event) => {
      const local = localSources.get(audio);
      if (!local || (audio.currentSrc || audio.src) !== local.objectUrl) return;
      // 捕获阶段先回退在线源，避免坏缓存触发全房间跳歌或音质降级
      event.stopImmediatePropagation();
      rejectedKeys.add(local.key);
      void discardAudio(local.key).catch(() => {});
      const time = audio.currentTime;
      const shouldPlay = !audio.paused;
      audio.pause();
      releaseSongAudioSource(audio);
      const recover = async () => {
        const fallbackUrl = local.resolveFallback ? await local.resolveFallback() : local.remoteUrl;
        if (audio.src !== local.objectUrl) return;
        audio.src = fallbackUrl;
        const expectedUrl = audio.src;
        audio.addEventListener('loadedmetadata', () => {
          if (audio.src !== expectedUrl) return;
          if (Number.isFinite(time) && time > 0) audio.currentTime = time;
          if (shouldPlay) void audio.play().catch(() => {});
        }, { once: true });
        audio.load();
      };
      const recovery = recover();
      sourceRecoveries.set(audio, recovery);
      void recovery.catch(() => {
        if (audio.src === local.objectUrl) audio.dispatchEvent(new Event('error'));
      });
    }, { capture: true });
  }
  if (blob) {
    const objectUrl = URL.createObjectURL(blob);
    localSources.set(audio, { key, objectUrl, remoteUrl: new URL(remoteUrl, document.baseURI).href, resolveFallback });
    audio.src = objectUrl;
  } else {
    audio.src = remoteUrl;
  }
}
