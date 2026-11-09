# Builda Online Payload Optimization Guide

This guide is for designing Room messages and state sync. It focuses on how game data is encoded on the wire, who it is sent to, and how often it is sent; the platform does not automatically convert
JSON to binary for the game, nor does it decide for the game which players need to receive a message.

## Estimate worst-case bandwidth first

Estimate with the actual encoded size, not the number of object fields:

```text
Output per second ≈ encoded size per message × sends per second × actual number of receivers
```

Online network limits use `1 KB = 1024 bytes`: each user's base rate a is 10 KB/s upstream and 30 KB/s downstream, and a Room is counted as
`min(active_users + 1, max_players)` real seats, never exceeding the maximum player count. Broadcasts multiply by the actual number of receivers; `sendToUser` only
multiplies by the number of target connections. Complete frames, WSS outer channel bytes, and chunk metadata all count; the over-limit error code is
`ROOM_BANDWIDTH_LIMIT_EXCEEDED`.
Each direction must satisfy both: the average over the last 5 seconds does not exceed a, and the average over the last 1 second does not exceed 2a. Short bursts can pass,
but sustained sending must satisfy the long-term average; chunking or sending everything at once cannot bypass these two cumulative windows.

Per-message size must include the message type, protocol fields, chunk metadata, and frame header. The receiver count for a broadcast is usually the Room's current number of connections;
`sendToUser`/`send_to_user` counts only the actual target connections. Estimate each phase separately, such as waiting, combat, settlement, and reconnect resends, and use the maximum player count,
maximum object count, and worst-case message size rather than averages.

## Binary first

- TypeScript clients and Rooms use `Uint8Array`; Rust uses `&[u8]` or an equivalent byte buffer.
- JSON methods such as `broadcastJson` and `sendToUserJson` are only suitable for debugging, admin messages, or low-frequency convenience; game data should define stable binary message codes,
  field order, lengths, endianness, and versions.
- JSON repeatedly sends field names, quotes, and numeric text, and usually uses more bandwidth and CPU than compact binary. Choose another encoding only when a benchmark proves it is better.
- Binary does not mean encrypted or trusted. You still must validate the message type, protocol version, length, enum ranges, and numeric bounds; data reported by the client may still be tampered with or replayed.
- A message table may still describe logical fields in JSON for easier review; this must not be implemented as a requirement for JSON encoding on the wire.

## Reduce the data to send

- **Incremental sync**: prefer sending deltas, patches, or events, and avoid sending the full world state every time. Provide a bounded full snapshot or paged resend only when recovery needs it.
- **Compact fields**: use enums, bitmasks, fixed-width integers, quantized coordinates/angles, and short IDs; set a range for every field and avoid unbounded strings and arrays.
- **Merge and throttle**: merge same-kind updates within the same tick; use latest-wins for high-frequency state such as positions, keeping only the latest value. Use event-driven or low-frequency sync for the waiting lobby, settlement, and non-combat phases.
- **Client prediction**: action gameplay can send inputs and let clients interpolate or predict presentation, with the Room arbitrating at a fixed rate; do not broadcast the full state for every rendered frame.
- **Interest range and targeted sending**: send by area, team, visible objects, or subscription range. Use
  `sendToUser`/`send_to_user` for hints, private drops, or ready results visible only to specific users; do not broadcast the entire Room state to everyone.
- Do not call a Host command per object, per cell, or per player; first merge into bounded batches, and set upper limits on the object count and send count per tick.

## Chunking large messages

A single complete `CYR1` frame is at most `65535` bytes, of which the fixed frame header takes `14` bytes; the message type and chunk metadata also take space.
When the single-frame limit is exceeded:

1. Prefer redesigning as a summary, delta, or pages; chunk only when the transfer is truly needed, and reserve space for the frame header and message type.
2. Each chunk carries at least a message ID, chunk index, chunk count or total length, and protocol version; add checksum information when needed.
3. Client reassembly must limit the maximum total size, maximum chunk count, per-message timeout, and expiry cleanup, and must handle duplicate or out-of-order chunks idempotently.
4. Use the reliable channel for reliable and ordered data; do not rely on chunk retransmission for discardable snapshots—drop them once expired and wait for the next snapshot.
5. Chunking cannot bypass the single-frame size, per-callback output, or per-second Room output limits; the total bytes after chunking still count toward the budget.

## Compression trade-offs

- Benchmark only larger, highly repetitive payloads before deciding whether to compress; compressing small messages can add CPU, latency, and memory.
- Compare compressed size, compression/decompression time, worst-case input, and slow-client behavior, and set per-message size limits before and after compression.
- Images, audio, video, and other already-compressed assets usually should not be compressed again. Compression is a game application-layer policy, not automatic platform behavior.

## Acceptance checklist

- Record, for each message kind, the worst-case encoded size per message, frequency per second, maximum player count, and actual number of receivers.
- Make explicit whether each message uses broadcast, targeted sending, or interest-range sending, and confirm whether old clients can ignore unknown optional messages.
- Run round-trip encode/decode tests on binary payloads, covering versions, lengths, boundary values, out-of-order, duplicate, and truncated input.
- For chunked messages, verify the maximum total size, maximum chunk count, timeout, expiry cleanup, packet loss, and behavior after reconnect.
- Verify with slow-client and packet-loss scenarios: key events are never silently lost, discardable snapshots can recover, and send queues do not grow without bound.
- Compare the optimized total output against [Room Resource Limits](resource-limits.md); when over the limit, reduce frequency, scope, or fields instead of further splitting packets to hide the problem.
