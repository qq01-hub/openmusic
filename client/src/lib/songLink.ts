import { extractMusicShareUrl } from './playlistLink';

export function detectSongLink(input: string): string | null {
  let url: URL;
  try { url = new URL(extractMusicShareUrl(input)); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;

  const { hostname, pathname, hash } = url;
  if (
    (/^(?:y\.)?music\.163\.com$/.test(hostname) && /^\/(?:m\/)?song(?:\/|\?|$)/i.test(hash.startsWith('#/') ? hash.slice(1) : pathname))
    || (/^(?:www\.)?163cn\.tv$/.test(hostname) && pathname !== '/')
    || (/^(?:i2?\.|c6?\.|u\.)?y\.qq\.com$|^c\.yym\.qq\.com$/.test(hostname)
      && /\/(?:songDetail(?:\/|$)|song(?:\/[a-z0-9]+)?\.html$)|^\/base\/fcgi-bin\/u$|^\/cgi-bin\/musicu\.fcg$/i.test(pathname))
    || (/^(?:(?:www|m|t[123])\.)?kugou\.com$/.test(hostname) && /^\/(?:song(?:\/|\.html|$)|(?:share|mixsong)\/[^/]+\.html$)/i.test(pathname))
    || (hostname === 'music.douyin.com' && pathname === '/qishui/share/track')
    || (hostname === 'qishui.douyin.com' && pathname.startsWith('/s/'))
  ) return url.href;
  return null;
}
