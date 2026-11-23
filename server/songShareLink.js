import { fetchPublicHttpsOnce } from './mediaProxy.js';

const HOSTS = {
  netease: new Set(['music.163.com', 'y.music.163.com', '163cn.tv', 'www.163cn.tv']),
  tencent: new Set(['y.qq.com', 'i.y.qq.com', 'i2.y.qq.com', 'c.y.qq.com', 'c6.y.qq.com', 'u.y.qq.com', 'c.yym.qq.com']),
  kugou: new Set(['kugou.com', 'www.kugou.com', 'm.kugou.com', 't1.kugou.com', 't2.kugou.com', 't3.kugou.com']),
  qishui: new Set(['music.douyin.com', 'qishui.douyin.com']),
};
const KUGOU_HASH = /^[a-f0-9]{32}$/i;

function classifySongShareLink(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  url.protocol = 'https:';
  const source = Object.keys(HOSTS).find((key) => HOSTS[key].has(url.hostname));
  if (!source) return null;

  const route = source === 'netease' && url.hash.startsWith('#/')
    ? new URL(url.origin + url.hash.slice(1)) : url;
  const { pathname, searchParams } = route;
  let id = '';
  if (source === 'netease') {
    id = pathname.match(/^\/(?:m\/)?song\/(\d+)\/?$/i)?.[1]
      || (/^\/(?:m\/)?song\/?$/i.test(pathname) ? searchParams.get('id') : '');
    if (/^\d{1,24}$/.test(id)) return { source, id };
    if (['163cn.tv', 'www.163cn.tv'].includes(url.hostname) && /^\/[a-z0-9_-]+\/?$/i.test(pathname)) return { source, url };
  }
  if (source === 'tencent') {
    const legacySong = pathname.match(/\/song\/([a-z0-9]+)\.html$/i);
    const songPage = legacySong || /\/(?:songDetail(?:\/|$)|song\.html$)/i.test(pathname);
    if (songPage) {
      id = legacySong?.[1] || pathname.match(/\/songDetail\/([a-z0-9]+)\/?$/i)?.[1]
        || searchParams.get('songmid') || searchParams.get('mid') || searchParams.get('songid') || searchParams.get('id') || '';
      if (/^[a-z0-9]{1,32}$/i.test(id)) return { source, id };
    }
    if (['/base/fcgi-bin/u', '/cgi-bin/musicu.fcg'].includes(pathname) && ['c6.y.qq.com', 'c.y.qq.com', 'u.y.qq.com'].includes(url.hostname)) {
      return { source, url };
    }
  }
  if (source === 'kugou') {
    if (/^\/(?:song\/?|song\.html)$/i.test(pathname)) {
      id = searchParams.get('hash') || new URLSearchParams(url.hash.slice(1)).get('hash');
      if (KUGOU_HASH.test(id)) return { source, id };
      if (/^t[123]\.kugou\.com$/.test(url.hostname) && /^[a-z0-9]{1,64}$/i.test(searchParams.get('id') || '')) return { source, url };
    }
    if (/^\/(?:mixsong|share)\/[a-z0-9_-]+\.html$/i.test(pathname)) return { source, url, html: true };
  }
  if (source === 'qishui') {
    if (pathname === '/qishui/share/track') id = searchParams.get('track_id');
    if (/^\d{1,24}$/.test(id)) return { source, id };
    if (url.hostname === 'qishui.douyin.com' && /^\/s\/[a-z0-9_-]+\/?$/i.test(pathname)) return { source, url };
  }
  return null;
}

async function readKugouShareHash(response) {
  if (!response.body || !/^text\/html\b/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let html = '';
  try {
    while (size < 256 * 1024) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) break;
      html += decoder.decode(value, { stream: true });
      const hash = html.match(/\bvar\s+dataFromSmarty\s*=\s*\[\s*\{\s*"hash"\s*:\s*"([a-f0-9]{32})"/i)?.[1];
      if (hash) return hash;
    }
    return '';
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function resolveSongShareLink(input, enabled, fetchOnce = fetchPublicHttpsOnce) {
  let link = classifySongShareLink(input);
  if (!link) return { error: '请粘贴支持的单曲分享链接', status: 400, code: 'SONG_LINK_INVALID' };
  const { source } = link;
  if (!enabled(source)) return { error: '该链接的音源未启用', status: 503, code: 'SOURCE_DISABLED' };
  const signal = AbortSignal.timeout(7000);
  try {
    for (let hop = 0; hop <= 4 && link?.source === source; hop++) {
      if (link.id) return { source, id: link.id };
      if (hop === 4) break;
      const response = await fetchOnce(link.url.href, signal, HOSTS[source]);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        link = location ? classifySongShareLink(new URL(location, link.url).href) : null;
        continue;
      }
      if (response.ok && link.html) {
        const id = await readKugouShareHash(response);
        if (id) return { source, id };
      } else {
        await response.body?.cancel();
      }
      break;
    }
  } catch {
    return { error: '音乐平台暂时无法打开该链接，请稍后重试', status: 502, code: 'SONG_LINK_UPSTREAM_ERROR' };
  }
  return { error: '链接未指向可识别的单曲', status: 422, code: 'SONG_LINK_UNRESOLVED' };
}
