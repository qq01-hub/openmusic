import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Volume2 } from 'lucide-react';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { isWeChatBrowser, markAudioSessionUnlocked, shouldShowUnlockOverlay, isMobileDevice } from '../lib/audioUnlock';

interface Props {
  tvMode?: boolean;
}

export default function AudioUnlockOverlay({ tvMode = false }: Props) {
  const needsAudioUnlock = useAudioStore((s) => s.needsAudioUnlock);
  const retryPlayback = useAudioStore((s) => s.retryPlayback);
  const room = useRoomStore((s) => s.room);
  const handlingRef = useRef(false);

  if (!needsAudioUnlock || !room?.current || !shouldShowUnlockOverlay()) return null;

  const handleUnlock = () => {
    if (handlingRef.current) return;
    handlingRef.current = true;
    markAudioSessionUnlocked();
    useAudioStore.getState().setNeedsAudioUnlock(false);
    retryPlayback?.(true);
    window.setTimeout(() => {
      handlingRef.current = false;
    }, 400);
  };

  const handlePointerUnlock = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    handleUnlock();
  };

  const hint = tvMode
    ? '浏览器限制自动播放，按遥控器任意键开启'
    : isWeChatBrowser()
      ? '微信内需点击授权后才能播放'
      : '浏览器限制自动播放，点击屏幕开启声音';

  return createPortal(
    <button
      type="button"
      onClick={!isMobileDevice() ? handlePointerUnlock : undefined}
      onTouchStart={isMobileDevice() ? handlePointerUnlock : undefined}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 touch-manipulation cursor-pointer"
      style={{ WebkitTapHighlightColor: 'transparent' }}
      aria-label="开启声音"
    >
      <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-netease-card border border-netease-border/60 shadow-2xl pointer-events-none select-none">
        <div className="w-14 h-14 rounded-full bg-netease-red/20 flex items-center justify-center">
          <Volume2 className="w-7 h-7 text-netease-red" />
        </div>
        <p className="text-base font-medium text-white">
          {tvMode ? '按任意键开启声音' : '点击开启声音'}
        </p>
        <p className="text-xs text-netease-muted text-center max-w-[16rem]">{hint}</p>
      </div>
    </button>,
    document.body,
  );
}
