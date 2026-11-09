# Player Data and Payment Fulfillment

**Player data (Player Data)** is stored per game + player (`roleId`) and persists across rooms. Function names are unchanged:
`cloudEnqueue` / `cloudRead*` / `cloudFlush` / `cloudLoadSnapshot` / `doOrder` / `fulfill`.
Report integration or semantics issues to the **player data maintainer**; do not treat them as client SDK / privateKV defects.

A Room may write keys for multiple roles, one copy per role; multiple roles being present does not mean they share one copy of player data. Read and write only inside the **Room WASM**; the four client SDKs provide no player data API, and it is not the same entry point as the client `privateKV`. The TypeScript and Rust Room APIs have different shapes;
once the Room language is chosen, implement only the corresponding column and do not mix the two SDKs.

## Capability Boundaries

| Layer | Player data | Payment |
| --- | --- | --- |
| Client SDK | None | Builda ext-pay produces an `orderId`, which is handed to the Room via a Match message |
| TypeScript Room | `cloudEnqueue` / `cloudRead*` / `cloudFlush` / `cloudLoadSnapshot` | `doOrder` / `fulfill` |
| Rust Room | `cloud_state_api` in `cloud_data_bindings` | `do_order` / `fulfill` |
| Local Mock | TS: in-process simulation; Rust: mainly `fulfill` | Fake orders + `doOrder`/`fulfill` |

The local Mock can falsify the closed loop, but does **not** stand in for production storage, ext-pay, slot reservation or isolation; full acceptance still has to happen online.

### Platform Reserved Keys (Do Not Touch)

The cross-room record of "has this order been fulfilled" is written by the platform into that player's player data, under the key `builda.order.<order number>`.
Game Rooms must **not read, write, delete or increment** any cloud variable starting with `builda.`;
such writes will fail. Do not `set` your own order key for "deduplication". In the `allowed` callback, write only your own business keys (e.g. `coins`).

## Client–Room Message Contract (Required for the Demo)

The client is responsible for ext-pay and Match communication; the Room only trusts messages on authenticated connections and does not call payment APIs directly.

1. The player initiates a Builda payment on the client and on success obtains an opaque **`orderId`** (`success` only means the payment went through). Only when that `payId`'s `grantBy` is `"room"` does the client hand the `orderId` to the Room; when `grantBy` is `"client"` (also when omitted / `""`), the client fulfills it itself, and **the Room must not grant**. See the Builda Skill for the specific API.
2. The client sends the `orderId` to the Room via `send_match_state_async` (or an equivalent method), for example:

| Message code | Direction | JSON example | Meaning |
| --- | --- | --- | --- |
| `201` | Client → Room | `{ "orderId": "<ext-pay-order-id>" }` | Request fulfillment |
| `202` | Room → Client | `{ "ok": true }` or `{ "ok": false, "reason": "rejected" }` | Fulfillment result (business-defined) |

3. The Room calls `doOrder` / `do_order` in `onMessage("201", …)`; **do not** use the player ID in the payload — the fulfillment target is always `client.userId` / `client.user_id()`.
4. The **`payId` / `pay_id`** on the `allowed` / `Allowed` result is the platform-trusted product/payment identifier; the Room uses it to decide which player data to write (e.g. how many coins to add); do not trust a product ID uploaded by the client.

Message codes `201`/`202` are only examples; the project should register them consistently across `builda.online.json`, the client and the Room.

## Payment Fulfillment Flow (Room Side)

1. Receive the `orderId` in a Match message from the client.
2. Call `doOrder(orderId, callback)` / `do_order(order_id, callback)`. The result enters the callback on a **later tick** (driven automatically by the platform; game code must not block waiting for it).
3. Grant goods only when `result.status === "allowed"` / `OrderDeliveryResult::Allowed`. `allowed` **only means fulfillment may proceed**; it does not mean the platform has Completed. Order information is on `result.order` / `Allowed(order)`.
4. **Within the same `allowed` callback**, `fulfill` for that player to write player data (e.g. increment coins). Do not use `cloudEnqueue` / `cloud_enqueue_state`.
5. **On the payment path, do not call `cloudFlush` again inside the callback**: when `doOrder` finishes, the platform waits until all writes fulfilled in this callback are `APPLIED` and then idempotently Completes.
6. Non-payment writes: a successful `cloudEnqueue` means the writes are queued; when you need to confirm this batch of writes has taken effect, call `cloudFlush` / `cloud_flush_barrier` and wait for `applied`. Existing snapshots are not refreshed automatically.
7. If fulfillment did not Complete (fulfill failed, `manual_review`), the same `orderId` can be passed to `doOrder` again to re-grant; an already Completed order yields `already_delivered`. Do not treat every non-`allowed` result as an order rejection.

This check is not a cross-Room mutual-exclusion lock; games must not rely on exactly-once. TypeScript / Rust both only look at `OrderDeliveryResult`:
`allowed | rejected | already_delivered | manual_review | unavailable | expired`.

## Error Code Ownership (Read This Before Writing verify)

| Code | Responsible party | Typical scenario | How to write acceptance |
| --- | --- | --- | --- |
| `schema-error` | **Host business rules** | `increment` on an existing non-int64 value, invalid op, objectCbor and other types the Host rejects | The Room must **catch** `CloudStateError`, record the result, and **must not** let the exception bubble up to the tick |
| `guest-abi` | **WIT/ABI encoding** | Invalid variant tag, unrecognized wire form | **Usually cannot be deliberately injected online**; verify with the local Mock or fixtures, and mark the doc "N/A online" |
| `guest-abi` (historical pitfall) | **SDK mapping** (0.14.2 and earlier) | jco throws `ComponentError` with the real code in `payload.tag`; old SDKs read only `message` and misclassified type conflicts as `guest-abi` | Fixed in Room SDK **≥ 0.14.3**; not a Host issue |

Since TypeScript Room SDK 0.14.3: `mapCloudError` reads the jco `ComponentError.payload.tag` (e.g. `{ tag: "schema-error" }`),
and no longer misreports Host type conflicts as `guest-abi`. The Host's rules for increment type conflicts need no change.

## Common Mistakes

- Writing a non-int64 value first and then `increment`ing the same key fails with `schema-error`, not `unknown_error` or `guest-abi`.
- **`schema-error` does not kill the Room**; only a `CloudStateError` that the Guest leaves **uncaught** in a tick/flush callback triggers
  `ROOM_RUNTIME_ERROR` and closes the room.
- ABI/encoding exceptions (e.g. a wrong WIT value tag) are `guest-abi`. Decide by `CloudStateError.code`; do not catch broadly and then report everything as an unknown error.
- Online, when jco fails on a WIT enum it throws `ComponentError` with the real code in `error.payload.tag`; do not look only at `error.message`.
- Passing an int64 as `number` in the public API (the SDK tolerates it) is **not** a guest-abi probe; do not use "number posing as bigint" to verify guest-abi online.
- Ordinary writes: a successful `cloudEnqueue` means the writes are queued; when you need to confirm this batch of writes has taken effect, call `cloudFlush` and wait for `applied`. Existing snapshots are not refreshed automatically. Inside a payment callback, `cloudEnqueue` / `cloudFlush` are forbidden; use only `fulfill`.
- `already_delivered` means "already granted"; do not reply with an order rejection. When the same Room hits the same `orderId` repeatedly, the Host will not enter the
  `allowed` callback a second time; do not `increment` yourself again to "make up for it".
- Do not read or write cloud variables starting with `builda.`; those are platform reserved keys.
- Authoritative gameplay state lives only in the Room. After `applied`, **re**-running `cloudLoadSnapshot` or loading the player on a new room entry reads the new value; sessions already holding an old snapshot are not refreshed automatically.
- The delete, broad catch, chained tests in flush callbacks and per-tick enqueue flooding in Demo/verify are **not** production templates.

## Pure Player Data Writes (No Payment)

When entering a room or when gameplay needs to persist progress:

1. `cloudLoadSnapshot(roleId, cb)` / `cloud_get_snapshot` + poll, to load the player's current cut.
2. During gameplay, modify with `cloudEnqueue` (handed to the Host to save in the background).
3. Only when you need to confirm this batch of writes has taken effect, `cloudFlush` and wait for `applied`; otherwise there is no need to flush "so that it gets saved". Existing snapshots are not refreshed automatically.
4. Verify with `cloudReadCurrent` or another `cloudLoadSnapshot`.

When no schema is registered, `schemaId` / `schemaVersion` may be passed as an empty string and `0` (same as online); when there are schema constraints, they must match what is agreed on the Builda side.
`increment` on a key that does not yet exist or has been deleted starts from 0; on an existing non-int64 value it fails.

## TypeScript Room Example

### Payment Fulfillment

```typescript
const OP_REQUEST_DELIVERY = "201";
const OP_DELIVERY_RESULT = "202";

this.onMessage(OP_REQUEST_DELIVERY, (client, payload) => {
  const body = decodeJson<{ orderId?: string }>(payload);
  if (!body.orderId) return;
  this.doOrder(body.orderId, (result) => {
    if (result.status === "already_delivered") {
      this.sendToUserJson(client.userId, OP_DELIVERY_RESULT, { ok: true, already: true });
      return;
    }
    if (result.status !== "allowed") {
      this.sendToUserJson(client.userId, OP_DELIVERY_RESULT, {
        ok: false,
        reason: result.status,
      });
      return;
    }
    // Decide what to grant from the trusted payId; example: +100 coins for any payId. Do not write the builda. prefix.
    this.fulfill([
      {
        roleId: client.userId,
        key: "coins",
        operation: "increment",
        delta: 100n,
      },
    ]);
    this.sendToUserJson(client.userId, OP_DELIVERY_RESULT, { ok: true, payId: result.order.payId });
  });
});
```

### Non-payment Write + flush

```typescript
this.cloudEnqueue({
  roleId: client.userId,
  key: "score",
  operation: "set",
  value: { kind: "int64", value: 42n },
});
this.cloudFlush(10_000, (result) => {
  if (result.status === "applied") {
    this.log("info", "cloud score saved");
  }
});
```

## Rust Room Example

### Payment Fulfillment (fulfill inside the callback; do not enqueue / flush)

```rust
use cysj_room_sdk::{do_order, fulfill, OrderDeliveryResult, RoomMessage};
use cysj_room_sdk::cloud_data_bindings::builda::cloud::types::{
    CloudOperation, CloudWriteRequestV1,
};

fn on_deliver_message(context: &mut RoomContext, message: RoomMessage) {
    let Ok(body) = message.json::<DeliverRequest>() else { return };
    let role_id = message.client.user_id().to_string();
    let _ = do_order(&body.order_id, move |result| {
        let OrderDeliveryResult::Allowed(order) = result else { return };
        let _ = fulfill(&[CloudWriteRequestV1 {
            role_id: role_id.clone(),
            key: "coins".to_string(),
            operation: CloudOperation::Increment,
            value: None,
            delta: Some(100),
            schema_id: String::new(),
            schema_version: 0,
        }]);
        let _ = context.set_state(&DeliveryResult { ok: true, pay_id: order.pay_id });
    });
}
```

### Non-payment: enqueue + poll flush in on_tick

```rust
// Room state must hold pending_flush: Option<u64>
fn start_flush_after_enqueue(&mut self) {
    if let Ok(handle) = cloud_state_api::cloud_flush_barrier(10_000) {
        self.pending_flush = Some(handle.id);
    }
}

fn on_tick(&mut self, context: &mut RoomContext, _delta_ms: u32) {
    let Some(handle_id) = self.pending_flush else { return };
    match cloud_state_api::cloud_poll_flush(cloud_state_api::FlushHandleV1 { id: handle_id }) {
        cloud_state_api::FlushPollResultV1::Applied(_) => {
            self.pending_flush = None;
            let _ = context.set_state(&CloudResult { saved: true });
        }
        cloud_state_api::FlushPollResultV1::Pending => {}
        _ => self.pending_flush = None,
    }
}
```

Flow: after `cloud_enqueue_state` succeeds, call `start_flush_after_enqueue`, then poll in subsequent `on_tick` calls until `Applied`.

## Writing verify / Probes (Lessons Learned)

### schema-error Matrix (increment Type Conflicts)

- **What to test**: for bool / string / float64 / bytes, `set` first and then `increment` → `CloudStateError.code === "schema-error"`.
- **objectCbor**: the Host may return `schema-error` already at the **`set` stage** (never reaching increment); the verify step expectation must state clearly whether it is
  `set` or `increment`; do not write increment for all of them.
- **How to test**:
  - Inside the Room, handle only **one** kind at a time; an `increment` failure must be **try/catch**ed, and the code written into `results[]`.
  - **Never** chain the next item from inside a `cloudFlush` callback (set → flush → increment × N). The old pattern triggers
    `ROOM_RUNTIME_ERROR` (uncaught Guest exception) within ~1s, unrelated to schema-error.
  - Recommended: **the client sends one Match message per kind**, and the Room runs only one probe; or run them serially inside the Room but **do not start the next item inside the flush callback**.
- **SDK version**: Room SDK **≥ 0.14.3** (Skill **≥ 0.30.3**); otherwise type conflicts may be misreported as `guest-abi`.

### guest-abi (WIT/ABI)

- **N/A online**: the public TS/Rust APIs cannot inject an invalid WIT wire; SDK-tolerated paths such as `number`→int64 **should not** be expected to produce guest-abi.
- **Where to verify**: in the local Mock / unit tests, simulate `invalid variant tag for cloud-value-v1: …` or invalid tag injection;
  expect `CloudStateError.code === "guest-abi"`.
- Skill and verify must be marked "guest-abi not verified online / covered by Mock", to avoid rework.

### flush / Payment Probes

- Non-payment: when confirmation is needed, `cloudFlush` until `applied`; in a payment callback **only `fulfill`; do not enqueue / flush**. The payment order is fixed: `doOrder` → `allowed` → `fulfill`.
- Demo-only probes such as broad catch, tick-burst and delete coins are not production templates.

### Experience and Observability (Not Online Defects)

- Use a select-all-and-copy UI for long logs; when investigating online issues, prefer the **roomId**. Storage implementation details do not belong in game code.
- Client `builda publish` and Room deploy are two separate pipelines; after changing Room logic, the App must be fully exited and re-entered to avoid caching the old WASM.

## Online Acceptance Checklist

- The Room is deployed (including cloud / payment logic); Room SDK ≥ 0.14.3, Skill ≥ 0.30.3.
- Client ext-pay succeeds and the Match message reaches the Room.
- Payment: retrying `doOrder` after Complete should yield `already_delivered` (already granted).
- **schema-error**: for bool/string/float64/bytes, set then increment → `schema-error`; the Guest must catch it, and the Room must not close because of this code.
- **objectCbor**: accept the code at the step (set or increment) agreed in the docs; do not judge failure solely on "never reached increment".
- **guest-abi**: mark N/A online; Mock coverage of the invalid-tag path is enough.
- Player data: when confirmation is needed, after flushing to `applied`, **re-entering the room or re-snapshotting** reads the new value; sessions already holding an old snapshot are not refreshed automatically.
- The local Mock cannot replace final verification of cloud/payment.
