// 左上信息面板与底部影评的切换：按行遮罩推入推出。
// 不依赖 GSAP SplitText（付费插件已免费但需单独引入），用 Range API 自己量行。
import { gsap } from 'gsap';

const ENERGY = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * 把一个元素的文本按实际渲染的换行位置拆成行，每行外包一层 overflow:hidden 的遮罩。
 * 用 Range 逐字符量 y 坐标找断行点，比正则猜词更准，中英文混排也成立。
 */
function splitLines(element) {
  // 显式 <br> 是硬换行（影评两行、主演多行都靠它），
  // 直接取 textContent 会把两侧文字黏在一起，所以先把 <br> 换成 \n。
  if (element.querySelector('br')) {
    const parts = element.innerHTML
      .split(/<br\s*\/?>/i)
      .map((part) => {
        const probe = document.createElement('div');
        probe.innerHTML = part;
        return (probe.textContent ?? '').trim();
      })
      .filter(Boolean);

    element.replaceChildren();
    return parts.map((part) => {
      const mask = document.createElement('span');
      mask.dataset.discLineMask = '';
      const line = document.createElement('span');
      line.className = 'disc-line';
      line.textContent = part;
      mask.appendChild(line);
      element.appendChild(mask);
      return line;
    });
  }

  const text = element.textContent ?? '';
  if (!text.trim()) return [];

  // 先还原成纯文本，避免二次拆行时套娃
  element.textContent = text;

  const node = element.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];

  const range = document.createRange();
  const breaks = [];
  let lastTop = null;

  for (let i = 0; i < text.length; i += 1) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rect = range.getBoundingClientRect();
    if (!rect.height) continue;
    const top = Math.round(rect.top * 10) / 10;
    if (lastTop === null) lastTop = top;
    else if (top > lastTop + 1) {
      breaks.push(i);
      lastTop = top;
    }
  }
  range.detach?.();

  const segments = [];
  let start = 0;
  for (const index of breaks) {
    segments.push(text.slice(start, index));
    start = index;
  }
  segments.push(text.slice(start));

  element.replaceChildren();
  return segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const mask = document.createElement('span');
      mask.dataset.discLineMask = '';
      const line = document.createElement('span');
      line.className = 'disc-line';
      line.textContent = segment;
      mask.appendChild(line);
      element.appendChild(mask);
      return line;
    });
}

/** 把一句影评在"长度最均衡的单词边界"拆成两行，各自加弯引号。 */
function splitTestimonial(text) {
  const clean = text.replace(/^[“"'']+|[”"'']+$/g, '').trim();
  const words = clean.split(/\s+/);
  if (words.length < 4) return [`“${clean}”`];

  let bestIndex = 1;
  let bestDelta = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const left = words.slice(0, i).join(' ').length;
    const right = words.slice(i).join(' ').length;
    const delta = Math.abs(left - right);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }

  return [
    `“${words.slice(0, bestIndex).join(' ')}`,
    `${words.slice(bestIndex).join(' ')}”`,
  ];
}

/** 星级：满星/半星/空星，半星用 clip-path 切一半。 */
function renderStars(container, value) {
  container.replaceChildren();
  for (let i = 0; i < 5; i += 1) {
    const remaining = value - i;
    const star = document.createElement('span');
    star.className = 'star';
    star.dataset.starStatus =
      remaining >= 1 ? 'full' : remaining >= 0.5 ? 'half' : 'empty';
    star.textContent = '★';
    container.appendChild(star);
  }
}

export function createPanel({ root, films }) {
  const groups = [
    { element: root.querySelector('[data-disc-group="info"]'), stagger: 0 },
    { element: root.querySelector('[data-disc-group="reviews"]'), stagger: 0.06 },
  ].filter((group) => group.element);

  const targets = {
    title: root.querySelector('[data-film-target="title"]'),
    primaryCredit: root.querySelector('[data-film-target="primary-credit"]'),
    year: root.querySelector('[data-film-target="year"]'),
    starring: root.querySelector('[data-film-target="starring"]'),
  };
  const reviewItems = Array.from(root.querySelectorAll('[data-review-target-item]'));
  const dividers = Array.from(root.querySelectorAll('.divider-horizontal'));

  let inTimeline = null;
  let settleTimer = 0;

  /** 写入一部影片的数据。影评拆两行，主演多项换行。 */
  function write(film) {
    if (targets.title) targets.title.textContent = film.title;
    if (targets.primaryCredit)
      targets.primaryCredit.textContent = film.directors.join(', ');
    if (targets.year) targets.year.textContent = film.year;
    if (targets.starring)
      targets.starring.innerHTML = film.starring
        .map((name) => name.replace(/</g, '&lt;'))
        .join('<br>');

    reviewItems.forEach((item, index) => {
      const review = film.reviews[index];
      item.hidden = !review;
      if (!review) return;
      const stars = item.querySelector('[data-review-stars]');
      const publication = item.querySelector('[data-review-publication]');
      const quote = item.querySelector('[data-review-testimonial]');
      if (stars) renderStars(stars, review.stars);
      if (publication) publication.textContent = review.publication;
      if (quote) quote.innerHTML = splitTestimonial(review.testimonial).join('<br>');
    });
  }

  const textTargets = () =>
    Array.from(root.querySelectorAll('[data-film-target], [data-review-text]')).filter(
      (element) => !element.closest('[hidden]'),
    );

  /** 出场：所有行上推出遮罩，分隔线从右收起。 */
  function animateOut() {
    if (inTimeline) {
      // in 还没走完就换片 → 直接倒放当前 in 当作 out
      inTimeline.timeScale(1.6).reverse();
      return inTimeline.duration() / 1.6 * inTimeline.progress();
    }

    const lines = Array.from(root.querySelectorAll('.disc-line'));
    const timeline = gsap.timeline();
    if (lines.length)
      timeline.to(
        lines,
        { yPercent: -120, duration: 0.4, ease: ENERGY, stagger: 0.016 },
        0,
      );
    if (dividers.length)
      timeline.to(
        dividers,
        {
          scaleX: 0,
          duration: 0.4,
          ease: ENERGY,
          transformOrigin: 'right center',
          stagger: 0.016,
        },
        0,
      );
    return 0.4;
  }

  /** 入场：重新拆行，从下方 120% 推入，分隔线从左展开。 */
  function animateIn() {
    const lines = [];
    textTargets().forEach((element) => lines.push(...splitLines(element)));

    const timeline = gsap.timeline({
      onComplete: () => {
        inTimeline = null;
      },
    });
    inTimeline = timeline;

    groups.forEach((group, groupIndex) => {
      const groupLines = lines.filter((line) => group.element.contains(line));
      if (!groupLines.length) return;
      gsap.set(groupLines, { yPercent: 120 });
      timeline.to(
        groupLines,
        { yPercent: 0, duration: 0.7, ease: ENERGY, stagger: 0.05 },
        groupIndex * 0.06,
      );
    });

    if (dividers.length) {
      gsap.set(dividers, { scaleX: 0, transformOrigin: 'left center' });
      timeline.to(
        dividers,
        { scaleX: 1, duration: 0.7, ease: ENERGY, stagger: 0.035 },
        0.05,
      );
    }

    return timeline;
  }

  /** 换片：out → 等稳定 → 写数据 → in。 */
  function change(film, { immediate = false } = {}) {
    clearTimeout(settleTimer);

    if (immediate) {
      write(film);
      textTargets().forEach((element) => splitLines(element));
      gsap.set(root.querySelectorAll('.disc-line'), { yPercent: 0 });
      gsap.set(dividers, { scaleX: 1, transformOrigin: 'left center' });
      return;
    }

    const outDuration = animateOut();
    settleTimer = setTimeout(
      () => {
        write(film);
        animateIn();
      },
      Math.max(100, outDuration * 1000 * 0.75),
    );
  }

  // resize 后行断点会变，重拆一次
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      textTargets().forEach((element) => splitLines(element));
      gsap.set(root.querySelectorAll('.disc-line'), { yPercent: 0 });
    }, 150);
  };
  window.addEventListener('resize', onResize);

  /** 量出最宽的一条影评，锁住容器宽度，换片时不抖。 */
  function lockReviewWidth() {
    const wrap = root.querySelector('[data-testimonial-wrap]');
    if (!wrap) return;
    const probe = wrap.cloneNode(true);
    Object.assign(probe.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0',
      width: 'auto',
      maxWidth: 'none',
      visibility: 'hidden',
    });
    document.body.appendChild(probe);

    let widest = 0;
    films.forEach((film) => {
      film.reviews.forEach((review, index) => {
        const quote = probe.querySelectorAll('[data-review-testimonial]')[index];
        if (!quote) return;
        quote.innerHTML = splitTestimonial(review.testimonial).join('<br>');
      });
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    });

    probe.remove();
    if (widest > 0)
      root.style.setProperty('--testimonial-width', `${Math.ceil(widest)}px`);
  }

  return {
    change,
    write,
    lockReviewWidth,
    destroy() {
      clearTimeout(settleTimer);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    },
  };
}
