// copperDemo: Amiga/90s demoscene. Copper raster bars (upper/lower bands), chrome twister (far left),
// 10k-dot spiral tunnel, quantized rotozoom plasma floor. 3 draws: backdrop, twister (instanced), dots (points).
// Everything is screen-space (own NDC projection in the vertex shaders), so the view offset never matters.
import * as THREE from '../../../vendor/three/three.module.js';

const BACK_FS = /* glsl */`
uniform float uClk, uEnter, uExit, uBars, uRoto, uSnap, uFlash;
uniform vec2 uPar;
vec3 barCol(float fi){
  float m = mod(fi, 4.0);
  vec3 c = m < 0.5 ? vec3(1.0,0.12,0.62) : m < 1.5 ? vec3(0.1,0.78,1.0) : m < 2.5 ? vec3(1.0,0.62,0.12) : vec3(0.55,0.22,1.0);
  if (m < 0.5) c = mix(c, uAccent, 0.45);
  if (m > 0.5 && m < 1.5) c = mix(c, uAccent2, 0.45);
  return c;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  float sp = 1.0 + 0.4 * uAlert;
  float t = uClk;
  float midM = smoothstep(0.80, 0.74, uv.y) * smoothstep(0.20, 0.26, uv.y);
  // background: indigo + quantized rotozoom plasma
  vec3 bg = mix(vec3(0.012,0.004,0.05), vec3(0.03,0.008,0.09), uv.y);
  if (uRoto > 0.5) {
    vec2 p = (uv - 0.5 + uPar) * vec2(asp, 1.0);
    float a = t * 0.13, ca = cos(a), sa = sin(a);
    p = mat2(ca, -sa, sa, ca) * p;
    p *= mix(9.0, 4.0, midM) * (0.8 + 0.45 * sin(t * 0.17));
    float chk = mod(floor(p.x) + floor(p.y), 2.0);
    float v = (sin(p.x * 0.7 + t * 0.4) + sin(p.y * 0.9 - t * 0.3) + sin(length(p) * 0.6 + t * 0.5)) / 6.0 + 0.5;
    v = floor(v * 12.0) / 12.0;                          // 12 colour steps
    vec3 rc = mix(vec3(0.55,0.10,0.70), vec3(0.10,0.45,0.95), v);
    rc = mix(rc, mix(uAccent, uAccent2, v), 0.3);
    bg += rc * (chk * 0.55 + 0.2) * mix(0.30, 0.10, midM) * 0.35;
  }
  bg *= 0.88 + 0.12 * sin(gl_FragCoord.y * 3.14159);        // scanlines
  vec3 col = bg;
  // copper bars: weave, depth swap
  float best = -9.0; vec3 bc = vec3(0.0); float cover = 0.0;
  float ex = smoothstep(0.0, 0.8, uExit);
  bool barZone = uExit > 0.0 || uSnap > 0.0 || abs(uv.y - 0.5) > 0.2;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uBars || !barZone) break;
    float fi = float(i);
    bool up = mod(fi, 2.0) < 0.5;
    float slot = floor(fi * 0.5);
    float base = up ? 0.9 : 0.10;
    float ph = t * sp;
    float w = sin(uv.x * 2.2 + ph * (0.8 + 0.13 * fi) + fi * 1.7) * 0.035 + sin(uv.x * 5.1 - ph * 1.3 + fi * 0.9) * 0.014;
    float off = (slot - 1.5) * 0.012 * sin(ph * 0.5 + fi);
    float yc = base + w + off;
    yc = mix(yc, base + (slot - 1.5) * 0.004, uSnap);       // snap into synced flash bar
    float hw = 0.02;
    yc = mix(yc, 0.5, ex); hw *= mix(1.0, 0.12, ex);
    float dy = (uv.y - yc) / hw;
    if (abs(dy) < 1.0) {
      float r = clamp(uEnter * 1.7 - fi * 0.11, 0.0, 1.0) * 1.1;
      float edge = mod(slot, 2.0) < 0.5 ? uv.x : 1.0 - uv.x;
      float m = smoothstep(r, r - 0.07, edge);
      float head = exp(-pow((edge - r) * 40.0, 2.0)) * step(0.001, r) * (1.0 - step(1.05, r));
      float prof = 1.0 - abs(dy);
      float d = sin(t * 0.6 + fi * 1.9 + uv.x * 1.7);
      if (m + head > 0.01 && d > best) {
        best = d;
        vec3 c = barCol(fi);
        vec3 bcol = c * pow(prof, 0.9) * 0.6 + pow(prof, 16.0) * vec3(1.0, 0.92, 0.85) * 1.1;
        bcol *= 0.65 + 0.35 * d;
        bcol *= 1.0 + 2.2 * exp(-pow((yc - uFlash) * 22.0, 2.0)) * step(0.0, uFlash);
        bcol += head * c * 2.0;
        bc = bcol * m + head * c * 2.0 * (1.0 - m);
        cover = max(m, head);
      }
    }
  }
  col = mix(col, bc, cover);
  // flash line sweeping top to bottom
  if (uFlash >= 0.0) {
    float l = exp(-pow((uv.y - uFlash) * 120.0, 2.0));
    col += l * mix(vec3(1.0,0.95,1.0), uAccent2, 0.4) * 2.0 + exp(-pow((uv.y - uFlash) * 14.0, 2.0)) * uAccent2 * 0.12;
  }
  gl_FragColor = vec4(finish(col), 1.0);
}`;

const BACK_VS = `void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const TW_VS = /* glsl */`
attribute vec2 aInst;
uniform float uClk, uEnter, uExit, uKick; uniform vec2 uRes, uPar;
varying vec2 vUv; varying float vNa; varying float vY; varying float vVis;
float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
void main(){
  float sl = aInst.x, fc = aInst.y, f = sl / 63.0;
  vec2 q = position.xy + 0.5; vUv = q;
  float y = (f * 2.0 - 1.0) * 1.15;
  float e = clamp(uEnter * 1.8 - f * 0.8, 0.0, 1.0); e = e * e * (3.0 - 2.0 * e);
  float a = y * 2.6 + uClk * 1.9 + sin(y * 1.4 + uClk * 0.7) * 1.1 + uKick * sin(y * 9.0 + uClk * 12.0) * 0.6;
  float R = 0.085 * (0.85 + 0.15 * sin(y * 3.0 + uClk)) * (1.0 + uKick * 0.5);
  float a0 = a + fc * 1.5708, a1 = a0 + 1.5708;
  float x0 = R * sin(a0), x1 = R * sin(a1);
  float vis = step(0.0, cos(a0 + 0.7854)) * step(0.001, e);
  float xx = mix(x0, x1, q.x);
  vec2 ndc = vec2(-0.93 + xx - (1.0 - e) * 1.1, y + (q.y - 0.5) * 0.044 - (1.0 - e) * 0.4 * sin(sl));
  float ex2 = uExit * uExit;
  ndc += vec2(h1(sl + 3.0) - 0.2, h1(sl + 7.0) - 0.5) * ex2 * vec2(2.2, 2.4);
  ndc += uPar * 0.15;
  vNa = a0 + 0.7854; vY = y; vVis = vis * (1.0 - smoothstep(0.6, 1.0, uExit));
  gl_Position = vis > 0.5 ? vec4(ndc, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const TW_FS = /* glsl */`
varying vec2 vUv; varying float vNa; varying float vY; varying float vVis;
uniform float uClk;
void main(){
  float s = vUv.x * 2.0 - 1.0;
  float ang = vNa + s * 0.75;
  float refl = sin(ang * 2.0 + vY * 3.0);
  float c = 0.5 + 0.5 * sin(refl * 3.14159 + vY * 5.0 + uClk * 0.6);
  vec3 hue = mix(uAccent2, uAccent, 0.5 + 0.5 * sin(vY * 3.0 + uClk * 0.8));
  vec3 col = mix(vec3(0.03,0.0,0.16), hue, smoothstep(0.2, 0.85, c));
  col += pow(c, 12.0) * vec3(1.0,0.95,1.0) * 0.6;
  col *= 0.3 + 0.7 * max(cos(ang), 0.0);
  col += smoothstep(0.82, 1.0, abs(s)) * uAccent2 * 0.7;
  col *= 0.65;
  gl_FragColor = vec4(finish(col), vVis);
}`;

const DOT_VS = /* glsl */`
attribute vec4 aSeed;
uniform float uClk, uEnter, uExit, uPunch, uAlert; uniform vec2 uRes, uPar; uniform vec4 uGuardRect;
uniform vec3 uAccent, uAccent2;
varying vec3 vCol; varying float vA;
void main(){
  float u = fract(aSeed.x - uClk * 0.055 - uPunch * 0.12);
  float d = 0.25 + u * 9.0;
  float th = aSeed.y * 6.28318 + aSeed.x * 3.5 + uClk * 0.4 + d * 0.22;
  float R = 1.1 + 0.3 * sin(d * 0.6 + uClk * 0.8);
  vec2 vp = vec2(-0.25, 0.04) + uPar * 0.3;
  float asp = uRes.x / uRes.y;
  vec2 rel = vec2(cos(th) / asp, sin(th)) * (R * 0.8 / d);
  float sc = 1.0 - smoothstep(0.0, 1.0, clamp(uEnter * 1.3 - aSeed.z * 0.3, 0.0, 1.0));
  rel *= 1.0 + sc * 3.5 * (aSeed.w + 0.3);
  float ex = uExit * uExit;
  rel *= 1.0 + ex * 10.0 * (aSeed.z + 0.5);
  vec2 ndc = vp + rel;
  float pr = clamp(uRes.y / 1080.0, 0.5, 2.0);
  gl_PointSize = clamp((1.6 + aSeed.z * 1.6) * (0.5 + 2.6 / (1.0 + d * 0.6)) * pr, 1.0, 14.0);
  float alpha = (1.0 - smoothstep(0.5, 0.92, u)) * smoothstep(0.0, 0.03, u) * (1.0 - sc) * (1.0 - smoothstep(0.4, 1.0, uExit));
  vec2 uv = ndc * 0.5 + 0.5;
  vec2 m = smoothstep(uGuardRect.xy - 0.05, uGuardRect.xy, uv) * (1.0 - smoothstep(uGuardRect.zw, uGuardRect.zw + 0.05, uv));
  alpha *= 1.0 - 0.7 * m.x * m.y;
  vec3 c = aSeed.w > 0.5 ? vec3(1.0,0.22,0.72) : vec3(0.1,0.92,1.0);
  c = mix(c, aSeed.w > 0.5 ? uAccent : uAccent2, 0.35);
  vCol = c * (0.5 + 1.1 * (1.0 - u)); vA = alpha;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;
const DOT_FS = /* glsl */`
varying vec3 vCol; varying float vA;
void main(){
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, r) * vA;
  gl_FragColor = vec4(finish(vCol), a);
}`;

export function create(ctx) {
  const G = ctx.GLSL;
  const HEAD = G.COMMON + (G.FINISH || '');
  const common = ctx.common();
  const clk = { value: 0 }, enter = { value: 1 }, exit = { value: 0 }, kick = { value: 0 }, punch = { value: 0 };
  const bars = { value: 8 }, roto = { value: 1 }, snap = { value: 0 }, flash = { value: -1 }, par = { value: new THREE.Vector2() };
  const shared = { ...common, uClk: clk, uEnter: enter, uExit: exit, uPar: par };

  // 1. backdrop
  const bm = ctx.track(new THREE.ShaderMaterial({
    vertexShader: BACK_VS, fragmentShader: HEAD + BACK_FS,
    uniforms: { ...shared, uBars: bars, uRoto: roto, uSnap: snap, uFlash: flash },
    depthTest: false, depthWrite: false,
  }));
  ctx.backdrop(bm);

  // 2. twister: 64 slices x 4 faces, one instanced draw
  const tg = ctx.track(new THREE.InstancedBufferGeometry());
  const pl = new THREE.PlaneGeometry(1, 1);
  tg.index = pl.index; tg.setAttribute('position', pl.attributes.position);
  const inst = new Float32Array(256 * 2);
  for (let i = 0; i < 256; i++) { inst[i * 2] = i >> 2; inst[i * 2 + 1] = i & 3; }
  tg.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 2));
  tg.instanceCount = 256;
  const tm = ctx.track(new THREE.ShaderMaterial({
    vertexShader: TW_VS, fragmentShader: HEAD + TW_FS,
    uniforms: { ...shared, uKick: kick }, transparent: true, depthTest: false, depthWrite: false,
  }));
  const tw = new THREE.Mesh(tg, tm); tw.frustumCulled = false; tw.renderOrder = -500;
  ctx.stage.add(tw);

  // 3. dot tunnel
  const N = 10000;
  const dg = ctx.track(new THREE.BufferGeometry());
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const ring = i % 100, kk = Math.floor(i / 100);
    seed[i * 4] = ring / 100;
    seed[i * 4 + 1] = (kk * 0.61803 + ring * 0.137) % 1;
    seed[i * 4 + 2] = ctx.rnd();
    seed[i * 4 + 3] = (kk & 1) ? 1 : 0;
  }
  dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const dm = ctx.track(new THREE.ShaderMaterial({
    vertexShader: DOT_VS, fragmentShader: HEAD + DOT_FS,
    uniforms: { ...shared, uPunch: punch }, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  const dots = new THREE.Points(dg, dm); dots.frustumCulled = false; dots.renderOrder = -400;
  ctx.stage.add(dots);

  // state (no per-frame allocation)
  let ent = 1, ext = 0, enterDur = 0, exitDur = 0, mode = 0, rip = 0, ripT = 1e9, k = 1, tmp = null;
  const DOTS = [3000, 6000, 10000], BARS = [5, 5, 8];

  const api = {
    update(dt, t, info) {
      k = info && info.k != null ? info.k : 1;
      clk.value += dt * (1 + 0.4 * ctx.alert.value);
      if (mode === 1) { ent = Math.min(1, ent + dt / Math.max(enterDur, 0.01)); if (ent >= 1) mode = 0; }
      else if (mode === 2) { ext = Math.min(1, ext + dt / Math.max(exitDur, 0.01)); }
      enter.value = ent; exit.value = ext;
      if (info && info.par) par.value.set(info.par.x * 0.0008, info.par.y * 0.0008);
      if (ripT < 1.2) {
        ripT += dt; const p = ripT / 1.2;
        flash.value = p < 1 ? 1 - p : -1;
        snap.value = rip * Math.sin(Math.min(p, 1) * Math.PI) ** 0.5;
        kick.value = rip * Math.max(0, 1 - ripT * 1.6);
        punch.value = rip * Math.max(0, 1 - ripT / 0.9) * 2;
      } else { flash.value = -1; snap.value = 0; kick.value *= 0.9; punch.value = 0; }
      kick.value += 0; 
    },
    setIntensity(a) { k = a; },
    enter(dur) { ent = 0; ext = 0; enterDur = dur; mode = 1; },
    exit(dur) { exitDur = dur; mode = 2; ext = Math.max(ext, 0.0001); },
    ripple(o) { rip = Math.max(0.35, (o && o.strength) || 1); ripT = 0; flash.value = 1; kick.value = rip; punch.value = rip * 2; },
    event(type) { if (type === 'story') api.ripple({ strength: 0.4 }); },
    setQuality(q) {
      q = q | 0; bars.value = BARS[q]; roto.value = q > 0 ? 1 : 0;
      dg.setDrawRange(0, DOTS[q]);
    },
    morphPoints(out, n) {
      const cam = ctx.camera; if (!cam) return false;
      if (!tmp) tmp = { v: new THREE.Vector3(), c: new THREE.Vector3() };
      cam.updateMatrixWorld(); tmp.c.setFromMatrixPosition(cam.matrixWorld);
      for (let i = 0; i < n; i++) {
        const r = ctx.rnd(); let x, y;
        if (r < 0.4) { x = ctx.rnd() * 2 - 1; y = (ctx.rnd() < 0.5 ? 0.8 : -0.8) + (ctx.rnd() - 0.5) * 0.1; }
        else if (r < 0.65) { x = -0.86 + (ctx.rnd() - 0.5) * 0.22; y = ctx.rnd() * 2.2 - 1.1; }
        else { const a = ctx.rnd() * 6.283, rr = 0.1 + ctx.rnd() * 0.8; x = -0.25 + Math.cos(a) * rr * 0.56; y = 0.04 + Math.sin(a) * rr; }
        tmp.v.set(x, y, 0.5).unproject(cam).sub(tmp.c).normalize().multiplyScalar(350).add(tmp.c);
        out[i * 3] = tmp.v.x; out[i * 3 + 1] = tmp.v.y; out[i * 3 + 2] = tmp.v.z;
      }
      return true;
    },
    grade: { bloom: 0.5, bloomThreshold: 0.85, bloomRadius: 0.55, tint: new THREE.Color(0.55, 0.4, 1.0), tintAmt: 0.05, sat: 1.1, contrast: 1.05, ca: 0.0015, grain: 0.04, vignette: 0.35, scan: 0.25 },
    cameraBias: { orbitScale: 0.9, bob: 0.9 },
  };
  api.setQuality(ctx.quality == null ? 2 : ctx.quality);
  return api;
}
