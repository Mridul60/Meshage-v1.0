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
      console.log('[usePersonalChat] Loading user data for chat', friendId);
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
        console.log('[usePersonalChat] Loaded chat history', {
          friendId,
          count: history.length,
        });
      }
      console.log('[usePersonalChat] User data ready', { friendId, persistentId, username });
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
          console.log('[usePersonalChat] Ignoring packet for different destination', {
            friendId,
            destinationId: packet.destinationId,
            myPersistentId,
          });
          return;
        }

        const payload: any = packet.payload;
        if (!payload || payload.kind !== 'DIRECT_MSG') {
          console.log('[usePersonalChat] Ignoring non-DIRECT_MSG payload', payload?.kind);
          return;
        }

        // Ensure this message is for this particular chat (from this friend)
        if (packet.sourceId !== friendId) {
          console.log('[usePersonalChat] Packet from different friend, skipping', {
            expected: friendId,
            actual: packet.sourceId,
          });
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
            console.log('[usePersonalChat] Duplicate message detected, skipping', newMessage.id);
            return prev;
          }

          const updated = [...prev, newMessage];
          StorageService.saveChatHistory(friendId, updated);
          StorageService.markChatAsRead(friendId, newMessage.timestamp);
          ChatEvents.emitHistoryUpdated(friendId, updated);
          console.log('[usePersonalChat] Stored incoming message', {
            friendId,
            packetId: packet.packetId,
            timestamp: newMessage.timestamp,
          });
          return updated;
        });
        console.log('[usePersonalChat] Received DIRECT_MSG for chat', {
          friendId,
          packetId: packet.packetId,
          text: messageContent,
        });
      } catch (error) {
        console.error('[usePersonalChat] Error handling routed DataPacket:', error);
      }
    };

    routingService.addDataHandler(handler);
    console.log('[usePersonalChat] Registered data handler for chat', friendId);
    return () => {
      routingService.removeDataHandler(handler);
      console.log('[usePersonalChat] Removed data handler for chat', friendId);
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

    console.log('[usePersonalChat] Sending DIRECT_MSG', {
      friendId,
      text: messageText,
    });
    routingService.sendData(friendId, payload);

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
