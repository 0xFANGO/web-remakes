// 加载计数器：一个字母格 + 三个数字滚筒，沿弧线前进，与光盘的升起/转正联动。
import { gsap } from 'gsap';
import { clamp } from './config.js';

const PRELOAD = {
  sceneShare: 0.18, // 场景初始化占的进度份额
  minDuration: 2.85, // 最短展示时长
  chase: 8, // 进度指数追赶系数
  setOff: 0.45, // 收尾延迟
  pushStagger: 0.14, // 数字格推出的错开
  navAfter: 0.15,
  copyAfter: 0.3,
  turnBy: 0.8, // 进度到 80% 时光盘已转正
};

// 节拍：到达某个进度 + 某个时刻，就把计数器推到下一格
const BEATS = [
  { progress: 0.05, time: 0.8, value: () => 'A24' },
  { progress: 0.5, time: 1.9, value: () => String(40 + Math.floor(Math.random() * 13)) },
  { progress: 0.75, time: 2.35, value: () => String(68 + Math.floor(Math.random() * 13)) },
  { progress: 1, time: 2.8, value: () => '100' },
];

/** 一个数字滚筒：竖排 "0…9 0…9"，靠 yPercent 滚到目标数字。 */
function createRoller() {
  const cell = document.createElement('span');
  cell.className = 'preloader__cell';
  const strip = document.createElement('span');
  strip.className = 'preloader__strip';
  // 两轮 0-9 共 20 行，每行占 5%
  strip.textContent = Array.from({ length: 20 }, (_, i) => i % 10).join('\n');
  cell.appendChild(strip);
  return { cell, strip };
}

export function createPreloader({ gallery, onNav, onCopy }) {
  const root = document.createElement('div');
  root.className = 'preloader';
  root.setAttribute('aria-hidden', 'true');

  const count = document.createElement('div');
  count.className = 'preloader__count heading-l';
  root.appendChild(count);

  // 字母格放 "A24"，宽度从 0 展开
  const letterCell = document.createElement('span');
  letterCell.className = 'preloader__cell preloader__cell--letters';
  const letterInner = document.createElement('span');
  letterInner.className = 'preloader__letters';
  letterInner.textContent = 'A24';
  letterCell.appendChild(letterInner);
  count.appendChild(letterCell);

  const rollers = [createRoller(), createRoller(), createRoller()];
  rollers.forEach(({ cell }) => count.appendChild(cell));

  // 左右两侧的说明文字
  const sideLeft = document.createElement('span');
  sideLeft.className = 'preloader__side preloader__side--left';
  sideLeft.textContent = 'A24 Films';
  const sideRight = document.createElement('span');
  sideRight.className = 'preloader__side preloader__side--right';
  sideRight.textContent = `2012 — ${new Date().getFullYear()}`;
  root.append(sideLeft, sideRight);

  document.body.appendChild(root);

  gsap.set(letterCell, { width: 0 });
  gsap.set(rollers.map((r) => r.cell), { width: 0 });

  let theta = 0;
  let beatIndex = 0;
  let smoothed = 0;
  let sceneReady = 0;
  let startTime = performance.now();
  let finished = false;
  let rafId = 0;

  /** 计数器沿弧线移动：theta 每拍走到 π·(i+1)/4。 */
  function moveAlongArc(step) {
    const target = (Math.PI * step) / 4;
    gsap.to(
      { value: theta },
      {
        value: target,
        duration: 0.6,
        ease: 'power2.inOut',
        onUpdate() {
          theta = this.targets()[0].value;
          applyArc();
        },
      },
    );
  }

  function applyArc() {
    const radius = Math.min(window.innerWidth, window.innerHeight) * 0.16;
    const x = Math.sin(theta) * radius;
    const y = -Math.cos(theta) * radius * 0.35 + radius * 0.35;
    gsap.set(count, { x, y });
  }

  /** 显示一个值：字母走字母格，数字走滚筒。 */
  function showValue(value) {
    if (/^\d+$/.test(value)) {
      gsap.to(letterCell, { width: 0, duration: 0.3, ease: 'power2.inOut' });
      const digits = value.padStart(3, ' ').split('');
      digits.forEach((digit, index) => {
        const roller = rollers[index];
        if (digit === ' ') {
          gsap.to(roller.cell, { width: 0, duration: 0.3, ease: 'power2.inOut' });
          return;
        }
        gsap.to(roller.cell, {
          width: '0.62em',
          duration: 0.35,
          ease: 'power2.inOut',
        });
        gsap.to(roller.strip, {
          yPercent: -Number(digit) * 5,
          duration: 0.5,
          ease: 'power2.inOut',
        });
      });
    } else {
      rollers.forEach((roller) =>
        gsap.to(roller.cell, { width: 0, duration: 0.3, ease: 'power2.inOut' }),
      );
      gsap.to(letterCell, {
        width: 'auto',
        duration: 0.4,
        ease: 'power2.inOut',
      });
    }
  }

  function loop(now) {
    if (finished) return;
    const elapsed = (now - startTime) / 1000;

    // 进度 = 场景初始化份额 + 封面加载份额，再与最短时长取 min
    const artProgress = gallery.artProgress;
    const raw = sceneReady * PRELOAD.sceneShare + artProgress * (1 - PRELOAD.sceneShare);
    const timeProgress = elapsed / PRELOAD.minDuration;
    const ceiling = Math.min(raw, timeProgress);

    // 指数追赶，避免数字跳变。
    // 指数逼近永远到不了 1，差距足够小时直接吸附，否则最后一拍不会触发。
    smoothed += (ceiling - smoothed) * Math.min(1, (1 / 60) * PRELOAD.chase);
    if (ceiling - smoothed < 0.002) smoothed = ceiling;
    const progress = clamp(smoothed, 0, 1);

    // 光盘联动：rise 用三次缓出，turn 用 2.4 次幂并在 80% 处完成
    const rise = 1 - Math.pow(1 - progress, 3);
    const turn = clamp(
      1 - Math.pow(1 - Math.min(1, progress / PRELOAD.turnBy), 2.4),
      0,
      1,
    );
    gallery.setPreloadPose({ rise, turn });

    // 兜底：贴图加载卡住也不能把页面锁死，超时后按节拍强行推进
    const overdue = elapsed > PRELOAD.minDuration * 2.5;

    const beat = BEATS[beatIndex];
    if (beat && ((progress >= beat.progress && elapsed >= beat.time) || overdue)) {
      showValue(beat.value());
      moveAlongArc(beatIndex + 1);
      beatIndex += 1;
    }

    if (beatIndex >= BEATS.length) {
      finish();
      return;
    }

    rafId = requestAnimationFrame(loop);
  }

  /** 收尾：数字格上推出场，揭示导航与文案，光盘扇形飞入。 */
  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    // CSS 靠这个属性藏着导航与文案，必须在揭示前摘掉
    document.documentElement.removeAttribute('data-preload');

    const timeline = gsap.timeline({
      delay: PRELOAD.setOff,
      onComplete: () => root.remove(),
    });

    const cells = [letterCell, ...rollers.map((r) => r.cell)];
    timeline.to(
      cells,
      {
        yPercent: -110,
        duration: 0.7,
        ease: 'power3.in',
        stagger: PRELOAD.pushStagger,
      },
      0,
    );
    timeline.to(
      [sideLeft, sideRight],
      { yPercent: -120, duration: 0.6, ease: 'power3.in', stagger: 0.08 },
      0,
    );
    timeline.call(() => onNav?.(), null, PRELOAD.navAfter);
    timeline.call(() => onCopy?.(), null, PRELOAD.copyAfter);
    timeline.call(() => gallery.fanIn(), null, PRELOAD.navAfter);
    timeline.to(root, { autoAlpha: 0, duration: 0.5, ease: 'power2.inOut' }, 0.5);
  }

  return {
    /** 场景初始化完成时调一次，让进度条先爬 18%。 */
    markSceneReady() {
      gsap.to(
        { value: 0 },
        {
          value: 1,
          duration: 0.6,
          ease: 'none',
          onUpdate() {
            sceneReady = this.targets()[0].value;
          },
        },
      );
    },
    start() {
      startTime = performance.now();
      applyArc();
      rafId = requestAnimationFrame(loop);
      // 硬兜底：无论贴图、着色器编译还是 rAF 出什么岔子，
      // 页面都必须在这个时间点之后交互可用。
      setTimeout(() => finish(), PRELOAD.minDuration * 1000 * 3);
    },
    /** reduced-motion 或出错时直接跳过。 */
    skip() {
      finished = true;
      cancelAnimationFrame(rafId);
      root.remove();
      onNav?.();
      onCopy?.();
      gallery.emitChange(gallery.index);
    },
  };
}
