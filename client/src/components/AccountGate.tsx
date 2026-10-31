import RiskHumanVerificationGate from './RiskHumanVerificationGate';
import { accountSessionRetryDelay, isExplicitAccountDenial } from '../lib/accountSessionRecovery';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Disc3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import AccountAccess from './AccountAccess';
import MusicLoading from './MusicLoading';
import ErrorReportSolutionGate from './ErrorReportSolutionGate';
import PermanentDecisionGate from './PermanentDecisionGate';
import { fetchAccountSession, logoutAccount } from '../lib/accountAuth';
import { isAccountSessionRevisionEvent } from '../lib/accountSessionSignal';
import { stopSharedAudio } from '../lib/audioElement';
import { hasAnonymousAccess, hasVerifiedAccountSession } from '../lib/accountAccessSession';

export default function AccountGate({ children, onReady, allowPreview = false }: { children: ReactNode; onReady?: () => void; allowPreview?: boolean }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(() => (
    hasVerifiedAccountSession() ? true : null
  ));
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let inFlight = false;
    let queued = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    const clearRetry = () => { if (retryTimer) window.clearTimeout(retryTimer); retryTimer = undefined; };
    const refresh = async () => {
      if (!active) return;
      if (inFlight) { queued = true; return; }
      clearRetry();
      inFlight = true;
      const current = ++generation;
      try {
        const account = await fetchAccountSession();
        if (!active || current !== generation) return;
        const allowed = Boolean(account) || hasAnonymousAccess();
        setAuthenticated(allowed);
        setError(''); setRetrying(false); attempt = 0;
        if (!allowed) { stopSharedAudio(); onReady?.(); }
      } catch (reason) {
        if (!active || current !== generation) return;
        if (isExplicitAccountDenial(reason)) {
          setAuthenticated(false); setRetrying(false);
          setError(reason instanceof Error ? reason.message : '账户会话已失效');
          stopSharedAudio();
        } else {
          // 暂时无法核验不等于未登录，保留已核验页面，不授予新的服务端访问权限
          setError('服务连接暂时中断，正在等待恢复');
          const delay = accountSessionRetryDelay(attempt++);
          setRetrying(true);
          retryTimer = window.setTimeout(() => { retryTimer = undefined; void refresh(); }, delay + Math.floor(Math.random() * 1000));
        }
        onReady?.();
      } finally {
        inFlight = false;
        if (active && queued) { queued = false; void refresh(); }
      }
    };
    const onChange = () => { if (!retryTimer) void refresh(); };
    const onIdentityChange = () => {
      generation++; attempt = 0; clearRetry();
      setAuthenticated(null); setError(''); stopSharedAudio();
      void refresh();
    };
    const onStorage = (event: StorageEvent) => { if (isAccountSessionRevisionEvent(event)) onIdentityChange(); };
    const onRestart = () => {
      generation++;
      attempt = 0; clearRetry(); setError('服务正在更新，正在自动恢复连接'); setRetrying(true);
      retryTimer = window.setTimeout(() => { retryTimer = undefined; void refresh(); }, 1500 + Math.floor(Math.random() * 1000));
    };
    void refresh();
    window.addEventListener('openmusic:account-session-changed', onIdentityChange);
    window.addEventListener('openmusic:account-auth-required', onChange);
    window.addEventListener('openmusic:server-restarting', onRestart);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onChange);
    window.addEventListener('online', onChange);
    const timer = window.setInterval(onChange, 60_000);
    return () => {
      active = false; clearRetry();
      window.clearInterval(timer);
      window.removeEventListener('openmusic:account-session-changed', onIdentityChange);
      window.removeEventListener('openmusic:account-auth-required', onChange);
      window.removeEventListener('openmusic:server-restarting', onRestart);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onChange);
      window.removeEventListener('online', onChange);
    };
  }, [onReady, revision]);

  const connectionNotice = error && <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-[180] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-white/15 bg-netease-dark/95 px-4 py-3 text-sm text-white shadow-lg">
    <span>{retrying ? error : '服务暂不可用，可稍后重试连接'}</span>
    <button type="button" className="ml-3 rounded px-2 py-1 text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={() => setRevision(value => value + 1)}>重试连接</button>
  </div>;

  // 预览与登录状态复用相同页面位置，避免登录后卸载首页并再次触发加载
  if (authenticated || allowPreview) return <>
    {authenticated && <ErrorReportSolutionGate />}
    {authenticated && <PermanentDecisionGate />}
    <RiskHumanVerificationGate />
    {children}
    {authenticated && connectionNotice}
  </>;
  if (authenticated === null) {
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const loadingLabel = error
      ? '正在等待账户服务恢复'
      : (path.startsWith('/room/') || path.startsWith('/tv/'))
        ? '正在连接房间'
        : '正在连接音乐空间';
    return <><MusicLoading label={loadingLabel} />{connectionNotice}</>;
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-netease-dark px-6 text-white">
      <div className="max-w-sm text-center">
        <Disc3 className="mx-auto mb-5 h-12 w-12 text-netease-red" aria-hidden />
        <h1 className="text-xl font-semibold">登录，回到你的音乐空间</h1>
        <p className="mt-3 text-sm leading-6 text-netease-muted">登录后加入房间，与朋友分享此刻的旋律</p>
        <Link to="/" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm text-netease-muted transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><ArrowLeft className="h-4 w-4" aria-hidden />先逛逛首页</Link>
        {error ? (
          <div role="alert" className="mt-5 space-y-3">
            <p className="text-sm text-amber-200">{error}</p>
            <button type="button" className="rounded-lg border border-white/20 px-4 py-2 text-sm" onClick={() => setRevision((value) => value + 1)}>重新验证</button>
            <button type="button" className="ml-3 text-sm underline" onClick={() => { void logoutAccount().then(() => setRevision((value) => value + 1)).catch(() => setError('退出未完成，请稍后重试')); }}>退出当前账户</button>
          </div>
        ) : null}
        <AccountAccess required />
      </div>
    </main>
  );
}
