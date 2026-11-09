# Changelog

## 0.6.18

- Ship resource limits 1.1.0 with a 2,000,000,000 fuel hard limit per online lifecycle callback. Include the online bandwidth limits of 20 KB/s upstream and 80 KB/s downstream averaged over 5 seconds, with twice those amounts allowed in 1-second bursts. The local source Mock does not enforce WASM fuel or online bandwidth quotas.

## 0.6.17

- Track @cysj/room 0.14.11; code comments, the README and the changelog are now in English; no API or behavior changes.

## 0.6.16

- Track @cysj/room 0.14.10; Cloud State writes use the bit-pattern host channel so negative int64, float64 and increment deltas no longer trap the Room

## 0.6.15

- Track @cysj/room 0.14.9; docs: package README title changed to Player Data

## 0.6.14

- Track @cysj/room 0.14.8; docs: developer docs consistently say player data, keeping function names such as cloudEnqueue

## 0.6.13

- Track @cysj/room 0.14.7; docs: enqueue means queued, flush waits until applied takes effect

## 0.6.12

- Track @cysj/room 0.14.6; docs: flush waits for Host APPLIED, which does not mean the storage write-back has completed

## 0.6.11

- Track @cysj/room 0.14.5; docs: enqueue hands data to the Host for background saving, and flush is only used to confirm APPLIED

## 0.6.10

- Track @cysj/room 0.14.4; align the Room payment public surface with the local Mock Cloud/fake payment simulation

## Unreleased

- Add in-process Cloud State and fake order delivery Host bindings for local closed-loop checks (`doOrder` / `fulfill` / `cloudFlush`).
- Drive order and cloud callbacks on tick and after room messages.
- Document Scenario `mock_economy.orders`; keep platform `builda.` keys rejected.

## 0.6.9

- Track @cysj/room 0.14.3; fix jco ComponentError enum payload mapping to schema-error

## 0.6.8

- Track @cysj/room 0.14.2; unify CloudStateError as kebab-case, classify ABI exceptions as guest-abi; doOrder compatibly extends outcome

## 0.6.7

- Track @cysj/room 0.14.1; fix CloudValueV1 to use WIT kebab-case tags so online jco no longer rejects int64Value

## 0.6.6

- Track @cysj/room 0.14.0; add the TypeScript Room cloud variable public API

## 0.6.5

- Track @cysj/room 0.13.0; sync the two doOrder interfaces and the minimal trusted order fields.

## 0.6.4

- Track @cysj/room 0.12.0; add secure doOrder order delivery and trusted product context

## 0.6.3

- Track @cysj/room 0.11.1; complete the Host capability for targeted sends to users and the compatibility gate

## 0.6.2

- Track @cysj/room 0.11.0; add an API for sending binary messages targeted by User ID.

## 0.6.1

- Track @cysj/room 0.10.0; add a trusted unixTimeMillis API that never goes backwards across callbacks and recovery

## 0.6.0

- Start the first Room lazily on local Admission and automatically reap it after Ticket, reconnect, and empty-room grace periods expire.
- Keep one concurrent Room while allowing up to 1000 sequential Room generations by default.

## 0.5.0

- Upgrade `ws` to 8.21.0 to resolve published high-severity advisories.
- Add bounded `--rooms N` sequential Room runs so repeated local scenarios do not require restarting the Mock process.

## 0.4.4

- Track @cysj/room 0.9.1; the local Mock aligns any author-initiated close to the ROOM_CLOSED normal terminal state

## 0.4.3

- Track @cysj/room 0.9.0; add public encodeJson/decodeJson APIs that reuse a module-level UTF-8 encoder/decoder.

## 0.4.2

- Pin `@cysj/room` 0.8.1 in the package, keeping the Mock consistent with the delivered Room SDK version.

## 0.4.1

- Local `log` now matches online at 2 KiB per entry, 20 entries per Room per second, and 16 KiB of body text, avoiding passing locally but being truncated online.

## 0.4.0

- The local Room WebSocket tunnel now carries complete `CYR1` frames via `frame_base64`.
- Room handlers, broadcasts, and targeted sends keep opaque bytes end to end and no longer parse gameplay payloads.

## 0.3.0

- The user Room's `log` is only output by the local Mock, uniformly limited to 4 KiB per entry, 20 entries per Room per second, and 64 KiB.
- Local logs normalize levels and use stable `operation/error_code/room_id/room_log_message` fields.

## 0.2.0

- Complete the local authentication, Ticket Assignment, and confirmation flow shared by the three client SDKs.
- Decode the client binary JSON envelope so the public send entry points of H5, Godot, and Unity can all drive Room messages directly.

## 0.1.0

- First open-source TypeScript Room Mock, executing user Room source directly.
- Provides a single Room, synthetic identities, Scenario, state, messages, tick, and loopback WebSocket integration testing.
