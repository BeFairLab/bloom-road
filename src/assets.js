// Texture loading with procedural canvas fallbacks, so the demo still runs
// if the generated assets are missing.
import * as THREE from 'three';

function prep(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

async function loadOrFallback(url, fallbackFn) {
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    return prep(tex);
  } catch {
    return prep(new THREE.CanvasTexture(fallbackFn()));
  }
}

function flowerCanvas(petal, center) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  // stem
  g.strokeStyle = '#5d7a3c';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(64, 124);
  g.quadraticCurveTo(58, 90, 64, 52);
  g.stroke();
  // leaf
  g.fillStyle = '#6d8a44';
  g.beginPath();
  g.ellipse(48, 92, 14, 6, -0.7, 0, Math.PI * 2);
  g.fill();
  // petals
  g.fillStyle = petal;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.beginPath();
    g.ellipse(64 + Math.cos(a) * 18, 44 + Math.sin(a) * 18, 15, 9, a, 0, Math.PI * 2);
    g.fill();
  }
  // center
  g.fillStyle = center;
  g.beginPath();
  g.arc(64, 44, 11, 0, Math.PI * 2);
  g.fill();
  return c;
}

function cloudCanvas() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const blobs = [
    [70, 84, 38], [120, 66, 46], [176, 80, 40], [110, 92, 44], [156, 94, 34],
  ];
  for (const [x, y, r] of blobs) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255, 240, 222, 0.95)');
    grad.addColorStop(0.7, 'rgba(255, 226, 198, 0.55)');
    grad.addColorStop(1, 'rgba(255, 226, 198, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export function softDotCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 235, 200, 1)');
  grad.addColorStop(0.5, 'rgba(255, 225, 185, 0.55)');
  grad.addColorStop(1, 'rgba(255, 225, 185, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export function rainStreakCanvas() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(200, 215, 235, 0)');
  grad.addColorStop(0.45, 'rgba(205, 220, 240, 0.9)');
  grad.addColorStop(1, 'rgba(200, 215, 235, 0)');
  g.fillStyle = grad;
  g.fillRect(6, 0, 4, 64);
  return c;
}

export function snowflakeCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 14);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.6, 'rgba(240, 246, 255, 0.6)');
  grad.addColorStop(1, 'rgba(240, 246, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
}

// City silhouette band for the horizon. Day version is drawn white so the
// material color can tint it to the haze; night version is dark with lit windows.
export function skylineCanvas(lit) {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d');
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let x = 0;
  while (x < 2048) {
    const w = 16 + rnd() * 48;
    const h = 26 + Math.pow(rnd(), 1.7) * 165;
    g.fillStyle = lit ? '#0c1322' : '#ffffff';
    g.fillRect(x, 256 - h, w, h);
    if (rnd() < 0.3) g.fillRect(x + w * 0.32, 256 - h - 9, w * 0.18, 9); // rooftop block
    if (rnd() < 0.18) g.fillRect(x + w * 0.46, 256 - h - 22, 2, 22); // antenna
    if (lit) {
      g.fillStyle = 'rgba(255, 192, 110, 0.9)';
      for (let wy = 256 - h + 5; wy < 248; wy += 7) {
        for (let wx = x + 3; wx < x + w - 3; wx += 6) {
          if (rnd() < 0.34) g.fillRect(wx, wy, 2.4, 3.4);
        }
      }
    }
    x += w + (rnd() < 0.25 ? 8 + rnd() * 34 : 2);
  }
  return c;
}

// Skyscraper facade: pale curtain-wall grid that instance colors can tint…
export function towerFacadeCanvas() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9ced4';
  g.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 6; col++) {
      g.fillStyle = (row + col) % 2 ? '#9fb4c6' : '#a8bccb';
      g.fillRect(6 + col * 20, 6 + row * 15.5, 16, 11);
    }
  }
  return c;
}

// …and the matching emissive map: scattered windows that light up at night.
export function towerWindowsCanvas() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 128, 256);
  let seed = 424241;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 6; col++) {
      if (rnd() < 0.42) {
        g.fillStyle = `rgba(255, ${175 + Math.floor(rnd() * 50)}, 110, ${0.55 + rnd() * 0.45})`;
        g.fillRect(6 + col * 20, 6 + row * 15.5, 16, 11);
      }
    }
  }
  return c;
}

export function blobShadowCanvas() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(40, 20, 12, 0.55)');
  grad.addColorStop(0.7, 'rgba(40, 20, 12, 0.28)');
  grad.addColorStop(1, 'rgba(40, 20, 12, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

export async function loadGameTextures() {
  const [poppy, daisy, gold, cloud] = await Promise.all([
    loadOrFallback('/assets/flower_poppy.png', () => flowerCanvas('#e0653f', '#7a3520')),
    loadOrFallback('/assets/flower_daisy.png', () => flowerCanvas('#f4ead2', '#e0a13c')),
    loadOrFallback('/assets/flower_gold.png', () => flowerCanvas('#e8b33c', '#9c5e22')),
    loadOrFallback('/assets/cloud.png', cloudCanvas),
  ]);
  return { flowers: [poppy, daisy, gold], cloud };
}
