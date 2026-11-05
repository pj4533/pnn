// chromeBlobs: "Liquid Chrome Lounge". Six liquid-chrome metaballs (raymarched in ctx.layer) merging and splitting
// in a dark void, upper-left; two thin neon tori precess around them; 3k glitter-dust points swirl (1 in 5 a fast comet).
// Everything shares one scripted virtual camera (uRayOrigin/uRayBasis) so tori and dust sit exactly around the chrome,
// and the layer's alpha carries hit depth so tori/dust pass behind the blobs. 5 draws: layer, backdrop, 2 tori, points.
import { CAM, FS_VERT, MARCH_FRAG, BACK_FRAG, TORUS_VERT, TORUS_FRAG, DUST_VERT, DUST_FRAG } from './chromeBlobs.glsl.js';

const CENTER_X = 0.40, CENTER_Y = 0.70, FOCAL = 0.95, CAM_D = 10;
const STEPS = [12, 18, 24], NBLOB = [4, 6, 6], NDUST = [1200, 2000, 3000];
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const elastic = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 + Math.pow(2, -9 * x) * Math.sin((x * 10 - 0.75) * 2.0944);

// The real common.js COMMON may or may not inline guard/alertMix/finish; add whichever is missing (never redeclare).
function preamble(G) {
  let s = G.COMMON || '';
  const pick = (v) => (typeof v === 'function' ? v() : v) || '';
  if (!/float\s+guard\s*\(/.test(s)) s += '\n' + pick(G.GUARD || G.guard);
  if (!/alertMix\s*\(/.test(s)) s += '\n' + pick(G.alertMix || G.ALERTMIX);
  if (!/finish\s*\(/.test(s)) s += '\n' + pick(G.finish || G.FINISH);
  return s + '\n';
}

export function create(ctx) {
  const { THREE, rnd } = ctx;
  let q = ctx.quality ?? 2;
  const HEAD = preamble(ctx.GLSL) + CAM;
  // vertex stages can't take COMMON (guard() reads gl_FragCoord): declare only what they use
  const VHEAD = 'uniform vec2 uRes; uniform vec4 uGuardRect; uniform vec3 uAccent, uAccent2;\n' + CAM;

  // ---- shared virtual-camera + scene uniforms (one object per uniform, shared by reference across materials) ----
  const U = {
    uRayOrigin: { value: new THREE.Vector3(0, 0, CAM_D) }, uRayBasis: { value: new THREE.Matrix3() },
    uPar: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector2(CENTER_X, CENTER_Y) },
    uFocal: { value: FOCAL }, uST: { value: 0 },
  };
  const B = []; for (let i = 0; i < 6; i++) B.push(new THREE.Vector4(0, 0, 0, 0.6));
  const MU = {
    uB: { value: B }, uNB: { value: NBLOB[q] }, uSteps: { value: STEPS[q] }, uWob: { value: 0.05 }, uRim: { value: 0 },
    uMaskR: { value: 0.4 }, uK: { value: 1.5 }, uBound: { value: new THREE.Vector4(0, 0, 0, 3) },
  };
  const marchMat = ctx.track(new THREE.ShaderMaterial({
    uniforms: { ...ctx.common(), ...U, ...MU }, vertexShader: FS_VERT, fragmentShader: HEAD + MARCH_FRAG,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  }));
  const layer = ctx.layer(marchMat, { scale: q >= 2 ? 0.5 : 0.25 });
  const uLayer = { value: layer.texture };

  // ---- backdrop: void + caustics + strip tubes + chrome composite + shockwave + glint ----
  const BU = { uLayer, uRip: { value: new THREE.Vector2(9, 0) }, uGlint: { value: 0 }, uEnter: { value: 0 } };
  ctx.backdrop(ctx.track(new THREE.ShaderMaterial({
    uniforms: { ...ctx.common(), ...U, ...BU }, vertexShader: FS_VERT, fragmentShader: HEAD + BACK_FRAG,
    depthTest: false, depthWrite: false,
  })));

  // ---- two neon tori ----
  const torGeo = ctx.track(new THREE.TorusGeometry(1, 0.012, 6, 220));
  const flare = { value: 0 }, torScale = { value: 0 };
  const tori = [{ rad: 2.55, tilt: 1.18, prec: 0.23, nut: 0.12, hue: 0 }, { rad: 3.15, tilt: 0.62, prec: -0.16, nut: 0.2, hue: 2.4 }].map((T) => {
    T.rot = { value: new THREE.Matrix3() };
    const mat = ctx.track(new THREE.ShaderMaterial({
      uniforms: { ...ctx.common(), ...U, uLayer, uRot: T.rot, uRad: { value: T.rad }, uScale: torScale, uFlare: flare, uHue: { value: T.hue } },
      vertexShader: VHEAD + TORUS_VERT, fragmentShader: HEAD + TORUS_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    }));
    const m = new THREE.Mesh(torGeo, mat); m.frustumCulled = false; m.renderOrder = 2; ctx.stage.add(m);
    T.mesh = m; return T;
  });

  // ---- glitter dust ----
  const N = NDUST[2], pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const fast = rnd() > 0.8;
    pos[i * 3] = rnd() * Math.PI * 2;
    pos[i * 3 + 1] = fast ? 2.0 + rnd() * 2.2 : 1.8 + Math.pow(rnd(), 0.7) * 6.2;
    pos[i * 3 + 2] = rnd() * 12 - 6;
    seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = fast ? 0.8 + rnd() * 0.2 : rnd() * 0.79;
  }
  const dustGeo = ctx.track(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  dustGeo.setDrawRange(0, NDUST[q]);
  const DU = { uSpread: { value: 1 }, uDustA: { value: 0 }, uPunch: { value: 0 }, uSize: { value: 2.8 } };
  const dust = new THREE.Points(dustGeo, ctx.track(new THREE.ShaderMaterial({
    uniforms: { ...ctx.common(), ...U, ...DU, uLayer }, vertexShader: VHEAD + DUST_VERT, fragmentShader: HEAD + DUST_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  })));
  dust.frustumCulled = false; dust.renderOrder = 3; ctx.stage.add(dust);

  // ---- blob choreography state ----
  const L = []; // Lissajous params per blob
  for (let i = 0; i < 6; i++) L.push({
    ax: 0.7 + rnd() * 0.5, ay: 0.5 + rnd() * 0.45, az: 0.6 + rnd() * 0.5,
    fx: 0.31 + rnd() * 0.35, fy: 0.27 + rnd() * 0.33, fz: 0.23 + rnd() * 0.3,
    px: rnd() * 6.28, py: rnd() * 6.28, pz: rnd() * 6.28, r: 0.6 + rnd() * 0.3,
  });
  let sT = 0, k = 1, enterDur = 0, enterT = 0, exitDur = 0, exitT = 0, kicked = true;
  let spr = 0, sprV = 0, rim = 0, wob = 0, ripAge = 9, ripStr = 0;
  const e3 = new THREE.Euler(0, 0, 0, 'YXZ'), m4 = new THREE.Matrix4();
  const vRo = new THREE.Vector3(), vRight = new THREE.Vector3(), vUp = new THREE.Vector3(), vBack = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const vP = new THREE.Vector3(), vS = new THREE.Vector3(), vV = new THREE.Vector3(), mT = new THREE.Matrix3();

  function setCamera(info) {
    const a = sT * 0.07, b = sT * 0.05;
    vRo.set(Math.sin(a) * 0.42, 0.2 + 0.1 * Math.sin(b), Math.cos(a)).normalize().multiplyScalar(CAM_D);
    U.uRayOrigin.value.copy(vRo);
    vBack.copy(vRo).normalize(); vRight.crossVectors(Y, vBack).normalize(); vUp.crossVectors(vBack, vRight);
    U.uRayBasis.value.set(vRight.x, vUp.x, vBack.x, vRight.y, vUp.y, vBack.y, vRight.z, vUp.z, vBack.z);
    if (info && info.par) U.uPar.value.set(info.par.x * 0.002, info.par.y * 0.002, 0);
  }

  function update(dt, t, info) {
    const alert = ctx.alert.value;
    sT = (sT + dt * (1 + 0.4 * alert)) % 3600;
    U.uST.value = sT;
    setCamera(info);
    // phases
    let e = 1, x = 0;
    if (enterDur > 0) { enterT += dt; e = Math.min(1, enterT / enterDur); if (e >= 1) enterDur = 0; }
    if (exitDur > 0) { exitT += dt; x = Math.min(1, exitT / exitDur); }
    let merge, rS, dropY, dSpread, dA, tS, glint = 0;
    if (x > 0) {
      merge = 1 - sm(0, 0.45, x); rS = 1 - sm(0.45, 0.85, x); dropY = 0;
      dSpread = 1 + 2.5 * sm(0, 1, x); dA = 1 - sm(0.1, 0.9, x); tS = 1 - sm(0, 0.7, x);
      glint = Math.max(0, 1 - Math.abs(x - 0.84) / 0.12);
    } else {
      const fall = Math.min(1, e / 0.42);
      dropY = 5.2 * (1 - fall * fall); merge = elastic((e - 0.42) / 0.58); rS = e < 0.42 ? 0.75 + 0.25 * sm(0, 0.3, e) : 1;
      dSpread = 3 - 2 * sm(0.1, 1, e); dA = sm(0.05, 0.8, e); tS = elastic((e - 0.3) / 0.7);
      if (!kicked && e >= 0.42) { kicked = true; sprV += 2.5; wob = Math.max(wob, 0.22); rim = Math.max(rim, 0.6); }
      glint = e < 0.42 ? 0.25 * sm(0, 0.15, e) * (1 - fall) : 0;   // droplet arrives with a glint
    }
    // splash spring + decays
    sprV += (-34 * spr - 4.5 * sprV) * dt; spr += sprV * dt;
    rim = Math.max(0, rim - dt * 1.3); wob = Math.max(0, wob - dt * 0.35); ripAge += dt; ripStr = Math.max(0, ripStr - dt * 0.7);
    const spread = merge * Math.max(0.35, 1 + spr * 0.9);
    let bound = 0;
    const nb = MU.uNB.value;
    for (let i = 0; i < 6; i++) {
      const p = L[i], s = sT * 0.85;
      const bx = Math.sin(s * p.fx + p.px) * p.ax * spread, by = Math.sin(s * p.fy + p.py) * p.ay * spread + dropY, bz = Math.sin(s * p.fz + p.pz) * p.az * spread;
      const r = p.r * rS * (0.85 + 0.15 * merge) * (q === 0 ? 1.12 : 1);
      B[i].set(bx, by, bz, r);
      if (i < nb) bound = Math.max(bound, Math.sqrt(bx * bx + by * by + bz * bz) + r);
    }
    MU.uBound.value.set(0, 0, 0, bound + 1.1 + wob);
    MU.uWob.value = (0.035 + 0.02 * Math.sin(sT * 0.6) + wob * 0.5 + Math.abs(sprV) * 0.02) * rS;
    MU.uRim.value = rim;
    flare.value = rim; torScale.value = Math.max(0, tS);
    BU.uRip.value.set(ripAge, ripStr); BU.uGlint.value = glint; BU.uEnter.value = Math.min(1, e) * (1 - x);
    DU.uSpread.value = dSpread; DU.uDustA.value = dA * (0.6 + 0.4 * k); DU.uPunch.value = Math.max(0, spr) * 0.6 + rim * 0.3;
    // tori precess (+ spin up on exit)
    for (let i = 0; i < 2; i++) {
      const T = tori[i], sp = 1 + 6 * x * x;
      e3.set(T.tilt + T.nut * Math.sin(sT * 0.4 + i * 2), sT * T.prec * sp + i * 1.7, 0.3 * Math.sin(sT * 0.21 + i));
      m4.makeRotationFromEuler(e3); T.rot.value.setFromMatrix4(m4);
    }
  }

  // project a virtual-space point to main-camera world space (for morphPoints)
  function toWorld(out, o, P) {
    vV.copy(P).sub(vRo).sub(U.uPar.value); mT.copy(U.uRayBasis.value).transpose(); vV.applyMatrix3(mT);
    const dz = Math.max(-vV.z, 0.05), asp = ctx.res.value.x / ctx.res.value.y;
    const sx = CENTER_X + (vV.x * FOCAL / dz) / asp, sy = CENTER_Y + vV.y * FOCAL / dz;
    vP.set(sx * 2 - 1, sy * 2 - 1, 0.5).unproject(ctx.camera).sub(ctx.camera.position).normalize();
    const dist = 260 + (dz - CAM_D) * 25;
    out[o] = ctx.camera.position.x + vP.x * dist; out[o + 1] = ctx.camera.position.y + vP.y * dist; out[o + 2] = ctx.camera.position.z + vP.z * dist;
  }

  setCamera(null);
  return {
    update,
    setIntensity(a) { k = a; ctx.fade.value = a; },
    enter(dur) { enterDur = Math.max(0.05, dur); enterT = 0; exitDur = 0; exitT = 0; kicked = false; },
    exit(dur) { exitDur = Math.max(0.05, dur); exitT = 0; },
    ripple(o = {}) {
      const s = o.strength ?? 1;
      sprV += 3.6 * s; wob = Math.max(wob, 0.12 + 0.14 * s); rim = Math.max(rim, s); ripAge = 0; ripStr = Math.max(ripStr, 0.4 + 0.6 * s);
    },
    shockwave(x, z, color) { this.ripple({ x, z, color, strength: 1 }); },
    event(type) { if (type === 'alert') { rim = 1; sprV += 2; } },
    setQuality(nq) {
      q = Math.max(0, Math.min(2, nq | 0));
      MU.uSteps.value = STEPS[q]; MU.uNB.value = NBLOB[q]; dustGeo.setDrawRange(0, NDUST[q]);
    },
    morphPoints(out, n) {
      const nb = MU.uNB.value;
      for (let i = 0; i < n; i++) {
        const b = B[i % nb], u = rnd() * 2 - 1, th = rnd() * 6.2832, s = Math.sqrt(1 - u * u), r = b.w * (1 + 0.15 * rnd());
        vS.set(b.x + s * Math.cos(th) * r, b.y + u * r, b.z + s * Math.sin(th) * r);
        toWorld(out, i * 3, vS);
      }
      return true;
    },
    grade: {
      bloom: 0.72, bloomThreshold: 0.62, bloomRadius: 0.5, tint: new THREE.Color('#d8b0ff'), tintAmt: 0.04,
      sat: 1.08, contrast: 1.1, ca: 1.15, grain: 0.9, vignette: 1.15, scan: 1.1,
    },
    cameraBias: { orbitScale: 0.85, bob: 0.9 },
    dispose() { ctx.stage.remove(dust, tori[0].mesh, tori[1].mesh); },
  };
}
