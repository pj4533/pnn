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

  // ---- reveal hooks added without touching env files
  const frontU = { value: -1000 };
  const gridMat = modules.grid.mesh.material;
  gridMat.uniforms.uFront = frontU; gridMat.uniforms.uRimCol = { value: new THREE.Color() };
  gridMat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader
      .replace('uniform vec3 uFog;', 'uniform vec3 uFog; uniform float uFront; uniform vec3 uRimCol;')
      .replace('c *= guard();', `float vis = smoothstep(uFront - 30., uFront + 30., d);
  float rim = exp(-pow((d - uFront) / 22., 2.)) * step(-500., uFront);
  c = c * vis + uRimCol * rim * (1.2 + l * 2.);
  c *= guard();`);
  };
  const tChildren = modules.terrain.group.children;
  const terrainU = tChildren[0].material.uniforms;       // uAmp is shared across the layers
  const skylineU = tChildren[tChildren.length - 1].material.uniforms;
  const sunMesh = modules.sun.mesh, sunU = sunMesh.material.uniforms;

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
      else if (type === 'story' && data && data.x != null) modules.grid.setPolarOrigin(data.x, data.z);
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
      for (let i = 0; i < ORDER.length; i++) modules[ORDER[i]].update(dt, t, cam);
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
