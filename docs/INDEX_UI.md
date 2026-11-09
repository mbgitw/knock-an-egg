# Index 与 Shop UI（2026-10-24）

## Index领取成功奖励卡补齐（2026-10-24）

核对原IndexController.showClaimPopup与State回包分支：仅Ready→Claimed的动物参与本次现金/速度合计，然后调用NewItemController.Show，现金卡在前、速度卡在后。NewItemController使用0.07秒入场错峰，3秒后按0.06秒错峰退场、光晕脉冲；ClaimFeedback.PlaySting只有音效，不触发PlayBank全屏闪光/镜头变化。




## Index Claim 领取接通（2026-10-24，T21）

用户反馈按钮无响应，确认旧版为纯UI，没有Claim/ClaimAll事件。现接通Normal单个/全部领取，奖励使用原IndexConfig导出的rewardSpeed/rewardCash，直接加到账户power/cash，沿用power上限1e19；现金用BigInt运算。未发现或已领取不可领取，单次账户保存同时写两项余额与领取标记，重复点击/刷新均不重复发奖。保存失败沿用账户dirty重试机制。

新增index-state.js统一发现/领取状态；restoreState迁移旧库存并恢复index，成功搬运入库时永久记录发现，因此卖出后保留图鉴进度。旧档里此前已卖掉且未记录的发现无法反推。UI更新Claimed、红点及剩余数量，锁定项真正disabled。球棒分级解锁、Limited扩充和联机权威领取仍不在本次范围，T21未整体完成。






## 入口与界面















## 文件与重建



## 验证



## 10 区武器及标签补图（2026-10-24，最新）

用户明确指出 Normal/Limited 标签可以从指定 v2 项目复用，并优先补齐10区球棒图标。现已完成：

| 区域 | 原工具名 | 当前图片 |
| --- | --- | --- |
| 1 森林 | Bat | 原木色棒 |
| 2 沙漠 | CactusBat | 绿色带刺仙人掌棒 |
| 3 雪地 | FrostBat | 青白冰霜棒 |
| 4 糖果 | CandyBat | 红色棒棒糖 |
| 5 沼泽 | TreeBat | 树冠棒 |
| 6 海洋 | LakeBat | 蓝色水纹棒 |
| 7 火山 | LavaBat | 橙红熔岩棒 |
| 8 樱花 | BlossomBat | 粉色花瓣棒 |
| 9 银河 | GalaxyBat | 深紫星光棒 |
| 10 X星球 | Electric Hammer | 蓝白电锤，沿用原 BatConfig 的40°图片旋转 |





