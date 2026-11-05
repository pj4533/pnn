// Shared env contract: ctx (live uniforms shared by every env module), GLSL snippets, phase helper.
export function createEnvCtx(THREE, { time, alert, accent, accent2 } = {}) {
  THREE_REF = THREE_REF || THREE;
  const N = 256, d = new Uint8Array(N * N * 4);
  // 4 independent channels of white noise; LinearFilter + mipmaps make it a smooth tiling value-noise lookup
  let s = 1234567;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s & 255; }
  const noiseTex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter; noiseTex.minFilter = THREE.LinearMipmapLinearFilter; noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return {
    THREE, time: time || { value: 0 }, alert: alert || { value: 0 },
    accent: accent || { value: new THREE.Color('#ff2bd6') }, accent2: accent2 || { value: new THREE.Color('#00f0ff') },
    flash: { value: 0 },
    fogCol: { value: new THREE.Color(0.13, 0.015, 0.13) },
    sunDir: { value: new THREE.Vector3(-0.2, 0.1, -1).normalize() },
    res: { value: new THREE.Vector2(1920, 1080) },                       // drawing-buffer px
    guardRect: { value: new THREE.Vector4(0.30, 0.30, 0.985, 0.93) },    // stage rect in gl_FragCoord/res (bottom-up)
    guardAmt: { value: 0.45 },
    ...heroUniforms(THREE),                                              // shared projector-stage uniforms (by reference)
    noiseTex,
    quality: 2,
  };
}

// Projector stage (hero) uniforms: ONE shared set for every scene, transition, env module and the stage rig, written
// each frame by stage.js. uHero = (cx, cy, rx, ry) bottom-up uv ellipse fitted to the widget; uHeroW = (world xyz, worldR);
// uStory = (dir -1|0|1, energy 0..1, swing 0|1, pulse 0..1); uStoryCol = story colour; uStoryColA = theme colour A.
let HERO = null;
export function heroUniforms(THREE) {
  if (!HERO) HERO = {
    uHero: { value: new THREE.Vector4(0.64, 0.6, 0.2, 0.25) }, uHeroW: { value: new THREE.Vector4(0, 10, 0, 15) },
    uStory: { value: new THREE.Vector4(0, 0.3, 0, 0) }, uStoryCol: { value: new THREE.Color('#00f0ff') }, uStoryColA: { value: new THREE.Color('#ff2bd6') },
  };
  return HERO;
}
export const HERO_KEYS = ['uHero', 'uHeroW', 'uStory', 'uStoryCol', 'uStoryColA'];

// GUARD: the calm "eye" around the widget. guard() keeps its name/signature (1 outside, 1-uGuardAmt in the calm core)
// but the rectangle is gone: an ellipse fitted to the widget's projected box, plus rim() = the eye-wall band at ~1.35x
// where every scene gathers its signature effect. A material missing the hero uniforms (uHero.z == 0) falls back to
// the old stage-rect box so nothing ever goes un-guarded.
export const GLSL = {
  GUARD: `uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
uniform vec4 uHero; uniform vec4 uHeroW; uniform vec4 uStory; uniform vec3 uStoryCol; uniform vec3 uStoryColA;
float heroSq(float x){ return x * x; }
vec2 heroD(vec2 q){ return (q - uHero.xy) / max(uHero.zw, vec2(1e-3)); }
float heroR(vec2 q){ return length(heroD(q)); }
float eye(){ vec2 q = gl_FragCoord.xy / uRes; if (uHero.z < 1e-4) { vec2 m = smoothstep(uGuardRect.xy - 0.08, uGuardRect.xy, q) * (1. - smoothstep(uGuardRect.zw, uGuardRect.zw + 0.08, q)); return 1. - m.x * m.y; } return smoothstep(0.78, 1.18, heroR(q)); }
float rim(){ if (uHero.z < 1e-4) return 0.; float r = heroR(gl_FragCoord.xy / uRes); return exp(-heroSq((r - 1.35) * 3.2)); }
vec2 heroFlow(vec2 q){ vec2 d = heroD(q); vec2 t = vec2(-d.y, d.x); return normalize(t * 1.0 - d * 0.35 * uStory.x + 1e-5); }
float guard(){ return 1. - uGuardAmt * (1. - eye()); }`,
  PALETTE: `vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(6.28318*(c*t+d)); }`,
};

export function guardUniforms(ctx) {
  const H = ctx.uHero ? ctx : heroUniforms(ctx.THREE || THREE_REF);
  return { uRes: ctx.res, uGuardRect: ctx.guardRect, uGuardAmt: ctx.guardAmt, uHero: H.uHero, uHeroW: H.uHeroW, uStory: H.uStory, uStoryCol: H.uStoryCol, uStoryColA: H.uStoryColA };
}
let THREE_REF = null;
/** Called once by whoever owns THREE (director/env ctx) so guardUniforms works for ctx objects without THREE. */
export function setThreeRef(T) { THREE_REF = T; }

export function makePhase(v = 0) {
  return { v, add(dt, rate, period) { this.v += dt * rate; if (period) this.v -= Math.floor(this.v / period) * period; return this.v; } };
}
