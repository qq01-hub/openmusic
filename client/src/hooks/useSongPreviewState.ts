import { useEffect, useState } from 'react';
import {
  getSongPreviewState,
  subscribeSongPreview,
  type SongPreviewState,
} from '../lib/songPreviewPlayer';

/** 订阅全局试听播放器状态；传入 targetKey 时仅在关联到该曲目时触发重渲染 */
export function useSongPreviewState(targetKey?: string): SongPreviewState {
  const [state, setState] = useState<SongPreviewState>(getSongPreviewState);

  useEffect(() => {
    setState(getSongPreviewState());
    return subscribeSongPreview(() => {
      const next = getSongPreviewState();
      setState((prev) => {
        if (!targetKey) return next;
        const wasTarget = prev.key === targetKey;
        const isTarget = next.key === targetKey;
        if (!wasTarget && !isTarget) return prev;
        return next;
      });
    });
  }, [targetKey]);

  return state;
}
