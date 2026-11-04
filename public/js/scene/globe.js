// Holographic globe: dotted land (Natural Earth 110m via world-atlas), coastlines, graticule, fresnel rim,
// a probability beacon at the story's region and travelling arcs from world hubs. Persistent; rises from the floor.
import * as THREE from '../../vendor/three/three.module.js';
import { TIME, holoMaterial, makeLabel, damp, clamp01, pctText, COL } from './holo.js';

export const GLOBE_R = 11;
const HUBS = [
  { name: 'New York', lat: 40.71, lon: -74.01 }, { name: 'London', lat: 51.5, lon: -0.12 }, { name: 'Tokyo', lat: 35.68, lon: 139.69 },
  { name: 'Beijing', lat: 39.9, lon: 116.4 }, { name: 'Sydney', lat: -33.87, lon: 151.21 }, { name: 'Sao Paulo', lat: -23.55, lon: -46.63 },
  { name: 'Delhi', lat: 28.61, lon: 77.21 }, { name: 'Lagos', lat: 6.52, lon: 3.38 }, { name: 'Washington', lat: 38.9, lon: -77.04 },
  { name: 'Berlin', lat: 52.52, lon: 13.4 }, { name: 'Singapore', lat: 1.35, lon: 103.82 }, { name: 'Mexico City', lat: 19.43, lon: -99.13 },
];
const D2R = Math.PI / 180;
export function lonLatToVec(lon, lat, r = 1, out = new THREE.Vector3()) {
  const cl = Math.cos(lat * D2R);
  return out.set(r * cl * Math.sin(lon * D2R), r * Math.sin(lat * D2R), r * cl * Math.cos(lon * D2R));
}

let landP = null;
function loadLand() {
  if (!landP) {
    landP = fetch(new URL('../../vendor/geo/land.json', import.meta.url)).then((r) => { if (!r.ok) throw new Error('land.json ' + r.status); return r.json(); });
    landP.catch(() => { landP = null; });
  }
  return landP;
}

export function createGlobe(scene, station) {
  const root = new THREE.Group(); root.position.copy(station); root.position.y = -GLOBE_R - 8; root.visible = false; scene.add(root);
  const rot = new THREE.Group(); rot.rotation.order = 'XYZ'; root.add(rot);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const colA = { value: new THREE.Color('#00f0ff') }, colB = { value: new THREE.Color('#ffab2e') };
  const uFade = { value: 0 }, uPx = { value: 1 };
  const mats = [];

  // occluder: dark core so the back hemisphere's dots and lines are hidden
  const core = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R * 0.985, 48, 32), new THREE.MeshBasicMaterial({ color: 0x06021a, transparent: true, opacity: 0.96 }));
  core.renderOrder = 1; rot.add(core); mats.push(core.material);

  // graticule
  {
    const arr = [];
    for (let lat = -75; lat <= 75; lat += 15) for (let lon = 0; lon < 360; lon += 3) { lonLatToVec(lon, lat, GLOBE_R * 0.995, _a); lonLatToVec(lon + 3, lat, GLOBE_R * 0.995, _b); arr.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z); }
    for (let lon = 0; lon < 360; lon += 15) for (let lat = -90; lat < 90; lat += 3) { lonLatToVec(lon, lat, GLOBE_R * 0.995, _a); lonLatToVec(lon, lat + 3, GLOBE_R * 0.995, _b); arr.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4fc8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.userData.op = 0.13; m.renderOrder = 2; rot.add(m); mats.push(m.material);
  }
  // equator ring, brighter
  {
    const g = new THREE.RingGeometry(GLOBE_R * 1.0, GLOBE_R * 1.015, 128); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.userData.op = 0.35; m.renderOrder = 2; rot.add(m); mats.push(m.material);
  }

  // land dots + coastlines (async)
  let dots = null, coast = null;
  loadLand().then((land) => {
    const n = land.dots.length / 2;
    const p = new Float32Array(n * 3), s = new Float32Array(n);
    for (let i = 0; i < n; i++) { lonLatToVec(land.dots[i * 2], land.dots[i * 2 + 1], GLOBE_R * 1.003, _a); p[i * 3] = _a.x; p[i * 3 + 1] = _a.y; p[i * 3 + 2] = _a.z; s[i] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: TIME, uPx, uFade, uColor: colA },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uPx; varying float vA;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vec3 n = normalize(mat3(modelMatrix) * position); vec3 v = normalize(cameraPosition - w.xyz);
          float f = dot(n, v); vA = smoothstep(-0.05, 0.35, f) * (0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 1.5) + aSeed * 50.0));
          vec4 mv = viewMatrix * w; gl_PointSize = (2.3 + 1.2 * f) * uPx * (90.0 / max(1.0, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uFade; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor * vA * (1.0 - d * 2.0) * 1.5 * uFade, 1.0); }`,
    });
    dots = new THREE.Points(g, m); dots.renderOrder = 3; rot.add(dots);
    // coastlines
    const arr = [];
    for (const ring of land.rings) { const k = ring.length / 2; for (let i = 0; i < k; i++) { const j = (i + 1) % k; lonLatToVec(ring[i * 2], ring[i * 2 + 1], GLOBE_R * 1.004, _a); lonLatToVec(ring[j * 2], ring[j * 2 + 1], GLOBE_R * 1.004, _b); arr.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z); } }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    coast = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    coast.userData.op = 0.28; coast.renderOrder = 3; rot.add(coast); mats.push(coast.material);
  }).catch((e) => console.warn('globe land data unavailable', e));

  // fresnel rim
  const rim = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R * 1.035, 48, 32), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uColor: colB, uFade, uTime: TIME },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uFade; uniform float uTime; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 v = normalize(cameraPosition - vW); float f = pow(max(1.0 - clamp(dot(normalize(vN), v), 0.0, 1.0), 1e-4), 3.2);
        float band = 0.85 + 0.15 * sin(vW.y * 6.0 - uTime * 2.0); gl_FragColor = vec4(uColor * f * 1.6 * band * uFade, 1.0); }`,
  }));
  rim.renderOrder = 4; root.add(rim);
  // floor halo under the globe
  const halo = new THREE.Mesh(new THREE.RingGeometry(GLOBE_R * 0.6, GLOBE_R * 1.5, 96), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: colA, uFade, uTime: TIME },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uFade; uniform float uTime; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.4, r) * smoothstep(0.35, 0.55, r); float rings = 0.6 + 0.4 * sin(r * 40.0 - uTime * 3.0); gl_FragColor = vec4(uColor * a * rings * 0.5 * uFade, 1.0); }`,
  }));
  halo.rotation.x = -Math.PI / 2; halo.renderOrder = 0; scene.add(halo); halo.position.set(station.x, 0.08, station.z); halo.visible = false;

  // ---- beacon + arcs (rebuilt per region) ----
  const beaconG = new THREE.Group(); rot.add(beaconG);
  let beacon = null, arcs = [], label = null, regionVec = null;
  function clearRegion() {
    beaconG.clear();
    if (beacon) { for (const m of beacon.mats) m.dispose(); for (const g of beacon.geos) g.dispose(); beacon = null; }
    for (const a of arcs) { a.geometry.dispose(); a.material.dispose(); }
    arcs = [];
    if (label) { label.dispose(); root.remove(label.sprite); label = null; }
    regionVec = null;
  }
  function setRegion(region, prob, pal, seed) {
    clearRegion();
    if (!region) return;
    regionVec = lonLatToVec(region.lon, region.lat, 1);
    const h = 2.5 + clamp01(prob) * 9;
    const geos = [], ms = [];
    const colM = holoMaterial(pal.a, { glow: 1.4, alpha: 0.95 }); ms.push(colM);
    const cyl = new THREE.CylinderGeometry(0.2, 0.42, h, 8, 1, true); cyl.translate(0, h / 2, 0); geos.push(cyl);
    const col = new THREE.Mesh(cyl, colM); beaconG.add(col);
    const tipM = holoMaterial(COL.white, { glow: 1.6, flat: 1 }); ms.push(tipM);
    const tipG = new THREE.SphereGeometry(0.42, 16, 12); geos.push(tipG);
    const tip = new THREE.Mesh(tipG, tipM); tip.position.y = h; beaconG.add(tip);
    // pulsing surface rings
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const rg = new THREE.RingGeometry(0.9, 1, 48); rg.rotateX(-Math.PI / 2); geos.push(rg);
      const rm = new THREE.MeshBasicMaterial({ color: pal.b.clone().multiplyScalar(1.8), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); ms.push(rm);
      const r = new THREE.Mesh(rg, rm); r.position.y = 0.05; r.userData.phase = i / 3; beaconG.add(r); rings.push(r);
    }
    // target reticle lines
    const rg2 = new THREE.RingGeometry(1.25, 1.32, 4); rg2.rotateX(-Math.PI / 2); geos.push(rg2);
    const ret = new THREE.Mesh(rg2, new THREE.MeshBasicMaterial({ color: pal.b, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); ms.push(ret.material);
    ret.position.y = 0.06; beaconG.add(ret);
    beacon = { geos, mats: ms, rings, ret, tip, col, h };
    // orient the beacon group: local +y -> region normal
    beaconG.position.copy(regionVec).multiplyScalar(GLOBE_R * 1.0);
    beaconG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), regionVec);
    // arcs from hubs (seeded choice, skip hubs within ~8 degrees)
    const picks = HUBS.map((hb, i) => ({ hb, k: Math.sin(seed * 0.001 + i * 7.3) })).filter(({ hb }) => Math.hypot(hb.lat - region.lat, hb.lon - region.lon) > 8).sort((p, q) => p.k - q.k).slice(0, 4 + (seed % 2));
    picks.forEach(({ hb }, i) => {
      const a = lonLatToVec(hb.lon, hb.lat, GLOBE_R * 1.01), b = regionVec.clone().multiplyScalar(GLOBE_R * 1.01);
      const dist = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(GLOBE_R + 1.5 + dist * 0.35);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const N = 72, pts = curve.getPoints(N), us = new Float32Array(N + 1);
      for (let k = 0; k <= N; k++) us[k] = k / N;
      const g = new THREE.BufferGeometry().setFromPoints(pts); g.setAttribute('aU', new THREE.BufferAttribute(us, 1));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: TIME, uFade, uColor: { value: pal.b.clone() }, uOff: { value: i * 0.37 }, uBorn: { value: TIME.value + 0.4 + i * 0.25 } },
        vertexShader: `attribute float aU; varying float vU; void main(){ vU = aU; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uColor; uniform float uOff; uniform float uBorn; varying float vU;
          void main(){ float grow = clamp((uTime - uBorn) * 0.9, 0.0, 1.0); if (vU > grow) discard;
            float head = fract(uTime * 0.35 + uOff); float pulse = smoothstep(0.12, 0.0, abs(vU - head)) * 1.6;
            gl_FragColor = vec4(uColor * (0.7 + pulse) * uFade, 1.0); }`,
      });
      const line = new THREE.Line(g, m); line.renderOrder = 5; rot.add(line); arcs.push(line);
      // hub marker
      const hg = new THREE.SphereGeometry(0.22, 8, 6); const hm = new THREE.MeshBasicMaterial({ color: pal.b, transparent: true, opacity: 0.9 });
      const hub = new THREE.Mesh(hg, hm); hub.position.copy(a); rot.add(hub); arcs.push(hub);
    });
    // Two stacked lines on a tall canvas: the region name on top, the probability well below it. On the old
    // 256px canvas the 150px figure (centred at 0.8) climbed into the name and was clipped at the bottom edge.
    label = makeLabel(region.name.toUpperCase(), { w: 1024, h: 440, height: 4.45, font: '700 120px Orbitron', color: '#ffffff', glow: pal.hexB, sub: pctText(prob), subColor: pal.hexA, subFont: '900 150px Orbitron', mainY: 0.2, subY: 0.66 });
    label.opacity = 0; root.add(label.sprite);
    return beacon;
  }

  // ---- state ----
  let shown = false, fade = 0, tShow = 0, tgtY = -GLOBE_R - 8, tgtRotX = 0.35, tgtRotY = 0, idle = true;
  const api = {
    root, rot, station: station.clone(), R: GLOBE_R,
    get fade() { return fade; },
    show({ region = null, prob = 0.5, palette: pal, seed = 1 } = {}) {
      shown = true; root.visible = true; halo.visible = true; tShow = 0;
      colA.value.copy(pal.a); colB.value.copy(pal.b);
      tgtY = GLOBE_R + 2.6;
      setRegion(region, prob, pal, seed);
      if (region) {
        idle = false;
        // park the region on the upper-right of the visible disc so the beacon reads in profile against the sky
        const elev = 0.42, yawOff = 0.62;
        tgtRotY = -region.lon * D2R + yawOff; tgtRotX = region.lat * D2R - elev;
        tgtRotX = THREE.MathUtils.clamp(tgtRotX, -1.0, 1.0);
        // shortest way around
        const cur = rot.rotation.y; const twoPi = Math.PI * 2;
        while (tgtRotY - cur > Math.PI) tgtRotY -= twoPi;
        while (tgtRotY - cur < -Math.PI) tgtRotY += twoPi;
        // arrive from the side: start rotated a little further so the globe visibly turns to the region
        rot.rotation.y = tgtRotY + 1.1 * ((seed & 1) ? 1 : -1);
        rot.rotation.x = tgtRotX - 0.4;
      } else { idle = true; }
    },
    hide() { shown = false; tgtY = -GLOBE_R - 8; },
    pose() {
      const c = station.clone().add(new THREE.Vector3(0, GLOBE_R + 2.6, 0));
      const box = new THREE.Box3(c.clone().add(new THREE.Vector3(-GLOBE_R * 1.1, -GLOBE_R * 1.12, -3)), c.clone().add(new THREE.Vector3(GLOBE_R * 1.25, GLOBE_R * 1.25 + 2, 3)));
      return { target: c, position: c.clone().add(new THREE.Vector3(2, 4, 48)), orbit: 0.08, box };
    },
    setPixelRatio(pr) { uPx.value = pr; },
    tick(dt, t) {
      if (!root.visible) return;
      tShow += dt;
      fade = damp(fade, shown ? 1 : 0, shown ? 2.2 : 3.5, dt);
      uFade.value = fade;
      root.position.y = damp(root.position.y, tgtY, 2.4, dt);
      if (!shown && fade < 0.01 && root.position.y < -GLOBE_R - 7) { root.visible = false; halo.visible = false; clearRegion(); return; }
      for (const m of mats) m.opacity = (m.userData?.op ?? 1) * fade;
      core.material.opacity = 0.96 * Math.min(1, fade * 1.5);
      for (const o of rot.children) if (o.userData.op != null) o.material.opacity = o.userData.op * fade;
      if (idle) { rot.rotation.y += dt * 0.12; rot.rotation.x = damp(rot.rotation.x, 0.35, 1.5, dt); }
      else {
        rot.rotation.y = damp(rot.rotation.y, tgtRotY + Math.sin(t * 0.21) * 0.05, 1.8, dt);
        rot.rotation.x = damp(rot.rotation.x, tgtRotX + Math.sin(t * 0.17) * 0.03, 1.8, dt);
      }
      halo.material.uniforms.uFade.value = fade;
      if (beacon) {
        const on = clamp01((tShow - 0.9) * 1.2);
        for (const m of beacon.mats) { if (m.uniforms?.uFade) m.uniforms.uFade.value = fade * on; else m.opacity = fade * on; }
        beacon.col.scale.y = 0.05 + 0.95 * (1 - Math.pow(1 - on, 3));
        beacon.tip.position.y = beacon.h * beacon.col.scale.y;
        beacon.tip.scale.setScalar(0.85 + 0.3 * Math.sin(t * 5));
        for (const r of beacon.rings) { const k = (t * 0.6 + r.userData.phase) % 1; r.scale.setScalar(0.6 + k * 3.2); r.material.opacity = (1 - k) * 0.8 * fade * on; }
        beacon.ret.rotation.y = t * 0.8;
        if (label) {
          // label floats above the tip, in root space (follows the rotation)
          _a.set(0, beacon.h + 0.4, 0).applyQuaternion(beaconG.quaternion).add(beaconG.position).applyEuler(rot.rotation);
          _a.x += 1.2; _a.y += 3.0; _a.z += 1.0;   // the tall two-line label's bottom (the %) clears the beacon tip
          label.sprite.position.copy(_a);
          label.opacity = fade * on;
        }
      }
    },
    dispose() {
      clearRegion();
      rot.traverse((o) => { o.geometry?.dispose?.(); if (o.material && !mats.includes(o.material)) o.material.dispose?.(); });
      for (const m of mats) m.dispose();
      rim.geometry.dispose(); rim.material.dispose(); halo.geometry.dispose(); halo.material.dispose();
      scene.remove(root); scene.remove(halo);
    },
  };
  return api;
}
