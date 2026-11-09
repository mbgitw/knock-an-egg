# Multiplayer Plan Gate and Capability Boundaries

This page carries the "plan / interview" stage of the main Skill. When adding multiplayer, turning a single-player game into a multiplayer one, adding a matchmaking entry, or substantially changing an existing multiplayer flow,
first read this page and the [Matchmaking scenario guide](matchmaking-guide.md); you may enter the implementation stage only after the author confirms the "Multiplayer plan confirmation".

## Multiplayer Product Gate

When adding multiplayer, turning a single-player game into a multiplayer one, adding a matchmaking entry, or substantially changing an existing multiplayer flow, you must first enter the **read-only plan stage**.
The read-only plan stage allows, and requires, first reading the public capability documents this Skill explicitly references, especially
the [Matchmaking scenario guide](matchmaking-guide.md) and
the "Automatic selection rules" in [Client SDK Selection and Integration](client-sdk-selection.md), and then taking inventory of the existing UI, configuration, client and
Room source in the user project. Until the plan is confirmed, do not write client code, `builda.online.json` or Room source.

The read-only plan stage has three steps:

1. **Public capability inventory**: first understand what the Builda Online public SDK can and cannot do, and for each capability the corresponding configuration,
   client calls, Room responsibilities and verification method. Never confirm a multiplayer plan with the user before reading `references/matchmaking-guide.md`.
2. **Project evidence inventory**: read-only inspection of the current game's engine, Room language, existing entry UI, `builda.online.json`, message codes and
   Room code; the existing project structure takes precedence over example paths.
3. **Multiplayer plan confirmation**: in ordinary player language, map the public capabilities into a gameplay flow the user can confirm, then write out the implementation terms and the Key matrix.

Before starting implementation you must produce a "Multiplayer plan confirmation" the user can understand, and it must satisfy the following seven items:

1. The public capability boundary inventory is complete, and every candidate gameplay is mapped to the Admission, public automatic matchmaking,
   Confirm, Bot and lifecycle capabilities Builda Online already supports; any capability missing from the public SDK has been reported as a gap.
2. The client engine has been uniquely determined from project evidence as Godot, H5, Cocos or Unity; if it cannot be uniquely determined, ask the user first.
3. The Room language has been uniquely determined as TypeScript or Rust from the user's choice or the existing `server/` source; for a new project with no evidence you must
   let the user choose, and must not decide for the user just because the AI is more familiar with one language.
4. Each gameplay entry has been classified as exactly one of the following, and the user has confirmed the player experience they actually want:
   - **Stay in the same room for the next match after one ends**: e.g. a CF looping room. While waiting, the system may fill in newcomers; once a match starts, newcomers cannot join the current match. After
     settlement and reset, the same room opens again; internally the platform maps this to a Room-mode looping room.
   - **New players can enter a world that is already running**: e.g. MMORPG channels or a shadow world. The world persists for a long time, does not require a full batch of players
     to start, and is not destroyed by a single win or loss; internally the platform maps this to a Room-mode long-lived room.
   - **Gather a fixed number of players for one match, return to the lobby afterwards to find new players**: e.g. regular 1v1, MOBA 5v5. Once the match starts, no strangers are added; after settlement
     the current room ends, and the next match may have different opponents; internally the platform maps this to Pool.
5. For each gameplay, the two independent entries, public matchmaking and private room creation, have been confirmed: the public entry automatically finds a room or waits for a fixed number of players; the private entry creates a room directly,
   and other players join by Room ID. The client shows only the entries enabled in configuration.
6. The user has confirmed the complete Key matrix: each `matchKey` represents one independent gameplay together with its public mode, teams, Confirm
   and Bot policy; the public matchmaking and private room buttons may reuse the same Key. Keys use stable, readable business names.
7. If players may start matchmaking for another gameplay from a long-lived Room such as an MMORPG/shadow room or a looping lobby room, the exit timing for the old Room has been confirmed:
   the platform allows a role that is already in a Room to create and wait on a Ticket, but the same role can still occupy only one Room Seat. Room mode forms a room only after
   the old Room is finally left; Pool may wait until `RoomReady` first, and the client must actively
   leave the old Room and wait for success before connecting to the new Room. The AI must decide when to leave the room based on the gameplay, and implement the cancel, timeout, leave-failure and RoomReady races;
   it must not blanket-forbid players in a Room before matchmaking starts, and must not rely on a new connection silently kicking out the old Seat. When the plan is unclear, use
   the "shadow world + dungeon" example in the [Matchmaking scenario guide](matchmaking-guide.md) to explain to the author the flow players will actually see.

A game may configure multiple `matchKey`s at the same time, but each
`matchKey` can choose only one mode. If the user only says "make it multiplayer", "make a three-player room" or "can play with friends", that is not enough to decide the classification
above; you must ask first. **Never present "drop-in/drop-out or match a single game", "Room or Pool", or "whether to Confirm" directly as user options.**
These words are not concrete enough for non-expert authors. First give common modes with complete flows for the author to compare against, for example: "Is it more like Honor of Kings/LOL regular matchmaking,
where a fixed number of players gather for one match, no newcomers join after it starts, and everyone returns to the lobby at the end; or like a CF/CS looping room, where players stay in the same room for consecutive matches; or
like Legend of Mir/World of Warcraft channels or a Minecraft server, where you enter a world that is already running?" Do not just name games, because the same game may also
have multiple modes. If the author still cannot decide, follow up using characters and moments from their game: "A and B are halfway through a match; if C taps Start now, where will C
go?" After the user answers what players will see, the AI then maps it to a platform mode. When the user has already described it clearly and existing code does not conflict, you may write
the judgment and its basis into the plan confirmation and continue, without mechanically asking again.

After the plan is confirmed, the AI bears full-stack responsibility for the multiplayer implementation. Unless the user explicitly limits the scope to a read-only review, the same implementation must proactively
maintain, and keep consistent:

- The project-root `builda.online.json`: truthfully record the mode, Team, public automatic matchmaking, Confirm,
  Bot, Presence and Room lifecycle policy of every `matchKey`; do not just hand the user a sample to fill in themselves.
- Client business code for the selected engine: implement only the entry, waiting, connection, room-leaving and error UI chosen in the plan.
- The Room source directory for the current language: implement the state handling, input validation, Team/Roster/Bot usage, match start/settlement,
  `lockRoom/releaseRoom` or the corresponding Rust API, reconnect, snapshots and final close confirmed by the author; do not wire up only the client and leave an empty Room.
- The message protocol shared by the client and Room, plus `builda.room.local.json` and local verification runnable in the current language.

When any existing implementation conflicts with the confirmed plan, modify that project file directly and say so; do not keep two mutually contradictory sets of old configuration, old Room
logic or compatibility branches. If the public SDK genuinely lacks a capability, report the gap explicitly; never work around it with a self-built protocol or fake success.

## Requirements Interview

Whenever you add or substantially change a multiplayer entry, or the user only vaguely asks for "multiplayer", "multiple players" or "play with friends", you must read
the [Matchmaking scenario guide](matchmaking-guide.md), first carry out its "Multiplayer requirements interview and plan confirmation", and then use its "External AI
completion checklist" for acceptance of the selected capabilities. When requirements are vague, follow up using the common breakdown examples in the guide; never skip this just because the user did not use platform terms such as Room locked/released.
Questions should first use common modes such as Honor of Kings/LOL regular matchmaking, CF/CS looping rooms, Legend of Mir/World of Warcraft channels or Minecraft servers as
analogies, and explain gathering players, match start, mid-match joining and where players go after settlement all together; if ambiguity remains, describe specific players, tap timing and outcomes. Do not just
swap "drop-in/drop-out / match a single game" for another set of terms and keep making the user guess; when only fixing a clear problem that does not change the existing multiplayer product semantics, you may keep the existing plan.

## Contents of the Multiplayer Plan Confirmation

First take inventory of existing scenes, scripts, `builda.online.json`, message codes and Room; do not overwrite existing gameplay. Before modifying any multiplayer file,
output a short "Multiplayer plan confirmation" according to the "Multiplayer Product Gate" above, stating at least: the client engine, the Room language, which of
CF looping room / shadow room / single-match matchmaking each entry belongs to, all `matchKey`s and their client entries, Room/Pool mode, player count and Team
structure, public automatic matchmaking, when Room mode is locked or released by user Room code,
bot policy, Pool Confirm timeout,
final lifecycle, and for each kind of shared data its trust model, tampering risk, Room handling and resource cost.
When something can be uniquely determined from what the user has already said clearly, existing configuration and code, adopt it directly and state the basis without asking again; when any option that would change the product flow or
Activity cannot be uniquely determined, you must ask the user in ordinary player language and wait for confirmation. At minimum make clear "what happens when a new player taps the entry while others are already playing"
and "where the original players go after a match ends"; if necessary also ask whether strangers may fill a spot after someone leaves mid-match. When many items are undecided,
communicate in rounds, each round prioritizing 1–3 questions that decide the subsequent path,
and do not dump the full checklist on the user at once. Never choose by default, turn on every capability at once, or generate configuration first and explain afterwards.
Also make clear the lifecycle model after a match ends: either reset state within the same Room to continue the next match, or return to the lobby and rematch into
a new Room. Only one of the two may be chosen; any gameplay that rematches into a new Room must design active Room closing for final paths such as normal win/loss, surrender and business timeout;
do not merely set the business state to `finished`.
If a long-lived Room also contains dungeons, battlegrounds or other matchmaking entries, you must also confirm whether the player "leaves the long-lived Room immediately after tapping matchmaking,
and keeps waiting once the exit succeeds", or "waits in the long-lived Room until Pool's RoomReady, then exits and connects to the new Room";
Room mode does not offer the latter timing. Write the choice into the client state machine and error UI; never use "already in a Room" as a reason to disable the matchmaking button.

## Determining the Room Language

Determine the Room language for this task in the plan confirmation:
- When the user has already explicitly specified a language, adopt it directly;
- When the existing `server/` contains only TypeScript evidence such as `package.json`, `tsconfig.json` or `@cysj/room` imports,
  keep TypeScript directly and do not ask again;
- When the existing `server/` contains only Rust evidence such as `Cargo.toml` or a `cysj-room-sdk` dependency, keep Rust directly
  and do not ask again;
- Only when creating a new Room, when both kinds of evidence are present, or when existing code cannot be reliably judged, let the user choose or clarify.
The `roomLanguage` already recorded in `.builda-online/installation.json` should agree with the source evidence; on conflict, stop and explain.
JavaScript and other server languages are not supported; a single user game task modifies only one Room implementation. Do not synchronously rewrite or delete the other example the repository demo
keeps to showcase capabilities, unless the user explicitly asks.

Once the language is determined, strictly isolate toolchains and documentation. A TypeScript Room only installs, reads, modifies and verifies the TypeScript SDK;
it does not check or install Rust, `rustup`, Cargo or the `wasm32-wasip2` target, and does not run any `cargo` command. Only a Rust Room
uses the Rust SDK and the Cargo toolchain. Examples and verification items for the other language are not part of the current task.

## Capability Boundaries

- The Builda SDK handles `whoami`, privateKV, payments, ads, leaderboards, audio, vibration, safe area, text input and host
  lifecycle. For related tasks, also use the project's `builda` skill.
- Builda Online handles runtime token authentication, matchmaking, Room allocation, Presence, authoritative state and the three logical channels; online, these are carried primarily by
  WebRTC DataChannel, and only after the SDK confirms that bounded WebRTC connection attempts have failed may it automatically fall back to standalone WSS.
- The SDK automatically notifies the Builda App of entering/leaving the current Room on first room entry and on leaving the room, room close, reconnect grace exhaustion and Socket close; this is
  host-side state, and game code does not need to, and must not, call the host interface itself.
- Private Rooms are created by the client for a `matchKey` with `privateRoomsEnabled=true` (Godot `create_and_connect_private_room_async`,
  H5/Cocos `createAndConnectPrivateRoom`, Unity `CreateAndConnectPrivateRoomAsync`), and can only be joined by Room ID;
  the creator and members are equals, the platform has no host, and match start, parameter changes and disbanding are decided by user Room code based on the roster; public and private Rooms are written the same way.
- When a player launches the game from a Builda App room invitation, use Godot `take_room_invite_async`, H5/Cocos `takeRoomInvite`, Unity
  `TakeRoomInviteAsync` in the startup flow to read the invitation once, and after obtaining the Room ID join by ID with Godot `join_room_by_id_async`, H5/Cocos
  `joinRoomById`, Unity `JoinRoomByIdAsync` (example `takeRoomInviteAndEnter`); with `available=false` or `invite=null`,
  follow the normal lobby flow. Sending invitations is the Builda App's job; Online provides no send interface.
- Room chat groups are hosted by the Builda App. The Online SDK only, after room entry and using the `team_id` provided by the game, has the host join the group by Room ID, and
  automatically leaves the group on leaving the room, room close and Socket close. When it returns `available=false`, hide the chat entry; never build your own chat service or retry.
  After joining, group messages pushed by the host reach the game through the Godot `received_chat_message`, H5/Cocos `chatMessage` and Unity
  `ChatMessageReceived` events; `senderId` is the sender's `roleId`, including messages you sent yourself. Sending is handled by the Builda App
  chat UI; Online provides no send interface, and messages are not cached or redelivered.
- The multiplayer part of the Builda Skill is only responsible for guiding installation of this Skill. The Builda SDK does not provide `Builda.backend`, signaling, TURN
  or Room APIs; do not call these nonexistent interfaces. This project's multiplayer capabilities use the separate Builda Online public SDK.
- User business code must not create its own listening ports, WebSocket data plane, signaling service, matchmaking service or authentication protocol, and must not actively choose,
  pre-establish or assemble the online fallback entry. Online standalone WSS is enabled automatically only by the public SDK after all bounded WebRTC attempts have explicitly failed and the platform has declared the capability.
  The `local_mock_websocket` installed with the deliverables and bound only to the loopback address is the fixed transport of the local source Mock; it is not a user-built
  service or an online fallback entry.
- The client Bundle and the Room Artifact are two separate artifact pipelines and must not be packaged into each other:
  - The Builda client draft command only uploads the Godot Web/HTML5 Bundle and optional assets.
  - Builda Online's own deployment client in `.builda-online/bin/` submits a TypeScript entry or a Rust Cargo
    Workspace; the platform generates and validates the WASM Component, then activates the Match Activity. Never upload a locally
    precompiled `.wasm`, and never call the Builda CLI's `online` subcommand.

## Gameplays and Entries

A `matchKey` corresponds to a gameplay; the public `mode` only decides the Room, Pool or RankPool matchmaking method. `privateRoomsEnabled=true`
allows the same gameplay to create private rooms directly, joined by Room ID; private rooms have no host, and do not take part in public matchmaking, tier filtering, automatic Bot backfill or
Confirm. Public Pool/RankPool matches still lock the roster. Public matchmaking and private room creation are enabled independently, and new entries may also both be closed.
