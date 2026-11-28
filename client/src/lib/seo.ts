import { useEffect, useState } from 'react';
import { fetchWithTimeout } from '../api/http';
import { isPureModeDisguiseActive } from './roomPureMode';

export const SITE_NAME = 'OpenMusic';

export const DEFAULT_TITLE = '一起听歌 - 和喜欢的人 听同一首歌 | OpenMusic';
export const DEFAULT_DESCRIPTION =
  'OpenMusic 是一款免费的在线一起听歌平台，支持多人实时同步播放、共同点歌与边听边聊。无论情侣异地、室友宿舍还是远方好友，只需创建房间并分享链接，就能同步听同一首歌。支持全网曲库搜索与歌词实时滚动，打开浏览器即可使用，无需下载安装客户端。';
export const DEFAULT_KEYWORDS =
  '一起听歌,多人听歌,和朋友一起听歌,在线一起听歌,情侣一起听歌,异地一起听歌,同步听歌,OpenMusic';

export const DEFAULT_HERO_HEADLINE = '和喜欢的人';
export const DEFAULT_HERO_SUBLINE = '听同一首歌';
export const DEFAULT_ABOUT_TITLE = '关于 OpenMusic';
export const DEFAULT_ABOUT_TEXT =
  'OpenMusic 是免费的在线音乐同步平台。在浏览器中创建房间、分享链接，好友加入后即可实时同播、轮流点歌、边看歌词边聊天。适合情侣异地陪伴、室友宿舍聚会，或任何想共享音乐时刻的场景。';

const FEATURE_LIST = [
  '多人房间进度实时同步',
  '支持轮流点歌与播放列表',
  '异地远程也能同听一首歌',
  '边听边聊，宿舍聚会也适用',
];

export const SEO_FAQS: { q: string; a: string }[] = [
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

export type SiteSeoConfig = {
  siteName: string;
  title: string;
  description: string;
  keywords: string;
  canonicalUrl: string;
  baiduVerification: string;
  ogImage: string;
  heroHeadline: string;
  heroSubline: string;
  aboutTitle: string;
  aboutText: string;
  featureList: string[];
  faqs: { q: string; a: string }[];
};

let remoteSeo: SiteSeoConfig | null = null;
let remoteSeoPromise: Promise<SiteSeoConfig | null> | null = null;

function builtinSeo(): SiteSeoConfig {
  return {
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    keywords: DEFAULT_KEYWORDS,
    canonicalUrl: '',
    baiduVerification: '',
    ogImage: '/og-cover.jpg',
    heroHeadline: DEFAULT_HERO_HEADLINE,
    heroSubline: DEFAULT_HERO_SUBLINE,
    aboutTitle: DEFAULT_ABOUT_TITLE,
    aboutText: DEFAULT_ABOUT_TEXT,
    featureList: FEATURE_LIST,
    faqs: SEO_FAQS,
  };
}

export function getActiveSeo(): SiteSeoConfig {
  return remoteSeo || builtinSeo();
}

export async function fetchSiteSeo(force = false): Promise<SiteSeoConfig> {
  if (!force && remoteSeo) return remoteSeo;
  if (!force && remoteSeoPromise) {
    const cached = await remoteSeoPromise;
    return cached || getActiveSeo();
  }

  remoteSeoPromise = (async () => {
    try {
      const res = await fetchWithTimeout('/api/site-seo', { method: 'GET' }, 5000);
      if (!res.ok) return null;
      const data = await res.json() as Partial<SiteSeoConfig>;
      const next: SiteSeoConfig = {
        ...builtinSeo(),
        siteName: String(data.siteName || '').trim() || SITE_NAME,
        title: String(data.title || '').trim() || DEFAULT_TITLE,
        description: String(data.description || '').trim() || DEFAULT_DESCRIPTION,
        keywords: String(data.keywords || '').trim() || DEFAULT_KEYWORDS,
        canonicalUrl: String(data.canonicalUrl || '').trim().replace(/\/$/, ''),
        baiduVerification: String(data.baiduVerification || '').trim(),
        ogImage: String(data.ogImage || '').trim() || '/og-cover.jpg',
        heroHeadline: String(data.heroHeadline || '').trim() || DEFAULT_HERO_HEADLINE,
        heroSubline: String(data.heroSubline || '').trim() || DEFAULT_HERO_SUBLINE,
        aboutTitle: String(data.aboutTitle || '').trim() || DEFAULT_ABOUT_TITLE,
        aboutText: String(data.aboutText || '').trim() || DEFAULT_ABOUT_TEXT,
        featureList: Array.isArray(data.featureList) && data.featureList.length
          ? data.featureList.map(String)
          : FEATURE_LIST,
        faqs: Array.isArray(data.faqs) && data.faqs.length
          ? data.faqs.map((item) => ({
            q: String((item as { q?: string }).q || '').trim(),
            a: String((item as { a?: string }).a || '').trim(),
          })).filter((item) => item.q && item.a)
          : SEO_FAQS,
      };
      remoteSeo = next;
      return next;
    } catch {
      return null;
    } finally {
      remoteSeoPromise = null;
    }
  })();

  const loaded = await remoteSeoPromise;
  return loaded || getActiveSeo();
}

export interface PageSeoOptions {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noindex?: boolean;
}

/** 优先后台规范域，否则当前访问域 */
export function getSiteOrigin(): string {
  const canonical = getActiveSeo().canonicalUrl;
  if (canonical) return canonical;
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  return '';
}

function upsertMeta(name: string, content: string, attribute: 'name' | 'property' = 'name') {
  if (!content && name === 'baidu-site-verification') {
    document.head.querySelector(`meta[${attribute}="${name}"]`)?.remove();
    return;
  }
  let el = document.head.querySelector(`meta[${attribute}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attribute, name);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

function resolveOgImage(origin: string, ogImage: string) {
  if (/^https?:\/\//i.test(ogImage)) return ogImage;
  const path = ogImage.startsWith('/') ? ogImage : `/${ogImage}`;
  return origin ? `${origin}${path}` : path;
}

function upsertJsonLd(origin: string, seo: SiteSeoConfig) {
  const appId = 'openmusic-json-ld';
  let appEl = document.getElementById(appId) as HTMLScriptElement | null;
  const appData = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: seo.siteName,
    alternateName: [
      '一起听歌',
      '多人听歌',
      '和朋友一起听歌',
      '点歌房',
    ],
    description: seo.description,
    ...(origin ? { url: `${origin}/` } : {}),
    applicationCategory: 'MusicApplication',
    operatingSystem: 'Web Browser',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    inLanguage: 'zh-CN',
    featureList: seo.featureList,
    publisher: {
      '@type': 'Organization',
      name: seo.siteName,
      ...(origin ? { url: `${origin}/` } : {}),
    },
  };

  if (!appEl) {
    appEl = document.createElement('script');
    appEl.id = appId;
    appEl.type = 'application/ld+json';
    document.head.appendChild(appEl);
  }
  appEl.textContent = JSON.stringify(appData);

  const breadcrumbId = 'openmusic-breadcrumb-json-ld';
  let breadcrumbEl = document.getElementById(breadcrumbId) as HTMLScriptElement | null;
  const breadcrumbData = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: '首页',
        ...(origin ? { item: `${origin}/` } : {}),
      },
    ],
  };
  if (!breadcrumbEl) {
    breadcrumbEl = document.createElement('script');
    breadcrumbEl.id = breadcrumbId;
    breadcrumbEl.type = 'application/ld+json';
    document.head.appendChild(breadcrumbEl);
  }
  breadcrumbEl.textContent = JSON.stringify(breadcrumbData);
}

export function buildPageTitle(pageTitle?: string) {
  const seo = getActiveSeo();
  if (!pageTitle) return seo.title;
  if (pageTitle.includes(seo.siteName) || pageTitle.includes(SITE_NAME)) return pageTitle;
  return `${pageTitle} - ${seo.siteName}`;
}

export function applyPageSeo(options: PageSeoOptions = {}) {
  if (typeof document === 'undefined') return;

  const seo = getActiveSeo();
  const title = buildPageTitle(options.title);
  const description = options.description || seo.description;
  const origin = getSiteOrigin();
  const path = options.path ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const url = origin ? `${origin}${path}` : path;
  const image = options.image || resolveOgImage(origin, seo.ogImage);
  const robots = options.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large';

  if (!isPureModeDisguiseActive()) {
    document.title = title;
  }
  upsertMeta('description', description);
  upsertMeta('keywords', seo.keywords);
  upsertMeta('robots', robots);
  upsertMeta('application-name', seo.siteName);
  if (seo.baiduVerification) {
    upsertMeta('baidu-site-verification', seo.baiduVerification);
  } else {
    upsertMeta('baidu-site-verification', '');
  }

  if (origin) {
    upsertLink('canonical', url);
    upsertJsonLd(origin, seo);
  }

  upsertMeta('og:title', title, 'property');
  upsertMeta('og:description', description, 'property');
  if (origin) upsertMeta('og:url', url, 'property');
  upsertMeta('og:image', image, 'property');
  upsertMeta('og:type', 'website', 'property');
  upsertMeta('og:locale', 'zh_CN', 'property');
  upsertMeta('og:site_name', seo.siteName, 'property');

  upsertMeta('twitter:card', 'summary_large_image');
  upsertMeta('twitter:title', title);
  upsertMeta('twitter:description', description);
  upsertMeta('twitter:image', image);
}

export function usePageSeo(options: PageSeoOptions) {
  const { title, description, path, image, noindex } = options;

  useEffect(() => {
    let cancelled = false;
    void fetchSiteSeo().then(() => {
      if (!cancelled) applyPageSeo({ title, description, path, image, noindex });
    });
    applyPageSeo({ title, description, path, image, noindex });
    return () => {
      cancelled = true;
      applyPageSeo();
    };
  }, [title, description, path, image, noindex]);
}

/** 首页等需要展示后台 SEO 文案的组件（当前首页不用，避免动可见区） */
export function useSiteSeoConfig(): SiteSeoConfig {
  const [seo, setSeo] = useState<SiteSeoConfig>(() => getActiveSeo());
  useEffect(() => {
    let cancelled = false;
    void fetchSiteSeo().then((next) => {
      if (!cancelled) setSeo(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return seo;
}

/** React 成功启动后交由各页面输出可见标题，避免与静态兜底 h1 重复。 */
export function removeSeoBootstrap() {
  const el = document.getElementById('seo-bootstrap');
  el?.remove();
}
