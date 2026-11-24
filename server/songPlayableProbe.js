import {
  fetchMetingApi,
  invalidateMetingUrlCache,
  isConfiguredMetingUrl,
} from './metingUpstream.js';
import {
  DEFAULT_MEDIA_UA,
  fetchMediaWithSafeRedirects,
  refererForMediaUrl,
} from './mediaProxy.js';

const QQ_PLACEHOLDER_HOST = 'aqqmusic.tc.qq.com';
const MEDIA_FILE_EXT = /\.(mp3|m4a|flac|ogg|wav|aac|wma)$/i;
const CDN_PROBE_TIMEOUT_MS = 5000;
const UNPLAYABLE_CDN_STATUSES = new Set([403, 404, 410, 451]);

function isNonAudioContentType(contentType) {
  const mediaType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (!mediaType) return false;
  return mediaType.startsWith('video/')
    || mediaType.startsWith('text/')
    || mediaType === 'application/json'
    || mediaType === 'application/xml'
    || mediaType === 'application/xhtml+xml'
    || mediaType.startsWith('image/');
}

async function probeCdnMediaPlayability(rawUrl) {
  const extraAllowedHosts = [];
  if (isConfiguredMetingUrl(rawUrl)) {
    try {
      extraAllowedHosts.push(new URL(rawUrl).hostname.toLowerCase());
    } catch {
      // 忽略非法 URL 解析失败，由外链校验兜底
    }
  }
  let response;
  try {
    response = await fetchMediaWithSafeRedirects(
      null,
      rawUrl,
      {
        method: 'GET',
        headers: {
          'User-Agent': DEFAULT_MEDIA_UA,
          Referer: refererForMediaUrl(rawUrl),
          Range: 'bytes=0-0',
        },
        extraAllowedHosts,
      },
      CDN_PROBE_TIMEOUT_MS,
    );
    if (UNPLAYABLE_CDN_STATUSES.has(response.status)) {
      return false;
    }
    if (
      (response.status === 200 || response.status === 206)
      && isNonAudioContentType(response.headers.get('content-type') || '')
    ) {
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`媒体 CDN 可播性探测跳过（${rawUrl.slice(0, 80)}）：`, err?.message || err);
    return true;
  } finally {
    await response?.body?.cancel?.().catch(() => {});
  }
}

function normalizeUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.startsWith('@') ? text.slice(1).trim() : text;
}

function isQqPlaceholderUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== QQ_PLACEHOLDER_HOST) return false;
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname || pathname === '/') return true;
    return !MEDIA_FILE_EXT.test(pathname);
  } catch {
    return false;
  }
}

function isPlayableHttpUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized.startsWith('http')) return false;
  if (isQqPlaceholderUrl(normalized)) return false;
  return true;
}

function parseUrlPayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      return normalizeUrl(data?.url);
    } catch {
      return '';
    }
  }
  return normalizeUrl(text);
}

function parseQishuiSourcePayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  try {
    const data = JSON.parse(text);
    const url = normalizeUrl(data?.url);
    const auth = String(data?.auth || '').trim();
    return isPlayableHttpUrl(url) && Boolean(auth);
  } catch {
    return false;
  }
}

async function probeMetingUrl(source, id, deps) {
  deps.invalidateUrlCache(source, id);
  const response = await deps.fetchMeting(
    { server: source, type: 'url', id },
    { redirect: 'manual', bypassCache: true },
    12000,
  );

  let resolvedUrl = '';
  if (response.status >= 300 && response.status < 400) {
    const location = normalizeUrl(response.headers.get('location'));
    await response.body?.cancel?.().catch(() => {});
    if (!isPlayableHttpUrl(location)) {
      deps.invalidateUrlCache(source, id);
      return false;
    }
    resolvedUrl = location;
  } else if (response.status === 404 || response.status === 403 || response.status >= 400) {
    await response.body?.cancel?.().catch(() => {});
    deps.invalidateUrlCache(source, id);
    return false;
  } else {
    const text = await response.text();
    const url = parseUrlPayload(text);
    if (!isPlayableHttpUrl(url)) {
      deps.invalidateUrlCache(source, id);
      return false;
    }
    resolvedUrl = url;
  }

  // 汽水第一层 URL 只是播放会话；必须继续取 mode=source，确认真正的
  // CDN 地址和音频密钥仍存在，否则 no url 会被误判成「服务端可播」。
  if (source === 'qishui') {
    const sourceEndpoint = new URL(resolvedUrl);
    sourceEndpoint.searchParams.set('mode', 'source');
    const sourceResponse = await deps.fetchMeting(
      sourceEndpoint.toString(),
      { redirect: 'manual', bypassCache: true },
      12000,
    );
    if (!sourceResponse.ok) {
      await sourceResponse.body?.cancel?.().catch(() => {});
      deps.invalidateUrlCache(source, id);
      return false;
    }
    const validQishui = parseQishuiSourcePayload(await sourceResponse.text());
    if (!validQishui) {
      deps.invalidateUrlCache(source, id);
    }
    return validQishui;
  }

  const cdnPlayable = await deps.probeCdn(resolvedUrl);
  if (!cdnPlayable) {
    deps.invalidateUrlCache(source, id);
    return false;
  }
  return true;
}

async function probeKugouUrl(id, deps) {
  // 与实际播放链路保持一致：Meting 为默认来源，管理后台自定义接口仅在 Meting 无结果时兜底。
  return probeMetingUrl('kugou', id, deps);
}

const DEFAULT_PROBE_DEPS = {
  fetchMeting: fetchMetingApi,
  invalidateUrlCache: invalidateMetingUrlCache,
  probeCdn: probeCdnMediaPlayability,
};

/**
 * 服务端探测当前曲是否仍可解析出可播放地址。
 * 用于 source_error 切歌：避免主控本机网络差误判为全屋音源异常。
 */
export async function isSongPlayableOnServer(song, deps = DEFAULT_PROBE_DEPS) {
  const id = String(song?.id || '').trim();
  if (!id) return false;

  const source = String(song?.source || 'netease').toLowerCase();
  const resolvedDeps = { ...DEFAULT_PROBE_DEPS, ...(deps || {}) };
  try {
    if (source === 'kugou') return await probeKugouUrl(id, resolvedDeps);
    if (source === 'netease' || source === 'tencent' || source === 'kugou' || source === 'qishui') {
      return await probeMetingUrl(source, id, resolvedDeps);
    }
    return false;
  } catch (err) {
    const message = String(err?.message || err);
    console.warn(`音源探测失败（${source}:${id}）：`, message);
    // 明确无链 / 上游业务 403：确认不可播，允许切歌
    if (/no\s*url|空播放|上游返回 403|未返回有效媒体|不可播外链/i.test(message)) {
      resolvedDeps.invalidateUrlCache(source, id);
      return false;
    }
    // 探测本身失败（上游抖动）时不视为「确认无源」，避免误切
    return true;
  }
}

export const __test = {
  isNonAudioContentType,
  probeCdnMediaPlayability,
};
