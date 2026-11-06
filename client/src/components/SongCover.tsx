import { memo, useState } from 'react';
import { getCoverUrl } from '../api/music';
import { getCoverPixelSize, getFallbackCoverUrl, type CoverSize } from '../lib/coverUrl';
import { useSignedApiUrl } from '../lib/signedApiUrl';
import type { Song } from '../types';

interface Props {
  song: Pick<Song, 'id' | 'source' | 'pic'>;
  size?: CoverSize;
  className?: string;
  eager?: boolean;
  /** 虚拟列表行内可关闭原生 lazy，避免快速滚动时 IntersectionObserver 滞后导致封面空白 */
  lazy?: boolean;
}

function coverIdentity(song: Pick<Song, 'id' | 'source' | 'pic'>): string {
  return `${song.source || 'netease'}:${song.id}:${song.pic || ''}`;
}

type LoadStage = 'primary' | 'proxy' | 'failed';

export default memo(function SongCover({
  song,
  size = 'thumb',
  className = '',
  eager = false,
  lazy = true,
}: Props) {
  const identity = coverIdentity(song);
  const [stageFor, setStageFor] = useState<{ id: string; stage: LoadStage } | null>(null);
  // stageFor 绑定 identity，切歌后 identity 变化会自动回到 primary，无需额外 effect 重置
  const stage: LoadStage = stageFor?.id === identity ? stageFor.stage : 'primary';

  const raw = getCoverUrl(song, size);
  const pixelSize = getCoverPixelSize(size);

  // 外链封面加载失败（如混合内容拦截、CDN 不支持 https）时改走同源代理兜底
  const proxyUrl = /^https?:\/\//i.test(raw)
    ? `/api/media-proxy?url=${encodeURIComponent(raw)}${pixelSize ? `&size=${pixelSize}` : ''}`
    : null;
  const target = stage === 'proxy' && proxyUrl ? proxyUrl : raw;
  const signed = useSignedApiUrl(target);
  const resolvedSrc = signed || (target && !target.startsWith('/api/media-proxy') ? target : null);
  const src = stage === 'failed' || !resolvedSrc ? getFallbackCoverUrl() : resolvedSrc;

  return (
    <img
      key={identity}
      src={src}
      alt=""
      className={className}
      width={pixelSize}
      height={pixelSize}
      loading={eager || !lazy ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      {...(eager ? { fetchpriority: 'high' } : {})}
      onError={() => {
        setStageFor({
          id: identity,
          stage: stage === 'primary' && proxyUrl ? 'proxy' : 'failed',
        });
      }}
    />
  );
}, (prev, next) => (
  coverIdentity(prev.song) === coverIdentity(next.song)
  && prev.size === next.size
  && prev.className === next.className
  && prev.eager === next.eager
  && prev.lazy === next.lazy
))
