// Sparse phantom traffic. Oncoming cars hold the left lane; same-direction
// cars never intersect: a faster car closes in on a leader (another car or
// the player), signals left, swings out, passes and signals back in — and if
// the oncoming lane is busy it just sits behind, matching the leader's speed.
// Lights and signals follow the time of day.
import * as THREE from 'three';
import { blobShadowCanvas } from './assets.js';
import { SPEED_LEVELS } from './environment.js';

const LANE = 2.1;
const PAINTS = [0x4f7bb5, 0xc9b96b, 0x8a9a8d, 0x9c5a4a, 0x5a6a72, 0xb8b0a4, 0x6b5a8a];

const HEAD_OFF = new THREE.Color(0xcfc2a4);
const HEAD_ON = new THREE.Color(0xfff3c8);
const TAIL_OFF = new THREE.Color(0x5a1410);
const TAIL_ON = new THREE.Color(0xff3520);
const SIG_OFF = new THREE.Color(0x5a3a10);
const SIG_ON = new THREE.Color(0xffb43a);

let shadowTex = null;

function buildCarMesh(paintHex) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: paintHex });
  const glass = new THREE.MeshLambertMaterial({ color: 0x3a3248 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2624 });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.46, 3.4), paint);
  lower.position.y = 0.55;
  group.add(lower);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.46, 1.7), paint);
  cabin.position.set(0, 0.98, 0.1);
  group.add(cabin);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 1.4), glass);
  windows.position.set(0, 1.0, 0.1);
  group.add(windows);

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 8);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.8, -1.1], [0.8, -1.1], [-0.8, 1.1], [0.8, 1.1]]) {
    const wM = new THREE.Mesh(wheelGeo, dark);
    wM.position.set(x, 0.33, z);
    group.add(wM);
    wheels.push(wM);
  }

  // lights: local +Z forward
  const headMat = new THREE.MeshBasicMaterial({ color: HEAD_OFF });
  const tailMat = new THREE.MeshBasicMaterial({ color: TAIL_OFF });
  const sigLMat = new THREE.MeshBasicMaterial({ color: SIG_OFF });
  const sigRMat = new THREE.MeshBasicMaterial({ color: SIG_OFF });
  for (const x of [-0.5, 0.5]) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 5), headMat);
    head.position.set(x, 0.6, 1.71);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.05), tailMat);
    tail.position.set(x, 0.6, -1.71);
    group.add(tail);
  }
  // local +Z forward, +Y up → the car's LEFT side is local +X
  for (const [mat, x] of [[sigLMat, 0.76], [sigRMat, -0.76]]) {
    for (const z of [1.66, -1.66]) {
      const sig = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), mat);
      sig.position.set(x, 0.56, z);
      group.add(sig);
    }
  }

  if (!shadowTex) shadowTex = new THREE.CanvasTexture(blobShadowCanvas());
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 4.2),
    new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  group.add(shadow);

  return { group, wheels, headMat, tailMat, sigLMat, sigRMat };
}

export class Traffic {
  constructor(scene, world, env) {
    this.scene = scene;
    this.world = world;
    this.env = env;
    this.cars = [];
  }

  _spawn(kind, carS) {
    const cruise = SPEED_LEVELS[this.env.speedIdx].v;
    const mesh = buildCarMesh(PAINTS[Math.floor(Math.random() * PAINTS.length)]);
    const car = {
      ...mesh,
      dir: kind === 'oncoming' ? -1 : 1,
      lane: kind === 'oncoming' ? -LANE : LANE,
      targetLane: kind === 'oncoming' ? -LANE : LANE,
      state: 'cruise',
      stateT: 0,
      blink: null,
      done: false,
    };
    if (kind === 'oncoming') {
      car.s = carS + 420 + Math.random() * 280;
      car.baseSpeed = 13 + Math.random() * 13;
    } else if (kind === 'slow') {
      car.s = carS + 220 + Math.random() * 320;
      car.baseSpeed = cruise * (0.5 + Math.random() * 0.25);
    } else { // fast — will catch up and overtake
      car.s = Math.max(10, carS - 120 - Math.random() * 80);
      car.baseSpeed = cruise * (1.25 + Math.random() * 0.35);
    }
    car.speed = car.baseSpeed;
    this.scene.add(car.group);
    this.cars.push(car);
  }

  _despawn(car) {
    this.scene.remove(car.group);
    car.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map !== shadowTex) o.material.dispose();
    });
    this.cars.splice(this.cars.indexOf(car), 1);
  }

  // nearest same-direction car ahead of the player in (roughly) his lane
  nearestAhead(carS, playerLane, range = 32) {
    let best = null;
    for (const c of this.cars) {
      if (c.dir < 0) continue;
      const gap = c.s - carS;
      if (gap <= 2 || gap > range) continue;
      if (Math.abs(c.lane - playerLane) > 2.4) continue;
      if (!best || gap < best.gap) best = { car: c, gap, speed: c.speed };
    }
    return best;
  }

  // is the oncoming lane free around the given stretch of road?
  oncomingClear(s0, s1) {
    const lo = Math.min(s0, s1) - 60;
    const hi = Math.max(s0, s1) + 90;
    return !this.cars.some((c) => c.dir < 0 && c.s > lo && c.s < hi);
  }

  // nearest leader (player or traffic) ahead of the given car in its lane.
  // The window is wider than a car so the speed clamp keeps holding through
  // most of a pull-out — release only once genuinely clear sideways.
  _leaderFor(car, carS, playerLane, playerSpeed) {
    let best = null;
    const consider = (s, lane, speed) => {
      if (Math.abs(car.lane - lane) > 2.6) return;
      const gap = s - car.s;
      if (gap <= 0.5 || gap > 50) return;
      if (!best || gap < best.gap) best = { s, gap, speed };
    };
    consider(carS, playerLane, playerSpeed);
    for (const o of this.cars) {
      if (o === car || o.dir < 0) continue;
      consider(o.s, o.lane, o.speed);
    }
    return best;
  }

  update(dt, carS, playerSpeed, playerLane, night, time) {
    // sparse spawning: a couple same-direction, a couple oncoming
    const same = this.cars.filter((c) => c.dir > 0);
    const onc = this.cars.filter((c) => c.dir < 0);
    if (onc.length < 2 && Math.random() < dt * 0.08) this._spawn('oncoming', carS);
    if (same.length < 2 && Math.random() < dt * 0.05) {
      const nearAhead = same.some((c) => c.s > carS && c.s < carS + 350);
      this._spawn(Math.random() < 0.5 && !nearAhead ? 'slow' : 'fast', carS);
    }

    const blinkOn = Math.floor(time * 2.6) % 2 === 0;

    for (const car of [...this.cars]) {
      car.s += car.dir * car.speed * dt;

      // out of range — recycle
      if (car.dir > 0 && (car.s < carS - 180 || car.s > carS + 750)) { this._despawn(car); continue; }
      if (car.dir < 0 && (car.s < carS - 140 || car.s < 10)) { this._despawn(car); continue; }

      if (car.dir > 0) {
        // the leader check is lane-aware, so it releases by itself once the
        // car has pulled far enough sideways during a pass
        const leader = this._leaderFor(car, carS, playerLane, playerSpeed);

        // closing in on someone slower: overtake if the left lane is free,
        // otherwise settle in behind and match their speed — never intersect
        if (car.state === 'cruise' && leader && car.baseSpeed > leader.speed + 1.5 && leader.gap < 40) {
          if (this.oncomingClear(car.s, car.s + 120)) {
            car.state = 'signal';
            car.stateT = 1.1;
            car.blink = 'L';
          }
        }
        let speedTarget = car.baseSpeed;
        if (leader && car.speed > leader.speed) {
          // engage early enough to bleed off the closing speed: braking
          // distance scales with how fast we're gaining on the leader
          const closing = car.speed - leader.speed;
          if (leader.gap < 10 + closing * 1.4) speedTarget = Math.max(2, leader.speed * 0.95);
        }
        car.speed += (speedTarget - car.speed) * (1 - Math.exp(-dt * (speedTarget < car.speed ? 2.2 : 1.2)));

        if (car.state === 'signal') {
          car.stateT -= dt;
          if (car.stateT <= 0) { car.state = 'pass'; car.targetLane = -LANE; }
        } else if (car.state === 'pass') {
          // abort the pass early if someone shows up in the oncoming lane
          const oncNear = this.cars.some((o) => o.dir < 0 && o.s > car.s - 30 && o.s < car.s + 110);
          // otherwise done once nobody in the right lane is alongside anymore
          let alongside = false;
          if (Math.abs(playerLane - LANE) < 1.7 && Math.abs(carS - car.s) < 18) alongside = true;
          for (const o of this.cars) {
            if (o === car || o.dir < 0) continue;
            if (Math.abs(o.lane - LANE) < 1.7 && o.s > car.s - 24 && o.s < car.s + 16) alongside = true;
          }
          if (oncNear || !alongside) {
            car.state = 'back';
            car.targetLane = LANE;
            car.blink = 'R';
          }
        } else if (car.state === 'back' && Math.abs(car.lane - LANE) < 0.18) {
          car.state = 'cruise';
          car.blink = null;
        }
      } else {
        // oncoming cars keep their own spacing: ease off behind a slower one
        let leader = null;
        for (const o of this.cars) {
          if (o === car || o.dir > 0) continue;
          const gap = car.s - o.s; // o is ahead in this car's direction of travel
          if (gap > 0.5 && gap < 18 && (!leader || gap < leader.gap)) leader = { gap, speed: o.speed };
        }
        const st = leader ? Math.min(car.baseSpeed, leader.speed * 0.95) : car.baseSpeed;
        car.speed += (st - car.speed) * (1 - Math.exp(-dt * 1.4));
      }
      // ease toward the target lane with capped sideways speed — a long,
      // gentle lane change instead of a darting swerve
      let dl = (car.targetLane - car.lane) * (1 - Math.exp(-dt * 1.8));
      const cap = dt * 1.5;
      if (dl > cap) dl = cap;
      else if (dl < -cap) dl = -cap;
      car.lane += dl;

      // place on the road
      const f = this.world.getFrame(car.s);
      const x = f.x + f.rightX * car.lane;
      const z = f.z + f.rightZ * car.lane;
      car.group.position.set(x, f.y + 0.02, z);
      car.group.rotation.y = car.dir > 0 ? Math.PI - f.theta : -f.theta;
      for (const w of car.wheels) w.rotation.x += (car.speed * dt) / 0.33;

      // lights
      car.headMat.color.copy(HEAD_OFF).lerp(HEAD_ON, night);
      car.tailMat.color.copy(TAIL_OFF).lerp(TAIL_ON, Math.min(1, night * 1.3 + 0.12));
      car.sigLMat.color.copy(car.blink === 'L' && blinkOn ? SIG_ON : SIG_OFF);
      car.sigRMat.color.copy(car.blink === 'R' && blinkOn ? SIG_ON : SIG_OFF);
    }
  }
}
