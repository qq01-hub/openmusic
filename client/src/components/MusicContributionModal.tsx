import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Crown, Gem, HeartHandshake, KeyRound, QrCode, X } from 'lucide-react';
import {
  checkContributionQr,
  bindContributionAccount,
  createContributionQr,
  fetchSharedContributions,
  revokeContribution,
  type SharedContribution,
} from '../api/musicContribution';
import {
  normalizeQrImage,
  normalizeQrStatus,
  textValue,
  unwrapQrPayload,
  type MusicAccountPlatform,
  type MusicAccountQrSession,
} from '../lib/musicAccountQr';
import Tooltip from './Tooltip';
import MusicLoading from './MusicLoading';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultProvider?: string;
  enabledPlatforms?: MusicAccountPlatform[];
}

const PLATFORM_META: Record<MusicAccountPlatform, { label: string; instruction: string; waiting: string }> = {
  netease: { label: '网易云', instruction: '使用网易云音乐 App 扫码', waiting: '等待网易云音乐 App 扫码…' },
  tencent: { label: 'QQ 音乐', instruction: '使用 QQ 音乐 App 扫码', waiting: '等待 QQ 音乐 App 扫码…' },
  kugou: { label: '酷狗音乐', instruction: '使用酷狗音乐 App 扫码确认登录', waiting: '等待酷狗音乐 App 扫码…' },
  qishui: { label: '汽水音乐', instruction: '使用已登录的汽水音乐 App 扫码确认登录', waiting: '等待汽水音乐 App 扫码…' },
};

export default function MusicContributionModal({ open, onClose, defaultProvider = '', enabledPlatforms }: Props) {
  const platforms = useMemo(
    () => (Object.keys(PLATFORM_META) as MusicAccountPlatform[]).filter((item) => !enabledPlatforms || enabledPlatforms.includes(item)),
    [enabledPlatforms],
  );
  const [platform, setPlatform] = useState<MusicAccountPlatform>('netease');
  const [session, setSession] = useState<MusicAccountQrSession | null>(null);
  const [statusText, setStatusText] = useState('');
  const [secondVerifyUrl, setSecondVerifyUrl] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [providerName, setProviderName] = useState(defaultProvider.trim().slice(0, 40));
  const [contributions, setContributions] = useState<SharedContribution[]>([]);
  const [revokeToken, setRevokeToken] = useState(() => {
    try { return localStorage.getItem('openmusic:contribution-revoke-id') || ''; } catch { return ''; }
  });
  const [revokeInput, setRevokeInput] = useState(() => {
    try { return localStorage.getItem('openmusic:contribution-revoke-id') || ''; } catch { return ''; }
  });
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const providerRef = useRef(providerName);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef(0);
  const secondVerifySubmittedRef = useRef(false);
  const secondVerifyFrameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    providerRef.current = providerName;
  }, [providerName]);

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

  const loadContributions = useCallback(async () => {
    try {
      const result = await fetchSharedContributions();
      if (result.success && Array.isArray(result.data)) setContributions(result.data);
    } catch {
      // 共享列表失败不影响扫码绑定
    }
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const cancelRun = useCallback(() => {
    runIdRef.current += 1;
    stopPoll();
    setSecondVerifyUrl('');
    secondVerifySubmittedRef.current = false;
  }, [stopPoll]);

  const startQr = useCallback(async (nextPlatform: MusicAccountPlatform) => {
    cancelRun();
    const runId = runIdRef.current;
    setPlatform(nextPlatform);
    setSession({ platform: nextPlatform });
    secondVerifySubmittedRef.current = false;
    setBusy(true);
    setError('');
    setSuccess('');
    setStatusText('正在准备二维码…');
    try {
      const created = await createContributionQr(nextPlatform);
      if (runId !== runIdRef.current) return;
      if (!created.success || !created.data) {
        setError(created.error || '二维码生成失败，请稍后再试');
        setSession(null);
        setStatusText('');
        return;
      }
      const raw = unwrapQrPayload(created.data);
      const next: MusicAccountQrSession = {
        platform: nextPlatform,
        sessionId: textValue(raw.sessionId),
        qrimg: normalizeQrImage(raw.qrimg || raw.qrImage || raw.image || raw.base64),
      };
      if (!next.sessionId) {
        setError('二维码会话无效，请重新打开再试');
        setSession(null);
        setStatusText('');
        return;
      }
      setSession(next);
      setStatusText(PLATFORM_META[nextPlatform].waiting);

      let phase: 'waiting' | 'scanned' | 'done' = 'waiting';
      let checking = false;
      const payload = { sessionId: next.sessionId };

      const check = async () => {
        let result;
        try {
          result = await checkContributionQr(payload);
        } catch (cause) {
          if (runId !== runIdRef.current || !open) return;
          setError(cause instanceof Error ? cause.message : '扫码状态查询失败，请重试');
          setStatusText('');
          stopPoll();
          phase = 'done';
          setBusy(false);
          return;
        }
        if (runId !== runIdRef.current || !open) return;
        if (!result.success || !result.data) {
          setError(result.error || '扫码状态查询失败，请重试');
          stopPoll();
          phase = 'done';
          setBusy(false);
          return;
        }
        const checked = unwrapQrPayload(result.data);
        const state = normalizeQrStatus(checked.status ?? checked.code ?? checked.state);
        if (state === 'expired') {
          setStatusText('二维码已过期，请切换平台或重新打开');
          stopPoll();
          phase = 'done';
          setBusy(false);
          return;
        }
        if (state === 'scanned') {
          phase = 'scanned';
          setStatusText(nextPlatform === 'tencent' ? '已扫码，请在 QQ 音乐 App 上确认' : nextPlatform === 'qishui' ? '已扫码，请在汽水音乐 App 上确认（5 秒后再次检查）' : '已扫码，请在手机上确认');
          return;
        }
        if (state === 'second_verify') {
          phase = 'scanned';
          setStatusText(secondVerifySubmittedRef.current ? '汽水验证中，请稍候…' : '请在当前浏览器窗口完成汽水安全验证');
          setSecondVerifyUrl(
            `/api/music-account-contribution/qr/verify/security_host.html?key=${encodeURIComponent(next.sessionId || '')}&bridgeRoot=${encodeURIComponent('/api/music-account-contribution/qr/verify')}`,
          );
          return;
        }
        if (state === 'error') {
          setError(textValue(checked.message || checked.msg) || '扫码失败，请重新生成二维码');
          setStatusText('');
          stopPoll();
          phase = 'done';
          setBusy(false);
          return;
        }
        if (state === 'confirmed') {
          phase = 'done';
          stopPoll();
          setBusy(true);
          setStatusText('正在验证会员权益…');
          try {
            const name = providerRef.current.trim();
            if (!name) {
              setError('请先填写共享署名，再重新生成二维码');
              setStatusText('');
              return;
            }
            const bound = await bindContributionAccount(next.sessionId || '', name);
            if (runId !== runIdRef.current || !open) return;
            if (!bound.success) {
              setError(bound.error || '这份账号暂时不能共享，请换一个会员账号试试');
              setStatusText('');
              return;
            }
            setSuccess(bound.message || '共享成功！谢谢你帮大家点亮更多好歌 ♪');
            const token = textValue(bound.revokeToken || (bound.data as Record<string, unknown> | undefined)?.revokeToken);
            if (token) {
              setRevokeToken(token);
              setRevokeInput(token);
              try { localStorage.setItem('openmusic:contribution-revoke-id', token); } catch { /* ignore */ }
            }
            setStatusText('');
            setSession(null);
            void loadContributions();
          } catch (cause) {
            if (runId === runIdRef.current && open) {
              setError(cause instanceof Error ? cause.message : '会员权益验证失败，请重新扫码');
              setStatusText('');
            }
          } finally {
            if (runId === runIdRef.current) setBusy(false);
          }
          return;
        }
        if (phase === 'waiting') setStatusText(PLATFORM_META[nextPlatform].waiting);
        if (phase === 'scanned') {
          setStatusText(nextPlatform === 'tencent' ? '已扫码，请在 QQ 音乐 App 上确认' : nextPlatform === 'qishui' ? '已扫码，请在汽水音乐 App 上确认（5 秒后再次检查）' : '已扫码，请在手机上确认');
        }
      };

      checking = true;
      void check().finally(() => { checking = false; });
      pollRef.current = setInterval(() => {
        if (checking || phase === 'done') return;
        checking = true;
        void check().finally(() => { checking = false; });
      }, nextPlatform === 'qishui' ? 5000 : 2000);
    } catch (cause) {
      if (runId === runIdRef.current) {
        setError(cause instanceof Error ? cause.message : '二维码生成失败，请稍后再试');
        setSession(null);
        setStatusText('');
      }
    } finally {
      if (runId === runIdRef.current) setBusy(false);
    }
  }, [cancelRun, loadContributions, open, stopPoll]);

  useEffect(() => {
    if (!open) {
      cancelRun();
      setSession(null);
      setError('');
      setSuccess('');
      setStatusText('');
      setSecondVerifyUrl('');
      setRevokeOpen(false);
      setProviderName(defaultProvider.trim().slice(0, 40));
      return;
    }
    setProviderName(defaultProvider.trim().slice(0, 40));
    void loadContributions();
    if (platforms.length > 0) void startQr(platforms[0]);
    return cancelRun;
  }, [cancelRun, defaultProvider, loadContributions, open, platforms, startQr]);

  useEffect(() => {
    if (!open || platforms.length === 0 || platforms.includes(platform)) return;
    cancelRun();
    setPlatform(platforms[0]);
  }, [cancelRun, open, platform, platforms]);

  if (!open || platforms.length === 0) return null;
  const qrDisplay = session?.qrimg || '';

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center p-4 sm:items-center">
      <button type="button" className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} aria-label="关闭" />
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-white/10 bg-[#101012]/95 p-5 shadow-2xl animate-fade-in sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-rose-200">
              <HeartHandshake className="h-5 w-5" />
              <h2 className="text-lg font-semibold text-white">共享会员</h2>
            </div>
            <p className="mt-2 max-w-[31ch] text-sm leading-relaxed text-white/55">
              仅用于音乐服务，全程加密保护
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setRevokeOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-white/50 hover:bg-white/10 hover:text-white">
              <KeyRound className="h-3.5 w-3.5" />取消共享
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-white/45 hover:bg-white/10 hover:text-white" aria-label="关闭">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <label className="mt-4 block text-xs text-white/65">
          给这份心意留个名字
          <input
            value={providerName}
            onChange={(event) => setProviderName(event.target.value.slice(0, 40))}
            maxLength={40}
            placeholder="取个名字，让大家记住你的这份心意～"
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-rose-300/40"
          />
        </label>

        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-white/75">共享用户</p>
            <span className="text-[10px] text-white/35">感谢每一位分享者</span>
          </div>
          {contributions.length > 0 ? (
            <div className="mt-2 grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
              {contributions.map((item, index) => {
                const isSvip = item.tier === 'svip';
                const platformLabel = item.platform === 'tencent' ? 'QQ' : item.platform === 'kugou' ? '酷狗' : item.platform === 'qishui' ? '汽水' : '网易';
                return (
                  <Tooltip
                    key={`${item.platform}-${item.providerName}-${item.updatedAt}-${index}`}
                    content={`${item.providerName} · ${platformLabel} · ${isSvip ? 'SVIP' : 'VIP'} 共享`}
                    side="top"
                    delay={180}
                    tapToShow
                  >
                    <button
                      type="button"
                      className={`shared-contributor shared-contributor--${item.tier}`}
                      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                      aria-label={`查看${item.providerName}的共享信息`}
                    >
                      <span className="shared-contributor__emblem" aria-hidden="true">
                        {isSvip ? <Crown className="h-3 w-3" /> : <Gem className="h-3 w-3" />}
                      </span>
                      <span className="shared-contributor__name">
                        {item.providerName}
                      </span>
                      <span className="shared-contributor__platform">· {platformLabel}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-white/35">还没有共享记录，等你来点亮第一份会员能力 ♪</p>
          )}
        </div>

        <div className="mt-5 grid gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1" style={{ gridTemplateColumns: `repeat(${platforms.length}, minmax(0, 1fr))` }} role="tablist" aria-label="选择音乐平台">
          {platforms.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={platform === item}
              disabled={busy}
              title={undefined}
              onClick={() => void startQr(item)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${platform === item ? 'bg-white/10 text-white' : 'text-white/45 hover:bg-white/[0.05] hover:text-white/80'}`}
            >
              {PLATFORM_META[item].label}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 px-4 py-5 text-center">
          {success ? (
            <div className="py-8">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" />
              <p className="mt-4 text-sm font-medium text-white">{success}</p>
              <button type="button" onClick={onClose} className="mt-5 rounded-xl bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15">完成</button>
            </div>
          ) : (
            <>
              {qrDisplay ? <img src={qrDisplay} alt="登录二维码" className="mx-auto h-48 w-48 rounded-xl bg-white p-2" /> : <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-xl bg-white/5"><MusicLoading label="正在准备登录二维码" compact className="bg-transparent" /></div>}
              <p className="mt-3 text-sm font-medium text-white/90">{PLATFORM_META[platform].instruction}</p>
              <p className="mt-1 text-xs text-white/45">{statusText || '等待扫码…'}</p>
              {error && <p className="mt-3 text-xs leading-relaxed text-rose-300">{error}</p>}
              <button type="button" disabled={busy} onClick={() => void startQr(platform)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-40">
                <QrCode className="h-3.5 w-3.5" /> 重新生成二维码
              </button>
            </>
          )}
        </div>
      </div>
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
      {revokeOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setRevokeOpen(false)} aria-label="关闭取消共享弹框" />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#17171b] p-5 shadow-2xl animate-fade-in">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-white">取消共享</h3>
                <p className="mt-1 text-xs leading-5 text-white/45">浏览器有缓存时会自动填入撤销 ID，无需重复输入。</p>
              </div>
              <button type="button" onClick={() => setRevokeOpen(false)} className="rounded-full p-1.5 text-white/45 hover:bg-white/10 hover:text-white" aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            {revokeToken ? <p className="mt-3 break-all rounded-lg bg-black/20 px-2.5 py-2 font-mono text-[11px] text-amber-200">当前撤销 ID：{revokeToken}</p> : null}
            <input value={revokeInput} onChange={(event) => setRevokeInput(event.target.value.slice(0, 64))} placeholder="输入撤销 ID（有缓存会自动填入）" className="mt-3 w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2.5 text-xs text-white outline-none placeholder:text-white/25" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRevokeOpen(false)} className="rounded-lg px-3 py-2 text-xs text-white/55 hover:bg-white/10 hover:text-white">返回</button>
              <button type="button" disabled={revokeBusy || !(revokeInput.trim() || revokeToken)} onClick={async () => {
                const token = revokeInput.trim() || revokeToken;
                setRevokeBusy(true);
                const result = await revokeContribution(token).catch(() => ({ success: false, error: '取消共享失败，请稍后再试', message: '' }));
                setRevokeBusy(false);
                if (result.success) {
                  setRevokeInput('');
                  if (token === revokeToken) { setRevokeToken(''); try { localStorage.removeItem('openmusic:contribution-revoke-id'); } catch { /* ignore */ } }
                  setRevokeOpen(false);
                  setSuccess(result.message || '共享已取消');
                  void loadContributions();
                } else setError(result.error || '取消共享失败');
              }} className="rounded-lg bg-rose-400/15 px-3 py-2 text-xs text-rose-100 hover:bg-rose-400/25 disabled:opacity-40">确认取消</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
