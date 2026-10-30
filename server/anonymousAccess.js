import { createHash } from 'node:crypto';

export function anonymousAccountId(userId) {
  const id = String(userId || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(id)) return '';
  return `acct_anon_${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
}

export function createAnonymousAccess({ getConfig, resolveIdentity, getIdentityOwner }) {
  return async req => {
    if (!getConfig().anonymousLoginEnabled) return null;
    const identity = resolveIdentity(req);
    if (!identity?.userId || await getIdentityOwner(identity.userId)) return null;
    const id = anonymousAccountId(identity.userId);
    if (!id) return null;
    return {
      id,
      roomUserId: identity.userId,
      anonymous: true,
      email: null,
      createdAt: 0,
    };
  };
}
