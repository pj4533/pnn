// THE PROJECTOR STAGE: the shared rig that makes the background and the widget one picture. Every frame the current
// hologram's pose box is projected with the live camera into an eye ellipse (hero.anchor); the story drives colour,
// direction and energy (hero.story); widget animations and broadcast events become pulses (hero.emit / onPulse).
// It writes the shared uniforms (uHero, uHeroW, uStory, uStoryCol, uStoryColA) every scene, transition and the post
// pass read, and draws 4 things in the main scene: a floor plinth of rotating tick-rings, a light cone, ~1.5k motes
// spiralling around the widget, and a halo disc behind it (dark calm centre + thin eye-wall ring).
import * as THREE from '../../vendor/three/three.module.js';
import { COL } from './holo.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dampK = (k, dt) => 1 - Math.exp(-k * dt);
const MOTES = [0, 768, 1536];

const SQ = 'float sq(float x){ return x * x; }\n';
const EYE_GLSL = /* glsl */`
uniform vec4 uHero; uniform vec2 uRes;
float heroR(vec2 q){ return length((q - uHero.xy) / max(uHero.zw, vec2(1e-3))); }
float eyeMask(float a, float b){ return smoothstep(a, b, heroR(gl_FragCoord.xy / uRes)); }`;

export function createHeroStage({ scene, camera, fx, post, sh }) {
  const U = sh;   // uHero, uHeroW, uStory, uStoryCol, uStoryColA (shared refs)
  const uTime = { value: 0 }, uE = { value: 0.3 }, uDir = { value: 0 }, uPulse = { value: 0 };
  const uVis = { value: 0 }, uIgn = { value: 1 }, uKick = { value: 0 }, uArrive = { value: 0 };
  const uCol = U.uStoryCol, uColA = U.uStoryColA;
  let quality = 2;

  const hero = {
    anchor: {
      screen: new THREE.Vector2(0.64, 0.6), radius: new THREE.Vector2(0.2, 0.25),
      world: new THREE.Vector3(0, 10, 0), floor: new THREE.Vector3(), worldR: 15, plinthY: 0.3,
    },
    story: { dir: 0, move: 0, energy: 0.3, swing: false, alert: false, colorA: new THREE.Color('#ff2bd6'), colorB: new THREE.Color('#00f0ff'), color: new THREE.Color('#00f0ff'), theme: 'world' },
    pulse: 0,
    emit, onPulse, project, setQuality, dispose, setStory, tick,
  };

  // ---------- pulses
  const listeners = new Set();
  let lastBurstAt = -1, clock = 0;
  function emit(type, strength = 1, extra = {}) {
    strength = clamp(+strength || 0, 0, 1);
    hero.pulse = Math.max(hero.pulse, strength);
    // small fx bursts (needle sparks every 70 ms) only bump the pulse; listeners hear them at most ~4x/s
    if ((type === 'burst' || type === 'ring') && strength < 0.6 && clock - lastBurstAt < 0.25) return;
    if (type === 'burst' || type === 'ring') lastBurstAt = clock;
    if (type === 'arrive') { uIgn.value = 0; uArrive.value = 1; }
    if (type !== 'beat') uKick.value = Math.max(uKick.value, strength);
    const p = { type, strength, color: hero.story.color.clone(), screen: hero.anchor.screen.clone(), ...extra, world: (extra.world || hero.anchor.world).clone() };
    for (const fn of [...listeners]) { try { fn(p); } catch (e) { console.error('[hero] listener', e); } }
    try { document.dispatchEvent(new CustomEvent('pnn:heropulse', { detail: { type, strength } })); } catch { /* no DOM */ }
  }
  function onPulse(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  const _pv = new THREE.Vector3();
  function project(v3, out = new THREE.Vector2()) { _pv.copy(v3).project(camera); return out.set((_pv.x + 1) / 2, (_pv.y + 1) / 2); }

  // ---------- story
  const tgtCol = new THREE.Color('#00f0ff'), tgtA = new THREE.Color('#ff2bd6');
  let tgtE = 0.3, tgtDir = 0;
  /** s = { dir, move, energy, swing, alert, colorA, colorB, theme } (colours are THREE.Color). */
  function setStory(s = {}) {
    const st = hero.story;
    st.move = s.move ?? 0; st.dir = s.dir ?? Math.sign(st.move); st.swing = !!s.swing; st.alert = !!s.alert; st.theme = s.theme || st.theme;
    st.energy = clamp(s.energy ?? (Math.min(1, Math.abs(st.move) / 0.15) + (st.swing ? 0.25 : 0)), 0, 1);
    if (s.colorA) st.colorA.copy(s.colorA);
    if (s.colorB) st.colorB.copy(s.colorB);
    if (st.alert) { st.color.copy(COL.alert); tgtA.copy(COL.alert); }
    else {
      st.color.copy(st.colorB);
      if (st.dir) st.color.lerp(st.dir > 0 ? COL.up : COL.down, 0.35);
      tgtA.copy(st.colorA);
    }
    tgtCol.copy(st.color); tgtE = st.energy; tgtDir = st.dir;
  }

  // ---------- 1) halo: clip-space quad around the eye, drawn first in the main pass. Premultiplied blend does both
  // jobs in one draw: alpha darkens the backdrop behind the widget, rgb adds the thin eye-wall ring.
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uHero: U.uHero, uRes: sh.res, uTime, uE, uDir, uPulse, uVis, uCol, uColA, uKick },
    vertexShader: /* glsl */`uniform vec4 uHero; varying vec2 vD;
      void main(){ vD = position.xy * 1.9; gl_Position = vec4((uHero.xy + vD * uHero.zw) * 2. - 1., 0., 1.); }`,
    fragmentShader: SQ + /* glsl */`uniform float uTime, uE, uDir, uPulse, uVis, uKick; uniform vec3 uCol, uColA; varying vec2 vD;
      void main(){
        float r = length(vD), a = atan(vD.y, vD.x);
        float core = (1. - smoothstep(.85, 1.35, r)) * .5;
        float rr = 1.35 + uKick * .06;
        float ring = exp(-sq((r - rr) * 40.));
        float seg = .55 + .45 * step(.35, fract(a / 6.28318 * 72. + uTime * .05 * (1. + 2. * uE) * (uDir == 0. ? 1. : uDir)));
        float glow = exp(-sq((r - rr) * 5.)) * .16;
        float inner = exp(-sq((r - 1.12) * 40.)) * .18 * step(.5, fract(a / 6.28318 * 24. - uTime * .08));
        vec3 c = uCol * (ring * seg * (.16 + .2 * uE + .7 * uPulse) + glow * (.25 + .6 * uPulse)) + uColA * inner * .5;
        float fade = 1. - smoothstep(1.6, 1.9, r);
        gl_FragColor = vec4(c * uVis * fade, core * uVis);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });
  const haloGeo = new THREE.PlaneGeometry(2, 2);
  const halo = new THREE.Mesh(haloGeo, haloMat); halo.frustumCulled = false; halo.renderOrder = -10;

  // ---------- 2) plinth: one disc on the floor, three procedural rings of rotating ticks + ignition sweep
  const plinthMat = new THREE.ShaderMaterial({
    uniforms: { uHero: U.uHero, uRes: sh.res, uTime, uE, uDir, uPulse, uVis, uIgn, uCol, uColA, uKick },
    vertexShader: /* glsl */`varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: SQ + EYE_GLSL + /* glsl */`uniform float uTime, uE, uDir, uPulse, uVis, uIgn, uKick; uniform vec3 uCol, uColA; varying vec2 vP;
      float band(float r, float a, float b){ return smoothstep(a - .006, a + .006, r) * (1. - smoothstep(b - .006, b + .006, r)); }
      void main(){
        float r = length(vP); if (r > 1.08) discard;
        float a = atan(vP.y, vP.x) / 6.28318 + .5;
        float spd = .02 + .09 * uE;
        float t1 = step(.55, fract(a * 120. + uTime * spd * 30.)) * band(r, .9, .96);
        float t2 = step(.7, fract(a * 48. - uTime * spd * 14.)) * band(r, .7, mix(.74, .78, step(.75, fract(a * 12. - uTime * spd * 3.5))));
        float t3 = step(.22, fract(a * 3. + uTime * spd * 4.)) * band(r, .47, .5);
        float rings = exp(-sq((r - .985) * 90.)) + exp(-sq((r - .8) * 120.)) * .6 + exp(-sq((r - .55) * 120.)) * .5;
        float sweep = step(a, uIgn * 1.25);                     // ignition: ticks light up around the circle
        float ign = exp(-sq((r - uIgn * 1.05) * 14.)) * (1. - uIgn) * 2.5;
        float fill = (1. - smoothstep(0., 1., r)) * .07;
        float lvl = .16 + .22 * uE + .7 * uPulse;
        vec3 c = mix(uColA, uCol, smoothstep(.4, .95, r)) * ((t1 + t2 * .9 + t3 * .8) * sweep * lvl + rings * (.16 + .16 * uE + .6 * uPulse) + fill)
               + uCol * (ign * .6 + exp(-sq((r - .985 - uKick * .08) * 30.)) * uKick * .5);
        gl_FragColor = vec4(c * uVis * mix(.35, 1., eyeMask(.8, 1.1)), 1.);   // calm where it passes under the widget's footer
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const plinthGeo = new THREE.CircleGeometry(1.08, 96); plinthGeo.rotateX(-Math.PI / 2);
  const plinth = new THREE.Mesh(plinthGeo, plinthMat); plinth.renderOrder = 5; plinth.frustumCulled = false;

  // ---------- 3) light cone: open cylinder rising from the plinth through the widget's lower half, fresnel edges,
  // scanlines climbing (up) / falling (down); faded inside the eye so it frames the widget instead of crossing it
  const coneGeo = new THREE.CylinderGeometry(0.82, 1, 1, 64, 1, true); coneGeo.translate(0, 0.5, 0);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uHero: U.uHero, uRes: sh.res, uTime, uE, uDir, uPulse, uVis, uCol, uColA },
    vertexShader: /* glsl */`varying vec3 vN, vW; varying float vY;
      void main(){ vY = position.y; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: EYE_GLSL + /* glsl */`
      uniform float uTime, uE, uDir, uPulse, uVis; uniform vec3 uCol, uColA; varying vec3 vN, vW; varying float vY;
      void main(){
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(max(1. - abs(dot(normalize(vN), v)), 1e-4), 2.5);
        float dirv = uDir == 0. ? .35 : uDir;
        float scan = smoothstep(.82, 1., fract(vY * 16. - uTime * (.5 + 1.6 * uE) * dirv));
        float h = pow(max(1. - vY, 1e-4), 1.6);
        float a = (fres * .16 + scan * (.04 + .07 * uE)) * h * (1. + uPulse);
        float m = mix(.03, 1., eyeMask(.75, 1.15));
        gl_FragColor = vec4(mix(uColA, uCol, .6 + .4 * vY) * a * m * uVis, 1.);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat); cone.renderOrder = 6; cone.frustumCulled = false;

  // ---------- 4) motes: GPU helices around the widget, gathered at the eye-wall; up = rise + spiral in, down = sink + drift out
  const NM = MOTES[2];
  const mg = new THREE.BufferGeometry();
  const seeds = new Float32Array(NM * 3);
  for (let i = 0; i < NM; i++) { seeds[i * 3] = Math.random(); seeds[i * 3 + 1] = Math.random(); seeds[i * 3 + 2] = Math.random(); }
  mg.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  const uCenter = { value: new THREE.Vector3() }, uR = { value: 15 }, uH = { value: 20 }, uPx = { value: 1 };
  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uHero: U.uHero, uRes: sh.res, uTime, uE, uDir, uPulse, uVis, uKick, uArrive, uCol, uColA, uCenter, uR, uH, uPx },
    vertexShader: /* glsl */`uniform float uTime, uE, uDir, uKick, uArrive, uR, uH, uPx; uniform vec3 uCenter; varying float vA, vT;
      void main(){
        vec3 s = position;
        float spd = (.12 + .55 * uE) * (.6 + .8 * s.z) * (s.x > .5 ? 1. : -.7);
        float yph = fract(s.y + uTime * (.03 + .09 * uE) * (uDir == 0. ? .25 : uDir));
        float r = uR * mix(1.12, 1.85, s.x * s.x);
        r *= uDir > 0. ? mix(1.15, .85, yph) : uDir < 0. ? mix(.9, 1.25, yph) : 1.;
        r *= 1. + uKick * .35 * (.4 + s.z) + uArrive * uArrive * (2.5 + 2. * s.z);
        float ang = s.z * 6.28318 * 13. + uTime * spd + uArrive * 3. * (s.x - .5);
        vec3 p = uCenter + vec3(cos(ang) * r, mix(-.05, 1.15, yph) * uH, sin(ang) * r * .6);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        vA = sin(3.14159 * yph) * (1. - uArrive * .5); vT = s.x;
        gl_PointSize = (.9 + 1.6 * s.z * s.z) * uPx * (220. / max(1., -mv.z));
      }`,
    fragmentShader: EYE_GLSL + /* glsl */`
      uniform float uE, uPulse, uVis; uniform vec3 uCol, uColA; varying float vA, vT;
      void main(){
        vec2 c = gl_PointCoord - .5; float d = dot(c, c); if (d > .25) discard;
        float k = smoothstep(.25, 0., d);
        float m = eyeMask(.88, 1.2);                       // never bright over the widget itself
        vec3 col = mix(uColA, uCol, .35 + .65 * vT) * (.3 + .3 * uE + .9 * uPulse);
        gl_FragColor = vec4(col * k * k * vA * m * uVis, 1.);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const motes = new THREE.Points(mg, moteMat); motes.frustumCulled = false; motes.renderOrder = 7;
  mg.setDrawRange(0, MOTES[quality]);

  const group = new THREE.Group(); group.name = 'heroStage';
  group.add(halo, plinth, cone, motes);
  scene.add(group);

  // ---------- anchor
  const tScreen = new THREE.Vector2(0.64, 0.6), tRad = new THREE.Vector2(0.2, 0.25);
  const _c = new THREE.Vector3(), _ctr = new THREE.Vector3(), _sz = new THREE.Vector3(), _fl = new THREE.Vector3();
  let has = false, emitAcc = 1, lastW = 0, lastH = 0;
  function fitBox(box) {
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      _c.applyMatrix4(camera.matrixWorldInverse);
      if (_c.z > -0.5) return false;                        // a corner behind the camera: keep the last fit
      _c.applyMatrix4(camera.projectionMatrix);
      const sx = (_c.x + 1) / 2, sy = (_c.y + 1) / 2;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    tScreen.set((x0 + x1) / 2, (y0 + y1) / 2);
    tRad.set(Math.max(0.02, (x1 - x0) / 2 * 1.08), Math.max(0.02, (y1 - y0) / 2 * 1.08));
    return true;
  }

  /** Per frame (after tickCamera, before world.tick). pose = current holo pose() or null; rect = overlay stage rect (top-down fractions). */
  function tick(dt, t, { pose = null, rect = null, cssW = 1920, cssH = 1080, visible = true } = {}) {
    clock += dt; uTime.value = t;
    const A = hero.anchor;
    let ok = false;
    if (pose && pose.box) {
      ok = fitBox(pose.box);
      pose.box.getCenter(_ctr); pose.box.getSize(_sz);
      A.world.lerp(_ctr, has ? dampK(8, dt) : 1);
      A.worldR += (Math.max(_sz.x, _sz.z) / 2 - A.worldR) * (has ? dampK(6, dt) : 1);
      uH.value += (_sz.y - uH.value) * dampK(6, dt);
    }
    if (!ok && rect) {
      tScreen.set((rect.x0 + rect.x1) / 2, 1 - (rect.y0 + rect.y1) / 2);
      tRad.set((rect.x1 - rect.x0) * 0.4, (rect.y1 - rect.y0) * 0.4);
    }
    const k = has ? dampK(12, dt) : 1;
    A.screen.lerp(tScreen, k); A.radius.lerp(tRad, k);
    has = has || ok;
    A.floor.set(A.world.x, 0.06, A.world.z);
    _fl.copy(A.floor); _fl.project(camera);
    A.plinthY = clamp((_fl.y + 1) / 2, 0, 1);

    // story signals (damped so a cut between stories glides)
    const sk = dampK(3, dt);
    uCol.value.lerp(tgtCol, sk); uColA.value.lerp(tgtA, sk);
    uE.value += (tgtE - uE.value) * sk;
    uDir.value = tgtDir;
    hero.pulse = Math.max(0, hero.pulse - dt * 2.2);
    uPulse.value = hero.pulse;
    uKick.value = Math.max(0, uKick.value - dt * 1.8);
    uArrive.value = Math.max(0, uArrive.value - dt * 1.1);
    uIgn.value = Math.min(1, uIgn.value + dt / 1.3);
    uVis.value += ((visible && pose ? 1 : 0) - uVis.value) * dampK(visible && pose ? 3 : 5, dt);

    // shared uniforms
    U.uHero.value.set(A.screen.x, A.screen.y, A.radius.x, A.radius.y);
    U.uHeroW.value.set(A.world.x, A.world.y, A.world.z, A.worldR);
    U.uStory.value.set(hero.story.dir, uE.value, hero.story.swing ? 1 : 0, hero.pulse);

    // rig placement: plinth + cone on the floor under the widget, motes around its centre
    const R = A.worldR * 1.15;
    plinth.position.copy(A.floor); plinth.scale.set(R, 1, R * 0.55);   // flattened: the widgets are wide, shallow panels
    plinth.rotation.y = 0;
    cone.position.copy(A.floor); cone.scale.set(R * 0.92, Math.max(4, uH.value * 0.8), R * 0.92 * 0.35);
    uCenter.value.set(A.world.x, 0, A.world.z); uR.value = A.worldR;
    group.visible = uVis.value > 0.003;

    post?.setHero?.({ plinthY: A.plinthY, cx: A.screen.x, cy: A.screen.y, rx: A.radius.x, ry: A.radius.y, vis: uVis.value, amt: quality > 0 ? 0.12 * uVis.value : 0 });

    // DOM: 'pnn:hero' ~10 Hz for the 2D overlay (CSS px, top-down)
    emitAcc += dt;
    if (emitAcc >= 0.1) { emitAcc = 0; dispatchDom(cssW, cssH); }
    lastW = cssW; lastH = cssH;
  }
  function dispatchDom(W = lastW || 1920, H = lastH || 1080) {
    const A = hero.anchor, st = hero.story;
    const detail = {
      x: A.screen.x * W, y: (1 - A.screen.y) * H, rx: A.radius.x * W, ry: A.radius.y * H,
      color: '#' + st.color.getHexString(), colorA: '#' + st.colorA.getHexString(), colorB: '#' + st.colorB.getHexString(),
      dir: st.dir, energy: +st.energy.toFixed(3), alert: st.alert, pulse: +hero.pulse.toFixed(3), visible: uVis.value > 0.5,
    };
    hero.dom = detail;
    try { document.dispatchEvent(new CustomEvent('pnn:hero', { detail })); } catch { /* no DOM */ }
  }
  hero.dispatchDom = dispatchDom;
  hero.setPixelRatio = (pr) => { uPx.value = pr; };

  function setQuality(q) { quality = clamp(q | 0, 0, 2); mg.setDrawRange(0, MOTES[quality]); motes.visible = quality > 0; }
  function dispose() {
    listeners.clear(); scene.remove(group);
    haloGeo.dispose(); haloMat.dispose(); plinthGeo.dispose(); plinthMat.dispose(); coneGeo.dispose(); coneMat.dispose(); mg.dispose(); moteMat.dispose();
  }
  return hero;
}
