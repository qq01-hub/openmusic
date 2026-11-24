/** 全站封禁命中后冻结前端，避免已打开的页面继续狂刷 API / 重连 */

import { softBlockMessage } from './softBlock';
import { isHostPageHidden, subscribeHostVisibility } from '../hooks/useVisualRenderPolicy';

let blocked = false;
let frozen = false;
let blockCode = '';
let recoveryTimer: number | null = null;
let recoveryInFlight = false;
let listenersBound = false;

const RECOVERY_POLL_MS = 8000;

export function isSiteAccessBlocked() {
  return blocked;
}

export function getSiteAccessBlockCode() {
  return blockCode;
}

export function clearSiteAccessBlocked() {
  blocked = false;
  frozen = false;
  blockCode = '';
  stopRecoveryPolling();
}

export function markSiteAccessBlocked(code?: string) {
  blocked = true;
  if (code) blockCode = String(code).trim().toUpperCase() || blockCode;
  freezeSiteAccessUi();
  startRecoveryPolling();
  bindRecoveryListeners();
}

function stopRecoveryPolling() {
  if (recoveryTimer != null) {
    window.clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
}

function startRecoveryPolling() {
  if (typeof window === 'undefined') return;
  if (recoveryTimer != null) return;
  recoveryTimer = window.setInterval(() => {
    if (isHostPageHidden()) return;
    void tryRecoverSiteAccess();
  }, RECOVERY_POLL_MS);
  // 立刻探一次，解封后尽快自动回来
  void tryRecoverSiteAccess();
}

function bindRecoveryListeners() {
  if (typeof window === 'undefined' || listenersBound) return;
  listenersBound = true;

  // bfcache 后退可能带回冻住的页面：普通刷新/前进后退都应能恢复探测
  window.addEventListener('pageshow', (event) => {
    if (!blocked) return;
    if (event.persisted) {
      void tryRecoverSiteAccess({ forceReloadOnStillBlocked: false });
    }
  });

  window.addEventListener('online', () => {
    if (blocked) void tryRecoverSiteAccess();
  });

  subscribeHostVisibility(() => {
    if (blocked && !isHostPageHidden()) void tryRecoverSiteAccess();
  });
}

/**
 * 用裸 fetch 探测是否仍被封（不走 fetchWithTimeout，避免本地假 503）。
 * 解封后自动 location.reload()，用户只需等或点按钮，不必会强制刷新。
 */
async function tryRecoverSiteAccess(options: { forceReloadOnStillBlocked?: boolean } = {}) {
  if (!blocked || recoveryInFlight || typeof window === 'undefined') return;
  recoveryInFlight = true;
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (detectSiteAccessBlockResponse(res)) {
      if (options.forceReloadOnStillBlocked) {
        window.location.reload();
      }
      return;
    }
    // 已不再封禁：清状态并整页重载，恢复正常 SPA
    clearSiteAccessBlocked();
    window.location.reload();
  } catch {
    // 网络抖动：保留冻结页，下次轮询再试
  } finally {
    recoveryInFlight = false;
  }
}

function freezeSiteAccessUi() {
  if (frozen || typeof document === 'undefined') return;
  frozen = true;
  try {
    document.title = '暂时无法访问';
    const message = softBlockMessage(blockCode || 'OM-SBAN');
    document.body.innerHTML = `
      <div style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:system-ui,sans-serif;background:#0b0d12;color:#e8eaed;text-align:center;padding:24px;gap:16px">
        <p style="opacity:.75;font-size:15px;margin:0;line-height:1.6;max-width:28em">${message}</p>
        <p style="opacity:.45;font-size:13px;margin:0">正在自动重试，也可点击下方按钮</p>
        <button type="button" id="om-site-unblock-reload"
          style="cursor:pointer;border:0;border-radius:10px;padding:10px 18px;font-size:14px;
            background:#ec4141;color:#fff">刷新重试</button>
      </div>
    `;
    document.getElementById('om-site-unblock-reload')?.addEventListener('click', () => {
      void tryRecoverSiteAccess({ forceReloadOnStillBlocked: true });
    });
  } catch {
    // ignore
  }
}

/** 识别服务端全站封禁响应：必须带明确标记，避免把普通 503 误判成全站封禁 */
export function detectSiteAccessBlockResponse(res: Response | null | undefined): boolean {
  if (!res || res.status !== 503) return false;
  // 忽略前端本地短路假响应，避免自我加固冻结状态
  if (res.headers.get('x-openmusic-block-local') === '1') return false;
  return res.headers.get('x-openmusic-site-blocked') === '1';
}
