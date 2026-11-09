import { TypedEmitter } from './emitter.js';
import { type RoomChannelName } from './protocol.js';
import { type NetworkSnapshot, type Payload } from './types.js';
export declare const ICE_GATHERING_TIMEOUT_MS = 5000;
export declare const ROOM_CHANNEL_OPEN_TIMEOUT_MS = 15000;
export declare const ROOM_WEBSOCKET_OPEN_TIMEOUT_MS = 10000;
export interface RoomEnvelope {
    channel: RoomChannelName;
    type: string;
    payload: Uint8Array;
    seq: number;
}
interface RoomTransportEvents {
    message: RoomEnvelope;
    disconnected: {
        reason: string;
    };
}
export interface RoomTransport {
    on<K extends keyof RoomTransportEvents>(event: K, listener: (value: RoomTransportEvents[K]) => void): () => void;
    connect(signaling: (offerSdp: string, candidates: Payload[]) => Promise<string>): Promise<void>;
    send(channel: RoomChannelName, type: string, payload: Uint8Array, sequence: number): void;
    snapshot(): Promise<NonNullable<NetworkSnapshot['room']>>;
    close(reason: string): void;
}
export interface WebSocketRoomCredential {
    endpoint: string;
    roomId: string;
    token: string;
    transportEpoch: number;
}
/** Uses the browser-native RTCPeerConnection to carry the single online Room data plane. */
export declare class WebRtcRoomTransport extends TypedEmitter<RoomTransportEvents> implements RoomTransport {
    private readonly configuration;
    private readonly factory;
    private readonly gatheringTimeoutMs;
    private readonly channelOpenTimeoutMs;
    private peer?;
    private readonly channels;
    private closed;
    private gatheringTimeout?;
    /** Create a Room transport that has not started signaling yet. */
    constructor(configuration: RTCConfiguration, factory: (configuration: RTCConfiguration) => RTCPeerConnection, gatheringTimeoutMs?: number, channelOpenTimeoutMs?: number);
    /** Create the fixed DataChannels, gather ICE and exchange SDP through the Gateway. */
    connect(signaling: (offerSdp: string, candidates: Payload[]) => Promise<string>): Promise<void>;
    /** Send a binary Room frame on the given protocol channel. */
    send(channelName: RoomChannelName, type: string, payload: Uint8Array, sequence: number): void;
    /** Return a network diagnostics snapshot without addresses, credentials, SDP or ICE candidates. */
    snapshot(): Promise<NonNullable<NetworkSnapshot['room']>>;
    /** Deterministically release the PeerConnection and all DataChannels. */
    close(reason: string): void;
    /** Wait for all three negotiated DataChannels to open. */
    private waitForChannels;
    /** Verify that the actual channel matches the envelope declaration before surfacing the message. */
    private handleMessage;
}
/** Standalone Room WebSocket data plane; the Main Gateway control WebSocket does not carry gameplay frames. */
export declare class WebSocketRoomTransport extends TypedEmitter<RoomTransportEvents> implements RoomTransport {
    private readonly credential;
    private readonly factory;
    private readonly openTimeoutMs;
    private socket?;
    private closed;
    private pendingState;
    private pendingStateTimer;
    /** Store the short-lived connection material issued by the server; callers must not assemble these fields from URLs or local configuration. */
    constructor(credential: WebSocketRoomCredential, factory: (url: string) => WebSocket, openTimeoutMs?: number);
    /** Establish a standalone WSS and complete Room authentication in the first frame; room_joined is still confirmed by the unified Room protocol. */
    connect(): Promise<void>;
    /** Wrap the original CYR1 frame with one stable channel byte; reliability semantics are still provided by CYR1 and the Room Runtime. */
    send(channelName: RoomChannelName, type: string, payload: Uint8Array, sequence: number): void;
    /** Return Room WebSocket diagnostics without the WSS address, token or epoch. */
    snapshot(): Promise<NonNullable<NetworkSnapshot['room']>>;
    /** Deterministically release the standalone Room WebSocket. */
    close(reason: string): void;
    private scheduleStateFlush;
    /** Verify the outer channel byte, then reuse CYR1 decoding; text gameplay payloads are not accepted. */
    private handleMessage;
}
/** The local transport explicitly reuses the Room Mock loopback WebSocket; online credentials never enter this implementation. */
export declare class LocalRoomTransport extends TypedEmitter<RoomTransportEvents> implements RoomTransport {
    private readonly sendEvent;
    private readonly roomId;
    private closed;
    /** Inject the local message send function managed by the Socket. */
    constructor(sendEvent: (type: string, payload: Payload) => void, roomId: string);
    /** The local transport does not perform WebRTC signaling. */
    connect(): Promise<void>;
    /** Send gameplay messages through an explicit local Room envelope. */
    send(channel: RoomChannelName, type: string, payload: Uint8Array, sequence: number): void;
    /** Inject gameplay envelopes returned by the local Mock. */
    receive(channel: RoomChannelName, frameBase64: string): void;
    /** Return diagnostics explicitly marked as the language Mock loopback WebSocket. */
    snapshot(): Promise<NonNullable<NetworkSnapshot['room']>>;
    /** Notify the local Mock to leave the Room and release the transport. */
    close(reason: string): void;
}
export declare function bytesToBase64(bytes: Uint8Array): string;
export {};
