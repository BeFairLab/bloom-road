// Post chain: render -> soft bloom -> tone mapping -> film grain + vignette.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAmount: { value: 0.045 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAmount;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      // vignette
      vec2 q = vUv - 0.5;
      float vig = smoothstep(0.95, 0.32, length(q) * 1.22);
      col *= mix(0.74, 1.0, vig);
      // gentle warm grade
      col = pow(col, vec3(0.985, 1.0, 1.035));
      col.r *= 1.02;
      col.b *= 0.985;
      // animated grain
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime * 7.0) * vec2(17.0, 113.0)) - 0.5;
      col += g * uAmount;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function makePost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: 4,
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.28, 0.8, 0.9);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const grain = new ShaderPass(GrainShader);
  composer.addPass(grain);

  return { composer, bloom, grain };
}
