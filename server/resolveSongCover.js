import { fetchMetingApi } from './metingUpstream.js';
import { resizeCoverForThumb } from './coverUrl.js';

function normalizeResolvedUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.startsWith('@') ? text.slice(1).trim() : text;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

/** 是否为可直接给大厅 <img> 用的 CDN 封面（排除 meting type=pic 查询地址） */
export function isDirectCoverUrl(url) {
  const raw = String(url || '').trim();
  if (!isHttpUrl(raw)) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.searchParams.get('type') === 'pic') return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * 通过 Meting 解析歌曲封面 CDN 直链（服务端一次解析，写入房间后大厅直接下发）。
 */
export async function resolveSongCoverUrl(source, id, thumbPx = 96) {
  const songId = String(id || '').trim();
  if (!songId) return '';

  const server = String(source || 'netease').trim() || 'netease';
  const response = await fetchMetingApi(
    { server, type: 'pic', id: songId },
    { redirect: 'manual' },
    8000,
  );

  let url = '';
  if (response.status >= 300 && response.status < 400) {
    url = normalizeResolvedUrl(response.headers.get('location'));
    await response.body?.cancel?.().catch(() => {});
  } else if (response.ok) {
    url = normalizeResolvedUrl(await response.text());
  } else {
    await response.body?.cancel?.().catch(() => {});
  }

  if (!isHttpUrl(url)) return '';
  if (!isDirectCoverUrl(url)) return '';

  return thumbPx > 0 ? (resizeCoverForThumb(url, thumbPx) || url) : url;
}
