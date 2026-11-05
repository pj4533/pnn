// Sun / celestial body: one additive billboard, blendable variants (stripe, eclipse, ring, twin, moon) + soft shafts.
// Params arrive via setParams(p): numbers and THREE.Color (copied, never referenced). All phases accumulate in JS and wrap.
import * as THREE from '../../../vendor/three/three.module.js';

const SUN_DIST = 1500;
const BASE_SCALE = 190 * 2 * 1.7;   // 646: today's quad size
const TAU = Math.PI * 2;
const SHAFT_SCALE = 2.2;

export const SUN_DEFAULTS = {
  stripe: 1, eclipse: 0, ring: 0, twin: 0, moon: 0,
  size: 1, height: 150, yaw: -0.2, stripes: 12, stripeSpeed: 0.12, corona: 1,
  eclipseOffset: 0, ringTilt: 0.35, twinOffset: 0.3, moonPhase: 0.15, shafts: 0, bright: 1,
};

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */`
precision highp float;
uniform vec4 uW;            // stripe, eclipse, ring, twin
uniform float uMoon;
uniform vec3 uColA, uColB, uCorona;
uniform float uQuad;        // quad scale relative to the disc quad (1 or 2.2)
uniform float uStripes, uStripePh, uCoronaK, uEclOff, uRingTilt, uTwinOff, uTwinAng, uMoonPhase;
uniform float uShafts, uShaftPh, uBright, uAlert, uQ;
uniform sampler2D uNoise;
uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
varying vec2 vUv;

float guard(){
  vec2 q = gl_FragCoord.xy / uRes;
  vec2 m = smoothstep(uGuardRect.xy - 0.08, uGuardRect.xy, q) * (1.0 - smoothstep(uGuardRect.zw, uGuardRect.zw + 0.08, q));
  return 1.0 - uGuardAmt * m.x * m.y;
}
float disc(float r, float R){ return smoothstep(R, R - 0.015, r); }

void main(){
  vec2 p = (vUv - 0.5) * 2.0 * 1.7 * uQuad;   // disc radius = 1
  float r = length(p);
  float y = p.y * 0.5 + 0.5;
  float wsum = uW.x + uW.y + uW.z + uW.w + uMoon;
  float nrm = wsum > 1.0 ? 1.0 / wsum : 1.0;
  vec3 core = vec3(0.0);
  float haloK = 0.0;

  if (uW.x > 0.002) {                                    // striped synth sun
    vec3 col = mix(uColA, uColB, smoothstep(0.0, 1.0, y));
    float cut = 1.0;
    if (y < 0.6) {
      float f = fract(y * uStripes - uStripePh);
      float gap = mix(0.64, 0.06, y / 0.6);
      cut = smoothstep(gap - 0.02, gap + 0.02, f);
    }
    core += col * disc(r, 1.0) * cut * 0.95 * uW.x * nrm;
    haloK += uW.x * nrm;
  }

  if (uW.y > 0.002) {                                    // eclipse: lit disc, dark occluder, corona
    vec2 o = vec2(uEclOff * 2.0, uEclOff * 0.35);
    float occ = disc(length(p - o), 0.97);
    vec3 col = mix(uColA, uColB, smoothstep(0.0, 1.0, y));
    float lit = disc(r, 1.0) * (1.0 - occ);
    float d = max(r - 0.97, 0.0);
    float cor = uCoronaK * 0.012 / (d * d + 0.012) * (1.0 - occ * disc(r, 0.97));
    cor *= smoothstep(1.7, 0.9, r);
    float rays = 0.75 + 0.25 * texture2D(uNoise, vec2(atan(p.y, p.x) * 0.95493 + uShaftPh, 0.71)).g;
    core += (col * lit * 1.1 + uCorona * cor * 0.55 * rays) * uW.y * nrm;
    haloK += uW.y * nrm * 0.8;
  }

  if (uW.z > 0.002) {                                    // ringed planet
    float PR = 0.72;
    float pd = disc(r, PR);
    vec2 n2 = p / PR;
    float nz = sqrt(max(1.0 - dot(n2, n2), 0.0));
    float lt = clamp(dot(vec3(n2, nz), normalize(vec3(-0.55, 0.5, 0.65))) * 0.5 + 0.5, 0.0, 1.0);
    float band = 0.5 + 0.5 * sin(p.y * 14.0 + sin(p.x * 3.0) * 0.6);
    vec3 pc = mix(uColA, uColB, clamp(0.5 + p.y * 0.55 + band * 0.12, 0.0, 1.0)) * (0.18 + 0.95 * lt * lt);
    float cs = cos(uRingTilt), sn = sin(uRingTilt);
    vec2 q = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y);
    float ed = length(vec2(q.x, q.y / 0.26));
    float ring = smoothstep(0.34, 0.30, abs(ed - 1.55)) * 0.85 + smoothstep(0.1, 0.07, abs(ed - 1.2)) * 0.55;
    ring *= 0.8 + 0.2 * texture2D(uNoise, vec2(ed * 3.0, 0.2)).r;
    float behind = step(0.0, q.y) * pd;                  // back half hidden behind the planet
    ring *= 1.0 - behind;
    vec3 rc = mix(uColB, uColA, 0.5 + 0.5 * sin(ed * 9.0)) * 1.05;
    core += (pc * pd + rc * ring) * uW.z * nrm;
    haloK += uW.z * nrm * 0.7;
  }

  if (uW.w > 0.002) {                                    // twin suns
    float a = uTwinAng;
    vec2 c1 = vec2(-0.28, 0.0);
    vec2 c2 = vec2(cos(a), sin(a) * 0.4) * (0.95 + uTwinOff * 1.2) + vec2(0.1, 0.1);
    float d1 = length(p - c1), d2 = length(p - c2);
    vec3 s1 = mix(uColA, vec3(1.0), 0.25 * smoothstep(0.9, 0.0, d1 / 0.8)) * disc(d1, 0.8);
    vec3 s2 = mix(uColB, vec3(1.0), 0.25 * smoothstep(0.5, 0.0, d2 / 0.38)) * disc(d2, 0.38);
    float g2 = exp(-max(d2 - 0.38, 0.0) * 5.0) * (1.0 - disc(d2, 0.38)) * 0.25;
    core += (s1 * 0.95 + s2 * 0.95 + uColB * g2) * uW.w * nrm;
    haloK += uW.w * nrm;
  }

  if (uMoon > 0.002) {                                   // lit moon sphere with craters
    float MR = 0.8;
    float md = disc(r, MR);
    vec2 n2 = p / MR;
    float nz = sqrt(max(1.0 - dot(n2, n2), 0.0));
    vec3 N = vec3(n2, nz);
    float a = uMoonPhase * 3.14159;
    vec3 L = normalize(vec3(sin(a) * 0.9, 0.25, cos(a)));
    float lam = clamp(dot(N, L), 0.0, 1.0);
    vec2 uv = N.xy * 0.5 + 0.5;
    float cr = texture2D(uNoise, uv * 1.7).r * 0.6 + texture2D(uNoise, uv * 4.1 + 0.3).g * 0.3;
    if (uQ > 0.5) cr += texture2D(uNoise, uv * 9.3 + 0.7).b * 0.15;
    float crater = smoothstep(0.35, 0.8, cr);
    vec3 base = mix(uColB, uColA, crater * 0.9) * (0.45 + 0.55 * crater);
    vec3 earth = uColB * 0.03;                           // faint earthshine on the dark side
    core += (base * lam * 1.05 + earth) * md * uMoon * nrm;
    haloK += uMoon * nrm * 0.55;
  }

  float g = guard();
  vec3 c = core;
  // halo (guarded)
  float outer = max(r - 1.0, 0.0);
  c += uCorona * exp(-outer * 4.0) * 0.22 * haloK * smoothstep(0.55, 1.0, r + 0.0) * g;
  // soft light shafts in the enlarged quad, alpha <= 0.18
  if (uShafts > 0.002) {
    float ang = atan(p.y, p.x) * 0.95493;                // 3 tiles around the circle (seamless on a repeat texture)
    float s1 = texture2D(uNoise, vec2(ang + uShaftPh, 0.37)).r;
    float s2 = texture2D(uNoise, vec2(ang * 2.0 - uShaftPh * 1.7, 0.63)).g;
    float streak = pow(abs(clamp(s1 * s2 * 2.0, 0.0, 1.0)), 2.0);
    float fall = exp(-r * 0.95) * smoothstep(0.75, 1.15, r);
    float edge = smoothstep(1.7 * uQuad, 1.7 * uQuad * 0.55, r);
    c += mix(uCorona, vec3(1.0), 0.2) * streak * fall * edge * 0.18 * uShafts * g;
  }
  c *= uBright;
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(c, l * vec3(1.0, 0.38, 0.1) * 1.1, uAlert);    // alert last
  gl_FragColor = vec4(c, 1.0);
}`;

export function createSun(scene, ctx) {
  let ownNoise = null;
  let noise = ctx && ctx.noiseTex;
  if (!noise) {                                           // fallback so the module works standalone
    const N = 128, d = new Uint8Array(N * N * 4);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 255) | 0;
    ownNoise = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
    ownNoise.wrapS = ownNoise.wrapT = THREE.RepeatWrapping;
    ownNoise.magFilter = ownNoise.minFilter = THREE.LinearFilter;
    ownNoise.needsUpdate = true;
    noise = ownNoise;
  }
  const res = (ctx && ctx.res) || { value: new THREE.Vector2(1920, 1080) };
  const gRect = (ctx && ctx.guardRect) || { value: new THREE.Vector4(0.3, 0.3, 0.985, 0.93) };
  const gAmt = (ctx && ctx.guardAmt) || { value: 0.45 };
  const alert = (ctx && ctx.alert) || { value: 0 };
  const sunDir = (ctx && ctx.sunDir) || { value: new THREE.Vector3(-0.2, 0.1, -1).normalize() };

  const U = {
    uW: { value: new THREE.Vector4(1, 0, 0, 0) }, uMoon: { value: 0 },
    uColA: { value: new THREE.Color(1, 0.05, 0.45) }, uColB: { value: new THREE.Color(1, 0.82, 0.18) },
    uCorona: { value: new THREE.Color(1, 0.1, 0.6) },
    uQuad: { value: 1 }, uStripes: { value: 12 }, uStripePh: { value: 0 }, uCoronaK: { value: 1 },
    uEclOff: { value: 0 }, uRingTilt: { value: 0.35 }, uTwinOff: { value: 0.3 }, uTwinAng: { value: 0 },
    uMoonPhase: { value: 0.15 }, uShafts: { value: 0 }, uShaftPh: { value: 0 }, uBright: { value: 1 },
    uAlert: alert, uQ: { value: 1 }, uNoise: { value: noise },
    uRes: res, uGuardRect: gRect, uGuardAmt: gAmt,
  };
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    uniforms: U, vertexShader: VERT, fragmentShader: FRAG,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -8;
  mesh.frustumCulled = false;
  mesh.visible = true;
  scene.add(mesh);

  const P = Object.assign({}, SUN_DEFAULTS);
  let quality = 2, stripePh = 0, shaftPh = 0, twinAng = 0;
  const wrap = (v, per) => v - Math.floor(v / per) * per;
  const tmp = new THREE.Vector3();

  function setParams(p) {
    if (!p) return;
    for (const k in SUN_DEFAULTS) if (typeof p[k] === 'number') P[k] = p[k];
    U.uW.value.set(P.stripe, P.eclipse, P.ring, P.twin);
    U.uMoon.value = P.moon;
    if (p.colA) U.uColA.value.copy(p.colA);
    if (p.colB) U.uColB.value.copy(p.colB);
    if (p.coronaCol) U.uCorona.value.copy(p.coronaCol);
    U.uStripes.value = P.stripes;
    U.uCoronaK.value = P.corona;
    U.uEclOff.value = P.eclipseOffset;
    U.uRingTilt.value = P.ringTilt;
    U.uTwinOff.value = P.twinOffset;
    U.uMoonPhase.value = P.moonPhase;
    U.uBright.value = Math.min(P.bright, 1.2);
  }

  function update(dt, t, camera) {
    stripePh = wrap(stripePh + dt * P.stripeSpeed, 1);
    shaftPh = wrap(shaftPh + dt * 0.012, 1);
    twinAng = wrap(twinAng + dt * 0.05, TAU);
    U.uStripePh.value = stripePh;
    U.uShaftPh.value = shaftPh;
    U.uTwinAng.value = twinAng;
    const shafts = quality === 0 ? 0 : P.shafts;
    U.uShafts.value = shafts;
    U.uQuad.value = shafts > 0.002 ? SHAFT_SCALE : 1;
    mesh.scale.setScalar(BASE_SCALE * Math.max(P.size, 0.05) * U.uQuad.value);
    const c = camera.position;
    mesh.position.set(c.x + Math.sin(-P.yaw) * SUN_DIST, P.height, c.z - Math.cos(P.yaw) * SUN_DIST);
    mesh.lookAt(c.x, P.height, c.z);
    mesh.updateMatrixWorld();
    sunDir.value.copy(tmp.subVectors(mesh.position, c).normalize());
  }

  function getWorldPos(out) { return out.copy(mesh.position); }
  function setQuality(l) { quality = l; U.uQ.value = l >= 2 ? 1 : 0; }

  function dispose() {
    scene.remove(mesh);
    geo.dispose(); mat.dispose();
    if (ownNoise) ownNoise.dispose();
  }

  setParams({});
  return { mesh, setParams, update, getWorldPos, setQuality, dispose };
}
