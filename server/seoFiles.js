/**
 * OpenMusic 站点 SEO 文案与 robots/sitemap 生成。
 * 客户端 / Vite / Node 共用，禁止引入 Node 专属 API。
 *
 * 只写正常人会搜的口语词；标题短、自然；FAQ 精简，不堆砌。
 */

export const SITE_NAME = 'OpenMusic';

/** 口语主词在前，场景清楚，品牌在后 */
export const DEFAULT_TITLE = '一起听歌 - 和喜欢的人 听同一首歌 | OpenMusic';

export const DEFAULT_DESCRIPTION =
  'OpenMusic 是一款免费的在线一起听歌平台，支持多人实时同步播放、共同点歌与边听边聊。无论情侣异地、室友宿舍还是远方好友，只需创建房间并分享链接，就能同步听同一首歌。支持全网曲库搜索与歌词实时滚动，打开浏览器即可使用，无需下载安装客户端。';

/** 真人会搜的词靠前；别塞生造词 */
export const DEFAULT_KEYWORDS =
  '一起听歌,多人听歌,和朋友一起听歌,在线一起听歌,情侣一起听歌,异地一起听歌,同步听歌,OpenMusic';

export const DEFAULT_HERO_HEADLINE = '和喜欢的人';
export const DEFAULT_HERO_SUBLINE = '听同一首歌';
export const DEFAULT_ABOUT_TITLE = '关于 OpenMusic';
export const DEFAULT_ABOUT_TEXT =
  'OpenMusic 是免费的在线音乐同步平台。在浏览器中创建房间、分享链接，好友加入后即可实时同播、轮流点歌、边看歌词边聊天。适合情侣异地陪伴、室友宿舍聚会，或任何想共享音乐时刻的场景。';

export const FEATURE_LIST = [
  '多人房间进度实时同步',
  '支持轮流点歌与播放列表',
  '异地远程也能同听一首歌',
  '边听边聊，宿舍聚会也适用',
];

/** 精简 FAQ：只覆盖最高频口语问法 */
export const SEO_FAQS = [
  {
    q: '怎么和朋友一起听歌？',
    a: '打开 OpenMusic 创建房间，把房间号或链接发给朋友。对方加入后进度自动同步，可以共同点歌、边看歌词边聊天。',
  },
  {
    q: '异地怎么同步播放？',
    a: '双方进入同一个在线房间即可，歌曲进度实时对齐，适合情侣或远方好友远程陪伴。',
  },
  {
    q: '两个人怎么听同一首歌？',
    a: '创建房间后邀请对方加入，播放进度保持一致，还能轮流添加歌曲到播放列表。',
  },
];

/** 可收录的静态路径（不含 /room /tv /admin） */
export const INDEXABLE_PATHS = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
];

/** SEO 字段默认值（后台留空时回退） */
export function getSeoDefaults() {
  return {
    seoTitle: DEFAULT_TITLE,
    seoDescription: DEFAULT_DESCRIPTION,
    seoKeywords: DEFAULT_KEYWORDS,
    seoSiteName: SITE_NAME,
    seoCanonicalUrl: '',
    seoBaiduVerification: '',
    seoOgImage: '/og-cover.jpg',
    seoHeroHeadline: DEFAULT_HERO_HEADLINE,
    seoHeroSubline: DEFAULT_HERO_SUBLINE,
    seoAboutTitle: DEFAULT_ABOUT_TITLE,
    seoAboutText: DEFAULT_ABOUT_TEXT,
  };
}

/**
 * @param {Record<string, unknown>} [config]
 */
export function buildPublicSiteSeo(config = {}) {
  const d = getSeoDefaults();
  const pick = (key, maxLen) => {
    const raw = String(config[key] ?? '').trim();
    if (!raw) return d[key];
    return maxLen ? raw.slice(0, maxLen) : raw;
  };
  const ogImage = pick('seoOgImage', 500);
  return {
    siteName: pick('seoSiteName', 80),
    title: pick('seoTitle', 120),
    description: pick('seoDescription', 300),
    keywords: pick('seoKeywords', 400),
    canonicalUrl: String(config.seoCanonicalUrl || '').trim().replace(/\/$/, ''),
    baiduVerification: String(config.seoBaiduVerification || '').trim().slice(0, 120),
    ogImage: ogImage.startsWith('/') || /^https?:\/\//i.test(ogImage) ? ogImage : d.seoOgImage,
    heroHeadline: pick('seoHeroHeadline', 40),
    heroSubline: pick('seoHeroSubline', 80),
    aboutTitle: pick('seoAboutTitle', 80),
    aboutText: pick('seoAboutText', 800),
    featureList: FEATURE_LIST,
    faqs: SEO_FAQS,
  };
}

/**
 * @param {string | Iterable<string> | null | undefined} allowedOrigins
 * @param {string} [canonicalEnv]
 */
export function resolvePrimarySiteOrigin(allowedOrigins, canonicalEnv = '') {
  const fromEnv = String(canonicalEnv || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (typeof allowedOrigins === 'string') {
    const first = allowedOrigins.split(',')[0]?.trim().replace(/\/$/, '');
    if (first) return first;
    return '';
  }

  if (allowedOrigins && typeof allowedOrigins[Symbol.iterator] === 'function') {
    const list = [...allowedOrigins];
    if (list.length > 0) return String(list[0]).replace(/\/$/, '');
  }

  return '';
}

/**
 * @param {import('express').Request} req
 * @param {Set<string> | string[] | null | undefined} allowedOrigins
 * @param {{ canonicalEnv?: string }} [opts]
 */
export function resolveSiteOrigin(req, allowedOrigins, opts = {}) {
  const primary = resolvePrimarySiteOrigin(allowedOrigins, opts.canonicalEnv);
  if (primary) return primary;

  const forwardedProto = req.get?.('x-forwarded-proto') || req.headers?.['x-forwarded-proto'];
  const proto = (
    (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : '')
    || req.protocol
    || 'http'
  );
  const forwardedHost = req.get?.('x-forwarded-host') || req.headers?.['x-forwarded-host'];
  const host = (
    (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0].trim() : '')
    || req.get?.('host')
    || req.headers?.host
    || 'localhost'
  );
  return `${proto}://${host}`.replace(/\/$/, '');
}

/** @param {import('http').IncomingMessage} req */
export function resolveDevSiteOrigin(req) {
  const host = req.headers.host || 'localhost:5173';
  return `http://${host}`.replace(/\/$/, '');
}

export function buildRobotsTxt(siteOrigin) {
  const origin = String(siteOrigin || '').replace(/\/$/, '');
  return [
    '# OpenMusic · 一起听歌',
    'User-agent: *',
    'Allow: /',
    '',
    '# 房间与电视页由服务端 X-Robots-Tag: noindex, nofollow 控制。',
    '# 保持可抓取，确保搜索引擎能读取该禁止收录指令。',
    '',
    origin ? `Sitemap: ${origin}/sitemap.xml` : 'Sitemap: /sitemap.xml',
    '',
  ].join('\n');
}

/**
 * @param {string} siteOrigin
 * @param {{ lastmod?: string }} [opts]
 */
export function buildSitemapXml(siteOrigin, opts = {}) {
  const origin = String(siteOrigin || '').replace(/\/$/, '');
  const lastmod = opts.lastmod || new Date().toISOString().slice(0, 10);
  const urls = INDEXABLE_PATHS.map((item) => {
    const loc = `${origin}${item.path === '/' ? '/' : item.path}`;
    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      `    <changefreq>${item.changefreq}</changefreq>`,
      `    <priority>${item.priority}</priority>`,
      '  </url>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}



/**
 * @param {string} html
 * @param {string} siteOrigin
 */
export function applySiteOriginToHtml(html, siteOrigin) {
  const origin = String(siteOrigin || '').replace(/\/$/, '');
  if (!html) return html;
  return html.split('__SITE_ORIGIN__').join(origin);
}

/**
 * 百度站长要求标签字面量与平台一致（含自闭合 `/`）。
 * 只保留安全字符，避免写进 HTML 属性。
 * @param {string} [code]
 */
export function sanitizeBaiduVerificationCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return '';
  const matched = raw.match(/content\s*=\s*["']([^"']+)["']/i);
  const value = (matched?.[1] || raw).trim();
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
}

/**
 * 严格按搜索资源平台示例输出，勿改格式。
 * @param {string} [code]
 */
export function buildBaiduVerificationMeta(code) {
  const value = sanitizeBaiduVerificationCode(code);
  if (!value) return '';
  return `<meta name="baidu-site-verification" content="${value}" />`;
}

const BAIDU_META_RE = /<meta\s+name=["']baidu-site-verification["']\s+content=["'][^"']*["']\s*\/?\s*>/gi;
const BAIDU_PLACEHOLDER = '<!-- __BAIDU_SITE_VERIFICATION__ -->';

/**
 * @param {string} html
 * @param {{ siteOrigin?: string, baiduVerification?: string }} [opts]
 */
export function applySeoToHtml(html, opts = {}) {
  if (!html) return html;
  let out = applySiteOriginToHtml(html, opts.siteOrigin);
  const meta = buildBaiduVerificationMeta(opts.baiduVerification);
  // 先清掉旧标签，再写入占位符位置，保证源码里是百度要求的完整一行
  out = out.replace(BAIDU_META_RE, '');
  if (out.includes(BAIDU_PLACEHOLDER)) {
    out = out.split(BAIDU_PLACEHOLDER).join(meta ? `${BAIDU_PLACEHOLDER}\n    ${meta}` : BAIDU_PLACEHOLDER);
  } else if (meta) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n    ${meta}`);
  }
  return out;
}
