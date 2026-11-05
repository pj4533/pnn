// kaleidoTunnel: Kaleidoscope Corridor. An endless crystalline cathedral of KIFS ribs (quarter-res glow raymarch),
// flown down with a gentle roll, plus streak dust rushing past. Vanishing point sits left of the hologram.
// Draws: layer (director-rendered) + backdrop + dust points = 3.
import * as THREE from '../../../vendor/three/three.module.js';
import { FS_VERT, LAYER_FRAG, BACK_FRAG, DUST_VERT, DUST_FRAG } from './kaleidoTunnel.glsl.js';

const VP = [0.64, 0.6];     // fallback only: the vanishing point is the hero (widget) screen centre, read from uHero each frame
const STEPS = [10, 16, 22], FOLDS = [3, 3, 4], DUST = [600, 1200, 2000];   // STEPS = analytic lace slices per pixel
const PER = 4, WRAP = PER * 64;                 // fly phase wraps on a whole number of corridor bays (and dust loops)

// Build a GLSL header from ctx.GLSL, filling any helper the shared chunk does not already define.
function header(G) {
  let s = G.COMMON || '';
  if (!/float\s+guard\s*\(/.test(s)) s += '\n' + (G.GUARD || G.guard || '');
  if (!/alertMix\s*\(/.test(s)) s += '\n' + (typeof G.alertMix === 'string' ? G.alertMix : typeof G.ALERT_MIX === 'string' ? G.ALERT_MIX : `
vec3 alertMix(vec3 c){ float l = dot(c, vec3(0.299, 0.587, 0.114)); vec3 r = vec3(1.0, 0.16, 0.05) * l * 2.2;
  return mix(c, r, uAlert * 0.85); }`);
  if (!/finish\s*\(/.test(s)) s += '\n' + (typeof G.finish === 'string' ? G.finish : typeof G.FINISH === 'string' ? G.FINISH : `
vec3 finish(vec3 c){ c = alertMix(c) * guard() * uFade; return c; }`);
  if (!/uHero/.test(s)) s += `\nuniform vec4 uHero; uniform vec4 uHeroW; uniform vec4 uStory; uniform vec3 uStoryCol; uniform vec3 uStoryColA;
float rim(){ float r = length((gl_FragCoord.xy / uRes - uHero.xy) / max(uHero.zw, vec2(1e-3))); return exp(-pow(abs((r - 1.35) * 3.2), 2.0)); }\n`;
  return s + '\n';
}

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function create(ctx) {
  const rnd = ctx.rnd || Math.random;
  const H = header(ctx.GLSL || {});
  let q = ctx.quality ?? 2;

  // ---- shared virtual camera uniforms (one object per uniform, referenced by all three materials)
  const uRayOrigin = { value: new THREE.Vector3() };
  const uRayBasis = { value: new THREE.Matrix3() };
  const uVP = { value: new THREE.Vector2(VP[0], VP[1]) };

  // hero contract uniforms: shared by reference from ctx.common(); calm defaults only if the core is absent
  const base = ctx.common();
  const hd = { uHero: new THREE.Vector4(0.64, 0.6, 0.2, 0.25), uHeroW: new THREE.Vector4(0, 0, 0, 1), uStory: new THREE.Vector4(0, 0.4, 0, 0), uStoryCol: ctx.accent2.value, uStoryColA: ctx.accent.value };
  for (const k in hd) if (!base[k]) base[k] = { value: hd[k] };
  const HU = base.uHero.value, SU = base.uStory.value;
  uVP.value.set(HU.x, HU.y);

  // ---- layer: KIFS raymarch
  const LU = {
    ...base,
    uRayOrigin, uRayBasis, uVP,
    uSteps: { value: STEPS[q] }, uFolds: { value: FOLDS[q] },
    uScale: { value: 1.42 }, uSquash: { value: 0.04 }, uOver: { value: 0 }, uGlow: { value: 1 },
    uRot: { value: new THREE.Vector4(1, 0, 1, 0) }, uOff: { value: new THREE.Vector3(0.9, 1.1, 0.8) },
    uRing: { value: new THREE.Vector3(-1, 0, 2.6) }, uRingCol: { value: new THREE.Color(0, 0.9, 1) },
    uDrift: { value: 0 }, uLand: { value: 0 },
  };
  const layerMat = ctx.track(new THREE.ShaderMaterial({
    uniforms: LU, vertexShader: FS_VERT, fragmentShader: H + LAYER_FRAG,
    depthTest: false, depthWrite: false,
  }));
  const layer = ctx.layer(layerMat, { scale: 0.25 });

  // ---- backdrop: upsample + sharpen / guard-side blur
  const BU = { ...base, tLayer: { value: layer.texture }, uVP, uLayerScale: { value: 0.25 }, uSeam: { value: 0 } };
  const backMat = ctx.track(new THREE.ShaderMaterial({
    uniforms: BU, vertexShader: FS_VERT, fragmentShader: H + BACK_FRAG,
    depthTest: false, depthWrite: false,
  }));
  ctx.backdrop(backMat);

  // ---- streak dust
  const NMAX = DUST[2];
  const seeds = new Float32Array(NMAX * 4);
  for (let i = 0; i < NMAX; i++) {
    seeds[i * 4] = rnd(); seeds[i * 4 + 1] = Math.pow(rnd(), 0.6); seeds[i * 4 + 2] = rnd(); seeds[i * 4 + 3] = rnd();
  }
  const dg = ctx.track(new THREE.BufferGeometry());
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NMAX * 3), 3));
  dg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  dg.setDrawRange(0, DUST[q]);
  const DU = { ...base, uRayOrigin, uRayBasis, uVP, uFly: { value: 0 }, uSpeed: { value: 1 }, uScatter: { value: 0 }, uDustK: { value: 0 } };
  const dustMat = ctx.track(new THREE.ShaderMaterial({
    uniforms: DU, vertexShader: 'uniform vec2 uRes;\n' + DUST_VERT, fragmentShader: H + DUST_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  const dust = new THREE.Points(dg, dustMat);
  dust.frustumCulled = false; dust.renderOrder = -900;
  ctx.stage.add(dust);

  // ---- state (all scalars; zero per-frame allocation)
  const euler = new THREE.Euler(), m4 = new THREE.Matrix4();
  let k = 1, fly = 0, punch = 0, snapA = 0, snapB = 0, ringD = -1, ringAmp = 0, land = 0, dirK = 0;
  // a scene created without enter() (pinned boot) still assembles, over 2.5 s
  let mode = 'enter', mT = 0, mDur = 2.5, unfold = 0, over = 0;

  function fireRing(color, strength) {
    ringD = 1.2; ringAmp = 0.4 + 0.5 * strength;           // the ring runs down the corridor and lands on the eye-wall
    if (color) LU.uRingCol.value.copy(color); else LU.uRingCol.value.copy(ctx.accent2.value);
    snapA = (rnd() - 0.5) * 0.9 * (0.4 + strength); snapB = (rnd() - 0.5) * 0.7 * (0.4 + strength);
    punch = Math.max(punch, 0.8 * strength + 0.2);
  }

  const api = {
    update(dt, t, info) {
      const alert = ctx.alert.value;
      // choreography
      mT += dt;
      const p = Math.min(mT / mDur, 1);
      if (mode === 'enter') { unfold = ease(p); over = 0; if (p >= 1) mode = 'live'; }
      else if (mode === 'exit') { over = ease(p); }
      else { unfold = 1; over = 0; }

      // the vanishing point and roll axis ride the widget
      const kv = 1 - Math.exp(-dt * 6);
      uVP.value.x += (HU.x - uVP.value.x) * kv; uVP.value.y += (HU.y - uVP.value.y) * kv;
      const en = Math.min(1, Math.max(0, SU.y));
      dirK += (SU.x - dirK) * (1 - Math.exp(-dt * 2));      // up opens the folds and flies forward, down closes them and drifts back
      const fk = dirK >= 0 ? 1 : 1 + 1.45 * dirK;

      // flight
      punch = Math.max(0, punch - dt * 0.9);
      const speed = (2.1 + 5.5 * punch * punch + (1 - unfold) * 6 + over * 8) * (1 + 0.4 * alert) * (0.4 + 0.6 * k) * (0.7 + 0.7 * en);
      fly = (((fly + dt * speed * fk) % WRAP) + WRAP) % WRAP;
      const par = info && info.par;
      const px = par ? par.x * 0.002 : 0, py = par ? par.y * 0.002 : 0;
      uRayOrigin.value.set(Math.sin(t * 0.13) * 0.28 + px * 0.6, Math.cos(t * 0.11) * 0.18 + py * 0.4, -fly);
      const roll = Math.sin(t * 0.045) * 0.55 + Math.sin(t * 0.017) * 0.35 + over * over * 1.4;
      euler.set(Math.sin(t * 0.07) * 0.035 - py * 0.05, Math.sin(t * 0.05) * 0.05 + px * 0.06, roll, 'ZYX');
      m4.makeRotationFromEuler(euler);
      uRayBasis.value.setFromMatrix4(m4);

      // fold drift (+ ripple snap, + over-fold on exit), unfolded from 0 on enter
      snapA *= Math.exp(-dt * 1.3); snapB *= Math.exp(-dt * 1.3);
      const sp = 1 + 0.4 * alert;
      const fa = 0.8 + 0.6 * en, op = dirK * (0.4 + en);
      const A = (0.42 + 0.22 * fa * Math.sin(t * 0.031 * sp) + 0.08 * Math.sin(t * 0.11) + 0.12 * op) * unfold + snapA + over * 1.8;
      const B = (0.28 + 0.18 * fa * Math.sin(t * 0.023 * sp + 1.7) + 0.08 * op) * unfold + snapB + over * 1.1;
      LU.uRot.value.set(Math.cos(A), Math.sin(A), Math.cos(B), Math.sin(B));
      LU.uOff.value.set((1.5 + 0.3 * Math.sin(t * 0.019)) * (1 + 0.08 * op), (1.7 + 0.4 * Math.sin(t * 0.027 + 2)) * (1 + 0.08 * op), 0.9 + 0.25 * Math.sin(t * 0.015 + 4));
      LU.uScale.value = 1.6 + 0.08 * Math.sin(t * 0.041) + over * 0.5;
      LU.uSquash.value = Math.max(0.03, unfold * (1 - over * 0.97));
      LU.uOver.value = over;
      LU.uGlow.value = 0.25 + 0.75 * unfold;
      LU.uDrift.value = (t * 0.01) % 1;
      BU.uSeam.value = Math.max(1 - unfold, over) * 0.85;

      // ring of light racing down the corridor into the eye; it lands as a halo flash on the eye-wall
      if (ringD > -1) {
        ringD *= Math.exp(dt * 2.6);
        const a = ringAmp * ease(Math.min(1, (ringD - 1.2) / 1.5)) * (1 - ease(Math.min(1, Math.max(0, (ringD - 7) / 1.5))));
        if (ringD >= 8.5) { ringD = -1; land = Math.max(land, ringAmp); LU.uRing.value.y = 0; } else LU.uRing.value.set(ringD, a, 2.6);
      } else LU.uRing.value.y = 0;
      land *= Math.exp(-dt * 3.5); LU.uLand.value = land;

      DU.uFly.value = fly;
      DU.uSpeed.value = speed * Math.abs(fk);
      DU.uScatter.value = over;
      DU.uDustK.value = Math.min(1, unfold * 1.5) * (1 - over * 0.5);
    },
    setIntensity(a) { k = a; if (ctx.fade && ctx.fade.value !== a) ctx.fade.value = a; },
    enter(dur) { mode = 'enter'; mT = 0; mDur = Math.max(0.2, dur || 2); unfold = 0; over = 0; punch = 1; },
    exit(dur) { mode = 'exit'; mT = 0; mDur = Math.max(0.2, dur || 1.5); },
    ripple(o = {}) { fireRing(o.color || null, o.strength == null ? 1 : o.strength); if (ctx.pulse) ctx.pulse.value = Math.max(ctx.pulse.value, (o.strength ?? 1) * 0.6); },
    shockwave(x, z, color) { fireRing(color || null, 1); },
    event(type, p) {
      if (type === 'mover') punch = Math.max(punch, 0.5);
      else if (type === 'heroPulse' && p) fireRing(base.uStoryCol.value, Math.min(1, (p.strength ?? 1) * (p.type === 'beat' ? 0.4 : 1)));
    },
    setQuality(nq) {
      q = Math.max(0, Math.min(2, nq | 0));
      LU.uSteps.value = STEPS[q]; LU.uFolds.value = FOLDS[q];
      dg.setDrawRange(0, DUST[q]);
    },
    // world-space points on the visible corridor: rings of ribs receding to the vanishing point
    morphPoints(out, n) {
      const cam = ctx.camera, v = new THREE.Vector3();
      if (!cam) return false;
      const asp = (ctx.res && ctx.res.value.x / ctx.res.value.y) || 16 / 9;
      for (let i = 0; i < n; i++) {
        const ang = Math.floor(rnd() * 8) * (Math.PI / 4) + (rnd() - 0.5) * 0.5;
        const D = 1.2 + Math.pow(rnd(), 1.6) * 30, rad = 2.6 + (rnd() - 0.5) * 0.8;
        const sx = uVP.value.x + Math.cos(ang) * rad * 1.05 / D / asp, sy = uVP.value.y + Math.sin(ang) * rad * 1.05 / D;
        v.set(sx * 2 - 1, sy * 2 - 1, 0.9 + 0.09 * (D / 32)).unproject(cam);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      return true;
    },
    grade: {
      bloom: 0.72, bloomThreshold: 0.62, bloomRadius: 0.55,
      tint: new THREE.Color('#b040ff'), tintAmt: 0.05, sat: 1.1, contrast: 1.05,
      ca: 1.25, grain: 1, vignette: 1.15, scan: 1.1,
    },
    cameraBias: { orbitScale: 0.9, bob: 0.85 },
    _u: { LU, BU, DU },  // test-page introspection only
    dispose() { ctx.stage.remove(dust); },
  };
  return api;
}
