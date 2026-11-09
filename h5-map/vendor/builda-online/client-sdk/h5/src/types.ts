import type { RoomChannelName } from './protocol.js'

export type Payload = Record<string, unknown>

export interface OnlineClientConfig {
  gatewayUrl: string
  gameId: string
  defaultQueueName: string
  requestTimeoutMs?: number
  webSocketFactory?: (url: string) => WebSocket
  peerConnectionFactory?: (configuration: RTCConfiguration) => RTCPeerConnection
  /** Override the host chat group bridge; defaults to the Builda SDK internal interface and treats the host as unsupported when it is missing. */
  chatGroupHostBridge?: ChatGroupHostBridge
}

/** Chat group operation result; `available=false` means the current host has no chat group capability and the game should hide related entry points. */
export interface ChatGroupResult {
  available: boolean
}

export type ChatGroupHostCommand = 'joinChatGroup' | 'quitChatGroup'

/** Host Room presence notification command: the SDK calls it automatically on the first room_joined and when the Room lifecycle ends; games do not need to integrate it. */
export type HostRoomCommand = 'enterRoom' | 'leaveRoom'

/** Inviter public profile; name/avatar may be empty strings, and the SDK makes a best effort to fill them from host profile data. */
export interface RoomInviter {
  id: string
  name: string
  avatar: string
}

/** The Room invitation that launched this page; roomId is passed directly to joinRoomById, and admission is still decided by the platform. */
export interface RoomInvite {
  roomId: string
  inviter: RoomInviter
}

/** Result of reading the invitation; available=false means the host has no invitation capability, invite=null means this launch was not from an invitation or it was already read. */
export interface RoomInviteResult {
  available: boolean
  invite: RoomInvite | null
}

export type RoomInviteHostResponse =
  | { ok: true; invite: RoomInvite | null }
  | { ok: false; error: { code: string; message: string } }

/** One chat group message pushed by the host; groupId is the Room ID, senderId is the sender roleId, including messages you sent yourself. */
export interface ChatGroupHostMessage {
  groupId: string
  teamId: number
  senderId: string
  text: string
}

/** Room chat message received by the game; only includes messages of Rooms whose chat group the current Socket has joined. */
export interface ChatMessage {
  roomId: string
  teamId: number
  senderId: string
  text: string
}

export type ChatGroupHostResponse =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

/** Host chat group bridge: the SDK depends only on these two methods and is unaware of the host's internal protocol. */
export interface ChatGroupHostBridge {
  available(): boolean
  request(command: ChatGroupHostCommand, params: { groupId: string; teamId: number }, timeoutMs: number): Promise<ChatGroupHostResponse>
  /** Subscribe to host chat messages and return an unsubscribe function; returns a no-op when the host does not support message push. */
  subscribe(handler: (message: ChatGroupHostMessage) => void): () => void
  /** Whether the host provides enterRoom/leaveRoom notifications; older hosts or custom bridges may leave it unimplemented. */
  roomNotificationsAvailable?(): boolean
  /** Notify the host of entering or leaving a Room; the result only affects the host side and is not returned to the game. */
  notifyRoom?(command: HostRoomCommand, params: { roomId: string }, timeoutMs: number): Promise<ChatGroupHostResponse>
  /** Whether the host provides a one-time read of the launching invitation. */
  roomInviteAvailable?(): boolean
  /** One-time read of the Room invitation that launched this page; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
  takeRoomInvite?(timeoutMs: number): Promise<RoomInviteHostResponse>
}

export interface Session {
  readonly token: string
  userId: string
  gameId: string
  onlineCompatibilityRevision: number
  expiresAtUnixSeconds: number
}

export interface MatchAssignment extends Payload {
  assignment_id: string
  room_id: string
  room_generation: number
  round_id: string
  presence_epoch: number
}

export interface MatchTicket extends Payload {
  ticket_id: string
  ticket_version: number
  match_key: string
  mode: string
  status: string
  assignment?: MatchAssignment
}

export interface PartyInvitation extends Payload {
  invite_id: string
  party_id: string
  game_id: string
  leader_role_id: string
  target_role_id: string
  party_revision: number
  invite_token: string
  expires_at_millis: number
  created_at_millis: number
}

export interface MatchJoinOptions {
  /** Only for solo ranked queueing; 0..Number.MAX_SAFE_INTEGER, authenticity is not verified. */
  rankScore?: number
  /** Only for ranked Party queueing; the party leader passes a map from every member role ID to score. */
  memberRankScores?: Record<string, number>
  preferences?: Payload
  partyId?: string
  partyRevision?: number
  idempotencyKey?: string
}

export interface RoomJoinOptions extends MatchJoinOptions {
  targetRoomId?: string
  allowCreate?: boolean
}

/** Public receipt that a Room credential was issued and cached on the current Socket; contains no connection material or ICE configuration. */
export interface RoomCredentialReceipt {
  roomId: string
  roomGeneration: number
  presenceEpoch: number
  expiresAtMillis: number
}

export interface MatchWaitOptions {
  heartbeatIntervalMs?: number
  signal?: AbortSignal
}

/** Options for the combined wait-and-connect; after a server requeue it automatically returns to waiting until a Room handle or an authoritative terminal state is reached. */
export interface MatchConnectOptions extends MatchWaitOptions {
  idempotencyKey?: string
}

/** Options for settling a possibly still-live Ticket to an authoritative terminal state. */
export interface MatchSettleOptions {
  signal?: AbortSignal
  idempotencyKey?: string
}

export interface MatchPresence {
  user_id?: string
  role_id?: string
  session_id?: string
  username?: string
  presence_epoch?: number
}

export interface RoomHandle {
  readonly roomId: string
  readonly generation: number
  readonly sessionId: string
  readonly presences: MatchPresence[]
  sendReliable(opCode: number, data: string | Uint8Array): void
  sendControl(opCode: number, data: string | Uint8Array): void
  sendUnreliable(opCode: number, data: string | Uint8Array): void
  leave(): Promise<void>
  joinChatGroup(teamId: number): Promise<ChatGroupResult>
  quitChatGroup(): Promise<ChatGroupResult>
}

export interface RoomMessage {
  roomId: string
  channel: RoomChannelName
  opCode: number
  data: Uint8Array
  reliable: boolean
}

export interface NetworkSnapshot {
  gateway: { transport: string; connectionState: string; rttMs?: number }
  room?: {
    transport: string
    roomRuntime?: string
    connectionState: string
    channels: Record<string, string>
    rttMs?: number
  }
}

export interface OnlineSocketEvents {
  connected: undefined
  closed: { code: number; reason: string }
  gatewayReconnecting: { attempt: number }
  gatewayReconnected: undefined
  error: { code: string | number; message: string }
  matchTicketUpdated: MatchTicket
  partyUpdated: Payload
  partyInviteReceived: PartyInvitation
  partyInvitesUpdated: { invites: PartyInvitation[] }
  roomMessage: RoomMessage
  matchPresence: { roomId: string; joins: MatchPresence[]; leaves: MatchPresence[] }
  roomPresence: { roomId: string; presence: Payload }
  roomClosed: { roomId: string; reason: string; errorCode?: string; message?: string }
  roomReconnecting: { roomId: string; attempt: number }
  roomReconnected: { roomId: string }
  roomTransferStarted: { roomId: string; targetGeneration: number }
  roomTransferCompleted: { roomId: string; generation: number; pauseMs: number }
  networkChanged: { roomId?: string; snapshot: NetworkSnapshot }
  chatMessage: ChatMessage
}

export class OnlineError extends Error {
  /** Create a stable SDK error that contains no credentials and no full payload. */
  constructor(
    public readonly code: string | number,
    message: string,
    public readonly requestId = '',
  ) {
    super(message)
    this.name = 'OnlineError'
  }
}
