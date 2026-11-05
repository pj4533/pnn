// Shared hologram toolkit: palette per theme, seeded variation, scan-in materials, canvas labels, easing.
import * as THREE from '../../vendor/three/three.module.js';

export const TIME = { value: 0 }; // shared time uniform, set by the frame loop

// Theme palettes (a = primary accent, b = secondary). Everything neon so bloom reads.
// stage (optional): the secondary colour the STAGE gets (world.setTheme, hero colorB, floor ring) when b would read as a
// takeover there. economy.b is the same green as "up", so economy stories turned the whole stage green (item 14); the
// widgets keep b, the stage gets a warm orange accent next to the gold.
export const THEMES = {
  politics: { a: '#ff2bd6', b: '#00f0ff' },
  economy: { a: '#ffd23f', b: '#3dff8a', stage: '#ff8a2e' },
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
// palette(story) -> { a, b, stage (stage secondary, = b unless the theme sets one), hexA, hexB, seed, rnd, pick(i) } tinted per theme, nudged per story id
export function palette(story, themeOverride) {
  const theme = themeOverride || story?.visual?.theme || 'world';
  const base = THEMES[theme] || THEMES.world;
  const seed = hash(story?.id || story?.eventTitle || theme);
  const rnd = rng(seed);
  const shift = (rnd() - 0.5) * 0.08;
  const a = nudgeHue(new THREE.Color(base.a), shift), b = nudgeHue(new THREE.Color(base.b), -shift * 0.5);
  const stage = base.stage ? nudgeHue(new THREE.Color(base.stage), -shift * 0.5) : b;
  const hexA = '#' + a.getHexString(), hexB = '#' + b.getHexString();
  const extras = EXTRA.filter((h) => h !== base.a && h !== base.b);
  const list = [a, b, ...extras.map((h) => new THREE.Color(h))];
  return { theme, seed, rnd, a, b, stage, hexA, hexB, pick: (i) => list[i % list.length], hex: (i) => '#' + list[i % list.length].getHexString() };
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
// Web fonts must be in before any label is drawn, or the canvas falls back to a serif. Canvas text never triggers a font load by itself,
// and document.fonts.load() resolves with [] when the Google Fonts stylesheet has not been parsed yet, so: load explicitly, then keep
// redrawing every label whenever the font set changes (loadingdone), and retry until the Orbitron + Rajdhani faces are really loaded.
const FACES = ['900 80px Orbitron', '700 80px Orbitron', '800 60px Rajdhani', '700 60px Rajdhani', '600 60px Rajdhani'];
function redrawAll() { for (const e of [...CACHE.values()]) dropEntry(e); WARMQ.length = 0; for (const l of LABELS) l.redraw(); }   // lazy: visible labels redraw at their next render, the rest via the pump
function faceStatus(fam) { let n = 0, ok = 0; if (document.fonts) document.fonts.forEach((f) => { if (f.family.replace(/["']/g, '') === fam) { n++; if (f.status === 'loaded') ok++; } }); return { n, ok }; }
if (typeof document !== 'undefined' && document.fonts?.load) {
  let tries = 0;
  const pump = () => {
    Promise.all(FACES.map((f) => document.fonts.load(f, 'Aa0%\u25B2\u25BC'))).then(() => {
      const o = faceStatus('Orbitron'), r = faceStatus('Rajdhani');
      const ready = o.n > 0 && o.ok > 0 && r.n > 0 && r.ok > 0;
      if (ready) { fontsReady = true; redrawAll(); }
      else if (++tries < 40) setTimeout(pump, 250);
    }).catch(() => { if (++tries < 40) setTimeout(pump, 500); });
  };
  pump();
  document.fonts.addEventListener?.('loadingdone', () => { if (faceStatus('Orbitron').ok && faceStatus('Rajdhani').ok) { fontsReady = true; redrawAll(); } });
  document.fonts.ready?.then(() => { if (faceStatus('Orbitron').ok) redrawAll(); });
}
// every canvas font names a fallback sans, so an unloaded face never turns serif
const withFallback = (font) => (font.includes(',') ? font : `${font}, "Arial Narrow", "Helvetica Neue", Arial, sans-serif`);
// ---- label scheduler (perf, item 11). A widget build used to draw ~20 label canvases and upload them all in its first
// frame, and every count-up redraw was uploaded right after drawing it. In WebKit an upload right after a canvas draw
// waits for that raster (3-5 ms per label; the boot warmup's 77 labels took 600+ ms); one frame later the same upload
// costs 0.6-2 ms (Chromium ~0.05 ms). So a label is drawn on one frame and uploaded on the next:
//  - makeLabel only queues the label. pumpLabels() (after render) issues the canvas draws of queued hidden labels in reveal
//    order (lowest yFrac first) within a time budget; labelsCommit() (after the widget ticks, before render) uploads what
//    was drawn on an earlier frame: labels on screen through three at this render, hidden ones via renderer.initTexture
//    (budgeted). labelsFrameStart() opens each frame.
//  - a label on screen whose text changes (count-ups) draws at once and shows the new text from the next frame on (its
//    texture keeps the old text meanwhile). A label never drawn before stays hidden until its first upload: it appears
//    one frame later, at the ~1% opacity its reveal starts from.
//  - opacity 0 hides the sprite (material.visible): a fully transparent sprite drew nothing anyway, and three then neither
//    draws nor uploads it. set() with unchanged text is a no-op. Canvases + CanvasTextures are pooled per size on dispose.
//  Without an attached renderer (no frame loop calling the two hooks) labels draw + upload synchronously, as before.
// Perf round 3 (Safari reveal hitches): the canvas draw's real cost is the deferred raster (shadow blurs) on the GPU, not
// the 2 ms of JS it measures, so a reveal that drew 8-19 labels in one frame stalled 40-60 ms. Now:
//  - prewarm: a few seconds before a card change the scene builds the NEXT widget off-scene (prewarmLabels) only to
//    collect its label contents (and, via label.warm(texts), the values its count-ups will pass through). Those are
//    drawn into a content-keyed CACHE and uploaded (initTexture), a few per frame, during the outgoing widget's hold.
//    A label whose exact content (text, sub, colours, every raster option) is cached shows that texture: no draw and no
//    upload at reveal, and a count-up step to a cached value is just a texture swap. Same pixels: the cache holds the
//    very canvas makeLabel would have drawn. Misses draw as before.
//  - draws per frame are capped by canvas area (FRAME_PX, at least one per frame), so misses spread over frames.
const QUEUE = new Set();      // dirty and hidden: waiting for a pump draw
const UPQ = new Map();        // drawn, not uploaded yet -> frame it was drawn on
let labelRenderer = null, frameNo = 0, held = false;
const POOL = new Map(); let poolPx = 0;
const POOL_MAX_PX = 4e6;
const FRAME_PX = 7e5;         // canvas px a frame may draw for labels (on screen first); at least one label per frame
const WARM_PX = 2.5e5, WARM_N = 3;   // per-frame px / count for prewarm draws and for their uploads (hold frames)
const CACHE_MAX_PX = 1e7;     // prewarmed textures kept (~40 MB RGBA); unreferenced ones are evicted oldest first
const CACHE_TTL = 90e3;       // an unreferenced cache entry older than this is released
const SEQ_MAX = 101;          // most count-up values one label may prewarm
let frameDrawPx = 0, frameDraws = 0, warmUpPx = 0, warmUpN = 0, lastSweep = 0;
function takeCanvas(w, h) {
  const list = POOL.get(w + 'x' + h);
  if (list && list.length) { poolPx -= w * h; return list.pop(); }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}
function giveCanvas(b) {
  const w = b.canvas.width, h = b.canvas.height;
  if (poolPx + w * h > POOL_MAX_PX) { b.tex.dispose(); return; }
  const k = w + 'x' + h; if (!POOL.has(k)) POOL.set(k, []);
  POOL.get(k).push(b); poolPx += w * h;
}
const canDraw = (px) => !labelRenderer || frameDraws === 0 || frameDrawPx + px <= FRAME_PX;
const noteDraw = (px) => { frameDrawPx += px; frameDraws++; };

// ---- label raster: one function so a prewarmed canvas is byte-for-byte what the label itself would draw
function fitFont(ctx, font, str, maxW) {
  ctx.font = font;
  const w = ctx.measureText(str).width;
  if (w <= maxW) return font;
  const m = font.match(/(\d+)px/);
  const px = Math.max(10, Math.floor(Number(m[1]) * maxW / w));
  return font.replace(/\d+px/, px + 'px');
}
// soft translucent backing for the hero readout and badges only (plate:true): feathered edges, no hard box, no border
function drawPlate(ctx, o, lines) {
  if (!o.plate) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, big = 0;
  for (const l of lines) {
    const px = Number((l.font.match(/(\d+)px/) || [0, 40])[1]);
    ctx.font = l.font; const w = ctx.measureText(l.str).width;
    const lx = o.align === 'left' ? l.x : o.align === 'right' ? l.x - w : l.x - w / 2;
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx + w); y0 = Math.min(y0, l.y - px * 0.56); y1 = Math.max(y1, l.y + px * 0.56); big = Math.max(big, px);
  }
  const feather = big * 0.22, padX = big * 0.22, padY = big * 0.08;
  x0 = Math.max(feather + 1, x0 - padX); x1 = Math.min(o.w - feather - 1, x1 + padX); y0 = Math.max(feather + 1, y0 - padY); y1 = Math.min(o.h - feather - 1, y1 + padY);
  const r = Math.min((y1 - y0) / 2, big * 0.35);
  ctx.save(); ctx.fillStyle = `rgba(6,0,22,${o.plateAlpha})`; ctx.shadowColor = `rgba(6,0,22,${o.plateAlpha * 1.6})`; ctx.shadowBlur = feather;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.arcTo(x1, y0, x1, y0 + r, r); ctx.lineTo(x1, y1 - r); ctx.arcTo(x1, y1, x1 - r, y1, r);
  ctx.lineTo(x0 + r, y1); ctx.arcTo(x0, y1, x0, y1 - r, r); ctx.lineTo(x0, y0 + r); ctx.arcTo(x0, y0, x0 + r, y0, r); ctx.closePath(); ctx.fill(); ctx.restore();
}
function paintLabel(ctx, o, cur) {
  ctx.clearRect(0, 0, o.w, o.h);
  const hasSub = cur.sub != null && cur.sub !== '';
  const pad = o.w * 0.05;
  const x = o.align === 'left' ? pad : o.align === 'right' ? o.w - pad : o.w / 2;
  ctx.textAlign = o.align; ctx.textBaseline = 'middle';
  const mainY = o.h * (hasSub ? (o.mainY ?? 0.36) : 0.5);
  const subY = o.h * (o.subY ?? 0.8);
  const mainFont = fitFont(ctx, o.font, cur.text, o.w - pad * 2);
  const subFont = hasSub ? fitFont(ctx, o.subFont, cur.sub, o.w - pad * 2) : null;
  drawPlate(ctx, o, [{ str: cur.text, font: mainFont, x, y: mainY }, ...(hasSub ? [{ str: cur.sub, font: subFont, x, y: subY }] : [])]);
  ctx.textAlign = o.align; ctx.textBaseline = 'middle';
  // designed glow (labels skip bloom, so the halo lives here and is identical over any background):
  // 1) a soft coloured halo, 2) a dark outline that separates the letters from the halo and any bright scene,
  // 3) the bright fill with a tight inner bloom of its own colour. crisp: smaller halo, heavier outline.
  const line = (str, font, y, fill, glowCol, k) => {
    ctx.font = font;
    const px = Number((font.match(/(\d+)px/) || [0, 60])[1]);
    ctx.lineJoin = 'round';
    // the halo must fade out INSIDE the canvas: a blur that reaches the texture edge is clipped into a hard-edged box (the old "plate" look on tick labels)
    const tw = ctx.measureText(str).width;
    const lft = o.align === 'left' ? x : o.align === 'right' ? x - tw : x - tw / 2;
    const mxo = Math.min(lft, o.w - lft - tw);                                                          // free space left/right of the glyphs
    const my = Math.min(y, o.h - y) - px * 0.4;                                                        // free space above/below the caps
    const room = Math.max(3, Math.min(mxo, my) - px * 0.06);
    const blurMax = Math.min(px * (o.crisp ? 0.35 : 0.5), room * 0.9);
    ctx.save();
    ctx.fillStyle = glowCol; ctx.strokeStyle = glowCol; ctx.shadowColor = glowCol;
    ctx.globalAlpha = o.crisp ? 0.3 : 0.42; ctx.lineWidth = Math.min(px * 0.1, room * 0.4); ctx.shadowBlur = blurMax; ctx.strokeText(str, x, y);
    ctx.globalAlpha = o.crisp ? 0.7 : 0.9; ctx.shadowBlur = Math.min(px * 0.2, blurMax); ctx.fillText(str, x, y);
    ctx.restore();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(4,0,16,0.94)'; ctx.lineWidth = px * (o.crisp ? 0.2 : 0.14) * k; ctx.strokeText(str, x, y);
    ctx.fillStyle = fill; ctx.shadowColor = glowCol; ctx.shadowBlur = px * 0.07; ctx.fillText(str, x, y);
    ctx.shadowBlur = 0; ctx.fillText(str, x, y);   // second pass keeps the core solid
  };
  line(cur.text, mainFont, mainY, cur.color, cur.glow, 1);
  if (hasSub) line(cur.sub, subFont, subY, o.subColor, o.subColor || cur.glow, 0.85);
}

// ---- content-keyed cache of prewarmed label textures (see the header above)
const CACHE = new Map();      // key -> { key, o, cur, b (bundle), state 0 queued / 1 drawn / 2 uploaded, frame, refs, used, gen, pri }
const WARMQ = [];             // entries waiting for a draw (sorted by pri)
let cachePx = 0, warmGen = 0, warming = null;
const optKey = (o) => JSON.stringify([o.w, o.h, o.font, o.subFont, o.subColor, o.align, o.plate, o.plateAlpha, o.crisp, o.mainY ?? null, o.subY ?? null]);
const contentKey = (ok, c) => `${ok}\u0001${c.text}\u0001${c.sub ?? ''}\u0001${c.color}\u0001${c.glow}`;
function dropEntry(e) {
  if (CACHE.get(e.key) === e) CACHE.delete(e.key);
  e.dead = true;
  if (e.refs > 0) return;                          // a label still shows it; released when that label lets go
  if (e.b) { cachePx -= e.o.w * e.o.h; giveCanvas(e.b); e.b = null; }
}
function releaseEntry(e) { e.refs--; e.used = performance.now(); if (e.dead && e.refs <= 0 && e.b) { cachePx -= e.o.w * e.o.h; giveCanvas(e.b); e.b = null; } }
/** Make room for px more cache pixels: evict unreferenced entries of older prewarms, least recently used first. */
function cacheRoom(px) {
  if (cachePx + px <= CACHE_MAX_PX) return true;
  const old = [...CACHE.values()].filter((e) => e.refs <= 0 && e.b && e.gen !== warmGen).sort((a, b) => a.used - b.used);
  for (const e of old) { dropEntry(e); if (cachePx + px <= CACHE_MAX_PX) return true; }
  return false;
}
function cacheSweep(now) {
  if (now - lastSweep < 2000) return;
  lastSweep = now;
  for (const e of [...CACHE.values()]) if (e.refs <= 0 && e.state === 2 && now - e.used > CACHE_TTL) dropEntry(e);
}
function wantEntry(ok, o, cur, pri) {
  const key = contentKey(ok, cur);
  const e = CACHE.get(key);
  if (e) { e.gen = warmGen; e.used = performance.now(); e.pri = Math.min(e.pri, pri); return; }
  const n = { key, o, cur: { ...cur }, b: null, state: 0, frame: 0, refs: 0, used: performance.now(), gen: warmGen, pri };
  CACHE.set(key, n); WARMQ.push(n);
}
/** Prewarm the labels of a widget that will air soon. fn() builds it (off-scene) and returns its dispose(). Every label
 *  made inside fn (plus the texts passed to label.warm) is queued for a draw + upload in spare frame time. Only the
 *  last prewarm counts: entries still queued from an older one are dropped. Returns the number of contents queued. */
export function prewarmLabels(fn) {
  if (!labelRenderer || !fontsReady) return 0;
  warmGen++;
  for (let i = WARMQ.length - 1; i >= 0; i--) { const e = WARMQ[i]; if (e.gen !== warmGen) { WARMQ.splice(i, 1); dropEntry(e); } }
  warming = [];
  let reqs = [], done = null;
  try { done = fn(); } finally { reqs = warming; warming = null; }
  let n = 0;
  for (const r of reqs) {
    const yf = Number.isFinite(r.api.yFrac) ? r.api.yFrac : 0.5;
    wantEntry(r.ok, r.o, r.cur(), yf); n++;
    const seq = r.seq.slice(0, SEQ_MAX);
    seq.forEach((t, i) => { wantEntry(r.ok, r.o, { ...r.cur(), text: t }, 1 + yf + i * 0.01); n++; });
  }
  WARMQ.sort((a, b) => a.pri - b.pri);
  try { done?.(); } catch (e) { console.warn('[holo] prewarm dispose', e); }
  return n;
}
export const labelCacheStats = () => ({ entries: CACHE.size, px: cachePx, queued: WARMQ.length, ready: [...CACHE.values()].filter((e) => e.state === 2).length });
/** The scene hands its renderer over once; from then on labels draw and upload a frame apart (see above). */
export function attachLabelRenderer(renderer) { labelRenderer = renderer; }
/** Warmup builds every widget only to compile programs: hold label draws meanwhile (they are disposed unseen). */
export function holdLabels(on) { held = !!on; }
/** Start of each frame (before anything can redraw a label). */
export function labelsFrameStart() { frameNo++; frameDrawPx = 0; frameDraws = 0; warmUpPx = 0; warmUpN = 0; }
/** Before render: commit uploads of labels drawn on an earlier frame. On-screen ones always (three uploads them at
 *  this render); hidden ones via initTexture, lowest yFrac first, within budgetMs. Then prewarmed canvases drawn on an
 *  earlier frame, a few per frame. */
export function labelsCommit(budgetMs = 3) {
  const t0 = performance.now();
  if (UPQ.size) {
    let hidden = null;
    for (const [l, k] of UPQ) {
      if (k >= frameNo) continue;
      if (l.opacity > 0) { UPQ.delete(l); l._commit(); } else (hidden ||= []).push(l);
    }
    if (hidden) {
      hidden.sort((a, b) => a.yFrac - b.yFrac);
      for (const l of hidden) { if (performance.now() - t0 >= budgetMs) break; UPQ.delete(l); l._upload(); }
    }
  }
  if (CACHE.size) {
    for (const e of CACHE.values()) {
      if (e.state !== 1 || e.frame >= frameNo) continue;
      const px = e.o.w * e.o.h;
      if (warmUpN >= WARM_N || (warmUpN && warmUpPx + px > WARM_PX) || performance.now() - t0 >= budgetMs) break;
      e.b.tex.needsUpdate = true; labelRenderer.initTexture(e.b.tex); e.state = 2;
      warmUpN++; warmUpPx += px;
    }
    cacheSweep(t0);
  }
}
/** After render: issue canvas draws for queued labels (on screen first, then lowest yFrac) within budgetMs and the
 *  frame's canvas-area cap (at least one), then prewarm draws in what is left of a smaller budget. */
export function pumpLabels(budgetMs = 2) {
  const t0 = performance.now();
  while (QUEUE.size && performance.now() - t0 < budgetMs) {
    let best = null;
    for (const l of QUEUE) if (!best || (l.opacity > 0) > (best.opacity > 0) || ((l.opacity > 0) === (best.opacity > 0) && l.yFrac < best.yFrac)) best = l;
    if (!canDraw(best.px)) return;
    QUEUE.delete(best); best._draw();
  }
  if (QUEUE.size) return;                         // the current widget's own labels come first
  let n = 0;
  while (WARMQ.length && n < WARM_N && performance.now() - t0 < budgetMs) {
    const e = WARMQ[0], px = e.o.w * e.o.h;
    if (frameDraws && frameDrawPx + px > WARM_PX) break;
    WARMQ.shift();
    if (e.dead || CACHE.get(e.key) !== e) continue;
    if (!cacheRoom(px)) { dropEntry(e); continue; }
    e.b = takeCanvas(e.o.w, e.o.h); cachePx += px;
    paintLabel(e.b.ctx, e.o, e.cur);
    e.state = 1; e.frame = frameNo; noteDraw(px); n++;
  }
}
export const labelQueueSize = () => QUEUE.size + UPQ.size;
// Label: Sprite with a fixed-size canvas; text scaled to fit. opts: { w, h (canvas px), height (world units), color, glow, font, sub, subColor, subFont, align,
//   mainY / subY (baseline-middle as a fraction of h; defaults 0.36 / 0.8 with a sub line), plate (default FALSE: tick/axis labels are plain text with glow + a thin dark outline;
//   pass plate:true only for the hero readout and badges: a soft, feathered translucent backing, plateAlpha 0.34), crisp (heavier dark outline, no glow blur: for small labels over bright arcs) }
// label.warm(texts): main-line texts this label will count through (same sub/colours); only used by a prewarm build.
export function makeLabel(text, opts = {}) {
  const o = { w: 1024, h: 256, height: 1, color: '#ffffff', glow: '#ff2bd6', font: '900 150px Orbitron', sub: null, subColor: '#00f0ff', subFont: '700 64px Rajdhani', align: 'center', bright: 0.8, plate: false, plateAlpha: 0.34, crisp: false, ...opts };
  o.font = withFallback(o.font); o.subFont = withFallback(o.subFont);
  const ok = optKey(o), PX = o.w * o.h;
  const warmReq = warming;                         // made inside a prewarm build: never drawn, only its contents are collected
  let own = null;                                  // this label's canvas + texture, taken on its first own draw
  let ent = null;                                  // the cache entry it shows instead, if any
  const mat = new THREE.SpriteMaterial({ map: null, transparent: true, depthWrite: false, depthTest: false });
  mat.color.setScalar(1);   // drawn after bloom (LabelPass): full brightness, the glow is designed into the texture
  const sprite = new THREE.Sprite(mat);
  sprite.layers.set(LABEL_LAYER);
  sprite.renderOrder = 50;
  sprite.scale.set(o.height * (o.w / o.h), o.height, 1);
  if (o.align === 'left') sprite.center.set(0, 0.5);
  if (o.align === 'right') sprite.center.set(1, 0.5);
  let cur = { text, sub: o.sub, color: o.color, glow: o.glow };
  let dirty = true, disposed = false, shown = false;
  const vis = () => { mat.visible = shown && mat.opacity > 0; };
  const cached = () => {
    if (!fontsReady || !CACHE.size) return null;
    const e = CACHE.get(contentKey(ok, cur));
    return e && e.state === 2 ? e : null;
  };
  function useEntry(e) {
    QUEUE.delete(api); UPQ.delete(api); dirty = false;
    if (ent !== e) { if (ent) releaseEntry(ent); ent = e; e.refs++; }
    e.used = performance.now();
    mat.map = e.b.tex; shown = true; vis();
  }
  function showOwn() {
    if (ent) { releaseEntry(ent); ent = null; }
    mat.map = own.tex; own.tex.needsUpdate = true; shown = true; vis();
  }
  function redraw() {
    if (!own) own = takeCanvas(o.w, o.h);
    paintLabel(own.ctx, o, cur);
    noteDraw(PX);
    dirty = false;
    if (labelRenderer) UPQ.set(api, frameNo);
    else showOwn();
  }
  // on screen (or about to be): draw now (frame cap allowing), upload next frame; hidden: queue for the pump.
  // A prewarmed texture with exactly this content is shown instead (force: fonts changed, ignore the cache).
  const invalidate = (force) => {
    if (disposed || warmReq) return;
    if (force !== true) { const e = cached(); if (e) { useEntry(e); return; } }
    dirty = true;
    if (mat.opacity > 0 && !held && canDraw(PX)) { QUEUE.delete(api); redraw(); } else QUEUE.add(api);
  };
  sprite.onBeforeRender = () => { if (dirty && canDraw(PX)) { QUEUE.delete(api); redraw(); } };
  const api = {
    sprite, yFrac: 0.5, px: PX, // yFrac: where this label sits in the hologram's reveal range (0 bottom..1 top)
    set(text2, sub2 = cur.sub, color2 = cur.color, glow2 = cur.glow) {
      if (text2 === cur.text && sub2 === cur.sub && color2 === cur.color && glow2 === cur.glow) return;
      cur = { text: text2, sub: sub2, color: color2, glow: glow2 }; invalidate();
    },
    warm(texts) { if (warmReq && idx >= 0) warmReq[idx].seq.push(...texts.filter((t) => t !== cur.text)); },
    redraw: () => invalidate(true),
    _draw() { if (!disposed && dirty) redraw(); },
    _commit() { if (disposed) return; if (dirty) { redraw(); return; } if (own) showOwn(); },
    _upload() { if (disposed) return; if (dirty) { redraw(); return; } if (own) { showOwn(); labelRenderer.initTexture(own.tex); } },
    _sync() { if (disposed) return; if (dirty || !own) redraw(); UPQ.delete(api); showOwn(); },   // warmup: draw + upload now
    get opacity() { return mat.opacity; },
    set opacity(v) {
      mat.opacity = v;
      if (v > 0 && dirty && !disposed && !held && !warmReq) { if (canDraw(PX)) { QUEUE.delete(api); redraw(); } else QUEUE.add(api); }   // reveal reached a label the pump has not drawn yet
      vis();
    },
    dispose() {
      if (disposed) return; disposed = true;
      LABELS.delete(api); QUEUE.delete(api); UPQ.delete(api);
      sprite.removeFromParent(); sprite.onBeforeRender = () => {};
      mat.map = null; mat.dispose();
      if (ent) { releaseEntry(ent); ent = null; }
      if (own) { giveCanvas(own); own = null; }
    },
  };
  let idx = -1;
  if (warmReq) {
    idx = warmReq.length;
    warmReq.push({ api, ok, o, cur: () => cur, seq: [] });
    dirty = false;
    return api;
  }
  vis();   // hidden until its first upload (a pooled canvas may still hold another label's text)
  LABELS.add(api);
  const e0 = cached();
  if (e0) useEntry(e0); else QUEUE.add(api);
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
/** Every whole-percent text a count from a to b passes through, in order (for label.warm). */
export function pctSeq(a, b) {
  const x = Math.round(clamp01(a) * 100), y = Math.round(clamp01(b) * 100), s = y >= x ? 1 : -1, out = [];
  for (let n = x; n !== y + s; n += s) out.push(`${n}%`);
  return out;
}
export const ptsText = (d) => { const n = Math.round(Math.abs(d) * 100); return n === 0 ? 'flat today' : `${d > 0 ? '▲' : '▼'} ${n} ${n === 1 ? 'pt' : 'pts'} today`; };

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
