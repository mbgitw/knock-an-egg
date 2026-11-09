/** Builda Online client wire protocol major version. */
export declare const CLIENT_PROTOCOL_VERSION = 1;
/** Stable error code the Gateway uses when internal Match/Room services are temporarily unavailable. */
export declare const CONTROL_UPSTREAM_ERROR = 2002;
/** The current client Bundle has no activated compatible server Release. */
export declare const CLIENT_SERVER_VERSION_UNSUPPORTED_ERROR = 2003;
/** Stable error code when the Room game data plane hits a per-user or per-Room bandwidth limit. */
export declare const ROOM_BANDWIDTH_LIMIT_EXCEEDED = "ROOM_BANDWIDTH_LIMIT_EXCEEDED";
/** Stable definitions of the three Room DataChannels; keep the Godot and Unity SDKs in sync when changing them. */
export declare const ROOM_CHANNELS: {
    readonly control_reliable: {
        readonly id: 1;
        readonly ordered: true;
    };
    readonly game_reliable: {
        readonly id: 2;
        readonly ordered: true;
    };
    readonly state_unreliable: {
        readonly id: 3;
        readonly ordered: false;
        readonly maxRetransmits: 0;
    };
};
export type RoomChannelName = keyof typeof ROOM_CHANNELS;
/** Control message types currently exposed by the Gateway. */
export declare const CONTROL_MESSAGES: {
    readonly auth: "auth";
    readonly matchJoinRoom: "match_join_room";
    readonly matchJoinPool: "match_join_pool";
    readonly matchJoinRankPool: "match_join_rank_pool";
    readonly matchTicketGet: "match_ticket_get";
    readonly matchTicketHeartbeat: "match_ticket_heartbeat";
    readonly matchTicketCancel: "match_ticket_cancel";
    readonly matchTicketUpdated: "match_ticket_updated";
    readonly partyCreate: "party_create";
    readonly partyCurrent: "party_current";
    readonly partyGet: "party_get";
    readonly partyJoin: "party_join";
    readonly partyInvite: "party_invite";
    readonly partyInviteList: "party_invite_list";
    readonly partyInviteReject: "party_invite_reject";
    readonly partyInviteRevoke: "party_invite_revoke";
    readonly partyInvitesUpdated: "party_invites_updated";
    readonly partyLeave: "party_leave";
    readonly partyTransferLeader: "party_transfer_leader";
    readonly partyHeartbeat: "party_heartbeat";
    readonly partySetState: "party_set_state";
    readonly partyUpdated: "party_updated";
    readonly roomGet: "room_get";
    readonly roomList: "room_list";
    readonly roomPrivateCreate: "room_private_create";
    readonly roomCredential: "room_credential";
    readonly roomLeave: "room_leave";
    readonly roomConnect: "room_connect";
    readonly localRoomJoin: "local_room_join";
    readonly localRoomData: "local_room_data";
    readonly localRoomLeave: "local_room_leave";
    readonly localRoomMessage: "local_room_message";
    readonly error: "error";
    readonly ping: "ping";
    readonly pong: "pong";
};
export declare const TRANSPORT_PING = "__cysj_transport_ping";
export declare const TRANSPORT_PONG = "__cysj_transport_pong";
export declare const TRANSPORT_LEAVE = "__cysj_room_leave";
export declare const TRANSPORT_LEFT = "__cysj_room_left";
export declare const MATCH_CONNECTION_PENDING = "match_connection_pending";
