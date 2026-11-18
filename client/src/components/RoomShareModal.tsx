import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from 'lucide-react';
import { copyToClipboard } from '../lib/copyToClipboard';
import MusicLoading from './MusicLoading';

interface Props {
  open: boolean;
  shareUrl: string;
  shareText: string;
  onClose: () => void;
  onCopied?: () => void;
}

export default function RoomShareModal({ open, shareUrl, shareText, onClose, onCopied }: Props) {
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !shareUrl) return;
    let cancelled = false;
    setQrImage('');
    setQrError('');
    setCopied(false);
    void QRCode.toDataURL(shareUrl, { width: 640, margin: 1, errorCorrectionLevel: 'M' }).then((image) => {
      if (!cancelled) setQrImage(image);
    }).catch(() => {
      if (!cancelled) setQrError('二维码生成失败，请稍后重试');
    });
    return () => { cancelled = true; };
  }, [open, shareUrl]);

  if (!open) return null;

  const handleCopy = async () => {
    if (!await copyToClipboard(shareText)) return;
    setCopied(true);
    onCopied?.();
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button type="button" className="absolute inset-0 bg-[#08090c] backdrop-blur-sm" onClick={onClose} aria-label="关闭分享弹窗" />
      <section className="relative flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-white/10 bg-netease-dark p-4 shadow-2xl sm:p-5" role="dialog" aria-modal="true" aria-label="分享房间">
        <div className="mb-3 flex flex-shrink-0 items-center justify-between sm:mb-4">
          <div><h2 className="text-base font-semibold text-white">分享房间</h2><p className="mt-1 text-xs text-netease-muted">扫码或复制邀请文案，邀请好友一起听</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white" aria-label="关闭"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
          <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-2xl bg-white p-2 sm:h-52 sm:w-52">
            {qrImage ? <img src={qrImage} alt="房间二维码" className="h-full w-full" /> : qrError ? <p className="px-4 text-center text-xs text-red-500">{qrError}</p> : <MusicLoading label="正在生成房间二维码" compact className="bg-transparent" />}
          </div>
          <p className="mt-3 text-center text-xs text-netease-muted">使用微信或相机扫描二维码进入房间</p>
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 sm:mt-5">
            <p className="mb-2 text-xs font-medium text-white/80">邀请文案与链接</p>
            <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-all text-xs leading-5 text-netease-muted">{shareText}</pre>
          </div>
        </div>
        <button type="button" onClick={() => void handleCopy()} className="mt-4 flex w-full flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-netease-red py-2.5 text-sm font-medium text-white hover:bg-netease-red/90">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? '已复制邀请文案' : '一键复制邀请文案'}
        </button>
      </section>
    </div>, document.body,
  );
}
