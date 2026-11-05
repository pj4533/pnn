// megacity: Neon Megacity Flyover. A Blade Runner night skyline seen from a slow glide above the rooftops:
// ~2.5k instanced towers with flickering window grids and neon roof outlines, canyon light-rivers on the street
// floor, far arcology silhouettes in a smoggy violet/orange sky, 5 sweeping searchlights, 1.5k flying cars on 3
// sky lanes, 6 floating holo-ad panels (abstract shapes only) and diagonal foreground rain.
// Draw calls: sky, towers(+ground slab as instance 0), cars, beams, rain, ads = 6. Programs: 6.
import * as THREE from '../../../vendor/three/three.module.js';
import * as S from './megacity.glsl.js';

const GROUND = -250, ZNEAR = 250, SPAN = 2700, CELL = 30, X0 = -900, COLS = 61, ROWS = 90;
const CANYONS = [-230, 250];
const N_TOWER = [1000, 1500, 2500], N_CAR = [600, 1000, 1500], N_RAIN = [0, 2000, 4000], N_BEAM = [2, 5, 5];
const MAX_TOWER = 2500, MAX_CAR = 1500, MAX_RAIN = 4000;

// Merge ctx.GLSL chunks into one fragment prefix: COMMON first, then any other chunk whose functions aren't
// defined yet (uniform lines already declared are stripped), then local fallbacks for anything still missing.
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
  return s;
}

export function create(ctx) {
  const { stage, rnd } = ctx;
  const track = ctx.track || ((o) => o);
  const FP = fragPrefix(ctx.GLSL || {}) + S.HEAD_F;
  const U = {
    uFogA: { value: new THREE.Color(0.02, 0.006, 0.038) }, uFogB: { value: new THREE.Color(0.085, 0.024, 0.032) },
    uHz: { value: 0.8 }, uBuild: { value: 1 }, uSink: { value: 0 }, uTravel: { value: 0 },
    uRip: { value: new THREE.Vector4(0, 0, 99, 0) }, uRipCol: { value: new THREE.Color('#00f0ff') }, uBrake: { value: 0 },
    uCarPh: { value: 0 }, uRainPh: { value: 0 }, uSnap: { value: 0 }, uOrbT: { value: 0 }, uFlowT: { value: 0 }, uWave: { value: new THREE.Vector2(9, 0) }, uPar: { value: new THREE.Vector2() }, uOct: { value: 3 }, uRootX: { value: 0 },
  };
  const mat = (vs, fs, o = {}) => track(new THREE.ShaderMaterial({
    uniforms: { ...ctx.common(), ...U }, vertexShader: S.HEAD_V + vs, fragmentShader: FP + fs, ...o,
  }));
  const glow = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };

  const city = new THREE.Group(); const sky = new THREE.Group();
  stage.add(city, sky);

  // ---------- sky backdrop ----------
  const skyMat = mat(S.V_SKY, S.F_SKY, { depthTest: false, depthWrite: false });
  if (ctx.backdrop) ctx.backdrop(skyMat);

  // ---------- towers (instance 0 is the ground slab) ----------
  const cells = [];
  for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) {
    if (i % 5 === 0 || j % 5 === 0) continue;
    const x = X0 + i * CELL;
    if (CANYONS.some((c) => Math.abs(x - c) < 50)) continue;
    cells.push(i, j);
  }
  const nc = cells.length / 2;
  for (let k = nc - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [cells[2 * k], cells[2 * r]] = [cells[2 * r], cells[2 * k]]; [cells[2 * k + 1], cells[2 * r + 1]] = [cells[2 * r + 1], cells[2 * k + 1]]; }
  const NT = Math.min(MAX_TOWER, nc);
  const box = track(new THREE.BoxGeometry(1, 1, 1)); box.translate(0, 0.5, 0);
  const tg = track(new THREE.InstancedBufferGeometry());
  tg.index = box.index; for (const a of ['position', 'normal']) tg.setAttribute(a, box.getAttribute(a));
  const aBase = new Float32Array((NT + 1) * 4), aPar = new Float32Array((NT + 1) * 4);
  aBase.set([0, (ZNEAR + ZNEAR - SPAN) / 2, 2600, SPAN + 400]); aPar.set([1, 0, -1, 0]);
  for (let k = 0; k < NT; k++) {
    const i = cells[2 * k], j = cells[2 * k + 1], o = (k + 1) * 4;
    const x = X0 + i * CELL + (rnd() - 0.5) * 5, z = ZNEAR - j * CELL - (rnd() - 0.5) * 5;
    const dc = Math.min(...CANYONS.map((c) => Math.abs(x - c)));
    let h = (22 + 75 * Math.pow(rnd(), 2.2)) * (0.75 + 0.7 * Math.exp(-dc / 110)) * (0.7 + 0.5 * Math.min(1, Math.abs(x) / 700));
    if (rnd() < 0.05) h = 140 + rnd() * 30;
    aBase[o] = x; aBase[o + 1] = z; aBase[o + 2] = 13 + rnd() * 13; aBase[o + 3] = 13 + rnd() * 13;
    aPar[o] = Math.min(170, h); aPar[o + 1] = rnd(); aPar[o + 2] = rnd();
    aPar[o + 3] = 0.75 * Math.min(1, Math.hypot(x, z + 700) / 1500) + 0.25 * rnd();
  }
  tg.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 4));
  tg.setAttribute('aPar', new THREE.InstancedBufferAttribute(aPar, 4));
  const towers = new THREE.Mesh(tg, mat(S.V_TOWER, S.F_TOWER));
  towers.frustumCulled = false; city.add(towers);

  // ---------- flying cars ----------
  const quad = track(new THREE.PlaneGeometry(1, 1));
  const cg = track(new THREE.InstancedBufferGeometry());
  cg.index = quad.index; cg.setAttribute('position', quad.getAttribute('position'));
  const aCar = new Float32Array(MAX_CAR * 4), aCar2 = new Float32Array(MAX_CAR * 4);
  for (let i = 0; i < MAX_CAR; i++) {
    const o = i * 4;
    aCar[o] = rnd(); aCar[o + 1] = i % 3; aCar[o + 2] = (i >> 1) % 2 ? 1 : -1; aCar[o + 3] = 60 + 10 * Math.floor(rnd() * 7);
    aCar2[o] = 7 + rnd() * 12; aCar2[o + 1] = rnd(); aCar2[o + 2] = rnd(); aCar2[o + 3] = (rnd() - 0.5) * 0.6;
  }
  cg.setAttribute('aCar', new THREE.InstancedBufferAttribute(aCar, 4));
  cg.setAttribute('aCar2', new THREE.InstancedBufferAttribute(aCar2, 4));
  const cars = new THREE.Mesh(cg, mat(S.V_CAR, S.F_CAR, { ...glow, side: THREE.DoubleSide }));
  cars.frustumCulled = false; cars.renderOrder = 3; sky.add(cars);

  // ---------- searchlights ----------
  const cyl = track(new THREE.CylinderGeometry(1, 0.03, 1, 22, 1, true)); cyl.translate(0, 0.5, 0);
  const bg = track(new THREE.InstancedBufferGeometry());
  bg.index = cyl.index; for (const a of ['position', 'normal']) bg.setAttribute(a, cyl.getAttribute(a));
  // [x, y, z, stagger] [period s, phase, tilt, length]; the 2 kept at q0 come first (one each side)
  const BEAMS = [[-560, -160, -950, 0.0, 9.0, 0.0, 0.45, 1500], [460, -160, -1050, 0.3, 10.5, 2.1, 0.5, 1500],
    [-820, -150, -1400, 0.6, 7.4, 4.0, 0.4, 1700], [700, -150, -1500, 0.8, 8.3, 1.0, 0.42, 1700], [-330, -170, -1900, 1.0, 11.0, 3.3, 0.55, 1800]];
  const aL = new Float32Array(20), aL2 = new Float32Array(20);
  BEAMS.forEach((b, i) => { aL.set(b.slice(0, 4), i * 4); aL2.set(b.slice(4), i * 4); });
  bg.setAttribute('aL', new THREE.InstancedBufferAttribute(aL, 4));
  bg.setAttribute('aL2', new THREE.InstancedBufferAttribute(aL2, 4));
  const beams = new THREE.Mesh(bg, mat(S.V_BEAM, S.F_BEAM, { ...glow, side: THREE.DoubleSide }));
  beams.frustumCulled = false; beams.renderOrder = 2; city.add(beams);

  // ---------- rain ----------
  const rg = track(new THREE.BufferGeometry());
  const rp = new Float32Array(MAX_RAIN * 2 * 3), re = new Float32Array(MAX_RAIN * 2);
  for (let i = 0; i < MAX_RAIN; i++) {
    const x = rnd(), y = rnd(), z = rnd();
    rp.set([x, y, z, x, y, z], i * 6); re[i * 2 + 1] = 1;
  }
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
  const rain = new THREE.LineSegments(rg, mat(S.V_RAIN, S.F_RAIN, glow));
  rain.frustumCulled = false; rain.renderOrder = 5; stage.add(rain);

  // ---------- holo ad panels ----------
  const ag = track(new THREE.InstancedBufferGeometry());
  ag.index = quad.index; ag.setAttribute('position', quad.getAttribute('position'));
  // satellites on the eye-wall ellipse: [angle (rad), ring radius (widget radii), depth factor behind the widget, type] [height (screen fraction), aspect, seed, _]
  const D = Math.PI / 180;
  const ADS = [[22 * D, 1.55, 1.25, 0, 0.2, 0.5, 0.1], [62 * D, 1.6, 1.6, 1, 0.16, 1.7, 0.5], [98 * D, 1.62, 2.1, 2, 0.24, 0.7, 0.9],
    [-28 * D, 1.55, 1.15, 1, 0.19, 0.55, 0.3], [140 * D, 1.6, 1.8, 0, 0.17, 1.4, 0.7], [-62 * D, 1.6, 1.4, 2, 0.14, 0.62, 0.2]];
  const aA = new Float32Array(24), aA2 = new Float32Array(24);
  ADS.forEach((a, i) => { aA.set(a.slice(0, 4), i * 4); aA2.set([...a.slice(4), 0], i * 4); });
  ag.setAttribute('aA', new THREE.InstancedBufferAttribute(aA, 4));
  ag.setAttribute('aA2', new THREE.InstancedBufferAttribute(aA2, 4));
  const ads = new THREE.Mesh(ag, mat(S.V_AD, S.F_AD, glow));
  ads.frustumCulled = false; ads.renderOrder = 4; sky.add(ads);

  // ---------- state ----------
  let k = 1, enterT = -1, enterDur = 1, exitT = -1, exitDur = 1;
  const _v = new THREE.Vector3();
  const red = new THREE.Color(1, 0.12, 0.08);

  function setQuality(q) {
    q = Math.max(0, Math.min(2, q | 0));
    tg.instanceCount = 1 + Math.min(NT, N_TOWER[q]);
    cg.instanceCount = N_CAR[q]; bg.instanceCount = N_BEAM[q]; ag.instanceCount = 6;
    rg.setDrawRange(0, N_RAIN[q] * 2);
    U.uOct.value = q + 2;
  }
  setQuality(ctx.quality ?? 2);

  function ripple(o = {}) {
    const s = o.strength ?? 1;
    // a weak story beat never stomps a stronger front that is still travelling
    if (U.uRip.value.z < 1.2 && U.uRip.value.w * Math.exp(-U.uRip.value.z * 0.55) > s) return;
    U.uRip.value.set(o.x ?? 0, o.z ?? 0, 0, s);
    if (o.color) U.uRipCol.value.copy(o.color); else U.uRipCol.value.copy(ctx.accent2?.value || U.uRipCol.value);
  }

  return {
    update(dt, t, info = {}) {
      const cam = info.camera || ctx.camera;
      const al = ctx.alert ? ctx.alert.value : 0, sp = 1 + 0.4 * al;
      if (enterT >= 0) { enterT += dt; U.uBuild.value = Math.min(1, enterT / enterDur); if (enterT >= enterDur) enterT = -1; }
      if (exitT >= 0) { exitT += dt; U.uSink.value = Math.min(1, exitT / exitDur); if (exitT >= exitDur) exitT = -1; }
      U.uTravel.value = (U.uTravel.value + dt * 24 * sp) % SPAN;
      U.uCarPh.value = (U.uCarPh.value + dt * sp) % 320;
      U.uRainPh.value = (U.uRainPh.value + dt * 380 * sp) % 3200;
      // projector stage: the current story sets orbit / flow speed; pulses decay here
      const en = ctx.uStory ? ctx.uStory.value.y : 0.3;
      U.uOrbT.value += dt * (0.5 + 1.5 * en) * sp; U.uFlowT.value += dt * 3 * (0.75 + 0.9 * en) * sp;
      U.uSnap.value = Math.max(0, U.uSnap.value - dt / 0.6);
      U.uWave.value.x += dt; if (U.uWave.value.x > 1.6) U.uWave.value.y = 0;
      U.uRip.value.z = Math.min(99, U.uRip.value.z + dt);
      U.uBrake.value = Math.min(1, U.uRip.value.w * 1.2) * Math.exp(-U.uRip.value.z * 1.3);
      const cx = cam.position.x;
      city.position.x = sky.position.x = cx * 0.85; U.uRootX.value = city.position.x;
      sky.position.y = cam.position.y * 0.7;
      if (info.par) U.uPar.value.set(info.par.x * 0.002, info.par.y * 0.002);
      cam.updateMatrixWorld();
      _v.set(cx, cam.position.y, cam.position.z - 5000).project(cam);
      U.uHz.value = Math.min(1.2, Math.max(-0.2, _v.y * 0.5 + 0.5));
    },
    setIntensity(a) { k = Math.max(0, Math.min(1, a)); if (ctx.fade) ctx.fade.value = k; },
    enter(dur = 2.5) { enterDur = Math.max(0.1, dur); enterT = 0; exitT = -1; U.uBuild.value = 0; U.uSink.value = 0; },
    exit(dur = 2) { exitDur = Math.max(0.1, dur); exitT = 0; },
    ripple,
    shockwave(x, z, color) { ripple({ x, z, color: color || red, strength: 1 }); },
    event(type, data) {
      if (type === 'alert') ripple({ x: data?.x ?? 0, z: data?.z ?? 0, color: red, strength: 1 });
      else if (type === 'heroPulse' && data) {
        const st = Math.min(1, data.strength ?? 1);
        // searchlights snap onto the widget for ~0.6 s; a window-grid wave rolls outward from the plaza
        if (data.type !== 'beat' && st >= 0.3) U.uSnap.value = Math.max(U.uSnap.value, Math.min(1, st + 0.2));
        if (st >= 0.3) U.uWave.value.set(0, Math.max(U.uWave.value.y * 0.5, st));
      }
    },
    setQuality,
    morphPoints(out, n) {
      // sample the visible towers' facades and roof outlines in their current (wrapped, risen) world position
      const cnt = tg.instanceCount - 1, tr = U.uTravel.value, b = U.uBuild.value;
      let i = 0, guard = 0;
      while (i < n && guard++ < n * 4) {
        const t = 1 + Math.floor(Math.random() * cnt), o = t * 4;
        const z = ZNEAR - SPAN + ((((aBase[o + 1] - (ZNEAR - SPAN) + tr) % SPAN) + SPAN) % SPAN);
        if (z < -1400 || z > 100) continue;
        const rise = Math.min(1, Math.max(0, (b * 1.7 - aPar[o + 3]) / 0.7)), h = aPar[o] * Math.max(0.02, 1 - Math.pow(1 - rise, 3));
        const top = Math.random() < 0.4;
        out[i * 3] = city.position.x + aBase[o] + (Math.random() - 0.5) * aBase[o + 2];
        out[i * 3 + 1] = GROUND + (top ? h : Math.random() * h);
        out[i * 3 + 2] = z + (top ? (Math.random() - 0.5) * aBase[o + 3] : aBase[o + 3] * 0.5);
        i++;
      }
      return i === n;
    },
    grade: { bloom: 0.8, bloomThreshold: 0.7, bloomRadius: 0.55, tint: new THREE.Color(1, 0.82, 1), tintAmt: 0.06, sat: 1.12, contrast: 1.08, ca: 1.1, grain: 1.15, vignette: 1.15, scan: 1.1 },
    cameraBias: { orbitScale: 0.9, bob: 0.85 },
    dispose() { city.removeFromParent(); sky.removeFromParent(); rain.removeFromParent(); },
  };
}
