/** Builda Online client wire protocol major version. */
export const CLIENT_PROTOCOL_VERSION = 1

/** Stable error code the Gateway uses when internal Match/Room services are temporarily unavailable. */
export const CONTROL_UPSTREAM_ERROR = 2_002

/** The current client Bundle has no activated compatible server Release. */
export const CLIENT_SERVER_VERSION_UNSUPPORTED_ERROR = 2_003

/** Stable error code when the Room game data plane hits a per-user or per-Room bandwidth limit. */
export const ROOM_BANDWIDTH_LIMIT_EXCEEDED = 'ROOM_BANDWIDTH_LIMIT_EXCEEDED'

/** Stable definitions of the three Room DataChannels; keep the Godot and Unity SDKs in sync when changing them. */
export const ROOM_CHANNELS = {
  control_reliable: { id: 1, ordered: true },
  game_reliable: { id: 2, ordered: true },
  state_unreliable: { id: 3, ordered: false, maxRetransmits: 0 },
} as const

export type RoomChannelName = keyof typeof ROOM_CHANNELS

/** Control message types currently exposed by the Gateway. */
export const CONTROL_MESSAGES = {
  auth: 'auth',
  matchJoinRoom: 'match_join_room',
  matchJoinPool: 'match_join_pool',
  matchJoinRankPool: 'match_join_rank_pool',
  matchTicketGet: 'match_ticket_get',
  matchTicketHeartbeat: 'match_ticket_heartbeat',
  matchTicketCancel: 'match_ticket_cancel',
  matchTicketUpdated: 'match_ticket_updated',
  partyCreate: 'party_create',
  partyCurrent: 'party_current',
  partyGet: 'party_get',
  partyJoin: 'party_join',
  partyInvite: 'party_invite',
  partyInviteList: 'party_invite_list',
  partyInviteReject: 'party_invite_reject',
  partyInviteRevoke: 'party_invite_revoke',
  partyInvitesUpdated: 'party_invites_updated',
  partyLeave: 'party_leave',
  partyTransferLeader: 'party_transfer_leader',
  partyHeartbeat: 'party_heartbeat',
  partySetState: 'party_set_state',
  partyUpdated: 'party_updated',
  roomGet: 'room_get',
  roomList: 'room_list',
  roomPrivateCreate: 'room_private_create',
  roomCredential: 'room_credential',
  roomLeave: 'room_leave',
  roomConnect: 'room_connect',
  localRoomJoin: 'local_room_join',
  localRoomData: 'local_room_data',
  localRoomLeave: 'local_room_leave',
  localRoomMessage: 'local_room_message',
  error: 'error',
  ping: 'ping',
  pong: 'pong',
} as const

export const TRANSPORT_PING = '__cysj_transport_ping'
export const TRANSPORT_PONG = '__cysj_transport_pong'
export const TRANSPORT_LEAVE = '__cysj_room_leave'
export const TRANSPORT_LEFT = '__cysj_room_left'
export const MATCH_CONNECTION_PENDING = 'match_connection_pending'
