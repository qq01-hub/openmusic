export interface HarmonyPlayerState {
  trackId: string;
  title: string;
  artist: string;
  playing: boolean;
  position: number;
  duration: number;
  canPause: boolean;
  canSkip: boolean;
  canSeek: boolean;
}

declare global {
  interface Window {
    __OPENMUSIC_HARMONY_APP__?: boolean;
    __OPENMUSIC_HARMONY_PLAYER__?: { updateState: (payload: string) => string };
    __OPENMUSIC_HARMONY_TOKEN__?: string;
  }
}

let sequence = 0;
let lastToken = '';

export function getMusicVerificationSandbox(): string {
  const permissions = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';
  // 鸿蒙开启媒体桥接时，同源验证页也不能读取顶层令牌
  return typeof window !== 'undefined' && window.__OPENMUSIC_HARMONY_APP__ === true
    ? permissions
    : `${permissions} allow-same-origin`;
}

function bridgeToken(): string | null {
  if (typeof window === 'undefined' || window.top !== window) return null;
  const token = window.__OPENMUSIC_HARMONY_TOKEN__;
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function hasHarmonyMediaBridge(): boolean {
  return Boolean(bridgeToken() && typeof window.__OPENMUSIC_HARMONY_PLAYER__?.updateState === 'function');
}

export function sendHarmonyPlayerState(state: HarmonyPlayerState | null): boolean {
  const token = bridgeToken();
  const bridge = typeof window === 'undefined' ? undefined : window.__OPENMUSIC_HARMONY_PLAYER__;
  if (!token || !bridge) return false;
  if (lastToken !== token) {
    sequence = 0;
    lastToken = token;
  }
  try {
    return bridge.updateState(JSON.stringify({ v: 1, token, seq: ++sequence, state })) === 'ok';
  } catch {
    // 原生能力不可用时不打断网页与服务端播放链路
    return false;
  }
}

export function isHarmonyPlayerCommand(detail: unknown, state: HarmonyPlayerState | null): boolean {
  if (!state || !detail || typeof detail !== 'object') return false;
  const data = detail as Record<string, unknown>;
  const token = bridgeToken();
  if (!token || data.source !== 'harmony' || data.token !== token || data.trackId !== state.trackId) return false;
  if (data.action === 'stopLocal') return true;
  if (data.action === 'play' || data.action === 'pause') return state.canPause;
  if (data.action === 'next') return state.canSkip;
  if (data.action === 'seek') return state.canSeek && typeof data.time === 'number' && Number.isFinite(data.time) &&
    data.time >= 0 && state.duration > 0 && data.time <= state.duration;
  return false;
}
