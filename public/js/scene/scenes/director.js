// Scene director: rotates the background scenes (registry.js) on a weighted no-repeat shuffle, holds each 60-120 s,
// then waits for the next card change (beat) and fires one of 8 transitions (transitions.js). At most two live
// instances: `cur` and `next`. The director owns the BackdropPass draw (via post.setBackdrop), the two layer RTs,
// the transition materials and the morph cloud. URL: ?scene=<id> pin, ?scenefast=1 (12-20 s holds), ?trans=<type>,
// ?mood=<x> (= outrunClassic + mood), ?envquality=0|1|2, ?envfast=1 (= scenefast).
import * as THREE from '../../../vendor/three/three.module.js';
import { SCENES, META, ROTATION, prefetchAll } from './registry.js';
import { createSceneCtx, disposeInstance, patchHeroUniforms, heroUniforms } from './common.js';
import { createTransitions, TRANSITIONS, TRANSITION_TYPES, defaultMorphPoints } from './transitions.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };
const RED = new THREE.Color('#ff3a2e'), CYAN = new THREE.Color('#5ff8ff');
const MOVER_UP = new THREE.Color('#40ff90'), MOVER_DN = new THREE.Color('#ff4060');
const CLOUD_N = [4096, 8192, 16384];
const GRADE_DEF = { bloom: 0.55, bloomThreshold: 0.78, bloomRadius: 0.4, tintAmt: 0, sat: 1, contrast: 1, ca: 1, grain: 1, vignette: 1, scan: 1 };
const GKEYS = ['bloom', 'bloomThreshold', 'bloomRadius', 'tintAmt', 'sat', 'contrast', 'ca', 'grain', 'vignette', 'scan'];
const WHITE = new THREE.Color(1, 1, 1);
const noop = () => {};

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

export function createSceneDirector({ renderer, camera, mainScene = null, ctxShared, opts = {} }) {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const flags = Object.assign(Object.fromEntries(q), opts);
  Object.defineProperty(flags, 'get', { value: (k) => q.get(k) ?? (opts[k] != null ? String(opts[k]) : null), enumerable: false });
  const fast = q.get('scenefast') === '1' || q.get('envfast') === '1' || !!opts.scenefast;
  let pinId = q.get('scene') || opts.scene || (q.get('mood') ? 'outrunClassic' : null);
  if (pinId && !SCENES[pinId]) { console.warn('[scene] unknown ?scene=' + pinId); pinId = null; }
  const pinned = !!pinId;
  const forcedTrans = TRANSITIONS[q.get('trans')] ? q.get('trans') : null;
  let quality = q.get('envquality') != null ? clamp(+q.get('envquality') | 0, 0, 2) : (opts.quality ?? 2);
  const dev = q.get('debug') === '1' || q.get('fixture') === '1' || /harness/.test(typeof location !== 'undefined' ? location.pathname : '');

  const holdDur = () => (fast ? rand(12, 20) : rand(60, 120));

  // ---- shared uniforms (scene ctx refs; never disposed by a scene)
  const fullRes = new THREE.Vector2(1920, 1080), halfRes = new THREE.Vector2(960, 540);
  const sh = {
    time: ctxShared.time, alert: ctxShared.alert, accent: ctxShared.accent, accent2: ctxShared.accent2,
    pulse: { value: 0 }, res: { value: new THREE.Vector2(1920, 1080) },
    guardRect: ctxShared.guardRect || { value: new THREE.Vector4(0.30, 0.30, 0.985, 0.93) },
    guardAmt: ctxShared.guardAmt || { value: 0.55 }, noise: ctxShared.noise,
    ...heroUniforms(THREE),       // uHero, uHeroW, uStory, uStoryCol, uStoryColA (shared by reference, written by stage.js)
    hero: null,                   // the projector stage (set by setHero)
  };
  // upload the shared noise now so its one-time upload is never attributed to the first scene (false leak report)
  try { if (sh.noise) renderer.initTexture(sh.noise); } catch { /* old three */ }
  const T = createTransitions({ res: sh.res, guardRect: sh.guardRect, guardAmt: sh.guardAmt, alert: sh.alert, noise: sh.noise, time: sh.time, hero: sh.uHero });
  const ortho = T.ortho;
  const subject = new THREE.Vector2(0.64, 0.615);        // hologram centre, bottom-up screen fraction (= hero.anchor.screen each frame)
  const story = { x: 0, z: 0, color: new THREE.Color('#00f0ff') };

  // ---- layer RTs: two fixed slots (one per live instance), sized CSS px x scale
  const layerPool = [0, 1].map(() => ({ rt: new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }), busy: false, scale: 0 }));
  const cssW = () => fullRes.x / Math.max(1e-3, renderer.getPixelRatio()), cssH = () => fullRes.y / Math.max(1e-3, renderer.getPixelRatio());
  function sizeLayer(L) { const w = Math.max(16, Math.round(Math.min(cssW() * L.scale, fullRes.x / 2))), h = Math.max(16, Math.round(Math.min(cssH() * L.scale, fullRes.y / 2))); if (L.rt.width !== w || L.rt.height !== h) L.rt.setSize(w, h); }
  function allocLayer(inst, scale) {
    const L = layerPool.find((l) => !l.busy);
    if (!L) throw new Error('no free layer slot');
    L.busy = true; L.scale = clamp(scale || 0.5, 0.125, 0.5); sizeLayer(L); inst.layerSlot = L;
    return L.rt;
  }

  // ---- state
  let post = null, cur = null, next = null, trans = null, preparing = false, disposed = false;
  let holdLeft = fast ? 14 : 75, due = false, dueAt = 0, frozen = false, forced = null;
  let lastBeatAt = -1e9, lastFlashAt = -1e9, lastShockAt = -1e9, lastBeatType = null, lastTrans = null, lite = false;
  let clock = 0, warmReq = null, alertK = 1;
  const failed = new Set();
  const events = [];
  const sceneFps = {}; let fpsWin = 0, fpsN = 0;
  let bag = [], transBag = [];
  const dying = [];
  const frameWaiters = [];
  const nextFrame = () => new Promise((r) => frameWaiters.push(r));
  const nudge = { tint: 0, col: new THREE.Color(1, 1, 1), bloom: 0, bloomT: 0 };
  const grade = { tint: new THREE.Color(1, 1, 1), ...GRADE_DEF };
  const gA = { tint: new THREE.Color(), ...GRADE_DEF }, gB = { tint: new THREE.Color(), ...GRADE_DEF };
  const bloomP = { strength: 0.55, threshold: 0.78, radius: 0.4 };
  const cameraBias = { orbitScale: 1, bob: 1, push: 1, whip: 0 };
  const _v = new THREE.Vector3(), _d = new THREE.Vector3();

  function log(type, id, ms) { events.push({ t: +clock.toFixed(1), type, id, ms: ms == null ? undefined : Math.round(ms) }); if (events.length > 20) events.shift(); }

  // ---- selection
  const okAfter = (id, curId) => {
    if (failed.has(id) || !SCENES[id]) return false;
    if (!curId) return true;
    if (id === curId) return false;
    const a = META[curId] || {}, b = META[id] || {};
    return !(a.similar || []).includes(id) && !(b.similar || []).includes(curId) && a.family !== b.family;
  };
  function pickWeighted(list) {
    let tot = 0; for (const id of list) tot += META[id]?.weight || 1;
    let r = Math.random() * tot;
    for (const id of list) { r -= META[id]?.weight || 1; if (r <= 0) return id; }
    return list[list.length - 1];
  }
  function pickNext(curId) {
    if (pinned) return pinId;
    if (!bag.length) bag = shuffle(ROTATION.filter((id) => !failed.has(id) && id !== curId));
    let cand = bag.filter((id) => okAfter(id, curId));
    if (!cand.length) cand = ROTATION.filter((id) => okAfter(id, curId));
    if (!cand.length) cand = ROTATION.filter((id) => id !== curId && !failed.has(id));
    if (!cand.length) return curId || null;
    const id = pickWeighted(cand);
    const i = bag.indexOf(id); if (i >= 0) bag.splice(i, 1);
    return id;
  }
  function pickTransition(A, B, want) {
    const morphOk = !!(A?.meta?.morph || B?.meta?.morph);
    if (want && TRANSITIONS[want] && (want !== 'morph' || morphOk)) return want;
    if (forcedTrans && (forcedTrans !== 'morph' || morphOk)) return forcedTrans;
    for (let g = 0; g < 3; g++) {
      if (!transBag.length) transBag = shuffle(TRANSITION_TYPES.slice());
      for (let i = 0; i < transBag.length; i++) {
        const t = transBag[i];
        if (t === lastTrans || (t === 'morph' && !morphOk)) continue;
        transBag.splice(i, 1); return t;
      }
      transBag = [];
    }
    return lastTrans === 'warp' ? 'scanwipe' : 'warp';
  }

  // ---- instances
  function makeInst(id) {
    return {
      id, meta: META[id] || { id, family: id, similar: [], morph: false }, state: 'idle', api: null, ctx: null, k: 0,
      cam0: new THREE.Vector3(), errors: 0, upG: 0, upT: 0, layerSlot: null, disposeIn: -1, mem: null, warmMs: 0,
      info: { camera, dt: 0, k: 0, phase: 'warm', alert: 0, camX: 0, par: new THREE.Vector3(), story, transition: -1, hero: null },
    };
  }
  function normalize(api) {
    for (const k of ['update', 'setIntensity', 'enter', 'exit', 'ripple', 'event', 'setQuality']) if (typeof api[k] !== 'function') api[k] = noop;
    if (!api.grade) api.grade = { ...GRADE_DEF, tint: WHITE.clone() };
    if (!api.cameraBias) api.cameraBias = { orbitScale: 1, bob: 1 };
    return api;
  }
  async function build(id, boot = false) {
    const inst = makeInst(id); inst.state = 'creating';
    let mod;
    try { mod = await SCENES[id](); } catch (e) { fail(inst, 'import', e); return null; }
    if (disposed) return null;
    if (!boot) await nextFrame();
    const t0 = performance.now();
    inst.mem = { g: renderer.info.memory.geometries, t: renderer.info.memory.textures };
    try {
      inst.ctx = createSceneCtx({ renderer, camera, sh, quality, opts: flags, seed: (Math.random() * 2 ** 31) | 0, inst, allocLayer: (s) => allocLayer(inst, s) });
      inst.api = normalize(mod.create(inst.ctx));
      patchHeroUniforms(inst.stage, sh); if (inst.layer) patchHeroUniforms(inst.layer.scene, sh);
      inst.stage.visible = false;
      inst.cam0.copy(camera.position);
      setK(inst, 0.001);
      inst.state = 'warming';
      if (!boot) await nextFrame();
      const compile = async (s, c) => { if (renderer.compileAsync) await renderer.compileAsync(s, c); else renderer.compile(s, c); };
      inst.stage.visible = true;
      await compile(inst.stage, camera);
      if (inst.layer) await compile(inst.layer.scene, ortho);
      inst.stage.visible = false;
      if (disposed) { destroy(inst); return null; }
      if (boot) warmDraw(inst); else { await new Promise((r) => { warmReq = { inst, r }; }); }
      const bad = brokenPrograms(inst);
      if (bad) throw new Error('shader compile failed: ' + bad);
    } catch (e) { fail(inst, 'create', e); destroy(inst); return null; }
    inst.warmMs = performance.now() - t0;
    inst.state = 'ready';
    log('ready', id, inst.warmMs);
    return inst;
  }
  // after the warm draw every program has been linked and checked: a scene whose shader failed is dropped
  function brokenPrograms(inst) {
    let bad = null;
    const chk = (m) => { const pr = m && renderer.properties.get(m).currentProgram; if (pr && pr.diagnostics && pr.diagnostics.runnable === false) bad = m.name || m.type; };
    const walk = (o) => { const m = o.material; if (Array.isArray(m)) m.forEach(chk); else chk(m); };
    inst.stage.traverse(walk); inst.layer?.scene.traverse(walk);
    return bad;
  }
  function fail(inst, what, e) {
    failed.add(inst.id);
    console.error('[scene]', what, inst.id, e);
    log('fail:' + what, inst.id);
    try { fetch('/api/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'scene.director.' + what, error: inst.id + ': ' + String(e?.stack || e) }) }).catch(noop); } catch { /* offline */ }
  }
  function setK(inst, k) { inst.k = k; inst.fade.value = k; try { inst.api.setIntensity(k); } catch (e) { inst.errors++; } }
  function step(inst, dt, phase, p) {
    const lt = inst.localTime; lt.value += dt; if (lt.value >= 3600) lt.value -= 3600;
    const cx = camera.position.x;
    for (let i = 0; i < inst.anchors.length; i++) { const a = inst.anchors[i]; a.o.position.x = cx * a.k; if (a.y != null) a.o.position.y = a.y; if (a.z != null) a.o.position.z = a.z; }
    const I = inst.info;
    I.dt = dt; I.k = inst.k; I.phase = phase; I.alert = sh.alert.value; I.camX = cx; I.transition = p;
    I.par.subVectors(camera.position, inst.cam0); I.hero = sh.hero;
    try { inst.api.update(dt, lt.value, I); } catch (e) {
      if (inst.errors++ === 0) console.error('[scene] update', inst.id, e);
      if (inst.errors > 30 && !failed.has(inst.id)) { fail(inst, 'update', e); if (inst === cur && !trans) { due = true; dueAt = clock; holdLeft = 0; } }
    }
  }
  // every draw of an instance goes through here so its uploads (memory deltas) are attributed to it for the leak check
  // (a layer RT re-sized by allocLayer re-uploads on its first draw: director-owned, so it is excluded)
  function rInst(inst, scene, cam, rtTex = 0) { const m = renderer.info.memory, g = m.geometries, t = m.textures; renderer.render(scene, cam); inst.upG += m.geometries - g; inst.upT += Math.max(0, m.textures - t - rtTex); }
  // A scene's low-res layer: the guard (hologram-area dimming) uses gl_FragCoord/res, so res must be THIS target's size,
  // not the screen's — with full-screen res the dim zone landed in the lower-left quarter and the hologram area stayed bright.
  function renderLayer(inst) {
    if (!inst.layer) return;
    const rt = inst.layer.rt, prev = sh.res.value.clone();
    sh.res.value.set(rt.width, rt.height);
    renderer.setRenderTarget(rt); rInst(inst, inst.layer.scene, ortho, 1);
    sh.res.value.copy(prev);
  }
  function warmDraw(inst) {
    if (!post) return;
    const tr = post.getTransRT?.(), rb = post.readBuffer;
    const ac = renderer.autoClear; renderer.autoClear = false;
    inst.stage.visible = true;
    step(inst, 0.016, 'warm', -1);
    renderLayer(inst);
    if (tr) { sh.res.value.copy(halfRes); renderer.setRenderTarget(tr.b); renderer.clear(); rInst(inst, inst.stage, camera); sh.res.value.copy(fullRes); }
    if (rb) { renderLayer(inst); renderer.setRenderTarget(rb); renderer.clear(); rInst(inst, inst.stage, camera); }
    inst.stage.visible = false;
    renderer.setRenderTarget(null);
    renderer.autoClear = ac;
  }
  function destroy(inst) {
    if (!inst || inst.state === 'disposed') return;
    inst.state = 'disposed';
    const m = renderer.info.memory, g0 = m.geometries, t0 = m.textures;
    try { inst.api?.dispose?.(); } catch (e) { console.error('[scene] dispose', inst.id, e); }
    disposeInstance(inst, sh);
    if (inst.layerSlot) { inst.layerSlot.busy = false; inst.layerSlot = null; }
    // leak check: geometries/textures this instance uploaded (memory delta since create, measured at the instant of
    // dispose so hologram churn in between doesn't count) should all have been released
    const freedG = g0 - m.geometries, freedT = t0 - m.textures;
    {
      const lg = inst.upG - freedG, lt = inst.upT - freedT;
      if (lg > 0 || lt > 0) { console.warn(`scene leak ${inst.id} +${lg}g/+${lt}t`); log('leak', inst.id, lg); }
    }
    log('disposed', inst.id, freedG);
  }

  async function prepareNext() {
    if (preparing || next || disposed) return;
    preparing = true;
    try {
      for (let tries = 0; tries < 4 && !next; tries++) {
        const id = pickNext(cur?.id || null);
        if (!id) break;
        const inst = await build(id);
        if (disposed) { destroy(inst); return; }
        if (inst) next = inst;
        else if (pinned) break;
      }
    } finally { preparing = false; }
  }

  // ---- transitions
  function startTransition(want) {
    const A = cur, B = next;
    const type = pickTransition(A, B, want);
    const spec = TRANSITIONS[type];
    trans = { type, dur: spec.dur, peak: spec.peak, t: 0, p: 0, A, B, speed: 1, frames: 0, ftAcc: 0, flashed: false };
    lastTrans = type; lastBeatType = type; lastBeatAt = clock; due = false; forced = null;
    A.state = 'exiting'; B.state = 'active';
    B.cam0.copy(camera.position);
    B.stage.visible = true; A.stage.visible = true;
    try { A.api.exit(spec.dur * spec.peak); } catch (e) { A.errors++; }
    try { B.api.enter(spec.dur * (1 - spec.peak)); } catch (e) { B.errors++; }
    T.use(type);
    T.U.uColA.value.copy(sh.accent.value); T.U.uColB.value.copy(sh.hero ? sh.hero.story.color : story.color);
    // every transition opens from / crosses through the widget (iris, warp, vortex, morph all centre on the hero)
    T.U.uOrigin.value.copy(subject);
    T.U.uLite.value = lite ? 1 : 0;
    if (type === 'morph') {
      const n = Math.max(1024, CLOUD_N[quality] >> (lite ? 1 : 0));
      const fillPts = (inst, arr) => { let ok = false; try { ok = inst.api.morphPoints?.(arr, n) !== false && !!inst.api.morphPoints; } catch (e) { ok = false; } if (!ok) defaultMorphPoints(arr, n, camera); };
      fillPts(A, T.from); fillPts(B, T.to);
      T.upload(n);
      _v.set(T.U.uOrigin.value.x * 2 - 1, T.U.uOrigin.value.y * 2 - 1, 0.5).unproject(camera);
      _d.subVectors(_v, camera.position).normalize();
      T.cloudU.uVortex.value.copy(camera.position).addScaledVector(_d, 520);
      T.cloudU.uSize.value = 2.6;
    }
    log('trans:' + type, A.id + '>' + B.id);
    return { type, dur: spec.dur, peak: spec.peak, from: A.id, to: B.id, id: B.id, at: performance.now() };
  }
  function endTransition() {
    const { A, B } = trans;
    trans = null;
    A.disposeIn = 2; A.stage.visible = false; dying.push(A);
    cur = B; next = null;
    holdLeft = holdDur(); due = false;
    cameraBias.push = 1; cameraBias.whip = 0;
  }
  function fireBeat(want) {
    if (!cur || !next || next.state !== 'ready' || trans) return null;
    return startTransition(want);
  }
  function dispatchBeat(beat) {
    if (!beat || typeof document === 'undefined') return;
    try { window.__pnnBeat = beat; document.dispatchEvent(new CustomEvent('pnn:beat', { detail: beat })); } catch { /* no DOM */ }
  }

  // ---- grade
  function readGrade(g, o) {
    g = g || GRADE_DEF;
    for (const k of GKEYS) o[k] = g[k] != null && Number.isFinite(+g[k]) ? +g[k] : GRADE_DEF[k];
    o.tint.copy(g.tint && g.tint.isColor ? g.tint : WHITE);
    if (o.ca < 0.05) o.ca /= 0.0022;            // absolute CA amounts -> post multiplier
    if (o.grain < 0.3) o.grain /= 0.022;        // absolute grain amounts -> post multiplier
    o.ca = clamp(o.ca, 0, 3); o.grain = clamp(o.grain, 0, 3); o.bloom = clamp(o.bloom, 0.25, 1.0);
    o.bloomThreshold = clamp(o.bloomThreshold, 0.3, 1.2); o.bloomRadius = clamp(o.bloomRadius, 0, 1);
    return o;
  }
  function pushGrade(dt) {
    if (!cur) return;
    readGrade(cur.api.grade, gA);
    let src = gA;
    const cbA = cur.api.cameraBias;
    let os = cbA.orbitScale ?? 1, bob = cbA.bob ?? 1;
    if (trans) {
      const e = smoother(trans.p), Bp = trans.B;
      readGrade(Bp.api.grade, gB);
      for (const k of GKEYS) grade[k] = gA[k] + (gB[k] - gA[k]) * e;
      grade.tint.copy(gA.tint).lerp(gB.tint, e);
      src = grade;
      const cbB = Bp.api.cameraBias; os += ((cbB.orbitScale ?? 1) - os) * e; bob += ((cbB.bob ?? 1) - bob) * e;
    }
    if (src !== grade) { for (const k of GKEYS) grade[k] = src[k]; grade.tint.copy(src.tint); }
    nudge.tint = Math.max(0, nudge.tint - dt * 0.04 / 30);
    if (nudge.tint > 0.0005) { const tot = grade.tintAmt + nudge.tint; grade.tint.lerp(nudge.col, nudge.tint / tot); grade.tintAmt = tot; }
    if (nudge.bloomT > 0) nudge.bloomT -= dt; else nudge.bloom = 0;
    cameraBias.orbitScale = clamp(os, 0.7, 1.3); cameraBias.bob = clamp(bob, 0.7, 1.3);
    if (post) {
      bloomP.strength = grade.bloom + nudge.bloom; bloomP.threshold = grade.bloomThreshold; bloomP.radius = grade.bloomRadius;
      post.setBloom?.(bloomP); post.setGrade?.(grade);
    }
  }

  // ---- per frame
  function update(dt, t) {
    if (disposed) return;
    clock += dt;
    if (frameWaiters.length) { const w = frameWaiters.splice(0); for (const f of w) f(); }
    sh.pulse.value = Math.max(0, sh.pulse.value - dt * 1.6);
    if (sh.hero) subject.copy(sh.hero.anchor.screen);
    alertK += ((frozen ? 0.85 : 1) - alertK) * (1 - Math.exp(-3 * dt));
    for (let i = dying.length - 1; i >= 0; i--) { if (--dying[i].disposeIn <= 0) { destroy(dying[i]); dying.splice(i, 1); } }
    if (!cur) return;
    if (trans) {
      trans.t += dt * trans.speed;
      const p = trans.p = clamp(trans.t / trans.dur, 0, 1), pk = trans.peak;
      if (trans.frames < 30) { trans.frames++; trans.ftAcc += dt; if (trans.frames === 30 && trans.ftAcc / 30 > 0.022 && !lite) { lite = true; log('lite', trans.type); } }
      // A fades out inside [0, peak+0.1], B fades in from peak-0.2 (full by peak+0.3 so the reveal reads bright)
      setK(trans.A, (1 - sstep(pk * 0.5, pk + 0.1, p)) * alertK);
      setK(trans.B, sstep(pk - 0.2, Math.min(1, pk + 0.3), p) * alertK);   // a little early: revealed regions never read as a void
      T.U.uP.value = p; T.U.uTime.value = trans.t;
      cameraBias.push = trans.type === 'warp' ? 1 - 0.04 * Math.sin(Math.PI * p) : 1;
      cameraBias.whip = trans.type === 'whip' ? Math.sin(Math.PI * p) : 0;
      if (trans.type === 'warp' && !trans.flashed && p >= pk) { trans.flashed = true; post?.flash?.(CYAN, 0.35); }
      step(trans.A, dt, 'exit', p);
      step(trans.B, dt, 'enter', p);
      if (p >= 1) endTransition();
    } else {
      setK(cur, cur.k < alertK ? Math.min(alertK, cur.k + dt / 1.5) : alertK);
      step(cur, dt, 'live', -1);
      const rotating = !pinned || fast || forced != null;
      if (rotating && !frozen && !due) {
        holdLeft -= dt;
        if (holdLeft <= 0) { due = true; dueAt = clock; }
      }
      if (rotating && (holdLeft <= (fast ? 6 : 15) || due) && !next && !preparing) prepareNext();
      if (due && !frozen && clock - dueAt > 240) { const b = fireBeat(); if (b) { log('failsafe', b.to); dispatchBeat(b); } }
    }
    // fps per scene (rolling 5 s)
    fpsWin += dt; fpsN++;
    if (fpsWin >= 5) { sceneFps[cur.id] = Math.round(fpsN / fpsWin); fpsWin = 0; fpsN = 0; }
    pushGrade(dt);
  }

  // ---- BackdropPass draw (called by post's BackdropPass with the composer read buffer)
  function draw(r, readBuffer) {
    const ac = r.autoClear; r.autoClear = false;
    if (warmReq && warmReq.inst.state === 'warming') {
      const w = warmReq; warmReq = null;
      try { warmDraw(w.inst); } catch (e) { console.error('[scene] warm draw', e); }
      w.r();
    } else if (warmReq) { const w = warmReq; warmReq = null; w.r(); }
    const tr = post?.getTransRT?.();
    if (trans && tr) {
      sh.res.value.copy(halfRes);
      renderLayer(trans.A); r.setRenderTarget(tr.a); r.clear(); rInst(trans.A, trans.A.stage, camera);
      renderLayer(trans.B); r.setRenderTarget(tr.b); r.clear(); rInst(trans.B, trans.B.stage, camera);
      sh.res.value.copy(fullRes);
      T.U.tA.value = tr.a.texture; T.U.tB.value = tr.b.texture;
      r.setRenderTarget(readBuffer); r.clear();
      r.render(T.quadScene, ortho);
      if (trans.type === 'morph') r.render(T.cloudScene, camera);
    } else if (cur && cur.state === 'active') {
      cur.stage.visible = true;
      renderLayer(cur);
      r.setRenderTarget(readBuffer); r.clear();
      rInst(cur, cur.stage, camera);
    } else {
      r.setRenderTarget(readBuffer); r.clear();
    }
    r.autoClear = ac;
  }

  // ---- boot: first scene + every transition program + the cloud, all compiled before the first frame
  async function warm() {
    const t0 = performance.now();
    let inst = null;
    for (let tries = 0; tries < 4 && !inst; tries++) {
      const id = pickNext(null);
      if (!id) break;
      inst = await build(id, true);
      if (pinned && !inst) break;
    }
    if (inst) {
      cur = inst; cur.state = 'active'; cur.stage.visible = true;
      setK(cur, 0);
      try { cur.api.enter(2.0); } catch (e) { cur.errors++; }
    }
    // compile all transitions + the cloud
    const tr = post?.getTransRT?.(), rb = post?.readBuffer;
    if (tr && rb) {
      const ac = renderer.autoClear; renderer.autoClear = false;
      T.U.tA.value = tr.a.texture; T.U.tB.value = tr.b.texture; T.U.uP.value = 0.5;
      renderer.setRenderTarget(rb);
      for (const type of TRANSITION_TYPES) { T.use(type); renderer.render(T.quadScene, ortho); }
      defaultMorphPoints(T.from, 1024, camera); defaultMorphPoints(T.to, 1024, camera); T.upload(1024);
      renderer.render(T.cloudScene, camera);
      renderer.clear();
      renderer.setRenderTarget(null);
      renderer.autoClear = ac;
      T.U.uP.value = 0;
    }
    if (!pinned) prefetchAll();
    const ms = performance.now() - t0;
    log('boot', cur?.id || 'none', ms);
    return ms;
  }

  function alive() { return trans ? [trans.A, trans.B] : cur ? [cur] : []; }
  function forEachAlive(fn) { for (const i of alive()) { try { fn(i.api, i); } catch (e) { i.errors++; if (i.errors === 1) console.error('[scene] hook', i.id, e); } } }

  const api = {
    cameraBias, update, draw, warm, sh, T,
    attachPost(p) { post = p; p?.setBackdrop?.(draw); },
    resize(pxW, pxH) {
      fullRes.set(pxW, pxH); halfRes.set(Math.max(1, Math.round(pxW / 2)), Math.max(1, Math.round(pxH / 2)));
      sh.res.value.copy(fullRes);
      for (const L of layerPool) if (L.busy) sizeLayer(L);
    },
    setSubject(x, y) { if (!sh.hero) subject.set(x, y); },
    /** Attach the projector stage: ctx.hero for scenes, info.hero in update(), and hero pulses forwarded to every live
     * scene as event('heroPulse', p) plus the per-instance ctx.onHeroPulse listeners. */
    setHero(hero) {
      sh.hero = hero || null;
      if (!hero) return;
      hero.onPulse((p) => {
        if (p.type === 'flash' || p.type === 'alert') sh.pulse.value = Math.max(sh.pulse.value, p.strength);
        forEachAlive((a, i) => { a.event('heroPulse', p); for (const f of i.pulseFns || []) f(p); });
      });
    },
    setQuality(l) { quality = clamp(l | 0, 0, 2); forEachAlive((a) => a.setQuality(quality)); if (next && !trans) { try { next.api.setQuality(quality); } catch { /* */ } } },
    shockwave(x, z, color) {
      lastShockAt = clock;
      forEachAlive((a) => (a.shockwave ? a.shockwave(x, z, color) : a.ripple({ x, z, color, strength: 1, screen: subject })));
    },
    /** Called on every non-alert card change. Returns the beat (and starts the transition) or null. */
    beat(info = {}) {
      if (!due || frozen || trans || !next || next.state !== 'ready') return null;
      if (clock - lastBeatAt < 4 || clock - lastFlashAt < 3) return null;
      if (info.station) { story.x = info.station.x; story.z = info.station.z; }
      if (info.pal?.b) story.color.copy(info.pal.b);
      return fireBeat(forced);
    },
    forceBeat(type) { due = true; dueAt = clock; holdLeft = 0; forced = TRANSITIONS[type] ? type : (forced || ''); if (!next && !preparing) prepareNext(); return true; },
    /** Debug: cut right now if next is ready (also dispatches pnn:beat). */
    cut(type) { const b = fireBeat(type); if (b) dispatchBeat(b); return b; },
    event(type, data = {}) {
      switch (type) {
        case 'alert':
          frozen = true;
          if (trans) { const rem = (1 - trans.p) * trans.dur; if (rem > 0.8) trans.speed = rem / 0.8; }
          if (data.x != null && clock - lastShockAt > 0.2) api.shockwave(data.x, data.z, RED);
          break;
        case 'alertClear':
          if (frozen) { frozen = false; if (!due) holdLeft += 20; }
          break;
        case 'flash':
          sh.pulse.value = 1; lastFlashAt = clock;
          nudge.bloom = 0.1; nudge.bloomT = 1.5;
          forEachAlive((a) => a.ripple({ x: data.x ?? camera.position.x, z: data.z ?? 0, strength: 1, color: sh.accent2.value, screen: subject }));
          break;
        case 'mover':
          nudge.col.copy((data.dir ?? 1) >= 0 ? MOVER_UP : MOVER_DN); nudge.tint = 0.04;
          break;
        case 'story':
          if (data.x != null) { story.x = data.x; story.z = data.z ?? 0; }
          if (data.color) story.color.copy(data.color);
          forEachAlive((a) => a.ripple({ x: story.x, z: story.z, color: story.color, strength: 0.4, screen: subject }));
          break;
      }
      forEachAlive((a) => a.event(type, data));
    },
    getState() {
      return {
        mood: cur?.id || null, scene: cur?.id || null, title: cur?.meta?.title || null, next: next?.id || null,
        k: trans ? +trans.p.toFixed(3) : -1, holdLeft: Math.round(holdLeft), due, quality, pinned, frozen, lite,
        trans: lastBeatType, events: events.slice(), sceneFps: { ...sceneFps }, failed: [...failed],
      };
    },
    get current() { return cur; }, get nextInst() { return next; }, get transition() { return trans; },
    dispose() {
      disposed = true;
      for (const i of [cur, next, trans?.A, trans?.B, ...dying]) destroy(i);
      cur = next = trans = null;
      T.dispose();
      for (const L of layerPool) L.rt.dispose();
      post?.setBackdrop?.(null); post = null;
    },
  };
  return api;
}
