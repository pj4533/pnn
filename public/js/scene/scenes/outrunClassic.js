// Outrun Classic: bridge over the living environment (env/*): sky, sun, terrain, grid, particles, atmos driven by
// env/director's mood system. The one allowed terrain + sun + grid scene ("home base").
// enter(): a glowing front rolls the grid in from the horizon, then terrain/skyline rise and the sun climbs out.
// exit(): the front retracts to the horizon, terrain flattens, skyline sinks, the sun drops away.
// Intensity is a clear-colour curtain (one cheap fullscreen quad), so unmodified env shaders still fade correctly.
import * as THREE from '../../../vendor/three/three.module.js';
import { createEnvCtx } from '../env/common.js';
import { createSky } from '../env/sky.js';
import { createSun } from '../env/sun.js';
import { createTerrain } from '../env/terrain.js';
import { createGrid } from '../env/grid.js';
import { createParticles } from '../env/particles.js';
import { createAtmos } from '../env/atmos.js';
import { createDirector } from '../env/director.js';
import { MOODS } from '../env/moods.js';

const ORDER = ['sun', 'sky', 'terrain', 'grid', 'atmos', 'particles'];
const sm = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const seg = (p, a, b) => sm((p - a) / (b - a));

// ---- hero (projector stage): the env modules each carry a private copy of the old rectangular guard(). Rather than touch
// env/*, patch each compiled-to-be fragment shader: rename the old guard and inject the calm-eye guard + eye-wall rim boost.
// A shader that already declares uHero (core-updated env/*) is left alone.
const HERO_INJECT = `
uniform vec4 uHero; uniform vec4 uHeroW; uniform vec4 uStory; uniform vec3 uStoryCol; uniform vec3 uStoryColA;
float guard(){
  vec2 q = gl_FragCoord.xy / uRes; float r = length((q - uHero.xy) / max(uHero.zw, vec2(1e-3)));
  float e = smoothstep(0.78, 1.18, r); float rm = exp(-pow(abs((r - 1.35) * 3.2), 2.));
  return (1. - uGuardAmt * (1. - e)) * (1. + rm * (0.2 + 0.4 * uStory.y + 0.5 * uStory.w));
}`;
const GUARD_DECL = 'uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;';
function patchGuard(mat, H) {
  const fs = mat && mat.fragmentShader;
  if (!mat.isShaderMaterial || !fs || /uHero/.test(fs) || !/float\s+guard\s*\(/.test(fs) || !fs.includes(GUARD_DECL)) return false;
  mat.fragmentShader = fs.replace(/float\s+guard\s*\(/, 'float guardRect(').replace(GUARD_DECL, GUARD_DECL + HERO_INJECT);
  if (/vec3 c = core;/.test(mat.fragmentShader)) mat.fragmentShader = mat.fragmentShader.replace('vec3 c = core;', 'vec3 c = core * 0.85 * (1. - uGuardAmt * (1. - smoothstep(0.78, 1.18, length((gl_FragCoord.xy / uRes - uHero.xy) / max(uHero.zw, vec2(1e-3))))));');   // sun disc: calm core behind the widget, no rim boost (it would blow out)
  Object.assign(mat.uniforms, H);
  mat.needsUpdate = true;
  return true;
}

const CURTAIN_VS = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const CURTAIN_FS = 'uniform float uA; void main(){ gl_FragColor = vec4(0.0021, 0.0006, 0.0103, uA); }';

export function create(ctx) {
  const stage = ctx.stage;
  // ---- env ctx: share what the contract shares, keep guardAmt private (env director writes it per mood)
  const env = createEnvCtx(THREE, { time: ctx.localTime, alert: ctx.alert, accent: ctx.accent, accent2: ctx.accent2 });
  env.noiseTex.dispose();                       // replace our private noise with the shared one (never disposed here)
  env.noiseTex = ctx.sharedNoise;
  env.res = ctx.res; env.guardRect = ctx.guardRect; env.quality = ctx.quality;
  env.guardAmt = { value: ctx.guardAmt.value };

  // hero uniforms by reference from the shared set (calm defaults if the core is absent)
  const cu = ctx.common();
  const HERO = {
    uHero: cu.uHero || { value: new THREE.Vector4(0.64, 0.6, 0.2, 0.25) }, uHeroW: cu.uHeroW || { value: new THREE.Vector4(0, 0, 0, 1) },
    uStory: cu.uStory || { value: new THREE.Vector4(0, 0.4, 0, 0) }, uStoryCol: cu.uStoryCol || { value: ctx.accent2.value }, uStoryColA: cu.uStoryColA || { value: ctx.accent.value },
  };
  Object.assign(env, HERO);
  const HU = HERO.uHero.value, SU = HERO.uStory.value;

  const modules = {
    sky: createSky(stage, env), sun: createSun(stage, env), terrain: createTerrain(stage, env),
    grid: createGrid(stage, env), particles: createParticles(stage, env), atmos: createAtmos(stage, env),
  };

  // ---- grade: env director writes through this fake post
  const grade = { bloom: 0.55, bloomThreshold: 0.78, bloomRadius: 0.4, tint: new THREE.Color(1, 1, 1), tintAmt: 0, sat: 1, contrast: 1, ca: 1, grain: 1, vignette: 1, scan: 1 };
  const fakePost = {
    setBloom(p) { grade.bloom = p.strength; grade.bloomThreshold = p.threshold; grade.bloomRadius = p.radius; },
    setGrade(g) { grade.tint.copy(g.tint); grade.tintAmt = g.tintAmt; grade.sat = g.sat; grade.contrast = g.contrast; grade.ca = g.ca; grade.grain = g.grain; grade.vignette = g.vignette; grade.scan = g.scan; },
  };
  const q = ctx.opts && ctx.opts.get ? ctx.opts : new URLSearchParams();
  const pinned = !!q.get('mood');
  const dir = createDirector({ ctx: env, modules, post: fakePost, opts: { envfast: 1, quality: ctx.quality, mood: q.get('mood') || undefined } });
  if (!pinned) dir.setMood(MOODS[Math.floor(ctx.rnd() * MOODS.length)].name, { transition: 0 });   // start on a random mood
  dir.tick(0, 0, null);
  const cameraBias = dir.cameraBias;
  stage.traverse((o) => { const m = o.material; if (Array.isArray(m)) m.forEach((x) => patchGuard(x, HERO)); else if (m) patchGuard(m, HERO); });

  // ---- reveal hooks added without touching env files
  const frontU = { value: -1000 };
  const gridMat = modules.grid.mesh.material;
  gridMat.uniforms.uFront = frontU; gridMat.uniforms.uRimCol = { value: new THREE.Color() };
  const inU = { value: new THREE.Vector4(0, 0, 0, 0) };    // x, z, radius, strength: a scanline front that rolls INTO the plinth
  gridMat.uniforms.uIn = inU; gridMat.uniforms.uInCol = HERO.uStoryCol;
  gridMat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader
      .replace('uniform vec3 uFog;', 'uniform vec3 uFog; uniform float uFront; uniform vec3 uRimCol; uniform vec4 uIn; uniform vec3 uInCol;')
      .replace('c *= guard();', `float vis = smoothstep(uFront - 30., uFront + 30., d);
  float rim = exp(-pow(abs((d - uFront) / 22.), 2.)) * step(-500., uFront);
  c = c * vis + uRimCol * rim * (1.2 + l * 2.);
  c += uInCol * exp(-pow(abs((distance(w, uIn.xy) - uIn.z) / 18.), 2.)) * uIn.w * (0.7 + l * 3.);
  c *= guard();`);
  };
  const tChildren = modules.terrain.group.children;
  const terrainU = tChildren[0].material.uniforms;       // uAmp is shared across the layers
  const skylineU = tChildren[tChildren.length - 1].material.uniforms;
  const sunMesh = modules.sun.mesh, sunU = sunMesh.material.uniforms;
  // terrain: the valley around the sun/widget opens to the eye's width so the ranges frame it from the flanks
  const valleyK = { value: 1 };
  for (const o of tChildren) {
    const m = o.material;
    if (!m || !m.vertexShader || !m.vertexShader.includes('uValleyX') || !m.vertexShader.includes('smoothstep(140.0, 620.0, abs(wx - uValleyX))')) continue;
    m.vertexShader = m.vertexShader.replace('uniform float uW, uD, uH, uSeed', 'uniform float uValleyK; uniform float uW, uD, uH, uSeed').replace('smoothstep(140.0, 620.0, abs(wx - uValleyX))', 'smoothstep(140.0 * uValleyK, 620.0 * uValleyK, abs(wx - uValleyX))');
    m.uniforms.uValleyK = valleyK; m.needsUpdate = true;
  }
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
  let dirK = 0, stripeExtra = 0, inR = -1, inS = 0, plinthOk = false;

  // ---- intensity curtain
  const curtainU = { uA: { value: 0 } };
  const curtainGeo = ctx.track(new THREE.BufferGeometry());
  curtainGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const curtainMat = ctx.track(new THREE.ShaderMaterial({ uniforms: curtainU, vertexShader: CURTAIN_VS, fragmentShader: CURTAIN_FS, transparent: true, depthTest: false, depthWrite: false }));
  const curtain = new THREE.Mesh(curtainGeo, curtainMat);
  curtain.renderOrder = 1000; curtain.frustumCulled = false; curtain.visible = false;
  stage.add(curtain);

  // ---- choreography state
  let mode = 0, mT = 0, mDur = 1, reveal = 1, pulseIdx = 3;
  const PULSE_AT = [0.02, 0.2, 0.4];
  let lastCamX = 0;

  function startMode(m, dur) { mode = m; mT = 0; mDur = Math.max(0.2, dur); pulseIdx = m > 0 ? 0 : 3; }

  // the sun disc sits directly behind the widget (screen centre = hero, radius ~1.25x the eye): the widget is silhouetted against it
  function heroSun(dt, cam, en) {
    const asp = ctx.res.value.x / Math.max(1, ctx.res.value.y);
    const lift = dirK * (0.015 + 0.05 * en);                 // up: the sun climbs a touch, down: it sinks
    _v.set(HU.x * 2 - 1, (HU.y + lift) * 2 - 1, 0.5).unproject(cam);
    _d.copy(_v).sub(cam.position).normalize();
    sunMesh.position.copy(cam.position).addScaledVector(_d, 1500);
    sunMesh.quaternion.copy(cam.quaternion);
    const Ruv = Math.min(0.52, 1.25 * Math.max(HU.z * asp, HU.w));
    sunMesh.scale.setScalar(Ruv * 2 * 1500 * Math.tan(cam.fov * Math.PI / 360) * 2 * 1.7 * sunU.uQuad.value);
    env.sunDir.value.copy(_d);
    stripeExtra = (stripeExtra + dt * (0.08 + 0.35 * en) * (dirK < -0.3 ? -1 : 1)) % 1;
    sunU.uStripePh.value += stripeExtra;
    const mk = Math.abs(dirK) * (0.1 + 0.3 * en);            // up: gold-green, down: red-shift
    sunU.uColA.value.lerp(HERO.uStoryCol.value, mk); sunU.uColB.value.lerp(HERO.uStoryCol.value, mk * 1.3);
    // valley width follows the eye
    valleyK.value = Math.min(1.6, Math.max(0.55, HU.z * 2 * 1050 * Math.tan(cam.fov * Math.PI / 360) * asp * 1.3 / 620));
  }
  // the grid's polar origin and the inward scanline front aim at the plinth on the floor under the widget
  let plx = 0, plz = -200;
  function heroGround(dt, cam) {
    _v.set(HU.x * 2 - 1, (HU.y - HU.w * 0.95) * 2 - 1, 0.5).unproject(cam);
    _d.copy(_v).sub(cam.position).normalize();
    if (_d.y < -0.01) { const tt = Math.min(1400, -cam.position.y / _d.y); plx = cam.position.x + _d.x * tt; plz = cam.position.z + _d.z * tt; plinthOk = true; }
    if (plinthOk) modules.grid.setPolarOrigin(plx, plz);
    if (inR >= 0) { inR -= dt * 820; if (inR < 0) { inR = -1; inS = 0; } }
    inU.value.set(plx, plz, Math.max(inR, 0), inR >= 0 ? inS * Math.min(1, (700 - inR) / 60) : 0);
  }

  const inst = {
    grade, cameraBias,
    setIntensity(a) {
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      curtainU.uA.value = 1 - a; curtain.visible = a < 0.999;
    },
    enter(dur) { startMode(1, dur); reveal = 0; modules.particles.shootingStar(); },
    exit(dur) { startMode(-1, dur); },
    ripple(o) {
      const s = Math.max(0.2, Math.min(1, o.strength ?? 1));
      modules.grid.pulse(o.x ?? lastCamX, o.z ?? -200, o.color || ctx.accent2.value, { strength: 0.5 + s * 0.7, speed: 260, width: 9, maxRadius: 800 });
      modules.terrain.pulse(s);
      if (s > 0.5) modules.particles.shootingStar();
    },
    shockwave(x, z, color) { modules.grid.shockwave(x, z, color); },
    event(type, data) {
      if (type === 'alert' || type === 'alertClear' || type === 'mover') dir.event(type, data || {});
      else if (type === 'story' && data && data.x != null && HU.z < 1e-4) modules.grid.setPolarOrigin(data.x, data.z);
      else if (type === 'heroPulse' && data) {                  // a scanline front rolls toward the plinth, the ranges answer
        const st = data.strength ?? 1, k = data.type === 'beat' ? 0.4 : 1;
        inR = 700; inS = Math.min(1, st * k) * 1.1;
        if (st * k > 0.55) modules.terrain.pulse(st * k * 0.8);
      }
    },
    setQuality(l) { dir.setQuality(l); },
    update(dt, t, info) {
      dt = dt > 0.1 ? 0.1 : dt;
      const cam = info.camera;
      lastCamX = cam.position.x;
      if (mode !== 0) {
        mT += dt;
        const p = Math.min(1, mT / mDur);
        reveal = mode > 0 ? p : 1 - p;
        if (mode > 0) {
          while (pulseIdx < 3 && p * 1 >= PULSE_AT[pulseIdx]) {   // rolling rings behind the front
            modules.grid.pulse(cam.position.x, cam.position.z - 40 - pulseIdx * 60, pulseIdx === 1 ? ctx.accent.value : ctx.accent2.value, { speed: 420, width: 12, strength: 0.7, maxRadius: 900 });
            pulseIdx++;
          }
        }
        if (p >= 1) { reveal = mode > 0 ? 1 : 0; mode = 0; }
      }
      const al = info.alert || 0;
      dir.tick(dt * (1 + 0.4 * al), t, cam);
      // staged reveal: grid front first, then terrain + skyline, then the sun
      const eg = seg(reveal, 0, 0.6), et = seg(reveal, 0.25, 0.9), es = seg(reveal, 0.1, 1);
      const live = reveal >= 1;
      frontU.value = live ? -1000 : 1500 * Math.pow(1 - eg, 1.6) - 40;
      gridMat.uniforms.uRimCol.value.copy(ctx.accent2.value).lerp(ctx.accent.value, 0.5 + 0.5 * Math.sin(t * 2));
      if (!live) {
        terrainU.uAmp.value *= 0.04 + 0.96 * et;
        skylineU.uSky.value *= et;
        sunU.uBright.value *= es;
      }
      const en = Math.min(1, Math.max(0, SU.y));
      dirK += (SU.x - dirK) * (1 - Math.exp(-dt * 2));
      for (let i = 0; i < ORDER.length; i++) {
        const nm = ORDER[i];
        modules[nm].update(nm === 'grid' || nm === 'atmos' || nm === 'particles' ? dt * (0.8 + 0.6 * en) : dt, t, cam);   // energy: grid scroll + particle drift
        if (nm === 'sun') heroSun(dt, cam, en);
      }
      heroGround(dt, cam);
      if (!live) sunMesh.position.y -= (1 - es) * 420;
    },
    morphPoints(out, n) {
      const cam = ctx.camera.position, sp = modules.sun.getWorldPos(new THREE.Vector3());
      for (let i = 0; i < n; i++) {
        const r = Math.random(), k = i * 3;
        if (r < 0.4) {                       // mountain ridge line, double-layer
          const x = cam.x + (Math.random() - 0.5) * 1100, z = cam.z - 420 - Math.random() * 200;
          const h = 30 + 90 * Math.abs(Math.sin(x * 0.011) * Math.sin(x * 0.0037 + 1)) + Math.random() * 20;
          out[k] = x; out[k + 1] = Math.random() * h; out[k + 2] = z;
        } else if (r < 0.7) {                // sun disc + ring
          const a = Math.random() * 6.2832, rad = 60 + Math.random() * (Math.random() < 0.5 ? 90 : 0) + 20 * Math.random();
          out[k] = sp.x + Math.cos(a) * rad; out[k + 1] = sp.y + Math.sin(a) * rad; out[k + 2] = sp.z;
        } else {                             // floor grid
          out[k] = cam.x + (Math.random() - 0.5) * 900; out[k + 1] = -2; out[k + 2] = cam.z - 60 - Math.random() * 700;
        }
      }
      return true;
    },
    dispose() {
      dir.dispose();
      for (const k of ORDER) { try { modules[k].dispose(); } catch (e) { /* module already gone */ } }
      stage.remove(curtain);
    },
  };
  return inst;
}
