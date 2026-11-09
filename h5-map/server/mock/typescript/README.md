# Builda Online TypeScript Room Mock

This is an open-source, single-process local Mock with a single concurrent Room. It loads the user's TypeScript Room source directly and provides synthetic players, lifecycle, state, and message forwarding, so multiple local clients can be tested against each other.

It does not run Builda Online's production services, and does not simulate the matchmaking algorithm, Party, invites, real authentication, WebRTC/TURN, distributed recovery, capacity, or security isolation. Those capabilities must be verified online.
It executes Room source with the permissions of the current operating-system user, so only run your own or reviewed code; the local Mock is not a sandbox for untrusted code.

## Player data and payment fulfillment

This Mock provides **in-process** player data and fake order fulfillment, so `cloudEnqueue` / `cloudFlush` / `doOrder` / `fulfill` can be falsified locally.
This is not production storage, real ext-pay, slot-reservation keys, or security isolation; final online verification must still be done in the App / the official Host.

- Regular writes: `cloudEnqueue` must be followed by `cloudFlush`; before the flush, `cloudRead*` does not see the new value.
- Payment: `doOrder` yields an `OrderDeliveryResult` on a later tick; inside the `allowed` callback use only `fulfill(writes)`, and do not call `cloudEnqueue` / `cloudFlush` again.
- Calling `doOrder` again with the same `orderId` yields `already_delivered` (Host poll reports `completed`) and never grants items twice.
- A Scenario can declare `mock_economy.orders`: `[{ "orderId", "userId", "payId" }]`. When not declared, any `orderId` of the current player defaults to `payId=orderId`.
- Guests still must not write keys with the `builda.` prefix.

`/config` carries `simulates_cloud_state=true` and `simulates_ext_pay=true`, indicating local simulation, not proof of online capability.


```bash
builda-room-mock \
  --room src/room.ts \
  --source-root . \
  --sdk node_modules/@cysj/room \
  --scenario builda.room.local.json
```

After startup the Mock stays idle, and the first local Admission creates the Room. When the last human player actively leaves the Room, or the 15-second reconnect
grace period of an abnormal disconnect ends, the Mock automatically destroys the Room once the 1-second empty-Room grace period ends; Bots do not keep a Room alive. The next local Ticket creates
a new Room generation on demand, and the user Room actively calling `disconnect` remains the normal way to end the current match earlier.

By default a single process runs up to 1000 matches sequentially, still with only one concurrent Room per match. Use `--rooms N` to lower the limit; `N` must be
`1..1000`, and the process must be explicitly restarted after the limit is reached.

By default it only listens on `127.0.0.1:7350`. Clients use `local:<player-id>` as the local synthetic identity.
`--source-root` is the source root the Room entry is allowed to import from, defaulting to the entry file's directory; if the entry needs to import sibling directories,
set it to the Room source root of the user's choice; the source directory does not need to be named `server/`.

The user Room's `log` writes structured debug events to local stdout, limited the same way as online to 2 KiB per entry, 20 entries per Room per second, and
16 KiB of body text, with any excess silently dropped. Online, the same SDK entry writes to separate bounded diagnostic storage rather than platform structured logs; authors can use
the Builda Online Diagnostics Skill to query logs by Room ID, retained for up to 7 days.

When the user Room calls `disconnect(reason)`, the Mock, like online, sends
`reason=game_completed`, `error_code=ROOM_CLOSED`, and `message=Room closed normally`; this is a normal terminal state and does not additionally trigger
the client's global error event.
