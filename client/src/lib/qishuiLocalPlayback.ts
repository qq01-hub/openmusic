import { fetchWithTimeout } from '../api/http';
import { isSourceUnavailableMessage } from './audioPlaybackError';
import { toProxiedMediaUrl } from './mediaProxyUrl';
import { signApiUrl } from './signedApiUrl';
import { debugLog, debugLine } from './debugTools';

type LocalSource = { url?: unknown; auth?: unknown };
type WorkerResult = { id: number; data?: ArrayBuffer; contentType?: string; error?: string; downloadMs?: number; decryptMs?: number; bytes?: number };

export type QishuiLocalPlaybackResult =
  | { status: 'ok'; url: string }
  | { status: 'aborted' }
  | { status: 'source-unavailable' }
  | { status: 'failed' };

const LOCAL_DECRYPT_TIMEOUT_MS = 20_000;
const LOCAL_SOURCE_FETCH_TIMEOUT_MS = 5_000;
/** 当前曲与下一首各保留一个，预取不能撤销仍用于快进的 blob */
const MAX_LOCAL_AUDIO_CACHE = 2;
let activePlaybackUrl = '';

export function retainQishuiPlaybackUrl(url: string): void {
  activePlaybackUrl = url.startsWith('blob:') ? url : '';
}

export function isQishuiLocalPlaybackUrl(url: string | null | undefined): url is string {
  return Boolean(url && /\/api\/qishui-source(?:\?|$)/i.test(url));
}
const blobCache = new Map<string, string>();
const pending = new Map<string, Promise<QishuiLocalPlaybackResult>>();
/** 串行解密：并行 Worker 会同时持有多首「密文+明文」峰值。 */
let decryptChain: Promise<void> = Promise.resolve();
let requestId = 0;
let prefetchAbort: AbortController | null = null;
let prefetchToken = '';

function sourceToken(wrappedUrl: string): string {
  try {
    return new URL(wrappedUrl, window.location.origin).searchParams.get('t')?.trim() || '';
  } catch {
    return '';
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function remember(key: string, url: string): string {
  const old = blobCache.get(key);
  if (old && old !== url) URL.revokeObjectURL(old);
  blobCache.delete(key);
  blobCache.set(key, url);
  while (blobCache.size > MAX_LOCAL_AUDIO_CACHE) {
    const oldest = [...blobCache.keys()].find((candidate) => candidate !== key && blobCache.get(candidate) !== activePlaybackUrl);
    if (!oldest) break;
    const oldUrl = blobCache.get(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    blobCache.delete(oldest);
  }
  return url;
}

function runWorker(sourceUrl: string, auth: string, signal?: AbortSignal, proxy = false): Promise<string> {
  const run = () => new Promise<string>((resolve, reject) => {
    const id = ++requestId;
    const worker = new Worker(new URL('../workers/qishuiDecryptWorker.ts', import.meta.url), { type: 'module' });
    const abort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      reject(new DOMException('汽水本地解密已取消', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      debugLog('qishui_local_audio_timeout', debugLine({ proxy }));
      reject(new Error('汽水本地解密超时'));
    }, LOCAL_DECRYPT_TIMEOUT_MS);
    if (signal?.aborted) {
      window.clearTimeout(timer);
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      debugLog('qishui_local_audio_ready', debugLine({
        proxy,
        downloadMs: event.data.downloadMs,
        decryptMs: event.data.decryptMs,
        bytes: event.data.bytes,
        failed: !event.data.data,
      }));
      if (!event.data.data) {
        reject(new Error(event.data.error || '汽水本地解密失败'));
        return;
      }
      resolve(URL.createObjectURL(new Blob([event.data.data], { type: event.data.contentType || 'audio/mp4' })));
    };
    worker.onerror = (event) => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      reject(new Error(event.message || '汽水本地解密 Worker 失败'));
    };
    worker.postMessage({ id, url: sourceUrl, auth, proxy });
  });

  const queued = decryptChain.then(run, run);
  // 无论成败都放行队列；错误留给调用方
  decryptChain = queued.then(() => undefined, () => undefined);
  return queued;
}

async function resolveLocalPlaybackUrl(
  wrappedUrl: string,
  signal?: AbortSignal,
  proxy = false,
): Promise<QishuiLocalPlaybackResult> {
  const token = sourceToken(wrappedUrl);
  if (!token || typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { status: 'failed' };
  }
  if (signal?.aborted) return { status: 'aborted' };

  // 代理只改变密文传输路径，同一会话的明文无需重新下载和解密
  const cacheKey = token;
  const cached = blobCache.get(cacheKey);
  if (cached) {
    blobCache.delete(cacheKey);
    blobCache.set(cacheKey, cached);
    return { status: 'ok', url: cached };
  }

  const existing = pending.get(cacheKey);
  if (existing) {
    const shared = await existing;
    // 调用方自己已取消：静默 aborted，勿当解密失败
    if (signal?.aborted) return { status: 'aborted' };
    // 共享任务被上一任播放路径 abort：本调用仍有效则重开，避免误报失败
    if (shared.status === 'aborted') {
      return resolveLocalPlaybackUrl(wrappedUrl, signal, proxy);
    }
    return shared;
  }

  const task = (async (): Promise<QishuiLocalPlaybackResult> => {
    if (signal?.aborted) return { status: 'aborted' };
    let blobUrl: string | null = null;
    try {
      const response = await fetchWithTimeout(
        `/api/qishui-source?t=${encodeURIComponent(token)}`,
        { cache: 'no-store', signal },
        LOCAL_SOURCE_FETCH_TIMEOUT_MS,
      );
      if (signal?.aborted) return { status: 'aborted' };
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return isSourceUnavailableMessage(body) ? { status: 'source-unavailable' } : { status: 'failed' };
      }
      const payload = await response.json() as LocalSource;
      const sourceUrl = typeof payload.url === 'string' ? payload.url : '';
      const auth = typeof payload.auth === 'string' ? payload.auth : '';
      if (isSourceUnavailableMessage(sourceUrl)) return { status: 'source-unavailable' };
      if (!sourceUrl || !auth) return { status: 'failed' };
      const fetchUrl = proxy
        ? await signApiUrl(toProxiedMediaUrl(sourceUrl))
        : sourceUrl;
      blobUrl = await runWorker(fetchUrl, auth, signal, proxy);
      if (signal?.aborted) {
        URL.revokeObjectURL(blobUrl);
        return { status: 'aborted' };
      }
      return { status: 'ok', url: remember(cacheKey, blobUrl) };
    } catch (err) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (signal?.aborted || isAbortError(err)) return { status: 'aborted' };
      return { status: 'failed' };
    }
  })().finally(() => {
    pending.delete(cacheKey);
  });

  pending.set(cacheKey, task);
  return task;
}

export async function resolveQishuiLocalPlaybackUrl(
  url: string,
  signal?: AbortSignal,
  proxy = false,
): Promise<QishuiLocalPlaybackResult> {
  if (!isQishuiLocalPlaybackUrl(url)) {
    return { status: 'failed' };
  }
  // 正式播放优先：取消仅预取任务，避免和当前曲抢 Worker/内存
  const token = sourceToken(url);
  if (token && prefetchToken && prefetchToken !== token) {
    prefetchAbort?.abort();
    prefetchAbort = null;
    prefetchToken = '';
  }
  return resolveLocalPlaybackUrl(url, signal, proxy);
}

/**
 * 仅预取下一首解密结果；同时只保留一个预取任务。
 * 不要对当前曲+多首队列并行整曲解密，否则内存会线性叠加。
 */
export function prefetchQishuiLocalPlayback(url: string | null | undefined, proxy = false): void {
  if (!isQishuiLocalPlaybackUrl(url)) return;
  const token = sourceToken(url);
  if (!token) return;
  const cacheKey = token;
  if (blobCache.has(cacheKey) || pending.has(cacheKey)) return;
  if (prefetchToken === cacheKey) return;

  prefetchAbort?.abort();
  const controller = new AbortController();
  prefetchAbort = controller;
  prefetchToken = cacheKey;
  void resolveLocalPlaybackUrl(url, controller.signal, proxy).finally(() => {
    if (prefetchAbort === controller) {
      prefetchAbort = null;
      prefetchToken = '';
    }
  });
}
