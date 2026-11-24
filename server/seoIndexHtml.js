/**
 * 将运行时 SEO（尤其是百度验证 meta）写入 client/dist/index.html，
 * 供 Nginx 静态直出时百度爬虫能抓到与平台一致的源码。
 */
import fs from 'fs';
import path from 'path';
import { applySeoToHtml } from './seoFiles.js';

const STAT_CHECK_INTERVAL_MS = 1000;
const MAX_HTML_CACHE_PATHS = 8;
const MAX_RENDERED_VARIANTS = 32;

const htmlCache = new Map();

function storeHtmlEntry(htmlPath, html, stat) {
  htmlCache.delete(htmlPath);
  const entry = {
    html,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    checkedAt: Date.now(),
    rendered: new Map(),
  };
  htmlCache.set(htmlPath, entry);
  while (htmlCache.size > MAX_HTML_CACHE_PATHS) {
    const oldestPath = htmlCache.keys().next().value;
    if (oldestPath === undefined) break;
    htmlCache.delete(oldestPath);
  }
  return entry;
}

function loadHtmlEntry(htmlPath) {
  const now = Date.now();
  const cached = htmlCache.get(htmlPath);
  if (cached && now - cached.checkedAt < STAT_CHECK_INTERVAL_MS) {
    return cached;
  }
  let stat;
  try {
    stat = fs.statSync(htmlPath);
  } catch {
    htmlCache.delete(htmlPath);
    return null;
  }
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    cached.checkedAt = now;
    return cached;
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  return storeHtmlEntry(htmlPath, html, stat);
}

/**
 * @param {string} clientDist
 * @param {{ baiduVerification?: string, siteOrigin?: string }} opts
 */
export function patchClientIndexHtml(clientDist, opts = {}) {
  const htmlPath = path.join(clientDist, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    htmlCache.delete(htmlPath);
    return { ok: false, error: 'index.html 不存在' };
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const next = applySeoToHtml(html, {
    baiduVerification: opts.baiduVerification,
    siteOrigin: opts.siteOrigin || '',
  });
  if (next === html) {
    try {
      storeHtmlEntry(htmlPath, html, fs.statSync(htmlPath));
    } catch {
      htmlCache.delete(htmlPath);
    }
    return { ok: true, unchanged: true };
  }
  fs.writeFileSync(htmlPath, next, 'utf8');
  try {
    storeHtmlEntry(htmlPath, next, fs.statSync(htmlPath));
  } catch {
    htmlCache.delete(htmlPath);
  }
  return { ok: true };
}

/**
 * @param {string} clientDist
 * @param {{ baiduVerification?: string, siteOrigin?: string }} opts
 * @returns {string | null}
 */
export function readClientIndexHtml(clientDist, opts = {}) {
  const htmlPath = path.join(clientDist, 'index.html');
  const entry = loadHtmlEntry(htmlPath);
  if (!entry) return null;
  const baiduVerification = opts.baiduVerification || '';
  const siteOrigin = opts.siteOrigin || '';
  const variantKey = `${baiduVerification}\0${siteOrigin}`;
  const cachedVariant = entry.rendered.get(variantKey);
  if (cachedVariant !== undefined) return cachedVariant;
  const rendered = applySeoToHtml(entry.html, {
    baiduVerification: opts.baiduVerification,
    siteOrigin,
  });
  entry.rendered.set(variantKey, rendered);
  while (entry.rendered.size > MAX_RENDERED_VARIANTS) {
    const oldestVariant = entry.rendered.keys().next().value;
    if (oldestVariant === undefined) break;
    entry.rendered.delete(oldestVariant);
  }
  return rendered;
}
