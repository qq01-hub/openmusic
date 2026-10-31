import { useEffect, useState } from 'react';
import { measureCoverLuminance, tuneCoverBackdrop, type CoverBackdropTuning } from '../lib/coverBackdrop';
import { getCoverPixelSize } from '../lib/coverUrl';
import { cacheCoverImage } from '../lib/coverImageCache';
import { toProxiedMediaUrl } from '../lib/mediaProxyUrl';
import { useSignedApiUrl } from '../lib/signedApiUrl';
import { loadSharedCoverResource } from '../lib/sharedCoverResource';

interface Props {
  coverUrl: string;
  className?: string;
}

type LoadStage = 'primary' | 'proxy';

export default function AmbientCoverLayers({ coverUrl, className = 'absolute inset-0' }: Props) {
  const [stageFor, setStageFor] = useState<{ id: string; stage: LoadStage } | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [resourceUrl, setResourceUrl] = useState('');
  const [tuning, setTuning] = useState<CoverBackdropTuning>(() => tuneCoverBackdrop(null));

  const stage: LoadStage = stageFor?.id === coverUrl ? stageFor.stage : 'primary';

  useEffect(() => {
    setStageFor(null);
    setLoadedFor(null);
    setResourceUrl('');
    setTuning(tuneCoverBackdrop(null));
  }, [coverUrl]);

  const pixelSize = getCoverPixelSize('medium');
  // 与 SongCover 一致：先直链，失败再走 media-proxy（避免代理限流导致背景偶发空白）
  const proxyUrl = /^https?:\/\//i.test(coverUrl)
    ? `/api/media-proxy?url=${encodeURIComponent(coverUrl)}${pixelSize ? `&size=${pixelSize}` : ''}`
    : null;
  const target = stage === 'proxy' && proxyUrl ? proxyUrl : coverUrl;
  const signedCover = useSignedApiUrl(target);
  const displayUrl = signedCover || '';
  const loaded = Boolean(resourceUrl) && loadedFor === resourceUrl;

  useEffect(() => {
    if (!displayUrl) return undefined;
    let cancelled = false;
    void loadSharedCoverResource(displayUrl)
      .then((sharedUrl) => {
        if (!cancelled) setResourceUrl(sharedUrl);
      })
      .catch(() => {
        if (!cancelled) setResourceUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [displayUrl]);

  return (
    <div className={`${className} overflow-hidden`} aria-hidden>
      <div className="absolute inset-0 bg-surface-canvas" />

      {resourceUrl ? (
        <img
          key={resourceUrl}
          src={resourceUrl}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-[opacity,filter] duration-700"
          style={{
            opacity: loaded ? tuning.coverOpacity : 0,
            filter: `blur(46px) brightness(${tuning.imgBrightness}) saturate(1.32) contrast(.96)`,
            transform: 'scale(1.14)',
          }}
          ref={(img) => {
            // 缓存命中时浏览器可能不再触发 onLoad，需主动检测 complete
            if (img?.complete && img.naturalWidth > 0 && loadedFor !== resourceUrl) {
              queueMicrotask(() => setLoadedFor(resourceUrl));
            }
          }}
          onLoad={(event) => {
            const img = event.currentTarget;
            setLoadedFor(resourceUrl);
            setTuning(tuneCoverBackdrop(measureCoverLuminance(img)));
            if (coverUrl) {
              cacheCoverImage(coverUrl, img);
              cacheCoverImage(toProxiedMediaUrl(coverUrl), img);
            }
          }}
          onError={() => {
            if (stage === 'primary' && proxyUrl) {
              setStageFor({ id: coverUrl, stage: 'proxy' });
              return;
            }
            setLoadedFor(null);
          }}
        />
      ) : null}

      <div
        className="absolute inset-0 transition-[background-color] duration-700"
        style={{ backgroundColor: `rgba(0, 0, 0, ${tuning.baseOverlay})` }}
      />

      <div
        className="absolute inset-0 transition-[background] duration-700"
        style={{
          background: `linear-gradient(to bottom, rgba(0, 0, 0, ${tuning.gradientTop}), transparent, rgba(0, 0, 0, ${tuning.gradientBottom}))`,
        }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(255,255,255,0.08),transparent_42%),linear-gradient(90deg,rgba(0,0,0,.25),transparent_25%,transparent_75%,rgba(0,0,0,.25))]" />
      <div className="absolute inset-0 shadow-[inset_0_0_180px_rgba(0,0,0,.42)]" />
    </div>
  );
}
