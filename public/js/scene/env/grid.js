// Living-environment grid floor: analytic infinite grid with blendable modes (square, hex, polar, dots),
// ripple shimmer, story-accent blending, a 4-slot pulse-ring buffer and the breaking-news alert bands.
// One draw call. No uTime in shaders: every phase is accumulated in JS and wrapped at a seamless period.
import * as THREE from '../../../vendor/three/three.module.js';

const TAU = Math.PI * 2;
const SCROLL_WRAP = 30;                 // cell units; divisible by every square/dot/polar period we use (1,2,3,5,6,10)
const HEX_WRAP = 1.7320508 * 8;         // hex row period (sqrt3) * 8
const MAXP = 4;

export const GRID_DEFAULTS = {
  square: 1, hex: 0, polar: 0, dots: 0,
  colA: '#ff2bd6', colB: '#00f0ff', storyMix: 0.5,
  speed: 1, cell: 1, fade: 1, ripple: 0, rippleSpeed: 1, glow: 1,
};

const VERT = /* glsl */`
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FRAG = /* glsl */`
uniform vec3 uFog; uniform vec3 uFar; uniform vec3 uNear; uniform float uAlert;
uniform vec4 uW;                 // square, hex, polar, dots
uniform vec4 uScroll;            // square/dots scroll, hex scroll, polar scroll, band phase
uniform vec4 uShape;             // cell, fade, glow, quality
uniform vec3 uRip;               // amount, phase, k
uniform vec2 uPolarOrigin;
uniform vec4 uPulses[${MAXP}];   // x, z, radius, strength
uniform vec4 uPulseCols[${MAXP}];// rgb, width
uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
varying vec3 vW;

float guard(){
  vec2 q = gl_FragCoord.xy / uRes;
  vec2 m = smoothstep(uGuardRect.xy - 0.08, uGuardRect.xy, q) * (1. - smoothstep(uGuardRect.zw, uGuardRect.zw + 0.08, q));
  return 1. - uGuardAmt * m.x * m.y;
}
// returns (core, halo), both 0..1, from a distance-to-line in pixels and an AA fade
vec2 shape(float gd, float f){ return vec2(1. - min(gd / 1.3, 1.), 1. - min(gd / 7., 1.)) * f; }
vec2 square(vec2 p){
  vec2 d = fwidth(p); vec2 g = abs(fract(p - 0.5) - 0.5) / d;
  return shape(min(g.x, g.y), 1. - clamp(max(d.x, d.y) * 1.4, 0., 0.85));
}
vec2 hexa(vec2 p){
  vec2 r = vec2(1., 1.7320508); vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 ag = abs(gv);
  float edge = 0.5 - max(dot(ag, vec2(0.5, 0.8660254)), ag.x);
  vec2 d = fwidth(p); float fw = max(d.x, d.y);
  return shape(edge / fw, 1. - clamp(fw * 1.4, 0., 0.85));
}
vec2 polar(vec2 w, float cell){
  vec2 v = w - uPolarOrigin;
  float rr = length(v) / cell - uScroll.z;
  float dr = fwidth(rr);
  vec2 ring = shape(abs(fract(rr - 0.5) - 0.5) / dr, 1. - clamp(dr * 1.4, 0., 0.85));
  float an = atan(v.y, v.x) * (48. / 6.2831853);
  float da = min(fwidth(an), fwidth(fract(an + 0.5) - 0.5));
  vec2 spk = shape(abs(fract(an - 0.5) - 0.5) / da, 1. - clamp(da * 1.4, 0., 0.85));
  spk *= smoothstep(4., 14., length(v) / cell * 1.0);
  return max(ring, spk * 0.8);
}
vec2 dots(vec2 p){
  vec2 f = fract(p) - 0.5; float d = length(f);
  vec2 dd = fwidth(p); float fw = max(dd.x, dd.y);
  float fa = 1. - clamp(fw * 2.2, 0., 0.9);
  float core = (1. - smoothstep(0.11 - fw, 0.11 + fw, d)) * fa;
  float halo = exp(-d * d * 36.) * 0.6 * fa;
  return vec2(core * 1.25, halo);
}

void main(){
  vec2 w = vW.xz;
  float cell = 3. * uShape.x;
  vec2 p = w / cell; p.y -= uScroll.x;
  vec2 lh = vec2(0.); vec2 co;
  if (uW.x > 0.002) lh += uW.x * square(p);
  if (uW.y > 0.002) lh += uW.y * hexa(vec2(p.x, p.y + uScroll.x - uScroll.y));
  if (uW.z > 0.002) lh += uW.z * polar(w, cell);
  if (uW.w > 0.002) lh += uW.w * dots(p);
  // coarse big-cell grid (old far grid): strongest in square mode, a hint in the others
  float l2 = 0.;
  if (uShape.w > 0.5) {
    vec2 p2 = w / (30. * uShape.x); p2.y -= uScroll.x / 10.;
    l2 = square(p2).x * (uW.x + 0.4 * (uW.y + uW.w) + 0.25 * uW.z);
  }
  float l = lh.x;
  float halo = (uShape.w > 0.5) ? lh.y * uShape.z * 0.32 : 0.;

  // ripple shimmer, no displacement
  float rip = 1.;
  if (uRip.x > 0.002) {
    float rd = length(w - uPolarOrigin);
    float s = sin(rd * uRip.z - uRip.y);
    if (uShape.w > 1.5) s = 0.7 * s + 0.3 * sin(w.x * 0.21 + w.y * 0.17 + uRip.y * 1.7);
    rip = 1. + uRip.x * 0.55 * s;
  }

  float d = distance(w, cameraPosition.xz);
  float fade = exp(-d * 0.0042 * uShape.y);
  vec3 base = vec3(0.012, 0.0, 0.035);
  vec3 nearC = mix(uNear, vec3(1.0, 0.15, 0.05), uAlert);
  vec3 farC = mix(uFar, vec3(1.0, 0.45, 0.1), uAlert);
  vec3 lc = mix(nearC, farC, smoothstep(10., 220., d));
  vec3 c = base + (lc * (l * 0.85 + halo) + farC * l2 * 1.1) * rip;

  // alert: sweeping bands toward the camera (phase in uScroll.w)
  float band = smoothstep(0.85, 1., sin(d * 0.08 - uScroll.w)) * uAlert;
  c += vec3(1., 0.2, 0.1) * band * (0.3 + l * 2.);

  // pulse rings
  for (int i = 0; i < ${MAXP}; i++) {
    vec4 pu = uPulses[i];
    if (pu.w < 0.002) continue;
    float wd = uPulseCols[i].w;
    float x = (distance(w, pu.xy) - pu.z) / wd;
    float ring = exp(-x * x) * pu.w;
    c += uPulseCols[i].rgb * ring * (0.6 + l * 3.);
  }

  c *= guard();
  c = mix(uFog, c, fade) ;
  c = mix(c, mix(uFog * vec3(1.8, 0.5, 0.4), c, fade), uAlert);   // alert: warmer fog, applied last
  gl_FragColor = vec4(c, 1.);
}`;

export function createGrid(scene, ctx) {
  const cur = { ...GRID_DEFAULTS };
  const colA = new THREE.Color(GRID_DEFAULTS.colA), colB = new THREE.Color(GRID_DEFAULTS.colB);
  const guard = {
    uRes: ctx.res || { value: new THREE.Vector2(1920, 1080) },
    uGuardRect: ctx.guardRect || { value: new THREE.Vector4(0.30, 0.30, 0.985, 0.93) },
    uGuardAmt: ctx.guardAmt || { value: 0.45 },
  };
  const alertU = ctx.alert || { value: 0 };
  const fogU = ctx.fogCol || { value: new THREE.Color(0.13, 0.015, 0.13) };

  const pulses = [], pulseCols = [];
  for (let i = 0; i < MAXP; i++) { pulses.push(new THREE.Vector4(0, 0, 0, 0)); pulseCols.push(new THREE.Vector4(1, 1, 1, 6)); }
  const slots = Array.from({ length: MAXP }, () => ({ speed: 0, s0: 0, age: 0, life: 0 }));
  let rr = 0;

  const u = {
    uFog: fogU, uFar: { value: new THREE.Color() }, uNear: { value: new THREE.Color() }, uAlert: alertU,
    uW: { value: new THREE.Vector4(1, 0, 0, 0) },
    uScroll: { value: new THREE.Vector4() },
    uShape: { value: new THREE.Vector4(1, 1, 1, ctx.quality ?? 2) },
    uRip: { value: new THREE.Vector3(0, 0, 0.12) },
    uPolarOrigin: { value: new THREE.Vector2(0, -100) },
    uPulses: { value: pulses }, uPulseCols: { value: pulseCols },
    ...guard,
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  scene.add(mesh);

  let sq = 0, hx = 0, pl = 0, band = 0, ripPh = 0;
  const polarTgt = new THREE.Vector2(0, -100);

  function setParams(p) {
    for (const k of ['square', 'hex', 'polar', 'dots', 'storyMix', 'speed', 'cell', 'fade', 'ripple', 'rippleSpeed', 'glow']) if (p[k] !== undefined) cur[k] = p[k];
    if (p.colA) colA.copy(p.colA);
    if (p.colB) colB.copy(p.colB);
    let s = cur.square + cur.hex + cur.polar + cur.dots;
    if (s < 0.001) { cur.square = 1; s = 1; }
    u.uW.value.set(cur.square / s, cur.hex / s, cur.polar / s, cur.dots / s);
    u.uShape.value.set(Math.max(0.3, cur.cell), Math.max(0.1, cur.fade), cur.glow, u.uShape.value.w);
    u.uRip.value.x = cur.ripple;
  }
  setParams({});

  function update(dt, t, camera) {
    const c = camera.position;
    mesh.position.set(c.x, 0, c.z);
    const al = alertU.value;
    const sp = cur.speed * (0.9 + al * 2.5) * dt;
    sq = (sq + sp) % SCROLL_WRAP;
    hx = (hx + sp) % HEX_WRAP;   // hex keeps its own wrapped accumulator
    pl = (pl - sp * 0.6 + SCROLL_WRAP) % SCROLL_WRAP; // polar rings expand outward
    band = (band + dt * 7) % TAU;
    ripPh = (ripPh + dt * 1.6 * cur.rippleSpeed) % TAU;
    u.uScroll.value.set(sq, hx, pl, band);
    u.uRip.value.y = ripPh;
    u.uFar.value.copy(colA).lerp(ctx.accent.value, cur.storyMix);
    u.uNear.value.copy(colB).lerp(ctx.accent2.value, cur.storyMix);
    // ease the polar origin toward the current station
    const po = u.uPolarOrigin.value, k = 1 - Math.exp(-2 * dt);
    po.x += (polarTgt.x - po.x) * k; po.y += (polarTgt.y - po.y) * k;
    for (let i = 0; i < MAXP; i++) {
      const s = slots[i];
      if (s.s0 <= 0) continue;
      s.age += dt;
      const f = 1 - s.age / s.life;
      if (f <= 0) { s.s0 = 0; pulses[i].w = 0; continue; }
      pulses[i].z = s.age * s.speed;
      pulses[i].w = s.s0 * f;
    }
  }

  function pulse(x, z, color, { speed = 160, width = 6, strength = 1, life, maxRadius = 700 } = {}) {
    const i = rr; rr = (rr + 1) % MAXP;
    const s = slots[i];
    s.speed = speed; s.s0 = strength; s.age = 0; s.life = life ?? Math.max(0.5, maxRadius / speed);
    pulses[i].set(x, z, 0, strength);
    const col = color && color.isColor ? color : new THREE.Color(color ?? '#00f0ff');
    pulseCols[i].set(col.r, col.g, col.b, Math.max(0.5, width));
  }
  // today's shockwave look: 55 u/s, 2.2 wide, linear fade over ~2.2 s
  function shockwave(x, z, color) { pulse(x, z, color || new THREE.Color('#00f0ff'), { speed: 55, width: 2.2, strength: 1, life: 2.2 }); }

  return {
    mesh, setParams, update, pulse, shockwave,
    setPolarOrigin(x, z) { polarTgt.set(x, z); },
    setQuality(level) { u.uShape.value.w = level; },
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); mat.dispose(); },
  };
}
