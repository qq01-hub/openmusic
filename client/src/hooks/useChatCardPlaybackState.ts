import { useEffect, useState } from 'react';
import {
  getChatCardPlaybackState,
  subscribeChatCardPlayback,
  type ChatCardPlaybackState,
} from '../lib/chatCardPlayer';

/** 订阅聊天音乐卡片的全局播放状态（卡片状态只在播放/暂停/结束时变化） */
export function useChatCardPlaybackState(): ChatCardPlaybackState {
  const [state, setState] = useState<ChatCardPlaybackState>(getChatCardPlaybackState);

  useEffect(() => {
    setState(getChatCardPlaybackState());
    return subscribeChatCardPlayback(() => setState(getChatCardPlaybackState()));
  }, []);

  return state;
}