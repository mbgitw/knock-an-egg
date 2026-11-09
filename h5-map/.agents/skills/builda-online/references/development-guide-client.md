# Client Integration

Read this page only during the client-writing phase; the prerequisites are the confirmed multiplayer plan and the shared message protocol in the [Development guide](development-guide.md).
Lifecycle, control frames, and error codes take [End-to-end lifecycle and Room protocol](client-lifecycle.md) as the sole authority; public methods take
[Client SDK selection and integration](client-sdk-selection.md) as the sole reference.

## Integration order

First select the single SDK per `client-sdk-selection.md`. For a complete Godot sequence example see [Godot lifecycle and integration example](client-lifecycle-godot.md); H5/Cocos use the camelCase APIs in their respective SDK README and
`dist/index.d.ts`, and Unity uses the package README and the `*Async` APIs of `Cysj.Online`. Do not install all four
SDKs into one client at the same time, and do not translate examples by copying the internal transport.

Use only the public objects of `res://addons/cysj_online/sdk/`: `CysjClient`, `CysjSession`, `CysjSocket`,
Match `Dictionary` snapshots, `CysjMatch`, and `CysjMatchState`.

Integration order:

1. Create the Client and the Socket, and add the Socket to the scene tree.
2. Call `client.restore_session(token)` with the platform token.
3. Listen for Match Ticket, state, Presence, and error signals.
4. `await socket.connect_async(session)`.
5. Call `join_room_async` or `join_pool_async`.
6. Call `wait_and_connect_matched_room_async` to wait and enter the Room; when a peer's Confirm failure causes a requeue, it automatically returns to waiting on the same Ticket.
   In the step-by-step flow, call `connect_matched_room_async` after `received_match_ticket_updated` delivers `room_ready`.
   Pool arrival confirmation is produced automatically by the real Room connection; game code does not send a manual Confirm. After a connect failure, first use
   `settle_match_ticket_async` to settle any still-live Ticket to an authoritative terminal state, then open the next matchmaking.
7. Send intents through `send_match_state_async` only after the Room connection succeeds.
8. When leaving the scene, cancel the Ticket or wait for the active Room leave to succeed according to the current phase, and only then close the Socket.

Admission, Ticket waiting, and Room connection are all states that can span frames; exit cannot be simplified to "if there is a `game_match`, leave the Room, otherwise just
close the Socket". When implementing the integration, also follow
[Client interruption recovery, Admission, and exit lifecycle](client-lifecycle.md) to keep the current Ticket, handle the cancel vs. RoomReady race, and make
a normal return to the entry point wait until settlement succeeds.

`leave_match_async` must be awaited to completion before closing the Socket; it first has the platform commit the Presence as the final `Left`, so the same role
can start the next match immediately. Closing the Peer directly counts as a network disconnect and enters the reconnect grace period, during which matchmaking again returns `MATCH_ROLE_BUSY`.
For gameplay that re-matchmakes after settlement, save the settlement screen data as soon as the final settlement message arrives and run this Room-leave flow automatically; do not wait for the player
to click "Back to lobby". If the Room leave returns non-`OK`, you must keep the error state and forbid matchmaking again immediately; never treat a timeout as success.
Conversely, when abnormal-disconnect auto-reconnect finally triggers `match_closed(match_id, "reconnect_timeout")`: the old Room is in a terminal state; clear
this match's Ticket, idempotency key, Seat, and cleanup flags and reopen Admission; never hand it to `_on_socket_error` to become a permanent error.
For H5/Cocos the equivalent is awaiting `socket.leaveRoom(roomId)`, and for Unity awaiting `socket.LeaveRoomAsync(roomId)`; all four clients must disable
repeated Room leave and matchmaking-again entry points until it completes. When a Builda App chat group is needed, after obtaining the Room handle call Godot `join_chat_group_async`,
H5/Cocos `room.joinChatGroup`, or Unity `room.JoinChatGroupAsync` and pass the `team_id` decided by the game itself; leaving the Room and Room close make the SDK
leave the group automatically, and `available=false` means the host does not support it, so hide the chat entry. Notifying the Builda App of the current Room on Room enter and leave is done by the SDK
automatically; game code does not need to and must not directly call the host's `enterRoom`/`leaveRoom`.

Returning to the lobby, closing the page, or switching scenes must not copy a simplified function that only checks `game_match`. Even when the Room is not yet connected, an
authoritative Ticket may already exist: you must call Godot `cancel_match_ticket_async`, H5 `cancelMatchTicket`, or Unity
`CancelMatchTicketAsync`, and handle the cancel vs. RoomReady race; after a connect failure or an aborted wait, use Godot
`settle_match_ticket_async`, H5/Cocos `settleMatchTicket`, or Unity `SettleMatchTicketAsync` to settle any still-live Ticket
to an authoritative terminal state. For complete copyable code see
[Client interruption recovery, Admission, and exit lifecycle](client-lifecycle.md).

Game code must not contain platform runtime addresses, `join_token`, manual `poll()`, or self-assembled Room addresses.

## Client implementation checklist

Use only the one public SDK determined by [Client SDK selection and integration](client-sdk-selection.md). Godot uses
`res://addons/cysj_online/sdk/`, H5 imports from `@cysj/online-h5`, Cocos imports from `@cysj/online-cocos`, and
Unity imports from the `Cysj.Online` namespace. All four clients first restore the session and connect to the Gateway, then branch strictly along the match entry path chosen in "Multiplayer plan confirmation":

Private entry points uniformly use the SDK's `create_and_connect_private_room*` to obtain the Room handle directly; members join by Room ID.
Do not start matchmaking or wait for Confirm because the public `mode` is Pool or RankPool, and do not duplicate a separate gameplay config for private Rooms.
Creating a private Room returns the Room directly; the Ticket saving and settlement requirements below apply only to matchmaking or join-by-ID paths that actually return a Ticket.
The Room/Pool mode branches below describe only public entry points:

1. Room mode: use only public auto-matchmaking with the same `matchKey`; there is no Confirm. User Room
   code must `release_room` in the waiting phase and `lock_room` in the match-start phase according to the gameplay.
2. Pool: after receiving the Assignment, you can enter immediately, or first show an "Accept match" UI and then enter; a successful real connection is
   automatically Confirmed by the platform. This is user-visible public behavior and does not expose any specific run location. Before all members arrive, never
   send gameplay messages; game code must not call Confirm manually.
3. On any path, establish the Room data plane only after the authoritative Seat/Assignment is ready, and send gameplay messages only after joining succeeds. For the main matchmaking path prefer
   the four-client combined entry `wait_and_connect_matched_room*`: when a peer's Confirm failure causes a requeue, it automatically
   returns to waiting on the same Ticket; `MATCH_ROOM_NOT_READY` is a recoverable error and must not be treated as a terminal state that clears the Ticket.
4. The client must explicitly maintain the `admitting → ticket_active → connecting_room → room_connected → cleaning` states.
   As soon as a Ticket is returned, save the latest `ticket_id/ticket_version/status`; update it whenever a push, wait result, or query result arrives,
   and never keep the Ticket only in a local variable of a single function call.
5. If the user asks to go back while an Admission request is still in flight, only record the exit intent and disable repeated actions, and wait for that request to settle; if a
   Ticket is then obtained, cancel it immediately. When a Ticket exists but the Room is not yet connected, call the four-client public cancel method; on a cancel vs. RoomReady race, first query
   the latest Ticket; if it can still be canceled, retry with the latest version within a bound; if it has entered RoomReady/confirmed, connect and immediately leave the Room actively. After a connect failure or
   an aborted combined entry, first use the four-client `settle_match_ticket*` to settle any still-live Ticket to an authoritative terminal state, then open the next matchmaking.
6. When the Room is connected, you must wait for the active Room leave to succeed. Godot checks that `leave_match_async` returns `OK`; H5/Cocos/Unity wait for the corresponding Promise/
   Task to complete normally. When cancel or Room leave fails, keep the Socket and the error state; never close the connection, switch scenes, open matchmaking again, or fake success.
7. Close the Socket only after the Ticket has reached a terminal state or the active Room leave has succeeded. Callbacks that cannot await async results, such as Godot `_exit_tree`, H5 `beforeunload`,
    Cocos Component `onDestroy`, and Unity `OnDestroy`, must not carry the normal exit; the normal back button
    must go through the awaitable settlement method in advance.
     A process force-killed by the system is an abnormal disconnect; it can only rely on the reconnect grace period and platform reclamation, and you must not claim the client actively left the Room.
11. Screen off, backgrounding, incoming calls, and network blips are not exits. While the process is still alive you must keep the original Admission idempotency key, Ticket, Assignment,
    and Room state: in the Ticket phase recover the original Ticket, in the first-connection phase continue `connect_matched_room*`, and only after `room_joined` has been received
    hand over to Room auto-reconnect. Calling `join_*` again is forbidden in any recovery phase; `MATCH_ROLE_BUSY` must not trigger a retried Admission either.
12. When Godot `match_closed`, H5 `roomClosed`, or Unity `RoomClosed` is received with reason `reconnect_timeout`, the old Room
     has entered a terminal state. You must atomically clear the Room handle, current Ticket, Admission idempotency key, Seat/pending-connection state, and reconnect/cleanup flags;
     Pool returns to the game lobby screen and opens new matchmaking, and a long-lived Room re-Admissions through the project's existing entry point. Never write it as a permanent
     `ERROR`, and never wait for or handle another global network error before recovering.
13. After the process is killed, never persist the token, Room credentials, or Assignment for homemade recovery. The current public API cannot find, by role, a pending Ticket/Room
    that was lost locally; on a cold start that hits `MATCH_ROLE_BUSY`, show that the old match is being reclaimed and back off within a bound; never automatically loop `join_*` rapidly.
14. Error UI must keep the stable `error_code` and the phase where it occurred; specific errors such as `MATCH_ROLE_BUSY`, the Room sandbox protection close
    `ROOM_RESOURCE_BUDGET_EXCEEDED`, cancel failure, and Room-leave commit timeout must not be overwritten by generic text such as "Failed to find a room". For the complete four-client patterns see
    [Client interruption recovery, Admission, and exit lifecycle](client-lifecycle.md), and use its "Common stable error codes" to judge which cases are recoverable,
    need a snapshot refresh, need an active Room leave, or need retries blocked.

Do not let game code see platform runtime addresses, the join token, SDP/ICE, or manual `poll()`. Do not modify
the internals of `addons/cysj_online`; when the SDK lacks a capability, report the gap.
