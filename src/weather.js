// Precipitation and lightning. Rain and snow are point clouds recycled in a
// box around the camera; lightning is a brief white directional flash whose
// strikes prefer the beat and trigger thunder in the music engine.
import * as THREE from 'three';
import { rainStreakCanvas, snowflakeCanvas } from './assets.js';

const RAIN_N = 1300;
const SNOW_N = 900;
const BOX = { x: 56, y: 30, z: 70 };

function makePoints(count, canvas, size, opacity, color) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * BOX.x;
    pos[i * 3 + 1] = Math.random() * BOX.y;
    pos[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(canvas),
    size,
    transparent: true,
    opacity,
    depthWrite: false,
    color,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  return { points, geo, mat, seed };
}

function wrapInto(pp, k, camera) {
  let wx = pp[k] - (camera.position.x - BOX.x / 2);
  let wy = pp[k + 1] - (camera.position.y - 6);
  let wz = pp[k + 2] - (camera.position.z - BOX.z / 2);
  wx = ((wx % BOX.x) + BOX.x) % BOX.x;
  wy = ((wy % BOX.y) + BOX.y) % BOX.y;
  wz = ((wz % BOX.z) + BOX.z) % BOX.z;
  pp[k] = camera.position.x - BOX.x / 2 + wx;
  pp[k + 1] = camera.position.y - 6 + wy;
  pp[k + 2] = camera.position.z - BOX.z / 2 + wz;
}

export function makeWeatherFX(scene) {
  const rain = makePoints(RAIN_N, rainStreakCanvas(), 0.85, 0.5, 0x9fb4cc);
  const snow = makePoints(SNOW_N, snowflakeCanvas(), 0.22, 0.85, 0xffffff);
  scene.add(rain.points, snow.points);

  const bolt = new THREE.DirectionalLight(0xdfe8ff, 0);
  bolt.position.set(60, 300, -80);
  scene.add(bolt);

  let flash = 0;

  function update(dt, env, camera, time, pulse, onThunder) {
    // rain
    rain.points.visible = env.rain > 0.02;
    if (rain.points.visible) {
      rain.mat.opacity = Math.min(1, env.rain) * 0.55;
      const pp = rain.geo.attributes.position.array;
      for (let i = 0; i < RAIN_N; i++) {
        const k = i * 3;
        pp[k + 1] -= dt * (30 + rain.seed[i] * 14);
        pp[k] += dt * 2.5;
        wrapInto(pp, k, camera);
      }
      rain.geo.attributes.position.needsUpdate = true;
    }

    // snow
    snow.points.visible = env.snow > 0.02;
    if (snow.points.visible) {
      snow.mat.opacity = Math.min(1, env.snow) * 0.9;
      const pp = snow.geo.attributes.position.array;
      for (let i = 0; i < SNOW_N; i++) {
        const k = i * 3;
        pp[k + 1] -= dt * (1.3 + snow.seed[i] * 1.4);
        pp[k] += Math.sin(time * 0.8 + snow.seed[i] * 40) * dt * 1.2;
        pp[k + 2] += dt * 0.8;
        wrapInto(pp, k, camera);
      }
      snow.geo.attributes.position.needsUpdate = true;
    }

    // lightning: strikes prefer the beat
    if (env.storm > 0.45 && Math.random() < dt * (0.12 + pulse * 0.35)) {
      flash = 0.7 + Math.random() * 0.5;
      if (onThunder) onThunder(0.4 + Math.random() * 1.8);
    }
    flash *= Math.exp(-dt * 7);
    if (flash < 0.003) flash = 0;
    bolt.intensity = flash * 4;

    return flash;
  }

  return { update };
}
