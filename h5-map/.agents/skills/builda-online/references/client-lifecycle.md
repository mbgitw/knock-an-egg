# Builda Online End-to-End Lifecycle and Room Protocol

This page is the single authoritative entry point in the multiplayer development Skill for the client lifecycle, the first Room-entry flow, Room control frames, and recovery semantics. It applies to
Godot, H5, Cocos, and Unity. Other references only describe specific gameplay or APIs and do not redefine state boundaries. It covers network blips,
screen off/backgrounding, incoming calls, the process being killed by the system, interruption of the first Room
connection, reconnect of a connected Room, active exit, and Room terminal states. The core principle: a paused local client screen, a request timeout, or a disconnected connection
never means the authoritative Ticket, Seat, or Room has been released; until the old object's terminal state is confirmed, you must never create a new Admission, otherwise it directly causes
`MATCH_ROLE_BUSY`.

## From Matchmaking to the First Gameplay Message

All engines follow the same order; the public SDK encapsulates credentials, signaling, and platform control frames:

| Step | Public action or platform event | Authoritative meaning | Game code responsibility |
| --- | --- | --- | --- |
| 1 | SDK `connect` / `auth` | Establishes the single Gateway control connection for the current process | Keep the Socket; on disconnect, recover it and do not create a second identity |
| 2 | `joinRoom` / `joinPool` | Creates the single Admission Ticket by `matchKey` | Immediately persist the latest `ticket_id/ticket_version/status` and the per-call idempotency key |
| 3 | Ticket heartbeat, `match_ticket_updated`, Ticket get | Renews the lease and advances `waiting -> matched -> room_ready/confirmed` | Pushes are only for early wake-up; the new snapshot returned by waits and queries overwrites the old snapshot |
| 4 | SDK `wait_and_connect_matched_room*` (or the split `wait_match_ticket_ready*` + `connect_matched_room*`) | The SDK issues credentials for the Assignment and completes one-shot SDP/ICE signaling through the Gateway; when a peer's Confirm failure causes a requeue, it returns to waiting on the same Ticket | Keep using the original Ticket; never call `room_credential/room_connect` yourself, and never treat a requeue as a failure and `join_*` again |
| 5 | The three WebRTC DataChannels open; or, after all bounded WebRTC attempts have explicitly failed, the SDK automatically establishes a standalone Room WSS | The three logical channels `control_reliable`, `game_reliable`, `state_unreliable` are usable; WSS is only an observable degraded state | Game code does not choose the transport or assemble the endpoint, and still keeps waiting for authoritative Room-entry confirmation |
| 6 | `match_connection_pending` | The Pool has reached the data plane and is still waiting for all human players of this round to connect | Consumed internally by the SDK; no business opCode is dispatched, and the game keeps waiting for the connect method to return |
| 7 | `room_joined` | The Seat has been committed, the Room has run its join flow, and the current connection has formally entered the Room | Consumed internally by the SDK, which makes the connect method return the Room handle; only from this moment may gameplay messages be sent |
| 8 | Numeric gameplay frames, `state/state_patch` | The Room and the client exchange opaque binary gameplay data | Decode according to the project's message protocol; do not assume JSON |
| 9 | Active leave / `room_closed` | The Seat is actively released, or the Room has entered a platform terminal state | Wait for the SDK to finish leaving; on Room close, save the reason/error code and then atomically clean up this match. A joined Room chat group is left automatically by the SDK |

`room_ready/confirmed`, obtaining the Assignment, the SDP answer, or the three DataChannels opening do not mean the Room has been entered. The public connect method only
returns successfully after `room_joined` is received, so game code must treat "obtaining the Room handle" as the only boundary for being allowed to send gameplay messages.

WebRTC is always the primary online link. Only when candidates are empty, the Peer/ICE is explicitly `failed`, or the three DataChannels did not all open within budget,
and the SDK has exhausted all bounded attempts of this round, may the SDK automatically connect to the standalone Room WSS with a newly issued transport epoch. A single TURN
address failure, a brief `disconnected`, auth/credentials, signaling, Room terminal states, platform service unavailability, or business errors must never trigger
degradation. Game code must not actively choose WSS, nor reconnect to another endpoint by itself based on error codes.

## Room Frame Classification

Online, all three logical channels carry `CYR1` binary frames. Normally they are carried by WebRTC DataChannels; the standalone WSS degraded state keeps the same frame semantics,
but `state_unreliable` uses bounded latest-wins/congestion dropping. Frame types and SDK behavior are fixed as follows; platform-reserved frames never enter the business message callback:

| Frame type | SDK behavior | Payload semantics |
| --- | --- | --- |
| `room_joined` | Completes the first Room entry internally | JSON: generation, session_id, presences |
| `match_connection_pending` | Internally keeps the Pool first-entry wait | Platform activation progress; business code must not depend on its fields |
| `match_presence` / `room_presence` | Dispatches typed Presence events | JSON |
| `room_migrate` | Dispatches migration start/complete and recovers automatically | JSON generation fence |
| `room_closed` | Dispatches the Room terminal state and cleans up the SDK handle | JSON reason, error code, message |
| `room_traffic_limited` | Raised through the generic error event, keeping the original error code | JSON scope, direction, limit, and observed |
| `state` / `state_patch` | Dispatches business messages with opCode `-1/-2` respectively | Opaque bytes |
| Pure decimal digit string | Dispatches a business message; the number is the opCode | Opaque bytes |
| `__cysj_transport_*`, `__cysj_room_*` | Consumed internally for SDK heartbeat and the active-leave handshake | Platform-reserved |
| Other non-numeric types | Treated as unknown platform frames and dropped; never mapped to `0` or `NaN` | Not exposed to the gameplay layer |

The public byte layout of `CYR1` is for interpreting packet captures and cross-client message limits, not for letting the game bypass the SDK and send frames itself:

| Byte offset | Length | Encoding | Meaning |
| --- | --- | --- | --- |
| `0..3` | 4 | ASCII | Fixed magic `CYR1` |
| `4..5` | 2 | `u16` big-endian | Byte length of the following UTF-8 type |
| `6..13` | 8 | `u64` big-endian | Non-negative message sequence |
| `14..(14+type_length-1)` | Variable | UTF-8 | Platform control type or decimal gameplay opCode |
| Remaining bytes | Variable | opaque bytes | Gameplay payload; do not assume JSON |

A complete frame is at most `65535` bytes; the 14-byte fixed header, the type, and the payload all count toward the limit. The Godot/H5/Cocos/Unity SDKs and the local Mock already handle
encoding, decoding, unknown platform frame filtering, and size checks; the game only uses the public Room send methods and typed message callbacks.

The local Mock synthesizes `room_joined` and goes directly to a single Room over a loopback WebSocket; it does not simulate real matchmaking, ICE/WebRTC,
the `match_connection_pending` activation window, network latency, or sandboxing. Therefore passing locally cannot replace online acceptance of the first Room entry and Pool activation.

## First Room-Entry Timeout Boundaries

| Error code | Where it stopped | What to investigate |
| --- | --- | --- |
| `ROOM_SIGNALING_FAILED` | The Gateway did not return a valid SDP answer | Auth, Assignment, credentials, or the signaling service |
| `WEBRTC_CHANNEL_TIMEOUT` | The three DataChannels did not all open within 15 seconds | ICE, TURN, device network, or WebRTC transport |
| `ROOM_JOIN_TIMEOUT` | DataChannels are open, but no `room_joined` within 15 seconds | Pool activation wait, the Room join flow, or the platform runtime placement |

The SDK's first connection performs bounded retries. Each retry round must read the latest snapshot of the original Ticket without a version, to accommodate the server raising
`ticket_version` on requeue; when exhausted, the stable error code of each round is kept. The caller can still only resume the original Ticket/Assignment and must not start a new Admission.

## SDK Time Boundaries

The following is the current public behavior, consistent across all four clients. It is for UI stage hints and troubleshooting, and is never a reason for the game layer to replicate the heartbeat, signaling, or retry state machine:

| Stage | Default boundary | Behavior on expiry |
| --- | --- | --- |
| Gateway cold connect | 30 seconds | Returns `GATEWAY_TIMEOUT` or the engine's corresponding connect timeout; may be overridden via public configuration |
| Ticket heartbeat | 5 seconds | Only renews the lease and backs up lost pushes; a `room_ready` push wakes up immediately |
| Gateway short-disconnect recovery | At most 3 attempts, 5 seconds per connect | Recovers the in-memory Session and the original Ticket; when exhausted, keeps the last stable error and does not create a new Admission |
| WebRTC ICE gathering | At most 5 seconds | Continues one-shot signaling with the offer/candidates already obtained; does not wait until the credentials expire |
| Three DataChannels open | 15 seconds | `WEBRTC_CHANNEL_TIMEOUT` |
| `room_joined` confirmation | 15 seconds after DataChannels open | `ROOM_JOIN_TIMEOUT` |
| Active leave | At most 10 seconds per call, at most two automatic retries | `ROOM_LEAVE_PENDING`; retain the handle and retry the same leave |

A connected Room enters disconnect detection after 10 consecutive seconds without valid data, and then uses a 30-second reconnect grace period; this is not the same timer as the two 15-second
timers of the first connection. Business UI should show the current stage and the stable error code, not a single unlocatable overall "network timeout".

## Contents

- [From Matchmaking to the First Gameplay Message](#from-matchmaking-to-the-first-gameplay-message)
- [Room Frame Classification](#room-frame-classification)
- [First Room-Entry Timeout Boundaries](#first-room-entry-timeout-boundaries)
- [State You Must Persist](#state-you-must-persist)
- [Interruption and Recovery Decision Table](#interruption-and-recovery-decision-table)
- [Screen Off, Backgrounding, and Network Blips](#screen-off-backgrounding-and-network-blips)
- [Process Kill and Cold Start](#process-kill-and-cold-start)
- [When a New Admission Is Allowed](#when-a-new-admission-is-allowed)
- [Unified Exit Algorithm](#unified-exit-algorithm)
- [Engine Examples](#engine-examples)
- [Error Display and Acceptance](#error-display-and-acceptance)
- [Common Stable Error Codes](#common-stable-error-codes)

## State You Must Persist

The client must maintain at least the following lifecycle. State names may be adjusted to the project's style, but the semantics must not be omitted:

```text
idle -> admitting -> ticket_active -> connecting_room -> room_connected -> cleaning
  ^                                                        |          \-> cleanup_failed
  |                                                        \-> reconnect_timeout
  +-------------------------------------------------------------------+
```

- `admitting`: the Admission request has been sent; the Ticket may already have been created on the server, but the client is still waiting for the response.
- `ticket_active`: the latest `ticket_id`, `ticket_version`, `status` must be kept on the UI controller or a long-lived object, never only as
  local variables of some async function. New snapshots returned by waits, pushes, and active queries all overwrite the old snapshot.
- `connecting_room`: a RoomReady Ticket is establishing the Room data plane. The exit flow must wait for the connection attempt to settle; if the connection finally succeeds,
  actively leave the Room right away.
- `room_connected`: keep the Room handle or `room_id`; on exit, wait for the active-leave confirmation.
- `cleaning`: disable the matchmaking, back, and repeated-cleanup buttons; never create a new Admission.
- `cleanup_failed`: keep the stable error code and the stage where it happened; do not close the Gateway, do not reopen matchmaking, and do not show "exited safely".
- `reconnect_timeout`: after an abnormal disconnect exceeds the grace period, the old Room is terminal. Clear this match's state and return to `idle`; a Pool reopens
  new matchmaking, and a long-lived Room re-runs its existing Admission. This is not an uncertain active-leave commit, and must not stay in a permanent error state.

Each Admission must also generate and persist a per-call idempotency key until the Ticket is obtained or it is certain that the request did not create a Ticket. A network timeout, disconnect, or
upstream failure cannot prove the server did not create a Ticket; for such outcomes you must not retry immediately with a new idempotency key, let alone start the next matchmaking directly.

## Interruption and Recovery Decision Table

First decide the recovery action by the authoritative stage at the time of the interruption; never look only at whether the page became visible again or whether the Socket just reconnected:

| Stage at interruption | Authoritative object | Recovery action | Forbidden action | When it ends |
| --- | --- | --- | --- | --- |
| Admission request has not returned yet | A Ticket may already exist | Keep the original idempotency key and wait for the original call to settle; save the Ticket once obtained | Call any `join_*` with a new idempotency key | It is confirmed the request created no Ticket, or the Ticket is obtained and the flow continues below |
| `waiting/matched` | Ticket | Let the SDK recover the Gateway, query and keep waiting on the original `ticket_id/ticket_version` | Create a new Ticket; treat a network error as a Ticket terminal state | The Ticket reaches `room_ready/confirmed` or an authoritative terminal state |
| `room_ready/confirmed`, first Room not yet connected | Ticket + Assignment + Seat | Query the original Ticket's latest snapshot, then call `connect_matched_room*` to continue the original Assignment; if the snapshot has been requeued back to waiting, go back to `wait*` (`wait_and_connect_matched_room*` does this automatically) | `join_*` again, manually reuse old Room credentials, treat `MATCH_ROOM_NOT_READY` as terminal | First connection succeeds, or the Ticket/Room reaches an authoritative terminal state |
| `room_joined` already received | Room + Seat | Hand over to the SDK's automatic Room reconnect; the business layer pauses input and waits for events | Create a new Admission; manually create a second Peer | `room_reconnected`, or `roomClosed/match_closed` |
| Active exit is settling | Ticket or Room | Wait for the cancel/active-leave confirmation | Close the Socket, switch scenes, matchmake again | Ticket terminal state or active leave succeeded |
| Room is already terminal | No recoverable old Room | Clean up the old match's local state; return to the lobby or start a new Admission according to the gameplay | Keep using the old Assignment, Seat, credentials | Local state has been atomically cleared |

`room_reconnecting` only applies to a Room for which `room_joined` was successfully received. When the Assignment has been committed but the first WebRTC has not yet succeeded,
there is no local Room handle that can auto-reconnect; recovery must run `connect_matched_room*` again along the original Ticket/Assignment.

## Settling After Requeue and Connection Failure

When any peer in a Pool fails to Confirm, the server sends the other still-alive Tickets back to the waiting state and raises `ticket_version` (requeue).
Such a Ticket is not terminal and still occupies the role; with split calls, `connect_matched_room*` returns `MATCH_ROOM_NOT_READY`, which is a
recoverable error, not a terminal state. All four client SDKs provide combined entry points that internalize this recovery path:

| Capability | Godot | H5 / Cocos | Unity |
| --- | --- | --- | --- |
| Wait + connect + automatically return to waiting on requeue | `wait_and_connect_matched_room_async(ticket, key)` | `waitAndConnectMatchedRoom(ticket, { signal, idempotencyKey })` | `WaitAndConnectMatchedRoomAsync(ticket, null, key, token)` |
| Settle a still-alive Ticket to an authoritative terminal state | `settle_match_ticket_async(ticket, key)` | `settleMatchTicket(ticket, { signal, idempotencyKey })` | `SettleMatchTicketAsync(ticket, key, token)` |

Rules:

1. Prefer the combined entry point on the main matchmaking path. It loops on the same Ticket, using the `<key>-round-<n>` idempotency sub-key for each connection round, until it obtains
   a Room handle or the Ticket enters an authoritative terminal state (H5/Cocos/Unity throw `MATCH_TICKET_TERMINAL`; Godot returns `null` and raises it through
   `request_failed`). It does not extend the original Ticket's Match deadline.
2. When the combined entry point fails for other reasons (such as `WEBRTC_CHANNEL_TIMEOUT`, `ROOM_JOIN_TIMEOUT`), the Ticket is often still
   `room_ready` or has been requeued; you must call the settle entry point first, then show the error and reopen the next matchmaking.
3. The settle entry point cancels `waiting` directly and handles the `MATCH_TICKET_STALE/MATCH_ASSIGNMENT_STALE/MATCH_TICKET_MOVING` races;
   for `matched/room_ready` it does not cancel, but waits (bounded) for an authoritative terminal state or a requeue back to waiting; returning `confirmed` means the Room has been entered,
   and you must actively leave through the Room handle. The wait budget is no less than 90 seconds and no more than the authoritative deadline plus 30 seconds; beyond that it returns
   `MATCH_RECOVERY_TIMEOUT`, and if cancel races fail to settle 5 times in a row it returns `MATCH_CANCEL_NOT_SETTLED`; neither is a terminal state,
   and the UI must keep the error code and block immediate re-matchmaking.
4. When the player actively cancels matchmaking while waiting: H5/Cocos/Unity abort the combined entry point with `AbortSignal`/`CancellationToken`, then call the settle
   entry point; Godot calls `settle_match_ticket_async` directly and concurrently, and the combined entry point returns `null` once the same Ticket reaches a terminal state.
   When the player asks to exit in the `room_ready` stage, you may still follow the [Unified Exit Algorithm](#unified-exit-algorithm) to connect and then immediately actively leave, so as to release the
   Seat as soon as possible; the settle entry point only waits for a terminal state and does not replace that path.
5. The local Mock does not simulate a peer's Confirm failure, and requeue is hard to trigger manually on real devices; do not write your own state machine for this path, and do not
   treat `MATCH_ROOM_NOT_READY` as terminal and clear the Ticket, otherwise the next matchmaking will directly hit `MATCH_ROLE_BUSY`.

## Screen Off, Backgrounding, and Network Blips

Screen off, backgrounding, incoming calls, Wi-Fi/cellular switching, and brief loss of network are all normal mobile interruptions and do not mean the player actively exited:

1. Keep the long-lived object that holds the Socket and the multiplayer state machine alive; do not call `close()` or clear the Ticket because the scene is paused, loses focus, or the page is hidden,
   and do not generate a new Admission idempotency key.
2. While the engine is paused, the SDK may be unable to poll or send heartbeats. After returning to the foreground, continue the original async flow; do not call
   `join_room/join_pool` directly in the foreground callback.
3. Gateway short disconnects are recovered by the SDK, bounded, using the in-memory Session. In the Ticket stage, query the original Ticket after recovery; in the first Room connection stage, continue the original
   Assignment; in the connected Room stage, the SDK re-issues credentials with a higher Presence epoch and rebuilds the Peer.
4. `gateway_reconnecting` only means the control connection is recovering, not that the Ticket or Room is terminal. `room_reconnecting` means an existing
   Room is within its reconnect grace period; in both states, disable the matchmaking, room-creation, and repeated-exit buttons.
5. After `gateway_reconnected`, continue the current authoritative stage; after `room_reconnected`, resume input and refresh the authoritative Room state. Do not write authoritative results directly based on
   frames, timers, or predicted state accumulated locally during the disconnect.

A connected Room starts disconnect detection after 10 consecutive seconds without valid data, followed by a 30-second reconnect grace period. During the grace period the Seat is in
`offline_grace` and still occupies the role and capacity; this exists to allow returning to the original match after a normal screen off or network switch. User code must not shorten this period,
and must not bypass it with a new Admission.

The first Room connection has no `room_reconnecting` event. It is bounded by the original Ticket, the Assignment, and the Room first-connection deadline; the caller
must keep the original Ticket and let `connect_matched_room*` settle within its bounds. An empty result, a timeout, or a single signaling failure cannot prove
the Seat occupancy has been released.

## Process Kill and Cold Start

When the process is killed by the system, the browser is closed, or the device loses power, the client cannot send a reliable active leave, nor continue in-memory recovery tasks:

- Do not fake a successful leave in exit callbacks; Godot `_exit_tree`, H5 `beforeunload`, Cocos Component `onDestroy`, and Unity
  `OnDestroy` cannot carry network settling.
- Do not write the runtime token, Room credentials, SDP/ICE, or the full Assignment into local saves for recovery; this data is short-lived, sensitive, and constrained by
  generation/presence epoch.
- The current public client API provides no entry point to enumerate by role or recover unknown pending Tickets/Rooms after a process restart. If the business did not keep the same long-lived multiplayer object while the host
  was still alive, after a cold start you can only wait for the platform to reclaim it per the Ticket deadline, the first-connection deadline, or the Room offline grace period.
- Receiving `MATCH_ROLE_BUSY` immediately after a cold start means the old authoritative object has not been reclaimed yet. Show "The previous match is ending, please try again later" and disable
  automatic fast retries; do not loop `join_*`. With current capabilities, the player can only retry after a bounded backoff, or wait for the platform to add role-based recovery.

Therefore, on mobile, keep the multiplayer controller alive across scenes as much as possible, and treat "screen-off recovery while the host process is still alive" as the main path; immediately resuming a match after the process is killed
is currently not a public capability, and neither the Skill nor the game UI may promise it can be recovered.

## When a New Admission Is Allowed

Only after any one of the following authoritative conditions is met may you clear the old state and reopen new matchmaking/room-creation entry points:

- The saved Ticket explicitly enters `cancelled`, `timeout`, `confirm_timeout`, or `failed`;
- The active-leave call succeeded, and the platform has confirmed the Seat is in the final `Left` state with its occupancy released;
- A connected Room received `match_closed/roomClosed/RoomClosed`. `reconnect_timeout` means the reconnect grace period was exhausted; other reasons such as a normal business close,
  `runtime_error`, or a resource-budget close likewise mean the old Room is terminal, and should be shown by reason and then cleaned up;
- In the first connection stage, re-querying the original Ticket/Room explicitly yields an authoritative terminal state.

None of the following signals is sufficient to reopen a new Admission: a local timeout, a Gateway/WebRTC close, the App returning to the foreground, a single Credential or
signaling failure, `MATCH_ROLE_BUSY`, a failed cancel request, or an active-leave commit timeout. In these cases you must keep the stage and the stable error code.

When you receive `MATCH_ROLE_BUSY`, do not retry Admission again. If there is a Ticket/Assignment/Room in memory, recover that object; if the local
state has been lost, enter a controlled wait, and never guess the occupying object or loop creating new Tickets.

## Unified Exit Algorithm

Active leave is a retryable operation. `leave_match_async`, `leaveRoom` / `room.leave()`, and `LeaveRoomAsync` / `LeaveAsync`
keep the original handle when sending fails or confirmation is unavailable. Concurrent calls share the same attempt and retries
reuse the same operation. The SDK waits at most ten seconds per call, with at most two automatic retries and bounded backoff.
`ROOM_LEAVE_PENDING` means retain the Room handle and call leave again. Keep the control connection available. Gameplay sends,
automatic Room reconnect, and new Room admissions are blocked until the pending leave is confirmed. A physical disconnect does
not mean the user has safely exited. Only confirmed release emits the `client_leave` close notification and releases Room resources.

Services advertising retryable leave support can confirm through the control connection even when the Room data connection is
lost. Older services use the existing data-channel handshake; they retain the handle on failure but require a working data channel
to confirm. Do not promise the stronger recovery guarantee for that fallback. Completed calls can be repeated using the same
handle; receipts expire after five minutes. `ROOM_LEAVE_UNKNOWN`, `ROOM_LEAVE_STALE`, `ROOM_LEAVE_PROOF_INVALID`, and
`ROOM_LEAVE_IDEMPOTENCY_CONFLICT` require showing the error and preserving recovery state, not creating another admission.
The SDK stores recovery state in memory; process termination and explicit Socket disposal end this in-memory recovery lifetime.


The normal "return to lobby", "exit Room", and "switch scene" entry points must be awaitable async flows:

1. Record `exit_requested=true`, and disable repeated buttons and all new Admissions.
2. If the Admission is still in flight, wait for it to settle; if it yields a Ticket, save it immediately and go to the next step. If the outcome is unclear, enter
   `cleanup_failed`; do not assume no Ticket exists.
3. If the Room connection is still in flight, wait for it to settle; if it yields a Room handle, actively leave immediately.
4. For a connected Room, call active leave and wait for confirmation: Godot only accepts `OK`; H5/Cocos/Unity only accept normal completion of the Promise/Task.
5. When there is only a Ticket, cancel with the latest `ticket_id/ticket_version`. If the cancel fails or returns a non-terminal state, actively query the latest Ticket:
   - `cancelled`, `timeout`, `confirm_timeout`, `failed`: already settled;
   - Still cancellable: retry once more, bounded, with the latest version from the query;
   - `room_ready` or `confirmed`: the cancel has raced with RoomReady; connect to that Room and then immediately actively leave.
   When the connection has already failed, the combined entry point has been aborted, or the Seat does not need to be released immediately, you may call the settle entry point directly instead of a manual cancel loop; when it returns
   `confirmed`, actively leave per step 4.
6. Only after the cleanup above succeeds may you close the Socket, switch scenes, or reopen the next matchmaking.

Godot `_exit_tree`, H5 `beforeunload`, Cocos Component `onDestroy`, and Unity `OnDestroy` cannot reliably wait for network confirmation,
and must not be used as the normal exit entry point.
The process being force-killed by the system, the browser being closed directly, or the device losing power are abnormal disconnects, which can only rely on the reconnect grace period and platform reclamation; the client must not claim they have
performed an active leave.

## Terminal Recovery After Abnormal Disconnect

After the automatic reconnect grace period is exhausted, all four client SDKs dispatch the Room close event only once, with `reason` fixed to `reconnect_timeout`. This event means the old
Room has entered a terminal state on the client; it is not a network error the business layer needs to wait on again. Event handling must atomically complete the following actions:

1. Verify the event's `room_id` is still the current Room, and ignore late events from old Rooms.
2. Clear the Room handle, the current Ticket, the Admission idempotency key, the Seat/pending-connection state, and the reconnect/cleanup/return flags.
3. A Pool switches back to the game lobby UI and reopens new matchmaking; a long-lived Room starts a new Admission through its existing entry point.
4. Do not enter a permanent `ERROR`, and do not wait for another global error event. An active-leave `ROOM_LEAVE_PENDING` (older SDKs: `ROOM_LEAVE_COMMIT_TIMEOUT`) is still an
   uncertain outcome, must stay in `cleanup_failed`, and must not apply the recovery rules here.

Godot may branch on `reason` in `match_closed`; H5/Cocos listen to `roomClosed`, Unity listens to `RoomClosed`. The recovery entry point should use
`call_deferred`, an event-loop task, or the project's existing async scheduling, to avoid synchronously re-entering Admission inside the close event callback stack.

## Engine Examples

The complete copy-ready code is split by engine; read only the one for the chosen engine. The rules on this page are the same for all four clients; when an example conflicts with this page, this page wins.

| Engine | Complete example | Cancel Ticket | Active leave | Callbacks that cannot carry a normal exit |
| --- | --- | --- | --- | --- |
| Godot | [Godot Lifecycle and Integration Example](client-lifecycle-godot.md) | `cancel_match_ticket_async` | `leave_match_async` | `_exit_tree` |
| H5 / Cocos | [H5 and Cocos Lifecycle Examples](client-lifecycle-h5-cocos.md) | `cancelMatchTicket` | `leaveRoom` | `beforeunload`, Component `onDestroy` |
| Unity | [Unity Lifecycle Example](client-lifecycle-unity.md) | `CancelMatchTicketAsync` | `LeaveRoomAsync` | `OnDestroy` |

## Error Display and Acceptance

The error state must keep at least `stage`, `error_code`, and a short message without credentials. `MATCH_ROLE_BUSY` means the role is still bound to an unsettled
Ticket or Room, not "random room search failed"; the UI should block immediate repeated Admission and show a diagnosable error code. Logs must not record the
runtime token, the full Ticket payload, Room credentials, SDP, or ICE.

When `ROOM_BANDWIDTH_LIMIT_EXCEEDED` is received, the user-facing hint should state clearly that Room game data traffic has hit the upstream or downstream limit, show the
direction, scope, and `limit_bytes_per_second`, and guide toward reducing sync frequency, visible range, or payload size; do not just show "network error", and do not suggest
the user reconnect to get around the limit.

## Common Stable Error Codes

The client UI does not need a separate branch for every error code, but must save the original `error_code` together with the stage where it happened and show it in a debug entry point. Below are the stable codes users and user AI most often encounter, from which the next step can be decided; unknown codes must also be shown as-is and must never be overwritten with "room search failed".

| Error code | Common stage | Meaning and handling |
| --- | --- | --- |
| `AUTH_FAILED` | `gateway_connect`/`admission` | The runtime token is invalid, expired, or does not belong to the current game. Obtain a new token from the Builda runtime and restore the session; do not reuse the old token. |
| `CLIENT_SERVER_VERSION_UNSUPPORTED` | `gateway_connect`/`room_connect` | The current client Bundle has no active Server Release yet. Update to the published client, or wait for the server release for the current Bundle to finish; do not bypass the version gate with repeated Admissions. |
| `GATEWAY_TIMEOUT`, `GATEWAY_CONNECT_FAILED`, `GATEWAY_CLOSED` | `gateway_connect`/`ticket_wait` | The Gateway connection timed out, failed, or has been closed. If it is not an active user exit, you may reconnect per the SDK recovery flow; do not create a second unsettled Admission. |
| `REQUEST_TIMEOUT`, `CONTROL_TIMEOUT`, `CONTROL_DISCONNECTED`, `CONTROL_NOT_CONNECTED` | `admission`/`ticket_wait`/`cleanup` | The control request did not get a definite result. First query or wait for the saved Ticket/Room state; do not assume the server did not create a Ticket. |
| `MATCH_INVALID_REQUEST`, `MATCH_INVALID_ACTIVITY`, `MATCH_PUBLIC_MATCHMAKING_DISABLED` | `admission` | The `matchKey`, mode, or public matchmaking switch passed by the client is inconsistent with `builda.online.json`. Fix the configuration and the client entry point; do not pass player counts or strategies ad hoc from the client. |
| `MATCH_ROLE_BUSY` | `admission` | The current role already has another Ticket or an unfinished Admission. A role inside a Room is allowed to create one Ticket; do not interpret this code as "cannot matchmake while in a Room". Recover or settle the existing object before retrying. |
| `MATCH_IDEMPOTENCY_CONFLICT` | `admission`/`ticket_cancel` | The same idempotency key was used for different requests. Fix one idempotency key per user action; generate a new key for a new action. |
| `MATCH_TICKET_NOT_FOUND`, `MATCH_ADMISSION_PENDING` | `ticket_get`/`ticket_wait` | The Ticket is not yet readable, has expired, or the admission is still being compensated. Keep querying the saved ticket/idempotency state; do not lose this operation. |
| `MATCH_TICKET_STALE`, `MATCH_ASSIGNMENT_STALE`, `MATCH_TICKET_MOVING` | `ticket_wait`/`ticket_cancel` | The Ticket version or Assignment has been updated. Immediately re-fetch the latest Ticket snapshot, then continue waiting or cancelling with the latest `ticket_version`. |
| `MATCH_TICKET_TERMINAL`, `ASSIGNMENT_MISSING` | `room_connect` | The Ticket is terminal or the Assignment is missing. Branch on the Ticket `status`; do not assemble Room info manually. |
| `MATCH_ROOM_NOT_READY` | `room_connect` | With a split call to `connect_matched_room*`, the Ticket has been requeued back to waiting. It is a recoverable error: re-query the snapshot and go back to waiting on the same Ticket; `wait_and_connect_matched_room*` handles it automatically; do not treat it as terminal and clear the Ticket. |
| `MATCH_RECOVERY_TIMEOUT` | `ticket_wait`/`ticket_settle` | No authoritative terminal state could be obtained even after the Ticket deadline. Keep the error code and block immediate retries; tell the user to re-enter later or wait for platform reclamation. |
| `MATCH_CANCEL_NOT_SETTLED` | `ticket_settle` | Repeated cancels by the settle entry point all raced with server updates. Keep the Ticket and the error code, back off and call the settle entry point again; do not start a new Admission. |
| `ROOM_FULL` | `room_connect` | Seats were full under concurrent admission. Keep the original Ticket/Assignment and query its authoritative terminal state; if still waiting, continue the original flow; only after it enters a terminal state may a new round of matchmaking start. |
| `ROOM_CREDENTIAL_MISSING`, `ROOM_CREDENTIAL_INVALID`, `ROOM_SEAT_NOT_COMMITTED`, `ROOM_PRESENCE_STALE` | `room_connect` | The Room connection credentials, Seat, or Presence are no longer valid. Keep the original Ticket and re-obtain the authoritative Assignment and credentials per the SDK matchmaking recovery flow. |
| `ROOM_ROLE_BINDING_BUSY` | `room_connect` | The role still occupies another Room Seat. Keep the new Ticket/Assignment, first actively leave the old Room and wait for success, then connect to the new Room; never just drop the network or let the new connection override the old Seat. |
| `ROOM_CONNECT_FAILED`, `ROOM_SIGNALING_FAILED` | `room_connect` | Credential or one-shot signaling failure. Show the error code and keep the original Ticket/Assignment; it must not be treated as having safely left the Room. |
| `WEBRTC_CHANNEL_TIMEOUT` | `room_connect` | The three DataChannels did not all open within 15 seconds; investigate ICE, TURN, device network, and WebRTC transport first. |
| `WEBRTC_OFFER_FAILED`, `WEBRTC_CONNECTION_FAILED`, `WEBRTC_FAILED` | `room_connect` | A WebRTC link failure recognizable by the SDK; degradation happens automatically only when all bounded attempts are exhausted and the platform declares the capability; the game layer must not switch by itself. |
| `ROOM_WEBSOCKET_CONNECT_TIMEOUT`, `ROOM_WEBSOCKET_CONNECT_FAILED`, `ROOM_WEBSOCKET_CLOSED` | `room_connect`/`room_connected` | The standalone degraded connection after an explicit WebRTC failure also failed or disconnected. Keep the original Ticket/Room lifecycle, handle it per SDK recovery or terminal state, and do not create a new Admission. |
| `ROOM_JOIN_TIMEOUT` | `room_connect` | DataChannels are open but no `room_joined` was received within 15 seconds; investigate the Pool activation wait, the Room join flow, and the platform runtime placement first. |
| `ROOM_BANDWIDTH_LIMIT_EXCEEDED` | `room_connected` | The user's or Room's game data plane hit the upstream/downstream limit; record the error code and the error message containing scope, direction, and quota, reduce frequency, range, or payload size, and do not reconnect immediately to get around it. |
| `ROOM_NOT_CONNECTED`, `ROOM_ALREADY_CONNECTED`, `ROOM_CHANNEL_CLOSED`, `ROOM_CHANNEL_BUSY` | `room_connected` | The local Room handle state does not match or the DataChannel is unavailable. Check the client state machine; do not bypass the SDK to send packets directly. |
| `ROOM_CLOSED` | `room_closed` | The user Room ended normally on its own; the public `reason` is always normalized to `game_completed`. Clean up the old Room and silently return to the corresponding entry point; do not wait for or produce a global error. |
| `ROOM_RESOURCE_BUDGET_EXCEEDED`, `ROOM_RUNTIME_ERROR`, `ROOM_COMMAND_LIMIT_EXCEEDED`, `ROOM_STATE_INVALID` | `room_closed` | The Room was closed by the platform sandbox protection. Routine CPU, fuel, and outbound budgets only warn and do not close the Room; when this error appears, first check for unbounded loops, abnormally concentrated Host calls, memory/output bounds, and message storms. |
| `ROOM_TERMINATED` | `room_closed` | The Room was terminated by the platform for an unspecified reason; this does not mean the user Room ended normally on its own. Keep the error code and Room ID, clean up the old Room, then show a hint and enter the diagnosis flow. |
| `ROOM_LEAVE_PENDING` (older SDKs: `ROOM_LEAVE_COMMIT_TIMEOUT`) | `room_leave`/`cleanup` | The active-leave commit was not confirmed. Keep the error state and the Gateway; do not close the connection or reopen matchmaking, to avoid a subsequent `MATCH_ROLE_BUSY`. |

The Ticket terminal states `cancelled`, `timeout`, `confirm_timeout`, `failed` are status values, not exception codes. When the wait or cancel flow gets these statuses, the Ticket has settled; only then may you clear the local Ticket and let subsequent flows continue.

After implementation, verify at least:

1. Exiting immediately after the Admission request is sent cancels the Ticket once the request returns it, instead of closing the Socket directly.
2. Exiting in the `waiting/matched` stage obtains a terminal state such as `cancelled` before switching scenes.
3. When cancel and `room_ready` happen at the same time, the client connects and actively leaves, leaving no Seat occupied.
4. With a connected Room, the Socket is closed only after the active leave succeeds; a timeout stays in the error state and cannot immediately matchmake again.
5. Completing "matchmake → enter Room → leave Room → matchmake again" consecutively does not produce `MATCH_ROLE_BUSY` the second time.
6. Stable error codes such as `MATCH_ROLE_BUSY` and `ROOM_LEAVE_COMMIT_TIMEOUT` are not overwritten by "room search failed".
7. Simulate screen off or network interruption separately in the four stages `admitting`, `ticket_active`, first `connecting_room`, and connected `room_reconnecting`; there is no second `join_*` during recovery.
8. An interrupted first Room connection queries and continues the original Ticket/Assignment, does not wait for a `room_reconnecting` event, and does not reopen the matchmaking button.
9. An interrupted connected Room first enters reconnecting; after reconnected it refreshes the authoritative state, and only after `reconnect_timeout` or another Room terminal state does it reopen new Admission.
10. Simulate a process kill and then a cold start that receives `MATCH_ROLE_BUSY`; the client does not loop Admission, does not read local credentials, only shows the old-match reclamation status, and backs off with bounds.
