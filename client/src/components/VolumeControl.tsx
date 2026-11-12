import { useEffect, useRef, useState } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { useAudioStore } from '../stores/audioStore';
import { applyAllAudioVolume } from '../lib/audioVolume';
import Tooltip from './Tooltip';

interface Props {
  className?: string;
  iconClassName?: string;
  /** 竖向滑条高度，如 h-20；内部会映射为横向滑条宽度再旋转 */
  sliderClassName?: string;
  /** 紧凑模式：仅图标，点击展开滑条 */
  compact?: boolean;
  buttonClassName?: string;
}

function trackWidthClass(heightClass: string): string {
  if (heightClass.startsWith('h-')) return heightClass.replace(/^h-/, 'w-');
  if (heightClass.startsWith('w-')) return heightClass;
  return 'w-20';
}

const MUTE_PREV_VOLUME_KEY = 'openmusic:volume-before-mute';

export default function VolumeControl({
  className = '',
  iconClassName = 'w-4 h-4',
  sliderClassName = 'h-20',
  compact = false,
  buttonClassName = 'w-8 h-8 text-netease-muted hover:text-white',
}: Props) {
  const volume = useAudioStore((s) => s.volume);
  const setVolume = useAudioStore((s) => s.setVolume);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const toggleMute = () => {
    if (volume > 0) {
      try { localStorage.setItem(MUTE_PREV_VOLUME_KEY, String(volume)); } catch {}
      setVolume(0);
    } else {
      let prev = 1;
      try { prev = Number(localStorage.getItem(MUTE_PREV_VOLUME_KEY)) || 1; } catch {}
      setVolume(Math.max(0.05, prev));
    }
  };

  useEffect(() => {
    applyAllAudioVolume(volume);
  }, [volume]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || (compact && !expanded)) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const audio = useAudioStore.getState();
      audio.setVolume(Math.min(100, Math.max(0, Math.round(audio.volume * 100) + (event.deltaY < 0 ? 1 : -1))) / 100);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [compact, expanded]);

  useEffect(() => {
    if (!compact || !expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [compact, expanded]);

  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const trackHeight = sliderClassName.startsWith('h-') ? sliderClassName : 'h-20';
  const inputWidth = trackWidthClass(trackHeight);

  const pct = `${Math.round(volume * 100)}%`;

  const slider = (
    <div className={`relative flex w-5 items-center justify-center ${trackHeight}`}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        style={{ ['--volume-pct' as string]: pct }}
        className={`volume-range absolute left-1/2 top-1/2 h-1 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer ${inputWidth}`}
        aria-label="音量"
      />
    </div>
  );

  if (compact) {
    return (
      <div ref={rootRef} className={`relative z-30 flex items-center ${className}`}>
        <Tooltip content={`音量 ${pct}（展开后滚轮调节，双击静音）`}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            onDoubleClick={(e) => { e.preventDefault(); toggleMute(); }}
            className={`flex items-center justify-center transition-colors ${buttonClassName}`}
            aria-label="音量"
            aria-expanded={expanded}
          >
            <Icon className={iconClassName} />
          </button>
        </Tooltip>
        {expanded && (
          <div className="pointer-events-auto absolute bottom-full left-1/2 z-[60] mb-2 flex -translate-x-1/2 flex-col items-center rounded-lg border border-netease-border/60 bg-netease-card px-2.5 py-3 shadow-lg">
            <span className="mb-2 text-xs tabular-nums text-white/80">{pct}</span>
            {slider}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`flex flex-col items-center gap-1.5 ${className}`}>
      {slider}
      <button
        type="button"
        onClick={toggleMute}
        className="flex items-center justify-center"
        aria-label={volume <= 0 ? '取消静音' : '静音'}
      >
        <Icon className={`${iconClassName} text-white/50 flex-shrink-0 hover:text-white transition-colors`} />
      </button>
    </div>
  );
}
