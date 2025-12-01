import React from 'react';

import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    Animated,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { Send } from 'lucide-react-native';

import NearbyDevicesModal from './NearbyDevicesModal';
import { useBroadcastScreen } from './useBroadcastScreen';
import type { Peer, Message, FriendRequest } from '../../types';

interface BroadcastScreenProps {
    navigation: any;
}

export default function BroadcastScreen({ navigation }: BroadcastScreenProps) {
    const {
        status,
        peers,
        connectedPeers,
        messages,
        messageText,
        showDevicesModal,
        messagesEndRef,
        setMessageText,
        setShowDevicesModal,
        handleSendMessage,
        handleAddFriend,
        isFriend,
        friendRequests,
        handleAcceptFriendRequest,
        handleRejectFriendRequest,
    } = useBroadcastScreen();

    const handleDevicesPress = () => {
        setShowDevicesModal(true);
    };

    const handleMessage = (deviceId: string) => {
        const peer = peers.find(p => p.deviceAddress === deviceId);
        if (!peer || !peer.persistentId) {
            console.warn('Cannot open chat - peer missing persistentId', peer);
            setShowDevicesModal(false);
            return;
        }

        const contactName = peer.displayName || peer.deviceName || 'Unknown';

        // Close the PAB first so the transition feels immediate
        setShowDevicesModal(false);

        navigation.navigate('ChatDetail', {
            contactName,
            contactId: peer.persistentId,
        });
    };

    // Transform peers to match NearbyDevicesModal format
    const devicesForModal = peers.map((peer: Peer) => ({
        id: peer.deviceAddress,
        name: peer.displayName || peer.deviceName,
        isFriend: isFriend(peer.persistentId),
        // connectedPeers is a list of connected device addresses
        isConnected: connectedPeers.includes(peer.deviceAddress),
    }));

    const [showRequests, setShowRequests] = React.useState(false);
    const [requestsVisible, setRequestsVisible] = React.useState(false);
    const requestsTranslateY = React.useRef(new Animated.Value(200)).current;
    const requestsBackdropOpacity = React.useRef(new Animated.Value(0)).current;
    const pendingRequestsCount = friendRequests.filter((r: FriendRequest) => r.type === 'incoming').length;

    React.useEffect(() => {
        if (showRequests) {
            setRequestsVisible(true);
            Animated.parallel([
                Animated.spring(requestsTranslateY, {
                    toValue: 0,
                    useNativeDriver: true,
                    tension: 65,
                    friction: 11,
                }),
                Animated.timing(requestsBackdropOpacity, {
                    toValue: 1,
                    duration: 250,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(requestsTranslateY, {
                    toValue: 200,
                    duration: 200,
                    useNativeDriver: true,
                }),
                Animated.timing(requestsBackdropOpacity, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setRequestsVisible(false);
            });
        }
    }, [showRequests]);

    return (
        <View style={styles.container}>
            {/* STATUS BAR */}
            <View style={styles.statusBar}>
                <Text style={styles.statusLabel}>Broadcast Status:</Text>
                <Text style={styles.statusValue}>{status}</Text>
                <View style={styles.statusRight}>
                    <TouchableOpacity
                        onPress={handleDevicesPress}
                        activeOpacity={0.7}
                        style={styles.statusDotWrapper}
                    >
                        <View style={[
                            styles.statusDot,
                            connectedPeers.length > 0 && styles.statusDotConnected
                        ]} />
                        <Text style={[
                            styles.statusCount,
                            connectedPeers.length > 0 && styles.statusCountConnected
                        ]}>
                            {peers.length}
                        </Text>
                    </TouchableOpacity>

                    {pendingRequestsCount > 0 && (
                        <TouchableOpacity
                            onPress={() => setShowRequests(true)}
                            activeOpacity={0.7}
                        >
                            <View style={styles.notificationBadge}>
                                <Text style={styles.notificationText}>
                                    {pendingRequestsCount > 9 ? '9+' : pendingRequestsCount}
                                </Text>
                            </View>
                        </TouchableOpacity>
                    )}
                </View>

            </View>

            {/* CHAT MESSAGES */}
            <KeyboardAvoidingView
                style={styles.flexContainer}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
            >
                <ScrollView
                    ref={messagesEndRef}
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    onContentSizeChange={() =>
                        messagesEndRef.current?.scrollToEnd({ animated: true })
                    }
                >
                    {messages.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>
                                {connectedPeers.length > 0
                                    ? 'No messages yet. Start broadcasting!'
                                    : 'Waiting for peers to connect\nDiscovering nearby devices...'}
                            </Text>
                        </View>
                    ) : (
                        messages.map((msg: Message) => (
                            <View
                                key={msg.id}
                                style={[
                                    styles.messageRow,
                                    msg.isSent ? styles.sentRow : styles.receivedRow,
                                ]}
                            >
                                {!msg.isSent && <View style={styles.avatar} />}
                                <View style={styles.messageContainer}>
                                    {!msg.isSent && (
                                        <Text style={styles.senderName}>
                                            {msg.senderName || 'Unknown'}
                                        </Text>
                                    )}
                                    <View
                                        style={[
                                            styles.messageBubble,
                                            msg.isSent
                                                ? styles.sentBubble
                                                : styles.receivedBubble,
                                        ]}
                                    >
                                        <Text style={styles.messageText}>{msg.text}</Text>
                                    </View>
                                    <Text style={styles.messageTime}>
                                        {new Date(msg.timestamp).toLocaleTimeString()}
                                    </Text>
                                </View>
                                {msg.isSent && <View style={styles.avatar} />}
                            </View>
                        ))
                    )}
                </ScrollView>

                {/* INPUT BAR */}
                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        placeholder="Enter your message"
                        placeholderTextColor="#888"
                        value={messageText}
                        onChangeText={setMessageText}
                        onSubmitEditing={handleSendMessage}
                        returnKeyType="send"
                    />
                    <TouchableOpacity
                        style={[
                            styles.sendButton,
                            !messageText.trim() && styles.sendButtonDisabled
                        ]}
                        onPress={handleSendMessage}
                        disabled={!messageText.trim()}
                    >
                        <Send size={20} color="#000" />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>

            {/* NEARBY DEVICES MODAL */}
            <NearbyDevicesModal
                visible={showDevicesModal}
                onClose={() => setShowDevicesModal(false)}
                devices={devicesForModal}
                onMessage={handleMessage}
                onAddFriend={handleAddFriend}
            />

            {/* FRIEND REQUESTS OVERLAY */}
            {requestsVisible && (
                <Animated.View style={[styles.requestsOverlay, { opacity: requestsBackdropOpacity }]}>
                    <Animated.View style={[styles.requestsCard, { transform: [{ translateY: requestsTranslateY }] }]}>
                        <View style={styles.requestsDragHandleContainer}>
                            <View style={styles.requestsDragHandle} />
                        </View>
                        <View style={styles.requestsHeader}>
                            <View style={styles.requestsHeaderTextContainer}>
                                <Text style={styles.requestsTitle}>
                                    Friend Requests{pendingRequestsCount > 0 ? ` (${pendingRequestsCount})` : ''}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.requestsCloseIcon}
                                onPress={() => setShowRequests(false)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="close" size={24} color="#F59E0B" />
                            </TouchableOpacity>
                        </View>

                        {friendRequests.filter((r: FriendRequest) => r.type === 'incoming').length === 0 ? (
                            <Text style={styles.requestsEmpty}>No pending requests</Text>
                        ) : (
                            friendRequests
                                .filter((r: FriendRequest) => r.type === 'incoming')
                                .map((request: FriendRequest) => (
                                    <View key={request.persistentId} style={styles.requestItem}>
                                        <View style={styles.requestInfo}>
                                            <Text style={styles.requestName}>{request.displayName}</Text>

                                            <Text style={styles.requestId}>
                                                ID · {(request.persistentId || '').split('-')[0]}
                                            </Text>
                                        </View>
                                        <View style={styles.requestActions}>
                                            <TouchableOpacity
                                                style={styles.requestAccept}
                                                onPress={async () => {
                                                    await handleAcceptFriendRequest(request);
                                                }}
                                            >
                                                <Text style={styles.requestAcceptText}>Accept</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={styles.requestReject}
                                                onPress={async () => {
                                                    await handleRejectFriendRequest(request);
                                                }}
                                            >
                                                <Ionicons name="trash" size={16} color="#000" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                ))
                        )}
                    </Animated.View>
                </Animated.View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#E5E5E5',
    },
    flexContainer: {
        flex: 1,
    },
    statusBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F5F5F5',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#000',
    },
    statusLabel: {
        fontSize: 12,
        color: '#000',
        fontWeight: '600',
    },
    statusValue: {
        fontSize: 12,
        color: '#000',
        fontWeight: '700',
        marginLeft: 4,
    },
    statusRight: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 12,
    },
    statusDotWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    statusDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#EF4444',
        borderWidth: 1,
        borderColor: '#000',
    },
    statusDotConnected: {
        backgroundColor: '#22C55E',
    },
    statusCount: {
        fontSize: 12,
        color: '#EF4444',
        fontWeight: '700',
    },
    statusCountConnected: {
        color: '#22C55E',
    },
    notificationBadge: {
        marginLeft: 6,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#F59E0B',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
        borderWidth: 1,
        borderColor: '#000',
    },
    notificationText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#000',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexGrow: 1,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyText: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        lineHeight: 20,
    },
    messageRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginBottom: 24,
    },
    sentRow: {
        justifyContent: 'flex-end',
    },
    receivedRow: {
        justifyContent: 'flex-start',
    },
    avatar: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#000',
    },
    messageContainer: {
        marginHorizontal: 10,
        maxWidth: '70%',
    },
    senderName: {
        fontSize: 11,
        color: '#666',
        marginBottom: 4,
        marginLeft: 4,
    },
    messageBubble: {
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderWidth: 1,
        borderColor: '#000',
        backgroundColor: '#FFF',
    },
    receivedBubble: {
        transform: [{ skewX: '-10deg' }],
    },
    sentBubble: {
        transform: [{ skewX: '10deg' }],
    },
    messageText: {
        color: '#000',
        fontSize: 14,
        transform: [{ skewX: '0deg' }],
    },
    messageTime: {
        fontSize: 10,
        color: '#888',
        marginTop: 4,
        marginLeft: 4,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    },
    input: {
        flex: 1,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#000',
        borderRadius: 20,
        paddingHorizontal: 16,
        height: 44,
        fontSize: 14,
        color: '#000',
    },
    sendButton: {
        width: 44,
        height: 44,
        marginLeft: 8,
        borderRadius: 22,
        backgroundColor: '#F59E0B',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#000',
    },
    sendButtonDisabled: {
        opacity: 0.5,
    },
    // Friend requests bottom sheet styles
    requestsOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    requestsCard: {
        width: '100%',
        maxHeight: '45%',
        backgroundColor: '#292929',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
        borderTopWidth: 1,
        borderColor: '#000',
    },
    requestsDragHandleContainer: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    requestsDragHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#FFFFFF',
        borderRadius: 2,
        opacity: 0.9,
    },
    requestsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 8,
    },
    requestsHeaderTextContainer: {
        flex: 1,
    },
    requestsCloseIcon: {
        padding: 4,
        marginLeft: 12,
    },
    requestsTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#E5E1DE',
        marginBottom: 4,
    },
    requestsSubtitle: {
        fontSize: 12,
        color: '#A3A3A3',
        marginBottom: 10,
    },
    requestsEmpty: {
        fontSize: 13,
        color: '#AAA',
        marginBottom: 12,
    },
    requestItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFF',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 8,
    },
    requestInfo: {
        flexShrink: 1,
        paddingRight: 8,
    },
    requestName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#000',
    },
    requestId: {
        fontSize: 11,
        color: '#666',
    },
    requestActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    requestAccept: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: '#F59E0B',
        borderWidth: 1,
        borderColor: '#000',
    },
    requestAcceptText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#000',
    },
    requestReject: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#EF4444',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#000',
    },
    requestsClose: {
        marginTop: 12,
        alignSelf: 'flex-end',
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: '#F5F5F5',
        borderWidth: 1,
        borderColor: '#000',
    },
    requestsCloseText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#000',
    },
});