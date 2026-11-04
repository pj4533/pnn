// Atmosphere module: low fog layers, horizon haze band, lightning + sky flash, post grade values.
// Param-driven (see setParams). All shader phases are JS-accumulated and wrapped (24/7 precision).
import * as THREE from '../../../vendor/three/three.module.js';

const BOLTS = 3;
const BOLT_VERTS = 64;
const FLASH_CAP = 0.35;
const WARM_FRAMES = 12; // never hide objects before the host warmup has compiled them

const GUARD_GLSL = /* glsl */`
uniform vec2 uRes; uniform vec4 uGuardRect; uniform float uGuardAmt;
float guard(){ vec2 q=gl_FragCoord.xy/uRes; vec2 m=smoothstep(uGuardRect.xy-0.08,uGuardRect.xy,q)*(1.-smoothstep(uGuardRect.zw,uGuardRect.zw+0.08,q)); return 1.-uGuardAmt*m.x*m.y; }
`;

const FOG_VERT = /* glsl */`
varying vec3 vW;
void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }
`;
const FOG_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uNoise; uniform vec2 uOffA, uOffB, uOffC; uniform float uScale, uAmt, uCamZ, uDetail, uAlert;
uniform vec3 uFogCol, uHazeCol, uSunDir;
${GUARD_GLSL}
varying vec3 vW;
void main(){
  vec2 p = vW.xz*uScale;
  float n = texture2D(uNoise, p + uOffA).r*0.55 + texture2D(uNoise, p*2.3 + uOffB).g*0.3;
  n += uDetail*texture2D(uNoise, p*5.1 + uOffC).b*0.15 + (1.-uDetail)*0.075;
  float d = smoothstep(0.35, 0.8, n);
  float zmask = smoothstep(uCamZ-300., uCamZ-700., vW.z);
  vec3 toP = vW - cameraPosition;
  float dist = length(toP.xz);
  float far = 1. - smoothstep(2200., 3000., dist);
  float near = smoothstep(250., 700., dist);
  vec2 vd = toP.xz/max(dist, 1.);
  vec2 sd = normalize(uSunDir.xz + 1e-4);
  float sun = pow(max(dot(vd, sd), 0.), 4.);
  vec3 col = mix(uFogCol, uHazeCol, 0.4)*(0.7 + 0.6*n)*1.6 + uHazeCol*sun*0.5;
  col = min(col, vec3(0.35));
  float a = uAmt*d*zmask*far*near*0.3*guard();
  col = mix(col, vec3(dot(col, vec3(0.3,0.59,0.11))*1.6, 0.04, 0.05), uAlert);
  gl_FragColor = vec4(col, a);
}
`;

const HAZE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uNoise; uniform vec2 uOffH; uniform float uAmt, uAlert;
uniform vec3 uHazeCol, uSunDir;
${GUARD_GLSL}
varying vec3 vW; varying vec2 vUv;
void main(){
  vec2 dir = normalize(vW.xz - cameraPosition.xz);
  float n = texture2D(uNoise, dir*0.35 + vec2(uOffH.x, vUv.y*0.12 + uOffH.y)).r;
  float y = vUv.y;
  float g = smoothstep(0.0, 0.22, y)*(1. - smoothstep(0.22, 0.85, y));
  float sun = pow(max(dot(dir, normalize(uSunDir.xz + 1e-4)), 0.), 3.);
  vec3 col = min(uHazeCol*(1. + 0.8*sun), vec3(0.35));
  float a = uAmt*g*(0.55 + 0.45*n)*0.3*guard();
  col = mix(col, vec3(dot(col, vec3(0.3,0.59,0.11))*1.6, 0.04, 0.05), uAlert);
  gl_FragColor = vec4(col, a);
}
`;
const HAZE_VERT = /* glsl */`
varying vec3 vW; varying vec2 vUv;
void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }
`;

function rand(a, b) { return a + Math.random() * (b - a); }

// Midpoint displacement bolt. Writes segment pairs into arr from index o; returns new index.
function boltPath(arr, o, ax, ay, az, bx, by, bz, levels, jitter) {
  let pts = [[ax, ay, az], [bx, by, bz]];
  let j = jitter;
  for (let l = 0; l < levels; l++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      next.push([(p[0] + q[0]) / 2 + rand(-j, j), (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 + rand(-j, j) * 0.3], q);
    }
    pts = next; j *= 0.55;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    arr[o++] = p[0]; arr[o++] = p[1]; arr[o++] = p[2];
    arr[o++] = q[0]; arr[o++] = q[1]; arr[o++] = q[2];
  }
  return { o, pts };
}

function pulseEnv(t, t0) {
  const u = t - t0;
  if (u < 0) return 0;
  return u < 0.025 ? u / 0.025 : Math.exp(-(u - 0.025) / 0.14);
}

export function createAtmos(scene, ctx) {
  const TH = ctx.THREE || THREE;
  if (!ctx.flash) ctx.flash = { value: 0 };
  if (!ctx.fogCol) ctx.fogCol = { value: new TH.Color(0.13, 0.015, 0.13) };
  if (!ctx.sunDir) ctx.sunDir = { value: new TH.Vector3(-0.2, 0.1, -1).normalize() };
  const res = ctx.res || { value: new TH.Vector2(1920, 1080) };
  const guardRect = ctx.guardRect || { value: new TH.Vector4(0.30, 0.30, 0.985, 0.93) };
  const guardAmt = ctx.guardAmt || { value: 0.45 };
  const alert = ctx.alert || { value: 0 };

  const P = {
    fogCol: new TH.Color(0.13, 0.015, 0.13), fogDensity: 0.5, fogLayers: 0.3, fogSpeed: 1,
    hazeAmt: 0.3, hazeCol: new TH.Color(0.4, 0.06, 0.25), boltCol: new TH.Color(0.75, 0.8, 1),
    lightningRate: 0,
  };
  const grade = { tint: new TH.Color(1, 1, 1), tintAmt: 0, sat: 1, contrast: 1, vignette: 1, grain: 1, scan: 1, ca: 1 };

  let quality = 2, frames = 0, time = 0;
  const geoms = [], mats = [], objs = [];

  // ---- fog planes
  const fogShared = {
    uNoise: { value: ctx.noiseTex }, uCamZ: { value: 0 }, uAlert: alert,
    uFogCol: ctx.fogCol, uSunDir: ctx.sunDir, uRes: res, uGuardRect: guardRect, uGuardAmt: guardAmt,
    uHazeCol: { value: P.hazeCol.clone() }, uDetail: { value: 1 },
  };
  const fogGeo = new TH.PlaneGeometry(6000, 3000, 1, 1); fogGeo.rotateX(-Math.PI / 2); geoms.push(fogGeo);
  const fogLayers = [];
  [[6, 1 / 2400, 1], [22, 1 / 3100, -0.7]].forEach(([y, scale, dirK], i) => {
    const mat = new TH.ShaderMaterial({
      vertexShader: FOG_VERT, fragmentShader: FOG_FRAG,
      uniforms: Object.assign({}, fogShared, {
        uScale: { value: scale }, uAmt: { value: 0 },
        uOffA: { value: new TH.Vector2() }, uOffB: { value: new TH.Vector2() }, uOffC: { value: new TH.Vector2() },
      }),
      transparent: true, depthWrite: false, depthTest: true,
    });
    mats.push(mat);
    const m = new TH.Mesh(fogGeo, mat);
    m.position.y = y; m.renderOrder = -4; m.frustumCulled = false; m.visible = true;
    m.name = 'atmosFog' + i;
    scene.add(m); objs.push(m);
    fogLayers.push({ mesh: m, mat, dirK, a: new TH.Vector2(), b: new TH.Vector2(), c: new TH.Vector2(), mul: i === 0 ? 1 : 0.8 });
  });

  // ---- haze band
  const hazeGeo = new TH.CylinderGeometry(2000, 2000, 400, 64, 1, true); hazeGeo.translate(0, 150, 0); geoms.push(hazeGeo);
  const hazeMat = new TH.ShaderMaterial({
    vertexShader: HAZE_VERT, fragmentShader: HAZE_FRAG,
    uniforms: {
      uNoise: fogShared.uNoise, uOffH: { value: new TH.Vector2() }, uAmt: { value: 0 }, uAlert: alert,
      uHazeCol: fogShared.uHazeCol, uSunDir: ctx.sunDir, uRes: res, uGuardRect: guardRect, uGuardAmt: guardAmt,
    },
    transparent: true, depthWrite: false, depthTest: true, side: TH.BackSide, blending: TH.AdditiveBlending,
  });
  mats.push(hazeMat);
  const haze = new TH.Mesh(hazeGeo, hazeMat);
  haze.renderOrder = -6.5; haze.frustumCulled = false; haze.visible = true; haze.name = 'atmosHaze';
  scene.add(haze); objs.push(haze);
  const hazeOff = { x: 0, y: 0 };

  // ---- lightning pool
  const bolts = [];
  for (let i = 0; i < BOLTS; i++) {
    const geo = new TH.BufferGeometry();
    const attr = new TH.BufferAttribute(new Float32Array(BOLT_VERTS * 3), 3);
    attr.setUsage(TH.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, BOLT_VERTS);
    geoms.push(geo);
    const mat = new TH.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: TH.AdditiveBlending, fog: false });
    mats.push(mat);
    const line = new TH.LineSegments(geo, mat);
    line.renderOrder = -6; line.frustumCulled = false; line.visible = true; line.name = 'atmosBolt' + i;
    scene.add(line); objs.push(line);
    bolts.push({ line, geo, attr, mat, t: 99, p2: -1, strength: 0, hold: 0, env: 0 });
  }
  let nextBolt = 0;
  const redBolt = new TH.Color(1, 0.12, 0.1), tmpC = new TH.Color();

  function strike(opts = {}) {
    const b = bolts[nextBolt]; nextBolt = (nextBolt + 1) % BOLTS;
    const cam = lastCam;
    const cx = cam ? cam.position.x : 0;
    const z = opts.z !== undefined ? opts.z : rand(-2200, -1400);
    const x = (opts.x !== undefined ? opts.x : cx + rand(-900, 900)) ;
    const top = rand(650, 900), bot = rand(40, 120);
    const a = b.attr.array; a.fill(0);
    let o = 0;
    const main = boltPath(a, o, x, top, z, x + rand(-80, 80), bot, z, 4, 70);
    o = main.o;
    for (let f = 0; f < 3 && o + 12 <= BOLT_VERTS * 3; f++) {
      const s = main.pts[Math.floor(rand(2, main.pts.length - 4))];
      const side = Math.random() < 0.5 ? -1 : 1;
      o = boltPath(a, o, s[0], s[1], s[2], s[0] + side * rand(60, 220), s[1] - rand(120, 280), z, 2, 40).o;
    }
    b.geo.setDrawRange(0, Math.min(BOLT_VERTS, o / 3));
    b.attr.needsUpdate = true;
    b.t = 0; b.p2 = Math.random() < 0.6 ? rand(0.08, 0.16) : -1;
    b.strength = opts.strength !== undefined ? opts.strength : 1;
    b.hold = opts.hold || 0;
    b.line.visible = true;
    return b;
  }

  // ---- state
  let lastCam = null;
  const sunHold = new TH.Color();

  function setParams(p) {
    if (!p) return;
    if (p.fogCol) { P.fogCol.copy(p.fogCol); ctx.fogCol.value.copy(p.fogCol); }
    if (p.hazeCol) P.hazeCol.copy(p.hazeCol);
    if (p.boltCol) P.boltCol.copy(p.boltCol);
    if (p.fogDensity !== undefined) P.fogDensity = p.fogDensity;
    if (p.fogLayers !== undefined) P.fogLayers = p.fogLayers;
    if (p.fogSpeed !== undefined) P.fogSpeed = p.fogSpeed;
    if (p.hazeAmt !== undefined) P.hazeAmt = p.hazeAmt;
    if (p.lightningRate !== undefined) P.lightningRate = p.lightningRate;
    const g = p.grade;
    if (g) {
      if (g.tint) grade.tint.copy(g.tint);
      for (const k of ['tintAmt', 'sat', 'contrast', 'vignette', 'grain', 'scan', 'ca']) if (g[k] !== undefined) grade[k] = g[k];
    }
  }

  const wrap1 = (v) => v - Math.floor(v);

  function update(dt, t, camera) {
    lastCam = camera || lastCam;
    frames++; time += dt;
    const cam = lastCam;
    const warm = frames > WARM_FRAMES;
    const spd = P.fogSpeed;

    // fog
    const amt = Math.min(1, P.fogLayers) * Math.min(1, P.fogDensity);
    const fogOn = quality > 0 && amt > 0.002;
    fogShared.uHazeCol.value.copy(P.hazeCol);
    fogShared.uDetail.value = quality >= 2 ? 1 : 0;
    for (const L of fogLayers) {
      // different directions per layer; offsets wrap at 1 (noise tile period)
      L.a.x = wrap1(L.a.x + dt * 0.0035 * spd * L.dirK); L.a.y = wrap1(L.a.y + dt * 0.0012 * spd);
      L.b.x = wrap1(L.b.x - dt * 0.0022 * spd); L.b.y = wrap1(L.b.y + dt * 0.0031 * spd * L.dirK);
      L.c.x = wrap1(L.c.x + dt * 0.0050 * spd); L.c.y = wrap1(L.c.y - dt * 0.0017 * spd);
      const u = L.mat.uniforms;
      u.uOffA.value.copy(L.a); u.uOffB.value.copy(L.b); u.uOffC.value.copy(L.c);
      u.uAmt.value = amt * L.mul;
      u.uCamZ.value = cam ? cam.position.z : 0;
      if (cam) L.mesh.position.set(cam.position.x, L.mesh.position.y, cam.position.z - 1800);
      L.mesh.visible = !warm || fogOn;
    }

    // haze
    hazeOff.x = wrap1(hazeOff.x + dt * 0.004 * spd); hazeOff.y = wrap1(hazeOff.y + dt * 0.0025 * spd);
    hazeMat.uniforms.uOffH.value.set(hazeOff.x, hazeOff.y);
    hazeMat.uniforms.uAmt.value = P.hazeAmt;
    if (cam) haze.position.set(cam.position.x, 0, cam.position.z);
    haze.visible = !warm || P.hazeAmt > 0.002;

    // lightning
    let flash = 0;
    const al = alert.value || 0;
    tmpC.copy(P.boltCol).lerp(redBolt, al);
    for (const b of bolts) {
      let env = 0;
      if (b.t < 2) {
        if (b.hold > 0) { b.hold -= dt; b.t = 0.03; } else b.t += dt;
        env = Math.max(pulseEnv(b.t, 0), b.p2 >= 0 ? 0.7 * pulseEnv(b.t, b.p2) : 0) * b.strength;
        if (b.t >= 1.2 || env < 0.003 && b.t > 0.3) { b.t = 99; env = 0; }
      }
      b.env = env;
      b.mat.opacity = Math.min(1, env);
      b.mat.color.copy(tmpC);
      if (warm && env === 0) b.line.visible = false;
      flash = Math.max(flash, env);
    }
    if (quality === 0) flash *= 0.6;
    ctx.flash.value = Math.min(FLASH_CAP, flash * FLASH_CAP);
  }

  function setQuality(l) { quality = l; }

  function dispose() {
    for (const o of objs) scene.remove(o);
    for (const g of geoms) g.dispose();
    for (const m of mats) m.dispose();
    objs.length = geoms.length = mats.length = 0;
    ctx.flash.value = 0;
  }

  return { setParams, update, strike, setQuality, dispose, grade, group: objs };
}
