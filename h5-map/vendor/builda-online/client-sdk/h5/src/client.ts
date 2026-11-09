import { OnlineSocket } from './socket.js'
import type { OnlineClientConfig, Session } from './types.js'

/** Holds the public client configuration and creates Sessions and real-time Sockets. */
export class OnlineClient {
  /** Validate game configuration that does not change at runtime. */
  constructor(public readonly config: OnlineClientConfig) {
    if (!config.gatewayUrl || !config.gameId || !config.defaultQueueName) {
      throw new TypeError('gatewayUrl, gameId, and defaultQueueName must not be empty')
    }
  }

  /** Restore an in-memory Session from the short-lived token provided by the Builda host. */
  restoreSession(token: string): Session {
    if (!token) throw new TypeError('runtime token must not be empty')
    return {
      token,
      userId: '',
      gameId: '',
      onlineCompatibilityRevision: 0,
      expiresAtUnixSeconds: 0,
    }
  }

  /** Create a real-time Socket that is not yet connected to the Gateway. */
  createSocket(): OnlineSocket {
    return new OnlineSocket(this.config)
  }

  /** Check whether the browser meets the minimum capabilities for online Room WebRTC. */
  static detectCapabilities(): { control: boolean; roomWebRtc: boolean; secureContext: boolean } {
    return {
      control: typeof WebSocket !== 'undefined',
      roomWebRtc: typeof RTCPeerConnection !== 'undefined' && typeof RTCDataChannel !== 'undefined',
      secureContext: typeof window === 'undefined' || window.isSecureContext,
    }
  }
}
