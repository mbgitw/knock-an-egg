# Builda Online H5 SDK

`@cysj/online-h5` is the Builda Online client SDK for browser games. It covers the three Match Admissions, Tickets,
Parties, public/private Rooms, invitations, three WebRTC DataChannels, offline grace and automatic reconnect. The client only chooses a `matchKey`;
player count, team structure, window widening, Confirm and Bot policy are frozen by `builda.online.json`.

## Installation and build

Commit the delivered package into the project at `vendor/builda-online/client-sdk/h5/` and install it as a local file dependency, or use the bundled `dist/` directly. This SDK is a browser ESM package; it does not depend on
the Node.js runtime and never stores the runtime token in `localStorage`, cookies or URLs.

Canvas/DOM projects without a bundler use [`examples/vanilla`](examples/vanilla/README.md): the build script copies
all runtime `*.js` files from `dist/` as is into `vendor/online/` of the game Bundle, and game code imports them by relative path, without
`*.d.ts` or source maps. The example covers both the explicit `builda dev` Mock shell and the in-memory runtime token of the Builda App.

```ts
import { OnlineClient, decodeJson, encodeJson } from "@cysj/online-h5";

const client = new OnlineClient({
  gatewayUrl,
  gameId,
  defaultQueueName: "default",
});
const session = client.restoreSession(await builda.requestToken());
const socket = client.createSocket();

await socket.connect(session);
const ticket = await socket.joinPool("casual", {
  idempotencyKey: "search-click-1",
});
const room = await socket.waitAndConnectMatchedRoom(ticket, {
  idempotencyKey: "connect-click-1",
});
room.sendReliable(1, encodeJson({ ready: true }));
socket.on("roomMessage", (message) => {
  const payload = decodeJson<{ score: number }>(message.data);
  console.log(payload.score);
});
```

`encodeJson(value)` and `decodeJson<T>(payload)` reuse module-level UTF-8 encoders/decoders. `T` only provides a static type hint;
fields coming from the Room must still be validated by game code before use. Binary gameplay messages keep using `Uint8Array` directly.

A cold Gateway connection waits 30 seconds by default, covering mobile network DNS, TCP, TLS and WebSocket handshakes; to override it, pass
milliseconds to `socket.connect(session, timeoutMs)`. On timeout the unfinished WebSocket is closed and the Promise rejects with
`GATEWAY_TIMEOUT`.

If the Gateway briefly disconnects during matchmaking waits or Room automatic reconnect because of a Wi-Fi/cellular switch, the SDK shares one bounded recovery task: at most
3 attempts of 5 seconds each, reauthenticating with the in-memory-only Session and then querying the original `ticket_id/ticket_version`. When a control request times out,
the SDK first discards the old Gateway that still looks OPEN; read-only or idempotent requests replay the same frozen payload at most once, and Admission must reuse
the idempotency key generated the first time, so no second logical Admission is created. The UI can listen to `gatewayReconnecting` and
`gatewayReconnected`; once recovery is exhausted, the waiting Promise rejects. Write operations whose outcome is uncertain and cannot be safely replayed return
`CONTROL_OUTCOME_UNKNOWN`; the game should reconcile through the corresponding query API and must not simply repeat the write.
After the Room reconnect grace is exhausted, only one `roomClosed({ reason: 'reconnect_timeout' })` is dispatched; the old Room is terminal, and the game should clear
the match state and reopen Admission. No global `error` for the same terminal state will follow.
Screen-off, page hiding and network switches do not mean an active exit. In the Ticket stage, keep the original Ticket; once an Assignment is obtained but the first
`room_joined` has not completed, keep the original Ticket and continue `connectMatchedRoom`; `roomReconnecting` is not dispatched in this case. Only
Rooms that were entered successfully use `roomReconnecting/roomReconnected` for automatic reconnect; do not call `join*` again during recovery.
After the page process is destroyed, the current SDK cannot recover unknown pending Tickets/Rooms by role; on a cold start that hits `MATCH_ROLE_BUSY`, enter a controlled wait
and only let the player retry manually after backoff. Do not retry Admission automatically, persist tokens/Room credentials, or create Tickets in a loop.
A physical Gateway close does not dispatch the Socket `closed` event; that event is dispatched only once, when the game actively calls `socket.close()`.
When the Gateway connection is still online but online services are briefly unavailable, the SDK does not create a new Ticket or end the wait early; it keeps
recovering the same `ticket_id/ticket_version` until it receives an authoritative RoomReady or terminal state.
When the platform transfers a Room generation, the SDK dispatches `roomTransferStarted` and then `roomTransferCompleted`; the completion event includes
the new generation and the actual pause in milliseconds. The game should pause input on the start event and refresh the view with the latest authoritative state on the completion event. Ordinary network
jitter still only dispatches `roomReconnecting/roomReconnected`.
During sustained unavailability, waiting lasts at most until 30 seconds after the server Match deadline, so it never hangs on the search screen forever.
Always use `connectMatchedRoom` to request credentials and enter the Room; Pool/RankPool confirm automatically once the real data connection is established, and Room
mode has no confirmation stage. It recovers lost credentials or signaling answers, and evicts possibly registered old
Peers with a higher Presence epoch. The game layer must not split these steps and retry on its own.

`waitMatchTicketReady` renews automatically and merges pushes while waiting for opponents, during Formation and Room cold start; a RoomReady push
wakes the waiter immediately, and the 5-second heartbeat only renews the lease and covers lost pushes;
`connectMatchedRoom` first connects to the assigned Room; for Pool/RankPool the platform confirms the real arrival, and the user Room `on_join` runs only after the whole group of Tickets
has arrived.
`waitAndConnectMatchedRoom(ticket, { signal, idempotencyKey })` combines both into one call: when a peer Confirm failure in Pool
causes a server requeue, the SDK automatically returns to waiting on the same Ticket and derives an idempotency subkey per round, until it obtains a Room handle or the Ticket
reaches an authoritative terminal state (rejects with `MATCH_TICKET_TERMINAL`); `signal` lets the player cancel matchmaking. It does not extend the original Ticket's Match
deadline; other connect failures reject as is, and the Ticket may still be live.
`settleMatchTicket(ticket, { signal })` settles after a connect failure or an aborted wait: waiting states are canceled directly with version races handled,
non-cancelable states such as `matched/room_ready` wait boundedly for an authoritative terminal state or a requeue back to waiting; a returned `confirmed` means the Room was entered,
and the game should actively leave through the Room handle. Do not open the next matchmaking before settling completes, or you will hit `MATCH_ROLE_BUSY`.

The underlying transport of online Rooms is decided by the server-side Game configuration. New Games use a standalone Room WebSocket by default; the new SDK
connects directly to the Worker Gateway for `room_transport=websocket`. When configured as `webrtc`, `RTCPeerConnection` and three negotiated DataChannels are preferred:
`control_reliable(1)`, `game_reliable(2)`, `state_unreliable(3)`. The SDK uses the actual `readyState` of the three channels to decide connection success,
and tolerates host WebViews occasionally missing the `open` event. Only when WebRTC explicitly fails to connect in all three bounded attempts does the SDK switch, with a newly issued
higher Presence epoch, to a standalone Room WSS; authentication, signaling, Room/Worker unavailability and business errors never trigger the fallback. Older SDKs
without the `room_transport` field keep working WebRTC-only; game code and the public Room API are unchanged.
The fallback link does not reuse the Gateway control WebSocket, and diagnostics are marked `websocket_degraded`. Only when the local Room Mock returns an explicit
`transport=local` is the loopback control connection reused, reporting `roomRuntime=language_mock`.

A Party invitation UI should register `partyInviteReceived/partyInvitesUpdated` first and then call `subscribePartyInvites()`; both the first call and
Gateway reconnects restore pending invitations. The party leader and the target player must each use their own authenticated Socket; to accept, pass the invitation from the subscription to
`acceptPartyInvite(invitation)`, to reject call `rejectPartyInvite(...)`, and after a restart restore with `getCurrentParty()`.
Room invitations only carry the Room ID; friend selection, delivery and decline prompts are handled by the game's own social system; after receiving the ID call
`joinRoomById(roomId)`. Online does not maintain a Room invitation inbox or accept/decline/revoke state. For the full Party, join-by-Room-ID and
low-level Ticket methods, see the generated `dist/index.d.ts`. Call `socket.close()` when leaving the page.
The player who creates the private Room calls `issueRoomCredential(...)` as described in the Skill and then `connectRoom(roomId)`; the issue method only returns a
`RoomCredentialReceipt`, the full connection material and ICE configuration stay only in Socket memory, and the game must not assemble signaling requests itself.
To end a match but keep matchmaking, first `await room.leave()`; it returns after the platform confirms the Seat is finally released,
rejects if the commit times out, and the caller must not rematch immediately; an active leave is never treated as
a disconnect reconnect.
After entering, call `room.joinChatGroup(teamId)` to let the Builda App join the host chat group by Room ID; `teamId` is decided by the game;
`{ available: false }` means the host has no chat group capability and the chat entry should be hidden. `room.quitChatGroup()` is for switching teams or quitting early;
actively leaving, `roomClosed` and `socket.close()` quit automatically. After joining, group messages pushed by the host arrive through `socket.on('chatMessage', ...)`
with the fields `roomId`, `teamId`, `senderId` (the sender roleId) and `text`.
The SDK also automatically tells the Builda App which Room it entered on first entry, and notifies it of leaving on leave, Room close, reconnect grace exhaustion and Socket close;
this is host-side Room presence state, which the game does not need to and cannot call manually, and it is silently skipped when the host lacks the capability.
`socket.createAndConnectPrivateRoom(matchKey, { idempotencyKey })` creates a private Room joinable only by Room ID and enters it directly;
the creator and later members are equal and there is no Room owner; other players join with `joinRoomById(roomId)`.
When a player launches the game from a Builda App Room invitation, call `socket.takeRoomInvite()` once during startup: it returns `{ available, invite }`,
where `invite` contains `roomId` and the inviter `id/name/avatar`; call `joinRoomById` with `roomId` to request a Seat. The host returns it only once,
and later calls always get `invite: null`; `available=false` means the host has no invitation capability.

## Installation check

```bash
./.builda-online/bin/builda-online check
pnpm exec tsc --noEmit
```

On Windows use `.builda-online/bin/builda-online.cmd check`. Type checking should use the game project's own scripts and locked dependencies; do not
run the SDK tests under platform repository paths.

`matchKey` maps to a game mode; public matchmaking mode and private Room creation are independent. Room, Pool and RankPool modes with private Rooms enabled can all create a Room directly and be joined by Room ID. Private Rooms take no part in matchmaking or Confirm, and public Pool/RankPool matches still lock their roster.

## Retrying an unconfirmed leave

Keep the Room handle when leave fails or returns `ROOM_LEAVE_PENDING`, and repeat the same leave call. Do not dispose the
Socket, send gameplay messages or start another admission while leave is pending. The SDK reuses the operation, shares
concurrent calls and emits `client_leave` only after confirmed release. With retryable-leave capability, confirmation can continue
through the control connection after the Room data connection is lost. Older services require their live-data-channel fallback.
See the installed `references/client-lifecycle.md` for the complete error and recovery contract.
