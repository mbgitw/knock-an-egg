











10个常规区域共有 **30种区域蛋、86种动物**；动物池以 `Shared/ZoneAnimalsConfig.Zones` 为准。
每种区域动物的 Normal、Gold、Diamond 模型路径见 inventory.json；下表中的模型、骨骼、动画来自 Normal 模板。

## 区域总表

| 区域 | 蛋（按配置顺序） | 动物（按池顺序，保留原拼写） |
| --- | --- | --- |
| 1 · Forest Zone | Forest Egg、Rock Egg、Swamp Egg | Chicken、Cat、Bat、Anteater、Badger、Parrot、GoldenRetriver、Bear |
| 2 · Desert Zone | Cactus Egg、Bones Egg、Scorpion Egg | Snake、Tiger、Lion、Ankylosaurus、COCKATRICE、SPHINX、CHIREMA、MANTICORE |
| 3 · Snowy Zone | Frozen Egg、Frosty Egg、Yeti Egg | Pigeon、GuiennaPig、Maltese、Goat、BichonFrise、SecretaryBird、Llama、Polar Bear |
| 4 · Candy Zone | Rainbow Egg、Easter Bunny Egg、Candy Egg | Bunny、trumpet、Muscovy Duck、barracuda、Moorish idol、Yak、Cobra、PREHISTORIC_DRAGONFLY |
| 5 · Swamp Zone | Gooey Egg、Tree Egg、Lake Egg | Snail、Goldfish、Lizard、pufferfish、Butterflyfish、stingray、Regal、PREHISTORIC_MOTH |
| 6 · Ocean Zone | Sea Stones Egg、Sea Egg、Water Egg | Cuttlefish、FangtoothFish、Swordfish、MantisShrimp、GoblinShark、LeafySeaDragon、MEGALODON、Amphiptere |
| 7 · Volcano Zone | Angel Egg、Fallen Angel Egg、Volcanic Egg | Jackalope、DIMETRODON、Brachiosaurus、Lindworm、T-Rex、Fenrir、CERBERUS、Raiju |
| 8 · Blossom Zone | Bamboo Egg、Blossom Egg、Fortune Egg | Tanuki、Surgeonfish、Mandarinfish、DumboOctopus、Akita、Gallimimus、Wolf、SIMURGH |
| 9 · Galaxy Zone | Starry Egg、Sun Egg、BlackHole Egg | Crocodile、Whale、Zebra、THUNDERBIRD、ARCHAEOPTERYX、WINGED_IMP、CALADRIUS、Velicoraptor、CLASSICDRAGON、QILIN |
| 10 · Planet X Zone | Plasma Egg、Nebula Egg、Supernova Egg | Bug、CrystalLizard、CrystalBeast、CrystalRaptor、CrystalDragon、Mantis、AlienJellyfish、CrystalScorpion、Behemoth、CrystalWolf、CelestialBeast、CelestialSpirit |

## 资源位置与核对结果

- 区域蛋：`ReplicatedStorage/Eggs/NormalEggs/<主题文件夹>/<序号>: <蛋名>`。例如 `Forest Eggs/1: Forest Egg`。模型名有数字前缀，配置名没有，清单已逐条对应。区域5文件夹仍叫 `Lake Eggs`；区域6为 `Under Water Eggs`，区域10为 `Alien Eggs`。
- 主动物库：`ReplicatedStorage/Animals/{Normal,Gold,Diamond}/Zone_<区域号>/<动物名>`；具体路径逐条记录，不能用旧备用模型替换当前动物池。
- Animals库共620个Model实例，含额外、活动、备用、退休和各皮肤版本，不能当成同等数量的当前区域动物。
- 当前区域Normal模板合计1764根Bone、491个Motor6D、172个Animation引用。Bone与Motor6D分开统计。
- 86种动物每种都有Normal、Gold、Diamond，合计258个模板、5292根Bone。Gold和Diamond各有74个模板没有自带Animation实例，按原AnimalAnimator代码回查Normal模板；各自只有第十区12个模板直接携带24个动画引用。清单的resolvedAnimations已记录回查结果。
- 区域蛋路径缺失：0；三套区域动物模板缺失：0。这只证明XML内实例存在，不证明远程网格、贴图、动画可下载。

## 每只动物的骨骼和动画

骨骼的完整父子路径、原始局部CFrame（位置XYZ + 3×3旋转）、Motor6D的Part0/Part1与C0/C1、网格与贴图ID均在 `inventory.json/models`。
动画列为原文件的Animation资源ID；直接下载远程曲线受权限限制。后续缓存恢复及播放验证见本文件的动物动画网页预览章节。

### 1 · Forest Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Chicken | 14 | 0 | Walk：138876818343982；Idle：123405154256492 |
| Cat | 26 | 0 | Walk：105123564900536；Idle：123080190944814 |
| Bat | 18 | 0 | Walk：138876818343982；Idle：123405154256492 |
| Anteater | 27 | 0 | Walk：119633799371557；Idle：88965886085030 |
| Badger | 27 | 0 | Walk：119633799371557；Idle：88965886085030 |
| Parrot | 16 | 0 | Walk：138876818343982；Idle：123405154256492 |
| GoldenRetriver | 26 | 0 | Walk：105123564900536；Idle：123080190944814 |
| Bear | 27 | 0 | Walk：105123564900536；Idle：123080190944814 |
### 2 · Desert Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Snake | 6 | 0 | Walk：125786319812990；Idle：112383600780869 |
| Tiger | 25 | 0 | Walk：105123564900536；Idle：123080190944814 |
| Lion | 26 | 0 | Walk：105123564900536；Idle：123080190944814 |
| Ankylosaurus | 27 | 0 | Walk：105123564900536；Idle：123080190944814 |
| COCKATRICE | 27 | 0 | Walk：86907797531617；Idle：98243084234606 |
| SPHINX | 28 | 0 | Walk：129201488277568；Idle：116727487408212 |
| CHIREMA | 27 | 0 | Walk：129201488277568；Idle：116727487408212 |
| MANTICORE | 29 | 0 | Walk：75162269191521；Idle：120840122644736 |
### 3 · Snowy Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Pigeon | 16 | 0 | Walk：138876818343982；Idle：123405154256492 |
| GuiennaPig | 25 | 0 | Walk：105123564900536；Idle：123080190944814 |
| Maltese | 27 | 0 | Walk：116245363105425；Idle：75384603821961 |
| Goat | 26 | 0 | Walk：105123564900536；Idle：123080190944814 |
| BichonFrise | 27 | 0 | Walk：116245363105425；Idle：75384603821961 |
| SecretaryBird | 20 | 0 | Walk：76351241713292；Idle：110983201525872 |
| Llama | 25 | 0 | Walk：105123564900536；Idle：123080190944814 |
| Polar Bear | 25 | 0 | Walk：105123564900536；Idle：123080190944814 |
### 4 · Candy Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Bunny | 22 | 0 | Walk：105123564900536；Idle：123080190944814 |
| trumpet | 7 | 0 | Walk：83727818424239；Idle：78608203402071 |
| Muscovy Duck | 18 | 0 | Walk：76351241713292；Idle：110983201525872 |
| barracuda | 9 | 0 | Walk：83727818424239；Idle：78608203402071 |
| Moorish idol | 10 | 0 | Walk：83727818424239；Idle：78608203402071 |
| Yak | 27 | 0 | Walk：119633799371557；Idle：88965886085030 |
| Cobra | 14 | 0 | Walk：125786319812990；Idle：112383600780869 |
| PREHISTORIC_DRAGONFLY | 8 | 0 | Walk：103049401799532；Idle：126488274105268 |
### 5 · Swamp Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Snail | 7 | 0 | Walk：102314204570385；Idle：89544843133791 |
| Goldfish | 10 | 0 | Walk：83727818424239；Idle：78608203402071 |
| Lizard | 27 | 0 | Walk：105123564900536；Idle：123080190944814 |
| pufferfish | 11 | 0 | Walk：83727818424239；Idle：78608203402071 |
| Butterflyfish | 13 | 0 | Walk：83727818424239；Idle：78608203402071 |
| stingray | 14 | 0 | Walk：83727818424239；Idle：78608203402071 |
| Regal | 12 | 0 | Walk：83727818424239；Idle：78608203402071 |
| PREHISTORIC_MOTH | 8 | 0 | Walk：103049401799532；Idle：126488274105268 |
### 6 · Ocean Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Cuttlefish | 6 | 0 | Walk：101166563162686；Idle：110459384539656 |
| FangtoothFish | 6 | 0 | Walk：101166563162686；Idle：110459384539656 |
| Swordfish | 18 | 0 | Walk：83727818424239；Idle：78608203402071 |
| MantisShrimp | 6 | 0 | Walk：101166563162686；Idle：110459384539656 |
| GoblinShark | 6 | 0 | Walk：101166563162686；Idle：110459384539656 |
| LeafySeaDragon | 6 | 0 | Walk：101166563162686；Idle：110459384539656 |
| MEGALODON | 18 | 0 | Walk：135431336555966；Idle：139137956762257 |
| Amphiptere | 14 | 0 | Walk：132786705856863；Idle：120871615286306 |
### 7 · Volcano Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Jackalope | 27 | 0 | Walk：119633799371557；Idle：88965886085030 |
| DIMETRODON | 28 | 0 | Walk：129201488277568；Idle：116727487408212 |
| Brachiosaurus | 27 | 0 | Walk：105123564900536；Idle：123080190944814 |
| Lindworm | 14 | 0 | Walk：132786705856863；Idle：120871615286306 |
| T-Rex | 26 | 0 | Walk：89517524310155；Idle：95732239757990 |
| Fenrir | 27 | 0 | Walk：119633799371557；Idle：88965886085030 |
| CERBERUS | 27 | 0 | Walk：129201488277568；Idle：116727487408212 |
| Raiju | 27 | 0 | Walk：119633799371557；Idle：88965886085030 |
### 8 · Blossom Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Tanuki | 16 | 0 | Walk：89517524310155；Idle：95732239757990 |
| Surgeonfish | 10 | 0 | Walk：83727818424239；Idle：78608203402071 |
| Mandarinfish | 11 | 0 | Walk：83727818424239；Idle：78608203402071 |
| DumboOctopus | 20 | 0 | Walk：125057486164961；Idle：130358947483767 |
| Akita | 27 | 0 | Walk：116245363105425；Idle：75384603821961 |
| Gallimimus | 26 | 0 | Walk：89517524310155；Idle：95732239757990 |
| Wolf | 26 | 0 | Walk：105123564900536；Idle：123080190944814 |
| SIMURGH | 27 | 0 | Walk：86907797531617；Idle：98243084234606 |
### 9 · Galaxy Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Crocodile | 26 | 0 | Walk：105123564900536；Idle：123080190944814 |
| Whale | 16 | 0 | Walk：83727818424239；Idle：78608203402071 |
| Zebra | 25 | 0 | Walk：105123564900536；Idle：123080190944814 |
| THUNDERBIRD | 26 | 0 | Walk：86907797531617；Idle：98243084234606 |
| ARCHAEOPTERYX | 27 | 0 | Walk：86907797531617；Idle：98243084234606 |
| WINGED_IMP | 19 | 0 | Walk：112609143900072；Idle：111041409743295 |
| CALADRIUS | 27 | 0 | Walk：86907797531617；Idle：98243084234606 |
| Velicoraptor | 26 | 0 | Walk：89517524310155；Idle：95732239757990 |
| CLASSICDRAGON | 32 | 0 | Walk：75162269191521；Idle：120840122644736 |
| QILIN | 28 | 0 | Walk：129201488277568；Idle：116727487408212 |
### 10 · Planet X Zone

| 动物 | Bone | Motor6D | 动画（名称：ID） |
| --- | ---: | ---: | --- |
| Bug | 13 | 8 | Walk：85796181058430；Idle：92110619232235 |
| CrystalLizard | 21 | 58 | Walk：119784579253064；Idle：86847457643159 |
| CrystalBeast | 21 | 57 | Walk：137190346735870；Idle：99420801168375 |
| CrystalRaptor | 20 | 37 | Walk：84912645455974；Idle：109481261718463 |
| CrystalDragon | 28 | 53 | Walk：75898883357755；Idle：115709766695934 |
| Mantis | 17 | 25 | Walk：124162658312389；Idle：90206663745233 |
| AlienJellyfish | 42 | 3 | Walk：125926075715821；Idle：92429679954246 |
| CrystalScorpion | 35 | 37 | Walk：117299095905420；Idle：97383093228865 |
| Behemoth | 22 | 50 | Walk：138772872187977；Idle：123056418543769 |
| CrystalWolf | 23 | 45 | Walk：79081024780551；Idle：70559539752544 |
| CelestialBeast | 20 | 65 | Walk：90466984044630；Idle：79456386324118 |
| CelestialSpirit | 20 | 53 | Walk：116603654292896；Idle：103521410218834 |

## 动画数据的实际完整性



| 本地关键帧路径 | 时长秒 | 关键帧 | Pose |
| --- | ---: | ---: | ---: |
| `/ReplicatedStorage/Devil Animals/Devil/Cerberus/AnimSaves/Walk` | 0.95 | 25 | 525 |
| `/ReplicatedStorage/Devil Animals/Devil/Cerberus/AnimSaves/Idle` | 3.6 | 33 | 693 |
| `/ReplicatedStorage/Devil Animals/Devil/Bat/AnimSaves/Walk` | 1.2 | 25 | 250 |
| `/ReplicatedStorage/Devil Animals/Devil/Bat/AnimSaves/Idle` | 3 | 49 | 490 |
| `/ReplicatedStorage/Devil Animals/Devil/Dragon/AnimSaves/Walk` | 1.2 | 25 | 550 |
| `/ReplicatedStorage/Devil Animals/Devil/Dragon/AnimSaves/Idle` | 3 | 49 | 1078 |
| `/ReplicatedStorage/Devil Animals/Devil/Golem/AnimSaves/Walk` | 1.3 | 25 | 400 |
| `/ReplicatedStorage/Devil Animals/Devil/Golem/AnimSaves/Idle` | 4 | 33 | 528 |
| `/ReplicatedStorage/Devil Animals/Devil/Scorpion/AnimSaves/Walk` | 0.9 | 25 | 500 |
| `/ReplicatedStorage/Devil Animals/Devil/Scorpion/AnimSaves/Idle` | 3.2 | 33 | 660 |
| `/ReplicatedStorage/Devil Animals/Devil/Hellhound/AnimSaves/Walk` | 0.85 | 25 | 425 |
| `/ReplicatedStorage/Devil Animals/Devil/Hellhound/AnimSaves/Idle` | 3.2 | 33 | 561 |
| `/ReplicatedStorage/Devil Animals/Devil/Boar/AnimSaves/Walk` | 0.8 | 25 | 450 |
| `/ReplicatedStorage/Devil Animals/Devil/Boar/AnimSaves/Idle` | 3.2 | 33 | 594 |
| `/ReplicatedStorage/Devil Animals/Devil/Fox/AnimSaves/Walk` | 0.8 | 25 | 475 |
| `/ReplicatedStorage/Devil Animals/Devil/Fox/AnimSaves/Idle` | 3.2 | 33 | 627 |
| `/ReplicatedStorage/TemplateR15/AnimSaves/Bat Swing` | 0.883333 | 54 | 540 |
| `/ReplicatedStorage/TemplateR15/AnimSaves/Pickaxe Swing` | 0.85 | 52 | 832 |

## 其他蛋与动物库

- `ReplicatedStorage/Eggs`：区域NormalEggs以外还包含特殊/活动蛋。
- `ReplicatedStorage/AnimalisticEggs`：动物造型蛋；`Shared/AnimalEggsConfig`记录具体动物映射。它们与30种区域刷新蛋分开。
- `ReplicatedStorage/EggHell/{White,Black}`：天使/地狱动物造型蛋；映射见AnimalEggsConfig。
- `ReplicatedStorage/Animals/{Normal,Gold,Diamond}`下还有AnimalHELL、AnimalANGEL、Celestial、Community及Zone_10_Retired。
- `ReplicatedStorage/Zone_10`：12个带编号的第十区源模型，包括 `7: Jellyfish`；当前动物池名为AlienJellyfish，以主Animals库模板为准。
- `ReplicatedStorage/Devil Animals`：Devil、Fallen Angel及其Gold/Diamond，共48个模型。
- 上述库的全部模型路径、骨骼与Animation引用一并进入inventory.json；Extras配置单独保留，不能凭CashZone当作普通区域掉落。

## 区域守卫

守卫单独列出，避免和可孵化动物混淆；下面是Workspace中的实际实例路径，骨骼和动画亦已索引。

| 区域 | 守卫配置名 | Bone / Motor6D | 动画（名称：ID） | 实际位置 |
| --- | --- | --- | --- | --- |
| 1 | Chicken | 14 / 6 | Walk：138876818343982；Idle：123405154256492 | `/Workspace/Build/ZoneBuilds/Zone1/Chicken` |
| 2 | SPHINX | 28 / 6 | Walk：129201488277568；Idle：116727487408212 | `/Workspace/Build/ZoneBuilds/Zone2/SPHINX` |
| 3 | IceYeti | 28 / 6 | Walk：121196378119008；Attack：124176099144018；Idle：110413390151409 | `/Workspace/Build/ZoneBuilds/Zone3/IceYeti` |
| 4 | EmeraldSerpent | 23 / 6 | Walk：84591885043491；Attack：137663529673535；Idle：76916031710442 | `/Workspace/Build/ZoneBuilds/Zone4/EmeraldSerpent` |
| 5 | WoollyMammoth | 32 / 6 | Walk：112101594820426；Attack：139751401943991；Idle：85314870453992 | `/Workspace/Build/ZoneBuilds/Zone5/WoollyMammoth` |
| 6 | RedshellCrab | 36 / 6 | Idle：87946389965275；Walk：86756090934625；Attack：137936020353946 | `/Workspace/Build/ZoneBuilds/Zone6/RedshellCrab` |
| 7 | MoleTitan | 27 / 6 | Walk：81281491566473；Idle：73771525225303；Attack：119976201013376 | `/Workspace/Build/ZoneBuilds/Zone7/MoleTitan` |
| 8 | Griffin | 83 / 32 | Walk：81426494751710；Idle：96903663164178 | `/Workspace/Build/ZoneBuilds/Zone8/Griffin` |
| 9 | 3Hydra | 102 / 13 | Idle：107045451670114；Walk：98325272450687 | `/Workspace/Build/ZoneBuilds/Zone9/3Hydra` |
| 10 | AlienGuardian | 23 / 19 | Idle：138606478982359；Walk：127571336918098 | `/Workspace/Build/ZoneBuilds/Zone10/AlienGuardian` |





## 动物动画网页预览（2026-10-23）



## 二次补缺后的当前状态（2026-10-23）



## 使用与边界

- 重建命令（h5-map目录）：`python tools/inspect_animal_assets.py`。
- 当前H5运行地图仍来自静态OBJ，不包含动物蒙皮或动画。独立检查页已为74种动物另行恢复蒙皮和缓存动作；接入实际动物玩法仍需按用户指定任务实施。
- 资源盘点与静态预览没有恢复基地误采集动物，没有改动运行地图或向游戏主画面新增UI。


## 十区守卫运行资源补齐（2026-10-24）




## 十区原蛋刷新资源现状（2026-10-24）




## T06.3 v2区域蛋补缺（2026-10-24）



运行与模型预览共用补充清单，原蛋命名/档位/血量/概率/奖励规则保留，几何范围按实际GLB重算。存档键与既有资产保留，旧档补首区槽，必要时为新几何重新选合法位置。原缺口审计继续保留，Blossom Egg仍缺3张原贴图。重建 `python h5-map/tools/prepare_v2_eggs.py`；详情与逐区映射见[EGG_SPAWNING.md](EGG_SPAWNING.md)。14项刷新专项及完整109项测试通过。


### Blossom Egg贴图缺口替代（2026-10-24）

