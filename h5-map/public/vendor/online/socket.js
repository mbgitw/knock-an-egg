import { ControlConnection, GATEWAY_CONNECT_TIMEOUT_MS, GATEWAY_RECOVERY_ATTEMPTS, GATEWAY_RECOVERY_CONNECT_TIMEOUT_MS, } from './control.js';
import { TypedEmitter } from './emitter.js';
import { CONTROL_UPSTREAM_ERROR, CONTROL_MESSAGES, ROOM_BANDWIDTH_LIMIT_EXCEEDED, MATCH_CONNECTION_PENDING, TRANSPORT_LEAVE, TRANSPORT_LEFT, TRANSPORT_PONG, } from './protocol.js';
import { LocalRoomTransport, WebRtcRoomTransport, WebSocketRoomTransport, } from './room-transport.js';
import { BuildaChatGroupHostBridge } from './host-chat-group.js';
import { OnlineError, } from './types.js';
import { decodeJsonPayload, encodeJsonPayload, encodeRoomFrame, roomPayload } from './room-frame.js';
import { bytesToBase64 } from './room-transport.js';
const MATCH_RECOVERY_GRACE_MS = 30_000;
export const CHAT_GROUP_REQUEST_TIMEOUT_MS = 10_000;
/** Bounded wait for host Room enter/leave notifications; the result is not returned to the game and only releases host-side resources. */
export const HOST_ROOM_REQUEST_TIMEOUT_MS = 10_000;
/** Default wait for reading the launching invitation; the maximum wait when the host bridge becomes ready later than the game script. */
export const ROOM_INVITE_REQUEST_TIMEOUT_MS = 10_000;
/** When settling a non-cancelable Ticket, the cadence for actively querying the snapshot when pushes are missing. */
const MATCH_SETTLE_POLL_INTERVAL_MS = 2_000;
/** Minimum wait budget for settling, covering Formation and Room cold start; when the authoritative deadline is later, the authoritative deadline plus grace applies. */
const MATCH_SETTLE_MIN_TIMEOUT_MS = 90_000;
/** Bounded retry count when cancellation races with server versions. */
const MATCH_SETTLE_CANCEL_ATTEMPTS = 5;
const MATCH_TICKET_CANCEL_RACE_ERROR_CODES = new Set([
    'MATCH_TICKET_STALE',
    'MATCH_ASSIGNMENT_STALE',
    'MATCH_TICKET_MOVING',
]);
const WEBRTC_FALLBACK_ERROR_CODES = new Set([
    'WEBRTC_OFFER_FAILED',
    'WEBRTC_CONNECTION_FAILED',
    'WEBRTC_CHANNEL_TIMEOUT',
]);
const ROOM_CONNECT_DISCONNECT_ERROR_CODES = new Set([
    'ROOM_WEBSOCKET_AUTH_INVALID',
    'ROOM_WEBSOCKET_AUTH_REJECTED',
    'ROOM_WEBSOCKET_ROOM_NOT_JOINABLE',
]);
/** Create a per-call idempotency key using Web Crypto or in-process random values. */
function idempotencyKey(value) {
    if (value)
        return value;
    if (globalThis.crypto?.randomUUID)
        return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
/** Determine whether the Ticket has reached an authoritative terminal state that needs no further heartbeats. */
function isTerminalMatchTicket(status) {
    return ['cancelled', 'timeout', 'party_timeout', 'confirm_timeout', 'failed'].includes(status);
}
/** Determine whether a control request can continue reading the authoritative object after resuming the same Gateway session. */
function isRecoverableControlError(error) {
    if (!(error instanceof OnlineError))
        return false;
    const code = String(error.code);
    return [
        'GATEWAY_CLOSED',
        'GATEWAY_TIMEOUT',
        'GATEWAY_CONNECT_FAILED',
        'REQUEST_TIMEOUT',
        String(CONTROL_UPSTREAM_ERROR),
    ].includes(code) || code.endsWith('_UPSTREAM_ERROR');
}
/** Determine whether the error is a transient invalidation caused by a server requeue raising ticket_version; waiting for the pushed new snapshot recovers from it. */
function isStaleMatchTicketError(error) {
    return error instanceof OnlineError && String(error.code) === 'MATCH_TICKET_STALE';
}
/** Determine whether a connect failure happened because the same Ticket was requeued back to a non-RoomReady state; in that case return to waiting instead of abandoning the Ticket. */
function isRequeuedMatchTicketError(error) {
    return error instanceof OnlineError && String(error.code) === 'MATCH_ROOM_NOT_READY';
}
/** Determine whether a cancel failure is only a version, Formation or migration race; settling can continue after rereading the latest snapshot. */
function isMatchTicketCancelRaceError(error) {
    return error instanceof OnlineError && MATCH_TICKET_CANCEL_RACE_ERROR_CODES.has(String(error.code));
}
/** Settle deadline: the Match/Confirm authoritative deadline plus grace, never below the fixed minimum budget, so Tickets in Formation are not timed out too early. */
function matchSettleDeadlineMs(ticket, startedAtMs) {
    const authoritativeDeadlineMs = Math.max(Number(ticket.match_deadline_at_millis ?? 0), Number(ticket.confirm_deadline_at_millis ?? 0));
    return Math.max(startedAtMs + MATCH_SETTLE_MIN_TIMEOUT_MS, authoritativeDeadlineMs > 0 ? authoritativeDeadlineMs + MATCH_RECOVERY_GRACE_MS : 0);
}
/** Only an explicit local WebRTC connection failure may enter the WSS fallback; control-plane, authentication and business errors must be surfaced as is. */
function isWebRtcFallbackEligible(error) {
    return error instanceof OnlineError && WEBRTC_FALLBACK_ERROR_CODES.has(String(error.code));
}
/** Map WSS first-frame authentication closes to connect errors to avoid falling into the room_joined timeout. */
function roomConnectDisconnectError(reason) {
    const code = ROOM_CONNECT_DISCONNECT_ERROR_CODES.has(reason)
        ? reason
        : 'ROOM_TRANSPORT_DISCONNECTED';
    return new OnlineError(code, `Room transport disconnected before join confirmation: ${reason}`);
}
/** Compatibility for older browsers and WebViews that lack AbortSignal.throwIfAborted. */
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
/** Wait for the given time, allowing the caller to abort flows that are still waiting for opponents. */
function abortableDelay(timeoutMs, signal) {
    if (signal?.aborted)
        return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, timeoutMs);
        const onAbort = () => {
            clearTimeout(timeout);
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/** Exposes the Room handle gameplay needs, without exposing the platform runtime location, credentials or SDP. */
class OnlineRoom {
    roomId;
    socket;
    left = false;
    markLeft() { this.left = true; }
    generation = 0;
    sessionId = '';
    presences = [];
    /** Store the Room ID and delegate sending and leaving to the Socket. */
    constructor(roomId, socket) {
        this.roomId = roomId;
        this.socket = socket;
    }
    /** Send a message over the reliable gameplay channel. */
    sendReliable(opCode, data) {
        this.socket.sendRoomData(this.roomId, 'game_reliable', opCode, data);
    }
    /** Send critical intents over the reliable control channel. */
    sendControl(opCode, data) {
        this.socket.sendRoomData(this.roomId, 'control_reliable', opCode, data);
    }
    /** Send high-frequency state over the latest-wins unreliable channel. */
    sendUnreliable(opCode, data) {
        this.socket.sendRoomData(this.roomId, 'state_unreliable', opCode, data);
    }
    /** Actively leave the current Room. */
    leave() {
        if (this.left)
            return Promise.resolve();
        return this.socket.leaveRoom(this.roomId, this);
    }
    /** Join the host chat group using the current Room ID as the group ID; teamId is decided by the game. */
    joinChatGroup(teamId) {
        return this.socket.joinChatGroup(this.roomId, teamId);
    }
    /** Actively quit the host chat group of the current Room; succeeds idempotently when not joined. */
    quitChatGroup() {
        return this.socket.quitChatGroup(this.roomId);
    }
}
/** Implements H5 Match, Party, Room, invitation and automatic reconnect capabilities. */
export class OnlineSocket extends TypedEmitter {
    config;
    control;
    rooms = new Map();
    completedLeaves = new Map();
    credentials = new Map();
    latestMatchTickets = new Map();
    matchTicketWaiters = new Map();
    sequence = 0;
    gatewayRttMs;
    roomRttMs = new Map();
    pendingRoomPongs = new Map();
    pendingRoomLeaves = new Map();
    // Rooms whose chat group was joined successfully, with their teamId; used to quit automatically on leaving, Room close and Socket close.
    chatGroups = new Map();
    chatGroupHostBridge;
    // Subscribe to host messages only while at least one Room's chat group is joined; unsubscribe after all are quit to avoid lingering page listeners.
    chatMessageUnsubscribe;
    // Rooms for which the host was notified of enterRoom; leaveRoom is notified automatically on leaving, Room close, reconnect grace exhaustion and Socket close.
    hostRooms = new Set();
    session;
    closedByClient = false;
    gatewayRecovery;
    partyInvitesSubscribed = false;
    partyInvites = new Map();
    currentParty;
    leaseHeartbeatTimer;
    leaseHeartbeatRunning = false;
    /** Create a real-time Socket without accessing the network in the constructor. */
    constructor(config) {
        super();
        this.config = config;
        const factory = config.webSocketFactory ?? ((url) => new WebSocket(url));
        this.control = new ControlConnection(config.gatewayUrl, config.requestTimeoutMs ?? 20_000, factory);
        this.control.on('push', (message) => this.handleControlPush(message.type, message.payload));
        this.chatGroupHostBridge = config.chatGroupHostBridge ?? new BuildaChatGroupHostBridge();
    }
    /** Connect to the Gateway and authenticate with the platform runtime token. */
    async connect(session, timeoutMs = GATEWAY_CONNECT_TIMEOUT_MS) {
        this.closedByClient = false;
        await this.connectAndAuthenticate(session, timeoutMs, true);
        this.ensureLeaseHeartbeat();
    }
    /** Establish and authenticate the Gateway once; the recovery path does not dispatch the initial connected again. */
    async connectAndAuthenticate(session, timeoutMs, emitConnected) {
        await this.control.connect(timeoutMs);
        let payload;
        try {
            payload = await this.request(CONTROL_MESSAGES.auth, {
                token: session.token,
                game_id: this.config.gameId,
            });
        }
        catch (error) {
            this.control.close(1000, 'authentication_failed');
            throw error;
        }
        session.userId = String(payload.user_id ?? '');
        session.gameId = String(payload.game_id ?? '');
        session.onlineCompatibilityRevision = Number(payload.online_compatibility_revision ?? 0);
        session.expiresAtUnixSeconds = Number(payload.expires_at_unix_seconds ?? 0);
        if (!session.userId || session.gameId !== this.config.gameId) {
            this.control.close(1000, 'authentication_failed');
            throw new OnlineError('AUTH_FAILED', 'Builda Online authentication failed');
        }
        this.session = session;
        // The invitation snapshot is only a best-effort recovered projection; failure must not interrupt the authenticated Gateway session, and later pushes realign it.
        if (this.partyInvitesSubscribed) {
            try {
                this.applyPartyInvites(await this.request(CONTROL_MESSAGES.partyInviteList, {}));
            }
            catch { /* Keep the local projection */ }
        }
        if (emitConnected)
            this.emit('connected', undefined);
    }
    /** Create a Match Ticket using Room Admission. */
    joinRoom(matchKey, options = {}) {
        return this.request(CONTROL_MESSAGES.matchJoinRoom, {
            ...this.joinPayload(matchKey, options),
            ...(options.targetRoomId ? { target_room_id: options.targetRoomId } : {}),
            allow_create: options.allowCreate ?? true,
        }, 'replay_once');
    }
    /** Join a Room-mode or private Room by Room ID; the Room ID itself is the Online admission credential. */
    async joinRoomById(roomId, options = {}) {
        const room = await this.getRoom(roomId);
        const activity = room.activity;
        const matchKey = String(activity?.queue_name ?? '');
        const mode = String(activity?.mode ?? '');
        const accessKind = String(room.access_kind ?? '');
        if (!matchKey || !(accessKind === 'private' || (accessKind === 'public' && mode === 'room'))) {
            throw new OnlineError('ROOM_ID_NOT_JOINABLE', 'Room ID does not identify a directly joinable room');
        }
        return this.joinRoom(matchKey, {
            ...options,
            targetRoomId: roomId,
            allowCreate: false,
        });
    }
    /** Create a Match Ticket using regular Pool Admission. */
    joinPool(matchKey, options = {}) {
        return this.request(CONTROL_MESSAGES.matchJoinPool, this.joinPayload(matchKey, options), 'replay_once');
    }
    /** Create a ranked Ticket with a client-provided score; omitting the score is only for compatibility with old calls. */
    joinRankPool(matchKey, options = {}) {
        return this.request(CONTROL_MESSAGES.matchJoinRankPool, {
            ...this.joinPayload(matchKey, options),
            ...(options.rankScore !== undefined ? { rank_score: options.rankScore } : {}),
            ...(options.memberRankScores !== undefined ? { member_rank_scores: { ...options.memberRankScores } } : {}),
        }, 'replay_once');
    }
    /** Query and restore the authoritative Ticket snapshot. */
    async getMatchTicket(ticketId, ticketVersion) {
        const ticket = await this.request(CONTROL_MESSAGES.matchTicketGet, {
            ticket_id: ticketId,
            ...(ticketVersion === undefined ? {} : { ticket_version: ticketVersion }),
        }, 'replay_once');
        this.rememberMatchTicket(ticket);
        return ticket;
    }
    /** Renew a Ticket that can still wait or confirm. */
    heartbeatMatchTicket(ticketId, ticketVersion, key) {
        return this.ticketMutation(CONTROL_MESSAGES.matchTicketHeartbeat, ticketId, ticketVersion, key);
    }
    /** Wait for the Ticket to reach RoomReady, renewing automatically during waiting, Formation and Room cold start. */
    async waitMatchTicketReady(ticket, options = {}) {
        const ticketId = ticket.ticket_id;
        let ticketVersion = ticket.ticket_version;
        if (!ticketId || ticketVersion < 0)
            throw new OnlineError('MATCH_TICKET_INVALID', 'Ticket identifier is invalid');
        this.rememberMatchTicket(ticket);
        const intervalMs = Math.max(1_000, options.heartbeatIntervalMs ?? 5_000);
        const matchDeadlineMs = Number(ticket.match_deadline_at_millis ?? 0);
        const recoveryDeadlineMs = matchDeadlineMs > 0
            ? matchDeadlineMs + MATCH_RECOVERY_GRACE_MS
            : Number.POSITIVE_INFINITY;
        let heartbeatSequence = 0;
        let nextHeartbeatAtMs = Date.now() + intervalMs;
        while (!this.closedByClient) {
            throwIfAborted(options.signal);
            if (Date.now() >= recoveryDeadlineMs) {
                throw new OnlineError('MATCH_RECOVERY_TIMEOUT', 'Authoritative terminal state is still unavailable after the Ticket deadline');
            }
            if (!this.control.isOpen()) {
                await this.recoverGateway();
                try {
                    ticket = await this.getMatchTicket(ticketId, ticketVersion);
                    nextHeartbeatAtMs = Date.now() + intervalMs;
                }
                catch (error) {
                    if (isStaleMatchTicketError(error)) {
                        ticket = await this.resyncStaleMatchTicket(ticketId) ?? ticket;
                        nextHeartbeatAtMs = Date.now() + intervalMs;
                        continue;
                    }
                    if (isRecoverableControlError(error))
                        continue;
                    throw error;
                }
            }
            const latest = this.latestMatchTickets.get(ticketId) ?? ticket;
            if (latest.status === 'room_ready' || latest.status === 'confirmed' || isTerminalMatchTicket(latest.status)) {
                return latest;
            }
            if (latest.ticket_version !== ticketVersion) {
                // Requeue only raises the fencing version of the same Ticket; while it is still waiting the lease must keep being renewed,
                // and the version change must not be misreported to the game layer as RoomReady.
                ticket = latest;
                ticketVersion = latest.ticket_version;
                continue;
            }
            // The heartbeat is an unconditional wall-clock renewal cadence; pushes only wake early and must not delay the next renewal.
            await this.waitForMatchTicketUpdate(ticketId, latest, Math.max(0, nextHeartbeatAtMs - Date.now()), options.signal);
            if (this.latestMatchTickets.get(ticketId) !== latest)
                continue;
            if (Date.now() < nextHeartbeatAtMs)
                continue;
            if (!this.control.isOpen())
                continue;
            try {
                ticket = await this.heartbeatMatchTicket(ticketId, ticketVersion, `sdk-wait-${ticketId}-${++heartbeatSequence}`);
                nextHeartbeatAtMs = Date.now() + intervalMs;
            }
            catch (error) {
                // A STALE heartbeat means a requeue raised the version without renewing; resync the latest snapshot with an unversioned get and renew.
                if (isStaleMatchTicketError(error)) {
                    ticket = await this.resyncStaleMatchTicket(ticketId) ?? ticket;
                    nextHeartbeatAtMs = Date.now() + intervalMs;
                    continue;
                }
                // Rolling releases or brief dependency jitter only affect this heartbeat; keep recovering the original Ticket and never create a new Admission.
                if (isRecoverableControlError(error)) {
                    nextHeartbeatAtMs = Date.now() + intervalMs;
                    continue;
                }
                throw error;
            }
        }
        throw new OnlineError('GATEWAY_CLOSED', 'Gateway closed while waiting for Match');
    }
    /** Cancel a Ticket that can still be canceled. */
    cancelMatchTicket(ticketId, ticketVersion, key) {
        return this.ticketMutation(CONTROL_MESSAGES.matchTicketCancel, ticketId, ticketVersion, key);
    }
    /**
     * Settle a possibly still-live Ticket to an authoritative terminal state: waiting states are canceled directly with version races handled; non-cancelable states such as Formation or RoomReady
     * wait boundedly for a terminal state or a requeue back to waiting. `confirmed` means the Room was entered; it is returned as is, and the caller should actively leave through the Room handle.
     */
    async settleMatchTicket(ticket, options = {}) {
        const ticketId = ticket.ticket_id;
        if (!ticketId)
            throw new OnlineError('MATCH_TICKET_INVALID', 'Ticket identifier is invalid');
        const operationKey = idempotencyKey(options.idempotencyKey);
        this.rememberMatchTicket(ticket);
        let current = this.latestMatchTickets.get(ticketId) ?? ticket;
        const startedAtMs = Date.now();
        let cancelSequence = 0;
        while (!this.closedByClient) {
            throwIfAborted(options.signal);
            if (isTerminalMatchTicket(current.status) || current.status === 'confirmed')
                return current;
            if (Date.now() >= matchSettleDeadlineMs(current, startedAtMs)) {
                throw new OnlineError('MATCH_RECOVERY_TIMEOUT', 'Ticket did not reach an authoritative terminal state before its deadline');
            }
            if (!this.control.isOpen())
                await this.recoverGateway();
            if (current.status === 'waiting') {
                if (cancelSequence >= MATCH_SETTLE_CANCEL_ATTEMPTS) {
                    throw new OnlineError('MATCH_CANCEL_NOT_SETTLED', 'Ticket cancellation kept racing with server-side updates');
                }
                cancelSequence += 1;
                try {
                    current = await this.cancelMatchTicket(ticketId, current.ticket_version, `${operationKey}-cancel-${cancelSequence}`);
                    continue;
                }
                catch (error) {
                    if (!isMatchTicketCancelRaceError(error) && !isRecoverableControlError(error))
                        throw error;
                    // Version race, Formation in progress or queue migration: back off, reread the latest snapshot, then decide whether to keep canceling or wait for a terminal state.
                    await abortableDelay(250 * cancelSequence + Math.floor(Math.random() * 100), options.signal);
                    current = await this.resyncStaleMatchTicket(ticketId) ?? current;
                    continue;
                }
            }
            // matched/room_ready cannot be canceled: wait for pushes and actively query when the cadence expires, until a terminal state or a requeue back to waiting.
            await this.waitForMatchTicketUpdate(ticketId, current, MATCH_SETTLE_POLL_INTERVAL_MS, options.signal);
            const latest = this.latestMatchTickets.get(ticketId);
            current = latest && latest !== current ? latest : (await this.resyncStaleMatchTicket(ticketId) ?? current);
        }
        throw new OnlineError('GATEWAY_CLOSED', 'Gateway closed while settling the Ticket');
    }
    /** Query the authoritative RoomDirectory snapshot. */
    getRoom(roomId) {
        return this.request(CONTROL_MESSAGES.roomGet, { room_id: roomId }, 'replay_once');
    }
    /** Return the currently public and joinable Rooms of a Room Activity. */
    listAvailableRooms(matchKey, limit = 20) {
        return this.request(CONTROL_MESSAGES.roomList, { match_key: matchKey, limit }, 'replay_once');
    }
    /** Create a private Room joinable only by Room ID, returning the authoritative directory and the creator Seat; usually use createAndConnectPrivateRoom directly. */
    createPrivateRoom(matchKey, key) {
        return this.request(CONTROL_MESSAGES.roomPrivateCreate, {
            match_key: matchKey,
            idempotency_key: idempotencyKey(key),
        }, 'replay_once');
    }
    /**
     * Create a private Room and enter it as the creator: private Rooms stay out of the public list and automatic matchmaking and can only be joined by Room ID;
     * the creator and later members are equal inside the Room. Credential issuance and connection are handled by the SDK; the game keeps only the returned Room handle.
     */
    async createAndConnectPrivateRoom(matchKey, options = {}) {
        const operationKey = idempotencyKey(options.idempotencyKey);
        const created = await this.createPrivateRoom(matchKey, operationKey);
        const room = (created.room ?? {});
        // Older servers still return owner_seat; both mean the same thing: the creator's first Seat.
        const seat = (created.creator_seat ?? created.owner_seat);
        const roomId = String(room.room_id ?? '');
        if (!roomId || !seat || typeof seat !== 'object') {
            throw new OnlineError('PRIVATE_ROOM_RESPONSE_INVALID', 'Private Room creation did not return a Room and creator Seat');
        }
        const receipt = await this.issueRoomCredential(roomId, Number(room.room_generation ?? 0), Number(seat.presence_epoch ?? 0), `${operationKey}-credential`);
        if (receipt.roomId !== roomId)
            throw new OnlineError('ROOM_CREDENTIAL_INVALID', 'Credential receipt does not match the created Room');
        return this.connectRoom(roomId);
    }
    /** Issue the short-lived Room credential for the first connect or a reconnect, cached only in memory. */
    async issueRoomCredential(roomId, generation, expectedPresenceEpoch, key) {
        const issued = await this.request(CONTROL_MESSAGES.roomCredential, {
            room_id: roomId,
            room_generation: generation,
            expected_presence_epoch: expectedPresenceEpoch,
            idempotency_key: idempotencyKey(key),
        }, 'replay_once');
        this.credentials.set(roomId, issued);
        return this.publicCredentialReceipt(issued);
    }
    /** Join the Room with the credential most recently issued or obtained by accepting an invitation. */
    async connectRoom(roomId, allowWebSocketFallback = true) {
        const issued = this.credentials.get(roomId);
        if (!issued)
            throw new OnlineError('ROOM_CREDENTIAL_MISSING', 'Issue a Room credential first');
        try {
            return await this.connectRoomInternal(roomId, issued, false);
        }
        catch (error) {
            if (String(issued.room_transport ?? 'webrtc') !== 'webrtc'
                || !allowWebSocketFallback || !isWebRtcFallbackEligible(error) || !this.websocketTransport(issued))
                throw error;
            const credential = (issued.credential ?? {});
            await this.issueRoomCredential(roomId, Number(credential.room_generation ?? 0), Number(credential.presence_epoch ?? 0), `websocket-fallback-${roomId}-${Date.now()}`);
            const fallbackIssued = this.credentials.get(roomId);
            if (!fallbackIssued)
                throw new OnlineError('ROOM_CREDENTIAL_MISSING', 'Room fallback credential is missing');
            return this.connectRoomInternal(roomId, fallbackIssued, false, 'websocket_degraded');
        }
    }
    /** Idempotently create a Party by the partyKey declared at deploy time. */
    async createParty(partyKey, key) {
        const party = await this.request(CONTROL_MESSAGES.partyCreate, { party_key: partyKey, idempotency_key: idempotencyKey(key) }, 'replay_once');
        this.currentParty = party;
        return party;
    }
    /** Get the authoritative Party snapshot. */
    async getParty(partyId) {
        const party = await this.request(CONTROL_MESSAGES.partyGet, { party_id: partyId }, 'replay_once');
        this.currentParty = party;
        return party;
    }
    /** Restore the Party of the currently authenticated role; returns undefined when not in a Party. */
    async getCurrentParty() {
        const result = await this.request(CONTROL_MESSAGES.partyCurrent, {}, 'replay_once');
        this.currentParty = result.party && typeof result.party === 'object' ? result.party : undefined;
        return this.currentParty;
    }
    /** The party leader creates a time-limited Party invitation. */
    invitePartyMember(partyId, expectedRevision, targetRoleId, key, expiresInMillis = 60_000) {
        return this.request(CONTROL_MESSAGES.partyInvite, {
            party_id: partyId,
            expected_revision: expectedRevision,
            target_role_id: targetRoleId,
            idempotency_key: idempotencyKey(key),
            expires_in_millis: expiresInMillis,
        }, 'replay_once');
    }
    /** Subscribe to Party invitations and immediately restore currently pending invitations; call after registering event listeners. */
    async subscribePartyInvites() {
        this.partyInvitesSubscribed = true;
        const snapshot = await this.request(CONTROL_MESSAGES.partyInviteList, {}, 'replay_once');
        return this.applyPartyInvites(snapshot);
    }
    /** Reject a Party invitation received by the current role. */
    async rejectPartyInvite(partyId, inviteId) {
        const result = await this.request(CONTROL_MESSAGES.partyInviteReject, { party_id: partyId, invite_id: inviteId });
        this.removePartyInvite(inviteId);
        return result;
    }
    /** Join the Party with a received authoritative invitation and update the local invitation snapshot immediately. */
    async acceptPartyInvite(invitation) {
        const result = await this.request(CONTROL_MESSAGES.partyJoin, {
            party_id: invitation.party_id,
            invite_token: invitation.invite_token,
        });
        this.removePartyInvite(invitation.invite_id);
        this.currentParty = result;
        return result;
    }
    /** The party leader revokes a still-pending Party invitation. */
    revokePartyInvite(partyId, inviteId) {
        return this.request(CONTROL_MESSAGES.partyInviteRevoke, { party_id: partyId, invite_id: inviteId });
    }
    /** Leave the Party with the membership epoch. */
    async leaveParty(partyId, expectedRevision, membershipEpoch) {
        const result = await this.request(CONTROL_MESSAGES.partyLeave, { party_id: partyId, expected_revision: expectedRevision, membership_epoch: membershipEpoch });
        this.currentParty = undefined;
        return result;
    }
    /** The current party leader transfers leadership to another member. */
    transferPartyLeader(partyId, expectedRevision, newLeaderRoleId) {
        return this.request(CONTROL_MESSAGES.partyTransferLeader, {
            party_id: partyId,
            expected_revision: expectedRevision,
            new_leader_role_id: newLeaderRoleId,
        });
    }
    /** Refresh the Party member lease and acknowledge the processed version. */
    async heartbeatParty(partyId, membershipEpoch, acknowledgedStateVersion) {
        const party = await this.request(CONTROL_MESSAGES.partyHeartbeat, { party_id: partyId, membership_epoch: membershipEpoch, acknowledged_state_version: acknowledgedStateVersion });
        this.currentParty = party;
        return party;
    }
    /** Switch Party state under the server binding-proof constraint. */
    setPartyState(partyId, expectedRevision, expectedStateVersion, expectedMemberVersion, state, ticketId, roomId) {
        return this.request(CONTROL_MESSAGES.partySetState, {
            party_id: partyId,
            expected_revision: expectedRevision,
            expected_state_version: expectedStateVersion,
            expected_member_version: expectedMemberVersion,
            state,
            ticket_id: ticketId ?? null,
            room_id: roomId ?? null,
        });
    }
    /** Issue a credential for a RoomReady Ticket and connect; arrival on the data plane completes Confirm automatically. */
    async connectMatchedRoom(ticket, key) {
        const operationKey = idempotencyKey(key);
        let current = ticket;
        let credentialIssued = false;
        let expectedPresenceEpoch = Number(ticket.assignment?.presence_epoch ?? 0);
        let credentialSequence = 1;
        let lastError = new OnlineError('ROOM_CONNECT_FAILED', 'Failed to connect to Room');
        let allAttemptsEligibleForFallback = true;
        let fallbackAssignment = ticket.assignment;
        const attemptErrorCodes = [];
        for (let attempt = 1; attempt <= GATEWAY_RECOVERY_ATTEMPTS; attempt += 1) {
            if (!this.control.isOpen())
                await this.recoverGateway();
            try {
                // When the first-round transport outcome is unclear the server may requeue and raise ticket_version; later steps must read the latest snapshot.
                if (attempt > 1)
                    current = await this.getMatchTicket(ticket.ticket_id);
                if (isTerminalMatchTicket(current.status)) {
                    throw new OnlineError('MATCH_TICKET_TERMINAL', `Ticket has reached a terminal state: ${current.status}`);
                }
                if (current.status !== 'room_ready' && current.status !== 'confirmed') {
                    throw new OnlineError('MATCH_ROOM_NOT_READY', `Ticket is not ready to connect: ${current.status}`);
                }
                const assignment = current.assignment ?? ticket.assignment;
                if (!assignment)
                    throw new OnlineError('ASSIGNMENT_MISSING', 'Ticket does not contain Assignment');
                fallbackAssignment = assignment;
                if (!credentialIssued)
                    expectedPresenceEpoch = assignment.presence_epoch;
                await this.issueRoomCredential(assignment.room_id, assignment.room_generation, expectedPresenceEpoch, `${operationKey}-credential-${credentialSequence}`);
                credentialIssued = true;
                const issued = this.credentials.get(assignment.room_id);
                if (issued)
                    issued.sdk_match_ticket = { ticket_id: current.ticket_id, ticket_version: current.ticket_version };
                const credential = (issued?.credential ?? {});
                expectedPresenceEpoch = Number(credential.presence_epoch ?? expectedPresenceEpoch);
                credentialSequence += 1;
                return await this.connectRoom(assignment.room_id, false);
            }
            catch (error) {
                lastError = error;
                allAttemptsEligibleForFallback = allAttemptsEligibleForFallback && isWebRtcFallbackEligible(error);
                attemptErrorCodes.push(error instanceof OnlineError ? String(error.code) : 'ROOM_CONNECT_ATTEMPT_FAILED');
                if (error instanceof OnlineError && ['AUTH_FAILED', 'ASSIGNMENT_MISSING', 'MATCH_TICKET_TERMINAL'].includes(String(error.code))) {
                    throw error;
                }
                if (attempt < GATEWAY_RECOVERY_ATTEMPTS)
                    await abortableDelay(250 * attempt + Math.floor(Math.random() * 100));
            }
        }
        if (allAttemptsEligibleForFallback && fallbackAssignment) {
            await this.issueRoomCredential(fallbackAssignment.room_id, fallbackAssignment.room_generation, expectedPresenceEpoch, `${operationKey}-credential-${credentialSequence}`);
            const fallbackIssued = this.credentials.get(fallbackAssignment.room_id);
            if (fallbackIssued && this.websocketTransport(fallbackIssued)) {
                fallbackIssued.sdk_match_ticket = { ticket_id: current.ticket_id, ticket_version: current.ticket_version };
                return this.connectRoomInternal(fallbackAssignment.room_id, fallbackIssued, false, 'websocket_degraded');
            }
        }
        const attemptSummary = attemptErrorCodes.join(' -> ');
        if (lastError instanceof OnlineError) {
            throw new OnlineError(lastError.code, `${lastError.message} (attempts: ${attemptSummary})`, lastError.requestId);
        }
        throw new OnlineError('ROOM_CONNECT_FAILED', `Failed to connect to Room (attempts: ${attemptSummary})`);
    }
    /**
     * Wait, connect, and automatically return to waiting after a server requeue, until a Room handle is obtained or the Ticket reaches an authoritative terminal state.
     * Each waiting round is still bounded by the original Ticket's Match deadline, which requeue does not extend; other connect failures are thrown as is, and the caller settles the Ticket.
     */
    async waitAndConnectMatchedRoom(ticket, options = {}) {
        const operationKey = idempotencyKey(options.idempotencyKey);
        let current = ticket;
        for (let round = 1;; round += 1) {
            current = await this.waitMatchTicketReady(current, options);
            if (isTerminalMatchTicket(current.status)) {
                throw new OnlineError('MATCH_TICKET_TERMINAL', `Ticket has reached a terminal state: ${current.status}`);
            }
            try {
                return await this.connectMatchedRoom(current, `${operationKey}-round-${round}`);
            }
            catch (error) {
                if (!isRequeuedMatchTicketError(error))
                    throw error;
                // Requeue only returns the same Ticket to waiting and raises its version; keep waiting on the latest snapshot and never create a new Admission.
                current = this.latestMatchTickets.get(current.ticket_id) ?? current;
            }
        }
    }
    /** Measure the Gateway control link RTT. */
    async measureGatewayRtt() {
        const started = performance.now();
        await this.request(CONTROL_MESSAGES.ping, {});
        this.gatewayRttMs = Math.round(performance.now() - started);
        return this.gatewayRttMs;
    }
    /** Measure the RTT of the given Room DataChannel via reserved control messages. */
    measureRoomRtt(roomId, timeoutMs = 5_000) {
        const entry = this.rooms.get(roomId);
        if (!entry)
            return Promise.reject(new OnlineError('ROOM_NOT_CONNECTED', 'Room is not connected'));
        const nonce = `${Date.now()}-${++this.sequence}`;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRoomPongs.delete(nonce);
                reject(new OnlineError('ROOM_PING_TIMEOUT', 'Room RTT measurement timed out'));
            }, timeoutMs);
            this.pendingRoomPongs.set(nonce, {
                started: performance.now(),
                resolve: (rtt) => {
                    clearTimeout(timeout);
                    this.roomRttMs.set(roomId, rtt);
                    resolve(rtt);
                },
            });
            entry.transport.send('control_reliable', '__cysj_transport_ping', encodeJsonPayload({ nonce }), this.sequence);
        });
    }
    /** Return control-plane and Room network snapshots without leaking addresses or credentials. */
    async networkSnapshot(roomId) {
        const snapshot = {
            gateway: {
                transport: this.config.gatewayUrl.startsWith('wss:') ? 'wss/tcp' : 'ws/tcp',
                connectionState: this.control.isOpen() ? 'connected' : 'closed',
                ...(this.gatewayRttMs === undefined ? {} : { rttMs: this.gatewayRttMs }),
            },
        };
        const entry = roomId ? this.rooms.get(roomId) : undefined;
        if (entry) {
            snapshot.room = await entry.transport.snapshot();
            const roomRtt = roomId ? this.roomRttMs.get(roomId) : undefined;
            if (roomRtt !== undefined)
                snapshot.room.rttMs = roomRtt;
        }
        return snapshot;
    }
    /** Send a user message on a standard Room channel. */
    sendRoomData(roomId, channel, opCode, data) {
        if (!Number.isInteger(opCode) || opCode < 0)
            throw new TypeError('opCode must be a non-negative integer');
        const entry = this.rooms.get(roomId);
        if (!entry)
            throw new OnlineError('ROOM_NOT_CONNECTED', 'Room is not connected');
        if (entry.leaveOperation)
            throw new OnlineError('ROOM_LEAVE_PENDING', 'Room leave is pending');
        entry.transport.send(channel, String(opCode), roomPayload(data), ++this.sequence);
    }
    /** Leave is retryable: retain the membership until authoritative confirmation. */
    async leaveRoom(roomId, expectedHandle) {
        for (const [id, expiry] of this.completedLeaves)
            if (expiry <= Date.now())
                this.completedLeaves.delete(id);
        const entry = this.rooms.get(roomId);
        if (!entry) {
            if (this.completedLeaves.has(roomId))
                return;
            throw new OnlineError('ROOM_LEAVE_UNKNOWN', 'No Room leave receipt is available');
        }
        if (expectedHandle && entry.handle !== expectedHandle)
            throw new OnlineError('ROOM_LEAVE_STALE', 'This handle belongs to an earlier Room membership');
        entry.terminal = true;
        entry.leaveOperation ??= idempotencyKey();
        // A single underlying task survives a caller's ten-second wait budget.
        if (!entry.leaveTask) {
            const task = Promise.resolve().then(() => this.commitRoomLeave(roomId, entry));
            entry.leaveTask = task;
            void task.finally(() => { if (entry.leaveTask === task)
                delete entry.leaveTask; }).catch(() => { });
        }
        let timer;
        try {
            await Promise.race([entry.leaveTask, new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new OnlineError('ROOM_LEAVE_PENDING', 'Room leave is pending; retry leave on the same handle')), 10_000);
                })]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async commitRoomLeave(roomId, entry) {
        let committed = entry.transport instanceof LocalRoomTransport;
        const deadline = Date.now() + 10_000;
        const credential = (entry.credential.credential ?? {});
        const handle = String(credential.leave_handle ?? '');
        for (let attempt = 0; !committed && attempt < 3 && Date.now() < deadline; attempt += 1) {
            if (attempt)
                await abortableDelay(Math.min((attempt === 1 ? 500 : 1000) + Math.random() * 100, Math.max(0, deadline - Date.now())));
            if (Date.now() >= deadline)
                break;
            try {
                if (handle) {
                    const result = await this.request(CONTROL_MESSAGES.roomLeave, {
                        room_id: roomId, leave_handle: handle, leave_operation_id: entry.leaveOperation,
                    }, 'transport_bound');
                    committed = result.committed === true && result.leave_operation_id === entry.leaveOperation && result.room_id === roomId;
                }
                else {
                    // Older servers: a live Room data channel is required; failure never drops the handle.
                    committed = await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => { this.pendingRoomLeaves.delete(roomId); resolve(false); }, Math.min(3000, Math.max(1, deadline - Date.now())));
                        this.pendingRoomLeaves.set(roomId, (result) => { clearTimeout(timeout); this.pendingRoomLeaves.delete(roomId); resolve(result); });
                        try {
                            entry.transport.send('control_reliable', TRANSPORT_LEAVE, new Uint8Array(), ++this.sequence);
                        }
                        catch (error) {
                            clearTimeout(timeout);
                            this.pendingRoomLeaves.delete(roomId);
                            reject(error);
                        }
                    });
                }
            }
            catch (error) {
                if (error instanceof OnlineError && ['ROOM_LEAVE_UNKNOWN', 'ROOM_LEAVE_STALE', 'ROOM_LEAVE_PROOF_INVALID', 'ROOM_LEAVE_IDEMPOTENCY_CONFLICT'].includes(String(error.code)))
                    throw error;
            }
        }
        if (!committed)
            throw new OnlineError('ROOM_LEAVE_PENDING', 'Room leave is pending; retry leave on the same handle');
        if (this.rooms.get(roomId) !== entry)
            return;
        entry.handle?.markLeft?.();
        this.rooms.delete(roomId);
        this.credentials.delete(roomId);
        this.roomRttMs.delete(roomId);
        this.completedLeaves.set(roomId, Date.now() + 300_000);
        if (this.completedLeaves.size > 128)
            this.completedLeaves.delete(this.completedLeaves.keys().next().value);
        this.releaseChatGroup(roomId);
        this.releaseHostRoom(roomId);
        entry.transport.close('client_leave');
        this.emit('roomClosed', { roomId, reason: 'client_leave' });
    }
    /**
     * One-time read of the Room invitation that launched this page: the first call returns the invitation, after which the host always returns null. With the roomId, call
     * joinRoomById to request a Seat; returns available=false when the host lacks the capability, and throws stable error codes when the host rejects or times out.
     */
    async takeRoomInvite(options = {}) {
        const bridge = this.chatGroupHostBridge;
        if (bridge.roomInviteAvailable?.() !== true || typeof bridge.takeRoomInvite !== 'function') {
            return { available: false, invite: null };
        }
        const timeoutMs = Math.max(1, options.timeoutMs ?? ROOM_INVITE_REQUEST_TIMEOUT_MS);
        const response = await bridge.takeRoomInvite(timeoutMs);
        if (!response.ok) {
            if (response.error.code === 'HOST_UNAVAILABLE' || response.error.code === 'ROOM_INVITE_UNAVAILABLE') {
                return { available: false, invite: null };
            }
            throw new OnlineError(response.error.code, response.error.message);
        }
        return { available: true, invite: response.invite };
    }
    /** Join the host chat group using the Room ID as the group ID; returns available=false when the host does not support it, without affecting entering the Room. */
    async joinChatGroup(roomId, teamId) {
        if (!Number.isInteger(teamId))
            throw new OnlineError('CHAT_GROUP_TEAM_INVALID', 'teamId must be an integer');
        const entry = this.rooms.get(roomId);
        if (!entry || !entry.handle)
            throw new OnlineError('CHAT_GROUP_ROOM_NOT_CONNECTED', 'Join the Room before joining its chat group');
        if (!this.chatGroupHostBridge.available())
            return { available: false };
        const previous = this.chatGroups.get(roomId);
        if (previous !== undefined && previous !== teamId) {
            // When switching teams, quit the old group first; the host's quit is idempotent for non-members, and failure does not block joining the new group.
            await this.chatGroupHostBridge.request('quitChatGroup', { groupId: roomId, teamId: previous }, CHAT_GROUP_REQUEST_TIMEOUT_MS);
            this.chatGroups.delete(roomId);
        }
        const response = await this.chatGroupHostBridge.request('joinChatGroup', { groupId: roomId, teamId }, CHAT_GROUP_REQUEST_TIMEOUT_MS);
        if (!response.ok)
            throw new OnlineError(response.error.code, response.error.message);
        if (this.rooms.get(roomId) === entry) {
            this.chatGroups.set(roomId, teamId);
            this.syncChatMessageSubscription();
        }
        else {
            this.releaseChatGroupMembership(roomId, teamId);
        }
        return { available: true };
    }
    /** Actively quit the Room's host chat group; returns idempotently when not joined or unsupported by the host. */
    async quitChatGroup(roomId) {
        const available = this.chatGroupHostBridge.available();
        const teamId = this.chatGroups.get(roomId);
        if (teamId === undefined)
            return { available };
        if (!available) {
            this.chatGroups.delete(roomId);
            this.syncChatMessageSubscription();
            return { available: false };
        }
        const response = await this.chatGroupHostBridge.request('quitChatGroup', { groupId: roomId, teamId }, CHAT_GROUP_REQUEST_TIMEOUT_MS);
        if (!response.ok)
            throw new OnlineError(response.error.code, response.error.message);
        this.chatGroups.delete(roomId);
        this.syncChatMessageSubscription();
        return { available: true };
    }
    /** Toggle the host message subscription by current membership; only forward messages of Rooms still in a group. */
    syncChatMessageSubscription() {
        if (this.chatGroups.size > 0) {
            if (this.chatMessageUnsubscribe)
                return;
            this.chatMessageUnsubscribe = this.chatGroupHostBridge.subscribe((message) => this.handleChatMessage(message));
            return;
        }
        const unsubscribe = this.chatMessageUnsubscribe;
        this.chatMessageUnsubscribe = undefined;
        unsubscribe?.();
    }
    /** Map host messages to public events; the group ID is the Room ID, and messages of Rooms not joined are dropped. */
    handleChatMessage(message) {
        if (!this.chatGroups.has(message.groupId))
            return;
        this.emit('chatMessage', {
            roomId: message.groupId,
            teamId: message.teamId,
            senderId: message.senderId,
            text: message.text,
        });
    }
    /** Quit the group automatically when the Room lifecycle ends: best effort, bounded timeout, never throws, never blocks leaving. */
    releaseChatGroup(roomId) {
        const teamId = this.chatGroups.get(roomId);
        if (teamId === undefined)
            return;
        this.chatGroups.delete(roomId);
        this.syncChatMessageSubscription();
        this.releaseChatGroupMembership(roomId, teamId);
    }
    /** Send one background quit to the host; the result only affects the host side and is not returned to the game. */
    releaseChatGroupMembership(roomId, teamId) {
        if (!this.chatGroupHostBridge.available())
            return;
        void this.chatGroupHostBridge
            .request('quitChatGroup', { groupId: roomId, teamId }, CHAT_GROUP_REQUEST_TIMEOUT_MS)
            .catch(() => undefined);
    }
    /** Notify the host of enterRoom automatically after first entering; skip silently when the host lacks the interface; the result is not returned to the game. */
    notifyHostRoomEnter(roomId) {
        if (this.hostRooms.has(roomId))
            return;
        if (this.chatGroupHostBridge.roomNotificationsAvailable?.() !== true)
            return;
        this.hostRooms.add(roomId);
        this.notifyHostRoom('enterRoom', roomId);
    }
    /** Notify the host of leaveRoom automatically when the Room lifecycle ends: sent once, only for Rooms notified with enterRoom. */
    releaseHostRoom(roomId) {
        if (!this.hostRooms.delete(roomId))
            return;
        if (this.chatGroupHostBridge.roomNotificationsAvailable?.() !== true)
            return;
        this.notifyHostRoom('leaveRoom', roomId);
    }
    /** Send one host Room notification in the background: bounded timeout, never throws, never blocks leaving. */
    notifyHostRoom(command, roomId) {
        const notify = this.chatGroupHostBridge.notifyRoom;
        if (typeof notify !== 'function')
            return;
        void Promise.resolve()
            .then(() => notify.call(this.chatGroupHostBridge, command, { roomId }, HOST_ROOM_REQUEST_TIMEOUT_MS))
            .catch(() => undefined);
    }
    /** Close all Room and Gateway connections. */
    close() {
        if (this.closedByClient)
            return;
        this.closedByClient = true;
        if (this.leaseHeartbeatTimer)
            clearInterval(this.leaseHeartbeatTimer);
        this.leaseHeartbeatTimer = undefined;
        for (const [roomId, entry] of this.rooms) {
            entry.terminal = true;
            entry.transport.close('socket_close');
            this.rooms.delete(roomId);
        }
        for (const roomId of Array.from(this.chatGroups.keys()))
            this.releaseChatGroup(roomId);
        for (const roomId of Array.from(this.hostRooms))
            this.releaseHostRoom(roomId);
        this.credentials.clear();
        this.currentParty = undefined;
        this.latestMatchTickets.clear();
        for (const waiters of this.matchTicketWaiters.values()) {
            for (const wake of waiters)
                wake();
        }
        this.matchTicketWaiters.clear();
        this.roomRttMs.clear();
        for (const resolve of this.pendingRoomLeaves.values())
            resolve(false);
        this.pendingRoomLeaves.clear();
        this.pendingRoomPongs.clear();
        this.control.close();
        this.emit('closed', { code: 1000, reason: 'client_close' });
        this.clear();
    }
    /** Rebuild the Gateway within a bounded number of attempts and reauthenticate with the in-memory Session. */
    recoverGateway() {
        if (this.control.isOpen())
            return Promise.resolve();
        if (this.closedByClient || !this.session) {
            return Promise.reject(new OnlineError('GATEWAY_CLOSED', 'Gateway was closed by the client'));
        }
        if (this.gatewayRecovery)
            return this.gatewayRecovery;
        this.gatewayRecovery = (async () => {
            let lastError = new OnlineError('GATEWAY_CONNECT_FAILED', 'Gateway recovery failed');
            for (let attempt = 1; attempt <= GATEWAY_RECOVERY_ATTEMPTS; attempt += 1) {
                if (this.closedByClient)
                    throw new OnlineError('GATEWAY_CLOSED', 'Gateway was closed by the client');
                this.emit('gatewayReconnecting', { attempt });
                try {
                    await this.connectAndAuthenticate(this.session, GATEWAY_RECOVERY_CONNECT_TIMEOUT_MS, false);
                    if (this.closedByClient) {
                        this.control.close(1000, 'client_close');
                        throw new OnlineError('GATEWAY_CLOSED', 'Gateway was closed by the client');
                    }
                    this.emit('gatewayReconnected', undefined);
                    return;
                }
                catch (error) {
                    lastError = error;
                    if (error instanceof OnlineError && error.code === 'AUTH_FAILED')
                        throw error;
                }
                if (attempt < GATEWAY_RECOVERY_ATTEMPTS) {
                    await abortableDelay(Math.min(500 * attempt, 2_000) + Math.floor(Math.random() * 200));
                }
            }
            throw lastError;
        })().finally(() => { this.gatewayRecovery = undefined; });
        return this.gatewayRecovery;
    }
    /** Assemble an Admission request whose rules the client cannot override. */
    joinPayload(matchKey, options) {
        return {
            match_key: matchKey,
            preferences: options.preferences ?? {},
            idempotency_key: idempotencyKey(options.idempotencyKey),
            ...(options.partyId && options.partyRevision !== undefined
                ? { party_id: options.partyId, party_revision: options.partyRevision }
                : {}),
        };
    }
    /** After a heartbeat or recovery read reports STALE, resync the latest snapshot with an unversioned get and renew. */
    async resyncStaleMatchTicket(ticketId) {
        try {
            return await this.getMatchTicket(ticketId);
        }
        catch {
            return undefined;
        }
    }
    /** Send a versioned Ticket mutation. */
    async ticketMutation(type, ticketId, ticketVersion, key) {
        const ticket = await this.request(type, {
            ticket_id: ticketId,
            ticket_version: ticketVersion,
            idempotency_key: idempotencyKey(key),
        }, 'replay_once');
        this.rememberMatchTicket(ticket);
        return ticket;
    }
    /** Recover a half-open Gateway according to request semantics; safe requests are replayed once using only the frozen payload. */
    async request(type, payload, policy = 'ambiguous_mutation') {
        if (['match_join_room', 'match_join_pool', 'match_join_rank_pool', 'room_private_create', 'room_credential'].includes(type)
            && [...this.rooms.values()].some((entry) => entry.leaveOperation)) {
            throw new OnlineError('ROOM_LEAVE_PENDING', 'Confirm the pending Room leave before entering another Room');
        }
        if (!this.control.isOpen() && this.session && !this.closedByClient)
            await this.recoverGateway();
        try {
            return await this.control.request(type, payload);
        }
        catch (error) {
            if (!(error instanceof OnlineError) || !['REQUEST_TIMEOUT', 'GATEWAY_CLOSED'].includes(String(error.code)))
                throw error;
            if (String(error.code) === 'REQUEST_TIMEOUT')
                this.control.invalidate('request_timeout');
            if (policy === 'replay_once') {
                await this.recoverGateway();
                try {
                    return await this.control.request(type, payload);
                }
                catch (retryError) {
                    if (retryError instanceof OnlineError && String(retryError.code) === 'REQUEST_TIMEOUT') {
                        this.control.invalidate('request_timeout');
                    }
                    throw retryError;
                }
            }
            if (String(error.code) === 'REQUEST_TIMEOUT') {
                throw new OnlineError('CONTROL_OUTCOME_UNKNOWN', `Control request outcome is unknown: ${type}`, error.requestId);
            }
            throw error;
        }
    }
    /** Start a single shared lease-renewal loop for transient state, avoiding a separate timer per object. */
    ensureLeaseHeartbeat() {
        if (this.leaseHeartbeatTimer)
            return;
        this.leaseHeartbeatTimer = setInterval(() => { void this.heartbeatActiveLeases(); }, 3_000);
    }
    /** Boundedly renew the current Party and Room; transient network failures are left to server grace and the existing recovery path. */
    async heartbeatActiveLeases() {
        if (this.leaseHeartbeatRunning || this.closedByClient)
            return;
        this.leaseHeartbeatRunning = true;
        try {
            const party = this.currentParty;
            const partyId = String(party?.party_id ?? '');
            const member = Array.isArray(party?.members)
                ? party.members.find((candidate) => String(candidate.role_id ?? '') === String(this.session?.userId ?? ''))
                : undefined;
            if (partyId && member) {
                try {
                    await this.heartbeatParty(partyId, Number(member.membership_epoch ?? 0), Number(party?.state_version ?? 0));
                }
                catch { /* Brief disconnects are absorbed by member grace */ }
            }
            for (const [roomId, entry] of this.rooms) {
                if (entry.terminal)
                    continue;
                const joiningTicket = entry.credential.sdk_match_ticket;
                if (!entry.handle && joiningTicket) {
                    try {
                        await this.heartbeatMatchTicket(joiningTicket.ticket_id, joiningTicket.ticket_version, `connect-lease-${roomId}-${Date.now()}`);
                    }
                    catch { /* Connection waiting still ends through the bounded budget and the authoritative terminal state. */ }
                }
                if (!entry.handle || String(entry.credential.transport ?? '') === 'local')
                    continue;
                try {
                    entry.transport.send('control_reliable', '__cysj_transport_ping', encodeJsonPayload({ nonce: `lease-${roomId}-${Date.now()}` }), ++this.sequence);
                }
                catch { /* The DataChannel disconnect callback handles reconnect */ }
            }
        }
        finally {
            this.leaseHeartbeatRunning = false;
        }
    }
    /** Establish the local or online Room transport and wait for room_joined. */
    async connectRoomInternal(roomId, issued, reconnecting, mode = 'primary') {
        const previous = this.rooms.get(roomId);
        if (previous?.leaveOperation)
            throw new OnlineError('ROOM_LEAVE_PENDING', 'Room leave is pending');
        this.completedLeaves.delete(roomId);
        if (previous && !reconnecting)
            throw new OnlineError('ROOM_ALREADY_CONNECTED', 'Room is already connected');
        const credential = (issued.credential ?? {});
        if (String(credential.room_id ?? '') !== roomId)
            throw new OnlineError('ROOM_CREDENTIAL_INVALID', 'Room credential does not match the target Room');
        const transportName = String(issued.transport ?? credential.transport ?? '');
        const local = transportName === 'local';
        const configuredTransport = String(issued.room_transport ?? 'webrtc');
        const websocket = this.websocketTransport(issued);
        if (!['websocket', 'webrtc'].includes(configuredTransport)) {
            throw new OnlineError('ROOM_TRANSPORT_INVALID', 'Room transport strategy is invalid');
        }
        if (configuredTransport === 'websocket' && !websocket) {
            throw new OnlineError('ROOM_WEBSOCKET_CREDENTIAL_INVALID', 'Room WebSocket credential is unavailable');
        }
        const fallbackWebSocket = mode === 'websocket_degraded' ? websocket : undefined;
        if (mode === 'websocket_degraded' && !fallbackWebSocket) {
            throw new OnlineError('ROOM_WEBSOCKET_CREDENTIAL_INVALID', 'Room WebSocket fallback credential is unavailable');
        }
        let transport;
        if (local) {
            transport = new LocalRoomTransport((type, payload) => this.control.sendEvent(type, payload), roomId);
        }
        else if (configuredTransport === 'websocket' || fallbackWebSocket) {
            transport = new WebSocketRoomTransport((configuredTransport === 'websocket' ? websocket : fallbackWebSocket), this.config.webSocketFactory ?? ((url) => new WebSocket(url)));
        }
        else {
            transport = new WebRtcRoomTransport({
                iceServers: Array.isArray(issued.ice_servers) ? issued.ice_servers : [],
                iceTransportPolicy: issued.ice_transport_policy === 'relay' ? 'relay' : 'all',
            }, this.config.peerConnectionFactory ?? ((configuration) => new RTCPeerConnection(configuration)));
        }
        const entry = {
            transport,
            credential: issued,
            terminal: false,
            reconnecting,
            ...(previous?.handle ? { handle: previous.handle } : {}),
            ...(previous?.transfer ? { transfer: previous.transfer } : {}),
        };
        this.rooms.set(roomId, entry);
        transport.on('message', (envelope) => this.handleRoomEnvelope(roomId, transport, envelope));
        transport.on('disconnected', ({ reason }) => this.handleRoomDisconnected(roomId, transport, reason));
        const joined = new Promise((resolve, reject) => {
            let activationPending = false;
            const failTimeout = () => {
                offMessage();
                offDisconnected();
                reject(new OnlineError('ROOM_JOIN_TIMEOUT', 'Timed out waiting for Room join confirmation'));
            };
            let timeout = setTimeout(failTimeout, 15_000);
            const offMessage = transport.on('message', (envelope) => {
                if (this.rooms.get(roomId) !== entry)
                    return;
                // Once connected, extend the all-member activation wait only once; duplicate or old-connection notifications cannot extend it.
                if (envelope.type === MATCH_CONNECTION_PENDING && envelope.channel === 'control_reliable' && !activationPending) {
                    activationPending = true;
                    clearTimeout(timeout);
                    timeout = setTimeout(failTimeout, 90_000);
                }
                if (envelope.type !== 'room_joined')
                    return;
                clearTimeout(timeout);
                offMessage();
                offDisconnected();
                const payload = decodeJsonPayload(envelope.payload);
                const firstJoin = entry.handle === undefined;
                const handle = entry.handle ?? new OnlineRoom(roomId, this);
                handle.generation = Number(payload.generation ?? credential.room_generation ?? 0);
                handle.sessionId = String(payload.session_id ?? '');
                handle.presences = Array.isArray(payload.presences) ? payload.presences : [];
                entry.handle = handle;
                // Notify the host only on first entry; reconnects and migrations keep the same Room and do not repeat enterRoom.
                if (firstJoin)
                    this.notifyHostRoomEnter(roomId);
                resolve(handle);
            });
            const offDisconnected = transport.on('disconnected', ({ reason }) => {
                if (this.rooms.get(roomId) !== entry)
                    return;
                clearTimeout(timeout);
                offMessage();
                offDisconnected();
                reject(roomConnectDisconnectError(reason));
            });
        });
        // When transport.connect fails first, joined rejects with a timeout later; absorb it early to avoid an unhandled rejection.
        joined.catch(() => { });
        try {
            if (local) {
                await transport.connect(async () => '');
                const payload = await this.request(CONTROL_MESSAGES.localRoomJoin, { room_id: roomId });
                const frame = encodeRoomFrame('room_joined', 0, encodeJsonPayload(payload));
                transport.receive('control_reliable', bytesToBase64(frame));
            }
            else if (fallbackWebSocket) {
                await transport.connect(async () => '');
            }
            else {
                await transport.connect(async (offerSdp, candidates) => {
                    const answer = await this.request(CONTROL_MESSAGES.roomConnect, { room_id: roomId, offer_sdp: offerSdp, candidates });
                    const answerSdp = String(answer.answer_sdp ?? '');
                    if (!answerSdp)
                        throw new OnlineError('ROOM_SIGNALING_FAILED', 'Room signaling did not return SDP answer');
                    return answerSdp;
                });
            }
            const handle = await joined;
            // Re-arm automatic reconnect once connected; connections established by background reconnects also need disconnect monitoring.
            entry.reconnecting = false;
            // Release the old transport only after the new epoch receives room_joined, avoiding local double writes or leftover resources during the switch window.
            if (previous && previous.transport !== transport)
                previous.transport.close('transport_replaced');
            return handle;
        }
        catch (error) {
            entry.terminal = true;
            const current = this.rooms.get(roomId);
            if (current === entry)
                this.rooms.delete(roomId);
            else if (current)
                this.credentials.set(roomId, current.credential);
            transport.close('room_connect_failed');
            throw error;
        }
    }
    /** Read standalone WSS connection material from the issue response; any missing or out-of-range field means the server has not enabled the fallback. */
    websocketTransport(issued) {
        const value = issued.websocket_transport ?? issued.degraded_transport;
        if (!value || typeof value !== 'object')
            return undefined;
        const degraded = value;
        if (!['websocket', 'websocket_degraded'].includes(String(degraded.transport ?? '')))
            return undefined;
        const endpoint = String(degraded.endpoint ?? '');
        const roomId = String(degraded.room_id ?? '');
        const token = String(degraded.token ?? '');
        const transportEpoch = Number(degraded.transport_epoch ?? -1);
        if (!/^wss?:\/\//.test(endpoint) || !roomId || !token || !Number.isSafeInteger(transportEpoch) || transportEpoch < 0) {
            return undefined;
        }
        return { endpoint, roomId, token, transportEpoch };
    }
    /** Dispatch Room lifecycle, Presence and user messages. */
    handleRoomEnvelope(roomId, sourceTransport, envelope) {
        const entry = this.rooms.get(roomId);
        if (!entry || entry.transport !== sourceTransport)
            return;
        if (envelope.type === '__cysj_invalid_envelope') {
            this.emit('error', { code: 'INVALID_ROOM_ENVELOPE', message: 'Failed to parse Room message' });
            return;
        }
        if (envelope.type === MATCH_CONNECTION_PENDING)
            return;
        // Only platform control frames carry JSON; gameplay opCode payloads must stay opaque binary.
        const payload = isJsonRoomControlEnvelope(envelope.type)
            ? decodeJsonPayload(envelope.payload)
            : {};
        if (envelope.type === TRANSPORT_PONG) {
            const nonce = String(payload.nonce ?? '');
            const pending = this.pendingRoomPongs.get(nonce);
            if (pending) {
                this.pendingRoomPongs.delete(nonce);
                pending.resolve(Math.round(performance.now() - pending.started));
            }
            return;
        }
        if (envelope.type === TRANSPORT_LEFT && envelope.channel === 'control_reliable') {
            const resolve = this.pendingRoomLeaves.get(roomId);
            if (resolve) {
                this.pendingRoomLeaves.delete(roomId);
                resolve(true);
            }
            return;
        }
        if (envelope.type === 'room_traffic_limited') {
            const code = String(payload.error_code ?? ROOM_BANDWIDTH_LIMIT_EXCEEDED);
            const scope = String(payload.scope ?? 'room');
            const direction = String(payload.direction ?? 'unknown');
            const limit = Number(payload.limit_bytes_per_second ?? 0);
            const message = `${String(payload.message ?? 'Room bandwidth limit exceeded')} (${scope}/${direction}, limit=${limit} B/s)`;
            this.emit('error', { code, message });
            return;
        }
        if (envelope.type === 'room_closed') {
            if (entry.leaveOperation)
                return;
            entry.terminal = true;
            this.rooms.delete(roomId);
            this.credentials.delete(roomId);
            this.roomRttMs.delete(roomId);
            this.releaseChatGroup(roomId);
            this.releaseHostRoom(roomId);
            const reason = String(payload.reason ?? 'room_closed');
            const errorCode = String(payload.error_code ?? 'ROOM_TERMINATED');
            const message = String(payload.message ?? 'Room is closed');
            this.emit('roomClosed', { roomId, reason, errorCode, message });
            if (errorCode !== 'ROOM_CLOSED')
                this.emit('error', { code: errorCode, message });
            return;
        }
        if (envelope.type === 'match_presence') {
            this.emit('matchPresence', {
                roomId,
                joins: Array.isArray(payload.joins) ? payload.joins : [],
                leaves: Array.isArray(payload.leaves) ? payload.leaves : [],
            });
            return;
        }
        if (envelope.type === 'room_presence') {
            this.emit('roomPresence', { roomId, presence: payload });
            return;
        }
        if (envelope.type === 'room_migrate') {
            void this.beginRoomMigration(roomId, payload);
            return;
        }
        if (envelope.type === 'room_joined')
            return;
        if (envelope.type !== 'state' && envelope.type !== 'state_patch' && !/^-?\d+$/.test(envelope.type))
            return;
        const opCode = envelope.type === 'state' ? -1 : envelope.type === 'state_patch' ? -2 : Number(envelope.type);
        this.emit('roomMessage', {
            roomId,
            channel: envelope.channel,
            opCode,
            data: envelope.payload,
            reliable: envelope.channel !== 'state_unreliable',
        });
    }
    /** Switch to the automatic reconnect path immediately using the new generation fence from the server. */
    async beginRoomMigration(roomId, payload) {
        const entry = this.rooms.get(roomId);
        if (!entry || entry.terminal)
            return;
        const credential = (entry.credential.credential ?? {});
        const targetGeneration = Number(payload.generation ?? 0);
        const targetPresenceEpoch = Number(payload.presence_epoch ?? 0);
        const currentGeneration = Number(credential.room_generation ?? entry.handle?.generation ?? 0);
        if (!Number.isSafeInteger(targetGeneration) || targetGeneration <= currentGeneration)
            return;
        if (!Number.isSafeInteger(targetPresenceEpoch) || targetPresenceEpoch < 0) {
            this.emit('error', { code: 'ROOM_MIGRATION_INVALID', message: 'Room migration Presence fence is invalid' });
            return;
        }
        credential.room_generation = targetGeneration;
        credential.presence_epoch = targetPresenceEpoch;
        entry.transfer = { targetGeneration, startedAtMs: Date.now() };
        this.emit('roomTransferStarted', { roomId, targetGeneration });
        const sourceTransport = entry.transport;
        entry.reconnecting = false;
        this.handleRoomDisconnected(roomId, sourceTransport, 'room_migrate');
        sourceTransport.close('room_migrate');
    }
    /** Recover the latest generation and Seat epoch from the public RoomDirectory when the migration notice is lost. */
    async refreshRoomReconnectCursor(roomId, entry) {
        const snapshot = await this.getRoom(roomId);
        const directory = (snapshot.room ?? snapshot);
        const credential = (entry.credential.credential ?? {});
        const seatId = String(credential.seat_id ?? '');
        const seats = (directory.seats ?? {});
        const seat = (seats[seatId] ?? {});
        const generation = Number(directory.room_generation ?? 0);
        const presenceEpoch = Number(seat.presence_epoch ?? -1);
        if (Number.isSafeInteger(generation) && generation > 0)
            credential.room_generation = generation;
        if (Number.isSafeInteger(presenceEpoch) && presenceEpoch >= 0)
            credential.presence_epoch = presenceEpoch;
    }
    /** Rebuild the Room Peer automatically with a higher Presence epoch within offline_grace. */
    handleRoomDisconnected(roomId, transport, reason) {
        const entry = this.rooms.get(roomId);
        if (!entry || entry.transport !== transport || entry.terminal || entry.reconnecting)
            return;
        // Connect failures before room_joined completes are settled by the connect flow itself and must not trigger background reconnect.
        if (!entry.handle)
            return;
        entry.reconnecting = true;
        void this.reconnectRoom(roomId, entry, reason);
    }
    /** Retry issuing new credentials; publish the single terminal state when the grace deadline is reached. */
    async reconnectRoom(roomId, previous, _reason) {
        const credential = (previous.credential.credential ?? {});
        let generation = Number(credential.room_generation ?? 0);
        let expectedEpoch = Number(credential.presence_epoch ?? 0);
        let credentialSequence = 1;
        const reconnectKeyPrefix = `reconnect-${roomId}-${Date.now()}`;
        const deadline = Date.now() + 60_000;
        let attempt = 0;
        let eligibleWebRtcFailures = 0;
        while (Date.now() < deadline) {
            // Stop background reconnect immediately after the user actively leaves the Room or closes the Socket.
            if (this.closedByClient || previous.terminal)
                return;
            const ownerBeforeIssue = this.rooms.get(roomId);
            if (ownerBeforeIssue && ownerBeforeIssue !== previous)
                return;
            attempt += 1;
            this.emit('roomReconnecting', { roomId, attempt });
            try {
                if (!this.control.isOpen())
                    await this.recoverGateway();
                await this.issueRoomCredential(roomId, generation, expectedEpoch, `${reconnectKeyPrefix}-${credentialSequence}`);
                const ownerAfterIssue = this.rooms.get(roomId);
                if (ownerAfterIssue && ownerAfterIssue !== previous) {
                    this.credentials.set(roomId, ownerAfterIssue.credential);
                    return;
                }
                const issued = this.credentials.get(roomId);
                if (!issued)
                    throw new Error('credential missing');
                const nextCredential = (issued.credential ?? {});
                expectedEpoch = Number(nextCredential.presence_epoch ?? expectedEpoch);
                credentialSequence += 1;
                const useWebSocketFallback = eligibleWebRtcFailures >= GATEWAY_RECOVERY_ATTEMPTS
                    && this.websocketTransport(issued) !== undefined;
                await this.connectRoomInternal(roomId, issued, true, useWebSocketFallback ? 'websocket_degraded' : 'primary');
                this.emit('roomReconnected', { roomId });
                const current = this.rooms.get(roomId);
                const transfer = current?.transfer ?? previous.transfer;
                if (transfer) {
                    const completedGeneration = Number((current?.credential.credential ?? {}).room_generation
                        ?? current?.handle?.generation
                        ?? transfer.targetGeneration);
                    if (current)
                        delete current.transfer;
                    this.emit('roomTransferCompleted', {
                        roomId,
                        generation: completedGeneration,
                        pauseMs: Math.max(0, Date.now() - transfer.startedAtMs),
                    });
                }
                return;
            }
            catch (error) {
                if (isWebRtcFallbackEligible(error))
                    eligibleWebRtcFailures += 1;
                else if (eligibleWebRtcFailures < GATEWAY_RECOVERY_ATTEMPTS)
                    eligibleWebRtcFailures = 0;
                try {
                    await this.refreshRoomReconnectCursor(roomId, previous);
                    const refreshed = (previous.credential.credential ?? {});
                    generation = Number(refreshed.room_generation ?? generation);
                    expectedEpoch = Number(refreshed.presence_epoch ?? expectedEpoch);
                }
                catch {
                    // When the Directory is briefly unavailable, keep the current fence and continue bounded recovery in the next round.
                }
                await new Promise((resolve) => setTimeout(resolve, Math.min(500 * attempt, 2_000) + Math.floor(Math.random() * 200)));
            }
        }
        this.finishRoomReconnectTimeout(roomId, previous);
    }
    /** Reconnect grace exhaustion means the old Room is terminal; dispatch only the Room close so a global error does not override business recovery state. */
    finishRoomReconnectTimeout(roomId, previous) {
        const current = this.rooms.get(roomId);
        if (current && current !== previous)
            return;
        const hadRoomState = this.rooms.has(roomId) || this.credentials.has(roomId) || this.roomRttMs.has(roomId);
        this.rooms.delete(roomId);
        this.credentials.delete(roomId);
        this.roomRttMs.delete(roomId);
        this.releaseChatGroup(roomId);
        this.releaseHostRoom(roomId);
        if (hadRoomState)
            this.emit('roomClosed', { roomId, reason: 'reconnect_timeout' });
    }
    /** Dispatch Gateway async pushes and local gameplay transport. */
    handleControlPush(type, value) {
        const payload = (value ?? {});
        if (type === CONTROL_MESSAGES.matchTicketUpdated) {
            const ticket = payload;
            if (this.rememberMatchTicket(ticket))
                this.emit('matchTicketUpdated', ticket);
        }
        else if (type === CONTROL_MESSAGES.partyUpdated)
            this.emit('partyUpdated', payload);
        else if (type === CONTROL_MESSAGES.partyInvitesUpdated)
            this.applyPartyInvites(payload);
        else if (type === CONTROL_MESSAGES.error)
            this.emit('error', { code: String(payload.error_code ?? payload.code ?? 'CONTROL_ERROR'), message: String(payload.message ?? 'Control plane error') });
        else if (type === CONTROL_MESSAGES.localRoomMessage) {
            const roomId = String(payload.match_id ?? '');
            const entry = this.rooms.get(roomId);
            if (entry?.transport instanceof LocalRoomTransport) {
                entry.transport.receive(String(payload.channel ?? ''), String(payload.frame_base64 ?? ''));
            }
        }
    }
    /** Apply the full invitation snapshot and emit a single notification only for newly appearing invitations. */
    applyPartyInvites(value) {
        const invites = Array.isArray(value.invites) ? value.invites : [];
        const previousIds = new Set(this.partyInvites.keys());
        this.partyInvites.clear();
        for (const invite of invites) {
            const inviteId = String(invite.invite_id ?? '');
            if (!inviteId)
                continue;
            this.partyInvites.set(inviteId, invite);
            if (!previousIds.has(inviteId))
                this.emit('partyInviteReceived', invite);
        }
        const snapshot = { invites };
        this.emit('partyInvitesUpdated', snapshot);
        return invites;
    }
    /** Remove terminal invitations from the local authoritative Party invitation snapshot projection. */
    removePartyInvite(inviteId) {
        if (!this.partyInvites.delete(inviteId))
            return;
        this.emit('partyInvitesUpdated', { invites: Array.from(this.partyInvites.values()) });
    }
    /** Cache the latest Ticket push to avoid reading a stale snapshot when automatic arrival commits interleave with active queries. */
    rememberMatchTicket(ticket) {
        if (!ticket?.ticket_id)
            return false;
        const current = this.latestMatchTickets.get(ticket.ticket_id);
        if (current?.status === 'confirmed' && ticket.status !== 'confirmed')
            return false;
        const currentTicketVersion = Number(current?.ticket_version ?? -1);
        const incomingTicketVersion = Number(ticket.ticket_version ?? -1);
        if (current && currentTicketVersion > incomingTicketVersion)
            return false;
        if (current && currentTicketVersion === incomingTicketVersion
            && Number(current.revision ?? 0) > Number(ticket.revision ?? 0))
            return false;
        this.latestMatchTickets.set(ticket.ticket_id, ticket);
        const waiters = this.matchTicketWaiters.get(ticket.ticket_id);
        if (waiters) {
            this.matchTicketWaiters.delete(ticket.ticket_id);
            for (const wake of waiters)
                wake();
        }
        return true;
    }
    /** Wake immediately on a Ticket push; the timeout only drives the next keep-alive query. */
    waitForMatchTicketUpdate(ticketId, observed, timeoutMs, signal) {
        if (signal?.aborted)
            return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return new Promise((resolve, reject) => {
            let settled = false;
            const waiters = this.matchTicketWaiters.get(ticketId) ?? new Set();
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                signal?.removeEventListener('abort', abort);
                waiters.delete(finish);
                if (waiters.size === 0 && this.matchTicketWaiters.get(ticketId) === waiters) {
                    this.matchTicketWaiters.delete(ticketId);
                }
                resolve();
            };
            const abort = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                waiters.delete(finish);
                if (waiters.size === 0 && this.matchTicketWaiters.get(ticketId) === waiters) {
                    this.matchTicketWaiters.delete(ticketId);
                }
                reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
            };
            const timeout = setTimeout(finish, timeoutMs);
            waiters.add(finish);
            this.matchTicketWaiters.set(ticketId, waiters);
            signal?.addEventListener('abort', abort, { once: true });
            // Eliminate the race of a push arriving between "check cache" and "register waiter".
            if (this.latestMatchTickets.get(ticketId) !== observed)
                finish();
        });
    }
    /** Return only the stable issue result to the game; full credentials and ICE configuration stay only in Socket memory. */
    publicCredentialReceipt(issued) {
        const credential = (issued.credential ?? {});
        return {
            roomId: String(credential.room_id ?? ''),
            roomGeneration: Number(credential.room_generation ?? 0),
            presenceEpoch: Number(credential.presence_epoch ?? 0),
            expiresAtMillis: Number(credential.expires_at_millis ?? 0),
        };
    }
}
/** Distinguish platform JSON control frames from user-defined gameplay frames; never try to parse arbitrary binary gameplay payloads. */
function isJsonRoomControlEnvelope(type) {
    return [
        TRANSPORT_PONG,
        TRANSPORT_LEFT,
        'room_joined',
        'room_closed',
        'room_traffic_limited',
        'match_presence',
        'room_presence',
        'room_migrate',
    ].includes(type);
}
