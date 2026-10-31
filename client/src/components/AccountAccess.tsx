import HumanVerification from './HumanVerification';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { wechatLoginRetryDelay } from '../lib/wechatLoginRetry';
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
  Radio,
  ShieldCheck,
  Trash2,
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
import { hasAnonymousAccess } from '../lib/accountAccessSession';
import { fetchAccountMusicAccounts, setAccountMusicShared, deleteAccountMusicAccount } from '../api/accountMusic';
import { listAccountRooms } from '../api/accountRooms';
import type { AccountRoomSummary, RoomMusicAccounts } from '../types';

const EMPTY_PROVIDERS: AccountProviderStatus = { linuxdo: false, github: false, wechat: false };

type View = 'welcome' | 'methods' | 'email-login' | 'email-register' | 'wechat-login' | 'wechat-bind' | 'manage';

const providerMeta: Record<Exclude<AccountIdentityProvider, 'email'>, { label: string; description: string }> = {
  linuxdo: { label: 'Linux Do', description: '社区身份' },
  github: { label: 'GitHub', description: '开发者身份' },
  wechat: { label: '微信文件传输助手登录', description: '通过文件传输助手确认身份' },
};

function LinuxDoMark() {
  return <img src="/branding/linuxdo.svg?omv=3" alt="" className="h-5 w-5 object-contain" />;
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
    let failures = 0;
    let confirmed = false;
    let flowId: string | undefined;
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
        const result = confirmed ? { status: 'confirmed' as const } : await pollWechatAccountLogin(controller.signal, flowId);
        if (cancelled) return;
        if (result.status === 'expired') throw new Error('二维码已过期，请重新获取');
        if (result.status === 'confirmed') {
          confirmed = true;
          setQrUrl(null);
          setStatus('正在完成账户验证…');
          const account = await completeWechatAccount(action, controller.signal, flowId);
          if (!cancelled) onComplete(account);
          return;
        }
        if (result.status === 'scanned') setStatus('已扫码，请在手机上确认');
        failures = 0;
        timer = window.setTimeout(() => void poll(), 1600);
      } catch (reason) {
        if (cancelled) return;
        const delay = wechatLoginRetryDelay(reason, failures);
        if (delay !== null && Date.now() + delay < expiresAt) {
          failures += 1;
          setStatus(confirmed ? '账户验证暂时繁忙，正在重试…' : '网络暂时波动，正在重新确认…');
          timer = window.setTimeout(() => void poll(), delay);
        } else fail(reason);
      }
    };

    void startWechatAccountLogin(controller.signal).then((session) => {
      if (cancelled) return;
      expiresAt = session.expiresAt;
      flowId = session.flowId;
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
        在手机上确认，完成后建议退出文件传输助手
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
  const authRecheckPending = useRef(false);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [providers, setProviders] = useState<AccountProviderStatus>(EMPTY_PROVIDERS);
  const [providerError, setProviderError] = useState('');
  const providerRequest = useRef<Promise<AccountProviderStatus> | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [musicAccounts, setMusicAccounts] = useState<RoomMusicAccounts>({ netease: null, tencent: null, kugou: null, qishui: null });
  const [accountRooms, setAccountRooms] = useState<AccountRoomSummary[]>([]);
  const [accountDataLoading, setAccountDataLoading] = useState(false);

  const setPanelOpen = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const refreshProviders = useCallback(() => {
    if (!providerRequest.current) {
      providerRequest.current = fetchAccountProviders()
        .then(status => { setProviders(status); setProviderError(''); return status; })
        .catch(reason => { setProviderError('登录方式加载失败，请重试'); throw reason; })
        .finally(() => { providerRequest.current = null; });
    }
    return providerRequest.current;
  }, []);

  const refresh = useCallback(async () => {
    const [session, status] = await Promise.allSettled([
      fetchAccountSession(),
      refreshProviders(),
    ]);
    if (session.status === 'rejected') throw session.reason;
    setAccount(session.value);
    if (session.value) {
      setAccountDataLoading(true);
      void Promise.all([fetchAccountMusicAccounts(), listAccountRooms()])
        .then(([accounts, rooms]) => { setMusicAccounts(accounts); setAccountRooms(rooms); })
        .catch(() => undefined)
        .finally(() => setAccountDataLoading(false));
    } else {
      setMusicAccounts({ netease: null, tencent: null, kugou: null, qishui: null });
      setAccountRooms([]);
    }
    if (status.status === 'fulfilled') setError('');
    return session.value;
  }, [refreshProviders]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => { void refreshProviders().catch(() => undefined); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [open, refreshProviders]);

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
      .catch((reason) => { setError(reason instanceof Error ? reason.message : '账户状态暂不可用，请重试'); })
      .finally(() => setLoading(false));
  }, [refresh, setPanelOpen]);

  useEffect(() => {
    if (loading || account || error || !allowAutoPrompt || open || hasAnonymousAccess()) return;
    setView('methods');
    setPanelOpen(true);
  }, [account, error, allowAutoPrompt, loading, open, setPanelOpen]);

  useEffect(() => {
    let active = true;
    const showLogin = () => {
      if (authRecheckPending.current) return;
      authRecheckPending.current = true;
      // 先确认真实账户状态，身份 Cookie 重签或服务重启不直接弹出登录
      void refresh().then(current => {
        if (!active || current || hasAnonymousAccess()) return;
        setAccount(null); setError(''); setView('welcome'); setPanelOpen(true);
      }).catch(() => { if (active) setError('服务连接暂不可用，请等待恢复后重试'); })
        .finally(() => { authRecheckPending.current = false; });
    };
    const update = () => { void refresh().catch(() => setError('账户状态暂不可用，请重试')); };
    const onNicknameSaveFailed = () => { setToast({ message: '已恢复登录，昵称尚未保存，请稍后重新保存', type: 'error' }); };
    window.addEventListener('openmusic:account-auth-required', showLogin);
    window.addEventListener('openmusic:account-session-changed', update);
    window.addEventListener('openmusic:account-nickname-save-failed', onNicknameSaveFailed);
    return () => {
      active = false;
      window.removeEventListener('openmusic:account-auth-required', showLogin);
      window.removeEventListener('openmusic:account-session-changed', update);
      window.removeEventListener('openmusic:account-nickname-save-failed', onNicknameSaveFailed);
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
    if (providers.turnstile?.enabled && !turnstileToken) { setError('请先完成人机校验'); return; }
    setSubmitting(true);
    setError('');
    try {
      const next = register
        ? await registerAccountWithEmail(email, password, code, turnstileToken)
        : await loginAccountWithEmail(email, password, turnstileToken);
      await refreshSocketSession();
      announceAccountSessionChanged();
      setAccount(next);
      setView('manage');
      setToast({ message: register ? '账户创建完成' : '欢迎回来', type: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setSubmitting(false);
      setTurnstileToken(''); setChallengeAttempt(value => value + 1);
    }
  };

  const sendCode = async () => {
    if (!email.trim()) {
      setError('请先填写邮箱地址');
      return;
    }
    if (providers.turnstile?.enabled && !turnstileToken) { setError('请先完成人机校验'); return; }
    setSubmitting(true);
    setError('');
    try {
      const result = await requestAccountEmailCode(email, turnstileToken);
      setCodeCooldown(result.resendAfterSec);
      setToast({ message: '验证码已发送', type: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证码发送失败');
    } finally {
      setSubmitting(false);
      setTurnstileToken(''); setChallengeAttempt(value => value + 1);
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
      setMusicAccounts({ netease: null, tencent: null, kugou: null, qishui: null });
      setAccountRooms([]);
      setView('methods');
      setToast({ message: '已退出账户', type: 'success' });
    } finally {
      setSubmitting(false);
    }
  };

  const musicPlatformLabels: Record<keyof RoomMusicAccounts, string> = {
    netease: '网易云',
    tencent: 'QQ 音乐',
    kugou: '酷狗音乐',
    qishui: '汽水音乐',
  };

  const toggleAccountMusic = async (platform: keyof RoomMusicAccounts, shared: boolean) => {
    setSubmitting(true);
    setError('');
    try {
      const next = await setAccountMusicShared(platform, shared);
      setMusicAccounts(current => ({ ...current, [platform]: next }));
      setToast({ message: shared ? `${musicPlatformLabels[platform]}会员已打开共享` : `${musicPlatformLabels[platform]}会员已关闭共享`, type: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '会员共享更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const removeAccountMusic = async (platform: keyof RoomMusicAccounts) => {
    if (!window.confirm(`删除已保存的${musicPlatformLabels[platform]}会员信息吗`)) return;
    setSubmitting(true);
    setError('');
    try {
      setMusicAccounts(await deleteAccountMusicAccount(platform));
      setToast({ message: `${musicPlatformLabels[platform]}会员信息已删除，原房间不受影响`, type: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '会员信息删除失败');
    } finally {
      setSubmitting(false);
    }
  };

  const title = view === 'manage'
    ? '账户与安全'
    : view.startsWith('wechat')
      ? '微信文件传输助手登录'
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
        panelClassName="account-modal-panel relative max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-[28px] p-5 text-left shadow-2xl animate-fade-in sm:p-6"
      >
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" className="account-dialog">
        <div className="account-dialog-header mb-5 flex items-center justify-between pb-4">
          <div className="flex items-center gap-3">
            {!['welcome', 'manage'].includes(view) && (
              <button type="button" onClick={() => { setError(''); setView(getAccountAccessBackView(view, Boolean(account))); }} className="account-icon-button rounded-xl p-2 text-netease-muted transition" aria-label="返回">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 id="account-dialog-title" className="text-base font-semibold text-white">{title}</h2>
              <p className="mt-1 text-xs text-netease-muted">{account ? '管理登录方式与账户安全' : '你的音乐，你们的此刻'}</p>
            </div>
          </div>
          {!required && <button type="button" onClick={close} className="account-icon-button rounded-xl p-1.5 text-netease-muted transition" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>}
        </div>

        {providerError && (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">
            <span>{providerError}</span>
            <button type="button" onClick={() => { void refreshProviders().catch(() => undefined); }} className="shrink-0 underline underline-offset-4">重试</button>
          </div>
        )}
        {view === 'welcome' && (
          <div className="account-welcome pb-1 pt-3 sm:pt-5">
            <div className="account-welcome-copy">
              <div className="flex items-center gap-5 sm:gap-6">
                <div aria-hidden="true" className="account-welcome-orb relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full sm:h-24 sm:w-24">
                  <span className="absolute inset-2 rounded-full border border-white/[0.07]" />
                  <span className="absolute inset-4 rounded-full border border-white/[0.07]" />
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-netease-red sm:h-12 sm:w-12"><Headphones className="h-5 w-5 text-white" /></span>
                </div>
                <h3 className="text-[26px] font-semibold leading-snug tracking-tight text-white sm:text-3xl">好音乐<br />值得一起听</h3>
              </div>
              <p className="mt-6 text-sm leading-7 text-netease-muted">登录后，和朋友一起点歌、收藏好音乐</p>
            </div>
            <div className="account-welcome-actions">
              <div className="account-welcome-benefits mb-5 flex flex-wrap gap-2 text-xs text-netease-muted">
                <span className="inline-flex items-center gap-2 rounded-full px-3 py-2"><Users className="h-4 w-4" aria-hidden />一起点歌</span>
                <span className="inline-flex items-center gap-2 rounded-full px-3 py-2"><Heart className="h-4 w-4" aria-hidden />收藏随行</span>
                <span className="inline-flex items-center gap-2 rounded-full px-3 py-2"><Radio className="h-4 w-4" aria-hidden />多端可用</span>
              </div>
              <button type="button" onClick={() => setView('methods')} className="account-primary-button group flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                登录或创建账户 <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden />
              </button>
              {!required && <button type="button" onClick={close} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl text-sm text-netease-muted transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">先逛逛首页</button>}
            </div>
          </div>
        )}

        {view === 'methods' && (
          <div className="account-method-grid grid grid-cols-2 gap-2.5">
            {providers.wechat && (
              <button
                type="button"
                onClick={() => setView('wechat-login')}
                className="account-method-card flex min-h-14 w-full items-center gap-3 rounded-2xl p-3 text-left transition"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.08] text-white"><ProviderIcon provider="wechat" /></span>
                <span className="flex-1 text-sm font-semibold text-white">微信文件传输助手登录</span>
                <ChevronRight className="h-4 w-4 text-white/25" />
              </button>
            )}
            <button type="button" onClick={() => setView('email-login')} className="account-method-card flex min-h-14 w-full items-center gap-3 rounded-2xl p-3 text-left transition">
              <span className="account-provider-icon account-provider-icon-email flex h-10 w-10 items-center justify-center rounded-xl text-white"><Mail className="h-5 w-5" /></span>
              <span className="flex-1"><span className="block text-sm font-semibold text-white">邮箱</span><span className="mt-0.5 block text-xs text-netease-muted">密码登录或验证码注册</span></span>
              <ChevronRight className="h-4 w-4 text-white/25" />
            </button>
            {(['linuxdo', 'github'] as const).map((provider) => providers[provider] && (
              <button
                key={provider}
                type="button"
                onClick={() => void startAccountOAuth(provider, 'login').catch(error => setError(error.message))}
                className="account-method-card flex min-h-14 w-full items-center gap-3 rounded-2xl p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.08] text-white"><ProviderIcon provider={provider} /></span>
                <span className="flex-1"><span className="block text-sm font-semibold text-white">{providerMeta[provider].label}</span><span className="mt-0.5 block text-xs text-netease-muted">{providerMeta[provider].description}</span></span>
                <ChevronRight className="h-4 w-4 text-white/25" />
              </button>
            ))}
            <p className="border-t border-white/10 pt-4 text-xs leading-5 text-netease-muted">已有账户？请用原方式登录，再绑定其他方式</p>
          </div>
        )}

        {required && view !== 'wechat-login' && view !== 'wechat-bind' && <Link to="/" className="mt-4 flex min-h-11 items-center justify-center rounded-xl text-sm text-netease-muted transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">返回首页，先逛逛</Link>}

        {(view === 'email-login' || view === 'email-register') && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submitEmail(view === 'email-register'); }}>
            <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-netease-muted">邮箱地址</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="home-modal-input w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/28" placeholder={view === 'email-register' ? 'name@qq.com' : 'name@example.com'} />{view === 'email-register' && <span className="mt-2 block pl-1 text-xs leading-5 text-netease-muted">仅支持 QQ、163、Gmail、Outlook 等常见公共邮箱，不支持自定义域名或企业邮箱<br />已有账户仍可使用原邮箱登录</span>}</label>
            <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-netease-muted">密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={view === 'email-register' ? 'new-password' : 'current-password'} className="home-modal-input w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/28" placeholder="至少 8 位" /></label>
            {view === 'email-register' && (
              <label className="block"><span className="mb-2 block pl-1 text-xs font-medium text-netease-muted">邮箱验证码</span><span className="flex gap-2"><input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="home-modal-input min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm tracking-[0.2em] text-white outline-none transition focus:border-white/28" placeholder="6 位验证码" /><button type="button" disabled={submitting || codeCooldown > 0} onClick={() => void sendCode()} className="rounded-xl border border-white/10 bg-white/[0.07] px-4 text-xs font-medium text-white disabled:opacity-45">{codeCooldown > 0 ? `${codeCooldown}s` : '发送验证码'}</button></span></label>
            )}
            {providers.turnstile?.enabled && <HumanVerification key={`${view}:${challengeAttempt}`} siteKey={providers.turnstile.siteKey} onToken={setTurnstileToken} />}
            {error && <p className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">{error}</p>}
            <button type="submit" disabled={submitting} className="account-primary-button flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition disabled:opacity-50">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{view === 'email-register' ? '创建并登录' : '登录'}</button>
            <button type="button" onClick={() => { setError(''); setView(view === 'email-register' ? 'email-login' : 'email-register'); }} className="w-full py-2 text-sm text-netease-muted transition hover:text-white">{view === 'email-register' ? '已有账户？返回登录' : '没有账户？使用邮箱注册'}</button>
          </form>
        )}

        {(view === 'wechat-bind' || view === 'wechat-login') && (
          <WechatAccountScan action={view === 'wechat-bind' ? 'bind' : 'login'} onComplete={finishWechat} />
        )}
        {view === 'manage' && account && (
          <div className="account-manage-layout">
            <div className="account-profile-card mb-6 flex items-center gap-4 rounded-2xl p-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black"><ShieldCheck className="h-5 w-5" /></span>
              <div className="min-w-0"><p className="truncate text-[15px] font-semibold text-white">{account.email || 'OpenMusic 账户'}</p><p className="mt-1 text-xs text-netease-muted">已绑定 {account.identities.length} 种登录方式</p></div>
            </div>
            <div className="account-manage-sections">
              <div className="account-section-card rounded-2xl p-3.5">
                <div className="account-section-heading mb-3 flex items-start justify-between gap-3">
                  <div><p className="text-sm font-medium text-white">音乐会员</p><p className="mt-1 text-xs text-netease-muted">新建房间时会自动使用已保存的会员账号</p></div>
                  {accountDataLoading && <Loader2 className="h-4 w-4 animate-spin text-white/45" />}
                </div>
                <div className="space-y-2">
                  {(Object.keys(musicPlatformLabels) as Array<keyof RoomMusicAccounts>).map((platform) => {
                    const musicAccount = musicAccounts[platform];
                    if (!musicAccount) return null;
                    return (
                       <div key={platform} className="account-row flex items-center gap-3 rounded-xl px-3 py-2.5">
                        <span className="min-w-0 flex-1"><span className="block text-sm text-white">{musicPlatformLabels[platform]}</span><span className="block truncate text-xs text-netease-muted">{musicAccount.nickname || '已登录'} · {musicAccount.hasSvip ? 'SVIP' : musicAccount.hasVip ? 'VIP' : '漫游'}</span></span>
                        <button type="button" role="switch" aria-checked={musicAccount.shared} disabled={submitting || !musicAccount.hasVip} onClick={() => void toggleAccountMusic(platform, !musicAccount.shared)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${musicAccount.shared ? 'bg-emerald-500' : 'bg-white/20'}`}><span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${musicAccount.shared ? 'translate-x-5' : ''}`} /></button>
                        <button type="button" disabled={submitting} onClick={() => void removeAccountMusic(platform)} className="rounded-lg p-1.5 text-white/35 transition hover:bg-red-400/10 hover:text-red-300 disabled:opacity-40" aria-label={`删除${musicPlatformLabels[platform]}会员信息`}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    );
                  })}
                  {!accountDataLoading && !Object.values(musicAccounts).some(Boolean) && <p className="py-2 text-xs text-white/40">还没有保存音乐会员账号</p>}
                </div>
              </div>
               <div className="account-section-card rounded-2xl p-3.5">
                <div className="account-section-heading mb-3 flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-white">我的房间</p>
                  <p className="mt-1 text-xs text-netease-muted">管理已创建的房间</p>
                </div>
                <div className="space-y-2">
                  {accountRooms.length > 0 ? accountRooms.map((room) => <Link key={room.id} to={`/room/${room.id}`} onClick={() => setPanelOpen(false)} className="account-row flex items-center justify-between rounded-xl px-3 py-2.5 transition"><span className="min-w-0"><span className="block truncate text-sm text-white">{room.name}</span><span className="mt-0.5 block text-xs text-white/40">{room.id} · {room.userCount} 人在线</span></span><ChevronRight className="h-4 w-4 text-white/35" /></Link>) : <p className="py-2 text-xs text-white/40">还没有创建房间</p>}
                </div>
              </div>
              {account.hasPassword && (
                <div className="account-section-card flex items-center gap-3 rounded-2xl p-3.5"><span className="account-provider-icon flex h-9 w-9 items-center justify-center rounded-xl"><Mail className="h-4 w-4" /></span><span className="flex-1"><span className="block text-sm font-medium text-white">邮箱与密码</span><span className="block truncate text-xs text-netease-muted">{account.email}</span></span><span className="text-xs text-emerald-300/80">已启用</span></div>
              )}
              {(['wechat', 'linuxdo', 'github'] as const).map((provider) => {
                const identity = identityMap.get(provider);
                const enabled = providers[provider];
                if (!identity && !enabled) return null;
                return (
                  <div key={provider} className="account-section-card flex items-center gap-3 rounded-2xl p-3.5">
                    <span className="account-provider-icon flex h-9 w-9 items-center justify-center rounded-xl"><ProviderIcon provider={provider} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white">{providerMeta[provider].label}</span><span className="block truncate text-xs text-netease-muted">{identity?.username || (identity ? '已绑定' : '尚未绑定')}</span></span>
                    {identity ? (
                      <button type="button" disabled={submitting} onClick={() => void unbind(provider)} className="rounded-full p-2 text-white/28 transition hover:bg-red-400/10 hover:text-red-300 disabled:opacity-40" aria-label={`解绑 ${providerMeta[provider].label}`}><Unlink className="h-4 w-4" /></button>
                    ) : provider === 'wechat' ? (
                      <button type="button" onClick={() => setView(`${provider}-bind`)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65 transition hover:bg-white/[0.07] hover:text-white">绑定</button>
                    ) : (
                      <button type="button" onClick={() => void startAccountOAuth(provider, 'bind').catch(error => setError(error.message))} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65 transition hover:bg-white/[0.07] hover:text-white">绑定</button>
                    )}
                  </div>
                );
              })}
            </div>
            {error && <p className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">{error}</p>}
            <button type="button" disabled={submitting} onClick={() => void logout()} className="account-logout-button mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm transition"><LogOut className="h-4 w-4" />退出账户</button>
          </div>
        )}
        {error && error !== '本机设备密钥已变化，请重新登录' && (view === 'welcome' || view === 'methods') && (
          <p role="alert" className="account-status-note mt-4 text-center text-[11px] leading-5">{error}</p>
        )}
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
