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
    <>
      <div className="absolute top-[-20%] left-[10%] h-[600px] w-[600px] rounded-full bg-netease-red/5 blur-[140px] mix-blend-screen" />
      <div className="absolute bottom-[-10%] right-[10%] h-[500px] w-[500px] rounded-full bg-purple-600/5 blur-[120px] mix-blend-screen" />
    </>
  );
}

/** 首页背景：React Bits Aurora。 */
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
      {enabled && !paused && !overloaded ? (
        <Suspense fallback={<StaticGlow />}>
          <div className="absolute inset-0 opacity-[0.68]">
            <Aurora colorStops={BRAND_STOPS} amplitude={1.05} blend={0.62} speed={0.55} onUnavailable={handleUnavailable} />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050505]/35 to-[#050505]/85" />
        </Suspense>
      ) : (
        <StaticGlow />
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
