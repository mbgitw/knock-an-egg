# Knock an Egg

H5 + Three.js 横屏牧场游戏，包含敲蛋、孵化、动物收藏、装备成长和七人联机。

开发目录为 `h5-map/`。先阅读 `docs/PROJECT_CONTEXT.md`、`docs/GAME_DESIGN.md` 和 `docs/TASKS.md`。

```powershell
cd h5-map
npm install
python serve.py
```

本地地址为 http://localhost:8765/ 。正式联机依赖已配置的 Builda SDK 与 Room。

验证：`npm test`、`npm run test:online`。构建：`node tools/prepare-builda-draft.mjs --release`，输出 `h5-map/build/builda-draft/`。上传和部署需要用户明确提出。
