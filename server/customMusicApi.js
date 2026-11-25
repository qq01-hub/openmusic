import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBlockedMediaHostname } from './mediaProxy.js';
import { getRuntimeConfig } from './runtimeConfig.js';

export const MUSIC_API_PLATFORMS = new Set(['netease', 'tencent', 'kugou', 'qishui']);
export const MUSIC_API_OPERATIONS = new Set([
  'search',
  'song',
  'url',
  'lrc',
  'pic',
  'playlist',
  'search_playlist',
]);
export const MUSIC_API_METHODS = new Set(['GET', 'POST']);

const TEMPLATE_VARIABLES = new Set(['id', 'keyword', 'quality', 'limit', 'server', 'artist', 'album', 'n']);
const DEFAULT_WEIGHT = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;
const JSON_PATH_PATTERN = /^(?:\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*|(?:[A-Za-z_$][\w$]*|\[\d+\])(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)$/;
const endpointStates = new Map();
const endpointFingerprints = new Map();
const roundRobinCursors = new Map();
const responseCache = new Map();
const RESPONSE_CACHE_TTL_MS = 10_000;
const RESPONSE_CACHE_MAX_ENTRIES = 2048;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
let configSignature = '';

function isMetadataOrLinkLocalHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/u, '');
  if (!host) return true;
  if (host === 'metadata.google.internal' || host === 'metadata' || host === 'metadata.goog') return true;
  if (/^169\.254\./.test(host) || /^::ffff:169\.254\./.test(host) || /^fe[89ab]/i.test(host)) return true;
  return false;
}

function isDisallowedCustomApiHostname(hostname) {
  if (isMetadataOrLinkLocalHost(hostname)) return true;
  if (process.env.ALLOW_PRIVATE_CUSTOM_MUSIC_API === '1') return false;
  return isBlockedMediaHostname(hostname);
}

async function assertSafeCustomApiTarget(parsedUrl) {
  const host = String(parsedUrl.hostname || '').replace(/^\[|\]$/g, '');
  if (isDisallowedCustomApiHostname(host)) {
    throw new Error('自定义音乐接口目标地址不允许指向内网或元数据主机');
  }
  if (isIP(host)) return;
  const records = await dnsLookup(host, { all: true });
  if (!records.length || records.some((record) => isDisallowedCustomApiHostname(record.address))) {
    throw new Error('自定义音乐接口域名解析到受限内网或元数据地址');
  }
}

function pruneResponseCache(now = Date.now()) {
  for (const [key, entry] of responseCache) {
    if (entry.expires <= now) responseCache.delete(key);
  }
  while (responseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (!oldest) break;
    responseCache.delete(oldest);
  }
}

async function readResponseTextLimited(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`自定义音乐接口响应过大（>${maxBytes} bytes）`);
    }
    return text;
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`自定义音乐接口响应过大（>${maxBytes} bytes）`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString('utf8');
}

const responseCacheCleanupTimer = setInterval(() => pruneResponseCache(), RESPONSE_CACHE_TTL_MS);
responseCacheCleanupTimer.unref?.();

function normalizeInteger(value, fallback, min, max, label) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}必须是 ${min}–${max} 的整数`);
  }
  return number;
}

export function parseJsonPath(path) {
  const value = String(path || '').trim();
  if (!value || !JSON_PATH_PATTERN.test(value)) return null;
  if (value === '$') return ['$'];
  const tokens = [];
  for (const match of value.matchAll(/([A-Za-z_$][\w$]*)|\[(\d+)\]/g)) {
    tokens.push(match[1] ?? Number(match[2]));
  }
  return tokens;
}

export function getJsonPath(value, path) {
  const tokens = parseJsonPath(path);
  if (!tokens) return undefined;
  let current = value;
  for (const token of tokens) {
    if (token === '$') continue;
    if (current === null || current === undefined) return undefined;
    if (typeof token === 'string') {
      if (FORBIDDEN_JSON_KEYS.has(token)) return undefined;
      if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    }
    current = current[token];
  }
  return current;
}

export function renderTemplate(template, variables, { encode = false } = {}) {
  return String(template ?? '').replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    if (!TEMPLATE_VARIABLES.has(name)) return match;
    const value = String(variables?.[name] ?? '');
    return encode ? encodeURIComponent(value) : value;
  });
}

function validateTemplate(value, label) {
  for (const match of String(value || '').matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    if (!TEMPLATE_VARIABLES.has(match[1])) {
      throw new Error(`${label}包含不支持的变量 {${match[1]}}`);
    }
  }
}

function normalizeHeaders(raw, index) {
  let value = raw ?? {};
  if (typeof value === 'string') {
    try {
      value = value.trim() ? JSON.parse(value) : {};
    } catch {
      throw new Error(`musicApis[${index}].headers 必须是有效 JSON`);
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`musicApis[${index}].headers 必须是 JSON 对象`);
  }
  const headers = {};
  for (const [name, headerValue] of Object.entries(value)) {
    const key = String(name).trim();
    if (!key || key.length > 128 || typeof headerValue !== 'string') {
      throw new Error(`musicApis[${index}].headers 仅允许字符串键值`);
    }
    validateTemplate(headerValue, `musicApis[${index}].headers.${key}`);
    headers[key] = headerValue.slice(0, 8192);
  }
  return headers;
}

function normalizeParams(raw, index) {
  let value = raw ?? {};
  if (typeof value === 'string') {
    try {
      value = value.trim() ? JSON.parse(value) : {};
    } catch {
      throw new Error(`musicApis[${index}].params 必须是有效 JSON`);
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`musicApis[${index}].params 必须是 JSON 对象`);
  }
  const params = {};
  for (const [name, paramValue] of Object.entries(value)) {
    const key = String(name).trim();
    if (!key || key.length > 128 || !['string', 'number', 'boolean'].includes(typeof paramValue)) {
      throw new Error(`musicApis[${index}].params 仅允许字符串、数字或布尔值`);
    }
    const text = String(paramValue);
    validateTemplate(text, `musicApis[${index}].params.${key}`);
    params[key] = text.slice(0, 8192);
  }
  return params;
}

function normalizeMapping(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`musicApis[${index}].mapping 必须是对象`);
  }
  const mapping = {};
  for (const [field, path] of Object.entries(raw)) {
    if (!field || field.length > 64 || typeof path !== 'string' || !parseJsonPath(path)) {
      throw new Error(`musicApis[${index}].mapping.${field} 必须是有效 JSON 路径`);
    }
    mapping[field] = path.trim();
  }
  if (Object.keys(mapping).length === 0) {
    throw new Error(`musicApis[${index}].mapping 不能为空`);
  }
  return mapping;
}

export function normalizeMusicApis(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('musicApis 必须是数组');
  if (raw.length > 100) throw new Error('musicApis 最多允许 100 条');

  const ids = new Set();
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`musicApis[${index}] 必须是对象`);
    }
    const rawPlatforms = Array.isArray(item.platforms)
      ? item.platforms
      : [item.platform].filter(Boolean);
    const platforms = [...new Set(rawPlatforms.map((value) => String(value || '').trim().toLowerCase()))];
    const rawOperations = Array.isArray(item.operations)
      ? item.operations
      : [item.operation].filter(Boolean);
    const operations = [...new Set(rawOperations.map((value) => String(value || '').trim().toLowerCase()))];
    const method = String(item.method || 'GET').trim().toUpperCase();
    const url = String(item.url || '').trim();
    if (platforms.length === 0 || platforms.some((platform) => !MUSIC_API_PLATFORMS.has(platform))) {
      throw new Error(`musicApis[${index}].platforms 无效`);
    }
    if (operations.length === 0 || operations.some((operation) => !MUSIC_API_OPERATIONS.has(operation))) {
      throw new Error(`musicApis[${index}].operations 无效`);
    }
    if (!MUSIC_API_METHODS.has(method)) {
      throw new Error(`musicApis[${index}].method 仅支持 GET/POST`);
    }
    validateTemplate(url, `musicApis[${index}].url`);
    try {
      const probe = new URL(renderTemplate(url, {
        id: 'x',
        keyword: 'x',
        quality: 'x',
        limit: '1',
        server: platforms[0],
      }));
      if (probe.protocol !== 'http:' && probe.protocol !== 'https:') throw new Error();
      if (isDisallowedCustomApiHostname(probe.hostname)) {
        throw new Error('BLOCKED_HOST');
      }
    } catch (err) {
      if (err?.message === 'BLOCKED_HOST') {
        throw new Error(`musicApis[${index}].url 不允许指向内网或云元数据地址`);
      }
      throw new Error(`musicApis[${index}].url 必须是 http/https 地址模板`);
    }
    const body = item.body === undefined || item.body === null ? '' : item.body;
    if (typeof body !== 'string') throw new Error(`musicApis[${index}].body 必须是字符串模板`);
    validateTemplate(body, `musicApis[${index}].body`);
    const id = String(item.id || `music-api-${index + 1}`).trim().slice(0, 128);
    if (!id) throw new Error(`musicApis[${index}].id 不能为空`);
    if (ids.has(id)) throw new Error(`musicApis[${index}].id 不能重复`);
    ids.add(id);
    return {
      id,
      name: String(item.name || '').trim().slice(0, 128),
      remark: String(item.remark || '').trim().slice(0, 1000),
      enabled: item.enabled !== false,
      platforms,
      operations,
      weight: normalizeInteger(item.weight, DEFAULT_WEIGHT, 1, 1000, `musicApis[${index}].weight`),
      timeoutMs: normalizeInteger(item.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 60_000, `musicApis[${index}].timeoutMs`),
      failureThreshold: normalizeInteger(
        item.failureThreshold,
        DEFAULT_FAILURE_THRESHOLD,
        1,
        20,
        `musicApis[${index}].failureThreshold`,
      ),
      cooldownMs: normalizeInteger(
        item.cooldownMs,
        DEFAULT_COOLDOWN_MS,
        5000,
        10 * 60_000,
        `musicApis[${index}].cooldownMs`,
      ),
      method,
      url: url.slice(0, 8192),
      params: normalizeParams(item.params, index),
      headers: normalizeHeaders(item.headers, index),
      body: body.slice(0, 65536),
      mapping: normalizeMapping(item.mapping, index),
    };
  });
}

function syncEndpointStates(apis) {
  const signature = JSON.stringify(apis);
  if (signature === configSignature) return;
  if (configSignature) responseCache.clear();
  const validIds = new Set(apis.map((endpoint) => endpoint.id));
  for (const key of endpointStates.keys()) {
    const endpointId = key.split('\n', 1)[0];
    if (!validIds.has(endpointId)) endpointStates.delete(key);
  }
  for (const endpoint of apis) {
    const fingerprint = JSON.stringify(endpoint);
    if (endpointFingerprints.has(endpoint.id) && endpointFingerprints.get(endpoint.id) !== fingerprint) {
      for (const key of endpointStates.keys()) {
        if (key.startsWith(`${endpoint.id}\n`)) endpointStates.delete(key);
      }
    }
    endpointFingerprints.set(endpoint.id, fingerprint);
  }
  for (const id of endpointFingerprints.keys()) {
    if (!validIds.has(id)) endpointFingerprints.delete(id);
  }
  configSignature = signature;
}

function routeStateKey(endpointId, platform, operation) {
  return `${endpointId}\n${platform}\n${operation}`;
}

function getRouteState(endpoint, platform, operation) {
  const key = routeStateKey(endpoint.id, platform, operation);
  let state = endpointStates.get(key);
  if (!state) {
    state = {
      circuitState: 'closed',
      openedUntil: 0,
      halfOpenInFlight: false,
      consecutiveFailures: 0,
      okCount: 0,
      failCount: 0,
      lastError: '',
      lastFailureAt: 0,
      lastSuccessAt: 0,
    };
    endpointStates.set(key, state);
  }
  return state;
}

function refreshCircuitState(state, now) {
  if (state.circuitState === 'open' && now >= state.openedUntil) {
    state.circuitState = 'half-open';
    state.halfOpenInFlight = false;
  }
}

function getConfiguredApis(config) {
  const apis = Array.isArray(config?.musicApis) ? config.musicApis : [];
  syncEndpointStates(apis);
  return apis;
}

function operationVariables(query) {
  const id = String(query?.id || '');
  return {
    id,
    keyword: String(query?.keyword ?? id),
    quality: String(query?.quality || ''),
    limit: String(query?.limit || ''),
    server: String(query?.server || ''),
    artist: String(query?.artist || ''),
    album: String(query?.album || ''),
    n: String(query?.n || ''),
  };
}

function mappedValue(source, path, payload) {
  const local = getJsonPath(source, path);
  return local === undefined && source !== payload ? getJsonPath(payload, path) : local;
}

function mapStructuredResponse(payload, endpoint, operation, platform) {
  const { mapping } = endpoint;
  const selected = mapping.items ? getJsonPath(payload, mapping.items) : payload;
  const sourceItems = Array.isArray(selected) ? selected : [selected];
  const fields = Object.entries(mapping).filter(([field]) => field !== 'items' && field !== 'value');
  const mapped = sourceItems.filter((item) => item !== null && item !== undefined).map((item) => {
    const result = {};
    for (const [field, path] of fields) {
      const value = mappedValue(item, path, payload);
      if (value !== undefined && value !== null) result[field] = value;
    }
    if (operation !== 'search_playlist' && !Object.hasOwn(result, 'source')) {
      result.source = platform;
    }
    return result;
  });
  return mapped.filter((item) => {
    if (operation === 'search_playlist') return String(item.id || '') && String(item.name || '');
    return String(item.id || '') || String(item.url || '');
  });
}

export function mapMusicApiResponse(payload, endpoint, requestedOperation, requestedPlatform) {
  const operation = requestedOperation || endpoint.operations?.[0] || endpoint.operation;
  if (['url', 'lrc', 'pic'].includes(operation)) {
    const path = endpoint.mapping[operation] || endpoint.mapping.value;
    const value = path ? getJsonPath(payload, path) : payload;
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    return '';
  }
  const platform = requestedPlatform || endpoint.platforms?.[0] || endpoint.platform;
  return mapStructuredResponse(payload, endpoint, operation, platform);
}

function hasCriticalResult(result) {
  return Array.isArray(result) ? result.length > 0 : Boolean(String(result || '').trim());
}

function orderedEndpoints(apis, platform, operation, now) {
  const matching = apis.filter((item) => (
    item.enabled && item.platforms.includes(platform) && item.operations.includes(operation)
  ));
  const eligible = matching.filter((endpoint) => {
    const state = getRouteState(endpoint, platform, operation);
    refreshCircuitState(state, now);
    return state.circuitState === 'closed'
      || (state.circuitState === 'half-open' && !state.halfOpenInFlight);
  });
  if (eligible.length <= 1) return eligible;

  const key = `${platform}:${operation}`;
  const signature = eligible.map((endpoint) => `${endpoint.id}:${endpoint.weight}`).join('|');
  const totalWeight = eligible.reduce((sum, endpoint) => sum + endpoint.weight, 0);
  let scheduler = roundRobinCursors.get(key);
  if (!scheduler || scheduler.signature !== signature) {
    scheduler = { signature, current: new Map() };
  }
  let selected = eligible[0];
  let selectedWeight = Number.NEGATIVE_INFINITY;
  for (const endpoint of eligible) {
    const current = (scheduler.current.get(endpoint.id) || 0) + endpoint.weight;
    scheduler.current.set(endpoint.id, current);
    if (current > selectedWeight) {
      selected = endpoint;
      selectedWeight = current;
    }
  }
  scheduler.current.set(selected.id, selectedWeight - totalWeight);
  roundRobinCursors.set(key, scheduler);
  const failovers = eligible
    .filter((endpoint) => endpoint.id !== selected.id)
    .sort((a, b) => b.weight - a.weight);
  return [selected, ...failovers];
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {}
}

async function requestEndpoint(endpoint, query, timeoutMs, fetchImpl, preview = false) {
  const variables = operationVariables(query);
  const headers = {};
  for (const [name, value] of Object.entries(endpoint.headers)) {
    headers[name] = renderTemplate(value, variables);
  }
  if (endpoint.method === 'POST' && endpoint.body && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const url = new URL(renderTemplate(endpoint.url, variables, { encode: true }));
  for (const [name, value] of Object.entries(endpoint.params)) {
    url.searchParams.set(name, renderTemplate(value, variables));
  }
  const renderedBody = endpoint.method === 'POST' ? renderTemplate(endpoint.body, variables) : '';
  const canShareResponse = endpoint.operations.length > 1;
  const cacheKey = JSON.stringify(canShareResponse ? [
    endpoint.id,
    endpoint.method,
    query?.server || '',
    url.toString(),
    renderedBody,
  ] : [
    endpoint.id,
    endpoint.method,
    query?.server || '',
    query?.type || '',
    url.toString(),
    renderedBody,
    query?.id || '',
    query?.keyword || '',
    query?.quality || '',
    query?.limit || '',
    query?.artist || '',
    query?.album || '',
    query?.n || '',
  ]);
  const cached = canShareResponse ? responseCache.get(cacheKey) : null;
  if (cached && cached.expires > Date.now()) {
    if (preview) return { payload: cached.payload, result: null };
    const cachedResult = mapMusicApiResponse(
      cached.payload,
      endpoint,
      String(query?.type || ''),
      String(query?.server || ''),
    );
    if (!hasCriticalResult(cachedResult)) {
      responseCache.delete(cacheKey);
      const error = new Error('自定义音乐接口返回空关键结果');
      error.countsForCircuit = false;
      throw error;
    }
    return {
      payload: cached.payload,
      result: cachedResult,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (fetchImpl === fetch) {
      await assertSafeCustomApiTarget(url);
    }
    const response = await fetchImpl(url.toString(), {
      method: endpoint.method,
      headers,
      body: endpoint.method === 'POST' ? renderedBody : undefined,
      signal: controller.signal,
      redirect: 'error',
    });
    if (response.status >= 500) {
      await cancelResponseBody(response);
      throw new Error(`自定义音乐接口返回 ${response.status}`);
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      const error = new Error(`自定义音乐接口返回 ${response.status}`);
      error.status = response.status;
      error.countsForCircuit = response.status !== 404;
      throw error;
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new Error(`自定义音乐接口响应过大（>${MAX_RESPONSE_BYTES} bytes）`);
    }
    const text = await readResponseTextLimited(response, MAX_RESPONSE_BYTES);
    let payload = text;
    try {
      payload = JSON.parse(text);
    } catch {
      if (!preview && !['url', 'lrc', 'pic'].includes(String(query?.type || ''))) {
        throw new Error('自定义音乐接口未返回 JSON');
      }
    }
    if (preview) {
      if (canShareResponse) {
        responseCache.set(cacheKey, { payload, expires: Date.now() + RESPONSE_CACHE_TTL_MS });
        pruneResponseCache();
      }
      return { payload, result: null };
    }
    const result = mapMusicApiResponse(
      payload,
      endpoint,
      String(query?.type || ''),
      String(query?.server || ''),
    );
    if (!hasCriticalResult(result)) {
      const error = new Error('自定义音乐接口返回空关键结果');
      error.countsForCircuit = false;
      throw error;
    }
    if (canShareResponse) {
      responseCache.set(cacheKey, { payload, expires: Date.now() + RESPONSE_CACHE_TTL_MS });
      pruneResponseCache();
    }
    return { payload, result };
  } finally {
    clearTimeout(timer);
  }
}

function listJsonPaths(value, prefix = '', output = [], depth = 0) {
  if (output.length >= 1000 || depth > 12 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    if (prefix) output.push(prefix);
    value.slice(0, 20).forEach((item, index) => {
      const path = `${prefix}[${index}]`;
      listJsonPaths(item, path, output, depth + 1);
    });
    return output;
  }
  if (typeof value === 'object') {
    if (prefix) output.push(prefix);
    Object.entries(value).slice(0, 100).forEach(([key, item]) => {
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) return;
      const path = prefix ? `${prefix}.${key}` : key;
      listJsonPaths(item, path, output, depth + 1);
    });
    return output;
  }
  if (!prefix && ['string', 'number', 'boolean'].includes(typeof value)) output.push('$');
  if (prefix) output.push(prefix);
  return output;
}

export async function previewCustomMusicApi(rawApi, variables = {}, { fetchImpl = fetch } = {}) {
  const endpoint = normalizeMusicApis([{ ...rawApi, enabled: true }])[0];
  const operation = endpoint.operations[0];
  const platform = MUSIC_API_PLATFORMS.has(String(variables.server || '').toLowerCase())
    ? String(variables.server).toLowerCase()
    : endpoint.platforms[0];
  const query = {
    server: platform,
    type: operation,
    id: variables.id || '123456',
    keyword: variables.keyword || '周杰伦',
    quality: variables.quality || '320',
    limit: variables.limit || '10',
  };
  const { payload } = await requestEndpoint(endpoint, query, endpoint.timeoutMs, fetchImpl, true);
  return {
    response: payload,
    paths: [...new Set(listJsonPaths(payload))],
  };
}

export async function fetchCustomMusicApi(
  query,
  { timeoutMs = 10000, fetchImpl = fetch, config = getRuntimeConfig(), now = Date.now } = {},
) {
  const platform = String(query?.server || '').toLowerCase();
  const operation = String(query?.type || '').toLowerCase();
  if (!MUSIC_API_PLATFORMS.has(platform) || !MUSIC_API_OPERATIONS.has(operation)) return null;
  const apis = getConfiguredApis(config);
  const candidates = orderedEndpoints(apis, platform, operation, now());
  if (candidates.length === 0) return null;

  let lastError = null;
  for (const endpoint of candidates) {
    const state = getRouteState(endpoint, platform, operation);
    const currentTime = now();
    refreshCircuitState(state, currentTime);
    const probing = state.circuitState === 'half-open';
    if (probing) state.halfOpenInFlight = true;
    try {
      const effectiveTimeoutMs = endpoint.timeoutMs || timeoutMs;
      const { result } = await requestEndpoint(endpoint, query, effectiveTimeoutMs, fetchImpl);
      state.okCount += 1;
      state.consecutiveFailures = 0;
      state.circuitState = 'closed';
      state.openedUntil = 0;
      state.halfOpenInFlight = false;
      state.lastError = '';
      state.lastSuccessAt = now();
      const textOperation = ['url', 'lrc', 'pic'].includes(operation);
      return new Response(textOperation ? result : JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': textOperation ? 'text/plain; charset=utf-8' : 'application/json' },
      });
    } catch (error) {
      state.failCount += 1;
      state.halfOpenInFlight = false;
      state.lastError = error?.message || '请求失败';
      state.lastFailureAt = now();
      if (error?.countsForCircuit === false) {
        // 404 / 空业务结果说明接口可达，只做本次故障切换，不应维持或触发熔断。
        state.circuitState = 'closed';
        state.openedUntil = 0;
        state.consecutiveFailures = 0;
      } else {
        state.consecutiveFailures += 1;
        if (probing || state.consecutiveFailures >= endpoint.failureThreshold) {
          state.circuitState = 'open';
          state.openedUntil = now() + endpoint.cooldownMs;
        }
      }
      lastError = error;
    }
  }
  throw lastError || new Error('所有自定义音乐接口均不可用');
}

export function hasCustomMusicApi(platform, operation) {
  return getConfiguredApis(getRuntimeConfig()).some((item) => (
    item.enabled && item.platforms.includes(platform) && item.operations.includes(operation)
  ));
}

export function getCustomMusicApiStatus() {
  const apis = getConfiguredApis(getRuntimeConfig());
  const now = Date.now();
  return {
    configured: apis.some((item) => item.enabled),
    routes: apis.flatMap((endpoint) => endpoint.platforms.flatMap((platform) => (
      endpoint.operations.map((operation) => {
        const state = getRouteState(endpoint, platform, operation);
        refreshCircuitState(state, now);
        return {
          id: endpoint.id,
          name: endpoint.name,
          remark: endpoint.remark,
          platform,
          operation,
          enabled: endpoint.enabled,
          weight: endpoint.weight,
          circuitState: endpoint.enabled ? state.circuitState : 'disabled',
          healthy: endpoint.enabled && state.circuitState !== 'open',
          cooldownRemainingSec: state.circuitState === 'open'
            ? Math.max(0, Math.ceil((state.openedUntil - now) / 1000))
            : 0,
          consecutiveFailures: state.consecutiveFailures,
          okCount: state.okCount,
          failCount: state.failCount,
          lastError: state.lastError,
          lastFailureAt: state.lastFailureAt,
          lastSuccessAt: state.lastSuccessAt,
        };
      })
    ))),
  };
}

export function resetCustomMusicApiCircuit(endpointId = '') {
  const target = String(endpointId || '').trim();
  for (const [key, state] of endpointStates.entries()) {
    if (target && !key.startsWith(`${target}\n`)) continue;
    state.circuitState = 'closed';
    state.openedUntil = 0;
    state.halfOpenInFlight = false;
    state.consecutiveFailures = 0;
    state.lastError = '';
  }
  return getCustomMusicApiStatus();
}
