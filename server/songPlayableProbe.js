import { fetchMetingApi } from './metingUpstream.js';

const QQ_PLACEHOLDER_HOST = 'aqqmusic.tc.qq.com';
const MEDIA_FILE_EXT = /\.(mp3|m4a|flac|ogg|wav|aac|wma)$/i;

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

async function probeMetingUrl(source, id) {
  const response = await fetchMetingApi(
    { server: source, type: 'url', id },
    { redirect: 'manual' },
    12000,
  );

  if (response.status >= 300 && response.status < 400) {
    const location = normalizeUrl(response.headers.get('location'));
    await response.body?.cancel?.().catch(() => {});
    return isPlayableHttpUrl(location);
  }

  if (response.status === 404 || response.status === 403 || response.status >= 400) {
    await response.body?.cancel?.().catch(() => {});
    return false;
  }

  const text = await response.text();
  const url = parseUrlPayload(text);
  if (!isPlayableHttpUrl(url)) return false;

  // 汽水第一层 URL 只是播放会话；必须继续取 mode=source，确认真正的
  // CDN 地址和音频密钥仍存在，否则 no url 会被误判成「服务端可播」。
  if (source === 'qishui') {
    const sourceEndpoint = new URL(url);
    sourceEndpoint.searchParams.set('mode', 'source');
    const sourceResponse = await fetchMetingApi(
      sourceEndpoint.toString(),
      { redirect: 'manual' },
      12000,
    );
    if (!sourceResponse.ok) {
      await sourceResponse.body?.cancel?.().catch(() => {});
      return false;
    }
    return parseQishuiSourcePayload(await sourceResponse.text());
  }

  return true;
}

async function probeKugouUrl(id) {
  // 与实际播放链路保持一致：Meting 为默认来源，管理后台自定义接口仅在 Meting 无结果时兜底。
  return probeMetingUrl('kugou', id);
}

/**
 * 服务端探测当前曲是否仍可解析出可播放地址。
 * 用于 source_error 切歌：避免主控本机网络差误判为全屋音源异常。
 */
export async function isSongPlayableOnServer(song) {
  const id = String(song?.id || '').trim();
  if (!id) return false;

  const source = String(song?.source || 'netease').toLowerCase();
  try {
    if (source === 'kugou') return await probeKugouUrl(id);
    if (source === 'netease' || source === 'tencent' || source === 'kugou' || source === 'qishui') {
      return await probeMetingUrl(source, id);
    }
    return false;
  } catch (err) {
    const message = String(err?.message || err);
    console.warn(`音源探测失败（${source}:${id}）：`, message);
    // 明确无链 / 上游业务 403：确认不可播，允许切歌
    if (/no\s*url|空播放|上游返回 403|未返回有效媒体|不可播外链/i.test(message)) {
      return false;
    }
    // 探测本身失败（上游抖动）时不视为「确认无源」，避免误切
    return true;
  }
}
