// 从 assets/*.json 生成 14 个静态页面（films / television / 12 个详情页）。
//
// 为什么要有这个脚本：Pages 是纯静态托管，每个 URL 都得是真文件，
// 而这些页面共用同一套 <head>、导航、画廊骨架。手写 14 份必然漂移，
// 所以用一个脚本一次性生成，产物照常提交进仓库——
// 访问者不需要 Node，只有改模板的人才跑它：
//
//     node tools/build-pages.mjs
//
// 它不是构建步骤，是代码生成器。页面本身依旧零构建、CDN importmap。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const read = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));
const films = await read('assets/films.json');
const series = await read('assets/television.json');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
const slug = (item) => item.detailUrl.split('/').filter(Boolean).pop();

/** 详情页/画廊页都要相对路径回到复刻根目录，层数不同。 */
const upTo = (depth) => '../'.repeat(depth);

const A24_LOGO = (await readFile(join(here, 'logo.svg'), 'utf8')).trim();

/** 导航。current 决定哪一项是 aria-current，base 决定链接深度。 */
function nav(current, base) {
  const item = (label, href) => {
    const active = current === label.toLowerCase();
    return `          <li><a class="nav-link" data-hover href="${href}"${
      active ? ' aria-current="page"' : ''
    }><span data-hover-target>${label}</span></a></li>`;
  };
  return `    <nav class="nav" data-theme-target="nav" aria-label="Primary">
      <div class="nav-container">
        <div class="nav-bg"></div>
        <ul class="nav-center__list">
          <li>
            <a class="nav-logo" href="${base || './'}" aria-label="A24 home">
${A24_LOGO}
            </a>
          </li>
${item('Films', base || './')}
${item('Television', `${base}television/`)}
          <li><a class="nav-link" data-hover href="${base || './'}"><span data-hover-target>Index</span></a></li>
        </ul>
      </div>
    </nav>`;
}

/** 隐藏数据源。渲染代码只认这套 data 属性，所以换目录不用动 JS。 */
function dataSource(items, base) {
  const rows = items
    .map((item) => {
      const art = item.discArtUrl.startsWith('http')
        ? item.discArtUrl
        : base + item.discArtUrl;
      const reviews = item.reviews
        .map(
          (r) => `          <div data-review-source-item>
            <p data-film-field="review-publication">${esc(r.publication)}</p>
            <p data-film-field="review-testimonial">${esc(r.testimonial)}</p>
            <p data-film-field="review-stars">${r.stars}</p>
          </div>`,
        )
        .join('\n');
      return `        <div data-film-item>
          <p data-film-field="title">${esc(item.title)}</p>
${item.directors.map((d) => `          <p data-film-field="directors">${esc(d)}</p>`).join('\n')}
          <p data-film-field="year">${esc(item.year)}</p>
${item.starring.map((a) => `          <p data-film-field="starring">${esc(a)}</p>`).join('\n')}
          <p data-film-field="disc-art-url">${attr(art)}</p>
          <p data-film-field="disc-art-alt">${attr(item.discArtAlt)}</p>
          <a data-film-field="detail-url" href="${base}production/${slug(item)}/"></a>
${reviews}
        </div>`;
    })
    .join('\n');

  return `      <div class="film-data" data-film-list hidden>
${rows}
      </div>`;
}

/** 画廊骨架：films 和 television 两页完全一样，只有数据源不同。 */
function galleryMarkup(items, base) {
  return `      <section id="section_hero" class="section_hero" data-disc-gallery>
        <div class="experience_wrap">
          <!-- 左上信息面板 -->
          <div class="experience_info" data-disc-group="info">
            <h1 class="heading-s" data-film-target="title">&nbsp;</h1>
            <div class="divider-horizontal"></div>
            <dl class="experience_credits">
              <div class="credit-row">
                <dt class="subheading-xs">Directed by</dt>
                <dd class="paragraph-m" data-film-target="primary-credit">&nbsp;</dd>
              </div>
              <div class="credit-row">
                <dt class="subheading-xs">Year</dt>
                <dd class="paragraph-m" data-film-target="year">&nbsp;</dd>
              </div>
              <div class="credit-row">
                <dt class="subheading-xs">Starring</dt>
                <dd class="paragraph-m" data-film-target="starring">&nbsp;</dd>
              </div>
            </dl>
          </div>

          <!-- 底部影评 -->
          <div class="testimonial_wrap" data-testimonial-wrap data-disc-group="reviews">
            <div class="testimonial_item" data-review-target-item>
              <div class="testimonial_stars" data-review-stars aria-hidden="true"></div>
              <p class="subheading-xs" data-review-publication>&nbsp;</p>
              <p class="paragraph-m" data-review-text data-review-testimonial>&nbsp;</p>
            </div>
            <div class="divider-horizontal divider-vertical"></div>
            <div class="testimonial_item" data-review-target-item>
              <div class="testimonial_stars" data-review-stars aria-hidden="true"></div>
              <p class="subheading-xs" data-review-publication>&nbsp;</p>
              <p class="paragraph-m" data-review-text data-review-testimonial>&nbsp;</p>
            </div>
          </div>
        </div>

        <!-- canvas 的归位点。切换时 canvas 会被摘进 [data-disc-carry] -->
        <div data-canvas-home>
          <div class="experience-canvas" data-disc-canvas></div>
        </div>

${dataSource(items, base)}
      </section>`;
}

/** 详情页正文。直出完整内容，直接访问 URL 也立刻可读，不等 JS。 */
function detailMarkup(item, siblings, base) {
  const index = siblings.findIndex((s) => slug(s) === slug(item));
  const backHref = base + (siblings === series ? 'television/' : '');
  const backLabel = siblings === series ? 'Television' : 'Films';
  const quotes = item.reviews
    .map(
      (r) => `          <blockquote class="detail__quote" data-detail-reveal>
            <p>“${esc(r.testimonial)}”</p>
            <cite>${esc(r.publication)} · ${r.stars}/5</cite>
          </blockquote>`,
    )
    .join('\n');

  return `      <section
        class="detail detail--page"
        data-detail-page
        data-detail-index="${index}"
        data-detail-collection="${siblings === series ? 'television' : 'films'}"
      >
        <article class="detail__panel">
          <a class="detail__close" href="${backHref}" data-detail-back>Close</a>
          <h1 class="heading-s" data-detail-reveal>${esc(item.title)}</h1>
          <div class="divider-horizontal" data-detail-reveal></div>
          <p class="paragraph-m" data-detail-reveal>Directed by ${esc(
            item.directors.join(', '),
          )} · ${esc(item.year)}</p>
          <p class="paragraph-m detail__starring" data-detail-reveal>${esc(
            item.starring.join(' · '),
          )}</p>
          <div class="detail__quotes">
${quotes}
          </div>
        </article>
      </section>`;
}

/** 整页外壳。三个命名空间共用，差异只在 namespace / 正文 / 标题。 */
function page({ namespace, title, description, body, base, current, preload = true }) {
  return `<!doctype html>
<html lang="en"${preload ? ' data-preload' : ''}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${attr(description)}" />
    <link rel="stylesheet" href="${base}styles.css" />
    <script type="importmap">
      {
        "imports": {
          "three": "https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js",
          "gsap": "https://cdn.jsdelivr.net/npm/gsap@3.15.0/index.js",
          "@barba/core": "https://cdn.jsdelivr.net/npm/@barba/core@2.10.3/dist/barba.mjs"
        }
      }
    </script>
    <script>
      // 入场前先隐藏导航与文案，由 preloader 收尾时揭示；
      // reduced-motion 下不走这条路径。
      if (matchMedia('(prefers-reduced-motion: reduce)').matches)
        document.documentElement.removeAttribute('data-preload');
    </script>
  </head>
  <body>
    <!-- 胶片颗粒：整页叠一层，所有画面的质感都来自它 -->
    <div class="grain" data-grain-animate="true" aria-hidden="true"></div>

${nav(current, base)}

    <main data-barba="wrapper">
      <div data-barba="container" data-barba-namespace="${namespace}" data-page-base="${base}">
${body}
      </div>
    </main>

    <!-- 切换时 canvas 临时挂到这里，脱离页面布局 -->
    <div class="disc-carry" data-disc-carry aria-hidden="true"></div>

    <script type="module" src="${base}src/main.js"></script>
  </body>
</html>
`;
}

const out = [];

out.push([
  'index.html',
  page({
    namespace: 'films',
    current: 'films',
    base: '',
    title: 'A24 — Films · Disc Gallery Remake',
    description:
      '三维光盘轮播的效果复刻：three.js 程序化材质、滚轮手势状态机、行遮罩文案切换。',
    body: galleryMarkup(films, ''),
  }),
]);

out.push([
  'television/index.html',
  page({
    namespace: 'television',
    current: 'television',
    base: '../',
    title: 'A24 — Television · Disc Gallery Remake',
    description:
      '光盘轮播的剧集目录，与 Films 共用同一套渲染，切换时当前光盘翻面交接。',
    body: galleryMarkup(series, '../'),
  }),
]);

for (const [collection, items] of [
  ['films', films],
  ['television', series],
]) {
  for (const item of items) {
    out.push([
      `production/${slug(item)}/index.html`,
      page({
        namespace: 'production',
        current: collection,
        base: '../../',
        preload: false,
        title: `${item.title} — A24 · Disc Gallery Remake`,
        description: `${item.title}（${item.directors.join(', ')}, ${item.year}）的详情页。`,
        body: detailMarkup(item, items, '../../'),
      }),
    ]);
  }
}

for (const [path, html] of out) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, html);
}
console.log(`wrote ${out.length} pages`);
