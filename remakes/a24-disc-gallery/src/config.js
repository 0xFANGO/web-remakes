// 光盘画廊的全部可调参数。
// 数值整体取自线上产物的配置对象，复刻时保持同名，便于和分析文档逐项对照。
export const CONFIG = {
  // 封面合成
  artScale: 1,
  artX: 0,
  artY: 0,
  artRot: 0,
  artBright: 1,
  artContrast: 1,
  artSat: 1,
  artResolution: 1024,

  // 程序化贴图强度
  texGrain: 0.59,
  texPrint: 0.35,
  texScratches: 0.36,
  texGloss: 1,

  // 印刷面
  frontClearcoat: 0.8,
  frontRough: 0.42,
  frontMetal: 0.48,

  // 数据面（虹彩）
  backBaseColor: '#1A1E2A',
  backRough: 0.23,
  backMetal: 1,
  backClearcoat: 0.34,
  backIridescence: 1,
  backIridIOR: 1.86,
  backIridThickness: 900,
  backRadialDetail: 1,

  // 外缘与中心环
  edgeColor: '#FFFFFF',
  edgeRoughness: 0.04,
  edgeMetalness: 0.55,
  edgeBleed: 0.026,
  hubColor: '#FFFFFF',
  hubTransmission: 0.68,
  hubRoughness: 0.38,
  hubIOR: 2,
  hubMatrixIntensity: 0.85,
  hubMatrixWidth: 0.4,
  hubFrostedEdge: 0.54,

  // 几何
  discThickness: 0.01,
  edgeBevel: 1,
  holeSize: 0.14,
  hubSize: 0.24,

  // 画廊布局
  galleryScale: 1.08,
  hGap: 2.3,
  depthGap: 1,
  activeDiscY: 0.06,
  galleryRotX: -30,
  galleryRotY: -30,
  inactiveScale: 0.8,

  // 相机与色调
  cameraDistance: 4.4,
  cameraFOV: 40,
  exposure: 0.86,
  environmentIntensity: 1,

  // 灯光
  keyIntensity: 0.75,
  keyColor: '#FFF9E8',
  keyX: 3.5,
  keyY: -8,
  fillIntensity: 0.3,
  rimIntensity: 0.75,
  rimColor: '#499FF5',
  topStripIntensity: 1.9,
  fogColor: '#FFFFFF',

  // 指针与拖拽
  hoverTiltStrength: 0.21,
  dragSensitivity: 0.95,
  dragVelocitySmoothing: 0.32,
  dragMaxVelocity: 0.5,
  friction: 0.89,
  maxSpinAngle: 180,
  resetDuration: 1.2,
  dragStartDistance: 5,

  // snap 与甩动手感
  snapDuration: 0.46,
  flowLean: 0.055,
  flowLeanMax: 0.3,
  flowBank: 0.32,
  flowDip: 0.014,
  flowDipMax: 0.09,
  followTight: 15,
  followBase: 11,
  followFalloff: 1.15,
  followMin: 6.5,
  spawnSlide: 0.9,
  spawnShrink: 0.72,
  snapFreq: 9.5,
  snapDamping: 12,

  // 点击推挤回弹
  pushDamping: 4.5,
  pushReturn: 3.4,
  pressDepth: 0.55,
  pressTilt: 1.5,

  // 入场/退场飞行
  flightRecede: 2.2,
  flightStagger: 0.45,
  flightStaggerIn: 0.28,
  flightStaggerMax: 4,
  flightPopScale: 0.35,
  flightPopScaleIn: 0.02,

  // preloader 联动
  preloadBoost: 0.8,
  preloadGrowBy: 0.5,
  preloadSpin: 1.1,
  preloadRiseFrom: 3,
  preloadRiseDepth: 0.7,
  preloadFanDuration: 1.15,

  // 触屏布局
  touchFlickVelocity: 0.035,
  touchFit: 1,
  touchPeek: 1,
  touchMinScale: 0.3,
  touchMaxScale: 3,
  touchGap: 2.2,
  touchDepth: 0.5,
  touchDropY: 1,
  touchActiveScale: 1.5,
  touchInactiveScale: 0.6,

  // 滚轮手势状态机
  wheelNoiseFloor: 0.3,
  wheelStepThreshold: 6,
  wheelEventCap: 24,
  wheelEnvelopeTau: 550,
  wheelRiseFactor: 1.2,
  wheelTickGap: 34,
  wheelPauseGap: 130,
  wheelIdleReset: 150,
  wheelMinStepTick: 90,
  wheelMinStepFlick: 190,
  wheelSustainDelay: 480,
  wheelSustainRatio: 0.8,

  // 手绘圈
  scribbleEnabled: 1,
  scribbleColor: '#000000',
  scribbleFps: 10,
  scribblePoints: 24,
  scribbleJitter: 0.028,
  scribbleLoops: 2,
  scribbleLoopGap: 0.045,
  scribblePadding: 0.06,
  scribbleWidth: 0.012,
  scribbleSweep: 0.68,
  scribbleSweepJitter: 0.4,
  scribbleIn: [0.3, 0.5, 0.72],
  scribbleOut: [0.72, 0.5, 0.3],
  scribbleLag: 15,

  // 实例化范围
  renderRadius: 5,
  artResolutionMin: 512,
  artResolutionMax: 1536,
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
