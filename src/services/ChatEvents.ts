import type { Message } from '../types';

export interface ChatHistoryUpdate {
  friendId: string;
  messages: Message[];
}

type ChatHistoryListener = (update: ChatHistoryUpdate) => void;

class ChatEventBus {
  private listeners = new Set<ChatHistoryListener>();

  subscribe(listener: ChatHistoryListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitHistoryUpdated(friendId: string, messages: Message[]) {
    const payload: ChatHistoryUpdate = { friendId, messages };
    this.listeners.forEach(listener => {
      try {
        listener(payload);
      } catch (error) {
        console.error('ChatEventBus listener error:', error);
      }
    });
  }
}

export const ChatEvents = new ChatEventBus();
