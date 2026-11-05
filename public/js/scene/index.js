// PNN 3D stage. createScene(canvas) -> { showStory(story, segmentName: 'top'|'focus'|'movers'|'week'|'sotd'), showAlert(alert), clearAlert(), setTicker(markets), resize(w, h), dispose() }
// The scene owns the WebGL canvas only. Text lives in the 2D overlays; holograms carry just outcome names and percentages.
import * as THREE from '../../vendor/three/three.module.js';
import { TIME, COL, palette, ease, damp } from './holo.js';
import { createWorld } from './world.js';
import { createPost } from './post.js';
import { createFx } from './fx.js';
import { createGlobe } from './globe.js';
import { createHeroStage } from './stage.js';
import { exchangeName, money, ago } from '../util.js';
import { createOutcomes } from './holograms/outcomes.js';
import { createDial } from './holograms/dial.js';
import { createRibbon } from './holograms/ribbon.js';
import { createCountdown } from './holograms/countdown.js';
import { createMovers } from './holograms/movers.js';
import { createSotd } from './holograms/sotd.js';

// Where holograms sit on screen (viewport fractions). Overlay panels take the left ~30% and bottom ~30%.
export const STAGE_RECT = { x0: 0.30, x1: 0.985, y0: 0.07, y1: 0.70 };
const FIT_MARGIN = 0.03;
// hologram stations spread along X so the camera tracks sideways between stories; the globe has its own
const STATIONS = [-270, -135, 0, 135, 270].map((x) => new THREE.Vector3(x, 0, 0));
const GLOBE_STATION = new THREE.Vector3(460, 0, -10);

function reportErr(kind, e) {
  console.error('[scene]', kind, e);
  try { fetch('/api/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'scene.' + kind, error: String(e?.stack || e) }) }).catch(() => {}); } catch {}
}

export function createScene(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.setClearColor(0x07021a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  // window size first: WebKit can report the default 300x150 clientWidth before first layout (full-screen canvas)
  let W = window.innerWidth || canvas.clientWidth, Hh = window.innerHeight || canvas.clientHeight;
  renderer.setSize(W, Hh, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / Hh, 0.1, 6000);
  const world = createWorld(scene, { renderer, camera });
  const fx = createFx(scene);
  const post = createPost(renderer, scene, camera, { samples: pixelRatio < 1.5 ? 4 : 0 });
  world.attachPost(post);
  const globe = createGlobe(scene, GLOBE_STATION);
  // the projector stage: anchor + story + pulses shared by the widget, the rig under it, every scene and the post pass
  const hero = createHeroStage({ THREE, scene, camera, fx, post, sh: world.director.sh });
  world.setHero(hero);
  // holograms get a thin fx proxy: their bursts/rings also pulse the stage while they are the current widget
  function wrapFx(isCur) {
    const s = (n) => Math.min(1, Math.max(0.3, (n || 0) / 40));
    return {
      ...fx,
      burst(p, c, n = 200, o) { fx.burst(p, c, n, o); if (isCur()) hero.emit('burst', s(n), { world: p }); },
      ring(p, c, o) { fx.ring(p, c, o); if (isCur()) hero.emit('ring', Math.min(1, 0.4 + (o?.radius || 30) / 40), { world: p }); },
      stream(p, c, n, d, o) { fx.stream(p, c, n, d, o); if (isCur()) hero.pulse = Math.max(hero.pulse, 0.18); },
    };
  }
  // hero.story from what airs: move = lead change1d (movers: top ticker market), swing/alert bonuses
  function storySignals(story, seg, pal) {
    const m = seg === 'movers' ? tickerMarkets[0] : (story?.lead || story?.markets?.[0]);
    const move = +(m?.change1d ?? 0) || 0;
    return { move, dir: move > 0.005 ? 1 : move < -0.005 ? -1 : 0, swing: !!story?.swing, alert: false, colorA: pal.a, colorB: pal.b, theme: pal.theme };
  }

  let RECT = opts.stageRect || STAGE_RECT;
  let SUBJECT_X = (RECT.x0 + RECT.x1) / 2, SUBJECT_Y = (RECT.y0 + RECT.y1) / 2;

  // ---------- camera rig ----------
  const rig = {
    pos: new THREE.Vector3(0, 30, 160), tgt: new THREE.Vector3(0, 8, -100),
    fromPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toPos: new THREE.Vector3(0, 30, 160), toTgt: new THREE.Vector3(0, 8, -100),
    k: 1, dur: 2.4, lift: 0, orbit: 0.12, orbitDir: 1, shake: 0, push: 1, pushTgt: 1,
    fx: 0, fy: 0, zm: 1, // hologram-driven follow offset (world x/y) and zoom multiplier, damped toward holo.camFocus
  };
  const fitCam = new THREE.PerspectiveCamera();
  const _c = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
  function boxExtent(box, tgt, d) {
    fitCam.copy(camera);
    fitCam.position.copy(tgt).addScaledVector(_dir, d);
    fitCam.lookAt(tgt); fitCam.updateMatrixWorld(true);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
    for (let i = 0; i < 8; i++) {
      _c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      _c.applyMatrix4(fitCam.matrixWorldInverse);
      if (_c.z > -0.5) behind = true;
      _c.applyMatrix4(fitCam.projectionMatrix);
      const sx = (_c.x + 1) / 2, sy = (1 - _c.y) / 2;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1, behind };
  }
  // fit pose.box inside RECT: binary-search the camera distance along the pose direction, then recentre
  function fitPose(pose) {
    if (!pose.box) return { position: pose.position.clone(), target: pose.target.clone() };
    camera.updateProjectionMatrix();
    const tgt = pose.target.clone();
    _dir.subVectors(pose.position, pose.target).normalize();
    const mx = (RECT.x1 - RECT.x0) * FIT_MARGIN, my = (RECT.y1 - RECT.y0) * FIT_MARGIN;
    const R = { x0: RECT.x0 + mx, x1: RECT.x1 - mx, y0: RECT.y0 + my, y1: RECT.y1 - my };
    const fits = (e) => !e.behind && e.x0 >= R.x0 && e.x1 <= R.x1 && e.y0 >= R.y0 && e.y1 <= R.y1;
    let d = 30;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 2, hi = 600;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fits(boxExtent(pose.box, tgt, m))) hi = m; else lo = m; }
      d = hi;
      const e = boxExtent(pose.box, tgt, d);
      const dxs = (e.x0 + e.x1) / 2 - SUBJECT_X, dys = (e.y0 + e.y1) / 2 - SUBJECT_Y;
      const halfH = d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      _right.setFromMatrixColumn(fitCam.matrixWorld, 0); _up.setFromMatrixColumn(fitCam.matrixWorld, 1);
      tgt.addScaledVector(_right, dxs * 2 * halfH * camera.aspect).addScaledVector(_up, -dys * 2 * halfH);
    }
    return { target: tgt, position: tgt.clone().addScaledVector(_dir, d) };
  }
  let curPose = null, firstFly = true;
  function flyTo(pose, { dur = 2.6 } = {}) {
    curPose = pose;
    const fit = fitPose(pose);
    if (firstFly) {
      // cold start: a short push-in from just behind the final pose instead of a long cruise over empty grid
      firstFly = false; dur = 1.6;
      rig.pos.copy(fit.position).add(new THREE.Vector3(0, 6, 0)).addScaledVector(fit.position.clone().sub(fit.target).normalize(), 40);
      rig.tgt.copy(fit.target);
    }
    rig.fromPos.copy(rig.pos); rig.fromTgt.copy(rig.tgt);
    rig.toPos.copy(fit.position); rig.toTgt.copy(fit.target);
    const dist = rig.fromPos.distanceTo(rig.toPos);
    rig.lift = Math.min(30, dist * 0.16);
    rig.dur = dist < 2 ? 1.2 : dur;
    rig.k = 0; rig.t0 = performance.now(); rig.orbit = pose.orbit ?? 0.12;
  }
  const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _off = new THREE.Vector3();
  function tickCamera(dt, t, now) {
    if (rig.k < 1) {
      // flights run on wall-clock: a shader-compile stall must not leave the camera cruising in slow motion
      rig.k = Math.min(1, (now - rig.t0) / 1000 / rig.dur);
      const e = ease.inOut(rig.k);
      rig.pos.lerpVectors(rig.fromPos, rig.toPos, e);
      rig.pos.y += Math.sin(Math.PI * e) * rig.lift;
      rig.tgt.lerpVectors(rig.fromTgt, rig.toTgt, ease.inOut(Math.min(1, rig.k * 1.15)));
    }
    rig.push = damp(rig.push, rig.pushTgt, 3, dt);
    // a hologram may steer the camera while it airs (price replay follows the tracer, SOTD pulls to the biggest move)
    const cf = !alertActive && current && !current.dead ? current.camFocus : null;
    rig.fx = damp(rig.fx, cf ? cf.dx || 0 : 0, 2.6, dt); rig.fy = damp(rig.fy, cf ? cf.dy || 0 : 0, 2.6, dt);
    rig.zm = damp(rig.zm, cf ? cf.zoom || 1 : 1, 2.6, dt);
    _off.subVectors(rig.pos, rig.tgt);
    const cb = world.env.cameraBias, os = Math.min(1.3, Math.max(0.7, cb.orbitScale)), bob = Math.min(1.3, Math.max(0.7, cb.bob));
    rig.whip = damp(rig.whip || 0, cb.whip || 0, 10, dt);
    const ang = (Math.sin(t * 0.11) * rig.orbit + Math.sin(t * 0.047) * rig.orbit * 0.5) * rig.orbitDir * os;
    _off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, ang);
    _p.copy(rig.tgt).add(_off);
    _p.y += Math.sin(t * 0.23) * 0.6 * bob;
    const zoom = (1 + Math.sin(t * 0.09) * 0.035) * rig.push * rig.zm * (cb.push || 1);
    _p.sub(rig.tgt).multiplyScalar(zoom).add(rig.tgt);
    _t.copy(rig.tgt);
    if (rig.shake > 0) {
      rig.shake = Math.max(0, rig.shake - dt * 1.6);
      const s = rig.shake * rig.shake * 0.5;
      _p.x += (Math.random() - 0.5) * s; _p.y += (Math.random() - 0.5) * s;
    }
    _p.x += rig.fx; _p.y += rig.fy; _t.x += rig.fx; _t.y += rig.fy;
    camera.position.copy(_p);
    camera.lookAt(_t);
    if (Math.abs(rig.whip) > 1e-4) camera.rotateY(-rig.whip * 0.0524);   // whip transition: +-3 deg pan impulse
  }

  // ---------- resize ----------
  // Camera framing only (cheap). Segment changes may call this; they must NOT reallocate render targets.
  function reframe() {
    camera.aspect = W / Hh;
    camera.setViewOffset(W, Hh, W * (0.5 - SUBJECT_X), Hh * (0.5 - SUBJECT_Y), W, Hh);
    camera.updateProjectionMatrix();
    if (curPose) {
      const fit = fitPose(curPose);
      rig.toPos.copy(fit.position); rig.toTgt.copy(fit.target);
      if (rig.k >= 1) { rig.pos.copy(rig.toPos); rig.tgt.copy(rig.toTgt); }
    }
  }
  // Full resize only when the size or pixel ratio actually changes: re-creating the composer's targets blanks a frame.
  let lastSize = '';
  function resize(w, h) {
    W = Math.max(1, Math.round(w || canvas.clientWidth || window.innerWidth)); Hh = Math.max(1, Math.round(h || canvas.clientHeight || window.innerHeight));
    const key = `${W}x${Hh}@${pixelRatio}`;
    if (key === lastSize) { reframe(); return; }
    lastSize = key;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(W, Hh, false);
    reframe();
    post.setSize(W, Hh, pixelRatio);
    world.resize(W * pixelRatio, Hh * pixelRatio);
    const pr = pixelRatio * Hh / 1080;
    world.setPixelRatio(pr); fx.setPixelRatio(pr); globe.setPixelRatio(pr); hero.setPixelRatio(pr);
  }
  const onWinResize = () => resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', onWinResize);
  resize(W, Hh);

  // ---------- holograms ----------
  let current = null, outgoing = [], curStation = null, curKey = null;
  let last = null;                 // { story, seg } last thing shown (restored after an alert)
  let tickerMarkets = [];
  let alertActive = false;
  const seedStation = (seed) => {
    const n = STATIONS.length, s = seed >>> 0;   // unsigned: `>>` on a seed >= 2^31 went negative -> undefined station
    let i = s % n;
    if (curStation && STATIONS[i].equals(curStation)) i = (i + 1 + ((s >>> 8) % (n - 1))) % n;
    return STATIONS[i] || STATIONS[2];
  };
  // the globe as a hologram-like object so the swap logic is uniform
  function globeHolo(ctx, story) {
    const region = story.visual?.region || null;
    const prob = story.lead?.yesPrice ?? 0.5;
    const prev = Math.min(1, Math.max(0, prob - (story.lead?.change1d ?? 0)));
    // the leaderboard needs 2+ outcomes; subject names what the % is of; info feeds the source/volume footer
    const ms = story.markets || [];
    const outcomes = ms.length >= 2 ? ms.slice(0, 4).map((m) => ({ name: m.outcome || m.title || '', p: m.yesPrice ?? 0, d: m.change1d ?? 0 })) : null;
    const subject = ms.length >= 2 ? (story.eventTitle || '') : (story.lead?.outcome || story.eventTitle || story.lead?.title || '');
    const vol = ms.reduce((a, m) => a + (m.volume24h || 0), 0);
    const info = { source: story.lead?.source ? exchangeName(story.lead.source) : null, vol: vol > 0 ? money(vol) : null, updated: story.lead?.updatedAt ? ago(story.lead.updatedAt) : null, thin: !!story.thin };
    return {
      root: globe.root, dead: false, visible: false, station: GLOBE_STATION.clone(),
      show() { this.visible = true; globe.show({ region, prob, prev, outcomes, subject, info, palette: ctx.pal, seed: ctx.seed }); },
      hide() { this.visible = false; globe.hide(); },
      tick() { if (!this.visible && !globe.root.visible) this.dead = true; },
      pose: () => globe.pose(),
      dispose() {},
    };
  }
  function build(story, seg) {
    let vis = seg === 'movers' ? 'movers' : seg === 'week' ? 'week' : seg === 'sotd' ? 'sotd' : (story?.visual?.type || 'dial');
    // a swing story with real history replays its price path instead of a plain dial (outcomes keep the sweeping podium)
    const replayable = !!story?.swing && Array.isArray(story?.history) && story.history.length >= 8;
    if (replayable && vis === 'dial') vis = 'ribbon';
    const pal = palette(story || { id: 'movers' }, seg === 'movers' ? (tickerMarkets[0]?.category && pickTheme(tickerMarkets[0].category)) || 'economy' : undefined);
    const seed = pal.seed;
    const station = vis === 'globe' ? GLOBE_STATION : seedStation(seed);
    let holoRef = null;
    const ctx = { scene, fx: wrapFx(() => holoRef && current === holoRef), world, station, pal, seed, rnd: pal.rnd, globe, hero };
    const o = { seg };
    const dialOrReplay = () => (replayable ? createRibbon(ctx, story, o) : createDial(ctx, story, o));
    let holo;
    switch (vis) {
      case 'sotd': holo = createSotd(ctx, story, o); break;
      case 'outcomes': holo = (story.markets?.length || 0) >= 2 ? createOutcomes(ctx, story, o) : dialOrReplay(); break;
      case 'ribbon': holo = createRibbon(ctx, story, o); break;
      case 'globe': holo = story.visual?.region ? globeHolo(ctx, story) : dialOrReplay(); break;
      case 'countdown': holo = createCountdown(ctx, story); break;
      case 'week': holo = createCountdown(ctx, story, { cluster: true }); break;
      case 'movers': holo = tickerMarkets.length ? createMovers(ctx, tickerMarkets) : (story ? createDial(ctx, story) : null); break;
      default: holo = createDial(ctx, story, o);
    }
    holoRef = holo;
    return { holo, pal, station, vis, storyId: story?.id ?? null, signals: storySignals(story, seg, pal) };
  }
  function pickTheme(cat) { return ['politics', 'economy', 'courts', 'tech', 'science', 'health', 'culture', 'weather', 'world'].includes(cat) ? cat : null; }
  function swapTo(built, { fly = true } = {}) {
    if (current) { current.hide(); outgoing.push(current); }
    current = built.holo; curStation = built.station;
    if (!current) return;
    current.show(); current._heroRevealed = false;
    world.setTheme(built.pal.a, built.pal.b);
    if (built.signals) hero.setStory(built.signals);
    hero.emit('arrive', 1);
    world.event('story', { x: built.station.x, z: built.station.z, color: built.pal.b });
    if (fly) flyTo(current.pose());
    rig.orbitDir = (built.pal.seed & 4) ? 1 : -1;
    // background beat: when the scene's hold is up, the scene transition fires on this card change
    const beat = built.vis !== 'alert' ? world.beat({ station: built.station, pal: built.pal, storyId: built.storyId }) : null;
    if (beat) {
      window.__pnnBeat = beat; hero.emit('beat', 0.8);
      try { document.dispatchEvent(new CustomEvent('pnn:beat', { detail: beat })); } catch (e) { reportErr('beat', e); }
      post.glitch(0.12);   // the transition is the show
    } else post.glitch(0.22);
    fx.ring(new THREE.Vector3(built.station.x, 0.15, built.station.z), built.pal.b, { radius: 26, dur: 1.6, bright: 1.6 });
    hero.dispatchDom(W, Hh);
  }

  // ---------- loop ----------
  let last_t = performance.now(), t = 0, errCount = 0, raf = 0, running = true;
  let fpsAcc = 0, fpsN = 0, fpsCheckAt = 8;
  const NO_FPS_GUARD = new URLSearchParams(location.search).get('fpsguard') === '0';   // tests: keep quality fixed
  let envQ = world.env.getState().quality, goodChecks = 0, lastQChange = 0;
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const raw = Math.max(0, (now - last_t) / 1000); last_t = now;
    const dt = Math.min(0.1, raw);           // simulation step (clamped so a stall doesn't explode physics)
    if (api.timing.frames.length < 12) api.timing.frames.push(+raw.toFixed(3));
    t += dt; TIME.value = t;
    try {
      tickCamera(dt, t, now);
      const live = current && !current.dead ? current : null;
      hero.tick(dt, t, { pose: live ? live.pose() : null, rect: RECT, cssW: W, cssH: Hh, visible: !!live && live.visible !== false });
      if (current) current.tick(dt, t);
      if (live && !live._heroRevealed && (live.reveal ?? 1) >= 0.999 && live.visible) { live._heroRevealed = true; hero.emit('reveal', 0.6); }
      for (let i = outgoing.length - 1; i >= 0; i--) {
        const h = outgoing[i]; h.tick(dt, t);
        if (h.dead) { try { h.dispose(); } catch (e) { reportErr('dispose', e); } outgoing.splice(i, 1); }
      }
      globe.tick(dt, t);
      fx.tick(dt);
      world.tick(dt, t, camera);
      post.render(dt);
    } catch (e) { if (errCount++ < 5) reportErr('frame', e); }
    fpsAcc += dt; fpsN++;
    if (t > fpsCheckAt && !NO_FPS_GUARD) {
      const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; fpsCheckAt = t + 5;
      api.fps = fps;
      // FPS guard: shed env quality first, then pixel ratio; step env quality back up only after 30 s of headroom
      if (document.hidden) goodChecks = 0;
      else if (fps < 50 && envQ > 0) { envQ--; world.setQuality(envQ); hero.setQuality(envQ); goodChecks = 0; lastQChange = t; }
      else if (fps < 48 && pixelRatio > 1) { pixelRatio = Math.max(1, +(pixelRatio - 0.25).toFixed(2)); lastSize = ''; resize(W, Hh); goodChecks = 0; }
      else if (fps > 58) { if (++goodChecks >= 6 && envQ < 2 && t - lastQChange > 60) { envQ++; world.setQuality(envQ); hero.setQuality(envQ); goodChecks = 0; lastQChange = t; } }
      else goodChecks = 0;
      api.envQ = envQ;
    }
  }
  // Warm-up: build one of every hologram far below the floor and compile all shader programs now, so the first
  // real story doesn't stall for seconds mid-flight while programs link.
  function warmup() {
    const t0 = performance.now();
    const station = new THREE.Vector3(0, -800, 0);
    const mkM = (id, p, d) => ({ id, outcome: id, title: id, yesPrice: p, change1d: d, closesAt: new Date(Date.now() + 3 * 86400e3).toISOString(), category: 'politics' });
    const ms = [mkM('a', 0.6, 0.05), mkM('b', 0.3, -0.04), mkM('c', 0.1, 0.01)];
    const story = { id: 'warmup', lead: ms[0], markets: ms, history: [{ t: 1, p: 0.3 }, { t: 2, p: 0.5 }, { t: 3, p: 0.4 }], visual: { type: 'outcomes', theme: 'politics', region: null } };
    const pal = palette(story);
    const ctx = { scene, fx, world, station, pal, seed: pal.seed, rnd: pal.rnd, globe };
    const built = [];
    try {
      built.push(createOutcomes(ctx, story), createDial(ctx, story), createRibbon(ctx, story), createCountdown(ctx, story, { cluster: true }), createMovers(ctx, ms));
      for (const h of built) { h.show(); h.tick(0.016, 0); h.tick(0.016, 0.016); }
      globe.show({ region: { name: 'x', lat: 10, lon: 10 }, prob: 0.5, palette: pal, seed: 1 }); globe.root.position.copy(station); globe.tick(0.016, 0);
      // draw one frame of everything through the full post chain: on Metal/ANGLE the expensive pipeline build
      // happens at first draw, not at link time, so compile() alone isn't enough
      camera.position.set(0, -790, 70); camera.lookAt(0, -792, 0); camera.updateMatrixWorld(true);
      renderer.compile(scene, camera);
      post.render(0.016);
      globe.hide(); globe.root.position.copy(GLOBE_STATION); globe.root.position.y = -globe.R - 8; globe.root.visible = false;
    } catch (e) { reportErr('warmup', e); }
    for (const h of built) { try { h.dispose(); } catch {} }
    api.timing.warmupMs = Math.round(performance.now() - t0);
  }

  const api = {
    fps: 0, envQ: 2, timing: { warmupMs: 0, envWarmMs: 0, frames: [] },
    forceBeat(type) { return world.env.forceBeat(type); },
    cut(type) { return world.env.cut(type); },
    get env() { return world.env.getState(); },
    envEvent(type, data) { try { world.event(type, data); if (type === 'flash') hero.emit('flash', 1); } catch (e) { reportErr('envEvent', e); } },
    showStory(story, segmentName = 'top') {
      try {
        const seg = ['top', 'focus', 'movers', 'week', 'sotd'].includes(segmentName) ? segmentName : 'top';
        if (seg === 'sotd' && !(story?.markets?.length)) return;
        last = { story, seg };
        if (alertActive) return;
        const key = seg === 'sotd' ? `sotd:${story.id ?? ''}` : `${seg === 'movers' ? 'movers' : story?.visual?.type}:${story?.id ?? ''}:${seg === 'week' ? 'week' : seg === 'top' ? 'top' : 'card'}`;
        if (key === curKey && current && !current.dead) return;
        if (!story && seg !== 'movers') return;
        curKey = key;
        swapTo(build(story, seg));
      } catch (e) { reportErr('showStory', e); }
    },
    showAlert(alert) {
      if (!alert) return;
      try {
        alertActive = true;
        world.setAlert(true); post.setAlert(true);
        post.flash(COL.alert, 1);
        rig.shake = 1.5; rig.pushTgt = 0.84;
        const station = curStation || STATIONS[2];
        world.shockwave(station.x, station.z, COL.alert);
        world.event('alert', { x: station.x, z: station.z });
        fx.ring(new THREE.Vector3(station.x, 0.15, station.z), COL.alert, { radius: 60, dur: 2.2, bright: 2.5 });
        fx.burst(new THREE.Vector3(station.x, 8, station.z), COL.amber, 500, { speed: 12, up: 8, lifeS: 2.4, sz: 1.2 });
        const pal = { ...palette({ id: alert.id || alert.marketId || 'alert' }, 'world'), a: COL.alert.clone(), b: COL.amber.clone(), hexA: '#ff3a2e', hexB: '#ffab2e' };
        pal.pick = (i) => [pal.a, pal.b, COL.white][i % 3]; pal.hex = (i) => ['#ff3a2e', '#ffab2e', '#ffffff'][i % 3];
        let holoRef = null;
        const ctx = { scene, fx: wrapFx(() => holoRef && current === holoRef), world, station, pal, seed: pal.seed, rnd: pal.rnd, globe, hero };
        const story = { id: alert.storyId, lead: { yesPrice: alert.to, change1d: alert.to - alert.from } };
        const holo = createDial(ctx, story, { alert: { from: alert.from, to: alert.to, minutes: alert.minutes || 0, label: alert.short || alert.label || alert.headline || '' } });
        holoRef = holo;
        curKey = 'alert:' + (alert.id || '');
        const mv = (alert.to ?? 0) - (alert.from ?? 0);
        swapTo({ holo, pal, station, vis: 'alert', signals: { move: mv, dir: mv > 0 ? 1 : mv < 0 ? -1 : 0, energy: 1, swing: false, alert: true, colorA: COL.alert, colorB: COL.amber, theme: 'alert' } });
        hero.emit('alert', 1);
      } catch (e) { reportErr('showAlert', e); }
    },
    clearAlert() {
      if (!alertActive) return;
      alertActive = false;
      world.setAlert(false); post.setAlert(false);
      world.event('alertClear');
      rig.pushTgt = 1; curKey = null;
      if (last) api.showStory(last.story, last.seg);
      else if (current) { current.hide(); outgoing.push(current); current = null; }
    },
    setTicker(markets) {
      tickerMarkets = Array.isArray(markets) ? markets : [];
      // a live movers board rebuilds in place when the ticker changes
      if (last?.seg === 'movers' && current && !alertActive) { curKey = null; api.showStory(last.story, 'movers'); }
    },
    resize(w, h) { resize(w, h); },
    setStageRect(rect) { RECT = rect || STAGE_RECT; SUBJECT_X = (RECT.x0 + RECT.x1) / 2; SUBJECT_Y = (RECT.y0 + RECT.y1) / 2; world.setStageRect(RECT); reframe(); },
    dispose() {
      running = false; cancelAnimationFrame(raf);
      window.removeEventListener('resize', onWinResize);
      try { if (current) current.dispose(); for (const h of outgoing) h.dispose(); } catch {}
      current = null; outgoing = [];
      hero.dispose(); globe.dispose(); fx.dispose(); world.dispose(); post.dispose();
      renderer.dispose();
    },
  };
  window.__pnnScene = { api, camera, rig, world, post, fx, globe, scene, flyTo, hero, get current() { return current; }, get RECT() { return RECT; } };
  warmup();
  world.setStageRect(RECT);
  // background: first scene + all transition programs compiled before the first frame (capped so a stuck import
  // never blanks the broadcast; the canvas shows the clear colour meanwhile)
  const envT0 = performance.now();
  Promise.race([world.warm(), new Promise((r) => setTimeout(r, 4000))])
    .catch((e) => reportErr('envWarm', e))
    .finally(() => { api.timing.envWarmMs = Math.round(performance.now() - envT0); last_t = performance.now(); if (running) raf = requestAnimationFrame(frame); });
  return api;
}
