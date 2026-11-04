// Living-environment terrain: three morphing wireframe ranges (ridge / dune / canyon / wave blend) + one instanced neon skyline.
// All height math is in the vertex shader; JS only accumulates wrapped phases (24/7 precision rule) and copies params into uniforms.
// Draw calls: 3 solid + 3 wire + 1 skyline = 7. ~15k terrain vertices per pass (one shared 241x21 grid).
import * as THREE from '../../../vendor/three/three.module.js';

const W = 4200, SEG_X = 240, SEG_Z = 20, CELL = W / SEG_X;           // vertex spacing 17.5 world units
const LAYERS = [                                                      // far -> near
  { z: -1300, depth: 300, height: 230, seed: 7.3, bias: 0.0, alpha: 0.30, fog: 0.55 },
  { z: -1050, depth: 260, height: 170, seed: 1.3, bias: 0.25, alpha: 0.35, fog: 0.38 },
  { z: -760, depth: 200, height: 95, seed: 4.7, bias: 0.6, alpha: 0.28, fog: 0.22 },
];
const NOISE_K = 0.004;            // noise lattice units per world unit
const PERIOD = 1000;              // noise lattice period; scroll/morph wrap here seamlessly
const SKY_N = 64, SKY_X = -560, SKY_Z = -830;
const TAU = Math.PI * 2;

const DEFAULTS = {
  ridge: 1, dune: 0, canyon: 0, wave: 0, amp: 1, freq: 1, scroll: 0.5, morphSeed: 0,
  wireColA: new THREE.Color(0.9, 0.1, 0.9), wireColB: new THREE.Color(0.0, 0.6, 1.0), wireAmt: 1,
  solidCol: new THREE.Color('#07011a'), pulseAmt: 0.4, pulseSpeed: 1,
  skyline: 0.6, skylineCol: new THREE.Color(0.0, 0.8, 1.0), windowCol: new THREE.Color('#ffc46b'), windowRate: 0.5, flicker: 0.5,
};

const NOISE_GLSL = /* glsl */`
float th12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// periodic value noise (period per in lattice units), quintic fade
float tvn(vec2 p, float per){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 i0 = mod(i, per), i1 = mod(i + 1.0, per);
  float a = th12(i0), b = th12(vec2(i1.x, i0.y)), c = th12(vec2(i0.x, i1.y)), d = th12(i1);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float tfbm(vec2 p){ float s = 0.0, a = 0.5, per = ${PERIOD.toFixed(1)};
  for (int i = 0; i < 4; i++){ s += a * tvn(p, per); p *= 2.0; per *= 2.0; a *= 0.5; } return s / 0.9375; }
float tridged(vec2 p){ float s = 0.0, a = 0.5, per = ${PERIOD.toFixed(1)};
  for (int i = 0; i < 4; i++){ float n = 1.0 - abs(tvn(p, per) * 2.0 - 1.0); s += a * n * n; p *= 2.0; per *= 2.0; a *= 0.55; } return s / 0.8; }
`;

const GUARD_GLSL = /* glsl */`
uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
float guard(){ vec2 q = gl_FragCoord.xy / uRes; vec2 m = smoothstep(uGuardRect.xy - 0.08, uGuardRect.xy, q) * (1.0 - smoothstep(uGuardRect.zw, uGuardRect.zw + 0.08, q)); return 1.0 - uGuardAmt * m.x * m.y; }
`;

const TERRAIN_VERT = /* glsl */`
uniform float uW, uD, uH, uSeed, uOffX, uNoiseOff, uMorph, uValleyX;
uniform vec4 uMix;            // ridge, dune, canyon, wave
uniform float uAmp, uFreq;
uniform vec4 uWPh;            // 4 swell phases (JS-wrapped at 2pi)
varying float vH; varying float vX; varying float vBack;
${NOISE_GLSL}
float shape(vec2 n, vec2 wp, float back){
  float h = 0.0;
  if (uMix.x > 0.002) h += uMix.x * tridged(n);
  if (uMix.y > 0.002){
    float d = fract(n.x * 1.2 + 0.45 * tfbm(n * 0.7 + 3.1));
    float dune = smoothstep(0.0, 0.82, d) * (1.0 - smoothstep(0.82, 1.0, d));
    float swell = 0.5 + 0.5 * sin(n.x * 6.2831853 * 0.4 + uSeed);
    h += uMix.y * (0.55 * dune + 0.3 * swell + 0.25 * tfbm(n * 2.0)) * 0.85;
  }
  if (uMix.z > 0.002){
    float b = tfbm(n * 0.8 + 11.0); float t = b * 4.5;
    float terr = (floor(t) + smoothstep(0.72, 1.0, fract(t))) / 4.5;
    h += uMix.z * pow(clamp(terr * 1.25 - 0.1, 0.0, 1.0), 1.3);
  }
  if (uMix.w > 0.002){
    float s = 0.0;
    s += 0.40 * sin(dot(wp, vec2(0.0110, 0.0300)) + uWPh.x);
    s += 0.28 * sin(dot(wp, vec2(-0.0170, 0.0210)) + uWPh.y);
    s += 0.20 * sin(dot(wp, vec2(0.0260, 0.0450)) + uWPh.z);
    s += 0.12 * sin(dot(wp, vec2(-0.0410, 0.0520)) + uWPh.w);
    float wv = 0.5 + 0.5 * s; wv = pow(wv, 1.6);            // sharp crests
    h += uMix.w * wv * (0.35 + 0.65 * back);
  }
  return h;
}
void main(){
  vec3 p = position;                                   // unit plane: x -0.5..0.5, z -0.5..0.5 (after rotateX)
  float lx = p.x * uW, lz = p.z * uD;
  float wx = lx + uOffX;                               // world x
  float back = 0.5 - p.z;                              // 0 front .. 1 back
  vec2 n = vec2((lx * uFreq) * ${NOISE_K} + uNoiseOff, uMorph + uSeed * 13.0 + back * 0.6);
  vec2 wp = vec2(wx, lz);
  // Gerstner-ish horizontal crowding of wave crests
  if (uMix.w > 0.002) lx += uMix.w * 6.0 * cos(dot(wp, vec2(0.0110, 0.0300)) + uWPh.x);
  float env = sin(min(1.0, back * 1.25) * 3.14159265);
  env = mix(env, 0.55 + 0.45 * min(1.0, back * 2.0), uMix.w * 0.8);
  float valley = smoothstep(140.0, 620.0, abs(wx - uValleyX));
  float h01 = shape(n, wp, back) * env * (0.25 + 0.75 * valley);
  vH = clamp(h01, 0.0, 1.0); vX = wx; vBack = back;
  vec3 pos = vec3(lx, h01 * uH * uAmp, lz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const WIRE_FRAG = /* glsl */`
uniform vec3 uColA, uColB; uniform float uWireAmt, uLayerAlpha, uBias, uAlert;
uniform float uPulseX, uPulseStr, uGlowPh;
varying float vH; varying float vX; varying float vBack;
${GUARD_GLSL}
void main(){
  vec3 c = mix(uColA, uColB, clamp(vH * 0.6 + uBias, 0.0, 1.0));
  float a = uWireAmt * uLayerAlpha * (0.55 + 0.45 * vH) * (0.6 + 0.4 * vBack);
  float glow = 0.5 + 0.5 * sin(vX * 0.0035 - uGlowPh);
  a *= 0.8 + 0.35 * glow * glow;
  float band = exp(-pow((vX - uPulseX) / 90.0, 2.0)) * uPulseStr;
  c = mix(c, vec3(1.0, 0.85, 1.0), clamp(band * 0.5, 0.0, 0.6));
  a = min(a + band * 0.35, 0.6);
  a *= guard();
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  c = mix(c, vec3(1.0, 0.1, 0.15) * (0.6 + l), uAlert);
  gl_FragColor = vec4(c, a);
}`;

const SOLID_FRAG = /* glsl */`
uniform vec3 uSolid, uFog; uniform float uLayerFog, uAlert;
varying float vH; varying float vX; varying float vBack;
void main(){
  float k = uLayerFog * (1.0 - vH * 0.6);
  vec3 c = mix(uSolid, uFog * 0.7, k);
  c = mix(c, vec3(0.05, 0.0, 0.01), uAlert * 0.8);
  gl_FragColor = vec4(c, 1.0);
}`;

const SKY_VERT = /* glsl */`
attribute vec4 aBox;   // x, z, w, d
attribute vec3 aInfo;  // height, hue, id-hash
uniform float uSky;
varying vec3 vL; varying vec3 vSize; varying vec3 vInfo; varying vec2 vFace;
void main(){
  float grow = clamp(uSky * 1.6 - aInfo.z * 0.6, 0.0, 1.0);
  float h = max(aInfo.x * grow * min(uSky * 1.5, 1.0), 0.01);
  vec3 size = vec3(aBox.z, h, aBox.w);
  vec3 p = position * size + vec3(aBox.x, 0.0, aBox.y);
  vL = position; vSize = size; vInfo = aInfo;
  vec3 ap = abs(vec3(position.x, position.y - 0.5, position.z));
  // face coords (world units): x/z faces use (z|x, y)
  vFace = (ap.x > ap.z) ? vec2(p.z, p.y) : vec2(p.x, p.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uSkyCol, uWinCol, uAccentA, uFog; uniform float uWinPh, uWinRate, uFlickPh, uFlicker, uDetail, uAlert;
varying vec3 vL; varying vec3 vSize; varying vec3 vInfo; varying vec2 vFace;
float sh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
${GUARD_GLSL}
void main(){
  // distance to box edges in world units -> second-smallest is the edge distance on this face
  vec3 d = (0.5 - abs(vec3(vL.x, vL.y - 0.5, vL.z))) * vSize;
  float mn = min(d.x, min(d.y, d.z)), mx = max(d.x, max(d.y, d.z));
  float mid = d.x + d.y + d.z - mn - mx;
  float fw = fwidth(mid) + 0.001;
  float edge = 1.0 - smoothstep(0.35, 0.35 + fw * 1.5, mid);
  vec3 tint = mix(uSkyCol, uAccentA, vInfo.y * 0.6);
  vec3 c = mix(uSkyCol * 0.03 + vec3(0.012, 0.004, 0.03), uFog * 0.35, 0.3);
  float top = step(vL.y, 0.999);
  if (uDetail > 0.5 && top > 0.5 && vL.y * vSize.y > 3.0){
    vec2 cell = floor(vFace / vec2(3.0, 4.0)); vec2 f = fract(vFace / vec2(3.0, 4.0));
    float win = step(f.x, 0.62) * step(0.25, f.y) * step(f.y, 0.85);
    float id = vInfo.z * 97.0;
    float h1 = sh(cell + id), h2 = sh(cell * 1.7 + id + 5.3);
    float k = floor(uWinPh * (0.15 + h2 * 0.5) + h1 * 17.0);
    float lit = step(0.86 - 0.3 * uWinRate, sh(cell + id + k * 3.17));
    c += uWinCol * 0.34 * win * lit * (0.6 + 0.4 * h2);
    // neon sign band near the roof on some towers, flickering
    if (vInfo.z > 0.8){
      float yTop = vSize.y * (1.0 - vL.y);
      float sign = step(2.0, yTop) * step(yTop, 6.0);
      float off = step(0.97 - 0.12 * uFlicker, sh(vec2(floor(uFlickPh * 8.0), id)));
      c += mix(uAccentA, uWinCol, 0.3) * 0.3 * sign * (1.0 - off);
    }
  }
  c += tint * 0.32 * edge;
  c *= guard();
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  c = mix(c, vec3(1.0, 0.1, 0.15) * l * 1.4 + vec3(0.03, 0.0, 0.0), uAlert);
  gl_FragColor = vec4(c, 1.0);
}`;

function buildWireIndex() {
  const idx = [], cols = SEG_X + 1;
  for (let j = 0; j <= SEG_Z; j++) for (let i = 0; i < SEG_X; i++) idx.push(j * cols + i, j * cols + i + 1);   // rows
  for (let i = 0; i <= SEG_X; i++) for (let j = 0; j < SEG_Z; j++) idx.push(j * cols + i, (j + 1) * cols + i); // columns
  return idx;
}

export function createTerrain(scene, ctx) {
  const alert = ctx.alert || { value: 0 };
  const res = ctx.res || { value: new THREE.Vector2(1920, 1080) };
  const guardRect = ctx.guardRect || { value: new THREE.Vector4(0.30, 0.30, 0.985, 0.93) };
  const guardAmt = ctx.guardAmt || { value: 0.45 };
  const fogCol = ctx.fogCol || { value: new THREE.Color(0.13, 0.015, 0.13) };
  const accentA = ctx.accent || { value: new THREE.Color('#ff2bd6') };
  const P = {};
  for (const k in DEFAULTS) P[k] = DEFAULTS[k] instanceof THREE.Color ? DEFAULTS[k].clone() : DEFAULTS[k];

  // shared uniforms
  const U = {
    uMix: { value: new THREE.Vector4(1, 0, 0, 0) }, uAmp: { value: 1 }, uFreq: { value: 1 },
    uWPh: { value: new THREE.Vector4() }, uNoiseOff: { value: 0 }, uMorph: { value: 0 }, uOffX: { value: 0 },
    uColA: { value: P.wireColA.clone() }, uColB: { value: P.wireColB.clone() }, uWireAmt: { value: 1 },
    uSolid: { value: P.solidCol.clone() }, uFog: fogCol, uAlert: alert,
    uPulseX: { value: -1e5 }, uPulseStr: { value: 0 }, uGlowPh: { value: 0 },
    uRes: res, uGuardRect: guardRect, uGuardAmt: guardAmt,
  };

  const group = new THREE.Group();
  group.name = 'env-terrain';
  const geo = new THREE.PlaneGeometry(1, 1, SEG_X, SEG_Z);
  geo.rotateX(-Math.PI / 2);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', geo.attributes.position);
  wireGeo.setIndex(buildWireIndex());

  const layers = LAYERS.map((L) => {
    const lu = { uW: { value: W }, uD: { value: L.depth }, uH: { value: L.height }, uSeed: { value: L.seed }, uValleyX: { value: 330 },
      uBias: { value: L.bias }, uLayerAlpha: { value: L.alpha }, uLayerFog: { value: L.fog } };
    const uniforms = { ...U, ...lu };
    const solidMat = new THREE.ShaderMaterial({ uniforms, vertexShader: TERRAIN_VERT, fragmentShader: SOLID_FRAG,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const wireMat = new THREE.ShaderMaterial({ uniforms, vertexShader: TERRAIN_VERT, fragmentShader: WIRE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const solid = new THREE.Mesh(geo, solidMat), wire = new THREE.LineSegments(wireGeo, wireMat);
    solid.renderOrder = -7; wire.renderOrder = -6;
    solid.frustumCulled = wire.frustumCulled = false;
    solid.position.z = wire.position.z = L.z;
    group.add(solid, wire);
    return { L, lu, solid, wire };
  });

  // ---- skyline: one InstancedMesh of 64 boxes ----
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
  boxGeo.deleteAttribute('normal'); boxGeo.deleteAttribute('uv');
  const aBox = new Float32Array(SKY_N * 4), aInfo = new Float32Array(SKY_N * 3);
  {
    let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < SKY_N; i++) {
      const row = i % 3;
      aBox[i * 4] = SKY_X + (i / SKY_N) * 620 + (rnd() - 0.5) * 12;
      aBox[i * 4 + 1] = SKY_Z - row * 45 - rnd() * 30;
      aBox[i * 4 + 2] = 10 + rnd() * 20; aBox[i * 4 + 3] = 10 + rnd() * 18;
      const edgeFade = 1 - Math.pow(Math.abs(i / SKY_N - 0.35) / 0.65, 2) * 0.6;
      aInfo[i * 3] = (14 + Math.pow(rnd(), 2.2) * 110) * (0.7 + 0.3 * row) * edgeFade;
      aInfo[i * 3 + 1] = rnd(); aInfo[i * 3 + 2] = rnd();
    }
  }
  boxGeo.setAttribute('aBox', new THREE.InstancedBufferAttribute(aBox, 4));
  boxGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(aInfo, 3));
  const skyU = {
    uSky: { value: P.skyline }, uSkyCol: { value: P.skylineCol.clone() }, uWinCol: { value: P.windowCol.clone() }, uAccentA: accentA,
    uFog: fogCol, uWinPh: { value: 0 }, uWinRate: { value: P.windowRate }, uFlickPh: { value: 0 }, uFlicker: { value: P.flicker },
    uDetail: { value: 1 }, uAlert: alert, uRes: res, uGuardRect: guardRect, uGuardAmt: guardAmt,
  };
  const skyMat = new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG });
  const skyline = new THREE.InstancedMesh(boxGeo, skyMat, SKY_N);
  skyline.renderOrder = -6; skyline.frustumCulled = false;
  group.add(skyline);
  scene.add(group);

  // ---- phases (JS-accumulated, wrapped) ----
  let scroll = 0, morph = 0, glow = 0, winPh = 0, flickPh = 0;
  const wph = [0, 0, 0, 0], wRates = [0.42, 0.31, 0.57, 0.83];
  let pulseX = 0, pulseStr = 0, pulseOn = false;
  let valleyX = null;
  let camX = 0;

  function copyCol(dst, src) { if (src == null) return; if (src.isColor) dst.copy(src); else dst.set(src); }

  function setParams(p) {
    if (!p) return;
    for (const k in DEFAULTS) {
      if (p[k] === undefined) continue;
      if (P[k] instanceof THREE.Color) copyCol(P[k], p[k]); else P[k] = p[k];
    }
    let sum = P.ridge + P.dune + P.canyon + P.wave; if (sum < 1e-4) sum = 1;
    U.uMix.value.set(P.ridge / sum, P.dune / sum, P.canyon / sum, P.wave / sum);
    U.uAmp.value = P.amp; U.uFreq.value = P.freq;
    U.uColA.value.copy(P.wireColA); U.uColB.value.copy(P.wireColB); U.uWireAmt.value = P.wireAmt;
    U.uSolid.value.copy(P.solidCol);
    skyU.uSky.value = P.skyline; skyU.uSkyCol.value.copy(P.skylineCol); skyU.uWinCol.value.copy(P.windowCol);
    skyU.uWinRate.value = P.windowRate; skyU.uFlicker.value = P.flicker;
    skyline.count = P.skyline < 0.01 ? 0 : SKY_N;
  }

  function update(dt, t, camera) {
    dt = Math.min(dt, 0.1);
    const c = camera.position;
    camX = c.x;
    const snap = Math.round(c.x / CELL) * CELL;      // world-fixed wire columns while following the camera
    U.uOffX.value = snap;
    for (const ly of layers) { ly.solid.position.x = ly.wire.position.x = snap; }
    scroll = (scroll + dt * 0.004 * P.scroll) % PERIOD;
    U.uNoiseOff.value = ((snap * P.freq * 0.004 + scroll) % PERIOD + PERIOD) % PERIOD;
    morph = (morph + dt * 0.0012) % PERIOD;                 // slower idle morph (subtle)
    U.uMorph.value = (morph + P.morphSeed * 1.2) % PERIOD;   // was *7: mood blends rebuilt whole ranges
    for (let i = 0; i < 4; i++) wph[i] = (wph[i] + dt * wRates[i] * (0.5 + 0.5 * P.scroll)) % TAU;
    U.uWPh.value.set(wph[0], wph[1], wph[2], wph[3]);
    glow = (glow + dt * 0.35) % TAU; U.uGlowPh.value = glow;
    winPh = (winPh + dt * (0.2 + P.windowRate)) % PERIOD; skyU.uWinPh.value = winPh;
    flickPh = (flickPh + dt) % 100; skyU.uFlickPh.value = flickPh;

    // valley: project the sun direction onto each layer's plane (sun.js writes ctx.sunDir before terrain.update)
    const sd = ctx.sunDir && ctx.sunDir.value;
    for (const ly of layers) {
      const dz = c.z - ly.L.z;
      let vx;
      if (sd && sd.z < -0.05) vx = c.x + (sd.x / -sd.z) * dz;
      else if (valleyX != null) vx = c.x + (valleyX - c.x) * (dz / 1470);
      else vx = c.x + 330;
      ly.lu.uValleyX.value = vx;
    }

    // pulse sweep across the ranges, left -> right relative to camera
    if (pulseOn) {
      pulseX += dt * 650 * P.pulseSpeed;
      pulseStr = Math.max(0, pulseStr - dt * 0.18);
      if (pulseX > W * 0.5 || pulseStr <= 0) { pulseOn = false; pulseStr = 0; }
    }
    U.uPulseX.value = pulseOn ? c.x + pulseX : -1e5;
    U.uPulseStr.value = pulseStr * (0.4 + 0.6 * P.pulseAmt);

    skyline.position.x = c.x; skyline.position.z = c.z * 0.2;
  }

  return {
    group,
    setParams,
    update,
    setValley(worldX) { valleyX = worldX; },
    pulse(strength = 1) { pulseOn = true; pulseX = -W * 0.5 + 600; pulseStr = Math.min(1.5, strength); },
    setQuality(level) { skyU.uDetail.value = level > 0 ? 1 : 0; },
    getParams() { return P; },
    dispose() {
      scene.remove(group);
      for (const ly of layers) { ly.solid.material.dispose(); ly.wire.material.dispose(); }
      geo.dispose(); wireGeo.dispose(); boxGeo.dispose(); skyMat.dispose(); skyline.dispose();
    },
  };
}
