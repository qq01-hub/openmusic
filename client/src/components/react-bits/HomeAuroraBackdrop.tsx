import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { isWeakPlaybackDevice } from '../../lib/weakPlaybackDevice';
import { isMobileDevice } from '../../lib/audioUnlock';

const Aurora = lazy(() => import('./Aurora'));

const BRAND_STOPS = ['#ff4d55', '#f472b6', '#c084fc'];

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canUseAurora(): boolean {
  if (typeof window === 'undefined') return false;
  if (prefersReducedMotion()) return false;
  if (isWeakPlaybackDevice()) return false;
  if (isMobileDevice()) return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function StaticGlow() {
  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 75% 65% at 12% 0%, rgba(255,77,85,0.24), transparent 75%), radial-gradient(ellipse 70% 60% at 88% 0%, rgba(192,132,252,0.20), transparent 75%), radial-gradient(ellipse 55% 50% at 50% 0%, rgba(244,114,182,0.12), transparent 80%)',
      }}
    />
  );
}

/** 首页背景保留静态渐变，动态极光仅作为增强层 */
export default function HomeAuroraBackdrop({ paused = false, roomCount = 0 }: { paused?: boolean; roomCount?: number }) {
  const [enabled, setEnabled] = useState(false);
  const handleUnavailable = useCallback(() => setEnabled(false), []);
  const overloaded = roomCount > 40;

  useEffect(() => {
    if (!paused && !overloaded) setEnabled(canUseAurora());
    else setEnabled(false);
  }, [overloaded, paused]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <StaticGlow />
      {enabled && !paused && !overloaded && (
        <Suspense fallback={null}>
          <div className="absolute inset-0 opacity-[0.68]">
            <Aurora colorStops={BRAND_STOPS} amplitude={1.05} blend={0.62} speed={0.55} onUnavailable={handleUnavailable} />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050505]/35 to-[#050505]/85" />
        </Suspense>
      )}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            'repeating-radial-gradient(circle at 17% 23%, rgba(255,255,255,0.34) 0 0.55px, transparent 0.8px 3px)',
          backgroundSize: '5px 5px',
        }}
      />
    </div>
  );
}
