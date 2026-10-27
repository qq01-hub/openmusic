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

export default function AccountGate({ children, onReady, allowPreview = false }: { children: ReactNode; onReady?: () => void; allowPreview?: boolean }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const account = await fetchAccountSession();
        if (!active || current !== generation) return;
        setAuthenticated(Boolean(account));
        setError('');
        if (!account) { stopSharedAudio(); onReady?.(); }
      } catch (reason) {
        if (!active || current !== generation) return;
        setAuthenticated(false);
        setError(reason instanceof Error ? reason.message : '账户验证失败，请重试');
        stopSharedAudio();
        onReady?.();
      }
    };
    const onChange = () => { void refresh(); };
    const onStorage = (event: StorageEvent) => { if (isAccountSessionRevisionEvent(event)) onChange(); };
    void refresh();
    window.addEventListener('openmusic:account-session-changed', onChange);
    window.addEventListener('openmusic:account-auth-required', onChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onChange);
    const timer = window.setInterval(onChange, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('openmusic:account-session-changed', onChange);
      window.removeEventListener('openmusic:account-auth-required', onChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onChange);
    };
  }, [onReady, revision]);

  if (authenticated) return <><ErrorReportSolutionGate /><PermanentDecisionGate />{children}</>;
  if (allowPreview) return children;
  if (authenticated === null) return <MusicLoading label="正在验证账户" />;
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
        ) : <AccountAccess required />}
      </div>
    </main>
  );
}
