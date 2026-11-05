// Shared hologram toolkit: palette per theme, seeded variation, scan-in materials, canvas labels, easing.
import * as THREE from '../../vendor/three/three.module.js';

export const TIME = { value: 0 }; // shared time uniform, set by the frame loop

// Theme palettes (a = primary accent, b = secondary). Everything neon so bloom reads.
export const THEMES = {
  politics: { a: '#ff2bd6', b: '#00f0ff' },
  economy: { a: '#ffd23f', b: '#3dff8a' },
  courts: { a: '#9b5cff', b: '#e6d6ff' },
  tech: { a: '#00f0ff', b: '#2d8cff' },
  science: { a: '#00ffc8', b: '#b4ff3d' },
  health: { a: '#ff6ad5', b: '#ffffff' },
  culture: { a: '#ff8a2e', b: '#ff2bd6' },
  weather: { a: '#4fa8ff', b: '#d8f4ff' },
  world: { a: '#00f0ff', b: '#ffab2e' },
};
export const HEX = { up: '#3dff8a', down: '#ff2e55', alert: '#ff3a2e', amber: '#ffab2e', cyan: '#00f0ff', magenta: '#ff2bd6', gold: '#ffd23f', violet: '#9b5cff', white: '#ffffff' };
export const COL = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, new THREE.Color(v)]));
// extra distinct accents for multi-outcome boards
const EXTRA = ['#ffd23f', '#3dff8a', '#ff8a2e', '#9b5cff', '#00f0ff', '#ff2bd6'];

// ---------- seeded variation ----------
export function hash(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const _hsl = { h: 0, s: 0, l: 0 };
export function nudgeHue(color, amount) {
  const c = color.clone(); c.getHSL(_hsl);
  c.setHSL((_hsl.h + amount + 1) % 1, _hsl.s, _hsl.l);
  return c;
}
// palette(story) -> { a, b, hexA, hexB, seed, rnd, pick(i) } tinted per theme, nudged per story id
export function palette(story, themeOverride) {
  const theme = themeOverride || story?.visual?.theme || 'world';
  const base = THEMES[theme] || THEMES.world;
  const seed = hash(story?.id || story?.eventTitle || theme);
  const rnd = rng(seed);
  const shift = (rnd() - 0.5) * 0.08;
  const a = nudgeHue(new THREE.Color(base.a), shift), b = nudgeHue(new THREE.Color(base.b), -shift * 0.5);
  const hexA = '#' + a.getHexString(), hexB = '#' + b.getHexString();
  const extras = EXTRA.filter((h) => h !== base.a && h !== base.b);
  const list = [a, b, ...extras.map((h) => new THREE.Color(h))];
  return { theme, seed, rnd, a, b, hexA, hexB, pick: (i) => list[i % list.length], hex: (i) => '#' + list[i % list.length].getHexString() };
}

// ---------- materials with fade + scan-in reveal ----------
const REVEAL_UNIFORMS = () => ({ uFade: { value: 1 }, uReveal: { value: 1 }, uR0: { value: 0 }, uR1: { value: 10 }, uAxis: { value: 0 }, uTime: TIME });
const revealGlsl = /* glsl */`
uniform float uFade; uniform float uReveal; uniform float uR0; uniform float uR1; uniform float uAxis; uniform float uTime;
varying vec3 vW;
float revealScan(out float rv){
  float rc = mix(vW.y, vW.x, uAxis);
  rv = clamp((rc - uR0) / max(uR1 - uR0, 0.001), 0.0, 1.0);
  if (rv > uReveal) discard;
  return exp(-abs(rv - uReveal) * 26.0) * step(uReveal, 0.999);
}`;

const holoVert = /* glsl */`
varying vec3 vN; varying vec3 vW;
void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const holoFrag = /* glsl */`
uniform vec3 uColor; uniform float uPulse; uniform float uGlow; uniform float uAlpha; uniform float uFlat;
varying vec3 vN;
${revealGlsl}
void main(){
  float rv; float scan = revealScan(rv);
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float top = smoothstep(0.6, 0.9, n.y);
  float fres = pow(max(1.0 - abs(dot(v, n)), 1e-4), 2.2);
  float band = smoothstep(0.75, 1.0, sin(vW.y * 9.0 - uTime * 2.6) * 0.5 + 0.5);
  float side = 1.0 - top;
  float hgt = clamp((vW.y - uR0) / max(uR1 - uR0, 0.001), 0.0, 1.0);
  vec3 c = uColor * mix(0.28 + 0.72 * hgt, 1.05, top);
  c += uColor * fres * 0.9 * side;
  c += uColor * band * 0.25 * side;
  c = mix(c, uColor * (0.95 + 0.25 * band), uFlat);
  c += vec3(1.0) * (uPulse * 0.9 + scan * 1.6);
  float a = (0.5 + 0.45 * top + 0.2 * fres + scan) * uAlpha;
  a = mix(a, uAlpha * (0.85 + scan), uFlat);
  gl_FragColor = vec4(c * uGlow, clamp(a, 0.0, 1.0) * uFade);
}`;
export function holoMaterial(color, { glow = 1, alpha = 1, flat = 0, side = THREE.FrontSide, depthWrite = true, blending = THREE.NormalBlending } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...REVEAL_UNIFORMS(), uColor: { value: color.clone() }, uPulse: { value: 0 }, uGlow: { value: glow }, uAlpha: { value: alpha }, uFlat: { value: flat } },
    vertexShader: holoVert, fragmentShader: holoFrag, transparent: true, depthWrite, side, blending,
  });
}

const lineVert = /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const lineFrag = /* glsl */`
uniform vec3 uColor; uniform float uGlow; uniform float uAlpha;
${revealGlsl}
void main(){
  float rv; float scan = revealScan(rv);
  gl_FragColor = vec4(uColor * uGlow + vec3(scan), uAlpha * uFade);
}`;
// glowing line material (additive) with the same reveal/fade uniforms
export function lineMaterial(color, { glow = 1.6, alpha = 0.8 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...REVEAL_UNIFORMS(), uColor: { value: color.clone() }, uGlow: { value: glow }, uAlpha: { value: alpha } },
    vertexShader: lineVert, fragmentShader: lineFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
// any custom ShaderMaterial can opt into the reveal system by spreading these uniforms and the glsl chunk
export const reveal = { uniforms: REVEAL_UNIFORMS, glsl: revealGlsl, vert: lineVert };

// ---------- canvas labels ----------
// Every label sprite lives on LABEL_LAYER only: the main pass (layer 0) skips it, post.js's LabelPass draws it after bloom.
export const LABEL_LAYER = 1;
const LABELS = new Set();
let fontsReady = false;
if (typeof document !== 'undefined' && document.fonts?.load) {
  Promise.all([document.fonts.load('900 80px Orbitron'), document.fonts.load('700 80px Orbitron'), document.fonts.load('700 60px Rajdhani'), document.fonts.load('600 60px Rajdhani')])
    .then(() => { fontsReady = true; for (const l of LABELS) l.redraw(); }).catch(() => {});
}
// Label: Sprite with a fixed-size canvas; text scaled to fit. opts: { w, h (canvas px), height (world units), color, glow, font, sub, subColor, subFont, align,
//   mainY / subY (baseline-middle as a fraction of h; defaults 0.36 / 0.8 with a sub line), plate (default true: rounded dark backing, plateAlpha 0.55), crisp (heavier dark outline, no glow blur: for small labels over bright arcs) }
export function makeLabel(text, opts = {}) {
  const o = { w: 1024, h: 256, height: 1, color: '#ffffff', glow: '#ff2bd6', font: '900 150px Orbitron', sub: null, subColor: '#00f0ff', subFont: '700 64px Rajdhani', align: 'center', bright: 0.8, plate: true, plateAlpha: 0.55, crisp: false, ...opts };
  const canvas = document.createElement('canvas');
  canvas.width = o.w; canvas.height = o.h;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  mat.color.setScalar(1);   // drawn after bloom (LabelPass): full brightness, the glow is designed into the texture
  const sprite = new THREE.Sprite(mat);
  sprite.layers.set(LABEL_LAYER);
  sprite.renderOrder = 50;
  sprite.scale.set(o.height * (o.w / o.h), o.height, 1);
  if (o.align === 'left') sprite.center.set(0, 0.5);
  if (o.align === 'right') sprite.center.set(1, 0.5);
  let cur = { text, sub: o.sub, color: o.color, glow: o.glow };
  function fitFont(font, str, maxW) {
    ctx.font = font;
    const w = ctx.measureText(str).width;
    if (w <= maxW) return font;
    const m = font.match(/(\d+)px/);
    const px = Math.max(10, Math.floor(Number(m[1]) * maxW / w));
    return font.replace(/\d+px/, px + 'px');
  }
  // dark rounded backing plate (~55% alpha) hugging the text so labels stay readable over bright scene areas (sun, sky, bloom)
  function plate(lines) {
    if (o.plate === false) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, big = 0;
    for (const l of lines) {
      const px = Number((l.font.match(/(\d+)px/) || [0, 40])[1]);
      ctx.font = l.font; const w = ctx.measureText(l.str).width;
      const lx = o.align === 'left' ? l.x : o.align === 'right' ? l.x - w : l.x - w / 2;
      x0 = Math.min(x0, lx); x1 = Math.max(x1, lx + w); y0 = Math.min(y0, l.y - px * 0.58); y1 = Math.max(y1, l.y + px * 0.58); big = Math.max(big, px);
    }
    const padX = big * 0.3, padY = big * 0.14;
    x0 = Math.max(1, x0 - padX); x1 = Math.min(o.w - 1, x1 + padX); y0 = Math.max(1, y0 - padY); y1 = Math.min(o.h - 1, y1 + padY);
    const r = Math.min((y1 - y0) / 2, big * 0.3);
    ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = `rgba(6,0,22,${o.plateAlpha})`;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.arcTo(x1, y0, x1, y0 + r, r); ctx.lineTo(x1, y1 - r); ctx.arcTo(x1, y1, x1 - r, y1, r);
    ctx.lineTo(x0 + r, y1); ctx.arcTo(x0, y1, x0, y1 - r, r); ctx.lineTo(x0, y0 + r); ctx.arcTo(x0, y0, x0 + r, y0, r); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function redraw() {
    ctx.clearRect(0, 0, o.w, o.h);
    const hasSub = cur.sub != null && cur.sub !== '';
    const pad = o.w * 0.05;
    const x = o.align === 'left' ? pad : o.align === 'right' ? o.w - pad : o.w / 2;
    ctx.textAlign = o.align; ctx.textBaseline = 'middle';
    const mainY = o.h * (hasSub ? (o.mainY ?? 0.36) : 0.5);
    const subY = o.h * (o.subY ?? 0.8);
    const mainFont = fitFont(o.font, cur.text, o.w - pad * 2);
    const subFont = hasSub ? fitFont(o.subFont, cur.sub, o.w - pad * 2) : null;
    plate([{ str: cur.text, font: mainFont, x, y: mainY }, ...(hasSub ? [{ str: cur.sub, font: subFont, x, y: subY }] : [])]);
    ctx.textAlign = o.align; ctx.textBaseline = 'middle';
    // designed glow (labels skip bloom, so the halo lives here and is identical over any background):
    // 1) a soft coloured halo, 2) a dark outline that separates the letters from the halo and any bright scene,
    // 3) the bright fill with a tight inner bloom of its own colour. crisp: smaller halo, heavier outline.
    const line = (str, font, y, fill, glowCol, k) => {
      ctx.font = font;
      const px = Number((font.match(/(\d+)px/) || [0, 60])[1]);
      ctx.lineJoin = 'round';
      ctx.save();
      ctx.fillStyle = glowCol; ctx.strokeStyle = glowCol; ctx.shadowColor = glowCol;
      ctx.globalAlpha = o.crisp ? 0.3 : 0.42; ctx.lineWidth = px * 0.2; ctx.shadowBlur = px * (o.crisp ? 0.35 : 0.55); ctx.strokeText(str, x, y);
      ctx.globalAlpha = o.crisp ? 0.7 : 0.9; ctx.shadowBlur = px * 0.2; ctx.fillText(str, x, y);
      ctx.restore();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(4,0,16,0.94)'; ctx.lineWidth = px * (o.crisp ? 0.2 : 0.14) * k; ctx.strokeText(str, x, y);
      ctx.fillStyle = fill; ctx.shadowColor = glowCol; ctx.shadowBlur = px * 0.07; ctx.fillText(str, x, y);
      ctx.shadowBlur = 0; ctx.fillText(str, x, y);   // second pass keeps the core solid
    };
    line(cur.text, mainFont, mainY, cur.color, cur.glow, 1);
    if (hasSub) line(cur.sub, subFont, subY, o.subColor, o.subColor || cur.glow, 0.85);
    tex.needsUpdate = true;
  }
  redraw();
  const api = {
    sprite, yFrac: 0.5, // yFrac: where this label sits in the hologram's reveal range (0 bottom..1 top)
    set(text2, sub2 = cur.sub, color2 = cur.color, glow2 = cur.glow) {
      if (text2 === cur.text && sub2 === cur.sub && color2 === cur.color && glow2 === cur.glow) return;
      cur = { text: text2, sub: sub2, color: color2, glow: glow2 }; redraw();
    },
    redraw,
    get opacity() { return mat.opacity; },
    set opacity(v) { mat.opacity = v; },
    dispose() { LABELS.delete(api); tex.dispose(); mat.dispose(); },
  };
  LABELS.add(api);
  return api;
}
export const fontsLoaded = () => fontsReady;

// ---------- math ----------
export const ease = {
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  outQuint: (k) => 1 - Math.pow(1 - k, 5),
  back: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
};
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
export const pctText = (p) => `${Math.round(clamp01(p) * 100)}%`;
export const ptsText = (d) => { const n = Math.round(Math.abs(d) * 100); return n === 0 ? 'flat today' : `${d > 0 ? '▲' : '▼'} ${n} pts today`; };

export function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
  });
}

// ---------- Holo: base for every per-story hologram ----------
// Lifecycle: created hidden -> show() scans in over ~1.2s -> hide() fades out -> dead -> dispose()
export class Holo {
  constructor(ctx, { height = 12, axis = 'y', width = 0 } = {}) {
    this.ctx = ctx;
    this.station = ctx.station.clone();
    this.root = new THREE.Group();
    this.root.position.copy(this.station);
    ctx.scene.add(this.root);
    this.mats = []; this.labels = []; this.extra = [];
    this.fade = 0; this.reveal = 0; this.tShow = 0; this.visible = false; this.dead = false;
    this.revealDur = 1.3; this.height = height;
    this.axis = axis === 'x' ? 1 : 0;
    this.r0 = axis === 'x' ? this.station.x - width / 2 : this.station.y;
    this.r1 = axis === 'x' ? this.station.x + width / 2 : this.station.y + height;
  }
  mat(color, opts) { const m = holoMaterial(color, opts); this.mats.push(m); return m; }
  line(color, opts) { const m = lineMaterial(color, opts); this.mats.push(m); return m; }
  reg(m) { this.mats.push(m); return m; }
  label(text, opts = {}) { const l = makeLabel(text, opts); l.opacity = 0; this.labels.push(l); this.root.add(l.sprite); return l; }
  show() { this.visible = true; this.tShow = 0; this.reveal = 0; }
  hide() { this.visible = false; }
  baseTick(dt) {
    if (this.visible) { this.tShow += dt; this.reveal = ease.outQuint(clamp01(this.tShow / this.revealDur)); this.fade = damp(this.fade, 1, 6, dt); }
    else { this.fade = damp(this.fade, 0, 5, dt); if (this.fade < 0.015) this.dead = true; }
    for (const m of this.mats) {
      const u = m.uniforms; if (!u) { m.opacity = this.fade; continue; }
      if (u.uFade) u.uFade.value = this.fade;
      if (u.uReveal) u.uReveal.value = this.reveal;
      if (u.uR0) { u.uR0.value = this.r0; u.uR1.value = this.r1; u.uAxis.value = this.axis; }
    }
    // reveal * 1.15: labels near the top (yFrac ~0.98: titles, NOW readouts) reach full opacity once the scan-in ends (were stuck at ~35%, grey)
    for (const l of this.labels) l.opacity = this.fade * clamp01((this.reveal * 1.15 - l.yFrac) * 6 + 0.2) * (l.bright ?? 1);
  }
  tick(dt, t) { this.baseTick(dt); }
  pose() { const tgt = this.station.clone().add(new THREE.Vector3(0, this.height / 2, 0)); return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 3, 40)), orbit: 0.12, box: new THREE.Box3(this.station.clone().add(new THREE.Vector3(-10, 0, -3)), this.station.clone().add(new THREE.Vector3(10, this.height, 3))) }; }
  dispose() { for (const l of this.labels) l.dispose(); disposeTree(this.root); this.root.parent?.remove(this.root); for (const f of this.extra) f(); }
}

// world-space box helper for poses
export const boxAt = (station, x0, y0, z0, x1, y1, z1) => new THREE.Box3(station.clone().add(new THREE.Vector3(x0, y0, z0)), station.clone().add(new THREE.Vector3(x1, y1, z1)));
