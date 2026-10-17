// 光盘轮播的核心：布局公式、输入手势、手绘圈、按需渲染。
import * as THREE from 'three';
import { gsap } from 'gsap';
import { CONFIG, clamp } from './config.js';
import {
  createDiscAssets,
  createDisc,
  createLights,
  applyEnvironment,
} from './disc.js';
import { composeArtwork } from './textures.js';

// 全站统一的运动曲线，等价 cubic-bezier(0.32, 0.72, 0, 1)
const DISC_GLIDE = 'cubic-bezier(0.32, 0.72, 0, 1)';

export function createGallery({ container, canvasMount, films, settings = CONFIG }) {
  const S = settings;
  const filmCount = films.length;

  // ---- 渲染器 ----
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  const isNarrow = () => window.innerWidth <= 767;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isNarrow() ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = S.exposure;
  renderer.setClearColor(0x000000, 0);
  // 透射 pass 按半分辨率渲染，压掉 hub/frost 的 transmission 开销。
  // 这个属性在 three 不同版本上名字不一样，拿不准就不设，
  // 设成零尺寸的 render target 会让每帧刷 GL_INVALID_FRAMEBUFFER_OPERATION。
  const transmissionScale = 0.5;
  if (typeof renderer.transmissionResolutionScale === 'number')
    renderer.transmissionResolutionScale = transmissionScale;
  else if (typeof renderer._transmissionResolutionScale === 'number')
    renderer._transmissionResolutionScale = transmissionScale;

  Object.assign(renderer.domElement.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    background: 'transparent',
    pointerEvents: 'none',
  });
  canvasMount.replaceChildren(renderer.domElement);

  // ---- 场景 ----
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(S.fogColor, 7, 14);

  const camera = new THREE.PerspectiveCamera(S.cameraFOV, 1, 0.1, 100);
  camera.position.set(0, 0, S.cameraDistance);
  camera.lookAt(0, 0, 0);

  // 整组斜着排，这是光盘"侧着叠过去"的来源
  const galleryGroup = new THREE.Group();
  galleryGroup.rotation.x = THREE.MathUtils.degToRad(S.galleryRotX);
  galleryGroup.rotation.y = THREE.MathUtils.degToRad(S.galleryRotY);
  galleryGroup.scale.setScalar(S.galleryScale);
  scene.add(galleryGroup);

  createLights(scene, S);

  const assets = createDiscAssets(renderer, S);
  applyEnvironment(scene, renderer, S);

  // ---- 光盘池 ----
  // 只实例化视野内的盘，池化复用，避免 12 张全建
  const poolSize = Math.min(filmCount, S.renderRadius * 2 + 3);
  const pool = [];
  const free = [];
  const active = new Map(); // filmIndex -> disc
  const pickTargets = [];

  for (let i = 0; i < poolSize; i += 1) {
    const disc = createDisc(assets, galleryGroup, S);
    pool.push(disc);
    free.push(disc);
  }

  // ---- 手绘圈 ----
  const scribbleSegments = S.scribblePoints * 3;
  const scribbleGroup = new THREE.Group();
  const scribbleGeometries = [];
  const scribbleMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(S.scribbleColor),
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });

  function buildScribbleGeometry() {
    const geometry = new THREE.BufferGeometry();
    const vertexCount = (scribbleSegments + 1) * 2;
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3),
    );
    const indices = [];
    for (let i = 0; i < scribbleSegments; i += 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    geometry.setIndex(indices);
    return geometry;
  }

  for (let i = 0; i < S.scribbleLoops; i += 1) {
    const geometry = buildScribbleGeometry();
    const mesh = new THREE.Mesh(geometry, scribbleMaterial);
    mesh.renderOrder = 900;
    scribbleGeometries.push(geometry);
    scribbleGroup.add(mesh);
  }
  scribbleGroup.visible = false;
  galleryGroup.add(scribbleGroup);

  /**
   * 重新随机一圈手绘线。
   * 用三角带模拟线宽，半径带平滑插值的抖动，只画 sweep 比例的弧长（故意不闭合），
   * 两端收细。每秒重随机 scribbleFps 次，产生手抖感。
   */
  function updateScribbleLoop(loopIndex, progress) {
    const geometry = scribbleGeometries[loopIndex];
    const position = geometry.getAttribute('position');
    const radius = 1 + S.scribblePadding + loopIndex * S.scribbleLoopGap;
    const halfWidth = S.scribbleWidth * 0.5;
    const sweep =
      clamp(
        S.scribbleSweep * (1 + (Math.random() - 0.5) * S.scribbleSweepJitter),
        0.12,
        1,
      ) * progress;
    const sweepAngle = Math.PI * 2 * sweep;
    const startAngle = Math.random() * Math.PI * 2;

    const jitters = [];
    for (let i = 0; i <= S.scribblePoints; i += 1)
      jitters.push(1 + (Math.random() - 0.5) * 2 * S.scribbleJitter);

    for (let i = 0; i <= scribbleSegments; i += 1) {
      const t = i / scribbleSegments;
      const angle = startAngle + t * sweepAngle;

      // 在控制点之间做 smoothstep 插值，抖动才不会是锯齿
      const controlPos = t * S.scribblePoints * sweep;
      const lower = Math.floor(controlPos);
      const upper = Math.min(S.scribblePoints, lower + 1);
      const frac = controlPos - lower;
      const smooth = frac * frac * (3 - 2 * frac);
      const jitter = jitters[lower] * (1 - smooth) + jitters[upper] * smooth;

      // 两端收细
      const taper = Math.min(1, Math.min(t, 1 - t) * 14 + 0.15);
      const inner = radius * jitter - halfWidth * taper;
      const outer = radius * jitter + halfWidth * taper;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      position.setXYZ(i * 2, cos * inner, sin * inner, 0);
      position.setXYZ(i * 2 + 1, cos * outer, sin * outer, 0);
    }

    position.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  let scribbleProgress = 0;
  let scribbleTarget = 0;
  let scribbleClock = 0;
  const scribblePos = new THREE.Vector3();

  // ---- 状态 ----
  let galleryScale = S.galleryScale; // 窄屏时会按视口重算
  let position = 0; // 连续位置，整数即居中
  let velocity = 0; // snap 弹簧速度，驱动 lean/dip
  let destroyed = false;
  let dragging = false;
  let spinningDisc = -1; // 正在被转的盘（拖当前盘时）
  let hoverIndex = -1;
  let pointerU = 0;
  let pointerV = 0;
  let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flight = { active: 1, others: 1, inbound: false };

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  // ---- 按需渲染 ----
  // 没有常驻 rAF。输入/动画调用 requestFrames(n)，布局返回剩余运动量，
  // 小于阈值就停。这是这个页面空闲时 0% CPU 的原因。
  let framesRequested = 0;
  let rafId = 0;
  let lastTime = 0;
  let qualityTier = 0;
  const QUALITY_TIERS = [1, 0.85, 0.7, 0.55];
  let frameTimes = [];

  function requestFrames(count = 1) {
    framesRequested = Math.max(framesRequested, count);
    if (!rafId) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    rafId = 0;
    if (destroyed) return;

    const dt = Math.min(0.05, (now - lastTime) / 1000) || 0.016;
    lastTime = now;

    const motion = layout(dt);
    updateHover(dt);
    renderer.render(scene, camera);

    // 自适应降档：连续 30 帧统计，帧时长超阈值就降像素比
    frameTimes.push(performance.now() - now);
    if (frameTimes.length >= 30) {
      const average = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      frameTimes = [];
      let nextTier = qualityTier;
      if (average > 45) nextTier = Math.min(QUALITY_TIERS.length - 1, qualityTier + 2);
      else if (average > 26.5) nextTier = Math.min(QUALITY_TIERS.length - 1, qualityTier + 1);
      if (nextTier !== qualityTier) {
        qualityTier = nextTier;
        resize();
      }
    }

    framesRequested -= 1;
    if (framesRequested > 0 || motion > 0.0008) requestFrames(1);
  }

  // ---- 布局 ----
  const nearestIndex = () => Math.round(clamp(position, 0, filmCount - 1));

  /**
   * 每帧重算每张盘的目标位姿，并按跟随系数插值逼近。
   * 返回"剩余运动量"给按需渲染判断是否该停。
   */
  function layout(dt, snapToTarget = false) {
    const centerIndex = nearestIndex();
    assignDiscs(centerIndex);
    galleryGroup.scale.setScalar(galleryScale);

    // lean / dip 来自 snap 弹簧速度：滚动时整组倾斜并下沉
    const flowing = !dragging && !reducedMotion;
    const lean = flowing
      ? clamp(
          Math.sign(velocity) * Math.sqrt(Math.abs(velocity)) * S.flowLean,
          -S.flowLeanMax,
          S.flowLeanMax,
        )
      : 0;
    const dip = flowing ? Math.min(S.flowDipMax, Math.abs(velocity) * S.flowDip) : 0;

    const followSpeed = dragging ? S.followTight : S.followBase;
    const touch = isTouchLayout();
    const activeScale = touch ? Math.max(0.5, S.touchActiveScale) : 1;
    const inactiveScale = touch
      ? clamp(S.touchInactiveScale, 0.2, 1)
      : S.inactiveScale;

    let motion = 0;

    active.forEach((disc, index) => {
      const offset = index - position;
      const distance = Math.abs(offset);
      const isActive = index === centerIndex;
      const theta = offset * 0.35;
      const depth = Math.max(S.discThickness * 3, 0.12, S.depthGap);

      // 弧线排布：x 走 sin，z 走 1-cos，于是远处的盘自然后退
      let targetX = Math.sin(theta) * S.hGap * 2.4;
      let targetY = (isActive ? S.activeDiscY : 0) - dip * (isActive ? 0.7 : 1);
      let targetZ = -Math.cos(theta) * depth * 2.4 + depth * 2.4;

      if (touch) {
        const fit = touchLayout(offset);
        targetX = fit.x;
        targetY = (isActive ? S.activeDiscY : 0) - dip * (isActive ? 0.7 : 1) + fit.y;
        targetZ = fit.z;
      }

      let targetRotX = 0;
      let targetRotY = -theta + lean * (isActive ? 1 : 1.12);
      if (touch)
        targetRotY =
          clamp(-offset, 0, 1) * -2 * THREE.MathUtils.degToRad(S.galleryRotY) +
          lean * (isActive ? 1 : 1.12);
      const targetRotZ = -lean * S.flowBank * (isActive ? 0.7 : 1);

      const baseScale = isActive
        ? activeScale
        : Math.max(
            inactiveScale,
            1 - distance * (1 - inactiveScale) * (touch ? 1 : 0.6),
          );

      let targetScale;
      let visible = true;

      if (isActive) {
        targetScale = baseScale * flight.active;
      } else {
        // 非当前盘按距离错开入场/退场，形成扇形飞入
        const progress = clamp(flight.others, 0, 2);
        const stagger = clamp(
          flight.inbound ? S.flightStaggerIn : S.flightStagger,
          0,
          0.9,
        );
        const maxStagger = Math.max(1, Math.round(S.flightStaggerMax));
        const delay = (Math.min(distance, maxStagger) / maxStagger) * stagger;
        const span = Math.max(0.1, 1 - stagger);
        const local = clamp((Math.min(1, progress) - delay) / span, 0, 1);
        const eased =
          (flight.inbound ? easeOutCubic(local) : local * (2 - local)) +
          Math.max(0, progress - 1);

        visible =
          eased > clamp(flight.inbound ? S.flightPopScaleIn : S.flightPopScale, 0, 0.9);
        targetScale = baseScale * eased;

        const recede = 1 - Math.min(1, eased);
        if (recede > 0.0001) targetZ -= recede * S.flightRecede;
      }

      disc.group.visible = visible;

      // hover 倾斜：跟随鼠标在盘面上的位置
      const hoverTarget = hoverIndex === index && spinningDisc < 0 ? 1 : 0;
      disc.hover += (hoverTarget - disc.hover) * Math.min(1, dt * 10);
      if (disc.hover > 0.001) {
        targetRotX += disc.hover * S.hoverTiltStrength * pointerV;
        targetRotY += disc.hover * S.hoverTiltStrength * pointerU;
      }

      // 离中心越远跟随越慢，形成拖尾
      const follow = clamp(
        followSpeed - distance * S.followFalloff,
        S.followMin,
        S.followTight,
      );
      const alpha =
        snapToTarget || dragging || reducedMotion ? 1 : Math.min(1, dt * follow);

      // 点击推挤的弹簧回弹
      const pushEnergy =
        Math.abs(disc.pushX) +
        Math.abs(disc.pushY) +
        Math.abs(disc.pushZ) +
        Math.abs(disc.pushVX) +
        Math.abs(disc.pushVY) +
        Math.abs(disc.pushVZ) +
        Math.abs(disc.pushRotX) +
        Math.abs(disc.pushRotY) +
        Math.abs(disc.pushRotVX) +
        Math.abs(disc.pushRotVY);

      if (reducedMotion) {
        resetPush(disc);
      } else if (pushEnergy > 0.0008) {
        const damping = Math.exp(-S.pushDamping * dt);
        const returning = Math.min(1, dt * S.pushReturn);
        disc.pushX += disc.pushVX * dt;
        disc.pushVX *= damping;
        disc.pushY += disc.pushVY * dt;
        disc.pushVY *= damping;
        disc.pushZ += disc.pushVZ * dt;
        disc.pushVZ *= damping;
        disc.pushRotX += disc.pushRotVX * dt;
        disc.pushRotVX *= damping;
        disc.pushRotY += disc.pushRotVY * dt;
        disc.pushRotVY *= damping;
        disc.pushX -= disc.pushX * returning;
        disc.pushY -= disc.pushY * returning;
        disc.pushZ -= disc.pushZ * returning;
        disc.pushRotX -= disc.pushRotX * returning;
        disc.pushRotY -= disc.pushRotY * returning;
        targetX += disc.pushX;
        targetY += disc.pushY;
        targetZ += disc.pushZ;
        motion += pushEnergy;
      } else if (pushEnergy > 0) {
        resetPush(disc);
      }

      // preloader 期间当前盘从下方升起
      if (preloadPose.active && isActive) {
        const rise = preloadOffset(preloadPose.rise);
        targetX += rise.x;
        targetY += rise.y;
        targetZ += rise.z;
      }

      if (disc.justAssigned) {
        // 新进入视野的盘：直接落到目标，但带一点入场偏移
        disc.group.position.set(targetX, targetY, targetZ);
        disc.group.rotation.set(targetRotX, targetRotY, targetRotZ);
        disc.group.scale.setScalar(targetScale);
        if (disc.spawnFrom && !snapToTarget && !reducedMotion) {
          disc.group.position.x += disc.spawnFrom * S.spawnSlide;
          disc.group.position.z -= 0.45;
          disc.group.rotation.y -= disc.spawnFrom * 0.3;
          disc.group.scale.multiplyScalar(S.spawnShrink);
        }
        disc.spawnFrom = 0;
        disc.justAssigned = false;
      } else {
        disc.group.position.x += (targetX - disc.group.position.x) * alpha;
        disc.group.position.y += (targetY - disc.group.position.y) * alpha;
        disc.group.position.z += (targetZ - disc.group.position.z) * alpha;
        const scale = disc.group.scale.x + (targetScale - disc.group.scale.x) * alpha;
        disc.group.scale.setScalar(scale);
        disc.group.rotation.x += (targetRotX - disc.group.rotation.x) * alpha;
        disc.group.rotation.y += (targetRotY - disc.group.rotation.y) * alpha;
        disc.group.rotation.z += (targetRotZ - disc.group.rotation.z) * alpha;
      }

      // 非手动旋转的盘，X 轴自转慢慢回零
      if (spinningDisc !== index && !disc.resetTween)
        disc.spinX += (0 - disc.spinX) * Math.min(1, dt * 2.5);
      disc.spin.rotation.x = disc.spinX + disc.pushRotX;
      disc.spin.rotation.y = disc.spinY + disc.pushRotY;

      // 近处的盘先画，避免透明材质穿插
      disc.group.renderOrder = Math.round(
        500 + disc.group.position.z * 10 - index * 0.01,
      );

      motion +=
        Math.abs(targetX - disc.group.position.x) +
        Math.abs(targetY - disc.group.position.y) +
        Math.abs(targetZ - disc.group.position.z) +
        Math.abs(targetScale - disc.group.scale.x) +
        Math.abs(targetRotX - disc.group.rotation.x) +
        Math.abs(targetRotY - disc.group.rotation.y) +
        Math.abs(targetRotZ - disc.group.rotation.z) +
        Math.abs(hoverTarget - disc.hover);

      if (spinningDisc !== index)
        motion += Math.abs(disc.spinX) + Math.abs(disc.spinY);
      if (disc.resetTween) motion += 1;
    });

    motion += updateScribble(dt, centerIndex);
    return motion;
  }

  function resetPush(disc) {
    disc.pushX = 0;
    disc.pushY = 0;
    disc.pushZ = 0;
    disc.pushVX = 0;
    disc.pushVY = 0;
    disc.pushVZ = 0;
    disc.pushRotX = 0;
    disc.pushRotY = 0;
    disc.pushRotVX = 0;
    disc.pushRotVY = 0;
  }

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  /** 手绘圈的出现/消失与跟随延迟。 */
  function updateScribble(dt, centerIndex) {
    if (!S.scribbleEnabled) return 0;

    const disc = active.get(centerIndex);
    const wants =
      !!disc && hoverIndex === centerIndex && spinningDisc < 0 && !dragging;
    scribbleTarget = wants ? 1 : 0;

    const [inA] = S.scribbleIn;
    const speed = scribbleTarget > scribbleProgress ? inA + 2.2 : 3.4;
    scribbleProgress += (scribbleTarget - scribbleProgress) * Math.min(1, dt * speed);

    if (scribbleProgress < 0.002) {
      scribbleGroup.visible = false;
      return Math.abs(scribbleTarget - scribbleProgress);
    }

    scribbleGroup.visible = true;

    if (disc) {
      // 位置带延迟，圈跟着盘"慢半拍"
      scribblePos.lerp(disc.group.position, Math.min(1, dt * S.scribbleLag));
      scribbleGroup.position.copy(scribblePos);
      scribbleGroup.scale.setScalar(disc.group.scale.x);
      scribbleGroup.rotation.copy(disc.group.rotation);
    }

    scribbleClock += dt;
    if (scribbleClock >= 1 / S.scribbleFps) {
      scribbleClock = 0;
      for (let i = 0; i < scribbleGeometries.length; i += 1)
        updateScribbleLoop(i, scribbleProgress);
    }

    return Math.abs(scribbleTarget - scribbleProgress) + 0.002;
  }

  // ---- 光盘分配 ----
  /** 把 renderRadius 内的 film 分配给池中的盘，超出的回收。 */
  function assignDiscs(centerIndex) {
    const from = Math.max(0, centerIndex - S.renderRadius);
    const to = Math.min(filmCount - 1, centerIndex + S.renderRadius);

    active.forEach((disc, index) => {
      if (index < from || index > to) {
        disc.group.visible = false;
        disc.index = -1;
        disc.frontMaterial.map = assets.placeholderTexture;
        active.delete(index);
        free.push(disc);
      }
    });

    for (let index = from; index <= to; index += 1) {
      if (active.has(index)) continue;
      const disc = free.pop();
      if (!disc) break;
      disc.index = index;
      disc.justAssigned = true;
      disc.spawnFrom = Math.sign(index - position) || 1;
      disc.spinX = 0;
      disc.spinY = 0;
      disc.hover = 0;
      resetPush(disc);
      disc.pick.userData.index = index;
      active.set(index, disc);
      loadArtwork(index);
    }

    pickTargets.length = 0;
    active.forEach((disc) => {
      if (disc.group.visible) pickTargets.push(disc.pick);
    });
  }

  // ---- 封面贴图 ----
  const artCache = new Map(); // url -> {status, texture}

  function loadArtwork(index) {
    const film = films[index];
    if (!film?.artwork) return;

    const cached = artCache.get(film.artwork);
    if (cached?.status === 'loaded') {
      applyArtwork(index);
      return;
    }
    if (cached?.promise) {
      cached.promise.then(() => !destroyed && applyArtwork(index));
      return;
    }

    const entry = { status: 'loading', texture: null, promise: null };
    entry.promise = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => {
        const canvas = composeArtwork(image, S, THREE.MathUtils.degToRad);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        entry.status = 'loaded';
        entry.texture = texture;
        resolve();
      };
      image.onerror = () => {
        entry.status = 'error';
        resolve();
      };
      image.src = film.artwork;
    });
    artCache.set(film.artwork, entry);
    entry.promise.then(() => !destroyed && applyArtwork(index));
  }

  function applyArtwork(index) {
    const disc = active.get(index);
    if (!disc) return;
    const entry = artCache.get(films[index]?.artwork);
    const texture =
      entry?.status === 'loaded' && entry.texture
        ? entry.texture
        : assets.placeholderTexture;
    if (disc.frontMaterial.map !== texture) {
      disc.frontMaterial.map = texture;
      disc.frontMaterial.needsUpdate = true;
      requestFrames(2);
    }
  }

  /** 预取相邻封面，snap 过去时贴图已经就位。 */
  function prefetch(index) {
    [index - 1, index + 1, index - 2, index + 2].forEach((i) => {
      if (i >= 0 && i < filmCount) loadArtwork(i);
    });
  }

  // ---- 触屏布局 ----
  const isTouchLayout = () => !!S.touchFit && window.innerWidth <= 991;

  function touchLayout(offset) {
    const gap = S.touchGap;
    return {
      x: offset * gap,
      y: -Math.abs(offset) * S.touchDropY * 0.12,
      z: -Math.abs(offset) * S.touchDepth,
    };
  }

  /**
   * 窄屏时整组缩放：用二分法求一个 galleryScale，
   * 让当前盘加上两侧露出的 touchPeek 恰好铺满视口宽度。
   * 不做这一步，竖屏上一张盘会撑满整个屏幕。
   */
  function fitTouchScale(width, height) {
    if (!isTouchLayout()) return S.galleryScale;

    // 当前盘半径 1，乘 touchActiveScale；两侧各留 touchPeek 的一点边
    const halfSpan = S.touchActiveScale * (1 + S.touchPeek * 0.5);
    const vFov = THREE.MathUtils.degToRad(S.cameraFOV);
    const visibleHeight = 2 * Math.tan(vFov / 2) * S.cameraDistance;
    const visibleWidth = visibleHeight * (width / height);

    // 盘整体还带 -30° 的 Y 轴旋转，横向投影会收窄，留一点余量
    const target = Math.min(visibleWidth, visibleHeight) * 0.62;
    return clamp(target / halfSpan, S.touchMinScale, S.touchMaxScale);
  }

  // ---- snap ----
  let snapTween = null;
  const snapProxy = { value: 0 };

  /**
   * 把连续位置 tween 到目标整数，并给速度一个 kick 产生甩动。
   * 时长按来源区分：滚轮最短，点击跨多格最长。
   */
  function snapTo(targetIndex, { source = 'wheel', silent = false } = {}) {
    const next = clamp(Math.round(targetIndex), 0, filmCount - 1);
    const distance = Math.abs(next - position);
    if (snapTween) snapTween.kill();

    let duration;
    let kick;
    if (source === 'keyboard') {
      duration = Math.min(0.6, 0.42 + distance * 0.05);
      kick = 4;
    } else if (source === 'click') {
      duration = clamp(0.45 + distance * 0.11, 0.46, 1.05);
      kick = Math.min(5, 2 + distance);
    } else if (source === 'flick') {
      duration = 0.56;
      kick = 3.5;
    } else {
      duration = S.snapDuration + 0.05;
      kick = 2.5;
    }

    if (reducedMotion) {
      position = next;
      velocity = 0;
      layout(1, true);
      renderer.render(scene, camera);
      if (!silent) emitChange(next);
      return;
    }

    velocity += Math.sign(next - position || 1) * kick;
    snapProxy.value = position;
    snapTween = gsap.to(snapProxy, {
      value: next,
      duration,
      ease: DISC_GLIDE,
      onUpdate: () => {
        position = snapProxy.value;
        requestFrames(1);
      },
      onComplete: () => {
        snapTween = null;
        position = next;
        if (!silent) emitChange(next);
        prefetch(next);
      },
    });
    requestFrames(2);
  }

  /** 速度的弹簧衰减，驱动 lean/dip 的"甩一下再回正"。 */
  function decayVelocity(dt) {
    if (Math.abs(velocity) < 0.001) {
      velocity = 0;
      return;
    }
    const damping = Math.exp(-S.snapDamping * dt);
    velocity *= damping;
  }

  let currentIndex = 0;

  function emitChange(index) {
    currentIndex = index;
    container.dispatchEvent(
      new CustomEvent('discgallerychange', {
        detail: { index, film: films[index] },
      }),
    );
  }

  // ---- 滚轮手势状态机 ----
  // 目标：一次滚轮手势 = 一格，触控板和鼠标滚轮都成立。
  // 判定靠四条独立规则（停顿 / 离散 tick / 突然加速 / 持续滚动），任一成立即视为新手势。
  const wheelState = {
    lastTime: 0,
    lastStepTime: 0,
    envelope: 0,
    peak: 0,
    accumulated: 0,
    gestureStart: 0,
    inGesture: false,
  };

  function onWheel(event) {
    event.preventDefault();
    const delta = event.deltaY;
    const magnitude = Math.abs(delta);
    if (magnitude < S.wheelNoiseFloor) return;

    const now = performance.now();
    const gap = now - wheelState.lastTime;
    wheelState.lastTime = now;

    // 超过空闲阈值就整个重置
    if (gap > S.wheelIdleReset) {
      wheelState.envelope = 0;
      wheelState.peak = 0;
      wheelState.accumulated = 0;
      wheelState.inGesture = false;
    }

    // 指数衰减包络：代表"当前这股力度"
    const decay = Math.exp(-gap / S.wheelEnvelopeTau);
    wheelState.envelope = wheelState.envelope * decay + magnitude;
    wheelState.peak = Math.max(wheelState.peak * decay, magnitude);

    const sinceStep = now - wheelState.lastStepTime;
    const pausedLongEnough = gap >= S.wheelPauseGap;
    const discreteTick = gap >= S.wheelTickGap && sinceStep >= S.wheelMinStepTick;
    const suddenRise =
      magnitude > wheelState.envelope * S.wheelRiseFactor * 0.5 &&
      sinceStep >= S.wheelMinStepFlick;
    const sustained =
      wheelState.inGesture &&
      now - wheelState.gestureStart >= S.wheelSustainDelay &&
      magnitude >= wheelState.peak * S.wheelSustainRatio &&
      sinceStep >= S.wheelMinStepTick;

    if (!wheelState.inGesture || pausedLongEnough) {
      wheelState.inGesture = true;
      wheelState.gestureStart = now;
      wheelState.accumulated = 0;
    }

    wheelState.accumulated += Math.min(magnitude, S.wheelEventCap);

    const shouldStep =
      wheelState.accumulated >= S.wheelStepThreshold &&
      (pausedLongEnough || discreteTick || suddenRise || sustained);

    if (shouldStep) {
      wheelState.accumulated = 0;
      wheelState.lastStepTime = now;
      wheelState.gestureStart = now;
      const direction = delta > 0 ? 1 : -1;
      const next = clamp(nearestIndex() + direction, 0, filmCount - 1);
      if (next !== nearestIndex()) snapTo(next, { source: 'wheel' });
    }
  }

  // ---- 指针 ----
  let pointerDown = false;
  let pointerStart = { x: 0, y: 0 };
  let pointerLast = { x: 0, y: 0 };
  let dragVelocity = 0;
  let dragStartPosition = 0;
  let pointerDownIndex = -1;
  let inertiaId = 0;

  function toNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    pointerNdc.x = (x / rect.width) * 2 - 1;
    pointerNdc.y = -(y / rect.height) * 2 + 1;
    return { x, y, rect };
  }

  /** Raycaster 命中测试，同时记录命中点在盘面上的 UV（给 hover 倾斜用）。 */
  function hitTest() {
    if (!pickTargets.length) return -1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(pickTargets, false)[0];
    if (!hit) return -1;
    if (hit.uv) {
      pointerU = hit.uv.x * 2 - 1;
      pointerV = hit.uv.y * 2 - 1;
    } else {
      pointerU = 0;
      pointerV = 0;
    }
    return hit.object.userData.index ?? -1;
  }

  function updateHover() {
    if (pointerDown) return;
    const hit = hitTest();
    if (hit !== hoverIndex) {
      hoverIndex = hit;
      requestFrames(2);
    }
    container.style.cursor = hit >= 0 ? 'pointer' : 'grab';
  }

  function onPointerMove(event) {
    toNdc(event);

    if (!pointerDown) {
      const hit = hitTest();
      if (hit !== hoverIndex) {
        hoverIndex = hit;
        requestFrames(2);
      }
      container.style.cursor = hit >= 0 ? 'pointer' : 'grab';
      if (hoverIndex >= 0) requestFrames(1);
      return;
    }

    const dx = event.clientX - pointerLast.x;
    const dy = event.clientY - pointerLast.y;
    const totalDx = event.clientX - pointerStart.x;
    const totalDy = event.clientY - pointerStart.y;

    if (!dragging && spinningDisc < 0) {
      if (Math.hypot(totalDx, totalDy) < S.dragStartDistance) return;
      // 按在当前盘上 → 转这张盘；按在别处 → 拖整个轮播
      if (pointerDownIndex === nearestIndex()) {
        spinningDisc = pointerDownIndex;
        const disc = active.get(spinningDisc);
        if (disc?.resetTween) {
          disc.resetTween.kill();
          disc.resetTween = null;
        }
      } else {
        dragging = true;
        dragStartPosition = position;
        if (snapTween) snapTween.kill();
        snapTween = null;
      }
      container.style.cursor = 'grabbing';
    }

    if (spinningDisc >= 0) {
      const disc = active.get(spinningDisc);
      if (disc) {
        const limit = THREE.MathUtils.degToRad(S.maxSpinAngle);
        disc.spinY = clamp(
          disc.spinY + dx * 0.0045 * S.dragSensitivity,
          -limit,
          limit,
        );
        disc.spinX = clamp(
          disc.spinX + dy * 0.0045 * S.dragSensitivity,
          -limit,
          limit,
        );
        requestFrames(2);
      }
    } else if (dragging) {
      const rect = renderer.domElement.getBoundingClientRect();
      const step = -(totalDx / rect.width) * 6 * S.dragSensitivity;
      position = clamp(dragStartPosition + step, -0.4, filmCount - 0.6);
      const instant = -(dx / rect.width) * 6 * S.dragSensitivity;
      dragVelocity =
        dragVelocity * (1 - S.dragVelocitySmoothing) +
        instant * S.dragVelocitySmoothing;
      dragVelocity = clamp(dragVelocity, -S.dragMaxVelocity, S.dragMaxVelocity);
      requestFrames(2);
    }

    pointerLast = { x: event.clientX, y: event.clientY };
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    toNdc(event);
    pointerDown = true;
    pointerStart = { x: event.clientX, y: event.clientY };
    pointerLast = { ...pointerStart };
    dragVelocity = 0;
    pointerDownIndex = hitTest();
    container.setPointerCapture?.(event.pointerId);
    container.focus({ preventScroll: true });
  }

  function onPointerUp(event) {
    if (!pointerDown) return;
    pointerDown = false;
    container.releasePointerCapture?.(event.pointerId);

    const moved = Math.hypot(
      event.clientX - pointerStart.x,
      event.clientY - pointerStart.y,
    );

    if (spinningDisc >= 0) {
      // 松手后弹回正面
      const disc = active.get(spinningDisc);
      const index = spinningDisc;
      spinningDisc = -1;
      if (disc) {
        disc.resetTween = gsap.to(disc, {
          spinX: 0,
          spinY: 0,
          duration: S.resetDuration,
          ease: 'elastic.out(1, 0.45)',
          onUpdate: () => requestFrames(1),
          onComplete: () => {
            disc.resetTween = null;
          },
        });
      }
      container.style.cursor = 'pointer';
      requestFrames(2);
      if (moved < S.dragStartDistance) openDetail(index);
      return;
    }

    if (dragging) {
      dragging = false;
      container.style.cursor = 'grab';
      // 触屏甩动：速度够大就按方向进一格
      if (
        event.pointerType !== 'mouse' &&
        Math.abs(dragVelocity) >= S.touchFlickVelocity
      ) {
        const direction = dragVelocity > 0 ? 1 : -1;
        snapTo(nearestIndex() + direction, { source: 'flick' });
        return;
      }
      startInertia();
      return;
    }

    // 没拖动 → 当作点击
    if (moved < S.dragStartDistance) {
      const hit = pointerDownIndex;
      if (hit < 0) return;
      if (hit === nearestIndex()) openDetail(hit);
      else {
        pressDisc(hit);
        snapTo(hit, { source: 'click' });
      }
    }
  }

  /** 松手后的摩擦衰减，停下时 snap 到最近整数。 */
  function startInertia() {
    cancelAnimationFrame(inertiaId);
    let last = performance.now();

    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
      last = now;
      // friction 是按帧的，换算到实际 dt
      dragVelocity *= Math.pow(S.friction, dt * 60);
      position = clamp(position + dragVelocity, -0.4, filmCount - 0.6);
      requestFrames(1);

      if (Math.abs(dragVelocity) > 0.0015) {
        inertiaId = requestAnimationFrame(step);
      } else {
        dragVelocity = 0;
        snapTo(nearestIndex(), { source: 'wheel' });
      }
    };

    inertiaId = requestAnimationFrame(step);
  }

  /** 点击非当前盘时给它一个推挤反馈。 */
  function pressDisc(index) {
    const disc = active.get(index);
    if (!disc || reducedMotion) return;
    disc.pushVZ -= S.pressDepth * 0.6;
    disc.pushRotVX += pointerV * S.pressTilt * 0.4;
    disc.pushRotVY += pointerU * S.pressTilt * 0.4;
    requestFrames(2);
  }

  // ---- 键盘 ----
  function onKeyDown(event) {
    const index = nearestIndex();
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        snapTo(index - 1, { source: 'keyboard' });
        break;
      case 'ArrowRight':
        event.preventDefault();
        snapTo(index + 1, { source: 'keyboard' });
        break;
      case 'Home':
        event.preventDefault();
        snapTo(0, { source: 'keyboard' });
        break;
      case 'End':
        event.preventDefault();
        snapTo(filmCount - 1, { source: 'keyboard' });
        break;
      case 'Enter':
        event.preventDefault();
        openDetail(index);
        break;
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        flipDisc(index);
        break;
      default:
        break;
    }
  }

  /** 空格翻面：spinY tween 到 π，再按一次转回。 */
  function flipDisc(index) {
    const disc = active.get(index);
    if (!disc) return;
    if (disc.resetTween) {
      disc.resetTween.kill();
      disc.resetTween = null;
    }
    const flipped = Math.abs(disc.spinY) > Math.PI / 2;
    disc.resetTween = gsap.to(disc, {
      spinY: flipped ? 0 : Math.PI,
      spinX: 0,
      duration: 0.9,
      ease: DISC_GLIDE,
      onUpdate: () => requestFrames(1),
      onComplete: () => {
        disc.resetTween = null;
      },
    });
    requestFrames(2);
  }

  function openDetail(index) {
    container.dispatchEvent(
      new CustomEvent('discgalleryopen', {
        detail: { index, film: films[index] },
      }),
    );
  }

  // ---- preloader 联动 ----
  const preloadPose = { active: false, rise: 0, turn: 0 };

  /** preloader 每帧调这个：rise 控制从下方升起，turn 控制侧面转正。 */
  function setPreloadPose({ rise = 0, turn = 0 }) {
    preloadPose.active = true;
    preloadPose.rise = rise;
    preloadPose.turn = turn;

    const disc = active.get(nearestIndex());
    if (disc) {
      // 初始 spinY = -π/2（侧着），转正时带一点 Z 轴旋转
      disc.spinY = -Math.PI / 2 * (1 - turn);
      disc.spin.rotation.z = (1 - turn) * S.preloadSpin * 0.35;
    }
    // preload 期间只有这一张盘在场，略放大；fanIn 时收回 1。
    flight.active = 1 + S.preloadGrowBy * rise;
    flight.others = 0;
    requestFrames(1);
  }

  function preloadOffset(rise) {
    const t = 1 - rise;
    return {
      x: 0,
      y: -t * S.preloadRiseFrom,
      z: -t * S.preloadRiseFrom * S.preloadRiseDepth,
    };
  }

  /** preloader 结束：其他光盘扇形飞入。 */
  function fanIn() {
    preloadPose.active = false;
    const disc = active.get(nearestIndex());
    if (disc) {
      disc.spin.rotation.z = 0;
      gsap.to(disc, {
        spinY: 0,
        duration: 0.7,
        ease: DISC_GLIDE,
        onUpdate: () => requestFrames(1),
      });
    }
    flight.inbound = true;
    flight.others = 0;
    return gsap
      .timeline({ onUpdate: () => requestFrames(1) })
      .to(
        flight,
        { others: 1, duration: S.preloadFanDuration, ease: DISC_GLIDE },
        0,
      )
      .to(flight, { active: 1, duration: 0.8, ease: DISC_GLIDE }, 0)
      .eventCallback('onComplete', () => {
        flight.inbound = false;
        emitChange(nearestIndex());
      });
  }

  // ---- 尺寸 ----
  function resize() {
    const rect = container.getBoundingClientRect();
    // 首帧 section 可能还没布局完，退回视口尺寸；
    // 传 0 给 setSize 会让透射 render target 变成零尺寸，每帧刷 WebGL 错误。
    const width = Math.max(1, Math.round(rect.width) || window.innerWidth);
    const height = Math.max(1, Math.round(rect.height) || window.innerHeight);
    const tier = QUALITY_TIERS[qualityTier];
    const basePixelRatio = Math.min(window.devicePixelRatio, isNarrow() ? 1.5 : 2);

    // 像素上限 12M，超出按面积缩 dpr
    let pixelRatio = basePixelRatio * tier;
    const pixels = width * height * pixelRatio * pixelRatio;
    const maxPixels = 12e6;
    if (pixels > maxPixels) pixelRatio *= Math.sqrt(maxPixels / pixels);

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    galleryScale = fitTouchScale(width, height);
    requestFrames(2);
  }

  // ---- 事件绑定 ----
  const onVisibility = () => {
    if (!document.hidden) requestFrames(2);
  };
  const onResize = () => {
    qualityTier = 0;
    frameTimes = [];
    resize();
  };
  const onMotionChange = (event) => {
    reducedMotion = event.matches;
  };

  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', onMotionChange);

  // 速度衰减挂在 gsap ticker 上，跟着渲染节奏走
  const velocityTicker = (_, deltaTime) => {
    if (velocity !== 0) {
      decayVelocity(deltaTime / 1000);
      requestFrames(1);
    }
  };
  gsap.ticker.add(velocityTicker);

  resize();
  assignDiscs(0);
  prefetch(0);
  layout(1, true);
  requestFrames(3);

  return {
    get index() {
      return currentIndex;
    },
    get films() {
      return films;
    },
    snapTo,
    flipDisc,
    setPreloadPose,
    fanIn,
    requestFrames,
    emitChange,
    resize,
    /** 等几何、贴图与 shader 都就位，preloader 据此算进度。 */
    async warmUp() {
      await Promise.all(
        films
          .slice(0, Math.min(filmCount, S.renderRadius + 1))
          .map((film) => artCache.get(film.artwork)?.promise)
          .filter(Boolean),
      );
      if (renderer.compileAsync) {
        try {
          await renderer.compileAsync(scene, camera);
        } catch {
          /* compileAsync 不支持就跳过，不影响画面 */
        }
      }
    },
    get artProgress() {
      const window = films.slice(0, Math.min(filmCount, S.renderRadius + 1));
      if (!window.length) return 1;
      const done = window.filter(
        (film) => artCache.get(film.artwork)?.status === 'loaded',
      ).length;
      return done / window.length;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(inertiaId);
      gsap.ticker.remove(velocityTicker);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotionChange);
      renderer.dispose();
    },
  };
}
