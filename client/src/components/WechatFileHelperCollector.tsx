import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import Modal from './Modal';
import MusicLoading from './MusicLoading';
import {
  getStickerBlobUrl,
  subscribeUserStickers,
  type UserSticker,
} from '../lib/userStickerStore';
import {
  bootstrapWechatFileHelperSession,
  buildWechatLoginQrImageUrl,
  clearWechatFileHelperSession,
  describeWechatFileHelperSession,
  fetchWechatLoginUuid,
  hasWechatFileHelperSession,
  pollWechatLogin,
  startFileHelperScanner,
  WECHAT_UNSUPPORTED_STICKER_TIP,
} from '../lib/wechatFileHelperBridge';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function WechatFileHelperCollector({ open, onClose }: Props) {
  const uuidRef = useRef<string | null>(null);
  const scannedRef = useRef(false);
  const bootstrappingRef = useRef(false);
  const loggedInRef = useRef(false);
  const pollingRef = useRef(false);
  const refreshTokenRef = useRef(0);
  const sessionStartAtRef = useRef(0);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [status, setStatus] = useState('正在获取登录二维码…');
  const [total, setTotal] = useState(0);
  const [sessionPreviewStickers, setSessionPreviewStickers] = useState<UserSticker[]>([]);
  const [unsupportedCount, setUnsupportedCount] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const previewObjectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    loggedInRef.current = false;
    scannedRef.current = false;
    bootstrappingRef.current = false;
    uuidRef.current = null;
    pollingRef.current = false;
    refreshTokenRef.current = 0;
    sessionStartAtRef.current = Date.now();
    clearWechatFileHelperSession();
    setQrUrl(null);
    setLoggedIn(false);
    setStatus('正在获取登录二维码…');
    setTotal(0);
    setSessionPreviewStickers([]);
    setUnsupportedCount(0);
    setPreviewUrls({});
    previewObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewObjectUrlsRef.current = [];
    let lastPollLog = '';

    const pushDebug = (message: string) => {
      console.log('[wx-filehelper]', `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`);
    };

    const stopScanner = startFileHelperScanner(
      () => null,
      (result) => {
        if (result.imported > 0) {
          setTotal((n) => n + result.imported);
          setStatus(`刚刚保存了 ${result.imported} 个表情`);
          pushDebug(`scanner imported=${result.imported} skipped=${result.skipped}`);
        } else if (result.skipped > 0) {
          pushDebug(`scanner skipped=${result.skipped}`);
        }
        if (result.unsupported > 0) {
          setUnsupportedCount((n) => n + result.unsupported);
          pushDebug(`scanner unsupported=${result.unsupported}`);
        }
      },
    );

    const markLoggedIn = () => {
      if (loggedInRef.current) return;
      loggedInRef.current = true;
      setLoggedIn(true);
      setQrUrl(null);
      pushDebug(`markLoggedIn ${describeWechatFileHelperSession()}`);
      setStatus((prev) => (
        prev.startsWith('刚刚保存了') ? prev : '已登录，请从手机发表情给「文件传输助手」'
      ));
    };

    const refreshQr = async () => {
      const token = refreshTokenRef.current + 1;
      refreshTokenRef.current = token;
      scannedRef.current = false;
      bootstrappingRef.current = false;
      pushDebug(`refreshQr start token=${token}`);
      const uuid = await fetchWechatLoginUuid();
      if (cancelled || refreshTokenRef.current !== token) return uuid;
      uuidRef.current = uuid;
      setQrUrl(buildWechatLoginQrImageUrl(uuid));
      setStatus('请用微信扫一扫登录');
      pushDebug(`refreshQr ok uuid=${uuid}`);
      return uuid;
    };

    const sessionTimer = window.setInterval(() => {
      if (hasWechatFileHelperSession() && !loggedInRef.current) {
        markLoggedIn();
      }
    }, 800);

    const pollTimer = window.setInterval(() => {
      void (async () => {
        if (pollingRef.current) return;
        const uuid = uuidRef.current;
        if (!uuid || cancelled || loggedInRef.current || bootstrappingRef.current) return;
        pollingRef.current = true;

        try {
          const tip: 0 | 1 = scannedRef.current ? 1 : 0;
          pushDebug(`poll start uuid=${uuid} tip=${tip}`);
          const result = await pollWechatLogin(uuid, tip);
          if (cancelled || loggedInRef.current || uuidRef.current !== uuid) return;
          const pollLog = `poll result uuid=${uuid} result=${typeof result === 'string' ? result : `ok:${result.redirectUri}`}`;
          if (pollLog !== lastPollLog) {
            lastPollLog = pollLog;
            pushDebug(pollLog);
          }

          if (result === 'expired') {
            try {
              await refreshQr();
              if (cancelled) return;
              setStatus('二维码已过期，已自动刷新');
            } catch {
              if (cancelled) return;
              setStatus('二维码已过期，请关闭后重试');
            }
            return;
          }

          if (result === 'scanned') {
            scannedRef.current = true;
            setStatus('扫码成功，请在手机上确认登录');
            return;
          }

          if (typeof result === 'object' && result.ok) {
            bootstrappingRef.current = true;
            uuidRef.current = null;
            setQrUrl(null);
            setStatus('登录中，正在同步会话…');
            pushDebug(`bootstrap start redirect=${result.redirectUri}`);

            try {
              await bootstrapWechatFileHelperSession(null, result.redirectUri);
              if (cancelled) return;
              bootstrappingRef.current = false;
              pushDebug(`bootstrap ok ${describeWechatFileHelperSession()}`);
              markLoggedIn();
            } catch (err) {
              if (cancelled) return;
              bootstrappingRef.current = false;
              uuidRef.current = null;
              scannedRef.current = true;
              setStatus('同步会话未完成，请关闭后重试');
              pushDebug(`bootstrap fail ${(err as Error)?.message || 'unknown'}`);
            }
          }
        } finally {
          pollingRef.current = false;
        }
      })();
    }, 2000);

    void refreshQr().catch(() => {
      if (!cancelled) setStatus('获取二维码失败，请关闭后重试');
    });

    return () => {
      cancelled = true;
      stopScanner();
      clearWechatFileHelperSession();
      window.clearInterval(sessionTimer);
      window.clearInterval(pollTimer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    return subscribeUserStickers((all) => {
      const startAt = sessionStartAtRef.current;
      const sessionOnes = all
        .filter((sticker) => sticker.importedAt >= startAt)
        .sort((a, b) => b.importedAt - a.importedAt);
      setSessionPreviewStickers(sessionOnes);
    });
  }, [open]);

  useEffect(() => {
    if (!open || sessionPreviewStickers.length === 0) {
      previewObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewObjectUrlsRef.current = [];
      setPreviewUrls({});
      return undefined;
    }

    let cancelled = false;
    const loadPreviews = async () => {
      const next: Record<string, string> = {};
      const created: string[] = [];
      for (const sticker of sessionPreviewStickers) {
        const url = await getStickerBlobUrl(sticker.id);
        if (url) {
          next[sticker.id] = url;
          created.push(url);
        }
      }
      if (cancelled) {
        created.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      previewObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewObjectUrlsRef.current = created;
      setPreviewUrls(next);
    };

    void loadPreviews();
    return () => {
      cancelled = true;
    };
  }, [open, sessionPreviewStickers]);

  return (
    <Modal
      open={open}
      zIndex={90}
      closeOnMaskClick={false}
      panelClassName="relative w-full max-w-[680px] animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-6 shadow-2xl"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">微信导入</h3>
          <p className="mt-1 text-xs leading-relaxed text-netease-muted">
            {loggedIn
              ? '登录成功。表情会自动保存到本机，可关闭此窗口继续在表情面板使用。'
              : '扫码登录后，把手机收藏表情发给「文件传输助手」即可。'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 rounded-lg p-1.5 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
          aria-label="关闭采集"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loggedIn ? (
        <div className="flex flex-col items-center py-4 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-emerald-400" />
          <p className="text-sm text-white">已登录文件传输助手</p>
          <p className="mt-2 text-xs leading-relaxed text-netease-muted">
            在手机微信里把表情发给「文件传输助手」，此处会自动收录。
          </p>
          <p className="mt-3 text-[11px] text-amber-200/90">
            {status} · 累计 {total} 个
          </p>
          {unsupportedCount > 0 && (
            <div className="mt-3 w-full rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-left">
              <p className="text-xs font-medium text-amber-200">
                {unsupportedCount} 个表情无法采集
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-100/80">
                微信网页版返回「{WECHAT_UNSUPPORTED_STICKER_TIP}」。这类表情无法自动下载，请改发普通 GIF/图片表情，或在手机端另存后再上传。
              </p>
            </div>
          )}
          {sessionPreviewStickers.length > 0 && (
            <div className="mt-4 w-full text-left">
              <p className="mb-2 text-xs font-medium text-white/90">本次导入预览</p>
              <div className="grid max-h-40 grid-cols-5 gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2 sm:grid-cols-6">
                {sessionPreviewStickers.map((sticker) => (
                  <div
                    key={sticker.id}
                    className="flex aspect-square items-center justify-center rounded-md border border-white/5 bg-white/5 p-1"
                  >
                    {previewUrls[sticker.id] ? (
                      <img
                        src={previewUrls[sticker.id]}
                        alt="本次导入表情"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-netease-muted" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <div className="flex h-[280px] w-[280px] items-center justify-center rounded-xl bg-white p-3">
            {qrUrl ? (
              <img
                src={qrUrl}
                alt="微信登录二维码"
                className="h-full w-full object-contain"
              />
            ) : (
              <MusicLoading label="正在准备微信二维码" compact className="bg-transparent" />
            )}
          </div>
          <p className="mt-4 text-sm text-white">{status}</p>
        </div>
      )}
    </Modal>
  );
}
