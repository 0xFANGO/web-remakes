# Web Remakes

把看到的好网页拆开，再用尽量少的依赖拼回去。

每个复刻是一个独立的静态目录，双击 `index.html` 就能跑，不需要构建步骤。
目标不是像素级还原，而是把**效果是怎么做出来的**讲清楚：参数来自哪里、
还原到什么程度、哪些地方是推断。

## 合集

| 复刻 | 原站 | 核心效果 |
|---|---|---|
| [A24 — Films](remakes/a24-disc-gallery/) | [a24.raviklaassens.com](https://a24.raviklaassens.com/) · Ravi Klaassens | three.js 三维光盘轮播、程序化材质、滚轮手势状态机 |

## 本地预览

静态文件，任意 HTTP 服务器都行（ES module 的 importmap 需要走 HTTP，不能用 `file://`）：

```bash
python3 -m http.server 4178
```

然后打开 <http://localhost:4178/>。

## 加一个新复刻

1. 建目录 `remakes/<slug>/`，里面是一个能独立打开的静态页面。
2. 写 `remakes/<slug>/README.md`：原站地址、技术栈、**参数出处**、还原程度、
   哪些是推断、哪些没做。
3. 放一张 `preview.jpg`（4:3，首页卡片用）。
4. 在 `remakes/index.json` 追加一条，首页会自动出卡片。

目录约定：

```
remakes/<slug>/
├── index.html      # 入口，可独立打开
├── styles.css
├── src/            # ES module，不走打包
├── assets/         # 图片、数据
├── preview.jpg     # 首页卡片图，4:3
└── README.md       # 实现说明与参数出处
```

## 依赖

走 CDN 的 importmap，不装 node_modules，不跑构建：

```html
<script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js" } }
</script>
```

版本号写死到具体小版本，避免哪天上游一改就挂。

## 版权

复刻仅用于学习与技术研究。原站的设计、文案与图片版权归原作者所有，
每个条目的 README 都标注了来源。涉及的影片封面等素材属于各自版权方，
仅作技术演示，不作商业用途。
