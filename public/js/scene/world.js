// Persistent background world: a thin facade over the scene director (scenes/director.js), which rotates 12
// full-screen synthwave scenes, beat-synced to card changes, with showy transitions. The former living environment
// (env/*) now lives on as the `outrunClassic` scene. Public API unchanged: accent, accent2, alert, setTheme, setAlert,
// event, shockwave, attachPost, resize, setPixelRatio, setQuality, env (= director: getState, cameraBias), tick,
// dispose; plus beat(info), warm(renderer, camera) and setStageRect(rect).
import * as THREE from '../../vendor/three/three.module.js';
import { TIME, damp } from './holo.js';
import { createEnvCtx } from './env/common.js';
import { createSceneDirector } from './scenes/director.js';

export function createWorld(scene, { renderer, camera, opts = {} } = {}) {
  const accent = { value: new THREE.Color('#ff2bd6') };
  const accent2 = { value: new THREE.Color('#00f0ff') };
  const alert = { value: 0 };                                  // 0..1 breaking-news red mode
  const tgtAccent = new THREE.Color('#ff2bd6'), tgtAccent2 = new THREE.Color('#00f0ff');
  let alertTarget = 0;

  // shared noise texture + guard uniforms (one guard mechanism for every scene)
  const envCtx = createEnvCtx(THREE, { time: TIME, alert, accent, accent2 });
  envCtx.guardAmt.value = 0.55;
  const director = createSceneDirector({
    renderer, camera, mainScene: scene, opts,
    ctxShared: { time: TIME, alert, accent, accent2, guardRect: envCtx.guardRect, guardAmt: envCtx.guardAmt, noise: envCtx.noiseTex },
  });

  return {
    accent, accent2, alert, env: director, director,
    setTheme(a, b) { tgtAccent.copy(a); tgtAccent2.copy(b); },
    setAlert(on) { alertTarget = on ? 1 : 0; },
    setPixelRatio() {},                       // scenes size points from ctx.res (drawing-buffer px)
    attachPost(post) { director.attachPost(post); },
    resize(pxW, pxH) { director.resize(pxW, pxH); },
    setQuality(l) { director.setQuality(l); },
    event(type, data) { director.event(type, data); },
    shockwave(x, z, color) { director.shockwave(x, z, color || new THREE.Color('#00f0ff')); },
    beat(info) { return director.beat(info); },
    warm() { return director.warm(); },
    /** Overlay stage rect (viewport fractions, top-down) -> guard rect (bottom-up) + subject point. */
    setStageRect(r) {
      if (!r) return;
      envCtx.guardRect.value.set(r.x0, 1 - r.y1, r.x1, 1 - r.y0);
      director.setSubject((r.x0 + r.x1) / 2, 1 - (r.y0 + r.y1) / 2);
    },
    tick(dt, t, camera_) {
      accent.value.lerp(tgtAccent, 1 - Math.exp(-1.5 * dt));
      accent2.value.lerp(tgtAccent2, 1 - Math.exp(-1.5 * dt));
      alert.value = damp(alert.value, alertTarget, alertTarget ? 8 : 2.5, dt);
      director.update(dt, t, camera_);
    },
    dispose() {
      director.dispose();
      envCtx.noiseTex.dispose();
    },
  };
}
