// _stub: contract test scene. A backdrop gradient, a ring of 64 instanced neon bars in the far field and 2k points.
// enter: bars rise from the floor band; exit: bars fly outward. ripple: an expanding ring front in the backdrop.
import * as THREE from '../../../vendor/three/three.module.js';

const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function create(ctx) {
  const G = ctx.GLSL;
  const U = { uAsm: { value: 0 }, uRip: { value: new THREE.Vector3(0, 0, 9) }, uRipCol: { value: new THREE.Color('#00f0ff') } };
  ctx.backdrop(ctx.track(new THREE.ShaderMaterial({
    uniforms: { ...ctx.common(), ...U },
    fragmentShader: `${G.COMMON}
uniform vec3 uRip; uniform vec3 uRipCol;
void main(){
  vec2 q = gl_FragCoord.xy / uRes;
  vec3 col = mix(vec3(.02,.0,.06), mix(uAccent, uAccent2, q.x) * .18, smoothstep(.2, 1., q.y));
  col += vec3(.05,.0,.08) * fbm(vec3(q * 4., uTime * .05), 3);
  float d = length((q - uRip.xy) * vec2(uRes.x / uRes.y, 1.));
  col += uRipCol * exp(-pow((d - uRip.z * 1.4) * 18., 2.)) * max(0., 1. - uRip.z) * 1.6;
  gl_FragColor = vec4(finish(col), 1.);
}`,
  })));

  const N = 64;
  const geo = ctx.track(new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(6, 1, 6)));
  const seed = new Float32Array(N); for (let i = 0; i < N; i++) seed[i] = i / N;
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  geo.instanceCount = N;
  const bars = new THREE.Mesh(geo, ctx.track(new THREE.ShaderMaterial({
    uniforms: { ...ctx.common(), ...U },
    vertexShader: `attribute float aSeed; uniform float uTime, uAsm, uAlert; varying float vH; varying float vS;
void main(){
  float a = aSeed * 6.28318 + uTime * .1 * (1. + .4 * uAlert);
  float h = (20. + 140. * (.5 + .5 * sin(uTime * 1.3 + aSeed * 40.))) * uAsm;
  vec3 p = position; p.y = (p.y + .5) * h; vH = p.y / 160.; vS = aSeed;
  float R = 520. + (1. - uAsm) * 600.;
  p += vec3(cos(a) * R, -60., -700. + sin(a) * R * .35);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`,
    fragmentShader: `${G.COMMON}
varying float vH; varying float vS;
void main(){ vec3 col = mix(uAccent, uAccent2, vS) * (.4 + 1.6 * vH) * (1. + uPulse); gl_FragColor = vec4(finish(col), 1.); }`,
  })));
  bars.frustumCulled = false;
  const root = new THREE.Group(); root.add(bars); ctx.stage.add(root);
  ctx.anchor(root, { parallax: 0.15 });

  let mode = 0, mt = 0, md = 1, asm = 0, rip = 9;
  const api = {
    grade: { bloom: 0.6, bloomThreshold: 0.7, bloomRadius: 0.5, tint: new THREE.Color(1, 1, 1), tintAmt: 0, sat: 1, contrast: 1, ca: 1, grain: 1, vignette: 1, scan: 1 },
    cameraBias: { orbitScale: 1, bob: 1 },
    setIntensity(a) { ctx.fade.value = a; },
    enter(d) { mode = 1; mt = 0; md = Math.max(0.1, d); },
    exit(d) { mode = -1; mt = 0; md = Math.max(0.1, d); },
    ripple(o = {}) { rip = 0; if (o.color) U.uRipCol.value.copy(o.color); const s = o.screen; U.uRip.value.set(s ? s.x : 0.64, s ? s.y : 0.6, 0); ctx.pulse.value = Math.max(ctx.pulse.value, (o.strength ?? 1) * 0.5); },
    event() {},
    setQuality() {},
    update(dt) {
      if (mode) { mt += dt; const p = Math.min(1, mt / md); asm = mode > 0 ? sm(p) : 1 - sm(p); if (p >= 1) mode = 0; } else if (asm === 0 && mt === 0) asm = 1;
      U.uAsm.value = asm;
      rip += dt; U.uRip.value.z = Math.min(rip, 9);
    },
    morphPoints() { return false; },
  };
  return api;
}
