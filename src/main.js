// Bloom Road — a meditative drive through changing country, weather and time.
import * as THREE from 'three';
import { World, ROAD_HALF } from './world.js';
import { makeSky, makeClouds, makeSkyline } from './sky.js';
import { makePost } from './post.js';
import { makeCar } from './car.js';
import { MusicEngine } from './audio.js';
import { loadGameTextures, softDotCanvas } from './assets.js';
import { Environment, SPEED_LEVELS } from './environment.js';
import { makeWeatherFX } from './weather.js';
import { makeRadio } from './radio.js';
import { Traffic } from './traffic.js';

async function init() {
  const app = document.getElementById('app');

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  app.appendChild(renderer.domElement);

  const env = new Environment();
  const envOut = env.out;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(envOut.fogColor.getHex(), 130, 1050);
  scene.background = new THREE.Color().copy(envOut.fogColor);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 7000);

  // lights — the sun (or moon) plus soft sky fill, all driven by the environment
  const sun = new THREE.DirectionalLight(0xffc27d, 2.6);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xffd9b3, 0x8a7a4f, 0.95);
  scene.add(hemi);
  const backfill = new THREE.DirectionalLight(0xa8b8ff, 0.35);
  backfill.position.set(120, 80, 200);
  scene.add(backfill);

  const textures = await loadGameTextures();

  const sky = makeSky();
  scene.add(sky);
  const clouds = makeClouds(textures.cloud);
  scene.add(clouds);
  const skyline = makeSkyline();
  scene.add(skyline);

  const world = new World(scene, textures.flowers, env);
  world.ensure(0, Infinity);

  const car = makeCar();
  scene.add(car.group);

  const traffic = new Traffic(scene, world, env);
  const weatherFX = makeWeatherFX(scene);

  // floating pollen / petals around the camera
  const PETALS = 240;
  const petalPos = new Float32Array(PETALS * 3);
  const petalSeed = new Float32Array(PETALS);
  for (let i = 0; i < PETALS; i++) {
    petalPos[i * 3] = (Math.random() - 0.5) * 50;
    petalPos[i * 3 + 1] = Math.random() * 14;
    petalPos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    petalSeed[i] = Math.random() * 100;
  }
  const petalGeo = new THREE.BufferGeometry();
  petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  const petalMat = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(softDotCanvas()),
    size: 0.16,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    color: 0xffe2b0,
    sizeAttenuation: true,
  });
  const petals = new THREE.Points(petalGeo, petalMat);
  petals.frustumCulled = false;
  scene.add(petals);

  const post = makePost(renderer, scene, camera);

  // ---- state ----
  let music = null;
  let driving = false;
  let carS = 40; // leave some road behind the chase camera
  let lateral = 2.1;
  let lateralTarget = 2.1;
  let steerInput = 0;
  let speed = 0;
  let flash = 0;
  let sceneTimer = 0;
  let radioTimer = 0;
  let overtake = { phase: null, t: 0, blink: null, target: null };
  const clock = new THREE.Clock();

  const camPos = new THREE.Vector3(0, 4, 12);
  const camLook = new THREE.Vector3();

  // ---- the radio ----
  const radio = makeRadio({
    onLandscape: (idx) => {
      const sKf = env.setLandscape(idx);
      if (sKf !== null && sKf !== undefined) world.invalidateBeyond(sKf);
      if (idx !== 'auto' && music) music.tuneFx();
    },
    onWeather: (idx) => env.setWeather(idx),
    onTime: (idx) => env.setTime(idx),
    onSpeed: (idx) => env.setSpeed(idx),
    onTrack: (v) => {
      if (!music) return;
      if (v === 'auto') music.setTrack('auto');
      else music.setTrack((music.pendingTrack !== null ? music.pendingTrack : music.trackIdx) + v);
    },
    onVolume: (v) => music && music.setVolume(v),
    onToggleMute: () => music && music.toggleMute(),
    onClickSound: () => music && music.uiClick(),
    getPulse: () => (music ? music.getPulse() : 0.15),
  });

  // ---- input ----
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyM' && music) music.toggleMute();
    if (e.code === 'KeyR' && driving) radio.toggle();
  });
  window.addEventListener('keyup', (e) => (keys[e.code] = false));

  let dragging = false;
  let dragX = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragX = e.clientX;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    lateralTarget += (e.clientX - dragX) * 0.012;
    dragX = e.clientX;
  });
  window.addEventListener('pointerup', () => (dragging = false));

  // ---- title flow ----
  const title = document.getElementById('title');
  const hint = document.getElementById('hint');
  document.getElementById('start').addEventListener('click', () => {
    music = new MusicEngine();
    music.start();
    driving = true;
    title.classList.add('hidden');
    hint.classList.add('show');
    radio.show();
    setTimeout(() => hint.classList.remove('show'), 9000);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.composer.setSize(window.innerWidth, window.innerHeight);
  });

  window.__debug = {
    scene, camera, world, car, env, traffic,
    get carS() { return carS; },
    get lateral() { return lateral; },
    get overtake() { return overtake; },
    get music() { return music; },
    get speed() { return speed; },
    get steerInput() { return steerInput; },
    get dragging() { return dragging; },
    get driving() { return driving; },
  };

  // ---- main loop ----
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // ---- environment drives everything ----
    env.update(dt, carS, music);

    // speed follows the cruise knob; breathes a little while driving
    const cruise = SPEED_LEVELS[env.speedIdx].v;
    const targetSpeed = driving ? cruise * (1 + Math.sin(t * 0.05) * 0.08) : 0;
    speed = THREE.MathUtils.lerp(speed, targetSpeed, 1 - Math.exp(-dt * 0.5));
    carS += speed * dt;

    // steering
    steerInput = (keys['ArrowRight'] || keys['KeyD'] ? 1 : 0) - (keys['ArrowLeft'] || keys['KeyA'] ? 1 : 0);
    lateralTarget = THREE.MathUtils.clamp(lateralTarget + steerInput * 5.2 * dt, -(ROAD_HALF - 1.5), ROAD_HALF - 1.5);

    // auto-overtake: when cruising up on a slower car, signal, swing out,
    // pass and come back — manual steering always takes over instantly
    const manual = steerInput !== 0 || dragging;
    if (manual && overtake.phase) { overtake.phase = null; overtake.blink = null; }
    if (driving && !manual) {
      if (!overtake.phase) {
        const ahead = traffic.nearestAhead(carS, lateral, 30);
        if (ahead && ahead.speed < speed * 0.92 && speed > 6 && traffic.oncomingClear(carS, carS + 150)) {
          overtake = { phase: 'signal', t: 0.85, blink: 'L', target: ahead.car };
        }
      } else if (overtake.phase === 'signal') {
        overtake.t -= dt;
        if (overtake.t <= 0) overtake.phase = 'out';
      } else if (overtake.phase === 'out') {
        lateralTarget = -2.1;
        if (!traffic.cars.includes(overtake.target) || carS > overtake.target.s + 13) {
          overtake.phase = 'back';
          overtake.blink = 'R';
          overtake.t = 1.0;
        }
      } else if (overtake.phase === 'back') {
        lateralTarget = 2.1;
        overtake.t -= dt;
        if (overtake.t <= 0 && Math.abs(lateral - 2.1) < 0.3) { overtake.phase = null; overtake.blink = null; }
      }
    }
    const prevLateral = lateral;
    lateral = THREE.MathUtils.lerp(lateral, lateralTarget, 1 - Math.exp(-dt * 2.2));
    const lateralVel = (lateral - prevLateral) / Math.max(dt, 1e-4);

    // place car on the road
    const f = world.getFrame(carS);
    const carX = f.x + f.rightX * lateral;
    const carZ = f.z + f.rightZ * lateral;
    car.group.position.set(carX, f.y + 0.02, carZ);
    car.group.rotation.y = Math.PI - f.theta - lateralVel * 0.045;
    const lightsOn = THREE.MathUtils.clamp(envOut.night + envOut.storm * 0.6 + envOut.fogW * 0.45, 0, 1);
    car.update(dt, speed, lateralVel, lightsOn, overtake.blink);
    traffic.update(dt, carS, speed, lateral, lightsOn, t);

    // chase camera with soft damping; FOV opens up with the cruise speed
    const back = 8.6;
    const targetCam = new THREE.Vector3(
      carX - f.dirX * back + f.rightX * lateral * -0.25,
      f.y + 3.2,
      carZ - f.dirZ * back + f.rightZ * lateral * -0.25
    );
    camPos.lerp(targetCam, 1 - Math.exp(-dt * 3.2));
    // snap only after real stalls: the damped camera trails by ~speed/3.2 m,
    // so the threshold must scale with speed or it fires every frame at pace
    const lagAllow = speed * 0.45 + 6;
    if (camPos.distanceToSquared(targetCam) > lagAllow * lagAllow) camPos.copy(targetCam);
    // never sink into the roadbed
    const camFrame = world.getFrame(Math.max(0, carS - back));
    camPos.y = Math.max(camPos.y, camFrame.y + 1.7);
    camera.position.copy(camPos);
    camLook.set(carX + f.dirX * 9, f.y + 1.9 + Math.sin(t * 0.4) * 0.08, carZ + f.dirZ * 9);
    camera.lookAt(camLook);
    const targetFov = 55 + env.speedIdx * 3;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-dt * 1.5));
      camera.updateProjectionMatrix();
    }

    // ---- apply the environment to scene, lights and post ----
    scene.fog.color.copy(envOut.fogColor);
    scene.fog.near = envOut.fogNear;
    scene.fog.far = envOut.fogFar;
    scene.background.copy(envOut.fogColor);
    sun.color.copy(envOut.sunColor);
    sun.intensity = envOut.sunI * envOut.lightMul + flash * 2.5;
    sun.position.copy(envOut.sunDir).multiplyScalar(300).add(camera.position);
    sun.target.position.copy(camera.position);
    sun.target.updateMatrixWorld();
    hemi.color.copy(envOut.hemiSky);
    hemi.groundColor.copy(envOut.hemiGround);
    hemi.intensity = envOut.hemiI * (0.55 + 0.45 * envOut.lightMul);
    backfill.intensity = 0.35 * (1 - envOut.night * 0.8);
    renderer.toneMappingExposure = envOut.exposure * (1 - envOut.skyDim * 0.18);

    // world upkeep
    world.ensure(carS);
    const pulse = music ? music.getPulse() : 0.2;
    world.update(t, pulse);
    world.applyEnvLook(envOut);
    post.bloom.strength = 0.3 + pulse * 0.12 + envOut.night * 0.1 + flash * 0.3;
    post.grain.uniforms.uTime.value = t;

    // sky, clouds and the horizon skyline follow the camera
    sky.position.copy(camera.position);
    sky.userData.update(envOut, t, flash);
    clouds.position.set(camera.position.x, 0, camera.position.z);
    clouds.rotation.y = t * 0.004;
    clouds.userData.update(envOut);
    skyline.userData.update(envOut, camera);

    // precipitation + lightning (thunder rolls into the music)
    flash = weatherFX.update(dt, envOut, camera, t, pulse, (delay) => music && music.thunder(delay));

    // drifting petals, recycled in a box around the camera; they hide in bad weather
    petalMat.opacity = 0.45 * (1 - envOut.night * 0.6) * (1 - Math.min(1, envOut.rain + envOut.snow) * 0.85);
    const pp = petalGeo.attributes.position.array;
    for (let i = 0; i < PETALS; i++) {
      const k = i * 3;
      pp[k] += Math.sin(t * 0.6 + petalSeed[i]) * dt * 0.7;
      pp[k + 1] -= dt * (0.35 + (petalSeed[i] % 1) * 0.5);
      pp[k + 2] += dt * 0.5;
      // wrap into camera-local box
      let wx = pp[k] - (camera.position.x - 25);
      let wy = pp[k + 1] - (camera.position.y - 4);
      let wz = pp[k + 2] - (camera.position.z - 35);
      wx = ((wx % 50) + 50) % 50;
      wy = ((wy % 15) + 15) % 15;
      wz = ((wz % 70) + 70) % 70;
      pp[k] = camera.position.x - 25 + wx;
      pp[k + 1] = camera.position.y - 4 + wy;
      pp[k + 2] = camera.position.z - 35 + wz;
    }
    petalGeo.attributes.position.needsUpdate = true;

    // ---- the music leans into the scene (throttled) ----
    sceneTimer -= dt;
    if (music && sceneTimer <= 0) {
      sceneTimer = 0.5;
      music.setScene({
        set: envOut.domLand,
        tempo: SPEED_LEVELS[env.speedIdx].bpm,
        night: envOut.night,
        muffle: envOut.fogW * 0.65 + envOut.snow * 0.45 + envOut.storm * 0.25,
        rain: envOut.rain,
        snow: envOut.snow,
        storm: envOut.storm,
        wind: envOut.wind,
        bright: envOut.clear * (1 - envOut.night) * (1 - envOut.skyDim),
        timeIdx: envOut.timeIdx,
      });
    }

    // ---- radio display (throttled) ----
    radioTimer -= dt;
    if (radioTimer <= 0) {
      radioTimer = 0.25;
      const lw = envOut.landWeights;
      radio.setState({
        needle01: envOut.needle01,
        landIdx: envOut.domLand,
        tuned: lw[envOut.domLand] > 0.82,
        timeIdx: envOut.timeIdx,
        weatherIdx: env.wxTargetIdx,
        speedIdx: env.speedIdx,
        muted: music ? music.muted : false,
        autoLand: env.autoLand,
        autoTime: env.autoTime && env.timeTarget === null,
        autoWeather: env.autoWeather,
        trackName: music ? music.displayTrack : 'GOLDEN HOUR',
        autoTrack: music ? music.autoTrack : true,
      });
    }

    post.composer.render();
  }
  tick();
}

init();
