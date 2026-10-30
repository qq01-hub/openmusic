import { resolveSignedApiUrl } from './signedApiUrl';
import {
  isProxiedMediaUrl,
  isSameOriginMediaUrl,
  toProxiedMediaUrl,
} from './mediaProxyUrl';

export type PlaybackErrorClass = 'temporary' | 'service';

// 媒体 CDN 的 403 通常表示签名过期/鉴权失效，不能按网络抖动无限重试旧地址。
const SERVICE_HTTP_STATUSES = new Set([403, 404, 502]);
const URL_PROBE_TIMEOUT_MS = 5000;

export const MAX_TEMP_PLAYBACK_RETRIES = 3;

/** QQ 音乐偶发返回的占位直链域名（无媒体文件路径，仅裸域名） */
const QQ_PLACEHOLDER_HOST = 'aqqmusic.tc.qq.com';

/** pathname 末尾需带常见音频后缀，否则视为占位/无效直链 */
const MEDIA_FILE_EXT = /\.(mp3|m4a|flac|ogg|wav|aac|wma)$/i;

function isQqPlaceholderPlaybackUrl(parsed: URL): boolean {
  if (parsed.hostname !== QQ_PLACEHOLDER_HOST) return false;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') return true;
  return !MEDIA_FILE_EXT.test(pathname);
}

export function isBlockedPlaybackUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url.trim(), typeof window !== 'undefined' ? window.location.href : 'https://localhost');
    return isQqPlaceholderPlaybackUrl(parsed);
  } catch {
    return false;
  }
}

/** Meting / 曲库上游明确表示无可用播放地址 */
export function isSourceUnavailableMessage(message: string | undefined | null): boolean {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'no url'
    || normalized === 'empty url'
    || normalized === 'blocked playback url'
    || normalized.includes('no url')
    || normalized.includes('音源异常')
    || normalized.includes('音源不可用');
}

export class SourceUnavailableError extends Error {
  constructor(message = 'no url') {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

function isInvalidPlaybackUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (isBlockedPlaybackUrl(trimmed)) return true;
  try {
    const parsed = new URL(trimmed, window.location.href);
    return !parsed.protocol.startsWith('http');
  } catch {
    return true;
  }
}

export function isServiceHttpStatus(status: number): boolean {
  return SERVICE_HTTP_STATUSES.has(status);
}

type MediaProbeResult = { status: number; contentType: string };

function isKnownNonAudioContentType(contentType: string): boolean {
  const type = contentType.split(';', 1)[0].trim().toLowerCase();
  if (!type) return false;
  // video/mp4 是本次问题中的典型坏链；HTML/JSON 通常是 CDN 错误页，也不能交给 audio。
  return type.startsWith('video/')
    || type.startsWith('text/')
    || type === 'application/json'
    || type === 'application/xml'
    || type === 'application/xhtml+xml'
    || type.startsWith('image/');
}

async function probeMediaUrl(url: string): Promise<MediaProbeResult | null> {
  const signForProbe = async (rawUrl: string) => {
    try {
      return (await resolveSignedApiUrl(rawUrl)) || rawUrl;
    } catch {
      return rawUrl;
    }
  };
  const candidates = [await signForProbe(url)];
  // 外链通常禁止 CORS，失败时改探测同源媒体代理；代理会透传上游 Content-Type。
  if (!isSameOriginMediaUrl(url) && !isProxiedMediaUrl(url)) {
    const proxied = toProxiedMediaUrl(url);
    if (proxied && proxied !== url) {
      candidates.push(await signForProbe(proxied));
    }
  }

  for (const probeUrl of candidates) {
    const request = async (method: 'HEAD' | 'GET'): Promise<MediaProbeResult | null> => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), URL_PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(probeUrl, {
          method,
          ...(method === 'GET' ? { headers: { Range: 'bytes=0-0' } } : {}),
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'include',
        });
        const result = {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
        };
        try {
          await response.body?.cancel?.();
        } catch {
          // 只读响应头，取消 Range body，避免探测请求占用连接。
        }
        return result;
      } catch {
        return null;
      } finally {
        window.clearTimeout(timer);
      }
    };

    // Express 的媒体代理以 GET 路由处理 HEAD；跳过 HEAD 可避免上游被无 Range 拉取整段音频。
    const head = isProxiedMediaUrl(probeUrl) ? null : await request('HEAD');
    if (head) return head;
    const ranged = await request('GET');
    if (ranged) return ranged;
  }
  return null;
}

/** 拉取播放地址失败（API / 空链） */
export function classifySongUrlFetchFailure(url: string | null | undefined): PlaybackErrorClass {
  if (isInvalidPlaybackUrl(url)) return 'service';
  return 'service';
}

export function classifySongUrlFetchError(error: unknown): PlaybackErrorClass {
  if (error instanceof SourceUnavailableError) return 'service';
  if (error instanceof Error && isSourceUnavailableMessage(error.message)) return 'service';
  if (error instanceof TypeError) return 'temporary';
  if (error instanceof DOMException) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'temporary';
    if (error.name === 'NetworkError') return 'temporary';
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // 连通性 / 配置类：按临时故障本地重试，勿标成无源切歌
    if (
      message.includes('无法连接')
      || message.includes('暂不可用')
      || message.includes('未配置')
      || message.includes('api 请求失败')
      || message.includes('network')
      || message.includes('timeout')
      || message.includes('超时')
    ) {
      return 'temporary';
    }
  }
  return 'service';
}

/** `<audio>` 播放错误分类 */
export async function classifyMediaPlaybackError(audio: HTMLAudioElement): Promise<PlaybackErrorClass> {
  const url = audio.currentSrc || audio.src;
  if (isInvalidPlaybackUrl(url)) return 'service';

  // 某些浏览器会把 video/mp4 先交给 media 元素再触发解码错误；若已暴露视频尺寸，
  // 可直接确认它不是纯音频流，无需再按网络抖动重试。
  const mediaDimensions = audio as HTMLAudioElement & { videoWidth?: number; videoHeight?: number };
  if ((mediaDimensions.videoWidth || 0) > 0 || (mediaDimensions.videoHeight || 0) > 0) return 'service';

  const mediaError = audio.error;
  if (mediaError?.code === MediaError.MEDIA_ERR_ABORTED) return 'temporary';
  if (mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return 'service';

  if (
    mediaError?.code === MediaError.MEDIA_ERR_NETWORK
    || mediaError == null
    || mediaError?.code === MediaError.MEDIA_ERR_DECODE
  ) {
    const probe = await probeMediaUrl(url);
    const hasNonAudioResponse = Boolean(
      probe
      && probe.status >= 200
      && probe.status < 300
      && isKnownNonAudioContentType(probe.contentType),
    );
    if (probe && (isServiceHttpStatus(probe.status) || hasNonAudioResponse)) {
      return 'service';
    }
    // 解码失败但探测不到跨域响应时仍按临时错误重试，避免误切正常音源。
    return 'temporary';
  }

  return 'temporary';
}
