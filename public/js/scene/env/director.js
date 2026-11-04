// Env director: cross-fades between moods (hold 1-2 min, blend 15-30 s), wanders every param slowly inside a
// mood, schedules small events (shooting stars, comets, lightning, grid pulses, terrain sweeps) and glues the
// blended params into the modules and post. Zero allocations per frame.
// URL: ?mood=<name> pins a mood; ?envfast=1 runs director time 20x; ?moodfast=1 compresses the cycle to ~20 s;
// ?envquality=0|1|2.
import * as THREE from '../../../vendor/three/three.module.js';
import { MOODS, WANDER, WEATHER, resolveMood, blendParams, dominant } from './moods.js';
import { makePhase } from './common.js';

const RESOLVED = MOODS.map(resolveMood);
const rand = (a, b) => a + Math.random() * (b - a);
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// valid ranges after wander (anything not listed is only floored at 0)
const RANGE = {
  'sun.height': [70, 320], 'sun.yaw': [-0.4, 0.05], 'sun.size': [0.3, 1.4], 'sun.eclipseOffset': [0, 0.3], 'sun.ringTilt': [0.1, 0.7],
  'sky.palDrift': [0, 1], 'sky.cloudAmt': [0, 1], 'terrain.amp': [0.3, 1.3], 'terrain.morphSeed': [-5, 5],
  'atmos.fogDensity': [0, 1], 'atmos.hazeAmt': [0, 0.8], 'atmos.fogLayers': [0, 1], 'particles.dust': [0, 1], 'particles.stars': [0, 1],
  'post.bloom': [0.4, 0.65], 'camera.orbitScale': [0.7, 1.3], 'camera.bob': [0.7, 1.3], 'grid.speed': [0.3, 2],
};

function lum(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

export function createDirector({ ctx, modules, post = null, opts = {} }) {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const pinName = opts.mood || q.get('mood');
  const speed = opts.envfast || (q.get('envfast') === '1' ? 20 : 1);
  const fast = opts.moodfast || q.get('moodfast') === '1';
  let quality = q.get('envquality') != null ? clamp(+q.get('envquality') | 0, 0, 2) : (opts.quality ?? 2);

  // user (2026-11-04): change every minute or two, quicker blends
  const holdDur = () => (fast ? rand(8, 12) : rand(60, 120));
  const transDur = () => (fast ? rand(5, 8) : rand(15, 30));

  let pinIdx = pinName ? RESOLVED.findIndex((m) => m.name === pinName) : -1;
  let curI = pinIdx >= 0 ? pinIdx : 0, prevI = -1, nextI = -1;
  let A = RESOLVED[curI], B = A;
  const out = resolveMood(MOODS[curI]);
  let k = 0, transT = 0, transLen = 45, transiting = false;
  let holdLeft = fast ? 10 : 45;           // first switch after 45 s
  let frozen = false;

  // wander: per path two seeded incommensurate phases (37..211 s periods)
  const wander = Object.entries(WANDER).map(([path, amp], i) => {
    const [sec, key] = path.split('.');
    const s1 = Math.sin(i * 12.9898 + 1.7) * 43758.5453, s2 = Math.sin(i * 78.233 + 4.1) * 12345.678;
    const p1 = 37 + (s1 - Math.floor(s1)) * 174, p2 = 37 + (s2 - Math.floor(s2)) * 174;
    return { sec, key, amp, r1: (Math.PI * 2) / p1, r2: (Math.PI * 2) / p2, f1: makePhase(i * 1.3), f2: makePhase(i * 2.9), range: RANGE[path] };
  });

  // transient nudges from events
  const nudge = { pal: 0, bloom: 0, bloomT: 0, tint: 0, tintCol: new THREE.Color(1, 1, 1) };
  const moverUp = new THREE.Color('#40ff90'), moverDn = new THREE.Color('#ff4060'), RED = new THREE.Color('#ff3a2e');
  const grade = { tint: new THREE.Color(1, 1, 1), tintAmt: 0, sat: 1, contrast: 1, vignette: 1, grain: 1, scan: 1, ca: 1 };
  const bloomP = { strength: 0.55, threshold: 0.78, radius: 0.4 };
  const cameraBias = { orbitScale: 1, bob: 1 };
  const events = { lastStrike: 0, lastStar: 0, lastComet: 0 };
  const sched = { star: 0, comet: 0, strike: 0, pulseIn: rand(20, 60), sweepIn: rand(15, 45) };
  const v3 = new THREE.Vector3();
  let clock = 0, lastCam = null;

  function pickNext() {
    const cur = RESOLVED[curI];
    const dSun = dominant(cur, 'sun'), dTer = dominant(cur, 'terrain'), dGrid = dominant(cur, 'grid');
    const cand = [];
    let tot = 0;
    RESOLVED.forEach((m, i) => {
      if (i === curI || i === prevI) return;
      const diff = (dominant(m, 'sun') !== dSun) + (dominant(m, 'terrain') !== dTer) + (dominant(m, 'grid') !== dGrid);
      if (diff < 2) return;
      const w = MOODS[i].weight || 1; cand.push([i, w]); tot += w;
    });
    if (!cand.length) RESOLVED.forEach((m, i) => { if (i !== curI) { cand.push([i, 1]); tot += 1; } });
    let r = Math.random() * tot;
    for (const [i, w] of cand) { r -= w; if (r <= 0) return i; }
    return cand[cand.length - 1][0];
  }
  function begin(i, len) {
    nextI = i; B = RESOLVED[i]; transLen = Math.max(0.5, len); transT = 0; transiting = true; k = 0;
  }

  function applyGuard() {
    const sky = A.sky, skyB = B.sky;
    const L = Math.max(lum(sky.mid), lum(sky.horizon) * 0.18) * (1 - k) + Math.max(lum(skyB.mid), lum(skyB.horizon) * 0.18) * k;
    ctx.guardAmt.value = L > 0.06 ? 0.6 : 0.45;   // dome-space luminance (horizon is scaled 0.18 by sky.js)
  }

  function tick(dt, t, camera) {
    lastCam = camera || lastCam;
    clock += dt;
    const ddt = dt * speed;
    // ---- timeline ----
    if (!frozen && pinIdx < 0) {
      if (transiting) {
        transT += ddt;
        k = smoother(clamp(transT / transLen, 0, 1));
        if (transT >= transLen) { prevI = curI; curI = nextI; A = B; k = 0; transiting = false; nextI = -1; holdLeft = holdDur(); }
      } else {
        holdLeft -= ddt;
        if (holdLeft <= 0) begin(pickNext(), transDur());
      }
    }
    blendParams(A, B, k, out);
    // ---- wander ----
    for (let i = 0; i < wander.length; i++) {
      const w = wander[i];
      const o = out[w.sec];
      const v = o[w.key] + w.amp * (0.6 * Math.sin(w.f1.add(ddt, w.r1, Math.PI * 2)) + 0.4 * Math.sin(w.f2.add(ddt, w.r2, Math.PI * 2)));
      o[w.key] = w.range ? clamp(v, w.range[0], w.range[1]) : Math.max(0, v);
    }
    // ---- nudges + safety clamps ----
    nudge.pal = Math.max(0, nudge.pal - dt * 0.05 / 20);
    nudge.tint = Math.max(0, nudge.tint - dt * 0.04 / 30);
    if (nudge.bloomT > 0) nudge.bloomT -= dt; else nudge.bloom = 0;
    out.sky.palDrift = clamp(out.sky.palDrift + nudge.pal, 0, 1);
    out.sun.bright = Math.min(out.sun.bright, 1.2);
    out.atmos.fogDensity = Math.min(out.atmos.fogDensity, 1);
    let wx = 0; for (const n of WEATHER) wx += out.particles[n];
    if (wx > 1) for (const n of WEATHER) out.particles[n] /= wx;
    applyGuard();

    // ---- push to modules ----
    const M = modules;
    M.sky?.setParams(out.sky); M.sun?.setParams(out.sun); M.terrain?.setParams(out.terrain);
    M.grid?.setParams(out.grid); M.atmos?.setParams(out.atmos); M.particles?.setParams(out.particles);
    if (M.sun && M.terrain?.setValley) M.terrain.setValley(M.sun.getWorldPos(v3).x);
    cameraBias.orbitScale = clamp(out.camera.orbitScale, 0.7, 1.3); cameraBias.bob = clamp(out.camera.bob, 0.7, 1.3);
    if (post) {
      bloomP.strength = clamp(out.post.bloom, 0.4, 0.65) + nudge.bloom;
      bloomP.threshold = out.post.bloomThreshold; bloomP.radius = out.post.bloomRadius;
      post.setBloom?.(bloomP);
      const P = out.post;
      grade.tint.copy(P.tint); grade.tintAmt = P.tintAmt;
      if (nudge.tint > 0.0005) {          // mover tint: blend toward green/red on top of the mood tint
        const tot = grade.tintAmt + nudge.tint;
        grade.tint.lerp(nudge.tintCol, nudge.tint / tot); grade.tintAmt = tot;
      }
      grade.sat = P.sat; grade.contrast = P.contrast; grade.vignette = P.vignette; grade.grain = P.grain; grade.scan = P.scan; grade.ca = P.ca;
      post.setGrade?.(grade);
    }

    // ---- scheduler (real time, not envfast) ----
    const pr = out.particles;
    if (pr.shootingRate > 0 && clock - sched.star > 8 && Math.random() < (pr.shootingRate / 60) * dt) { sched.star = clock; events.lastStar = clock; M.particles?.shootingStar(); }
    if (pr.cometRate > 0 && clock - sched.comet > 240 && Math.random() < (pr.cometRate / 600) * dt) { sched.comet = clock; events.lastComet = clock; M.particles?.comet(); }
    const lr = out.atmos.lightningRate;
    if (quality > 0 && lr > 0.01 && clock - sched.strike > 6 && Math.random() < (lr / 60) * dt) { sched.strike = clock; events.lastStrike = clock; M.atmos?.strike(); }
    if ((sched.pulseIn -= dt) <= 0) {
      sched.pulseIn = rand(20, 60);
      if (lastCam && M.grid) M.grid.pulse(lastCam.position.x + rand(-300, 300), lastCam.position.z - rand(300, 900), out.grid.colA, { strength: 0.4 });
    }
    if ((sched.sweepIn -= dt) <= 0) {
      const pa = out.terrain.pulseAmt;
      sched.sweepIn = rand(15, 45) / Math.max(0.25, pa);
      if (pa > 0.05) M.terrain?.pulse(Math.min(1, 0.4 + pa * 0.6));
    }
  }

  function event(type, data = {}) {
    const M = modules;
    switch (type) {
      case 'alert':
        frozen = true;
        if (data.x != null) M.grid?.pulse(data.x, data.z, RED, { strength: 1.2 });
        if (out.atmos.lightningRate > 0.01) M.atmos?.strike();
        break;
      case 'alertClear':
        if (frozen) { frozen = false; holdLeft += 30; }
        break;
      case 'story':
        if (data.x != null) {
          M.grid?.pulse(data.x, data.z, data.color || out.grid.colB, { strength: 0.8 });
          M.grid?.setPolarOrigin?.(data.x, data.z);
        }
        nudge.pal = 0.05;
        break;
      case 'flash': {
        const c = lastCam?.position;
        const x = data.x ?? (c ? c.x : 0), z = data.z ?? (c ? c.z - 160 : 0);
        M.grid?.pulse(x, z, out.grid.colB, { strength: 1 });
        setTimeout(() => M.grid?.pulse(x, z, out.grid.colA, { strength: 0.8 }), 350);
        M.terrain?.pulse(1); M.particles?.shootingStar();
        nudge.bloom = 0.1; nudge.bloomT = 1.5;
        break;
      }
      case 'mover':
        nudge.tintCol.copy((data.dir ?? 1) >= 0 ? moverUp : moverDn); nudge.tint = 0.04;
        break;
      case 'strike': M.atmos?.strike(data); break;
      case 'star': M.particles?.shootingStar(); break;
      case 'comet': M.particles?.comet(); break;
      case 'pulse': M.terrain?.pulse(1); break;
    }
  }

  function setMood(name, { transition = 45 } = {}) {
    const i = RESOLVED.findIndex((m) => m.name === name);
    if (i < 0) return false;
    if (transiting) { A = RESOLVED[curI]; }
    if (transition <= 0) { prevI = curI; curI = i; A = B = RESOLVED[i]; k = 0; transiting = false; holdLeft = holdDur(); }
    else begin(i, transition);
    return true;
  }
  function setQuality(l) {
    quality = clamp(l | 0, 0, 2); ctx.quality = quality;
    for (const m of Object.values(modules)) m?.setQuality?.(quality);
  }

  const api = {
    tick, event, setMood, setQuality, cameraBias,
    next() { return setMood(RESOLVED[pickNext()].name, { transition: fast ? 10 : 45 }); },
    attachPost(p) { post = p; },
    getState: () => ({ mood: RESOLVED[curI].name, next: nextI >= 0 ? RESOLVED[nextI].name : null, k: +k.toFixed(3), holdLeft: Math.round(holdLeft), quality, pinned: pinIdx >= 0, frozen, events: { ...events } }),
    moods: RESOLVED.map((m) => m.name),
    out,
    dispose() { post = null; },
  };
  if (quality !== 2) setQuality(quality);
  return api;
}
