const DEFAULT_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

const SENSITIVE_KEY_RE = /(?:authorization|cookie|password|secret|token|key|credential|session|sid)/i;
const metrics = new Map();

function resolveLevel() {
  const raw = String(process.env.LOG_LEVEL || DEFAULT_LEVEL).trim().toLowerCase();
  return LEVELS[raw] ? raw : DEFAULT_LEVEL;
}

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[resolveLevel()];
}

function redactValue(key, value) {
  if (SENSITIVE_KEY_RE.test(String(key || ''))) return '[REDACTED]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : value.stack,
    };
  }
  return value;
}

function redactMeta(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Error) return redactValue('error', value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactMeta(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactMeta(redactValue(key, item), seen)]),
  );
}

function write(level, scope, message, meta) {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(meta && typeof meta === 'object' ? { meta: redactMeta(meta) } : {}),
  };
  const line = JSON.stringify(payload);
  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  writer(line);
}

export function createLogger(scope) {
  const name = String(scope || 'app').trim() || 'app';
  return {
    debug: (message, meta) => write('debug', name, message, meta),
    info: (message, meta) => write('info', name, message, meta),
    warn: (message, meta) => write('warn', name, message, meta),
    error: (message, meta) => write('error', name, message, meta),
  };
}

export function incrementMetric(name, labels = {}) {
  const metric = String(name || '').trim();
  if (!metric) return 0;
  const key = JSON.stringify({ metric, labels: redactMeta(labels) || {} });
  const next = (metrics.get(key) || 0) + 1;
  metrics.set(key, next);
  return next;
}


