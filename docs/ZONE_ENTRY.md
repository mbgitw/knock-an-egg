# 区域进入提示

日期：2026-10-24。任务 T20.1 / T28 区域进入提示子集；用户明确要求加入截图中的系统。







## 名称和推荐值

| 区域 | 原标题 | 推荐速度 |
| --- | --- | --- |
| 1 | Forest Zone | 5 |
| 2 | Desert Zone | 1000 |
| 3 | Snowy Zone | 50000 |
| 4 | Candy Zone | 750000 |
| 5 | Swamp Zone | 12000000 |
| 6 | Ocean Zone | 150000000 |
| 7 | Volcano Zone | 1000000000 |
| 8 | Blossom Zone | 5000000000 |
| 9 | Galaxy Zone | 25000000000 |
| 10 | Planet X Zone | 100000000000 |

这些值取自 RequiredPower，属于成长值提示；不等于实际 studs/s，不是硬性入区限制，不扣费、不改账户、不自动打开购买窗口。

## 行为

检测原 `Workspace/Build/ZoneHitboxes` 的10区与SafeZone，按区域顺序匹配，转换到部件局部坐标、完整XYZ范围且Y额外容差2。H5使用人物脚底加半个人高对应原角色根部位置，避免错用镜头位置。

首次进入/切区显示，原地停留不重复；离区后重入可再次显示。安全区没有自己的弹条；按原逻辑返回安全区时已有消息仍走完剩余退场，不立即创建新消息。0.22秒Quad Out滑入，显示起算2秒后0.3秒向上淡出。快速跨区直接替换为最新消息，采用单一状态/时钟，不留下旧计时器关闭新消息。



## 样式与图片边界

原Messages宽70%、高10%、顶部55px；主条宽75.7365%、高75.7365%，推荐行高度53.2061%、中心Y=1.02339566。标题各区原RGB上下渐变、黑描边，背景黑色0.45不透明并向两侧淡出；推荐行白色Recommended文字、蓝色鞋和青蓝渐变数值。H5保留桌面比例、左右居中，窄屏自动缩放长行并下移避让左侧HUD，所有节点pointer-events:none。



鞋图复用本项目此前引入的 `public/hud-layout/speed.webp`，不是已验证原94371431575562二进制。GothamSSm字体使用现有Montserrat Black/Rubik ExtraBold替代，非逐像素一致。原全局公告MessagesLift避让依赖尚未接入的公告系统，暂不实现。

## 文件与重建

- `public/gameplay/zone-entry-state.js`：纯区域检测、重入/替换/延后状态。
- `public/gameplay/zone-entry.js`、`zone-entry.css`：HUD、渐变描边、缩放和逐帧动画。
- `public/app.js`：创建/更新系统，暴露`game.zoneEntry`，不改场景模型。
- `python tools/prepare_zone_entry.py`：只读原件重建文字、数值、触发体与源归档。
- `python tools/recover_zone_entry_icons.py`：按已记录缓存键重新发布图片。

## 验证

新增5项区域检测/重入/计时/跨区替换/模态延后/追逐/旋转范围测试；当次完整 `npm test` 108/108通过（包含工作区其他系统已有测试）。

独立验收页 `/zone-entry-test.html` 使用内存账户，可逐区真实传送、观察倒计时与定格样式；`/zone-entry-responsive-test.html` 提供390×650、844×390预览。定格/传送只存在验收页，正式页没有调试控件。

