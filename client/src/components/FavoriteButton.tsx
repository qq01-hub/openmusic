import { useEffect, useRef, useState } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import type { Song } from '../types';
import { useFavorites } from '../hooks/useFavorites';
import Tooltip from './Tooltip';
import QueueTip from './queue/QueueTip';

interface Props {
  song: Song | null;
  className?: string;
  iconClassName?: string;
  titlePrefix?: string;
  /** 列表项中悬停时才显示 */
  showOnHover?: boolean;
  /** 由父级传入时可避免列表行重复订阅收藏状态 */
  favorited?: boolean;
  /** 队列区域使用 QueueTip */
  useQueueTip?: boolean;
  /** 双击时执行分类收藏，提供后会延迟单击以区分双击 */
  onDoubleClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleResult?: (favorited: boolean) => void;
}

export default function FavoriteButton({
  song,
  className = 'w-8 h-8 text-netease-muted hover:text-rose-300',
  iconClassName = 'w-4 h-4',
  titlePrefix = '',
  showOnHover = false,
  favorited: favoritedProp,
  useQueueTip = false,
  onDoubleClick,
  onToggleResult,
}: Props) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const clickTimer = useRef<number | null>(null);

  const favorited = favoritedProp ?? isFavorite(song);

  const handleToggle = async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!song || loading) return;
    setLoading(true);
    setError('');
    const res = await toggleFavorite(song);
    setLoading(false);
    if (res.success) onToggleResult?.(favorited);
    if (!res.success) {
      setError(res.error || '收藏失败');
    }
  };

  useEffect(() => () => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!onDoubleClick) {
      void handleToggle(event);
      return;
    }
    event.stopPropagation();
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      void handleToggle(event);
    }, 220);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!onDoubleClick) return;
    event.preventDefault();
    event.stopPropagation();
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onDoubleClick(event);
  };

  const hoverClass = showOnHover ? 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100' : '';

  const tip = error || `${titlePrefix}${favorited ? '取消收藏' : '收藏'}${onDoubleClick ? ' · 双击选择分类' : ''}`;
  const TipWrapper = useQueueTip ? QueueTip : Tooltip;

  return (
    <TipWrapper content={tip}>
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        disabled={!song || loading}
        className={`flex flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${favorited ? 'text-rose-300' : ''} ${hoverClass} ${className}`}
        aria-label={favorited ? '取消收藏' : '收藏'}
      >
        {loading ? (
          <Loader2 className={`${iconClassName} animate-spin`} />
        ) : (
          <Heart className={`${iconClassName} ${favorited ? 'fill-current' : ''}`} />
        )}
      </button>
    </TipWrapper>
  );
}
