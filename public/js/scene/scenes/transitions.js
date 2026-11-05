// Scene-to-scene transitions: 8 fullscreen ShaderMaterials sampling tA (outgoing) and tB (incoming) at half
// resolution, plus the MorphCloud (16k GPU points flying from A's shapes into B's). Each shader eases uP itself.
// Transition-added light (rims, flashes, streaks) is multiplied by guard() and the hologram rect is luma-capped at
// 2.5, so holograms drawn on top stay readable. uLite (0/1) halves the tap counts (uniform-bounded loops).
import * as THREE from '../../../vendor/three/three.module.js';

export const TRANSITIONS = {
  morph: { dur: 3.2, peak: 0.5 },
  warp: { dur: 2.4, peak: 0.45 },
  vhs: { dur: 2.0, peak: 0.5 },
  scanwipe: { dur: 1.8, peak: 0.5 },
  inkbleed: { dur: 2.8, peak: 0.5 },
  gridfold: { dur: 2.6, peak: 0.5 },
  wormhole: { dur: 2.8, peak: 0.5 },
  whip: { dur: 2.0, peak: 0.5 },
};
export const TRANSITION_TYPES = Object.keys(TRANSITIONS);

const VS = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const HEAD = /* glsl */`
precision highp float;
uniform sampler2D tA, tB, uNoise;
uniform float uP, uTime, uAlert, uGuardAmt, uLite;
uniform vec2 uRes, uOrigin;
uniform vec3 uColA, uColB;
uniform vec4 uGuardRect;
varying vec2 vUv;
const float PI = 3.14159265;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ return texture2D(uNoise, p / 256.).r; }
float fbm3(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 3; i++) { v += a * vn(p * 64.); p = p * 2.03 + 7.7; a *= .5; } return v / .875; }
float gmask(){ vec2 q = gl_FragCoord.xy / uRes; vec2 m = smoothstep(uGuardRect.xy - .08, uGuardRect.xy, q) * (1. - smoothstep(uGuardRect.zw, uGuardRect.zw + .08, q)); return m.x * m.y; }
float guard(){ return 1. - uGuardAmt * gmask(); }
float e3(float x){ x = clamp(x, 0., 1.); return x * x * (3. - 2. * x); }
float eIn(float x){ x = clamp(x, 0., 1.); return x * x * x; }
float eOut(float x){ x = clamp(x, 0., 1.); return 1. - pow(1. - x, 3.); }
vec3 A(vec2 uv){ return texture2D(tA, clamp(uv, .001, .999)).rgb; }
vec3 B(vec2 uv){ return texture2D(tB, clamp(uv, .001, .999)).rgb; }
vec3 alertTint(vec3 c){ float l = dot(c, vec3(.2126, .7152, .0722)); return mix(c, vec3(1., .1, .05) * l * 1.4, uAlert * .8); }
vec3 done(vec3 c){ float l = dot(c, vec3(.2126, .7152, .0722)); float cap = mix(1e3, 2.5, gmask()); c *= l > cap ? cap / l : 1.; return max(c, 0.); }
`;
const accent = 'alertTint(mix(uColA, uColB, uP))';

const FRAG = {
  // noise-threshold dissolve along the cloud's density, thin accent rim
  morph: `void main(){
  vec2 uv = vUv; float asp = uRes.x / uRes.y;
  float n = fbm3(uv * vec2(asp, 1.) * 2.2 + uTime * .03);
  float d = length((uv - uOrigin) * vec2(asp, 1.));
  float f = n * .75 + d * .25;
  float edge = mix(-.08, 1.08, e3((uP - .3) / .45));
  float m = smoothstep(edge + .035, edge - .035, f);
  vec3 col = mix(A(uv), B(uv), m);
  float rim = exp(-abs(f - edge) * 70.) * step(.01, uP) * step(uP, .99);
  col += ${accent} * rim * 1.6 * guard();
  gl_FragColor = vec4(done(col), 1.);
}`,
  // hyperspace: zoom blur + streaks into A, flash + split + ring at the peak, B arrives from over-zoom
  warp: `void main(){
  vec2 uv = vUv; float asp = uRes.x / uRes.y; const float PK = .45;
  vec2 d = uv - uOrigin;
  float pA = eIn(uP / PK), pB = eOut((uP - PK) / (1. - PK));
  bool inA = uP < PK;
  float s = inA ? pA * .4 : (1. - pB) * .3;
  vec2 dd = inA ? d : d / mix(1.25, 1., pB);
  float taps = uLite > .5 ? 4. : 8.;
  vec3 col = vec3(0.); float w = 0.;
  for (int i = 0; i < 8; i++) {
    float fi = float(i); if (fi >= taps) break;
    float k = 1. - s * fi / taps;
    vec2 q = uOrigin + dd * k;
    col += inA ? A(q) : B(q); w += 1.;
  }
  col /= w;
  float near = exp(-pow((uP - PK) * 9., 2.));
  vec2 c2 = uOrigin + dd * (1. - .03 * near);
  vec3 split = inA ? A(c2) : B(c2);
  col.r = mix(col.r, split.r, near); col.b = mix(col.b, (inA ? A(uOrigin + dd * (1. + .03 * near)) : B(uOrigin + dd * (1. + .03 * near))).b, near);
  vec2 pd = d * vec2(asp, 1.); float r = length(pd), ang = atan(pd.y, pd.x);
  float cell = floor(ang * 38.); float h = hash12(vec2(cell, 3.1));
  float head = fract(h * 7.3 + uTime * (.6 + h) * (1. + 3. * pA));
  float len = .02 + .5 * pA * pA + .2 * (1. - pB) * step(PK, uP);
  float streak = smoothstep(len, 0., abs(r - head * 1.4) ) * step(.82, hash12(vec2(cell, 9.7))) * smoothstep(.03, .12, r);
  float streakAmt = inA ? pA : (1. - pB) * .7;
  col += mix(vec3(.6, .95, 1.), ${accent}, .4) * streak * streakAmt * 1.4 * guard();
  float flash = exp(-pow((uP - PK) * 18., 2.)) * .6;
  float ring = exp(-pow((r - (uP - PK) * 3.2) * 22., 2.)) * step(PK, uP) * (1. - pB);
  col += (vec3(.7, 1., 1.) * flash * (1. - .7 * gmask()) + ${accent} * ring * 1.5) * guard();
  gl_FragColor = vec4(done(col), 1.);
}`,
  // VHS tracking band, datamosh blocks, head-switch stripe, saturation crush
  vhs: `void main(){
  vec2 uv = vUv; vec2 px = gl_FragCoord.xy;
  float bc = mix(-.25, 1.25, uP), band = 1. - smoothstep(0., .16, abs(uv.y - bc));
  float tq = floor(uTime * 30.);
  float row = floor(px.y / 4.);
  float disp = (hash12(vec2(row, tq)) - .5) * .12 * band;
  float head = step(uv.y, .035) * exp(-pow((uP - .5) * 5., 2.));
  disp += (hash12(vec2(row, tq + 3.)) - .5) * .2 * head;
  vec2 q = uv + vec2(disp, 0.);
  vec2 blk = floor(px / 16.); float hb = hash12(blk);
  float mixB = step(hb, e3((uP - .12) / .76));
  vec2 bq = (blk * 16. + 8.) / uRes;
  vec2 o = vec2(16. / uRes.x, 0.), o2 = vec2(0., 16. / uRes.y);
  float lA = dot(A(bq), vec3(.333)), gx = dot(A(bq + o), vec3(.333)) - lA, gy = dot(A(bq + o2), vec3(.333)) - lA;
  float mosh = sin(PI * clamp(uP, 0., 1.));
  vec2 qB = q - vec2(gx, gy) * .35 * mosh;
  qB = mix(qB, floor(qB * uRes / 16.) * 16. / uRes, mosh * .7);
  float sp = .012 * band + .004 * mosh;
  vec3 a = vec3(A(q + vec2(sp, 0.)).r, A(q).g, A(q - vec2(sp, 0.)).b);
  vec3 b = uLite > .5 ? B(qB) : vec3(B(qB + vec2(sp, 0.)).r, B(qB).g, B(qB - vec2(sp, 0.)).b);
  vec3 col = mix(a, b, mixB);
  float crush = exp(-pow((uP - .5) * 6., 2.)) * .65;
  col = mix(col, vec3(dot(col, vec3(.2126, .7152, .0722))), crush);
  float noise = hash12(px * .5 + tq) * band * .35;
  col += (vec3(noise) * .6 + ${accent} * band * .08 + vec3(.8, .9, 1.) * head * hash12(vec2(row, tq + 9.)) * .4) * guard();
  gl_FragColor = vec4(done(col), 1.);
}`,
  // interlaced diagonal scanline wipe with chromatic split and phosphor afterglow
  scanwipe: `void main(){
  vec2 uv = vUv; float asp = uRes.x / uRes.y;
  float f = (1. - uv.y) * .92 + (uv.x - .5) * .2126 * asp * .5;
  float pos = mix(-.2, 1.2, e3(uP));
  float odd = mod(floor(gl_FragCoord.y / 2.), 2.);
  float posR = pos + (odd > .5 ? .06 : -.06) * sin(PI * clamp(uP, 0., 1.));
  float behind = posR - f;
  float rev = step(0., behind);
  float sp = .015 * exp(-max(behind, 0.) * 14.) * rev;
  vec3 b = uLite > .5 ? B(uv + vec2(sp, 0.)) : vec3(B(uv + vec2(sp, 0.)).r, B(uv).g, B(uv - vec2(sp, 0.)).b);
  vec3 col = mix(A(uv), b, rev);
  float lw = 2. / uRes.y;
  float line = exp(-pow((f - pos) / lw, 2.));
  float glow = exp(-max(behind, 0.) / .04) * rev * .5;
  col += (${accent} * (line * 2. + glow) + vec3(1.) * line * .4) * guard();
  gl_FragColor = vec4(done(col), 1.);
}`,
  // ink bleed from the hologram point: noisy front, glowing rim, ripples refract A ahead of it
  inkbleed: `void main(){
  vec2 uv = vUv; float asp = uRes.x / uRes.y;
  vec2 dv = (uv - uOrigin) * vec2(asp, 1.);
  float dd = length(dv) + (fbm3(uv * 3. + uTime * .05) - .5) * .25;
  float r = e3((uP - .15) / .7) * 1.9 - .05;   // front reaches mid-screen at the peak, as B fades in
  float inside = smoothstep(r + .01, r - .01, dd);
  float ahead = smoothstep(r + .45, r, dd) * (1. - inside);
  vec2 dir = normalize(dv + 1e-5) / vec2(asp, 1.);
  vec2 qa = uv + dir * sin(dd * 80. - uTime * 8.) * .004 * ahead;
  vec3 col = mix(A(qa), B(uv), inside);
  float rim = exp(-abs(dd - r) * 55.) * step(.005, uP) * step(uP, .995);
  col += (alertTint(uColB) * rim * 1.8 + alertTint(uColA) * ahead * .05 * (.5 + .5 * sin(dd * 80. - uTime * 8.))) * guard();
  gl_FragColor = vec4(done(col), 1.);
}`,
  // 16x9 tiles flip around their vertical axis, staggered diagonally from the right edge
  gridfold: `void main(){
  vec2 uv = vUv; vec2 G = vec2(16., 9.);
  vec2 id = floor(uv * G), lc = fract(uv * G);
  float st = (1. - id.x / 15.) * .9 + (id.y / 8.) * .3;
  float ang = clamp(uP * 2.2 - st, 0., 1.) * PI;
  float c = cos(ang), sn = sin(ang);
  float lx = (lc.x - .5) / max(abs(c), .02) + .5;
  float ly = (lc.y - .5) * (1. + .18 * sn * (lx - .5) * sign(c)) + .5;
  vec3 col = vec3(.008, .002, .03);
  if (lx >= 0. && lx <= 1. && ly >= 0. && ly <= 1.) {
    vec2 q = (id + vec2(c >= 0. ? lx : 1. - lx, ly)) / G;
    col = (c >= 0. ? A(q) : B(q)) * (.35 + .65 * abs(c));
    float edge = max(smoothstep(.06, 0., lx), smoothstep(.94, 1., lx)) + max(smoothstep(.04, 0., ly), smoothstep(.96, 1., ly)) * .5;
    vec3 ec = mod(id.x + id.y, 2.) > .5 ? vec3(1., .17, .84) : vec3(0., .94, 1.);
    col += alertTint(ec) * edge * sn * 1.4 * guard();
  }
  gl_FragColor = vec4(done(col), 1.);
}`,
  // polar twirl into a vortex at uOrigin; tunnel rings; B unspools from the eye
  wormhole: `void main(){
  vec2 uv = vUv; float asp = uRes.x / uRes.y;
  vec2 d = (uv - uOrigin) * vec2(asp, 1.);
  float r = length(d), a = atan(d.y, d.x);
  float eA = e3(uP / .5), eB = e3((uP - .5) / .5);
  bool inA = uP < .5;
  float tw = inA ? eA : 1. - eB;
  float rr = r * (1. + 2.2 * tw);
  float aa = a + pow(max(1. - r, 0.), 2.) * tw * 9. * (inA ? 1. : -1.);
  vec2 q = uOrigin + vec2(cos(aa), sin(aa)) * rr / vec2(asp, 1.);
  vec3 col = inA ? A(q) : B(q);
  float eye = smoothstep(.0, .15 + .2 * tw, r);
  col *= mix(1., eye, tw);
  float env = sin(PI * clamp(uP, 0., 1.));
  float rings = pow(.5 + .5 * sin(log(r + 1e-3) * 20. - uTime * 12.), 8.) * env * smoothstep(.02, .2, r);
  col += ${accent} * rings * .9 * guard();
  gl_FragColor = vec4(done(col), 1.);
}`,
  // camera whip-pan: A slides off left, B slides in from the right under a horizontal motion blur + speed lines
  whip: `void main(){
  vec2 uv = vUv;
  float S = e3(uP) * 1.04;
  float blur = pow(sin(PI * clamp(uP, 0., 1.)), 2.);
  float taps = uLite > .5 ? 5. : 10.;
  vec3 col = vec3(0.); float w = 0.;
  for (int i = 0; i < 10; i++) {
    float fi = float(i); if (fi >= taps) break;
    float x = uv.x + S + (fi / (taps - 1.) - .5) * blur * .12;
    vec3 c = x < 1. ? A(vec2(x, uv.y)) : (x < 1.04 ? vec3(.0) : B(vec2(x - 1.04, uv.y)));
    col += c; w += 1.;
  }
  col /= w;
  float row = floor(gl_FragCoord.y / 3.);
  float hs = hash12(vec2(row, 1.7));
  float lineX = fract(uv.x * (.6 + hs) + uTime * (3. + hs * 4.) + hs * 9.);
  float sl = step(.93, hs) * smoothstep(.6, 1., lineX) * blur;
  col += ${accent} * sl * 1.2 * guard();
  gl_FragColor = vec4(done(col), 1.);
}`,
};

const CLOUD_VS = /* glsl */`
attribute vec3 aFrom, aTo; attribute float aSeed;
uniform float uP, uTime, uSize, uScale; uniform vec3 uVortex, uColA, uColB; uniform vec2 uRes;
varying vec3 vCol; varying float vA;
vec3 h3(float s){ vec3 p3 = fract(vec3(s) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
void main(){
  vec3 r = h3(aSeed * 1000. + 1.);
  float p1 = smoothstep(0., .45, uP);
  float ang = r.x * 6.28318 + uTime * (1.2 + r.y) + p1 * 6.;
  float rad = (40. + r.y * 220.) * uScale;
  vec3 vort = uVortex + vec3(cos(ang) * rad, (r.z - .5) * 160. * uScale + sin(ang * 2. + r.x * 9.) * 20., sin(ang) * rad * .45);
  vec3 curl = vec3(sin(aFrom.y * .02 + uTime * 1.7 + r.x * 6.), sin(aFrom.z * .02 + uTime * 1.3 + r.y * 6.), sin(aFrom.x * .02 + uTime * 1.1 + r.z * 6.)) * 60. * sin(3.14159 * p1);
  vec3 pos = mix(aFrom, vort, p1 * p1 * (3. - 2. * p1)) + curl;
  float w = smoothstep(.55 + r.x * .2, .75 + r.x * .25, uP);
  pos = mix(pos, aTo, w);
  vec4 mv = viewMatrix * vec4(pos, 1.);
  gl_Position = projectionMatrix * mv;
  float flare = exp(-pow((uP - .5) * 7., 2.));
  vCol = mix(uColA, uColB, smoothstep(.3, .7, uP)) * (1. + 1.2 * flare);
  vA = smoothstep(0., .06, uP) * (1. - smoothstep(.82, 1., uP)) * (.5 + .5 * r.z);
  gl_PointSize = clamp(uSize * (1. + flare) * uRes.y / 1080., 1., 48.);
}`;
const CLOUD_FS = /* glsl */`
uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt, uAlert;
varying vec3 vCol; varying float vA;
float guard(){ vec2 q = gl_FragCoord.xy / uRes; vec2 m = smoothstep(uGuardRect.xy - .08, uGuardRect.xy, q) * (1. - smoothstep(uGuardRect.zw, uGuardRect.zw + .08, q)); return 1. - uGuardAmt * m.x * m.y; }
void main(){
  vec2 c = gl_PointCoord - .5; float d = dot(c, c);
  float a = smoothstep(.25, .0, d) * vA;
  vec3 col = vCol; float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(col, vec3(1., .12, .05) * l * 1.4, uAlert * .8);
  gl_FragColor = vec4(col * a * guard(), 1.);
}`;

/** Build every transition material, the fullscreen quad that draws them and the morph cloud. */
export function createTransitions({ res, guardRect, guardAmt, alert, noise, time }) {
  const U = {
    tA: { value: null }, tB: { value: null }, uNoise: { value: noise },
    uP: { value: 0 }, uTime: { value: 0 }, uAlert: alert, uGuardAmt: guardAmt, uLite: { value: 0 },
    uRes: res, uOrigin: { value: new THREE.Vector2(0.28, 0.62) },
    uColA: { value: new THREE.Color('#ff2bd6') }, uColB: { value: new THREE.Color('#00f0ff') }, uGuardRect: guardRect,
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mats = {};
  for (const k of TRANSITION_TYPES) {
    mats[k] = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: HEAD + FRAG[k], depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  }
  const quad = new THREE.Mesh(geo, mats.morph); quad.frustumCulled = false;
  const quadScene = new THREE.Scene(); quadScene.add(quad);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- morph cloud
  const N = 16384;
  const cg = new THREE.BufferGeometry();
  const from = new Float32Array(N * 3), to = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) seed[i] = (i * 0.61803398875) % 1;
  const aFrom = new THREE.BufferAttribute(from, 3), aTo = new THREE.BufferAttribute(to, 3);
  aFrom.setUsage(THREE.DynamicDrawUsage); aTo.setUsage(THREE.DynamicDrawUsage);
  cg.setAttribute('position', aFrom); cg.setAttribute('aFrom', aFrom); cg.setAttribute('aTo', aTo); cg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const CU = {
    uP: U.uP, uTime: U.uTime, uSize: { value: 2.6 }, uScale: { value: 1 }, uVortex: { value: new THREE.Vector3() },
    uColA: U.uColA, uColB: U.uColB, uRes: res, uGuardRect: guardRect, uGuardAmt: guardAmt, uAlert: alert,
  };
  const cloudMat = new THREE.ShaderMaterial({ uniforms: CU, vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const cloud = new THREE.Points(cg, cloudMat); cloud.frustumCulled = false;
  const cloudScene = new THREE.Scene(); cloudScene.add(cloud);

  return {
    U, mats, quad, quadScene, ortho, cloud, cloudScene, cloudU: CU, N, from, to,
    use(type) { quad.material = mats[type] || mats.morph; },
    /** Upload aFrom/aTo once at the start of a morph (n points; the rest are hidden by drawRange). */
    upload(n) { cg.setDrawRange(0, n); aFrom.needsUpdate = true; aTo.needsUpdate = true; },
    setCount(n) { cg.setDrawRange(0, n); },
    dispose() { geo.dispose(); for (const k in mats) mats[k].dispose(); cg.dispose(); cloudMat.dispose(); },
  };
}

/** Default morph sampler: a jittered shell around the scene's far-field subject (in front of the camera). */
export function defaultMorphPoints(out, n, camera, rnd = Math.random) {
  const cx = camera.position.x, cz = camera.position.z;
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 260 * (0.85 + rnd() * 0.3);
    out[i * 3] = cx - 120 + Math.cos(a) * s * r * 1.6;
    out[i * 3 + 1] = 140 + u * r * 0.7;
    out[i * 3 + 2] = cz - 700 + Math.sin(a) * s * r;
  }
  return true;
}
