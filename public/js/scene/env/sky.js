// Living-environment sky dome: gradient + palette drift + horizon band (cheap, per pixel), plus an offscreen
// lat-long "dynamic sky" (FBM clouds, domain-warped nebula, aurora curtains, faint sky dust) rendered at a fixed
// 1024x384 at 8/15/30 Hz into two ping-pong RTs that the dome cross-fades by frame fraction.
// All time-varying inputs are JS-accumulated, wrapped phases (24/7 precision rule).
import * as THREE from '../../../vendor/three/three.module.js';

const TAU = Math.PI * 2;
const RT_W = 1024, RT_H = 384;
const EL_MIN = -5 * Math.PI / 180, EL_MAX = 60 * Math.PI / 180;
const RATE_HZ = [8, 15, 30];
const OCTAVES = [3, 4, 5];
const HORIZON_GAIN = 0.18;   // mood horizon hex is a hue; old look had linear horizon ~0.16
const GLOW_GAIN = 0.3;       // glow line gain (old: 0.6 * (0.5,0.05,0.4))
const LUM_CAP = 0.35;

const DEF = {
  zenith: '#05000f', mid: '#1a0533', horizon: '#ff2a8a', glow: '#ff6ad5',
  palA: [0.5, 0.5, 0.5], palB: [0.5, 0.5, 0.5], palC: [1, 1, 1], palD: [0.0, 0.33, 0.67],
  palDrift: 0, bandAmt: 1, cloudAmt: 0.25, cloudScale: 1, cloudSpeed: 1,
  nebulaAmt: 0.1, warp: 0.5, auroraAmt: 0, auroraHue: 0.35, auroraSpeed: 1, starAmt: 0.7,
};

function makeNoiseTex() {
  const N = 256, d = new Uint8Array(N * N * 4);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 256) | 0;
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const GUARD_GLSL = `uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
float guard(){ vec2 q=gl_FragCoord.xy/uRes; vec2 m=smoothstep(uGuardRect.xy-0.08,uGuardRect.xy,q)*(1.-smoothstep(uGuardRect.zw,uGuardRect.zw+0.08,q)); return 1.-uGuardAmt*m.x*m.y; }`;

// ---------- offscreen dynamic-sky pass ----------
const RT_VERT = `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`;
const RT_FRAG = `precision highp float;
uniform sampler2D uNoise; uniform int uOct;
uniform float uCloudAmt, uCloudScale, uNebulaAmt, uWarp, uAuroraAmt, uAuroraHue, uStarAmt;
uniform vec2 uCloudOff, uCloudOff2, uNebOff, uNebOff2, uAurOff; uniform float uAurPh, uPalPh;
uniform vec3 uPalA, uPalB, uPalC, uPalD, uHorizon, uGlow, uMid;
uniform vec3 uSunDir;
varying vec2 vUv;
const float PI = 3.14159265;
vec3 pal(float t){ return uPalA + uPalB*cos(6.28318*(uPalC*t + uPalD)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
// noise coordinates are in texture-uv units: offsets wrap at 1.0, octave scale exactly 2.0 keeps wraps seamless
float fbmR(vec2 p){ float v=0., a=0.5, s=0.; for(int i=0;i<6;i++){ if(i>=uOct) break; v+=a*texture2D(uNoise,p).r; s+=a; p=p*2.0+vec2(0.371,0.713); a*=0.5; } return v/s; }
float fbmG(vec2 p){ float v=0., a=0.5, s=0.; for(int i=0;i<6;i++){ if(i>=uOct) break; v+=a*texture2D(uNoise,p).g; s+=a; p=p*2.0+vec2(0.193,0.557); a*=0.5; } return v/s; }
float fbmB(vec2 p){ float v=0., a=0.5, s=0.; for(int i=0;i<6;i++){ if(i>=uOct) break; v+=a*texture2D(uNoise,p).b; s+=a; p=p*2.0+vec2(0.631,0.281); a*=0.5; } return v/s; }
void main(){
  float az = (vUv.x - 0.5) * 6.28318;
  float el = mix(${EL_MIN.toFixed(6)}, ${EL_MAX.toFixed(6)}, vUv.y);
  vec3 d = vec3(sin(az)*cos(el), sin(el), -cos(az)*cos(el));
  vec3 col = vec3(0.0); float occ = 0.0;
  float sunF = max(dot(d, uSunDir), 0.0);

  // nebula: IQ domain warp, upper sky
  if (uNebulaAmt > 0.002) {
    vec2 p = vec2(d.x + d.y*0.45, d.z - d.y*0.3) * 0.55;
    vec2 q = vec2(fbmR(p + uNebOff), fbmG(p + vec2(0.52,0.13) - uNebOff2));
    vec2 r = vec2(fbmG(p + 4.0*uWarp*q + vec2(0.17,0.92)), fbmB(p + 4.0*uWarp*q + vec2(0.83,0.28) + uNebOff2));
    float f = fbmB(p + 4.0*uWarp*r);
    float dens = smoothstep(0.38, 0.78, f) * (0.55 + 0.45*length(q));
    vec3 nc = pal(f*0.9 + length(r)*0.35 + uPalPh);
    float mask = smoothstep(0.02, 0.3, d.y);
    col += nc * dens * dens * mask * uNebulaAmt * 0.22;
    col += uMid * 1.5 * smoothstep(0.3, 0.6, f) * mask * uNebulaAmt; // dust glow
  }

  // faint sky dust band (great circle, tilted)
  if (uStarAmt > 0.002) {
    float g = abs(dot(d, normalize(vec3(0.35, 0.6, 0.72))));
    float b = exp(-g*g*28.0) * smoothstep(0.0, 0.15, d.y);
    float n = fbmR(vec2(d.x*1.3+d.z*0.4, d.y*1.7) + vec2(0.31,0.77));
    col += mix(uGlow, vec3(0.6,0.7,1.0), 0.5) * b * smoothstep(0.35, 0.8, n) * uStarAmt * 0.035;
  }

  // aurora curtains: 12 constant steps through a slab, vertical stretch, green->cyan->magenta ramp
  if (uAuroraAmt > 0.002 && d.y > 0.01) {
    float jit = hash12(gl_FragCoord.xy);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float fi = (float(i) + jit) / 12.0;
      float h = 0.35 + fi * 0.9;                      // slab height (sky units)
      vec2 xz = d.xz * (h / max(d.y, 0.16));         // clamp: near the horizon (all the camera sees) curtains stay broad, not hairline stripes
      vec2 qa = xz * 0.11;
      float band = qa.y + 0.35*sin(qa.x*1.6 + uAurPh) + 0.6*(texture2D(uNoise, qa*0.05 + uAurOff).g - 0.5);
      float rib = exp(-pow(fract(band*0.9) - 0.5, 2.0) * 60.0);
      float rays = texture2D(uNoise, vec2(qa.x*0.35 + band*0.02, 0.37) + uAurOff*2.0).r;
      float dens = rib * (0.35 + 0.65*rays*rays) * (1.0 - fi) * (1.0 - fi*0.5);
      vec3 ramp = mix(vec3(0.1,1.0,0.45), vec3(0.1,0.85,1.0), smoothstep(0.1, 0.55, fi));
      ramp = mix(ramp, vec3(0.95,0.25,0.9), smoothstep(0.5, 1.0, fi));
      float hs = (uAuroraHue - 0.35) * 6.28318;       // hue rotate around grey axis
      vec3 k = vec3(0.57735); float cs = cos(hs), sn = sin(hs);
      ramp = ramp*cs + cross(k, ramp)*sn + k*dot(k, ramp)*(1.0-cs);
      acc += max(ramp, 0.0) * dens;
    }
    col += acc / 12.0 * uAuroraAmt * smoothstep(0.0, 0.035, d.y) * 2.4;   // visible in the low sky band above the mountains
  }

  // clouds: low, banded, lit from the horizon/sun side
  if (uCloudAmt > 0.002) {
    vec2 p = d.xz / (max(d.y, 0.0) + 0.09) * 0.06 * uCloudScale;
    float f = fbmR(p + uCloudOff) * 0.65 + fbmG(p*vec2(0.5,2.2) + uCloudOff2) * 0.35;
    float th = mix(0.62, 0.38, uCloudAmt);
    float c = smoothstep(th, th + 0.22, f);
    float elm = smoothstep(-0.06, 0.01, d.y) * (1.0 - smoothstep(0.18, 0.55, d.y));
    c *= elm * min(uCloudAmt * 1.6, 1.0);
    occ = c * 0.75;
    float rim = smoothstep(th + 0.05, th + 0.3, f) * 0.6 + 0.4;
    vec3 lit = uHorizon * ${HORIZON_GAIN} * 0.9 * (1.0 - smoothstep(0.0, 0.3, d.y)) + uGlow * 0.12 * pow(sunF, 6.0);
    col = col * (1.0 - occ) + lit * c * rim;
  }
  gl_FragColor = vec4(col, occ);
}`;

// ---------- dome ----------
const DOME_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const DOME_FRAG = `precision highp float;
${GUARD_GLSL}
uniform vec3 uZenith, uMid, uHorizon, uGlow, uPalA, uPalB, uPalC, uPalD, uSunDir, uBolt;
uniform float uPalDrift, uBandAmt, uPalPh, uFlash, uAlert, uAlertPh, uDyn, uFrac;
uniform vec2 uBandOff;
uniform sampler2D uNoise, uDynA, uDynB;
varying vec3 vDir;
vec3 pal(float t){ return uPalA + uPalB*cos(6.28318*(uPalC*t + uPalD)); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 hor = uHorizon * ${HORIZON_GAIN};
  vec3 c = mix(hor, uMid, smoothstep(-0.02, 0.16, h));
  c = mix(c, uZenith, smoothstep(0.14, 0.7, h));
  if (uPalDrift > 0.002) {
    vec3 pc = pal(uPalPh + h*0.35 + d.x*0.08);
    float l = dot(c, vec3(0.2126,0.7152,0.0722));
    c = mix(c, pc * (l*1.2 + 0.012), uPalDrift * 0.45);
  }
  // horizon band with low-frequency wobble on the line
  float wob = (texture2D(uNoise, d.xz*0.06 + uBandOff).r - 0.5) * 0.025;
  float hb = h - wob;
  c += uGlow * ${GLOW_GAIN} * exp(-abs(hb) * 60.0) * uBandAmt;
  c += hor * 0.35 * exp(-abs(hb) * 14.0) * uBandAmt;
  // dynamic sky (lat-long RT)
  if (uDyn > 0.5) {
    float el = asin(clamp(h, -1.0, 1.0));
    float v = (el - (${EL_MIN.toFixed(6)})) / (${(EL_MAX - EL_MIN).toFixed(6)});
    float u = atan(d.x, -d.z) / 6.28318 + 0.5;
    vec4 a = texture2D(uDynA, vec2(u, clamp(v, 0.002, 0.998)));
    vec4 b = texture2D(uDynB, vec2(u, clamp(v, 0.002, 0.998)));
    vec4 dy = mix(a, b, uFrac);
    float fade = smoothstep(-0.02, 0.03, v) * (1.0 - smoothstep(0.9, 1.0, v));
    c = c * (1.0 - dy.a * fade) + dy.rgb * fade;
  }
  // readability: dim inside the hologram stage, then cap luminance (bloom threshold safety)
  c *= guard();
  float L = dot(c, vec3(0.2126,0.7152,0.0722));
  c *= min(1.0, ${LUM_CAP.toFixed(3)} / max(L, 1e-5));
  // sun glow (allowed over the cap near the sun)
  float sf = max(dot(d, uSunDir), 0.0);
  c += uGlow * (pow(sf, 10.0) * 0.07 + pow(sf, 90.0) * 0.18);
  // lightning flash
  c += uBolt * uFlash * (0.35 + 0.65*smoothstep(-0.05, 0.4, h)) * 0.6;
  c = mix(c, c * vec3(1.6, 0.35, 0.3) + vec3(0.06, 0.0, 0.0) * (0.5 + 0.5 * sin(uAlertPh)), uAlert);
  gl_FragColor = vec4(c, 1.0);
}`;

export function createSky(scene, ctx = {}) {
  const ownNoise = !ctx.noiseTex;
  const noiseTex = ctx.noiseTex || makeNoiseTex();
  const res = ctx.res || { value: new THREE.Vector2(1920, 1080) };
  const guardRect = ctx.guardRect || { value: new THREE.Vector4(0.30, 0.30, 0.985, 0.93) };
  const guardAmt = ctx.guardAmt || { value: 0.45 };
  const alert = ctx.alert || { value: 0 };
  const flash = ctx.flash || { value: 0 };
  const sunDir = ctx.sunDir || { value: new THREE.Vector3(0.2, 0.08, -1).normalize() };

  const col = (h) => new THREE.Color(h).convertSRGBToLinear();
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

  // --- RTs (created once) ---
  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping };
  let rtA = new THREE.WebGLRenderTarget(RT_W, RT_H, rtOpts);
  let rtB = new THREE.WebGLRenderTarget(RT_W, RT_H, rtOpts);
  for (const rt of [rtA, rtB]) { rt.texture.wrapS = THREE.RepeatWrapping; rt.texture.wrapT = THREE.ClampToEdgeWrapping; }

  const ru = {
    uNoise: { value: noiseTex }, uOct: { value: 5 },
    uCloudAmt: { value: 0 }, uCloudScale: { value: 1 }, uNebulaAmt: { value: 0 }, uWarp: { value: 0.5 },
    uAuroraAmt: { value: 0 }, uAuroraHue: { value: 0.35 }, uStarAmt: { value: 0 },
    uCloudOff: { value: new THREE.Vector2() }, uCloudOff2: { value: new THREE.Vector2() },
    uNebOff: { value: new THREE.Vector2() }, uNebOff2: { value: new THREE.Vector2() }, uAurOff: { value: new THREE.Vector2() },
    uAurPh: { value: 0 }, uPalPh: { value: 0 },
    uPalA: { value: v3(DEF.palA) }, uPalB: { value: v3(DEF.palB) }, uPalC: { value: v3(DEF.palC) }, uPalD: { value: v3(DEF.palD) },
    uHorizon: { value: col(DEF.horizon) }, uGlow: { value: col(DEF.glow) }, uMid: { value: col(DEF.mid) },
    uSunDir: { value: new THREE.Vector3().copy(sunDir.value) },
  };
  const rtMat = new THREE.ShaderMaterial({ uniforms: ru, vertexShader: RT_VERT, fragmentShader: RT_FRAG, depthTest: false, depthWrite: false });
  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const tri = new THREE.Mesh(triGeo, rtMat); tri.frustumCulled = false;
  const rtScene = new THREE.Scene(); rtScene.add(tri);
  const rtCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // --- dome ---
  const du = {
    uRes: res, uGuardRect: guardRect, uGuardAmt: guardAmt,
    uZenith: { value: col(DEF.zenith) }, uMid: { value: col(DEF.mid) }, uHorizon: { value: col(DEF.horizon) }, uGlow: { value: col(DEF.glow) },
    uPalA: ru.uPalA, uPalB: ru.uPalB, uPalC: ru.uPalC, uPalD: ru.uPalD,
    uSunDir: sunDir, uBolt: { value: ctx.boltCol?.value || new THREE.Color(0.55, 0.65, 1.0) },
    uPalDrift: { value: 0 }, uBandAmt: { value: 1 }, uPalPh: { value: 0 }, uFlash: flash, uAlert: alert, uAlertPh: { value: 0 },
    uDyn: { value: 1 }, uFrac: { value: 0 }, uBandOff: { value: new THREE.Vector2() },
    uNoise: { value: noiseTex }, uDynA: { value: rtA.texture }, uDynB: { value: rtB.texture },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 48, 24),
    new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: du, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG }),
  );
  mesh.renderOrder = -10; mesh.frustumCulled = false; mesh.name = 'env.sky';
  scene.add(mesh);

  // --- state ---
  const P = {
    palDrift: DEF.palDrift, bandAmt: DEF.bandAmt, cloudAmt: DEF.cloudAmt, cloudScale: DEF.cloudScale, cloudSpeed: DEF.cloudSpeed,
    nebulaAmt: DEF.nebulaAmt, warp: DEF.warp, auroraAmt: DEF.auroraAmt, auroraHue: DEF.auroraHue, auroraSpeed: DEF.auroraSpeed, starAmt: DEF.starAmt,
  };
  let quality = ctx.quality ?? 2, interval = 1 / RATE_HZ[quality], acc = 0, pending = 2; // render both RTs first
  const ph = { c1x: 0, c1y: 0, c2x: 0, c2y: 0, n1x: 0, n1y: 0, n2x: 0, n2y: 0, ax: 0, ay: 0, aur: 0, pal: 0, bx: 0, alert: 0 };
  const w1 = (v) => v - Math.floor(v); // wrap at 1 (noise tile period)
  ru.uOct.value = OCTAVES[quality];

  const setCol = (dst, src) => { if (src == null) return; if (src.isColor) dst.copy(src); else if (typeof src === 'string' || typeof src === 'number') dst.set(src).convertSRGBToLinear(); };
  const setV3 = (dst, src) => { if (src == null) return; if (src.isColor) dst.set(src.r, src.g, src.b); else if (src.isVector3) dst.copy(src); else if (Array.isArray(src)) dst.set(src[0], src[1], src[2]); };

  function dynActive() { return P.cloudAmt > 0.002 || P.nebulaAmt > 0.002 || P.auroraAmt > 0.002 || P.starAmt > 0.002; }

  function renderDyn(renderer) {
    const prevRT = renderer.getRenderTarget();
    const xr = renderer.xr.enabled, sh = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    ru.uSunDir.value.copy(sunDir.value);
    renderer.setRenderTarget(rtB);
    renderer.render(rtScene, rtCam);
    renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = sh;
    renderer.setRenderTarget(prevRT);
  }
  function swap() { const t = rtA; rtA = rtB; rtB = t; du.uDynA.value = rtA.texture; du.uDynB.value = rtB.texture; }

  mesh.onBeforeRender = (renderer) => {
    if (!pending || !dynActive()) return;
    while (pending > 0) { if (pending === 2) { renderDyn(renderer); swap(); } else renderDyn(renderer); pending--; }
  };

  return {
    mesh,
    setParams(p) {
      if (!p) return;
      setCol(du.uZenith.value, p.zenith); setCol(du.uMid.value, p.mid); setCol(du.uHorizon.value, p.horizon); setCol(du.uGlow.value, p.glow);
      ru.uMid.value.copy(du.uMid.value); ru.uHorizon.value.copy(du.uHorizon.value); ru.uGlow.value.copy(du.uGlow.value);
      setV3(ru.uPalA.value, p.palA); setV3(ru.uPalB.value, p.palB); setV3(ru.uPalC.value, p.palC); setV3(ru.uPalD.value, p.palD);
      for (const k in P) if (typeof p[k] === 'number' && Number.isFinite(p[k])) P[k] = p[k];
      du.uPalDrift.value = P.palDrift; du.uBandAmt.value = P.bandAmt;
      ru.uCloudAmt.value = P.cloudAmt; ru.uCloudScale.value = P.cloudScale; ru.uNebulaAmt.value = P.nebulaAmt; ru.uWarp.value = P.warp;
      ru.uAuroraAmt.value = P.auroraAmt; ru.uAuroraHue.value = P.auroraHue; ru.uStarAmt.value = P.starAmt;
    },
    update(dt, t, camera) {
      if (camera) mesh.position.copy(camera.position);
      dt = Math.min(Math.max(dt || 0, 0), 0.25);
      // phases (wrapped: noise offsets at 1.0, angular at 2π; palette at 1.0, seamless for integer palC)
      const cs = P.cloudSpeed;
      ph.c1x = w1(ph.c1x + dt * 0.0016 * cs); ph.c1y = w1(ph.c1y + dt * 0.0005 * cs);
      ph.c2x = w1(ph.c2x + dt * 0.0011 * cs); ph.c2y = w1(ph.c2y - dt * 0.0007 * cs);
      ph.n1x = w1(ph.n1x + dt * 0.0009); ph.n1y = w1(ph.n1y + dt * 0.0004);
      ph.n2x = w1(ph.n2x - dt * 0.0006); ph.n2y = w1(ph.n2y + dt * 0.0008);
      const as = P.auroraSpeed;
      ph.ax = w1(ph.ax + dt * 0.004 * as); ph.ay = w1(ph.ay + dt * 0.0025 * as);
      ph.aur = (ph.aur + dt * 0.12 * as) % TAU;
      ph.pal = w1(ph.pal + dt * 0.006);
      ph.bx = w1(ph.bx + dt * 0.0015);
      ph.alert = (ph.alert + dt * 6) % TAU;
      du.uPalPh.value = ph.pal; du.uBandOff.value.set(ph.bx, ph.bx * 0.37); du.uAlertPh.value = ph.alert;

      const on = dynActive();
      du.uDyn.value = on ? 1 : 0;
      if (!on) { acc = 0; pending = 2; du.uFrac.value = 0; return; }
      acc += dt;
      if (acc >= interval) {
        acc = Math.min(acc - interval, interval * 0.99);
        ru.uCloudOff.value.set(ph.c1x, ph.c1y); ru.uCloudOff2.value.set(ph.c2x, ph.c2y);
        ru.uNebOff.value.set(ph.n1x, ph.n1y); ru.uNebOff2.value.set(ph.n2x, ph.n2y);
        ru.uAurOff.value.set(ph.ax, ph.ay); ru.uAurPh.value = ph.aur; ru.uPalPh.value = ph.pal;
        if (pending === 0) { swap(); pending = 1; }
      }
      du.uFrac.value = pending ? 0 : acc / interval;
    },
    setQuality(level) {
      quality = Math.max(0, Math.min(2, level | 0));
      interval = 1 / RATE_HZ[quality];
      ru.uOct.value = OCTAVES[quality];
    },
    dispose() {
      scene.remove(mesh);
      mesh.onBeforeRender = () => {};
      mesh.geometry.dispose(); mesh.material.dispose();
      triGeo.dispose(); rtMat.dispose(); rtA.dispose(); rtB.dispose();
      if (ownNoise) noiseTex.dispose();
    },
  };
}
