// Shared env contract: ctx (live uniforms shared by every env module), GLSL snippets, phase helper.
export function createEnvCtx(THREE, { time, alert, accent, accent2 } = {}) {
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
    noiseTex,
    quality: 2,
  };
}

export const GLSL = {
  GUARD: `uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
float guard(){ vec2 q=gl_FragCoord.xy/uRes; vec2 m=smoothstep(uGuardRect.xy-0.08,uGuardRect.xy,q)*(1.-smoothstep(uGuardRect.zw,uGuardRect.zw+0.08,q)); return 1.-uGuardAmt*m.x*m.y; }`,
  PALETTE: `vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(6.28318*(c*t+d)); }`,
};

export function guardUniforms(ctx) { return { uRes: ctx.res, uGuardRect: ctx.guardRect, uGuardAmt: ctx.guardAmt }; }

export function makePhase(v = 0) {
  return { v, add(dt, rate, period) { this.v += dt * rate; if (period) this.v -= Math.floor(this.v / period) * period; return this.v; } };
}
