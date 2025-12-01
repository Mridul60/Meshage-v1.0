import { useState, useEffect, useRef } from 'react';
import { StorageService } from '../../../utils/storage';
import type { Message } from '../../../types';
import { routingService } from '../../../services/RoutingService';
import type { DataPacket } from '../../../types/routing';
import { NodeIdentity } from '../../../services/NodeIdentity';
import { ChatEvents } from '../../../services/ChatEvents';

interface UsePersonalChatProps {
  friendId: string;
  friendName: string;
  friendAddress?: string;
}

export const usePersonalChat = ({ friendId, friendName, friendAddress }: UsePersonalChatProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectedPeerAddresses, setConnectedPeerAddresses] = useState<string[]>([]);
  const [connectedPeerIds, setConnectedPeerIds] = useState<Map<string, string>>(new Map()); // address -> persistentId
  const [myPersistentId, setMyPersistentId] = useState<string>('');
  const [myUsername, setMyUsername] = useState<string>('User');
  const messagesEndRef = useRef<any>(null);

  // Load user data and chat history
  useEffect(() => {
    const loadUserData = async () => {
      const persistentId = await StorageService.getPersistentId();
      setMyPersistentId(persistentId);

      const username = await StorageService.getUsername();
      setMyUsername(username || 'User');

      // Initialize global nodeId if not already set
      const existingNodeId = NodeIdentity.tryGetNodeId();
      if (!existingNodeId) {
        const nodeId = `${username || 'User'}|${persistentId}`;
        NodeIdentity.setNodeId(nodeId);
      }

      // Load chat history for this friend
      const history = await StorageService.getChatHistory(friendId);
      if (history.length > 0) {
        setMessages(history);
        const lastTimestamp = history[history.length - 1]?.timestamp;
        if (lastTimestamp) {
          StorageService.markChatAsRead(friendId, lastTimestamp);
        }
        ChatEvents.emitHistoryUpdated(friendId, history as Message[]);
        console.log(`Loaded ${history.length} messages from history for friend: ${friendId}`);
      }
    };
    loadUserData();
  }, [friendId]);

  // Check connection status
  useEffect(() => {
    const checkConnection = () => {
      // Check if friend is connected by either:
      // 1. Device address match (if we have friendAddress)
      // 2. Persistent ID match (check all connected peers)
      const isConnectedByAddress = friendAddress && connectedPeerAddresses.includes(friendAddress);
      const isConnectedById = Array.from(connectedPeerIds.values()).includes(friendId);

      const connected = isConnectedByAddress || isConnectedById;
      setIsConnected(connected);

      console.log('PersonalChat - Connection check:', {
        friendId,
        friendAddress,
        connectedPeerAddresses,
        connectedPeerIds: Array.from(connectedPeerIds.entries()),
        isConnectedByAddress,
        isConnectedById,
        finalStatus: connected
      });
    };
    checkConnection();
  }, [connectedPeerAddresses, connectedPeerIds, friendAddress, friendId]);

  // Listen to routed DATA packets from RoutingService
  useEffect(() => {
    const handler = (packet: DataPacket) => {
      try {
        // Only process packets delivered to us
        if (packet.destinationId !== myPersistentId) {
          return;
        }

        const payload: any = packet.payload;
        if (!payload || payload.kind !== 'DIRECT_MSG') {
          return;
        }

        // Ensure this message is for this particular chat (from this friend)
        if (packet.sourceId !== friendId) {
          return;
        }

        const messageContent: string = payload.text;

        const newMessage: Message = {
          id: packet.packetId,
          text: messageContent,
          fromAddress: packet.sourceId,
          senderName: friendName,
          timestamp: packet.timestamp,
          isSent: false,
        };

        setMessages(prev => {
          const isDuplicate = prev.some(msg => msg.id === newMessage.id);
          if (isDuplicate) {
            console.log('PersonalChat - Duplicate routed message detected, skipping');
            return prev;
          }

          const updated = [...prev, newMessage];
          StorageService.saveChatHistory(friendId, updated);
          StorageService.markChatAsRead(friendId, newMessage.timestamp);
          ChatEvents.emitHistoryUpdated(friendId, updated);
          return updated;
        });
        console.log('✅ PersonalChat - Received routed DIRECT_MSG for this chat:', messageContent);
      } catch (error) {
        console.error('PersonalChat - Error handling routed DataPacket:', error);
      }
    };

    routingService.addDataHandler(handler);
    return () => {
      routingService.removeDataHandler(handler);
    };
  }, [friendId, friendName, myPersistentId]);

  const handleSendMessage = () => {
    if (!messageText.trim()) return;

    const newMessage: Message = {
      id: `${Date.now()}-sent`,
      text: messageText,
      fromAddress: 'me',
      senderName: myUsername,
      timestamp: Date.now(),
      isSent: true,
    };

    setMessages(prev => {
      const updated = [...prev, newMessage];
      // Save to storage
      StorageService.saveChatHistory(friendId, updated);
      StorageService.markChatAsRead(friendId, newMessage.timestamp);
      ChatEvents.emitHistoryUpdated(friendId, updated);
      return updated;
    });

    // Use the RoutingService to send a unicast DIRECT_MSG to this friend
    const payload = {
      kind: 'DIRECT_MSG',
      text: messageText,
      timestamp: Date.now(),
    };

    routingService.sendData(friendId, payload);
    console.log('PersonalChat - Sending routed DIRECT_MSG to friend:', friendId);

    setMessageText('');

    setTimeout(() => {
      messagesEndRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  return {
    messages,
    messageText,
    isConnected,
    messagesEndRef,
    setMessageText,
    handleSendMessage,
  };
};
