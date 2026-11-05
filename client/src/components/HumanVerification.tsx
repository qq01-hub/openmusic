import { useEffect, useRef, useState } from 'react';

type TurnstileApi = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }
let scriptPromise: Promise<TurnstileApi> | undefined;
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
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    let resizeObserver: ResizeObserver | undefined;
    setError(''); setUnsupported(false); setCopied(false); onToken('');
    const fail = (message: string, isUnsupported = false) => {
      if (cancelled) return;
      onToken('');
      setUnsupported(isUnsupported);
      setError(message);
    };
    void loadTurnstile().then(value => {
      if (cancelled || !container.current) return;
      api = value;
      const compact = parseFloat(getComputedStyle(container.current).width) < 300;
      widget = api.render(container.current, { sitekey: siteKey, action, cData: cdata, theme: 'auto', language: 'zh-cn', size: compact ? 'compact' : 'flexible', retry: 'never',
        callback: (token: string) => { if (!cancelled) { setError(''); onToken(token); } },
        'expired-callback': () => fail('校验已过期，请重新验证'),
        'timeout-callback': () => fail('校验超时，请重新验证'),
        'unsupported-callback': () => fail(UNSUPPORTED_BROWSER_MESSAGE, true),
        'error-callback': (errorCode: string) => {
          const code = /^\d{6}$/.test(String(errorCode)) ? String(errorCode) : '';
          const isUnsupported = code === '110500';
          fail(isUnsupported ? UNSUPPORTED_BROWSER_MESSAGE
            : `人机校验暂不可用${code ? `（错误码 ${code}）` : ''}，请检查网络或内容拦截设置后重试`, isUnsupported);
          return true;
        },
      });
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(entries => {
          const width = entries[0]?.contentRect.width;
          if (!cancelled && width !== undefined && (width < 300) !== compact) {
            setRetry(value => value + 1);
          }
        });
        resizeObserver.observe(container.current);
      }
    }).catch(() => fail('人机校验加载失败，请检查网络或内容拦截设置后重试'));
    return () => { cancelled = true; resizeObserver?.disconnect(); if (widget !== undefined) api?.remove(widget); };
  }, [siteKey, retry, onToken, action, cdata]);
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
    {error && <p role="alert" className="mt-2 text-sm text-amber-200">{error}</p>}
    {error && <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" onClick={() => setRetry(value => value + 1)} className="rounded border border-white/20 px-3 py-2 text-sm text-white">重新验证</button>
      {unsupported && <button type="button" onClick={() => { void copyCurrentUrl(); }} className="rounded border border-white/20 px-3 py-2 text-sm text-white">{copied ? '已复制链接，请去系统浏览器打开' : '复制页面链接'}</button>}
    </div>}
  </div>;
}
