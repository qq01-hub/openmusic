import { useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { getDeskPetCharacter, resolveDeskPetAction, type DeskPetCharacterId } from '../lib/deskPetCharacters';
import { UPSTREAM_SPRITE } from '../lib/deskPetUpstream';
import './RoomAiDesktopPet.css';

interface Props {
  character: DeskPetCharacterId;
  animation?: string;
  facingLeft?: boolean;
  preview?: boolean;
  loop?: boolean;
  playKey?: number;
  onComplete?: () => void;
}

export default function DeskPetAppearance({ character, animation = 'idle', facingLeft = false,
  preview = false, loop = true, playKey = 0, onComplete }: Props) {
  const config = getDeskPetCharacter(character);
  const [failedAsset, setFailedAsset] = useState('');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // 朝向变化只更新镜像，不重新随机动作素材，避免漫游或拖拽转向时频繁重载视频产生闪烁
  const random = useMemo(() => Math.random(), [character, animation, playKey]);
  const action = useMemo(() => resolveDeskPetAction(character, animation, {
    random: () => preview ? 0 : random, baseIdle: !preview, facingLeft,
  }), [character, animation, preview, random, facingLeft]);
  const animate = !preview && !reduceMotion;
  const videoRef = useRef<HTMLVideoElement>(null);
  const completed = useRef(onComplete);
  completed.current = onComplete;

  // 对齐 playOnce：视频等待真实 ended，元数据到达后重设兜底，立绘与图集使用源码时长
  useEffect(() => {
    if (loop || preview) return;
    let finished = false;
    let timer: number;
    const back = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      completed.current?.();
    };
    const video = videoRef.current;
    const arm = () => {
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(back, Math.min(15000, video.duration * 1000 + 400));
    };
    timer = window.setTimeout(back, action.kind === 'pose' ? 2600
      : action.kind === 'sprite' ? Math.min(8000, spriteDuration(action.sprite) + 220) : 13000);
    if (video) {
      video.addEventListener('ended', back);
      video.addEventListener('loadedmetadata', arm);
      if (video.readyState >= 1) arm();
      video.currentTime = 0;
      void video.play().catch(() => {});
    }
    return () => {
      finished = true;
      window.clearTimeout(timer);
      video?.removeEventListener('ended', back);
      video?.removeEventListener('loadedmetadata', arm);
    };
  }, [action.kind, action.src, action.sprite, loop, preview, playKey]);

  return (
    <div className={`room-pet-animation${config.kind !== 'video' && animate ? ' room-pet-animation--pose' : ''}`}
      style={{ transform: action.mirror ? 'scaleX(-1)' : undefined }}
      data-pet-character={config.id} data-pet-animation={animation} data-upstream-action={action.name}>
      {failedAsset === action.src ? (
        <img className="room-pet-animation__video" src="/desk-pet/idle.png" alt={`${config.label}素材加载失败，显示原版大肥鱼`} draggable={false} />
      ) : config.kind === 'sprite' ? (
        <SpriteCharacter mode={action.sprite} animate={animate} loop={loop} playKey={playKey} onError={() => setFailedAsset(action.src)} />
      ) : config.kind === 'pose' ? (
        <img key={action.src} className={`room-pet-animation__video${animate ? ' room-pet-animation__pose-pop' : ''}`}
          src={action.src} alt={`${config.label}原版立绘`} draggable={false} loading={preview ? 'lazy' : 'eager'}
          decoding="async" onError={() => setFailedAsset(action.src)} />
      ) : !animate ? (
        <img className="room-pet-animation__video" src="/desk-pet/idle.png" alt={`${config.label}原版形象`} draggable={false} />
      ) : (
        <VideoCharacter src={action.src} videoRef={videoRef} loop={loop}
          onError={() => setFailedAsset(action.src)} label={`${config.label}原版动画`} />
      )}
    </div>
  );
}

function VideoCharacter({ src, videoRef, loop, onError, label }: {
  src: string; videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  loop: boolean; onError: () => void; label: string;
}) {
  const [displayedSrc, setDisplayedSrc] = useState(src);
  const [readySrc, setReadySrc] = useState('');
  // 新视频真正绘出首帧前保留旧画面（若首次加载尚未就绪则用透明静态帧垫底），并隐藏解码中的 video，彻底消除透明 WebM 解码瞬间的黑色矩形边框闪现
  const sources = displayedSrc === src ? [src] : [displayedSrc, src];
  const markReady = (source: string) => {
    setReadySrc(source);
    if (source === src) {
      setDisplayedSrc(source);
    }
  };
  return (
    <>
      {readySrc !== displayedSrc && (
        <img
          className="room-pet-animation__video"
          src="/desk-pet/idle.png"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      {sources.map(source => {
        const isCurrentVisible = source === displayedSrc && readySrc === source;
        return (
          <video key={source} ref={node => { if (source === src) videoRef.current = node; }}
            className="room-pet-animation__video" src={source}
            style={{
              opacity: isCurrentVisible ? 1 : 0,
              visibility: isCurrentVisible ? 'visible' : 'hidden',
            }}
            autoPlay muted loop={source === src && loop} playsInline preload="auto"
            disablePictureInPicture disableRemotePlayback tabIndex={-1} draggable={false}
            onLoadedData={event => {
              if (event.currentTarget.readyState >= 2) markReady(source);
            }}
            onPlaying={event => {
              if (event.currentTarget.readyState >= 2) markReady(source);
            }}
            onError={source === src ? onError : undefined}
            aria-hidden={!isCurrentVisible} aria-label={label} />
        );
      })}
    </>
  );
}

interface SpriteSequence { row: number; count: number; times: readonly number[]; frame?: number }
const SPRITE_SEQUENCES: Readonly<Record<string, SpriteSequence>> = UPSTREAM_SPRITE.sequences;
function spriteDuration(mode: string) {
  const sequence = SPRITE_SEQUENCES[mode] ?? SPRITE_SEQUENCES.waiting;
  const times = sequence.frame === undefined ? sequence.times
    : [sequence.times[sequence.frame] ?? sequence.times[0]];
  return times.reduce((total, time) => total + time, 0);
}

function SpriteCharacter({ mode, animate, loop, playKey, onError }: {
  mode: string; animate: boolean; loop: boolean; playKey: number; onError: () => void;
}) {
  const [cell, setCell] = useState({ row: 0, column: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<{ x: number; y: number; at: number } | null>(null);
  useEffect(() => {
    const sheet = new Image();
    sheet.src = '/desk-pet/gpt/spritesheet.webp';
    sheet.onerror = onError;
    return () => { sheet.onerror = null; };
  }, [onError]);
  useEffect(() => {
    const sequence = SPRITE_SEQUENCES[mode] ?? SPRITE_SEQUENCES.waiting;
    const start = sequence.frame ?? 0;
    let frame = start;
    let timer: number | undefined;
    const onPointerMove = (event: PointerEvent) => {
      lastPointer.current = { x: event.clientX, y: event.clientY, at: performance.now() };
    };
    const tick = () => {
      const pointer = lastPointer.current;
      const box = boxRef.current?.getBoundingClientRect();
      if (animate && mode === 'idle' && pointer && box && performance.now() - pointer.at < 1800) {
        const dx = pointer.x - (box.left + box.width / 2);
        const dy = pointer.y - (box.top + box.height / 2);
        const look = Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / 22.5) % 16;
        setCell({ row: 9 + Math.floor(look / 8), column: look % 8 });
        timer = window.setTimeout(tick, 90);
        return;
      }
      setCell({ row: sequence.row, column: frame });
      if (!animate) return;
      const duration = sequence.times[frame] ?? 150;
      frame++;
      if (frame >= sequence.count) {
        if (!loop) return;
        frame = start;
      }
      timer = window.setTimeout(tick, duration);
    };
    tick();
    if (animate && mode === 'idle') window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [animate, mode, loop, playKey]);
  return <div ref={boxRef} className="room-pet-animation__sprite" role="img" aria-label="GPT 娘原版精灵图动画"
    style={{ backgroundPosition: `${cell.column / (UPSTREAM_SPRITE.cols - 1) * 100}% ${cell.row / (UPSTREAM_SPRITE.rows - 1) * 100}%` }}
    data-sprite-cell={`${cell.row}:${cell.column}`} />;
}
