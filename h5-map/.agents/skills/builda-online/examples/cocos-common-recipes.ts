import {
  OnlineClient,
  OnlineError,
  type MatchPresence,
  type MatchTicket,
  type OnlineSocket,

  type Payload,
  type RoomHandle,
  type RoomMessage,
} from "@cysj/online-cocos";

const READY_STATUSES = new Set(["room_ready", "confirmed"]);
const TERMINAL_STATUSES = new Set([
  "cancelled",
  "timeout",

  "confirm_timeout",
  "failed",
]);

/** Read a required object from a public Payload. */
function objectField(payload: Payload, field: string): Payload {
  const value = payload[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OnlineError("PUBLIC_RESPONSE_INVALID", `Missing object field: ${field}`);
  }
  return value as Payload;
}

/** Read a required string from a public Payload. */
function stringField(payload: Payload, field: string): string {
  const value = String(payload[field] ?? "");
  if (!value) throw new OnlineError("PUBLIC_RESPONSE_INVALID", `Missing string field: ${field}`);
  return value;
}

/** Read a non-negative integer from a public Payload. */
function integerField(payload: Payload, field: string): number {
  const value = Number(payload[field]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OnlineError("PUBLIC_RESPONSE_INVALID", `Invalid integer field: ${field}`);
  }
  return value;
}

/** Check browser capabilities, restore the in-memory Session, and connect to the Gateway after registering events. */
export async function createConnectedSocket(
  client: OnlineClient,
  runtimeToken: string,
  bindEvents: (socket: OnlineSocket) => void,
): Promise<OnlineSocket> {
  const capabilities = OnlineClient.detectCapabilities();
  if (!capabilities.control || !capabilities.roomWebRtc || !capabilities.secureContext) {
    throw new OnlineError("CLIENT_WEBRTC_UNAVAILABLE", "This browser cannot open an online Room");
  }
  const socket = client.createSocket();
  bindEvents(socket);
  await socket.connect(client.restoreSession(runtimeToken));
  return socket;
}

/**
 * Wait on the same Ticket and connect; when a peer Confirm failure causes a requeue, the SDK automatically returns to waiting until a Room handle is obtained
 * or the Ticket reaches an authoritative terminal state (throws `MATCH_TICKET_TERMINAL`). Other connection failures are rethrown as-is; the Ticket may still be
 * alive, so call settleAbandonedTicket to settle it before allowing the next matchmaking attempt.
 */
export async function waitAndConnect(
  socket: OnlineSocket,
  ticket: MatchTicket,
  operationKey: string,
  signal?: AbortSignal,
): Promise<RoomHandle> {
  return socket.waitAndConnectMatchedRoom(ticket, {
    idempotencyKey: operationKey,
    ...(signal ? { signal } : {}),
  });
}

/** Query the original Ticket after a cold start or Gateway recovery; never create a second Ticket as a fallback. */
export async function recoverTicket(
  socket: OnlineSocket,
  ticketId: string,
  knownVersion?: number,
): Promise<MatchTicket> {
  return socket.getMatchTicket(ticketId, knownVersion);
}

/** Manually renew a Ticket once, only for advanced flows that do not use waitMatchTicketReady. */
export function heartbeatTicketOnce(
  socket: OnlineSocket,
  ticket: MatchTicket,
  operationKey: string,
): Promise<MatchTicket> {
  return socket.heartbeatMatchTicket(ticket.ticket_id, ticket.ticket_version, operationKey);
}

/** Regular single-match matchmaking. */
export async function enterPool(
  socket: OnlineSocket,
  matchKey: string,
  operationKey: string,
): Promise<RoomHandle> {
  const ticket = await socket.joinPool(matchKey, { idempotencyKey: operationKey });
  return waitAndConnect(socket, ticket, operationKey);
}

/** Ranked matchmaking uses the single-player rating maintained by the game. */
export async function enterRankPool(
  socket: OnlineSocket,
  matchKey: string,
  operationKey: string,
  rankScore?: number,
): Promise<RoomHandle> {
  const ticket = await socket.joinRankPool(matchKey, { idempotencyKey: operationKey, ...(rankScore !== undefined ? { rankScore } : {}) });
  return waitAndConnect(socket, ticket, operationKey);
}

/** Room-mode quick join; whether a Room is created when none is available is governed by this call together with the deploy configuration. */
export async function enterRoomMode(
  socket: OnlineSocket,
  matchKey: string,
  allowCreate: boolean,
  operationKey: string,
): Promise<RoomHandle> {
  const ticket = await socket.joinRoom(matchKey, {
    allowCreate,
    idempotencyKey: operationKey,
  });
  return waitAndConnect(socket, ticket, operationKey);
}


/** Join with a known Room ID: a Room shared by the game's social system or a Builda App invite; the Room ID is the admission credential, and no new Room is created. */
export async function enterRoomBySharedId(
  socket: OnlineSocket,
  roomId: string,
  operationKey: string,
): Promise<RoomHandle> {
  const ticket = await socket.joinRoomById(roomId, { idempotencyKey: operationKey });
  return waitAndConnect(socket, ticket, operationKey);
}

/**
 * Handle a launch from a Builda App Room invite: the host returns the invite only once per page lifecycle. When an invite exists, request a Seat with its roomId
 * and wait to enter the Room; when there is no invite or the host does not support it, return null and the game follows its normal lobby flow. Whether the Room
 * can be entered is still decided by the platform (full, released, etc. are reported as stable error codes).
 */
export async function takeRoomInviteAndEnter(
  socket: OnlineSocket,
  operationKey: string,
): Promise<RoomHandle | null> {
  const result = await socket.takeRoomInvite();
  if (!result.available || !result.invite) return null;
  return enterRoomBySharedId(socket, result.invite.roomId, `${operationKey}-invite`);
}

/** Refresh the public authoritative snapshot of a Room; never guess generation or revision from the client cache. */
export function getRoomSnapshot(socket: OnlineSocket, roomId: string): Promise<Payload> {
  return socket.getRoom(roomId);
}

/**
 * Create a private Room and enter it as the creator: private Rooms do not appear in the public list or automatic matchmaking and can only be joined by Room ID; the creator
 * and later members have equal rights. Hand room.roomId to the game's own social system for sharing; other players join with enterRoomBySharedId.
 */
export async function createAndEnterPrivateRoom(
  socket: OnlineSocket,
  matchKey: string,
  operationKey: string,
): Promise<{ room: RoomHandle; roomId: string }> {
  const room = await socket.createAndConnectPrivateRoom(matchKey, { idempotencyKey: operationKey });
  return { room, roomId: room.roomId };
}


/** Cancel the pending Ticket; if it already raced with RoomReady, connect and then actively leave the Room immediately. */
export async function cancelTicketOrLeaveReadyRoom(
  socket: OnlineSocket,
  ticket: MatchTicket,
  operationKey: string,
): Promise<void> {
  let latest = await socket.getMatchTicket(ticket.ticket_id);
  if (["waiting", "matched"].includes(latest.status)) {
    try {
      latest = await socket.cancelMatchTicket(
        latest.ticket_id,
        latest.ticket_version,
        `${operationKey}-cancel`,
      );
    } catch (error) {
      if (!(error instanceof OnlineError)) throw error;
      latest = await socket.getMatchTicket(ticket.ticket_id);
    }
  }
  if (TERMINAL_STATUSES.has(latest.status)) return;
  if (READY_STATUSES.has(latest.status)) {
    const room = await socket.connectMatchedRoom(latest, `${operationKey}-cancel-race`);
    await room.leave();
    return;
  }
  throw new OnlineError("MATCH_CLEANUP_INCOMPLETE", `Ticket is still active: ${latest.status}`);
}

/**
 * Settle a Ticket that may still be alive after a connection failure or an aborted wait: a waiting Ticket is cancelled directly, while non-cancellable states such as matched or RoomReady
 * make the SDK wait, bounded, for an authoritative terminal state. Returning `confirmed` means the Room was entered and must be actively left through the Room handle. Do not re-match before settling,
 * otherwise you will hit MATCH_ROLE_BUSY.
 */
export async function settleAbandonedTicket(
  socket: OnlineSocket,
  ticket: MatchTicket,
  operationKey: string,
  signal?: AbortSignal,
): Promise<MatchTicket> {
  return socket.settleMatchTicket(ticket, {
    idempotencyKey: `${operationKey}-settle`,
    ...(signal ? { signal } : {}),
  });
}

/** Common choices for the three channels: commands reliable, key events reliable, continuous snapshots droppable. */
export function sendGameplay(room: RoomHandle, input: Payload, snapshot: Uint8Array): void {
  room.sendControl(1, JSON.stringify(input));
  room.sendReliable(101, JSON.stringify({ event: "round_started" }));
  room.sendUnreliable(201, snapshot);
}

export interface RoomEventHandlers {
  onConnected(): void;
  onSocketClosed(code: number, reason: string): void;
  onError(code: string | number, message: string): void;
  onTicket(ticket: MatchTicket): void;



  onMessage(message: RoomMessage): void;
  onPresence(roomId: string, joins: MatchPresence[], leaves: MatchPresence[]): void;
  onRoomPresence(roomId: string, presence: Payload): void;
  onClosed(roomId: string, reason: string, errorCode?: string): void;
  onNetworkStage(stage: string, roomId?: string): void;
  onNetworkSnapshot(roomId: string | undefined, snapshot: Payload): void;
  /** Host chat messages for a Room whose group has been joined; senderId is the sender's roleId and includes your own messages. */
  onChatMessage(roomId: string, teamId: number, senderId: string, text: string): void;
}

/** Register Room message, Presence, reconnect, migration, and terminal events, and return a single unbind function. */
export function bindRoomEvents(socket: OnlineSocket, handlers: RoomEventHandlers): () => void {
  const unsubscribe = [
    socket.on("connected", handlers.onConnected),
    socket.on("closed", (event) => handlers.onSocketClosed(event.code, event.reason)),
    socket.on("error", (event) => handlers.onError(event.code, event.message)),
    socket.on("matchTicketUpdated", handlers.onTicket),



    socket.on("roomMessage", handlers.onMessage),
    socket.on("matchPresence", (event) => handlers.onPresence(event.roomId, event.joins, event.leaves)),
    socket.on("roomPresence", (event) => handlers.onRoomPresence(event.roomId, event.presence)),
    socket.on("roomClosed", (event) => handlers.onClosed(event.roomId, event.reason, event.errorCode)),
    socket.on("gatewayReconnecting", () => handlers.onNetworkStage("gateway_reconnecting")),
    socket.on("gatewayReconnected", () => handlers.onNetworkStage("gateway_reconnected")),
    socket.on("roomReconnecting", (event) => handlers.onNetworkStage("room_reconnecting", event.roomId)),
    socket.on("roomReconnected", (event) => handlers.onNetworkStage("room_reconnected", event.roomId)),
    socket.on("roomTransferStarted", (event) => handlers.onNetworkStage("room_transfer_started", event.roomId)),
    socket.on("roomTransferCompleted", (event) => handlers.onNetworkStage("room_transfer_completed", event.roomId)),
    socket.on("networkChanged", (event) => handlers.onNetworkSnapshot(event.roomId, event.snapshot as unknown as Payload)),
    socket.on("chatMessage", (event) => handlers.onChatMessage(event.roomId, event.teamId, event.senderId, event.text)),
  ];
  return () => unsubscribe.forEach((off) => off());
}

/** Read only the redacted network snapshot and RTT; never record addresses, tokens, or credentials. */
export async function collectNetworkDiagnostics(socket: OnlineSocket, roomId?: string): Promise<Payload> {
  const gatewayRttMs = await socket.measureGatewayRtt();
  const roomRttMs = roomId ? await socket.measureRoomRtt(roomId) : undefined;
  const snapshot = await socket.networkSnapshot(roomId);
  return { gatewayRttMs, roomRttMs, snapshot };
}

/** After waiting from a long-lived Room to a single-match RoomReady, reliably leave the old Seat first, then connect to the new Room. */
export async function switchLongRoomToPool(
  socket: OnlineSocket,
  oldRoom: RoomHandle,
  matchKey: string,
  operationKey: string,
): Promise<RoomHandle> {
  const ticket = await socket.joinPool(matchKey, { idempotencyKey: operationKey });
  const ready = await socket.waitMatchTicketReady(ticket);
  if (!READY_STATUSES.has(ready.status)) {
    throw new OnlineError("MATCH_TICKET_TERMINAL", `Ticket ended with status: ${ready.status}`);
  }
  await oldRoom.leave();
  return socket.connectMatchedRoom(ready, `${operationKey}-connect`);
}

/** On a normal exit, settle the Room first, then close the whole Socket. */
export async function leaveRoomAndClose(socket: OnlineSocket, room: RoomHandle): Promise<void> {
  await room.leave();
  socket.close();
}

/** After entering the Room, join the host chat group by Room ID; teamId is decided by the game's own team rules. Hide the chat entry when available=false. */
export async function joinTeamChat(room: RoomHandle, teamId: number): Promise<boolean> {
  const result = await room.joinChatGroup(teamId);
  return result.available;
}

/** Leave the group when switching teams or muting early; actively leaving the Room, closing the Room, and closing the Socket make the SDK leave the group automatically, so no repeated call is needed. */
export async function quitTeamChat(room: RoomHandle): Promise<void> {
  await room.quitChatGroup();
}
