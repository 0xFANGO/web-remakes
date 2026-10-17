// 一张光盘 = 6 个 Mesh（印刷面 / 数据面 / 外缘 / 透明环 / 镜面环 / 磨砂环）+ 1 个隐藏拾取圆。
// 几何与材质参数逐项取自线上产物。
import * as THREE from 'three';
import {
  buildTexture,
  buildMatrixCanvas,
  buildEnvironmentCanvas,
} from './textures.js';

/** canvas → CanvasTexture，统一设色彩空间与各向异性过滤。 */
function toTexture(canvas, renderer, colorSpace = THREE.NoColorSpace) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

/**
 * 外缘轮廓：六点 Lathe，两侧带倒角。
 * 倒角量随厚度走，保证薄盘也有可见的高光边。
 */
function buildEdgeGeometry(settings) {
  const half = settings.discThickness / 2;
  const bevel =
    0.0015 + settings.edgeBevel * Math.min(settings.discThickness * 0.55, 0.018);
  const inner = 1 - settings.edgeBleed;

  const points = [
    new THREE.Vector2(inner, half),
    new THREE.Vector2(1 - bevel, half),
    new THREE.Vector2(1, half - bevel),
    new THREE.Vector2(1, -half + bevel),
    new THREE.Vector2(1 - bevel, -half),
    new THREE.Vector2(inner, -half),
  ];

  const geometry = new THREE.LatheGeometry(points, 256);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 中心区的环形轮廓。厚度方向叠一层 cos(t·3π) 的波浪，
 * 形成真实 CD 中心那几道台阶；wave 控制起伏幅度。
 */
function buildRingGeometry(innerRadius, outerRadius, thickness, wave, segments = 160) {
  const half = thickness / 2;
  const start = Math.max(0.002, innerRadius);
  const span = Math.max(0.0001, outerRadius - start);
  const points = [
    new THREE.Vector2(start, -half),
    new THREE.Vector2(start, half),
  ];

  for (let i = 0; i <= 5; i += 1) {
    const t = i / 5;
    const radius = start + span * t;
    const y =
      half * (1 - wave) + half * wave * (0.6 + 0.4 * Math.cos(t * Math.PI * 3));
    points.push(new THREE.Vector2(radius, y));
  }

  points.push(new THREE.Vector2(outerRadius, half * 0.92));
  points.push(new THREE.Vector2(outerRadius, -half * 0.92));

  for (let i = 5; i >= 0; i -= 1) {
    const t = i / 5;
    const radius = start + span * t;
    const y = -(
      half * (1 - wave) +
      half * wave * (0.6 + 0.4 * Math.cos(t * Math.PI * 3))
    );
    points.push(new THREE.Vector2(radius, y));
  }

  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * RingGeometry 默认是极坐标 UV，封面会被绕着圈拉开。
 * 这里按顶点位置重映射成平面投影，封面才是正着贴的。
 */
function remapRingUV(geometry) {
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i += 1) {
    uv.setXY(i, position.getX(i) * 0.5 + 0.5, position.getY(i) * 0.5 + 0.5);
  }
  uv.needsUpdate = true;
}

/** 构建全部光盘共享的几何、贴图与材质（只做一次）。 */
export function createDiscAssets(renderer, settings) {
  const holeRadius = 2 * settings.holeSize;
  const hubRadius = settings.hubSize;
  const thickness = settings.discThickness;
  const outerRadius = 1 - settings.edgeBleed;

  const frontGeometry = new THREE.RingGeometry(hubRadius, outerRadius, 220, 1);
  const backGeometry = new THREE.RingGeometry(hubRadius, outerRadius, 220, 1);
  remapRingUV(frontGeometry);
  remapRingUV(backGeometry);

  // 中心区从内到外分三段：磨砂 → 镜面 → 透明塑料
  const frostInner = holeRadius / 2;
  const centerSpan = hubRadius - frostInner;
  const matrixInner = frostInner + centerSpan * 0.34;
  const matrixOuter = matrixInner + centerSpan * settings.hubMatrixWidth;
  const centerThickness = thickness * 1.02;

  const frontNormalMap = toTexture(
    buildTexture('frontNormal', settings),
    renderer,
  );
  const backNormalMap = toTexture(buildTexture('backNormal', settings), renderer);
  const frontRoughnessMap = toTexture(
    buildTexture('frontRough', settings),
    renderer,
  );
  const backRoughnessMap = toTexture(
    buildTexture('backRough', settings),
    renderer,
  );
  const matrixTexture = toTexture(
    buildMatrixCanvas(),
    renderer,
    THREE.SRGBColorSpace,
  );

  // 封面未加载时的占位：一块纯深色
  const placeholderCanvas = document.createElement('canvas');
  placeholderCanvas.width = 16;
  placeholderCanvas.height = 16;
  const placeholderCtx = placeholderCanvas.getContext('2d');
  placeholderCtx.fillStyle = '#0c0c0e';
  placeholderCtx.fillRect(0, 0, 16, 16);
  const placeholderTexture = toTexture(
    placeholderCanvas,
    renderer,
    THREE.SRGBColorSpace,
  );

  return {
    frontGeometry,
    backGeometry,
    edgeGeometry: buildEdgeGeometry(settings),
    hubGeometry: buildRingGeometry(
      matrixOuter,
      hubRadius,
      centerThickness,
      0.22,
      160,
    ),
    matrixGeometry: buildRingGeometry(
      matrixInner,
      matrixOuter,
      centerThickness * 0.88,
      0.12,
      128,
    ),
    frostGeometry: buildRingGeometry(
      frostInner,
      matrixInner,
      centerThickness * 0.96,
      0.4,
      128,
    ),
    pickGeometry: new THREE.CircleGeometry(1, 24),
    pickMaterial: new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    frontNormalMap,
    backNormalMap,
    frontRoughnessMap,
    backRoughnessMap,
    matrixTexture,
    placeholderTexture,

    // 数据面：iridescence 是 CD 虹彩的来源，three r178 原生支持
    backMaterial: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(settings.backBaseColor),
      roughness: settings.backRough,
      metalness: settings.backMetal,
      roughnessMap: backRoughnessMap,
      clearcoat: settings.backClearcoat,
      clearcoatRoughness: 0.06,
      iridescence: settings.backIridescence,
      iridescenceIOR: settings.backIridIOR,
      iridescenceThicknessRange: [140, settings.backIridThickness],
      normalMap: backNormalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: 1.5,
    }),
    edgeMaterial: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(settings.edgeColor),
      roughness: settings.edgeRoughness,
      metalness: settings.edgeMetalness,
      clearcoat: 0.7,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.8,
      side: THREE.DoubleSide,
    }),
    // transmission 会触发 three 的透射 pass，开销最大的一块
    hubMaterial: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(settings.hubColor),
      roughness: settings.hubRoughness,
      metalness: 0,
      transmission: settings.hubTransmission,
      thickness: 0.6,
      ior: settings.hubIOR,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.3,
      transparent: true,
      side: THREE.DoubleSide,
    }),
    matrixMaterial: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xdfe3e9),
      map: matrixTexture,
      roughness: 0.28,
      metalness: 0.82,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.45,
      side: THREE.DoubleSide,
    }),
    frostMaterial: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xeeeff5),
      roughness: 0.25 + settings.hubFrostedEdge * 0.55,
      metalness: 0,
      transmission: (1 - settings.hubFrostedEdge) * 0.5,
      thickness: 0.3,
      ior: 1.5,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.9,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  };
}

/**
 * 实例化一张光盘。
 * 外层 group 管位置/缩放，内层 spin 管自转（翻面时只转 spin）。
 * 每张盘有自己的 frontMaterial，因为封面贴图各不相同。
 */
export function createDisc(assets, parent, settings) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);

  const frontMaterial = new THREE.MeshPhysicalMaterial({
    map: assets.placeholderTexture,
    roughness: settings.frontRough,
    metalness: settings.frontMetal,
    roughnessMap: assets.frontRoughnessMap,
    clearcoat: settings.frontClearcoat,
    clearcoatRoughness: 0.18 * (1 - settings.texGloss),
    normalMap: assets.frontNormalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    envMapIntensity: 0.85,
  });

  const half = settings.discThickness / 2;
  const front = new THREE.Mesh(assets.frontGeometry, frontMaterial);
  const back = new THREE.Mesh(assets.backGeometry, assets.backMaterial);
  const edge = new THREE.Mesh(assets.edgeGeometry, assets.edgeMaterial);
  const hub = new THREE.Mesh(assets.hubGeometry, assets.hubMaterial);
  const matrix = new THREE.Mesh(assets.matrixGeometry, assets.matrixMaterial);
  const frost = new THREE.Mesh(assets.frostGeometry, assets.frostMaterial);

  front.position.z = half + 0.0006;
  back.position.z = -half - 0.0006;
  back.rotation.y = Math.PI;
  // Lathe 默认绕 Y 轴，转到绕 Z 才是盘面朝前
  edge.rotation.x = Math.PI / 2;
  hub.rotation.x = Math.PI / 2;
  matrix.rotation.x = Math.PI / 2;
  frost.rotation.x = Math.PI / 2;

  spin.add(front, back, edge, hub, matrix, frost);

  const pick = new THREE.Mesh(assets.pickGeometry, assets.pickMaterial);
  pick.renderOrder = -1;
  group.add(pick);

  parent.add(group);
  group.visible = false;

  return {
    index: -1,
    group,
    spin,
    pick,
    frontMaterial,
    hover: 0,
    spinX: 0,
    spinY: 0,
    resetTween: null,
    justAssigned: false,
    spawnFrom: 0,
    pushX: 0,
    pushY: 0,
    pushZ: 0,
    pushVX: 0,
    pushVY: 0,
    pushVZ: 0,
    pushRotX: 0,
    pushRotY: 0,
    pushRotVX: 0,
    pushRotVY: 0,
  };
}

/** 场景光照：环境光 + 主光 + 补光 + 蓝色轮廓光 + 顶部条光。 */
export function createLights(scene, settings) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const key = new THREE.DirectionalLight(settings.keyColor, settings.keyIntensity);
  key.position.set(settings.keyX, settings.keyY, 6);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffffff, settings.fillIntensity);
  fill.position.set(-5, -2, 4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(settings.rimColor, settings.rimIntensity);
  rim.position.set(0, 3, -6);
  scene.add(rim);

  // 盘面上那道横贯的长条高光
  const strip = new THREE.RectAreaLight(
    0xffffff,
    settings.topStripIntensity,
    6,
    0.4,
  );
  strip.position.set(0, 3.2, 3);
  strip.lookAt(0, 0, 0);
  scene.add(strip);
}

/** 用程序化 canvas 生成 PMREM 环境贴图，无需 HDR 文件。 */
export function applyEnvironment(scene, renderer, settings) {
  const texture = new THREE.CanvasTexture(buildEnvironmentCanvas());
  texture.mapping = THREE.EquirectangularReflectionMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(texture);
  texture.dispose();
  pmrem.dispose();

  scene.environment = target.texture;
  scene.environmentIntensity = settings.environmentIntensity;
  return target;
}
