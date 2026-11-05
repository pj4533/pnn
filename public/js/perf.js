// Real-device perf telemetry (item 11). Measures every frame (rAF deltas), attributes each frame to what was on air
// (scene id, transition, widget type + phase, rundown segment) and to named hitch causes timed with performance.now()
// (scene create/warm/dispose, shader compile/link, programs count, label canvas redraws + texture uploads, widget
// build/swap/dispose, SSE handlers, overlay render). Every 30 s it POSTs one {kind:'perf'} line to /api/client-log
// (level debug: file only, scripts/perf-report.mjs ranks it). ?perf=1 adds a small corner HUD. No visual change otherwise.
// Hot path: index.js calls perf.sec(i, ms) per frame section; post.js keeps per-pass CPU ms; everything else is rare.
const now = () => performance.now();
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const WINDOW_MS = Q.get('perfwin') ? Math.max(5000, +Q.get('perfwin') * 1000) : 30000;
const HUD = Q.get('perf') === '1';
export const SECTIONS = ['cam', 'hero', 'widget', 'outgoing', 'globe', 'fx', 'world', 'post', 'other'];
const MAXF = 8192;

function deviceInfo() {
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const device = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : 'other';
  const browser = /HeadlessChrome/.test(ua) ? 'HeadlessChrome' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'other';
  return {
    device, browser, headless: !!navigator.webdriver || /Headless/.test(ua) || undefined,
    standalone: (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone || undefined,
    screen: `${screen.width}x${screen.height}`, dpr: window.devicePixelRatio || 1, cores: navigator.hardwareConcurrency || undefined,
  };
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
const r1 = (v) => Math.round(v * 10) / 10;

function makeStats() { return { n: 0, sum: 0, l33: 0, l50: 0, worst: 0, arr: [] }; }
function addStat(s, d) { s.n++; s.sum += d; if (d > 33.4) s.l33++; if (d > 50) s.l50++; if (d > s.worst) s.worst = d; if (s.arr.length < 4000) s.arr.push(d); }
function sumStat(s) { const a = s.arr.sort((x, y) => x - y); return { n: s.n, avg: r1(s.sum / s.n), p95: r1(pct(a, 0.95)), l33: s.l33, l50: s.l50, worst: Math.round(s.worst) }; }

export const perf = {
  on: false,
  info: null,
  // scene hooks (filled by attachScene)
  _scene: null, _gl: null, _renderer: null,
  // per-frame pending bucket (closed at each rAF tick of this module)
  sec: (i, ms) => { pend.sec[i] += ms; },
  ev(name, ms = 0, detail) {
    if (!perf.on) return;
    pend.ev.push(detail != null ? { n: name, ms, d: String(detail).slice(0, 60) } : { n: name, ms });
  },
  time(name, fn, detail) { const t = now(); try { return fn(); } finally { perf.ev(name, now() - t, detail); } },
  wrap(obj, method, name) {
    const f = obj?.[method]; if (typeof f !== 'function' || f.__perf) return;
    const w = function (...a) { const t = now(); depth++; try { return f.apply(this, a); } finally { const ms = now() - t; if (--depth === 0) pend.js += ms; if (ms >= 1) perf.ev(name, ms); } };
    w.__perf = true; obj[method] = w;
  },
  passes(names, ms) { for (let i = 0; i < ms.length; i++) { pend.pass[names[i]] = (pend.pass[names[i]] || 0) + ms[i]; } },
  cpu(ms) { pend.cpu += ms; },
  setQuality(envQ, pr) {
    if (!perf.on || (win.quality && win.quality.envQ === envQ && win.quality.pr === pr)) return;
    if (win.quality) perf.ev('quality', 0, `q${envQ} pr${pr}`);
    win.quality = { envQ, pr };
  },
  attachScene(s) { perf._scene = s; if (s.renderer) instrumentGL(s.renderer); },
  stats: null,
};

// two buckets swapped each frame and reset in place (the telemetry must not add GC churn of its own)
function freshPend() { return { sec: new Float64Array(SECTIONS.length), pass: {}, ev: [], js: 0, cpu: 0, gl: { shN: 0, shMs: 0, texN: 0, texMs: 0, canvasTexN: 0, bufN: 0, bufMs: 0 }, c2d: 0, labels: 0 }; }
function resetPend(p) { p.sec.fill(0); for (const k in p.pass) p.pass[k] = 0; p.ev.length = 0; p.js = p.cpu = p.c2d = p.labels = 0; const g = p.gl; g.shN = g.shMs = g.texN = g.texMs = g.canvasTexN = g.bufN = g.bufMs = 0; return p; }
let pend = freshPend(), spare = freshPend();
const keys = [], evs = [];
let depth = 0;   // nested wrapped calls (sse.state -> director.update -> overlay.render) count once toward measured JS

let win = null;
function freshWin() {
  return {
    start: Date.now(), t0: now(), deltas: new Float32Array(MAXF), nf: 0, l33: 0, l50: 0, worst: 0, worstCtx: null, hidden: 0,
    by: new Map(), hitches: [], events: [], secSum: new Float64Array(SECTIONS.length), secMax: new Float64Array(SECTIONS.length), passSum: {}, cpuSum: 0, cpuMax: 0,
    gl: { shN: 0, shMs: 0, texN: 0, texMs: 0, canvasTexN: 0, bufN: 0, bufMs: 0 }, labels: 0, c2dMs: 0, unattributed50: 0, loaf: [],
    quality: win?.quality || null,
  };
}

// ---------- GL + canvas instrumentation (rare calls only) ----------
function instrumentGL(renderer) {
  if (perf._gl) return;
  const gl = renderer.getContext(); perf._gl = gl; perf._renderer = renderer;
  const G = () => pend.gl;
  const timed = (name, onDone) => { const f = gl[name]; if (typeof f !== 'function') return; gl[name] = function (...a) { const t = now(); try { return f.apply(gl, a); } finally { onDone(now() - t, a); } }; };
  timed('compileShader', (ms) => { G().shN++; G().shMs += ms; });
  timed('linkProgram', (ms) => { G().shMs += ms; });
  // three's checkShaderErrors reads LINK_STATUS lazily: on Metal/ANGLE that read is where the compile stall lands
  timed('getProgramParameter', (ms) => { G().shMs += ms; });
  timed('getShaderParameter', (ms) => { G().shMs += ms; });
  const tex = (ms, a) => { const g = G(); g.texN++; g.texMs += ms; const src = a[a.length - 1]; if (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement) g.canvasTexN++; };
  timed('texImage2D', tex); timed('texSubImage2D', tex); timed('texImage3D', tex);
  timed('bufferData', (ms) => { G().bufN++; G().bufMs += ms; });
}
function instrumentCanvas() {
  const P = typeof CanvasRenderingContext2D !== 'undefined' && CanvasRenderingContext2D.prototype; if (!P || P.fillText.__perf) return;
  for (const m of ['fillText', 'strokeText']) {
    const f = P[m];
    P[m] = function (...a) { const t = now(); try { return f.apply(this, a); } finally { pend.c2d += now() - t; } };
    P[m].__perf = true;
  }
  // makeLabel's redraw starts with a full-canvas clearRect: count those as label redraws
  const cr = P.clearRect;
  P.clearRect = function (x, y, w, h) { if (x === 0 && y === 0 && w === this.canvas.width && h === this.canvas.height && w >= 256) pend.labels++; return cr.call(this, x, y, w, h); };
}
function instrumentSSE() {
  if (typeof EventSource === 'undefined' || EventSource.prototype.addEventListener.__perf) return;
  const add = EventSource.prototype.addEventListener;
  EventSource.prototype.addEventListener = function (type, fn, o) {
    if (typeof fn !== 'function') return add.call(this, type, fn, o);
    return add.call(this, type, function (ev) { const t = now(); depth++; try { return fn.call(this, ev); } finally { const ms = now() - t; if (--depth === 0) pend.js += ms; perf.ev('sse.' + type, ms, ev?.data ? Math.round(ev.data.length / 1024) + 'KB' : null); } }, o);
  };
  EventSource.prototype.addEventListener.__perf = true;
}

// ---------- per-frame context ----------
let lastScene = { cur: null, trans: null, next: null, nextState: null, evKey: '' }, lastPoll = 0;
function sceneCtx(force) {
  const s = perf._scene; if (!s) return { scene: null, trans: null, widget: null, phase: null };
  let scene = null, trans = null, widget = null, phase = null;
  try {
    const d = s.director();
    if (d) {
      const tr = d.transition, cur = d.current, nx = d.nextInst;
      scene = cur?.id || null; trans = tr ? tr.type : null;
      if (scene !== lastScene.cur) { if (lastScene.cur) perf.ev('scene.current', 0, scene); lastScene.cur = scene; }
      if (trans !== lastScene.trans) { perf.ev(trans ? 'trans.start' : 'trans.end', 0, trans ? `${trans} ${tr.A?.id}>${tr.B?.id}` : lastScene.trans); lastScene.trans = trans; }
      const nid = nx?.id || null, ns = nx?.state || null;
      if (nid !== lastScene.next || ns !== lastScene.nextState) {
        if (nid && ns === 'warming') perf.ev('scene.create', 0, nid);
        else if (nid && ns === 'ready') perf.ev('scene.warm', Math.round(nx.warmMs || 0), nid);
        lastScene.next = nid; lastScene.nextState = ns;
      }
      // director's own event log (dispose / leak / fail / boot), polled once a second and on every long frame
      const t = now();
      if (force || t - lastPoll > 1000) {
        lastPoll = t;
        const evs = d.getState?.().events || [];
        const key = (e) => `${e.t}|${e.type}|${e.id}`;
        const from = lastScene.evKey ? evs.findIndex((e) => key(e) === lastScene.evKey) + 1 : 0;   // -1+1: rotated past it, take all
        for (let i = from; i < evs.length; i++) { const e = evs[i]; if (/^(disposed|leak|fail|boot)/.test(e.type)) perf.ev('scene.' + e.type, e.type === 'boot' ? e.ms || 0 : 0, e.id); }
        if (evs.length) lastScene.evKey = key(evs[evs.length - 1]);
      }
    }
    const w = s.widget?.(); if (w) { widget = w.vis; phase = w.phase; }
  } catch { /* never let telemetry break the show */ }
  return { scene, trans, widget, phase };
}

// ---------- frame loop ----------
let lastT = 0, lastProgs = -1, segFn = null, hud = null, hudFps = { n: 0, t0: 0, fps: 0 };
const segKey = () => { try { return segFn?.() || null; } catch { return null; } };
function tick(ts) {
  requestAnimationFrame(tick);
  if (document.hidden) { lastT = 0; resetPend(pend); return; }
  if (!lastT) { lastT = ts; resetPend(pend); return; }
  const d = ts - lastT; lastT = ts;
  const W = win, p = pend; pend = resetPend(spare); spare = p;
  // programs count change = a new shader program linked this frame
  const r = perf._renderer;
  if (r) { const n = r.info.programs?.length ?? -1; if (lastProgs >= 0 && n > lastProgs) perf.ev('programs', 0, '+' + (n - lastProgs) + '=' + n); lastProgs = n; }
  // move this frame's ev (incl. ones just emitted) to the closed bucket
  const c = sceneCtx(d > 33.4);
  evs.length = 0;
  for (const e of p.ev) evs.push(e);
  for (const e of pend.ev) evs.push(e);
  pend.ev.length = 0;
  const g = p.gl;
  if (g.shN || g.shMs > 2) evs.push({ n: 'shader', ms: g.shMs, d: g.shN + ' compiles' });
  if (p.labels || p.c2d > 2) evs.push({ n: 'label.redraw', ms: p.c2d, d: p.labels + ' labels' });
  if (g.texMs > 2) evs.push({ n: 'tex.upload', ms: g.texMs, d: `${g.texN} (${g.canvasTexN} canvas)` });
  if (g.bufMs > 2) evs.push({ n: 'buffer.upload', ms: g.bufMs, d: g.bufN + ' buffers' });
  const Wg = W.gl; Wg.shN += g.shN; Wg.shMs += g.shMs; Wg.texN += g.texN; Wg.texMs += g.texMs; Wg.canvasTexN += g.canvasTexN; Wg.bufN += g.bufN; Wg.bufMs += g.bufMs;
  W.labels += p.labels; W.c2dMs += p.c2d;
  if (W.nf < MAXF) W.deltas[W.nf] = d;
  W.nf++;
  if (d > 33.4) W.l33++;
  if (d > 50) W.l50++;
  // attribution keys
  const seg = segKey();
  keys.length = 0; keys.push('all');
  if (c.scene) keys.push('scene:' + c.scene);
  if (c.trans) keys.push('trans:' + c.trans);
  if (c.widget) { keys.push('widget:' + c.widget); if (c.phase) keys.push('widget:' + c.widget + ':' + c.phase); }
  if (seg) keys.push('seg:' + seg);
  for (const e of evs) if ((e.ms >= 1 || /^(scene|trans\.start|programs|widget)/.test(e.n)) && !/^(scene\.current|quality)$/.test(e.n) && !keys.includes('ev:' + e.n)) keys.push('ev:' + e.n);
  for (const k of keys) { let s = W.by.get(k); if (!s) W.by.set(k, (s = makeStats())); addStat(s, d); }
  let secTot = 0;
  for (let i = 0; i < SECTIONS.length; i++) { const v = p.sec[i]; W.secSum[i] += v; if (v > W.secMax[i]) W.secMax[i] = v; secTot += v; }
  for (const k in p.pass) W.passSum[k] = (W.passSum[k] || 0) + p.pass[k];
  W.cpuSum += p.cpu; if (p.cpu > W.cpuMax) W.cpuMax = p.cpu;
  const tOff = +((ts - W.t0) / 1000).toFixed(2);
  // notable events go to the window log (capped)
  for (const e of evs) if ((e.ms >= 2 || /^(scene|trans|widget\.build|programs|quality|stall)/.test(e.n)) && W.events.length < 60) W.events.push({ t: tOff, n: e.n, ms: r1(e.ms), ...(e.d ? { d: e.d } : {}), ...(d > 33.4 ? { f: Math.round(d) } : {}) });
  if (d > 33.4) {
    let evMs = 0; for (const e of evs) if (/^(scene\.warmup|widget\.)/.test(e.n)) evMs += e.ms;
    const js = Math.max(p.cpu + p.js, evMs) + g.shMs + g.texMs + p.c2d;
    const sec = {}; for (let i = 0; i < SECTIONS.length; i++) if (p.sec[i] >= 1) sec[SECTIONS[i]] = r1(p.sec[i]);
    const pass = {}; for (const k in p.pass) if (p.pass[k] >= 1) pass[k] = r1(p.pass[k]);
    const h = { t: tOff, ms: Math.round(d), cpu: r1(p.cpu), js: r1(p.js), scene: c.scene, trans: c.trans, widget: c.widget, phase: c.phase, seg, sec, pass, ev: evs.filter((e) => e.ms >= 1 || /^(scene|trans|programs|widget)/.test(e.n)).map((e) => e.n + (e.ms >= 1 ? ':' + Math.round(e.ms) : '') + (e.d ? '(' + e.d + ')' : '')).slice(0, 8) };
    // GC-like / compositor stall: a 50 ms+ frame where measured JS explains < 30% of it
    if (d > 50 && js < d * 0.3) { h.stall = true; W.unattributed50++; if (W.events.length < 60) W.events.push({ t: tOff, n: 'stall', ms: Math.round(d), d: 'js ' + Math.round(js) + 'ms' }); }
    if (d > W.worst) { W.worst = d; W.worstCtx = h; }
    W.hitches.push(h);
    if (W.hitches.length > 40) { W.hitches.sort((a, b) => b.ms - a.ms); W.hitches.length = 20; }
  }
  void secTot;
  // HUD fps (1 s)
  hudFps.n++; if (ts - hudFps.t0 >= 1000) { hudFps.fps = hudFps.n * 1000 / (ts - hudFps.t0); hudFps.n = 0; hudFps.t0 = ts; if (hud) drawHud(c, seg); }
  if (now() - W.t0 >= WINDOW_MS) flush();
}

function summarize(W) {
  const nf = Math.min(W.nf, MAXF);
  const a = Array.from(W.deltas.subarray(0, nf)).sort((x, y) => x - y);
  const dur = (now() - W.t0) / 1000;
  const by = {};
  const rows = [...W.by.entries()].filter(([k]) => k !== 'all').sort((x, y) => (y[1].l33 / y[1].n) - (x[1].l33 / x[1].n) || y[1].n - x[1].n).slice(0, 40);
  for (const [k, s] of rows) by[k] = sumStat(s);
  const sec = {}; for (let i = 0; i < SECTIONS.length; i++) if (W.secSum[i] > 0) sec[SECTIONS[i]] = { avg: +(W.secSum[i] / Math.max(1, W.nf)).toFixed(2), max: r1(W.secMax[i]) };
  const pass = {}; for (const k in W.passSum) pass[k] = +(W.passSum[k] / Math.max(1, W.nf)).toFixed(2);
  const hitches = W.hitches.sort((x, y) => y.ms - x.ms).slice(0, 12);
  const g = W.gl;
  return {
    level: 'debug', kind: 'perf', v: 1, ...perf.info, quality: W.quality, start: new Date(W.start).toISOString(), secs: Math.round(dur),
    frames: W.nf, fps: r1(W.nf / Math.max(0.001, dur)), p50: r1(pct(a, 0.5)), p95: r1(pct(a, 0.95)), p99: r1(pct(a, 0.99)),
    long33: W.l33, long50: W.l50, worst: Math.round(W.worst), stalls: W.unattributed50,
    cpu: { avg: +(W.cpuSum / Math.max(1, W.nf)).toFixed(2), max: r1(W.cpuMax) }, sec, pass,
    gl: { shaders: g.shN, shaderMs: Math.round(g.shMs), texUploads: g.texN, canvasTex: g.canvasTexN, texMs: Math.round(g.texMs), bufUploads: g.bufN, bufMs: Math.round(g.bufMs), programs: perf._renderer?.info.programs?.length ?? null },
    labels: W.labels, label2dMs: Math.round(W.c2dMs),
    by, hitches, events: W.events, ...(W.loaf.length ? { loaf: W.loaf.slice(0, 8) } : {}),
  };
}
function flush(final = false) {
  const W = win; win = freshWin();
  if (W.nf < 10) return;
  const out = summarize(W);
  perf.last = out;
  if (perf.send) {
    try {
      let body = JSON.stringify(out);
      if (body.length > 30000) { out.events = out.events.slice(0, 20); out.hitches = out.hitches.slice(0, 6); body = JSON.stringify(out); }
      fetch('/api/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: final || body.length < 60000 }).catch(() => {});
    } catch { /* offline */ }
  }
}

// Chromium only: Long Animation Frame entries name the scripts behind a long frame (Safari lacks it; ignored there)
function observeLoaf() {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (win.loaf.length >= 8 || e.duration < 50) continue;
        win.loaf.push({ ms: Math.round(e.duration), block: Math.round(e.blockingDuration || 0), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), scripts: (e.scripts || []).slice(0, 3).map((s) => `${(s.sourceFunctionName || s.invoker || '?').slice(0, 40)}@${(s.sourceURL || '').split('/').pop()}:${Math.round(s.duration)}`) });
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch { /* unsupported */ }
}

// ---------- HUD (?perf=1) ----------
function makeHud() {
  const el = document.createElement('div');
  el.id = 'perf-hud';
  el.style.cssText = 'position:fixed;right:max(8px,.5vw);top:max(8px,.5vw);z-index:99999;pointer-events:none;font:600 max(11px,.7vw)/1.35 ui-monospace,Menlo,monospace;color:#e8fffb;background:rgba(4,0,18,.82);border:1px solid rgba(0,240,255,.45);border-radius:6px;padding:6px 9px;white-space:pre;min-width:16em';
  document.body.appendChild(el);
  return el;
}
function drawHud(c, seg) {
  const W = win, nf = Math.min(W.nf, MAXF);
  let p95 = 0;
  if (nf > 10) { const a = Array.from(W.deltas.subarray(Math.max(0, nf - 300), nf)).sort((x, y) => x - y); p95 = pct(a, 0.95); }
  const q = W.quality ? `q${W.quality.envQ} pr${W.quality.pr}` : '';
  const last = W.hitches.length ? W.hitches[W.hitches.length - 1] : null;
  hud.textContent = `PERF ${perf.info.device} ${perf.info.browser} dpr${perf.info.dpr} ${q}\n` +
    `fps ${hudFps.fps.toFixed(0).padStart(3)}  p95 ${p95.toFixed(1)}ms\n` +
    `long>33 ${W.l33}  >50 ${W.l50}  worst ${Math.round(W.worst)}ms\n` +
    `scene ${c.scene || '-'}${c.trans ? '  TRANS ' + c.trans : ''}\n` +
    `widget ${c.widget || '-'} ${c.phase || ''}  seg ${seg || '-'}` +
    (last ? `\nlast hitch ${last.ms}ms ${last.ev[0] || (last.stall ? 'stall' : '')}` : '');
  hud.style.borderColor = p95 > 33 ? '#ff3a2e' : p95 > 20 ? '#ffab2e' : 'rgba(0,240,255,.45)';
}

/** Start telemetry. opts: { send (default true), segment: () => current rundown segment id, wrap: [[obj, method, name], ...] } */
export function initPerf(opts = {}) {
  if (perf.on || typeof window === 'undefined' || Q.get('perf') === '0') return perf;
  perf.on = true;
  perf.info = deviceInfo();
  perf.send = opts.send !== false;
  segFn = opts.segment || null;
  win = freshWin();
  instrumentCanvas(); instrumentSSE(); observeLoaf();
  for (const [o, m, n] of opts.wrap || []) perf.wrap(o, m, n);
  requestAnimationFrame(tick);
  if (HUD) { const go = () => { hud = makeHud(); }; if (document.body) go(); else addEventListener('DOMContentLoaded', go); }
  addEventListener('pagehide', () => flush(true));
  window.__pnnPerf = perf;
  return perf;
}
