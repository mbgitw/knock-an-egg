import { OnlineSocket } from './socket.js';
import type { OnlineClientConfig, Session } from './types.js';
/** Holds the public client configuration and creates Sessions and real-time Sockets. */
export declare class OnlineClient {
    readonly config: OnlineClientConfig;
    /** Validate game configuration that does not change at runtime. */
    constructor(config: OnlineClientConfig);
    /** Restore an in-memory Session from the short-lived token provided by the Builda host. */
    restoreSession(token: string): Session;
    /** Create a real-time Socket that is not yet connected to the Gateway. */
    createSocket(): OnlineSocket;
    /** Check whether the browser meets the minimum capabilities for online Room WebRTC. */
    static detectCapabilities(): {
        control: boolean;
        roomWebRtc: boolean;
        secureContext: boolean;
    };
}
