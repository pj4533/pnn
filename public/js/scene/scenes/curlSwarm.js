// curlSwarm: a 147k-particle GPGPU galaxy flowing in analytic curl noise around a morphing strange attractor
// (Lorenz -> Aizawa -> Thomas every 25 s) in the upper-right sky, behind and around the hologram (the left ~47% is an
// opaque card). Bright ribbons peel off it: one flows left along the top, one runs down the right edge; comets streak
// left across the top; a dim domain-warped nebula sits behind.
// Draws: 2 sim passes (384² HalfFloat ping-pong) + 1 points + 1 nebula layer + 1 backdrop = 5.
import * as THREE from '../../../vendor/three/three.module.js';
import { SIM_N, SIM_COMMON, SEEDS, SIM_VEL, SIM_POS, PTS_VERT, PTS_FRAG, FS_VERT, NEB, NEB_FRAG, BACK_FRAG } from './curlSwarm.glsl.js';

const N = SIM_N;
const COUNTS = [49152, 98304, N * N];
const CYCLE = 25, MORPH = 6, ORDER = [0, 1, 2];
const ANCHOR_NDC = [0.54, 0.44];    // screen (0.77, 0.72): upper right, behind/around the hologram, clear of the opaque left card
const VIS_L = -0.06, VIS_B = -0.30;  // ribbons fade out past this NDC x (screen 0.47) and y (screen 0.35)
const DEPTH = 320;
const HOLO = [0.64, 0.615];         // hologram centre, bottom-up screen

// Build the shared prelude from ctx.GLSL, filling any gaps so the scene compiles against any common.js revision.
function prelude(G = {}) {
  let s = G.COMMON || '';
  for (const k of Object.keys(G)) {
    const v = G[k];
    if (k === 'COMMON' || typeof v !== 'string') continue;
    const defs = v.match(/\b(?:float|vec3)\s+(guard|alertMix|finish)\s*\(/g);
    if (!defs) continue;
    if (defs.some((d) => new RegExp('\\b' + d.replace(/\s+/g, '\\s+').replace('(', '\\(')).test(s))) continue;
    s += '\n' + v.replace(/uniform\s[^;]*;/g, '');
  }
  const need = [['vec2', 'uRes'], ['vec4', 'uGuardRect'], ['float', 'uGuardAmt'], ['float', 'uTime'], ['float', 'uAlert'],
    ['float', 'uPulse'], ['float', 'uFade'], ['vec3', 'uAccent'], ['vec3', 'uAccent2'], ['sampler2D', 'uNoise']];
  let pre = '';
  for (const [t, n] of need) if (!new RegExp('\\b' + n + '\\b').test(s)) pre += `uniform ${t} ${n};\n`;
  let post = '';
  if (!/float\s+guard\s*\(/.test(s)) post += `float guard(){ vec2 q=gl_FragCoord.xy/uRes; vec2 m=smoothstep(uGuardRect.xy-0.08,uGuardRect.xy,q)*(1.-smoothstep(uGuardRect.zw,uGuardRect.zw+0.08,q)); return 1.-uGuardAmt*m.x*m.y; }\n`;
  if (!/vec3\s+alertMix\s*\(/.test(s)) post += `vec3 alertMix(vec3 c){ float l=dot(c,vec3(.2126,.7152,.0722)); return mix(c, vec3(l*2.2,l*.5,l*.12), uAlert); }\n`;
  if (!/vec3\s+finish\s*\(/.test(s)) post += `vec3 finish(vec3 c){ return alertMix(c)*guard()*uFade; }\n`;
  return pre + s + '\n' + post;
}

const VPRE = 'uniform vec2 uRes; uniform float uPulse; uniform vec3 uAccent; uniform vec3 uAccent2;\n';
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function create(ctx) {
  const { renderer, camera, stage } = ctx;
  const track = ctx.track || ((o) => o);
  const PRE = prelude(ctx.GLSL);
  const common = () => (ctx.common ? ctx.common() : {});
  let quality = ctx.quality ?? 2;

  // ---------- GPGPU sim: own ping-pong (the one RT exception the contract allows) ----------
  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
  const pos = [new THREE.WebGLRenderTarget(N, N, rtOpts), new THREE.WebGLRenderTarget(N, N, rtOpts)];
  const vel = [new THREE.WebGLRenderTarget(N, N, rtOpts), new THREE.WebGLRenderTarget(N, N, rtOpts)];
  track(pos[0], pos[1], vel[0], vel[1]);
  let pi = 0, vi = 0;

  const rotM4 = new THREE.Matrix4(), rotE = new THREE.Euler(0, 0, 0, 'YXZ');
  const simU = {
    tPos: { value: null }, tVel: { value: null }, uDt: { value: 1 / 60 }, uSpd: { value: 1 }, uMorph: { value: 0 },
    uTA: { value: 0 }, uTB: { value: 1 }, uAsm: { value: 0 }, uScat: { value: 0 }, uInit: { value: 1 }, uKick: { value: 1 }, uLT: ctx.localTime || { value: 0 },
    uRot: { value: new THREE.Matrix3() }, uImp: { value: new THREE.Vector4() }, uEdge: { value: new THREE.Vector4(-1.6, 5.6, -2.8, 1.2) },
  };
  const simMat = (frag) => track(new THREE.ShaderMaterial({
    uniforms: { ...common(), ...simU, tPos: { value: null }, tVel: { value: null } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: PRE + SIM_COMMON + SEEDS + frag, depthTest: false, depthWrite: false,
  }));
  const velMat = simMat(SIM_VEL), posMat = simMat(SIM_POS);
  const tri = track(new THREE.BufferGeometry());
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const simQuad = new THREE.Mesh(tri, velMat); simQuad.frustumCulled = false;
  const simScene = new THREE.Scene(); simScene.add(simQuad);
  const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function simStep(dt) {
    const prev = renderer.getRenderTarget();
    velMat.uniforms.tPos.value = pos[pi].texture; velMat.uniforms.tVel.value = vel[vi].texture;
    simQuad.material = velMat; renderer.setRenderTarget(vel[1 - vi]); renderer.render(simScene, simCam); vi = 1 - vi;
    posMat.uniforms.tPos.value = pos[pi].texture; posMat.uniforms.tVel.value = vel[vi].texture;
    simQuad.material = posMat; renderer.setRenderTarget(pos[1 - pi]); renderer.render(simScene, simCam); pi = 1 - pi;
    renderer.setRenderTarget(prev);
  }

  // ---------- points: vertex texture fetch ----------
  const ref = new Float32Array(N * N * 3);
  for (let y = 0, i = 0; y < N; y++) for (let x = 0; x < N; x++, i += 3) { ref[i] = (x + 0.5) / N; ref[i + 1] = (y + 0.5) / N; }
  const pGeo = track(new THREE.BufferGeometry());
  pGeo.setAttribute('position', new THREE.BufferAttribute(ref, 3));
  const ptsU = {
    ...common(), tPos: { value: pos[0].texture }, tVel: { value: vel[0].texture }, uAnchor: { value: new THREE.Vector3(0, 0, -DEPTH) },
    uScale: { value: 40 }, uSize: { value: 1 }, uAsm: simU.uAsm, uScat: simU.uScat, uEdge: simU.uEdge, uHolo: { value: new THREE.Vector2(HOLO[0], HOLO[1]) }, uVis: { value: new THREE.Vector2(-4, -3) },
  };
  const ptsMat = track(new THREE.ShaderMaterial({
    uniforms: ptsU, vertexShader: VPRE + SEEDS + PTS_VERT, fragmentShader: PRE + PTS_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }));
  const points = new THREE.Points(pGeo, ptsMat);
  points.frustumCulled = false; points.renderOrder = 10;
  stage.add(points);

  // ---------- nebula: quarter-res layer + full-res backdrop composite ----------
  const asp = new THREE.Vector2(16 / 9, 1);
  const nebU = { ...common(), uPar: { value: new THREE.Vector2() }, uOct: { value: [2, 3, 3][quality] }, uAsp: { value: asp } };
  const nebMat = track(new THREE.ShaderMaterial({ uniforms: nebU, vertexShader: FS_VERT, fragmentShader: PRE + NEB + NEB_FRAG, depthTest: false, depthWrite: false }));
  const layer = ctx.layer ? ctx.layer(nebMat, { scale: 0.25 }) : null;
  const ringCol = new THREE.Color(1, 0.3, 0.9);
  const backU = {
    ...nebU, tLayer: { value: layer ? layer.texture : null }, uHasLayer: { value: layer ? 1 : 0 },
    uRing: { value: new THREE.Vector4(0.77, 0.72, 9, 0) }, uRingCol: { value: ringCol },
  };
  const backMat = track(new THREE.ShaderMaterial({ uniforms: backU, vertexShader: FS_VERT, fragmentShader: PRE + NEB + BACK_FRAG, depthTest: false, depthWrite: false }));
  if (ctx.backdrop) ctx.backdrop(backMat);
  else { const m = new THREE.Mesh(tri, backMat); m.frustumCulled = false; m.renderOrder = -1000; stage.add(m); }

  // ---------- state ----------
  let intensity = 1, asm = 0, entering = false, exiting = false, enterT = 0, enterDur = 2.5, exitT = 0, exitDur = 2, scat = 0;
  let ringAge = 9, ringStr = 0, simAcc = 0, needInit = true, started = false;
  const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const edge = simU.uEdge.value, anchor = ptsU.uAnchor.value;

  function viewAt(nx, ny, out) {
    out.set(nx, ny, 0.5).applyMatrix4(camera.projectionMatrixInverse);
    return out.multiplyScalar(-DEPTH / out.z);
  }
  function frame(par) {
    viewAt(ANCHOR_NDC[0], ANCHOR_NDC[1], _a);
    viewAt(-1, -1, _b); viewAt(1, 1, _c);
    const sc = (_c.y - _b.y) * 0.15 * (1 + 0.04 * Math.sin((ctx.localTime?.value || 0) * 0.37));
    ptsU.uScale.value = sc;
    edge.set((_b.x - _a.x) / sc, (_c.x - _a.x) / sc, (_b.y - _a.y) / sc, (_c.y - _a.y) / sc);
    ptsU.uVis.value.set((viewAt(VIS_L, 0, _v).x - _a.x) / sc, (viewAt(0, VIS_B, _v).y - _a.y) / sc);
    const px = par ? Math.max(-14, Math.min(14, par.x * 0.025)) : 0, py = par ? Math.max(-6, Math.min(6, par.y * 0.025)) : 0;
    anchor.set(_a.x - px, _a.y - py, _a.z);
    asp.x = (_c.x - _b.x) / (_c.y - _b.y);
  }

  function attractorState(lt) {
    const k = Math.floor(lt / CYCLE), ph = lt - k * CYCLE;
    simU.uTA.value = ORDER[k % 3]; simU.uTB.value = ORDER[(k + 1) % 3];
    simU.uMorph.value = ease((ph - (CYCLE - MORPH)) / MORPH);
    rotE.set(0.32 + 0.12 * Math.sin(lt * 0.05), lt * 0.11, 0.08 * Math.sin(lt * 0.031));
    simU.uRot.value.setFromMatrix4(rotM4.makeRotationFromEuler(rotE));
  }

  function startEnter(dur) { enterDur = Math.max(0.3, dur || 2.5); enterT = 0; entering = true; exiting = false; scat = 0; asm = 0; needInit = true; started = true; }

  const grade = {
    bloom: 0.85, bloomThreshold: 0.5, bloomRadius: 0.6, tint: new THREE.Color(0.85, 0.55, 1.0), tintAmt: 0.05,
    sat: 1.12, contrast: 1.06, ca: 1.1, grain: 0.9, vignette: 1.15, scan: 1.0,
  };

  const api = {
    grade,
    cameraBias: { orbitScale: 1.05, bob: 0.9 },
    update(dt, t, info) {
      dt = dt > 0 ? Math.min(dt, 0.25) : 0;
      const lt = ctx.localTime ? ctx.localTime.value : t;
      if (!started && info && info.phase === 'live') startEnter(2.5);
      if (entering) { enterT += dt; asm = ease(enterT / enterDur); if (enterT >= enterDur) { entering = false; asm = 1; } }
      if (exiting) { exitT += dt; scat = ease(exitT / (exitDur * 0.65)); }
      simU.uAsm.value = asm; simU.uScat.value = scat;
      simU.uSpd.value = (1 + 0.4 * (ctx.alert ? ctx.alert.value : 0)) * (0.55 + 0.45 * intensity) * (1 + 0.6 * scat);
      attractorState(lt);
      frame(info && info.par);
      nebU.uPar.value.set(info && info.par ? info.par.x * 0.002 : 0, info && info.par ? info.par.y * 0.002 : 0);
      // ripple ring + one-step impulse
      ringAge += dt;
      simU.uKick.value = ease(ringAge / 1.4);
      backU.uRing.value.z = ringAge; backU.uRing.value.w = ringStr;
      const sdt = Math.min(dt, 1 / 20);
      if (needInit) {
        simU.uInit.value = 1; simStep(sdt); simStep(sdt); simU.uInit.value = 0; needInit = false;
      } else if (quality === 0) {
        simAcc += dt;
        if (simAcc >= 1 / 30) { const d = Math.min(simAcc, 1 / 15); simAcc = 0; simU.uDt.value = d; simStep(d); }
      } else { simU.uDt.value = sdt; simStep(sdt); }
      ptsU.tPos.value = pos[pi].texture; ptsU.tVel.value = vel[vi].texture;
    },
    setIntensity(a) { intensity = Math.max(0, Math.min(1, a)); if (ctx.fade) ctx.fade.value = intensity; },
    enter(dur) { startEnter(dur); },
    exit(dur) { exitDur = Math.max(0.3, dur || 2); exitT = 0; exiting = true; entering = false; started = true; },
    ripple(o = {}) {
      const s = Math.max(0.15, Math.min(1, o.strength ?? 1));
      ringAge = 0; ringStr = s;
      if (o.color) ringCol.copy(o.color); else ringCol.setRGB(1, 0.3, 0.9);
      if (ctx.pulse) ctx.pulse.value = Math.max(ctx.pulse.value, s * 0.6);
      // fire the impulse immediately so the shell is visible this frame
      simU.uImp.value.set(0, 0, 0, s); simU.uDt.value = 1 / 60; simStep(1 / 60); simU.uImp.value.w = 0;
      ptsU.tPos.value = pos[pi].texture; ptsU.tVel.value = vel[vi].texture;
    },
    shockwave(x, z, color) { api.ripple({ x, z, color, strength: 1 }); },
    event(type) { if (type === 'alertClear') ringCol.setRGB(1, 0.3, 0.9); },   // alert ripple arrives via shockwave()
    setQuality(q) {
      quality = Math.max(0, Math.min(2, q | 0));
      pGeo.setDrawRange(0, COUNTS[quality]);
      nebU.uOct.value = [2, 3, 3][quality];
    },
    morphPoints(out, n) { return sampleAttractor(out, n); },
    dispose() { simScene.remove(simQuad); },
  };

  // CPU integration of the dominant attractor, mapped exactly as the GPU maps it, then to world space
  function sampleAttractor(out, n) {
    const ty = simU.uMorph.value > 0.5 ? simU.uTB.value : simU.uTA.value;
    const R = simU.uRot.value, sc = ptsU.uScale.value;
    let x = 0.1, y = 0.0, z = ty === 0 ? 20 : 0.1, h = ty === 0 ? 0.004 : ty === 1 ? 0.008 : 0.04;
    const K = ty === 0 ? 22 : ty === 1 ? 1.3 : 3.3, cz = ty === 0 ? 25 : ty === 1 ? 0.7 : 0;
    camera.updateMatrixWorld();
    for (let i = -400, j = 0; j < n; i++) {
      let dx, dy, dz;
      if (ty === 0) { dx = 10 * (y - x); dy = x * (28 - z) - y; dz = x * y - 2.6667 * z; }
      else if (ty === 1) { dx = (z - 0.7) * x - 3.5 * y; dy = 3.5 * x + (z - 0.7) * y; dz = 0.6 + 0.95 * z - z * z * z / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x; }
      else { dx = Math.sin(y) - 0.208186 * x; dy = Math.sin(z) - 0.208186 * y; dz = Math.sin(x) - 0.208186 * z; }
      x += dx * h; y += dy * h; z += dz * h;
      if (i < 0 || (i & 1)) continue;
      _v.set(x / K, (z - cz) / K, y / K).applyMatrix3(R).multiplyScalar(sc).add(anchor).applyMatrix4(camera.matrixWorld);
      out[j * 3] = _v.x; out[j * 3 + 1] = _v.y; out[j * 3 + 2] = _v.z; j++;
    }
    return true;
  }

  api.setQuality(quality);
  frame(null); attractorState(0);
  return api;
}
