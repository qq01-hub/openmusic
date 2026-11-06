import { useEffect, useState } from 'react';
import {
  getChatCardPlaybackState,
  subscribeChatCardPlayback,
  type ChatCardPlaybackState,
} from '../lib/chatCardPlayer';

const IDLE_CHAT_CARD_STATE: ChatCardPlaybackState = {
  messageId: null,
  cardKey: null,
  trackKey: null,
  song: null,
  status: 'idle',
  error: null,
  positionSec: 0,
  durationSec: 0,
  lyrics: [],
};

function resolveTargetCardState(targetCardKey?: string | null): ChatCardPlaybackState {
  const current = getChatCardPlaybackState();
  if (!targetCardKey) return current;
  return current.cardKey === targetCardKey ? current : IDLE_CHAT_CARD_STATE;
}

/** 订阅聊天音乐卡片的全局播放状态；传入 targetCardKey 时仅当前卡片响应进度更新 */
export function useChatCardPlaybackState(targetCardKey?: string | null): ChatCardPlaybackState {
  const [state, setState] = useState<ChatCardPlaybackState>(() => resolveTargetCardState(targetCardKey));

  useEffect(() => {
    const sync = () => {
      const next = resolveTargetCardState(targetCardKey);
      setState((prev) => (prev === next ? prev : next));
    };
    sync();
    return subscribeChatCardPlayback(sync);
  }, [targetCardKey]);

  return state;
}