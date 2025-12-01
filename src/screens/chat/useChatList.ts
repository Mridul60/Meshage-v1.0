import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StorageService } from '../../utils/storage';
import type { Friend, Message } from '../../types';
import { ChatEvents } from '../../services/ChatEvents';

export interface ChatListItem {
  friendId: string;
  name: string;
  lastMessage?: Message;
  unreadCount: number;
}

export const useChatList = () => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [chatCache, setChatCache] = useState<Record<string, Message[]>>({});
  const [readReceipts, setReadReceipts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  const loadFriends = useCallback(async () => {
    const storedFriends = await StorageService.getFriends();
    setFriends(storedFriends);
    return storedFriends;
  }, []);

  const loadChatsForFriends = useCallback(async (friendList: Friend[]) => {
    const entries = await Promise.all(
      friendList.map(async friend => {
        const history = await StorageService.getChatHistory(friend.persistentId);
        return [friend.persistentId, history] as const;
      })
    );
    setChatCache(Object.fromEntries(entries));
  }, []);

  const loadReadReceipts = useCallback(async () => {
    const receipts = await StorageService.getChatReadReceipts();
    setReadReceipts(receipts);
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const friendList = await loadFriends();
    await Promise.all([loadChatsForFriends(friendList), loadReadReceipts()]);
    setIsLoading(false);
  }, [loadFriends, loadChatsForFriends, loadReadReceipts]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = ChatEvents.subscribe(async ({ friendId, messages }) => {
      setChatCache(prev => ({
        ...prev,
        [friendId]: messages,
      }));
      setReadReceipts(prev => ({
        ...prev,
        [friendId]: messages[messages.length - 1]?.timestamp || prev[friendId] || 0,
      }));
      refreshRef.current?.();
    });
    return unsubscribe;
  }, []);

  const markChatAsRead = useCallback(async (friendId: string, timestamp?: number) => {
    const appliedTimestamp = timestamp ?? Date.now();
    await StorageService.markChatAsRead(friendId, appliedTimestamp);
    setReadReceipts(prev => ({
      ...prev,
      [friendId]: appliedTimestamp,
    }));
  }, []);

  const chatList = useMemo<ChatListItem[]>(() => {
    return friends
      .map(friend => {
        const history = chatCache[friend.persistentId] || [];
        const lastMessage = history[history.length - 1];
        const lastRead = readReceipts[friend.persistentId] || 0;
        const unreadCount = history.filter(msg => msg.timestamp > lastRead).length;

        return {
          friendId: friend.persistentId,
          name: friend.displayName,
          lastMessage,
          unreadCount,
        };
      })
      .filter(item => item.lastMessage)
      .sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
  }, [friends, chatCache, readReceipts]);

  return {
    chats: chatList,
    isLoading,
    refresh,
    markChatAsRead,
  };
};
