---
name: builda-online
description: "For a Godot, H5, Cocos, or Unity game on Builda: clarify the multiplayer plan first, then build Builda Online hosted multiplayer. Use to build or change multiplayer, matchmaking, rooms, WebRTC DataChannel, client, TypeScript/Rust Room, local testing, Room build/deploy, or end-to-end tests; also to coordinate both release chains (Builda client draft, Builda Online Room Artifact)."
---

# Builda Online Multiplayer Development

Always reply to the user in the language they use. This guidance is written in English; that does not change the language you talk to the user in.

Use only the project engine's public client SDK (Godot, H5, Cocos, or Unity) and the user Room SDK; build the game as "client +
Builda Online hosted Room". Builda Agent Server handles authorization, game binding, and client draft publishing; Builda Online handles matchmaking, Rooms, and
the gameplay data plane. User tasks only need these two public entry points for authorization, release, and multiplayer.

## Delivery version gate

Builda Online deliverables are released in the same version as the base Builda SDK. The only version lock is `.builda-agent/sdk-version`; multiplayer deliverables
never update alone or compare manifests by time window. `.builda-online/installation.json#releaseId` records the installed snapshot;
it must equal the lock.

After project rules, before on-demand references or multiplayer edits, read `.builda-online/installation.json` and both Skills'
`VERSION`, then run `.builda-online/bin/builda-online check`:

- `onlineRelease=<version>` equal to `sdkVersion=<version>`: this is the right snapshot; do not access the
  manifest or upgrade because a new multiplayer feature starts.
- `ONLINE_RELEASE_DRIFT`: the user's `builda sdk upgrade` advanced the lock. Run
  `.builda-online/bin/builda-online upgrade`: it reads the immutable manifest
  `${publicBaseUrl}/releases/<version>/manifest.json` per the lock, verifies each SHA-256, updates both Skills, deploy client, single client SDK,
  same-language Room SDK and Mock, and rewrites the install record; unchanged components print `component=<name> reused`. Then re-read the new
  `SKILL.md`, run `check`, and continue per the new Skill's workflow.
- `onlineRelease=unrecorded`: an old manual install. Run once
  `.builda-online/bin/builda-online install --manifest-url ${installation.json#manifestUrl}` (use
  `${publicBaseUrl}/manifest.json` if the old install lacks that field) to record `releaseId` and component digests.

Only a user-requested `builda sdk upgrade` upgrades; never edit `.builda-agent/sdk-version` yourself, never read the root
`manifest.json` to judge "is there a new version", never guess versions from cache filenames, examples, release IDs, build time, or platform internals.
Client SDK, server SDK, and same-language Mock are project dependencies kept in version control after `upgrade`; never overwrite a single file or
keep an old Skill. Before uploading the client (`builda publish`) or Room source (`builda-online deploy`), `check` must pass again;
`deploy` also rejects drift.

If the manifest is temporarily unreachable, `upgrade` fails and changes nothing. You must not claim the install is updated, change code relying on new SDK semantics,
deploy, or run online diagnostics; you may keep a read-only project inventory and tell the user the version is unconfirmed.

## Protocol compatibility revision

The root `builda.online.json` must keep a positive integer `onlineCompatibilityRevision`. It is the only client-Room
game protocol compatibility key, distinct from the client Bundle ID, Builda draft version, Room `version`, and Server Release ID.

Keep the revision by default. Text, UI, images, audio, client-local presentation, or Room fixes compatible with existing client messages
do not bump. Bump only when old clients can't encode requests, understand responses, or keep the state machine, e.g. removing or
redefining message fields, changing message code meanings or required handshake order, or old clients can't finish a match. New optional fields,
server tolerance, and logic fixes keeping message semantics usually don't bump. Never hash source or the whole Bundle to decide compatibility.

Before each protocol change answer: does the new Room still accept old clients' messages; can old clients still understand
the new Room's messages; do the existing join, reconnect recovery, and settlement state machines still hold. All three "yes": keep the revision; only if any is "no"
recommend a bump, and tell the user the affected old clients before changing config. After a bump you must close the loop: "update client draft -> deploy and activate
the same-revision Server Release -> publish the client". If `builda-online check` or `deploy` finds the client draft revision differs from config,
stop and run the Builda draft sync first; never change the Bundle ID or re-upload identical code to bypass it.

`builda-online check` prints `compatibilityReviewRequired=true`, three `compatibilityQuestionNStatus=pending`
and the questions; it never fakes manual review as an automatic verdict. Legacy
`compatibilityDecision` and `compatibilityQuestionN` are transition-period output only;
`compatibilityDecisionDeprecated=true` means new flows must not treat them as a finished review.
`initialRevision=true` only means config uses first revision `1`, not that a real Ticket/Room was verified.

## Release decision and fixed order

On "release", "update", or "go live", first answer the three compatibility questions, then pick exactly one branch below. Here
`./.builda-agent/builda publish` only uploads the Bundle and syncs the pending Builda draft; "publish the client" is only the final release and review the user
starts in the Builda App; different actions.

| Branch | revision | Order the user AI must follow |
| --- | --- | --- |
| First release of a multiplayer game | First positive integer, usually `1` | Verify local client and Room -> `builda publish` syncs client draft -> `builda-online deploy` builds and activates same-revision Server Release -> verify target Artifact with a new real Ticket/Room -> ask user to publish client in Builda App |
| Client-only change | Unchanged | Confirm the revision has a usable active Server Release -> build, `builda publish` -> draft playtest -> ask user to publish client in Builda App; never run `builda-online deploy` or redeploy the Room because the Bundle ID changed |
| Room or server config change, compatible with old clients | Unchanged | Verify Room locally -> `builda-online deploy` -> verify new Artifact with a new Ticket/Room on old client protocol; only if the client also changed: `builda publish`, draft playtest, hand off for publishing; a pure server update uploads no Bundle and does not republish the client |
| Client and Room protocol incompatible | Bump once | Finish new client and Room together -> `builda publish` syncs new-revision client draft first, unpublished -> `builda-online deploy` activates same-revision Server Release -> verify with a new real Ticket/Room -> ask user to publish client in Builda App |

Never invent a fifth order. A client-only change reuses the existing active Release and requires no deploy receipt this time; on first release or a revision bump
the target revision has no active Release, so the Room deploy must finish before publishing the client. A compatible Room update instantly changes the active Release
for new Tickets of that revision, so confirm backward compatibility first; existing Tickets and running Rooms stay pinned to the original
Artifact. If project evidence can't confirm compatibility or an active Release, stop publishing and tell the user
what evidence is missing; never trial-and-error via blind revision bumps, Bundle re-uploads, or pointless server redeploys.

Server log writing, online log queries, exit reasons, and log performance go to the separate `builda-online-diagnostics` Skill.
For those, read `.agents/skills/builda-online-diagnostics/SKILL.md`; this Skill covers only multiplayer gameplay;
do not duplicate the diagnostics flow.

## AI identity and environment model

You are the user AI in a game developer's project, not the Builda Online platform dev AI. Use only this Skill, public SDKs,
public docs, and user project code; never read, search, or infer the platform repo, trusted service source, internal test environments,
branches, clusters, or ops config.

The user has only **local** (current Room language's open-source Mock runs the same source) and **online** (real service locked by the install record; no test or
sandbox server). Install record URLs are opaque online endpoints; see
[Environment model and config identity](references/environment-and-identity.md).

**Never infer the environment from the page address.** Builda App downloads the game Bundle and loads the real online game via on-device
`http://127.0.0.1:<dynamic port>/...`; so a `window.location.hostname` of `localhost` or
`127.0.0.1` never means the local Room Mock. Web local testing trusts only `builda_mock_shell=1` explicitly injected by the
`builda dev` test shell; native Godot editor runs may trust the engine editor flag.

## Hard constraints

- For a new or materially changed multiplayer flow, start read-only planning: until you read the [Matchmaking scenario guide](references/matchmaking-guide.md) and the author
  confirms the "multiplayer plan confirmation", do not write client code, `builda.online.json`, or Room source;
  never pick by default, enable all capabilities at once, or generate config first and explain later. After confirmation, one implementation proactively maintains config, the single client, current-language
  Room, message protocol, and local Scenario.
- AI must not default to "server authoritative" or "pure relay" for the author. Before implementing, explain plainly: client-reported data
  can be tampered, replayed, sped up, or forged; more Room validation, arbitration, recompute, or snapshots costs CPU, tick, broadcast,
  migration recovery, and capacity budget. Clients may send inputs, intents, candidate state, or state to relay; the author must knowingly confirm how the Room handles
  each message type: reject, trim, validate, arbitrate, recompute, rate-limited relay, direct relay, or presentation-only sync. If the author explicitly picks
  client authority, weak validation, or pure relay, you may implement it, but plan confirmation and delivery notes must state tampering risk, use cases, and that it
  is not anti-cheat or strong fairness.
- Once the language is set, strictly isolate toolchains and docs. A TypeScript Room only installs, reads, edits, verifies the TypeScript SDK;
  never check or install Rust, `rustup`, Cargo, the `wasm32-wasip2` target, or run any `cargo` command.
- Public SDKs only: no own ports, data plane, signaling, matchmaking, or auth; never pick or assemble online fallback entries, edit SDK internals, upload local `.wasm`, or call the Builda CLI
  `online` subcommand; report gaps, never fake success.
- Never guess URLs, `gameId`, or credentials; tokens stay in memory. Deploy only on explicit user request; before upload inventory source paths only; stop on env files, private keys,
  cloud credentials, or user data; report only public fields.
- Local Mock results must not pose as WebRTC, TURN, cross-instance recovery, or online capacity verification.

## Read by phase

After the version gate read only current-phase docs (next group at next phase); only the chosen engine example and Room language doc.

| Phase | Must read (as needed) |
| --- | --- |
| Task start | `references/project-checks.md` |
| Plan/interview | First `references/matchmaking-guide.md`, then `references/plan-gate.md` and "Automatic selection rules" in `references/client-sdk-selection.md`, then confirm with the author |
| Write client | `references/development-guide.md`, `references/development-guide-client.md`, `references/client-sdk-selection.md`, all of `references/client-lifecycle.md` plus one of `references/client-lifecycle-godot.md` / `references/client-lifecycle-h5-cocos.md` / `references/client-lifecycle-unity.md`, `references/common-flows.md`, `references/environment-and-identity.md` (plus `references/payload-optimization.md` when designing messages) |
| Write Room | `development-guide.md`, `references/development-guide-room.md`, one of `references/room-typescript.md` / `references/room-rust.md`, `references/resource-limits.md`, `payload-optimization.md`, "Room gameplay templates" in `common-flows.md`; changes to Room lifecycle (create, join, leave, close, reconnect, migration recovery) or matchmaking (Ticket, Pool/RankPool, Confirm, private room join) must read all of `client-lifecycle.md`; optional for gameplay rules, message content, or resource budget only |
| Player data and payment | `references/room-cloud-state-and-payment.md` |
| Local testing | `references/local-testing.md`, "Verification" in `development-guide.md` |
| Online deploy | `references/deployment.md`, `resource-limits.md`, `environment-and-identity.md` |
| Troubleshooting | "Common stable error codes" in `client-lifecycle.md` (logs, exit reasons: read the diagnostics Skill) |

Authorities: matchmaking scenario guide for capabilities and requirements; `client-sdk-selection.md` alone maps public SDK methods; `client-lifecycle.md` alone
governs client lifecycle, control frames, and error codes (never assemble another state machine elsewhere); `common-flows.md` for correct common-feature flows; `resource-limits.md` alone covers
Room resource limits; logs and diagnosis belong only to the diagnostics Skill, which does not redefine the state machine. Before delivery report results per
"Completion criteria" in `development-guide.md`.
