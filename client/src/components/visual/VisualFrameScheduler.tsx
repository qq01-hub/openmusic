import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { isHostPageHidden, subscribeHostVisibility } from '../../hooks/useVisualRenderPolicy';

export default function VisualFrameScheduler({ fps }: { fps: number }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (fps <= 0) return;
    let frame = 0;
    let last = 0;
    const interval = 1000 / fps;
    const tick = (now: number) => {
      if (isHostPageHidden()) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
      if (now - last < interval) return;
      last = now - ((now - last) % interval);
      invalidate();
    };
    const sync = () => {
      if (isHostPageHidden()) {
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        return;
      }
      if (!frame) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    sync();
    const unsubscribe = subscribeHostVisibility(sync);
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fps, invalidate]);

  return null;
}
