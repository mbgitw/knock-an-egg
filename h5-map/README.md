# H5 开发入口

游戏入口：`public/index.html`、`public/app.js`。玩法位于 `public/gameplay/`，联机客户端位于 `public/online/`，服务端位于 `server/game/`。

在本目录执行：

- `python serve.py`：本地预览 http://localhost:8765/。
- `npm test`：客户端与纯规则回归。
- `npm run test:online`：生成共享规则并验证联机逻辑。
- `node tools/prepare-builda-draft.mjs --release`：生成 `build/builda-draft/`。

运行地图与当前模型直接维护于 `public/`。平台约定和工作状态见上一级 `docs/`。
