import barba from '@barba/core';
import { gsap } from 'gsap';
import { CONFIG } from './config.js';
import { createGallery } from './gallery.js';
import { createPanel } from './panel.js';
import { createPreloader } from './preloader.js';
import { createTransitions } from './transitions.js';

// 全局 ease，等价原站 CustomEase('main', '0.625, 0.05, 0, 1')
gsap.defaults({ ease: 'cubic-bezier(0.625, 0.05, 0, 1)' });

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 把页面里写的相对地址解析成绝对地址。
 * base 默认取当前文档；从 fetch 回来的 DOM 里读数据时没有文档基准，
 * 调用方把那一页的地址传进来。
 */
function resolveUrl(href, base = document.baseURI) {
  if (!href) return '';
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/** 读取隐藏的数据源。保留 data 属性协议，换数据源不用动渲染代码。 */
function readItems(root, base = document.baseURI) {
  return Array.from(root.querySelectorAll('[data-film-item]')).map((item) => {
    const field = (name) =>
      item.querySelector(`[data-film-field="${name}"]`)?.textContent.trim() ?? '';
    const fields = (name) =>
      Array.from(item.querySelectorAll(`[data-film-field="${name}"]`))
        .map((el) => el.textContent.trim())
        .filter(Boolean);

    return {
      title: field('title'),
      directors: fields('directors'),
      year: field('year'),
      starring: fields('starring'),
      artwork: resolveUrl(field('disc-art-url'), base),
      artworkAlt: field('disc-art-alt'),
      // 取 .href 而不是 getAttribute：浏览器按文档基准解析成绝对地址。
      // 页面写的是相对路径（Pages 部署在子路径下，根相对会指错地方），
      // 而 barba.go() 要的是从任何深度都不会再被二次拼接的 URL。
      // 详情页的数据源是 fetch 回来的 DOM，没有基准，所以带上 base 兜底。
      detailUrl: resolveUrl(
        item.querySelector('[data-film-field="detail-url"]')?.getAttribute('href') ??
          '',
        base,
      ),
      reviews: Array.from(item.querySelectorAll('[data-review-source-item]')).map(
        (review) => ({
          publication:
            review
              .querySelector('[data-film-field="review-publication"]')
              ?.textContent.trim() ?? '',
          testimonial:
            review
              .querySelector('[data-film-field="review-testimonial"]')
              ?.textContent.trim() ?? '',
          stars: Number(
            review
              .querySelector('[data-film-field="review-stars"]')
              ?.textContent.trim() ?? 0,
          ),
        }),
      ),
    };
  });
}

/** 导航 hover 的文字上下翻转：把文本包一层，副本靠 ::after 叠上去。 */
function setupHoverLinks(scope = document) {
  scope.querySelectorAll('[data-hover]').forEach((link) => {
    const target = link.querySelector('[data-hover-target]') ?? link;
    const text = target.textContent.trim();
    if (!text || target.querySelector('[data-hover-inner]')) return;

    const inner = document.createElement('span');
    inner.dataset.hoverInner = '';
    inner.dataset.text = text;
    const label = document.createElement('span');
    label.dataset.hoverText = '';
    label.textContent = text;
    inner.appendChild(label);
    target.replaceChildren(inner);
  });
}

// ---------------------------------------------------------------------------
// shell：活过所有页面切换的那一层
// ---------------------------------------------------------------------------
// 画廊只建一次。Barba 换掉的是 [data-barba="container"]，canvas 不在里面，
// 所以 renderer、程序化贴图、环境贴图、光盘池全程留用。
// 换页时发生的只有三件事：canvas 搬家、数据源换成新页的、事件宿主改绑。
const shell = {
  carry: document.querySelector('[data-disc-carry]'),
  canvasMount: null,
  gallery: null,
  panel: null,
  section: null,
  items: [],
  // 从哪张盘进的详情页。返回时摆回同一张，而不是弹回第一张 ——
  // 直接访问详情 URL 时由页面上的 data-detail-index 提供。
  returnIndex: 0,
  reducedMotion,
  currentItem() {
    return shell.items[shell.gallery?.index ?? 0];
  },
  bindPage,
};

let live = null;

/** 画廊页的无障碍属性。每次换页都要在新容器上重新声明一遍。 */
function describeGallery(section, count) {
  section.setAttribute('tabindex', '0');
  section.setAttribute('role', 'group');
  section.setAttribute('aria-roledescription', 'carousel');
  section.setAttribute('aria-label', 'Disc gallery');
  section.setAttribute(
    'aria-keyshortcuts',
    'ArrowLeft ArrowRight Home End Enter Space',
  );

  live = document.createElement('p');
  live.className = 'visually-hidden';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  section.appendChild(live);

  const help = document.createElement('p');
  help.className = 'visually-hidden';
  help.id = 'disc-gallery-help';
  help.textContent = `Use the left and right arrow keys to browse ${count} titles. Press Enter to open the title in front, or Space to flip the disc over.`;
  section.appendChild(help);
  section.setAttribute('aria-describedby', help.id);
}

const onGalleryChange = (event) => {
  const { index, film } = event.detail;
  shell.panel?.change(film);
  if (live) live.textContent = `${film.title}, ${index + 1} of ${shell.items.length}`;
};

const onGalleryOpen = (event) => {
  const item = shell.items[event.detail.index];
  if (!item?.detailUrl) return;
  shell.returnIndex = event.detail.index;
  barba.go(item.detailUrl);
};

/**
 * 把 shell 接到一个新页面的容器上。
 * 详情页没有画廊，这里只更新导航；画廊页则换数据源、换事件宿主。
 */
function bindPage(container) {
  setupHoverLinks(document);

  const section = container.querySelector('[data-disc-gallery]');
  if (!section) {
    shell.section = null;
    return;
  }

  const items = readItems(section);
  shell.items = items;
  shell.section = section;

  // 隐藏数据源对辅助技术与 Tab 都应不可见
  const list = section.querySelector('[data-film-list]');
  if (list) {
    list.setAttribute('aria-hidden', 'true');
    if ('inert' in HTMLElement.prototype) list.inert = true;
  }

  describeGallery(section, items.length);

  // canvas 还在载体里时不要抢回来，过渡结束后 drop() 会放回这一页的归位点
  const home = section.querySelector('[data-canvas-home]');
  if (home && shell.canvasMount && shell.canvasMount.parentElement !== shell.carry)
    home.appendChild(shell.canvasMount);

  shell.panel?.destroy?.();
  shell.panel = createPanel({ root: section, films: items });
  shell.panel.lockReviewWidth();
  const index = Math.min(Math.max(shell.returnIndex, 0), items.length - 1);
  shell.panel.write(items[index]);

  shell.gallery.setCatalog(items, { index });
  shell.gallery.setContainer(section);

  section.addEventListener('discgallerychange', onGalleryChange);
  section.addEventListener('discgalleryopen', onGalleryOpen);
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
const firstContainer = document.querySelector('[data-barba="container"]');
const firstSection = firstContainer?.querySelector('[data-disc-gallery]');
const pageBase = firstContainer?.dataset.pageBase ?? '';
const detailPage = firstContainer?.querySelector('[data-detail-page]');

/** 详情页直接打开时也要有画廊，否则返回时没有盘可飞。挂一个屏外的宿主。 */
function detachedHost() {
  const host = document.createElement('div');
  host.setAttribute('data-disc-gallery', '');
  host.setAttribute('aria-hidden', 'true');
  // 必须有真实尺寸：renderer 拿到 0×0 的 render target 会每帧刷
  // GL_INVALID_FRAMEBUFFER_OPERATION。inset:0 的 fixed 元素就够了，
  // 它铺满视口，和画廊页里的归位点尺寸一致。
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100svh',
    pointerEvents: 'none',
  });
  const mount = document.createElement('div');
  mount.className = 'experience-canvas';
  mount.setAttribute('data-disc-canvas', '');
  const home = document.createElement('div');
  home.setAttribute('data-canvas-home', '');
  home.appendChild(mount);
  host.appendChild(home);
  document.body.appendChild(host);
  return host;
}

/**
 * 详情页要知道自己所属的目录，返回时才摆得好光盘。
 * 页面上写了 collection 与 index，数据现取：直接访问详情 URL 时
 * 本页没有画廊数据，去抓对应的列表页。
 */
async function catalogForDetail(page) {
  const collection = page.dataset.detailCollection ?? 'films';
  const url = collection === 'television' ? `${pageBase}television/` : pageBase || './';
  try {
    const html = await fetch(url, { credentials: 'same-origin' }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const section = doc.querySelector('[data-disc-gallery]');
    if (section) return readItems(section, new URL(url, document.baseURI).href);
  } catch {
    /* 取不到就空着：详情页本身是静态直出的，照样可读 */
  }
  return [];
}

const bootSection = firstSection ?? detachedHost();
shell.canvasMount = bootSection.querySelector('[data-disc-canvas]');

const bootItems = detailPage
  ? await catalogForDetail(detailPage)
  : readItems(bootSection);
shell.items = bootItems;

// 空目录兜底：画廊至少要有一条数据才建得起来
const EMPTY_ITEM = {
  title: '',
  directors: [],
  year: '',
  starring: [],
  artwork: '',
  reviews: [],
};

shell.gallery = createGallery({
  container: bootSection,
  canvasMount: shell.canvasMount,
  films: bootItems.length ? bootItems : [EMPTY_ITEM],
  settings: CONFIG,
});

if (detailPage) {
  // 直接访问详情 URL：把画廊摆成"刚退场"的样子，返回时才接得上
  const index = Number(detailPage.dataset.detailIndex ?? 0);
  shell.returnIndex = index;
  if (bootItems.length) shell.gallery.setCatalog(bootItems, { index });
  shell.carry?.appendChild(shell.canvasMount);
  shell.carry?.classList.add('is-active');
  gsap.set(shell.carry, { autoAlpha: 0 });
  setupHoverLinks(document);
  document.documentElement.removeAttribute('data-preload');
} else {
  bindPage(firstContainer);
}

// ---------------------------------------------------------------------------
// preloader：只在首次落在画廊页时跑一次
// ---------------------------------------------------------------------------
const nav = document.querySelector('[data-theme-target="nav"]');

const revealNav = () => {
  if (!nav) return;
  gsap.fromTo(
    nav.querySelectorAll('.nav-bg, .nav-center__list > li'),
    { autoAlpha: 0, y: '-0.6em' },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.8,
      stagger: 0.06,
      clearProps: 'transform,visibility',
    },
  );
};

const revealCopy = () => {
  document
    .querySelectorAll('.experience_info, [data-testimonial-wrap]')
    .forEach((element) => {
      element.style.visibility = 'visible';
    });
  shell.panel?.change(shell.currentItem(), { immediate: true });
};

if (!detailPage) {
  const preloader = createPreloader({
    gallery: shell.gallery,
    onNav: revealNav,
    onCopy: revealCopy,
  });

  if (reducedMotion) {
    document.documentElement.removeAttribute('data-preload');
    preloader.skip();
    revealNav();
    revealCopy();
  } else {
    shell.gallery.warmUp().then(() => preloader.markSceneReady());
    preloader.start();
    // 兜底：20 秒后无论如何放开页面
    setTimeout(() => document.documentElement.removeAttribute('data-preload'), 20000);
  }
}

// 详情页按 Esc 返回。按钮是普通链接，这里走同一个地址，
// Barba 照样接管，过渡与点 Close 完全一致。
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const back = document
    .querySelector('[data-barba="container"]')
    ?.querySelector('[data-detail-back]');
  // 用 .href 而不是 getAttribute：相对地址交给 barba.go 会被二次拼接
  if (back) barba.go(back.href);
});

// ---------------------------------------------------------------------------
// Barba
// ---------------------------------------------------------------------------
barba.init({
  sync: true,
  preventRunning: true,
  timeout: 7000,
  // reduced-motion 下整个无刷新切换都不走，交给浏览器直接跳转
  prevent: ({ el }) => reducedMotion || el?.hasAttribute?.('data-barba-prevent'),
  transitions: createTransitions(shell),
});

// 换页后导航高亮跟着命名空间走
barba.hooks.after(({ next }) => {
  const ns = next.namespace;
  document.querySelectorAll('.nav-link').forEach((link) => {
    const label = link.textContent.trim().toLowerCase();
    if ((ns === 'films' || ns === 'television') && label === ns)
      link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  shell.gallery.requestFrames(2);
});

// 调试开关：?debug 在控制台暴露内部对象
if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { shell, gallery: shell.gallery, CONFIG, barba, gsap });
}
