// vaporGallery: classic vaporwave album cover. Chrome bust, checker floor, marble columns, OS windows, palms, orbiting wire solids.
import * as THREE_ from '../../../vendor/three/three.module.js';
import * as S from './vaporGallery.glsl.js';

const ease = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
// The left ~47% of the screen is an opaque card and the hologram sits at ~(0.64, 0.62): the bust, columns and windows live in the right half,
// behind and around the hologram (upper right, far background). The hologram itself spans roughly x 0.39-0.89, y 0.24-0.65: keep clear of it.
const BUST = { sx: 0.84, sy: 0.83, z: -170, hf: 0.3 };

function atlas(THREE) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  const pal = ['#ff9ad5', '#7ff3e6', '#b9a2ff', '#ffc9a0', '#fff1a8', '#9fd0ff'];
  for (let i = 0; i < 8; i++) {
    const ox = (i % 4) * 256, oy = Math.floor(i / 4) * 256; g.save(); g.translate(ox, oy);
    g.fillStyle = '#2a1a4e'; g.fillRect(0, 0, 256, 256); g.fillStyle = pal[i % 6]; g.fillRect(4, 4, 248, 28);
    g.fillStyle = '#2a1a4e'; for (let b = 0; b < 3; b++) g.fillRect(212 + b * 12, 12, 8, 8);
    g.fillStyle = '#d8cff0'; g.fillRect(4, 36, 248, 216); const P = 16;
    for (let y = 0; y < 13; y++) for (let x = 0; x < 15; x++) {
      const X = 8 + x * P, Y = 40 + y * P; let v = 0;
      if (i === 0) v = (Math.hypot(x - 7, y - 8) < 5) ? 1 + ((y + x) & 1) : 0;
      else if (i === 1) v = ((x + y) & 1) ? 3 : 0;
      else if (i === 2) v = y > 12 - (Math.abs(x - 7) * 1.3 + (x % 3)) ? 2 : (y < 4 && x > 10 ? 4 : 0);
      else if (i === 3) v = y > 12 - ((x * 7 + 3) % 11) ? 1 + (x % 3) : 0;
      else if (i === 4) v = (x % 5 < 3 && y % 4 < 2) ? 1 + ((x / 5 | 0) + (y / 4 | 0)) % 4 : 0;
      else if (i === 5) v = ((x * 3 + y * 5) % 7 < y / 2) ? 3 : 0;
      else if (i === 6) v = (x === 3 || x === 11 || y === 3 || y === 10 || x - y === -2 + 5 || x + y === 14) ? 5 : 0;
      else v = (y === 6 ? (x < 10 ? 1 : 0) : ((x + y * 2) % 4 === 0 ? 2 : 0));
      if (v) { g.fillStyle = pal[v % 6]; g.fillRect(X, Y, P, P); }
    }
    g.strokeStyle = '#2a1a4e'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 252); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t;
}

function bustGeometry(THREE, rnd) {
  const parts = [];
  const add = (geo, m) => { const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(m); parts.push(g.attributes.position.array); };
  const M = new THREE.Matrix4();
  const prof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(Math.max(0.001, 0.95 * Math.pow(Math.sin(Math.PI * t), 0.75) * (0.78 + 0.28 * t)), -1 + 2.1 * t)); }
  add(new THREE.LatheGeometry(prof, 14), M.makeScale(1, 1, 0.9));
  add(new THREE.ConeGeometry(0.15, 0.5, 4), M.makeTranslation(0, -0.08, 0.95).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  add(new THREE.BoxGeometry(1.0, 0.1, 0.25), M.makeTranslation(0, 0.38, 0.72));
  add(new THREE.CylinderGeometry(0.32, 0.42, 0.8, 10), M.makeTranslation(0, -1.3, 0));
  add(new THREE.SphereGeometry(1.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.makeScale(0.95, 0.5, 0.6).setPosition(0, -1.9, 0));
  let n = 0; for (const p of parts) n += p.length;
  const pos = new Float32Array(n); let o = 0; for (const p of parts) { pos.set(p, o); o += p.length; }
  for (let i = 1; i < n; i += 3) pos[i] += 0.55;
  const tris = n / 9, bary = new Float32Array(n), cen = new Float32Array(n), r = new Float32Array(n / 3);
  let y0 = 1e9, y1 = -1e9;
  for (let t = 0; t < tris; t++) {
    const rr = rnd(); let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < 3; v++) { const i = t * 9 + v * 3; cx += pos[i] / 3; cy += pos[i + 1] / 3; cz += pos[i + 2] / 3; bary[i + v] = 1; y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); r[t * 3 + v] = rr; }
    for (let v = 0; v < 3; v++) { const i = t * 9 + v * 3; cen[i] = cx; cen[i + 1] = cy; cen[i + 2] = cz; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  g.setAttribute('aC', new THREE.BufferAttribute(cen, 3)); g.setAttribute('aR', new THREE.BufferAttribute(r, 1));
  g.userData.y = [y0, y1]; return g;
}

function withBary(THREE, geo) {
  const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count, b = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) b[i * 3 + (i % 3)] = 1; g.setAttribute('aBary', new THREE.BufferAttribute(b, 3)); return g;
}

export function create(ctx) {
  const THREE = ctx.THREE || THREE_, rnd = ctx.rnd;
  const G0 = ctx.GLSL, COMMON = G0.COMMON || '';
  const part = (k, sig) => (typeof G0[k] === 'string' && !COMMON.includes(sig) ? G0[k] : '');
  const GL = COMMON + part('guard', 'float guard(') + part('alertMix', 'vec3 alertMix(') + part('finish', 'vec3 finish(');
  const FH = GL + S.FHEAD, VH = S.VHEAD;
  const cam = ctx.camera;
  // Everything is authored in VIEW space and the roots follow the camera each frame, so the layout (right-half composition) holds at any camera pose
  // (the scene may be created while the rig is parked at the warm-up pose, and each story flies the camera elsewhere).
  const ref = cam.clone(); ref.position.set(0, 0, 0); ref.quaternion.identity(); ref.scale.set(1, 1, 1); ref.updateProjectionMatrix(); ref.updateMatrixWorld(true);
  const tmp = new THREE.Vector3();
  // screen fraction -> view-space point on plane z (create-time only)
  const at = (sx, sy, z) => { tmp.set(sx * 2 - 1, sy * 2 - 1, 0.5).unproject(ref); const t = z / tmp.z; return new THREE.Vector3(tmp.x * t, tmp.y * t, z); };
  const uph = (z) => Math.abs(at(0.5, 1, z).y - at(0.5, 0, z).y);

  const U = {
    uP: { value: 0 }, uFloor: { value: 1 }, uRip: { value: new THREE.Vector4(0.2, 99, 0, 0) }, uRipCol: { value: new THREE.Color(1, 0.3, 0.8) }, uPar: { value: new THREE.Vector2() },
    uBuild: { value: 1 }, uBreak: { value: 0 }, uFlare: { value: 0 }, uOrb: { value: 0 }, uPunch: { value: 0 }, uSunPh: { value: 0 }, uWv: { value: new THREE.Vector2(9, 0) },
  };
  const uni = { ...ctx.common(), ...U };
  const mk = (vs, fs, extra, o = {}) => ctx.track(new THREE.ShaderMaterial({
    vertexShader: VH + vs, fragmentShader: FH + fs, uniforms: { ...uni, ...extra }, transparent: !o.opaque, depthWrite: !!o.depth,
    blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
  }));
  const root = new THREE.Group(), sroot = new THREE.Group(); ctx.stage.add(root, sroot);
  root.matrixAutoUpdate = false; sroot.matrixAutoUpdate = false;
  const lx = (x) => x, lxs = (x) => x;
  const sync = (par) => {   // roots ride the camera; a small lateral parallax keeps depth when the rig flies
    const off = par ? 30 * Math.tanh(par.x / 200) : 0;
    for (const [g, k] of [[root, 0.4], [sroot, 0.15]]) { g.position.copy(cam.position); g.quaternion.copy(cam.quaternion); g.translateX(-off * k); g.updateMatrix(); g.matrixWorld.copy(g.matrix); }
  };
  sync(null);

  // ---- backdrop: wall + floor
  const back = ctx.backdrop(ctx.track(new THREE.ShaderMaterial({ vertexShader: S.BACK_VS, fragmentShader: FH + S.BACK_FS, uniforms: { ...uni } })));

  // ---- bust
  const bg = ctx.track(bustGeometry(THREE, rnd));
  const bustMat = mk(S.BUST_VS, S.BUST_FS, { uY: { value: new THREE.Vector2(...bg.userData.y) } }, { depth: true });
  const bust = new THREE.Mesh(bg, bustMat); bust.frustumCulled = false; root.add(bust);
  const bp = at(BUST.sx, BUST.sy, BUST.z); const bScale = BUST.hf * uph(BUST.z) / 3.4;
  const HU = ctx.uHero ? ctx.uHero.value : new THREE.Vector4(0.64, 0.6, 0.2, 0.25);
  bust.scale.setScalar(bScale); bust.position.set(lx(bp.x), bp.y, bp.z);
  const bustC = bust.position.clone();

  // ---- columns (8)
  const lathe = []; for (const [r, y] of [[0.62, -2.05], [0.62, -1.9], [0.44, -1.78], [0.34, -1.6], [0.31, 0.5], [0.3, 1.6], [0.42, 1.75], [0.62, 1.88], [0.62, 2.05]]) lathe.push(new THREE.Vector2(r, y));
  const cg0 = new THREE.LatheGeometry(lathe, 20);
  // colonnade flanking the eye: [side * lateral (eye radii), floor-depth ratio, view depth, _]; nearer rows sit lower, taller and further out
  const CP = [[-1.5, 0.5, 400], [1.5, 0.5, 400], [-1.5, 0.75, 330], [1.5, 0.75, 330], [-1.5, 1.0, 260], [1.5, 1.0, 260], [-1.5, 1.35, 200], [1.5, 1.35, 200]];
  const mkInst = (base, n, attrs) => { const g = new THREE.InstancedBufferGeometry(); g.index = base.index; for (const k in base.attributes) g.setAttribute(k, base.attributes[k]); g.instanceCount = n;
    for (const [name, arr] of Object.entries(attrs)) g.setAttribute(name, new THREE.InstancedBufferAttribute(arr, 4)); return ctx.track(g); };
  const cA = new Float32Array(32), cB = new Float32Array(32);
  CP.forEach(([lat, dd, z], i) => { cA.set([lat, dd, z, 1], i * 4); cB.set([(rnd() - 0.5) * 0.1, rnd() * 6.28, i / 8, rnd() < 0.5 ? 1 : -1], i * 4); });
  const colMesh = new THREE.Mesh(mkInst(cg0, 8, { iA: cA, iB: cB }), mk(S.COL_VS, S.COL_FS, {}, { depth: true })); colMesh.frustumCulled = false; colMesh.renderOrder = 1; root.add(colMesh);

  // ---- windows (24) + palms (10), one shader program (uKind)
  const atl = ctx.track(atlas(THREE));
  const qg = new THREE.PlaneGeometry(1, 1, 1, 10); qg.translate(0, 0.5, 0);
  const wA = new Float32Array(96), wB = new Float32Array(96);
  for (let i = 0; i < 24; i++) {   // satellites on the eye-wall: [angle, ring radius, -view depth, screen height] [aspect, seed, delay, period]
    const top = i % 3 !== 2, ang = top ? (30 + rnd() * 120) * Math.PI / 180 : (-60 + rnd() * 30) * Math.PI / 180, z = -(190 + rnd() * 130);
    wA.set([ang, 1.9 + rnd() * 0.4, z, (0.07 + rnd() * 0.05) * 1.25], i * 4); wB.set([0.72, rnd(), i / 24, 11 + rnd() * 10], i * 4);
  }
  const wMesh = new THREE.Mesh(mkInst(qg, 24, { iA: wA, iB: wB }), mk(S.QUAD_VS, S.QUAD_FS, { uKind: { value: 0 }, uAtlas: { value: atl } })); wMesh.frustumCulled = false; wMesh.renderOrder = 2; root.add(wMesh);
  const pA = new Float32Array(40), pB = new Float32Array(40);
  for (let i = 0; i < 10; i++) {
    const z = -230 - rnd() * 120, sx = 0.94 + rnd() * 0.1, w = at(sx, 0.17 + rnd() * 0.1, z);
    pA.set([lx(w.x), w.y, w.z, (0.36 + rnd() * 0.28) * uph(z)], i * 4); pB.set([1, rnd(), i / 10, 0], i * 4);
  }
  const pMesh = new THREE.Mesh(mkInst(qg, 10, { iA: pA, iB: pB }), mk(S.QUAD_VS, S.QUAD_FS, { uKind: { value: 1 }, uAtlas: { value: atl } })); pMesh.frustumCulled = false; pMesh.renderOrder = 3; root.add(pMesh);

  // ---- orbiting wire polyhedra (2 draws x 10)
  const polyMk = (geo, n, seed) => {
    const oA = new Float32Array(n * 4), oB = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const j = i + seed; oA.set([(30 + rnd() * 20), (0.35 + rnd() * 0.6) * (rnd() < 0.5 ? 1 : -1), rnd() * 6.28, rnd() * 3.1], i * 4); oB.set([(5 + rnd() * 5), rnd(), j / 20, rnd()], i * 4); }
    const m = new THREE.Mesh(mkInst(withBary(THREE, geo), n, { iO: oA, iP: oB }), mk(S.POLY_VS, S.POLY_FS, { uC: { value: bustC } }, { add: true })); m.frustumCulled = false; m.renderOrder = 4; root.add(m); return m;
  };
  const polyA = polyMk(new THREE.IcosahedronGeometry(1, 0), 10, 0), polyB = polyMk(new THREE.OctahedronGeometry(1.1, 0), 10, 10);

  // ---- stars / sparkles (2k points)
  const NS = 2000, sp = new Float32Array(NS * 3), sa = new Float32Array(NS * 4);
  const sl = at(-0.1, 0.28, -450), sr = at(1.1, 1.05, -450), bw = sr.x - sl.x, bh = sr.y - sl.y;
  for (let i = 0; i < NS; i++) { const k = rnd(); sp.set([lxs(sl.x + rnd() * bw), sl.y + Math.sqrt(rnd()) * bh, -450], i * 3); sa.set([k > 0.97 ? 5 : 1.5 + rnd() * 2, rnd(), k, 0.3 + rnd() * 0.7], i * 4); }
  const pg = ctx.track(new THREE.BufferGeometry()); pg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); pg.setAttribute('aS', new THREE.BufferAttribute(sa, 4));
  const stars = new THREE.Points(pg, mk(S.STAR_VS, S.STAR_FS, { uBox: { value: new THREE.Vector3(bw, bh, 0) } }, { add: true })); stars.frustumCulled = false; sroot.add(stars);

  // ---- state
  const st = { mode: 'live', t: 0, dur: 1 }, v2 = new THREE.Vector3(); let sunPh = 0, wvAge = 9, k = 1, flare = 0, punch = 0, orb = 0, ph = 0, ripAge = 99, ripStr = 0, q = ctx.quality ?? 2;
  const rotY = { v: 0 };
  const api = {
    grade: { bloom: 0.8, bloomThreshold: 0.72, bloomRadius: 0.6, tint: new THREE.Color(1, 0.88, 1), tintAmt: 0.05, sat: 1.05, contrast: 1.05, ca: 0.0012, grain: 0.04, vignette: 0.3, scan: 0.1 },
    cameraBias: { orbitScale: 0.95, bob: 1.05 },
    update(dt, t, info) {
      const al = ctx.alert.value; const sp_ = (1 + 0.4 * al) * (0.6 + 0.4 * k);
      ph += dt * sp_; if (ph > 3600) ph -= 3600; U.uP.value = ph;
      const en = ctx.uStory ? ctx.uStory.value.y : 0.35, dirS = ctx.uStory ? ctx.uStory.value.x : 0;
      orb += dt * sp_ * (0.5 + 1.1 * en) * (1 + punch * 3); punch = Math.max(0, punch - dt * 1.5); U.uOrb.value = orb;
      sunPh += dt * (0.05 + 0.3 * en) * (dirS < -0.3 ? -1 : 1) * (Math.abs(dirS) > 0.3 ? 1 : 0.3); U.uSunPh.value = sunPh;
      wvAge += dt; U.uWv.value.x = wvAge; if (wvAge > 1.6) U.uWv.value.y = 0;
      flare = Math.max(0, flare - dt * 1.3); U.uFlare.value = flare; ripAge += dt; U.uRip.value.y = ripAge;
      if (st.mode !== 'live') { st.t += dt; const p = Math.min(1, st.t / st.dur);
        if (st.mode === 'enter') { U.uBuild.value = p; U.uBreak.value = 0; U.uFloor.value = ease(p * 1.1); } else { U.uBuild.value = 1; U.uBreak.value = p; U.uFloor.value = 1 - ease(p * 1.1); }
        if (p >= 1) st.mode = st.mode === 'enter' ? 'live' : 'gone'; }
      else { U.uBuild.value = 1; U.uBreak.value = 0; U.uFloor.value = 1; }
      sync(info && info.par);
      // the bust stands to one side of the widget, turned three-quarters toward it, swaying gently
      const bx = Math.min(0.93, HU.x + HU.z * 1.3), by = Math.max(0.3, Math.min(0.8, HU.y + HU.w * 0.15));
      const tp = at(bx, by, BUST.z); bustC.set(tp.x, tp.y, tp.z); bust.position.x += (bustC.x - bust.position.x) * Math.min(1, dt * 3);
      const face = bx > HU.x ? -0.85 : 0.85;
      rotY.v += dt * 0.38 * sp_ * (1 + flare) * 0.3; bust.rotation.y = face + Math.sin(rotY.v * 1.4) * 0.22 + flare * Math.sin(ph * 6) * 0.15;
      bust.position.y = bustC.y + Math.sin(ph * 0.7) * 3.2;
      if (info && info.par) U.uPar.value.set(info.par.x * 0.0008, 0);
    },
    setIntensity(a) { k = a; },
    enter(dur) { st.mode = 'enter'; st.t = 0; st.dur = Math.max(0.2, dur); },
    exit(dur) { st.mode = 'exit'; st.t = 0; st.dur = Math.max(0.2, dur); },
    ripple(o) {
      let sx = 0.7; if (o && o.screen) sx = o.screen.x; else if (o) { v2.set(o.x || 0, 0, o.z || 0).project(cam); sx = Math.min(1, Math.max(0, v2.x * 0.5 + 0.5)); }
      const s = o && o.strength != null ? o.strength : 1; ripAge = 0; U.uRip.value.set(sx, 0, 0.5 + 0.5 * s, 0);
      if (o && o.color && o.color.isColor) U.uRipCol.value.copy(o.color); else U.uRipCol.value.copy(ctx.accent2.value);
      flare = Math.max(flare, 0.4 + 0.6 * s); punch = Math.max(punch, s);
    },
    shockwave(x, z, color) { api.ripple({ x, z, color, strength: 1 }); },
    event(type, d) {
      if (type !== 'heroPulse' || !d || (d.strength ?? 1) < 0.3 || d.type === 'beat') return;
      wvAge = 0; U.uWv.value.set(0, Math.min(1, d.strength ?? 1)); flare = Math.max(flare, 0.5 * (d.strength ?? 1));   // floor ring wave + bust flare
    },
    setQuality(v) {
      q = v; const f = v >= 2 ? 1 : 0.5; wMesh.geometry.instanceCount = v === 0 ? 0 : Math.round(24 * f); wMesh.visible = v > 0;
      pMesh.visible = v > 0; pMesh.geometry.instanceCount = v > 0 ? 10 : 0; stars.visible = v >= 2;
    },
    morphPoints(out, n) {
      sync(null); const M = root.matrixWorld, V3 = new THREE.Vector3();
      const P = bg.attributes.position.array, nt = P.length / 9, cy = Math.cos(rotY.v), sy = Math.sin(rotY.v), s = bScale;
      for (let i = 0; i < n; i++) {
        const r = i / n; let x, y, z;
        if (r < 0.55) { const t = (Math.random() * nt | 0) * 9; const a = Math.random(), b = Math.random() * (1 - a), c = 1 - a - b;
          const lxp = P[t] * a + P[t + 3] * b + P[t + 6] * c, lyp = P[t + 1] * a + P[t + 4] * b + P[t + 7] * c, lzp = P[t + 2] * a + P[t + 5] * b + P[t + 8] * c;
          x = bust.position.x + (lxp * cy + lzp * sy) * s; y = bust.position.y + lyp * s; z = bust.position.z + (-lxp * sy + lzp * cy) * s; }
        else if (r < 0.8) { const j = (Math.random() * 8 | 0) * 4, dd = cA[j + 1], span = Math.max(0.06, 0.47 - (HU.y - HU.w * 0.93) * 0.45 - 0.0);
          const sx = HU.x + cA[j] * HU.z * dd, sy = Math.min(0.95, HU.y - HU.w * 0.93 + Math.random() * 4.4 * dd * 0.17); const w = at(sx, sy, -cA[j + 2]); x = w.x; y = w.y; z = w.z; }
        else { const j = (Math.random() * 24 | 0) * 4, a = wA[j] + (Math.random() - 0.5) * 0.4, w = at(Math.min(0.95, Math.max(0.34, HU.x + Math.cos(a) * HU.z * wA[j + 1])), Math.min(0.9, Math.max(0.08, HU.y + Math.sin(a) * HU.w * wA[j + 1])), wA[j + 2]); x = w.x; y = w.y; z = w.z; }
        V3.set(x, y, z).applyMatrix4(M); out[i * 3] = V3.x; out[i * 3 + 1] = V3.y; out[i * 3 + 2] = V3.z;
      }
      return true;
    },
    dispose() {},
  };
  api.setQuality(q);
  return api;
}
