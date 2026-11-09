# Environment Model and Configuration Identity

This page is the full version of the main Skill's "AI identity and environment model" plus the "Configuration and identity" rules; read it before writing the client, doing online integration testing, or deploying.

## AI identity and environment model

You are the user AI running in the game developer's project, not the Builda Online platform development AI. You may only use this Skill, the public SDKs,
public documentation, and the user's project code; you must not read, search, or infer the Builda Online platform repositories, trusted service source code, internal test environments,
branches, clusters, or operations configuration. How the platform is developed and released internally is not part of the user's task.

The user has only two environments:

- **Local**: the user runs the same business source code directly with the open-source Room Mock for the current Room language. Each Mock process runs at most one
  concurrent Room, created on the first Admission and destroyed automatically after all human occupancy is gone and the local empty-room grace period has passed; the next Admission
  creates a new Room generation. The Mock provides synthetic identities, lifecycle, state, messages, and a loopback WebSocket; it neither contains nor imitates the platform's production service logic.
  Room and Pool Admission go directly to the same local Room; Match, WebRTC, TURN, cross-instance recovery,
  capacity, and security isolation still require online verification. The Mock runs source code with the current system user's permissions; only run your own or reviewed code.
- **Online**: the real Builda Online service locked by `.builda-online/installation.json`. Uploading Room source code really builds an
  Artifact and, after all configuration succeeds, activates the Match Activity and Server Release for the current compatibility revision, which may immediately affect real players on that revision; there is no test server, staging server, or
  sandbox server for users to try uploads on. Only run deployment commands when the user explicitly asks to deploy or go live.

The URLs and default identifiers in the installation record are online configuration that must not be guessed or replaced. Even if a domain contains platform-internal identifiers, treat it only as
an opaque online endpoint; do not introduce platform-internal concepts such as `debug`, `test`, `release`, or "test server" to the user.

**Never infer the environment from the page address.** The Builda App downloads the game Bundle and loads the real online game through the on-device
`http://127.0.0.1:<dynamic port>/...`; therefore `window.location.hostname` being `localhost` or
`127.0.0.1` never means the local Room Mock is in use. Web local integration testing recognizes only the
`builda_mock_shell=1` explicitly injected by the `builda dev` test shell; native runs in the Godot editor may recognize the engine's editor flag. Never choose `localRoomMock.gatewayUrl` based on hostname, protocol, port, or whether the URL
is a loopback address; otherwise a real device will wrongly connect to port 7350 on the device itself.

## Configuration and identity

- Do not guess environment URLs, `gameId`, runtime tokens, Room deployment addresses, or credentials. Gateway, online API, and SDK initialization defaults
  are read from `.builda-online/installation.json`, and the game ID is read from the `gameId` in `.builda-agent/game.json`.
  Public Match always uses the user-confirmed `matchKey` from `builda.online.json#matchKeys`; the installation record's
  `defaultQueueName` is only an SDK initialization compatibility field and cannot replace or override multiple `matchKey` values.
- `matchKey` is a gameplay entry, for example `casual-5v5` or `custom-room`. When starting matchmaking, pass only the current entry's `matchKey`; the client
  must not upload player counts or policies on the fly.
- The local Mock uses `local:<player-id>` synthetic identities; do not write tokens into the repository, logs, URLs, privateKV, or saves.
- Local process configuration may only be consumed by the selected client SDK's public Client/Session entry; game business scripts must not read
  `CYSJ_*` environment variables directly. When the same client needs to switch to the local Mock, use only the explicit test shell marker or editor flag above;
  never check `location.hostname`, `localhost`, or `127.0.0.1`.
- In the Builda App, obtain the short-lived runtime token for the current game and current player through `Builda.requestToken()` (`builda.request_token()` in Godot),
  and hand it only in memory to Builda Online `restore_session`. Request it again when it is close to expiry; never write the token into
  privateKV, local files, saves, logs, or URLs. A local `local:` token cannot be used for real online integration testing.
- The player's stable identity is Builda's `roleId`. The client `session.userId` (`session.user_id` in Godot), the Room-side
  `client.userId` and `client.roleId` (`user_id` / `role_id` in Rust), the `userId` of `sendToUser`, and the `userId` in Presence and
  `roster` are all the same value, namely the current player's `roleId`, identical to the roleId used by Builda `getRoleInfo`.
  Use it as the key for cross-match saves, leaderboards, and player display; `sessionId` only identifies one connection and changes after reconnect, so it cannot be used as the player identity.
- `setup.md`, the manifest, and SDK downloads are public entries; game binding, client package upload, Room deployment, and real-player multiplayer must
  be authenticated. A protected API returning `401` without valid credentials is the correct result; go back to the Builda `auth` or runtime token acquisition flow,
  and never bypass authentication or mix up the publish grant, deploy session, and player runtime token.
- Before going live, you must follow [Online Deployment Workflow](deployment.md) to inventory the files under this Room source root that will be uploaded. Check only paths and
  file types, never output credential contents; if you find environment files, private keys, cloud credentials, user data, or other files unrelated to the Room build, you must
  stop before authorization and upload, and ask the user to move them out and re-check. Never assume a file will not be uploaded just because `.gitignore` ignores it.
- Apart from the public installation fields this Skill explicitly requires, treat everything in the manifest as opaque release metadata, and do not write it into user configuration or the final report. After deployment report only
  `gameId`, `buildId`, `artifactId`, `sourceSha256`, `matchKeys`, and the public Admission; do not show or copy raw service
  responses, object storage keys, runtime node identifiers, or internal routes. When a build fails, relay only the length-limited public diagnostics from the deploy client.
- Bot backfill is explicitly enabled by each `matchKey`'s policy in `builda.online.json`. Bots are not platform users and do not create
  runtime tokens, Tickets, Sessions, or WebRTC connections. The client cannot choose or override the Bot policy.
