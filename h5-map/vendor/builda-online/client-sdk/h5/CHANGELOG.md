# Changelog

## 0.18.0

- Failed or timed-out Room leave keeps its handle and reuses the same operation on retry. Concurrent calls share one attempt; gameplay, reconnect and new admissions pause until release is confirmed.
- On services supporting retryable leave, Room data connection loss does not prevent confirmation. Older services keep the live-data-channel fallback and cannot confirm after that channel is lost.
- A pending leave reports `ROOM_LEAVE_PENDING`; success closes the Room once. Keep the handle and retry leave; an unknown or expired receipt is not a successful leave.


## 0.17.2

- Allow up to 60 seconds for private room creation while preserving other request deadlines.


## 0.17.1

- Code comments, the README and this changelog are now in English; no API or behavior changes.

## 0.17.0

- `joinRankPool` adds solo `rankScore` and Party `memberRankScores`, so the game submits the queueing score; the platform only validates the values and members, not their authenticity.
- When a matched Room is connected but waiting for all members to activate, the join wait is extended once within bounds and the Ticket renewed, so long waits are no longer misreported as connect timeouts.

## 0.16.1

- Fixed private Rooms joined by Room ID being blocked by public Pool/RankPool modes; public closed matches still forbid joining by Room ID.

## 0.16.0

- On the first `room_joined`, the host is automatically notified of `enterRoom` through the Builda SDK internal interface; actively leaving, `roomClosed`, reconnect grace
  exhaustion and `close()` automatically notify `leaveRoom`. Each happens once per Room, reconnects and migrations do not repeat it, and it is silently skipped when the host lacks the interface;
  games need no integration. `ChatGroupHostBridge` adds optional `roomNotificationsAvailable` and `notifyRoom`.
- Added `takeRoomInvite`: a one-time read of a launch from a Builda App Room invitation, returning `{ available, invite }`, where `invite` contains `roomId`
  and the inviter `id/name/avatar` (filled from host public profile data on a best-effort basis when missing); `available=false` when the host lacks the capability.
  `ChatGroupHostBridge` adds optional `roomInviteAvailable` and `takeRoomInvite`; CommonRecipes adds `takeRoomInviteAndEnter`.
- Private Rooms no longer have a host: added `createAndConnectPrivateRoom` to create, issue credentials and enter in one step; removed
  `transferPrivateRoomOwner` and the `room_private_transfer_owner` message, and the server response field `owner_seat` is renamed `creator_seat`
  (the SDK still reads the old field). CommonRecipes' `createAndEnterPrivateRoom` now delegates to the SDK, and `transferPrivateOwner` is removed.

## 0.15.1

- Synced the Ticket snapshot dedup fix: compare `ticket_version` first and compare `revision` only within the same `ticket_version`, so new snapshots after a requeue are no longer blocked by old ones.

## 0.15.0

- Added `waitAndConnectMatchedRoom`: waits, connects, and after a server requeue automatically returns to waiting on the same Ticket, deriving
  an idempotency subkey per round, until it obtains a Room handle or the Ticket reaches an authoritative terminal state; supports cancellation via `AbortSignal`.
- Added `settleMatchTicket`: settles a possibly still-live Ticket to an authoritative terminal state; waiting states are canceled with version races handled, and non-cancelable states
  wait boundedly for a terminal state; `confirmed` is returned as is.
- Added the public types `MatchConnectOptions` and `MatchSettleOptions`; the semantics of `waitMatchTicketReady`, `connectMatchedRoom` and
  `cancelMatchTicket` are unchanged.

## 0.14.0

- Added the `chatMessage` event: after joining, host chat group messages are received through the Builda SDK with the fields `roomId`, `teamId`, `senderId`
  (the sender roleId) and `text`; the SDK subscribes only while some Room's group is joined and only forwards messages of joined Rooms. `ChatGroupHostBridge` adds `subscribe`.

## 0.13.0

- Added `room.joinChatGroup(teamId)` and `room.quitChatGroup()` (plus Socket-level `joinChatGroup/quitChatGroup`):
  the host joins/quits the chat group by Room ID through the Builda SDK, with `teamId` provided by the game; returns `{ available: false }` when the host does not support it.
- Actively leaving, `roomClosed`, reconnect grace exhaustion and `close()` quit the group automatically in the background; `chatGroupHostBridge` can inject a test bridge.

## 0.12.0

- Room network rate-limit control frames now surface `ROOM_BANDWIDTH_LIMIT_EXCEEDED` through the generic error event, keeping the scope, direction and limit information.

## 0.11.1

- WSS first-frame authentication closes now return refined error codes by close code instead of being classified late as `ROOM_JOIN_TIMEOUT`.

## 0.11.0

- The Room transport policy is now a Game-level `room_transport` enum; new Games use the Worker Gateway Room WebSocket by default.
- `webrtc` Games still switch to WSS after an explicit WebRTC failure under the original rules; old credentials without the new field keep using WebRTC.
- WebSocket `state_unreliable` keeps only the latest snapshot, and network snapshots report the actual connection state.

## 0.10.0

- After WebRTC explicitly fails in all three bounded connection attempts, the SDK automatically switches to a standalone Room WSS with a newly issued higher Presence epoch;
  signaling, authentication, Room/Worker unavailability and business errors never trigger the fallback.
- WSS keeps reusing `CYR1` and the three channel IDs; `state_unreliable` uses a bounded backlog with latest-wins dropping on the reliable WebSocket;
  public network snapshots are only marked `websocket_degraded` and contain no endpoint, token or epoch.

## 0.9.3

- Changed Map iterator spreading in the shared browser core to `Array.from(...)`, preventing Cocos Creator loose transpilation from breaking
  DataChannel state checks, network snapshots and the Party invitation projection.

## 0.9.2

- Fixed false timeouts when some host WebViews update all three DataChannels to `open` but miss the final `open` event;
  the connect wait now listens to events and boundedly checks the actual state, and a truly missing channel still returns `WEBRTC_CHANNEL_TIMEOUT` after 15 seconds.

## 0.9.1

- Added a static ESM Vanilla H5 example without a bundler, fixing relative imports, the Bundle directory and the environment boundary between Builda dev and the production App.

## 0.9.0

- Added public `encodeJson` / `decodeJson<T>`, reusing module-level UTF-8 encoders/decoders so gameplay messages no longer create a
  `TextDecoder` each time.

## 0.8.0

- The Session uses the numeric `onlineCompatibilityRevision` to express client/Room protocol compatibility, instead of treating the Bundle version as the multiplayer version.

## 0.7.3

- Fixed discarding the old connection after a half-open Gateway request timeout: use a WebSocket close code allowed by browsers so the subsequent Gateway recovery flow can run.

## 0.7.2

- After a control request times out, discard the Gateway that still looks OPEN; read-only and idempotent requests replay the same payload once, boundedly, after reauthentication.
- Admission replays reuse the idempotency key generated the first time, and uncertain writes return `CONTROL_OUTCOME_UNKNOWN`, avoiding duplicate business changes.

## 0.7.1

- The README adds the unified resource limit entry of the installed Skill and removes platform development-time notes.

## 0.7.0

- `issueRoomCredential` now returns a typed public receipt containing only the Room ID, generation, Presence epoch and expiry time;
  full credentials and ICE configuration still stay only in Socket memory.
- Removed the old Lobby methods, events and control constants that left the user product boundary; the list of public Rooms, private Rooms and match start now all use the Match/Room API.

## 0.6.5

- Pool/RankPool activation wait frames are consumed inside the SDK and no longer leak to the gameplay layer as `opCode=NaN`.
- Room first-connect retries now read the latest Ticket without a version and keep each round's stable error code when exhausted.

## 0.6.4

- Room frames, connect failures and reconnect exhaustion are isolated per current transport/lineage, so old connections and old reconnect tasks no longer clean up or pollute later connections.
- When no candidate is produced within the ICE gathering limit, the SDK no longer sends a doomed Offer; it releases the old Peer immediately and enters a bounded retry.

## 0.6.3

- Fixed the wait method wrongly returning a `waiting` Ticket after a server requeue raised `ticket_version`; it now keeps renewing the same Ticket until RoomReady or an authoritative terminal state.
- Room invitations now only carry the Room ID; added `joinRoomById`, removed the stateful Room Invite API and events, and private Room creation no longer accepts invitation permissions.
- Private Lobbies add invitee decline `rejectLobbyInvite` and host revoke `revokeLobbyInvite`, both protected by the Lobby version CAS.
- Documented the recovery boundaries for screen-off, page hiding, process destruction and cold-start `MATCH_ROLE_BUSY`; the runtime API is unchanged.
- Fixed gameplay messages being unconditionally parsed as JSON before event dispatch; `RoomMessage.data` can now losslessly receive arbitrary binary payloads containing `0x00` and `0xff`.

## 0.6.2

- Shortened the ICE gathering tolerance limit to 5 seconds, so Room signaling does not start only after the short-lived connection credential has expired.

## 0.6.1

- After automatic reconnect grace is exhausted, only `roomClosed(reason=reconnect_timeout)` is dispatched; the old Room's local state is cleaned up and the global error is no longer dispatched again.

## 0.6.0

- Room DataChannels now use `CYR1` binary frames, and `RoomMessage.data` always returns `Uint8Array`.

## 0.5.0

- Room generation switches add `roomTransferStarted/roomTransferCompleted`, so games can pause input while the runtime location switches and get the actual pause in milliseconds.

## 0.4.1

- Fixed compatibility with older browsers/WebViews: credential redaction no longer relies on `structuredClone`, and matchmaking waits no longer rely on `AbortSignal.throwIfAborted`.
- Matchmaking waits treat `MATCH_TICKET_STALE` caused by a server requeue as recoverable, immediately resyncing the latest snapshot with an unversioned get and renewing.
- Heartbeats now renew unconditionally on wall-clock time; Ticket pushes only wake early and no longer delay the next heartbeat.
- A failed invitation snapshot recovery during Gateway recovery no longer interrupts the authenticated session; later pushes realign it.
- Late request-level errors no longer masquerade as global `error` events; an active leave timeout now throws an `OnlineError` with a `code`.
- WebRTC ICE gathering gets a 15-second limit, and an `iceconnectionstatechange` disconnect fallback covers older WebViews without `connectionState`.
- Connect failures before `room_joined` completes no longer wrongly trigger background reconnect; after a successful reconnect, disconnect monitoring is re-armed, and an active leave or close stops background reconnect immediately.

## 0.4.0

- Added APIs for listing public Rooms, creating private Rooms and transferring the private Room owner.
- Pool/RankPool complete confirmation automatically once the three DataChannels are really connected, so game code no longer has to Confirm manually.

## 0.3.6

- Added current Party recovery, Party invitation revocation and `acceptPartyInvite`; Room invitations add a recoverable subscription plus single and full-list events.
- Control requests prefer throwing the stable `error_code`, and accepting or declining an invitation immediately updates the full local snapshot.

## 0.3.5

- Added a recoverable Party invitation subscription, the `partyInviteReceived/partyInvitesUpdated` events and a decline API; Gateway reconnects restore
  pending invitations, and accepting an invitation is no longer wrongly rejected because of a Party revision advanced by member heartbeats.

## 0.3.4

- Raised the default cold Gateway connection budget to 30 seconds, covering the long tail of cold DNS, TLS and WebSocket handshakes on phones.
- Added `waitMatchTicketReady`, which renews automatically and merges server pushes while waiting for opponents, during Formation and Room cold start.
- `connectMatchedRoom` can safely recover from a `room_ready` Ticket or a Ticket already authoritatively committed as `confirmed`.
- Late old Ticket snapshots no longer bypass the internal version gate and reach the game layer.
- When the Gateway briefly disconnects during matchmaking waits or Room reconnect, the SDK runs a shared recovery of at most 3 attempts of 5 seconds each; after reauthentication it recovers by the original
  `ticket_id/ticket_version`, never creates a second Ticket, and dispatches `gatewayReconnecting/gatewayReconnected`.
- `connectMatchedRoom` recovers uncertain credential/signaling outcomes; after a lost answer it issues a higher Presence epoch
  and does not reuse old Peer credentials that may already be registered with the platform.
- A physical Gateway close no longer wrongly dispatches the Socket `closed` event; during repeated jitter, Ticket/Confirm queries keep recovering the original authoritative object.
- When the Gateway is online but the platform's internal Match/Room is rolling out, error code `2002` no longer terminates the original Ticket; the waiter keeps renewing and converging on the authoritative
  `ticket_id/ticket_version`.
- `room_ready` pushes wake the waiting flow immediately, and the heartbeat interval no longer adds extra match completion latency.

## 0.3.3

- Made explicit and locked the default Gateway connect wait at 10 seconds; on timeout the unfinished WebSocket is closed and `GATEWAY_TIMEOUT` is returned.

## 0.3.2

- `leaveRoom` waits for the platform to commit the final leave and release the Seat before closing the Peer; a commit timeout rejects, and an active leave no longer falls into the 60-second reconnect grace.

## 0.3.1

- After `connectMatchedRoom` establishes the real data connection, the platform confirms automatically, and the user Room `on_join` runs only after the whole group of Tickets has arrived.

## 0.3.0

- The local path now uses the in-language open-source Room Mock, and diagnostics are explicitly marked `local_mock_websocket` and `language_mock`.

## 0.2.0

- The local control protocol is unified as `local_room_*`, connecting to the open-source Mock of the current Room language.

## 0.1.0

- First delivery of the H5 TypeScript SDK.
- Supports Match, Party, Lobby, Room v5, full Room invitations and offline grace reconnect.
- The online data plane uses only three browser WebRTC DataChannels.
- Supports an explicitly isolated local Room transport.
