// Post-processing: BackdropPass (scene director) -> main scene (holograms on top) -> bloom -> grade/CA/glitch/vignette/grain + flash + alert tint.
import * as THREE from '../../vendor/three/three.module.js';
import { EffectComposer } from '../../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../../vendor/three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../../vendor/three/addons/postprocessing/OutputPass.js';
import { Pass } from '../../vendor/three/addons/postprocessing/Pass.js';

// BackdropPass: the scene director draws the background (steady state: its stage; during a transition: both scenes to
// tRA/tRB, then the transition quad + morph cloud) straight into the composer read buffer. No swap.
class BackdropPass extends Pass {
  constructor() { super(); this.needsSwap = false; this.draw = null; }
  render(renderer, writeBuffer, readBuffer) {
    if (this.draw) { this.draw(renderer, readBuffer); return; }
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer); renderer.clear();
    renderer.autoClear = ac;
  }
}
import { TIME } from './holo.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: TIME, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color(1, 1, 1) },
    uCA: { value: 0 }, uGlitch: { value: 0 }, uAlert: { value: 0 }, uRes: { value: new THREE.Vector2(1920, 1080) },
    // per-mood grade (env director); identity defaults
    uTint: { value: new THREE.Color(1, 1, 1) }, uTintAmt: { value: 0 }, uSat: { value: 1 }, uContrast: { value: 1 },
    uGrainK: { value: 1 }, uVigK: { value: 1 }, uScanK: { value: 1 }, uCAk: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; uniform vec3 uFlashCol; uniform float uCA; uniform float uGlitch; uniform float uAlert; uniform vec2 uRes;
    uniform vec3 uTint; uniform float uTintAmt, uSat, uContrast, uGrainK, uVigK, uScanK, uCAk;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      float row = floor(uv.y * 48.0);
      float gl = step(1.0 - 0.18 * uGlitch, hash(vec2(row, floor(uTime * 24.0))));
      uv.x += gl * (hash(vec2(row, uTime)) - 0.5) * 0.06 * uGlitch;
      vec2 c = uv - 0.5; float r2 = dot(c, c);
      float ca = (0.0022 * uCAk + uCA * 0.03) * (0.3 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      col += uFlashCol * uFlash * (0.25 + r2 * 1.2);
      float vig = smoothstep(0.75, 0.12, r2);
      col *= mix(1.0 - 0.5 * uVigK, 1.0, vig);
      // mood grade (before the alert so the alert always wins)
      float lu = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lu), col, uSat);
      col = max((col - 0.18) * uContrast + 0.18, 0.0);
      col = mix(col, col * uTint / max(dot(uTint, vec3(0.2126, 0.7152, 0.0722)), 0.05), uTintAmt);
      col *= 1.0 - max(uScanK - 1.0, 0.0) * 0.15 * (0.5 + 0.5 * sin(uv.y * uRes.y * 1.5));
      // alert: red pulsing edge vignette + faint scanlines
      float beat = 0.5 + 0.5 * sin(uTime * 5.0);
      col += vec3(0.55, 0.04, 0.02) * uAlert * smoothstep(0.08, 0.55, r2) * (0.55 + 0.45 * beat);
      col *= 1.0 - uAlert * 0.08 * (0.5 + 0.5 * sin(uv.y * uRes.y * 1.5));
      float n = hash(uv * uRes + fract(uTime * 7.0) * 100.0);
      col += (n - 0.5) * 0.022 * uGrainK;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { samples = 0 } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  const backdrop = new BackdropPass();
  composer.addPass(backdrop);
  const main = new RenderPass(scene, camera);
  main.clear = false; main.clearDepth = true;           // holograms, fx and globe always draw on top of the backdrop
  composer.addPass(main);
  // transition targets: fixed HalfFloat RTs at drawing-buffer x 0.5, allocated in setSize only
  const tOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, samples: 0 };
  const tRA = new THREE.WebGLRenderTarget(4, 4, tOpts), tRB = new THREE.WebGLRenderTarget(4, 4, tOpts);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.4, 0.78);
  composer.addPass(bloom);
  const fin = new ShaderPass(FinalShader);
  fin.uniforms.uTime = TIME;   // ShaderPass clones uniforms; share the live clock so grain/glitch animate
  composer.addPass(fin);
  composer.addPass(new OutputPass());
  const base = { strength: 0.55 };
  const U = fin.uniforms;
  let flash = 0, ca = 0, glitch = 0, alert = 0, alertTarget = 0;
  return {
    composer, bloom, backdrop,
    get readBuffer() { return composer.readBuffer; },
    getTransRT() { return { a: tRA, b: tRB }; },
    setBackdrop(fn) { backdrop.draw = fn || null; },
    setSize(w, h, pixelRatio) {
      const tw = Math.max(1, Math.round(w * pixelRatio / 2)), th = Math.max(1, Math.round(h * pixelRatio / 2));
      tRA.setSize(tw, th); tRB.setSize(tw, th);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
      bloom.setSize(Math.round(w * pixelRatio / 2), Math.round(h * pixelRatio / 2));
      fin.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
    },
    flash(color, amount = 0.6) {
      fin.uniforms.uFlashCol.value.copy(color || new THREE.Color(1, 1, 1));
      flash = Math.max(flash, amount); ca = Math.max(ca, 1); glitch = Math.max(glitch, 1);
    },
    glitch(amount = 0.6) { glitch = Math.max(glitch, amount); ca = Math.max(ca, amount * 0.6); },
    setAlert(on) { alertTarget = on ? 1 : 0; },
    // env director: mood bloom base (alert/flash boosts stay on top) and colour grade
    setBloom({ strength, threshold, radius } = {}) {
      if (strength != null) base.strength = strength;
      if (threshold != null) bloom.threshold = threshold;
      if (radius != null) bloom.radius = radius;
    },
    setGrade(g) {
      if (!g) return;
      if (g.tint) U.uTint.value.copy(g.tint);
      if (g.tintAmt != null) U.uTintAmt.value = g.tintAmt;
      if (g.sat != null) U.uSat.value = g.sat;
      if (g.contrast != null) U.uContrast.value = g.contrast;
      if (g.grain != null) U.uGrainK.value = g.grain;
      if (g.vignette != null) U.uVigK.value = g.vignette;
      if (g.scan != null) U.uScanK.value = g.scan;
      if (g.ca != null) U.uCAk.value = g.ca;
    },
    render(dt) {
      flash = Math.max(0, flash - dt * 1.4); ca = Math.max(0, ca - dt * 1.2); glitch = Math.max(0, glitch - dt * 2.2);
      alert += (alertTarget - alert) * (1 - Math.exp(-(alertTarget ? 7 : 2.5) * dt));
      fin.uniforms.uFlash.value = flash * flash;
      fin.uniforms.uCA.value = ca + alert * 0.12;
      fin.uniforms.uGlitch.value = glitch;
      fin.uniforms.uAlert.value = alert;
      bloom.strength = base.strength + flash * 0.5 + alert * 0.25;
      composer.render(dt);
    },
    dispose() { backdrop.draw = null; composer.dispose?.(); rt.dispose(); tRA.dispose(); tRB.dispose(); bloom.dispose?.(); },
  };
}
