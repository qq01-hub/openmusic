import { lookup } from 'node:dns';
import { request } from 'node:https';
import { load } from 'cheerio/slim';
import { isBlockedMediaHostname } from './mediaProxy.js';
import { getRedisClient } from './roomStorage.js';
import { createDistributedSocketRateLimiter } from './socketRateLimiter.js';
import { createLogger, incrementMetric } from './logger.js';

const logger = createLogger('ai-web-search');
const SEARCH_HOSTS = new Set(['www.bing.com', 'cn.bing.com', 'html.duckduckgo.com']);
const MAX_BYTES = 512 * 1024;
const limiter = createDistributedSocketRateLimiter({ getRedisClient });

function searchError(code) {
  return Object.assign(new Error(code), { code });
}

function assertSearchUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !SEARCH_HOSTS.has(url.hostname)) throw searchError('WEB_SEARCH_TARGET_DENIED');
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
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
        'Accept-Encoding': 'identity',
      },
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error);
          if (!addresses.length || addresses.some(item => isBlockedMediaHostname(item.address))) {
            return callback(searchError('WEB_SEARCH_TARGET_DENIED'));
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
      if (status !== 200 || !['text/html', 'application/xhtml+xml'].includes(type)
        || !['', 'identity'].includes(String(response.headers['content-encoding'] || ''))
        || Number(response.headers['content-length'] || 0) > MAX_BYTES) {
        response.destroy();
        reject(searchError('WEB_SEARCH_RESPONSE_INVALID'));
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

export async function fetchSearchPage(rawUrl) {
  let url = assertSearchUrl(rawUrl);
  const signal = AbortSignal.timeout(8000);
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
    if (url.hostname === 'duckduckgo.com' && url.pathname === '/l/') {
      url = new URL(url.searchParams.get('uddg'));
    }
    if (url.hostname === 'www.bing.com' && url.pathname === '/ck/a') {
      const wrapped = url.searchParams.get('u');
      if (wrapped?.startsWith('a1')) url = new URL(Buffer.from(wrapped.slice(2), 'base64url').toString('utf8'));
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || isBlockedMediaHostname(url.hostname)
      || ['duckduckgo.com', ...SEARCH_HOSTS].includes(url.hostname)) return '';
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
  if (provider === 'bing') {
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
    for (const [provider, endpoint] of [
      ['bing', 'https://www.bing.com/search'],
      ['duckduckgo', 'https://html.duckduckgo.com/html/'],
    ]) {
      const url = new URL(endpoint);
      url.searchParams.set('q', query);
      if (provider === 'duckduckgo') url.searchParams.set('kl', 'cn-zh');
      try {
        const webResults = parseResults(provider, await fetchPage(url.href), limit);
        incrementMetric('room_ai_web_search_provider_total', { provider, result: webResults.length ? 'success' : 'empty' });
        if (!webResults.length) continue;
        incrementMetric('room_ai_web_search_total', { result: 'success' });
        logger.info('联网搜索完成', { provider, resultCount: webResults.length, durationMs: now() - started });
        return { success: true, query, provider, searchedAt: new Date(now()).toISOString(), untrusted: true, webResults };
      } catch (error) {
        incrementMetric('room_ai_web_search_provider_total', { provider, result: 'failed' });
        logger.warn('搜索后端请求失败', { provider, code: String(error?.code || 'WEB_SEARCH_UPSTREAM_FAILED').slice(0, 64) });
      }
    }
    logger.warn('联网搜索未取得有效结果', { durationMs: now() - started });
    return fail('WEB_SEARCH_UNAVAILABLE', '搜索服务暂不可用或未取得有效结果，不能据此声称已核实信息');
  };
}

export const searchWeb = createWebSearch();
