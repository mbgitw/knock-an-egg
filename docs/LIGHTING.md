# 光照、天空与守卫材质修正

日期：2026-10-24。范围 B01.L：根据用户两张截图检查原 Lighting/Sky 与 H5 暗淡原因，修复正式入口。

## 核实的原参数



| 属性 | 原值 |
| --- | --- |
| TimeOfDay / GeographicLatitude | 12:00:00 / 0 |
| Brightness / ExposureCompensation | 2.5 / 0 |
| Ambient | RGB(218,199,156) |
| OutdoorAmbient | RGB(146,201,226) |
| EnvironmentDiffuseScale / SpecularScale | 0.75 / 0.70 |
| GlobalShadows / ShadowSoftness | true / 0.2 |
| ColorCorrection Contrast / Saturation / Brightness | 0.2 / 0.1 / 0 |
| ColorCorrection TintColor | RGB(255,237,239) |
| Atmosphere Density / Haze / Glare | 0.309 / 0 / 0 |
| SunRays Intensity / Spread | 0.01 / 0.5 |

正在使用的是 Lighting 直属的 Sky，六面资源 Rt/Lf/Up/Dn/Bk/Ft 分别为 591057625、591057861、591059642、591059876、591058823、591058104。Skies 文件夹里的两套备用天空未启用，不能混用。六面原 PNG 均已实际下载、解码并记录哈希，无生成替代图片。

## 发灰原因与实现





## 复现与验证

- 正式页：http://localhost:8765/ 。不新增提示UI，原账户/玩法保持。
- 对照页：http://localhost:8765/lighting-test.html 。独立内存账户，固定镜头和鸡位置，三个按钮分别为旧画面、仅修材质、完整修正。固定位置仅在该验收页生效。
- 截图：`h5-map/preview-lighting-before.png`、`preview-lighting-material.png`、`preview-lighting-after.png`。
- 重建：在 h5-map 执行 `python tools/prepare_lighting.py`（已有图片复用）与 `python tools/build_guard_assets.py`。
- 原85项自动测试通过；新增材质回归后守卫20/20通过，覆盖6个原SurfaceAppearance色调及普通材质不变。
- 浏览器已验证正式画面和同视角三种模式，天空/云层、鸡/嘴/脚底色、地面纹理均可见。调试时的一次重复shader函数错误已修复，正式页最终刷新后无新增error/warn。首次额外开页曾出现Horns1_nmap.png单次加载失败；源PNG可解码、HTTP 200，刷新后未重现。
- 本次加入单次全屏渲染与MSAA目标，触屏真机性能尚未测量。


## 2026-10-25 普通动物偏暗修复（T02 显示修复，已完成）





