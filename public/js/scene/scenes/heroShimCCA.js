// Shared "hero" (widget at the centre of the stage) helpers for curlSwarm, chromeBlobs and auroraFireworks.
// Contract: uHero (cx, cy, rx, ry in bottom-up uv), uHeroW, uStory (dir, energy, swing, pulse), uStoryCol, uStoryColA.
// When the stage core is merged these arrive through ctx.common() and the COMMON GLSL already declares them; before that
// the shim declares and feeds them itself (from ctx.hero if present, else the old stage-rect centre) and swaps the
// rectangular guard() for the calm-ellipse eye, so the scenes look right either way. All of this is a no-op after merge.

export const HERO_UNI = 'uniform vec4 uHero; uniform vec4 uHeroW; uniform vec4 uStory; uniform vec3 uStoryCol; uniform vec3 uStoryColA;\n';

// Pure helpers (own names, never clash with the core's heroD/heroR/eye/rim). q is bottom-up uv.
export const HERO_FN = `
vec2 hD(vec2 q){ return (q - uHero.xy) / max(uHero.zw, vec2(1e-3)); }
float hR(vec2 q){ return length(hD(q)); }
float hEye(vec2 q){ return smoothstep(0.78, 1.18, hR(q)); }
float hRim(vec2 q){ float r = hR(q); return exp(-pow(abs((r - 1.35) * 3.2), 2.0)); }
vec2 hFlow(vec2 q){ vec2 d = hD(q); vec2 t = vec2(-d.y, d.x); return normalize(t - d * 0.35 * uStory.x + 1e-5); }
`;

const EYE_GUARD = 'float guard(){ vec2 d=(gl_FragCoord.xy/uRes-uHero.xy)/max(uHero.zw,vec2(1e-3)); return 1.-uGuardAmt*(1.-smoothstep(0.78,1.18,length(d))); }';
const OLD_GUARD = /float\s+guard\s*\(\s*\)\s*\{[^\n]*?return[^\n]*?\}/;

/** Patch a fragment prelude (COMMON etc.): declare hero uniforms and swap in the eye guard when the core isn't there. */
export function patchHero(s) {
  if (/\bheroD\s*\(/.test(s)) return s;                      // core merged: nothing to do
  if (!/\buHero\b/.test(s)) s = HERO_UNI + s;
  s = s.replace(OLD_GUARD, EYE_GUARD);
  s = s.replace(/(vec3\s+finish\s*\(\s*vec3\s+c\s*\)\s*\{\s*c\s*=\s*alertMix\(c\)\s*\*\s*guard\(\)\s*)\*\s*uFade;/,
    '$1* uFade * (1. + exp(-pow(abs((length((gl_FragCoord.xy/uRes-uHero.xy)/max(uHero.zw,vec2(1e-3)))-1.35)*3.2),2.))*(0.25+0.45*uStory.y+0.6*uStory.w));');
  return s;
}

/** The five hero uniforms (by reference from ctx.common() when the core is there, else local ones the shim feeds). */
export function heroUniforms(ctx) {
  const c = ctx.common ? ctx.common() : {};
  const T = ctx.THREE;
  if (c.uHero && c.uStory) {
    return { live: true, u: { uHero: c.uHero, uHeroW: c.uHeroW, uStory: c.uStory, uStoryCol: c.uStoryCol, uStoryColA: c.uStoryColA } };
  }
  const acc = ctx.accent2 ? ctx.accent2.value : new T.Color('#00f0ff'), acc1 = ctx.accent ? ctx.accent.value : new T.Color('#ff2bd6');
  const H = {
    live: false,
    u: {
      uHero: { value: new T.Vector4(0.64, 0.6, 0.2, 0.25) }, uHeroW: { value: new T.Vector4(0, 0, 0, 1) },
      uStory: { value: new T.Vector4(0, 0.35, 0, 0) },
      uStoryCol: { value: new T.Color().copy(acc) }, uStoryColA: { value: new T.Color().copy(acc1) },
    },
  };
  try { (window.__heroFallback = window.__heroFallback || []).push(H.u); } catch (e) { /* no window */ }   // dev: poke the story before the core lands
  return H;
}

/** Feed the fallback uniforms each frame (no-op when the core owns them). */
export function heroSync(H, ctx, info, dt = 0) {
  if (H.live) return;
  const hero = (info && info.hero) || ctx.hero;
  const u = H.u;
  if (hero && hero.anchor && hero.story) {
    u.uHero.value.set(hero.anchor.screen.x, hero.anchor.screen.y, hero.anchor.radius.x, hero.anchor.radius.y);
    u.uHeroW.value.set(hero.anchor.world.x, hero.anchor.world.y, hero.anchor.world.z, hero.anchor.worldR);
    u.uStory.value.set(hero.story.dir, hero.story.energy, hero.story.swing ? 1 : 0, hero.pulse || 0);
    u.uStoryCol.value.copy(hero.story.color); u.uStoryColA.value.copy(hero.story.colorA);
  } else {
    const g = ctx.guardRect.value;
    u.uHero.value.set((g.x + g.z) * 0.5, (g.y + g.w) * 0.5, 0.2, 0.25);
    u.uStory.value.w = Math.max(0, u.uStory.value.w - dt * 2.2);
    u.uStoryCol.value.copy(ctx.accent2.value); u.uStoryColA.value.copy(ctx.accent.value);
  }
}
