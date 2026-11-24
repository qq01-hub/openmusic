import { useEffect, useState } from 'react';

export type VisualBackgroundPolicy = 'keep' | 'pause' | 'release';
export type VisualForegroundFpsMode = 'vsync' | 'adaptive' | '45' | '60' | '75' | '90' | '120';

const VISIBLE_POLICY = {
  mounted: true,
  frameloop: 'always' as const,
  targetFps: 0,
};

const HIDDEN_POLICY = {
  mounted: true,
  frameloop: 'never' as const,
  targetFps: 0,
};

let electronWindowHidden = false;
const hostVisibilityListeners = new Set<() => void>();
let hostVisibilityWired = false;

function notifyHostVisibility() {
  hostVisibilityListeners.forEach((listener) => listener());
}

function ensureHostVisibilityListeners() {
  if (hostVisibilityWired || typeof window === 'undefined') return;
  hostVisibilityWired = true;
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', notifyHostVisibility);
  }
  window.electronAPI?.onWindowVisibilityChange?.((visible) => {
    const nextHidden = !visible;
    if (electronWindowHidden === nextHidden) return;
    electronWindowHidden = nextHidden;
    notifyHostVisibility();
  });
}

export function isHostPageHidden(): boolean {
  ensureHostVisibilityListeners();
  if (typeof document !== 'undefined' && document.hidden) return true;
  return electronWindowHidden;
}

export function subscribeHostVisibility(listener: () => void): () => void {
  ensureHostVisibilityListeners();
  hostVisibilityListeners.add(listener);
  return () => {
    hostVisibilityListeners.delete(listener);
  };
}

export function useVisualRenderPolicy(_isPlaying: boolean) {
  const [hidden, setHidden] = useState(() => isHostPageHidden());

  useEffect(() => {
    setHidden(isHostPageHidden());
    return subscribeHostVisibility(() => {
      setHidden(isHostPageHidden());
    });
  }, []);

  return hidden ? HIDDEN_POLICY : VISIBLE_POLICY;
}
