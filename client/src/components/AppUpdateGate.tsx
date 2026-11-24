import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Modal from './Modal';
import {
  dismissUpdateForBuild,
  fetchRemoteAppVersion,
  forceAppReload,
  isUpdateSuppressedForBuild,
  LOCAL_APP_BUILD_ID,
  type AppVersionInfo,
} from '../lib/appVersion';
import { setGuidePauseReason } from '../lib/guidePause';
import { getDisplayUpdateNotes } from '../lib/updateNotes';
import { isHostPageHidden, subscribeHostVisibility } from '../hooks/useVisualRenderPolicy';

const POLL_MS = 3 * 60 * 1000;
const MIN_CHECK_GAP_MS = 15 * 1000;

export default function AppUpdateGate() {
  const location = useLocation();
  const [remote, setRemote] = useState<AppVersionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  /** 本挂载周期内是否已自动弹过一次，避免退房间/切页后轮询再次强开 */
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    setGuidePauseReason('app-update', open);
    return () => setGuidePauseReason('app-update', false);
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const controllers = new Set<AbortController>();
    let inFlight = false;
    let lastCheckAt = 0;

    const check = async (force = false) => {
      const now = Date.now();
      if (cancelled || inFlight) return;
      if (!force && (document.hidden || now - lastCheckAt < MIN_CHECK_GAP_MS)) return;
      inFlight = true;
      lastCheckAt = now;
      const ac = new AbortController();
      controllers.add(ac);
      try {
        const info = await fetchRemoteAppVersion(ac.signal);
        if (cancelled || !info) return;
        if (info.buildId === LOCAL_APP_BUILD_ID || info.buildId === 'dev') return;
        // 非紧急发版：不弹窗、不显示角标
        if (!info.forcePrompt) return;
        // 已点过「稍后/立即更新」的版本：房间回首页也不再弹、不显示角标
        if (isUpdateSuppressedForBuild(info.buildId)) return;
        setRemote(info);
        if (autoOpenedRef.current) return;
        autoOpenedRef.current = true;
        setOpen(true);
      } catch {
        // ignore network errors
      } finally {
        controllers.delete(ac);
        inFlight = false;
      }
    };

    void check(true);
    timer = window.setInterval(() => {
      if (!isHostPageHidden()) void check();
    }, POLL_MS);

    const onVisible = () => {
      if (!isHostPageHidden()) void check();
    };
    const unsubscribeVisibility = subscribeHostVisibility(onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      unsubscribeVisibility();
      window.removeEventListener('focus', onVisible);
      for (const ac of controllers) ac.abort();
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!remote || remote.buildId === LOCAL_APP_BUILD_ID) return null;
  if (!remote.forcePrompt) return null;
  if (isUpdateSuppressedForBuild(remote.buildId)) return null;

  const notes = getDisplayUpdateNotes(remote.notes);

  const onLater = () => {
    dismissUpdateForBuild(remote.buildId);
    setOpen(false);
  };

  const onReload = async () => {
    dismissUpdateForBuild(remote.buildId);
    setOpen(false);
    setReloading(true);
    await forceAppReload();
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-[70] inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-500 px-3.5 py-2 text-sm font-medium text-black shadow-lg shadow-black/25 transition-colors hover:bg-amber-400"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          更新
        </button>
      )}

      <Modal
        open={open}
        onClose={onLater}
        closeOnMaskClick={false}
        zIndex={90}
        panelClassName="room-feature-dialog relative w-full max-w-[19rem] animate-fade-in overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
      >
        <div className="px-5 pb-5 pt-6">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/15">
            <RefreshCw className="h-4 w-4 text-amber-400" />
          </div>

          <h2 className="text-center text-base font-semibold tracking-tight text-white">
            发现新版本
          </h2>

          <ul className="mt-3.5 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {notes.map((note) => (
              <li
                key={note}
                className="flex gap-2 text-[13px] leading-snug text-white/70"
              >
                <span className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-amber-400/80" />
                <span className="min-w-0">{note}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void onReload()}
              disabled={reloading}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} />
              {reloading ? '更新中…' : '立即更新'}
            </button>
            <button
              type="button"
              onClick={onLater}
              disabled={reloading}
              className="h-9 w-full rounded-xl text-sm text-white/45 transition-colors hover:bg-white/5 hover:text-white/70 disabled:opacity-40"
            >
              稍后
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
