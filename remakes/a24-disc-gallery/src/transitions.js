// Barba 过渡：disc-detail-open / disc-detail-close / disc-flip。
//
// 三个过渡共享同一条物理前提：**画廊实例从不重建**。
// renderer、程序化贴图、环境贴图、光盘池都挂在 shell 上活过整个会话，
// 换页时只是把 canvas 节点搬进搬出 [data-disc-carry]。
// 这就是"光盘飞进详情页""两页共用一张光盘"这两个错觉的来源 ——
// 它们不是两张盘对齐，本来就是同一张。
import { gsap } from 'gsap';

const GLIDE = 'cubic-bezier(0.32, 0.72, 0, 1)';

// 原站产物里的过渡参数，逐项抄出
export const TRANSITION = {
  pressScale: 0.94,
  pressDuration: 0.12,
  springScale: 1.015,
  springDuration: 0.16,
  outDuration: 0.55,
  detailFade: 0.35,
  inDuration: 1.05,
  othersStagger: 0.28,
};

/** 把 canvas 摘进 fixed 载体。切换期间它脱离页面布局，不随容器一起被替换。 */
function lift(shell) {
  const { carry, canvasMount } = shell;
  if (canvasMount.parentElement !== carry) carry.appendChild(canvasMount);
  carry.classList.add('is-active');
  gsap.set(carry, { autoAlpha: 1 });
}

/**
 * 把 canvas 放回新页面的归位点。
 * 必须在传进来的新容器里找：sync 模式下新旧两个容器同时挂在文档上，
 * document.querySelector 会先命中旧页那个，canvas 就被放回了正在退场的页面。
 */
function drop(shell, container) {
  const { carry, canvasMount } = shell;
  const home = (container ?? document).querySelector('[data-canvas-home]');
  if (home) {
    home.appendChild(canvasMount);
    carry.classList.remove('is-active');
  }
  // 详情页没有归位点，canvas 就留在载体里继续盖着（它是 fixed 全屏的）
  shell.gallery.resize();
}

/**
 * 把画廊摆回"正常可见"的终态。
 * 过渡中途被打断时（切后台标签页 rAF 停摆、用户连点换页），
 * tween 可能永远跑不完，光盘就卡在缩小或侧立的半途上。
 * 所以每条过渡结束都显式归位一次，不依赖 tween 自己走到头。
 */
function settle(shell, container) {
  // canvas 必须回到页面里的归位点。过渡途中它待在 fixed 载体里，
  // 留在那儿虽然看着一样（载体也是全屏），但 z-index 关系和正常加载不同，
  // 手绘圈与文案的叠放次序会跟着变，所以收尾时一定要归位。
  drop(shell, container);
  shell.gallery.settlePose();
  gsap.set(shell.carry, { autoAlpha: 1 });
}

/**
 * 当前盘的"按压 → 回弹"：先缩到 0.94，再弹到 1.015。
 * 走 flight.active 而不是新开一个属性——布局里当前盘的缩放本来就是
 * baseScale * flight.active，借道现成的管线，layout 不用改。
 */
function pressSpring(shell) {
  const { flight } = shell.gallery;
  return gsap
    .timeline({ onUpdate: () => shell.gallery.requestFrames(1) })
    .to(flight, {
      active: TRANSITION.pressScale,
      duration: TRANSITION.pressDuration,
      ease: GLIDE,
    })
    .to(flight, {
      active: TRANSITION.springScale,
      duration: TRANSITION.springDuration,
      ease: GLIDE,
    });
}

/** 旋转缩小退场：spinY 转到 π/2 的同时整组缩掉。 */
function exitSpin(shell) {
  const disc = shell.gallery.activeDisc;
  const { flight } = shell.gallery;
  const tl = gsap.timeline({ onUpdate: () => shell.gallery.requestFrames(1) });
  if (disc)
    tl.to(
      disc,
      { spinY: Math.PI / 2, duration: TRANSITION.outDuration, ease: GLIDE },
      0,
    );
  tl.to(
    flight,
    { active: 0.2, others: 0, duration: TRANSITION.outDuration, ease: GLIDE },
    0,
  );
  return tl;
}

/** 详情页正文逐行揭示。 */
function revealDetail(container) {
  const rows = container.querySelectorAll('[data-detail-reveal]');
  if (!rows.length) return gsap.timeline();
  return gsap.fromTo(
    rows,
    { yPercent: 40, autoAlpha: 0 },
    {
      yPercent: 0,
      autoAlpha: 1,
      duration: 0.7,
      ease: GLIDE,
      stagger: 0.06,
      clearProps: 'transform',
    },
  );
}

/** 从下一页 HTML 里抓前几张封面预热，和原站 beforeEnter 的做法一样。 */
export function prefetchArtwork(html, limit = 4) {
  const matches = [
    ...String(html).matchAll(/data-film-field="disc-art-url">([^<]+)</g),
  ].slice(0, limit);
  for (const [, url] of matches) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url.trim();
  }
}

export function createTransitions(shell) {
  const skip = () => shell.reducedMotion;

  return [
    {
      // 画廊 → 详情：按压回弹 → 旋转退场 → canvas 进载体 → 详情淡入
      name: 'disc-detail-open',
      from: { namespace: ['films', 'television'] },
      to: { namespace: ['production'] },
      sync: true,

      beforeEnter({ next }) {
        prefetchArtwork(next.html);
      },

      leave({ current }) {
        if (skip()) {
          lift(shell);
          return;
        }
        shell.panel?.animateOut?.();
        // 载体整个 leave 期间都留着：它托着那张正在旋转退场的光盘，
        // 淡出要等新页真的挂上来（afterEnter），否则中间会空一帧。
        return gsap
          .timeline()
          .add(() => lift(shell), 0)
          .add(pressSpring(shell))
          .add(exitSpin(shell))
          .to(
            current.container,
            { autoAlpha: 0, duration: TRANSITION.detailFade, ease: GLIDE },
            TRANSITION.pressDuration + TRANSITION.springDuration,
          );
      },

      enter({ next }) {
        // 详情页没有 [data-canvas-home]，canvas 留在 fixed 载体里铺底
        shell.gallery.resize();
        if (skip()) {
          gsap.set(shell.carry, { autoAlpha: 0 });
          return;
        }
        return gsap
          .timeline()
          .fromTo(
            next.container,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: TRANSITION.detailFade, ease: GLIDE },
            0,
          )
          .add(revealDetail(next.container), 0.1)
          // 详情已经盖上来了，这时候才轮到光盘退场
          .to(
            shell.carry,
            { autoAlpha: 0, duration: TRANSITION.outDuration, ease: GLIDE },
            TRANSITION.detailFade * 0.6,
          );
      },
    },

    {
      // 详情 → 画廊：详情淡出，光盘从 -π/2 转正，其他盘错开飞入
      name: 'disc-detail-close',
      from: { namespace: ['production'] },
      to: { namespace: ['films', 'television'] },
      sync: true,

      beforeEnter({ next }) {
        prefetchArtwork(next.html);
      },

      leave({ current }) {
        if (skip()) return;
        return gsap.to(current.container, {
          autoAlpha: 0,
          duration: TRANSITION.detailFade,
          ease: GLIDE,
        });
      },

      enter({ next }) {
        shell.bindPage(next.container);
        drop(shell, next.container);
        if (skip()) {
          settle(shell, next.container);
          return;
        }

        const disc = shell.gallery.activeDisc;
        const { flight } = shell.gallery;
        if (disc) disc.spinY = -Math.PI / 2;
        flight.active = 0.2;
        flight.others = 0;

        const tl = gsap.timeline({
          onUpdate: () => shell.gallery.requestFrames(1),
        });
        tl.set(shell.carry, { autoAlpha: 1 }, 0);
        if (disc)
          tl.to(
            disc,
            { spinY: 0, duration: TRANSITION.inDuration, ease: GLIDE },
            0,
          );
        tl.to(
          flight,
          { active: 1, duration: TRANSITION.inDuration, ease: GLIDE },
          0,
        )
          // 其他盘晚 0.28 再飞入，队形才有先后
          .to(
            flight,
            { others: 1, duration: TRANSITION.inDuration, ease: GLIDE },
            TRANSITION.othersStagger,
          )
          .fromTo(
            next.container,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: TRANSITION.detailFade, ease: GLIDE },
            0,
          )
          .add(() => shell.panel?.change?.(shell.currentItem(), { immediate: true }), 0.1)
          .eventCallback('onComplete', () => settle(shell, next.container));
        return tl;
      },
    },

    {
      // films ↔ television：当前盘翻到侧面，新页的盘从另一侧翻回来。
      // 中途换目录，所以观众看到的是"同一张盘转了个身换了封面"。
      name: 'disc-flip',
      from: { namespace: ['films', 'television'] },
      to: { namespace: ['films', 'television'] },
      sync: true,

      beforeEnter({ next }) {
        prefetchArtwork(next.html);
      },

      leave({ current }) {
        if (skip()) {
          lift(shell);
          return;
        }
        shell.panel?.animateOut?.();
        const disc = shell.gallery.activeDisc;
        const tl = gsap.timeline({
          onUpdate: () => shell.gallery.requestFrames(1),
        });
        if (disc)
          tl.to(disc, { spinY: Math.PI / 2, duration: 0.5, ease: GLIDE }, 0);
        tl.to(
          shell.gallery.flight,
          { others: 0, duration: 0.5, ease: GLIDE },
          0,
        )
          .to(
            current.container,
            { autoAlpha: 0, duration: TRANSITION.detailFade, ease: GLIDE },
            0.15,
          )
          .add(() => lift(shell));
        return tl;
      },

      enter({ next }) {
        // 换的是另一套目录，上一套的位置不该带过来，从第一张开始
        shell.returnIndex = 0;
        // 翻到侧面的这一刻换目录：封面换了，盘没换
        shell.bindPage(next.container);
        drop(shell, next.container);
        if (skip()) {
          settle(shell, next.container);
          return;
        }

        const disc = shell.gallery.activeDisc;
        if (disc) disc.spinY = -Math.PI / 2;
        shell.gallery.flight.others = 0;

        const tl = gsap.timeline({
          onUpdate: () => shell.gallery.requestFrames(1),
        });
        tl.set(shell.carry, { autoAlpha: 1 }, 0);
        if (disc) tl.to(disc, { spinY: 0, duration: 0.7, ease: GLIDE }, 0);
        tl.to(
          shell.gallery.flight,
          { others: 1, duration: 0.9, ease: GLIDE },
          0.2,
        )
          .fromTo(
            next.container,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: TRANSITION.detailFade, ease: GLIDE },
            0.1,
          )
          .add(() => shell.panel?.change?.(shell.currentItem(), { immediate: true }), 0.1)
          .eventCallback('onComplete', () => settle(shell, next.container));
        return tl;
      },
    },
  ];
}
