# Local Room Mock Workflow

Use this workflow when the user asks to "run the Room locally, debug Room inputs, or connect multiple local clients to each other". Install only the open-source Mock for the current Room language: TypeScript uses `@cysj/room-mock`, Rust uses `cysj-room-mock`. Both run only the user's own Room source and do not need Docker, platform source, platform storage or scheduling components, Kubernetes, or online login.

When the user asks for local testing, start only the current-language Room Mock locked by the manifest. TypeScript uses Node, Rust uses
Cargo; never read the platform repository, call remote build services, or upload source, and do not install the other Room language's toolchain as a workaround.
WASM build/check is a separate preflight, not a prerequisite for starting the local Mock. Do not manually restart the Mock for every match; use the same process to
verify automatic reclamation of empty Rooms and the new Room generation created by the next Admission.

Before starting local testing, there must already be a confirmed multiplayer plan, and the AI must have synced the project-root `builda.online.json`, the current-language Room source, and
the selected client. The confirmation must cover multiple `matchKey`s and each Match's public auto-matchmaking strategy. The Scenario extracts from these three the final Room inputs that can be expressed
locally; never use the Scenario to decide the gameplay for the user in reverse, and never
skip real server logic just because the Mock can start. When config, Room, and client are found to be inconsistent, fix the project files first, then test.

The Room source directory is decided by the user's project and is not required to be named `server/` or `room/`. The AI should keep the existing directory; a new project may choose
`server/` as the recommended directory, but do not force the user to move files because of an example path. The TypeScript Mock's `--room` points to the entry file, and
`--source-root` points to the source root that the Room entry may import from relatively; the entry must be inside the source root, imports must not go beyond that root, and must not import
third-party or platform-internal packages other than the public SDK. The Rust Mock runs from the Cargo Workspace the user chose, and the `local` binary may
live in any canonical package in that Workspace.

The local Mock keeps at most one concurrent Room per process; it is idle at startup, and the first local Admission creates the Room. Ticket reservations and
abnormal disconnects are each held for 15 seconds; once there are no human reservations, no one online, and no one in a reconnect grace period, the Room is automatically destroyed after a further 1-second empty-Room grace, and Bots do not keep the
Room alive. The next Admission creates a new Room generation, so the AI does not need to manually restart the process for each match. The Mock provides synthetic identities,
Scenario/Roster/teams/bots, the `create/join/message/tick/disconnect/reconnect/leave/dispose` lifecycle, state, messages, and
a loopback WebSocket. Clients use `local:<player-id>`, and both the Room and Pool entries immediately point to the current single Room, so this cannot be used to
judge that platform matchmaking is correct.

The local Mock contains no platform production logic and does not simulate the Match algorithm, real authentication, Gateway, WebRTC/TURN, platform storage and scheduling, cross-instance recovery, capacity, performance, or security isolation. The TypeScript Mock provides in-process player data and fake orders/`fulfill`; the Rust Mock provides fake orders and a `fulfill` buffer. This is only for local falsification and does not replace online final verification; for the flow, see [Player Data and Payment Fulfillment](room-cloud-state-and-payment.md).
It executes Room source with the permissions of the current operating system user; run only the user's own or reviewed code, and do not treat it as a sandbox for untrusted code.

## 1. Define the Scenario

Create `builda.room.local.json` in the project root or the current Room test directory, and point to it with `--scenario` when starting the Mock:

```json
{
  "schema_version": 1,
  "room": {
    "room_id": "local-room",
    "room_name": "local-room",
    "game_id": "local-game",
    "tick_rate": 20,
    "max_players": 4,
    "match_key": "local",
    "room_origin": "public_match",
    "match_mode": "room",
    "room_type": "default"
  },
  "actors": [
    { "player_id": "player-a", "seat_id": "seat-a", "team_id": "red" },
    { "player_id": "player-b", "seat_id": "seat-b", "team_id": "blue" }
  ],
  "bots": [
    { "bot_id": "bot-1", "seat_id": "bot-seat-1", "team_id": "red" }
  ],
  "launch_context": { "map": "forest" },
  "mock_economy": {
    "orders": [
      { "orderId": "ord-1", "userId": "player-a", "payId": "gold_pickaxe" }
    ]
  }
}
```

`mock_economy.orders` is optional: it pre-seeds fake orders for the TypeScript / Rust Mock (`userId` corresponds to the Scenario's `player_id`). When not declared, any `orderId` for the current player defaults to `payId=orderId`.

The Scenario expresses only the final input passed to the user's Room, not the intermediate process of platform matchmaking.
It must cover the Team, human/bot Roster, and non-secret launch parameters that the confirmed plan will pass to the Room. A CF looping room must cover locking, settlement
reset, and re-release; a shadow room must cover mid-session joins/leaves; a Pool must cover single-match settlement and bounded close.

## 2. Start the Mock for the Current Language

TypeScript projects use only the Node toolchain:

```bash
builda-room-mock \
  --room <entry .ts inside the Room source root> \
  --source-root <Room source root> \
  --sdk <@cysj/room directory installed in the project> \
  --scenario <path to builda.room.local.json>
```

Rust projects use only Cargo; the project's `local` binary registers the current Room type:

```bash
cargo run --manifest-path <Room Workspace/Cargo.toml> --features local-mock --bin local -- --scenario <path to builda.room.local.json>
```

Both Mocks listen only on `127.0.0.1:7350` by default; the health check is `http://127.0.0.1:7350/health`, and the client Gateway is `ws://127.0.0.1:7350/ws`. Never bind a public address or pass an online token to the Mock.

## 3. User Room Behavior to Verify

1. Two different `local:<player-id>` clients can join the same Room;
2. The Scenario's human, team, bot, and launch parameters enter the public `RoomContext`;
3. `onCreate/onJoin/onMessage/onTick/onDisconnect/onReconnect/onLeave/onDispose` execute as expected;
4. The client-observable results of `setState/patchState/broadcast/send` conform to the public contract;
5. Active leave, abnormal disconnect, Room-initiated close, and invalid input have clear outcomes;
6. `/health` shows `lifecycle=idle` and `active_rooms=0` before the first Ticket, and returns to that state after the last human occupancy disappears and the empty-Room grace
   has passed; the `room_generation` of the next Admission must increment.

If players return to the lobby and rematch after settlement, you must also record and assert the following order: the client receives and saves the final settlement, automatically leaves actively,
the Room receives the final `onLeave`, a later tick requests close, and finally `onDispose` fires. Also cover the fallback where a bounded countdown
eventually reclaims the Room when a client has not left. The Room staying in `finished` forever, or `onDispose` firing before the client has observed the settlement message, both count as failures.
The local Mock does not simulate platform Match role occupancy, so local results cannot be used to claim that a second online matchmaking has passed.

A local pass only shows that the current Room business code behaves correctly under the public Mock contract; it does not show that the online platform's internal implementation, WASM ABI, WebRTC, TURN, recovery, capacity, or isolation have passed.

## 4. Run the Online Build Preflight Separately

Fast local integration and WASM build checks are two separate things. When you need to check online build compatibility, TypeScript runs only the project-locked TypeScript Room build/check; only Rust runs `cargo build --target wasm32-wasip2 --release`. Local artifacts are not uploaded; online deployment still uploads source, and the platform rebuilds it.
