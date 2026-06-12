// Gradient sky dome, clouds and the horizon skyline. All of it is driven by
// the Environment each frame: time-of-day palettes, storm dimming, stars,
// lightning flash. The dome follows the camera.
import * as THREE from 'three';
import { skylineCanvas } from './assets.js';

export const SUN_DIR = new THREE.Vector3(-0.07, 0.12, -0.99).normalize();

const _deckDark = new THREE.Color('#4f535e');

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunAmt;
uniform float uStars;
uniform float uDim;
uniform float uFlash;
uniform float uTime;
uniform float uOvercast;
uniform vec3 uCloudCol;
varying vec3 vDir;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  vec3 col = mix(uMid, uZenith, smoothstep(0.02, 0.42, h));
  col = mix(uHorizon, col, smoothstep(-0.01, 0.14, h));
  col = mix(uBelow, col, smoothstep(-0.20, -0.01, h));

  // overcast: a slow-drifting cloud deck rolls in with bad weather.
  // Project onto a virtual plane above the camera so the noise keeps texture
  // at the zenith (raw d.xz collapses to a constant there and paints a
  // hard-edged solid cap), keep coverage below 1 and tint from the cloud
  // palette so the deck follows the time of day.
  if (uOvercast > 0.003 && h > 0.01) {
    vec2 p = d.xz * (2.0 / (0.3 + h)) + vec2(uTime * 0.012, uTime * 0.005);
    float n = 0.55 * vnoise(p) + 0.30 * vnoise(p * 2.13 + 17.0) + 0.15 * vnoise(p * 4.31 + 41.0);
    float cov = smoothstep(0.60 - uOvercast * 0.45, 0.86, n + uOvercast * 0.18);
    cov *= uOvercast * smoothstep(0.01, 0.16, h);
    vec3 deck = uCloudCol * (0.72 + 0.34 * n);
    col = mix(col, deck, min(cov, 0.9));
  }

  float sd = max(dot(d, uSunDir), 0.0);
  // wide warm wash on the sun side
  col += uSunColor * pow(sd, 3.0) * 0.22 * uSunAmt;
  col += uSunColor * pow(sd, 14.0) * 0.16 * uSunAmt;
  // glow + disc (doubles as the moon at night — pale color, small glow)
  float glow = pow(sd, 120.0) * 0.35 + pow(sd, 600.0) * 0.5;
  float disc = smoothstep(0.99930, 0.99962, sd);
  col += uSunColor * glow * uSunAmt;
  col += (uSunColor + vec3(0.12)) * disc * (0.6 + 0.55 * uSunAmt);

  // stars fade in at night, hidden by overcast
  if (uStars > 0.001 && h > 0.03) {
    float az = atan(d.x, d.z);
    vec2 sg = vec2(az * 28.0, d.y * 42.0);
    vec2 cell = floor(sg);
    vec2 f = fract(sg);
    float hs = hash21(cell);
    vec2 sp = vec2(hash21(cell + 3.1), hash21(cell + 7.7)) * 0.8 + 0.1;
    float twinkle = 0.7 + 0.3 * sin(uTime * (1.5 + hs * 2.5) + hs * 40.0);
    float star = smoothstep(0.10, 0.02, length(f - sp)) * step(0.78, hs) * twinkle;
    col += vec3(0.85, 0.9, 1.0) * star * uStars * (1.0 - uDim) * smoothstep(0.03, 0.25, h);
  }

  // overcast: desaturate, cool down, darken
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma) * vec3(0.82, 0.84, 0.92), uDim);
  col *= 1.0 - uDim * 0.35;

  // lightning
  col += vec3(0.9, 0.95, 1.0) * uFlash;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeSky() {
  const geo = new THREE.SphereGeometry(3200, 32, 16);
  const uniforms = {
    uZenith: { value: new THREE.Color('#5975b0') },
    uMid: { value: new THREE.Color('#ffad6b') },
    uHorizon: { value: new THREE.Color('#ff9457') },
    uBelow: { value: new THREE.Color('#6b4233') },
    uSunDir: { value: SUN_DIR.clone() },
    uSunColor: { value: new THREE.Color('#ffc27d') },
    uSunAmt: { value: 1 },
    uStars: { value: 0 },
    uDim: { value: 0 },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uOvercast: { value: 0 },
    uCloudCol: { value: new THREE.Color('#9aa0ac') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;

  mesh.userData.update = (env, time, flash) => {
    uniforms.uZenith.value.copy(env.zenith);
    uniforms.uMid.value.copy(env.mid);
    uniforms.uHorizon.value.copy(env.horizon);
    uniforms.uBelow.value.copy(env.below);
    uniforms.uSunDir.value.copy(env.sunDir);
    uniforms.uSunColor.value.copy(env.sunColor);
    uniforms.uSunAmt.value = env.sunAmt * (1 - env.skyDim * 0.8);
    uniforms.uStars.value = env.stars;
    uniforms.uDim.value = env.skyDim;
    uniforms.uFlash.value = flash;
    uniforms.uTime.value = time;
    uniforms.uOvercast.value = env.overcast;
    uniforms.uCloudCol.value.copy(env.cloudTint).lerp(_deckDark, env.cloudDark * 0.8);
  };
  return mesh;
}

export function makeClouds(cloudTexture) {
  const group = new THREE.Group();
  const mat = new THREE.SpriteMaterial({
    map: cloudTexture,
    transparent: true,
    opacity: 0.7,
    color: 0xffe8d2,
    fog: false,
    depthWrite: false,
  });
  for (let i = 0; i < 14; i++) {
    const sprite = new THREE.Sprite(mat);
    const a = (i / 14) * Math.PI * 2 + Math.sin(i * 12.9) * 0.4;
    const r = 900 + (i % 4) * 260;
    // high enough that highland ridges never slice a sprite into a wedge
    sprite.position.set(Math.cos(a) * r, 250 + ((i * 73) % 170), Math.sin(a) * r);
    const s = 220 + ((i * 47) % 180);
    sprite.scale.set(s, s * 0.5, 1);
    group.add(sprite);
  }
  const dark = new THREE.Color('#4a4654');
  group.userData.update = (env) => {
    mat.opacity = env.cloudOpacity * 0.85;
    mat.color.copy(env.cloudTint).lerp(dark, env.cloudDark);
  };
  return group;
}

// Two concentric silhouette bands around the camera: a haze-tinted day layer
// and a dark lit-windows night layer that crossfade with time of day.
export function makeSkyline() {
  const group = new THREE.Group();
  const layers = [];
  for (const lit of [false, true]) {
    const tex = new THREE.CanvasTexture(skylineCanvas(lit));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = 7; // ~2 km of texture per repeat, keeps towers building-sized
    const geo = new THREE.CylinderGeometry(2500 - (lit ? 2 : 0), 2500 - (lit ? 2 : 0), 420, 72, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    group.add(mesh);
    layers.push(mat);
  }
  group.userData.update = (env, camera) => {
    // base of the band sits below the horizon, towers rise just above it
    group.position.set(camera.position.x, camera.position.y + 45, camera.position.z);
    const fogVis = THREE.MathUtils.smoothstep(env.fogFar, 300, 1000);
    const amt = env.skylineAmt * fogVis;
    layers[0].opacity = amt * (1 - env.night * 0.88) * (1 - env.skyDim * 0.4);
    layers[0].color.copy(env.skylineTint);
    layers[1].opacity = amt * env.night;
    group.visible = amt > 0.01;
  };
  return group;
}
