// PNN living environment: all GPU particles (stars, dust, weather, shooting stars, comets).
// Zero per-frame CPU attribute work. Positions come from vertex shaders + wrapped JS phases.
// Draw calls: 4 (stars, dust, weather, meteors). Self-contained: only needs ctx fields
// { time, alert, accent, accent2, res, guardRect, guardAmt, quality } (all optional, safe fallbacks).
import * as THREE from '../../../vendor/three/three.module.js';

const TAU = Math.PI * 2;
const wrap = (v, p) => v - Math.floor(v / p) * p;
const N_STARS = 3000, N_DUST = 1500, N_WEATHER = 8000, N_METEOR = 6;
const Q_STARS = [1500, 2400, 3000], Q_DUST = [600, 1000, 1500], Q_WEATHER = [2400, 4800, 8000];

function rng(seed) { // mulberry32, deterministic layouts
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const GUARD = /* glsl */`
uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
float guard(){ vec2 q=gl_FragCoord.xy/uRes; vec2 m=smoothstep(uGuardRect.xy-0.08,uGuardRect.xy,q)*(1.-smoothstep(uGuardRect.zw,uGuardRect.zw+0.08,q)); return 1.-uGuardAmt*m.x*m.y; }
vec3 redShift(vec3 c){ float l=dot(c,vec3(0.4,0.4,0.2)); return vec3(max(c.r,l*1.1), c.g*0.12, c.b*0.18); }
`;

// ---------------------------------------------------------------- stars
const STAR_VS = /* glsl */`
attribute vec4 aSeed; // x density, y twinkle k, z hue, w size
uniform float uStars, uTw, uTwAmt, uPx;
varying vec3 vCol; varying float vA;
uniform vec3 uAccent2;
void main(){
  float on = clamp((uStars - aSeed.x) / 0.05, 0.0, 1.0);
  float k = floor(1.0 + aSeed.y * 4.0);
  float tw = 1.0 - uTwAmt * (0.5 + 0.5 * sin(uTw * k + aSeed.x * 40.0));
  vec3 warm = vec3(1.0, 0.82, 0.66), cool = vec3(0.72, 0.82, 1.0), pink = vec3(1.0, 0.62, 0.9);
  vec3 c = aSeed.z < 0.5 ? mix(cool, vec3(1.0), aSeed.z * 2.0) : mix(vec3(1.0), aSeed.z < 0.85 ? warm : pink, (aSeed.z - 0.5) * 2.0);
  vCol = mix(c, uAccent2, 0.12) * 0.7;
  vA = on * tw * (0.45 + 0.55 * aSeed.w);
  gl_PointSize = on < 0.001 ? 0.0 : (1.0 + aSeed.w * aSeed.w * 2.2) * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STAR_FS = /* glsl */`
${GUARD}
uniform float uAlert; varying vec3 vCol; varying float vA;
void main(){
  vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.05, length(d));
  vec3 c = vCol; c = mix(c, redShift(c), uAlert);
  gl_FragColor = vec4(c, a * vA * guard());
}`;

// ---------------------------------------------------------------- dust
const DUST_VS = /* glsl */`
attribute vec4 aSeed;
uniform vec3 uCam; uniform float uPh, uSw, uPx, uDust; uniform vec3 uColA, uColB;
varying vec3 vCol; varying float vA;
void main(){
  float on = clamp((uDust - aSeed.x) / 0.08, 0.0, 1.0);
  vec3 drift = vec3(floor(aSeed.x*9.0)-4.0, floor(aSeed.y*5.0)-2.0, floor(aSeed.z*9.0)-4.0);
  vec3 u = fract(position + drift * uPh);
  vec3 w = u * 90.0;
  vec3 rel = mod(w - uCam + 45.0, 90.0) - 45.0;
  vec3 wp = uCam + rel;
  vec3 e = smoothstep(vec3(45.0), vec3(34.0), abs(rel));
  float edge = e.x * e.y * e.z * smoothstep(0.0, 3.0, wp.y);
  float k = floor(1.0 + aSeed.y * 3.0);
  float tw = 0.7 + 0.3 * sin(uSw * k + aSeed.x * 6.2831);
  vCol = mix(uColA, uColB, aSeed.z);
  vA = 0.25 * on * edge * tw;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = max(-mv.z, 1.0);
  gl_PointSize = on < 0.001 ? 0.0 : (1.5 + 2.5 * aSeed.w) * uPx * clamp(50.0 / dist, 0.5, 2.0);
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FS = /* glsl */`
${GUARD}
uniform float uAlert; varying vec3 vCol; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, d);
  vec3 c = mix(vCol, redShift(vCol), uAlert);
  gl_FragColor = vec4(c, a * vA * guard());
}`;

// ---------------------------------------------------------------- weather
const WX_VS = /* glsl */`
attribute vec4 aSeed; // x bucket, y,z,w random
uniform vec3 uCam, uWeatherCol;
uniform vec4 uA1; uniform float uAm, uNorm; // amounts rain snow embers fireflies | motes
uniform float uPhRain, uPhSnow, uPhEmb, uPhMote, uPhWind, uSway, uPx;
varying vec3 vCol; varying float vA, vT; varying vec2 vS;
const vec3 BS = vec3(300.0, 120.0, 400.0);
void main(){
  float c1 = uA1.x*uNorm, c2 = c1 + uA1.y*uNorm, c3 = c2 + uA1.z*uNorm, c4 = c3 + uA1.w*uNorm, c5 = c4 + uAm*uNorm;
  float s = aSeed.x;
  float ty = s < c1 ? 0.0 : s < c2 ? 1.0 : s < c3 ? 2.0 : s < c4 ? 3.0 : s < c5 ? 4.0 : -1.0;
  if (ty < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); vT = 0.0; vS = vec2(0.0); return; }
  float k = floor(3.0 + aSeed.y * 3.0);           // 3..5 integer speed multiplier
  float kw = floor(1.0 + aSeed.z * 3.0);          // 1..3 wind multiplier
  float ks = floor(1.0 + aSeed.y * 4.0);          // 1..4 sway multiplier
  float ph = aSeed.z * 6.2831;
  vec3 u = position; vec3 col = uWeatherCol; float a = 0.0, size = 3.0;
  if (ty < 0.5) { // rain
    u.y = fract(position.y - k * uPhRain);
    u.x = fract(position.x + kw * uPhWind);
    col = mix(uWeatherCol, vec3(0.6, 0.8, 1.0), 0.5); a = 0.2; size = 10.0 + 10.0 * aSeed.w;
  } else if (ty < 1.5) { // snow
    u.y = fract(position.y - k * uPhSnow);
    u.x = fract(position.x + kw * uPhWind + 0.02 * sin(uSway * ks + ph));
    u.z = fract(position.z + 0.02 * cos(uSway * ks * 0.0 + uSway * (ks + 1.0) + ph));
    col = mix(uWeatherCol, vec3(1.0), 0.6); a = 0.5; size = 2.5 + 2.0 * aSeed.w;
  } else if (ty < 2.5) { // embers
    u.y = fract(position.y + k * uPhEmb);
    u.x = fract(position.x + kw * uPhWind * 0.5 + 0.03 * sin(uSway * ks + ph));
    col = mix(vec3(1.0, 0.42, 0.1), uWeatherCol, 0.25);
    a = (0.55 + 0.45 * sin(uSway * (ks + 2.0) * 2.0 + ph * 3.0)) * 0.8; size = 2.5 + 2.5 * aSeed.w;
  } else if (ty < 3.5) { // fireflies
    u = position; u.y = position.y * 0.4;
    u += 0.035 * vec3(sin(uSway * ks + ph), 0.5 * sin(uSway * (ks + 1.0) + ph * 2.0), cos(uSway * (ks + 2.0) + ph * 3.0));
    u = fract(u);
    col = mix(vec3(0.7, 1.0, 0.45), uWeatherCol, 0.3);
    a = pow(abs(0.5 + 0.5 * sin(uSway * (ks + 1.0) * 2.0 + ph * 5.0)), 2.0) * 0.75 + 0.05; size = 4.0 + 4.0 * aSeed.w;
  } else { // motes
    u.y = fract(position.y + k * uPhMote);
    col = uWeatherCol; a = 0.6; size = 3.0 + 2.0 * aSeed.w;
  }
  vec3 B = vec3(uCam.x - 150.0, -10.0, uCam.z - 150.0 - 200.0);
  vec3 L = u * BS;
  vec3 wp;
  wp.xz = B.xz + mod(L.xz - B.xz, BS.xz);
  wp.y = B.y + L.y;
  vec3 rel = (wp - B) / BS;
  float edge = smoothstep(0.0, 0.07, rel.x) * (1.0 - smoothstep(0.93, 1.0, rel.x))
             * smoothstep(0.0, 0.07, rel.z) * (1.0 - smoothstep(0.93, 1.0, rel.z));
  float vy = (ty > 2.5 && ty < 3.5) ? 1.0 : smoothstep(0.0, 0.08, u.y) * (1.0 - smoothstep(0.9, 1.0, u.y));
  float ground = smoothstep(0.0, 4.0, wp.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = max(-mv.z, 1.0);
  float near = smoothstep(25.0, 45.0, distance(wp, uCam));
  vA = a * edge * vy * ground * near * step(0.0, -mv.z);
  float sz = size * uPx * clamp(120.0 / dist, 0.4, 2.2);
  if (ty > 0.5 && ty < 1.5) sz = floor(max(2.0, sz));
  gl_PointSize = sz; vS = vec2(sz, 0.0);
  vCol = col; vT = ty;
  gl_Position = projectionMatrix * mv;
}`;
const WX_FS = /* glsl */`
${GUARD}
uniform float uAlert, uSlant; varying vec3 vCol; varying float vA, vT; varying vec2 vS;
void main(){
  vec2 pc = gl_PointCoord; vec2 c = abs(pc - 0.5); float d = length(pc - 0.5) * 2.0; float a = 1.0; vec3 col = vCol;
  if (vT < 0.5) { float x = pc.x - 0.5 + (pc.y - 0.5) * uSlant; a = (1.0 - smoothstep(0.03, 0.09, abs(x))) * sin(pc.y * 3.14159); }
  else if (vT < 1.5) { a = (vS.x > 5.0 && c.x > 0.3 && c.y > 0.3) ? 0.0 : 1.0; }
  else if (vT < 2.5) { float g = smoothstep(1.0, 0.0, d); a = g * g; col = mix(col, vec3(1.0, 0.85, 0.5), g * g * 0.6); }
  else if (vT < 3.5) { a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.8, 1.0, d)); }
  else { a = 1.0 - smoothstep(0.3, 0.4, max(c.x, c.y)); }
  col = mix(col, redShift(col), uAlert);
  gl_FragColor = vec4(col, a * vA * guard());
}`;

// ---------------------------------------------------------------- meteors (shooting stars + comets)
const MET_VS = /* glsl */`
attribute vec3 aStart, aDir; attribute vec4 aInfo; attribute vec3 aStyle; // birth,life,speed,len | width,kind,seed
uniform float uClock; uniform vec3 uCam;
varying float vAlong, vY, vEnv, vKind, vLW;
void main(){
  float age = uClock - aInfo.x; float life = aInfo.y; float u = age / life;
  vKind = aStyle.y;
  if (age < 0.0 || u > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlong = 0.0; vY = 0.0; vEnv = 0.0; vLW = 1.0; return; }
  vec3 head = aStart + aDir * aInfo.z * age;
  float len = aInfo.w * (aStyle.y > 0.5 ? smoothstep(0.0, 0.15, u) : 1.0);
  vec3 tail = head - aDir * len;
  vec3 vh = (viewMatrix * vec4(uCam + head, 1.0)).xyz;
  vec3 vt = (viewMatrix * vec4(uCam + tail, 1.0)).xyz;
  float al = position.x; float a0 = max(al, 0.0);
  vec3 p = mix(vh, vt, a0);
  vec2 d = vt.xy - vh.xy; d = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
  vec2 perp = vec2(-d.y, d.x);
  float w = aStyle.x * mix(1.0, 0.12, a0);
  p.xy += perp * position.y * w - d * (al < 0.0 ? -al * len * 0.0 : 0.0);
  if (al < 0.0) p.xy -= d * (-al) * len;
  vAlong = al; vY = position.y; vLW = len / aStyle.x;
  vEnv = aStyle.y > 0.5 ? smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.8, 1.0, u))
                        : smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.5, 1.0, u));
  vEnv *= step(0.0, -vh.z) * step(0.0, -vt.z);
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;
const MET_FS = /* glsl */`
${GUARD}
uniform float uAlert; uniform vec3 uAccent2;
varying float vAlong, vY, vEnv, vKind, vLW;
void main(){
  float al = max(vAlong, 0.0);
  float tailF = pow(1.0 - al, 3.0);
  float core = exp(-vY * vY * 7.0);
  float gx = vAlong * vLW;
  float glow = exp(-(gx * gx + vY * vY) * 0.9) * (1.0 - smoothstep(0.6, 1.0, abs(vY)));
  vec3 c1 = vKind > 0.5 ? mix(vec3(0.75, 1.0, 0.9), vec3(0.45, 0.6, 1.0), al) : mix(vec3(0.85, 0.95, 1.0), vec3(1.0, 0.5, 0.9), al);
  c1 = mix(c1, uAccent2, 0.15);
  float vis = (vAlong < 0.0 ? 0.0 : tailF * core) + glow * (vKind > 0.5 ? 1.2 : 0.8);
  float a = clamp(vis * vEnv, 0.0, 1.0);
  vec3 c = mix(c1, redShift(c1), uAlert);
  gl_FragColor = vec4(c, a * guard());
}`;

// ---------------------------------------------------------------- module
export function createParticles(scene, ctx = {}) {
  const T = THREE;
  const zero = { value: 0 };
  const shared = {
    uRes: ctx.res || { value: new T.Vector2(1920, 1080) },
    uGuardRect: ctx.guardRect || { value: new T.Vector4(0.30, 0.30, 0.985, 0.93) },
    uGuardAmt: ctx.guardAmt || { value: 0.45 },
    uAlert: ctx.alert || zero,
    uPx: { value: 1 },
    uCam: { value: new T.Vector3() },
  };
  const acc = ctx.accent && ctx.accent.value ? ctx.accent : { value: new T.Color(1, 0.17, 0.84) };
  const acc2 = ctx.accent2 && ctx.accent2.value ? ctx.accent2 : { value: new T.Color(0, 0.94, 1) };
  const accV3 = { value: new T.Vector3() }, acc2V3 = { value: new T.Vector3() };

  const P = { // current params (copied from director)
    stars: 0.7, starTwinkle: 0.6, dust: 0.6, rain: 0, snow: 0, embers: 0, fireflies: 0, motes: 0,
    wind: 0, fall: 1, shootingRate: 2, cometRate: 0,
    dustColA: new T.Color(1, 0.17, 0.84), dustColB: new T.Color(0, 0.94, 1), hasDustCol: false,
    weatherCol: new T.Color(0.8, 0.9, 1.0),
  };
  const ph = { rain: 0, snow: 0, emb: 0, mote: 0, wind: 0, sway: 0, dust: 0, tw: 0 };
  let quality = ctx.quality == null ? 2 : ctx.quality;
  let clock = 0, frames = 0, disposed = false;
  const disposables = [];
  const mkMat = (vs, fs, uniforms, blending = T.AdditiveBlending) => {
    const m = new T.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms, transparent: true, depthWrite: false, depthTest: true, blending });
    disposables.push(m); return m;
  };
  const pointsOf = (n, attrFn, mat, order) => {
    const g = new T.BufferGeometry();
    const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
    attrFn(pos, seed, n);
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new T.BufferAttribute(seed, 4));
    g.setDrawRange(0, n);
    const pts = new T.Points(g, mat);
    pts.frustumCulled = false; pts.renderOrder = order; pts.visible = true;
    scene.add(pts); disposables.push(g); return pts;
  };

  // ---- stars
  const starU = { ...shared, uStars: { value: P.stars }, uTw: { value: 0 }, uTwAmt: { value: 0.4 }, uAccent2: acc2V3 };
  const stars = pointsOf(N_STARS, (pos, seed, n) => {
    const r = rng(1337);
    for (let i = 0; i < n; i++) {
      const z = -0.08 + r() * 1.08, a = r() * TAU, rr = Math.sqrt(1 - Math.min(1, z * z));
      // y up: z is elevation; heading uniformly around
      pos[i * 3] = Math.cos(a) * rr * 2600; pos[i * 3 + 1] = z * 2600; pos[i * 3 + 2] = Math.sin(a) * rr * 2600;
      seed[i * 4] = r(); seed[i * 4 + 1] = r(); seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r();
    }
  }, mkMat(STAR_VS, STAR_FS, starU), -9);

  // ---- dust
  const dustU = { ...shared, uPh: { value: 0 }, uSw: { value: 0 }, uDust: { value: P.dust }, uColA: { value: new T.Vector3() }, uColB: { value: new T.Vector3() } };
  const dust = pointsOf(N_DUST, (pos, seed, n) => {
    const r = rng(4242);
    for (let i = 0; i < n; i++) { pos[i * 3] = r(); pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r(); seed[i * 4] = r(); seed[i * 4 + 1] = r(); seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r(); }
  }, mkMat(DUST_VS, DUST_FS, dustU), 1);

  // ---- weather
  const wxU = {
    ...shared, uWeatherCol: { value: new T.Vector3() }, uA1: { value: new T.Vector4() }, uAm: { value: 0 }, uNorm: { value: 1 },
    uPhRain: { value: 0 }, uPhSnow: { value: 0 }, uPhEmb: { value: 0 }, uPhMote: { value: 0 }, uPhWind: { value: 0 }, uSway: { value: 0 }, uSlant: { value: 0 },
  };
  const weather = pointsOf(N_WEATHER, (pos, seed, n) => {
    const r = rng(9001);
    for (let i = 0; i < n; i++) { pos[i * 3] = r(); pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r(); seed[i * 4] = r(); seed[i * 4 + 1] = r(); seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r(); }
  }, mkMat(WX_VS, WX_FS, wxU), 2);

  // ---- meteors
  const mg = new T.InstancedBufferGeometry();
  mg.setAttribute('position', new T.BufferAttribute(new Float32Array([-0.06, -1, 0, 1, -1, 0, 1, 1, 0, -0.06, 1, 0]), 3));
  mg.setIndex([0, 1, 2, 0, 2, 3]);
  const aStart = new T.InstancedBufferAttribute(new Float32Array(N_METEOR * 3), 3);
  const aDir = new T.InstancedBufferAttribute(new Float32Array(N_METEOR * 3), 3);
  const aInfo = new T.InstancedBufferAttribute(new Float32Array(N_METEOR * 4), 4);
  const aStyle = new T.InstancedBufferAttribute(new Float32Array(N_METEOR * 3), 3);
  for (let i = 0; i < N_METEOR; i++) { aInfo.array[i * 4] = -1e9; aInfo.array[i * 4 + 1] = 1; aStyle.array[i * 3] = 6; }
  mg.setAttribute('aStart', aStart); mg.setAttribute('aDir', aDir); mg.setAttribute('aInfo', aInfo); mg.setAttribute('aStyle', aStyle);
  mg.instanceCount = N_METEOR; disposables.push(mg);
  const metU = { ...shared, uClock: { value: 0 }, uAccent2: acc2V3 };
  const meteors = new T.Mesh(mg, mkMat(MET_VS, MET_FS, metU));
  meteors.frustumCulled = false; meteors.renderOrder = -8.9; meteors.visible = true;
  scene.add(meteors);

  const mrand = rng(777 + (Date.now() & 0xffff));
  function spawn(slot, kind) {
    const az = (mrand() - 0.5) * 2.0 * (kind ? 1.0 : 0.9);           // around -z heading
    const el = (kind ? 0.2 : 0.22) + mrand() * (kind ? 0.35 : 0.45);
    const R = 2000, ce = Math.cos(el);
    const sx = Math.sin(az) * ce * R, sy = Math.sin(el) * R, sz = -Math.cos(az) * ce * R;
    const sgn = mrand() < 0.5 ? -1 : 1, down = -(0.08 + mrand() * 0.4);
    let dx = Math.cos(az) * sgn, dy = down, dz = Math.sin(az) * sgn;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    aStart.array.set([sx, sy, sz], slot * 3); aDir.array.set([dx, dy, dz], slot * 3);
    const life = kind ? 20 + mrand() * 20 : 0.8 + mrand() * 0.9;
    const speed = kind ? 22 + mrand() * 18 : 800 + mrand() * 500;
    aInfo.array.set([clock, life, speed, kind ? 520 : 380], slot * 4);
    aStyle.array.set([kind ? 20 : 5.5, kind, mrand()], slot * 3);
    aStart.needsUpdate = aDir.needsUpdate = aInfo.needsUpdate = aStyle.needsUpdate = true;
  }
  function freeSlot(lo, hi) {
    let best = lo, bestAge = -1;
    for (let i = lo; i < hi; i++) {
      const age = clock - aInfo.array[i * 4 + 0], over = age - aInfo.array[i * 4 + 1];
      if (over > 0) return i;
      if (age > bestAge) { bestAge = age; best = i; }
    }
    return best;
  }

  const api = {
    setParams(p) {
      if (!p) return;
      const num = (k) => { if (typeof p[k] === 'number') P[k] = p[k]; };
      ['stars', 'starTwinkle', 'dust', 'rain', 'snow', 'embers', 'fireflies', 'motes', 'wind', 'fall', 'shootingRate', 'cometRate'].forEach(num);
      if (p.dustColA && p.dustColA.isColor) { P.dustColA.copy(p.dustColA); P.hasDustCol = true; }
      if (p.dustColB && p.dustColB.isColor) { P.dustColB.copy(p.dustColB); P.hasDustCol = true; }
      if (p.weatherCol && p.weatherCol.isColor) P.weatherCol.copy(p.weatherCol);
    },
    update(dt, t, camera) {
      if (disposed) return;
      dt = Math.min(Math.max(dt || 0, 0), 0.1); frames++;
      clock += dt;
      if (clock > 3600) { // rebase so uClock stays small
        for (let i = 0; i < N_METEOR; i++) aInfo.array[i * 4] -= 3600; aInfo.needsUpdate = true; clock -= 3600;
      }
      const fall = P.fall;
      ph.rain = wrap(ph.rain + dt * 0.21 * fall, 1); ph.snow = wrap(ph.snow + dt * 0.0125 * fall, 1);
      ph.emb = wrap(ph.emb + dt * 0.021 * fall, 1); ph.mote = wrap(ph.mote + dt * 0.046 * fall, 1);
      ph.wind = wrap(ph.wind + dt * 0.025 * P.wind, 1); ph.sway = wrap(ph.sway + dt * 0.6, TAU);
      ph.dust = wrap(ph.dust + dt / 400, 1); ph.tw = wrap(ph.tw + dt * 1.4, TAU);

      const res = shared.uRes.value; shared.uPx.value = Math.max(0.5, (res && res.y ? res.y : 1080) / 1080);
      if (camera) shared.uCam.value.copy(camera.position);
      const cam = shared.uCam.value;
      stars.position.copy(cam);

      accV3.value.set(acc.value.r, acc.value.g, acc.value.b); acc2V3.value.set(acc2.value.r, acc2.value.g, acc2.value.b);
      starU.uStars.value = P.stars; starU.uTw.value = ph.tw; starU.uTwAmt.value = 0.65 * Math.min(1, P.starTwinkle);
      const dc = dustU, a = P.hasDustCol ? 0.5 : 1.0;
      const ca = P.hasDustCol ? P.dustColA : acc.value, cb = P.hasDustCol ? P.dustColB : acc2.value;
      // mix with live accents at 0.5 when mood colors given
      dc.uColA.value.set(ca.r * a + acc.value.r * (1 - a), ca.g * a + acc.value.g * (1 - a), ca.b * a + acc.value.b * (1 - a));
      dc.uColB.value.set(cb.r * a + acc2.value.r * (1 - a), cb.g * a + acc2.value.g * (1 - a), cb.b * a + acc2.value.b * (1 - a));
      dc.uPh.value = ph.dust; dc.uSw.value = ph.sway; dc.uDust.value = P.dust;

      const tot = P.rain + P.snow + P.embers + P.fireflies + P.motes;
      wxU.uA1.value.set(P.rain, P.snow, P.embers, P.fireflies); wxU.uAm.value = P.motes; wxU.uNorm.value = 1 / Math.max(1, tot);
      wxU.uPhRain.value = ph.rain; wxU.uPhSnow.value = ph.snow; wxU.uPhEmb.value = ph.emb; wxU.uPhMote.value = ph.mote;
      wxU.uPhWind.value = ph.wind; wxU.uSway.value = ph.sway;
      wxU.uSlant.value = Math.max(-0.4, Math.min(0.4, P.wind * 0.15));
      wxU.uWeatherCol.value.set(P.weatherCol.r, P.weatherCol.g, P.weatherCol.b);
      metU.uClock.value = clock;

      if (frames > 4) { // after the warmup pass, skip zero-amount draws
        stars.visible = P.stars > 0.002; dust.visible = P.dust > 0.002; weather.visible = tot > 0.002;
      }
    },
    shootingStar() { spawn(freeSlot(0, 4), 0); },
    comet() { spawn(freeSlot(4, 6), 1); },
    setQuality(level) {
      quality = Math.max(0, Math.min(2, level | 0));
      stars.geometry.setDrawRange(0, Q_STARS[quality]); dust.geometry.setDrawRange(0, Q_DUST[quality]); weather.geometry.setDrawRange(0, Q_WEATHER[quality]);
    },
    dispose() {
      if (disposed) return; disposed = true;
      [stars, dust, weather, meteors].forEach((o) => scene.remove(o));
      disposables.forEach((d) => d.dispose());
    },
    objects: { stars, dust, weather, meteors },
  };
  api.setQuality(quality);
  return api;
}
