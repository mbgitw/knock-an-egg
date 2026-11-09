import { TypedEmitter } from './emitter.js';
import { type RoomChannelName } from './protocol.js';
import { type ChatGroupResult, type MatchConnectOptions, type MatchJoinOptions, type MatchSettleOptions, type MatchWaitOptions, type MatchTicket, type NetworkSnapshot, type OnlineClientConfig, type OnlineSocketEvents, type PartyInvitation, type Payload, type RoomCredentialReceipt, type RoomHandle, type RoomInviteResult, type RoomJoinOptions, type Session } from './types.js';
export declare const CHAT_GROUP_REQUEST_TIMEOUT_MS = 10000;
/** Bounded wait for host Room enter/leave notifications; the result is not returned to the game and only releases host-side resources. */
export declare const HOST_ROOM_REQUEST_TIMEOUT_MS = 10000;
/** Default wait for reading the launching invitation; the maximum wait when the host bridge becomes ready later than the game script. */
export declare const ROOM_INVITE_REQUEST_TIMEOUT_MS = 10000;
/** Implements H5 Match, Party, Room, invitation and automatic reconnect capabilities. */
export declare class OnlineSocket extends TypedEmitter<OnlineSocketEvents> {
    private readonly config;
    private readonly control;
    private readonly rooms;
    private readonly completedLeaves;
    private readonly credentials;
    private readonly latestMatchTickets;
    private readonly matchTicketWaiters;
    private sequence;
    private gatewayRttMs?;
    private readonly roomRttMs;
    private readonly pendingRoomPongs;
    private readonly pendingRoomLeaves;
    private readonly chatGroups;
    private readonly chatGroupHostBridge;
    private chatMessageUnsubscribe;
    private readonly hostRooms;
    private session?;
    private closedByClient;
    private gatewayRecovery;
    private partyInvitesSubscribed;
    private readonly partyInvites;
    private currentParty;
    private leaseHeartbeatTimer;
    private leaseHeartbeatRunning;
    /** Create a real-time Socket without accessing the network in the constructor. */
    constructor(config: OnlineClientConfig);
    /** Connect to the Gateway and authenticate with the platform runtime token. */
    connect(session: Session, timeoutMs?: number): Promise<void>;
    /** Establish and authenticate the Gateway once; the recovery path does not dispatch the initial connected again. */
    private connectAndAuthenticate;
    /** Create a Match Ticket using Room Admission. */
    joinRoom(matchKey: string, options?: RoomJoinOptions): Promise<MatchTicket>;
    /** Join a Room-mode or private Room by Room ID; the Room ID itself is the Online admission credential. */
    joinRoomById(roomId: string, options?: MatchJoinOptions): Promise<MatchTicket>;
    /** Create a Match Ticket using regular Pool Admission. */
    joinPool(matchKey: string, options?: MatchJoinOptions): Promise<MatchTicket>;
    /** Create a ranked Ticket with a client-provided score; omitting the score is only for compatibility with old calls. */
    joinRankPool(matchKey: string, options?: MatchJoinOptions): Promise<MatchTicket>;
    /** Query and restore the authoritative Ticket snapshot. */
    getMatchTicket(ticketId: string, ticketVersion?: number): Promise<MatchTicket>;
    /** Renew a Ticket that can still wait or confirm. */
    heartbeatMatchTicket(ticketId: string, ticketVersion: number, key?: string): Promise<MatchTicket>;
    /** Wait for the Ticket to reach RoomReady, renewing automatically during waiting, Formation and Room cold start. */
    waitMatchTicketReady(ticket: MatchTicket, options?: MatchWaitOptions): Promise<MatchTicket>;
    /** Cancel a Ticket that can still be canceled. */
    cancelMatchTicket(ticketId: string, ticketVersion: number, key?: string): Promise<MatchTicket>;
    /**
     * Settle a possibly still-live Ticket to an authoritative terminal state: waiting states are canceled directly with version races handled; non-cancelable states such as Formation or RoomReady
     * wait boundedly for a terminal state or a requeue back to waiting. `confirmed` means the Room was entered; it is returned as is, and the caller should actively leave through the Room handle.
     */
    settleMatchTicket(ticket: MatchTicket, options?: MatchSettleOptions): Promise<MatchTicket>;
    /** Query the authoritative RoomDirectory snapshot. */
    getRoom(roomId: string): Promise<Payload>;
    /** Return the currently public and joinable Rooms of a Room Activity. */
    listAvailableRooms(matchKey: string, limit?: number): Promise<Payload>;
    /** Create a private Room joinable only by Room ID, returning the authoritative directory and the creator Seat; usually use createAndConnectPrivateRoom directly. */
    createPrivateRoom(matchKey: string, key?: string): Promise<Payload>;
    /**
     * Create a private Room and enter it as the creator: private Rooms stay out of the public list and automatic matchmaking and can only be joined by Room ID;
     * the creator and later members are equal inside the Room. Credential issuance and connection are handled by the SDK; the game keeps only the returned Room handle.
     */
    createAndConnectPrivateRoom(matchKey: string, options?: {
        idempotencyKey?: string;
    }): Promise<RoomHandle>;
    /** Issue the short-lived Room credential for the first connect or a reconnect, cached only in memory. */
    issueRoomCredential(roomId: string, generation: number, expectedPresenceEpoch: number, key?: string): Promise<RoomCredentialReceipt>;
    /** Join the Room with the credential most recently issued or obtained by accepting an invitation. */
    connectRoom(roomId: string, allowWebSocketFallback?: boolean): Promise<RoomHandle>;
    /** Idempotently create a Party by the partyKey declared at deploy time. */
    createParty(partyKey: string, key?: string): Promise<Payload>;
    /** Get the authoritative Party snapshot. */
    getParty(partyId: string): Promise<Payload>;
    /** Restore the Party of the currently authenticated role; returns undefined when not in a Party. */
    getCurrentParty(): Promise<Payload | undefined>;
    /** The party leader creates a time-limited Party invitation. */
    invitePartyMember(partyId: string, expectedRevision: number, targetRoleId: string, key?: string, expiresInMillis?: number): Promise<Payload>;
    /** Subscribe to Party invitations and immediately restore currently pending invitations; call after registering event listeners. */
    subscribePartyInvites(): Promise<PartyInvitation[]>;
    /** Reject a Party invitation received by the current role. */
    rejectPartyInvite(partyId: string, inviteId: string): Promise<Payload>;
    /** Join the Party with a received authoritative invitation and update the local invitation snapshot immediately. */
    acceptPartyInvite(invitation: PartyInvitation): Promise<Payload>;
    /** The party leader revokes a still-pending Party invitation. */
    revokePartyInvite(partyId: string, inviteId: string): Promise<Payload>;
    /** Leave the Party with the membership epoch. */
    leaveParty(partyId: string, expectedRevision: number, membershipEpoch: number): Promise<Payload>;
    /** The current party leader transfers leadership to another member. */
    transferPartyLeader(partyId: string, expectedRevision: number, newLeaderRoleId: string): Promise<Payload>;
    /** Refresh the Party member lease and acknowledge the processed version. */
    heartbeatParty(partyId: string, membershipEpoch: number, acknowledgedStateVersion: number): Promise<Payload>;
    /** Switch Party state under the server binding-proof constraint. */
    setPartyState(partyId: string, expectedRevision: number, expectedStateVersion: number, expectedMemberVersion: number, state: string, ticketId?: string, roomId?: string): Promise<Payload>;
    /** Issue a credential for a RoomReady Ticket and connect; arrival on the data plane completes Confirm automatically. */
    connectMatchedRoom(ticket: MatchTicket, key?: string): Promise<RoomHandle>;
    /**
     * Wait, connect, and automatically return to waiting after a server requeue, until a Room handle is obtained or the Ticket reaches an authoritative terminal state.
     * Each waiting round is still bounded by the original Ticket's Match deadline, which requeue does not extend; other connect failures are thrown as is, and the caller settles the Ticket.
     */
    waitAndConnectMatchedRoom(ticket: MatchTicket, options?: MatchConnectOptions): Promise<RoomHandle>;
    /** Measure the Gateway control link RTT. */
    measureGatewayRtt(): Promise<number>;
    /** Measure the RTT of the given Room DataChannel via reserved control messages. */
    measureRoomRtt(roomId: string, timeoutMs?: number): Promise<number>;
    /** Return control-plane and Room network snapshots without leaking addresses or credentials. */
    networkSnapshot(roomId?: string): Promise<NetworkSnapshot>;
    /** Send a user message on a standard Room channel. */
    sendRoomData(roomId: string, channel: RoomChannelName, opCode: number, data: string | Uint8Array): void;
    /** Leave is retryable: retain the membership until authoritative confirmation. */
    leaveRoom(roomId: string, expectedHandle?: RoomHandle): Promise<void>;
    private commitRoomLeave;
    /**
     * One-time read of the Room invitation that launched this page: the first call returns the invitation, after which the host always returns null. With the roomId, call
     * joinRoomById to request a Seat; returns available=false when the host lacks the capability, and throws stable error codes when the host rejects or times out.
     */
    takeRoomInvite(options?: {
        timeoutMs?: number;
    }): Promise<RoomInviteResult>;
    /** Join the host chat group using the Room ID as the group ID; returns available=false when the host does not support it, without affecting entering the Room. */
    joinChatGroup(roomId: string, teamId: number): Promise<ChatGroupResult>;
    /** Actively quit the Room's host chat group; returns idempotently when not joined or unsupported by the host. */
    quitChatGroup(roomId: string): Promise<ChatGroupResult>;
    /** Toggle the host message subscription by current membership; only forward messages of Rooms still in a group. */
    private syncChatMessageSubscription;
    /** Map host messages to public events; the group ID is the Room ID, and messages of Rooms not joined are dropped. */
    private handleChatMessage;
    /** Quit the group automatically when the Room lifecycle ends: best effort, bounded timeout, never throws, never blocks leaving. */
    private releaseChatGroup;
    /** Send one background quit to the host; the result only affects the host side and is not returned to the game. */
    private releaseChatGroupMembership;
    /** Notify the host of enterRoom automatically after first entering; skip silently when the host lacks the interface; the result is not returned to the game. */
    private notifyHostRoomEnter;
    /** Notify the host of leaveRoom automatically when the Room lifecycle ends: sent once, only for Rooms notified with enterRoom. */
    private releaseHostRoom;
    /** Send one host Room notification in the background: bounded timeout, never throws, never blocks leaving. */
    private notifyHostRoom;
    /** Close all Room and Gateway connections. */
    close(): void;
    /** Rebuild the Gateway within a bounded number of attempts and reauthenticate with the in-memory Session. */
    private recoverGateway;
    /** Assemble an Admission request whose rules the client cannot override. */
    private joinPayload;
    /** After a heartbeat or recovery read reports STALE, resync the latest snapshot with an unversioned get and renew. */
    private resyncStaleMatchTicket;
    /** Send a versioned Ticket mutation. */
    private ticketMutation;
    /** Recover a half-open Gateway according to request semantics; safe requests are replayed once using only the frozen payload. */
    private request;
    /** Start a single shared lease-renewal loop for transient state, avoiding a separate timer per object. */
    private ensureLeaseHeartbeat;
    /** Boundedly renew the current Party and Room; transient network failures are left to server grace and the existing recovery path. */
    private heartbeatActiveLeases;
    /** Establish the local or online Room transport and wait for room_joined. */
    private connectRoomInternal;
    /** Read standalone WSS connection material from the issue response; any missing or out-of-range field means the server has not enabled the fallback. */
    private websocketTransport;
    /** Dispatch Room lifecycle, Presence and user messages. */
    private handleRoomEnvelope;
    /** Switch to the automatic reconnect path immediately using the new generation fence from the server. */
    private beginRoomMigration;
    /** Recover the latest generation and Seat epoch from the public RoomDirectory when the migration notice is lost. */
    private refreshRoomReconnectCursor;
    /** Rebuild the Room Peer automatically with a higher Presence epoch within offline_grace. */
    private handleRoomDisconnected;
    /** Retry issuing new credentials; publish the single terminal state when the grace deadline is reached. */
    private reconnectRoom;
    /** Reconnect grace exhaustion means the old Room is terminal; dispatch only the Room close so a global error does not override business recovery state. */
    private finishRoomReconnectTimeout;
    /** Dispatch Gateway async pushes and local gameplay transport. */
    private handleControlPush;
    /** Apply the full invitation snapshot and emit a single notification only for newly appearing invitations. */
    private applyPartyInvites;
    /** Remove terminal invitations from the local authoritative Party invitation snapshot projection. */
    private removePartyInvite;
    /** Cache the latest Ticket push to avoid reading a stale snapshot when automatic arrival commits interleave with active queries. */
    private rememberMatchTicket;
    /** Wake immediately on a Ticket push; the timeout only drives the next keep-alive query. */
    private waitForMatchTicketUpdate;
    /** Return only the stable issue result to the game; full credentials and ICE configuration stay only in Socket memory. */
    private publicCredentialReceipt;
}
