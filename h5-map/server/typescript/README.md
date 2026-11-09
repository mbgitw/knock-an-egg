# `@cysj/room`

This is the TypeScript Room SDK delivered to Builda Online users. It contains only the public API needed to write an
authoritative Room, and does not include matchmaking, authentication, scheduling, database or platform runtime implementations.

This package is installed as a local dependency at the fixed version in the delivery manifest; `package.json` keeps `private: true` and must not be published to the public npm registry.

`RoomContext.maxPlayers` comes from the server Activity and is the Room's maximum player count; `roster` is only the
human and bot Roster frozen at startup. With later joins in Room mode and private Room invites, the startup Roster can be smaller than `maxPlayers`.

```ts
import { Client, Room, decodeJson, defineRoom, type RoomContext } from "@cysj/room";

type State = { players: Record<string, boolean> };

class GameRoom extends Room<State> {
  constructor() {
    super();
    this.onMessage("1", (client: Client, payload) => {
      const input = decodeJson<{ ready?: boolean }>(payload);
      if (!input.ready) return;
      this.state.players[client.sessionId] = true;
      this.patchState({ players: this.state.players });
    });
  }

  /** Create the authoritative state. */
  onCreate(_context: RoomContext): void {
    this.setState({ players: {} });
  }
}

export default defineRoom(GameRoom);
```

`encodeJson(value)` and `decodeJson<T>(payload)` reuse a module-level UTF-8 encoder/decoder. `T` only provides a static type hint
and performs no runtime structure validation; fields coming from clients must still be validated by Room game code before use.

`Room<TState>` saves the full `this.state` as a JSON checkpoint by default and restores it when the run location moves or recovers from a failure.
All mutable state that affects gameplay continuity should live in `state`; ordinary Rooms do not need to implement transfer callbacks. Only override
`onCheckpoint/onRestore/onActivated` when upgrading the snapshot format or when derived objects must be rebuilt after restore; `onCheckpoint` must not send messages or modify
Host state. Run location selection, route switching and client reconnect are handled by the platform.

Online, the platform compiles Room code into a restricted WASM Component. Locally you can use the open-source
`@cysj/room-mock` from the delivery package to load the same TypeScript source directly and run multiple clients for integration testing; the Mock is not the production Runtime and
does not simulate the matchmaking algorithm, Party, invites, WebRTC/TURN, distributed recovery or security isolation.

Whether a public Room accepts new players is controlled by user Room code; clients cannot override this state:

```ts
this.lockRoom();    // After the match starts, remove from public matchmaking and Room invites
this.releaseRoom(); // Allow joining again after a match ends
```

The platform validates the current Room generation and Activity. Only public Rooms with `mode=room` can toggle this; Pool/RankPool
Rooms are always locked. When a Room has no human players, the platform cleans it up automatically after a bounded empty-Room retention window.

`broadcast` and `Client.send` use the reliable gameplay channel by default; to send control events or droppable snapshots, use
`broadcastOn` / `Client.sendOn` and pass `control-reliable`, `game-reliable` or
`state-unreliable`.

A Room can also use `this.sendToUser` / `this.sendToUserOn` to send to a stable `userId`; the platform automatically resolves that user's current
active connection, so the user Room does not need to maintain a `userId -> sessionId` mapping after reconnect. For JSON, use the matching
`sendToUserJson` / `sendToUserJsonOn` convenience methods.

`this.log(level, message)` prints bounded debug logs in the local `@cysj/room-mock`; online it goes to short-lived
Room logs isolated to the current game. Online, each Room allows at most 2048 bytes per entry, at most 20 entries and 16 KiB of body per second, and at most 256 KiB of in-memory buffer;
anything over the limit is only dropped and counted, without affecting the Room. Query by Room ID with the separate Builda Online Diagnostics Skill;
logs are kept for at most 7 days. Logs must not contain credentials or unnecessary personal data, and game state and correctness must not depend on logs.

`this.unixTimeMillis()` returns UTC Unix milliseconds sampled by the trusted host as a `bigint`. Multiple reads within one lifecycle callback return the same value,
and within the same Room it never goes backwards across callbacks, migration and failure recovery, making it suitable for recording event times and storing absolute deadlines. Elapsed gameplay time and countdowns
should still advance with `onTick(deltaMs)`; do not use the timestamp to advance physics simulation, generate unique IDs or decide replayable random outcomes, and do not use
`Date.now()` directly.

`this.doOrder(orderId, callback)` verifies an order the player has already paid for. The callback receives a single `OrderDeliveryResult`:
`allowed` carries the trusted `order.orderId + order.payId` and only means the order may be fulfilled, not that it is Complete.
The other terminal states are `rejected | already_delivered | manual_review | unavailable | expired`.
Only call `this.fulfill([{ roleId, key, operation, ... }])` inside `allowed` to write goods; do not read or write cloud variables starting with `builda.`,
and do not call `cloudEnqueue` or `cloudFlush` in the callback. Cross-Room deduplication is reserved by the platform; do not set order keys yourself.
The platform idempotently marks the order fulfilled only after all writes produced by the callback are `APPLIED`; if they are not APPLIED it will not Complete, and the same `orderId` can be passed to
`doOrder` again to re-grant. `already_delivered` means it was already granted; do not treat it as a rejection. The local source Mock provides in-process fake orders and `fulfill` (see the Mock README); it does not replace final online verification.

Player data is only read and written inside the Room; the client SDK provides no player data API. TypeScript Rooms use
`this.cloudEnqueue(...)` to queue writes, `this.cloudReadCurrent(...)` / `this.cloudReadManyCurrent(...)` to read current values,
`this.cloudFlush(deadlineMs, callback)` to wait for `applied` when you need to confirm the batch has taken effect, and `this.cloudLoadSnapshot(roleId, callback)` to read a role snapshot.
`roleId` must be the current player's `client.userId`; do not trust player identifiers in client messages. A successful `cloudEnqueue` means the write is queued; to confirm that the batch has taken effect, call `cloudFlush` and wait for `applied`. Existing snapshots are not refreshed automatically. `cloudReadCurrent` only contains values that have taken effect. Flush and snapshot results are returned via callback
on a later tick. Failures throw `CloudStateError` with a kebab-case `code` (such as `schema-error`, `capability-unavailable`);
online, jco wraps WIT enum errors in a `ComponentError` with `payload.tag`, which the SDK reads structurally. ABI/encoding errors are
`guest-abi` and no longer bubble up as unwrapped exceptions. The TypeScript local source Mock provides in-process player data; it does not replace final online verification.

For the full runtime, checkpoint, Host output and source package limits, read the installed
`.agents/skills/builda-online/references/resource-limits.md`.

When gameplay produces a final settlement and the Room will not be reused, first broadcast the settlement and save the final state; clients leave the Room actively as soon as they receive the settlement, and the Room
calls `this.disconnect("game_completed")` on a later tick after every human player's final `onLeave`, keeping a bounded tick-based
timeout as a fallback. Only changing the game phase to `finished` does not close the platform Room or release capacity.
