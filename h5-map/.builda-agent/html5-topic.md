# HTML5 packaging (including Cocos Creator)

> BuildaGame agent toolchain version: 0.4.108

Enter this topic from the base Skill's task table: read it when engine=h5 and you need to build or package.

HTML5 projects (engine=h5) upload the **build output**, not the source project:

1. First run the project's own build (e.g. `npm run build`) to get a self-contained static directory (commonly `dist/` / `build/`). **The entry must be the root `index.html`**, and its `<head>` must keep the `<script src="builda-sdk.js"></script>` reference (see the HTML5 part of the same-version SDK integration Skill).
2. The build output must be offline and self-contained: ship all JS/CSS/images/audio in the bundle; referencing any external CDN is not allowed. For fonts, **prefer system fonts** — H5 rendering (pixi/phaser/canvas) uses the browser text pipeline, which has built-in system font fallback including Chinese; writing a generic font stack in `font-family` is enough, and Chinese needs no bundled font. Ship only custom fonts such as brand/art fonts in the bundle, and subset large ones (including CJK) before bundling (for the subsetting method see §2 of `.builda-agent/sdk-guidance/<sdk-version>/md_godot_i18n.md`, "Font handling"; ignore the Godot-specific parts). Disable sourcemaps — a `.map` in the zip is rejected by bundle-check.
3. Zip the contents of the build directory (the zip root is `index.html` directly; do not wrap it in an extra directory):

```bash
npm run build
(cd dist && zip -r ../builda-web.zip .)
./.builda-agent/builda bundle-check builda-web.zip
./.builda-agent/builda upload-build builda-web.zip
```

On Windows PowerShell use:

```powershell
.builda-agent\builda.cmd bundle-pack dist builda-web.zip
```

4. h5 bundle-check rules: there must be a root `index.html` that references `builda-sdk.js`; `node_modules/`, `.map`, `.d.ts`, `.env`, VCS directories and any Godot project files are forbidden; file types are limited to the platform allowlist (common web assets are all covered; on `File types not allowed`, move that file out of the build or switch to a supported format); bundled `.wasm` (e.g. a physics engine) is allowed, ≤1GiB per file.
5. The game may contain its own wasm/workers; the whole bundle is subject to the default 200 MiB app limit, and an existing dynamically allowlisted game owned by the current user may be raised to `201..500` MiB per the server value; route large audio files through the `assets upload` pipeline first.

### Cocos Creator projects (use the h5 flow)

Cocos Creator games integrate the **HTML5 (engine=h5)** way: choose **web-mobile** as the build platform, and the upload is the build output directory (root is `index.html`); SDK integration, bundle-check rules and local `builda dev` debugging are exactly the same as the HTML5 flow on this page. Inject the SDK reference with a Cocos custom build template: create `build-templates/web-mobile/index.html` at the project root (copy it from one build's output and edit it), add `<script src="builda-sdk.js"></script>` in `<head>`, and every later build includes it automatically.

Build config constraints (Build & Publish panel / corresponding `buildConfig` fields):

| Field | Requirement | Reason |
|---|---|---|
| `mainBundleIsRemote` | **must be `false`** | the zip is self-contained output; a remote bundle fails to start outright in the CDN environment |
| `sourceMaps` | **must be `false`** | `bundle-check` forbids `.map`, and it leaks source code |
| `packages.<platform>.orientation` | same as `orientation` in `builda.publish.json` | otherwise the host container and game canvas orientations conflict |
| `debug` | `false` recommended | size and performance |
| `md5Cache` | `true` is fine | Cocos only md5-renames its own assets; it does not affect the root-path `builda-sdk.js` reference |
