import { useEffect, useRef, useState } from 'react';

type TurnstileApi = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }
let scriptPromise: Promise<TurnstileApi> | undefined;
const CHALLENGE_WAIT_MS = 20_000;
const CHALLENGE_STALLED_MESSAGE = '人机校验长时间没有响应，请检查能否访问 challenges.cloudflare.com，然后重新验证';
const UNSUPPORTED_BROWSER_MESSAGE = '当前浏览器内核或内置 WebView 不支持 Cloudflare 人机校验，请复制当前页面链接到系统 Safari 或 Chrome 打开，并关闭桌面网站、极速/省流模式或广告内容拦截后重试';
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const timer = window.setTimeout(() => fail(), 10000);
    const fail = () => { window.clearTimeout(timer); script.remove(); scriptPromise = undefined; reject(new Error('人机校验加载失败，请检查网络后重试')); };
    script.onload = () => { window.clearTimeout(timer); if (window.turnstile) resolve(window.turnstile); else fail(); };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export default function HumanVerification({ siteKey, onToken, action = 'account_auth', cdata }: { siteKey: string; onToken: (token: string) => void; action?: 'account_auth' | 'risk_challenge'; cdata?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState({ revision: 0, automatic: false });
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let stopped = false;
    let verified = false;
    let watchdog: number | undefined;
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    let resizeObserver: ResizeObserver | undefined;
    setError('');
    setUnsupported(false);
    setCopied(false);
    setRetrying(attempt.automatic);
    onToken('');

    const removeWidget = () => {
      if (widget === undefined) return;
      api?.remove(widget);
      widget = undefined;
    };
    const stop = () => {
      stopped = true;
      window.clearTimeout(watchdog);
      resizeObserver?.disconnect();
      removeWidget();
    };
    const fail = (message: string, isUnsupported = false) => {
      if (stopped) return;
      stop();
      onToken('');
      setRetrying(false);
      setUnsupported(isUnsupported);
      setError(message);
    };
    const retryTransientFailure = (message: string) => {
      if (stopped) return;
      if (attempt.automatic) {
        fail(message);
        return;
      }
      stop();
      setAttempt(previous => ({ revision: previous.revision + 1, automatic: true }));
    };
    const watchForResponse = () => {
      window.clearTimeout(watchdog);
      if (stopped || verified) return;
      watchdog = window.setTimeout(() => retryTransientFailure(CHALLENGE_STALLED_MESSAGE), CHALLENGE_WAIT_MS);
    };
    void loadTurnstile().then(value => {
      if (stopped || !container.current) return;
      api = value;
      const compact = parseFloat(getComputedStyle(container.current).width) < 300;
      watchForResponse();
      widget = api.render(container.current, {
        sitekey: siteKey, action, cData: cdata, theme: 'auto', language: 'zh-cn',
        size: compact ? 'compact' : 'flexible', retry: 'never',
        'refresh-expired': 'manual', 'refresh-timeout': 'manual',
        callback: (token: string) => {
          if (stopped) return;
          verified = true;
          window.clearTimeout(watchdog);
          setRetrying(false);
          onToken(token);
        },
        'before-interactive-callback': () => window.clearTimeout(watchdog),
        'after-interactive-callback': watchForResponse,
        'expired-callback': () => fail('校验已过期，请重新验证'),
        'timeout-callback': () => fail('校验超时，请重新验证'),
        'unsupported-callback': () => fail(UNSUPPORTED_BROWSER_MESSAGE, true),
        'error-callback': (errorCode: string) => {
          const code = /^\d{6}$/.test(String(errorCode)) ? String(errorCode) : '';
          if (code === '200500') {
            retryTransientFailure('人机校验组件加载失败（错误码 200500），请检查网络或内容拦截设置后重新验证');
          } else if (code === '110200') {
            fail('当前域名未获人机校验授权（错误码 110200），请联系管理员');
          } else if (code === '110500') {
            fail(UNSUPPORTED_BROWSER_MESSAGE, true);
          } else {
            fail(`人机校验暂不可用${code ? `（错误码 ${code}）` : ''}，请检查网络或内容拦截设置后重试`);
          }
          return true;
        },
      });
      if (stopped) {
        removeWidget();
        return;
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(entries => {
          const width = entries[0]?.contentRect.width;
          if (!stopped && !verified && width !== undefined && (width < 300) !== compact) {
            stop();
            setAttempt(previous => ({ ...previous, revision: previous.revision + 1 }));
          }
        });
        resizeObserver.observe(container.current);
      }
    }).catch(() => fail('人机校验加载失败，请检查网络或内容拦截设置后重试'));
    return stop;
  }, [siteKey, attempt, onToken, action, cdata]);
  const copyCurrentUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return <div className="rounded-xl border border-white/10 p-3">
    <p className="mb-2 text-xs text-netease-muted">安全校验由 Cloudflare Turnstile 提供</p>
    <div ref={container} />
    {retrying && <p role="status" className="mt-2 text-sm text-netease-muted">校验未响应，正在自动重试</p>}
    {error && <p role="alert" className="mt-2 text-sm text-amber-200">{error}</p>}
    {(error || retrying) && <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" onClick={() => setAttempt(previous => ({ revision: previous.revision + 1, automatic: false }))} className="rounded border border-white/20 px-3 py-2 text-sm text-white">重新验证</button>
      {unsupported && <button type="button" onClick={() => { void copyCurrentUrl(); }} className="rounded border border-white/20 px-3 py-2 text-sm text-white">{copied ? '已复制链接，请去系统浏览器打开' : '复制页面链接'}</button>}
    </div>}
  </div>;
}
