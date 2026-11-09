# Vanilla H5 static release

This example targets Canvas/DOM games without a bundler. The source is in `src/main.js` and loads browser ESM by relative path; the
browser never has to resolve the `@cysj/online-h5` bare import.

Finish the TypeScript build in the SDK root first, then run:

```bash
node examples/vanilla/scripts/build.mjs
```

The final releasable directory is always:

```text
examples/vanilla/dist/
  index.html
  main.js
  vendor/online/*.js
```

The build script recursively copies all runtime `*.js` files from the SDK `dist/`, preserving relative directories, and never puts `*.d.ts` or `*.map` into the game
Bundle. If the project already has its own static build script,
reuse the same three-entry layout.

`builda dev` explicitly injects `builda_mock_shell=1`; the example then connects to the loopback Mock and uses `local:<player-id>`. The production Builda
App never takes the local branch, even when it loads the page from an on-device loopback HTTP Server; the game must pass the `gatewayUrl` and short-lived
`runtimeToken` obtained by the App to `connectBuildaOnline` as in-memory parameters. Never decide the local environment from the hostname, protocol or port, and never write the
runtime token into URLs, storage or logs.
