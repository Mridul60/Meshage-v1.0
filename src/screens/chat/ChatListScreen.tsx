import React, { useMemo } from 'react';
import {
  Text,
  StyleSheet,
  FlatList,
  View,
  TouchableOpacity,
} from 'react-native';
import ChatItem from './ChatItem';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types/navigation';
import { useChatList } from './useChatList';

type ChatListNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Main'>;

const ChatScreen: React.FC = () => {
  const navigation = useNavigation<ChatListNavigationProp>();
  const { chats, isLoading } = useChatList();

  const unreadCount = useMemo(() => {
    return chats.reduce((total, chat) => total + chat.unreadCount, 0);
  }, [chats]);

  const handleChatItemPress = (chat: typeof chats[number]) => {
    navigation.navigate('ChatDetail', {
      contactName: chat.name,
      contactId: chat.friendId,
    });
  };

  const renderChatItem = ({ item }: { item: typeof chats[number] }) => {
    const lastMessageText = item.lastMessage?.text || '';
    const timestamp = item.lastMessage?.timestamp;
    const timeLabel = timestamp ? new Date(timestamp).toLocaleTimeString() : '';

    const initials = item.name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    return (
      <ChatItem
        name={item.name}
        message={lastMessageText}
        time={timeLabel}
        avatar={initials}
        isRead={item.unreadCount === 0}
        onPress={() => handleChatItemPress(item)}
        unreadCount={item.unreadCount}
      />
    );
  };

  const handleFriendsPageButton = () => {
    navigation.navigate('Friends');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.chatsHeader}>
          <Text style={styles.chatsTitle}>Chats</Text>
          <View style={styles.unreadContainer}>
            <Text style={styles.unreadText}>Unread messages</Text>
            <Text style={styles.unreadCount}>{unreadCount}</Text>
          </View>
        </View>

        <FlatList
          data={chats}
          renderItem={renderChatItem}
          keyExtractor={item => item.friendId}
          style={styles.chatList}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.chatListContent}
          ListEmptyComponent={
            isLoading ? (
              <Text style={styles.emptyText}>Loading chats...</Text>
            ) : (
              <Text style={styles.emptyText}>No conversations yet. Start messaging a friend!</Text>
            )
          }
        />
      </View>

      <TouchableOpacity
        style={styles.fab}
        onPress={handleFriendsPageButton}
        activeOpacity={0.8}
      >
        <Ionicons name="people" size={28} color="#000" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E5E5E5',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  chatsHeader: {
    paddingTop: 16,
    paddingBottom: 8,
  },
  chatsTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  unreadContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unreadText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  unreadCount: {
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: '#F59E0B',
    color: '#000',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  chatList: {
    flex: 1,
  },
  chatListContent: {
    paddingBottom: 100,
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 24,
    fontSize: 14,
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 14,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
});

export default ChatScreen;