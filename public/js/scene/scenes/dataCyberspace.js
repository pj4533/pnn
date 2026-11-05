// dataCyberspace: Neuromancer datascape. 800 translucent fresnel towers/cubes in the far field, glowing links,
// 6k amber packets racing along them (all GPU, positions baked), a double-helix data stream up the left, and
// 3-depth glyph rain behind. Draws: backdrop + towers + links + packets + helix = 5. Programs: 5.
import * as THREE from '../../../vendor/three/three.module.js';
import * as S from './dataCyberspace.glsl.js';

const NT = 800, NH = 260, NP = 6000, WRAP = 3600;
const PK = [1500, 3000, 6000], HX = [0, 260, 260], RAIN = [[0, 0, 1], [0, 1, 1], [1, 1, 1]];
const FIELD_PAR = 0.15, HELIX_POS = [-262, 30, -230];

function header(G) {
  let s = G.COMMON || `uniform float uTime, uAlert, uPulse, uFade; uniform vec3 uAccent, uAccent2; uniform sampler2D uNoise;\n`;
  if (!/float\s+guard\s*\(/.test(s)) s += '\n' + (G.GUARD || G.guard || `uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
float guard(){ vec2 q=gl_FragCoord.xy/uRes; vec2 m=smoothstep(uGuardRect.xy-0.08,uGuardRect.xy,q)*(1.-smoothstep(uGuardRect.zw,uGuardRect.zw+0.08,q)); return 1.-uGuardAmt*m.x*m.y; }`);
  if (!/alertMix\s*\(/.test(s)) s += `\nvec3 alertMix(vec3 c){ float l = dot(c, vec3(0.299,0.587,0.114)); return mix(c, vec3(1.0,0.16,0.05)*l*2.2, uAlert*0.85); }`;
  if (!/finish\s*\(/.test(s)) s += `\nvec3 finish(vec3 c){ return alertMix(c)*guard()*uFade; }`;
  return s + `\nfloat calm(){ return 1. - 0.8*(1.-guard())/max(uGuardAmt,0.001); }\n`;
}

function makeAtlas() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
  let s = 77; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.font = 'bold 46px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 64; i++) {
    const x = (i % 8) * 64, y = Math.floor(i / 8) * 64;
    if (i < 10) g.fillText(String(i), x + 32, y + 34);
    else if (i === 10) g.fillText('%', x + 32, y + 34);
    else if (i < 15) { // arrows
      g.save(); g.translate(x + 32, y + 32); g.rotate((i - 11) * Math.PI / 2);
      g.beginPath(); g.moveTo(-16, 0); g.lineTo(16, 0); g.moveTo(5, -11); g.lineTo(16, 0); g.lineTo(5, 11); g.stroke(); g.restore();
    } else { // abstract katakana-like strokes on a 3x3 lattice
      g.beginPath(); const n = 3 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        g.moveTo(x + 14 + Math.floor(r() * 3) * 18, y + 14 + Math.floor(r() * 3) * 18);
        g.lineTo(x + 14 + Math.floor(r() * 3) * 18, y + 14 + Math.floor(r() * 3) * 18);
      }
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

export function create(ctx) {
  const rnd = ctx.rnd || Math.random;
  const H = header(ctx.GLSL || {});
  let q = ctx.quality ?? 2;
  const cam = ctx.camera;

  // ---------- nodes
  const nodes = []; // { x, y, z (base), w, h, d, top:[x,y,z] }
  for (let i = 0; i < NT; i++) {
    const sky = i >= 560;
    const w = sky ? 8 + rnd() * 14 : 10 + rnd() * 18, hh = sky ? w : 20 + rnd() * rnd() * 170;
    const x = (rnd() * 2 - 1) * (sky ? 1200 : 1150);
    const z = -(sky ? 350 + rnd() * 950 : 260 + Math.pow(rnd(), 0.9) * 900);
    const y = sky ? 110 + rnd() * 160 : -70;
    nodes.push({ x, y, z, w, h: hh, d: w * (0.7 + rnd() * 0.6), tx: x, ty: y + hh, tz: z });
  }
  // seed node: near the left-centre of the field
  let seed = 0, sbest = 1e9;
  nodes.forEach((n, i) => { const d = Math.hypot(n.x + 150, n.y + 40, n.z + 600); if (d < sbest) { sbest = d; seed = i; } });
  let maxD = 1;
  for (const n of nodes) { n.dn = Math.hypot(n.tx - nodes[seed].tx, n.ty - nodes[seed].ty, n.tz - nodes[seed].tz); maxD = Math.max(maxD, n.dn); }
  for (const n of nodes) n.dn /= maxD;

  // ---------- links (3 nearest neighbours, deduped, shuffled)
  const seen = new Set(), links = [];
  for (let i = 0; i < NT; i++) {
    const a = nodes[i], cand = [];
    for (let j = 0; j < NT; j++) if (j !== i) cand.push([Math.hypot(a.tx - nodes[j].tx, a.ty - nodes[j].ty, a.tz - nodes[j].tz), j]);
    cand.sort((u, v) => u[0] - v[0]);
    for (let k = 0; k < 3; k++) {
      const [d, j] = cand[k], key = Math.min(i, j) * NT + Math.max(i, j);
      if (d < 520 && !seen.has(key)) { seen.add(key); links.push([i, j]); }
    }
  }
  for (let i = links.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [links[i], links[j]] = [links[j], links[i]]; }
  const NL = links.length;

  // ---------- towers (instanced)
  const bg = new THREE.BoxGeometry(1, 1, 1); bg.translate(0, 0.5, 0);
  const tg = new THREE.InstancedBufferGeometry(); tg.index = bg.index;
  for (const k of ['position', 'normal', 'uv']) tg.setAttribute(k, bg.getAttribute(k));
  const iPos = new Float32Array(NT * 3), iSize = new Float32Array(NT * 3), iSeed = new Float32Array(NT * 4), iAux = new Float32Array(NT * 2);
  nodes.forEach((n, i) => {
    iPos.set([n.x, n.y, n.z], i * 3); iSize.set([n.w, n.h, n.d], i * 3);
    const per = WRAP / (700 + Math.floor(rnd() * 700));
    iSeed.set([rnd(), per, rnd(), rnd() < 0.18 ? 1 : 0], i * 4);
    iAux.set([n.dn, rnd() < 0.09 ? 1 : 0], i * 2);
  });

  // ---------- packets
  const aA = new Float32Array(NP * 3), aB = new Float32Array(NP * 3), aP = new Float32Array(NP * 4), aD = new Float32Array(NP * 4);
  const designated = new Uint8Array(NT);
  for (let i = 0; i < NP; i++) {
    let [u, v] = links[i % NL]; if (rnd() < 0.5) [u, v] = [v, u];
    const a = nodes[u], b = nodes[v];
    const per = WRAP / (900 + Math.floor(rnd() * 900)), off = rnd();
    aA.set([a.tx, a.ty, a.tz], i * 3); aB.set([b.tx, b.ty, b.tz], i * 3);
    aP.set([off, per, 7 + rnd() * 8, rnd()], i * 4);
    const cz = 2 * rnd() - 1, ph = rnd() * 6.2832, rr = Math.sqrt(1 - cz * cz);
    aD.set([rr * Math.cos(ph), rr * Math.sin(ph), cz, a.dn], i * 4);
    if (!designated[v]) { designated[v] = 1; iSeed[v * 4 + 1] = per; iSeed[v * 4 + 2] = off; }
  }
  for (const [name, arr, sz] of [['iPos', iPos, 3], ['iSize', iSize, 3], ['iSeed', iSeed, 4], ['iAux', iAux, 2]]) tg.setAttribute(name, new THREE.InstancedBufferAttribute(arr, sz));
  tg.instanceCount = NT;

  // each link is LK segments so it can bow toward the hub (curve evaluated in the vertex shader from a, b and t)
  const LK = 6, LV = NL * LK * 2;
  const lp = new Float32Array(LV * 3), lb = new Float32Array(LV * 3), lt = new Float32Array(LV), li = new Float32Array(LV * 2);
  links.forEach(([u, v], i) => {
    const a = nodes[u], b = nodes[v];
    for (let j = 0; j < LK * 2; j++) {
      const o = i * LK * 2 + j, t = (j >> 1) + (j & 1);
      lp.set([a.tx, a.ty, a.tz], o * 3); lb.set([b.tx, b.ty, b.tz], o * 3); lt[o] = t / LK; li.set([a.dn, 0], o * 2);
    }
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('aB', new THREE.BufferAttribute(lb, 3));
  lg.setAttribute('aT', new THREE.BufferAttribute(lt, 1)); lg.setAttribute('aInfo', new THREE.BufferAttribute(li, 2));
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
  pg.setAttribute('aA', new THREE.BufferAttribute(aA, 3)); pg.setAttribute('aB', new THREE.BufferAttribute(aB, 3));
  pg.setAttribute('aP', new THREE.BufferAttribute(aP, 4)); pg.setAttribute('aD', new THREE.BufferAttribute(aD, 4));

  // ---------- helix (instanced cubes)
  const hg = new THREE.InstancedBufferGeometry(); const hb = new THREE.BoxGeometry(1, 1, 1); hg.index = hb.index;
  for (const k of ['position', 'normal', 'uv']) hg.setAttribute(k, hb.getAttribute(k));
  const hI = new Float32Array(NH * 4), hS = new Float32Array(NH * 3);
  const HP = 90;   // strand pairs along the (short) helix; rungs: 16 slices x 5
  for (let i = 0; i < NH; i++) {
    if (i < HP * 2) hI.set([i % 2, Math.floor(i / 2) / HP, 0, 0], i * 4);
    else { const k = i - HP * 2; hI.set([2, (Math.floor(k / 5) + 0.5) / 16, ((k % 5) + 0.5) / 5, 0], i * 4); }
    hS.set([rnd(), rnd(), rnd()], i * 3);
  }
  hg.setAttribute('hI', new THREE.InstancedBufferAttribute(hI, 4)); hg.setAttribute('hS', new THREE.InstancedBufferAttribute(hS, 3));
  hg.instanceCount = NH;

  // ---------- state + uniforms
  const U = { uT: { value: 0 }, uEnter: { value: 1 }, uExit: { value: 0 }, uRipAge: { value: -1 }, uRipAmp: { value: 0 },
    uRipO: { value: new THREE.Vector3(0, -20, -330) }, uPT: { value: 0 }, uPul: { value: new THREE.Vector2(9, 0) },
    uClimbPh: { value: 0 }, uHLen: { value: 120 }, uHR: { value: 38 } };
  const mk = (vs, fs, extra, blend = true) => ctx.track(new THREE.ShaderMaterial({
    uniforms: { ...ctx.common(), ...U, ...extra }, vertexShader: vs, fragmentShader: H + fs,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const atlas = ctx.track(makeAtlas());
  const root = new THREE.Group(), helixRoot = new THREE.Group();
  const uPx = { value: (ctx.res && ctx.res.value.y / 1080) || 1 };
  const backMat = mk(S.FS_VERT, S.BACK_FRAG, { tAtlas: { value: atlas }, uRainEnv: { value: 1 }, uLayers: { value: new THREE.Vector3(1, 1, 1) }, uParPx: { value: new THREE.Vector2() } });
  backMat.blending = THREE.NoBlending;
  const backdrop = ctx.backdrop(backMat);
  const towers = new THREE.Mesh(ctx.track(tg), mk(S.TOWER_VERT, S.TOWER_FRAG, {}));
  const linkObj = new THREE.LineSegments(ctx.track(lg), mk(S.LINK_VERT, S.LINK_FRAG, {}));
  const packets = new THREE.Points(ctx.track(pg), mk(S.PACKET_VERT, S.PACKET_FRAG, { uStormMax: { value: 0 }, uStormAge: U.uRipAge, uPx, uClimb: { value: 0 } }));
  const hmat = mk(S.HELIX_VERT, S.HELIX_FRAG, {});
  const helix = new THREE.Mesh(ctx.track(hg), hmat);
  ctx.track(bg, hb);
  for (const o of [towers, linkObj, packets, helix]) o.frustumCulled = false;
  towers.renderOrder = -3; linkObj.renderOrder = -2; packets.renderOrder = -1; helix.renderOrder = -1;
  root.add(towers, linkObj, packets); helixRoot.add(helix);
  ctx.stage.add(root, helixRoot);
  

  let climb = 0, k = 1, T = 0, enterT = -1, enterD = 1, exitT = -1, exitD = 1, ripT = -1, stormMax = 0, ripAmp = 0;
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

  function setQuality(nq) {
    q = Math.max(0, Math.min(2, nq | 0));
    pg.setDrawRange(0, PK[q]); tg.instanceCount = q === 0 ? 600 : NT;
    lg.setDrawRange(0, (q === 0 ? Math.floor(NL * 0.6) : NL) * LK * 2);
    hg.instanceCount = HX[q]; helixRoot.visible = HX[q] > 0;
    const L = RAIN[q]; backMat.uniforms.uLayers.value.set(L[0], L[1], L[2]);
  }
  setQuality(q);

  function ripple(o = {}) {
    const s = o.strength == null ? 1 : o.strength;
    U.uRipO.value.set((o.x || 0) - root.position.x, -20, -330 + (o.z || 0) * 0.3);
    ripT = 0; ripAmp = Math.min(1, 0.35 + s); stormMax = 0.25 * Math.min(1, s * 1.2);
    packets.material.uniforms.uStormMax.value = stormMax;
    U.uRipAge.value = 0; U.uRipAmp.value = ripAmp;
  }

  return {
    update(dt, t, info) {
      dt = Math.max(0, dt);
      const al = ctx.alert ? ctx.alert.value : 0;
      T = (T + dt * (1 + 0.4 * al)) % WRAP; U.uT.value = T;
      // projector stage: energy drives packet speed + helix climb, direction drives the flow; pulses decay here
      const st = ctx.uStory ? ctx.uStory.value : { x: 0, y: 0.35 }, hw = ctx.uHeroW ? ctx.uHeroW.value : null;
      U.uPT.value = (U.uPT.value + dt * (0.7 + 1.3 * st.y) * (1 + 0.4 * al)) % WRAP;
      climb = (climb + dt * (0.03 + 0.07 * st.y) * (st.x < -0.3 ? -1 : 1)) % 1;
      U.uClimbPh.value = climb < 0 ? climb + 1 : climb;
      U.uPul.value.x += dt; if (U.uPul.value.x > 1.6) U.uPul.value.y = 0;
      if (hw) { // the helix wraps the light cone: floor under the widget up to its base
        helixRoot.position.set(hw.x, 0.06, hw.z); U.uHLen.value = Math.max(24, hw.y * 1.1); U.uHR.value = Math.max(14, hw.w * 0.95);
      }
      if (enterT >= 0) { enterT += dt; U.uEnter.value = Math.min(1, enterT / enterD); if (enterT >= enterD) enterT = -1; }
      if (exitT >= 0) { exitT += dt; U.uExit.value = Math.min(1, exitT / exitD); if (exitT >= exitD) exitT = -1; }
      if (ripT >= 0) { ripT += dt; U.uRipAge.value = ripT; if (ripT > 3.5) { ripT = -1; U.uRipAge.value = -1; } }
      root.position.x = cam.position.x * (1 - FIELD_PAR);
      backMat.uniforms.uParPx.value.x = (info && info.par ? info.par.x : 0) * 0.6 * uPx.value;
    },
    setIntensity(a) { k = a; if (ctx.fade && ctx.fade.value !== a) ctx.fade.value = a; },
    enter(dur = 2.5) { enterD = Math.max(0.1, dur); enterT = 0; exitT = -1; U.uEnter.value = 0; U.uExit.value = 0; },
    exit(dur = 1.6) { exitD = Math.max(0.1, dur); exitT = 0; U.uEnter.value = 1; },
    ripple,
    shockwave(x, z, color) { ripple({ x, z, color, strength: 1 }); },
    event(type, data) {
      if (type === 'mover') ripple({ x: 0, z: 0, strength: 0.25 });
      else if (type === 'heroPulse' && data && (data.strength ?? 1) >= 0.3 && data.type !== 'beat') U.uPul.value.set(0, Math.min(1, data.strength ?? 1));   // packet burst floods toward the hub
    },
    setQuality,
    morphPoints(out, n) {
      const rx = root.position.x;
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.25 && helixRoot.visible) { // helix strand
          const yn = rnd(), a = yn * 15.7 + T * 0.9 + (rnd() < 0.5 ? 0 : Math.PI), R = U.uHR.value * (1.08 - 0.34 * yn);
          out[i * 3] = helixRoot.position.x + Math.cos(a) * R; out[i * 3 + 1] = helixRoot.position.y + yn * U.uHLen.value; out[i * 3 + 2] = helixRoot.position.z + Math.sin(a) * R;
        } else {
          const nd = nodes[Math.floor(rnd() * NT)];
          out[i * 3] = rx + nd.x + (rnd() - 0.5) * nd.w; out[i * 3 + 1] = nd.y + rnd() * nd.h; out[i * 3 + 2] = nd.z + (rnd() - 0.5) * nd.d;
        }
      }
      return true;
    },
    grade: { bloom: 0.9, bloomThreshold: 0.55, bloomRadius: 0.7, tint: new THREE.Color('#2a6bff'), tintAmt: 0.05, sat: 1.08, contrast: 1.06, ca: 1, grain: 1, vignette: 1.05, scan: 1.1 },
    cameraBias: { orbitScale: 1.05, bob: 0.9 },
    dispose() { root.removeFromParent(); helixRoot.removeFromParent(); },
  };
}
