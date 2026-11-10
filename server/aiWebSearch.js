import { lookup } from 'node:dns';
import { request } from 'node:https';
import { load } from 'cheerio/slim';
import { isBlockedMediaHostname } from './mediaProxy.js';
import { getRedisClient } from './roomStorage.js';
import { createDistributedSocketRateLimiter } from './socketRateLimiter.js';
import { createLogger, incrementMetric } from './logger.js';

const logger = createLogger('ai-web-search');
const SEARCH_PATHS = new Map([
  ['www.bing.com', '/search'], ['cn.bing.com', '/search'],
  ['html.duckduckgo.com', '/html'], ['lite.duckduckgo.com', '/lite'],
  ['www.baidu.com', '/s'], ['www.sogou.com', '/web'],
]);
const SEARCH_PROVIDERS = [
  { id: 'bing-rss', endpoint: 'https://www.bing.com/search', params: { format: 'rss' } },
  { id: 'baidu', endpoint: 'https://www.baidu.com/s', queryParam: 'wd', params: { tn: 'json', rn: '5' } },
  { id: 'duckduckgo-lite', endpoint: 'https://lite.duckduckgo.com/lite/', params: { kl: 'cn-zh' } },
  { id: 'sogou', endpoint: 'https://www.sogou.com/web', queryParam: 'query' },
  { id: 'bing-cn', endpoint: 'https://cn.bing.com/search' },
  { id: 'duckduckgo', endpoint: 'https://html.duckduckgo.com/html/', params: { kl: 'cn-zh' } },
  { id: 'bing', endpoint: 'https://www.bing.com/search' },
];
const MAX_BYTES = 512 * 1024;
const SEARCH_TIMEOUT_MS = 16_000;
const PROVIDER_TIMEOUT_MS = 4_000;
const limiter = createDistributedSocketRateLimiter({ getRedisClient });

function searchError(code) {
  return Object.assign(new Error(code), { code });
}

function assertSearchUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !SEARCH_PATHS.has(url.hostname)
    || url.pathname.replace(/\/$/u, '') !== SEARCH_PATHS.get(url.hostname)) throw searchError('WEB_SEARCH_TARGET_DENIED');
  return url;
}

// 仅请求固定搜索站点，每次连接校验并绑定公网 DNS 地址，不请求搜索结果网页
function requestPage(url, signal) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      signal,
      agent: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OpenMusic/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml,application/json;q=0.9',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
        'Accept-Encoding': 'identity',
      },
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error);
          if (!addresses.length || addresses.some(item => isBlockedMediaHostname(item.address))) {
            return callback(searchError('WEB_SEARCH_DNS_BLOCKED'));
          }
          addresses.sort((a, b) => a.family - b.family);
          return options?.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
        });
      },
    }, response => {
      response.on('error', reject);
      const status = response.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.destroy();
        resolve({ location });
        return;
      }
      const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const types = ['text/html', 'application/xhtml+xml'];
      if (['www.bing.com', 'cn.bing.com'].includes(url.hostname) && url.searchParams.get('format') === 'rss') {
        types.push('application/rss+xml', 'application/xml', 'text/xml');
      }
      if (url.hostname === 'www.baidu.com' && url.searchParams.get('tn') === 'json') {
        types.push('application/json', 'text/json', 'text/plain');
      }
      if (status !== 200 || !types.includes(type)
        || !['', 'identity'].includes(String(response.headers['content-encoding'] || ''))
        || Number(response.headers['content-length'] || 0) > MAX_BYTES) {
        response.destroy();
        reject(searchError(status !== 200 ? `WEB_SEARCH_HTTP_${status}` : 'WEB_SEARCH_RESPONSE_INVALID'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          response.destroy(searchError('WEB_SEARCH_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function fetchSearchPage(rawUrl, { signal: parentSignal } = {}) {
  let url = assertSearchUrl(rawUrl);
  const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
  for (let hop = 0; hop < 3; hop += 1) {
    const result = await requestPage(url, signal);
    if (result.body !== undefined) return result.body;
    if (!result.location) throw searchError('WEB_SEARCH_REDIRECT_INVALID');
    url = assertSearchUrl(new URL(result.location, url));
  }
  throw searchError('WEB_SEARCH_REDIRECT_LIMIT');
}

function cleanText(value, limit) {
  const $ = load(String(value || ''));
  $('script, style, iframe, noscript').remove();
  return $.root().text().replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function sourceUrl(value) {
  try {
    let url = new URL(value, 'https://duckduckgo.com');
    if (['duckduckgo.com', 'html.duckduckgo.com', 'lite.duckduckgo.com'].includes(url.hostname) && url.pathname === '/l/') {
      url = new URL(url.searchParams.get('uddg'));
    }
    if (['www.bing.com', 'cn.bing.com'].includes(url.hostname) && url.pathname === '/ck/a') {
      const wrapped = url.searchParams.get('u');
      if (wrapped?.startsWith('a1')) url = new URL(Buffer.from(wrapped.slice(2), 'base64url').toString('utf8'));
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || isBlockedMediaHostname(url.hostname)
      || ['duckduckgo.com', ...SEARCH_PATHS.keys()].includes(url.hostname)) return '';
    url.hash = '';
    return url.href.length <= 1000 ? url.href : '';
  } catch { return ''; }
}

function parseResults(provider, body, limit) {
  const results = [];
  const seen = new Set();
  const add = (title, link, snippet) => {
    const url = sourceUrl(link);
    const name = cleanText(title, 120);
    if (!url || !name || seen.has(url) || results.length >= limit) return;
    seen.add(url);
    results.push({ title: name, url, snippet: cleanText(snippet, 350) });
  };
  if (provider === 'bing-rss') {
    const $ = load(body, { xmlMode: true });
    $('rss > channel > item').each((_index, item) => {
      add($(item).find('title').text(), $(item).find('link').text(), $(item).find('description').text());
    });
  } else if (provider === 'baidu') {
    let data;
    try { data = JSON.parse(body); } catch { return results; }
    if (data?.antiFlag === 1) throw searchError('WEB_SEARCH_CHALLENGE');
    for (const item of Array.isArray(data?.feed?.entry) ? data.feed.entry : []) {
      add(item?.title, item?.url, item?.abs);
    }
  } else if (provider === 'sogou') {
    const $ = load(body);
    $('.vrwrap, .rb').each((_index, item) => {
      const link = $(item).find('h3.pt a, h3.vr-title a').first();
      const href = link.attr('href');
      const direct = href?.startsWith('/link?') ? $(item).find('[data-url]').first().attr('data-url') : href;
      add(link.html(), direct, $(item).find('.ft, .attribute-centent, .fz-mid.space-txt').first().html());
    });
  } else if (provider === 'duckduckgo-lite') {
    const $ = load(body);
    $('a.result-link').each((_index, item) => {
      const row = $(item).closest('tr');
      const snippet = row.nextUntil('tr:has(a.result-link)').find('.result-snippet').first();
      add($(item).html(), $(item).attr('href'), snippet.html());
    });
  } else if (provider === 'bing' || provider === 'bing-cn') {
    const $ = load(body);
    $('#b_results .b_algo').each((_index, item) => {
      const link = $(item).find('h2 a').first();
      add(link.html(), link.attr('href'), $(item).find('p').html());
    });
  } else {
    const $ = load(body);
    $('.result').each((_index, item) => {
      const link = $(item).find('a.result__a').first();
      add(link.html(), link.attr('href'), $(item).find('.result__snippet').html());
    });
  }
  return results;
}

export function createWebSearch({ fetchPage = fetchSearchPage, limiter: rateLimiter = limiter, now = () => Date.now() } = {}) {
  return async function search(args = {}, { principal } = {}) {
    const fail = (code, error, extra = {}) => {
      incrementMetric('room_ai_web_search_total', { result: code });
      return { success: false, code, error, ...extra };
    };
    if (typeof principal !== 'string' || !/^acct_[a-zA-Z0-9_-]{16,64}$/u.test(principal)) {
      return fail('WEB_SEARCH_ACCOUNT_REQUIRED', '无法确认当前成员账户，未执行联网搜索');
    }
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 240
      || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 5))) {
      return fail('INVALID_ARGUMENTS', '搜索词需为1～240字符，结果数量需为1～5的整数');
    }
    const query = args.query.trim();
    const limit = args.limit ?? 3;
    try {
      for (const policy of [
        { scope: 'room-ai-web-account', principal, windowMs: 60000, max: 6 },
        { scope: 'room-ai-web-global', principal: 'all', windowMs: 60000, max: 30 },
      ]) {
        const rate = await rateLimiter.consume(policy);
        if (rate.unavailable) return fail('WEB_SEARCH_STORAGE_UNAVAILABLE', '搜索限流存储暂不可用');
        if (!rate.allowed) return fail('WEB_SEARCH_RATE_LIMITED', '联网搜索频率过高，请稍后再试', { retryAfterMs: rate.retryAfterMs });
      }
    } catch {
      return fail('WEB_SEARCH_STORAGE_UNAVAILABLE', '搜索限流存储暂不可用');
    }
    const started = now();
    const deadline = started + SEARCH_TIMEOUT_MS;
    const failures = [];
    // 每批最多请求两个不同入口，首个有效结果返回后取消其余请求
    for (let index = 0; index < SEARCH_PROVIDERS.length && now() < deadline; index += 2) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(searchError('WEB_SEARCH_TIMEOUT')), Math.min(PROVIDER_TIMEOUT_MS, deadline - now()));
      try {
        const { provider, webResults } = await Promise.any(SEARCH_PROVIDERS.slice(index, index + 2).map(async backend => {
          const provider = backend.id;
          const url = new URL(backend.endpoint);
          for (const [key, value] of Object.entries(backend.params || {})) url.searchParams.set(key, value);
          url.searchParams.set(backend.queryParam || 'q', query);
          try {
            const webResults = parseResults(provider, await fetchPage(url.href, { signal: controller.signal }), limit);
            if (!webResults.length) throw searchError('WEB_SEARCH_NO_RESULTS');
            incrementMetric('room_ai_web_search_provider_total', { provider, result: 'success' });
            return { provider, webResults };
          } catch (error) {
            if (controller.signal.reason?.code === 'WEB_SEARCH_CANCELLED') throw error;
            const code = controller.signal.aborted ? 'WEB_SEARCH_TIMEOUT' : String(error?.code || 'WEB_SEARCH_UPSTREAM_FAILED').slice(0, 64);
            failures.push({ provider, code });
            incrementMetric('room_ai_web_search_provider_total', { provider, result: code === 'WEB_SEARCH_NO_RESULTS' ? 'empty' : 'failed' });
            logger.warn('搜索后端未取得有效结果', { provider, code });
            throw error;
          }
        }));
        incrementMetric('room_ai_web_search_total', { result: 'success' });
        logger.info('联网搜索完成', { provider, resultCount: webResults.length, durationMs: now() - started });
        return { success: true, query, provider, searchedAt: new Date(now()).toISOString(), untrusted: true, webResults };
      } catch {
        // 本批全部失败后继续尝试下一批，不把单个搜索源故障当成模型不支持联网
      } finally {
        clearTimeout(timer);
        controller.abort(searchError('WEB_SEARCH_CANCELLED'));
      }
    }
    logger.warn('联网搜索未取得有效结果', { durationMs: now() - started });
    if (failures.length && failures.every(item => item.code === 'WEB_SEARCH_DNS_BLOCKED')) {
      return fail('WEB_SEARCH_DNS_BLOCKED', '搜索来源的 DNS 解析未通过公网校验，请管理员检查服务器 DNS 或代理 Fake-IP 配置；本次未完成搜索，不代表模型不支持联网', { failures });
    }
    return fail('WEB_SEARCH_UNAVAILABLE', '已尝试内置免费搜索，但本次来源连接失败、受限或未取得有效结果；不代表模型不支持联网，不能声称已核实信息', { failures });
  };
}

export const searchWeb = createWebSearch();
