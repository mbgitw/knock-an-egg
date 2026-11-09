# TypeScript Room

This page is read only for TypeScript Rooms; for general Room rules see [Room server](development-guide-room.md). For Rust Rooms read
[Rust Room](room-rust.md) instead.

Import public APIs only from `@cysj/room`. If the editor reports that the module cannot be found, check whether the user-provided TypeScript SDK has been wired in through
the project's `package.json` or `tsconfig.json`; do not fake local type declarations, and do not copy platform-internal code.
Locally, use the project's existing TypeScript type check, and `@cysj/room-mock` loads the same `.ts` Room source and the public
SDK directly; the Mock does not generate, read, or execute a local `room.wasm`. WASM build/check is only an optional standalone build pre-check, not a prerequisite for starting the Mock;
the TypeScript option does not need Cargo, nor does it need a generated Rust Workspace or the `wasm32-wasip2` target installed.
At release you still submit the `.ts` source per the [online deployment workflow](deployment.md), and the platform rebuilds it independently. Never rewrite a TypeScript
Room into a Rust Workspace, and never upload locally precompiled WASM.

```ts
import { Client, Room, defineRoom, type RoomContext } from "@cysj/room";

type GameState = {
  started: boolean;
  players: Record<string, { ready: boolean }>;
};

class GameRoom extends Room<GameState> {
  /** Register message handlers; new instances restored after migration also run the constructor. */
  constructor() {
    super();
    this.onMessage("1", (client: Client, payload: unknown) => {
      const ready = Boolean((payload as { ready?: boolean }).ready);
      this.state.players[client.sessionId] = { ready };
      this.state.started = Object.values(this.state.players).length >= 2
        && Object.values(this.state.players).every((player) => player.ready);
      this.patchState({
        started: this.state.started,
        players: this.state.players,
      });
      if (this.state.started) {
        this.broadcast("101", { started: true });
      }
    });
  }

  /** Create the complete authoritative state. */
  onCreate(_context: RoomContext): void {
    this.setState({ started: false, players: {} });
  }

  /** Register a player the platform has already authenticated. */
  onJoin(client: Client): void {
    this.state.players[client.sessionId] = { ready: false };
    this.setState(this.state);
  }

  /** Remove a player who has finally left. */
  onLeave(client: Client): void {
    delete this.state.players[client.sessionId];
    this.setState(this.state);
  }

  /** Advance a lightweight authoritative simulation at a fixed step. */
  onTick(_deltaMs: number): void {}
}

export default defineRoom(GameRoom);
```

Public capabilities:

- `this.onMessage(type, handler)`: register messages in the constructor.
- `this.setState(state)`: replace and broadcast the complete authoritative state.
- `this.patchState(patch)`: broadcast a patch; you must update `this.state` accordingly before calling it.
- `this.broadcast(type, payload)`: reliably broadcast a binary payload; when JSON is needed, explicitly use `broadcastJson`.
- `client.send(type, payload)`: reliably unicast a binary payload; when JSON is needed, explicitly use `sendJson`.
- `this.broadcastOn` / `client.sendOn`: binary broadcast or unicast on a chosen logical channel; the corresponding JSON convenience methods are
  `broadcastJsonOn` / `sendJsonOn`. Online WebRTC and the standalone WSS fallback both carry the same binary gameplay frames.
- `this.log(level, message)`: write bounded Room logs that are visible locally and queryable online for a short time; for query, quota, privacy, and performance rules,
  read the separate `builda-online-diagnostics` Skill. Over the limit only logs are dropped; never rely on logs to carry business state.
- `this.disconnect(reason)`: request that the Room be closed.

A close initiated by the user Room is delivered as a normal terminal state both online and in the local Mock: public `reason=game_completed`,
`error_code=ROOM_CLOSED`, and it does not additionally trigger a client global error event. It is still recommended to pass a stable `game_completed` so local business code
and debug logs stay consistent; custom text does not become a platform error category.
- `this.random()`, `this.randomInt(min, maxExclusive)`, `this.randomUint64()`: use the migratable host random sequence.
- `this.unixTimeMillis()`: read trusted UTC Unix milliseconds as a `bigint`. It is fixed within one lifecycle callback, and within the same Room it does not go backward across callbacks,
  migration, or failure recovery; use it only for event times and absolute deadlines.
- `this.doOrder(orderId, callback)` / `this.fulfill(writes)`: verify an ext-pay order and write the goods inside the `allowed` callback;
  do not read or write `builda.`, and do not call `cloudEnqueue` / `cloudFlush` in the callback. `allowed` only means the item may be granted; the order is in
  `result.order`. `already_delivered` means it was already granted. See [Development guide "Server-side fulfillment of paid orders"](development-guide.md#server-side-fulfillment-of-paid-orders) for details.
- `this.cloudEnqueue(...)`: enqueue cloud variable set/increment/delete; on failure it throws `CloudStateError`. A type conflict is
  `schema-error` (Host rule; SDK ≥ 0.14.3 maps it correctly from jco `payload.tag`), and a WIT/ABI exception is `guest-abi`
  (usually impossible to inject deliberately online; see the responsibility table in the reference). **You must catch it inside the Room**; an uncaught exception closes the Room on the tick.
  `this.cloudReadCurrent` / `this.cloudReadManyCurrent` read current values; `this.cloudFlush(deadlineMs, callback)`
  A successful `cloudEnqueue` means the write is queued; when you need to confirm this batch of writes has taken effect, call `cloudFlush` and wait for `applied`. Existing snapshots are not refreshed automatically.
  `this.cloudLoadSnapshot(roleId, callback)` reads a role snapshot. `roleId` must use `client.userId`;
  the client SDK does not provide a player data API. The TypeScript local Mock can simulate in process; the Rust Mock mainly covers `fulfill` in the payment window. Neither passes itself off as production storage.

For complete examples in both languages, how to write verify probes, and the final acceptance checklist, see [Player data and payment fulfillment](room-cloud-state-and-payment.md).

The platform sets `this.context` before calling `onCreate` and `onRestore`; other lifecycle methods can read it directly. Host random numbers can be called in
all lifecycle methods such as `onCreate`, `onJoin`, and `onTick`; there is no tick-context restriction.

Never use Node.js APIs, arbitrary npm packages, network, files, databases, environment variables, `Math.random()`, `Date.now()`, or an uncontrolled
system clock. Advance gameplay elapsed time and countdowns with `onTick(deltaMs)`; never use Unix timestamps to advance physics simulation, generate unique IDs,
or decide replayable random results. Every loop must have an explicit upper bound, and `onTick` must not block or allocate without bound.

The platform currently only observes regular CPU, fuel, and outbound byte budgets as online alerts and does not close a Room for crossing these observation thresholds; the sandbox still keeps
extreme protection against runaway callbacks occupying the execution thread for long periods, and structural boundaries such as memory, message size, Host command count, and output size still reject or
terminate out-of-bounds execution. Read the specific values only from [Room resource limits](resource-limits.md). Do not run heavy logic every tick during waiting, empty-Room, and lobby phases:
respond only to events such as join, leave, ready, Room lock, release, and countdown.
Prefer event-driven snapshots and state broadcasts; when periodic display is truly needed, keep it at no more than 4Hz and send only summaries or deltas. Use high-frequency sync only in the
playing phase, and every per-tick loop must be bounded by player count, object count, or a fixed upper limit. Complex physics, pathfinding,
large-scale object simulation, or full-state broadcasts should still lower the tick/snapshot frequency, or first confirm with the user to switch to a Rust Room.

When gameplay has produced an irreversible final settlement and the Room will not be reused, you must first broadcast the final result and save state, then wait for clients to receive the settlement and
actively leave the Room. Put the close flag and a bounded fallback countdown into migratable state; after every human player has triggered the final `onLeave`, close on a subsequent tick.
`settlementId` must be determined by authoritative state such as the existing `roundId` and a monotonic settlement sequence number; it must not use system time. The fields and methods below should
be mapped to the current gameplay; in this close check, `players` counts only network-connected human players, and bot gameplay state should be stored separately:

```ts
type GameResult = {
  settlementId: string;
  winner: string;
};

type LifecycleState = {
  phase: "playing" | "finished";
  players: Record<string, { ready: boolean }>;
  finalResult: GameResult | null;
  closeDeadlineMs: number;
  closeOnNextTick: boolean;
};

/** Finish a match and start bounded reclamation; every win/loss, surrender, and timeout path calls this. */
private finishGame(result: GameResult): void {
  if (this.state.phase === "finished") return;
  this.state.phase = "finished";
  this.state.finalResult = result;
  this.state.closeDeadlineMs = 5_000;
  this.setState(this.state);
  this.broadcast("199", result);
}

/** Remove human players after their final Room leave; register the deferred close only after everyone has left. */
onLeave(client: Client): void {
  delete this.state.players[client.sessionId];
  if (this.state.phase === "finished" && Object.keys(this.state.players).length === 0) {
    this.state.closeOnNextTick = true;
  }
  this.setState(this.state);
}

/** Handle close first, then the settlement fallback, and only then advance gameplay still in progress. */
onTick(deltaMs: number): void {
  if (this.state.closeOnNextTick) {
    this.state.closeOnNextTick = false;
    this.disconnect("game_completed");
    return;
  }
  if (this.state.phase === "finished") {
    this.state.closeDeadlineMs = Math.max(0, this.state.closeDeadlineMs - deltaMs);
    if (this.state.closeDeadlineMs === 0) this.state.closeOnNextTick = true;
    return;
  }
  this.advanceGame(deltaMs);
}
```

After receiving message `199`, the client must first save the result, then automatically wait for the public SDK's active Room leave to succeed, and only then open the next matchmaking.
The close check must be at the start of `onTick`; never only set `phase = "finished"`, and never call `disconnect` in the same callback
that broadcasts the final message.

By default the SDK writes the complete `this.state` into the checkpoint as JSON, and the platform restores it. The gameplay's players, phase, score,
timers, settlement idempotency ID, and deferred close flag must all be placed in `state` and listed in `builda.online.json#roomTransfer.authoritativeState`.
Override `onCheckpoint`, `onRestore`, and `onActivated` only when the state format is upgraded or non-serializable derived objects need to be rebuilt after
restore. `onCheckpoint` must not send messages or modify Host state; switching of run location, routing, and client connections is always done by the platform.
Host random state is saved independently by the platform; do not generate random seeds yourself.
