# Builda Online Match and Room Integration Guide

This document is for game-development AI and covers only the public client SDK, the user Room SDK, and `builda.online.json`. Completing the user's game does not require reading the Builda Online platform repository; also do not read or infer Builda Online platform service source code, internal storage, scheduling topology, or internal environments.

## 1. Read the Stable Configuration First

Read only from the user project:

- `.builda-agent/game.json#gameId`
- `.builda-online/installation.json#gatewayUrl` and the public service addresses and default identifiers in the same installation record
- The project-root `builda.online.json`
- The short-lived runtime token returned by the Builda runtime through `builda.request_token()`

The installation record is the local environment lock, and the token is kept in memory only. `matchKey` is an independent gameplay entry point, not the default queue name from the installation record.
Match configuration and Room gameplay both come from project configuration; the client must not
upload player counts, modes, Bot settings, or room policies on the fly.

## 2. Take Stock of the Public Capability Boundary First

Read this section before plan confirmation to learn what the public SDK already supports, then discuss the player flow with the user. Do not make the user
choose among plans blindly before you know the capability boundary; what is forbidden is writing code and configuration, not reading public capability docs, surveying the existing project, or preparing candidate plans.

Every capability must land in four places:

- `builda.online.json`: declare `matchKeys`, mode, teams, public auto-matchmaking, Confirm, Bot, and
  Room lifecycle policy.
- Client: call only the public methods of the selected Godot/H5/Cocos/Unity SDK, passing a stable `matchKey` and an idempotency key.
- Room: implement the room logic the author confirmed, input validation, Team/Bot usage, locking/releasing or single-match close, disconnects, and snapshots.
- Verification: local Mock verifies only the user Room source and public API calls; real Match, WebRTC, TURN, capacity, and
  security isolation can only be verified online.

How common capabilities are implemented:

| Capability | Config | Client | Room | Verification focus |
| --- | --- | --- | --- | --- |
| Room looping room | `mode="room"`, `publicMatchmaking=true`, `createPublicRoom=true` | Public automatic room finding; no Confirm | `releaseRoom/release_room` while waiting/after settlement, `lockRoom/lock_room` after the match starts, reset the next match in the same Room | Newcomers wait for the next match, locking does not kick anyone, the room reopens after settlement |
| Room long-running room | `mode="room"`, capacity set to the world's player count, usually kept `release`d | Newcomers join the current world directly when a slot is free | Not closed by a single match's win or loss; handle mid-session joins, leaves, and state snapshots | Newcomers enter the current progress; disconnected Seats are not taken over during grace |
| Private room (friends room) | `privateRoomsEnabled=true`; the public `mode` can be any mode and can coexist with `publicMatchmaking` | The creator calls `createAndEnterPrivateRoom` and shares the Room ID; others call `enterRoomBySharedId` | Same as public rooms; starting/disbanding is decided by the Room based on the roster; there is no host | Not shown in public lists; a full room is rejected with a stable error code |
| Pool single match | `mode="pool"`, `teamCount/teamSize`, optional `confirmTimeoutSeconds` and `botPolicy` | After `joinPool`, wait for the Assignment, then connect to the Room | Always locked; after a match settles, broadcast the final result, and after clients leave the room voluntarily, do a bounded `disconnect` | No character occupancy across two consecutive matches; the Room does not get stuck in `finished` |
| Bot fill | `botPolicy.enabled=true`, with wait time, minimum human players, and maximum Bot ratio | The client cannot choose or override the Bot policy | A Bot is a non-human Seat in the Roster, driven by the same confirmed rules | Bots create no token/Session/WebRTC and do not keep an empty room alive forever |

The config example only shows the field shape; a real project must rewrite it according to the user's confirmation and the existing structure:

```json
{
  "matchKeys": {
    "cf-room": {
      "mode": "room",
      "teamCount": 2,
      "teamSize": 5,
      "publicMatchmaking": true,
      "createPublicRoom": true
    },
    "casual-5v5": {
      "mode": "pool",
      "teamCount": 2,
      "teamSize": 5,
      "publicMatchmaking": true,
      "confirmTimeoutSeconds": 30,
      "botPolicy": {
        "enabled": true,
        "defaultFillAfterSeconds": 180,
        "minimumFillAfterSeconds": 60,
        "maximumFillAfterSeconds": 300,
        "minimumHumanPlayers": 2,
        "maximumBotRatio": 0.5
      }
    }
  }
}
```

## 3. Multiplayer Requirements Interview and Plan Confirmation

Before adding or substantively changing a multiplayer entry point, first finish the public capability boundary survey, then do a read-only project survey of the user's words, the UI, `builda.online.json`, the client, and
the Room code. Never start writing code or configuration before the plan is confirmed. First confirm, in plain player language, how players actually enter and
leave the game:

| Player experience | Corresponding mode | Server behavior that must be spelled out |
| --- | --- | --- |
| Stay in the original room after a match and continue with the next one, e.g. a CF looping room | Room looping room | While waiting, the system may fill in newcomers; after the match starts, newcomers cannot join the current match; after settlement and reset, the original room opens again |
| New players go straight into a world that is already running, e.g. MMORPG server lines | Room long-running room | The world does not wait for a full group to start and is not destroyed by one match's win or loss; when a slot is free, newcomers enter the current progress directly |
| Gather a fixed number of players for one match, then return to the lobby to find new players, e.g. ordinary 1v1 or MOBA 5v5 | Pool | No strangers are added after the fight starts; one room per match; the room ends after settlement, and the next match may have different opponents |

Do not just ask "Room or Pool?", and do not ask "drop in and out, or match one round?". The latter sounds colloquial but still does not say what happens mid-fight,
at settlement, and in the next match. First have the user confirm the concrete player scenario, then the AI maps it to a mode. A game can have several gameplay entry points at once,
but each `matchKey` must be named and confirmed separately; never apply one policy to everything under a vague "multiplayer mode".

Prefer offering the author the following comparison of common game modes. You must describe the behavior as well; never just ask "is it like Honor of Kings or like CF?", because the same game can have
several entry points, such as rooms and matchmaking:

```text
Which of these is your gameplay closest to?
1. Honor of Kings/LOL normal matchmaking: wait until a fixed number of players arrive; once the fight starts, strangers cannot join; when it ends everyone returns to the lobby and the next match is matched again.
2. CF/CS looping room: the system fills players into joinable rooms; after the match starts, newcomers wait for the next one; when it ends the original players stay in the room and can start again and again.
3. Legend of Mir/World of Warcraft server lines or a Minecraft server: the world keeps running; players go straight into the current progress when a slot is free, and there is no
   "everyone in this match settles and returns to the lobby".
```

Once the author picks one, restate it in terms of the current game, replacing the example's buttons, player counts, start conditions, and settlement. When the author is unfamiliar with these games, thinks none of them
fit, or the answer is still ambiguous, ask the two questions below around the same set of players; ask the third only if the answers are still incomplete:

```text
1. Suppose A and B are already fighting, and C taps "Start" now: does C immediately enter what A and B are playing, stay in the original room and wait for the next match, or does the system
   find other players for C and open a new room?
2. After A and B finish: do they stay in the original room and tap "Play again", or do they both return to the lobby to rematch, possibly meeting different people next time?
3. B disconnects or quits mid-match: is the seat held only for B to reconnect, may a stranger fill in, or is the current match treated as lost/ended right away?
```

Replace the button names, player counts, and gameplay in the questions with the current project's real content. For example, for a 1v1 project ask "will C wait for another opponent to start a second
1v1?" instead of copying the abstract template. After asking, first restate the player flow the user's choice implies and confirm it is correct; only then write implementation terms such as Room, Pool,
locking, releasing, or Confirm into the plan.

Also confirm the project's technical choices: the client must choose exactly one of Godot, H5, Cocos, or Unity; the Room source must choose exactly one of TypeScript or
Rust. When existing source proves the choice unambiguously, reuse it and state the evidence in the plan; for a new project or conflicting evidence, ask the user. Never default to
whichever language the AI is more familiar with.

Then fill in the following product decisions:

| Decision | What must be confirmed |
| --- | --- |
| Match Key | Which gameplay entry points are needed, their stable Keys and corresponding client buttons; whether each entry point is Room or Pool |
| Room mode | Whether it is a CF-style looping room or an MMORPG shadow room; how public automatic room finding works; when it is locked and when it is released |
| Pool | Team capacity; whether to show an "Accept match" UI first; Confirm timeout, default 30 seconds, at most 60 seconds |
| Bot | Whether to enable it, how long to wait, the minimum human players, and the maximum Bot ratio; the Bot's gameplay AI is implemented in the Room source |
| Lifecycle | Whether the Room is destroyed after one match, or locked for settlement and then released to start the next match |
| Trust model | Which data is only synced for presentation and which affects other players or settlement; whether client tampering risk is acceptable; whether the Room validates, arbitrates, recomputes, forwards with rate limiting, forwards directly, or saves a snapshot for each message type |

When the user's explicit requirements or project evidence determine a decision unambiguously, state the evidence and continue; otherwise ask only 1–3 questions per round that most affect the state machine, then wait.
Never enable all capabilities by default, and never make the user understand internal platform terms first.

### Breakdown Examples for Common Vague Requests

This section shows user AI behavior examples; it is not a config template to copy directly. A real project must still read the existing UI, configuration, and Room code first,
then implement according to the user's confirmation.

**Example 1: The user says "Make it multiplayer for me."**

Do not create a `default` Match directly, and do not turn on Room, Pool, and Bot all at once. First narrow down the biggest difference in player language:

```text
Let me confirm the multiplayer style first so I don't build the wrong entry point:
1. Is your gameplay more like Honor of Kings/LOL normal matchmaking: gather a group for one match, then return to the lobby and rematch; or like a CF/CS looping room:
   the system fills you into a joinable room, and you stay in the room after a match to keep starting new ones; or like an MMO/Minecraft: go straight into a world that keeps running?
```

If the user answers "rematch every match, 2v2", the plan usually maps to: `matchKey=casual-2v2`, mode Pool, Team
`[2,2]`, public matchmaking, and whether to add Confirm/Bot still needs confirming.

**Example 2: The user says "I want a three-player room."**

"Three-player room" only states capacity; the lifecycle still needs confirming:

```text
Three-player gameplay can mean two different experiences; please pick one:
1. The system automatically fills players into a looping room of up to 3 players, and after settlement they stay in the original room for the next match;
2. The system gathers 3 players for a one-off single match, and after settlement everyone returns to the lobby to rematch.
```

The first usually maps to Room mode and needs confirmation of when to `lockRoom/releaseRoom`; the second maps to Pool mode and needs confirmation of the
Confirm and Bot policy. Both use public auto-matchmaking through `matchKey`.

**Example 3: The user says "A looping room like CF, where we can keep going to the next match after finishing."**

This is usually Room mode, but you still must not skip confirming locking/releasing:

```text
I'll treat this as a looping room: the room is joinable while waiting, stops admitting newcomers once the match starts, and reopens after settlement and reset.
I still need to confirm:
1. When there is no joinable room, may the system create a new room automatically?
2. Should a player who disconnects mid-match keep their seat and wait for reconnection?
```

After confirmation the plan usually maps to: one Room-mode `matchKey`, with the Room source calling `releaseRoom()` while waiting/after settlement and
`lockRoom()` after the match starts; the client provides only a public auto-matchmaking entry point and invents no extra admission method.

**Example 4: The user says "First make a fixed 1v1 multiplayer test."**

"Fixed 1v1" only says a match has at most two players; it does not say whether the room is reused. First give the author the two closest modes:

```text
Which is this 1v1 more like?
1. Honor of Kings/LOL matchmaking: the system opens a match for two players; after a winner is decided both return to the lobby; to play again they rematch and may get a different opponent.
2. A CF/CS room: two players enter a fixed room and fight repeatedly; after a winner is decided they stay in the original room and can start the next round directly.
```

If the author is still unsure, follow up with the full timeline:

```text
Let me confirm with a three-player example:
1. After A and B have started their 1v1, C taps "Start": does the system have C wait for another opponent and start a second 1v1, or have C stay in A and B's
   room and wait for the next round?
2. After A and B have a winner: do both return to the lobby to rematch, or stay in the original room and tap "Play again" directly?
3. If B disconnects halfway through: is B's seat held while waiting for reconnection, or is B ruled the loser immediately and the match ended?
```

If the answer is "C finds another opponent; A and B return to the lobby after finishing; B's seat is held for a reconnect period, and B loses on timeout", this is an ordinary single-match 1v1, usually
mapped to Pool, Team `[1,1]`, one Room per match. If the answer is "C waits for the next round in the original room; A and B stay in the room and play again", it is a looping room,
usually mapped to Room, and you continue to confirm how newcomers wait and when the room reopens for joining. The AI must choose one based on the answers; never decide for the author just because both are
"1v1".

The plan confirmation must list at least the client engine, the Room language, the trust model, and the complete Key matrix. A game can configure multiple `matchKey`s; each
`matchKey` must separately freeze its mode, teams, public auto-matchmaking, and gameplay policy. For example:

```text
Client: Godot; Room: TypeScript (evidence: existing project.godot and rooms/online/room.ts).
Trust model: the client reports candidate movement positions; the Room validates Seat, frequency, and speed cap, then forwards them; skill hits, damage, and win/loss are
arbitrated by the Room, which saves round state. The author has confirmed this resource cost is acceptable.
normal-5v5: Pool, [5,5], public auto-matchmaking, Confirm 30 seconds.
cf-room: Room, up to 10 players, public automatic room finding; released while waiting, locked at match start, released after settlement.
```

Once the user confirms or project evidence determines it unambiguously, the AI must proactively create or update the project-root `builda.online.json`, the Room
source directory for the current language, the selected client code, the shared message protocol, and `builda.room.local.json`. `server/` is only the recommended directory name for new projects;
existing projects that use another conventional directory should keep it. Never generate only the client calls, only paste a config example,
or leave the user to add the server themselves. When configuration, Room, and client conflict, update them together according to the confirmed plan; never keep two parallel logic paths.

Key wiring must be one-to-one: when a gameplay entry point is tapped, pass that entry point's `matchKey`; the Room uses `match_key` from the launch context
to route to the room logic inside the same Artifact. Do not let several different gameplay buttons secretly share one vague `default` Match Key.

## 4. Three Match Entry Points

The public entry points provide Room public auto-matchmaking, Pool fixed-Team match assembly, and RankPool score-based pairing; gameplay with private rooms enabled additionally provides direct room creation and joining by Room ID:

| Need | Godot | H5 | Unity |
| --- | --- | --- | --- |
| Find a room automatically / create a room per config | `join_room_async(match_key, {"allow_create": allow_create}, "", -1, key)` | `joinRoom(matchKey, {allowCreate, idempotencyKey: key})` | `JoinRoomAsync(matchKey, new MatchJoinOptions { AllowCreate = allowCreate, IdempotencyKey = key })` |
| Exact fixed-Team match assembly | `join_pool_async(match_key, {}, "", -1, key)` | `joinPool(matchKey, {idempotencyKey: key})` | `JoinPoolAsync(matchKey, new MatchJoinOptions { IdempotencyKey = key })` |
| Score-based pairing (solo) | `join_rank_pool_async(match_key, {}, "", -1, key, rank_score)` | `joinRankPool(matchKey, {idempotencyKey: key, rankScore: score})` | `JoinRankPoolAsync(matchKey, new MatchJoinOptions { IdempotencyKey = key, RankScore = score })` |

- Room mode admits players one by one, with no Confirm. An auto-matchmaking Ticket that loses a concurrent race for the last Seat keeps waiting.
- Pool creates a one-time locked Room once it is exactly filled.
- RankPool solo matching uses the `rankScore` / `rank_score` submitted by the game; the score must be an integer from 0 to 9007199254740991.
  The platform validates the numeric range but does not verify whether the score is genuine. If the game bases wins, rewards, or rankings on this score, it should define its own anti-tampering plan.
- All three entry points pass the corresponding `matchKey` and an idempotency key; Room may additionally pass `allowCreate`. Do not let the client specify player count, Team, Bot,
  or matchmaking window.

### Starting Another Gameplay from a Long-Running Room

Players in an MMORPG shadow world, a persistent lobby, or a looping room can create and wait on another Match Ticket; "Already in a Room" is not a reason to forbid
matchmaking. But the platform still guarantees that the same character can occupy only one Room Seat, so the author must design the handoff from the old Room to the new Room:

- Room mode: the Ticket may queue first, but it will not take part in room assembly before the old Room is finally left. The client can voluntarily leave the room right after matchmaking is tapped,
  wait for `leaveRoom` to succeed, and then keep showing matchmaking; if leaving fails, keep the old Room and allow canceling the Ticket or retrying the leave.
- Pool: the player can stay in the shadow world and wait for `RoomReady`. On receiving it, first save the Ticket/Assignment, voluntarily leave the old Room
  and wait for success, then call the SDK to connect to the new Room; if leaving fails, never connect to the new Room; retry within the remaining Confirm time or show the failure.
- If the author values simple switching more, Pool can also use "leave the old Room immediately after starting to queue". The AI should choose the timing based on the player experience the user
  confirmed, rather than fixing one on its own.
- When the Ticket is canceled or times out, if the player has not yet left the old Room, they simply stay in the original world; if they have already left, return to the lobby
  or re-enter the long-running world per the game design. You must handle cancel and RoomReady happening at the same time, the old Room's leave confirmation timing out, repeated taps, and process recovery.
- Never connect to the new Room before closing the old Room, and never just drop the network instead of voluntarily leaving; a network drop enters the reconnect grace period, and the old Seat
  remains valid.

#### Example 1: Stay in the shadow world while queueing for a normal dungeon, then switch after a match is found

The player first enters the long-running `shadow-world` and can still move, chat, and fight monsters; tapping "4-player dungeon" calls the Pool entry point, and while waiting the player
stays in the shadow world. When the Ticket reaches `RoomReady`, the client shows "Entering dungeon", saves the Ticket/Assignment, and in order:

1. Disables repeat matchmaking, teleport, and exit buttons;
2. Voluntarily leaves the shadow Room and waits for the SDK to explicitly return success;
3. Clears the old Room handle, then connects to the dungeon Room with the same RoomReady Ticket;
4. After the dungeon ends, voluntarily leaves the room, then re-enters the shadow world through the project's existing entry point.

This usually maps to `shadow-world=Room` and `dungeon-4p=Pool`. If players should stay in the world the whole time while waiting for a match, the dungeon's
`confirmTimeoutSeconds` should leave enough time for leaving and connecting, up to 60 seconds; the AI must choose based on actual project measurements and must not promise that leaving
always completes instantly. When the Ticket is canceled or times out during the waiting phase, the player is still in the shadow world and does not need to re-enter. If leaving fails after RoomReady,
never connect to the dungeon, and you can no longer cancel a Ticket that has entered the match-assembly phase; keep the error UI and wait for that Ticket's authoritative terminal state.
`ROOM_ROLE_BINDING_BUSY` means the old Seat has not been released yet and is not a signal to create a new Ticket; the client must keep the current Assignment,
finish voluntarily leaving the old Room, and then connect to the dungeon.

You can implement it with the following state machine, using the method names of the selected engine SDK:

```text
ticket = joinPool("dungeon-4p")
ready = waitTicketReady(ticket)       # keep using shadowRoom while waiting
if ready is canceled/timed out/failed:
    keep shadowRoom, end this flow

UI enters "Switching to dungeon"
leaveResult = await leaveRoom(shadowRoom)
if leaveResult failed:
    keep ready and the error stage, do not connect to the new Room
    wait for the Ticket's terminal state or let the player retry leaving under a bounded policy
else:
    shadowRoom = null
    dungeonRoom = await connectMatchedRoom(ready)
```

#### Example 2: Leave the shadow world immediately after tapping the dungeon, then match on the loading screen

If the author does not want to be bound by the 60-second switching window after the dungeon match completes, the client can voluntarily leave the shadow Room right after the Ticket is created successfully. The player
then stays on a separate matchmaking/loading screen until the Pool or Room Ticket completes. This flow makes switching simple, but after a cancel or timeout
the player is no longer in the original world; the client must return to character select, the lobby, or re-enter the shadow world as the author confirmed, and must not pretend the old Room still exists.

For an activity whose target is also Room mode, such as going from a main-city shadow line into a public activity room that keeps filling players, only this approach works:
first call `joinRoom` to create the Ticket, then voluntarily leave the shadow Room; the platform lets that Ticket take part in room assembly only after the old Seat is finally released.
Room mode has no "RoomReady first, stay in the old world, then switch last" flow.

When leaving the old Room fails and the Ticket is still `waiting`, the client can cancel the Ticket using the latest `ticket_version` and then stay in
the original world; you must handle the race between cancel and match assembly, and must not discard the Ticket just because the cancel request failed.

Confirm with the author in player language, for example:

```text
After a player taps "Match dungeon" in the open world, do you want them to keep playing in the world and enter the dungeon once the system finds teammates, or leave
the open world immediately after tapping and wait on the matchmaking screen? The first only works for Pool match assembly, and after a match is found they must leave the open world and connect to the dungeon
within an entry window of at most 60 seconds; the second also works for public activity rooms, but after a cancel or timeout you need to decide whether to return to the lobby or re-enter the open world.
```

When the author has already chosen explicitly and the existing code is consistent, the AI records the choice and implements it directly without asking again. Whichever is chosen, you must verify that the other players in the old Room
see the member leave normally, that the new Room does not overwrite the old Seat, and that failure paths never keep two usable Room handles at once.

## 5. Locking and Releasing in Room Mode

Only Rooms with `match_mode=room` that come from public matchmaking can call:

TypeScript:

```ts
this.releaseRoom(); // In a Room subclass: waiting for players, or letting a shadow room allow drop-in/drop-out
this.lockRoom();    // In a Room subclass: stop admitting newcomers during match start, countdown, and settlement
```

Rust:

```rust
ctx.release_room();
ctx.lock_room();
```

Locking/releasing only controls Admission of newcomers:

- It does not kick existing players.
- It does not break reconnection to the same Seat.
- An `offline_grace` Seat still counts toward capacity and cannot be taken over by a newcomer.
- The client SDK renews the Room lease automatically. A brief network loss can recover using the original Ticket and `roomId`;
  after the platform grace period, the server removes the offline member and releases the character; game code must not fake heartbeats or cache the occupancy state forever.
- A full Room never oversells even when released; once a slot frees up, it automatically becomes joinable again.
- The platform rejects these APIs when called from a Pool.

A CF-style Room is released while waiting, locked when it fills and the match starts, and released after settlement; an MMORPG shadow Room can stay released the whole time. This switching logic must
be written into the user Room source and the migration snapshot, not maintained only by the client UI.

## 6. Pool Automatic Confirm

Confirm has only `allMembers`, and the platform produces it automatically once the real data-plane connections complete. Game code has no
manual Confirm method.

The client can choose between two UIs, but the server semantics are the same:

1. Auto-enter: once the Ticket gets an Assignment, the SDK immediately connects to the Room.
2. Accept match: show a button first, and call the SDK to enter the Room after the player taps it.

Each `matchKey`'s `confirmTimeoutSeconds` defaults to 30 seconds, range 1–60 seconds. Until all members arrive, the client is in a "Waiting for other players"
state and the user Room has not yet received `on_join`. If one player times out, their Ticket fails, and the other Tickets keep their queue age and are rematched.
A disconnect after all members arrive and commit belongs to Room Presence/reconnect and does not go back to Match.

Do not copy credentials, signaling, or retry logic yourself. Use the selected SDK's Pool wait-and-connect method; a Gateway reconnect only recovers
the original Ticket and cannot re-run Admission.

## 7. Room Presence, Leaving, and Reconnection

In Room mode players connect one by one; after a Pool's members all commit, every Seat is `Online`. After that, when the control connection or WebRTC drops, the Seat enters
`offline_grace` and keeps occupying capacity. The SDK reconnects to the original Seat with a higher `presence_epoch`; an old connection cannot overwrite a new connection.

The Room receives `on_disconnect/on_reconnect/on_leave`. Only voluntary leaving, being kicked, grace expiry, or Room close triggers the final
`on_leave`. Do not use a temporary connection ID as the gameplay player primary key; use the stable Seat ID.

## 8. Room Launch Context

The same TypeScript/Rust Room routes gameplay only by the trusted fields that the public SDK currently provides as strong types:

- `match_key`
- `match_mode`
- Activity revision
- Team and human/bot Roster; each Seat carries a stable `team_id`

TypeScript's `launchContextJson` and Rust's `launch_context_json` are supplementary JSON for the same launch snapshot; do not assume it contains
fields that the public types do not promise. When the public SDK does not provide a corresponding strongly typed field, Room gameplay must not fake it or require the client to report it.

The client's first message cannot reselect the gameplay. The user Room is a restricted WASM Component: it does not listen on ports and does not access the network, files, databases,
environment variables, or internal platform services.

## 9. External AI Completion Checklist

- Confirmed the client engine, Room language, the choice among the three player experiences, all `matchKey`s, modes, player counts, Team, Bot, public auto-matchmaking, and end-of-match lifecycle.
- Actually created or updated `builda.online.json`, the current-language Room source, the selected client, the shared message protocol, and the local Scenario; there is no half implementation that only wires up the client or only pastes examples.
- The Room implements the message handling the author confirmed, match start/settlement, Team/Bot usage, disconnects, snapshots, and the chosen lifecycle; if client authority, weak validation, or pure forwarding affects outcomes such as win/loss, rewards, or scores, the tampering risk is flagged in the plan and the delivery notes.
- Room mode verifies automatic room finding, room creation per config, concurrent races for the last Seat, and the lock/release cycle.
- Room mode has no Confirm; a single player's connection failure does not affect other Room members.
- Pool verifies the platform's automatic all-member Confirm, client auto-enter/enter-after-tap, and the 1–60 second timeout.
- A Pool Room is always locked and is destroyed after one match ends.
- Verify the disconnect grace period, reconnection to the original Seat, old-epoch fencing, and final room leave.
- Verify the Bot threshold, minimum human players, maximum Bot ratio, and an explicit Bot Roster.
- Local Mock is used only for integration testing of user Room source with public APIs; it does not pass itself off as real Match, WebRTC, platform storage, or recovery verification.

`matchKey` maps to a gameplay; `mode` determines the public matchmaking method, and the private room switch independently determines whether that gameplay can create rooms directly.
Private Rooms are not created by Match and do not take part in public matchmaking, rank filtering, automatic Bot fill, or Confirm; they keep the gameplay's player count and team capacity.
Public matchmaking and private rooms can be enabled independently or both disabled; when both are disabled, hide the new-match and new-room entry points.
