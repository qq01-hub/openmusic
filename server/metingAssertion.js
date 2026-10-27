import { createHash, createHmac, randomBytes } from 'node:crypto';

export function createMetingAssertion(secret, rawUrl, context = {}, { method = 'GET', body = '', now = Date.now() } = {}) {
  const target = new URL(rawUrl);
  const claims = Buffer.from(JSON.stringify({
    v: 1,
    aud: target.origin,
    sub: context.accountId || 'openmusic:system',
    purpose: context.accountId ? 'account' : 'system',
    ts: Math.floor(now / 1000),
    nonce: randomBytes(18).toString('base64url'),
  })).toString('base64url');
  const payload = [claims, method.toUpperCase(), target.pathname + target.search, createHash('sha256').update(body || '').digest('hex')].join('\n');
  return {
    'X-OpenMusic-Assertion': claims,
    'X-OpenMusic-Signature': createHmac('sha256', secret).update(payload).digest('base64url'),
  };
}
