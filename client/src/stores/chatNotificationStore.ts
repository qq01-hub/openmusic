import { create } from 'zustand';

const STORAGE_KEY = 'openmusic:chat-notifications:v1';

function readAllMessages(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

interface ChatNotificationStore {
  allMessages: boolean;
  setAllMessages: (enabled: boolean) => void;
}

export const useChatNotificationStore = create<ChatNotificationStore>((set) => ({
  allMessages: readAllMessages(),
  setAllMessages: (enabled) => {
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch {
      // 存储不可用时仍允许当前页面使用个人设置
    }
    set({ allMessages: enabled });
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      useChatNotificationStore.setState({ allMessages: readAllMessages() });
    }
  });
}
