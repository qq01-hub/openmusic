import { useCallback, useSyncExternalStore } from 'react';
import {
  getChatCardPlaybackState,
  subscribeChatCardPlayback,
  type ChatCardPlaybackState,
} from '../lib/chatCardPlayer';

/** 仅活跃卡片接收进度变化，其余卡片复用空闲快照 */
export function useChatCardPlaybackState(cardKey?: string): ChatCardPlaybackState {
  const getSnapshot = useCallback(() => getChatCardPlaybackState(cardKey), [cardKey]);
  return useSyncExternalStore(subscribeChatCardPlayback, getSnapshot, getSnapshot);
}
