import { fetchWithTimeout } from '../api/http';
import { rememberClientId } from './clientId';
import { getDeviceId } from './deviceId';
import { applySiteFeatures } from '../stores/siteFeaturesStore';
import { detectSiteAccessBlockResponse, isSiteAccessBlocked, markSiteAccessBlocked } from './siteAccessGate';
import {
  extractSoftBlockCode,
  readSoftBlockCodeFromResponse,
  softBlockMessage,
  SOFT_BLOCK_CODES,
} from './softBlock';

let bootstrapPromise: Promise<string | null> | null = null;
let lastBootstrapError = '';
let bootstrapGeneration = 0;

export function getLastBootstrapError(): string {
  return lastBootstrapError;
}

async function requestSessionBootstrap(generation: number): Promise<string | null> {
  if (isSiteAccessBlocked()) return null;
  const res = await fetchWithTimeout(
    '/api/session/bootstrap',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId() }),
    },
    8000,
  );
  if (generation !== bootstrapGeneration) return null;
  if (detectSiteAccessBlockResponse(res)) {
    markSiteAccessBlocked(readSoftBlockCodeFromResponse(res) || SOFT_BLOCK_CODES.SITE_BAN);
    lastBootstrapError = softBlockMessage(SOFT_BLOCK_CODES.SITE_BAN);
    return null;
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
    const code = readSoftBlockCodeFromResponse(res)
      || extractSoftBlockCode(data)
      || extractSoftBlockCode(typeof data?.error === 'string' ? data.error : '');
    if (code) {
      lastBootstrapError = softBlockMessage(code);
    } else if (typeof data?.error === 'string' && data.error.trim()) {
      lastBootstrapError = data.error.trim();
    } else {
      lastBootstrapError = '会话未就绪，请刷新页面后重试';
    }
    return null;
  }
  const data = (await res.json()) as {
    clientId?: string;
    features?: {
      svipQualityEnabled?: boolean;
      neteaseSvip?: boolean;
      tencentSvip?: boolean;
      qishuiVip?: boolean;
      sharedMembershipEnabled?: boolean;
      musicSourcesEnabled?: Partial<Record<'netease' | 'tencent' | 'kugou' | 'qishui', boolean>>;
    };
  };
  if (generation !== bootstrapGeneration) return null;
  applySiteFeatures(data.features);
  if (data.clientId) rememberClientId(data.clientId);
  lastBootstrapError = '';
  return data.clientId || null;
}

/** 通过 HttpOnly Cookie 建立会话，不在 WebSocket 中传递身份令牌 */
export function ensureSessionBootstrap(force = false): Promise<string | null> {
  if (isSiteAccessBlocked()) return Promise.resolve(null);
  if (force) bootstrapPromise = null;
  if (!bootstrapPromise) {
    const generation = bootstrapGeneration;
    bootstrapPromise = (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (generation !== bootstrapGeneration) return null;
        if (isSiteAccessBlocked()) return null;
        try {
          const clientId = await requestSessionBootstrap(generation);
          if (clientId) return clientId;
          if (isSiteAccessBlocked()) return null;
        } catch {
          // retry
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      return null;
    })();
  }
  return bootstrapPromise;
}

/** bootstrap 必须成功，否则抛出错误 */
export async function requireSessionBootstrap(force = false): Promise<string> {
  if (isSiteAccessBlocked()) {
    throw new Error(softBlockMessage(SOFT_BLOCK_CODES.SITE_BAN));
  }
  let clientId = await ensureSessionBootstrap(force);
  if (!clientId) {
    if (isSiteAccessBlocked()) {
      throw new Error(softBlockMessage(SOFT_BLOCK_CODES.SITE_BAN));
    }
    resetSessionBootstrap();
    clientId = await ensureSessionBootstrap(true);
  }
  if (!clientId) {
    throw new Error(
      lastBootstrapError
        || (isSiteAccessBlocked()
          ? softBlockMessage(SOFT_BLOCK_CODES.SITE_BAN)
          : '会话未就绪，请刷新页面后重试'),
    );
  }
  return clientId;
}

export function resetSessionBootstrap(): void {
  if (isSiteAccessBlocked()) return;
  bootstrapGeneration += 1;
  bootstrapPromise = null;
}
