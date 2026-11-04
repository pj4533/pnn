// Reusable hologram pieces: hemicycle seat layout, arc-fill meshes, tick rings, floor rings, base lines.
import * as THREE from '../../../vendor/three/three.module.js';
import { reveal, TIME } from '../holo.js';

// 100-seat hemicycle in `rows` rows between radii r0..r1, sorted left (angle PI) to right (angle 0)
export function hemicycle(total, rows, r0, r1) {
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / Math.max(1, rows - 1));
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.round((total * r) / sum));
  let diff = total - counts.reduce((a, b) => a + b, 0);
  for (let i = rows - 1; diff !== 0; i = (i - 1 + rows) % rows) { counts[i] += Math.sign(diff); diff -= Math.sign(diff); }
  const seats = [];
  radii.forEach((r, i) => {
    const n = counts[i];
    for (let j = 0; j < n; j++) { const a = Math.PI - (Math.PI * j) / Math.max(1, n - 1); seats.push({ a, r, x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  });
  seats.sort((p, q) => (q.a - p.a) || (p.r - q.r));
  return seats;
}

// Flat ring sector whose lit portion is driven by uniforms uLo/uHi in "value" space (0..1 along the arc).
// The arc runs clockwise from angle `start + span` (value 0) to `start` (value 1), angles CCW from +x in the XY plane.
export function arcMesh(rIn, rOut, color, { start, span, lo = 0, hi = 0, glow = 1.4, alpha = 0.9, segments = 160 } = {}) {
  const geo = new THREE.RingGeometry(rIn, rOut, segments, 1, start, span);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...reveal.uniforms(), uColor: { value: color.clone() }, uLo: { value: lo }, uHi: { value: hi }, uStart: { value: start }, uSpan: { value: span }, uGlow: { value: glow }, uAlpha: { value: alpha } },
    vertexShader: `varying vec3 vW; varying vec2 vL; void main(){ vL = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uLo; uniform float uHi; uniform float uStart; uniform float uSpan; uniform float uGlow; uniform float uAlpha; varying vec2 vL;
      ${reveal.glsl}
      void main(){
        float rv; float scan = revealScan(rv);
        float ang = atan(vL.y, vL.x);
        float u = mod(ang - uStart + 6.28318530718, 6.28318530718) / uSpan; // 0 at value 1 end .. 1 at value 0 end
        float v = 1.0 - u;
        if (v < uLo || v > uHi) discard;
        float edge = smoothstep(0.0, 0.03, uHi - v) * 0.6 + 0.4;
        float tip = exp(-(uHi - v) * 40.0);
        float stripes = 0.85 + 0.15 * sin((v * uSpan) * 60.0 - uTime * 2.0);
        gl_FragColor = vec4(uColor * uGlow * (edge * stripes + tip * 1.2) + vec3(scan), uAlpha * uFade);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

// tick marks around an arc (LineSegments positions)
export function tickPositions(r, start, span, { count = 50, long = 10, longer = 25, len = 0.35, lenLong = 0.75, lenLonger = 1.1 } = {}) {
  const arr = [];
  for (let i = 0; i <= count; i++) {
    const v = i / count, ang = start + span * (1 - v);
    const l = i % longer === 0 ? lenLonger : i % long === 0 ? lenLong : len;
    arr.push(Math.cos(ang) * r, Math.sin(ang) * r, 0, Math.cos(ang) * (r + l), Math.sin(ang) * (r + l), 0);
  }
  return new Float32Array(arr);
}

// thin flat ring on the floor (horizontal), additive
export function floorRing(rIn, rOut, material, segments = 128) {
  const g = new THREE.RingGeometry(rIn, rOut, segments);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, material); m.position.y = 0.06; return m;
}

// rectangle outline (LineSegments) in the XZ plane at y
export function rectOutline(w, d, y = 0) {
  const x = w / 2, z = d / 2;
  return new Float32Array([-x, y, -z, x, y, -z, x, y, -z, x, y, z, x, y, z, -x, y, z, -x, y, z, -x, y, -z]);
}

// corner brackets for a rectangle (XZ plane)
export function bracketPositions(w, d, y = 0, len = 1.2) {
  const x = w / 2, z = d / 2, a = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    a.push(sx * x, y, sz * z, sx * (x - len), y, sz * z, sx * x, y, sz * z, sx * x, y, sz * (z - len));
  }
  return new Float32Array(a);
}

export function lineSeg(positions, material) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.LineSegments(g, material);
}
export function lineStrip(points, material) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(g, material);
}
export { TIME };
