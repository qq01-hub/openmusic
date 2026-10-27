import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Github,
  Headphones,
  Heart,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  ShieldCheck,
  Unlink,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import Modal from './Modal';
import { Link } from 'react-router-dom';
import MusicLoading from './MusicLoading';
import Toast from './Toast';
import {
  completeWechatAccount,
  consumeAccountAuthReturn,
  fetchAccountProviders,
  fetchAccountSession,
  loginAccountWithEmail,
  logoutAccount,
  registerAccountWithEmail,
  requestAccountEmailCode,
  startAccountOAuth,
  startWechatAccountLogin,
  pollWechatAccountLogin,
  unbindAccountIdentity,
  type AccountIdentityProvider,
  type AccountProfile,
  type AccountProviderStatus,
} from '../lib/accountAuth';
import { headerPillCls } from '../lib/homeHeaderActions';
import { getAccountAccessBackView } from '../lib/accountAccessNavigation';
import { refreshSocketSession } from '../hooks/useSocket';
import { announceAccountSessionChanged } from '../lib/accountSessionSignal';

const EMPTY_PROVIDERS: AccountProviderStatus = { linuxdo: false, github: false, wechat: false };

type View = 'welcome' | 'methods' | 'email-login' | 'email-register' | 'wechat-login' | 'wechat-bind' | 'manage';

const providerMeta: Record<Exclude<AccountIdentityProvider, 'email'>, { label: string; description: string }> = {
  linuxdo: { label: 'Linux Do', description: '社区身份' },
  github: { label: 'GitHub', description: '开发者身份' },
  wechat: { label: '微信', description: '使用微信扫码登录' },
};

function LinuxDoMark() {
  return <span className="text-[11px] font-black tracking-[-0.08em]">LINUX.DO</span>;
}

function ProviderIcon({ provider }: { provider: Exclude<AccountIdentityProvider, 'email'> }) {
  if (provider === 'github') return <Github className="h-5 w-5" />;
  if (provider === 'wechat') return <MessageCircle className="h-5 w-5" />;
  return <LinuxDoMark />;
}

function WechatAccountScan({
  action,
  onComplete,
}: {
  action: 'login' | 'bind';
  onComplete: (account: AccountProfile) => void;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('正在准备安全二维码…');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: number | undefined;
    let expiresAt = 0;
    setQrUrl(null);
    setError('');
    setStatus('正在准备安全二维码…');

    const fail = (reason: unknown) => {
      if (cancelled) return;
      setQrUrl(null);
      setStatus('操作未完成');
      setError(reason instanceof Error ? reason.message : '微信登录失败，请重试');
    };

    const poll = async () => {
      try {
        if (Date.now() >= expiresAt) throw new Error('二维码已过期，请重新获取');
        const result = await pollWechatAccountLogin(controller.signal);
        if (cancelled) return;
        if (result.status === 'expired') throw new Error('二维码已过期，请重新获取');
        if (result.status === 'confirmed') {
          setQrUrl(null);
          setStatus('正在完成账户验证…');
          const account = await completeWechatAccount(action, controller.signal);
          if (!cancelled) onComplete(account);
          return;
        }
        if (result.status === 'scanned') setStatus('已扫码，请在手机上确认');
        timer = window.setTimeout(() => void poll(), 1600);
      } catch (reason) { fail(reason); }
    };

    void startWechatAccountLogin(controller.signal).then((session) => {
      if (cancelled) return;
      expiresAt = session.expiresAt;
      setQrUrl(session.qrUrl);
      setStatus('请使用微信扫一扫');
      timer = window.setTimeout(() => void poll(), 1600);
    }).catch(fail);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [action, onComplete, retryKey]);

  return (
    <div className="flex flex-col items-center py-2 text-center">
      <div className="flex h-[min(66vw,260px)] w-[min(66vw,260px)] items-center justify-center rounded-[28px] bg-white p-3 shadow-[0_22px_60px_rgba(0,0,0,.28)]">
        {qrUrl ? (
          <img src={qrUrl} alt="微信登录二维码" onError={() => { setQrUrl(null); setError('二维码加载失败，请重新获取'); }} className="h-full w-full rounded-2xl object-contain" />
        ) : error ? (
          <MessageCircle className="h-12 w-12 text-black/20" />
        ) : (
          <MusicLoading label="正在准备微信二维码" compact className="bg-transparent" />
        )}
      </div>
      <p role="status" aria-live="polite" className="mt-5 text-[15px] font-semibold text-white">{status}</p>
      <p className="mt-1.5 max-w-xs text-xs leading-5 text-netease-muted">
        通过文件传输助手确认微信身份，由本站服务端向微信核验 UIN，完成后建议在手机微信顶部退出文件传输助手
      </p>
      {error && <p className="mt-3 text-sm text-amber-200">{error}</p>}
      {error && (
        <button
          type="button"
          onClick={() => setRetryKey((value) => value + 1)}
          className="mt-4 rounded-full border border-white/12 bg-white/[0.06] px-5 py-2 text-sm text-white transition hover:bg-white/10"
        >
          重新获取二维码
        </button>
      )}
    </div>
  );
}

export default function AccountAccess({
  allowAutoPrompt = true,
  onOpenChange,
  required = false,
}: {
  allowAutoPrompt?: boolean;
  onOpenChange?: (open: boolean) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(required);
  const [view, setView] = useState<View>('welcome');
  const dialogRef = useRef<HTMLDivElement>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [providers, setProviders] = useState<AccountProviderStatus>(EMPTY_PROVIDERS);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const setPanelOpen = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const refresh = useCallback(async () => {
    const [session, status] = await Promise.all([
      fetchAccountSession(),
      fetchAccountProviders(),
    ]);
    setAccount(session);
    setProviders(status);
    return session;
  }, []);

  useEffect(() => {
    const oauthResult = consumeAccountAuthReturn();
    if (oauthResult) {
      setToast(oauthResult);
      announceAccountSessionChanged();
    }
    void refresh()
      .then((session) => {
        if (oauthResult) {
          setView(session ? 'manage' : 'methods');
          setPanelOpen(true);
        }
      })
      .catch((reason) => { setProviders(EMPTY_PROVIDERS); setError(reason instanceof Error ? reason.message : '账户状态暂不可用，请重试'); })
      .finally(() => setLoading(false));
  }, [refresh, setPanelOpen]);

  useEffect(() => {
    if (loading || account || !allowAutoPrompt || open) return;
    setView('methods');
    setPanelOpen(true);
  }, [account, allowAutoPrompt, loading, open, setPanelOpen]);

  useEffect(() => {
    const showLogin = () => {
      setAccount(null);
      setError('');
      setView('welcome');
      setPanelOpen(true);
    };
    const update = () => { void refresh().catch(() => setError('账户状态暂不可用，请重试')); };
    window.addEventListener('openmusic:account-auth-required', showLogin);
    window.addEventListener('openmusic:account-session-changed', update);
    return () => {
      window.removeEventListener('openmusic:account-auth-required', showLogin);
      window.removeEventListener('openmusic:account-session-changed', update);
    };
  }, [refresh, setPanelOpen]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const selector = 'button:not([disabled]), input:not([disabled]), a[href], select, textarea, [tabindex="0"]';
    dialog?.querySelector<HTMLElement>(selector)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !required) setPanelOpen(false);
      if (event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(selector)].filter((element) => element.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, required, setPanelOpen, view]);

  useEffect(() => {
    if (codeCooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCodeCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  const identityMap = useMemo(
    () => new Map(account?.identities.map((identity) => [identity.provider, identity]) || []),
    [account],
  );

  const close = () => {
    if (required && !account) return;
    setError('');
    setPanelOpen(false);
  };

  const submitEmail = async (register: boolean) => {
    if (!email.trim() || password.length < 8 || (register && !/^\d{6}$/.test(code))) {
      setError(register ? '请填写邮箱、至少 8 位密码和 6 位验证码' : '请填写邮箱和至少 8 位密码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const next = register
        ? await registerAccountWithEmail(email, password, code)
        : await loginAccountWithEmail(email, password);
      await refreshSocketSession();
      announceAccountSessionChanged();
      setAccount(next);
      setView('manage');
      setToast({ message: register ? '账户创建完成' : '欢迎回来', type: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  const sendCode = async () => {
    if (!email.trim()) {
      setError('请先填写邮箱地址');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await requestAccountEmailCode(email);
      setCodeCooldown(result.resendAfterSec);
      setToast({ message: '验证码已发送', type: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证码发送失败');
    } finally {
      setSubmitting(false);
    }
  };

  const finishWechat = useCallback((next: AccountProfile) => {
    void refreshSocketSession().finally(() => {
      announceAccountSessionChanged();
    });
    setAccount(next);
    setView('manage');
    setToast({ message: '微信身份验证成功', type: 'success' });
  }, []);

  const unbind = async (provider: Exclude<AccountIdentityProvider, 'email'>) => {
    setSubmitting(true);
    setError('');
    try {
      const next = await unbindAccountIdentity(provider);
      setAccount(next);
      setToast({ message: `${providerMeta[provider].label} 已解绑`, type: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '解绑失败');
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    setSubmitting(true);
    try {
      await logoutAccount();
      announceAccountSessionChanged();
      void refreshSocketSession().catch(() => setToast({ message: '账户已退出，连接清理未完成，请刷新页面', type: 'error' }));
      setAccount(null);
      setView('methods');
      setToast({ message: '已退出账户，请重新登录后使用', type: 'success' });
    } finally {
      setSubmitting(false);
    }
  };

  const title = view === 'manage'
    ? '账户与安全'
    : view.startsWith('wechat')
      ? '微信扫码'
      : view === 'email-register'
        ? '创建账户'
        : view === 'email-login'
          ? '邮箱登录'
          : view === 'welcome' ? '欢迎来到 OpenMusic' : '选择登录方式';

  return (
    <>
      {!required && <button
        type="button"
        data-guide="home-account"
        onClick={() => {
          setView(account ? 'manage' : 'welcome');
          setPanelOpen(true);
        }}
        className={headerPillCls}
        aria-label={account ? '账户与安全' : '登录账户'}
      >
        <span className={`flex h-4 w-4 items-center justify-center rounded-full ${account ? 'bg-white text-black' : 'bg-white/10 text-white/70'}`}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : account ? <Check className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{account ? (account.email || identityMap.values().next().value?.username || '我的账户') : '登录'}</span>
      </button>}

      <Modal
        open={open}
        onClose={close}
        closeOnMaskClick={!required}
        zIndex={115}
        containerClassName="fixed inset-0 flex items-center justify-center p-4 sm:p-6"
        panelClassName="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-netease-dark p-5 text-left shadow-2xl animate-fade-in sm:p-6"
      >
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" className="account-dialog">
        <div className="mb-5 flex items-center justify-between border-b border-white/8 pb-4">
          <div className="flex items-center gap-3">
            {!['welcome', 'manage'].includes(view) && (
              <button type="button" onClick={() => { setError(''); setView(getAccountAccessBackView(view, Boolean(account))); }} className="rounded-lg bg-white/[0.06] p-2 text-netease-muted transition hover:bg-white/10 hover:text-white" aria-label="返回">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 id="account-dialog-title" className="text-base font-semibold text-white">{title}</h2>
              <p className="mt-1 text-xs text-netease-muted">{account ? '管理登录方式与账户安全' : '你的音乐，你们的此刻'}</p>
            </div>
          </div>
          {!required && <button type="button" onClick={close} className="rounded-lg p-1.5 text-netease-muted transition hover:bg-white/10 hover:text-white" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>}
        </div>

        {view === 'welcome' && (
          <div className="pb-1 pt-3 sm:pt-5">
            <div className="flex items-center gap-5 sm:gap-6">
              <div aria-hidden="true" className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#171717] shadow-[0_8px_20px_rgba(0,0,0,.35)] sm:h-24 sm:w-24">
                <span className="absolute inset-2 rounded-full border border-white/[0.07]" />
                <span className="absolute inset-4 rounded-full border border-white/[0.07]" />
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-netease-red sm:h-12 sm:w-12"><Headphones className="h-5 w-5 text-white" /></span>
              </div>
              <h3 className="text-[26px] font-semibold leading-snug tracking-tight text-white sm:text-3xl">好音乐<br />值得一起听</h3>
            </div>
            <p className="mt-6 text-sm leading-7 text-netease-muted">加入一个房间，把喜欢的歌放给彼此听<br />登录后，你的收藏与房间也会一直在这里</p>
            <div className="my-6 flex flex-wrap gap-x-6 gap-y-3 border-y border-white/[0.08] py-4 text-xs text-netease-muted">
              <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-white/70" aria-hidden />一起点歌</span>
              <span className="inline-flex items-center gap-2"><Heart className="h-4 w-4 text-white/70" aria-hidden />收藏随行</span>
            </div>
            <button type="button" onClick={() => setView('methods')} className="group flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-netease-red px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-netease-red/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
              登录或创建账户 <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden />
            </button>
            {!required && <button type="button" onClick={close} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl text-sm text-netease-muted transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">先逛逛首页</button>}
          </div>
        )}

        {view === 'methods' && (
          <div className="space-y-3">
            <button type="button" onClick={() => setView('email-login')} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-left transition hover:bg-white/[0.085]">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black"><Mail className="h-5 w-5" /></span>
              <span className="flex-1"><span className="block text-sm font-semibold text-white">邮箱</span><span className="mt-0.5 block text-xs text-netease-muted">密码登录或验证码注册</span></span>
              <ChevronRight className="h-4 w-4 text-white/25" />
            </button>
            {(['linuxdo', 'github', 'wechat'] as const).map((provider) => providers[provider] && (
              <button
                key={provider}
                type="button"
                onClick={() => provider === 'wechat' ? setView('wechat-login') : startAccountOAuth(provider, 'login')}
                className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-left transition hover:bg-white/[0.085] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-white/[0.045]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.08] text-white"><ProviderIcon provider={provider} /></span>
                <span className="flex-1"><span className="block text-sm font-semibold text-white">{providerMeta[provider].label}</span><span className="mt-0.5 block text-xs text-netease-muted">{providerMeta[provider].description}</span></span>
                <ChevronRight className="h-4 w-4 text-white/25" />
              </button>
            ))}
            <p className="border-t border-white/10 pt-4 text-xs leading-5 text-netease-muted">选择你习惯的方式登录，之后也可以在账户中绑定其他登录方式</p>
          </div>
        )}

        {required && <Link to="/" className="mt-4 flex min-h-11 items-center justify-center rounded-xl text-sm text-netease-muted transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">返回首页，先逛逛</Link>}

        {(view === 'email-login' || view === 'email-register') && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submitEmail(view === 'email-register'); }}>
            <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-netease-muted">邮箱地址</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="home-modal-input w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/28" placeholder={view === 'email-register' ? 'name@qq.com' : 'name@example.com'} />{view === 'email-register' && <span className="mt-2 block pl-1 text-xs leading-5 text-netease-muted">仅支持 QQ、163、Gmail、Outlook 等常见公共邮箱，不支持自定义域名或企业邮箱<br />已有账户仍可使用原邮箱登录</span>}</label>
            <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-netease-muted">密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={view === 'email-register' ? 'new-password' : 'current-password'} className="home-modal-input w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/28" placeholder="至少 8 位" /></label>
            {view === 'email-register' && (
              <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-netease-muted">邮箱验证码</span><span className="flex gap-2"><input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="home-modal-input min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm tracking-[0.2em] text-white outline-none transition focus:border-white/28" placeholder="6 位验证码" /><button type="button" disabled={submitting || codeCooldown > 0} onClick={() => void sendCode()} className="rounded-xl border border-white/10 bg-white/[0.07] px-4 text-xs font-medium text-white disabled:opacity-45">{codeCooldown > 0 ? `${codeCooldown}s` : '发送验证码'}</button></span></label>
            )}
            {error && <p className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">{error}</p>}
            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{view === 'email-register' ? '创建并登录' : '登录'}</button>
            <button type="button" onClick={() => { setError(''); setView(view === 'email-register' ? 'email-login' : 'email-register'); }} className="w-full py-2 text-sm text-netease-muted transition hover:text-white">{view === 'email-register' ? '已有账户？返回登录' : '没有账户？使用邮箱注册'}</button>
          </form>
        )}

        {(view === 'wechat-bind' || view === 'wechat-login') && (
          <WechatAccountScan action={view === 'wechat-bind' ? 'bind' : 'login'} onComplete={finishWechat} />
        )}

        {view === 'manage' && account && (
          <div>
            <div className="mb-6 flex items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.04] p-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black"><ShieldCheck className="h-5 w-5" /></span>
              <div className="min-w-0"><p className="truncate text-[15px] font-semibold text-white">{account.email || 'OpenMusic 账户'}</p><p className="mt-1 text-xs text-netease-muted">已启用 {account.identities.length} 种身份 · 数据不会按邮箱自动合并</p></div>
            </div>
            <div className="space-y-2.5">
              {account.hasPassword && (
                <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07]"><Mail className="h-4 w-4" /></span><span className="flex-1"><span className="block text-sm font-medium text-white">邮箱与密码</span><span className="block truncate text-xs text-netease-muted">{account.email}</span></span><span className="text-xs text-emerald-300/80">已启用</span></div>
              )}
              {(['linuxdo', 'wechat', 'github'] as const).map((provider) => {
                const identity = identityMap.get(provider);
                const enabled = providers[provider];
                if (!identity && !enabled) return null;
                return (
                  <div key={provider} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07]"><ProviderIcon provider={provider} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white">{providerMeta[provider].label}</span><span className="block truncate text-xs text-netease-muted">{identity?.username || (identity ? '已绑定' : '尚未绑定')}</span></span>
                    {identity ? (
                      <button type="button" disabled={submitting} onClick={() => void unbind(provider)} className="rounded-full p-2 text-white/28 transition hover:bg-red-400/10 hover:text-red-300 disabled:opacity-40" aria-label={`解绑 ${providerMeta[provider].label}`}><Unlink className="h-4 w-4" /></button>
                    ) : provider === 'wechat' ? (
                      <button type="button" onClick={() => setView('wechat-bind')} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65 transition hover:bg-white/[0.07] hover:text-white">绑定</button>
                    ) : (
                      <button type="button" onClick={() => startAccountOAuth(provider, 'bind')} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65 transition hover:bg-white/[0.07] hover:text-white">绑定</button>
                    )}
                  </div>
                );
              })}
            </div>
            {error && <p className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">{error}</p>}
            <button type="button" disabled={submitting} onClick={() => void logout()} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 py-3 text-sm text-netease-muted transition hover:bg-white/[0.05] hover:text-white"><LogOut className="h-4 w-4" />退出账户</button>
          </div>
        )}
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
