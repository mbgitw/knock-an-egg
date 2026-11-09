import { TypedEmitter } from './emitter.js';
import { type Payload } from './types.js';
interface ControlEnvelope {
    type: string;
    payload: unknown;
    request_id: string;
}
interface ControlEvents {
    push: ControlEnvelope;
    closed: {
        code: number;
        reason: string;
    };
}
/** Covers DNS, TCP and TLS handshake time on mobile network cold starts. */
export declare const GATEWAY_CONNECT_TIMEOUT_MS = 30000;
export declare const GATEWAY_RECOVERY_CONNECT_TIMEOUT_MS = 5000;
export declare const GATEWAY_RECOVERY_ATTEMPTS = 3;
/** Manages Gateway WebSocket request correlation and server pushes. */
export declare class ControlConnection extends TypedEmitter<ControlEvents> {
    private readonly url;
    private readonly timeoutMs;
    private readonly factory;
    private socket;
    private sequence;
    private readonly pending;
    /** Create the control connection; factory injection is for browser tests and does not change the online protocol. */
    constructor(url: string, timeoutMs: number, factory: (url: string) => WebSocket);
    /** Establish a Gateway WebSocket that can send messages. */
    connect(timeoutMs?: number): Promise<void>;
    /** Send a control request and wait for the matching response by request_id. */
    request<T>(type: string, payload?: Payload): Promise<T>;
    /** Send a local transport event; online Room data must not use this interface. */
    sendEvent(type: string, payload: Payload): void;
    /** Return whether the current connection can send control messages. */
    isOpen(): boolean;
    /** Close the Gateway and reject requests that are still pending. */
    close(code?: number, reason?: string): void;
    /** Immediately discard a Gateway whose results can no longer be trusted; late messages from the old connection never reach the new session. */
    invalidate(reason?: string): void;
    /** Encode and send one control envelope. */
    private send;
    /** Decode Gateway messages and dispatch responses or pushes. */
    private handleMessage;
    /** Clean up all waiters after the connection closes. */
    private handleClose;
    /** Reject requests on the old connection uniformly so waiters do not hang until timeout after the connection is replaced. */
    private rejectPending;
}
export {};
