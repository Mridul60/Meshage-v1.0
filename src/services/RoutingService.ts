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
    console.log('RoutingService initialized (epidemic mode):', {
      myId,
      username: this.username,
    });

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => this.cleanupPacketCache(), CLEAN_INTERVAL_MS);
  }

  public handleIncomingPacket(packet: Packet, viaDevice?: string) {
    if (packet.type !== PacketType.DATA) {
      return;
    }

    const dataPacket = packet as DataPacket;
    if (this.packetCache.has(dataPacket.packetId)) {
      return; // duplicate packet, drop
    }

    this.packetCache.set(dataPacket.packetId, Date.now());

    if (dataPacket.destinationId === 'BROADCAST' || dataPacket.destinationId === this.myPersistentId) {
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
      return;
    }

    this.forwardPacket({ ...dataPacket, ttl: ttl - 1 }, viaDevice);
  }

  private forwardPacket(packet: DataPacket, viaDevice?: string) {
    if (this.connectedPeers.size === 0) {
      return;
    }

    this.connectedPeers.forEach(deviceAddress => {
      if (viaDevice && deviceAddress === viaDevice) {
        return; // skip the peer we received it from
      }
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

    this.handleIncomingPacket(packet);
  }

  public sendBroadcast(payload: any, ttl: number = DEFAULT_TTL) {
    this.sendData('BROADCAST', payload, ttl);
  }

  public addConnectedPeer(deviceAddress: string) {
    this.connectedPeers.add(deviceAddress);
  }

  public removeConnectedPeer(deviceAddress: string) {
    this.connectedPeers.delete(deviceAddress);
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
    } catch (error) {
      console.error('Failed to send packet to', deviceAddress, error);
    }
  }

  private cleanupPacketCache() {
    const cutoff = Date.now() - PACKET_CACHE_TTL_MS;
    this.packetCache.forEach((timestamp, packetId) => {
      if (timestamp < cutoff) {
        this.packetCache.delete(packetId);
      }
    });
  }
}

export const routingService = RoutingService.getInstance();
