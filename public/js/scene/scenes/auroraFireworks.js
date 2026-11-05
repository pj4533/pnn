// auroraFireworks: Midnight Aurora. Seven stacked aurora curtains over a black mirror-water plane with a faint skyline,
// 64 meteors, and a pool of 12 firework shells (400 points each) that launch from the far left/right edges and are
// mirrored in the water. Calm, dreamy. All layers are screen-space (uv) so station flights only add gentle parallax.
// Draws: backdrop(sky+stars+moon+skyline+water), curtains(instanced), meteors, fireworks, fireworks-mirror = 5.
import * as THREE from '../../../vendor/three/three.module.js';
import * as S from './auroraFireworks.glsl.js';

const NB = 12, NP = 400, NM = 64, NC = 7;
const QB = [4, 8, 12], QC = [3, 5, 7], QM = [32, 48, 64];
const PAL = [[1, .2, .8], [.1, .9, 1], [1, .7, .2], [.6, .3, 1], [1, .35, .5], [.3, 1, .8]];
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const sstep = (a, b, x) => ease((x - a) / (b - a));

// Merge ctx.GLSL chunks into one fragment prefix (COMMON first, fallbacks for anything missing).
function fragPrefix(G) {
  let s = typeof G.COMMON === 'string' ? G.COMMON + '\n' : '';
  const defined = (fn) => new RegExp(`\\b(?:float|vec[234]|void)\\s+${fn}\\s*\\(`).test(s);
  const declared = (u) => new RegExp(`uniform\\s+[^;]*\\b${u}\\b`).test(s);
  for (const k of Object.keys(G)) {
    const c = G[k];
    if (k === 'COMMON' || typeof c !== 'string') continue;
    const fns = [...c.matchAll(/\b(?:float|vec[234]|void)\s+(\w+)\s*\(/g)].map((m) => m[1]);
    if (!fns.length || fns.some(defined)) continue;
    s += c.split(/(?<=;)/).filter((l) => { const m = l.match(/uniform\s+\w+\s+(\w+)/); return !m || !declared(m[1]); }).join('') + '\n';
  }
  const U = { uTime: 'float', uAlert: 'float', uPulse: 'float', uFade: 'float', uAccent: 'vec3', uAccent2: 'vec3', uRes: 'vec2', uGuardRect: 'vec4', uGuardAmt: 'float', uNoise: 'sampler2D' };
  let head = '';
  for (const [u, t] of Object.entries(U)) if (!declared(u)) head += `uniform ${t} ${u};\n`;
  s = head + s;
  if (!defined('guard')) s += 'float guard(){ vec2 q=gl_FragCoord.xy/uRes; vec2 m=smoothstep(uGuardRect.xy-0.08,uGuardRect.xy,q)*(1.-smoothstep(uGuardRect.zw,uGuardRect.zw+0.08,q)); return 1.-uGuardAmt*m.x*m.y; }\n';
  if (!defined('alertMix')) s += 'vec3 alertMix(vec3 c){ float l=dot(c,vec3(.2126,.7152,.0722)); vec3 r=mix(vec3(1.,.07,.03),vec3(1.,.5,.1),clamp(l*.6,0.,1.))*l*1.5; return mix(c,r,uAlert); }\n';
  if (!defined('finish')) s += 'vec3 finish(vec3 c){ return alertMix(c)*guard()*uFade; }\n';
  if (!defined('vnoise')) s += 'float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); vec2 o=vec2(37.,17.)*i.z; vec2 uv=(i.xy+o+f.xy+.5)/256.; vec2 rg=texture2D(uNoise,uv).yx; return mix(rg.x,rg.y,f.z); }\n';
  return s;
}

export function create(ctx) {
  const { stage, rnd } = ctx;
  const track = ctx.track || ((o) => o);
  const FP = fragPrefix(ctx.GLSL || {});
  const uni = ctx.common();
  const B0 = [], B1 = [], B2 = [];
  for (let i = 0; i < NB; i++) { B0.push(new THREE.Vector4(.5, .6, 99, 0)); B1.push(new THREE.Vector4(1, 1, 1, .2)); B2.push(new THREE.Vector4(1, 1, 1, .5)); }
  const U = {
    uT: { value: 0 }, uEnter: { value: 1 }, uExit: { value: 0 }, uStars: { value: 1 }, uAur: { value: 1 },
    uRip: { value: new THREE.Vector4(.64, .13, 99, 0) }, uPar: { value: new THREE.Vector2() },
    uSh: { value: new THREE.Vector4(0, -1, 0, 0) },
    uB0: { value: B0 }, uB1: { value: B1 }, uB2: { value: B2 },
  };
  const mk = (vs, fs, extra, o = {}) => track(new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: FP + fs, uniforms: { ...uni, ...U, ...extra },
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, ...o,
  }));

  // backdrop
  const back = mk(S.BACK_VS, S.BACK_FS(''), {}, { transparent: false, blending: THREE.NoBlending });
  ctx.backdrop(back);

  // aurora curtains (one instanced 128x16 strip)
  const pg = new THREE.PlaneGeometry(1, 1, 128, 16);
  const ag = track(new THREE.InstancedBufferGeometry());
  ag.index = pg.index; ag.setAttribute('position', pg.attributes.position);
  const ac = new Float32Array(NC * 4);
  // far curtains sit higher and smaller; all bases >= 0.70
  const bases = [.70, .72, .75, .73, .78, .76, .81], hts = [.26, .22, .2, .24, .17, .2, .15];
  for (let i = 0; i < NC; i++) ac.set([i, bases[i] + (rnd() - .5) * .01, hts[i], rnd()], i * 4);
  ag.setAttribute('aC', new THREE.InstancedBufferAttribute(ac, 4)); ag.instanceCount = NC;
  const aur = new THREE.Mesh(ag, mk(S.AUR_VS, S.AUR_FS(''), {}, { side: THREE.DoubleSide }));
  aur.frustumCulled = false; aur.renderOrder = 1; stage.add(aur);

  // meteors
  const qg = track(new THREE.InstancedBufferGeometry());
  qg.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, -.5, 1, 0, .5, 1, 0], 3)); qg.setIndex([0, 1, 2, 2, 1, 3]);
  const am = new Float32Array(NM * 4);
  for (let i = 0; i < NM; i++) am.set([(i + rnd() * .8) / NM, rnd(), rnd(), rnd()], i * 4);
  qg.setAttribute('aM', new THREE.InstancedBufferAttribute(am, 4)); qg.instanceCount = NM;
  const met = new THREE.Mesh(qg, mk(S.MET_VS, S.MET_FS(''))); met.frustumCulled = false; met.renderOrder = 2; stage.add(met);

  // fireworks (+ mirror), shared geometry
  const fg = track(new THREE.BufferGeometry());
  const pos = new Float32Array(NB * NP * 3), ad = new Float32Array(NB * NP * 4), ai = new Float32Array(NB * NP * 3);
  for (let b = 0; b < NB; b++) for (let p = 0; p < NP; p++) {
    const j = b * NP + p;
    // uniform sphere directions
    const z = rnd() * 2 - 1, th = rnd() * 6.2832, r = Math.sqrt(1 - z * z);
    ad.set([r * Math.cos(th), r * Math.sin(th), z, rnd()], j * 4);
    ai.set([b, p < 16 ? p / 16 : -1, 0], j * 3);
  }
  fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fg.setAttribute('aD', new THREE.BufferAttribute(ad, 4)); fg.setAttribute('aI', new THREE.BufferAttribute(ai, 3));
  fg.setDrawRange(0, NB * NP);
  const fwMat = mk(S.FW_VS, S.FW_FS(''), { uMirror: { value: 0 } });
  const fwMir = mk(S.FW_VS, S.FW_FS(''), { uMirror: { value: 1 } });
  const fw = new THREE.Points(fg, fwMat), fwm = new THREE.Points(fg, fwMir);
  for (const m of [fw, fwm]) { m.frustumCulled = false; stage.add(m); }
  fw.renderOrder = 4; fwm.renderOrder = 3;

  const Sx = {
    k: 1, nb: NB, next: 0, cd: 2.2, T: 0, spin: 0, enterT: -1, enterD: 1, exitT: -1, exitD: 1, lastRip: -9, ripCount: 0, q: ctx.quality,
    rc: new THREE.Color(1, .3, .6), hasRc: false,
  };

  // slot = next pool entry; side -1 left / +1 right; delay s; sc = size scale
  function spawn(side, delay, sc, kind, col) {
    const i = Sx.next; Sx.next = (Sx.next + 1) % Sx.nb;
    const left = side < 0;
    const cx = left ? .04 + rnd() * .22 : .93 + rnd() * .035, cy = .5 + rnd() * .32;
    const R = (left ? .2 + rnd() * .08 : .1 + rnd() * .045) * sc;
    B0[i].set(cx, cy, -.85 - delay, kind >= 0 ? kind : Math.floor(rnd() * 4));
    const c1 = PAL[(rnd() * PAL.length) | 0], c2 = PAL[(rnd() * PAL.length) | 0];
    const story = rnd() < .3;
    if (col) { B1[i].set(col.r, col.g, col.b, R); B2[i].set(ctx.accent.value.r, ctx.accent.value.g, ctx.accent.value.b, left ? .03 : .97); }
    else if (story) { const a1 = ctx.accent.value, a2 = ctx.accent2.value; B1[i].set(a1.r, a1.g, a1.b, R); B2[i].set(a2.r, a2.g, a2.b, left ? .03 : .97); }
    else { B1[i].set(c1[0], c1[1], c1[2], R); B2[i].set(c2[0], c2[1], c2[2], left ? .03 : .97); }
  }
  function salvo(n, big, col) {
    let side = rnd() < .5 ? -1 : 1;
    for (let j = 0; j < n; j++) { spawn(side, j * (.25 + rnd() * .35), big ? 1.25 : 1, big && j === 0 ? 2 : -1, col); side = -side; }
  }

  function curtainUV(i, u, v, t, out) { // JS twin of AUR_VS (for morph sampling)
    const sd = ac[i * 4 + 3], ph = sd * 40, tt = t * (.6 + .25 * ((sd * 7) % 1));
    const wy = .03 * Math.sin(u * 4.2 + tt * .5 + ph) + .018 * Math.sin(u * 9.1 - tt * .8 + ph * 1.7) + .008 * Math.sin(u * 21 - tt * 1.3 + ph);
    const hh = ac[i * 4 + 2] * (.75 + .25 * Math.sin(u * 3 + tt * .35 + ph * 2));
    out[0] = -.25 + u * 1.5 + .04 * Math.sin(u * 6 + tt * .4 + ph) + v * .05 * Math.sin(u * 2 + ph);
    out[1] = ac[i * 4 + 1] + wy + v * hh;
  }

  const gradeCol = new THREE.Color(.9, .85, 1);
  const tmpUV = [0, 0], v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
  const api = {
    grade: { bloom: .95, bloomThreshold: .6, bloomRadius: .8, tint: gradeCol, tintAmt: .04, sat: 1.1, contrast: 1.05, ca: .001, grain: .05, vignette: .4, scan: .1 },
    cameraBias: { orbitScale: .85, bob: .8 },
    setIntensity(a) { Sx.k = a; },
    enter(d) { Sx.enterT = 0; Sx.enterD = Math.max(.1, d); Sx.exitT = -1; U.uExit.value = 0; U.uEnter.value = 0; U.uStars.value = 0; Sx.cd = Math.min(Sx.cd, 1.2 + d * .5); },
    exit(d) { Sx.exitT = 0; Sx.exitD = Math.max(.1, d); Sx.enterT = -1; U.uEnter.value = 1; salvo(Math.min(4, Sx.nb), true); },
    ripple(o) {
      const s = o.strength ?? 1;
      let sx = .64;
      if (o.screen) { sx = o.screen.x; if (sx < 0 || sx > 1 || o.screen.y < 0 || o.screen.y > 1) sx = sx * .5 + .5; }
      U.uRip.value.set(Math.min(.9, Math.max(.1, sx)), .12, 0, s);
      Sx.ripCount++;
      ctx.pulse.value = Math.max(ctx.pulse.value, s);
      U.uSh.value.set(s, 0, Sx.ripCount, 0);
      if (s > .7 && Sx.T - Sx.lastRip > 1.5 && Sx.exitT < 0) { Sx.lastRip = Sx.T; salvo(4, true, o.color || null); }
      else if (s <= .7 && Sx.T - Sx.lastRip > 1.5 && Sx.k > .3) { Sx.lastRip = Sx.T; spawn(rnd() < .5 ? -1 : 1, 0, 1, -1, null); }
    },
    shockwave(x, z, color) { api.ripple({ x, z, color, strength: 1, screen: null }); },
    event() {},
    setQuality(q) {
      Sx.q = q; Sx.nb = QB[q]; aur.geometry.instanceCount = QC[q]; qg.instanceCount = QM[q];
      fg.setDrawRange(0, Sx.nb * NP); Sx.next %= Sx.nb;
      for (let i = Sx.nb; i < NB; i++) B0[i].z = 99;
    },
    update(dt, t, info) {
      dt = dt > 0 ? Math.min(dt, .1) : 0; // guard against negative or huge first-frame dt
      const al = ctx.alert.value, sp = (1 + .4 * al) * (.6 + .4 * Sx.k);
      Sx.spin += dt * sp; Sx.T += dt;
      U.uT.value = Sx.spin % 3600;
      if (info && info.par) U.uPar.value.x = Math.max(-.05, Math.min(.05, info.par.x * 5e-5));
      let enterP = 1;
      if (Sx.enterT >= 0) { Sx.enterT += dt; const p = Math.min(1, Sx.enterT / Sx.enterD); enterP = ease(p); U.uEnter.value = enterP; U.uStars.value = enterP; if (p >= 1) Sx.enterT = -1; }
      let ex = 0;
      if (Sx.exitT >= 0) { Sx.exitT += dt; const p = Math.min(1, Sx.exitT / Sx.exitD); ex = sstep(.3, 1, p); U.uExit.value = ex; U.uStars.value = 1 - sstep(.55, 1, p); if (p >= 1) Sx.exitT = -1; }
      U.uAur.value = sstep(.15, .9, U.uEnter.value) * (1 - ex);
      // firework scheduling: a salvo every 5-8 s
      for (let i = 0; i < Sx.nb; i++) { const b = B0[i]; if (b.z < 90) { b.z += dt * sp; if (b.z > 6) b.z = 99; } }
      if (Sx.exitT < 0 && U.uEnter.value > .5 && Sx.k > .2) {
        Sx.cd -= dt * sp;
        if (Sx.cd <= 0) { Sx.cd = 5 + rnd() * 3; salvo(rnd() < .5 ? 2 : 3, false, null); }
      }
      const r = U.uRip.value; if (r.z < 90) { r.z += dt; if (r.z > 5) { r.z = 99; r.w = 0; } }
      const sh = U.uSh.value; if (sh.y >= 0) { sh.y += dt; if (sh.y > 3) { sh.y = -1; sh.x = 0; } }
    },
    morphPoints(out, n) {
      const cam = ctx.camera, t = U.uT.value;
      for (let k = 0; k < n; k++) {
        if (k % 5 < 4) curtainUV(((rnd() * NC) | 0) % QC[Sx.q], rnd(), Math.pow(rnd(), 1.6), t, tmpUV);
        else { tmpUV[0] = rnd(); tmpUV[1] = .4 + rnd() * .6; }
        v3.set(tmpUV[0] * 2 - 1, tmpUV[1] * 2 - 1, .5).unproject(cam);
        v3b.copy(v3).sub(cam.position).normalize().multiplyScalar(700).add(cam.position);
        out[k * 3] = v3b.x; out[k * 3 + 1] = v3b.y; out[k * 3 + 2] = v3b.z;
      }
      return true;
    },
  };
  api.setQuality(ctx.quality);
  return api;
}
