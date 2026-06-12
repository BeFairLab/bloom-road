// A cute low-poly retro hatchback built from primitives, plus a blob shadow.
// Headlights and taillights fade in when the world gets dark.
import * as THREE from 'three';
import { blobShadowCanvas } from './assets.js';

export function makeCar() {
  const group = new THREE.Group(); // position + yaw set from the road frame
  const body = new THREE.Group();  // roll / pitch / bob
  group.add(body);

  const paint = new THREE.MeshLambertMaterial({ color: 0xd95f3b });
  const trim = new THREE.MeshLambertMaterial({ color: 0xf6e8cd });
  const glass = new THREE.MeshLambertMaterial({ color: 0x43355a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2624 });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.46, 3.6), paint);
  lower.position.y = 0.55;
  body.add(lower);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.9), paint);
  cabin.position.set(0, 1.0, 0.15);
  body.add(cabin);

  const windows = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.3, 1.55), glass);
  windows.position.set(0, 1.02, 0.15);
  body.add(windows);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 1.8), trim);
  roof.position.set(0, 1.29, 0.15);
  body.add(roof);

  for (const z of [-1.74, 1.74]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.16, 0.28), trim);
    bumper.position.set(0, 0.42, z);
    body.add(bumper);
  }

  // lights: local +Z is forward
  const headMat = new THREE.MeshBasicMaterial({ color: 0xcfc2a4 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x5a1410 });
  const headOff = new THREE.Color(0xcfc2a4);
  const headOn = new THREE.Color(0xfff3c8);
  const tailOff = new THREE.Color(0x5a1410);
  const tailOn = new THREE.Color(0xff3520);
  for (const x of [-0.55, 0.55]) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), headMat);
    head.position.set(x, 0.62, 1.81);
    body.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.05), tailMat);
    tail.position.set(x, 0.62, -1.81);
    body.add(tail);
  }

  // turn signals for the auto-overtake maneuver
  // (with local +Z forward and +Y up, the car's LEFT side is local +X)
  const sigOff = new THREE.Color(0x5a3a10);
  const sigOn = new THREE.Color(0xffb43a);
  const sigLMat = new THREE.MeshBasicMaterial({ color: sigOff });
  const sigRMat = new THREE.MeshBasicMaterial({ color: sigOff });
  for (const [mat, x] of [[sigLMat, 0.8], [sigRMat, -0.8]]) {
    for (const z of [1.76, -1.76]) {
      const sig = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 4), mat);
      sig.position.set(x, 0.58, z);
      body.add(sig);
    }
  }

  const beam = new THREE.SpotLight(0xffeec0, 0, 110, 0.52, 0.7, 1.2);
  beam.position.set(0, 0.8, 1.7);
  beam.target.position.set(0, -0.4, 16);
  body.add(beam);
  body.add(beam.target);

  // black tint so the blob only darkens the road — never glows
  const shadowTex = new THREE.CanvasTexture(blobShadowCanvas());
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 4.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  group.add(shadow);

  let bobT = 0;
  let lights = 0;
  function update(dt, speed, steer, lightsOn = 0, blink = null) {
    bobT += dt;
    for (const w of wheels) w.rotation.x += (speed * dt) / 0.34;
    body.position.y = Math.sin(bobT * 7.3) * 0.012 + Math.sin(bobT * 3.1) * 0.01;
    body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, -steer * 0.05, 1 - Math.exp(-dt * 6));
    body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, Math.sin(bobT * 1.7) * 0.004, 0.1);

    lights = THREE.MathUtils.lerp(lights, THREE.MathUtils.clamp(lightsOn, 0, 1), 1 - Math.exp(-dt * 2));
    headMat.color.copy(headOff).lerp(headOn, lights);
    tailMat.color.copy(tailOff).lerp(tailOn, lights);
    beam.intensity = lights * 320;

    const blinkOn = Math.floor(bobT * 2.6) % 2 === 0;
    sigLMat.color.copy(blink === 'L' && blinkOn ? sigOn : sigOff);
    sigRMat.color.copy(blink === 'R' && blinkOn ? sigOn : sigOff);
  }

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.82, -1.15], [0.82, -1.15], [-0.82, 1.15], [0.82, 1.15]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.34, z);
    body.add(w);
    wheels.push(w);
  }

  return { group, update };
}
