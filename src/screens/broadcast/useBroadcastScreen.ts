/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from 'react';
import {
    PermissionsAndroid,
    Platform,
} from 'react-native';

import type {
    Peer,
    Message,
    DiscoveryEvent,
    ConnectionInfo,
    MessageReceivedEvent,
    FriendRequest,
} from '../../types';
import { StorageService } from '../../utils/storage';
import { Nearby } from '../../services/Nearby';
import { NodeIdentity, NodeMessage } from '../../services/NodeIdentity';

// Parse device identifier "username|persistentId"
const parseDeviceIdentifier = (deviceName: string): { displayName: string; persistentId?: string } => {
    const parts = deviceName.split('|');
    if (parts.length === 2) {
        return {
            displayName: parts[0],
            persistentId: parts[1],
        };
    }
    return {
        displayName: deviceName,
        persistentId: undefined,
    };
};

export const useBroadcastScreen = () => {
    const [status, setStatus] = useState<string>('DISCONNECTED');
    const [peers, setPeers] = useState<Peer[]>([]);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageText, setMessageText] = useState<string>('');
    const [username, setUsername] = useState<string>('User');
    const [persistentId, setPersistentId] = useState<string>('');
    const [friendsList, setFriendsList] = useState<Set<string>>(new Set());
    const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
    const [showDevicesModal, setShowDevicesModal] = useState<boolean>(false);
    const messagesEndRef = useRef<any>(null);
    const peersRef = useRef<Peer[]>([]);
    const nodeIdRef = useRef<string>('');
    const sessionIdRef = useRef<string>(NodeIdentity.getSessionId());

    const requestPermissions = async (): Promise<boolean> => {
        if (Platform.OS !== 'android') return true;

        const permissionsToRequest: Array<typeof PermissionsAndroid.PERMISSIONS[keyof typeof PermissionsAndroid.PERMISSIONS]> = [];

        if (Platform.Version >= 33) {
            permissionsToRequest.push(
                PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
            );
        } else if (Platform.Version >= 31) {
            permissionsToRequest.push(
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
            );
        } else {
            permissionsToRequest.push(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
            );
        }

        try {
            const granted = await PermissionsAndroid.requestMultiple(permissionsToRequest);
            const anyGranted = Object.values(granted).some(
                r => r === PermissionsAndroid.RESULTS.GRANTED,
            );
            return anyGranted;
        } catch (err) {
            console.warn(err);
            return false;
        }
    };

    const updatePeers = (updater: (prev: Peer[]) => Peer[]) => {
        setPeers(prev => {
            const next = updater(prev);
            peersRef.current = next;
            return next;
        });
    };

    useEffect(() => {
        const initializeApp = async () => {
            // Load username and persistent ID
            const savedUsername = await StorageService.getUsername();
            const savedPersistentId = await StorageService.getPersistentId();

            const deviceIdentifier = savedUsername
                ? `${savedUsername}|${savedPersistentId}`
                : `User|${savedPersistentId}`;

            // Windsurf Node identity
            nodeIdRef.current = deviceIdentifier;

            if (savedUsername) {
                setUsername(savedUsername);
            }
            setPersistentId(savedPersistentId);

            // Load friends list
            const friends = await StorageService.getFriends();
            setFriendsList(new Set(friends.map(f => f.persistentId)));

            // Load friend requests
            const requests = await StorageService.getFriendRequests();
            setFriendRequests(requests);

            const hasPermission = await requestPermissions();
            if (!hasPermission) {
                setStatus('PERMISSION_REQUIRED');
                return;
            }

            setStatus('DISCOVERING');
            await Nearby.start(deviceIdentifier);
        };

        initializeApp();

        const subs = Nearby.addListeners({
            onEndpointFound: ({ id, name }) => {
                // SELF-FILTER for discovery: do not show or connect to our own nodeId
                if (name === nodeIdRef.current) {
                    return;
                }

                const { displayName, persistentId } = parseDeviceIdentifier(name);
                updatePeers(prev => {
                    const existingIndex = prev.findIndex(p => p.deviceAddress === id);
                    const nextPeer: Peer = {
                        deviceAddress: id,
                        deviceName: name,
                        status: 3,
                        displayName,
                        persistentId,
                    };
                    if (existingIndex >= 0) {
                        const copy = [...prev];
                        copy[existingIndex] = nextPeer;
                        return copy;
                    }
                    return [...prev, nextPeer];
                });

                // Auto-connect to discovered endpoints
                Nearby.connect(id).catch(() => { });
            },
            onEndpointLost: ({ id }) => {
                updatePeers(prev => prev.filter(p => p.deviceAddress !== id));
                setConnectedPeers(prev => prev.filter(p => p !== id));
            },
            onConnectionChanged: ({ id, connected }) => {
                setConnectedPeers(prev => {
                    let next: string[];
                    if (connected) {
                        next = [...new Set([...prev, id])];
                    } else {
                        next = prev.filter(p => p !== id);
                    }
                    setStatus(next.length > 0 ? 'CONNECTED' : 'DISCONNECTED');
                    return next;
                });
            },
            onMessageReceived: ({ fromId, message, timestamp }) => {
                console.log('[useBroadcastScreen] Raw Nearby message received', {
                    fromId,
                    length: message?.length,
                    timestamp,
                });

                // First try to parse as NodeMessage JSON (used for broadcast chat)
                let parsed: NodeMessage | null = null;
                try {
                    parsed = JSON.parse(message) as NodeMessage;
                } catch {
                    parsed = null;
                    console.log('[useBroadcastScreen] Message not JSON, falling back to legacy handling');
                }

                if (parsed && parsed.nodeId && parsed.sessionId) {
                    // SELF-FILTER: ignore any packet from our own nodeId
                    if (parsed.nodeId === nodeIdRef.current) {
                        console.log('[useBroadcastScreen] Ignoring self-originated broadcast packet');
                        return;
                    }

                    console.log('[useBroadcastScreen] Parsed NodeMessage payload', {
                        type: parsed.type,
                        payloadKind: (parsed.payload as any)?.kind,
                        nodeId: parsed.nodeId,
                    });

                    if (parsed.type === 'DATA' && parsed.payload) {
                        // Handle broadcast chat messages
                        if (parsed.payload.kind === 'BROADCAST_MESSAGE' && typeof parsed.payload.text === 'string') {
                            const peer = peersRef.current.find(p => p.deviceAddress === fromId);
                            const senderName = peer?.displayName || peer?.deviceName || 'Unknown';

                            const newMessage: Message = {
                                id: `${timestamp}-${fromId}`,
                                text: parsed.payload.text,
                                fromAddress: fromId,
                                senderName,
                                timestamp,
                                isSent: false,
                            };
                            setMessages(prev => [...prev, newMessage]);
                            console.log('[useBroadcastScreen] Stored incoming broadcast message', {
                                fromId,
                                senderName,
                                text: parsed.payload.text,
                            });
                            return;
                        }
                    }
                }

                // If we reach here, either JSON parsing failed or it wasn't a NodeMessage
                if (typeof message === 'string') {
                    // Handle raw friend request messages: "FRIEND_REQUEST:persistentId:username"
                    if (message.startsWith('FRIEND_REQUEST:')) {
                        console.log('[useBroadcastScreen] Handling FRIEND_REQUEST payload');
                        const parts = message.split(':', 3);
                        if (parts.length === 3) {
                            const senderPersistentId = parts[1];
                            const senderName = parts[2];

                            // Persist incoming friend request
                            StorageService.addFriendRequest({
                                persistentId: senderPersistentId,
                                displayName: senderName,
                                deviceAddress: fromId,
                                timestamp,
                                type: 'incoming',
                            }).catch(() => { });

                            // Update local state (deduplicate by persistentId)
                            setFriendRequests(prev => {
                                const filtered = prev.filter(r => r.persistentId !== senderPersistentId);
                                return [
                                    ...filtered,
                                    {
                                        persistentId: senderPersistentId,
                                        displayName: senderName,
                                        deviceAddress: fromId,
                                        timestamp,
                                        type: 'incoming' as const,
                                    },
                                ];
                            });
                        }
                    }

                    // Handle friend acceptance acknowledgement: "FRIEND_ACCEPT:persistentId:username"
                    if (message.startsWith('FRIEND_ACCEPT:')) {
                        console.log('[useBroadcastScreen] Handling FRIEND_ACCEPT payload');
                        const parts = message.split(':', 3);
                        if (parts.length === 3) {
                            const accepterPersistentId = parts[1];
                            const accepterName = parts[2];

                            // Persist new friend
                            StorageService.addFriend({
                                persistentId: accepterPersistentId,
                                displayName: accepterName,
                                deviceAddress: fromId,
                            }).catch(() => { });

                            // Update local friends set
                            setFriendsList(prev => new Set([...prev, accepterPersistentId]));

                            // Remove any pending friend request (incoming or outgoing) for this peer
                            StorageService.removeFriendRequest(accepterPersistentId).catch(() => { });
                            setFriendRequests(prev => prev.filter(r => r.persistentId !== accepterPersistentId));
                        }
                    }
                }
            },
        });

        return () => {
            subs.remove();
            Nearby.stop().catch(() => { });
        };
    }, []);

    const handleSendMessage = () => {
        if (!messageText.trim()) {
            console.log('[useBroadcastScreen] Ignoring empty broadcast send');
            return;
        }

        // Optimistically display the message in the UI
        const newMessage: Message = {
            id: `${Date.now()}-sent`,
            text: messageText,
            fromAddress: 'me',
            senderName: username,
            timestamp: Date.now(),
            isSent: true,
        };

        setMessages(prev => [...prev, newMessage]);
        console.log('[useBroadcastScreen] Sending broadcast message', {
            text: messageText,
            username,
        });
        const envelope: NodeMessage = {
            nodeId: nodeIdRef.current,
            sessionId: sessionIdRef.current,
            type: 'DATA',
            payload: {
                kind: 'BROADCAST_MESSAGE',
                text: messageText,
                timestamp: Date.now(),
            },
        };

        Nearby.sendMessage(JSON.stringify(envelope), null)
            .then(() => {
                console.log('[useBroadcastScreen] Broadcast message handed to Nearby');
            })
            .catch(error => {
                console.error('[useBroadcastScreen] Failed to send broadcast message', error);
            });
        setMessageText('');

        setTimeout(() => {
            messagesEndRef.current?.scrollToEnd({ animated: true });
        }, 100);
    };

    const handleAddFriend = async (deviceId: string) => {
        const peer = peers.find(p => p.deviceAddress === deviceId);
        if (!peer || !peer.persistentId) return;

        const friendRequestMessage = `FRIEND_REQUEST:${persistentId}:${username}`;
        // Send friend request via Nearby to this specific endpoint
        Nearby.sendMessage(friendRequestMessage, peer.deviceAddress).catch(() => { });

        await StorageService.addFriendRequest({
            persistentId: peer.persistentId,
            displayName: peer.displayName || peer.deviceName,
            deviceAddress: peer.deviceAddress,
            timestamp: Date.now(),
            type: 'outgoing',
        });

        setFriendRequests(prev => {
            const filtered = prev.filter(r => r.persistentId !== peer.persistentId);
            return [...filtered, {
                persistentId: peer.persistentId!,
                displayName: peer.displayName || peer.deviceName,
                deviceAddress: peer.deviceAddress,
                timestamp: Date.now(),
                type: 'outgoing' as const,
            }];
        });
    };

    const handleAcceptFriendRequest = async (request: FriendRequest) => {
        // Add the requester as our friend locally
        await StorageService.addFriend({
            persistentId: request.persistentId,
            displayName: request.displayName,
            deviceAddress: request.deviceAddress,
        });

        setFriendsList(prev => new Set([...prev, request.persistentId]));

        // Remove this request from storage and state
        await StorageService.removeFriendRequest(request.persistentId);
        setFriendRequests(prev => prev.filter(r => r.persistentId !== request.persistentId));

        // Send acknowledgement back so the original sender also adds us as a friend
        try {
            const acceptMessage = `FRIEND_ACCEPT:${persistentId}:${username}`;
            if (request.deviceAddress) {
                Nearby.sendMessage(acceptMessage, request.deviceAddress).catch(() => { });
            }
        } catch {
            // best-effort, ignore errors
        }
    };

    const handleRejectFriendRequest = async (request: FriendRequest) => {
        await StorageService.removeFriendRequest(request.persistentId);
        setFriendRequests(prev => prev.filter(r => r.persistentId !== request.persistentId));
    };

    const isFriend = (pid?: string): boolean => {
        if (!pid) return false;
        return friendsList.has(pid);
    };

    return {
        status,
        peers,
        connectedPeers,
        messages,
        messageText,
        username,
        showDevicesModal,
        friendRequests,
        messagesEndRef,
        setMessageText,
        setShowDevicesModal,
        handleSendMessage,
        handleAddFriend,
        handleAcceptFriendRequest,
        handleRejectFriendRequest,
        isFriend,
    };
};