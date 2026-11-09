# Rust Room

This page is for Rust Rooms only; for general Room rules see [Room Server](development-guide-room.md). For a TypeScript Room, read
[TypeScript Room](room-typescript.md) instead.

Create a standalone `cdylib` project from the `cysj-room-sdk` template installed in the current project, depending only on the public `cysj-room-sdk`,
`serde`, and `serde_json`. The Room type implements `Default + Room`, and finally calls this once:

```rust
cysj_room_sdk::export_room!(GameRoom);
```

Implement `on_create`, `on_join`, `on_leave`, `on_message`, `on_tick`, and `on_dispose` as the game requires. The Room type must
derive `Serialize + Deserialize`; by default the SDK saves and restores the complete Room. Only override
`on_checkpoint`, `on_restore`, and `on_activated` when using a custom checkpoint format; custom restore must check `RoomSnapshot.schema_version`.

Public capabilities:

- `context.broadcast(type, &payload)` / `client.send(type, &payload)`: reliable binary broadcast and unicast; when JSON is needed, explicitly use
  `broadcast_json` / `send_json`.
- `context.broadcast_on` / `client.send_on`: binary broadcast or unicast on a chosen logical channel; the corresponding JSON convenience methods are
  `broadcast_json_on` / `send_json_on`. Online WebRTC and the standalone WSS fallback both carry the same binary gameplay frames.
- `context.set_state(&state)` / `context.patch_state(&patch)`: full state and state patch.
- `message.json::<T>()`: parse the client payload into strongly typed input.
- `context.log(level, message)`: write bounded Room logs that are visible locally and queryable online for a short period; for query, quota, privacy, and performance rules,
  read the separate `builda-online-diagnostics` Skill. Exceeding the limit only drops logs and does not affect the Room.
- `context.disconnect(reason)`: request closing the Room.
- `context.random_u64()`: use the migratable host random sequence.
- `context.unix_time_millis()`: read trusted UTC Unix milliseconds as `i64`. It is fixed within one lifecycle callback, and never goes backwards for the same Room across callbacks,
  migration, and failure recovery; use it only for event times and absolute deadlines.
- `cysj_room_sdk::do_order(order_id, callback)` / `fulfill(&[...])`: verify the ext-pay order and write the goods inside the `Allowed`
  callback; do not read or write `builda.`, and do not call `cloud_enqueue_state` / flush inside the callback. The order is in `Allowed(order)`.
  `AlreadyDelivered` means it was already granted. See [Development Guide "Server-side fulfillment of paid orders"](development-guide.md#server-side-fulfillment-of-paid-orders).
- `cysj_room_sdk::cloud_data_bindings` 's `cloud_state_api`: `cloud_enqueue_state`,
  `cloud_read_current`, `cloud_read_many_current`, `cloud_flush_barrier` + `cloud_poll_flush`,
  `cloud_get_snapshot` + `cloud_poll_snapshot`. A successful `cloud_enqueue_state` means the write is queued; when you need to confirm the batch has taken effect,
  use `cloud_flush_barrier` + poll to wait for `applied`. An existing snapshot does not refresh automatically. `role_id` must use `client.user_id()`; the client SDK does not provide
  player data APIs. The TypeScript local Mock can simulate in-process; the Rust Mock mainly covers the payment-window `fulfill`. Neither impersonates production storage.
- `RoomSnapshot::json(version, &state)` / `snapshot.decode_json()`: migration snapshot.

For complete examples in both languages see [Player Data and Payment Fulfillment](room-cloud-state-and-payment.md).

Rust Rooms likewise must never use the network, files, databases, environment variables, or any system clock. Do not add the WASI wall-clock capability; advance gameplay elapsed
time and countdowns with `on_tick(delta_ms)`, and never use Unix timestamps to advance physics simulation, generate unique IDs, or decide replayable random
outcomes. Lifecycle functions must not block or perform unbounded computation. The following commands are only for local pre-checks:

For Rooms that rematch after settlement, Rust uses the same final-leave and bounded-reclaim pattern:

```rust
#[derive(Clone, Serialize, Deserialize)]
struct GameResult {
    settlement_id: String,
    winner: String,
}

// The Room state must also contain final_result, close_deadline_ms, and close_on_next_tick,
// and players must count only network-connected humans in the close check.

/// Finish a match and start bounded reclaim; every end-of-game path calls this.
fn finish_game(&mut self, context: &mut RoomContext, result: &GameResult) {
    if self.phase == Phase::Finished {
        return;
    }
    self.phase = Phase::Finished;
    self.final_result = Some(result.clone());
    self.close_deadline_ms = 5_000;
    context.set_state(self).expect("final state must be serializable");
    context.broadcast("199", result).expect("settlement must be serializable");
}

/// Remove the human after the final leave; register the follow-up close only after everyone has left.
fn on_leave(&mut self, context: &mut RoomContext, client: RoomClient, _reason: &str) {
    self.players.remove(&client.session_id);
    if self.phase == Phase::Finished && self.players.is_empty() {
        self.close_on_next_tick = true;
    }
    context.set_state(self).expect("leave state must be serializable");
}

/// Handle close first, then the settlement fallback, and only then advance gameplay still in progress.
fn on_tick(&mut self, context: &mut RoomContext, delta_ms: u32) {
    if self.close_on_next_tick {
        self.close_on_next_tick = false;
        context.disconnect("game_completed");
        return;
    }
    if self.phase == Phase::Finished {
        self.close_deadline_ms = self.close_deadline_ms.saturating_sub(delta_ms);
        if self.close_deadline_ms == 0 {
            self.close_on_next_tick = true;
        }
        return;
    }
    self.advance_game(context, delta_ms);
}
```

`close_on_next_tick`, `close_deadline_ms`, and the settlement state must migrate with the Room snapshot, so that a migration between settlement and close does not
leave a permanent `finished` Room behind. After receiving the settlement, the client must immediately leave the Room on its own; do not treat the Room's fallback close as the normal leave flow.

```powershell
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
```

For an online release, upload the complete Workspace source package containing `Cargo.toml`, `Cargo.lock`, and local crates, to be compiled by
the platform. Follow [Online Deployment Workflow](deployment.md) for all deployment rules; never mistake the Builda
client draft upload command for the Room deployment command, and never call platform internal APIs yourself. Do not upload a local WASM yourself,
and do not put `target/`, `.git/`, `.cargo/`, `vendor/`, or `rust-toolchain*` into the source package; only after the build succeeds,
explicitly activate the new Match Activity.
