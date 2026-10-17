// 光盘的四张程序化贴图：两张法线、两张粗糙度。
// 全部用像素循环生成，不依赖任何外部美术资源。
// 高度图经 Sobel 差分转法线，和原站的 writeNormals 一致。

function valueNoise(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function writeNormals(heightMap, data, size) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heightMap[y * size + Math.max(0, x - 1)];
      const right = heightMap[y * size + Math.min(size - 1, x + 1)];
      const up = heightMap[Math.max(0, y - 1) * size + x];
      const down = heightMap[Math.min(size - 1, y + 1) * size + x];

      let nx = left - right;
      let ny = up - down;
      let nz = 1;

      const inverse = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const index = (y * size + x) * 4;

      nx *= inverse;
      ny *= inverse;
      nz *= inverse;

      data[index] = (nx * 0.5 + 0.5) * 255;
      data[index + 1] = (ny * 0.5 + 0.5) * 255;
      data[index + 2] = (nz * 0.5 + 0.5) * 255;
      data[index + 3] = 255;
    }
  }
}

// 印刷面法线：同心光学纹 + 印刷颗粒 − 划痕 + 灰尘点
function frontNormal(size, s) {
  const data = new Uint8ClampedArray(size * size * 4);
  const heightMap = new Float32Array(size * size);
  const center = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const radiusValue = Math.sqrt(dx * dx + dy * dy) + 0.0001;

      const optical = Math.sin(radiusValue * 0.6) * 0.02;
      const ink = (valueNoise(x * 0.4, y * 0.4) - 0.5) * 0.5 * s.texPrint;

      heightMap[y * size + x] = optical + ink;
    }
  }

  const scratchCount = Math.floor(30 * s.texScratches);

  for (let scratch = 0; scratch < scratchCount; scratch += 1) {
    const angle = Math.random() * Math.PI * 2;
    const length = 30 + Math.random() * 220;
    const startX = Math.random() * size;
    const startY = Math.random() * size;
    const deltaX = Math.cos(angle);
    const deltaY = Math.sin(angle);
    const depth = (Math.random() * 0.7 + 0.2) * s.texScratches;

    for (let step = 0; step < length; step += 1) {
      const px = Math.round(startX + deltaX * step);
      const py = Math.round(startY + deltaY * step);

      if (px < 1 || py < 1 || px >= size - 1 || py >= size - 1) continue;

      heightMap[py * size + px] -= depth;
    }
  }

  const dustCount = Math.floor(500 * s.texScratches);

  for (let dust = 0; dust < dustCount; dust += 1) {
    const px = Math.floor(Math.random() * size);
    const py = Math.floor(Math.random() * size);

    heightMap[py * size + px] += (Math.random() - 0.5) * s.texScratches * 1.2;
  }

  writeNormals(heightMap, data, size);
  return data;
}

// 数据面法线：密集同心环，虹彩靠它产生方向性
function backNormal(size, s) {
  const data = new Uint8ClampedArray(size * size * 4);
  const heightMap = new Float32Array(size * size);
  const center = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const radiusValue = Math.sqrt(dx * dx + dy * dy);

      const ring = Math.sin(radiusValue * 3.2) * 0.5 * s.backRadialDetail;
      const jitter =
        (valueNoise(x * 0.6, y * 0.6) - 0.5) * 0.06 * s.backRadialDetail;

      heightMap[y * size + x] = ring + jitter;
    }
  }

  writeNormals(heightMap, data, size);
  return data;
}

// 印刷面粗糙度：高频颗粒 + 低频印刷 − 同心光泽带
function frontRough(size, s) {
  const data = new Uint8ClampedArray(size * size * 4);
  const center = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let roughness = s.frontRough;

      roughness += (valueNoise(x * 2.3, y * 2.3) - 0.5) * 0.35 * s.texGrain;
      roughness += (valueNoise(x * 0.5, y * 0.5) - 0.5) * 0.3 * s.texPrint;

      const dx = x - center;
      const dy = y - center;
      const radiusValue = Math.sqrt(dx * dx + dy * dy) / (size * 0.5);

      roughness -= (Math.sin(radiusValue * 14) * 0.5 + 0.5) * 0.5 * s.texGloss;
      roughness = clamp(roughness, 0.02, 1);

      const value = roughness * 255;
      const index = (y * size + x) * 4;

      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }

  return data;
}

// 数据面粗糙度：基础值 + 低频环带 + 轻噪声
function backRough(size, s) {
  const data = new Uint8ClampedArray(size * size * 4);
  const center = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const radiusValue = Math.sqrt(dx * dx + dy * dy);

      let roughness = s.backRough;

      roughness += Math.sin(radiusValue * 1.6) * 0.06 * s.backRadialDetail;
      roughness +=
        (valueNoise(x * 1.2, y * 1.2) - 0.5) * 0.04 * s.backRadialDetail;
      roughness = clamp(roughness, 0.02, 1);

      const value = roughness * 255;
      const index = (y * size + x) * 4;

      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }

  return data;
}

const BUILDERS = { frontNormal, backNormal, frontRough, backRough };

// 贴图尺寸：512 够用，法线细节主要来自高频噪声
const TEXTURE_SIZE = 512;

const cache = new Map();

/** 生成一张程序化贴图，返回可直接喂给 CanvasTexture 的 canvas。 */
export function buildTexture(name, settings, size = TEXTURE_SIZE) {
  const key = `${name}:${size}:${settings.texGrain}:${settings.texPrint}:${settings.texScratches}:${settings.texGloss}:${settings.backRadialDetail}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const data = BUILDERS[name](size, settings);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(data, size, size), 0, 0);

  cache.set(key, canvas);
  return canvas;
}

/** 中心镜面环的径向渐变贴图：四圈细线叠在渐变上。 */
export function buildMatrixCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(256, 256, 40.96, 256, 256, 256);
  gradient.addColorStop(0, '#d9dde4');
  gradient.addColorStop(0.42, '#f0f2f5');
  gradient.addColorStop(0.72, '#cfd4dc');
  gradient.addColorStop(1, '#b8bec8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  ctx.lineWidth = 1;
  [0.255, 0.285, 0.315, 0.345].forEach((radius, index) => {
    ctx.strokeStyle = `rgba(255,255,255,${0.14 - index * 0.018})`;
    ctx.beginPath();
    ctx.arc(256, 256, 512 * radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  return canvas;
}

/**
 * 环境贴图：深色竖向渐变 + 四道亮条。
 * 光盘 70% 的质感来自这张图，亮条就是盘面扫过的高光。
 */
export function buildEnvironmentCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#25282f');
  gradient.addColorStop(0.5, '#0e0f13');
  gradient.addColorStop(1, '#020203');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);

  const span = 0.07;
  [
    [0.14, span, 1],
    [0.4, span * 0.7, 0.6],
    [0.26, span * 1.1, 0.85],
    [0.62, span * 0.5, 0.35],
  ].forEach(([position, height, strength]) => {
    const bar = ctx.createLinearGradient(
      0,
      512 * (position - height),
      0,
      512 * (position + height),
    );
    bar.addColorStop(0, 'rgba(255,255,255,0)');
    bar.addColorStop(0.5, `rgba(255,255,255,${Math.max(0.1, 0.85 * strength)})`);
    bar.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bar;
    ctx.fillRect(0, 512 * (position - height), 1024, 512 * height * 2);
  });

  return canvas;
}

/**
 * 封面合成：把方形封面裁成圆环（挖掉中心孔），底色 #0c0c0e。
 * 用 evenodd 填充规则一次裁出环形，封面按 cover 居中绘制。
 */
export function composeArtwork(image, settings, degToRad) {
  const size = clamp(
    settings.artResolution,
    settings.artResolutionMin,
    settings.artResolutionMax,
  );
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const innerRadius = size * 0.5 * Math.max(settings.holeSize, settings.hubSize);

  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.arc(size / 2, size / 2, innerRadius, 0, Math.PI * 2, true);
  ctx.clip('evenodd');

  ctx.fillStyle = '#0c0c0e';
  ctx.fillRect(0, 0, size, size);

  ctx.filter = `brightness(${settings.artBright}) contrast(${settings.artContrast}) saturate(${settings.artSat})`;
  ctx.translate(size / 2 + settings.artX * size, size / 2 - settings.artY * size);
  ctx.rotate(degToRad(settings.artRot));

  const aspect = image.naturalWidth / image.naturalHeight;
  let drawWidth = size * settings.artScale;
  let drawHeight = size * settings.artScale;
  if (aspect > 1) drawWidth = drawHeight * aspect;
  else drawHeight = drawWidth / aspect;

  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.filter = 'none';
  ctx.restore();

  return canvas;
}
