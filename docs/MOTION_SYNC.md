# 人物移动同步专项（2026-10-26）

## 2026-10-26 暂停恢复时钟误拒绝修复（未部署）

线上已确认恢复active后MOTION_TIME持续，accepted与权威坐标冻结。手机sampleTime与Room state.elapsed不保证同速，不能用后者的间隔+1000ms限制前者。现只检查sampleTime单调及uint32回绕；跨大间隔仍由远端MotionTrack重置播放缓冲。服务器位移预算只依赖原Room模拟时间，不使用采样时间或速度增加额度。epoch、序号、边界、垂直校验保持。50项联机测试通过（含3项新增时钟/暂停/恢复后敲蛋回归），TS与恢复检查通过。纯服务端兼容修复，revision2不变；部署与新Room真实App验收待完成。

客户端草稿与配套Room已于2026-10-26按用户授权更新。客户端versionId ad467f6a-7802-5676-b064-76b9e73b7d42，Bundle ac1ab380dcc81ed64ef32410cf8b7724，sync=ok、ready；Room Artifact 039b7ed35be3cb386b90cbda31cf4eec，Release active，revision2。正式公开发布仍需App审核，真实双身份新Room验收仍pending。

沿用H5官方Online SDK、TypeScript Room、pasture-world公共七席持续世界；没有新增匹配入口、机器人、竞技回滚或比赛生命周期。原镜头策略、角色动画及禁止玩家诊断面板保持。

## 协议与兼容

onlineCompatibilityRevision保持2。旧客户端请求继续接受、旧响应格式继续理解、进房/重连/退出状态机不变；三项兼容性人工核对均为是。新客户端遇到旧Room没有能力声明时继续发送23字节MOVE；新Room只向已发送有效增强包的客户端发送MOTIONS，旧客户端接收原MOVES。快照分片拼接完后才协商；重新获取快照时重置序号基线与epoch，避免旧轨迹回放。现有Ticket/Room仍固定旧Artifact。

| 消息 | 方向/通道 | 内容/大小 | Room处理 |
| --- | --- | --- | --- |
| MOVE 1 / MOVES 102 | 原有不可靠状态通道 | 原23B单人、6+24N批量 | 继续兼容，旧观察方10Hz |
| MOTION 8 | 客户端→Room，不可靠 | 41B：原位置/朝向/序号/flags，uint32采样毫秒，3个float32速度，uint16 epoch | 校验全部有限值/长度/序号/epoch/时钟单调/回绕；沿用服务器累计距离额度及边界 |
| MOTIONS 111 | Room→增强客户端，不可靠 | 6+42N，最多7人300B；每条保留发送端采样时间 | 每tick合并当前帧，不可靠消息无补发队列 |
| SNAPSHOT 101 | 原可靠通道 | 新可选motion:{version:2,hz:20,epoch} | 不改原基线屏障/账户存档 |
| EVENT position | 原可靠通道 | 可选correction及motionEpoch | 真位移违规才纠正，不因短到包间隔拉回；重生仍直接定位 |

时间和速度仅用于表现，不能给客户端额外位移额度；仍是原来客户端碰撞+Room位移校验的信任模型，并非服务端重算人物物理或强反作弊。增强字段随state.players保留；调度余量随完整state检查点恢复，旧检查点缺可选字段用默认值。云存档键/结构不变。

## 调度与表现

- Room tickRate与本地Scenario改20Hz；onTick只调度移动，updateGameplay按累计100ms执行，保留守卫/蛋/经济10Hz工作量。
- 发包移动20Hz上限、静止1Hz；拥塞继续原有退避，不积压旧移动。移除80ms到达间隔拒绝，包成簇也受同一累计距离预算约束。
- 每个远端角色独立展开采样时钟。32个时差/间隔样本估计95分位抖动、100–300ms缓冲；播放速度最多±10%调整，缓存最多24个位置。网络到达节奏不作为运动节奏。
- 已确认位置之间按速度做单调Hermite插值，限制切线不越过已确认坐标范围。旧角色没有速度信息仍用直线插值；显示动画速度匹配移动速度。断流不外推，播放点停在最后确认时刻，恢复后继续；严重断档仍可能停顿，不能保证任何网络条件下完全连续。
- 1Hz静止转起跑插入站位边界，避免把第一小步分摊到整段静止心跳。epoch切断重生/重连前后轨迹，旧epoch拒绝。
- 小于等于6单位的权威纠正：物理立即采用服务端位置，角色和镜头的显示偏移按18/s指数衰减；重生、远距离或外力过程直接采用位置。不是物理插值，奖励/命中仍用权威规则。

## 带宽与负载

增强上行41B×20=820B/s/人；7人批量下行300B×20=6000B/s/接收者，七人合计42000B/s应用负载。另有消息类型、CYR1、WebRTC/平台传输开销，以及原有玩法消息；未实测线上协议开销，不能把应用负载当成全部流量。增强与旧包按接收者能力二选一，不给同一人重复发两种状态。每tick最多7次定向移动发送，远低于256 Host命令上限；其他玩法保持10Hz。

## 验证

命令：npm test；npm run test:online；node --test tools/test-camera-occlusion.mjs tools/test-guard-planner.mjs tools/test-room-budget.mjs；npx tsc --noEmit -p server/game/tsconfig.json；node tools/verify-motion-mock.mjs。

结果：224项全量、19项联机基础+15项既有专项+13项新同步专项、18项相机/守卫预算通过；TS/SDK/Online恢复检查通过。新专项覆盖跨JS域字节、截断/NaN/槽位、成簇到达、伪造时钟不增距离、检查点/epoch、20Hz与10Hz隔离、能力降级/分片、急转跳跃/断流、时钟序号回绕、静止起跑、小纠正及发送限频。





## 实机交付与复测

本地客户端目录build/builda-draft以--release生成，enabled:false、diagnostics:false，独立QA页不入包；ZIP为build/builda-motion-sync.zip。现已按兼容Room更新顺序先部署并激活Room，再上传客户端草稿；双方完全退出旧房，重新打开最新草稿进入新Room。公开发布仍需App审核流程。

bundle-check通过，ZIP 130764329字节。已评估>50MiB体积提示：最大文件是运行地图world.glb（约15.2MB）、map.json（约6.8MB）、守卫模型（约5.9MB），另有既有动物模型。沿用当前自包含资源，网络同步专项不同时改资源加载路径；后续模型延迟加载仍可独立优化。本包无独立测试页，诊断和离线开关均false。

两人轮流静止观察另一人直跑5秒、急停、往返与90/180度转向、连续跳跃、持物移动、回牧场/重生；再测短暂网络波动与恢复。关注脚步连续、停跑后不滑动、无忽近忽远/反复拉回、重生不拖影，以及旁观方自己的帧率。真机证据尚未取得，T37/T38/T43保持待验收。
