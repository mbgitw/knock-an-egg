# Changelog

## 0.14.11

- Code comments, the README and the changelog are now in English; no API or behavior changes.

## 0.14.10

- Cloud State writes use the bit-pattern host channel so negative int64, float64 and increment deltas no longer trap the Room

## 0.14.9

- docs: rename the package README heading to Player Data

## 0.14.8

- docs: developer docs consistently say player data, keeping function names such as cloudEnqueue

## 0.14.7

- docs: enqueue means queued; flush waits for applied, meaning the writes have taken effect

## 0.14.6

- docs: flush waits for Host APPLIED, which does not mean the data was written back to storage

## 0.14.5

- docs: enqueue hands writes to the Host for background saving; flush is only for confirming APPLIED

## 0.14.4

- Align the Room payment public surface with the local Mock Cloud/fake payment simulation

## Unreleased

- Add `fulfill(writes)`; `cloudEnqueue` / `cloudFlush` are forbidden inside payment callbacks; the Guest must not write the `builda.` prefix
- The `doOrder` callback only receives `OrderDeliveryResult`; `allowed` carries `order`; Host `completed` maps to `already_delivered`

## 0.14.3

- Fix mapping of jco ComponentError enum payloads to schema-error

## 0.14.2

- Unify CloudStateError on kebab-case codes with ABI errors mapped to guest-abi; doOrder tolerates extended outcomes

## 0.14.1

- Fix CloudValueV1 to use WIT kebab-case tags so online jco no longer rejects int64Value

## 0.14.0

- Add the public TypeScript Room cloud variable API

## 0.13.0

- Narrow doOrder to two interfaces: read-only Query and idempotent Complete; trusted orders only expose orderId and payId.
- Clarify that delivered=false is not a cross-Room exclusive claim; game logic must not rely on exactly-once.

## 0.12.0

- Add secure doOrder order fulfillment and trusted product context

## 0.11.1

- Complete the Host capability and compatibility gate for user-targeted sends

## 0.11.0

- Add an API to send binary messages to a specific User ID.

## 0.10.0

- Add a trusted unixTimeMillis API that never goes backwards across callbacks and recovery

## 0.9.1

- Local Mock aligns any author-initiated close to the normal ROOM_CLOSED terminal state

## 0.9.0

- Add public encodeJson/decodeJson APIs that reuse a module-level UTF-8 encoder/decoder.

## 0.8.1

- README adds a single entry point for runtime, message, log, source package and configuration count limits.

## 0.8.0

- Upgrade the WIT ABI to `cysj:room@0.10.0`; online, `log` is now collected per Room with bounds and supports short-term author queries; exceeding limits only drops logs without affecting the Room.

## 0.7.0

- `broadcast/send/onMessage` use `Uint8Array` by default; JSON moves to the explicitly named `broadcastJson/sendJson` convenience APIs.

## 0.6.0

- Upgrade the WIT ABI to `cysj:room@0.9.0`; the Room transfer lifecycle is narrowed to `onCheckpoint/onRestore/onActivated`, and the default checkpoint automatically saves the full JSON state.

## 0.5.0

- Upgrade the WIT ABI to `cysj:room@0.8.0`; `RoomContext.entryKind` adds `private`.
- The Room Host uses `lockRoom` and `releaseRoom` to control admission to public Rooms; the Backfill command is no longer provided.

## 0.4.0

- `log` only prints debug output in the local source Mock; the online adapter silently drops it inside the component and no longer calls the platform Host or writes platform logs.
- Upgrade the WIT ABI to `cysj:room@0.7.0`, removing the online Host `log` capability.

## 0.3.0

- Expose an injectable `RoomHost` so the source Mock and the online WIT Host share the same Room API.
- Room source runs locally directly in the TypeScript Mock, no longer depending on the native Local Runner.

## 0.2.0

- Upgrade the WIT ABI to `cysj:room@0.6.0`.
- `RoomContext` adds `maxPlayers`, frozen by the server Activity.
- Roster supports platform bot seats; bots carry no user identity or client connection.

## 0.1.0

- First internal delivery release.
