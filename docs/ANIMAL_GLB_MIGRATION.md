# 动物资源 GLB 本地优化

## 2026-10-26 动物GLB优化版已同步 Builda

用户授权“测完之后推一版到Builda”。重新构建release并通过242项回归、5项动画专项、92种模型/动作/材质/实例释放检查、12组像素对照和实际本地游戏六项流程，资源及脚本无错误、无旧rig/clip请求。SDK检查与官方bundle检查通过。发布包由官方bundle-pack生成，为52117785字节（49.70MiB）；与此前49.47MiB包压缩器口径不同，运行文件仅重建scene UUID变化，不能把差值当成新增资源。



本条覆盖此前本轮“未上传”的状态；仅同步客户端待发布草稿，未部署Room，保持兼容修订2，不代表本地付款及移动服务端改动已上线。手机加载、原生音频和真实联机仍需App试玩验证；公开发布仍为pending_user_action，需要在Builda App试玩后提交审核发布。

2026-10-26：92种动物已接入本地正式加载路径，未上传Builda、未部署Room。用户确认试验不影响线上后同意开始优化，本轮按已说明的边界只做本地。

## 范围与结果

- 74种普通动物、12种Planet X动物、6种付费动物，原名称和物种ID保持。
- 每种一个自包含GLB，包含原静态展示模型、独立的蒙皮模型、Idle/Walk和原材质贴图；保留静态与动画两种模式，避免改变普通动物在手持/孵化时原有的静态表现。
- 贴图无损WebP；保持原Phong材质、法线方向、颜色、高光、透明度、尺寸和朝向。没有减面、重绘或改成调色板。
- 同种实例共享几何、贴图和动作数据；每只动物有独立骨架和mixer，同一多部件动物的网格共享一个等价skin。
- 只在构建目录排除478个确定被替代的旧scene、rig、clip和贴图，删除前核对其他保留scene的共享贴图引用。public中的OBJ、MTL、旧JSON与贴图原件保留。

同一份本地版本、ZIP Deflate level9口径：

| 项目 | 优化前 | 优化后 |
| --- | --- | --- |
| 本轮替换的动物资源 | 20.46 MiB | 13.57 MiB |
| 整个主包 | 56.42 MiB | 49.47 MiB |

动物资源减少约33.65%，整包减少7288526字节、约6.95MiB。整包基线为本轮开始时的本地构建，已含其他任务的本地改动，不等同于先前60.42MiB单曲草稿；不把其他任务的音频拆包收益计入本次动物优化。最终本地包`h5-map/build/animal-glb-optimized-local.zip`为51873251字节。

为了保持静态外观，这次GLB同时保留静态和蒙皮模型，体积收益不能直接套用之前只包含动画模型的双样本试验。原件没有删除。

## 运行路径和资源释放

`gameplay/animal-glb-runtime.js`按需读取清单与单物种GLB并缓存；失败会移除失败promise，后续操作可重试。`EggWorld.petTemplate`优先取GLB的静态模板，`createPetModel`识别模板标记后创建动画实例。保留原`includeOrdinary`语义：普通动物在默认展示/手持时静态，在牧场时启用动画；Planet X和付费动物继续动画显示。

变体继续使用现有`animal-variants/materials.json`：克隆材质后将对应材质传给动画实例，不修改Normal或其他实例。未恢复的变体仍按原逻辑回退，不伪造外观。图鉴的缺失渲染图恢复也使用新静态模板，不再依赖发布包中不存在的OBJ/MTL。

`disposePetModel`释放实例mixer和独立Skeleton，不释放由物种缓存拥有的共享geometry/material/texture；旧JSON路径仍按原规则释放其独有geometry。缓存按需加载、随页面会话保留，不预加载全部92种；本轮未实现LRU淘汰策略。

## 验证

- `npm test`：242项通过。
- `npm run test:animal-animations`：5项通过，包含74普通、12Planet X、6付费旧源数据与实际新GLB的回归。
- 浏览器实际构建：92种静态模型逐顶点误差0；Idle/Walk各7个时点，包含循环边界和跨周期，全部顶点最大误差约2.38e-6游戏单位；两动作时长保持。
- 92种验证Normal/Gold/Diamond现有材质规则、Normal不被变体修改、普通静态模式、共享几何、独立骨架及移除实例不误释放其他实例资源。
- Chicken、CrystalDragon、CelestialBeast、AngelHydra共12张左右对照图，平均每通道像素差小于0.05（0–255尺度）。左为旧路径，右为新路径。
- 完整本地游戏通过背包装备、牧场放置/动画、收回再装备、孵化落地、拾取搬运、丢弃六项。未请求旧rig/clip JSON，未出现脚本异常或资源404。测试用官方SDK mock和临时浏览器账户，没有访问正式账户。
- 92个GLB均为自包含资源、各1个共享skin；目录和清单引用完整，无临时测试页，诊断/离线发布开关false。

缓存后16实例创建中位数（桌面headless Chrome）：Chicken约13.1→1.7ms，CrystalDragon约36.8→6.6ms；几何缓冲分别544512→34032字节、5025248→314078字节。仅指几何缓冲，不是总内存。mixer推进240帧的耗时基本不变，不能据此声称手机FPS或七人满房性能提升。

## 重建与验收

在h5-map执行，需要现有Node/Three.js、Python/Pillow(WebP)和Chrome：

```text
node tools/prepare-builda-draft.mjs --release --legacy-animals
node tools/build-animal-glbs.mjs
node tools/prepare-builda-draft.mjs --release
npm test
npm run test:animal-animations
```

`--legacy-animals`保留导出所需旧模型数据，仅用于准备重建输入，不是运行时切回旧模型的开关。转换工具使用8771/9236端口并在结束关闭辅助进程。它写入public/gameplay/animal-glb/；92种均通过转换验收后才写最终清单。

发布构建会检查清单记录的原始文件和编译代码SHA256。源数据变化而GLB未重建时构建会失败，按上面的顺序重新生成，不绕过检查。构建清单的审计字段在发布包中移除，只留运行查找信息。

浏览器验收：`node tools/verify-animal-glb-game.mjs`，或`--models-only`仅检查模型与实例开销；需要8772/9237端口及保留的`build/animal-glb-baseline/model-check`旧模型依赖，测试结束清理临时页面。生成本地ZIP后可运行`python tools/validate-animal-glb-output.py`核对包、截图及验收证据。

