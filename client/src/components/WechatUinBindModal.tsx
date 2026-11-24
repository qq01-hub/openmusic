import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import Modal from './Modal';
import MusicLoading from './MusicLoading';
import {
  bindWechatUin,
  recoverWechatUin,
} from '../lib/wechatUinAuth';
import {
  bootstrapWechatFileHelperSession,
  buildWechatLoginQrImageUrl,
  clearWechatFileHelperSession,
  fetchWechatLoginUuid,
  pollWechatLogin,
} from '../lib/wechatFileHelperBridge';
import { isHostPageHidden, subscribeHostVisibility } from '../hooks/useVisualRenderPolicy';

type Mode = 'bind' | 'recover';

interface Props {
  open: boolean;
  mode: Mode;
  roomId?: string;
  onClose: () => void;
  onCompleted: () => void;
}

export default function WechatUinBindModal({ open, mode, roomId, onClose, onCompleted }: Props) {
  const uuidRef = useRef<string | null>(null);
  const scannedRef = useRef(false);
  const busyRef = useRef(false);
  const completedRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const refreshRef = useRef(0);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('正在获取登录二维码…');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    clearWechatFileHelperSession();
    uuidRef.current = null;
    scannedRef.current = false;
    busyRef.current = false;
    completedRef.current = false;
    refreshRef.current = 0;
    setQrUrl(null);
    setStatus('正在获取登录二维码…');
    setDone(false);
    setError('');

    const refreshQr = async () => {
      const token = refreshRef.current + 1;
      refreshRef.current = token;
      scannedRef.current = false;
      const uuid = await fetchWechatLoginUuid();
      if (cancelled || refreshRef.current !== token) return;
      uuidRef.current = uuid;
      setQrUrl(buildWechatLoginQrImageUrl(uuid));
      setStatus('请用微信扫一扫登录');
    };

    let pollTimer: number | null = null;
    const stopPoll = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const runPoll = async () => {
      if (busyRef.current || completedRef.current || cancelled || !uuidRef.current || isHostPageHidden()) return;
      busyRef.current = true;
      const uuid = uuidRef.current;
      try {
        const result = await pollWechatLogin(uuid, scannedRef.current ? 1 : 0);
        if (cancelled || uuidRef.current !== uuid) return;
        if (result === 'expired') {
          await refreshQr();
          if (!cancelled) setStatus('二维码已过期，已自动刷新');
          return;
        }
        if (result === 'scanned') {
          scannedRef.current = true;
          setStatus('扫码成功，请在手机上确认登录');
          return;
        }
        if (typeof result === 'object' && result.ok) {
          uuidRef.current = null;
          setQrUrl(null);
          setStatus('登录中，正在读取微信身份…');
          await bootstrapWechatFileHelperSession(null, result.redirectUri);
          const bindResult = mode === 'bind'
            ? await bindWechatUin(roomId || '')
            : await recoverWechatUin(roomId || '');
          if (!bindResult.success) throw new Error(bindResult.error || '微信绑定失败');
          if (cancelled) return;
          completedRef.current = true;
          stopPoll();
          clearWechatFileHelperSession();
          setDone(true);
          setStatus(mode === 'bind' ? '绑定完毕' : '身份找回成功');
          onCompletedRef.current();
        }
      } catch (err) {
        if (cancelled) return;
        uuidRef.current = null;
        completedRef.current = true;
        stopPoll();
        setQrUrl(null);
        setError(err instanceof Error ? err.message : '微信绑定失败');
        setStatus('操作失败，请重试');
      } finally {
        busyRef.current = false;
      }
    };

    pollTimer = window.setInterval(() => {
      void runPoll();
    }, 2000);
    const unsubscribeVisibility = subscribeHostVisibility(() => {
      if (!isHostPageHidden()) void runPoll();
    });

    void refreshQr().catch(() => {
      if (!cancelled) {
        setError('获取二维码失败，请关闭后重试');
        setStatus('获取二维码失败，请重试');
      }
    });

    return () => {
      cancelled = true;
      stopPoll();
      unsubscribeVisibility();
      clearWechatFileHelperSession();
    };
  }, [open, mode, roomId, retryKey]);

  return (
    <Modal open={open} zIndex={100} closeOnMaskClick={false} panelClassName="relative w-full max-w-[520px] animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-6 shadow-2xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{mode === 'bind' ? '微信身份绑定' : '微信身份找回'}</h3>
          <p className="mt-1 text-xs leading-relaxed text-netease-muted">
            {mode === 'bind' ? '扫码登录文件传输助手，读取微信 UIN 绑定当前房间房主身份。' : '扫码登录文件传输助手，使用已绑定的微信身份找回房主。'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-netease-muted hover:bg-white/10 hover:text-white" aria-label="关闭">
          <X className="h-4 w-4" />
        </button>
      </div>
      {done ? (
        <div className="flex flex-col items-center py-8 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-emerald-400" />
          <p className="text-sm font-medium text-white">{mode === 'bind' ? '绑定完毕' : '身份找回成功'}</p>
          <p className="mt-3 text-xs leading-relaxed text-amber-200">请在微信手机版顶部退出「文件传输助手」，避免留下网页微信登录会话。</p>
          <button type="button" onClick={onClose} className="mt-5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400">完成</button>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <div className="flex h-[280px] w-[280px] items-center justify-center rounded-xl bg-white p-3">
            {qrUrl ? <img src={qrUrl} alt="微信登录二维码" className="h-full w-full object-contain" /> : error ? <p className="px-6 text-center text-xs text-red-500">二维码加载失败</p> : <MusicLoading label="正在准备微信二维码" compact className="bg-transparent" />}
          </div>
          <p className="mt-4 text-sm text-white">{status}</p>
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          {error && !done && <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15">重新获取二维码</button>}
        </div>
      )}
    </Modal>
  );
}
