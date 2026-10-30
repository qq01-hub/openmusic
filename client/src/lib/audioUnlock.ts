import { isAudioFocusInterrupted, resumeAudioFocus } from './audioFocus';

const AUDIO_UNLOCK_KEY = 'openmusic:audio-unlocked';

let sessionUnlocked = false;
const audioOutputContexts = new WeakMap<HTMLAudioElement, AudioContext>();
const PLAY_REQUEST_TIMEOUT_MS = 4000;

type NativeAudioSession = EventTarget & { type: string; readonly state?: string };

/** 可选的系统音频会话能力，旧浏览器仍沿用媒体元素播放 */
export function getNativeAudioSession(): NativeAudioSession | null {
  try {
    return (navigator as Navigator & { audioSession?: NativeAudioSession }).audioSession ?? null;
  } catch {
    return null;
  }
}

export function registerAudioOutputContext(audio: HTMLAudioElement, context: AudioContext): void {
  audioOutputContexts.set(audio, context);
}

/** 元素播放成功不代表 Web Audio 已经开始输出 */
export function isAudioOutputRunning(audio: HTMLAudioElement): boolean {
  const context = audioOutputContexts.get(audio);
  return !context || context.state === 'running';
}

export function getAudioOutputDiagnostics(audio: HTMLAudioElement): {
  state: string | null;
  sampleRate: number | null;
  sessionType: string | null;
  sessionState: string | null;
} {
  const context = audioOutputContexts.get(audio);
  const session = getNativeAudioSession();
  return {
    state: context?.state ?? null,
    sampleRate: context?.sampleRate ?? null,
    sessionType: session?.type ?? null,
    sessionState: session?.state ?? null,
  };
}

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
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isMobileDevice(): boolean {
  return isIOS() || /Android/i.test(navigator.userAgent);
}

/** 微信 / 移动端：自动播放受限，需用户手势解锁 */
export function isRestrictedAutoplayEnv(): boolean {
  return isWeChatBrowser() || isMobileDevice();
}

/** 房间正在播放且尚未手势授权时，应尽早展示解锁层（不必等音频缓冲完成） */
export function shouldPromptAudioUnlock(isPlaying: boolean): boolean {
  return Boolean(isPlaying && isRestrictedAutoplayEnv() && shouldShowUnlockOverlay());
}

/** 配置 audio 以支持微信 / iOS 内联播放 */
export function configureInlineAudio(audio: HTMLAudioElement): void {
  // 在接入 Web Audio 前声明音乐播放用途，避免后台输出沿用 ambient 会话
  const session = getNativeAudioSession();
  if (session && session.type !== 'playback') {
    try {
      session.type = 'playback';
    } catch {
      // 部分浏览器仅暴露接口但不允许设置，继续使用既有播放路径
    }
  }
  audio.setAttribute('playsinline', 'true');
  audio.setAttribute('webkit-playsinline', 'true');
  audio.setAttribute('x5-playsinline', 'true');
  audio.setAttribute('x5-video-player-type', 'h5-page');
  audio.setAttribute('x5-video-player-fullscreen', 'false');
  // iOS 的 metadata 预载经常只拿到首段信息，切歌后会迟迟不进入 HAVE_FUTURE_DATA
  audio.preload = isIOS() ? 'auto' : isMobileDevice() ? 'metadata' : 'auto';
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
  resumeAudioFocus(audio);
  const context = audioOutputContexts.get(audio);
  if (context && context.state !== 'running' && context.state !== 'closed') {
    void context.resume().catch(() => {});
  }
  if (!audio.src) return;
  runInWeChatUserGesture(() => {
    void audio.play().catch(() => {});
  });
}

export async function tryPlay(audio: HTMLAudioElement): Promise<PlayResult> {
  if (isAudioFocusInterrupted(audio)) return 'blocked';
  if (!audio.src) return 'error';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mediaStarted = false;
  try {
    // 播放请求可能永久 pending，不能阻塞串行队列及后续缓冲超时
    const result = await Promise.race([
      audio.play().then(async () => {
        mediaStarted = true;
        const context = audioOutputContexts.get(audio);
        if (context && context.state !== 'running' && context.state !== 'closed' && !isAudioFocusInterrupted(audio)) {
          await context.resume();
        }
        return 'settled' as const;
      }),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), PLAY_REQUEST_TIMEOUT_MS);
      }),
    ]);
    if (result === 'timeout') return mediaStarted && !isAudioOutputRunning(audio) ? 'blocked' : 'error';
    // 微信 / iOS 可能 resolve 但仍处于 paused
    if (audio.paused || !isAudioOutputRunning(audio)) return 'blocked';
    return 'played';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return 'blocked';
    }
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

/** 先正常播放，失败则尝试静音自动播放再取消静音（电视浏览器常用） */
export async function tryPlayWithAutoplayFallback(
  audio: HTMLAudioElement,
  allowMutedFallback: boolean,
): Promise<PlayResult> {
  const direct = await tryPlay(audio);
  if (direct === 'played' || !allowMutedFallback || isAudioFocusInterrupted(audio)) return direct;

  const wasMuted = audio.muted;
  try {
    audio.muted = true;
    const muted = await tryPlay(audio);
    audio.muted = wasMuted;
    if (muted === 'played') return 'played';

    const retry = await tryPlay(audio);
    return retry;
  } finally {
    audio.muted = wasMuted;
  }
}

/** 评估播放是否真正开始（含微信 / iOS 延迟复查） */
export async function assessPlaybackResult(
  audio: HTMLAudioElement,
  initial: PlayResult,
): Promise<PlayResult> {
  if (initial !== 'played') return initial;
  if (!isAudioOutputRunning(audio)) return 'blocked';
  if (!isRestrictedAutoplayEnv()) return 'played';

  const delayMs = isIOS() ? 50 : 120;
  await new Promise((r) => setTimeout(r, delayMs));
  if (audio.paused || !isAudioOutputRunning(audio)) return 'blocked';
  return 'played';
}

/** 根据播放结果判断是否需要展示解锁层 */
export function playbackNeedsUnlock(result: PlayResult, audio: HTMLAudioElement): boolean {
  // 换源中断、媒体错误和预探测后的主动暂停都不代表用户撤销了播放授权
  return result === 'blocked' && !audio.error;
}
