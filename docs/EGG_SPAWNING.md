# 地图蛋刷新与资源缺口（2026-10-24）

## 蛋生成进石头修复（2026-10-24，T06.3跟进）

原因：原刷蛋净空复用人物碰撞世界，忽略CanCollide=false的可见石头/树木等装饰。新增`egg-placement-obstacles.js`，从map.json十区装饰层级（含Decor、Build、Stars/Galaxy、AlienMap等）中的可见部件构建旋转变换后的世界包围盒，在原地面/胶囊/射线检查之前检查蛋与巢整体占地半径，另留0.2单位间隔。只检查与蛋高度相交的装饰，地下部件及足够高的树冠不占地；保守包围盒可能比实际不规则石头略大。人物碰撞规则不变。



## 动物拾取搬运本地流程已接通（2026-10-24）



完整规则、代码、尺寸映射及资源边界见[ANIMAL_CARRY.md](ANIMAL_CARRY.md)。本次为本地流程，不启动待确认的多人Room，也不标T09放置/T10收益完成。Carry原动画与计时图标403，原生骨骼动作/字体等仍有近似，尚非完整一比一。新增14项单元测试，全量136项通过；浏览器26项流程及实际按键/长按按钮通过，console无warn/error，独立验收不写正式存档。














本轮结论：新发现“携带暂停、掉落续计”候选行为，但仍缺可信实机或服务端证据，保持待验证。用户确认的演出结束后45秒、全员可拾取/1.4秒/限一只、区域掉落规则与Safe Zone成功带回均不变。验证应使用同一只动物，分别比较首次拾取前、持有一段时间、主动放下、受击掉落及回原位后的剩余时间，避免混淆30秒攻略、计时文本隐藏、版本更新或新生成实例。此次只记录研究，不修改运行玩法，也不因网上出现背包系统而新增扩容功能。





### 可作为后续实现依据的补充









## 模型预览网格遮挡修复（2026-10-24，T06.3跟进）





## 用户确认：孵化归属（2026-10-24）

- 多人敲同一个蛋时，按最后一击决定孵化归属，即有效攻击使蛋血量归零的玩家。
- 无拾取保护期。



### 用户确认：拾取条件与v2距离依据（2026-10-24）



v2调用链：`src/game/game.ts:3808`选目标与`:5831`持续按住检查 → `src/game/config.ts:508`的`eggInteractionRadiusForWeight` → `server/game/egg-tuning.ts:105`的`eggInteractionRadius`。其阈值为`10.714285714285714 + max(0, scale - 1) × 1.7857142857142858`（v2世界单位）；`scale = petSizeForWeight(petId, weight).eggScale`。普通scale≤1时约10.714，scale=2时12.5。客户端用玩家位置与目标模型位置的三维欧氏距离，严格小于阈值；不是镜头距离或距模型表面的距离。





### 用户确认：45秒倒计时起点与消失现象（2026-10-24）

- 已确认：动物孵化出场演出结束后开始45秒倒计时，不从破蛋、动物生成或刚落地时提前计算。
- 用户此前观察：“拾取或掉落后，动物就没了”；后续已补充下节掉落位置规则，以最新确认规则为准，不再把掉落一概解释为动物删除。
- 仍未确认：拾取后场景对象与携带/背包对象如何转换；原计时是否取消、保留、继续或重置。不能擅自实现“掉落后重新获得45秒”，也不能把场景中不可见视作所有权/存档记录删除。

本次仅更新规则与证据状态，未修改运行玩法；后续T07/T08验收应从演出完成事件开始计时，并将上述未确认转换单独核实。

### 用户确认：主动放下与区域掉落规则（2026-10-24）

- 搬运时可以主动放下动物。
- 动物已被搬运出其所属区域后，掉落在放下/掉落发生的当前位置。
- 未搬出所属区域时，掉落会回归动物原位（原先所在位置）。

此规则来自用户明确确认，覆盖此前“掉落后动物没了”的不完整观察；不等于删除动物或自动入库。倒计时的保留/重置、跨出后又返回所属区域的判定，以及死亡/退出等特殊事件如何触发掉落仍未明确，不据此额外推定。本轮仅记录，未接入搬运/掉落运行逻辑。

### 用户确认：成功带回的触发条件（2026-10-24）

携带动物回到Safe Zone（安全区）就算成功带回，不需要先走到个人基地围栏内或完成放置才判定带回。此为用户明确确认，成功带回的区域条件不再待确认；动物转成背包工具、解除携带及持久化的具体时点仍单独核实，不把“带回成功”直接等同于“已放置产钱”。本轮仅记录规则，未修改运行玩法。










### 当前实际资源映射

| H5蛋 | v2当前物种 | v2区域 | 实际JSON |
| --- | --- | --- | --- |
| egg_z01_01 · Forest Egg | Chicken (`chicken`) | forest | public/assets/source-atlas/egg-models/36.json |
| egg_z01_02 · Rock Egg | Dog (`dog`) | forest | public/assets/source-atlas/egg-models/88.json |
| egg_z01_03 · Swamp Egg | Bear (`bear`) | forest | public/assets/source-atlas/egg-models/40.json |
| egg_z02_01 · Cactus Egg | Jerboa (`jerboa`) | desert | public/assets/source-atlas/egg-models/46.json |
| egg_z02_02 · Bones Egg | Rattlesnake (`snake`) | desert | public/assets/source-atlas/egg-models/29.json |
| egg_z02_03 · Scorpion Egg | DeathstalkerScorpion (`scorpion`) | desert | public/assets/source-atlas/egg-models/26.json |
| egg_z03_01 · Frozen Egg | Polar Bear (`polar-bear`) | snow | public/assets/source-atlas/egg-models/5.json |
| egg_z03_02 · Frosty Egg | Mammoth (`musk-ox`) | snow | public/assets/source-atlas/egg-models/18.json |
| egg_z03_03 · Yeti Egg | Ice Dragon (`mammoth`) | snow | public/assets/source-atlas/egg-models/87.json |
| egg_z04_01 · Rainbow Egg | Crane (`japanese-white-eye`) | cherry-blossom | public/assets/source-atlas/egg-models/75.json |
| egg_z04_02 · Easter Bunny Egg | Salamander (`japanese-macaque`) | cherry-blossom | public/assets/source-atlas/egg-models/80.json |
| egg_z04_03 · Candy Egg | Koi (`japanese-squirrel`) | cherry-blossom | public/assets/source-atlas/egg-models/77.json |
| egg_z05_01 · Gooey Egg | Frog (`frog`) | lake | public/assets/source-atlas/egg-models/39.json |
| egg_z05_02 · Tree Egg | Turtle (`turtle`) | lake | public/assets/source-atlas/egg-models/41.json |
| egg_z05_03 · Lake Egg | Swan (`swan`) | lake | public/assets/source-atlas/egg-models/31.json |
| egg_z06_01 · Sea Stones Egg | Parrotfish (`pufferfish`) | abyss-ocean | public/assets/source-atlas/egg-models/4.json |
| egg_z06_02 · Sea Egg | Swordfish (`hermit-crab`) | abyss-ocean | public/assets/source-atlas/egg-models/140.json |
| egg_z06_03 · Water Egg | Finned Thresher (`shark`) | abyss-ocean | public/assets/source-atlas/egg-models/90.json |
| egg_z07_01 · Angel Egg | Ash Gecko (`fire-ant`) | volcano | public/assets/source-atlas/egg-models/43.json |
| egg_z07_02 · Fallen Angel Egg | Lava Iguana (`hell-bug`) | volcano | public/assets/source-atlas/egg-models/54.json |
| egg_z07_03 · Volcanic Egg | Phoenix (`phoenix`) | volcano | public/assets/source-atlas/egg-models/1.json |
| egg_z08_02 · Blossom Egg | Kitsune (`sakura-kitsune`) | cherry-blossom | public/assets/source-atlas/egg-models/76.json |





| 项目 | 当前运行行为 |
| --- | --- |
| 标签 | 230蛋独立SVG世界投影，摄像机到顶部挂点≤150；5×5 studs模板、SizeOffsetY=1、顶部+1、近大远小与AlwaysOnTop；原英文名称、同区品质及动态渐变 |
| 血条 | 名称/品质上移，下方黑描边深灰底、绿黄渐变填充/白内边/砖纹及HP文字；满血隐藏，最后受击后6秒收起；0.15秒扣血和0.18秒收起，秒杀0.55秒扣空+0.2秒停留 |
| Idle/受击 | 独立随机2.5–6秒，35%小跳/65%晃动；幅度与时长读取原配置；受击打断Idle、白闪0.18秒、缩至85%后Elastic恢复 |
| 出生/性能 | 蛋与巢固定底部0.7秒缩放出生；Idle基础200、视野余量/60近距豁免；自适应距离档和本区豁免，壳体625隐藏/600恢复 |
| 敲空0–1秒 | 蛋壳保留，三圈旋转并白闪；奖励单次保存，不立即抛碎片或消失 |
| 1–5秒 | 原4秒指数膨胀，至少至1.75倍；噪声晃动，普通标签切换幸运计数 |
| 5–6秒 | 原1秒Expo.Out再次放大3倍并白色淡出；可取回的原粒子；动物同时开始展示 |
| 动物/巢 | 动物0.6秒Back.Out长大/三圈升起、0.55秒Bounce落地、2.5秒朝向玩家；巢1.35倍弹起0.14秒再缩小0.18秒；原有收下/出售面板延后到展示完成 |

实现入口：`h5-map/public/gameplay/egg-presentation-state.js`（独立时序）、`egg-billboards.js`/`egg-presentation.css`（UI）、`egg-feedback.js`（粒子/闪白）、`egg-world-runtime.js`（场景联动）、`pickaxe-system.js`（实际挥击/演出后结算UI）。原粒子复用`model-check/weapon-effects.js`，新增原EmitCount发射和释放接口；保留v2模型stud着色器。



**尚未达到完整一比一的边界：**





## 原蛋头顶标签与待机表现调查（2026-10-24，仅调查）



### 名称、品质与距离



### Idle的确切行为

`EggEffects.playIdleWiggle/playIdleHop`直接以CFrame/ModelScaler驱动模型，不需要远程Idle动画资源；巢不参与普通待机变换。

| 参数 | 原值与含义 |
| --- | --- |
| 等待 | 每轮随机2.5–6秒，动作执行完成后再开始下一轮等待；各蛋独立 |
| 动作抽取 | 35%小跳，65%晃动；一轮二选一 |
| 晃动 | 0.7秒，初始角幅参数6°，频率5Hz，幅度线性衰减到0 |
| 晃动方向 | 每次随机水平倾斜方向，组合X/Z旋转，不是Y轴持续自转 |
| 小跳 | 0.35秒，高度=原壳体高度×0.12；`sin(pi*t/0.35)`上升再落地 |
| 结束 | 恢复初始位置/旋转，不积累偏移 |

启动动作还需：未进入孵化/消失、未处于受击/刷新占用窗口、摄像机距离小于动态阈值、通过EggViewFrustum检查。基础阈值200 studs；视野判定含15°余量，60 studs内直接放行（因此不能简单说“屏幕外完全不动”）。这些条件在每轮启动时检查，正在执行的短动作不会逐帧再次做距离剔除。受击取消令牌递增，会中断当前Idle；孵化/消失会终止该蛋Idle循环。

### 关联表现与性能

- 普通未受损蛋血条默认隐藏。受伤后最后有效受击/血量下降约6秒内显示；填充变化0.15秒Quad.Out，收起0.18秒Back.In。Titanic单独常显；秒杀有0.55秒扣空演示和0.2秒停留，不能因立即破蛋而完全看不到血条。名称/品质可平时显示，与血条条件分开。Broken/Hatching/Despawning通常关闭整个标签，秒杀展示有临时例外。
- 命中反馈：白闪0.18秒，0.07秒缩到85%，0.45秒Elastic.Out恢复；底部补偿保持贴地，同时粒子与Impact声音。Idle封锁到命中后约0.62秒（0.07+0.45+0.1）。`Hit.ShakeAngle=18`虽存在配置，但此处playHitEffect未消费它，不能描述为已实现18°命中摇摆。
- 刷新：`SpawnRise`实际为蛋和巢从约1%放大到100%，底部固定，0.7秒Quad.Out；只对SpawnedAt距当前服务器时间不足3秒的新蛋播放，Idle再避让0.1秒。名字中的Rise不等于直接向上平移。消失为0.4秒Quad.In缩小，再隐藏蛋/巢及关闭附带效果。
- 破蛋进入专门序列：旋转引入→晃动放大/幸运信息→爆开→宠物展示/品质爆发→巢退场；它与普通Idle是两套行为。
- 持续VFX普通范围200，离开到220停止，回到200恢复；壳/巢/标签远距隐藏范围600，离开到625隐藏，回到600恢复；均每0.25秒检查。20/25的迟滞防止边界闪烁。**Idle启动本身没有这20的迟滞**，标签仍独立受150限制。
- 自适应性能档距离倍率1/0.8/0.62/0.45；普通Idle阈值相应200/160/124/90，但玩家当前所在区的蛋豁免距离降档。10秒预热，平滑FPS低于40持续3秒降档，高于54持续20秒起恢复。ViewCull的HideEggShells/PauseEggVFX当前为false，但Idle仍显式调用视野检查。
- 打击基础范围8是另一套参数，EggTargeting按人物位置到壳体表面的近似距离计算，较大/悬空蛋还有尺寸与ReachBelow补偿；不与150/200混为一谈。

### 当前H5的差异

调查时`egg-world-runtime.js`没有随机Idle与常驻名称/品质标签；只有受击短摇摆、0.7秒从地下平移出现和按人物距离600隐藏。`pickaxe-system.js.showHealth`为当前目标显示名称/血条，与原多蛋常驻标签及受击6秒血条策略不同。本轮只记录差异，不把它们标为已移植，也不改变已完成的蛋资源补充/刷新状态。客户端表现可直接核查；服务端生成与结算仍沿用原副本缺失的边界。



## 当前生效：v2区域模型补充（2026-10-24）





| 区域 | 按原三档顺序使用的v2模型 |
| --- | --- |
| 1 | Chiken_egg.glb、Rabbit_egg.glb、Bear_brown_egg.glb |
| 2 | Goat_egg.glb、Snake_egg.glb、Scorpion_egg.glb |
| 3 | Polar_Bear_egg.glb、Mammoth_egg.glb、Dragon_Ice_egg.glb |
| 4 | Seahorse_egg.glb、koi_egg.glb、sakura-kitsune_egg.glb |
| 5 | Frog_egg.glb、Turtle_egg.glb、Crocodile_Dark_egg.glb |
| 6 | Regal_Angelfish_egg.glb、Jellyfish_egg.glb、Shark_Blue_egg.glb |
| 7 | FireEagle_egg.glb、Devil_egg.glb、Fire_Phoenix_egg.glb |







## 首次交付结果（已由下方v2补充覆盖）



静态地图中原蛋/装饰的1,154个OBJ对象已按源名和包围盒精确移除，不与动态模型重叠。原230个蛋实例和230个巢的属性/位置另存追溯；它们是采集时动态生成的快照，不能当作手工放置的固定刷新点。原文件中没有服务端刷蛋脚本，位置选择/补刷调度是H5根据客户端配置重建，不声称恢复了原服务端实现。

## 各区范围与数量

下表是原ZoneHitboxes的XZ范围；实际候选位置还要扣除边距6和完整模型/蛋巢半径，并通过地面、坡差、实心障碍和互相间距检查。

| 区域 | 原X范围 | 原Z范围 | 原快照数/上限 | 当前目标 | 当前可生成类型 |
| --- | --- | --- | ---: | ---: | --- |
| 1 Forest Zone | -174.50 至 -81.47 | -75.00 至 75.00 | 14 | 0 | 无（按用户选择停用缺网格种类） |
| 2 Desert Zone | -304.00 至 -187.00 | -75.25 至 75.25 | 16 | 16 | Scorpion Egg |
| 3 Snowy Zone | -463.25 至 -315.75 | -74.75 至 74.75 | 18 | 18 | Yeti Egg |
| 4 Candy Zone | -681.75 至 -475.25 | -74.86 至 74.86 | 20 | 20 | Candy Egg |
| 5 Swamp Zone | -960.75 至 -694.25 | -73.50 至 73.50 | 22 | 22 | Tree Egg |
| 6 Ocean Zone | -1299.75 至 -973.25 | -74.50 至 74.50 | 24 | 24 | Sea Egg |
| 7 Volcano Zone | -1819.50 至 -1311.50 | -75.00 至 75.00 | 26 | 26 | Angel Egg、Fallen Angel Egg |
| 8 Blossom Zone | -2338.00 至 -1831.00 | -75.00 至 75.00 | 28 | 28 | Bamboo Egg、Blossom Egg、Fortune Egg |
| 9 Galaxy Zone | -2863.00 至 -2350.00 | -75.00 至 75.00 | 30 | 30 | Starry Egg、Sun Egg、BlackHole Egg |
| 10 Planet X Zone | -3497.00 至 -2863.00 | -75.00 至 75.00 | 32 | 32 | Plasma Egg、Nebula Egg、Supernova Egg |



## 可核实的原配置及H5处理

- `SpawningEnabled=true`；`MaxPerZone=14`、每区`MaxPerZoneStep=2`，对应14、16、18、20、22、24、26、28、30、32。保存文件每区实例数完全吻合。
- 三档`TierWeights={3,2,1}`；`TierSizeMult={1,1.1,1.25}`作为原TierScale记录。当前只从有几何的档位抽取，不生成缺几何种类。
- 壳体基准高度为`3 + (zone−1) × 0.3`，再乘`SpawnSizeMult`。230个快照最大高度误差0.002164；不能再重复乘TierScale。
- 最大血量为`round(蛋种基础Health × SpawnSizeMult^SizeHealthExponent)`，指数为1；230/230快照吻合。受损快照的当前Health和MaxHealth已区分。
- `EggSizes.Roll`原曲线已移植：BigChance=0.65、MinMult=0.7、MaxOneIn=10000、MinOneIn=60、TailExponent=1.3、Decimals=2、LuckBend=0.35。各区SpawnMax参数为2.3/2.6/3/3.4/3.6/3.7/3.9，后3区用4；它们调整尾部分布，不是硬裁切上限。
- `WidthSpreadFraction=0.92`、`LengthBands=3`、`BandBalanceAttempts=10`、`EdgeMargin=6`、`Gap=5`、`PlacementAttempts=20`。H5沿区域X长度分三段，优先较少蛋的段，按包含全部装饰的足迹检查间距和墙体；不成功就保留空位重试，不强行穿障碍摆满。
- 原`RespawnDelay=15`、`BrokenCleanupDelay=6`、`BrokenRespawnDelay={10,15}`均已归档。H5破碎后立即停止命中并结算一次，旧巢6秒清理；10–15秒后重新抽取种类/尺寸/位置、代次加1，保持数量上限。原子去重沿用每次挥击与每个蛋代次。普通失败空位每1秒重试，每0.25秒最多补8个，属于H5调度控制。
- 原蛋巢`NestWidthScale=1.6`、`NestSinkFraction=0.45`、`NestBuryFraction=0.35`：按蛋体宽1.6倍缩放巢，将巢埋入地面35%，壳底位于地面+巢高20%。再按全模型包围盒的ReachBelow抬高，防止装饰埋入地面；57个带ReachBelow属性的快照验证最大偏差0.000049。
- 原`SpawnRise.Duration=0.7`；当前保留0.7秒升起，并在升起完成前禁止命中。600距离外隐藏模型，逻辑计时继续。
- 当前原快照没有DespawnAt；未据此编造活蛋定时消失。原配置还有`PityCheckInterval=5`、`PityInterval={10,15}`、`PityMax=8`和仅Zone1启用的HealthDepth(Chance0.8/Band0.15/Attempts14)。副本没有消费这些字段的服务端代码，确切含义不能核实，已保留原配置而未把它们改写成假定的大蛋保底/刷新规则。Zone1当前不生成，HealthDepth不影响已启用区域。

## 每种蛋的资源状态

“有几何”包括缺件模型，不代表外观完整。当前还缺39个部件：36个Union无有效几何，另3个Sea Egg网格候选身份未确定。

| 区域 | 蛋 | 已恢复/应有部件 | 当前是否生成 | 缺口 |
| --- | --- | ---: | --- | --- |
| 1 | Forest Egg | 0/1 | 否 | 无原几何 |
| 1 | Rock Egg | 0/1 | 否 | 无原几何 |
| 1 | Swamp Egg | 0/2 | 否 | 无原几何 |
| 2 | Cactus Egg | 0/1 | 否 | 无原几何 |
| 2 | Bones Egg | 0/3 | 否 | 无原几何 |
| 2 | Scorpion Egg | 23/25 | 是 | 缺2部件 |
| 3 | Frozen Egg | 0/2 | 否 | 无原几何 |
| 3 | Frosty Egg | 0/1 | 否 | 无原几何 |
| 3 | Yeti Egg | 6/9 | 是 | 缺3部件 |
| 4 | Rainbow Egg | 0/1 | 否 | 无原几何 |
| 4 | Easter Bunny Egg | 0/3 | 否 | 无原几何 |
| 4 | Candy Egg | 10/11 | 是 | 缺1部件 |
| 5 | Gooey Egg | 0/2 | 否 | 无原几何 |
| 5 | Tree Egg | 66/67 | 是 | 缺1部件 |
| 5 | Lake Egg | 0/1 | 否 | 无原几何 |
| 6 | Sea Stones Egg | 0/2 | 否 | 无原几何 |
| 6 | Sea Egg | 3/8 | 是 | 缺5部件（2个Union、3个网格候选未确认） |
| 6 | Water Egg | 0/2 | 否 | 无原几何 |
| 7 | Angel Egg | 1/3 | 是 | 缺2部件 |
| 7 | Fallen Angel Egg | 2/3 | 是 | 缺1部件 |
| 7 | Volcanic Egg | 0/2 | 否 | 无原几何 |
| 8 | Bamboo Egg | 5/5 | 是 | 几何完整 |
| 8 | Blossom Egg | 5/5 | 是 | 几何完整；3张原贴图未恢复，保留原部件颜色 |
| 8 | Fortune Egg | 9/9 | 是 | 几何完整 |
| 9 | Starry Egg | 2/2 | 是 | 几何完整 |
| 9 | Sun Egg | 1/1 | 是 | 几何完整 |
| 9 | BlackHole Egg | 4/4 | 是 | 几何完整 |
| 10 | Plasma Egg | 10/10 | 是 | 几何完整 |
| 10 | Nebula Egg | 7/7 | 是 | 几何完整 |
| 10 | Supernova Egg | 10/10 | 是 | 几何完整 |



## 现有玩法与保存



保存键仍为`knock-egg:treadmill:v1`。`pickaxes.worldEggs.version=2`保存新的地图蛋状态；旧首区`eggs`和既有收藏/现金/成长/机器/围栏/拖尾/武器字段保留。恢复时从可信配置重算尺寸/血量上限/地面，校验可用资源、位置和代次；到期破碎蛋只补一代，不补发离线奖励。

## 代码与重建



在`h5-map/`依次运行：





## 验证

新增13项刷新专项测试通过，当前全套108项通过。包括230原坐标/数量/血量与57个ReachBelow样本、16几何/10巢资源、缺失种类过滤、216数量上限、尺寸尾分布、区域/间隙/真实碰撞地面、10–15秒补刷、旧对象拒绝命中、保存/离线只补一代、本区奖励与去重、旧静态几何清理。








### v2蛋stud材质补齐（2026-10-24）

用户指出新增蛋缺少stud。原因是v2除了GLB内嵌材质，还在`src/game/model-studs.ts`中运行时添加方形stud凹凸；此前仅复制GLB漏接这一层。现将该模块去除TypeScript类型后移植为`public/gameplay/v2-model-studs.js`，正式蛋加载和模型预览共用，应用于21个v2补充模型。保留原色图/法线图，采用v2原0.5世界单位间距、边缘阴影和浅凸法线；纹理随物体移动旋转，按实际缩放保持密度，实例克隆共享已挂接材质。原9个模型不额外叠加。




### Blossom Egg贴图缺口替代（2026-10-24）

