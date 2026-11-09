# Online Room Build and Deployment

Deployment takes `onlineCompatibilityRevision` from the current Builda client draft and checks it against the project configuration, builds an immutable Artifact,
and, after all configuration succeeds, activates the new Server Release as the active head for that revision. Client Bundles and Server Releases
evolve independently, with no one-to-one binding. Users have only two environments: "local source Mock" and "online"; there is no user-facing test server,
staging server, or sandbox server. Run it only when the user explicitly asks to deploy or go live.

Before uploading, also read [Room resource limits](resource-limits.md) and confirm the source file count, unpacked size, and archive size are within limits.
Before uploading, Room source must also pass `.builda-online/bin/builda-online check`: `onlineRelease` must equal the version lock's `sdkVersion`;
when it reports `ONLINE_RELEASE_DRIFT`, first run `.builda-online/bin/builda-online upgrade`; `deploy` itself also rejects a drifted version.

## General Deployment Rules

- For every Builda client draft task, first run the project's Builda `check` and `auth` in `game/`, then follow the Builda skill
  for the SDK, export, `bundle-check`, upload, and draft flow.
- The online source build and the user's local language toolchain are two independent build chains. When
  `deployment.source_languages` in the installation record includes `typescript`, the platform already provides online building from TypeScript source to a
  WASM Artifact; local Mock does not build WASM, and the result of a separate local build/check can neither be uploaded nor replace the online rebuild.
- `deployment.client` in the installation record must be `builda-online`, and `source_languages` must include the current Room
  language. If either is missing, it is a deliverable error in this environment; stop and report it. Never fall back to the Builda CLI's legacy Online capability.
- Deployment modifies real online resources and may run only after the user explicitly asks to deploy or go live. Follow
  this page and use the owned deployment client in `.builda-online/bin/`. It first
  calls Builda `check/auth` to obtain the user's authorization context, then submits the source, waits for the build, and activates the Match Activity; never call unpublished endpoints by hand,
  reuse a player runtime token, or fall back to uploading WASM directly.
- After creating or updating the Builda draft, stop in the pending-publish state and let the user try it in the Builda App and complete review and listing.
- When the user explicitly asks to maintain a specific online Room, use the owned client's `migrate-room` and `migration-status`; submit only
  `room_id`; the platform chooses the run location automatically, and never use a player runtime token as migration authorization. Report to the user only
  `room_id`, `migration_id`, the public status, and the result; ignore and never copy any run-node, routing, or storage fields.

## 1. Pre-deployment Checks

First read `.builda-online/installation.json`, then run:

```bash
./.builda-online/bin/builda-online check
```

On Windows use `builda-online.cmd` in the same directory; that entry applies ExecutionPolicy Bypass only to the current child process and prefers the interpreter recorded in
`installation.json#pythonInterpreter`. The check prints the redacted interpreter source and Python version, and verifies:

- The game binding in `.builda-agent/game.json`;
- An immutable client draft version for this release already exists in Builda; a Room deployment cannot bind to a version that has not been uploaded or that the user typed by hand;
- The API, Room language, and client SDK versions locked in the installation record;
- The Server SDK and Room Contract versions locked in the installation record; at deployment the platform checks them again exactly against the current online build capability;
- User code does not use `location.hostname`, localhost, loopback IPs, protocol, or port to guess the local Mock;
- The current project uses only the selected TypeScript or Rust Room toolchain.

A real Bundle in the Builda App may also be loaded from an on-device loopback HTTP Server; Web local integration testing recognizes only `builda_mock_shell=1` injected by `builda dev`, and Godot editor runs may recognize the editor flag.

## 2. Confirm the Product Plan First

Deployment is not the time to decide gameplay for the first time. Before generating or modifying `builda.online.json`, you must first complete the
multiplayer plan confirmation in `matchmaking-guide.md`; without a confirmation sheet, stop deployment preparation and only do a read-only survey. Confirm at least:

- The client uses exactly one of Godot, H5, Cocos, or Unity, and the Room uses exactly one of TypeScript or Rust;
- Whether each gameplay is a CF-style looping room, an MMORPG/shadow room, or an Honor of Kings-style single-match Pool;
- Which `matchKey`s are needed, which client entry point each maps to, and whether each is `room` or `pool`;
- Each `matchKey`'s team count, players per team, and public auto-matchmaking entry point;
- Whether Room mode may create a public room when no joinable room exists;
- The Pool automatic room-entry confirmation timeout and the restricted Bot policy;
- Reconnect, end of match, and empty-room reclamation.

A Room's `locked/released` state is decided at runtime by the user Room code; it is not a long-lived deployment-time switch. Room mode has no Confirm; Pool has only one semantic: "automatic confirmation once the real connection is established".

After confirmation, the AI must directly maintain the project's `builda.online.json` and the Room source directory for the current language. `server/` is only the
recommended directory name for new projects; existing projects that use another conventional directory should keep it and pass the actual path in the deploy command. Never generate only a JSON
example for the user to copy, and never activate a half-finished state where a `matchKey` exists in the configuration but the client or Room has no corresponding implementation. Before deploying, check item by item:

- Each `matchKey` has exactly one match entry point in the single client;
- Each `matchKey` has explicit room logic, trust model, and end-of-match branch in the same Room Artifact;
- The lock/release timing for Room mode is written in the Room source and snapshot, not only in the UI or docs;
- Team and Bot configuration is consistent with the client UI and how the Room uses them;
- `source` points to the Room source actually checked and modified this time; there is no second, deployment-only copy of server code.

## 3. `builda.online.json` v3

Each game maintains only one game-level configuration. One source build is shared by all `matchKey`s:

```json
{
  "schemaVersion": 3,
  "onlineCompatibilityRevision": 1,
  "roomTransfer": {
    "snapshotSchemaVersion": 1,
    "authoritativeState": [
      "state.phase",
      "state.players",
      "state.round",
      "state.closeDeadlineMs"
    ],
    "failureRecovery": "latest-checkpoint",
    "pauseBudgetMillis": 1000
  },
  "source": "rooms/online",
  "roomRoute": "authoritative",
  "roomType": "authoritative",
  "version": "v2",
  "tickRate": 20,
  "matchKeys": {
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
    },
    "public-world": {
      "mode": "room",
      "teamCount": 1,
      "teamSize": 50,
      "publicMatchmaking": true,
      "createPublicRoom": true,
      "recovery": "recoverable"
    }
  },
  "roomParameters": {}
}
```

Rules:

- `schemaVersion` can only be `3`; old configurations are no longer compatible;
- `roomTransfer.authoritativeState` must list, item by item, the authoritative state that still affects gameplay after transfer. Players, scores, phases, timers,
  settlement idempotency IDs, room-lock state, and deferred-close flags must not be hidden in other mutable fields of the Room class;
- `snapshotSchemaVersion` is the user state format version, currently starting from `1`; `failureRecovery` is fixed to
  `latest-checkpoint`, and `pauseBudgetMillis` is fixed to `1000`;
- `matchKeys` has `1..64` entries; the client passes only keys declared here;
- `teamCount × teamSize` is `1..50`; the platform only passes team information, and the user Room decides whether it is co-op, versus, or FFA;
- Public matchmaking entry points set `publicMatchmaking=true`; any public mode may set `privateRoomsEnabled=true` to let clients create private Rooms joinable only by
  Room ID; the two are independent switches and can also both be off (in which case `createPublicRoom=false`);
- Only `room` may set `createPublicRoom=true`;
- `room` must not configure `confirmTimeoutSeconds`;
- `pool` defaults to 30 seconds and allows only `1..60` seconds;
- A game may have multiple `matchKey`s with completely different policies; never use `defaultQueueName` to override these business Keys;
- `roomParameters` may hold only non-secret string key-value pairs.

A Rust Workspace must also add to the root configuration:

```json
{
  "manifestPath": "Cargo.toml",
  "package": "my-game-room"
}
```

TypeScript must not include these two fields. `source` should match the path passed on the command line; local Mock and the online build run the same Room business source.
A Rust project may keep `cysj-room-mock`, outside the source package, as an optional path dependency under the non-default `local-mock` feature,
with no need to upload the Mock online. The temporary online manifest strips optional dependencies not enabled by the default feature closure; never enable `local-mock` directly or indirectly in the `default`
feature, or that dependency will be validated as an online runtime dependency and rejected for reaching outside the source package.
TypeScript `Room<TState>` writes the full `this.state` into the checkpoint by default; a Rust Room type must derive
`Serialize + Deserialize`, and the SDK saves the full Room by default. Override `onCheckpoint/onRestore/onActivated` (snake_case in Rust)
only when the state format is upgraded or non-serializable derived objects must be rebuilt after restore. These callbacks do not choose the platform run location, connect clients,
or submit routes, and `onCheckpoint` must not send messages or modify Host state.

Each public auto-matchmaking mode uses only its corresponding single Admission API:

| mode | Control message | Godot | H5 | Unity |
| --- | --- | --- | --- | --- |
| `room` | `join_room` | `join_room_async` | `joinRoom` | `JoinRoomAsync` |
| `pool` | `join_pool` | `join_pool_async` | `joinPool` | `JoinPoolAsync` |

## 4. Local Verification

Before deploying, run at least:

```bash
./.builda-online/bin/builda-online check \
  --project-root . \
  --room-source <Room source file or directory> \
  --activity-config builda.online.json
```

This check validates the Room's migration-recovery declaration and source structure before going online, requesting authorization, or uploading source; a successful result must include
`roomTransferRecovery=safe`. `deploy` repeats the same gate, so it cannot be bypassed by skipping the local command.

Then take stock of the files under `<Room source file or directory>` in the command that will be packaged. Do not read or print the contents of suspicious files; if any of the following
paths or types appears, you must stop before authorization and upload, report the path, and ask the user to move it out and check again:

- `.env`, `.env.*`, `.npmrc`, `.pypirc`, `.netrc`, `credentials`, `credentials.*`;
- `id_rsa`, `id_ed25519`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*service-account*.json`, `*credentials*.json`;
- Cloud provider, database, payment, signing, or user-system credentials, exported player data, logs, saves, database files, and backups unrelated to the Room build.

`.gitignore` does not limit what the deployment client packages from source. If the Room directory is mixed with other project content, first narrow it to a standalone Room source root that contains only the current language's source,
dependency declarations, lock files, and resources required for the build; never read, copy, or rename credential files just to pass the check. The survey result reports only
the source root, file count, and rejected paths, and never prints file contents to the terminal or the final reply.

Then run the source Mock scenario for the current language to verify Room business logic, team information, Bot policy, `lockRoom/releaseRoom` or
`lock_room/release_room` calls, and disconnect events. If the AI only modified configuration or the client and did not get the same Room source to pass verification in the current
language, deployment is forbidden. Local results do not mean real WASM, WebRTC/TURN, cross-instance recovery, capacity, or security isolation have passed.

## 5. Run the Deployment

First classify the change according to the main Skill's "Release decision and fixed order". Run the commands in this section only for the first release of a multiplayer game, Room/server configuration changes, or protocol-incompatible upgrades;
for a client-only change when the current revision already has an active Server Release, do not run Room deployment. For a first release or an incompatible upgrade, you
must first sync the client draft, then deploy the Server Release for the same revision, and only then let the user publish the client in the Builda App. A backward-compatible
server-only update keeps the revision and is finished once deployment verification completes; it uploads no Bundle and does not require the user to republish the client.

TypeScript:

```bash
./.builda-online/bin/builda-online deploy <Room source entry .ts or TypeScript source directory containing room.ts> builda.online.json
```

Rust:

```bash
./.builda-online/bin/builda-online deploy <Rust Workspace directory> builda.online.json
```

The deployment client will:

1. Run Builda `check/auth`;
2. Obtain the client draft's `onlineCompatibilityRevision` from the trusted deployment authorization and check it against the local configuration;
3. Upload the source and wait for the controlled build to finish; a finished build creates an immutable `prepared` Server Release;
4. Write all Match Activity snapshots for that compatibility revision;
5. After all configuration succeeds, explicitly activate the Server Release just built;
6. Write the local receipt `.builda-online/last-deployment.json`.

On success, stdout also prints `gameId`, `buildId`, `artifactId`, `sourceSha256`, `onlineCompatibilityRevision`,
`serverReleaseId`, `releaseStatus`, and `matchKeys`, so the AI does not need to read the whole JSON to complete the report.

The receipt is current-machine state listed in `.gitignore`, not user-publishable configuration. The AI reads and reports only `gameId`, `buildId`, `artifactId`, `onlineCompatibilityRevision`, `serverReleaseId`, `releaseStatus`,
`matchKeys`, the client Admission for each public mode, and the source SHA-256; never display, copy, or commit other raw response fields, especially
object storage keys, run-node identifiers, and internal routes. Never save or print authorization credentials, source contents, or unbounded diagnostics.

### When a New Version Takes Effect

Every successful deployment produces a new immutable Room Artifact. The client and Room judge whether the game communication protocol is compatible only through the positive integer
`onlineCompatibilityRevision`; the Bundle ID is used only for download, caching, and integrity, and plays no part in compatibility checks.
The same revision can have multiple different client Bundles, and can also receive multiple backward-compatible Server Releases deployed in succession.
The version boundary is fixed when the Ticket is created; running authoritative objects are never hot-swapped to new code:

- Waiting Tickets and Assignments that already existed before deployment keep using the version fixed at creation;
- After another deployment on the same revision, new Tickets use the latest active Release; existing objects keep using the original Artifact;
- A Pool Room that is already running finishes the current match and does not switch code mid-match;
- Even when a Room looping room calls `releaseRoom` after settlement and starts the next match in the same Room, it still runs the original Artifact; only after the old Room closes and a
  Room is created anew does the new version apply;
- A long-running Room likewise keeps running the original Artifact until it is closed and recreated through the product flow. `migrate-room` only migrates the run location and restores the same
  authoritative state and Artifact; it is not a code upgrade command.

Therefore post-deployment verification must create a new Ticket and record this deployment's target version using the receipt's `artifactId`. When you need to verify a long-running room
upgrade, first have the user confirm an acceptable maintenance window and Room close flow; never silently kick running players just to "take effect immediately".

A client draft can be published only after the same revision already has an active Server Release. For a first release or a revision bump, use this
Room deployment receipt's `releaseStatus=active` as evidence; a client-only change can reuse the revision's existing active Release and does not require
redeploying the Room this time. If the client is published first without an active Release, the Gateway rejects authentication with the stable error
`CLIENT_SERVER_VERSION_UNSUPPORTED`; the client should show "This game
version has no compatible server configured yet. Please update or try again later." and must not retry by entering another version.

## 6. Post-deployment Verification

- First run `builda-online verify` (on Windows, `builda-online.cmd verify`) to obtain the pending
  checklist locked to the target Artifact; it does not use the author's credentials to impersonate real players;
- In the Builda App, use two independent real identities to create new Tickets and enter a new Room, and record the Room ID; never reuse pre-deployment Tickets/Rooms;
- Rerun with the Room ID: `verify --room-id '<room-id>' --joined-player-count 2
  --data-channels control_reliable,game_reliable,state_unreliable --leave-completed`. The command uses only the author's read-only diagnostics authorization
  to automatically check the Room's Artifact; the real player count, DataChannels, and voluntary leave are explicitly confirmed by the operator based on observed runtime
  evidence, and the command does not observe or fake these three pieces of evidence automatically. Without the corresponding client events or network snapshots, never pass
  the completed flags; if any item is missing or inconsistent with the deployment receipt, the result stays `builda-online-verify=pending`;
- Against the deployment receipt, confirm that all `matchKey`s exactly match the confirmation sheet, the project JSON, the client entry points, and the Room branches;
- Verify public auto-matchmaking for each `matchKey`;
- For Pool, verify that commit happens only after all human players enter, and timeout requeueing when a single player fails to enter;
- For Room, verify automatic joining, full-room contention, `locked/released`, and empty-room cleanup;
- Verify that all four client SDKs use the same public control semantics;

## 7. User-initiated Room Migration

Run this only when the game owner explicitly asks to maintain or migrate a specific running Room:

```bash
./.builda-online/bin/builda-online migrate-room '<room-id>'
./.builda-online/bin/builda-online migration-status '<room-id>' '<migration-id>'
```

The commands reuse Builda `check/auth`. The user submits only `room-id`; the platform chooses the run location automatically and restores the same authoritative state. The AI reports to the user only
`room_id`, `migration_id`, the public status, and the final result; it never displays or saves run-node, routing, storage, or other platform implementation fields from the response.
During migration the client SDK pauses switching and rebuilds the Room connection automatically; unreliable messages may be lost during the switching window, and the restored authoritative state is final.
