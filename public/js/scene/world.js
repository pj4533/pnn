// Persistent synthwave world: a thin facade over the living environment (env/*). Six param-driven modules (sky,
// sun, terrain, grid, particles, atmos) are driven by env/director.js, which cross-fades between named moods and
// wanders every param slowly. Public API unchanged: accent, accent2, alert, setTheme, setAlert, shockwave, tick, dispose.
import * as THREE from '../../vendor/three/three.module.js';
import { TIME, damp } from './holo.js';
import { createEnvCtx } from './env/common.js';
import { createSky } from './env/sky.js';
import { createSun } from './env/sun.js';
import { createTerrain } from './env/terrain.js';
import { createGrid } from './env/grid.js';
import { createParticles } from './env/particles.js';
import { createAtmos } from './env/atmos.js';
import { createDirector } from './env/director.js';

export function createWorld(scene, opts = {}) {
  const accent = { value: new THREE.Color('#ff2bd6') };        // far grid tint (theme a)
  const accent2 = { value: new THREE.Color('#00f0ff') };       // near grid tint (theme b)
  const alert = { value: 0 };                                  // 0..1 breaking-news red mode
  const tgtAccent = new THREE.Color('#ff2bd6'), tgtAccent2 = new THREE.Color('#00f0ff');
  let alertTarget = 0;

  const ctx = createEnvCtx(THREE, { time: TIME, alert, accent, accent2 });
  const modules = {
    sky: createSky(scene, ctx), sun: createSun(scene, ctx), terrain: createTerrain(scene, ctx),
    grid: createGrid(scene, ctx), particles: createParticles(scene, ctx), atmos: createAtmos(scene, ctx),
  };
  const director = createDirector({ ctx, modules, post: null, opts });
  director.tick(0, 0, null);   // push the starting mood's params before warmup compiles/draws everything
  const ORDER = ['sun', 'sky', 'terrain', 'grid', 'atmos', 'particles'];   // sun first: it writes ctx.sunDir

  return {
    accent, accent2, alert, env: director, ctx, modules,
    setTheme(a, b) { tgtAccent.copy(a); tgtAccent2.copy(b); },
    setAlert(on) { alertTarget = on ? 1 : 0; },
    setPixelRatio() {},                       // env modules size points from ctx.res (drawing-buffer px)
    attachPost(post) { director.attachPost(post); },
    resize(pxW, pxH) { ctx.res.value.set(pxW, pxH); },
    setQuality(l) { director.setQuality(l); },
    event(type, data) { director.event(type, data); },
    shockwave(x, z, color) { modules.grid.shockwave(x, z, color || new THREE.Color('#00f0ff')); },
    tick(dt, t, camera) {
      accent.value.lerp(tgtAccent, 1 - Math.exp(-1.5 * dt));
      accent2.value.lerp(tgtAccent2, 1 - Math.exp(-1.5 * dt));
      alert.value = damp(alert.value, alertTarget, alertTarget ? 8 : 2.5, dt);
      director.tick(dt, t, camera);
      for (const k of ORDER) modules[k].update(dt, t, camera);
    },
    dispose() {
      director.dispose();
      for (const k of ORDER) { try { modules[k].dispose(); } catch {} }
      ctx.noiseTex.dispose();
    },
  };
}
