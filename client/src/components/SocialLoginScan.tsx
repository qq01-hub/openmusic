import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { getAccountSessionGeneration } from '../lib/accountAccessSession';
import { requestSocialLogin, socialLabels, type SocialProvider, type SocialResult } from '../lib/socialLogin';

export default function SocialLoginScan({ provider, action, audience = 'account', onComplete }: {
  provider: SocialProvider;
  action: 'login' | 'bind';
  audience?: 'account' | 'admin';
  onComplete: (result: SocialResult) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [qrUrl, setQrUrl] = useState('');
  const [status, setStatus] = useState('正在准备二维码…');
  const [error, setError] = useState('');
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timer: number | undefined;
    let flowId = '';
    let expiresAt = 0;
    let generation = getAccountSessionGeneration();
    let failures = 0;
    let confirmed = false;
    setQrUrl('');
    setError('');
    setStatus('正在准备二维码…');
    const assertCurrent = () => {
      if (cancelled) throw new Error('扫码已取消');
      if (audience === 'account' && generation !== getAccountSessionGeneration()) throw new Error('账户已变化，请重新获取二维码');
    };
    const fail = (reason: unknown) => {
      if (cancelled) return;
      setQrUrl('');
      setError(reason instanceof Error ? reason.message : '扫码失败，请重新获取二维码');
      setStatus('操作未完成');
    };
    const poll = async () => {
      try {
        assertCurrent();
        if (Date.now() >= expiresAt) throw new Error('二维码已过期，请重新获取');
        const result = confirmed ? { status: 'confirmed' } : await requestSocialLogin<{ status: string }>(audience, provider, 'poll', action, controller.signal, flowId);
        assertCurrent();
        if (result.status === 'confirmed') {
          confirmed = true;
          setQrUrl('');
          setStatus('正在完成身份验证…');
          const completed = await requestSocialLogin<SocialResult>(audience, provider, 'complete', action, controller.signal, flowId);
          if (cancelled) return;
          completeRef.current(completed);
          return;
        }
        failures = 0;
        timer = window.setTimeout(() => void poll(), 2500);
      } catch (reason) {
        if (cancelled) return;
        const retryable = reason as { status?: number; name?: string; code?: string };
        if (retryable.code === 'SOCIAL_LOGIN_BUSY' && failures < 3 && Date.now() + 2500 < expiresAt) {
          failures += 1;
          timer = window.setTimeout(() => void poll(), 2500);
        } else fail(reason);
      }
    };
    void requestSocialLogin<{ qrUrl: string; flowId: string; expiresAt: number }>(audience, provider, 'start', action, controller.signal)
      .then(flow => {
        assertCurrent();
        if (!/^data:image\/(?:png|jpeg);base64,/u.test(flow.qrUrl) || !/^[a-f0-9]{64}$/u.test(flow.flowId) || !Number.isFinite(flow.expiresAt)) throw new Error('二维码响应异常，请重试');
        flowId = flow.flowId;
        expiresAt = flow.expiresAt;
        generation = getAccountSessionGeneration();
        setQrUrl(flow.qrUrl);
        setStatus(provider === 'wechat_scan' ? '微信扫码：30 秒内扫描，1 分钟内确认' : '用 QQ 扫码，在手机上确认');
        timer = window.setTimeout(() => void poll(), 2500);
      }).catch(fail);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [provider, action, audience, attempt]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '12px 0' }}>
      <div style={{ width: 'min(64vw, 240px)', height: 'min(64vw, 240px)', background: '#fff', borderRadius: 16, padding: 12, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {qrUrl ? <img src={qrUrl} alt={`${socialLabels[provider]}二维码`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={() => { setQrUrl(''); setError('二维码加载失败，请重新获取'); }} />
          : error ? <RefreshCw aria-hidden style={{ color: '#64748b' }} /> : <Loader2 className="animate-spin" aria-label="正在加载二维码" style={{ color: '#64748b' }} />}
      </div>
      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 14 }}>{status}</p>
      {provider === 'wechat_scan' && <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>与文件传输助手独立，需分别绑定</p>}
      {error && <p role="alert" style={{ margin: 0, color: audience === 'admin' ? '#b42318' : '#fde68a', fontSize: 14 }}>{error}</p>}
      {error && <button type="button" onClick={() => setAttempt(value => value + 1)} style={{ minHeight: 44, padding: '8px 18px', border: '1px solid currentColor', borderRadius: 12, background: 'transparent', color: 'inherit' }}>重新获取二维码</button>}
    </div>
  );
}
