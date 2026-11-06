import { useEffect, useState } from 'react';
import {
  getSongPreviewState,
  subscribeSongPreview,
  type SongPreviewState,
} from '../lib/songPreviewPlayer';

const IDLE_PREVIEW_STATE: SongPreviewState = {
  key: null,
  status: 'idle',
  error: null,
  currentTime: 0,
  duration: 0,
};

function resolveTargetPreviewState(targetKey?: string): SongPreviewState {
  const current = getSongPreviewState();
  if (!targetKey) return current;
  return current.key === targetKey ? current : IDLE_PREVIEW_STATE;
}

function samePreviewState(a: SongPreviewState, b: SongPreviewState): boolean {
  return a === b || (
    a.key === b.key
    && a.status === b.status
    && a.error === b.error
    && a.currentTime === b.currentTime
    && a.duration === b.duration
  );
}

/** 订阅全局试听播放器状态；传入 targetKey 时仅在关联到该曲目时触发重渲染 */
export function useSongPreviewState(targetKey?: string): SongPreviewState {
  const [state, setState] = useState<SongPreviewState>(() => resolveTargetPreviewState(targetKey));

  useEffect(() => {
    const sync = () => {
      const next = resolveTargetPreviewState(targetKey);
      setState((prev) => (samePreviewState(prev, next) ? prev : next));
    };
    sync();
    return subscribeSongPreview(sync);
  }, [targetKey]);

  return state;
}
