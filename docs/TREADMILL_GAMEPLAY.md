# 跑步机玩法（2026-10-23）



## 正式游戏行为



## 公共跑步机

原文件由管理员触发，没有可证明的自动活动频率。因此不凭空添加定时刷出或玩家管理按钮。

本地主控可调用：

```js
await game.treadmills.startPublicEvent({multiplier: 4, seconds: 120});
game.treadmills.stopPublicEvent();
```



## 账户、存档和后续系统接口

`TreadmillState`为纯数值状态，`TreadmillSystem`负责场景、交互和表现。`window.game.account`与`window.game.treadmills.account`是同一账户，方便同目录正在接入的其他玩法共享现金，不能再建立互相覆盖的独立余额。

```js
game.account.creditCash(850000);               // 实际收入系统统一入账
game.account.setBoost('speed', 2, 60);         // 全部成长×2，60秒
game.account.setBoost('treadmill', 2, 60);     // 仅训练成长×2
game.account.setBoost('walk', 1.25, 60);       // 实际移速增益
```

本地键 `knock-egg:treadmill:v1`，version=1，保存cash、power、baseId、unlocked、level、slow、boosts和未到期publicEvent，并兼容共享账户中的pickaxes字段。现金通过共享currency模块在大额时保存为十进制字符串，避免大于安全整数时扣费丢精度。成长约每2秒保存，购买、切换慢速、退出、失焦立即保存。拒绝非有限数、非法等级与事件时间；损坏数据恢复默认，localStorage不可用时允许内存模式运行，不会因存储异常崩溃。



## 地图与资源处理





`python tools/prepare_treadmill_runtime.py`由原assets.json生成10台源坐标变换、站位和升级板坐标，保留原导出的尺度与朝向。9级模板原有几何缺口（4级12Union、7级4Union、9级1Cylinder）仍存在；本次逻辑接入不代表这些几何已经补齐。

## 验证



22项自动测试（其中6项原人物物理）和60项真实场景检查是本次记录；包含模型加载失败/加载中离开不扣费、并发购买只换一台。后续其他玩法增加测试后，以实际运行报告为准。

## HUD与路牌复用更新（2026-10-23）







## 移动成长移除（2026-10-23）

原副本缺服务端，不能证明非训练速度奖励由移动触发。用户明确要求移除此前H5补全的移动成长。`advance()`现在必须存在有效训练会话才结算，运行循环不再传入moving判定；速度增益也不会让非训练状态产生成长。保留已保存的成长、现金、等级和慢速状态，不回扣历史成长。回归覆盖移动不加、训练仍加、结束训练停止发奖。

本次移除移动成长的验证：`npm test`30/30通过，覆盖非训练移动（含速度增益）不发奖、训练增长和退出停止；正式游戏页面已刷新。



## 训练提示框移除（2026-10-24，T17 UI调整）

按用户截图要求，移除跑步机训练期间底部的整块提示框：机器名称、倍率/每秒成长文字及“结束训练”按钮，同时删除对应DOM更新和CSS。自有/公共训练均不再显示该框；训练成长、左下速度/现金HUD、成长弹字和路牌升级保留。退出仍使用Space跳跃、Escape或原触屏跳跃手势；失焦自动停止。未改数值或存档。JS语法检查和跑步机专项16项测试通过。

