# Auto Swing 与底部快捷栏



## 已接入

- 正式入口 `/`：Auto Swing 独立置于底栏上方，原蓝色挥镐图、红/绿渐变、菱格纹理、斜面边框、白字深色描边；开关文字保持英文原文，0.22秒变色、0.2秒点击防抖。
- 底栏居中、距底5像素（兼容安全区），黑色50%透明方槽、白色选中框、左上数字键和底部英文装备名。1号槽随当前20档镐子变化，2号槽复用现有WeaponSystem及10区武器图。
- 点击或1/2切换/卸下，复用共享装备状态和原有自动敲蛋逻辑；球棒/空手/训练时隐藏Auto Swing，外部面板锁住交互，失焦停止自动挥击。自动开关不持久保存。
- 桌面去掉旧的额外挥击圆按钮，场景点击/F保留；触屏保留原有攻击入口。移动端使用MobileScatchel的比例及隐藏数字键，增加窄竖屏可读性约束。
- 未增加操作提示。没有实现展开背包的拖拽排序、宠物/蛋快捷物品或新战斗系统；现有武器购买/解锁和战斗范围以其自身任务文档为准。

## 原始证据和还原边界









## 验证

- 当次完整`npm test`76/76通过，两个系统JS语法检查通过。
- `node tools/check-hotbar.cjs`：20图解码、红绿开关、1/2切换、双槽互斥、空手隐藏、Index输入锁定、自动真实破蛋、1920×1094/1280×720/390×844/844×390布局、触屏点击、正式页通过；无应用错误。忽略与本次无关的浏览器默认favicon.ico 404。
- 测试装备/大额测试现金只在`/pickaxe-test.html`内存账户使用；正式页独立空白浏览器上下文仅查看。未向用户正式存档添加水晶镐或现金。
- 截图：`h5-map/preview-hotbar.png`（水晶镐对照）、`preview-hotbar-on.png`、`preview-hotbar-game.png`（正式页）、`preview-hotbar-touch.png`。触屏为浏览器模拟，非真机验收。


## Auto Swing 遮挡弹窗点击修复（2026-10-24）

用户反馈Auto Swing遮挡Index的Claim按钮。原因是Index打开时旧CSS把整个pickaxe-ui提升至z-index:13（Index为12），且独立Auto按钮未包含在原底栏的点击穿透规则里。已移除Index对pickaxe-ui的层级提升，并为pickaxe-ui内所有disabled按钮设置pointer-events:none，保留正常状态点击。

浏览器1280×720实际重叠点点击回归通过：命中.index-claim-all，真实鼠标点击触发一次监听，Auto未开启；关闭Index及镐子商店后Auto均正常恢复。验证使用隔离浏览器账户，不改用户存档。专项命令`node tools/check-hotbar-overlap.cjs`，截图`h5-map/preview-hotbar-overlap-fixed.png`。页面已有builda-sdk.js 404与本修复无关。本次只改CSS，不涉及奖励逻辑。
