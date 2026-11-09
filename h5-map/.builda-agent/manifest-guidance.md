# Manifest (builda.publish.json)

> BuildaGame agent toolchain version: 0.4.107

Enter this topic from the base Skill's routing table: read it when creating/editing the manifest, choosing a category, filling minimum browser versions, or configuring leaderboards/IAP/Schemas.

`builda.publish.json` is the single source of truth for the draft:

```json
{
  "title": "Your game",
  "tagline": "One short sentence about the game.",
  "desc": "What players should know before playing.",
  "category": "",
  "engine": "godot",
  "tags": ["godot"],
  "orientation": "landscape",
  "minChromeMajor": 0,
  "minIOSMajor": 0,
  "coverKind": "palette",
  "coverPalette": "ember",
  "buildPrefix": "",
  "buildEntry": "index.html",
  "buildSize": 0,
  "bundleUrl": "",
  "bundleMd5": "",
  "bundleVersion": "",
  "bundleEntry": "index.html",
  "bundleSize": 0
}
```

`engine` is written automatically by `new-manifest` from directory detection (`godot|h5|unity`, which also sets the `tags` default); bundle-check and upload pick validation rules by it; do not hand-edit it to a value that does not match the project.

Builda App release display boundary (name, cover, description, promo images):

- Builda draft sync **does not overwrite** the Builda App's top-level name, cover, description or promo images. The only display candidate currently wired in is `title`.
- `title` is only a name candidate saved by the platform. When the user **first submits for release in the App** and the name is still empty, the platform may prefill it; resubmitting after a review rejection is not a first submission and will not auto-use the Builda name again; do not promise the user that renaming the draft changes the name already filled in or published in the Builda App. Later name, cover, description and promo images are edited by the user in the Builda App.
- `tagline` / `desc` are only Builda local plan and web display fields; they are not mapped to the Builda App description/slogan; do not write or send `coverUrl`, `advert` or `images` to change release display. These fields are deprecated (including for the first release); the CLI strips them. Writing them explicitly only yields a deprecation notice and does not change the Builda App display. This does not concern images inside the game bundle or normal build content.
- `title`'s "prefill on first submission only" and "platform keeps saving the candidate" are two separate things. Later `publish` / `update-draft` must still sync builds as usual; do not stop updating because title changed, and do not treat "not successfully released" as first submission.

`category` is a required single-choice gate. Based on the game's core gameplay, choose exactly one of the 28 keys below; write the English key in the manifest — no Chinese, no invented values, no case changes. If it truly fits none, use `other`; in the CLI and server, non-empty unknown values are normalized to `other` as a fallback, but an empty value is still rejected:

```text
action Action               strategy Strategy           rolePlay Roleplay
plot Story                  adventure Adventure         sandBox Sandbox
survival Survival           pzzle Puzzle                mystery Mystery
leisure Casual              simulation Simulation       yangCheng Life sim
card Card                   desktop Board               tower Tower defense
rogueLike Roguelike         shoot Shooter               speed Racing
sport Sport                 fangZhi Idle                music Music
dress Dress up              other Other                 cooperation Co-op
moba MOBA                   asymmetric Asymmetric       party Party game
fight Fighting
```

`pzzle` is the compatibility spelling in the current publish contract; you must use it as is and never change it to `puzzle`. If several types apply, choose the one that best represents the core gameplay. `new-manifest` deliberately leaves `category` empty; the CLI refuses submission until it is chosen. Orientation is only `landscape|portrait`, cover kind only `palette|image`; the CLI validates before upload and names fields to fix.

`minChromeMajor` / `minIOSMajor` are the lowest Chrome major version and lowest Safari iOS major version the game runs on; they are written into the game version info by `create-draft` / `update-draft`, and the platform uses them to block incompatible devices: **the lower the declared value, the more devices can enter the game**. When a player's device is below the declared value (Android checks the WebView's Chrome version, iOS checks the OS version), the App shows "Browser engine version is too old." (in the player's App language) on game launch and exits; the player cannot enter. So fill in the **lowest version the build actually runs on**: do not inflate it (that needlessly locks out older-device players), and do not understate it (below real capability, older devices get a black screen/crash after entering). **Preflight hard check: both fields must be positive integers**; the template's `0` is a placeholder, and the draft cannot be submitted without evaluating and filling them.

How to evaluate: find evidence from the build's real runtime requirements, not gut feeling. Reference points — Emscripten-based engine exports such as Godot 4 Web and Unity WebGL/IL2CPP (`engine=godot|unity`) **must have `minChromeMajor` at least `88`** (default `88` / `15`): Emscripten JS glue uses `??=` (Chrome 85), the platform play domain enforces COOP/COEP cross-origin isolation, and full support needs Chrome 88; Chrome 81 running Emscripten output fails with `SyntaxError` and a black screen in testing. Raise it if the build uses newer Web APIs. For other H5 games with no reliable evidence, use the platform baseline `81` / `15`. Only pure canvas/DOM H5 games with transpiled JS can go significantly below the baseline; if the build uses newer Web APIs (e.g. OffscreenCanvas, WebGPU, untranspiled newer ES syntax), raise accordingly. Old projects' `builda.publish.json` may lack these two keys; likewise evaluate and add them before submitting a draft.

Builda platform players' Chrome version distribution (Android): about **98.5%** are on 81 or above, **89.5%** on 85 or above, **88%** on 88 or above. So declaring `88` blocks about 12% of players, declaring `81` only about 1.5%. Godot and Unity games are fixed at no lower than `88`; authors need to know this means about 12% of players cannot enter; games that care about reach should consider switching to the H5 engine. Weigh compatibility before filling in for H5 games: to reach more players, prefer lowering the build's runtime requirements (e.g. transpile JS, avoid relying on cross-origin isolation/multithreading) and verify on low-version real devices before lowering the declared value, instead of filling a low value without verification.

The default manifest deliberately omits `rankBoards`, meaning ordinary updates keep existing leaderboards. To configure leaderboards, add the full array per SDK guidance `.builda-agent/sdk-guidance/<sdk-version>/md_rankboards.md` (for SDK versions before 0.9.7 that file only has runtime notes; read `https://ai.builda.game/game-sdk/releases/0.9.7/md_rankboards.md` instead — the configuration contract is independent of SDK version); write `"rankBoards": []` only when the user explicitly asks to clear all boards.

IAP release config uses `payPoints`; declaring `grantBy: "client" | "room"` explicitly is recommended; omitted or empty string defaults to `client`.
`client` means the client grants items; `room` means the Room grants after redeeming, and the client must not grant rewards again; blanks, null or other values are not accepted.
Omit `payPoints` when there is no IAP; do not change pay points in ordinary build updates. Read the release contract on demand at
`.builda-agent/sdk-guidance/<sdk-version>/md_cysj_app.md` §6.2.2; payment API integration still follows the same-version SDK Skill.

To add or evolve a Builda Online Player Data Object structure, use `objectSchemas` in the manifest, and first read
`https://ai.builda.game/agent/releases/0.4.107/md_object_schemas.md`. Schemas are registered separately via the Builda CLI, not through Builda App review; the same
`schemaId` only allows additive-only evolution — never delete/change existing fields. Do not bind Schema Version to Bundle/Game Version.

After `builda upload-build` succeeds, it writes `prefix`, `entry`, `size` and `bundleUrl/bundleMd5/bundleVersion/bundleEntry/bundleSize` from the response back into the manifest. The former serve Builda online trial play; the latter serve Builda App download, verification and local WebView caching. If the automatic write fails, you must copy them manually; get this step wrong and the draft has no playable entry or App bundle.

Hand off Builda Online Room work per `md_agent_online.md` only when the user explicitly asks.
