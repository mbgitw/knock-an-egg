import { TypedEmitter } from './emitter.js'
import { ROOM_CHANNELS, type RoomChannelName } from './protocol.js'
import { OnlineError, type NetworkSnapshot, type Payload } from './types.js'
import { decodeRoomFrame, encodeRoomFrame } from './room-frame.js'

export const ICE_GATHERING_TIMEOUT_MS = 5_000
export const ROOM_CHANNEL_OPEN_TIMEOUT_MS = 15_000
export const ROOM_WEBSOCKET_OPEN_TIMEOUT_MS = 10_000
const ROOM_CHANNEL_STATE_POLL_MS = 50
const ROOM_WEBSOCKET_UNRELIABLE_BACKLOG_BYTES = 262_144

function roomWebSocketCloseReason(code: number, reason: string): string {
  if (code === 4001) return 'ROOM_WEBSOCKET_AUTH_INVALID'
  if (code === 4003) return 'ROOM_WEBSOCKET_AUTH_REJECTED'
  if (code === 4004) return 'ROOM_WEBSOCKET_ROOM_NOT_JOINABLE'
  return reason || `websocket_${code}`
}

export interface RoomEnvelope {
  channel: RoomChannelName
  type: string
  payload: Uint8Array
  seq: number
}

interface RoomTransportEvents {
  message: RoomEnvelope
  disconnected: { reason: string }
}

export interface RoomTransport {
  on<K extends keyof RoomTransportEvents>(event: K, listener: (value: RoomTransportEvents[K]) => void): () => void
  connect(signaling: (offerSdp: string, candidates: Payload[]) => Promise<string>): Promise<void>
  send(channel: RoomChannelName, type: string, payload: Uint8Array, sequence: number): void
  snapshot(): Promise<NonNullable<NetworkSnapshot['room']>>
  close(reason: string): void
}

export interface WebSocketRoomCredential {
  endpoint: string
  roomId: string
  token: string
  transportEpoch: number
}

/** Uses the browser-native RTCPeerConnection to carry the single online Room data plane. */
export class WebRtcRoomTransport extends TypedEmitter<RoomTransportEvents> implements RoomTransport {
  private peer?: RTCPeerConnection
  private readonly channels = new Map<RoomChannelName, RTCDataChannel>()
  private closed = false
  private gatheringTimeout?: ReturnType<typeof setTimeout>

  /** Create a Room transport that has not started signaling yet. */
  constructor(
    private readonly configuration: RTCConfiguration,
    private readonly factory: (configuration: RTCConfiguration) => RTCPeerConnection,
    private readonly gatheringTimeoutMs = ICE_GATHERING_TIMEOUT_MS,
    private readonly channelOpenTimeoutMs = ROOM_CHANNEL_OPEN_TIMEOUT_MS,
  ) {
    super()
  }

  /** Create the fixed DataChannels, gather ICE and exchange SDP through the Gateway. */
  async connect(signaling: (offerSdp: string, candidates: Payload[]) => Promise<string>): Promise<void> {
    let peer: RTCPeerConnection
    try {
      peer = this.factory(this.configuration)
    } catch {
      throw new OnlineError('WEBRTC_OFFER_FAILED', 'WebRTC is unavailable in the current runtime')
    }
    this.peer = peer
    const candidates: Payload[] = []
    const gatheringComplete = new Promise<void>((resolve) => {
      // Some network stacks may not fire gathering complete for a long time; after the timeout, continue signaling with the candidates gathered so far.
      this.gatheringTimeout = setTimeout(resolve, this.gatheringTimeoutMs)
      peer.addEventListener('icecandidate', (event) => {
        if (!event.candidate) {
          resolve()
          return
        }
        candidates.push({
          media: event.candidate.sdpMid ?? '',
          index: event.candidate.sdpMLineIndex ?? 0,
          candidate: event.candidate.candidate,
        })
      })
    })
    let signalingStarted = false
    let signalingCompleted = false
    try {
      for (const [name, definition] of Object.entries(ROOM_CHANNELS) as [RoomChannelName, (typeof ROOM_CHANNELS)[RoomChannelName]][]) {
        const channel = peer.createDataChannel(name, { negotiated: true, ...definition })
        channel.binaryType = 'arraybuffer'
        channel.addEventListener('message', (event) => this.handleMessage(name, event.data))
        this.channels.set(name, channel)
      }
      peer.addEventListener('connectionstatechange', () => {
        if (!this.closed && ['failed', 'closed'].includes(peer.connectionState)) {
          this.emit('disconnected', { reason: `webrtc_${peer.connectionState}` })
        }
      })
      peer.addEventListener('iceconnectionstatechange', () => {
        // Older WebViews may lack connectionState; fall back to the ICE connection state to dispatch disconnects, which upper layers handle idempotently per Room.
        if (!this.closed && ['failed', 'closed'].includes(peer.iceConnectionState)) {
          this.emit('disconnected', { reason: `webrtc_ice_${peer.iceConnectionState}` })
        }
      })
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      if (peer.iceGatheringState !== 'complete') await gatheringComplete
      clearTimeout(this.gatheringTimeout)
      const offerSdp = peer.localDescription?.sdp
      if (!offerSdp) throw new OnlineError('WEBRTC_OFFER_FAILED', 'WebRTC offer was not generated')
      const hasCandidate = candidates.length > 0 || offerSdp.split(/\r?\n/).some((line) => line.startsWith('a=candidate:'))
      if (!hasCandidate) {
        throw new OnlineError('WEBRTC_OFFER_FAILED', 'ICE gathering timed out without a usable candidate')
      }
      signalingStarted = true
      const answerSdp = await signaling(offerSdp, candidates)
      signalingCompleted = true
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      await this.waitForChannels(this.channelOpenTimeoutMs)
    } catch (error) {
      clearTimeout(this.gatheringTimeout)
      if (error instanceof OnlineError) throw error
      if (signalingStarted && !signalingCompleted) {
        throw new OnlineError('ROOM_SIGNALING_FAILED', 'Room signaling failed')
      }
      throw new OnlineError('WEBRTC_OFFER_FAILED', 'WebRTC negotiation failed in the current runtime')
    }
  }

  /** Send a binary Room frame on the given protocol channel. */
  send(channelName: RoomChannelName, type: string, payload: Uint8Array, sequence: number): void {
    const channel = this.channels.get(channelName)
    if (!channel || channel.readyState !== 'open') {
      throw new OnlineError('ROOM_CHANNEL_CLOSED', `Room channel is unavailable: ${channelName}`)
    }
    if (channelName === 'state_unreliable' && channel.bufferedAmount > 262_144) {
      throw new OnlineError('ROOM_CHANNEL_BUSY', 'Unreliable state channel backlog is too large')
    }
    channel.send(encodeRoomFrame(type, sequence, payload).buffer as ArrayBuffer)
  }

  /** Return a network diagnostics snapshot without addresses, credentials, SDP or ICE candidates. */
  async snapshot(): Promise<NonNullable<NetworkSnapshot['room']>> {
    return {
      transport: 'webrtc',
      connectionState: this.peer?.connectionState ?? 'closed',
      channels: Object.fromEntries(Array.from(this.channels).map(([name, channel]) => [name, channel.readyState])),
    }
  }

  /** Deterministically release the PeerConnection and all DataChannels. */
  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.gatheringTimeout)
    for (const channel of this.channels.values()) channel.close()
    this.channels.clear()
    this.peer?.close()
    this.emit('disconnected', { reason })
  }

  /** Wait for all three negotiated DataChannels to open. */
  private waitForChannels(timeoutMs: number): Promise<void> {
    // Cocos Creator's loose transpilation does not spread a MapIterator correctly; always convert to an array explicitly.
    const allOpen = () => this.channels.size === 3 && Array.from(this.channels.values()).every((channel) => channel.readyState === 'open')
    if (allOpen()) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const channels = Array.from(this.channels.values())
      let settled = false
      const cleanup = () => {
        clearTimeout(timeout)
        clearInterval(poll)
        for (const channel of channels) channel.removeEventListener('open', checkOpen)
      }
      const finish = (error?: OnlineError) => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const checkOpen = () => {
        if (allOpen()) finish()
      }
      // Some host WebViews update readyState but miss the final open event; events plus bounded polling together converge on the real state.
      for (const channel of channels) channel.addEventListener('open', checkOpen)
      const poll = setInterval(checkOpen, Math.min(ROOM_CHANNEL_STATE_POLL_MS, Math.max(1, timeoutMs)))
      const timeout = setTimeout(() => {
        if (allOpen()) finish()
        else finish(new OnlineError('WEBRTC_CHANNEL_TIMEOUT', 'Timed out waiting for Room DataChannels'))
      }, timeoutMs)
      checkOpen()
    })
  }

  /** Verify that the actual channel matches the envelope declaration before surfacing the message. */
  private handleMessage(channel: RoomChannelName, data: unknown): void {
    try {
      if (!(data instanceof ArrayBuffer)) throw new TypeError('binary frame required')
      const frame = decodeRoomFrame(data)
      this.emit('message', { channel, type: frame.type, payload: frame.payload, seq: frame.sequence })
    } catch {
      // Full gameplay payloads must not be logged; the upper layer presents them uniformly through the protocol error event.
      this.emit('message', { channel: 'control_reliable', type: '__cysj_invalid_envelope', payload: new Uint8Array(), seq: 0 })
    }
  }
}

/** Standalone Room WebSocket data plane; the Main Gateway control WebSocket does not carry gameplay frames. */
export class WebSocketRoomTransport extends TypedEmitter<RoomTransportEvents> implements RoomTransport {
  private socket?: WebSocket
  private closed = false
  private pendingState: Uint8Array | undefined = undefined
  private pendingStateTimer: ReturnType<typeof setTimeout> | undefined = undefined

  /** Store the short-lived connection material issued by the server; callers must not assemble these fields from URLs or local configuration. */
  constructor(
    private readonly credential: WebSocketRoomCredential,
    private readonly factory: (url: string) => WebSocket,
    private readonly openTimeoutMs = ROOM_WEBSOCKET_OPEN_TIMEOUT_MS,
  ) {
    super()
  }

  /** Establish a standalone WSS and complete Room authentication in the first frame; room_joined is still confirmed by the unified Room protocol. */
  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new OnlineError('ROOM_WEBSOCKET_CLOSED', 'Room WebSocket is closed'))
    const socket = this.factory(this.credential.endpoint)
    this.socket = socket
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('message', (event) => this.handleMessage(event.data))
    socket.addEventListener('close', (event) => {
      if (!this.closed) this.emit('disconnected', { reason: roomWebSocketCloseReason(event.code, event.reason) })
    })
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: OnlineError) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
        if (error) reject(error)
        else resolve()
      }
      const onOpen = () => {
        try {
          socket.send(JSON.stringify({
            type: 'room_connect',
            room_id: this.credential.roomId,
            token: this.credential.token,
            transport_epoch: this.credential.transportEpoch,
          }))
          finish()
        } catch {
          finish(new OnlineError('ROOM_WEBSOCKET_AUTH_FAILED', 'Failed to send Room WebSocket authentication'))
        }
      }
      const onError = () => finish(new OnlineError('ROOM_WEBSOCKET_CONNECT_FAILED', 'Failed to connect Room WebSocket'))
      const timeout = setTimeout(
        () => finish(new OnlineError('ROOM_WEBSOCKET_CONNECT_TIMEOUT', 'Timed out connecting Room WebSocket')),
        this.openTimeoutMs,
      )
      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
    })
  }

  /** Wrap the original CYR1 frame with one stable channel byte; reliability semantics are still provided by CYR1 and the Room Runtime. */
  send(channelName: RoomChannelName, type: string, payload: Uint8Array, sequence: number): void {
    const socket = this.socket
    if (!socket || socket.readyState !== 1) {
      throw new OnlineError('ROOM_WEBSOCKET_CLOSED', 'Room WebSocket is unavailable')
    }
    const frame = encodeRoomFrame(type, sequence, payload)
    const message = new Uint8Array(frame.byteLength + 1)
    message[0] = ROOM_CHANNELS[channelName].id
    message.set(frame, 1)
    if (channelName === 'state_unreliable' && socket.bufferedAmount > ROOM_WEBSOCKET_UNRELIABLE_BACKLOG_BYTES) {
      // WSS is ordered/reliable; retain only the newest state snapshot and drop stale queued state.
      this.pendingState = message
      this.scheduleStateFlush()
      return
    }
    socket.send(message)
  }

  /** Return Room WebSocket diagnostics without the WSS address, token or epoch. */
  async snapshot(): Promise<NonNullable<NetworkSnapshot['room']>> {
    const connectionState = websocketState(this.socket?.readyState)
    const channelState = connectionState === 'connected' ? 'open' : connectionState
    return {
      transport: 'websocket_degraded',
      connectionState,
      channels: {
        control_reliable: channelState,
        game_reliable: channelState,
        state_unreliable: connectionState === 'connected' ? 'degraded_reliable' : channelState,
      },
    }
  }

  /** Deterministically release the standalone Room WebSocket. */
  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.pendingStateTimer)
    this.pendingState = undefined
    this.socket?.close(1000, reason.slice(0, 123))
    this.emit('disconnected', { reason })
  }

  private scheduleStateFlush(): void {
    if (this.pendingStateTimer || this.closed) return
    this.pendingStateTimer = setTimeout(() => {
      this.pendingStateTimer = undefined
      const socket = this.socket
      const pending = this.pendingState
      if (!socket || !pending || this.closed) return
      if (socket.readyState === 1 && socket.bufferedAmount <= ROOM_WEBSOCKET_UNRELIABLE_BACKLOG_BYTES) {
        this.pendingState = undefined
        socket.send(pending.buffer as ArrayBuffer)
      } else if (socket.readyState === 1) {
        this.scheduleStateFlush()
      }
    }, 10)
  }

  /** Verify the outer channel byte, then reuse CYR1 decoding; text gameplay payloads are not accepted. */
  private handleMessage(data: unknown): void {
    try {
      if (!(data instanceof ArrayBuffer)) throw new TypeError('binary frame required')
      const bytes = new Uint8Array(data)
      const channel = channelFromTransportId(bytes[0])
      if (!channel || bytes.byteLength < 2) throw new TypeError('invalid channel')
      const frame = decodeRoomFrame(bytes.slice(1))
      this.emit('message', { channel, type: frame.type, payload: frame.payload, seq: frame.sequence })
    } catch {
      this.emit('message', { channel: 'control_reliable', type: '__cysj_invalid_envelope', payload: new Uint8Array(), seq: 0 })
    }
  }
}

/** The local transport explicitly reuses the Room Mock loopback WebSocket; online credentials never enter this implementation. */
export class LocalRoomTransport extends TypedEmitter<RoomTransportEvents> implements RoomTransport {
  private closed = false

  /** Inject the local message send function managed by the Socket. */
  constructor(private readonly sendEvent: (type: string, payload: Payload) => void, private readonly roomId: string) {
    super()
  }

  /** The local transport does not perform WebRTC signaling. */
  async connect(): Promise<void> {}

  /** Send gameplay messages through an explicit local Room envelope. */
  send(channel: RoomChannelName, type: string, payload: Uint8Array, sequence: number): void {
    if (this.closed) throw new OnlineError('LOCAL_ROOM_CLOSED', 'Local Room is closed')
    this.sendEvent('local_room_data', {
      match_id: this.roomId,
      channel,
      frame_base64: bytesToBase64(encodeRoomFrame(type, sequence, payload)),
    })
  }

  /** Inject gameplay envelopes returned by the local Mock. */
  receive(channel: RoomChannelName, frameBase64: string): void {
    if (this.closed) return
    const frame = decodeRoomFrame(base64ToBytes(frameBase64))
    this.emit('message', { channel, type: frame.type, payload: frame.payload, seq: frame.sequence })
  }

  /** Return diagnostics explicitly marked as the language Mock loopback WebSocket. */
  async snapshot(): Promise<NonNullable<NetworkSnapshot['room']>> {
    return {
      transport: 'local_mock_websocket',
      roomRuntime: 'language_mock',
      connectionState: this.closed ? 'closed' : 'connected',
      channels: {},
    }
  }

  /** Notify the local Mock to leave the Room and release the transport. */
  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    if (reason !== 'server_close') this.sendEvent('local_room_leave', { match_id: this.roomId })
    this.emit('disconnected', { reason })
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function channelFromTransportId(value: number | undefined): RoomChannelName | undefined {
  return (Object.entries(ROOM_CHANNELS) as [RoomChannelName, (typeof ROOM_CHANNELS)[RoomChannelName]][])
    .find(([, definition]) => definition.id === value)?.[0]
}

function websocketState(value: number | undefined): string {
  if (value === 0) return 'connecting'
  if (value === 1) return 'connected'
  if (value === 2) return 'closing'
  return 'closed'
}
