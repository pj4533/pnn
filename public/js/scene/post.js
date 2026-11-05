// Post-processing: BackdropPass (scene director) -> main scene (holograms on top) -> bloom -> grade/CA/glitch/vignette/grain + flash + alert tint -> hologram labels (LabelPass: no bloom, no grade).
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
import { TIME, LABEL_LAYER } from './holo.js';

// LabelPass: hologram text (makeLabel sprites live on LABEL_LAYER only) drawn AFTER bloom, straight onto the composed
// image. Text never feeds the bloom (no white smears over bright scenes) and carries its own designed glow in the
// label texture, so it looks the same over a bright green scene and over black. Arcs, beams and particles keep bloom.
class LabelPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera, mask = cam.layers.mask, ac = renderer.autoClear;
    cam.layers.set(LABEL_LAYER);
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, cam);
    cam.layers.mask = mask; renderer.autoClear = ac;
  }
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: TIME, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color(1, 1, 1) },
    uCA: { value: 0 }, uGlitch: { value: 0 }, uAlert: { value: 0 }, uRes: { value: new THREE.Vector2(1920, 1080) },
    // per-mood grade (env director); identity defaults
    uTint: { value: new THREE.Color(1, 1, 1) }, uTintAmt: { value: 0 }, uSat: { value: 1 }, uContrast: { value: 1 },
    uGrainK: { value: 1 }, uVigK: { value: 1 }, uScanK: { value: 1 }, uCAk: { value: 1 },
    // projector stage: uPlinth = (cx, plinthY, rx, amt) floor reflection under the widget; uHeroC = eye centre (vignette)
    uPlinth: { value: new THREE.Vector4(0.64, 0.3, 0.2, 0) }, uHeroC: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; uniform vec3 uFlashCol; uniform float uCA; uniform float uGlitch; uniform float uAlert; uniform vec2 uRes;
    uniform vec3 uTint; uniform float uTintAmt, uSat, uContrast, uGrainK, uVigK, uScanK, uCAk; uniform vec4 uPlinth; uniform vec2 uHeroC;
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
      // fake floor reflection: inside the plinth ellipse, mirror the frame about the plinth's screen line (rippled)
      if (uPlinth.w > 0.0 && uv.y < uPlinth.y && abs(uv.x - uPlinth.x) < uPlinth.z * 1.3) {
        float dpt = uPlinth.y - uv.y;
        float fx = 1.0 - smoothstep(uPlinth.z * 0.7, uPlinth.z * 1.3, abs(uv.x - uPlinth.x));
        vec2 ruv = vec2(uv.x + 0.004 * sin(uv.y * 140.0 + uTime * 3.0), 2.0 * uPlinth.y - uv.y);
        col += texture2D(tDiffuse, clamp(ruv, 0.001, 0.999)).rgb * uPlinth.w * fx * smoothstep(0.0, 0.012, dpt) * (1.0 - smoothstep(0.012, 0.1, dpt));
      }
      col += uFlashCol * uFlash * (0.25 + r2 * 1.2);
      vec2 cv = uv - mix(vec2(0.5), uHeroC, 0.5); float v2 = dot(cv, cv);   // the eye is the brightest place
      float vig = smoothstep(0.75, 0.12, v2);
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
  // projector stage: bloom is added back at less than full strength inside the calm eye (no extra pass, one ALU
  // mask in the bloom's own blend shader) so the bright eye-wall glows outward instead of fogging over the widget
  const uBloomEye = { value: new THREE.Vector4(0.64, 0.6, 0, 0) };   // cx, cy, rx, ry (bottom-up uv); rx 0 = off
  bloom.copyUniforms.uEye = uBloomEye;
  bloom.blendMaterial.fragmentShader = `uniform float opacity; uniform sampler2D tDiffuse; uniform vec4 uEye; varying vec2 vUv;
    void main(){ float m = 1.0; if (uEye.z > 0.0) { vec2 d = (vUv - uEye.xy) / max(uEye.zw, vec2(1e-3)); m = mix(0.4, 1.0, smoothstep(0.75, 1.25, length(d))); }
      gl_FragColor = opacity * texture2D(tDiffuse, vUv) * m; }`;
  bloom.blendMaterial.needsUpdate = true;
  const fin = new ShaderPass(FinalShader);
  fin.uniforms.uTime = TIME;   // ShaderPass clones uniforms; share the live clock so grain/glitch animate
  composer.addPass(fin);
  // hologram text after bloom AND after the grade/vignette: the vignette and mood grade dimmed edge labels to grey,
  // so text keeps one look on every scene (its glow is designed into the label texture)
  composer.addPass(new LabelPass(scene, camera));
  composer.addPass(new OutputPass());
  // perf counters (item 11): CPU ms each pass spends submitting this frame (a first-draw pipeline build, a canvas
  // texture upload or a sync readback stalls inside the pass that triggered it). Read by scene/index.js -> perf.js.
  const passNames = ['backdrop', 'main', 'bloom', 'final', 'label', 'output'];
  const passMs = new Float32Array(composer.passes.length);
  composer.passes.forEach((pass, i) => {
    const r = pass.render;
    pass.render = function (...a) { const t = performance.now(); try { return r.apply(pass, a); } finally { passMs[i] += performance.now() - t; } };
  });
  const base = { strength: 0.55 };
  const U = fin.uniforms;
  let flash = 0, ca = 0, glitch = 0, alert = 0, alertTarget = 0;
  return {
    composer, bloom, backdrop,
    perf: { names: passNames, ms: passMs },
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
    /** Projector stage: floor-reflection ellipse (bottom-up uv) and eye centre for the vignette. */
    setHero({ plinthY = 0.3, cx = 0.64, cy = 0.6, rx = 0.2, ry = 0, amt = 0, vis = 1 } = {}) { U.uPlinth.value.set(cx, plinthY, rx, amt); U.uHeroC.value.set(cx, cy); uBloomEye.value.set(cx, cy, vis > 0.5 ? rx : 0, ry); },
    // env director: mood bloom base (alert/flash boosts stay on top) and colour grade
    setBloom({ strength, threshold, radius } = {}) {
      if (strength != null) base.strength = strength;
      if (threshold != null) bloom.threshold = threshold;
      // projector stage: a wide bloom radius smears the bright eye-wall across the calm core (green/pink fog over the
      // widget), so the glow stays local to the rim; the scene's own strength/threshold still set the mood
      if (radius != null) bloom.radius = Math.min(radius, 0.5);
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
      passMs.fill(0);
      composer.render(dt);
    },
    dispose() { backdrop.draw = null; composer.dispose?.(); rt.dispose(); tRA.dispose(); tRB.dispose(); bloom.dispose?.(); },
  };
}
