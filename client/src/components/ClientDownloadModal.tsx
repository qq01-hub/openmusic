import { Download, MonitorDown, Smartphone, X } from 'lucide-react';
import { ANDROID_APK_URL } from '../lib/androidDownload';
import { WINDOWS_DESKTOP_CLIENT_URL } from '../lib/desktopDownload';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ClientDownloadModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-netease-dark shadow-2xl animate-fade-in overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-netease-border/50 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Smartphone className="h-4 w-4 flex-shrink-0 text-netease-muted" />
            <h2 className="text-sm font-semibold text-white">下载客户端</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <a
            href={WINDOWS_DESKTOP_CLIENT_URL}
            download="openmusic-desktop-setup.exe"
            className="flex items-center gap-3 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-3 transition-colors hover:bg-sky-500/15"
          >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
              <MonitorDown className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-sky-300">Windows 桌面客户端</span>
              <span className="mt-0.5 block text-xs text-sky-200/70">下载安装版</span>
            </span>
          </a>

          <a
            href={ANDROID_APK_URL}
            download="openmusic.apk"
            className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-3 transition-colors hover:bg-emerald-500/15"
          >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
              <Download className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-emerald-300">Android</span>
            </span>
          </a>

        </div>
      </div>
    </div>
  );
}
