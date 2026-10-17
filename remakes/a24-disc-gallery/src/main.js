import { gsap } from 'gsap';
import { CONFIG } from './config.js';
import { createGallery } from './gallery.js';
import { createPanel } from './panel.js';
import { createPreloader } from './preloader.js';
import { createDetail } from './detail.js';

// 全局 ease，等价原站 CustomEase('main', '0.625, 0.05, 0, 1')
gsap.defaults({ ease: 'cubic-bezier(0.625, 0.05, 0, 1)' });

const section = document.querySelector('[data-disc-gallery]');
const canvasMount = document.querySelector('[data-disc-canvas]');
const nav = document.querySelector('[data-theme-target="nav"]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 读取隐藏的 film 数据源。保留 data 属性协议，换数据源不用动渲染代码。 */
function readFilms(root) {
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
      artwork: field('disc-art-url'),
      artworkAlt: field('disc-art-alt'),
      detailUrl:
        item.querySelector('[data-film-field="detail-url"]')?.getAttribute('href') ??
        '',
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
function setupHoverLinks() {
  document.querySelectorAll('[data-hover]').forEach((link) => {
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

const films = readFilms(section);

// 隐藏数据源对辅助技术与 Tab 都应不可见
const filmList = section.querySelector('[data-film-list]');
if (filmList) {
  filmList.setAttribute('aria-hidden', 'true');
  if ('inert' in HTMLElement.prototype) filmList.inert = true;
}

// 无障碍：画廊是一个可聚焦的 carousel，变化通过 aria-live 播报
section.setAttribute('tabindex', '0');
section.setAttribute('role', 'group');
section.setAttribute('aria-roledescription', 'carousel');
section.setAttribute('aria-label', 'Film disc gallery');
section.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End Enter Space');

const live = document.createElement('p');
live.className = 'visually-hidden';
live.setAttribute('aria-live', 'polite');
live.setAttribute('aria-atomic', 'true');
section.appendChild(live);

const help = document.createElement('p');
help.className = 'visually-hidden';
help.id = 'disc-gallery-help';
help.textContent =
  'Use the left and right arrow keys to browse films. Press Enter to open the film in front, or Space to flip the disc over.';
section.appendChild(help);
section.setAttribute('aria-describedby', help.id);

setupHoverLinks();

const gallery = createGallery({ container: section, canvasMount, films, settings: CONFIG });
const panel = createPanel({ root: section, films });
const detail = createDetail({ gallery, films });

panel.lockReviewWidth();
panel.write(films[0]);

section.addEventListener('discgallerychange', (event) => {
  const { index, film } = event.detail;
  panel.change(film);
  live.textContent = `${film.title}, ${index + 1} of ${films.length}`;
});

section.addEventListener('discgalleryopen', (event) => {
  detail.open(event.detail.index);
});

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
  panel.change(films[gallery.index], { immediate: true });
};

const preloader = createPreloader({
  gallery,
  onNav: revealNav,
  onCopy: revealCopy,
});

// reduced-motion 直接定位，不播任何入场动画
if (reducedMotion) {
  document.documentElement.removeAttribute('data-preload');
  preloader.skip();
  revealNav();
  revealCopy();
} else {
  gallery.warmUp().then(() => preloader.markSceneReady());
  preloader.start();
  // 兜底：20 秒后无论如何放开页面
  setTimeout(() => document.documentElement.removeAttribute('data-preload'), 20000);
}

// 调试开关：?debug 在控制台暴露内部对象
if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { gallery, panel, films, CONFIG });
}
