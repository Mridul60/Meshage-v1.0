import { NativeModules } from 'react-native';
import { NodeIdentity, NodeMessage } from './NodeIdentity';
import { PacketType, type DataPacket, type Packet } from '../types/routing';

const { MeshNetwork } = NativeModules;

const DEFAULT_TTL = 5;
const PACKET_CACHE_TTL_MS = 5 * 60 * 1000; // remember packets for 5 minutes
const CLEAN_INTERVAL_MS = 30 * 1000;

class RoutingService {
  private static instance: RoutingService;
  private myPersistentId = '';
  private username = 'User';
  private connectedPeers: Set<string> = new Set();
  private packetCache: Map<string, number> = new Map();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private dataHandlers: Set<(packet: DataPacket) => void> = new Set();

  private constructor() {}

  public static getInstance() {
    if (!RoutingService.instance) {
      RoutingService.instance = new RoutingService();
    }
    return RoutingService.instance;
  }

  public initialize(myId: string, _deviceAddress?: string, username?: string) {
    this.myPersistentId = myId;
    this.username = username || 'User';
    console.log('[RoutingService] Initialized epidemic routing', {
      myId,
      username: this.username,
    });

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => this.cleanupPacketCache(), CLEAN_INTERVAL_MS);
    console.log('[RoutingService] Packet cache cleanup scheduled every', CLEAN_INTERVAL_MS, 'ms');
  }

  public handleIncomingPacket(packet: Packet, viaDevice?: string) {
    if (packet.type !== PacketType.DATA) {
      console.log('[RoutingService] Ignoring non-DATA packet', packet.type);
      return;
    }

    const dataPacket = packet as DataPacket;
    if (this.packetCache.has(dataPacket.packetId)) {
      console.log('[RoutingService] Dropping duplicate packet', dataPacket.packetId);
      return; // duplicate packet, drop
    }

    this.packetCache.set(dataPacket.packetId, Date.now());
    console.log('[RoutingService] Accepted packet', {
      packetId: dataPacket.packetId,
      from: dataPacket.sourceId,
      destination: dataPacket.destinationId,
      viaDevice,
      ttl: dataPacket.ttl,
    });

    if (dataPacket.destinationId === 'BROADCAST' || dataPacket.destinationId === this.myPersistentId) {
      console.log('[RoutingService] Delivering packet to local handlers', {
        destinationMatch: dataPacket.destinationId,
        handlerCount: this.dataHandlers.size,
      });
      this.dataHandlers.forEach(handler => {
        try {
          handler(dataPacket);
        } catch (error) {
          console.error('Error delivering packet:', error);
        }
      });
    }

    const ttl = dataPacket.ttl ?? DEFAULT_TTL;
    if (ttl <= 0) {
      console.log('[RoutingService] TTL exhausted, not forwarding', dataPacket.packetId);
      return;
    }

    this.forwardPacket({ ...dataPacket, ttl: ttl - 1 }, viaDevice);
  }

  private forwardPacket(packet: DataPacket, viaDevice?: string) {
    if (this.connectedPeers.size === 0) {
      console.log('[RoutingService] No connected peers, cannot forward', packet.packetId);
      return;
    }

    this.connectedPeers.forEach(deviceAddress => {
      if (viaDevice && deviceAddress === viaDevice) {
        console.log('[RoutingService] Skipping origin peer for packet', packet.packetId, viaDevice);
        return; // skip the peer we received it from
      }
      console.log('[RoutingService] Forwarding packet', packet.packetId, 'to', deviceAddress);
      this.sendPacketToDevice(deviceAddress, packet);
    });
  }

  public sendData(destinationId: string, payload: any, ttl: number = DEFAULT_TTL) {
    const packet: DataPacket = {
      type: PacketType.DATA,
      packetId: `data-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sourceId: this.myPersistentId,
      destinationId,
      payload,
      senderName: this.username,
      timestamp: Date.now(),
      ttl,
    };

    console.log('[RoutingService] Sending data', {
      packetId: packet.packetId,
      destinationId,
      ttl,
      payloadKind: payload?.kind,
    });
    this.handleIncomingPacket(packet);
  }

  public sendBroadcast(payload: any, ttl: number = DEFAULT_TTL) {
    console.log('[RoutingService] Broadcasting payload', {
      payloadKind: payload?.kind,
      ttl,
    });
    this.sendData('BROADCAST', payload, ttl);
  }

  public addConnectedPeer(deviceAddress: string, peerId?: string) {
    this.connectedPeers.add(deviceAddress);
    console.log('[RoutingService] Added connected peer', deviceAddress, {
      total: this.connectedPeers.size,
      peerId,
    });
  }

  public removeConnectedPeer(deviceAddress: string) {
    this.connectedPeers.delete(deviceAddress);
    console.log('[RoutingService] Removed connected peer', deviceAddress, 'total:', this.connectedPeers.size);
  }

  public getConnectedPeers(): Set<string> {
    return new Set(this.connectedPeers);
  }

  public addDataHandler(handler: (packet: DataPacket) => void) {
    this.dataHandlers.add(handler);
  }

  public removeDataHandler(handler: (packet: DataPacket) => void) {
    this.dataHandlers.delete(handler);
  }

  private sendPacketToDevice(deviceAddress: string, packet: DataPacket) {
    try {
      const envelope: NodeMessage<DataPacket> = {
        nodeId: NodeIdentity.getNodeId(),
        sessionId: NodeIdentity.getSessionId(),
        type: 'DATA',
        payload: packet,
      };
      MeshNetwork.sendMessage(JSON.stringify(envelope), this.username, deviceAddress);
      console.log('[RoutingService] Mesh send queued', {
        packetId: packet.packetId,
        deviceAddress,
      });
    } catch (error) {
      console.error('Failed to send packet to', deviceAddress, error);
    }
  }

  private cleanupPacketCache() {
    const cutoff = Date.now() - PACKET_CACHE_TTL_MS;
    let removed = 0;
    this.packetCache.forEach((timestamp, packetId) => {
      if (timestamp < cutoff) {
        this.packetCache.delete(packetId);
        removed += 1;
      }
    });
    if (removed > 0) {
      console.log('[RoutingService] Cleaned packet cache entries', removed);
    }
  }
}

export const routingService = RoutingService.getInstance();
