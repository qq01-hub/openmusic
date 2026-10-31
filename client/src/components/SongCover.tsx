import { memo, useEffect, useState } from 'react';
import { getCoverUrl } from '../api/music';
import { getCoverPixelSize, getFallbackCoverUrl, type CoverSize } from '../lib/coverUrl';
import { useSignedApiUrl } from '../lib/signedApiUrl';
import type { Song } from '../types';

interface Props {
  song: Pick<Song, 'id' | 'source' | 'pic'>;
  size?: CoverSize;
  className?: string;
  eager?: boolean;
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
}: Props) {
  const identity = coverIdentity(song);
  const [stageFor, setStageFor] = useState<{ id: string; stage: LoadStage } | null>(null);
  const stage: LoadStage = stageFor?.id === identity ? stageFor.stage : 'primary';

  // 切歌后必须清掉失败态，否则底栏单例封面会一直卡在黑底占位
  useEffect(() => {
    setStageFor(null);
  }, [identity]);

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
      loading={eager ? 'eager' : 'lazy'}
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
})
