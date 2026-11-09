# Merge Pets（T23，2026-10-25）

## 原件与规则



- 三槽，候选包括背包、装备中的动物及自己的 PlacedAnimals；稀有度降序、重量降序、名称升序。首只决定物种，随后仅显示同物种且未选中的动物。选择不提前消耗；Remove 清空对应槽；选择页 X 返回合成页，再次 X 关闭。关闭保留选择，失去所有权则清除。
- 结果预览重量是三只 WeightKg 之和；源按钮依次是 3 Pets Left、2 Pets Left、1 Pet Left、Merge。CooldownSeconds=0。
- VariantOdds 按 Diamond→Gold，原代码计数器累计而不是每个变体重置。例如一钻一金一普通为 Diamond=1/3、Gold=4/9、Normal=2/9。已逐行移植，未擅自改成各1/3。
- GrowthSeconds = round(min(604800,10 × max(1,(kg/150)^0.88) × 稀有度倍率))。倍率 Common 1 至 Omega 5。Merge 成功发对应动物的 Egg Tool，随后 PlaceEgg，成熟可 HatchEgg；客户端 HatchGrantDelaySeconds=6.2。
- MergedSizeMult 为 (kg / AnimalBaseKg)^(1/3)，视觉范围0.4–13，TargetHeight=4，成长蛋比例3，放置足迹比例0.4。

原副本服务端为空：重量预览与共享公式可确认，服务器实际结果赋值、变体抽取时点、保存时点和事务方式无法核实。当前 H5 将预览重量作为产物重量、合成时抽取一次变体、放置时启动计时、孵化6.2秒后一次入包，这是明确记录的本地实现。历史未记录重量宠物用 baseKg×sizeMult³ 补值，不能反推其原重量。当前不启用原未启用的 Mutation。

## 已接入

`public/gameplay/merge-state.js`：跨背包/牧场三宠事务、唯一结果ID、物种/所有权/去重校验、失败回滚；结果蛋、已放置蛋、孵化中状态均保存于同一账户快照。刷新保留重量、变体、成熟时刻与孵化进度，重复调用不再次消耗或发放。宠物恢复器接受 merge UUID，跨容器去重。

`merge-ui.js/css`：沿用原GuiObject结构和1.29515517比例，英文文案、三槽、选择列表、重量/结果蛋、管道填充、关闭返回、键盘焦点、模态输入锁定与横竖屏缩放。使用现有 SourceGui 适配器，未改共享商店适配器。

`merge-system.js`：地图 EggMachine 附近20单位显示原 Open 功能入口（E/点击）；背包 Eggs 分类显示/装备结果蛋，自己牧场点击地面或E/放置按钮放下，成长列表Open及场景成熟蛋Open孵化。按自家Hitbox、50单位距离、最终足迹与其他蛋/宠物间隔检查。计时使用持久化readyAt，离线时间继续计算；孵化中的记录可在刷新后继续完成。手持蛋与工具/动物装备互斥。

孵化宠物保留原物种、总重量、sizeMult与variant，进入现有背包及牧场收入流程；合成后代的背包/牧场模型应用重量尺寸。容量计入未放置和成长中的结果蛋。

## 视觉与功能边界（不能称严格1:1）



结果蛋使用已有对应动物原渲染图；当前场景成长蛋及手持蛋是Three Sprite展示，**不是原AnimalisticEggs三维模型**。原孵化模型形变、摄像机演出、完整粒子/声音、Gold/Diamond专用外观未复原。原付费Skip/Grow All保留原列表入口但不执行购买、扣款或免费加速；真实支付仍属T30。尚未接Room权威/云端存档。因此T23功能本地子集已完成，精确资源与表现仍在进行，T22/T30不整体标完成。

## 验收与运行




## Merge Add列表空白修复（2026-10-25）

用户反馈Add后只有背景。确认选择列表是原MergeMachine框架的兄弟节点，列表z-index:auto低于框架z-index:3，标题/宠物/NO PETS均被背景覆盖。背景pointer-events:none使此前点击测试仍可穿透，不能证明画面可见。现显式将选择列表设为z-index:4。未改候选规则、账户或合成逻辑。

新增tools/check-merge-selection.cjs，独立浏览器内存账户验证实际Add/选宠/返回、无宠NO PETS、关闭解锁，以及列表绘制层级高于框架；已查看有宠与空列表截图，无JS错误。截图preview-merge-selection-fixed.png和preview-merge-selection-empty-fixed.png。不修改用户正式存档。

