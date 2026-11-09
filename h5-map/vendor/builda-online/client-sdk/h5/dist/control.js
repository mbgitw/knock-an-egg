import { TypedEmitter } from './emitter.js';
import { CONTROL_MESSAGES } from './protocol.js';
import { OnlineError } from './types.js';
/** Covers DNS, TCP and TLS handshake time on mobile network cold starts. */
export const GATEWAY_CONNECT_TIMEOUT_MS = 30_000;
export const GATEWAY_RECOVERY_CONNECT_TIMEOUT_MS = 5_000;
export const GATEWAY_RECOVERY_ATTEMPTS = 3;
/** Manages Gateway WebSocket request correlation and server pushes. */
export class ControlConnection extends TypedEmitter {
    url;
    timeoutMs;
    factory;
    socket;
    sequence = 0;
    pending = new Map();
    /** Create the control connection; factory injection is for browser tests and does not change the online protocol. */
    constructor(url, timeoutMs, factory) {
        super();
        this.url = url;
        this.timeoutMs = timeoutMs;
        this.factory = factory;
    }
    /** Establish a Gateway WebSocket that can send messages. */
    connect(timeoutMs = GATEWAY_CONNECT_TIMEOUT_MS) {
        if (this.socket?.readyState === WebSocket.OPEN)
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            const socket = this.factory(this.url);
            if (this.socket) {
                this.rejectPending('Gateway connection is recovering');
                if (this.socket.readyState !== WebSocket.CLOSING && this.socket.readyState !== WebSocket.CLOSED) {
                    this.socket.close(1000, 'connection_replaced');
                }
            }
            this.socket = socket;
            const timeout = setTimeout(() => {
                socket.close(1000, 'connect_timeout');
                reject(new OnlineError('GATEWAY_TIMEOUT', 'Gateway connection timed out'));
            }, timeoutMs);
            socket.addEventListener('open', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
            socket.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new OnlineError('GATEWAY_CONNECT_FAILED', 'Failed to connect to Gateway'));
            }, { once: true });
            socket.addEventListener('message', (event) => {
                if (socket === this.socket)
                    this.handleMessage(event.data);
            });
            socket.addEventListener('close', (event) => this.handleClose(socket, event.code, event.reason));
        });
    }
    /** Send a control request and wait for the matching response by request_id. */
    request(type, payload = {}) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new OnlineError('GATEWAY_CLOSED', 'Gateway is not connected'));
        }
        const requestId = String(++this.sequence);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new OnlineError('REQUEST_TIMEOUT', `Control request timed out: ${type}`, requestId));
            }, type === 'room_leave' ? 2500 : type === 'room_private_create' ? Math.max(this.timeoutMs, 60_000) : this.timeoutMs);
            this.pending.set(requestId, {
                resolve: resolve,
                reject,
                timeout,
            });
            this.send(type, payload, requestId);
        });
    }
    /** Send a local transport event; online Room data must not use this interface. */
    sendEvent(type, payload) {
        this.send(type, payload, '');
    }
    /** Return whether the current connection can send control messages. */
    isOpen() {
        return this.socket?.readyState === WebSocket.OPEN;
    }
    /** Close the Gateway and reject requests that are still pending. */
    close(code = 1000, reason = 'client_close') {
        this.socket?.close(code, reason);
    }
    /** Immediately discard a Gateway whose results can no longer be trusted; late messages from the old connection never reach the new session. */
    invalidate(reason = 'transport_untrusted') {
        const socket = this.socket;
        this.socket = undefined;
        this.rejectPending('Gateway transport is no longer trusted');
        if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
            // Browser WebSocket only accepts 1000 or 3000-4999; 1001 throws a DOMException synchronously in WebViews.
            socket.close(1000, reason);
        }
    }
    /** Encode and send one control envelope. */
    send(type, payload, requestId) {
        this.socket?.send(JSON.stringify({ type, payload, request_id: requestId }));
    }
    /** Decode Gateway messages and dispatch responses or pushes. */
    handleMessage(data) {
        if (typeof data !== 'string')
            return;
        let envelope;
        try {
            envelope = JSON.parse(data);
        }
        catch {
            this.emit('push', { type: CONTROL_MESSAGES.error, payload: { code: 'INVALID_JSON', message: 'Failed to parse control message' }, request_id: '' });
            return;
        }
        if (envelope.type === CONTROL_MESSAGES.ping)
            this.send(CONTROL_MESSAGES.pong, {}, '');
        const pending = envelope.request_id ? this.pending.get(envelope.request_id) : undefined;
        if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(envelope.request_id);
            if (envelope.type === CONTROL_MESSAGES.error) {
                const error = (envelope.payload ?? {});
                pending.reject(new OnlineError(String(error.error_code ?? error.code ?? 'CONTROL_ERROR'), String(error.message ?? 'Control request failed'), envelope.request_id));
            }
            else {
                pending.resolve(envelope.payload);
            }
            return;
        }
        // A late error carrying request_id belongs to its already timed-out request; it must not masquerade as a global control-plane error push.
        if (envelope.request_id && envelope.type === CONTROL_MESSAGES.error)
            return;
        this.emit('push', envelope);
    }
    /** Clean up all waiters after the connection closes. */
    handleClose(source, code, reason) {
        if (source !== this.socket)
            return;
        this.rejectPending('Gateway connection is closed');
        this.emit('closed', { code, reason });
    }
    /** Reject requests on the old connection uniformly so waiters do not hang until timeout after the connection is replaced. */
    rejectPending(message) {
        for (const [requestId, pending] of this.pending) {
            clearTimeout(pending.timeout);
            pending.reject(new OnlineError('GATEWAY_CLOSED', message, requestId));
        }
        this.pending.clear();
    }
}
