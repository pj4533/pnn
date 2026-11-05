// Scene contract helpers: the per-instance ctx factory, shared GLSL chunks, seeded rng.
// One guard mechanism: GLSL.GUARD / GLSL.PALETTE / guardUniforms come from env/common.js.
import * as THREE from '../../../vendor/three/three.module.js';
import { GPUComputationRenderer } from '../../../vendor/three/addons/misc/GPUComputationRenderer.js';
import { GLSL as ENV_GLSL, guardUniforms, heroUniforms, HERO_KEYS, setThreeRef } from '../env/common.js';
setThreeRef(THREE);

export { guardUniforms };

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const UNIFORMS = `uniform float uTime, uAlert, uPulse, uFade; uniform vec3 uAccent, uAccent2; uniform sampler2D uNoise;`;
// the `guard` sub-chunk carries the hero uniforms + eye/rim/heroFlow helpers so a scene adding only it still compiles
const GUARD_FN = ENV_GLSL.GUARD.slice(ENV_GLSL.GUARD.indexOf('uniform vec4 uHero;'));
const HELPERS = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3. - 2. * f);
  vec2 uv = (i.xy + vec2(37., 17.) * i.z) + f.xy; vec2 rg = texture2D(uNoise, (uv + .5) / 256.).yx; return mix(rg.x, rg.y, f.z); }
float fbm(vec3 p, int oct){ float v = 0., a = .5, s = 0.; for (int i = 0; i < 4; i++) { if (i >= oct) break; v += a * vnoise(p); s += a; p = p * 2.03 + 17.1; a *= .5; } return v / max(s, 1e-4); }
vec3 pal(float t){ return .5 + .5 * cos(6.28318 * (t + vec3(0., .33, .67))); }
${ENV_GLSL.PALETTE}`;
const ALERT_MIX = `vec3 alertMix(vec3 c){ float l = dot(c, vec3(.2126, .7152, .0722)); vec3 r = mix(vec3(1., .07, .03), vec3(1., .5, .1), clamp(l * .6, 0., 1.)) * l * 1.5; return mix(c, r, uAlert); }`;
const FINISH = `vec3 finish(vec3 c){ c = alertMix(c) * guard() * (1. + rim() * (0.2 + 0.3 * uStory.y + 0.5 * uStory.w)) * uFade; float l = dot(c, vec3(.2126, .7152, .0722)); c *= l > 2.5 ? 2.5 / l : 1.; return max(c, 0.); }`;

// COMMON is fragment-only (guard reads gl_FragCoord). Each sub-chunk is a verbatim substring of COMMON so scene
// preamble builders that "add whatever is missing" never redeclare.
export const GLSL = {
  COMMON: `${UNIFORMS}\n${ENV_GLSL.GUARD}\n${HELPERS}\n${ALERT_MIX}\n${FINISH}\n`,
  GUARD: ENV_GLSL.GUARD, PALETTE: ENV_GLSL.PALETTE,
  guard: GUARD_FN, alertMix: ALERT_MIX, finish: FINISH,
};

const FS_TRI = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
const BACK_VS = 'void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }';
const LAYER_VS = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** Build the ctx a scene's create(ctx) receives. `sh` holds the director-shared uniforms; `inst` collects per-instance
 * bookkeeping (tracked resources, anchors, layer) that the director reads every frame and on dispose. */
export function createSceneCtx({ renderer, camera, sh, quality, opts, seed, inst, allocLayer }) {
  const stage = new THREE.Scene();
  stage.matrixWorldAutoUpdate = true;
  const localTime = { value: 0 }, fade = { value: 0 };
  inst.tracked = []; inst.anchors = []; inst.pulseFns = []; inst.layer = null; inst.localTime = localTime; inst.fade = fade; inst.stage = stage;
  const track = (...objs) => { for (const o of objs) if (o) inst.tracked.push(o); return objs[0]; };
  const tri = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(FS_TRI.slice(), 3)); return track(g); };
  const common = () => ({
    uTime: localTime, uAlert: sh.alert, uPulse: sh.pulse, uFade: fade, uAccent: sh.accent, uAccent2: sh.accent2,
    uRes: sh.res, uGuardRect: sh.guardRect, uGuardAmt: sh.guardAmt, uNoise: { value: sh.noise },
    uHero: sh.uHero, uHeroW: sh.uHeroW, uStory: sh.uStory, uStoryCol: sh.uStoryCol, uStoryColA: sh.uStoryColA,
  });
  const ctx = {
    THREE, renderer, camera, stage, quality, rnd: mulberry32(seed >>> 0), opts,
    time: sh.time, localTime, alert: sh.alert, pulse: sh.pulse, fade, accent: sh.accent, accent2: sh.accent2,
    res: sh.res, guardRect: sh.guardRect, guardAmt: sh.guardAmt, sharedNoise: sh.noise,
    uHero: sh.uHero, uHeroW: sh.uHeroW, uStory: sh.uStory, uStoryCol: sh.uStoryCol, uStoryColA: sh.uStoryColA,
    // the projector stage (anchor, story, pulse); `stage` stays this scene's THREE.Scene
    get hero() { return sh.hero || null; },
    /** Subscribe to hero pulses ({ type, strength, color, screen, world }); unsubscribed automatically on dispose. */
    onHeroPulse(fn) { (inst.pulseFns || (inst.pulseFns = [])).push(fn); return () => { const i = inst.pulseFns.indexOf(fn); if (i >= 0) inst.pulseFns.splice(i, 1); }; },
    common, GLSL, track,
    backdrop(material) {
      if (!material.vertexShader || /projectionMatrix/.test(material.vertexShader)) material.vertexShader = BACK_VS;
      material.depthTest = false; material.depthWrite = false;
      track(material);
      const m = new THREE.Mesh(tri(), material);
      m.renderOrder = -1000; m.frustumCulled = false;
      stage.add(m);
      return m;
    },
    layer(material, { scale = 0.5 } = {}) {
      if (inst.layer) throw new Error('one layer per scene');
      if (!material.vertexShader || /projectionMatrix/.test(material.vertexShader)) material.vertexShader = LAYER_VS;
      material.depthTest = false; material.depthWrite = false;
      track(material);
      const rt = allocLayer(scale);
      const scene = new THREE.Scene();
      const m = new THREE.Mesh(tri(), material); m.frustumCulled = false; scene.add(m);
      inst.layer = { material, scene, rt, scale };
      return { texture: rt.texture, uniforms: material.uniforms, rt };
    },
    backdropFromLayer(layer, { tint = new THREE.Color(1, 1, 1), add = false } = {}) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...common(), tLayer: { value: layer.texture }, uTint: { value: tint } },
        vertexShader: BACK_VS,
        fragmentShader: `${GLSL.COMMON}\nuniform sampler2D tLayer; uniform vec3 uTint;\nvoid main(){ vec3 col = texture2D(tLayer, gl_FragCoord.xy / uRes).rgb * uTint; gl_FragColor = vec4(finish(col), 1.0); }`,
        blending: add ? THREE.AdditiveBlending : THREE.NoBlending, transparent: add,
      });
      return ctx.backdrop(mat);
    },
    anchor(object3d, { parallax = 0.15, y = null, z = null } = {}) { inst.anchors.push({ o: object3d, k: 1 - parallax, y, z }); return object3d; },
    gpgpu(size, simFragment, { init = null, name = 'tSim' } = {}) {
      const n = Math.min(256, size | 0);
      const gpu = new GPUComputationRenderer(n, n, renderer);
      gpu.setDataType(THREE.HalfFloatType);
      const tex = gpu.createTexture();
      if (init) init(tex.image.data, n);
      const variable = gpu.addVariable(name, simFragment, tex);
      gpu.setVariableDependencies(variable, [variable]);
      variable.minFilter = variable.magFilter = THREE.NearestFilter;
      const err = gpu.init();
      if (err) throw new Error('gpgpu: ' + err);
      track({ dispose: () => gpu.dispose() });
      return { gpu, variable, uniforms: variable.material.uniforms, compute: () => gpu.compute(), texture: () => gpu.getCurrentRenderTarget(variable).texture };
    },
  };
  return ctx;
}

/** Dispose everything a scene instance owns: tracked objects plus anything left in its stage (never shared refs). */
export function disposeInstance(inst, shared) {
  const seen = new Set();
  const kill = (o) => {
    if (!o || seen.has(o) || o === shared.noise) return; seen.add(o);
    try { o.dispose?.(); } catch (e) { /* already gone */ }
  };
  for (const o of inst.tracked || []) kill(o);
  inst.stage?.traverse((o) => {
    kill(o.geometry);
    const m = o.material; if (Array.isArray(m)) m.forEach(kill); else kill(m);
  });
  if (inst.layer) inst.layer.scene.clear();
  inst.stage?.clear();
  inst.tracked = []; inst.anchors = []; inst.pulseFns = [];
}

/** Give every ShaderMaterial whose shader reads the hero uniforms the shared refs it is missing (env modules and
 * scenes that list uniforms by hand), so the calm eye never silently falls back. Cheap: runs once per instance. */
export function patchHeroUniforms(root, sh) {
  root?.traverse?.((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      if (!m.isShaderMaterial || !m.uniforms || !/uHero|uStory/.test(m.fragmentShader + m.vertexShader)) continue;
      for (const k of HERO_KEYS) if (!m.uniforms[k]) m.uniforms[k] = sh[k];
    }
  });
}
export { heroUniforms };
