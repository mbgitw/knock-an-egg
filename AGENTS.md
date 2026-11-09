# 项目协作约定

接手修改时先读 `docs/PROJECT_CONTEXT.md`、`docs/GAME_DESIGN.md`、`docs/TASKS.md`。涉及平台接入、联机或发布时，再读 `docs/BUILDA_INTEGRATION_GUIDE.md` 和当前锁定版本的平台 Skill。

- 使用中文回复。技术路线为 H5 + Three.js，工作目录为 `h5-map/`。
- 按任务逐项推进，完成后同步上下文、设计和任务状态。
- 未明确要求发布或上传时，只修改、构建和本地验证，不更新平台草稿或部署 Room。
- Builda 唯一目标为 `GD:409930:13`；SDK/Online 当前锁定 `0.12.1`，协议修订为 3。
- 付款前不持久化购买准备、不预生成付费蛋、不冻结玩法；成功付款后保存订单回执并按平台冻结的 grantBy 发货。离线双倍、单蛋加速、全部蛋加速固定 100 G，保留现有 payId。
- 文字只使用黑色描边；除用户特别要求，不添加文字阴影、发光、模糊或渐变。
- 不额外添加操作说明、调试面板、统计或地图检查器到游戏 UI。本地开发工具不得进入正式构建。
- 运行地图为 `h5-map/public/obj-map/world.glb`。保留已完成的地图清理，不恢复基地中的预放置动物和邀请人物。
- 模型保留渲染、骨骼、动画、挂点及加载必需数据；不添加可选的工具标签或资源溯源报告。
- 运行状态必须实际检查；不凭历史记录声称预览服务器或浏览器仍在运行。

常用命令（在 h5-map 执行）：`python serve.py`、`npm test`、`npm run test:online`、`node tools/prepare-builda-draft.mjs --release`。

图片生成默认使用个人 `bmft-image-default` 技能和 `gpt-image-2`。网关读取 `OPENAI_BASE_URL`，缺失时使用 `https://sub.bmft.tech`；鉴权读取 `OPENAI_API_KEY`，兼容 `BMFT_API_KEY`。密钥不得写入文件或提交。用户已允许必要时使用内置图像工具。
