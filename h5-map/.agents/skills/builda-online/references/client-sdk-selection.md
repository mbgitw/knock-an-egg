# Client SDK Selection and Integration

Builda Online ships four client SDKs at once: Godot, H5, Cocos and Unity. All four share the same Match, public automatic matchmaking,
Presence and three-DataChannel semantics, but have independent versions and APIs that follow each language's idioms. A game client installs only one
SDK, and does not copy or rewrite SDK internals.

The client engine and the Room language are two independent choices in the multiplayer plan. After finishing the engine decision on this page, you must write "client=Godot/H5/Cocos/Unity"
and "Room=TypeScript/Rust" together into the multiplayer plan confirmation; H5 and Cocos both use the TypeScript API, but that must not automatically select a TypeScript Room,
and Unity using C# must not lead to creating a C# server. Before confirmation, do read-only checks only; after confirmation, maintain only this one client and this one Room.

## Automatic Selection Rules

Check the actual client root directory in the following priority order:

1. `project.godot` exists: choose `client_sdks.godot`, installed into `addons/cysj_online/`.
2. `ProjectSettings/ProjectVersion.txt` exists and `Assets/` exists: choose `client_sdks.unity`, installed as a UPM local package
   with the fixed package name `com.cysj.online`. Unity projects always integrate through the C# API; the underlying native WebRTC or WebGL browser
   bridge is adapted inside the SDK.
3. `package.json`, `assets/` and `settings/` exist, and `tsconfig.json` extends `./temp/tsconfig.cocos.json`:
   choose `client_sdks.cocos`, with the fixed package name `@cysj/online-cocos`. Only Web
   Mobile/Web Desktop on Cocos Creator 3.8 LTS is supported; for native and mini-game targets you must stop and report that they are unsupported.
4. `package.json` and a browser entry (such as `index.html`, a Vite/Webpack config or `src/`) exist, and none of the first three
   engine markers is present: choose `client_sdks.h5`, with the fixed package name `@cysj/online-h5`.
5. When multiple engine markers are present at once, first locate the real client subdirectory; if it still cannot be uniquely determined, ask the user; never install multiple SDKs at once.
6. Other engines are not currently supported. Never treat Unity WebGL or Cocos Web as an H5 project, and never install
   `@cysj/online-h5` in a Unity project; the Unity SDK may internally use Unity WebRTC, a WebGL JS plugin or a browser capability bridge depending on the export platform,
   but exposes only `com.cysj.online` to the user project.

You must use the `clientSdk`, `clientSdkVersion` and `clientProtocolVersion` recorded in `.builda-online/installation.json`
to re-verify the installed version. Godot reads the actual version from `addons/cysj_online/plugin.cfg`; the controlled local H5 package lives in
`vendor/builda-online/client-sdk/h5/`; the controlled local Cocos package lives in `vendor/builda-online/client-sdk/cocos/`; the controlled local Unity
UPM package lives in `vendor/builda-online/client-sdk/unity/`. These directories are project dependencies and must be kept under version control; `.builda-online/` only holds
local installation state, deployment tools and caches. After installation and before every
deployment, run `.builda-online/bin/builda-online check`; if it finds multiple versions or record drift, run `builda-online upgrade`. The immutable manifest
corresponding to the version lock is the only source; do not guess versions from documentation examples, cached file names or internal platform repositories.

`check` proves that the installation record and the files on disk are consistent with each other, and that `onlineRelease` equals the project version lock `sdkVersion`; that is the
client SDK version this project should use. Do not visit the manifest looking for an "update" just because you are starting to add multiplayer capabilities. Only after the user runs `builda sdk upgrade` to advance the version lock
will `check` report `ONLINE_RELEASE_DRIFT`; then run `.builda-online/bin/builda-online upgrade` to update the Skill,
the deployment client and the single selected SDK together, and run `check` again. Never copy new APIs from the current documentation directly just because an old version's `check=ok`.

## The Only Way to Identify the Local Mock

The real game Bundle in the Builda App is always loaded by a loopback HTTP Server on the device, so the page hostname is also `127.0.0.1`.
Clients must not use `location.hostname == "localhost"`, `location.hostname == "127.0.0.1"`, `file:`, the port or the
URL protocol as the criterion for the local Mock. Otherwise the Builda App skips `Builda.requestToken()` and wrongly connects to the device's own
`ws://127.0.0.1:7350/ws`.

The recommended `dev-url` from `builda dev` injects `builda_mock_shell=1` into the game iframe through the test shell. When the same client needs to switch
between the local Mock and the Builda App, only this explicit, non-secret marker is allowed; native Godot editor runs may also use
`OS.has_feature("editor")`. The standard check for Godot Web is:

```gdscript
## Recognize only the Builda test shell's explicit marker; the Builda App itself also uses 127.0.0.1, so never check the hostname.
func uses_local_room_mock() -> bool:
	if OS.has_feature("editor"):
		return true
	if not OS.has_feature("web"):
		return false
	return bool(JavaScriptBridge.eval(
		"new URLSearchParams(window.location.search).get('builda_mock_shell') === '1'",
		true
	))
```

H5 and Cocos Web use the same marker:

```ts
/** Recognize only the builda dev shell; do not treat the Builda App's loopback origin as the local Mock. */
export function usesLocalRoomMock(): boolean {
  return new URLSearchParams(window.location.search).get('builda_mock_shell') === '1'
}
```

The `builda-online check` run after installation and before every deployment scans the user's client source; when it finds hostname and loopback addresses jointly involved in
Builda Online/Gateway environment switching, it fails with `UNSAFE_LOCAL_RUNTIME_DETECTION`. Never bypass this check.

## API Reference

| Capability | Godot | H5 / Cocos Web | Unity |
| --- | --- | --- | --- |
| Restore session | `restore_session` | `restoreSession` | `RestoreSession` |
| Connect to Gateway | `connect_async` | `connect` | `ConnectAsync` |
| Room Admission | `join_room_async` | `joinRoom` | `JoinRoomAsync` |
| Regular matchmaking | `join_pool_async` | `joinPool` | `JoinPoolAsync` |
| Query and restore Ticket | `get_match_ticket_async` | `getMatchTicket` | `GetMatchTicketAsync` |
| Manually renew Ticket lease (usually called internally by the wait methods) | `heartbeat_match_ticket_async` | `heartbeatMatchTicket` | `HeartbeatMatchTicketAsync` |
| Wait for and restore Ticket | `wait_match_ticket_ready_async` | `waitMatchTicketReady` | `WaitForMatchTicketReadyAsync` |
| Cancel a Ticket that has not entered a Room | `cancel_match_ticket_async` | `cancelMatchTicket` | `CancelMatchTicketAsync` |
| Connect to the matched Room (Pool auto-confirm) | `connect_matched_room_async` | `connectMatchedRoom` | `ConnectMatchedRoomAsync` |
| Wait + connect + automatically return to waiting on requeue (recommended main path) | `wait_and_connect_matched_room_async` | `waitAndConnectMatchedRoom` | `WaitAndConnectMatchedRoomAsync` |
| Settle a still-live Ticket to its authoritative final state | `settle_match_ticket_async` | `settleMatchTicket` | `SettleMatchTicketAsync` |
| Actively leave a connected Room | `leave_match_async` | `leaveRoom` | `LeaveRoomAsync` |
| Close Socket | `close` | `close` | `CloseAsync` |
| Query Room authoritative snapshot | `get_room_async` | `getRoom` | `GetRoomAsync` |
| Reliable gameplay message | `send_match_state_raw_async` | `RoomHandle.sendReliable` | `OnlineRoom.SendReliable` |
| Reliable control gameplay message | `send_match_control_async` | `RoomHandle.sendControl` | `OnlineRoom.SendControl` |
| Unreliable gameplay message | `send_match_state_unreliable_async` | `RoomHandle.sendUnreliable` | `OnlineRoom.SendUnreliable` |
| Gateway RTT | `measure_gateway_rtt_async` | `measureGatewayRtt` | `MeasureGatewayRttAsync` |
| Room RTT | `measure_room_rtt_async` | `measureRoomRtt` | `MeasureRoomRttAsync` |
| Network snapshot | `network_path_snapshot` | `networkSnapshot` | `NetworkSnapshot` |
| Join the Room chat group (group ID = Room ID, `team_id` provided by the game) | `join_chat_group_async` | `RoomHandle.joinChatGroup` | `OnlineRoom.JoinChatGroupAsync` |
| Actively quit the Room chat group (the SDK quits automatically on leaving the room, room close and Socket close) | `quit_chat_group_async` | `RoomHandle.quitChatGroup` | `OnlineRoom.QuitChatGroupAsync` |
| Create a private Room and enter it (not in the public list or automatic matchmaking, joinable only by Room ID, members are equals) | `create_and_connect_private_room_async` | `createAndConnectPrivateRoom` | `CreateAndConnectPrivateRoomAsync` |
| Join by a known Room ID (the Room ID is the admission credential; no new Room is created) | `join_room_by_id_async` | `joinRoomById` | `JoinRoomByIdAsync` |
| Read a Builda App room invitation launch once (then join by ID after obtaining the Room ID) | `take_room_invite_async` | `takeRoomInvite` | `TakeRoomInviteAsync` |

Notifying the Builda App of the current Room on room entry and leaving (host `enterRoom`/`leaveRoom`) is done automatically by the SDK on the first `room_joined`, active room leaving, room close,
reconnect grace exhaustion and Socket close; none of the four platforms has a corresponding public method, and game code does not need to, and must not, call the host interface directly.

Connection recovery and Room transfer use each platform's corresponding gateway/room reconnecting, reconnected and transfer started/completed events;
these are events to listen to, not recovery commands the game calls. The SDK automatically rebuilds credentials, Peer and generation fence; the game only pauses input,
shows the stage and refreshes authoritative state once it completes.

The table above lists only public game APIs. Method parameters and types follow the installed SDK's public declarations and README; never infer request bodies from Gateway message names.
All failures keep the SDK's stable error codes and are handled per
[Client Interruption Recovery, Admission and Exit Lifecycle](client-lifecycle.md#common-stable-error-codes); never
overwrite errors from different stages uniformly as "connection failed".

Assignments obtained from matchmaking always use `connect_matched_room*`. Connection credentials, SDP, ICE candidates and answers are all
internal SDK wire protocol and not part of the user workflow; when a public capability is missing, report a product gap; never copy internal requests or read the SDK transport
source to work around it.

Player count, team structure, bot policy and Room admission come only from the server Activity and user Room code. No client SDK
can upload or override them. Pool confirms automatically after the real Room data connection is established; there is no manual Confirm API on the client.
The client may show multiple gameplay buttons; the public matchmaking and private room buttons for the same gameplay use the same `matchKey`.
Show only the entries enabled in configuration: the public entry runs matchmaking, the private entry creates a room directly or joins by Room ID, and the client must not override the server's admission policy.

## Transport and Lifecycle

- On all four platforms the online control plane is the Gateway WebSocket, and the online gameplay data plane prefers WebRTC DataChannel. Only when all of the SDK's bounded WebRTC
  connection attempts have explicitly failed does it switch, with a new transport epoch issued by the server, to standalone Room WSS; game code takes no part in the choice.
- On all four platforms, a cold Gateway connection waits 30 seconds by default, covering DNS, TCP, TLS and the WebSocket handshake. Godot can pass an override in seconds, H5/Cocos can pass an
  override in milliseconds, and Unity uses `GatewayConnectTimeout`; never implement unbounded retries in the game layer.
- Short Gateway disconnects during matchmaking waits or Room recovery are handled uniformly by the SDK with bounded reconnects of at most 3 attempts of 5 seconds each, re-authentication and a query of the original Ticket; the game layer must not
  call Admission again "as a fallback", or it will create duplicate Tickets. The UI only listens to each platform's corresponding gateway reconnecting/reconnected events.
- A `room_ready` push immediately wakes the Ticket waiter on all four platforms; the 5-second heartbeat is only a fallback for lost pushes and lease renewal, and should not become a matchmaking completion delay.
- The three negotiated channels are fixed as `control_reliable(1)`, `game_reliable(2)`,
  `state_unreliable(3, ordered=false, maxRetransmits=0)`.
- After H5/Cocos page resume, Unity app resume and Godot lifecycle resume, the SDK issues, within `offline_grace`, credentials with a higher
  `presence_epoch` and rebuilds the Peer. The game uses reconnecting/reconnected to update the network indicator; a physical Gateway disconnect is not
  a Socket terminal state, and the public `closed` is dispatched only when the game actively closes the whole Socket; never use it to end the Match early.
- The local source Mock returns an explicit `transport=local` only on loopback addresses and with a local token; the online fallback WSS, the local Mock and the
  Gateway control WebSocket are all mutually independent connections, and game code must not assemble their addresses or credentials.
- The runtime token is held only in memory, never written to localStorage, PlayerPrefs, Godot saves, logs or URLs.
- Exiting Admission, Ticket, Room and Socket must follow
  [Client Interruption Recovery, Admission and Exit Lifecycle](client-lifecycle.md): in the Ticket stage cancel first, in the Room stage first wait for the active room leave to finish,
  and only after settling succeeds may the Socket be closed; when canceling or leaving fails, do not switch scenes or reopen matchmaking.

## Modification Boundaries

Game code only calls the selected SDK's public entry points. Do not access Godot's transport files, the internal `control`/
`room-transport` modules of H5/Cocos, or Unity's `Runtime/Transport` types. When the public SDK lacks a capability, report the gap; do not copy the protocol or implement
Gateway, signaling, TURN, Room credentials and the reconnect state machine yourself.
