import { useState, useEffect, useRef } from 'react';
import {
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { StorageService } from '../../utils/storage';
import { routingService } from '../../services/RoutingService';
import { NodeIdentity, NodeMessage } from '../../services/NodeIdentity';
import { windsurfDiscovery } from '../../services/WindsurfDiscovery';
import type {
  Peer,
  Message,
  DiscoveryEvent,
  ConnectionInfo,
  MessageReceivedEvent,
  FriendRequest
} from '../../types';

const { MeshNetwork } = NativeModules;
const MeshNetworkEvents = new NativeEventEmitter(MeshNetwork);

// Utility function to parse device identifier "username|persistentId"
const parseDeviceIdentifier = (deviceName: string): { displayName: string; persistentId?: string } => {
  const parts = deviceName.split('|');

  if (parts.length === 2) {
    return {
      displayName: parts[0],
      persistentId: parts[1],
    };
  }

  // Fallback for devices without persistent ID (old format or other apps)
  return {
    displayName: deviceName,
    persistentId: undefined,
  };
};

export const useChatScreen = () => {
  const [status, setStatus] = useState<string>('Not Initialized');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isGroupOwner, setIsGroupOwner] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState<string>('');
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('User');
  const [showPeerModal, setShowPeerModal] = useState<boolean>(false);
  const [persistentId, setPersistentId] = useState<string>('');
  const [friendsList, setFriendsList] = useState<Set<string>>(new Set());
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const messagesEndRef = useRef<any>(null);
  const hasAutoStarted = useRef<boolean>(false);
  const connectionAttempts = useRef<Map<string, number>>(new Map());
  const connectionRetryTimers = useRef<Map<string, any>>(new Map());

  const requestPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    const permissionsToRequest: Array<typeof PermissionsAndroid.PERMISSIONS[keyof typeof PermissionsAndroid.PERMISSIONS]> = [];

    if (Platform.Version >= 33) {
      // Android 13+
      permissionsToRequest.push(
        PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      );
    } else if (Platform.Version >= 31) {
      // Android 12
      permissionsToRequest.push(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
    } else {
      // Android 11 and below
      permissionsToRequest.push(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      );
    }

    try {
      const granted = await PermissionsAndroid.requestMultiple(permissionsToRequest);
      const allGranted = Object.values(granted).every(
        r => r === PermissionsAndroid.RESULTS.GRANTED,
      );
      if (allGranted) {
        console.log('All required permissions granted');
        return true;
      } else {
        console.log('One or more permissions were denied:', granted);
        return false;
      }
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  useEffect(() => {
    const initializeApp = async () => {
      // Load username and persistent ID from storage
      const savedUsername = await StorageService.getUsername();
            const savedPersistentId = await StorageService.getPersistentId(); // Gets or creates persistent ID

      if (savedUsername) {
        setUsername(savedUsername);
      }
      console.log("usechat: username: ", savedUsername)
      console.log("usechat: persistentId: ", savedPersistentId)
      setPersistentId(savedPersistentId);

      // Load friends list
      const friends = await StorageService.getFriends();
      setFriendsList(new Set(friends.map(f => f.persistentId)));

      // Load friend requests
      const requests = await StorageService.getFriendRequests();
      setFriendRequests(requests);
      console.log('Loaded friend requests:', requests.length);

      // Create device identifier: "username|persistentId"
      // Format: "Alice|abc-123-def" so other devices can parse it
      const deviceIdentifier = savedUsername
        ? `${savedUsername}|${savedPersistentId}`
        : `User|${savedPersistentId}`;

      console.log('Device Identifier:', deviceIdentifier);
      console.log('Persistent ID:', savedPersistentId);

      // Initialize global Windsurf node identity
      NodeIdentity.setNodeId(deviceIdentifier);

      // Initialize the routing service with our ID, device address, and username
      routingService.initialize(savedPersistentId, deviceIdentifier, savedUsername || 'User');

      // Start Windsurf discovery loop (DISCOVER/RESPONSE) using MeshNetwork
      windsurfDiscovery.start(savedUsername || 'User');

      // Update device name with username AND persistent ID
      MeshNetwork.setDeviceName(deviceIdentifier);

      MeshNetwork.init();
      setStatus('Initialized');

      // Auto-start discovery after permissions
      if (!hasAutoStarted.current) {
        hasAutoStarted.current = true;
        const hasPermission = await requestPermissions();
        if (hasPermission) {
          setStatus('Auto-starting discovery...');
          setTimeout(() => {
            MeshNetwork.discoverPeers();
          }, 1000); // Small delay to ensure initialization
        } else {
          setStatus('Permissions required. Tap Discover Peers.');
        }
      }
    };

    initializeApp();

    const attemptConnection = (peer: Peer) => {
      const attempts = connectionAttempts.current.get(peer.deviceAddress) || 0;
      const maxAttempts = 3;

      if (!connectedPeers.includes(peer.deviceAddress)) {
        if (attempts >= maxAttempts) {
          console.log(`Max connection attempts (${maxAttempts}) reached for: ${peer.deviceName}`);
          return;
        }

        console.log(`Auto-connecting to: ${peer.deviceName} (attempt ${attempts + 1}/${maxAttempts})`);
        console.log(`Connection details:`, {
          deviceAddress: peer.deviceAddress,
          deviceName: peer.deviceName,
          status: peer.status,
          attempts: attempts + 1
        });

        MeshNetwork.connectToPeer(peer.deviceAddress);
        connectionAttempts.current.set(peer.deviceAddress, attempts + 1);

        // Set retry timer (retry after 3 seconds if connection fails)
        const existingTimer = connectionRetryTimers.current.get(peer.deviceAddress);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const retryTimer = setTimeout(() => {
          // Check if still not connected and peer still available
          if (!connectedPeers.includes(peer.deviceAddress) &&
            peers.some(p => p.deviceAddress === peer.deviceAddress)) {
            console.log(`Retrying connection to: ${peer.deviceName}`);
            attemptConnection(peer);
          }
        }, 3000); // Retry after 3 seconds (reduced from 5)

        connectionRetryTimers.current.set(peer.deviceAddress, retryTimer);
      } else {
        console.log(`Skipping connection to ${peer.deviceName} - already connected`);
      }
    };

    const onPeersFoundListener = MeshNetworkEvents.addListener(
      'onPeersFound',
      (event: Peer[]) => {
        console.log('Peers found (raw):', event);

        // Parse device identifiers and add persistent IDs
        const parsedPeers = event.map((peer: Peer) => {
          const { displayName, persistentId } = parseDeviceIdentifier(peer.deviceName);

          return {
            ...peer,
            displayName,
            persistentId,
          };
        });

        console.log('Peers found (parsed):', parsedPeers);
        setPeers(parsedPeers);

        // Always auto-connect to available peers
        if (parsedPeers.length > 0) {
          parsedPeers.forEach((peer: Peer) => {
            console.log(`Found peer: ${peer.displayName} (ID: ${peer.persistentId || 'none'})`);
            console.log(`Peer details:`, {
              deviceName: peer.deviceName,
              deviceAddress: peer.deviceAddress,
              status: peer.status,
              statusMeaning: peer.status === 0 ? 'Connected' : peer.status === 3 ? 'Available' : 'Unknown',
              isAvailable: peer.status === 3,
              isAlreadyConnected: connectedPeers.includes(peer.deviceAddress),
              willAutoConnect: (peer.status === 3 || peer.status !== 0) && !connectedPeers.includes(peer.deviceAddress)
            });

            // Auto-connect if:
            // 1. Status is 3 (Available) OR status is not 0 (not already connected)
            // 2. Not already in our connected peers list
            // This handles cases where status might be incorrect
            if ((peer.status === 3 || peer.status !== 0) && !connectedPeers.includes(peer.deviceAddress)) {
              attemptConnection(peer);
            }
          });
        }
      },
    );

    const onDiscoveryStateChangedListener = MeshNetworkEvents.addListener(
      'onDiscoveryStateChanged',
      (event: DiscoveryEvent | string) => {
        let eventStatus: string;
        let reasonCode: number | undefined;
        let message: string | undefined;

        if (typeof event === 'object' && event.status) {
          eventStatus = event.status;
          reasonCode = event.reasonCode;
          message = (event as any).message;
        } else {
          eventStatus = event as string;
        }

        console.log('Discovery state changed:', eventStatus, 'Reason:', reasonCode, 'Message:', message);

        if (eventStatus.includes('Started')) {
          setIsDiscovering(true);
        } else if (eventStatus.includes('Stopped') || eventStatus.includes('Failed')) {
          setIsDiscovering(false);
        }

        if (eventStatus.includes('Failed')) {
          const errorMsg = message || `Error code ${reasonCode || 'Unknown'}`;
          setStatus(`Discovery Failed: ${errorMsg} - Retrying...`);

          // Auto-retry on discovery failure
          console.log('Discovery failed - Auto-retrying in 3 seconds...');
          setTimeout(() => {
            console.log('Restarting discovery...');
            MeshNetwork.discoverPeers();
          }, 3000); // Retry after 3 seconds

        } else if (eventStatus.toLowerCase().includes('already')) {
          // Handle "Already discovering" error
          setStatus('Already discovering - Resetting...');
          console.log('Already discovering error - Resetting and restarting...');

          // Stop and restart
          setTimeout(() => {
            MeshNetwork.stopDiscovery();
            setTimeout(() => {
              console.log('Restarting discovery after reset...');
              MeshNetwork.discoverPeers();
            }, 1000);
          }, 1000);

        } else {
          setStatus(eventStatus);
        }
      },
    );

    const onConnectionChangedListener = MeshNetworkEvents.addListener(
      'onConnectionChanged',
      (event: ConnectionInfo | boolean) => {
        console.log('Connection changed:', event);
        if (typeof event === 'boolean') {
          setIsConnected(event);
          if (!event) {
            setConnectedPeers([]);
            setIsGroupOwner(false);
            setStatus('Disconnected');
          }
        } else {
          setIsConnected(true);
          setIsGroupOwner(event.isGroupOwner);
          setStatus(
            event.isGroupOwner
              ? `Connected as Group Owner (${event.groupOwnerAddress})`
              : `Connected to ${event.groupOwnerAddress}`,
          );
        }
      },
    );

    const onPeerConnectedListener = MeshNetworkEvents.addListener(
      'onPeerConnected',
      (data: { address: string } | string) => {
        const address = typeof data === 'string' ? data : data.address;

        // Find peer's display name from peers array
        const peer = peers.find(p => p.deviceAddress === address);
        const displayName = peer?.displayName || peer?.deviceName || address;

        console.log('Peer connected:', displayName, `(${address})`);
        setConnectedPeers(prev => [...new Set([...prev, address])]);
        setStatus(`Peer connected: ${displayName}`);

        // Notify routing service about new peer connection
        routingService.addConnectedPeer(address, peer?.persistentId);

        // Clear retry timer for this peer since connection succeeded
        const timer = connectionRetryTimers.current.get(address);
        if (timer) {
          clearTimeout(timer);
          connectionRetryTimers.current.delete(address);
        }
        // Reset connection attempts
        connectionAttempts.current.delete(address);
      },
    );

    const onPeerDisconnectedListener = MeshNetworkEvents.addListener(
      'onPeerDisconnected',
      (data: { address: string } | string) => {
        const address = typeof data === 'string' ? data : data.address;

        // Find peer's display name from peers array
        const peer = peers.find(p => p.deviceAddress === address);
        const displayName = peer?.displayName || peer?.deviceName || address;

        console.log('Peer disconnected:', displayName, `(${address})`);
        setConnectedPeers(prev => prev.filter(p => p !== address));
        setStatus(`Peer disconnected: ${displayName}`);

        // Notify routing service about peer disconnection
        routingService.removeConnectedPeer(address);
      },
    );

        const onMessageReceivedListener = MeshNetworkEvents.addListener(
      'onMessageReceived',
      (data: MessageReceivedEvent) => {
        try {
          const raw = data.message;
          console.log('[useChatScreen] Raw Mesh message received', {
            fromAddress: data.fromAddress,
            length: raw?.length,
          });
          let envelope: NodeMessage<any>;

          try {
            envelope = JSON.parse(raw);
          } catch {
            console.log('[useChatScreen] Message not JSON, ignoring for routing');
            return;
          }

          if (!envelope || !envelope.nodeId || !envelope.sessionId) {
            console.log('[useChatScreen] Invalid envelope, missing ids');
            return;
          }

          // SELF-FILTER: ignore any packet from our own nodeId
          const myNodeId = NodeIdentity.tryGetNodeId();
          if (myNodeId && envelope.nodeId === myNodeId) {
            console.log('[useChatScreen] Ignoring self-originated envelope');
            return;
          }

          console.log('[useChatScreen] Envelope accepted', {
            nodeId: envelope.nodeId,
            sessionId: envelope.sessionId,
            type: envelope.type,
          });

          // Allow discovery service to update peer list for any valid non-self message
          windsurfDiscovery.handleIncoming(envelope, data.fromAddress);

          if (envelope.type !== 'DATA' || !envelope.payload) {
            console.log('[useChatScreen] Envelope not DATA or missing payload');
            return;
          }

          // Payload is the routing Packet for DATA messages
          const packet = envelope.payload as any;
          if (!packet || !packet.type) {
            console.log('[useChatScreen] DATA payload missing packet info');
            return;
          }

          console.log('[useChatScreen] Forwarding packet to routingService', {
            packetType: packet.type,
            packetId: packet.packetId,
          });
          routingService.handleIncomingPacket(packet, data.fromAddress);
        } catch (error) {
          console.error('Error handling incoming NodeMessage in useChatScreen:', error);
        }
      }
    );

    // PREVIOUS MESSAGE HANDLING LOGIC (NOW DELEGATED TO ROUTING SERVICE)
    // const onMessageReceivedListener_OLD = MeshNetworkEvents.addListener(
    //   'onMessageReceived',
    //   async (data: MessageReceivedEvent) => {
    //     // ... (rest of the old message handling logic)
    //   }
    // );

    const onMessageSentListener = MeshNetworkEvents.addListener(
      'onMessageSent',
      (data: { message: string; success: boolean }) => {
        console.log('Message sent:', data);
      },
    );
    const onConnectionErrorListener = MeshNetworkEvents.addListener(
      'onConnectionError',
      (error: any) => {
        // Handle specific error codes
        const reasonCode = error?.reasonCode || error;
        const deviceAddress = error?.deviceAddress;

        // Log all errors for debugging, but some are just informational
        console.log('Connection event:', { reasonCode, deviceAddress });

        let errorMessage = 'Connection Error';

        switch (reasonCode) {
          case 1:
            // Error code 1 is informational - "Already advertising/discovering"
            // This is normal after connection succeeds, not a real error
            console.log('Info: Already advertising/discovering (this is normal)');
            // Don't show error message or reset - this is harmless
            return; // Exit early, don't update status
            break;
          case 3:
            errorMessage = 'Peer no longer available';
            console.log(`Error code 3 (Endpoint Unknown) for ${deviceAddress} - Peer left the network`);
            // Stop retrying for this peer since it's gone
            const timer = connectionRetryTimers.current.get(deviceAddress);
            if (timer) {
              clearTimeout(timer);
              connectionRetryTimers.current.delete(deviceAddress);
              console.log(`Stopped retrying connection to ${deviceAddress}`);
            }
            connectionAttempts.current.delete(deviceAddress);
            break;
          case 13:
            errorMessage = 'Network I/O Error - Will retry automatically';
            console.log(`Error code 13 (IO Error) for ${deviceAddress} - Retry logic will handle this`);
            break;
          case 8001:
            errorMessage = 'Connection rejected';
            console.log(`Error code 8001 (Rejected) for ${deviceAddress}`);
            break;
          case 8002:
            errorMessage = 'Connection failed - Will retry';
            console.log(`Error code 8002 (Connection Failed) for ${deviceAddress} - Will retry`);
            // Let the automatic retry logic handle this
            break;
          default:


            console.log(`Unknown connection error: ${reasonCode} for ${deviceAddress}`);
            errorMessage = `Error code ${reasonCode}`;
        }

        setStatus(errorMessage);

        // Note: Retry logic will automatically handle this in the attemptConnection function
      },
    );

    return () => {
      onPeersFoundListener.remove();
      onDiscoveryStateChangedListener.remove();
      onConnectionChangedListener.remove();
      onPeerConnectedListener.remove();
      onPeerDisconnectedListener.remove();
      onMessageReceivedListener.remove();
      onMessageSentListener.remove();
      onConnectionErrorListener.remove();

      // Clear all retry timers
      connectionRetryTimers.current.forEach((timer) => {
        clearTimeout(timer);
      });
      connectionRetryTimers.current.clear();
      connectionAttempts.current.clear();
    };
  }, []);

  const handleDiscoverPeers = async () => {
    const hasPermission = await requestPermissions();
    if (hasPermission) {
      setPeers([]);
      MeshNetwork.discoverPeers();
    } else {
      setStatus('Permission denied. Cannot discover peers.');
    }
  };

  const handleStopDiscovery = () => {
    MeshNetwork.stopDiscovery();
    setIsDiscovering(false);
  };

  const handleResetDiscovery = () => {
    // Stop any ongoing discovery and reset local UI state
    try {
      MeshNetwork.stopDiscovery();
    } catch (e) {
      // no-op
    }
    setIsDiscovering(false);
    setPeers([]);
    setStatus('Reset. Ready to discover.');
  };

  const handleConnectToPeer = (deviceAddress: string) => {
    console.log('Connecting to peer:', deviceAddress);
    MeshNetwork.connectToPeer(deviceAddress);
    setSelectedPeer(deviceAddress);
  };

  const handleDisconnect = () => {
    MeshNetwork.disconnect();
    setMessages([]);
    setSelectedPeer(null);
  };

  const handleSendMessage = () => {
    if (!messageText.trim() || !selectedPeer) return;

    // The selectedPeer is the deviceAddress. We need to find the persistentId for routing.
    const peer = peers.find(p => p.deviceAddress === selectedPeer);
    if (!peer || !peer.persistentId) {
        console.error("Cannot send message: selected peer does not have a persistent ID.");
        return;
    }

    routingService.sendData(peer.persistentId, messageText);

    // Optimistically display the message
    const newMessage: Message = {
      id: `${Date.now()}-sent`,
      text: messageText,
      fromAddress: 'me',
      senderName: username,
      timestamp: Date.now(),
      isSent: true,
    };

    setMessages(prev => [...prev, newMessage]);
    setMessageText('');

    setTimeout(() => {
      messagesEndRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const getPeerStatusText = (status: number): string => {
    switch (status) {
      case 0: return 'Connected';
      case 1: return 'Invited';
      case 2: return 'Failed';
      case 3: return 'Available';
      case 4: return 'Unavailable';
      default: return 'Unknown';
    }
  };

  const handleAddFriend = async (peer: Peer) => {
    if (!peer.persistentId) {
      console.warn('Cannot add friend without persistent ID');
      return;
    }

    // Send friend request to the peer, wrapped in Windsurf Node envelope
    const friendRequestMessage = `FRIEND_REQUEST:${persistentId}:${username}`;
    const friendRequestEnvelope: NodeMessage<string> = {
      nodeId: NodeIdentity.getNodeId(),
      sessionId: NodeIdentity.getSessionId(),
      type: 'DATA',
      payload: friendRequestMessage,
    };
    MeshNetwork.sendMessage(JSON.stringify(friendRequestEnvelope), username, peer.deviceAddress);

    // Save as outgoing request so we can track it
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

    // Auto-connect to peer
    handleConnectToPeer(peer.deviceAddress);

    console.log('Friend request sent to:', peer.displayName);
  };

  const handleAcceptFriendRequest = async (request: { persistentId: string; displayName: string; deviceAddress: string }) => {
    // Add to friends list
    await StorageService.addFriend({
      persistentId: request.persistentId,
      displayName: request.displayName,
      deviceAddress: request.deviceAddress,
    });

    // Update local friends list
    setFriendsList(prev => new Set([...prev, request.persistentId]));

    // Remove from friend requests
    await StorageService.removeFriendRequest(request.persistentId);
    setFriendRequests(prev => prev.filter(r => r.persistentId !== request.persistentId));

    // Send acceptance message back - BROADCAST to ensure delivery
    const acceptMessage = `FRIEND_ACCEPT:${persistentId}:${username}`;

    const acceptEnvelope: NodeMessage<string> = {
      nodeId: NodeIdentity.getNodeId(),
      sessionId: NodeIdentity.getSessionId(),
      type: 'DATA',
      payload: acceptMessage,
    };

    // Try to send directly first
    MeshNetwork.sendMessage(JSON.stringify(acceptEnvelope), username, request.deviceAddress);
    console.log('Sent FRIEND_ACCEPT to:', request.deviceAddress);

    // Also broadcast to ensure the message reaches the requester
    setTimeout(() => {
      MeshNetwork.sendMessage(JSON.stringify(acceptEnvelope), username, null);
      console.log('Broadcasted FRIEND_ACCEPT to all peers');
    }, 100);

    console.log('Friend request accepted:', request.displayName);
  };

  const handleRejectFriendRequest = async (request: { persistentId: string; displayName: string }) => {
    // Remove from friend requests
    await StorageService.removeFriendRequest(request.persistentId);
    setFriendRequests(prev => prev.filter(r => r.persistentId !== request.persistentId));

    console.log('Friend request rejected:', request.displayName);
  };

  const isFriend = (persistentId?: string): boolean => {
    if (!persistentId) return false;
    return friendsList.has(persistentId);
  };

  return {
    // State
    status,
    peers,
    connectedPeers,
    isDiscovering,
    isConnected,
    isGroupOwner,
    messages,
    messageText,
    selectedPeer,
    messagesEndRef,
    username,
    persistentId, // Persistent ID for friends feature
    showPeerModal,
    friendsList,
    friendRequests,

    // State setters
    setMessageText,
    setShowPeerModal,

    // Handlers
    handleDiscoverPeers,
    handleStopDiscovery,
    handleResetDiscovery,
    handleConnectToPeer,
    handleDisconnect,
    handleSendMessage,
    handleAddFriend,
    handleAcceptFriendRequest,
    handleRejectFriendRequest,
    getPeerStatusText,
    isFriend,
  };
};
