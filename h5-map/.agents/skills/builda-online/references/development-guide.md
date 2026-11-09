# Builda Online Client and Room Development Guide

You are modifying a Godot, H5, Cocos, or Unity game and writing a Room hosted by Builda Online for it. The user has already provided:

1. The Godot plugin, `@cysj/online-h5`, or `com.cysj.online`, uniquely selected per `client-sdk-selection.md`.
2. The TypeScript SDK `@cysj/room` or the Rust SDK
   `cysj-room-sdk`, uniquely determined by the user's explicit choice or by evidence in the existing source. JavaScript is not supported.

The goal is for the selected client to complete authentication, matchmaking, and Match communication through Nakama-style APIs, and for the TypeScript or Rust
Room to run the author-confirmed Room logic through a unified lifecycle. Use only the public SDKs; do not read or modify platform-internal code.

## Prerequisites

This document is not a code template for skipping product confirmation. Before you start making changes, you must already have produced and confirmed the "multiplayer plan" per `matchmaking-guide.md`, which
specifies: the client engine, the Room language, CF looping room / shadow room / single-match Pool, the client entry point for every `matchKey`,
the public auto-matchmaking strategy, Team, Bot, Confirm,
the Room lifecycle, the trust model for each kind of shared data, tampering risks, Room handling, and resource cost. If several reasonable options remain, ask the user first and wait;
never reverse-engineer requirements from the examples below.

After confirmation, the AI proactively maintains the complete game workspace, not just the client:

1. Create or update `builda.online.json` at the project root so that every confirmed entry point has a unique `matchKey` and a complete frozen strategy.
2. Create or update the Room source directory for the current language, implementing the author-confirmed Room logic and lifecycle; `server/` is only the recommended directory name. If an existing project
   uses a different conventional directory, keep it and pass the actual path to the local Mock and deploy commands.
3. Update the uniquely selected client's entry points, UI, error states, and message handling.
4. Sync the shared message protocol and `builda.room.local.json`, and run local verification for the current language.

If the user already has any of these files, read them first and modify them in their existing structure; if you find old entry points that conflict with the confirmed plan, delete the superseded logic. Do not generate
a second config or a parallel Room. Only an explicitly read-only review task may skip writing files.

## General constraints

- The AI must not choose server-authoritative, client-authoritative, or pure relay on the author's behalf by default. Data reported by the client may be tampered with, replayed, sped up, or forged;
  Room validation, adjudication, recomputation, and storing more state also consume CPU, ticks, broadcasts, migration recovery, and capacity budget. Before implementing, you must confirm with the author
  whether each kind of shared data is rejected, clipped, validated, adjudicated, recomputed, rate-limited and relayed, relayed directly, or synced only for presentation.
- All four clients and the Room share integer message codes: client `op_code = 1` corresponds to message type `"1"` in the Room; Room
  `broadcast("101", payload)` corresponds to message code `101` in the client.
- User game and Room code must not create custom WebSockets, HTTP services, listening ports, matchmaking services, or authentication protocols; the source Mock installed with the deliverables
  and bound only to the loopback address is a local development tool, not a user service or an online WebSocket data plane.
- Do not modify the internal source of `addons/cysj_online`, `@cysj/room`, or `cysj-room-sdk`.
- Determine the Room language before starting. If the user has specified it, use it directly; if the existing `server/` has only `package.json`,
  `tsconfig.json`, a `.ts` Room entry, or `@cysj/room` imports, keep TypeScript; if it has only
  `Cargo.toml`, a `.rs` Room entry, or a `cysj-room-sdk` dependency, keep Rust. Ask only when creating a new Room, when both kinds of evidence
  exist at the same time, or when you cannot determine it reliably. Do not mix the two Room SDKs on your own, and do not create a JavaScript Room, a Node.js
  service, or a standalone process.
- Once the language is determined, only the matching option in the rest of this document belongs to the current flow. The TypeScript option does not need Rust, `rustup`, Cargo, or
  the `wasm32-wasip2` target; never check, install, or run these tools for a TypeScript Room; only the Rust option uses
  the Cargo toolchain.

## Implementation order

The implementation order is fixed as "config and protocol/trust model → Room logic → client flow → local verification". `builda.online.json` is not an auxiliary file generated
temporarily at deploy time, and `server/` is not an optional example; both are part of the game source. Every time you add or remove a matchmaking entry point, Bot, Team,
Room-lock timing, or game-ending method, check and modify both of them first, then change the client.

## 1. Define the shared message protocol first

First write or sync the confirmed plan into `builda.online.json`, then list all upstream and downstream messages, for example:

| Message code | Direction | Logical payload example | Meaning |
| --- | --- | --- | --- |
| `1` | client → Room | `{ "ready": true }` | Player ready |
| `2` | client → Room | `{ "x": 1.0, "y": 0.0, "sequence": 10 }` | Player input |
| `101` | Room → client | `{ "started": true }` | Match started |
| `102` | Room → client | `{ "players": ... }` | Authoritative state event |

Define message codes in one place so the selected client and the Room do not use contradictory numbers.

Create or update `builda.online.json` according to the confirmed plan. Then build a shared message table that includes at least the message code, direction, channel,
JSON structure, Room handling, whether it is written to recoverable state, tampering risk, and resource impact. Also maintain a
`matchKey → client entry/mode/public auto-matchmaking/Room route` mapping table. Every `matchKey` in the config must have a corresponding implementation in both the client entry points and the Room routes; entry points that exist in the client or
Room but are not declared in the config must be deleted or completed. Godot integer `op_code` values and
Room string message types must correspond one-to-one. Platform-reserved types must not be used as business messages.

When designing messages, also read the [payload optimization guide](payload-optimization.md). The JSON structures in the message table describe logical fields
and do not mean online traffic must be JSON-encoded; prefer binary payloads such as `Uint8Array`/`&[u8]` for game data. First estimate worst-case bandwidth from the encoded size of a single message,
sends per second, and the actual number of receivers, then decide on deltas, merging, rate limiting, targeted sends, or chunking.

### Server-side fulfillment of paid orders

When a paid item must be granted in the Room, call the current language SDK's `doOrder(orderId, callback)` /
`do_order(order_id, callback)` only from an authenticated player's message. The callback receives only an `OrderDeliveryResult`; only when it is `allowed` / `Allowed`, read the trusted `orderId/order_id + payId/pay_id` from
`result.order` and use `fulfill` to write to that player's player data. Do not
trust item or player IDs uploaded by the client, and do not retry the `allowed` branch yourself. `already_delivered` means it was already granted; it is not a rejection.
ExtPay's `delivered=false` is not an exclusive claim; cross-Room deduplication is claimed by the platform, and the game must not read or write keys starting with `builda.`.
`cloudEnqueue` / `cloudFlush` are forbidden inside the payment callback. The order is `doOrder` → `allowed` → `fulfill`; the platform waits until all writes successfully enqueued by that callback are APPLIED before idempotently marking the order.
Exceptions or uncertain results are reconciled manually by the platform; game code must not automatically refund or grant again.
The local Room Mock provides in-process fake orders and `fulfill` (TS also includes player data flush/read) to make local falsification easy; it does not replace final online verification. See
[Player data and payment fulfillment](room-cloud-state-and-payment.md) for details.

## 2. Client integration

During the client-writing phase, read [Client integration](development-guide-client.md), then read [End-to-end lifecycle and Room protocol](client-lifecycle.md)
and one lifecycle example for the selected engine.

## 3. Room server

During the Room-writing phase, read [Room server](development-guide-room.md), then, according to the determined Room language, read only one of
[TypeScript Room](room-typescript.md) or [Rust Room](room-rust.md).

## 4. Output and acceptance

Work in the following order:

1. Read `builda.online.json`, the current language Room, the selected client scenes, and the existing protocol; restate the confirmed plan and state which files you plan to modify.
2. Create or update `builda.online.json`, and list the mapping from each `matchKey` to the client entry point and the Room gameplay branch.
3. List and sync the unified message protocol.
4. According to the determined Room language, modify the TypeScript Room entry, or the locked Rust Cargo
   Workspace that the platform can compile.
5. Modify only the selected client's code, completing the chosen match entry, connection, Room leave, and failure UI.
6. Sync `builda.room.local.json`, and add brief comments, in the language the user uses, to public methods and key steps.
7. Check that the entry points in config, client, and Room correspond one-to-one; that the trust model and Room handling for each kind of message are implemented; that the Room has no overreaching capabilities; and that message codes match exactly on both sides.
8. Make it explicit whether the next match resets in the same Room or re-matchmakes. If it re-matchmakes, check every game-ending path one by one: the settlement is sent first, the client automatically
   waits for the active Room leave to succeed, and the Room closes on the tick after the final `onLeave` or a bounded timeout; after online deployment, verify that two matchmaking rounds
   can be completed back-to-back without waiting 60 seconds.

The final result must satisfy: Ticket `room_ready/confirmed` does not mean the Room has been joined; gameplay messages may be sent only after `connect_room_async` succeeds;
the tampering risk and Room handling boundary for each kind of shared data are implemented as confirmed by the author; no SDK's internal implementation has been modified.

## 5. Verification

Verify layer by layer as conditions allow:

1. Static cross-check of message codes, JSON fields, and channels.
2. Verify according to the determined Room language: for TypeScript, run only the project's existing TypeScript type check; only for Rust, run
   the local `wasm32-wasip2` build. Do not check or install Rust/Cargo to verify a TypeScript Room.
3. According to the selected client, run the Godot script smoke, H5 TypeScript compile/browser tests, or Unity EditMode/PlayMode tests.
4. Per the [local multiplayer workflow](local-testing.md), start the open-source Mock for the current language, and with different
   `local:<player-id>` identities verify that the selected Admission reaches the unique Room directly, the Scenario startup parameters, the user Room lifecycle,
   authoritative state, messages, abnormal disconnects, mid-game joins, and Room leaves.
   For gameplay that "re-matchmakes after settlement", you must also verify that the client automatically and actively leaves the Room after receiving the final settlement, that the Room triggers `onDispose` only after receiving the final `onLeave`,
   and that clients that did not leave are reclaimed by a bounded countdown; never accept a Room that stays in `finished` forever.
   The local Mock does not simulate platform role occupancy, so it cannot prove that you can matchmake again immediately.
   Local results can prove that the current source runs under the public Mock contract, but they do not verify WASM, WebRTC, TURN, cross-instance recovery, online capacity,
   or security isolation; these can only be re-verified with real identities after
   the user explicitly deploys online.
5. After the user explicitly requests online deployment and the deployment succeeds, run two clients with different real identities to re-verify the same scenarios. Before deployment, never upload source
   or activate a Match Activity on your own for the sake of verification.
   For gameplay that re-matchmakes every match, online acceptance must complete two matches back-to-back: after the first match receives the settlement, wait for the active Room leave to succeed, then immediately start the second
   matchmaking without waiting for the reconnect grace period; the second match must join the Room successfully, and `MATCH_ROLE_BUSY` must not appear.
6. Use the Builda skill to verify the selected client SDK, the client build output, and the Bundle; this verification is not equivalent to Builda Online
   two-client joint testing.

Modifying the trusted service implementation inside the Builda Online platform repository is not part of the user game development flow. If the current task really is maintaining the platform implementation, exit this skill's user
workflow and follow the repository's platform development rules.

## 6. Completion criteria

When delivering, state:

- Which client SDK was selected, on what basis, and which client and Room files were modified.
- The multiplayer plan as explicitly confirmed by the user or uniquely determined by project evidence: `matchKey`, public auto-matchmaking, player count/teams, Room locking/release, bots, and auto-join Confirm;
  explicitly list the capabilities not selected this time and therefore not implemented.
- The `builda.online.json`, current-language Room source, client entry points, message protocol, and local Scenarios actually maintained, and how they correspond one-to-one.
- The final message protocol, trust model, tampering risks, and Room handling boundaries.
- Whether "reset in the same Room" or "close then re-matchmake" was chosen after a match ends, with the corresponding game-ending code, client Room-leave code, and the results of the two-matches-back-to-back verification.
- Which verifications were run and which were not.
- The independent status of the client Bundle and the Room Artifact.
- Any still-missing online configuration, identity bridge, deployment authorization, or platform capability.

The final code must not modify SDK internals, must not mistake a successful match for having joined the Room, and must not pass off local Mock results as
WebRTC, TURN, cross-instance recovery, or online capacity verification. For gameplay that closes and then re-matchmakes, if any game-ending path only sets `finished`,
the client does not automatically wait for the active Room leave to succeed, or the Room does not call `disconnect` after the final Room leave/bounded timeout, the work is considered incomplete.
