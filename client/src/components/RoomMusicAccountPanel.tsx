import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, QrCode, Trash2 } from 'lucide-react';
import MusicLoading from './MusicLoading';
import type { RoomMusicAccount, RoomMusicAccounts } from '../types';
import {
  normalizeQrImage,
  normalizeQrStatus,
  textValue,
  unwrapQrPayload,
  type MusicAccountQrSession,
} from '../lib/musicAccountQr';

type Platform = 'netease' | 'tencent' | 'kugou' | 'qishui';

interface Props {
  accounts: RoomMusicAccounts;
  sharedMembershipEnabled?: boolean;
  enabledPlatforms?: Platform[];
  onCreateQr: (platform: Platform) => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>;
  onCheckQr: (payload: Record<string, unknown>) => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>;
  onBind: (payload: {
    sessionId: string;
    shared?: boolean;
  }) => Promise<{ success: boolean; error?: string; message?: string }>;
  onRefresh: () => Promise<{ success: boolean; error?: string; data?: RoomMusicAccounts }>;
  onSetShared: (platform: Platform, shared: boolean) => Promise<{ success: boolean; error?: string }>;
  onUnbind: (platform: Platform) => Promise<{ success: boolean; error?: string }>;
}

function getShareBannerText(accounts: RoomMusicAccounts): string {
  const vipAccounts = [accounts.netease, accounts.tencent, accounts.kugou, accounts.qishui].filter((a) => a?.hasVip);
  const hasShared = vipAccounts.some((a) => a?.shared);

  if (hasShared) {
    return '感谢你的共享！大家都能用到～你是最棒的 ♪';
  }
  if (vipAccounts.length > 0) {
    return '愿意把会员能力借给大家吗～一份共享，就能点亮更多喜欢的歌 ♪';
  }
  return '把会员能力借给大家吧～一起点亮更多好歌 ♪';
}

function getSearchAbilityText(account: RoomMusicAccount): string {
  if (account.canSearchSongs && account.canSearchPlaylists) return '歌曲、歌单搜索可用';
  if (account.canSearchSongs) return '歌曲搜索可用';
  if (account.canSearchPlaylists) return '歌单搜索可用';
  return '搜索能力暂不可用';
}

const SECURITY_NOTE = '账号加密保管，仅用于取歌，不会泄露给他人';

const PLATFORM_META: Record<Platform, { label: string; qrInstruction: string; waitingText: string }> = {
  netease: {
    label: '网易云',
    qrInstruction: '使用网易云音乐 App 扫码',
    waitingText: '等待网易云音乐 App 扫码…',
  },
  tencent: {
    label: 'QQ 音乐',
    qrInstruction: '使用 QQ 音乐 App 扫码',
    waitingText: '等待 QQ 音乐 App 扫码…',
  },
  kugou: {
    label: '酷狗音乐',
    qrInstruction: '使用酷狗音乐 App 扫码确认登录',
    waitingText: '等待酷狗音乐 App 扫码…',
  },
  qishui: {
    label: '汽水音乐',
    qrInstruction: '使用已登录的汽水音乐 App 扫码确认登录',
    waitingText: '等待汽水音乐 App 扫码…',
  },
};

function ShareSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div>
        <p className="text-sm text-white">{checked ? '共享' : '不共享'}</p>
        <p className="mt-0.5 text-[11px] text-netease-muted">
          {checked ? '全站可用' : '仅房间可用'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-netease-red' : 'bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function QrBlock({
  qrDisplay,
  instruction,
  statusText,
  onCancel,
}: {
  qrDisplay: string;
  instruction: string;
  statusText: string;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-4 text-center">
      {qrDisplay ? (
        <img
          src={qrDisplay}
          alt="登录二维码"
          className="mx-auto h-40 w-40 rounded-lg bg-white p-2"
        />
      ) : (
        <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-lg bg-white/5">
          <MusicLoading label="正在准备音乐账户二维码" compact className="bg-transparent" />
        </div>
      )}
      <p className="mt-2.5 text-xs font-medium text-white/90">{instruction}</p>
      <p className="mt-1 text-[11px] text-netease-muted">{statusText || '等待扫码…'}</p>
      <button
        type="button"
        className="mt-1.5 text-[11px] text-netease-muted underline"
        onClick={onCancel}
      >
        取消
      </button>
    </div>
  );
}

function PlatformCard({
  label,
  account,
  sharedMembershipEnabled,
  busy,
  wantShared,
  onWantSharedChange,
  onStartQr,
  onToggleShared,
  onUnbind,
  scanning,
  qrDisplay,
  qrInstruction,
  statusText,
  onCancelQr,
  error,
  hint,
}: {
  label: string;
  account: RoomMusicAccount | null;
  sharedMembershipEnabled: boolean;
  busy: boolean;
  wantShared: boolean;
  onWantSharedChange: (v: boolean) => void;
  onStartQr: () => void;
  onToggleShared: (shared: boolean) => void;
  onUnbind: () => void;
  scanning: boolean;
  qrDisplay: string;
  qrInstruction: string;
  statusText: string;
  onCancelQr: () => void;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-white">{label}</h4>
        {account ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              account.hasVip
                ? account.shared
                  ? 'bg-emerald-400/15 text-emerald-300'
                  : 'bg-sky-400/15 text-sky-300'
                : 'bg-amber-400/15 text-amber-300'
            }`}
          >
            {account.hasSvip ? '支持 SVIP' : account.hasVip ? '支持 VIP' : '仅漫游'}
          </span>
        ) : (
          <span className="text-[10px] text-netease-muted">未绑定</span>
        )}
      </div>

      {scanning ? (
        <QrBlock
          qrDisplay={qrDisplay}
          instruction={qrInstruction}
          statusText={statusText}
          onCancel={onCancelQr}
        />
      ) : account ? (
        <>
          <div className="flex items-center gap-3">
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xs text-white/50">
                {label.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white">{account.nickname || '已登录'}</p>
              {account.shared && account.providerName && (
                <p className="truncate text-[11px] text-white/45">共享署名：{account.providerName}</p>
              )}
              {account.isValid === false && (
                <p className="text-[11px] text-amber-300/90">可能已失效</p>
              )}
              {account.isValid !== false && (
                <p className={`text-[11px] ${account.canSearchSongs || account.canSearchPlaylists ? 'text-white/45' : 'text-amber-300/90'}`}>
                  {getSearchAbilityText(account)}
                </p>
              )}
            </div>
          </div>

          {sharedMembershipEnabled && account.hasVip ? (
            <ShareSwitch
              checked={account.shared}
              disabled={busy}
              onChange={onToggleShared}
            />
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onStartQr}
              className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] py-2 text-xs text-white/80 hover:bg-white/[0.07] disabled:opacity-50"
            >
              重新扫码
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onUnbind}
              className="inline-flex items-center gap-1 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300 hover:bg-red-400/15 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              解绑
            </button>
          </div>
        </>
      ) : (
        <>
          {sharedMembershipEnabled && (
            <ShareSwitch
              checked={wantShared}
              disabled={busy}
              onChange={onWantSharedChange}
            />
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onStartQr}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-netease-red py-2.5 text-sm font-medium text-white hover:bg-netease-red/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
            扫码登录
          </button>
        </>
      )}

      {error && <p className="text-xs text-red-300">{error}</p>}
      {hint && !error && <p className="text-xs text-amber-300/90">{hint}</p>}
    </div>
  );
}

export default function RoomMusicAccountPanel({
  accounts,
  sharedMembershipEnabled = true,
  onCreateQr,
  onCheckQr,
  onBind,
  onRefresh,
  onSetShared,
  onUnbind,
  enabledPlatforms,
}: Props) {
  const platforms = useMemo(
    () => (Object.keys(PLATFORM_META) as Platform[]).filter((platform) => !enabledPlatforms || enabledPlatforms.includes(platform)),
    [enabledPlatforms],
  );
  const [activePlatform, setActivePlatform] = useState<Platform>('netease');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorPlatform, setErrorPlatform] = useState<Platform | null>(null);
  const [hint, setHint] = useState('');
  const [hintPlatform, setHintPlatform] = useState<Platform | null>(null);
  const [statusText, setStatusText] = useState('');
  const [secondVerifyUrl, setSecondVerifyUrl] = useState('');
  const [session, setSession] = useState<MusicAccountQrSession | null>(null);
  const [wantShared, setWantShared] = useState<Record<Platform, boolean>>({
    netease: false,
    tencent: false,
    kugou: false,
    qishui: false,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bindingRef = useRef(false);
  const runIdRef = useRef(0);
  const secondVerifySubmittedRef = useRef(false);
  const secondVerifyFrameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!sharedMembershipEnabled) {
      setWantShared({ netease: false, tencent: false, kugou: false, qishui: false });
    }
  }, [sharedMembershipEnabled]);


  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const cancelQr = useCallback(() => {
    runIdRef.current += 1;
    stopPoll();
    setSession(null);
    setStatusText('');
    setSecondVerifyUrl('');
    setError('');
    setErrorPlatform(null);
    setHint('');
    setHintPlatform(null);
  }, [stopPoll]);

  useEffect(() => {
    if (platforms.length > 0 && !platforms.includes(activePlatform)) {
      cancelQr();
      setActivePlatform(platforms[0]);
    }
  }, [activePlatform, cancelQr, platforms]);

  useEffect(() => {
    void onRefresh();
    return () => stopPoll();
  }, [onRefresh, stopPoll]);

  useEffect(() => {
    const handleVerifyMessage = (event: MessageEvent) => {
      if (event.source !== secondVerifyFrameRef.current?.contentWindow) return;
      if (event.data?.type !== 'qishui-second-verify-complete') return;
      if (textValue(event.data.key) !== textValue(session?.sessionId)) return;
      secondVerifySubmittedRef.current = true;
      setSecondVerifyUrl('');
      setSession((current) => current ? { ...current, qrimg: '' } : current);
      setStatusText('汽水验证中，请稍候…');
    };
    window.addEventListener('message', handleVerifyMessage);
    return () => window.removeEventListener('message', handleVerifyMessage);
  }, [session?.sessionId]);

  const finishBind = useCallback(
    async (platform: Platform, sessionId: string) => {
      if (bindingRef.current) return;
      bindingRef.current = true;
      setBusy(true);
      setStatusText('绑定中…');
      try {
        const res = await onBind({
          sessionId,
          shared: wantShared[platform],
        });
        if (!res.success) {
          setError(res.error || '绑定失败');
          setErrorPlatform(platform);
          setHint('');
          setHintPlatform(null);
          secondVerifySubmittedRef.current = false;
          return;
        }
        setSession(null);
        setStatusText('');
        setError('');
        setErrorPlatform(null);
        setHint('');
        setHintPlatform(null);
        stopPoll();
      } finally {
        bindingRef.current = false;
        setBusy(false);
      }
    },
    [onBind, stopPoll, wantShared],
  );

  const startQr = useCallback(
    async (platform: Platform) => {
      stopPoll();
      const runId = ++runIdRef.current;
      setError('');
      setErrorPlatform(null);
      setStatusText('生成二维码…');
      setBusy(true);
      setSession({ platform });
      secondVerifySubmittedRef.current = false;
      bindingRef.current = false;
      try {
        const res = await onCreateQr(platform);
        if (runId !== runIdRef.current) return;
        if (!res.success || !res.data) {
          setError(res.error || '生成失败');
          setErrorPlatform(platform);
          setStatusText('');
          setSession(null);
          return;
        }
        const raw = unwrapQrPayload(res.data);
        const next: MusicAccountQrSession = {
          platform,
          sessionId: textValue(raw.sessionId),
          qrimg: normalizeQrImage(raw.qrimg || raw.qrImage || raw.image || raw.base64),
          message: textValue(raw.message || raw.msg) || undefined,
        };
        if (!next.sessionId) {
          setError('上游未返回扫码会话标识，请检查 Meting 版本和配置');
          setErrorPlatform(platform);
          setStatusText('');
          setSession(null);
          stopPoll();
          return;
        }
        setSession(next);
        setStatusText(PLATFORM_META[platform].waitingText);

        // 状态水位：waiting < scanned < confirmed，禁止回退到「等待扫码」
        let phase: 'waiting' | 'scanned' | 'done' = 'waiting';
        let checking = false;
        const checkPayload = { sessionId: next.sessionId };

        const doCheck = async (): Promise<'retry' | 'done'> => {
          const check = await onCheckQr(checkPayload);
          if (runId !== runIdRef.current) return 'done';
          if (!check.success || !check.data) {
            setError(textValue(check.error) || '查询扫码状态失败，请重试');
            setErrorPlatform(platform);
            setStatusText('');
            stopPoll();
            phase = 'done';
            setBusy(false);
            return 'done';
          }
          const rawCheck = unwrapQrPayload(check.data);
          const status = normalizeQrStatus(rawCheck.status ?? rawCheck.code ?? rawCheck.state);

          if (status === 'expired') {
            setStatusText('已过期，请重试');
            stopPoll();
            phase = 'done';
            setBusy(false);
            return 'done';
          }

          if (status === 'confirmed') {
            phase = 'done';
            setStatusText('授权成功，绑定中…');
            stopPoll();
            await finishBind(platform, next.sessionId || '');
            return 'done';
          }

          if (status === 'second_verify') {
            phase = 'scanned';
            setStatusText(secondVerifySubmittedRef.current ? '汽水验证中，请稍候…' : '请在当前浏览器窗口完成汽水安全验证');
            setSecondVerifyUrl(
              `/api/music-account-contribution/qr/verify/security_host.html?key=${encodeURIComponent(next.sessionId || '')}&bridgeRoot=${encodeURIComponent('/api/music-account-contribution/qr/verify')}`,
            );
            return 'retry';
          }

          if (status === 'scanned') {
            phase = 'scanned';
            setStatusText(platform === 'tencent' ? '已扫码，请在 QQ 音乐 App 上确认' : platform === 'qishui' ? '已扫码，请在汽水音乐 App 上确认（5 秒后再次检查）' : '已扫码，请在手机上确认');
            return 'retry';
          }

          if (status === 'error') {
            const msg = textValue(rawCheck.message || rawCheck.msg || check.error) || '扫码异常';
            setError(msg);
            setErrorPlatform(platform);
            setStatusText('');
            stopPoll();
            phase = 'done';
            setBusy(false);
            return 'done';
          }

          // waiting / 其它：已扫过就不要把文案打回「等待扫码」
          if (phase === 'waiting') {
            setStatusText(PLATFORM_META[platform].waitingText);
          } else if (phase === 'scanned') {
            setStatusText(platform === 'tencent' ? '已扫码，请在 QQ 音乐 App 上确认' : platform === 'qishui' ? '已扫码，请在汽水音乐 App 上确认（5 秒后再次检查）' : '已扫码，请在手机上确认');
          }
          return 'retry';
        };

        // 立刻查一次，不要干等首个 interval
        checking = true;
        void (async () => {
          try {
            await doCheck();
          } finally {
            checking = false;
          }
        })();

        pollRef.current = setInterval(() => {
          if (checking || phase === 'done') return;
          checking = true;
          void (async () => {
            try {
              await doCheck();
            } finally {
              checking = false;
            }
          })();
        }, platform === 'qishui' ? 5000 : 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : '生成失败');
        setErrorPlatform(platform);
        setStatusText('');
        setSession(null);
      } finally {
        setBusy(false);
      }
    },
    [finishBind, onCheckQr, onCreateQr, stopPoll],
  );

  const qrDisplay = session?.qrimg || '';

  const cardProps = (platform: Platform, label: string) => ({
    label,
    account: accounts[platform],
    sharedMembershipEnabled,
    busy,
    wantShared: wantShared[platform],
    onWantSharedChange: (v: boolean) => setWantShared((s) => ({ ...s, [platform]: v })),
    onStartQr: () => void startQr(platform),
    onToggleShared: (shared: boolean) => {
      setBusy(true);
      void onSetShared(platform, shared)
        .then((res) => {
          if (!res.success) {
            setError(res.error || (shared ? '加入共享失败' : '移出共享失败'));
            setErrorPlatform(platform);
          } else {
            setError('');
            setErrorPlatform(null);
          }
        })
        .finally(() => setBusy(false));
    },
    onUnbind: () => {
      setBusy(true);
      void onUnbind(platform)
        .then((res) => {
          if (!res.success) {
            setError(res.error || '解绑失败');
            setErrorPlatform(platform);
          } else {
            setError('');
            setErrorPlatform(null);
          }
        })
        .finally(() => setBusy(false));
    },
    scanning: session?.platform === platform,
    qrDisplay: session?.platform === platform ? qrDisplay : '',
    qrInstruction: PLATFORM_META[platform].qrInstruction,
    statusText: session?.platform === platform ? statusText : '',
    onCancelQr: cancelQr,
    error: errorPlatform === platform ? error : undefined,
    hint: hintPlatform === platform ? hint : undefined,
  });

  const shareBannerText = useMemo(() => getShareBannerText(accounts), [accounts]);
  const activeMeta = PLATFORM_META[activePlatform];

  if (platforms.length === 0) return null;

  const selectPlatform = (platform: Platform) => {
    if (platform === activePlatform) return;
    cancelQr();
    setActivePlatform(platform);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="shrink-0 text-sm font-medium text-white">音源账号</h3>
        <p className="text-right text-[11px] leading-relaxed text-netease-muted">
          {shareBannerText}
        </p>
      </div>
      <div
        role="tablist"
        aria-label="选择音乐平台"
        className="grid gap-1 rounded-lg border border-white/10 bg-black/20 p-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(platforms.length, 1)}, minmax(0, 1fr))` }}
      >
        {platforms.map((platform) => {
          const selected = activePlatform === platform;
          const account = accounts[platform];
          return (
            <button
              key={platform}
              type="button"
              role="tab"
              id={`music-account-tab-${platform}`}
              aria-selected={selected}
              aria-controls={`music-account-panel-${platform}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectPlatform(platform)}
              className={`flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                selected
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-netease-muted hover:bg-white/[0.05] hover:text-white/85'
              }`}
            >
              <span>{PLATFORM_META[platform].label}</span>
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${account ? 'bg-emerald-400' : 'bg-white/20'}`}
              />
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`music-account-panel-${activePlatform}`}
        aria-labelledby={`music-account-tab-${activePlatform}`}
      >
        <PlatformCard {...cardProps(activePlatform, activeMeta.label)} />
      </div>
      <p className="text-center text-[10px] leading-relaxed text-netease-muted/80">
        {SECURITY_NOTE}
      </p>
      {secondVerifyUrl ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
          <div className="flex h-[min(620px,90vh)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/15 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 text-sm font-medium text-black">
              <span>汽水安全验证</span>
              <button
                type="button"
                onClick={() => setSecondVerifyUrl('')}
                className="rounded px-2 py-1 text-black/55 hover:bg-black/5"
                aria-label="关闭验证窗口"
              >
                关闭
              </button>
            </div>
            <iframe
              ref={secondVerifyFrameRef}
              title="汽水安全验证"
              src={secondVerifyUrl}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
              className="min-h-0 flex-1 border-0"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
