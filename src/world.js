// Endless procedural world: a road of varied character through changing
// country. The centerline is integrated from a curvature function that is
// gated into straights and bends and flattens out downtown; terrain is a
// ribbon following the road; everything is built/disposed in chunks as the
// car advances. The landscape (fields / highlands / desert / skyline
// outskirts / downtown) blends along the arc length, so new country always
// morphs in smoothly ahead of the car.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { towerFacadeCanvas, towerWindowsCanvas } from './assets.js';

export const DS = 2.4;               // meters between stations
export const ROAD_HALF = 4.6;        // half road width
const CHUNK_STATIONS = 56;           // ~134 m per chunk
const CHUNK_LEN = DS * CHUNK_STATIONS;

function roadYBase(s) {
  return Math.sin(s * 0.0046 + 2.0) * 2.4 + Math.sin(s * 0.0013) * 1.6 + Math.sin(s * 0.017) * 0.4;
}
function curvatureBase(s) {
  return (
    Math.sin(s * 0.0021 + 1.7) * 0.0035 +
    Math.sin(s * 0.00057 + 0.4) * 0.0028 +
    Math.sin(s * 0.0089) * 0.0009
  );
}
// 0 = straightaway, 1 = winding section; gives the road long straight breaths
function bendGate(s) {
  const w = Math.sin(s * 0.0024 + 0.8) + 0.55 * Math.sin(s * 0.00091 + 2.2);
  return smoothstep(-0.25, 0.35, w);
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function hash2(a, b) {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// ---- ground palettes per landscape ----------------------------------------
const PAL = [
  { near: '#8e9c52', far: '#d8aa5c', patch: '#cd8348', dirt: '#bb9a68', patchAmt: 0.45 },
  { near: '#79805c', far: '#9b8f7a', patch: '#8d7585', dirt: '#9a8a70', patchAmt: 0.2 },
  { near: '#cfa86a', far: '#dca257', patch: '#b97a3f', dirt: '#c4a070', patchAmt: 0.35 },
  { near: '#8a9456', far: '#c2a468', patch: '#b08050', dirt: '#a99878', patchAmt: 0.3 },
  { near: '#6f6b66', far: '#7c7a74', patch: '#666058', dirt: '#86827c', patchAmt: 0.15 },
].map((p) => ({
  near: new THREE.Color(p.near), far: new THREE.Color(p.far),
  patch: new THREE.Color(p.patch), dirt: new THREE.Color(p.dirt), patchAmt: p.patchAmt,
}));
const C_ASPHALT = new THREE.Color('#52453e');
const C_SNOWCAP = new THREE.Color('#e8ecf2');

const _col = new THREE.Color();
const _acc = new THREE.Color();
const _tmp = new THREE.Color();

function roadColor(s, d) {
  _col.copy(C_ASPHALT);
  _col.offsetHSL(0, 0, (hash2(Math.floor(s * 0.8), Math.floor(d)) - 0.5) * 0.05);
  return _col;
}

// Cylindrical-billboard flower shader with wind sway driven by the music.
const FLOWER_VERT = /* glsl */ `
uniform float uTime;
uniform float uWind;
varying vec2 vUv;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 origin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(vec3(instanceMatrix[0].xyz));
  float hash = fract(sin(dot(origin.xz, vec2(12.9898, 78.233))) * 43758.5453);

  vec3 toCam = cameraPosition - origin.xyz;
  toCam.y = 0.0;
  vec3 fwd = normalize(toCam + vec3(0.0001, 0.0, 0.0));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));

  vec3 pos = origin.xyz + right * (position.x * scale) + vec3(0.0, 1.0, 0.0) * (position.y * scale);
  float sway = sin(uTime * 1.5 + hash * 6.2831 + origin.x * 0.06) * (0.05 + uWind * 0.14);
  pos += (right * sway + fwd * sway * 0.35) * (vUv.y * vUv.y) * scale;

  vShade = 0.82 + 0.3 * hash;
  vec4 mvPosition = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const FLOWER_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uTint;
uniform vec3 uLight;
uniform float uSnow;
varying vec2 vUv;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.45) discard;
  vec3 col = c.rgb * uTint * vShade;
  col = mix(col, vec3(0.93, 0.95, 1.02), uSnow * 0.7);
  col *= uLight;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

function coloredGeo(geo, hex) {
  if (geo.index) geo = geo.toNonIndexed(); // merge needs uniform indexing; non-indexed = flat facets
  const color = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function makeTreeProto() {
  const trunk = coloredGeo(new THREE.CylinderGeometry(0.09, 0.16, 1.1, 5).translate(0, 0.55, 0), '#6e4f38');
  const lower = coloredGeo(new THREE.ConeGeometry(0.62, 1.5, 6).translate(0, 1.6, 0), '#5d7a3c');
  const upper = coloredGeo(new THREE.ConeGeometry(0.45, 1.1, 6).translate(0, 2.5, 0), '#6d8a44');
  return mergeGeometries([trunk, lower, upper]);
}
function makeRoundTreeProto() {
  const trunk = coloredGeo(new THREE.CylinderGeometry(0.1, 0.17, 1.3, 5).translate(0, 0.65, 0), '#6e4f38');
  const blobA = coloredGeo(new THREE.IcosahedronGeometry(0.85, 0).translate(0, 1.9, 0), '#647e3e');
  const blobB = coloredGeo(new THREE.IcosahedronGeometry(0.6, 0).translate(0.4, 2.4, 0.1), '#7a9148');
  return mergeGeometries([trunk, blobA, blobB]);
}
function makePoleProto() {
  const pole = coloredGeo(new THREE.CylinderGeometry(0.07, 0.1, 7, 5).translate(0, 3.5, 0), '#7c5d45');
  const arm = coloredGeo(new THREE.BoxGeometry(1.7, 0.12, 0.12).translate(0, 6.3, 0), '#6e5240');
  return mergeGeometries([pole, arm]);
}
function makeCactusProto() {
  const body = coloredGeo(new THREE.CylinderGeometry(0.3, 0.38, 2.6, 7).translate(0, 1.3, 0), '#5f7a45');
  const armA = coloredGeo(new THREE.CylinderGeometry(0.15, 0.17, 0.9, 6).rotateZ(Math.PI / 2).translate(-0.62, 1.45, 0), '#587242');
  const armAUp = coloredGeo(new THREE.CylinderGeometry(0.14, 0.15, 0.9, 6).translate(-1.0, 1.9, 0), '#587242');
  const armB = coloredGeo(new THREE.CylinderGeometry(0.13, 0.15, 0.7, 6).rotateZ(-Math.PI / 2).translate(0.5, 1.9, 0), '#587242');
  const armBUp = coloredGeo(new THREE.CylinderGeometry(0.12, 0.13, 0.7, 6).translate(0.82, 2.25, 0), '#587242');
  return mergeGeometries([body, armA, armAUp, armB, armBUp]);
}
function makeRockProto() {
  const a = coloredGeo(new THREE.IcosahedronGeometry(0.9, 0).scale(1, 0.62, 1).translate(0, 0.34, 0), '#9a8a72');
  const b = coloredGeo(new THREE.IcosahedronGeometry(0.55, 0).scale(1, 0.7, 1).translate(0.7, 0.22, 0.3), '#8a7a64');
  return mergeGeometries([a, b]);
}
function makeStreetlightProto() {
  const pole = coloredGeo(new THREE.CylinderGeometry(0.07, 0.1, 5.4, 6).translate(0, 2.7, 0), '#4a4a52');
  const arm = coloredGeo(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5).rotateZ(Math.PI / 2).translate(0.8, 5.3, 0), '#4a4a52');
  const head = coloredGeo(new THREE.BoxGeometry(0.5, 0.14, 0.22).translate(1.5, 5.26, 0), '#3a3a40');
  return mergeGeometries([pole, arm, head]);
}

// cool glass tones for the downtown towers
const TOWER_COLORS = ['#9fb6c6', '#b5c4cf', '#8ba3b5', '#c4c9cf', '#7f95a8', '#aab4be'].map((c) => new THREE.Color(c));

// flower density by landscape
const FLOWER_DENS = [1, 0.45, 0.18, 0.85, 0.06];

function addSnowUniform(mat, uniformRef) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowCov = uniformRef;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnowCov;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 1.0), uSnowCov);'
      );
  };
}

export class World {
  constructor(scene, flowerTextures, env) {
    this.scene = scene;
    this.env = env;
    this.stations = [];
    this.genState = { s: 0, x: 0, z: 0, theta: 0 };
    this.chunks = new Map();

    this.uTime = { value: 0 };
    this.uWind = { value: 0.3 };
    this.uFlowerLight = { value: new THREE.Color(1, 1, 1) };
    this.uFlowerSnow = { value: 0 };
    this.uSnowGround = { value: 0 };
    this.uSnowRoad = { value: 0 };

    this.flowerGeo = new THREE.PlaneGeometry(1, 1.15);
    this.flowerGeo.translate(0, 0.575, 0);

    const tints = [0xffffff, 0xfff4e2, 0xffe9c8];
    this.flowerMats = flowerTextures.map((tex, i) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uTime: this.uTime,
          uWind: this.uWind,
          uLight: this.uFlowerLight,
          uSnow: this.uFlowerSnow,
          map: { value: tex },
          uTint: { value: new THREE.Color(tints[i % tints.length]) },
        },
        vertexShader: FLOWER_VERT,
        fragmentShader: FLOWER_FRAG,
        fog: true,
        side: THREE.DoubleSide,
      });
      // keep shared uniform objects shared (clone above copies fog only)
      mat.uniforms.uTime = this.uTime;
      mat.uniforms.uWind = this.uWind;
      mat.uniforms.uLight = this.uFlowerLight;
      mat.uniforms.uSnow = this.uFlowerSnow;
      return mat;
    });

    this.groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.roadMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    addSnowUniform(this.groundMat, this.uSnowGround);
    addSnowUniform(this.roadMat, this.uSnowRoad);
    this.lineMat = new THREE.MeshBasicMaterial({ color: 0xffe5b8 });
    this.lineColorDay = new THREE.Color(0xffe5b8);
    this.lineColorNight = new THREE.Color(0x7d83a6);
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    const facadeTex = new THREE.CanvasTexture(towerFacadeCanvas());
    facadeTex.colorSpace = THREE.SRGBColorSpace;
    const windowsTex = new THREE.CanvasTexture(towerWindowsCanvas());
    windowsTex.colorSpace = THREE.SRGBColorSpace;
    this.buildingMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map: facadeTex,
      emissive: new THREE.Color(0xffc788),
      emissiveMap: windowsTex,
      emissiveIntensity: 0,
    });

    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x46392c });
    this.lampOff = new THREE.Color(0x46392c);
    this.lampOn = new THREE.Color(0xffc97a);

    // rain puddles mirror the sky; snowdrifts pile up at the road edges
    this.puddleMat = new THREE.MeshBasicMaterial({ color: 0xa0b4c8, transparent: true, opacity: 0, depthWrite: false });
    this.driftMat = new THREE.MeshLambertMaterial({ color: 0xeef2f8, transparent: true, opacity: 0 });

    this.treeProtoA = makeTreeProto();
    this.treeProtoB = makeRoundTreeProto();
    this.poleProto = makePoleProto();
    this.cactusProto = makeCactusProto();
    this.rockProto = makeRockProto();
    this.lampProto = makeStreetlightProto();
    this.buildingGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.lampGlowGeo = new THREE.SphereGeometry(0.17, 6, 5);
    this.puddleGeo = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2);
    this.driftGeo = new THREE.IcosahedronGeometry(1, 0).scale(1, 0.32, 1);
    this.sharedGeos = new Set([
      this.flowerGeo, this.treeProtoA, this.treeProtoB, this.poleProto,
      this.cactusProto, this.rockProto, this.lampProto, this.buildingGeo,
      this.lampGlowGeo, this.puddleGeo, this.driftGeo,
    ]);

    // the outer columns slope the terrain away into a far valley: the mesh
    // edge never hangs in the sky, and (unlike a vertical fold) the descent
    // reads as a natural hillside even when a curve swings it close
    this.groundOffsets = [4.6, 6, 9, 14, 22, 34, 52, 80, 120, 170, 230, 300, 360, 440, 540];
  }

  // ---- road shape, gated by landscape: downtown straightens and flattens ----

  roadYAt(s) {
    const w = this.env.weightsAt(s);
    return roadYBase(s) * (1 + w[1] * 0.5 - w[4] * 0.72 - w[3] * 0.25 - w[2] * 0.15);
  }

  curvatureAt(s) {
    const w = this.env.weightsAt(s);
    return curvatureBase(s) * (0.25 + 1.3 * bendGate(s)) * (1 - w[4] * 0.92 - w[3] * 0.4);
  }

  // Terrain height at (arc length s, signed lateral offset d), shaped by the
  // landscape weights: fields roll, highlands ridge up, dunes drift, city flattens.
  terrainH(s, d, w) {
    const ad = Math.abs(d);
    const ramp = smoothstep(ROAD_HALF + 1.4, 28, ad);
    const nearMul = 1 - (w[4] * 0.75 + w[3] * 0.25);
    let h =
      (Math.sin(s * 0.013 + d * 0.045) * 1.1 +
        Math.sin(s * 0.0048 + d * 0.011 + 2.1) * 2.3 +
        Math.sin(s * 0.027 + d * 0.07) * 0.3) *
      ramp * nearMul;

    const far = smoothstep(60, 250, ad);
    const base = 9 + 7 * Math.sin(s * 0.0021 + d * 0.006 + 1.0) + 5 * Math.sin(s * 0.0009 - d * 0.004 + 0.7);
    const ampMul = w[0] * 1 + w[1] * 3.6 + w[2] * 1.4 + w[3] * 0.7 + w[4] * 0.35;
    h += far * base * ampMul;
    // highland ridges
    h += w[1] * far * (16 * Math.pow(Math.abs(Math.sin(s * 0.0012 + d * 0.0045)), 1.5) + 11 * Math.abs(Math.sin(s * 0.0005 - d * 0.002 + 2.0)));
    // desert dunes
    h += w[2] * far * 6 * Math.sin(s * 0.003 + d * 0.01);
    return this.roadYAt(s) + h;
  }

  groundColor(s, d, h, w) {
    const ad = Math.abs(d);
    const farT = smoothstep(12, 210, ad);
    const p = Math.sin(s * 0.016 + d * 0.05) * Math.sin(s * 0.005 - d * 0.013 + 3.0);
    const patchT = smoothstep(0.45, 0.85, p);
    const dirtT = ad < 8 ? smoothstep(8, 5.2, ad) * 0.85 : 0;

    _acc.setRGB(0, 0, 0);
    for (let i = 0; i < 5; i++) {
      if (w[i] < 0.004) continue;
      const pal = PAL[i];
      _tmp.copy(pal.near).lerp(pal.far, farT);
      _tmp.lerp(pal.patch, patchT * pal.patchAmt);
      if (dirtT > 0) _tmp.lerp(pal.dirt, dirtT);
      _acc.r += _tmp.r * w[i];
      _acc.g += _tmp.g * w[i];
      _acc.b += _tmp.b * w[i];
    }
    // snow caps on high ground in the highlands
    const rel = h - this.roadYAt(s);
    const cap = smoothstep(26, 48, rel) * w[1];
    if (cap > 0) _acc.lerp(C_SNOWCAP, cap * 0.9);
    _acc.offsetHSL(0, 0, (hash2(Math.floor(s * 0.6), Math.floor(d * 0.6)) - 0.5) * 0.10);
    return _acc;
  }

  ensureStations(n) {
    while (this.stations.length <= n) {
      const g = this.genState;
      this.stations.push({ s: g.s, x: g.x, y: this.roadYAt(g.s), z: g.z, theta: g.theta });
      g.x += Math.sin(g.theta) * DS;
      g.z += -Math.cos(g.theta) * DS;
      g.s += DS;
      g.theta += this.curvatureAt(g.s) * DS;
    }
  }

  getFrame(s) {
    const f = Math.max(0, s) / DS;
    const i = Math.floor(f);
    const t = f - i;
    this.ensureStations(i + 2);
    const a = this.stations[i];
    const b = this.stations[i + 1];
    const theta = a.theta + (b.theta - a.theta) * t;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      theta,
      dirX: Math.sin(theta),
      dirZ: -Math.cos(theta),
      rightX: Math.cos(theta),
      rightZ: Math.sin(theta),
    };
  }

  ensure(carS, budget = 2) {
    const ciMin = Math.max(0, Math.floor((carS - 160) / CHUNK_LEN));
    const ciMax = Math.floor((carS + 820) / CHUNK_LEN);
    let built = 0;
    for (let ci = ciMin; ci <= ciMax; ci++) {
      if (!this.chunks.has(ci)) {
        this._buildChunk(ci);
        if (++built >= budget) break;
      }
    }
    for (const [ci, chunk] of this.chunks) {
      if (ci < ciMin || ci > ciMax) this._disposeChunk(ci, chunk);
    }
  }

  // Drop chunks AND road centerline past the given arc length so the road
  // regenerates with the new landscape's character (straight downtown, etc.).
  // Stations are only truncated past the last kept chunk — kept geometry
  // references the old centerline, so cutting earlier would tear the seam.
  invalidateBeyond(s) {
    let maxKept = -1;
    for (const [ci, chunk] of this.chunks) {
      if (ci * CHUNK_LEN > s) this._disposeChunk(ci, chunk);
      else maxKept = Math.max(maxKept, ci);
    }
    const keep = Math.max(2, (maxKept + 1) * CHUNK_STATIONS + 3);
    if (this.stations.length > keep) {
      this.stations.length = keep;
      const last = this.stations[keep - 1];
      const g = this.genState;
      g.x = last.x + Math.sin(last.theta) * DS;
      g.z = last.z - Math.cos(last.theta) * DS;
      g.s = last.s + DS;
      g.theta = last.theta + this.curvatureAt(g.s) * DS;
    }
  }

  _disposeChunk(ci, chunk) {
    this.scene.remove(chunk);
    chunk.traverse((o) => o.geometry && !this.sharedGeos.has(o.geometry) && o.geometry.dispose());
    this.chunks.delete(ci);
  }

  update(time, pulse) {
    this.uTime.value = time;
    this.uWind.value = 0.25 + pulse * 0.6;
  }

  // night/weather look applied to materials shared across chunks
  applyEnvLook(env) {
    this.uSnowGround.value = env.snowCover * 0.85;
    this.uSnowRoad.value = env.snowCover * 0.45;
    this.uFlowerSnow.value = env.snowCover;
    const bright = (0.35 + 0.65 * (1 - env.night)) * (1 - env.skyDim * 0.4);
    this.uFlowerLight.value.setRGB(bright, bright, bright * (1 + env.night * 0.25));
    this.lineMat.color.copy(this.lineColorDay).lerp(this.lineColorNight, env.night * 0.8);
    this.lampMat.color.copy(this.lampOff).lerp(this.lampOn, Math.min(1, env.night * 1.4 + env.skyDim * 0.3));
    this.buildingMat.emissiveIntensity = env.night * 1.25 + env.skyDim * 0.15;
    this.puddleMat.opacity = env.wetness * 0.62;
    this.puddleMat.color.copy(env.horizon).lerp(env.zenith, 0.4);
    this.driftMat.opacity = env.snowCover;
  }

  // ---- chunk construction -------------------------------------------------

  _ribbon(i0, i1, offsets, heightFn, colorFn, flat) {
    const rows = i1 - i0 + 1;
    const cols = offsets.length;
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    for (let r = 0; r < rows; r++) {
      const st = this.stations[i0 + r];
      const rx = Math.cos(st.theta);
      const rz = Math.sin(st.theta);
      for (let c = 0; c < cols; c++) {
        const d = offsets[c];
        const k = (r * cols + c) * 3;
        const h = heightFn(st.s, d);
        pos[k] = st.x + rx * d;
        pos[k + 1] = h;
        pos[k + 2] = st.z + rz * d;
        const cc = colorFn(st.s, d, h);
        col[k] = cc.r;
        col[k + 1] = cc.g;
        col[k + 2] = cc.b;
      }
    }
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        // columns must ascend in d so these triangles face up (+Y)
        idx.push(a, b, d, b, e, d);
      }
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    if (flat) geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    return geo;
  }

  _buildChunk(ci) {
    const i0 = ci * CHUNK_STATIONS;
    const i1 = i0 + CHUNK_STATIONS;
    this.ensureStations(i1 + 2);
    const wMid = this.env.weightsAt(((i0 + i1) / 2) * DS);

    const group = new THREE.Group();

    // road surface
    const roadGeo = this._ribbon(i0, i1, [-ROAD_HALF, 0, ROAD_HALF], (s) => this.roadYAt(s) + 0.02, roadColor, false);
    group.add(new THREE.Mesh(roadGeo, this.roadMat));

    // ground on both sides (faceted for the low-poly look); past 300 m the
    // hills ease down into a distant valley so the outer edge sits below the
    // horizon without ever forming a cliff wall
    const hFn = (s, d) => {
      const ad = Math.abs(d);
      const w = this.env.weightsAt(s);
      if (ad <= 300) return this.terrainH(s, d, w);
      const edge = this.terrainH(s, Math.sign(d) * 300, w);
      const k = smoothstep(300, 540, ad);
      return edge * (1 - k) + (this.roadYAt(s) - 45) * k;
    };
    const cFn = (s, d, h) => this.groundColor(s, d, h, this.env.weightsAt(s));
    for (const sign of [-1, 1]) {
      const offsets = this.groundOffsets.map((d) => d * sign).sort((a, b) => a - b);
      const geo = this._ribbon(i0, i1, offsets, hFn, cFn, true);
      group.add(new THREE.Mesh(geo, this.groundMat));
    }

    // edge lines
    for (const sign of [-1, 1]) {
      const d = 4.12 * sign;
      const geo = this._ribbon(i0, i1, [d - 0.08, d + 0.08], (s) => this.roadYAt(s) + 0.045, () => _col.set(0xffe5b8), false);
      group.add(new THREE.Mesh(geo, this.lineMat));
    }

    // center dashes
    group.add(new THREE.Mesh(this._dashes(i0, i1), this.lineMat));

    // flowers
    for (let ti = 0; ti < this.flowerMats.length; ti++) {
      const im = this._flowers(i0, i1, ti, ci);
      if (im) group.add(im);
    }

    // trees, cacti, rocks, poles, buildings — mixed by landscape weights
    group.add(this._props(i0, i1, ci, wMid));

    // weather dressing: puddles on the asphalt, drifts at the road edges
    group.add(this._puddles(i0, i1, ci));
    group.add(this._drifts(i0, i1, ci));

    this.scene.add(group);
    this.chunks.set(ci, group);
  }

  _dashes(i0, i1) {
    const pos = [];
    const idx = [];
    for (let i = i0; i < i1; i += 4) {
      const s0 = i * DS;
      const fA = this.getFrame(s0);
      const fB = this.getFrame(s0 + 2.0);
      const base = pos.length / 3;
      const w = 0.16;
      pos.push(
        fA.x - fA.rightX * w, fA.y + 0.05, fA.z - fA.rightZ * w,
        fA.x + fA.rightX * w, fA.y + 0.05, fA.z + fA.rightZ * w,
        fB.x - fB.rightX * w, fB.y + 0.05, fB.z - fB.rightZ * w,
        fB.x + fB.rightX * w, fB.y + 0.05, fB.z + fB.rightZ * w
      );
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    return geo;
  }

  _flowers(i0, i1, ti, ci) {
    const COUNT = 260;
    const dummy = new THREE.Object3D();
    const mats = [];
    for (let k = 0; k < COUNT; k++) {
      const r1 = hash2(ci * 7.13 + ti * 3.7, k * 1.37);
      const r2 = hash2(ci * 2.71 + ti * 9.1, k * 5.91);
      const r3 = hash2(ci * 5.39 + ti * 1.3, k * 3.17);
      const r4 = hash2(ci * 8.17 + ti * 6.7, k * 7.77);
      const s = (i0 + r1 * (i1 - i0)) * DS;
      const w = this.env.weightsAt(s);
      let dens = 0;
      for (let i = 0; i < 5; i++) dens += w[i] * FLOWER_DENS[i];
      if (r4 > dens) continue;
      const side = r2 < 0.5 ? -1 : 1;
      const d = side * (6.2 + Math.pow(r3, 1.7) * 88);
      const f = this.getFrame(s);
      const x = f.x + f.rightX * d;
      const z = f.z + f.rightZ * d;
      const y = this.terrainH(s, d, w);
      let sc = 0.42 + r4 * 0.5;
      sc *= 1 + smoothstep(30, 90, Math.abs(d)) * 0.65; // bigger far out, keeps density feel
      dummy.position.set(x, y - 0.04, z);
      dummy.scale.setScalar(sc);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mats.push(dummy.matrix.clone());
    }
    if (!mats.length) return null;
    const im = new THREE.InstancedMesh(this.flowerGeo, this.flowerMats[ti], mats.length);
    for (let k = 0; k < mats.length; k++) im.setMatrixAt(k, mats[k]);
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    return im;
  }

  _scatter(proto, material, count, ci, salt, place) {
    if (count <= 0) return null;
    const im = new THREE.InstancedMesh(proto, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let k = 0; k < count; k++) {
      const r1 = hash2(ci * 4.91 + salt, k * 2.39);
      const r2 = hash2(ci * 6.53 + salt, k * 8.11);
      const r3 = hash2(ci * 1.97 + salt, k * 4.73);
      if (place(dummy, r1, r2, r3, k) === false) continue;
      dummy.updateMatrix();
      im.setMatrixAt(n++, dummy.matrix);
    }
    if (!n) return null;
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    return im;
  }

  _puddles(i0, i1, ci) {
    return this._scatter(this.puddleGeo, this.puddleMat, 6, ci, 77.7, (dummy, r1, r2, r3) => {
      const s = (i0 + r1 * (i1 - i0)) * DS;
      const d = (r2 - 0.5) * 2 * 5.6;
      const f = this.getFrame(s);
      dummy.position.set(f.x + f.rightX * d, this.roadYAt(s) + 0.055, f.z + f.rightZ * d);
      dummy.rotation.set(0, r3 * Math.PI, 0);
      dummy.scale.set(0.8 + r3 * 1.3, 1, 0.5 + r2 * 0.7);
    });
  }

  _drifts(i0, i1, ci) {
    return this._scatter(this.driftGeo, this.driftMat, 9, ci, 99.1, (dummy, r1, r2, r3) => {
      const s = (i0 + r1 * (i1 - i0)) * DS;
      const side = r2 < 0.5 ? -1 : 1;
      const d = side * (5.7 + r3 * 3.2);
      const f = this.getFrame(s);
      const w = this.env.weightsAt(s);
      dummy.position.set(f.x + f.rightX * d, this.terrainH(s, d, w) - 0.25, f.z + f.rightZ * d);
      dummy.rotation.set(0, r3 * Math.PI * 2, 0);
      dummy.scale.set(1.3 + r1 * 2.2, 1 + r2 * 1.4, 1.1 + r3 * 1.8);
    });
  }

  _props(i0, i1, ci, w) {
    const group = new THREE.Group();
    const sOf = (r) => (i0 + r * (i1 - i0)) * DS;
    const wAt = (s) => this.env.weightsAt(s);

    // trees: fields, outskirts and (mostly conifers) highlands
    const treeAmt = w[0] + w[3] * 0.8 + w[1] * 1.1;
    const TREES = Math.round(7 * treeAmt);
    const coniferShare = w[1] > 0.4 ? 0.75 : 0.5;
    const nConifer = Math.round(TREES * coniferShare);
    for (const [proto, salt, n] of [[this.treeProtoA, 0, nConifer], [this.treeProtoB, 17.3, TREES - nConifer]]) {
      const im = this._scatter(proto, this.propMat, n, ci, salt, (dummy, r1, r2, r3) => {
        const s = sOf(r1);
        const d = (r2 < 0.5 ? -1 : 1) * (26 + r3 * 130);
        const f = this.getFrame(s);
        dummy.position.set(f.x + f.rightX * d, this.terrainH(s, d, wAt(s)) - 0.1, f.z + f.rightZ * d);
        dummy.rotation.set(0, r2 * Math.PI * 2, 0);
        dummy.scale.setScalar(2.4 + r3 * 2.2);
      });
      if (im) group.add(im);
    }

    // desert: cacti and rocks (rocks also in the highlands)
    const cacti = this._scatter(this.cactusProto, this.propMat, Math.round(6 * w[2]), ci, 31.7, (dummy, r1, r2, r3) => {
      const s = sOf(r1);
      const d = (r2 < 0.5 ? -1 : 1) * (14 + r3 * 110);
      const f = this.getFrame(s);
      dummy.position.set(f.x + f.rightX * d, this.terrainH(s, d, wAt(s)) - 0.15, f.z + f.rightZ * d);
      dummy.rotation.set(0, r2 * Math.PI * 2, 0);
      dummy.scale.setScalar(1.1 + r3 * 1.6);
    });
    if (cacti) group.add(cacti);
    const rocks = this._scatter(this.rockProto, this.propMat, Math.round(5 * (w[2] + w[1] * 0.9)), ci, 47.1, (dummy, r1, r2, r3) => {
      const s = sOf(r1);
      const d = (r2 < 0.5 ? -1 : 1) * (10 + r3 * 120);
      const f = this.getFrame(s);
      dummy.position.set(f.x + f.rightX * d, this.terrainH(s, d, wAt(s)) - 0.3, f.z + f.rightZ * d);
      dummy.rotation.set(0, r2 * Math.PI * 2, 0);
      dummy.scale.setScalar(1 + r3 * 3.2);
    });
    if (rocks) group.add(rocks);

    // downtown: glass towers on both sides
    const B = Math.round(18 * w[4]);
    if (B > 0) {
      const im = new THREE.InstancedMesh(this.buildingGeo, this.buildingMat, B);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let k = 0; k < B; k++) {
        const r1 = hash2(ci * 3.77 + 61.3, k * 2.93);
        const r2 = hash2(ci * 9.31 + 61.3, k * 6.17);
        const r3 = hash2(ci * 7.07 + 61.3, k * 1.91);
        const r4 = hash2(ci * 2.39 + 61.3, k * 9.43);
        const s = sOf(r1);
        const side = r2 < 0.5 ? -1 : 1;
        const d = side * (14 + Math.pow(r3, 1.4) * 62);
        const f = this.getFrame(s);
        const h = 12 + Math.pow(r4, 1.5) * 80;
        // sunk a couple of meters so corners never float off sloped ground
        dummy.position.set(f.x + f.rightX * d, this.terrainH(s, d, wAt(s)) - 2.2, f.z + f.rightZ * d);
        dummy.rotation.set(0, f.theta + (r4 - 0.5) * 0.15, 0);
        dummy.scale.set(6 + r2 * 8, h, 6 + r3 * 8);
        dummy.updateMatrix();
        im.setMatrixAt(n, dummy.matrix);
        _tmp.copy(TOWER_COLORS[Math.floor(r4 * TOWER_COLORS.length) % TOWER_COLORS.length]);
        _tmp.offsetHSL(0, 0, (r1 - 0.5) * 0.07);
        im.setColorAt(n, _tmp);
        n++;
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      group.add(im);
    }

    // roadside verticals: telephone poles in the country, streetlights downtown
    const POLES = Math.floor(CHUNK_STATIONS / 14);
    const city = w[4] > 0.5;
    const proto = city ? this.lampProto : this.poleProto;
    const imP = new THREE.InstancedMesh(proto, this.propMat, POLES);
    const glows = city ? new THREE.InstancedMesh(this.lampGlowGeo, this.lampMat, POLES) : null;
    const dummy = new THREE.Object3D();
    for (let k = 0; k < POLES; k++) {
      const s = (i0 + k * 14 + 6) * DS;
      const f = this.getFrame(s);
      const d = city ? -7.2 : -8.4;
      const y = this.terrainH(s, d, wAt(s)) - 0.2;
      dummy.position.set(f.x + f.rightX * d, y, f.z + f.rightZ * d);
      dummy.rotation.set(0, f.theta, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      imP.setMatrixAt(k, dummy.matrix);
      if (glows) {
        // lamp head hangs 1.5 m toward the road (proto arm points local +X = world right)
        dummy.position.set(f.x + f.rightX * (d + 1.5), y + 5.2, f.z + f.rightZ * (d + 1.5));
        dummy.updateMatrix();
        glows.setMatrixAt(k, dummy.matrix);
      }
    }
    imP.instanceMatrix.needsUpdate = true;
    imP.frustumCulled = false;
    group.add(imP);
    if (glows) {
      glows.instanceMatrix.needsUpdate = true;
      glows.frustumCulled = false;
      group.add(glows);
    }

    return group;
  }
}
