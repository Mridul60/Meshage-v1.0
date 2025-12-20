/**
 * Unified packet structure for the AODV-like routing protocol.
 */

// Defines the purpose of a network packet
export enum PacketType {
  DATA = 'DATA', // User-facing message
}

export interface BasePacket {
  type: PacketType;
  packetId: string;
  sourceId: string;
  destinationId: string;
  timestamp: number;
}

// Packet containing the actual user message (supports opportunistic forwarding)
export interface DataPacket extends BasePacket {
  type: PacketType.DATA;
  payload: any;
  senderName: string;
  ttl?: number; // Remaining hop budget for epidemic forwarding
}

export type Packet = DataPacket;
