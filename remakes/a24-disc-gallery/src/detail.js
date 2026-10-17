// 详情页切换。
// 原站用 Barba 做多页无刷新切换，并把 WebGL canvas 摘进一个 fixed 载体，
// 让光盘"飞进"详情页。这里是单页复刻：详情做成同页覆盖层，
// 但保留同一套动作（按压 → 回弹 → 旋转退场 → canvas 载体搬运 → 淡入）。
import { gsap } from 'gsap';

const GLIDE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const TRANSITION = {
  pressScale: 0.94,
  pressDuration: 0.12,
  springScale: 1.015,
  springDuration: 0.16,
  outDuration: 0.55,
  detailFade: 0.35,
  inDuration: 1.05,
};

export function createDetail({ gallery, films }) {
  const overlay = document.querySelector('[data-detail-overlay]');
  const carry = document.querySelector('[data-disc-carry]');
  const canvasMount = document.querySelector('[data-disc-canvas]');
  if (!overlay || !carry || !canvasMount) {
    return { open() {}, close() {} };
  }

  const titleEl = overlay.querySelector('[data-detail-title]');
  const metaEl = overlay.querySelector('[data-detail-meta]');
  const starringEl = overlay.querySelector('[data-detail-starring]');
  const quotesEl = overlay.querySelector('[data-detail-quotes]');
  const closeButton = overlay.querySelector('[data-detail-close]');

  let open = false;
  let busy = false;
  let lastFocus = null;

  function fill(film) {
    if (titleEl) titleEl.textContent = film.title;
    if (metaEl)
      metaEl.textContent = `Directed by ${film.directors.join(', ')} · ${film.year}`;
    if (starringEl) starringEl.textContent = film.starring.join(' · ');
    if (quotesEl)
      quotesEl.replaceChildren(
        ...film.reviews.map((review) => {
          const quote = document.createElement('blockquote');
          quote.className = 'detail__quote';
          quote.dataset.detailReveal = '';

          const text = document.createElement('p');
          text.textContent = `“${review.testimonial.replace(/^[“"]+|[”"]+$/g, '')}”`;

          const cite = document.createElement('cite');
          cite.textContent = `${review.publication} · ${review.stars}/5`;

          quote.append(text, cite);
          return quote;
        }),
      );
  }

  function openDetail(index) {
    if (open || busy) return;
    const film = films[index];
    if (!film) return;

    busy = true;
    lastFocus = document.activeElement;
    fill(film);

    // 把 canvas 摘进 fixed 载体，切换过程中光盘不随布局变化
    carry.appendChild(canvasMount);
    carry.classList.add('is-active');

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');

    gsap
      .timeline({
        onComplete: () => {
          busy = false;
          open = true;
          closeButton?.focus({ preventScroll: true });
        },
      })
      .fromTo(
        overlay,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: TRANSITION.detailFade, ease: GLIDE },
        TRANSITION.pressDuration + TRANSITION.springDuration,
      )
      .fromTo(
        overlay.querySelectorAll('[data-detail-reveal]'),
        { yPercent: 40, autoAlpha: 0 },
        {
          yPercent: 0,
          autoAlpha: 1,
          duration: 0.7,
          ease: GLIDE,
          stagger: 0.06,
          clearProps: 'transform',
        },
        TRANSITION.pressDuration + TRANSITION.springDuration + 0.1,
      )
      .to(
        carry,
        { autoAlpha: 0, duration: TRANSITION.outDuration, ease: GLIDE },
        TRANSITION.pressDuration + TRANSITION.springDuration,
      );
  }

  function closeDetail() {
    if (!open || busy) return;
    busy = true;

    gsap
      .timeline({
        onComplete: () => {
          overlay.hidden = true;
          overlay.setAttribute('aria-hidden', 'true');
          // 还原 canvas 到页面内
          document.querySelector('[data-canvas-home]')?.appendChild(canvasMount);
          carry.classList.remove('is-active');
          gsap.set(carry, { autoAlpha: 1 });
          busy = false;
          open = false;
          lastFocus?.focus?.({ preventScroll: true });
          gallery.requestFrames(3);
        },
      })
      .to(overlay, { autoAlpha: 0, duration: TRANSITION.detailFade, ease: GLIDE })
      .to(carry, { autoAlpha: 1, duration: 0.3, ease: GLIDE }, 0);
  }

  closeButton?.addEventListener('click', closeDetail);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeDetail();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) closeDetail();
  });

  return { open: openDetail, close: closeDetail };
}
