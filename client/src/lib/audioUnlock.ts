const AUDIO_UNLOCK_KEY = 'openmusic:audio-unlocked';

let sessionUnlocked = false;

function isReloadNavigation() {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === 'reload';
}

/** 页面刷新后浏览器会重新要求用户手势，清除上次会话的解锁标记 */
function resetUnlockOnPageLoad() {
  if (!isReloadNavigation()) return;
  sessionUnlocked = false;
  try {
    sessionStorage.removeItem(AUDIO_UNLOCK_KEY);
  } catch {
    /* private mode */
  }
}

resetUnlockOnPageLoad();

/** 本会话内用户是否已通过手势解锁音频（仅当前页面内存，刷新后需重新授权） */
export function isAudioSessionUnlocked(): boolean {
  return sessionUnlocked;
}

/** 记录用户已授权，后续切歌不再弹窗（仅当前页面有效） */
export function markAudioSessionUnlocked(): void {
  sessionUnlocked = true;
  try {
    sessionStorage.setItem(AUDIO_UNLOCK_KEY, '1');
  } catch {
    /* private mode */
  }
}

/** 播放被拦截时重置，以便再次展示解锁层 */
export function resetAudioSessionUnlocked(): void {
  sessionUnlocked = false;
  try {
    sessionStorage.removeItem(AUDIO_UNLOCK_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * 是否应展示解锁遮罩。只要本会话尚未通过手势授权就允许展示——
 * 桌面浏览器在没有用户交互时同样会拦截自动播放，需要弹窗引导点击。
 * 实际是否展示仍由 needsAudioUnlock（确实被拦截）决定。
 */
export function shouldShowUnlockOverlay(): boolean {
  return !isAudioSessionUnlocked();
}

export function isWeChatBrowser(): boolean {
  return /MicroMessenger/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function isMobileDevice(): boolean {
  return isIOS() || /Android/i.test(navigator.userAgent);
}

/** 微信 / 移动端：自动播放受限，需用户手势解锁 */
export function isRestrictedAutoplayEnv(): boolean {
  return isWeChatBrowser() || isMobileDevice();
}

/** 已授权或已正常播放时不再用 play/pause 探测打断音频 */
export function shouldProbeAudioUnlock(audio: HTMLAudioElement): boolean {
  return !isAudioSessionUnlocked() && (audio.paused || audio.currentTime <= 0.05);
}

/** 房间正在播放且尚未手势授权时，应尽早展示解锁层（不必等音频缓冲完成） */
export function shouldPromptAudioUnlock(isPlaying: boolean): boolean {
  return Boolean(isPlaying && isRestrictedAutoplayEnv() && shouldShowUnlockOverlay());
}

/** 配置 audio 以支持微信 / iOS 内联播放 */
export function configureInlineAudio(audio: HTMLAudioElement): void {
  audio.setAttribute('playsinline', 'true');
  audio.setAttribute('webkit-playsinline', 'true');
  audio.setAttribute('x5-playsinline', 'true');
  audio.setAttribute('x5-video-player-type', 'h5-page');
  audio.setAttribute('x5-video-player-fullscreen', 'false');
  audio.preload = 'auto';
  if (isIOS()) {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    try {
      if (session) session.type = 'playback';
    } catch {
      // 部分 WebView 不允许设置原生会话类型
    }
  }
  (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  (audio as HTMLAudioElement & { webkitPlaysInline?: boolean }).webkitPlaysInline = true;
}

type WeixinBridge = { invoke: (method: string, args: object, cb: () => void) => void };

/** 微信 iOS：Bridge 就绪后回调（常用于解锁媒体播放） */
export function onWeChatBridgeReady(callback: () => void): void {
  if (!isWeChatBrowser()) return;

  const w = window as Window & { WeixinJSBridge?: WeixinBridge };
  const run = () => w.WeixinJSBridge?.invoke('getNetworkType', {}, callback);

  if (typeof w.WeixinJSBridge !== 'undefined') {
    run();
  } else {
    document.addEventListener('WeixinJSBridgeReady', run, { once: true });
  }
}

export type PlayResult = 'played' | 'blocked' | 'error';

export function isTvPage(): boolean {
  return /^\/tv\//.test(window.location.pathname);
}

/** 微信 iOS：在用户手势回调内先走 Bridge，再执行 play */
export function runInWeChatUserGesture(fn: () => void): void {
  if (!isWeChatBrowser()) {
    fn();
    return;
  }

  const w = window as Window & { WeixinJSBridge?: WeixinBridge };
  const run = () => {
    if (w.WeixinJSBridge) {
      w.WeixinJSBridge.invoke('getNetworkType', {}, fn);
    } else {
      fn();
    }
  };

  if (typeof w.WeixinJSBridge !== 'undefined') {
    run();
  } else {
    fn();
  }
}

/** 须在 click/touch 回调中同步调用，否则 iOS / 微信会丢失用户手势导致 play() 被拒 */
export function playInUserGesture(audio: HTMLAudioElement): void {
  if (!audio.src) return;
  runInWeChatUserGesture(() => {
    void audio.play().catch(() => {});
  });
}

export async function tryPlay(audio: HTMLAudioElement): Promise<PlayResult> {
  if (!audio.src) return 'error';
  try {
    await audio.play();
    // 微信 / iOS 可能 resolve 但仍处于 paused
    if (audio.paused) return 'blocked';
    return 'played';
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      return 'blocked';
    }
    return 'error';
  }
}

/** 先正常播放，失败则尝试静音自动播放再取消静音（电视浏览器常用） */
export async function tryPlayWithAutoplayFallback(
  audio: HTMLAudioElement,
  allowMutedFallback: boolean,
): Promise<PlayResult> {
  const direct = await tryPlay(audio);
  if (direct === 'played' || !allowMutedFallback) return direct;

  const wasMuted = audio.muted;
  try {
    audio.muted = true;
    await audio.play();
    audio.muted = wasMuted;
    if (!audio.paused) return 'played';

    const retry = await tryPlay(audio);
    return retry;
  } catch {
    audio.muted = wasMuted;
    return 'blocked';
  }
}

/** 评估播放是否真正开始（含微信 / iOS 延迟复查） */
export async function assessPlaybackResult(
  audio: HTMLAudioElement,
  initial: PlayResult,
): Promise<PlayResult> {
  if (initial !== 'played') return initial;
  if (!isRestrictedAutoplayEnv()) return 'played';

  const delayMs = isIOS() ? 50 : 120;
  await new Promise((r) => setTimeout(r, delayMs));
  if (audio.paused) return 'blocked';
  return 'played';
}

/** 根据播放结果判断是否需要展示解锁层 */
export function playbackNeedsUnlock(result: PlayResult, audio: HTMLAudioElement): boolean {
  if (result === 'blocked' || result === 'error') return true;
  return Boolean(audio.src && audio.paused);
}
