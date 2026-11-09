# Builda Online Room Resource Limits

This page is the single source for the boundaries on user Room runtime, source upload, logs, and config counts. Machine-readable values ship with the Room SDK/Mock in
`contracts/resource-limits.json`. Do not infer a different set of limits from error message text, the platform implementation, or local machine performance.

## Contents

- [Runtime Hard Limits](#runtime-hard-limits)
- [Room Network Limits](#room-network-limits)
- [Log Limits](#log-limits)
- [Source Upload Limits](#source-upload-limits)
- [Config Count Limits](#config-count-limits)
- [Design Approaches for Different Game Types](#design-approaches-for-different-game-types)
- [What the Local Mock Can Prove](#what-the-local-mock-can-prove)

## Runtime Hard Limits

| Resource | Current limit | Result when exceeded | How game code should respond |
| --- | ---: | --- | --- |
| Room WASM memory per Room | 64 MiB | Allocation fails or the Room is closed protectively | Keep only authoritative data in state; do not cache map copies, historical frames, or unbounded collections |
| Single complete `CYR1` frame | 65535 bytes | SDK/runtime refuses to send or process it | The 14-byte header, message type, and payload all count; split large state into summaries, patches, or pages |
| Single checkpoint | 4 MiB | Checkpoint/restore fails | Save only the authoritative state needed for recovery; keep temporary indexes and rebuildable caches out of snapshots |
| fuel per lifecycle callback | 2,000,000,000 | An extreme runaway callback is aborted | Do not treat fuel as a time unit; every loop must be capped by player count, object count, or a fixed number of iterations |
| Host commands per callback | 256 | `ROOM_COMMAND_LIMIT_EXCEEDED` or protective close | Merge broadcasts and state patches; never call the Host per object, per cell, or per player |
| Host output per callback | 1 MiB | Output is rejected or the Room is closed protectively | Merge similar messages; do not broadcast the whole world plus many targeted copies in one tick |
| Host output per Room per second | 4 MiB | Output is rejected or the Room is closed protectively | Send high-frequency state over `state-unreliable`, send only changes, and aggregate at a fixed rate |

Host output includes the bodies the Room hands to the platform, such as `broadcast/send/set_state/patch_state`. One broadcast counts as one Host command,
but its body still counts toward output bytes. Regular CPU, fuel, and outbound volume are also observed online; crossing an observation threshold does not by itself close the Room, but the
structural hard limits and runaway-protection caps above still reject or terminate out-of-bounds execution.

A lifecycle callback consuming more than 200,000,000 fuel produces a rate-limited warning; the fuel hard limit is 2,000,000,000 per callback.
Execution-time protection applies independently, so a larger fuel budget does not guarantee a longer execution time. Keep every callback bounded.

## Room Network Limits

All online Rooms enforce network limits, with `1 KB = 1024 bytes`. Quotas include message bodies and protocol overhead.
Both online transport modes share the user's quota, and reconnecting does not immediately reset the quota.

| Scope | Upstream hard-limit base rate a | Downstream hard-limit base rate a | Result when exceeded |
| --- | ---: | ---: | --- |
| Per user | 20 KB/s | 80 KB/s | The current gameplay message is dropped and `ROOM_BANDWIDTH_LIMIT_EXCEEDED` is reported |
| Per Room | 20 × `effective_users` KB/s | 80 × `effective_users` KB/s | The current excess output is rejected and the same error is reported |

Each scope and each direction checks two sliding windows at once: **the total over the past 5 seconds must not exceed 5a, and the total over the past 1 second must not exceed 2a**.
For each user, this allows at most 100 KB upstream / 400 KB downstream over 5 seconds, and 40 KB upstream / 160 KB downstream over 1 second.
A 5-second average above 10 KB/s upstream or 40 KB/s downstream produces a rate-limited warning while messages remain allowed; Room warning thresholds scale by `effective_users`. Warnings do not emit the bandwidth-limit error.
Accounting uses 100ms buckets, and window boundaries may be conservatively delayed by at most 100ms; sends do not need to be spread evenly across every millisecond.
For example, a single user can send 40 KB upstream in a burst, but at most 100 KB in total over any 5 seconds, and cannot keep sending 40 KB every second.
Time before a new Room existed and idle periods with no sends count as zero; after exceeding the limit, you must wait for the corresponding historical traffic to expire, and waiting one second is not guaranteed to restore it.

`effective_users = min(active_users + 1, max_players)`, where `active_users` is the current number of deduplicated connected users.
For example, a Room with a maximum of 5 players uses a 2-player quota when 1 player is online and a 5-player quota when 5 players are online; a Room with a maximum of 1 player always uses a 1-player quota.
Broadcasts are metered by the actual number of receiving connections, and targeted sends count only the target user's connections. Multiple connections of the same user share that user's personal quota.

Limit-exceeded errors, join/leave confirmations, and migration notifications do not consume gameplay quota. Exceeding the limit does not by itself close the Room; once quota recovers, new messages are processed again,
and rejected messages are not resent automatically. Reliable transport only guarantees delivery of messages that were already accepted; it cannot guarantee that excess business messages are accepted.
Games should reduce send frequency, scope, and fields; operations that require confirmation should use business-level acknowledgments and bounded idempotent retries, rather than resending immediately and creating a flood.

When you receive `ROOM_RESOURCE_BUDGET_EXCEEDED`, `ROOM_COMMAND_LIMIT_EXCEEDED`, or `ROOM_STATE_INVALID`, first check:

1. Whether any loop, recursion, collection, or queue lacks a fixed cap;
2. Whether one callback sends a separate message for each player or object;
3. Whether every tick broadcasts the full state, map, paths, or history;
4. Whether the checkpoint contains rebuildable caches, presentation data, or stale players;
5. Whether a TypeScript Room is handling complex physics, full-map pathfinding, or large-scale object simulation, in which case lower the frequency or switch to Rust.

## Log Limits

| Resource | Current limit | Result when exceeded |
| --- | ---: | --- |
| Single entry body | 2048 bytes | Truncated or dropped, and counted in stats |
| Entries per Room per second | 20 | Dropped and counted in `dropped_events` |
| Body per Room per second | 16 KiB | Dropped and counted in `dropped_bytes` |
| In-memory buffer per Room | 256 KiB | Old/new logs dropped and counted in stats |
| Single query | 200 entries | A larger limit is rejected |
| Maximum retention | 7 days | Not queryable after expiry |

Exceeding log limits only drops logs; it does not block, trap, or close the Room. The TypeScript/Rust local Mock applies the same limits to single entry size, entries per second, and body per second,
but local stdout does not simulate online buffering, storage, or querying. Business state, retries, and settlement must not depend on log writes succeeding.

## Source Upload Limits

| Input | Current limit |
| --- | ---: |
| TypeScript single-file entry | 16 MiB |
| File count of a TypeScript directory or Rust Workspace | 2048 |
| Total expanded Workspace size | 64 MiB |
| Deterministic source archive | 16 MiB |

The deploy client checks these limits before authorization and upload. Dependency directories, build output, logs, databases, saves, backups, and local WASM must not
go into the Room source root; do not bypass the checks by splitting archives, changing extensions, or using symbolic links.

## Config Count Limits

| Config | Current limit |
| --- | ---: |
| `matchKeys` | 1..64 entries |
| `teamCount * teamSize` | 1..50 |
| `confirmTimeoutSeconds` | 1..60 seconds |
| `snapshotSchemaVersion` | 1..65535 |

These are per-game config limits, not a suggestion to fill the config to the maximum. Declare only game modes that actually exist in the client entry and Room routing.

## Design Approaches for Different Game Types

- Turn-based, board, and card games: event-driven updates; do not broadcast when there is no input, and the checkpoint saves the game state, the turn, and the settlement idempotency ID.
- Action, shooter, MOBA: when tamper resistance matters, the recommendation is for the client to send input rather than final coordinates, with the Room adjudicating at a fixed rate, the reliable channel carrying
  key events, and `state-unreliable` carrying droppable snapshots or deltas. This is only a default recommendation: when the author chooses, for reasons such as game feel, to have the client report positions or hits
  and the Room validate them, that can also be implemented, and the tamper risk must be stated per the SKILL's trust model; when adding ranking or rewards, re-evaluate together with the author,
  who may tighten validation, make settlement accept only events the Room has adopted, or switch to server authority; do not require a rework by default.
- CF-style looping room: the waiting and settlement phases are low-frequency or event-driven; lock the Room when a round starts, and release it after a full reset; keep only the necessary summary of past rounds.
- MMO/long-lived shadow room: send state by region or area of interest, not the whole world to all players; periodically clean up offline entities and expired events.
- Many Bots: Bots only produce input under the same authoritative rules; set fixed caps on the number of Bots, pathfinding nodes, and decisions per tick.

By default, keep state sync at or below 4Hz first; raise it only when the gameplay truly requires it, and estimate Host output per second using the actual maximum player count and the worst-case payload.
Do not treat `tickRate` as equal to the broadcast rate.

## What the Local Mock Can Prove

The Mock can verify, for the same Room source, the lifecycle, Roster/Team/Bot input, messages, state, Room lock/release, game end, basic log rate limiting,
and local multi-client flows. The Mock enforces the 65535-byte frame limit.

The Mock does not simulate WASM memory, fuel, the 4 MiB checkpoint, Host command/output budgets, real capacity, WebRTC/TURN, the matchmaking algorithm, or
security isolation. Static checks and local passes only prove that the business logic conforms to the public API; after deployment you must still verify transport,
recovery, and resource usage with real identities. Never read the platform implementation or hardcode internal addresses in game code to make local results "more like online".
