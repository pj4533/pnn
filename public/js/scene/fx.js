// Particle bursts, streams and expanding shockwave rings (one shared GPU buffer).
import * as THREE from '../../vendor/three/three.module.js';
import { TIME } from './holo.js';

export function createFx(scene) {
  const MAX = 6000;
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3), life = new Float32Array(MAX), size = new Float32Array(MAX);
  const vel = new Float32Array(MAX * 3), rate = new Float32Array(MAX), grav = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const aLife = new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos); geo.setAttribute('color', aCol); geo.setAttribute('aLife', aLife); geo.setAttribute('aSize', aSize);
  const uPx = { value: 1 };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uPx, uTime: TIME },
    vertexShader: `attribute float aLife; attribute float aSize; varying vec3 vC; varying float vL;
      uniform float uPx;
      void main(){ vC = color; vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aLife <= 0.0 ? 0.0 : aSize * uPx * (480.0 / max(1.0, -mv.z)) * (0.4 + 0.6 * aLife);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vL; void main(){ if (vL <= 0.0) discard; float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
      float a = pow(max(1.0 - d * 2.0, 1e-4), 1.6); gl_FragColor = vec4(vC * a * (0.6 + 1.6 * vL), 1.0); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 40;
  scene.add(points);
  let head = 0, active = 0;

  function emit(p, color, n, { speed = 7, up = 9, lifeS = 2.2, sz = 1, spread = 0.4, gravity = 7, white = 0.25, dir = null } = {}) {
    const c = color || new THREE.Color(1, 1, 1);
    for (let k = 0; k < n; k++) {
      const i = head; head = (head + 1) % MAX;
      pos[i * 3] = p.x + (Math.random() - 0.5) * spread; pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread; pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.3 + Math.random() * 0.7);
      if (dir) { vel[i * 3] = dir.x * s + (Math.random() - 0.5) * s * 0.3; vel[i * 3 + 1] = dir.y * s + up * Math.random() * 0.2; vel[i * 3 + 2] = dir.z * s + (Math.random() - 0.5) * s * 0.3; }
      else { vel[i * 3] = Math.sin(ph) * Math.cos(th) * s; vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * s * 0.5 + up * (0.4 + Math.random() * 0.6); vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s; }
      const w = Math.random() < white ? 1 : 0;
      col[i * 3] = w ? 1.4 : c.r * 1.6; col[i * 3 + 1] = w ? 1.4 : c.g * 1.6; col[i * 3 + 2] = w ? 1.4 : c.b * 1.6;
      life[i] = 1; rate[i] = 1 / (lifeS * (0.6 + Math.random() * 0.6)); size[i] = sz * (0.5 + Math.random()); grav[i] = gravity;
    }
    active = MAX;
  }
  const burst = (p, color, n = 200, opts) => emit(p, color, n, opts);
  // a few particles drifting along dir (used for streams from pillar tops, beacons)
  const stream = (p, color, n, dir, opts = {}) => emit(p, color, n, { speed: 3, up: 0, lifeS: 1.4, sz: 0.7, spread: 0.6, gravity: 0, white: 0.1, dir, ...opts });

  // shockwave rings (horizontal)
  const ringGeo = new THREE.RingGeometry(0.92, 1, 128, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false; m.renderOrder = 41; m.userData = { t: 1, dur: 1, r: 1 };
    scene.add(m); rings.push(m);
  }
  let ringHead = 0;
  function ring(p, color, { radius = 30, dur = 1.6, bright = 2 } = {}) {
    const m = rings[ringHead]; ringHead = (ringHead + 1) % rings.length;
    m.position.copy(p); m.userData = { t: 0, dur, r: radius, bright };
    m.material.color.copy(color || new THREE.Color(1, 1, 1)).multiplyScalar(bright);
    m.visible = true;
  }

  return {
    burst, stream, ring,
    setPixelRatio(pr) { uPx.value = pr; },
    tick(dt) {
      if (active > 0) {
        let any = 0;
        const drag = Math.pow(0.4, dt);
        for (let i = 0; i < MAX; i++) {
          if (life[i] <= 0) continue;
          any++;
          vel[i * 3 + 1] -= grav[i] * dt;
          vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          if (pos[i * 3 + 1] < 0.05) { pos[i * 3 + 1] = 0.05; vel[i * 3 + 1] *= -0.35; }
          life[i] -= rate[i] * dt;
          if (life[i] < 0) life[i] = 0;
        }
        aPos.needsUpdate = true; aCol.needsUpdate = true; aLife.needsUpdate = true; aSize.needsUpdate = true;
        if (!any) active = 0;
      }
      for (const m of rings) {
        if (!m.visible) continue;
        const u = m.userData; u.t += dt / u.dur;
        if (u.t >= 1) { m.visible = false; continue; }
        const e = 1 - Math.pow(1 - u.t, 2.2);
        m.scale.setScalar(0.5 + e * u.r);
        m.material.opacity = (1 - u.t) * 0.9;
      }
    },
    dispose() { geo.dispose(); mat.dispose(); scene.remove(points); ringGeo.dispose(); for (const m of rings) { m.material.dispose(); scene.remove(m); } },
  };
}
