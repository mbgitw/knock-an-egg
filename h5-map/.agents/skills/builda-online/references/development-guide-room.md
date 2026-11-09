# Room Server

Any change involving the Room lifecycle (create, join, leave, close, reconnect, migration recovery) or matchmaking (Ticket, Pool/RankPool, Confirm, private Room join) must read the full [End-to-End Lifecycle and Room Protocol](client-lifecycle.md); changes only to gameplay rules, message content, or resource budgets may skip it.

Read this page only during the Room-writing stage, with the confirmed multiplayer plan and the shared message protocol in the [Development Guide](development-guide.md) as prerequisites.
Then, according to the chosen language, read only one of [TypeScript Room](room-typescript.md) or [Rust Room](room-rust.md), and read
[Room Resource Limits](resource-limits.md).

## General Rules

`RoomContext.maxPlayers` (`max_players` in Rust) is the maximum player count frozen by the Activity, and `roster` is the
humans and bots already assigned at startup. The two may differ; bots only provide a `botId`, so do not fake a user, Session, or network connection for a bot.

`client.userId` (`client.user_id` in Rust) is this player's `roleId` on Builda, identical to `client.roleId`, and also matches
the client `session.userId`, `roster` members, and the `userId` in Presence events. Room state, cross-match data, and
`sendToUser` are all keyed by it; `client.sessionId` represents only the current connection, changes after a reconnect, and is used only to distinguish connections.

Room source must correspond to the confirmed product model; do not just copy the minimal example:

- CF looping room: call `releaseRoom/release_room` during the waiting phase, call `lockRoom/lock_room` before a round starts, and release again only after settling and resetting all
  round state; the lock state and the round phase go into the migration snapshot.
- MMORPG/shadow room: handle players joining mid-session, leaving, and reconnecting over the long term, and do not kick players on your own when at capacity; do not destroy the Room after a single local event.
- Pool: one Room per match, all authoritative settlement paths converge on the same idempotent end method, and the Room closes within a bounded time after clients actively leave;
  never release it as a joinable Room.
- All modes: the Room must at least validate the Seat corresponding to the identity, as well as message size, rate, and format; other data is handled according to the trust model the author
  confirmed. If data affecting win/loss, rewards, scores, economy, leaderboards, or later unlocks is decided by the client or purely relayed, the tamper risk must be stated in the plan and the delivery
  notes, and it must not be described as anti-cheat or a strong fairness model. Bots advance under the same confirmed rules and do not fake client connections.

## Room Implementation Checklist

TypeScript imports only from `@cysj/room`; Rust uses only `cysj-room-sdk` and allowed dependencies. The Room does not listen on ports, and does not access the network,
files, databases, environment variables, or any system clock, and does not use `Math.random()` or `Date.now()`. When an event time or an absolute deadline is needed,
TypeScript uses `this.unixTimeMillis()` and Rust uses `context.unix_time_millis()`; the trusted Unix milliseconds are fixed within a single
lifecycle callback and never go backwards across callbacks, migration, and recovery of the same Room. Elapsed gameplay time is still advanced only by `onTick(deltaMs)` /
`on_tick(delta_ms)`; timestamps must not be used to advance physics simulation, generate unique IDs, or decide replayable random results. Loops must be bounded, and
a tick must not block.

Do not generate a placeholder Room that "starts but has no gameplay". You must write the Room rules from the plan confirmation into the current language's source: which client
messages are input, candidate state, or state to relay; how the Room handles them according to the author-confirmed trust model; which state must be saved and restored; when
to start and end; how Team/Roster info is used in gameplay; how Bots are driven by the same code; and how disconnects and final leaves are handled. A CF looping room must have Room source control lock/release; a shadow room must handle long-term
mid-session joins and leaves; a Pool must run only one match and close within a bounded time after settlement.

Before implementing state sync and Host output, you must check, per the [Payload Optimization Guide](payload-optimization.md), the worst-case single message size, per-second rate,
actual receiver count, and slow-client/packet-loss behavior. Large messages may only be chunked within the single-frame size the protocol allows, with caps on total reassembly size, chunk count, and
timeout; chunking must not be used to bypass the single-frame or total output budget.

TypeScript must put all Room state that needs recovery into `this.state`, and a Rust Room must derive `Serialize + Deserialize`; the SDK
generates a full checkpoint by default. Write players, phase, scores, timers, settlement idempotency IDs, Room lock state, and delayed-close state item by item into
`builda.online.json#roomTransfer.authoritativeState`. Ordinary Rooms do not implement transfer orchestration; only when the state format is upgraded or derived objects must be rebuilt after recovery
should you override `onCheckpoint/onRestore/onActivated` (snake_case in Rust). Random numbers use the migratable random sequence provided by the
host. Run location, routing, and client connections are all managed by the platform, and Room code does not touch these capabilities.

The platform currently only observes regular CPU, fuel, and outbound byte budgets for online alerts, and does not close the Room for crossing these observation thresholds. The sandbox still keeps
extreme protection against runaway callbacks occupying an execution thread for a long time, and structural limits such as memory, message size, Host command count, and output size still reject or
terminate out-of-bounds execution. For specific values and results when exceeded, always read [Room Resource Limits](resource-limits.md). Waiting, empty Room, lobby,
settlement display, and not-yet-started phases must be event-driven or use low-frequency sync:

- Empty Rooms and waiting lobbies must not scan the full map, pathfind, run collision, AI, or leaderboards every tick; handle only state changes such as joining, leaving, ready, and countdown.
- Snapshots and state broadcasts should prefer being event-driven; when a heartbeat-style display is needed, keep it at or below 4Hz, send only summaries or deltas, and do not broadcast the full state every tick.
- Use high-frequency sync only in the playing phase, and the loop cap per tick must be bounded by player count, object count, or a fixed budget.
- A TypeScript Room is better suited to default integration and lightweight authoritative logic; for complex physics, pathfinding, full simulation, or large-scale object sync, lower the tick/snapshot rate, or confirm with the user to switch to the higher-performance Rust Room.
- Receiving `ROOM_RESOURCE_BUDGET_EXCEEDED` means the sandbox's extreme protection was triggered; first check for unbounded loops, abnormally concentrated Host calls,
  heavy allocation, and message storms, and do not display it as a matchmaking timeout.

Every Room must have a clear party responsible for ending it and a termination path:

- In Room mode, if the next round continues in the same Room, do not close the Room; the Room is locked at round start and is released only after settlement completes and authoritative state is reset,
  and the client must not start Pool matchmaking again.
- A Pool Room is permanently locked and runs only one match; after settlement it must be destroyed, and it can neither be released nor accept new players.
- If players return to the lobby and rematch after settlement, the Room must first save the final state, broadcast the final result with a stable settlement ID, and start a bounded close
  countdown, but must not close immediately. After receiving the settlement, the client first saves the data needed by the settlement screen, then immediately `await`s the selected SDK's leave method;
  it must not wait for the user to click "Back" before leaving, and must not close the Peer directly. Only a successful SDK return means the platform has released the role and the
  rematch entry can be opened; a timeout or failure must be clearly reported and must be prevented from being misreported as success.
- The Room removes humans who have left in the final `onLeave`; after all humans have finally left, set a one-time close flag, and in a later `onTick`
  call TypeScript `this.disconnect("game_completed")` or Rust
  `context.disconnect("game_completed")`. While some clients have not finished leaving, use a bounded countdown decremented by Room ticks as a fallback
  close, to avoid occupying capacity forever. The close flag, the countdown, and the settlement state must go into the migration snapshot.
- Never close the Room in the same callback that produces the final broadcast, and never only set `phase = "finished"`; the former may lose the settlement message,
  and the latter keeps occupying the Room, Seats, and capacity.

Check that every game-end branch converges on the same idempotent end method, so that the final settlement is sent only once, the client's active leave is initiated only once,
Room close is registered only once, and `disconnect` executes only once. For concrete TypeScript/Rust patterns, see
[TypeScript Room](room-typescript.md) or [Rust Room](room-rust.md).

For resource warnings, dropped traffic, or Room failures, start with `builda-online alerts --since 30m --json`; add `--room-id <room-id>` to focus on a returned Room. Alerts are separate from user logs, aggregated, and best effort; empty results do not prove health. For detailed online diagnosis, use the diagnostics Skill to run `builda-online logs --since 30m --json` for the current game. A Room ID is optional; use a returned Room ID to narrow the query. Check `partial` and `has_more` before treating results as complete.
