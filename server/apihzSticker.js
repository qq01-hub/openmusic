import {
  buildApihzUrl,
  fetchApihz,
  getApihzId,
  getApihzKey,
  isApihzConfigured,
} from './apihz.js';
import { shuffleStickers } from './builtinStickers.js';

const STICKER_ENDPOINT = 'img/apihzbqbbaidu.php';
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 20;
const SEARCH_TIMEOUT_MS = 10000;

export function isApihzStickerConfigured() {
  return isApihzConfigured();
}

export async function searchApihzStickers(words, page = 1, limit = DEFAULT_LIMIT) {
  if (!isApihzStickerConfigured()) {
    throw new Error('未配置表情包搜索');
  }

  const normalizedWords = String(words || '').trim();
  if (!normalizedWords) throw new Error('请输入搜索关键词');
  if (normalizedWords.length > 32) throw new Error('关键词过长');

  const safePage = Math.max(1, Math.min(200, Number(page) || 1));
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));

  const params = new URLSearchParams({
    id: getApihzId(),
    key: getApihzKey(),
    limit: String(safeLimit),
    page: String(safePage),
    words: normalizedWords,
  });

  const res = await fetchApihz(`${buildApihzUrl(STICKER_ENDPOINT)}?${params.toString()}`, {}, SEARCH_TIMEOUT_MS);
  if (!res.ok) throw new Error('搜索服务暂时不可用');

  const data = await res.json();
  if (Number(data?.code) !== 200) {
    throw new Error(data?.msg || data?.message || '搜索失败');
  }

  const images = Array.isArray(data.res)
    ? data.res.filter((item) => typeof item === 'string' && item.startsWith('https://'))
    : [];

  return {
    images,
    page: Number(data.page) || safePage,
    maxPage: Math.max(1, Number(data.maxpage) || 1),
    count: Number(data.count) || images.length,
  };
}

export async function searchApihzStickersRandom(words, count = 5, { random = Math.random, excludeUrls = [] } = {}) {
  const safeCount = Math.max(1, Math.min(MAX_LIMIT, Number(count) || 5));
  const first = await searchApihzStickers(words, 1, MAX_LIMIT);
  let pool = [...(first.images || [])];

  const maxCandidatePage = Math.min(Number(first.maxPage) || 1, 5);
  if (maxCandidatePage > 1) {
    const pickedPage = 1 + Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * maxCandidatePage);
    if (pickedPage > 1) {
      try {
        const extra = await searchApihzStickers(words, pickedPage, MAX_LIMIT);
        pool.push(...(extra.images || []));
      } catch {
        // 保留第 1 页已取到的候选
      }
    }
  }

  const excluded = new Set(Array.isArray(excludeUrls) ? excludeUrls : []);
  const unique = [...new Set(pool)];
  const filtered = unique.filter((url) => !excluded.has(url));
  const candidates = filtered.length ? filtered : unique;

  return {
    images: shuffleStickers(candidates, random).slice(0, safeCount),
    maxPage: first.maxPage,
    count: first.count,
  };
}
