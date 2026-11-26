import { isIP } from 'node:net';
import { getRedisClient } from './roomStorage.js';
import { sanitizeDeviceId } from './deviceIdentity.js';

const KEY_PREFIX = 'openmusic:client_network_binding:';
export const CLIENT_NETWORK_BINDING_TTL_SEC = 30 * 24 * 60 * 60;
export const GUEST_CLIENT_NETWORK_BINDING_TTL_SEC = 3 * 24 * 60 * 60;

function normalizeIp(raw) {
  let ip = String(raw || '').replace(/^::ffff:/, '').trim();
  if (!ip) return '';
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  const v4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) ip = v4WithPort[1];
  return isIP(ip) ? ip : '';
}

function normalizeLocation(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 12);
}

function bindingKey({ userId, deviceId } = {}) {
  const uid = sanitizeDeviceId(userId);
  const did = sanitizeDeviceId(deviceId);
  return uid && did ? `${KEY_PREFIX}${uid}:${did}` : '';
}

function parseBinding(raw) {
  try {
    const value = JSON.parse(String(raw || ''));
    const ip = normalizeIp(value?.ip);
    if (!ip) return null;
    return { ip, location: normalizeLocation(value.location) };
  } catch {
    return null;
  }
}

export function createClientNetworkBindingStore({ getRedisClient: getClient = getRedisClient } = {}) {
  return {
    async resolve(identity, reported = {}, options = {}) {
      const candidate = {
        ip: normalizeIp(reported.ip),
        location: normalizeLocation(reported.location),
      };
      const key = bindingKey(identity);
      if (!key) return candidate;

      const client = getClient();
      if (!client) return candidate;
      const rawTtl = options && typeof options === 'object' ? Number(options.ttlSec) : NaN;
      const ttlSec = Number.isFinite(rawTtl) && rawTtl > 0
        ? Math.max(60, Math.min(CLIENT_NETWORK_BINDING_TTL_SEC, Math.floor(rawTtl)))
        : CLIENT_NETWORK_BINDING_TTL_SEC;

      try {
        const existing = parseBinding(await client.get(key));
        if (existing) return existing;
        if (!candidate.ip) return { ip: '', location: '' };

        await client.set(key, JSON.stringify(candidate), { NX: true, EX: ttlSec });
        return parseBinding(await client.get(key)) || candidate;
      } catch (err) {
        console.error('客户端展示网络信息绑定读写失败:', err?.message || err);
        return candidate;
      }
    },
  };
}

const defaultStore = createClientNetworkBindingStore();
export const resolveBoundClientNetwork = defaultStore.resolve;
