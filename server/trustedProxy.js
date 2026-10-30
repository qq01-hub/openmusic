export function createProxyTrust({ enabled, trustedIps, normalizeIp }) {
  return peer => enabled === true && trustedIps.has(normalizeIp(peer || ''));
}

export function observeProxyHeaders(headers, peer, isTrusted, customHeader = '') {
  const trusted = isTrusted(peer);
  const forwarded = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', customHeader].filter(Boolean).some(name => Boolean(headers?.[name]));
  return { route: trusted ? 'trusted_proxy' : 'direct', untrustedForwarded: !trusted && forwarded };
}
