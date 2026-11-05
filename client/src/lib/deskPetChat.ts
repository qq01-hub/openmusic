import type { AiProcessingTask } from '../stores/chatStore';
import type { ChatMessage } from '../types';
import { isVerifiedAiBotMessage } from './chatAi';

export function getDeskPetThinkingTask(tasks: AiProcessingTask[], userId: string | null) {
  if (!userId) return undefined;
  return tasks.find((task) => task.userId === userId
    && (task.status === 'queued' || task.status === 'processing'));
}

export function getDeskPetReply(messages: ChatMessage[], userId: string | null) {
  if (!userId) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (isVerifiedAiBotMessage(message) && message.replyTo?.userId === userId && message.text) {
      return message;
    }
  }
  return null;
}
