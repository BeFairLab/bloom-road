// Central environment state: time of day, weather, landscape and cruise speed.
// Everything drifts smoothly on its own; the radio sets targets and the state
// eases toward them. Auto weather changes land on chord boundaries so the
// world breathes with the music; landscapes change as "stations" down the road.
import * as THREE from 'three';

export const TIME_NAMES = ['DAWN', 'DAY', 'DUSK', 'NIGHT'];
export const WEATHER_NAMES = ['CLEAR', 'CLOUDS', 'FOG', 'RAIN', 'SNOW', 'STORM'];
export const LAND_NAMES = ['FIELDS', 'HIGHLANDS', 'DESERT', 'SKYLINE', 'DOWNTOWN'];
export const STATION_FREQS = ['88.1', '92.5', '96.8', '101.3', '105.9'];

export const SPEED_LEVELS = [
  { v: 9, bpm: 66, label: '40' },
  { v: 16, bpm: 78, label: '70' },
  { v: 25, bpm: 90, label: '110' },
  { v: 36, bpm: 104, label: '150' },
];

const DAY_LEN = 540;        // seconds for a full day/night cycle in auto mode
const LAND_TRANS = 420;     // meters to crossfade between landscapes
const LAND_AHEAD_AUTO = 900; // auto changes appear beyond the build horizon
const LAND_AHEAD_MANUAL = 150;
const WX_TAU_AUTO = 30;     // seconds for a weather crossfade when it drifts on its own
const WX_TAU_MANUAL = 12;   // a touch quicker when picked on the radio, still gentle

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// keyframes at t = 0 (dawn), .25 (day), .5 (sunset), .75 (night)
const TIME_KEYS = [
  {
    zenith: '#56608f', mid: '#e89a7e', horizon: '#ffc4a3', below: '#5d4a4a',
    fog: '#edb79c', sun: '#ffdcb8', sunI: 2.0, sunAmt: 0.8,
    dir: new THREE.Vector3(0.42, 0.10, -0.90).normalize(),
    hemiSky: '#ffd2c2', hemiGround: '#7c6a5e', hemiI: 0.85,
    exposure: 0.95, stars: 0.18, cloud: '#ffd3c8',
  },
  {
    zenith: '#3a6cc8', mid: '#8fb8e8', horizon: '#dceef0', below: '#74806e',
    fog: '#d7e7ea', sun: '#fff2d8', sunI: 2.9, sunAmt: 0.85,
    dir: new THREE.Vector3(0.05, 0.62, -0.79).normalize(),
    hemiSky: '#cfe4ff', hemiGround: '#8f9a6f', hemiI: 1.0,
    exposure: 1.02, stars: 0, cloud: '#ffffff',
  },
  {
    zenith: '#5975b0', mid: '#ffad6b', horizon: '#ff9457', below: '#6b4233',
    fog: '#ffb37e', sun: '#ffc27d', sunI: 2.6, sunAmt: 1.0,
    dir: new THREE.Vector3(-0.07, 0.12, -0.99).normalize(),
    hemiSky: '#ffd9b3', hemiGround: '#8a7a4f', hemiI: 0.95,
    exposure: 1.0, stars: 0, cloud: '#ffe8d2',
  },
  {
    zenith: '#070b1c', mid: '#101a36', horizon: '#23304f', below: '#05070e',
    fog: '#141c30', sun: '#c3d3ff', sunI: 0.5, sunAmt: 0.35,
    dir: new THREE.Vector3(0.40, 0.45, -0.80).normalize(),
    hemiSky: '#2a3a66', hemiGround: '#11141f', hemiI: 0.5,
    exposure: 0.86, stars: 1, cloud: '#2b3552',
  },
].map((k) => ({
  ...k,
  zenith: new THREE.Color(k.zenith), mid: new THREE.Color(k.mid),
  horizon: new THREE.Color(k.horizon), below: new THREE.Color(k.below),
  fog: new THREE.Color(k.fog), sun: new THREE.Color(k.sun),
  hemiSky: new THREE.Color(k.hemiSky), hemiGround: new THREE.Color(k.hemiGround),
  cloud: new THREE.Color(k.cloud),
}));

// per-weather: fog range, sky dimming, light multiplier, gray haze tint
const WX = [
  { near: 130, far: 1050, dim: 0.0, light: 1.0, gray: 0.0, tint: '#ffffff', wind: 0.0 },
  { near: 115, far: 880, dim: 0.16, light: 0.85, gray: 0.12, tint: '#aeb4ba', wind: 0.1 },
  { near: 16, far: 230, dim: 0.30, light: 0.70, gray: 0.55, tint: '#aeb4ba', wind: 0.15 },
  { near: 85, far: 600, dim: 0.34, light: 0.60, gray: 0.30, tint: '#8e96a4', wind: 0.5 },
  { near: 55, far: 460, dim: 0.22, light: 0.75, gray: 0.55, tint: '#c9cdd6', wind: 0.35 },
  { near: 70, far: 520, dim: 0.58, light: 0.45, gray: 0.50, tint: '#6f7484', wind: 1.0 },
].map((w) => ({ ...w, tint: new THREE.Color(w.tint) }));

const WX_PICK_WEIGHTS = [0.30, 0.22, 0.12, 0.16, 0.08, 0.12];

const _c1 = new THREE.Color();

export class Environment {
  constructor() {
    this.t = 0.52;                 // start just past sunset key — the classic look
    this.timeTarget = null;        // manual target, null = auto
    this.autoTime = true;

    this.wx = [1, 0, 0, 0, 0, 0];  // smoothed weather weights
    this.wxTargetIdx = 0;
    this.autoWeather = true;
    this.wxTimer = 60 + Math.random() * 90;
    this.wxTau = WX_TAU_AUTO;

    this.landKfs = [{ s: -1e9, idx: 0 }];
    this.autoLand = true;
    this.nextLandS = 1400 + Math.random() * 600;

    this.speedIdx = 1;
    this.snowCover = 0;
    this.wetness = 0;
    this.lastChord = -1;
    this.lastCarS = 0;

    this.out = {
      zenith: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color(),
      below: new THREE.Color(), fogColor: new THREE.Color(), sunColor: new THREE.Color(),
      hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), cloudTint: new THREE.Color(),
      skylineTint: new THREE.Color(),
      sunDir: new THREE.Vector3(0, 0.2, -1),
      sunI: 2.6, sunAmt: 1, hemiI: 0.95, exposure: 1, stars: 0, night: 0,
      skyDim: 0, lightMul: 1, fogNear: 130, fogFar: 1050,
      rain: 0, snow: 0, snowCover: 0, wetness: 0, storm: 0, fogW: 0, clear: 1,
      cloudOpacity: 0.5, cloudDark: 0, overcast: 0,
      wind: 0, skylineAmt: 0, needle01: 0,
      landWeights: [1, 0, 0, 0, 0], domLand: 0,
      timeIdx: 2,
    };
  }

  // ---- radio controls ------------------------------------------------------

  setTime(idx) {
    if (idx === 'auto') { this.autoTime = true; this.timeTarget = null; return; }
    this.autoTime = false;
    this.timeTarget = [0.02, 0.27, 0.52, 0.77][idx];
  }

  setWeather(idx) {
    if (idx === 'auto') { this.autoWeather = true; this.wxTimer = 60 + Math.random() * 120; return; }
    this.autoWeather = false;
    this.wxTargetIdx = idx;
    this.wxTau = WX_TAU_MANUAL;
  }

  // returns arc length where the new landscape begins (for chunk invalidation)
  setLandscape(idx) {
    if (idx === 'auto') { this.autoLand = true; this.nextLandS = this.lastCarS + 1000 + Math.random() * 600; return null; }
    this.autoLand = false;
    const s = this.lastCarS + LAND_AHEAD_MANUAL;
    this._pushLandKf(s, idx);
    return s;
  }

  setSpeed(idx) { this.speedIdx = idx; }

  _pushLandKf(s, idx) {
    if (this.landKfs[this.landKfs.length - 1].idx === idx) return;
    // drop keyframes the new one would override
    while (this.landKfs.length > 1 && this.landKfs[this.landKfs.length - 1].s >= s) this.landKfs.pop();
    this.landKfs.push({ s, idx });
    if (this.landKfs.length > 7) this.landKfs.splice(0, this.landKfs.length - 7);
  }

  // ---- landscape weights along the road -----------------------------------

  weightsAt(s) {
    const w = [0, 0, 0, 0, 0];
    w[this.landKfs[0].idx] = 1;
    for (let i = 1; i < this.landKfs.length; i++) {
      const kf = this.landKfs[i];
      const a = smoothstep(kf.s, kf.s + LAND_TRANS, s);
      if (a <= 0) break;
      for (let j = 0; j < 5; j++) w[j] *= 1 - a;
      w[kf.idx] += a;
    }
    return w;
  }

  // ---- per-frame update ----------------------------------------------------

  update(dt, carS, music) {
    this.lastCarS = carS;
    const o = this.out;

    // chord boundary flag — auto changes snap to the music
    let chordChanged = false;
    if (music) {
      const chord = Math.floor(music.beatCount / 8);
      chordChanged = chord !== this.lastChord;
      this.lastChord = chord;
    }

    // time of day
    if (this.timeTarget !== null) {
      let diff = this.timeTarget - this.t;
      diff -= Math.round(diff); // shortest way around the circle
      const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.05);
      this.t += step;
      if (Math.abs(diff) < 0.002) { this.t = this.timeTarget; this.timeTarget = null; }
    } else if (this.autoTime) {
      this.t += dt / DAY_LEN;
    }
    this.t = ((this.t % 1) + 1) % 1;

    // auto weather: countdown, then change on a chord boundary
    if (this.autoWeather) {
      this.wxTimer -= dt;
      if (this.wxTimer <= 0 && (chordChanged || !music)) {
        let pick = this.wxTargetIdx;
        while (pick === this.wxTargetIdx) {
          const r = Math.random();
          let acc = 0;
          for (let i = 0; i < 6; i++) { acc += WX_PICK_WEIGHTS[i]; if (r < acc) { pick = i; break; } }
        }
        this.wxTargetIdx = pick;
        this.wxTimer = 150 + Math.random() * 150; // a new sky every 2.5–5 minutes
        this.wxTau = WX_TAU_AUTO;
      }
    }
    const k = 1 - Math.exp(-dt / this.wxTau); // long, patient crossfade
    let wsum = 0;
    for (let i = 0; i < 6; i++) {
      this.wx[i] += ((i === this.wxTargetIdx ? 1 : 0) - this.wx[i]) * k;
      wsum += this.wx[i];
    }
    for (let i = 0; i < 6; i++) this.wx[i] /= wsum;

    // auto landscape: schedule the next "station" beyond the build horizon
    if (this.autoLand && carS > this.nextLandS - LAND_AHEAD_AUTO) {
      const cur = this.landKfs[this.landKfs.length - 1].idx;
      let pick = cur;
      while (pick === cur) pick = Math.floor(Math.random() * 5);
      this._pushLandKf(this.nextLandS, pick);
      this.nextLandS += 1800 + Math.random() * 900; // a couple of minutes per country
    }

    // snow cover and road wetness creep in and fade slowly
    const snowAmt = this.wx[4];
    this.snowCover = THREE.MathUtils.clamp(
      this.snowCover + (snowAmt > 0.45 ? dt * 0.028 : -dt * 0.018), 0, 1);
    const rainAmt = this.wx[3] + this.wx[5];
    this.wetness = THREE.MathUtils.clamp(
      this.wetness + (rainAmt > 0.45 ? dt * 0.05 : -dt * 0.015), 0, 1);

    // ---- blend time-of-day keyframes ----
    const seg = this.t * 4;
    const i0 = Math.floor(seg) % 4;
    const i1 = (i0 + 1) % 4;
    const f = smoothstep(0, 1, seg - Math.floor(seg));
    const A = TIME_KEYS[i0];
    const B = TIME_KEYS[i1];

    o.zenith.copy(A.zenith).lerp(B.zenith, f);
    o.mid.copy(A.mid).lerp(B.mid, f);
    o.horizon.copy(A.horizon).lerp(B.horizon, f);
    o.below.copy(A.below).lerp(B.below, f);
    o.fogColor.copy(A.fog).lerp(B.fog, f);
    o.sunColor.copy(A.sun).lerp(B.sun, f);
    o.hemiSky.copy(A.hemiSky).lerp(B.hemiSky, f);
    o.hemiGround.copy(A.hemiGround).lerp(B.hemiGround, f);
    o.cloudTint.copy(A.cloud).lerp(B.cloud, f);
    o.sunDir.copy(A.dir).lerp(B.dir, f).normalize();
    o.sunI = THREE.MathUtils.lerp(A.sunI, B.sunI, f);
    o.sunAmt = THREE.MathUtils.lerp(A.sunAmt, B.sunAmt, f);
    o.hemiI = THREE.MathUtils.lerp(A.hemiI, B.hemiI, f);
    o.exposure = THREE.MathUtils.lerp(A.exposure, B.exposure, f);
    o.stars = THREE.MathUtils.lerp(A.stars, B.stars, f);
    o.night = (i0 === 3 ? 1 - f : 0) + (i1 === 3 ? f : 0);
    o.timeIdx = f < 0.5 ? i0 : i1;

    // ---- weather overlays ----
    let near = 0; let far = 0; let dim = 0; let light = 0; let gray = 0; let wind = 0;
    _c1.setRGB(0, 0, 0);
    for (let i = 0; i < 6; i++) {
      const w = this.wx[i];
      const W = WX[i];
      near += W.near * w; far += W.far * w; dim += W.dim * w;
      light += W.light * w; gray += W.gray * w; wind += W.wind * w;
      _c1.r += W.tint.r * w * W.gray; _c1.g += W.tint.g * w * W.gray; _c1.b += W.tint.b * w * W.gray;
    }
    if (gray > 0.001) _c1.multiplyScalar(1 / gray);
    o.fogNear = near;
    o.fogFar = far * (1 - 0.18 * o.night);
    o.skyDim = dim;
    o.lightMul = light;
    o.wind = wind;
    o.fogColor.lerp(_c1, gray * (1 - o.night * 0.55));
    o.rain = this.wx[3] + this.wx[5];
    o.snow = this.wx[4];
    o.storm = this.wx[5];
    o.fogW = this.wx[2];
    o.clear = this.wx[0];
    o.snowCover = this.snowCover;
    o.wetness = this.wetness;
    o.cloudOpacity = Math.min(1, 0.22 + this.wx[1] * 0.7 + this.wx[5] * 0.85 + this.wx[3] * 0.5 + this.wx[4] * 0.4);
    o.cloudDark = this.wx[5] * 0.7 + this.wx[3] * 0.3 + this.wx[4] * 0.15;
    o.overcast = Math.min(1, this.wx[1] * 0.7 + this.wx[2] * 0.3 + this.wx[3] * 0.85 + this.wx[4] * 0.55 + this.wx[5] * 0.95);

    // ---- landscape ----
    const lw = this.weightsAt(carS);
    o.landWeights = lw;
    let dom = 0;
    for (let i = 1; i < 5; i++) if (lw[i] > lw[dom]) dom = i;
    o.domLand = dom;
    o.skylineAmt = lw[3] + lw[4] * 0.75;
    o.needle01 = lw[0] * 0.08 + lw[1] * 0.29 + lw[2] * 0.5 + lw[3] * 0.71 + lw[4] * 0.92;
    o.skylineTint.copy(o.horizon).lerp(o.below, 0.62);

    return o;
  }
}
