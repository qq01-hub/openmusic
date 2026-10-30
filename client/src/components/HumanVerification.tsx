import { useEffect, useRef, useState } from 'react';

type TurnstileApi = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }
let scriptPromise: Promise<TurnstileApi> | undefined;
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
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    setError(''); onToken('');
    void loadTurnstile().then(value => {
      if (cancelled || !container.current) return;
      api = value;
      widget = api.render(container.current, { sitekey: siteKey, action, cData: cdata, theme: 'auto', size: 'flexible', retry: 'never',
        callback: (token: string) => { if (!cancelled) { setError(''); onToken(token); } },
        'expired-callback': () => { if (!cancelled) { onToken(''); setError('校验已过期，请重新验证'); } },
        'error-callback': () => { if (!cancelled) { onToken(''); setError('人机校验暂不可用，请重试'); } },
      });
    }).catch(() => { if (!cancelled) setError('人机校验加载失败，请检查网络后重试'); });
    return () => { cancelled = true; if (widget !== undefined) api?.remove(widget); };
  }, [siteKey, retry, onToken, action, cdata]);
  return <div className="rounded-xl border border-white/10 p-3">
    <p className="mb-2 text-xs text-netease-muted">安全校验由 Cloudflare Turnstile 提供</p>
    <div ref={container} />
    {error && <p role="alert" className="mt-2 text-sm text-amber-200">{error}</p>}
    {error && <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 rounded border border-white/20 px-3 py-2 text-sm text-white">重新验证</button>}
  </div>;
}
