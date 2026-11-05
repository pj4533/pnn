// Vector Arcade Void: late-70s vector monitor. Phosphor wireframes on black, no fills.
// Hero: Tempest tube web (far left). Layers: tumbling polyhedra stream, Battlezone saucers/tanks, sparse starfield.
import * as THREE from '../../../vendor/three/three.module.js';
import { POLY_VS, SAUCER_VS, WEB_VS, WEB_FS, STAR_VS, WAVE_VS, WAVE_FS, LINE_FS } from './vectorArcade.glsl.js';

const TYPES = [['ico', 170], ['octa', 170], ['torus', 80], ['pyr', 180]];
const QF = [0.33, 0.58, 1], STARS = [1000, 1800, 3000];
const ZNEAR = -190, ZFAR = -1650;
const HERO_STUB_GLSL = `uniform vec4 uHero; uniform vec4 uHeroW; uniform vec4 uStory; uniform vec3 uStoryCol; uniform vec3 uStoryColA;`;   // only used when the stage core is absent
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ---- geometry builders (one-time CPU work) ----
function torusEdges(R, r, nu, nv) {
  const P = [], pt = (i, j) => { const u = (i % nu) / nu * 6.2832, v = (j % nv) / nv * 6.2832, k = R + r * Math.cos(v); return [k * Math.cos(u), r * Math.sin(v), k * Math.sin(u)]; };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { P.push(...pt(i, j), ...pt(i + 1, j), ...pt(i, j), ...pt(i, j + 1)); }
  return new Float32Array(P);
}
function baseEdges(kind) {
  if (kind === 'torus') return torusEdges(0.8, 0.3, 14, 6);
  const g = kind === 'ico' ? new THREE.IcosahedronGeometry(1, 0) : kind === 'octa' ? new THREE.OctahedronGeometry(1, 0) : new THREE.ConeGeometry(1, 1.7, 4);
  const e = new THREE.EdgesGeometry(g, 5).attributes.position.array; g.dispose(); return e;
}
function boxLines(P, cx, cy, cz, sx, sy, sz) {
  const c = []; for (let i = 0; i < 8; i++) c.push([cx + ((i & 1) - .5) * sx, cy + (((i >> 1) & 1) - .5) * sy, cz + (((i >> 2) & 1) - .5) * sz]);
  for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) P.push(...c[a], 0, ...c[b], 0);
}
// segments sorted bottom-up so aIdx gives a sweeping vertex-order reveal
function segAttrs(pos, rnd, tags, stride = 3) {
  const n = pos.length / (stride * 2), order = [...Array(n).keys()];
  const my = (i) => Math.min(pos[i * 2 * stride + 1], pos[(i * 2 + 1) * stride + 1]);
  order.sort((a, b) => my(a) - my(b));
  const T = new Float32Array(n * 2), P = new Float32Array(n * 6), I = new Float32Array(n * 2), M = new Float32Array(n * 6), D = new Float32Array(n * 6);
  order.forEach((s, k) => {
    const a = [pos[s * 2 * stride], pos[s * 2 * stride + 1], pos[s * 2 * stride + 2]], b = [pos[(s * 2 + 1) * stride], pos[(s * 2 + 1) * stride + 1], pos[(s * 2 + 1) * stride + 2]];
    const d = [rnd() - .5, rnd() - .5, rnd() - .5], l = Math.hypot(...d) || 1;
    for (let q = 0; q < 2; q++) {
      const v = q ? b : a, o = k * 6 + q * 3;
      P.set(v, o); M.set([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], o); D.set([d[0] / l, d[1] / l, d[2] / l], o);
      I[k * 2 + q] = k / Math.max(1, n - 1); if (tags) T[k * 2 + q] = tags[s];
    }
  });
  return { P, I, M, D, T, n };
}

export function create(ctx) {
  const { rnd, quality } = ctx, cam = ctx.camera, stage = ctx.stage;
  const th = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), asp = cam.aspect || 16 / 9, camY = cam.position.y;
  // hero uniforms: shared refs from ctx.common() (stage core); stubbed from the stage-rect centre when absent
  const C0 = ctx.common(), coreHero = !!C0.uHero;
  const HU = {
    uHero: C0.uHero || { value: new THREE.Vector4(0.64, 0.6, 0.2, 0.25) }, uHeroW: C0.uHeroW || { value: new THREE.Vector4(0, 10, 0, 15) },
    uStory: C0.uStory || { value: new THREE.Vector4(0, 0.35, 0, 0) }, uStoryCol: C0.uStoryCol || { value: new THREE.Color().copy(ctx.accent2.value) },
    uStoryColA: C0.uStoryColA || { value: new THREE.Color().copy(ctx.accent.value) },
  };
  const root = new THREE.Group(); root.frustumCulled = false; stage.add(root);
  if (ctx.anchor) ctx.anchor(root, { parallax: 0.15 });
  const sky = new THREE.Group(); stage.add(sky);

  // shared non-common uniforms (by reference across all materials)
  const U = {
    uTravel: { value: 0 }, uSpin: { value: 0 }, uReveal: { value: 1 }, uExit: { value: 0 }, uK: { value: 1 },
    uZNear: { value: ZNEAR }, uZFar: { value: ZFAR }, uWaveC: { value: new THREE.Vector3() }, uWaveR: { value: -9999 },
    uWaveA: { value: 0 }, uWaveT: { value: 1 }, uWaveCol: { value: new THREE.Color() }, uWebWave: { value: -9 },
    uOrbit: { value: 0 }, uSauT: { value: 0 }, uWebClk: { value: 0 }, uWebRot: { value: 0 }, uWaveRho: { value: -9 },
  };
  const G = ctx.GLSL, C = G.COMMON || '';
  const frag = (body) => {
    let h = C + '\nfloat sqf(float x){ return x*x; }\n'; if (!/uniform\s+vec4\s+uHero\b/.test(h)) h += '\n' + HERO_STUB_GLSL + '\n';
    if (!/vec3\s+finish\s*\(/.test(h)) for (const k of ['GUARD', 'guard', 'alertMix', 'finish']) { const v = G[k]; h += (typeof v === 'function' ? v() : v || '') + '\n'; }
    return h + body;
  };
  const mat = (vs, fs, extra = {}) => ctx.track(new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: frag(fs), uniforms: { ...ctx.common(), ...HU, ...U, ...extra },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  const line = (geo, m, parent) => { const o = new THREE.LineSegments(geo, m); o.frustumCulled = false; parent.add(o); return o; };

  // ---- polyhedra ----
  const polyMat = mat(POLY_VS, LINE_FS), polyGeos = [];
  let nInst = 0;
  for (const [kind, max] of TYPES) {
    const s = segAttrs(baseEdges(kind), rnd), g = ctx.track(new THREE.InstancedBufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(s.P, 3)); g.setAttribute('aIdx', new THREE.BufferAttribute(s.I, 1));
    g.setAttribute('aMid', new THREE.BufferAttribute(s.M, 3)); g.setAttribute('aDir', new THREE.BufferAttribute(s.D, 3));
    const off = new Float32Array(max * 3), ax = new Float32Array(max * 4), sd = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) {
      // hero-polar spawn: angle, outer radius (hero radii), phase
      const giant = rnd() < 0.035;
      off.set([rnd() * 6.2832, giant ? 4.5 + rnd() * 2 : 2.1 + 2.9 * Math.pow(rnd(), 0.8), rnd()], i * 3);
      const av = [rnd() - .5, rnd() - .5, rnd() - .5], l = Math.hypot(...av) || 1;
      ax.set([av[0] / l, av[1] / l, av[2] / l, (rnd() < .5 ? -1 : 1) * (.25 + rnd() * rnd() * 2.2)], i * 4);
      sd.set([giant ? 130 + rnd() * 110 : 10 + rnd() * rnd() * 42, giant ? .3 + rnd() * .2 : .7 + rnd() * .6, rnd(), rnd()], i * 4);
    }
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3)); g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(ax, 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 4)); g.instanceCount = max;
    line(g, polyMat, root); polyGeos.push([g, max]); nInst += max;
  }

  // ---- Tempest web: supercircle tube, 16 lanes ----
  const NL = 16, NR = 22, wl = [], wd = [], wa = [];
  for (let j = 0; j < NR; j++) for (let i = 0; i < NL; i++) {
    const a0 = i / NL * 6.2832, a1 = (i + 1) / NL * 6.2832, d = j / (NR - 1);
    wl.push(i, i); wd.push(d, d); wa.push(a0, a1);
    if (j < NR - 1) { wl.push(i, i); wd.push(d, (j + 1) / (NR - 1)); wa.push(a0, a0); }
  }
  const wg = ctx.track(new THREE.BufferGeometry());
  wg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(wl.length * 3), 3)); wg.setAttribute('aLane', new THREE.Float32BufferAttribute(wl, 1));
  wg.setAttribute('aDepth', new THREE.Float32BufferAttribute(wd, 1)); wg.setAttribute('aAng', new THREE.Float32BufferAttribute(wa, 1));
  const web = line(wg, mat(WEB_VS, WEB_FS), root);

  // ---- saucers (kind 0) and tanks (kind 1) share one draw; aModel masks the other kind ----
  const sPos = [], sTag = [];
  const seg = (a, b, tag) => { sPos.push(...a, ...b); sTag.push(tag); };
  const ringPts = (y, r, n) => Array.from({ length: n }, (_, i) => [r * Math.cos(i / n * 6.2832), y, r * Math.sin(i / n * 6.2832)]);
  const lv = [ringPts(0, 1, 12), ringPts(-.18, .55, 12), ringPts(.14, .62, 12), ringPts(.4, .28, 12)];
  for (const r of lv) for (let i = 0; i < 12; i++) seg(r[i], r[(i + 1) % 12], 0);
  for (let i = 0; i < 12; i++) { seg(lv[0][i], lv[1][i], 0); seg(lv[0][i], lv[2][i], 0); seg(lv[2][i], lv[3][i], 0); }
  const tp = []; boxLines(tp, 0, 0, 0, 1.3, .45, 2); boxLines(tp, 0, .45, .15, .7, .4, .8); boxLines(tp, 0, .5, -.9, .1, .1, 1.1); boxLines(tp, -.75, -.1, 0, .22, .3, 2.1); boxLines(tp, .75, -.1, 0, .22, .3, 2.1);
  for (let i = 0; i < tp.length; i += 8) seg(tp.slice(i, i + 3), tp.slice(i + 4, i + 7), 1);
  const sa = segAttrs(new Float32Array(sPos), rnd, sTag), NS = 12, sg = ctx.track(new THREE.InstancedBufferGeometry());
  sg.setAttribute('position', new THREE.BufferAttribute(sa.P, 3)); sg.setAttribute('aIdx', new THREE.BufferAttribute(sa.I, 1)); sg.setAttribute('aModel', new THREE.BufferAttribute(sa.T, 1));
  const arc = new Float32Array(NS * 4), ss = new Float32Array(NS * 4);
  for (let i = 0; i < NS; i++) {
    const tank = i >= 8 ? 1 : 0;
    arc.set([rnd() * 0.9, 0, (.5 + rnd() * .6) * (i % 2 ? -1 : 1), rnd() * 6.28], i * 4);
    ss.set([tank, 520 + rnd() * 250, 0.45 + rnd() * 0.4, rnd()], i * 4);
  }
  sg.setAttribute('aArc', new THREE.InstancedBufferAttribute(arc, 4)); sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ss, 4)); sg.instanceCount = NS;
  line(sg, mat(SAUCER_VS, LINE_FS), root);

  // ---- stars (infinitely far, follow camera rotation only) ----
  const NSTAR = 3000, st = new Float32Array(NSTAR * 4);
  for (let i = 0; i < NSTAR; i++) {
    const x = (rnd() * 2 - 1) * 1.7 * asp * th, y = (Math.pow(rnd(), .8) * 2 - .55) * 1.6 * th, l = Math.hypot(x, y, 1);
    st.set([x / l, y / l, -1 / l, rnd()], i * 4);
  }
  const stg = ctx.track(new THREE.BufferGeometry()); stg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NSTAR * 3), 3)); stg.setAttribute('aStar', new THREE.BufferAttribute(st, 4));
  const stars = new THREE.Points(stg, mat(STAR_VS, LINE_FS)); stars.frustumCulled = false; stars.renderOrder = -1; sky.add(stars);

  // ---- ripple: wireframe shockwave sphere ----
  const wsph = ctx.track(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 2)));
  const wave = line(wsph, mat(WAVE_VS, WAVE_FS), root); wave.visible = false;

  // ---- state ----
  let enterT = 0, enterD = 0, exitT = 0, exitD = 0, spinBoost = 0, punch = 0, waveAge = 9, waveStr = 0, qf = 1, waveBase = 20;
  const q0 = Math.min(2, Math.max(0, quality | 0));
  const _v = new THREE.Vector3(), sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  const unproj = (nx, ny, dist, out) => out.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(dist).add(cam.position);
  // shockwave sphere sits on the widget (uHeroW when the stage core feeds it, else the hero's screen point unprojected)
  function place() {
    const h = HU.uHero.value;
    if (coreHero && ctx.hero) { const w = HU.uHeroW.value; U.uWaveC.value.set(w.x, w.y, w.z); waveBase = Math.max(5, w.w); }
    else { cam.updateMatrixWorld(); unproj(h.x * 2 - 1, h.y * 2 - 1, 160, U.uWaveC.value); waveBase = h.w * 2 * 160 * th; }
  }
  const api = {
    grade: { bloom: 0.6, bloomThreshold: 0.55, bloomRadius: 0.5, tint: new THREE.Color(0.35, 0.8, 1.0), tintAmt: 0.06, sat: 1.12, contrast: 1.12, ca: 0.0018, grain: 0.05, vignette: 0.5, scan: 0.35 },
    cameraBias: { orbitScale: 1.1, bob: 0.9 },
    setIntensity(a) { U.uK.value = a; },
    enter(dur) { enterD = Math.max(0.1, dur); enterT = 0; exitD = 0; exitT = 0; U.uReveal.value = 0; U.uExit.value = 0; },
    exit(dur) { exitD = Math.max(0.1, dur); exitT = 0; spinBoost += 5; },
    ripple(o) {
      const s = o && o.strength != null ? o.strength : 1;
      if (o && o.color != null) { if (o.color.isColor) U.uWaveCol.value.copy(o.color); else U.uWaveCol.value.set(o.color); } else U.uWaveCol.value.copy(HU.uStoryCol.value);
      waveAge = 0; waveStr = s; wave.visible = true; place(); spinBoost += 5 * s; punch = Math.max(punch, s); ctx.pulse.value = Math.max(ctx.pulse.value, 0.8 * s);
    },
    shockwave(x, z, color) { api.ripple({ x, z, color, strength: 1 }); },
    // hero pulse: wireframe shockwave sphere spawned on the widget + a lane flash running out from the eye-wall
    event(type, p) { if (type === 'heroPulse') api.ripple({ strength: Math.max(0.5, (p && p.strength) || 1), color: p && p.color }); },
    setQuality(q) {
      qf = QF[Math.min(2, Math.max(0, q | 0))];
      for (const [g, max] of polyGeos) g.instanceCount = Math.max(8, Math.round(max * qf));
      stg.setDrawRange(0, STARS[Math.min(2, Math.max(0, q | 0))]);
    },
    morphPoints(out, n) { // CPU replica of the hero-polar polyhedra paths and the hero-fitted web
      const tr = U.uTravel.value, H = HU.uHero.value, inw = HU.uStory.value.x >= 0 ? 1 : -1, orb = U.uOrbit.value; let k = 0;
      const nPoly = Math.floor(n * 0.7);
      for (; k < nPoly; k++) {
        const [g, max] = polyGeos[k % 4], i = ((k / 4) | 0) % Math.round(max * qf), off = g.attributes.aOffset.array, sd = g.attributes.aSeed.array, ax = g.attributes.aAxis.array;
        const ph = (off[i * 3 + 2] + tr * sd[i * 4 + 1]) % 1, giant = sd[i * 4] > 110, e = sm(0, 0.72, ph), rhoR = giant ? 3.4 : 1.3 + 1.5 * sd[i * 4 + 3] * sd[i * 4 + 3];
        const rho = inw > 0 ? off[i * 3 + 1] + (rhoR - off[i * 3 + 1]) * e : rhoR + (off[i * 3 + 1] - rhoR) * e, sg = ax[i * 4 + 3] > 0 ? 1 : -1;
        const th = off[i * 3] + (inw > 0 ? 2.4 * (1 - e) : -2.4 * e) * sg + orb * (0.3 + sd[i * 4 + 3] * 0.5) * sg / (0.6 + rho * 0.5);
        unproj((H.x + Math.cos(th) * H.z * rho) * 2 - 1, (H.y + Math.sin(th) * H.w * rho) * 2 - 1, giant ? 2300 : 520 + 700 * ((sd[i * 4 + 2] * 13.7) % 1), _v);
        out[k * 3] = _v.x; out[k * 3 + 1] = _v.y; out[k * 3 + 2] = _v.z;
      }
      const wd = wg.attributes.aDepth.array, wa = wg.attributes.aAng.array;
      for (; k < n; k++) {
        const v = (rnd() * wd.length) | 0, d = wd[v], a = wa[v] + U.uWebRot.value, c = Math.cos(a), s = Math.sin(a);
        const sq = 1 / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), 0.25), rho = 1.35 / (1 - 0.93 * Math.pow(d, 0.85)) * (1 + (sq - 1) * sm(0, 0.7, d));
        unproj((H.x + c * H.z * rho) * 2 - 1, (H.y + s * H.w * rho) * 2 - 1, 900, _v);
        out[k * 3] = _v.x; out[k * 3 + 1] = _v.y; out[k * 3 + 2] = _v.z;
      }
      return true;
    },
    update(dt, t, info) {
      dt = Math.min(dt, 0.1);
      if (!ctx.anchor) root.position.x = (info ? info.camX : cam.position.x) * 0.85;
      if (enterD > 0 && enterT < enterD) enterT += dt;
      if (exitD > 0 && exitT < exitD) exitT += dt;
      const rv = enterD > 0 ? ease(enterT / enterD) : 1, ex = exitD > 0 ? ease(exitT / exitD) : 0;
      U.uReveal.value = rv; U.uExit.value = ex;
      const al = ctx.alert.value, sp = 1 + 0.4 * al, rush = 1 + 6 * (1 - rv) * (1 - rv);
      spinBoost *= Math.exp(-dt * 1.1); punch *= Math.exp(-dt * 1.6);
      if (!coreHero) { const r = ctx.guardRect.value; HU.uHero.value.set((r.x + r.z) / 2, (r.y + r.w) / 2, (r.z - r.x) * 0.3, (r.w - r.y) * 0.3); }
      const en = HU.uStory.value.y;                       // story energy drives every speed in the room
      U.uTravel.value += dt * 0.062 * (0.5 + 1.1 * en) * (1 + punch * 3.5) * sp * rush;
      U.uSpin.value += dt * (0.6 + spinBoost) * sp;
      U.uOrbit.value += dt * (0.3 + 0.9 * en) * sp;
      U.uSauT.value += dt * (0.5 + 1.1 * en) * sp;
      U.uWebClk.value += dt * (0.55 + 1.3 * en) * sp;
      U.uWebRot.value += dt * 0.13 * (1 + punch) * sp * (0.5 + en);
      if (waveAge < 1.8) {
        waveAge += dt; const f = waveAge / 1.8, w = 1 - (1 - f) * (1 - f);
        place(); U.uWaveR.value = waveBase * (1.2 + 16 * w); U.uWaveRho.value = 1 + 4.5 * w; U.uWaveT.value = f; U.uWaveA.value = waveStr * (1 - f); U.uWebWave.value = Math.min(1.2, f * 1.6) - 0.1;
        if (waveAge >= 1.8) { wave.visible = false; U.uWaveR.value = -9999; U.uWaveA.value = 0; U.uWebWave.value = -9; U.uWaveRho.value = -9; }
      }
    },
    dispose() {},
  };
  api.setQuality(q0);
  return api;
}
