import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Github,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  ShieldCheck,
  Unlink,
  UserRound,
  X,
} from 'lucide-react';
import Modal from './Modal';
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
  unbindAccountIdentity,
  type AccountIdentityProvider,
  type AccountProfile,
  type AccountProviderStatus,
} from '../lib/accountAuth';
import {
  bootstrapWechatFileHelperSession,
  buildWechatLoginQrImageUrl,
  clearWechatFileHelperSession,
  fetchWechatLoginUuid,
  getWechatFileHelperUin,
  pollWechatLogin,
} from '../lib/wechatFileHelperBridge';
import { refreshSocketSession } from '../hooks/useSocket';

const GUEST_CHOICE_KEY = 'openmusic:account-entry-choice:v1';
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
  const uuidRef = useRef<string | null>(null);
  const scannedRef = useRef(false);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('正在准备安全二维码…');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    clearWechatFileHelperSession();
    uuidRef.current = null;
    scannedRef.current = false;
    busyRef.current = false;
    doneRef.current = false;
    setQrUrl(null);
    setError('');
    setStatus('正在准备安全二维码…');

    const refreshQr = async () => {
      const uuid = await fetchWechatLoginUuid();
      if (cancelled) return;
      uuidRef.current = uuid;
      scannedRef.current = false;
      setQrUrl(buildWechatLoginQrImageUrl(uuid));
      setStatus('请使用微信扫一扫');
    };

    const timer = window.setInterval(() => {
      void (async () => {
        if (cancelled || busyRef.current || doneRef.current || !uuidRef.current) return;
        busyRef.current = true;
        const uuid = uuidRef.current;
        try {
          const result = await pollWechatLogin(uuid, scannedRef.current ? 1 : 0);
          if (cancelled || uuidRef.current !== uuid) return;
          if (result === 'expired') {
            setStatus('二维码已过期，正在刷新…');
            await refreshQr();
            return;
          }
          if (result === 'scanned') {
            scannedRef.current = true;
            setStatus('已扫码，请在手机上确认');
            return;
          }
          if (typeof result === 'object' && result.ok) {
            doneRef.current = true;
            uuidRef.current = null;
            setQrUrl(null);
            setStatus('正在验证微信身份…');
            await bootstrapWechatFileHelperSession(null, result.redirectUri);
            const uin = getWechatFileHelperUin();
            if (!uin) throw new Error('未读取到微信身份，请重新扫码');
            const account = await completeWechatAccount(action, uin);
            if (cancelled) return;
            clearWechatFileHelperSession();
            onComplete(account);
          }
        } catch (reason) {
          if (cancelled) return;
          doneRef.current = true;
          setQrUrl(null);
          setStatus('操作未完成');
          setError(reason instanceof Error ? reason.message : '微信登录失败');
        } finally {
          busyRef.current = false;
        }
      })();
    }, 1800);

    void refreshQr().catch(() => {
      if (!cancelled) {
        doneRef.current = true;
        setStatus('二维码获取失败');
        setError('请检查网络后重试');
      }
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      clearWechatFileHelperSession();
    };
  }, [action, onComplete, retryKey]);

  return (
    <div className="flex flex-col items-center py-2 text-center">
      <div className="flex h-[min(66vw,260px)] w-[min(66vw,260px)] items-center justify-center rounded-[28px] bg-white p-3 shadow-[0_22px_60px_rgba(0,0,0,.28)]">
        {qrUrl ? (
          <img src={qrUrl} alt="微信登录二维码" className="h-full w-full rounded-2xl object-contain" />
        ) : error ? (
          <MessageCircle className="h-12 w-12 text-black/20" />
        ) : (
          <Loader2 className="h-9 w-9 animate-spin text-black/35" />
        )}
      </div>
      <p className="mt-5 text-[15px] font-semibold text-white">{status}</p>
      <p className="mt-1.5 max-w-xs text-xs leading-5 text-white/42">
        扫码仅用于确认微信身份，完成后建议在手机微信顶部退出文件传输助手。
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
}: {
  allowAutoPrompt?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('welcome');
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
    if (oauthResult) setToast(oauthResult);
    void refresh()
      .then((session) => {
        if (oauthResult) {
          setView(session ? 'manage' : 'methods');
          setPanelOpen(true);
        }
      })
      .catch(() => setProviders(EMPTY_PROVIDERS))
      .finally(() => setLoading(false));
  }, [refresh, setPanelOpen]);

  useEffect(() => {
    if (loading || account || !allowAutoPrompt || open) return;
    try {
      if (localStorage.getItem(GUEST_CHOICE_KEY) === 'guest') return;
    } catch {
      // 无本地存储时仍展示一次选择。
    }
    setView('welcome');
    setPanelOpen(true);
  }, [account, allowAutoPrompt, loading, open, setPanelOpen]);

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
    if (!account) {
      try { localStorage.setItem(GUEST_CHOICE_KEY, 'guest'); } catch { /* ignore */ }
    }
    setError('');
    setPanelOpen(false);
  };

  const chooseGuest = () => {
    close();
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
      window.dispatchEvent(new Event('openmusic:account-session-changed'));
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
      window.dispatchEvent(new Event('openmusic:account-session-changed'));
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
      await refreshSocketSession();
      window.dispatchEvent(new Event('openmusic:account-session-changed'));
      setAccount(null);
      setView('welcome');
      setToast({ message: '已退出账户，当前继续使用游客身份', type: 'success' });
      try { localStorage.setItem(GUEST_CHOICE_KEY, 'guest'); } catch { /* ignore */ }
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
          : '进入 OpenMusic';

  return (
    <>
      <button
        type="button"
        data-guide="home-account"
        onClick={() => {
          setView(account ? 'manage' : 'welcome');
          setPanelOpen(true);
        }}
        className="group inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-2.5 text-sm text-white/70 outline-none transition duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.1] hover:text-white focus-visible:ring-2 focus-visible:ring-netease-red/40 sm:px-3.5"
        aria-label={account ? '账户与安全' : '登录账户'}
      >
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${account ? 'bg-white text-black' : 'bg-white/10 text-white/70'}`}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : account ? <Check className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{account ? (account.email || identityMap.values().next().value?.username || '我的账户') : '登录'}</span>
      </button>

      <Modal
        open={open}
        onClose={close}
        zIndex={115}
        panelClassName="relative max-h-[min(760px,calc(100vh-2rem))] w-full max-w-[520px] overflow-y-auto rounded-[34px] border border-white/12 bg-[#111113]/95 p-5 shadow-[0_32px_100px_rgba(0,0,0,.62)] backdrop-blur-3xl sm:p-7"
      >
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!['welcome', 'manage'].includes(view) && (
              <button type="button" onClick={() => { setError(''); setView(account ? 'manage' : 'methods'); }} className="rounded-full bg-white/[0.06] p-2 text-white/55 transition hover:bg-white/10 hover:text-white" aria-label="返回">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.025em] text-white">{title}</h2>
              <p className="mt-0.5 text-xs text-white/38">账户是可选的，游客功能始终可用</p>
            </div>
          </div>
          <button type="button" onClick={close} className="rounded-full p-2 text-white/35 transition hover:bg-white/[0.07] hover:text-white" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        {view === 'welcome' && (
          <div className="space-y-3">
            <div className="mb-7 rounded-[28px] border border-white/8 bg-gradient-to-b from-white/[0.075] to-white/[0.025] px-6 py-7">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,.12)]">
                <KeyRound className="h-5 w-5" />
              </div>
              <h3 className="text-2xl font-semibold tracking-[-0.04em] text-white">一份账户，多种登录方式。</h3>
              <p className="mt-3 text-sm leading-6 text-white/48">绑定 Linux Do 或 GitHub，换设备时也能安全回到自己的账户。</p>
            </div>
            <button type="button" onClick={() => setView('methods')} className="flex w-full items-center justify-between rounded-2xl bg-white px-5 py-4 text-left text-[15px] font-semibold text-black transition hover:bg-white/90">
              登录或创建账户 <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={chooseGuest} className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-left text-[15px] text-white/75 transition hover:bg-white/[0.08] hover:text-white">
              以游客身份继续 <ChevronRight className="h-4 w-4 text-white/35" />
            </button>
          </div>
        )}

        {view === 'methods' && (
          <div className="space-y-3">
            <button type="button" onClick={() => setView('email-login')} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-left transition hover:bg-white/[0.085]">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black"><Mail className="h-5 w-5" /></span>
              <span className="flex-1"><span className="block text-sm font-semibold text-white">邮箱</span><span className="mt-0.5 block text-xs text-white/38">密码登录或验证码注册</span></span>
              <ChevronRight className="h-4 w-4 text-white/25" />
            </button>
            {(['linuxdo', 'wechat', 'github'] as const).map((provider) => providers[provider] && (
              <button
                key={provider}
                type="button"
                onClick={() => provider === 'wechat' ? setView('wechat-login') : startAccountOAuth(provider, 'login')}
                className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-left transition hover:bg-white/[0.085] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-white/[0.045]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.08] text-white"><ProviderIcon provider={provider} /></span>
                <span className="flex-1"><span className="block text-sm font-semibold text-white">{providerMeta[provider].label}</span><span className="mt-0.5 block text-xs text-white/38">{providerMeta[provider].description}</span></span>
                <ChevronRight className="h-4 w-4 text-white/25" />
              </button>
            ))}
            <button type="button" onClick={chooseGuest} className="w-full py-3 text-sm text-white/42 transition hover:text-white/70">暂不登录，继续使用游客身份</button>
          </div>
        )}

        {(view === 'email-login' || view === 'email-register') && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submitEmail(view === 'email-register'); }}>
            <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-white/45">邮箱地址</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="home-modal-input w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/28" placeholder="name@example.com" /></label>
            <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-white/45">密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={view === 'email-register' ? 'new-password' : 'current-password'} className="home-modal-input w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/28" placeholder="至少 8 位" /></label>
            {view === 'email-register' && (
              <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-white/45">邮箱验证码</span><span className="flex gap-2"><input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="home-modal-input min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm tracking-[0.2em] text-white outline-none transition focus:border-white/28" placeholder="6 位验证码" /><button type="button" disabled={submitting || codeCooldown > 0} onClick={() => void sendCode()} className="rounded-2xl border border-white/10 bg-white/[0.07] px-4 text-xs font-medium text-white disabled:opacity-45">{codeCooldown > 0 ? `${codeCooldown}s` : '发送验证码'}</button></span></label>
            )}
            {error && <p className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">{error}</p>}
            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{view === 'email-register' ? '创建并登录' : '登录'}</button>
            <button type="button" onClick={() => { setError(''); setView(view === 'email-register' ? 'email-login' : 'email-register'); }} className="w-full py-2 text-sm text-white/45 transition hover:text-white">{view === 'email-register' ? '已有账户？返回登录' : '没有账户？使用邮箱注册'}</button>
          </form>
        )}

        {(view === 'wechat-login' || view === 'wechat-bind') && (
          <WechatAccountScan action={view === 'wechat-bind' ? 'bind' : 'login'} onComplete={finishWechat} />
        )}

        {view === 'manage' && account && (
          <div>
            <div className="mb-6 flex items-center gap-4 rounded-[26px] border border-white/8 bg-white/[0.04] p-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black"><ShieldCheck className="h-5 w-5" /></span>
              <div className="min-w-0"><p className="truncate text-[15px] font-semibold text-white">{account.email || 'OpenMusic 账户'}</p><p className="mt-1 text-xs text-white/38">已启用 {account.identities.length} 种身份 · 数据不会按邮箱自动合并</p></div>
            </div>
            <div className="space-y-2.5">
              {account.hasPassword && (
                <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07]"><Mail className="h-4 w-4" /></span><span className="flex-1"><span className="block text-sm font-medium text-white">邮箱与密码</span><span className="block truncate text-xs text-white/35">{account.email}</span></span><span className="text-xs text-emerald-300/80">已启用</span></div>
              )}
              {(['linuxdo', 'wechat', 'github'] as const).map((provider) => {
                const identity = identityMap.get(provider);
                const enabled = providers[provider];
                if (!identity && !enabled) return null;
                return (
                  <div key={provider} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07]"><ProviderIcon provider={provider} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white">{providerMeta[provider].label}</span><span className="block truncate text-xs text-white/35">{identity?.username || (identity ? '已绑定' : '尚未绑定')}</span></span>
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
            <button type="button" disabled={submitting} onClick={() => void logout()} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 py-3 text-sm text-white/45 transition hover:bg-white/[0.05] hover:text-white"><LogOut className="h-4 w-4" />退出账户</button>
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
