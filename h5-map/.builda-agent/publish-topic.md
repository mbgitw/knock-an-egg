# Upload and Sync Drafts

> BuildaGame agent toolchain version: 0.4.109

Enter this topic from the base Skill's routing table: read it when the user asks to upload/update a Builda game; for export or packaging details, also read the engine's topic.

## Upload a draft

When the user asks to "upload/update a Builda game", the agent uploads the build and creates/updates the Builda app pending-release draft (commands are the same for all three engines; build formats are in `md_agent_godot.md` / `md_agent_html5.md` / `md_agent_unity.md`):

```bash
./.builda-agent/builda check
./.builda-agent/builda auth
./.builda-agent/builda new-manifest
./.builda-agent/builda publish path/to/web-build.zip
```

`publish` is the default high-level entry: it runs the same bundle validation and upload, then creates or updates the draft automatically based on the project's
`.builda-agent/game.json`. Use `bundle-check`, `upload-build`,
`create-draft`, `update-draft` separately only to locate a failure or reuse an already uploaded build. When the game needs platform audio assets or
large assets (3D models etc., via `res/**`), also run `assets check` and `assets upload` before `publish`.

Treat `publish` as one complete sync command: upload progress only means confirmed bytes; keep waiting through `uploaded`, `validating`, `promoting`.
Only after the server returns `ready` does the CLI write the manifest and sync create/update draft. Only exit code 0 lets you tell the user
"the current Builda version is updated"; report only the draft/build version; do not say the Builda App name, cover, description or promo images have been changed. Never report success early based on
100% upload, `uploaded` or a long time without stage changes. The validation stage has no reliable percentage; the CLI prints a stage heartbeat every 10 seconds,
just keep reading stderr.

On network errors, 429 and temporary service unavailability the CLI backs off and retries automatically; do not start a second concurrent publish. Ctrl-C means pause; after a network drop,
CLI exit or machine reboot, rerun the exact same `builda publish <same zip>`. The CLI resumes the same Upload Session by bundle SHA-256 and game scope,
rotates the short-lived capability, and resumes against parts already in OSS; no need to save the session URL, signed URL or
token. Even if the bundle is `ready` and the draft-sync response was lost, rerunning skips the upload and recovers create/update with a stable idempotency key.
On `409 upload session quota exceeded`, first check the CLI-returned `game_active_session` (1 per game) or
`owner_active_limit` (3 per account) and the actual blocking sessions; you can also run `./.builda-agent/builda upload-list`,
`--all` to query all your games, `--json` for automation (on Windows use `.\.builda-agent\builda.cmd`).
Verify progress with `upload-status` using the returned ID; explicitly `upload-cancel` only sessions confirmed abandoned, then rerun publish;
do not guess session IDs, use historical IDs or bulk-cancel other running uploads. When `canCancel=false`, check the status first;
never force-clear a Validator lease. Retries reuse the original ZIP; repacking may change the SHA-256 so it is no longer a resume of the original session.
If an old server does not support the list or gives no blocking details, keep the raw error and requestId for maintainers; do not guess the missing info is the account limit.
Explicit 4xx, bundle validation failures or terminal Session failures are not masked automatically; fix per the CLI's specific hint, then rerun.

`bundle-check` and other validation commands are the Builda draft upload contract, not suggestions. Whenever they report errors, you must first fix the game export or SDK integration; do not judge "it should upload fine" from prompt text, and do not bypass the checks to upload directly.

Upload `assets.zip` only when the game needs Builda App/FMOD audio (users sometimes mistype it as FM0D), external audio assets, or needs to move large static assets (3D models, textures, Unity AssetBundles etc., dynamically loaded via `res/**`) out of the main bundle; purely offline games with no extra asset needs can skip the two assets steps.

## Game resource package uploads

`builda assets check <assets.zip>` checks the local archive; `builda assets upload <assets.zip>` uses the same
resumable transport helper as the main bundle, with a separate assets session. It is not the standalone add-on tool.
Keep the original ZIP and rerun the same command after interruption. Wait for `ready`: only then does the CLI save
`assetsVersion/assetsBaseUrl/assetsManifestUrl` in the manifest. A server without assets sessions must be upgraded;
the CLI does not fall back to sending the entire resource ZIP through the API.

Defaults are 340 MiB compressed and 1024 MiB total extracted. An existing game's server allowance can raise the
compressed limit to 500 MiB. The extracted hard limit stays 1024 MiB; explicit per-game limits of 320–1024 MiB still apply. Local validation above defaults only indicates that a
server allowance is required; it does not grant permission. Each extracted file is still limited to 32 MiB, at most
10000 files and 20000 ZIP entries. Content and data-only pck checks remain authoritative on the server.

Recovery commands: `builda assets upload-list [--all] [--json]`, `builda assets upload-status <session>`, and
`builda assets upload-cancel <session>`. Inspect before explicitly canceling an abandoned session. Resource sessions
have a separate quota from main bundles. On Windows use `.\.builda-agent\builda.cmd` with the same arguments.

## Common export and packaging reminders

Export and packaging reminders (all engines): the H5 bundle zip may only contain runtime files. The zip **does not include** the SDK JS (`index.html` references root-path `builda-sdk.js`; at runtime the Builda App downloads and injects it from the CDN per the release manifest's `sdk` contract; the old embedded form is still accepted). `builda-sdk.d.ts`, `builda-dev-shell.html`, `project.godot`,
`export_presets.cfg`, `.godot/`, `node_modules/`, sourcemaps (`.map`), `.env`, source directories and editor caches must not go into the zip; Unity project files are likewise forbidden (`*.meta`, `*.csproj`, `*.sln`, `*.unity`, `Library/`, `Temp/`, `Obj/`, `ProjectSettings/` — package only the contents of the WebGL build output directory, never the `Assets/` sources). When `bundle-check` reports such files, repack the zip; do not upload. Above 50 MiB main bundle the CLI gives a non-blocking optimization hint; the applied limit for a new game's first upload (no gameId yet) and for ordinary games is 200 MiB; an existing game owned by the current user can go up to `201..500` MiB only when hit by the server's dynamic allowlist. Do not change URLs, split requests or forge a gameId to bypass limits; to slim down, work through `https://ai.builda.game/agent/releases/0.4.109/md_bundle_size.md` category by category (move large assets out to `res/**`, audio/fonts/textures and engine export settings).
Windows PowerShell must not use `Compress-Archive` directly on the build directory: Windows PowerShell 5.1 may write ZIP entries as `assets\icon.png`, which the server rejects under zip-slip safety rules. Always use `.builda-agent\builda.cmd bundle-pack <build-dir> <output.zip>`; it produces `/`-separated entries via the standard ZIP API. `bundle-check` also rejects backslashes, absolute paths, drive letters and `..` escape paths before upload.
If the local command is `godot4`, replace `godot` in export commands with `godot4`, and first run `./.builda-agent/builda godot web-template-check godot4`.

On Windows, likewise enter the project root first, then use project-relative paths:

```powershell
.builda-agent\builda.cmd check
.builda-agent\builda.cmd auth
```

## New game vs updating an existing game

- New game: `publish <build.zip>` automatically runs `upload-build -> wait for ready -> create-draft`; only on success does it write the gameId and report that the current Builda version is updated and the cysj pending-release draft is synced; there is no gameId during the first upload, and you must never pre-create an empty game.
- Updating an existing game: when the current project directory has `.builda-agent/game.json`, `publish <build.zip>` automatically runs `upload-build -> wait for ready -> update-draft`, then stops and reports the same way.
- For both new and updated games, before submitting the draft confirm the manifest has `minChromeMajor` / `minIOSMajor` evaluated from placeholders to the lowest versions the build actually runs on (lower reaches more devices, see `md_agent_manifest.md`); if an old manifest lacks these two keys, evaluate and add them first; preflight rejects missing or placeholder submissions.
- When changes touch privateKV, payments or leaderboards, check stable identifier design against `.builda-agent/sdk-guidance/<sdk-version>/md_persistent_ids.md`; do not casually change existing `privateKV key`, `payId` or `rankId`.
- `.builda-agent/game.json` is the project identity file, in the current project's `.builda-agent/` directory. It records `gameId/title/lastVersionId/updatedAt`, one file per project; when the user maintains several games, the agent must enter the corresponding project directory before operating.
- After `create-draft` succeeds the CLI writes `.builda-agent/game.json` automatically. `update-draft` also updates it on success.
- If the current project has no `.builda-agent/game.json` but the user explicitly says it is an existing game, you must have the user provide the target `game_id` once and run `update-draft <game_id>`; on success the CLI writes the binding into the current project directory.
- A legacy `builda.game.json` in the project root is migrated by the CLI to `.builda-agent/game.json` automatically.
- `.builda-agent/last-game-id` is only a weak recovery receipt; it cannot replace the `.builda-agent/game.json` that should be committed, and must not be used automatically as a cross-project update target.
- `update-draft` syncs the Builda pending-release draft and switches the current Builda version; it does not affect releases already public on the Builda platform. Later updates keep saving the `title` candidate and syncing the build; do not use `coverUrl` / `advert` / `images` to change the Builda App display, and do not promise that renaming the draft overrides a name already filled in in the Builda App. On success report only the draft/build version; do not say the Builda App display has been changed.

## Closing message

After a create or update sync succeeds, close with a short message; do not give a trial-play URL and do not call Builda publish again:

```text
The current Builda version is updated and the Builda pending-release draft is synced: title "...", gameId ..., currentVersionId ..., bundleVersion ..., orientation .... Next, try it in the Builda app, and once it looks right, complete review and release.
```
