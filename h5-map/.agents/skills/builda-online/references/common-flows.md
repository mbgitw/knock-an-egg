# Builda Online Common Features and Correct Examples

This page is an example index for common features. Public method names follow [Client SDK selection](client-sdk-selection.md), the state machine and error codes follow
[End-to-end lifecycle](client-lifecycle.md), and resource boundaries follow [Room resource limits](resource-limits.md).

The four `*-common-recipes` files shipped with the Skill use the real Godot, H5, Cocos, and Unity public APIs respectively, and pass
compile or parse checks in their languages; pick the one file for the current engine, and do not re-copy an approximate implementation from this page. The complete four-client cancel, recovery, and exit state machine
still follows the lifecycle document.

## Contents

- [Example assets](#example-assets)
- [Connection and event registration](#connection-and-event-registration)
- [Room and Pool Admission](#room-and-pool-admission)
- [Ticket cancellation and RoomReady race](#ticket-cancellation-and-roomready-race)
- [Three-channel messages and Presence](#three-channel-messages-and-presence)
- [Reconnect, migration, and network diagnostics](#reconnect-migration-and-network-diagnostics)
- [Switching gameplay from a long-lived Room](#switching-gameplay-from-a-long-lived-room)
- [Normal exit and re-matchmaking](#normal-exit-and-re-matchmaking)
- [Room gameplay templates](#room-gameplay-templates)

## Example assets

| File | Verified content | When to read |
| --- | --- | --- |
| `examples/h5-common-recipes.ts` | Strict compile against H5 public types | Calling any common client capability |
| `examples/cocos-common-recipes.ts` | Strict compile against Cocos Web public types | Common Cocos Creator client capabilities |
| `examples/godot-common-recipes.gd` | Godot 4.7 public API parse | Common Godot client capabilities |
| `examples/unity-common-recipes.cs` | Unity public C# API compile contract | Common Unity client capabilities |
| `examples/client-supported-modes.h5.ts` | Three-mode matrix of H5 against the real source Mock | Need full page state and message handling |
| `examples/client-supported-modes.godot.gd` | Three-mode matrix of Godot against the real source Mock | Godot scene integration |
| `examples/room-supported-modes.typescript.ts` | TypeScript CF/long-lived Room/Pool | TypeScript authoritative Room |
| `examples/room-supported-modes.rust.rs` | Rust Room equivalent to the TypeScript one | Rust authoritative Room |
| `examples/cf-room.json` | Looping room Roster/Team/startup context | Verify Room lock, settlement, reset, release |
| `examples/shadow-world.json` | Long-lived world and mid-game join | Verify drop-in/drop-out and persistent state |
| `examples/casual-2p.json` | Pool two-team single match | Verify settlement, Room leave, and close |

The examples are mode skeletons, not an invitation for the AI to copy the "star-grabbing" gameplay into other games. Keep the lifecycle, fencing, game-ending, and resource-control structure,
and replace message codes, input validation, state, and win/loss rules with the gameplay the user has already confirmed.

## Connection and event registration

1. Read `gatewayUrl/gameId/defaultQueueName` from the install record, and obtain a short-lived runtime token from the Builda App.
2. Create one Socket, register error, Ticket, Room, reconnect, and migration events first, then call `connect`.
3. H5/Cocos use `bindRoomEvents(...)`; when leaving the scene, call the unsubscribe function it returns.
4. The Godot Socket must be added to the scene tree; Unity events are dispatched on the main thread that created the Socket.

Do not decide local/online based on hostname, port, or protocol. Only `builda_mock_shell=1` or the Godot editor flag may select the local
Mock; the online URL is read only from the install record.

The client version comes from the runtime token issued by Builda; it is not an SDK parameter. The Gateway only allows connections from Bundles that have an active Server Release;
`CLIENT_SERVER_VERSION_UNSUPPORTED` means the current Bundle has not yet completed its matching server release, or is accessing a Lobby or Room of another
compatibility group. The client should keep and display the original error code, and must not rewrite the version, downgrade the token, or retry in a loop.

## Room and Pool Admission

The recipe names below use the H5/Cocos files as examples; the Godot/Unity files contain the same-semantics flows with method names in their own languages:

| Player flow | recipe | Key boundary |
| --- | --- | --- |
| Regular single match | `enterPool` | One Room per match; the client does not upload player count, Team, Bot, or Confirm |
| Room quick join | `enterRoomMode` | `allowCreate` only expresses this request's intent and is still constrained by the deployment config |
| Wait and connect | `waitAndConnect` | Keep the same Ticket; when a peer's Confirm failure causes a requeue, the SDK automatically returns to waiting; gameplay messages are allowed only after obtaining the Room handle |
| Settle after connect failure | `settleAbandonedTicket` | Never re-Admission before the Ticket reaches an authoritative terminal state; when it returns `confirmed`, actively leave the Room |
| Create a private Room | `createAndEnterPrivateRoom` | The `matchKey` requires `privateRoomsEnabled=true`; hand the returned `roomId` to the game's social system to share; the creator and members are equal, there is no host |
| Join by a known Room ID | `enterRoomBySharedId` | The Room ID is the admission credential; no matchKey is needed and no new Room is created; handle Room full or already released by stable error codes |
| Builda App invite launch | `takeRoomInviteAndEnter` | Read the invite once at startup; if there is an invite, join by ID, otherwise go to the lobby |

Every entry point must write `ticket_id/ticket_version/status` into the current scene state. A `room_ready` push only wakes the wait early;
the new Ticket snapshot returned by `wait*` overwrites the old one. On network failure, recover the original Ticket; re-Admission is forbidden.

## Ticket cancellation and RoomReady race

Use `cancelTicketOrLeaveReadyRoom`; do not call cancel just once in the back button:

1. Query the latest snapshot of the original Ticket;
2. When `waiting/matched`, cancel using the latest version;
3. On a version race or an unclear request result, query the same Ticket again;
4. When already `room_ready/confirmed`, connect to the original Assignment and immediately leave the Room actively;
5. Clean up objects and open a new Admission only after the Ticket reaches a terminal state or the Room leave succeeds.

While an Admission request is still in flight, only record the exit intent and wait for the request to return; after getting the Ticket, run the algorithm above. Never unconditionally close
the Socket, and never treat a local timeout as the server having canceled.

After a connect failure or after `waitAndConnect` is aborted by an `AbortSignal`, use `settleAbandonedTicket`: in a waiting state it cancels directly and handles version
races; in `matched/room_ready` it waits, bounded, for an authoritative terminal state; a `confirmed` return means the Room has been joined, and you must actively leave through the Room handle.

## Three-channel messages and Presence

`sendGameplay` shows the purpose of the three channels:

- `sendControl`: reliable, low-frequency gameplay control intents, such as ready, select, confirm; it is not a platform control protocol.
- `sendReliable`: gameplay events that must arrive in order, such as round start, damage, settlement.
- `sendUnreliable`: continuous snapshots that may be dropped, such as position, facing, and interpolation targets.

The client sends inputs or intents; it must not send its own final score, win/loss, drops, or trusted coordinates. The Room validates opCode, payload type, length,
role permissions, phase, increasing sequence, and rate before updating the authoritative state.

`bindRoomEvents` handles `roomMessage`, `matchPresence`, and Room terminal states together. Presence only represents connection/member changes and does not replace
the gameplay player state of the user Room; during the disconnect grace period a role may still hold its Seat, and irreversible cleanup runs only in the final `onLeave`.

## Reconnect, migration, and network diagnostics

Listen to `gatewayReconnecting/gatewayReconnected` only to update the global network indicator; listen to
`roomReconnecting/roomReconnected` to pause and resume input for the current Room. Migration uses
`roomTransferStarted/roomTransferCompleted`: pause input at start, and on completion wait for the latest authoritative state to refresh the view; do not issue credentials yourself.

`collectNetworkDiagnostics` only reads a redacted network snapshot, Gateway RTT, and Room RTT. Logging `stage + error_code + room_id`
is enough; do not log URLs, SDP, ICE, tokens, credentials, or the full Assignment.

Before the first connection obtains a Room handle, no Room reconnect events are dispatched; keep using the original Ticket and `connectMatchedRoom`. After receiving
`roomClosed(reason=reconnect_timeout)`, the old Room is in a terminal state; atomically clean up this match and return to the entry point according to the gameplay.

## Switching gameplay from a long-lived Room

Only Pool may stay in the long-lived Room first while waiting for a new Ticket:

```ts
const ticket = await socket.joinPool("dungeon", { idempotencyKey: operationKey });
const ready = await socket.waitMatchTicketReady(ticket);
freezeOldWorldInput();
await oldRoom.leave();
const dungeon = await socket.connectMatchedRoom(ready, `${operationKey}-connect`);
```

If leaving the old Room fails, keep the new Ticket/Assignment and the error stage; you must not connect to the new Room first. Room mode should actively leave the old Room
before taking part in forming the new Room, because it may immediately occupy a new Seat. For the full races, read the long-lived Room section of the matchmaking guide.

## Normal exit and re-matchmaking

`leaveRoomAndClose` applies only to exiting the whole multiplayer page. When continuing to matchmake, only `await room.leave()`; do not close the shared Socket.

Correct order for single-match settlement: the Room saves and broadcasts a unique settlement result; the client saves the settlement UI data and immediately leaves the Room actively; after the platform confirms the Seat
is released, the client opens the next matchmaking; the Room closes on a subsequent tick after all human players have finally left or the bounded countdown runs out. On a Room-leave timeout keep
the error state and the Socket, and do not show "exited safely".

## Room gameplay templates

`room-supported-modes.typescript.ts` and `room-supported-modes.rust.rs` are authoritative implementations of the same matrix that has already been run, covering:

- The server validates increasing input sequence; the client cannot add score directly;
- Ready state goes through the reliable control channel and incremental state patches; the client merges patches before rendering;
- Chat content is length-limited and whitespace-normalized; targeted random results are sent only to the requester;
- Position intents go through the unreliable channel; the server validates sequence numbers and bounds before writing to authoritative state;
- Roster, Team, and Bot use the same authoritative action function;
- CF locks the Room at match start, unique settlement, clear-and-reset, release on the next tick;
- Long-lived world mid-game join, leave, and accumulated state;
- Pool unique settlement, client actively leaves the Room, close after the final `onLeave`;
- Close countdown, settlement ID, Room-lock state, and player state go into the checkpoint;
- Logs record only phase boundaries, not per-tick/per-message output.

Read only one of these files, according to the selected language. Do not generate both TypeScript and Rust Rooms, and do not let the example's business message codes directly
overwrite the existing protocol. After modifying, start the current language Mock with the corresponding Scenario; two clients must actually run through ready, chat, targeted receipts,
unreliable movement, out-of-bounds rejection, settlement, and exit. WebRTC and resource capacity can still only be verified online.
