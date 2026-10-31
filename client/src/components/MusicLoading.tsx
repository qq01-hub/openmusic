import { useLoadingQuote } from '../lib/loadingQuote';
import BrandMark from './BrandMark';
import './MusicLoading.css';

interface Props {
  label?: string;
  compact?: boolean;
  className?: string;
}

let initialFullscreenDone = false;

/** Shared by route loading and room connection; no simulated progress or audio. */
export default function MusicLoading({ label = '正在连接音乐空间', compact = false, className = '' }: Props) {
  const quote = useLoadingQuote();
  const skipEntranceAnimation = !compact && initialFullscreenDone;
  if (!compact && !initialFullscreenDone) {
    initialFullscreenDone = true;
  }
  return (
    <div
      className={`om-music-loading${compact ? ' om-music-loading--compact' : ' om-music-loading--fullscreen'}${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className={`om-music-loading__content${skipEntranceAnimation ? ' om-music-loading__content--instant' : ''}`}>
        <div className="om-music-loading__record" aria-hidden="true"><i /><BrandMark className="om-music-loading__mark" /></div>
        <div className="om-music-loading__wave" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6].map((i) => <i key={i} style={{ animationDelay: `${i * -0.13}s` }} />)}</div>
        <p className="om-music-loading__label">{label}</p>
        <p className="om-music-loading__quote">{quote}</p>
        <span className="om-music-loading__brand" aria-hidden="true">OPENMUSIC · 此刻同频</span>
      </div>
    </div>
  );
}
