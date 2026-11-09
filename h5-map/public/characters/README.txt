默认人物精简包

使用 default-character.glb 即可，无需任何外部贴图或游戏代码。
包含：默认橙色衣服、默认表情、棕色头发、12 根蒙皮骨骼和 17 段动画。
衣服和表情已烘焙为标准 PBR 基础色贴图，全部纹理内嵌。
双击 preview.html 可离线查看人物并切换动画；预览页自带运行库，不需要安装 Node.js。

导入说明
- Three.js：GLTFLoader 加载 GLB，使用 AnimationMixer 播放 gltf.animations。
- Blender/Godot：直接导入 GLB。其他引擎若不原生支持 glTF，需要对应导入器。
- 保留源骨骼名称、绑定和坐标比例，不强制转换成人形骨架。
- 批量生成多个人物实例时，Three.js 请使用 SkeletonUtils.clone。
- 人物世界移动、碰撞、武器逻辑、实时布娃娃不在资源包内。
- 不含其他换装资源、商店、支付、存档、蛋或武器模型。

动画清单
Breathing Idle — 10.033 秒
RunLobbyNew — 0.367 秒
LobbyAir — 1.833 秒
global_slide_start — 0.167 秒
global_crouch — 0.000 秒
global_air — 1.833 秒
global_hold — 0.167 秒
global_hold_dualgun — 0.083 秒
global_hold_grenade — 0.167 秒
global_hold_knife — 0.167 秒
global_hold_minigun — 0.167 秒
global_hold_pistol — 0.083 秒
global_hold_rpg — 0.167 秒
global_hold_shield — 0.083 秒
Carry Egg — 10.033 秒
Guard Knockback — 1.800 秒
Carry Egg Run — 0.367 秒

Breathing Idle、RunLobbyNew、Carry Egg、Carry Egg Run 适合循环。
Guard Knockback 建议单次播放。global_crouch 是零时长静态姿势，global_hold* 是持物姿势短片段。
14 段为原始角色可用动画，Carry Egg / Guard Knockback / Carry Egg Run 是当前项目补充动画。
原项目中的第一人称枪械动画不绑定此第三人称骨架，未混入本包。

来源说明
本包由当前项目 character-threejs 角色资源精简导出；未附加新的授权或更改原资源权利归属。
