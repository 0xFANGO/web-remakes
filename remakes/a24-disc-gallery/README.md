# A24 — Films · 三维光盘轮播

复刻自 [a24.raviklaassens.com](https://a24.raviklaassens.com/)（作者 Ravi Klaassens），
调研与复刻日期 2026-10-17。

![预览](preview.jpg)

12 部电影各对应一张 CD，排成一道弧线。滚轮、拖拽、键盘推动轮播，
当前光盘居中放大，左上信息面板与底部影评随之用行遮罩切换；
hover 当前光盘会出现手绘圈，空格翻到背面的虹彩数据面。

## 跑起来

需要 HTTP 服务（importmap 不能走 `file://`）：

```bash
python3 -m http.server 4178
```

打开 <http://localhost:4178/remakes/a24-disc-gallery/>。
加 `?debug` 会把 `gallery` / `films` / `CONFIG` 挂到 `window` 上。

## 操作

| 操作 | 效果 |
|---|---|
| 滚轮 / 触控板 | 一次手势走一格 |
| 拖拽空白处 | 拖动轮播，松手带惯性 |
| 拖拽当前光盘 | 转动这张盘，松手弹回 |
| 点击非当前光盘 | snap 过去 |
| 点击当前光盘 / Enter | 打开详情 |
| 空格 | 翻面 |
| ← → / Home / End | 前后一格 / 首尾 |

## 技术栈

只有两个依赖，都走 CDN：

- `three@0.178.0` —— 3D 渲染。原站 `THREE.REVISION === "178"`，这里对齐同一版，
  因为背面的 `iridescence`（薄膜干涉）在这个版本是内置特性。
- `gsap@3.15.0` —— tween 与时间轴。

原站还用了 Lenis（平滑滚动）和 Barba（多页无刷新切换）。这里是单页复刻：
首屏本身不滚动，Lenis 没有用武之地；详情做成同页覆盖层，所以 Barba 也省掉了。

## 实现要点

### 光盘（`src/disc.js`）

一张光盘是 6 个 Mesh 加一个隐藏的拾取圆：

| Mesh | 几何 | 作用 |
|---|---|---|
| front | `RingGeometry(0.24, 0.974, 220)`，UV 重映射为平面投影 | 封面印刷面 |
| back | 同上，`rotation.y = π` | 数据面（虹彩） |
| edge | `LatheGeometry` 六点轮廓，含倒角 | 外缘白边 |
| hub | `LatheGeometry`，半径 0.214 → 0.24 | 透明塑料环 |
| matrix | `LatheGeometry`，半径 0.174 → 0.214 | 银色镜面环 |
| frost | `LatheGeometry`，半径 0.14 → 0.174 | 磨砂内环 |
| pick | `CircleGeometry(1, 24)`，不可见 | Raycaster 命中用 |

`RingGeometry` 默认是极坐标 UV，封面会被绕圈拉开，所以按顶点位置重映射成平面投影。
中心三个环的轮廓在厚度方向叠了 `cos(t·3π)` 的波浪，做出真实 CD 中心的多道台阶。

**质感 70% 来自光照与环境贴图，不是几何。** 环境贴图是一张 1024×512 的 canvas：
深色竖向渐变 (`#25282f → #0e0f13 → #020203`) 加四道亮条，经 `PMREMGenerator` 生成。
没有 HDR 文件。盘面上那道横贯的长条高光来自一盏 `RectAreaLight(6 × 0.4)`。

### 程序化贴图（`src/textures.js`）

四张贴图全部用像素循环生成，零外部美术资源：

- **frontNormal** —— 同心光学纹 `sin(r*0.6)*0.02` + 印刷颗粒噪声 − 10 条随机划痕 + 180 个灰尘点，经 Sobel 差分转法线
- **backNormal** —— 密集同心环 `sin(r*3.2)*0.5`，虹彩的方向性靠它
- **frontRough** —— 基础 0.42 + 高低频噪声 − 同心光泽带
- **backRough** —— 基础 0.23 + 低频环带 + 轻噪声

封面合成用 `ctx.clip('evenodd')` 一次裁出圆环（挖掉中心孔），底色 `#0c0c0e`。

### 布局公式（`src/gallery.js`）

设 `L` 是当前连续位置，对索引 `p` 的光盘，`m = p - L`，`θ = m * 0.35`：

```
x = sin(θ) * hGap(2.3) * 2.4
y = (active ? 0.06 : 0) - dip * (active ? 0.7 : 1)
z = -cos(θ) * depth * 2.4 + depth * 2.4     // depth = max(thickness*3, 0.12, depthGap)
rotation.y = -θ + lean * (active ? 1 : 1.12)
rotation.z = -lean * flowBank(0.32) * (active ? 0.7 : 1)
scale = active ? 1 : max(0.8, 1 - |m| * 0.2 * 0.6)
renderOrder = 500 + z*10 - p*0.01
```

`lean` 与 `dip` 来自 snap 弹簧速度，这就是滚动时光盘"甩一下再回正"的来源。
所有目标值都不是直接赋值，而是每帧按 `min(1, dt * k)` 插值逼近，
`k = clamp(followBase - |m| * followFalloff, followMin, followTight)` ——
离中心越远跟随越慢，形成拖尾。

### 滚轮手势

整站最精细的一块，也是最该照抄参数的一块。目标是**一次滚轮手势等于一格**，
无论触控板还是鼠标滚轮。判定靠四条独立规则，任一成立即视为新手势开始：

- 停顿 ≥ 130ms
- 间隔 ≥ 34ms 且距上次 step ≥ 90ms（鼠标滚轮的离散 tick）
- delta 突然超过指数衰减包络的 1.2 倍且距上次 step ≥ 190ms（触控板甩动）
- 持续滚动 ≥ 480ms 且力度 ≥ 峰值的 80%

手势内累加 delta（单次上限 24），超过阈值 6 就走一格。
macOS 触控板与 Windows 鼠标行为差异很大，简单 debounce 替代不了这个状态机。

### 按需渲染

没有常驻 `requestAnimationFrame`。任何输入或动画调用 `requestFrames(n)`，
布局函数返回"剩余运动量"，小于阈值就停。实测**空闲时 2 秒内 0 次 rAF**。

另外每 30 帧统计平均帧时长，超过 26.5ms 降一级像素比（档位 `[1, .85, .7, .55]`），
超过 45ms 降两级；`document.hidden` 时暂停。

### 文案切换（`src/panel.js`）

原站用 GSAP SplitText 拆行。这里用 Range API 逐字符量 y 坐标找断行点自己拆，
中英文混排也成立，少一个依赖。每行外包一层 `overflow: hidden` 的遮罩：
出场 `yPercent → -120`（0.4s，行间 0.016），入场从 `120 → 0`（0.7s，行间 0.05），
ease 统一 `cubic-bezier(0.32, 0.72, 0, 1)`。

影评引言在**长度最均衡的单词边界**拆成两行；半星用 `clip-path: inset(0 50% 0 0)`
加负 margin 实现。所有影评会先克隆到屏外量出最大宽度写进 `--testimonial-width`，
避免换片时布局抖动。

## 和原站的差异

**字体。** 原站用 Pangram Pangram 的商业字体（PP Eiko / PP Neue Montreal / PP Museum）。
这里换成 Instrument Serif + Instrument Sans，形态接近但不相同，标题的字形差异最明显。

**详情页。** 原站是 Barba 多页切换，光盘会"飞"进 `/production/<slug>` 真实页面。
这里是同页覆盖层，保留了同一套动作（按压 → 回弹 → canvas 搬进 fixed 载体 → 淡入），
但详情页本身的 hero 揭示动画没有复刻。

**没做的部分。** Television 页与 films ↔ television 的翻面切换、预告片灯箱、
Index 下拉菜单。原站的调研也没覆盖这些。

**颗粒图。** 原站用一张 avif 平铺噪点图，这里用内联 SVG `feTurbulence` 生成，
省掉一个外部文件，颗粒形态略有不同。

**透射分辨率。** 原站 `transmissionResolutionScale = 0.5` 把 hub/frost 的透射 pass
压成半分辨率。这个属性在 three 不同版本上名字不一样，代码里做了兼容判断，
拿不准就不设 —— 设成零尺寸的 render target 会让每帧刷 WebGL 错误。

## 参数出处

`src/config.js` 里的数值整体取自线上产物的配置对象，保持同名便于对照。
贴图生成器（`src/textures.js` 的四个 builder）在原站产物里是未压缩的字符串，
变量名完整，所以是逐行搬过来的，不是猜的。

几何、材质、布局公式、滚轮状态机的参数同样来自产物静态阅读。
环境贴图的四道亮条位置也在产物里（原分析文档把这一项标为"推断"，实际可以确认）。

## 无障碍

画廊是一个 `role="group"` 的 carousel，`tabindex="0"` 可聚焦，
换片通过 `aria-live="polite"` 播报"片名, n of 12"，有屏幕阅读器操作说明。
隐藏的数据源设了 `aria-hidden` 和 `inert`。

`prefers-reduced-motion: reduce` 下跳过 preloader、关掉颗粒跳动与所有过渡，
换片直接定位。

## 素材

`assets/art/` 的 12 张封面来自原站，已下载到本地（不热链对方 CDN）。
版权归 A24 及各影片版权方所有，这里仅作技术演示。
`assets/films.json` 是从原站 HTML 提取的结构化数据，保留原始的 data 属性协议 ——
换任何 CMS 或 JSON 数据源都不用动渲染代码。
