# Builda Online Agent Setup

> User environment: online (`online`)
>
> Setup entry: https://ai.builda.game/online/setup.md
>
> Delivery manifest: https://ai.builda.game/online/releases/0.12.1/manifest.json
>
> The user has only two environments: local and online. Online addresses are locked by the manifest; local uses the open-source Mock of the current Room language.
> Builda Online deliverables are released in the same version as the Builda SDK: the project's `.builda-agent/sdk-version` is the only version lock,
> and install and upgrade only use the immutable snapshot described by `https://ai.builda.game/online/releases/<that version>/manifest.json`.

Always reply to the user in the language they use. This guidance is written in English; that does not change the language you talk to the user in.

You are installing Builda Online for a game already integrated with Builda. Builda Agent Server handles authorization, game binding, and client publishing; Builda Online handles online matchmaking, Rooms, and the gameplay data plane. You are the AI in the user's project: use only this document, the installed Skills, public SDKs, public docs, and the user project; never read or infer the platform repository, internal environments, branches, clusters, or ops config.

## Prerequisite checks

1. Locate the real game project root and read the project rules.
2. Confirm `.builda-agent/SKILL.md`, the Builda CLI, and `.builda-agent/sdk-version` exist; otherwise use the manifest's `runtime.builda_setup_url` to install Builda, run `sdk install`, then come back.
3. Read the Builda Skill and run `check` and `engine detect`. Run `auth` only when you need to create or bind a game, deploy a Room, publish the client, or
   do online testing with a real identity; if `.builda-agent/game.json` already exists and you only use the local Mock, do not require login.
   The Builda CLI does not handle Room releases; do not call its `online` subcommand.
4. Read the bound game ID from `.builda-agent/game.json#gameId`; if the file does not exist, first create or bind per the Builda Skill; never guess.
5. Choose exactly one client SDK from project evidence: Godot, H5, Cocos, or Unity. Cocos supports only Creator 3.8 LTS
   Web Mobile/Web Desktop and uses the separate `@cysj/online-cocos` package. Unity projects always use the separate Unity SDK
   `com.cysj.online` and its C# API; never install the H5 SDK or call `@cysj/online-h5` in a Unity project.
6. From `package.json`/`tsconfig.json`/`@cysj/room` or `Cargo.toml`/`cysj-room-sdk`, choose only one Room language. Ask only when evidence conflicts or a new project cannot tell. JavaScript and other languages are not supported.
7. TypeScript Room checks only the Node toolchain; only a Rust Room checks Cargo, rustc, and `wasm32-wasip2`. Never add unrelated toolchains to install another language's deliverables.
8. Use a Python 3.9+ the host can currently run to execute `import sys; print(sys.executable)`, and record the normalized absolute path. An interpreter the host provides but
   that is not on `PATH` is equally valid; do not modify the system `PATH` just so the launcher can guess it.

Installation only sets up tools and SDKs; it does not decide the game's multiplayer product. After downloading any SDK and before changing any multiplayer business file, the user AI
must first read the installed `references/matchmaking-guide.md` to inventory the public capability boundaries, and use project evidence to complete the
"multiplayer plan confirmation": the single client engine, the single Room language, stay in the same room after a match / newcomers join a running world directly / return to the lobby and re-matchmake after the match,
public automatic matchmaking, client entry points for multiple `matchKey`s, player counts and Teams, Bots, Confirm, endgame, trust model,
tampering risk, and Room handling.
When starting the client, you must read all of `references/client-lifecycle.md` to learn the only
state boundaries from Admission to the first gameplay frame, recovery, and exit, and read only the one lifecycle example for the chosen engine; then read `references/client-sdk-selection.md` and
`references/common-flows.md`, using only the chosen engine's public methods and correct call order; never reverse-engineer the wire protocol from SDK-internal control messages.
Load other references per the Skill's "Read by phase" table.
When information is insufficient, ask 1–3 questions that decide the state machine per round and wait. First give examples from common patterns such as Honor of Kings/LOL normal matchmaking, CF/CS looping rooms, Legend of Mir/
World of Warcraft shards, or Minecraft servers, and explain how players gather, the match starts, mid-match joining, and where settlement leads; if the author is still unsure,
then ask "A and B are already playing; what happens when C presses Start now?". Never ask only "drop-in/drop-out / match one game", and never use examples to choose for the user by default.

## Verify the delivery manifest

The delivery manifest is verified automatically by the deploy client's `builda-online install`: `schema_version`, `environment=online`,
`release_id` equals the version lock, `setup_url`/`manifest_url` belong to `public_base_url`, `support.*` includes the chosen engine and Room language,
`runtime.deployment.client=builda-online`, `room_mocks.behavior.rooms_per_process=1`,
`transport=local_mock_websocket`, `room_runtime=language_mock`, `executes_room_source=true`, `builds_wasm=false`,
`uses_webrtc=false`, `simulates_real_auth=false`, `simulates_matchmaking=false`, `provides_security_isolation=false`,
both `room_mocks.<language>` have `archive_layout=project_root`, `install_directory=.`, `contracts_directory=contracts`,
and `package_directory` and `sdk_directory` point to the same-language Mock and Room SDK respectively; every component's version and download URL must be in
the same immutable snapshot and pass SHA-256 verification.

If any item does not match, the command fails and names the field. Then stop and report the deliverable problem; never hand-assemble URLs, fall back to the platform repository, switch to another
language, or fake a completed install. You only need to confirm yourself that `https://ai.builda.game/online/releases/0.12.1/manifest.json` is reachable and `environment=online`.

## Download and install

Install and upgrade are guided by the Builda CLI and performed by the deploy client `builda-online`; do not manually download or extract SDKs or rewrite dependency manifests.

1. At the project root run `./.builda-agent/builda check` (on Windows `.\.builda-agent\builda.cmd check`); it updates the Builda CLI and the base
   Skill to the latest version; when it prints `builda-agent-skill-updated=1`, re-read `.builda-agent/SKILL.md`. If `.builda-agent/sdk-version`
   is missing, first run `sdk install` per the Builda Skill; if the version is below 0.5, that version has no multiplayer deliverables and needs user confirmation before running `sdk upgrade`.
   Do not rewrite the version lock yourself.
2. Run:

   ```bash
   ./.builda-agent/builda sdk install --with-online
   ```

   On Windows use `.\.builda-agent\builda.cmd sdk install --with-online`. The Builda CLI (0.4.56+) reads the `online` block of the base manifest per the version lock,
   verifies the SHA-256 of the same-version Online manifest, installs the multiplayer development Skill and the deploy client, then automatically runs
   `./.builda-online/bin/builda-online install --manifest-url https://ai.builda.game/online/releases/<version lock>/manifest.json`.
   No arguments are needed when the engine and Room language can be uniquely determined from project evidence; when the CLI prints `online-install=needs-room-language`, ask
   the user per the prerequisite-check rules, then run `./.builda-online/bin/builda-online install --room-language typescript|rust` (or append the same argument
   to `sdk install --with-online`); when it prints `online-install=needs-client-sdk`, append `--client-sdk godot|h5|cocos|unity`. Output `online=not-included`
   means that SDK version has no multiplayer deliverables; stop and tell the user. If the CLI reports `Unknown sdk install option`, the CLI is too old; first run
   `./.builda-agent/builda update` and retry. Do not manually download the Skill zip or extract SDKs.
3. `install` only reads the immutable manifest per the version lock and verifies each SHA-256; on failure it does not modify the project. Controlled directories it writes:
   - Multiplayer development Skill → `.agents/skills/builda-online/`, log diagnostics Skill → `.agents/skills/builda-online-diagnostics/`.
     Claude Code, Cursor, Cline, Roo Code, Windsurf, and other entries only statically point to these two originals and do not keep separate copies;
   - Builda Online's own deploy client → `.builda-online/bin/` (a copy of the Skill's `bin/`); when the client updates itself it automatically hands off to the new version
     to continue installing. It is used only to install/upgrade deliverables and deploy online source: request authorization, upload source, wait for the online build, and activate the Match Activity;
     it must not call the Builda CLI's legacy Online capabilities;
   - The single client SDK: Godot → `addons/cysj_online/`; H5 → `vendor/builda-online/client-sdk/h5/` and writes
     `@cysj/online-h5=file:vendor/builda-online/client-sdk/h5` into the project `package.json`; Cocos →
     `vendor/builda-online/client-sdk/cocos/` and writes `@cysj/online-cocos`; Unity →
     `vendor/builda-online/client-sdk/unity/` and writes
     `com.cysj.online=file:../vendor/builda-online/client-sdk/unity` into `Packages/manifest.json`. The chosen client SDK is a project dependency under the project's version control;
   - Same-language Room SDK and Mock as a project-root overlay: it only replaces `contracts/`, `server/<language>/` (Room SDK), and
     `server/mock/<language>/` (Mock), touching no other files, so no duplicate `server/mock/<language>/server/...` directory appears;
   - Appends `/.builda-online/` to `.gitignore`; writes a credential-free `.builda-online/installation.json`; deletes the old
     `manifest-check.json`.
4. Read `roomSdkDependency` from the command output and reference the Room SDK and Mock as local dependencies in the Room source directory: for TypeScript, write
   `@cysj/room=file:<relative path to server/typescript>` in the Room's `package.json`; for Rust, write
   `cysj-room-sdk = { path = "<relative path to server/rust>" }` in Cargo.toml, with the Mock referenced via an optional `local-mock` feature; the online `--lib`
   build must not enable that feature. TypeScript Room checks only the Node toolchain; only a Rust Room checks Cargo, rustc, and `wasm32-wasip2`.
5. Create `builda.room.local.json` as the non-secret local Scenario. It describes only the Room's final inputs, Roster, teams, and bots, not the
   platform matchmaking process.
6. Run `./.builda-online/bin/builda-online check` (on Windows `builda-online.cmd check`) and confirm
   `onlineRelease` equals `sdkVersion`, and that the Builda game binding, the single client SDK's actual version, `clientSdkVersion`, and the protocol version
   are consistent; then re-read both newly installed Skills' `VERSION` and `SKILL.md`, and only after comparing them exactly with the install record may you report a successful install.
7. Upgrades only follow the version lock: after the user runs `./.builda-agent/builda sdk upgrade` to advance `.builda-agent/sdk-version`, `check`
   reports `ONLINE_RELEASE_DRIFT`; then run `./.builda-online/bin/builda-online upgrade`. Do not access the
   manifest on a time schedule, do not upgrade because a new multiplayer feature starts, and do not use the root `manifest.json`'s `release_id` to judge "there is a new version".

## Development duties after install

Once the user asks to start multiplayer development, the AI must proactively maintain the complete implementation in version control:

1. Create or update the root `builda.online.json` with the confirmed multiple `matchKey`s, public automatic matchmaking, and freeze policy;
2. Create or update the current-language Room source directory, implementing the author-confirmed room logic, input validation, room lock/release, disconnects, snapshots, and endgame; `server/`
   is only the recommended directory name; existing projects using another conventional directory keep their actual path;
3. Change only the chosen engine's client, wiring up the confirmed matchmaking, connection, room leave, and error UI; when implementing Admission, Ticket,
   Room, or scene exit you must read `references/client-lifecycle.md`, save the latest Ticket, and wait for cancellation or explicit room leave to close out;
4. Sync the message protocol and `builda.room.local.json` and run the current-language Mock.

Never treat `builda.online.json` as a file generated only at deploy time, never wire up only the client and leave the server for the user to write, and never
create both TypeScript and Rust Rooms. You may leave these files unchanged only when the user explicitly asks for a read-only review.

## installation.json

`builda-online install` generates a credential-free `.builda-online/installation.json` with fields:

- `environment`, `releaseId`, `sdkVersion` (all equal to the version lock), `publicBaseUrl`, `manifestUrl`, `immutableManifestUrl`,
  `setupUrl`, `apiBaseUrl`, `buildaAgentApiBaseUrl`, `gatewayUrl`, `defaultQueueName`;
- `skillVersion`, `diagnosticsSkillVersion`;
- the full `deployment` object;
- `clientSdk`, `clientSdkVersion`, `clientProtocolVersion`;
- `roomLanguage` and its `serverSdkVersion` and `roomMockVersion`;
- `roomContractVersion`, `localMockProtocolVersion`;
- `pythonInterpreter`: absolute path of the Python 3.9+ that ran the install command;
- `gameIdSource=.builda-agent/game.json#gameId`;
- `localRoomMock.gatewayUrl=ws://127.0.0.1:7350/ws`, `healthUrl=http://127.0.0.1:7350/health`,
  `configUrl=http://127.0.0.1:7350/config`, `implementation` from the manifest's current-language record, `roomRuntime=language_mock`,
  `transport=local_mock_websocket`, `buildsWasm=false`, `usesWebRtc=false`, `simulatesMatchmaking=false`,
  `providesSecurityIsolation=false`;
- `version` and `sha256` of `components.<skill|diagnostics_skill|client_sdk|server_sdk|room_mock>`, used by the next
  `install`/`upgrade` to tell which components are byte-identical and reusable.

Field mapping uses the manifest's original fields: `public_base_url`, `manifest_url`, `setup_url`, `skill.version`,
`diagnostics_skill.version`, `runtime.api_base_url`, `runtime.builda_agent_api_base_url`, `runtime.gateway_url`,
`runtime.default_queue_name`, `client_sdks.<engine>.version`, `server_sdks.<language>.version`,
`room_mocks.<language>.version`. Do not edit this file by hand; it contains no runtime token, Builda grant, deploy code, deploy token,
cookie, or `local:` identity.

## Local verification

1. TypeScript:

   ```bash
   builda-room-mock \
     --room <entry .ts inside the Room source root> \
     --source-root <Room source root> \
     --sdk <@cysj/room directory installed in the project> \
     --scenario <path to builda.room.local.json>
   ```

2. Rust:

   ```bash
   cargo run --manifest-path <Room Workspace/Cargo.toml> --features local-mock --bin local -- --scenario <path to builda.room.local.json>
   ```

3. Use two clients with different `local:<player-id>` to verify join, state, messages, tick, abnormal disconnect, and leave. Room/Pool both go straight into the current single Room.
4. Before the first Ticket, confirm `/health` shows `lifecycle=idle`, `active_rooms=0`; after all human occupancy is gone and the empty-room grace period has passed, confirm that state
   again, and verify the next Admission gets an incremented `room_generation`; do not restart the Mock manually instead of this verification.
5. The local Mock does not verify WASM, WebRTC, TURN, real auth, matchmaking algorithms, distributed recovery, capacity, performance, or security isolation. To check online build compatibility, run the current language's WASM build/check separately; local artifacts are not uploaded.

## Online verification and deployment

The short-lived runtime token the Builda App provides at runtime is kept only in memory and passed to the chosen client SDK; never write it to URLs, logs, privateKV, files, or saves. Local `local:` identities cannot be used online.

Builda App loads the real game Bundle from on-device `http://127.0.0.1:<dynamic port>`, so the client must never use
`location.hostname`, `localhost`, or `127.0.0.1` to decide it is using the local Room Mock. Web local testing trusts only
`builda_mock_shell=1` injected by the `builda dev` test shell; `.builda-online/bin/builda-online check` rejects such
dangerous checks and returns `UNSAFE_LOCAL_RUNTIME_DETECTION`.

Only when the user explicitly asks to deploy or go live, read the Skill's deployment flow and run `.builda-online/bin/builda-online deploy`. Online always uploads source and the platform rebuilds the Artifact; never upload or trust local Mock/WASM artifacts. Before authorization and upload you must, per `references/deployment.md`, inventory only the file paths of this Room source root, rejecting env files, private keys, cloud credentials, user data, and files unrelated to the build, without reading or printing their contents. After a successful deploy, verify matchmaking, Room join, and the three logical channels with two real identities; normal networks must keep WebRTC as the primary link; never switch transports in game code just to test fallback.

After install, read `.agents/skills/builda-online/SKILL.md` and load references per its "Read by phase" table: for planning, automatic matchmaking,
Room lifecycle, or Bots read `references/matchmaking-guide.md`; before writing or reviewing client multiplayer code read all of
`references/client-lifecycle.md`; for local debugging read `references/local-testing.md`; for deployment read
`references/deployment.md`. To write, query, or analyze online Room logs, read
`.agents/skills/builda-online-diagnostics/SKILL.md` instead.
