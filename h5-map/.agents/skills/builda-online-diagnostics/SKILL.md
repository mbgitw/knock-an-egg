---
name: builda-online-diagnostics
description: "Query and analyze Builda Online online Room user logs, log drop statistics, and exit reasons, and guide adding bounded logs to TypeScript or Rust Rooms. Use when the user asks to check server logs, investigate a Room exiting silently, locate online multiplayer server issues, explain droppedEvents/droppedBytes, design log fields, or assess log performance overhead; ordinary multiplayer gameplay development still uses the builda-online Skill."
---

# Builda Online Log Diagnostics

Always reply to the user in the language they use. This guidance is written in English; that does not change the language you talk to the user in.

Use the author's existing Builda login and the current project's game binding to query short-term online diagnostics for the current game, optionally filtered to a known Room. Do not create another login state,
do not read or show credentials, and do not try to access other games.

## Delivery version gate

Builda Online deliverables are released in the same version as the base Builda SDK, and the project's only version lock is `.builda-agent/sdk-version`; this Skill does not compare manifests by time
window. After reading project rules and before querying online logs or changing Room log code, read `.builda-online/installation.json`
and both Skills' `VERSION`, then run `.builda-online/bin/builda-online check`: if `onlineRelease` equals `sdkVersion`, you may
continue; on `ONLINE_RELEASE_DRIFT`, run `.builda-online/bin/builda-online upgrade` per the multiplayer development Skill, which also updates
this Skill; `onlineRelease=unrecorded` means an old manual install, so run `builda-online install` once per the multiplayer development Skill. You must not
edit the version lock yourself, and must not read the root `manifest.json` to guess "is there a new version".

Addresses such as `apiBaseUrl` and `buildaAgentApiBaseUrl` in the install record are online config that must not be guessed or replaced. When the manifest or install record
is unavailable, do not claim the version is confirmed; only continue a read-only inventory and tell the user.

## Identify the evidence source first

Room logs are not a master log of the whole multiplayer chain. First determine the failure stage per the multiplayer development Skill's lifecycle, then choose evidence; failures that never entered a Room
cannot be located by running `logs` repeatedly:

| Last confirmed stage | Primary evidence | What Room logs can prove |
| --- | --- | --- |
| Gateway not yet connected | SDK stable error code, client network snapshot | Not applicable; there is no Room ID yet |
| Admission/Ticket waiting | Latest `ticket_id/ticket_version/status`, SDK error code | Not applicable; Ticket logs are not Room user logs |
| Assignment received, first connection got no `room_joined` | `room_id`, connection stage, `ROOM_SIGNALING_FAILED` / `WEBRTC_CHANNEL_TIMEOUT` / `ROOM_JOIN_TIMEOUT` | Only helps judge whether the Room started or ran the join; no logs does not mean Gateway, ICE, or TURN is fine |
| Room handle obtained | Client events, Room ID, user Room logs | Can reconstruct the business stage after `onJoin`, user code logs, and exit info |
| `roomClosed` / `match_closed` received | Close reason/error code, Room log `exit` | Judge together with the last business stage and exit category; the last log line is not automatically the root cause |

First save and report `stage + error_code + room_id (if any)`. SDP, ICE, tokens, credentials, and the full Assignment are not diagnostic
material; never write them to client logs, Room logs, or the final report.

## Important game alerts

Start with `builda-online alerts --since 30m --limit 100 --json` when the user wants to find resource pressure, dropped traffic, or failed Rooms and does not know a Room ID. On Windows use `.\builda-online.cmd` from the installed bin directory, or the project's `.\.builda-online\bin\builda-online.cmd` launcher. To focus on a returned Room, add `--room-id <room-id>`. The command uses the current project's game binding and the same read-only diagnostics permission as `logs`.

Alerts are trusted service observations, saved separately from user-written logs. A user `log("warn", ...)` or `log("error", ...)` does not create an alert. Normal game completion and empty-Room cleanup do not create alerts.

| Alert code | Meaning / action |
| --- | --- |
| `ROOM_FUEL_WARNING`, `ROOM_EXECUTION_WARNING`, `ROOM_CPU_WARNING` | A measured callback or Room resource crossed a warning threshold; `action=observed`, execution continues |
| `ROOM_BANDWIDTH_WARNING` | Accepted upstream/downstream traffic crossed the 5-second warning threshold |
| `ROOM_BANDWIDTH_LIMITED` | A gameplay frame was dropped; `action=message_dropped`, connection remains available |
| `ROOM_FUEL_EXHAUSTED`, `ROOM_MEMORY_LIMIT`, `ROOM_EXECUTION_TIMEOUT`, `ROOM_TABLE_LIMIT` | A trusted resource failure stopped the Room or prevented it from starting |
| `ROOM_RUNTIME_ERROR` | Room execution failed; do not infer a resource limit from user error text |
| `ROOM_RESTORE_FAILED` | One Room restore attempt failed; this does not prove recovery has permanently failed |
| `ROOM_RECOVERY_FAILED` | The Room could not be recovered; distinguish this availability incident from a game-code crash |

Each `alerts[]` item includes `alert_id`, `code`, `severity`, `action`, `room_id`, `artifact_id`, `generation`, `first_at_millis`, `last_at_millis`, and `occurrences`. Repeated observations with the same Room, generation, cause, metric, scope, direction, limit and measurement window are aggregated into fixed 30-second buckets. `observed` is the peak measured value; `limit` is its threshold. `metric` describes the unit (`fuel`, `cpu_nanos`, `execution_nanos`, `memory_bytes`, `bytes`, or `none`), `scope` is `callback`, `room`, or `user`, and `direction` identifies traffic direction when relevant. Compare bytes over `window_millis`, not bytes directly with KB/s. `window_millis=0` means a callback measurement, not a sliding rate. Fuel counts instructions and is not CPU time; execution duration is elapsed time. A failed memory growth can occur while reported memory is still below its limit.

`occurrences` counts reported observations: every dropped frame is counted, while soft warnings are sampled at most once per second per source. User-scoped traffic alerts aggregate across players in the Room and do not expose player identities. An aggregate overlapping the requested start time can include occurrences just before that time. Results are newest first, retained for up to 7 days, and limited to 200 items per query. If `has_more=true`, shorten the range or filter by Room; the result is not a complete incident inventory. `delivery=best_effort` means a process failure or prolonged upload pressure can lose observations: empty results never prove health. Older events are not backfilled.

Use the returned Room and time range to query `logs <room-id>` for business context. An alert identifies a measured failure or action, not automatically the game's root cause. `404` means this alert capability is unavailable; `429` means reduce query frequency; `503` means temporarily unavailable, not an empty alert list. Never replace a failed alert query with a claim that no alerts exist.

## Query workflow

1. Locate the game project root and read the project rules, `.builda-agent/game.json`, and
   `.builda-online/installation.json`. Read only the public fields needed to confirm binding and install; do not output full file contents.
2. Confirm `.builda-online/bin/builda-online` is installed. If missing, upgrade per the current Builda Online setup; never assemble
   download links from unknown addresses.
3. If a full Room ID is already known from a client error or matchmaking result, you may filter by it. Otherwise query the current game first; do not require the user to find a Room ID. Never guess an ID or substitute a player ID, Ticket ID, or Match Key.
4. Query recent logs:

   ```bash
   ./.builda-online/bin/builda-online logs --since 30m --limit 100 --json
   ```

   Windows:

   ```powershell
   .\.builda-online\bin\builda-online.cmd logs --since 30m --limit 100 --json
   ```

   To focus on a returned Room, use `builda-online logs <room-id> --since 30m --limit 100 --json`; this retains the existing Room-specific response.

5. `--since` takes only a positive integer plus `m`, `h`, or `d`, at most `7d`; `--limit` is `1..200`. Query a short window first and widen
   only when truly needed, avoiding repeated fetches and showing large amounts of text.
6. Reconstruct the timeline by `logged_at_millis`; `sequence` is local to a Room/generation, not a global counter. Game-wide entries include `room_id`, `artifact_id`, and `generation`; correlate them with `rooms[].exit` and the per-Room drop counts. If `has_more=true` or `partial=true`, narrow the time range or query a returned Room ID before drawing conclusions. The returned totals cover only the scanned data when `partial=true`. Quote the minimum necessary log lines to the user and hide their personal data.

When needed, the query command runs Builda `check/auth`, then requests a short-lived, current-game-bound read-only diagnostics grant. The grant is used only inside the
process. On `401` log in again; `403` means the current identity, game, or read-only permission does not match. An empty game-wide query returns empty lists; it does not prove the game is healthy. For a Room-specific query, `404` means no queryable diagnostics or known Room record. For a game-wide query, `404` means the query capability is unavailable; use a known Room ID if available. `429` means the query is busy: reduce query frequency instead of polling repeatedly. `503` means the query is temporarily unavailable, not that no logs exist. Do not bypass authorization failures.

## Interpreting results

- `room_id` / `generation`: identify the Room and runtime generation of a game-wide entry; never combine different Rooms as one sequence.
- `rooms`: bounded summaries for Rooms represented in the scanned data, including drop counts and the currently known `exit`; this is not a complete history of every Room.
- `has_more`: additional matching log entries were omitted by the requested limit; narrow the time range or filter by Room.
- `partial`: a scan or summary boundary was reached; entries and drop counts must not be treated as complete for the whole window.
- `artifact_id`: the public Artifact identifier the Room actually ran (on each game-wide entry or summary, or at the top level for a Room-specific query), which can be checked against the deploy receipt; if empty, do not guess the target version.
- `entries`: recent logs in ascending order of time and the Room's stable sequence number, at most the requested `limit`.
- `dropped_events`: number of events dropped within the selected window due to rate, byte, or buffer limits. When greater than zero, the logs are not a complete transcript.
- `dropped_bytes`: bytes of message text truncated or dropped, used to judge log pressure; it does not represent business network traffic.
- `exit.status`: the Room terminal state known to the platform.
- `exit.reason_code`: a stable, sanitized exit category. It does not return user exception text or platform-internal error details.

No `exit` does not prove the Room is still running; it may simply not have reached a terminal state yet. An `exit` also does not mean the last user log is the exit
root cause. First find the last business stage by time, then combine it with the exit category and drop statistics to reach a conclusion, clearly separating facts from inferences.

## Writing logs

TypeScript Room uses:

```ts
this.log("info", `round_started round=${roundId}`)
```

Rust Room uses:

```rust
context.log("info", &format!("round_started round={round_id}"));
```

Use only `debug`, `info`, `warn`, `error`. Messages can be any UTF-8 text, but prefer stable event names and a few business identifiers,
e.g. `phase=settlement round=42`. Never log tokens, cookies, passwords, private keys, payment data, full player input, chat text, or
other unnecessary personal data.

At minimum, log at the user Room's key business boundaries: creation complete, player join result, match start, phase changes, settlement, active close, and exhausted retries
or unrecoverable errors. Keep the same event names and field names across TypeScript/Rust; when including player identifiers, log only the stable business IDs
needed for diagnosis. Do not log every successful heartbeat, tick, state broadcast, or network packet.

The trusted bounds for each online Room are: at most 2048 bytes per message, at most 20 entries per second, at most 16 KiB of text per second, and an in-memory buffer
of at most 256 KiB; queries return at most 200 entries, retained for at most 7 days. Exceeding limits only drops logs and accumulates statistics; it never blocks, traps, or closes the Room.
The local Mock uses the same limits per message, entries per second, and text per second, but local terminal output is not the same as what is saved online. Other runtime resource
bounds follow `references/resource-limits.md` in the multiplayer development Skill.

Logs still cost serialization, host calls, memory, and upload. Never log every tick, every player position, every network packet, or on each loop iteration; for high-frequency
state use phase transitions, error boundaries, periodic summaries, or sampling. Business correctness, settlement, and recovery must never depend on whether logs were written.

## Diagnostic conclusion

The final report includes: game and the returned Rooms relevant to the issue, query window and any truncation, key timeline, drop statistics, exit category, most likely cause, still-missing evidence, and the next
minimal code change or reproduction step. Do not claim you have read platform-internal logs, databases, runtime locations, clusters, or ops information.
