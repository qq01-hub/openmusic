import type { ChatMessage } from '../types';
import { compactReplyText, compactSongCardsText, hasMentionAllInText, hasMentionInText } from './chatPanelUtils';

interface ChatNotificationContext {
  roomId: string;
  roomName?: string;
  userIds: string[];
  nickname: string;
  allMessages: boolean;
  isCurrent?: () => boolean;
}

/** 只从用户点击开关的操作请求权限，普通消息不会反复弹出授权请求 */
export async function requestChatNotificationPermission(): Promise<string | null> {
  if (typeof Notification === 'undefined') return '当前浏览器不支持消息通知，请使用支持通知的浏览器';
  if (typeof window !== 'undefined' && !window.isSecureContext) return '浏览器通知需要安全连接，请通过 HTTPS 打开本站';
  try {
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission === 'granted') return null;
    return permission === 'denied'
      ? '浏览器已阻止通知，请在本站的浏览器权限设置中允许通知后重试'
      : '尚未允许浏览器通知，请再次开启并完成授权';
  } catch {
    return '无法开启浏览器通知，请检查本站的通知权限后重试';
  }
}

/** 仅由实时消息入库路径调用，历史加载、重绘和纯净模式抽屉不参与通知判断 */
export async function notifyChatMessage(message: ChatMessage, context: ChatNotificationContext): Promise<void> {
  if (!context.roomId || !context.userIds.length || typeof Notification === 'undefined') return;
  if (context.isCurrent && !context.isCurrent()) return;
  if (message.kind && message.kind !== 'chat' && message.kind !== 'ai_bot') return;
  if (context.userIds.includes(message.userId)) return;
  const mentioned = message.mentions?.some((mention) => context.userIds.includes(mention.id))
    || (context.nickname.trim() && hasMentionInText(message.text, context.nickname.trim()))
    || hasMentionAllInText(message.text);
  if (!context.allMessages && !mentioned) return;
  try {
    // 保留既有 @ 提醒的授权流程，所有消息开关则在点击时完成授权
    if (mentioned && Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted' || (context.isCurrent && !context.isCurrent())) return;
    const title = mentioned
      ? `${message.nickname} 提到了你`
      : `${context.roomName || '聊天室'} · ${message.nickname}`;
    const notification = new Notification(title, {
      body: compactReplyText(message.text, message.imageUrl, message.imageKey, message.asSticker)
        || compactSongCardsText(message.songs),
      tag: `openmusic-chat-${context.roomId}-${message.id}`,
      silent: false,
    });
    notification.onclick = () => { window.focus(); notification.close(); };
  } catch {
    // WebView 或浏览器拒绝通知时仍正常接收和显示聊天消息
  }
}
