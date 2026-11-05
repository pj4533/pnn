// Holographic globe: dotted land (Natural Earth 110m via world-atlas), coastlines, graticule, fresnel rim,
// a probability beacon at the story's region and travelling arcs from world hubs. Persistent; rises from the floor.
import * as THREE from '../../vendor/three/three.module.js';
import { TIME, holoMaterial, makeLabel, damp, clamp01, pctText, ptsText, ease, COL, HEX } from './holo.js';
import { OUTCOME_COLORS } from '../util.js';

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

  // ---- beacon + arcs + data overlay (rebuilt per region, all disposed in clearRegion) ----
  // Layout (root space, +x right): the beacon column stands on the region with a 0/50/100% scale beside it, a ghost ring
  // at yesterday's height and a NOW tag; a headline block (region, subject, big % + change chip) sits up and to the right;
  // a leaderboard of the story's outcomes sits lower right, outside the sphere; a source/volume footer sits under it.
  const BASE_H = 0.8, SCALE_H = 8.5;                 // column height for 0% and the extra for 100% (the board's gauge carries the labelled scale)
  const hOf = (p) => BASE_H + clamp01(p) * SCALE_H;
  const HX = 11.6, HTOP = 13.0;                       // headline block / board left edge and top, in root space (right of the sphere)
  const PANEL_W = 12.0, BAR_W = 7.0, ROW = 2.75;
  const DIM = new THREE.Color(0.2, 0.15, 0.4), TXT_DOWN = '#ff6f8a';   // lighter red for text so it holds contrast under the outline
  const _n = new THREE.Vector3(), _bp = new THREE.Vector3(), _ax = new THREE.Vector3(0, 1, 0);
  // 0 -> a (rise to yesterday), hold, a -> b (sweep to today). u in 0..1
  function kf(u, a, b) { if (u <= 0) return 0; if (u < 0.33) return a * ease.out(u / 0.33); if (u < 0.5) return a; if (u < 1) return a + (b - a) * ease.inOut((u - 0.5) / 0.5); return b; }
  const beaconG = new THREE.Group(); rot.add(beaconG);
  let beacon = null, arcs = [], regionVec = null, hasPanel = false, ov = null;
  function clearRegion() {
    beaconG.clear();
    if (beacon) { for (const m of beacon.mats) m.dispose(); for (const g of beacon.geos) g.dispose(); beacon = null; }
    for (const a of arcs) { a.geometry.dispose(); a.material.dispose(); }
    arcs = [];
    if (ov) { for (const it of ov.labels) it.l.dispose(); for (const g of ov.geos) g.dispose(); for (const m of ov.mats) m.dispose(); root.remove(ov.hudG, ov.panelG, ov.footG, ov.leader); ov = null; }
    regionVec = null; hasPanel = false;
  }
  function wrap2(text, max) {
    const w = text.split(/\s+/).filter(Boolean); if (w.join(' ').length <= max) return [w.join(' '), ''];
    let a = '', i = 0; while (i < w.length - 1 && (a + ' ' + w[i]).trim().length <= max) { a = (a + ' ' + w[i]).trim(); i++; }
    if (!a) { a = w[0]; i = 1; }
    return [a, w.slice(i).join(' ')];
  }
  const shortName = (s) => { const w = String(s || '').trim().split(/\s+/); while (w.length > 1 && w.join(' ').length > 14) w.shift(); return w.join(' '); };
  const ptsShort = (d) => { const n = Math.round(Math.abs(d) * 100); return n === 0 ? 'FLAT' : `${d > 0 ? '▲' : '▼'} ${n} PTS`; };
  function subjectOf(subject) { return String(subject || '').replace(/\?+\s*$/, '').replace(/^\s*will\s+/i, '').trim().toUpperCase(); }

  function setRegion(region, prob, pal, seed, info = {}) {
    clearRegion();
    if (!region) return;
    regionVec = lonLatToVec(region.lon, region.lat, 1);
    prob = clamp01(prob);
    const prev = clamp01(info.prev ?? prob), d = prob - prev;
    const dirCol = d > 0.004 ? COL.up : d < -0.004 ? COL.down : pal.a;
    const dirHex = d > 0.004 ? HEX.up : d < -0.004 ? TXT_DOWN : pal.hexA;
    const geos = [], ms = [];
    const colM = holoMaterial(pal.a, { glow: 1.4, alpha: 0.95 }); ms.push(colM);
    const cyl = new THREE.CylinderGeometry(0.2, 0.42, 1, 8, 1, true); cyl.translate(0, 0.5, 0); geos.push(cyl);
    const col = new THREE.Mesh(cyl, colM); beaconG.add(col);
    const tipM = holoMaterial(COL.white, { glow: 1.6, flat: 1 }); ms.push(tipM);
    const tipG = new THREE.SphereGeometry(0.42, 16, 12); geos.push(tipG);
    const tip = new THREE.Mesh(tipG, tipM); beaconG.add(tip);
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
    // ghost ring on the column at yesterday's height
    const ghostG = new THREE.RingGeometry(0.62, 0.8, 40); ghostG.rotateX(-Math.PI / 2); geos.push(ghostG);
    const ghostM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, depthTest: false }); ms.push(ghostM);
    const ghost = new THREE.Mesh(ghostG, ghostM); ghost.position.y = hOf(prev); ghost.renderOrder = 6; beaconG.add(ghost);
    beacon = { geos, mats: ms, rings, ret, tip, col, ghost, h: hOf(prob) };
    // orient the beacon group: local +y -> region normal
    beaconG.position.copy(regionVec).multiplyScalar(GLOBE_R * 1.0);
    beaconG.quaternion.setFromUnitVectors(_ax, regionVec);
    // arcs from hubs (seeded choice, skip hubs within ~8 degrees); colour = direction of the odds
    const arcCol = Math.abs(d) > 0.004 ? dirCol.clone().multiplyScalar(0.9) : pal.b.clone();
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
        uniforms: { uTime: TIME, uFade, uColor: { value: arcCol.clone() }, uOff: { value: i * 0.37 }, uBorn: { value: TIME.value + 0.4 + i * 0.25 } },
        vertexShader: `attribute float aU; varying float vU; void main(){ vU = aU; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uColor; uniform float uOff; uniform float uBorn; varying float vU;
          void main(){ float grow = clamp((uTime - uBorn) * 0.9, 0.0, 1.0); if (vU > grow) discard;
            float head = fract(uTime * 0.35 + uOff); float pulse = smoothstep(0.12, 0.0, abs(vU - head)) * 1.6;
            gl_FragColor = vec4(uColor * (0.7 + pulse) * uFade, 1.0); }`,
      });
      const line = new THREE.Line(g, m); line.renderOrder = 5; rot.add(line); arcs.push(line);
      // hub marker
      const hg = new THREE.SphereGeometry(0.22, 8, 6); const hm = new THREE.MeshBasicMaterial({ color: arcCol, transparent: true, opacity: 0.9 });
      const hub = new THREE.Mesh(hg, hm); hub.position.copy(a); rot.add(hub); arcs.push(hub);
    });

    // ---- data overlay (root space; labels are sprites so they always face the camera) ----
    // Sizes are in world units of FONT height (fu): the globe is ~21 px/unit on a 1080p screen, so fu 1.1 is ~23 px.
    const labels = [], meshes = [], oGeos = [], oMats = [];
    const hudG = new THREE.Group(); root.add(hudG);
    const panelG = new THREE.Group(); root.add(panelG);
    const footG = new THREE.Group(); root.add(footG);
    const leaderG = new THREE.BufferGeometry(); leaderG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const leaderM = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const leader = new THREE.Line(leaderG, leaderM); leader.renderOrder = 40; leader.frustumCulled = false; root.add(leader);
    oGeos.push(leaderG); oMats.push(leaderM);
    ov = { labels, geos: oGeos, mats: oMats, hudG, panelG, footG, leader };
    // one or two lines of text; fu = font height in world units, wU = label width in world units
    const addText = (grp, text, o, x, y, t0, max = 1) => {
      const fam = o.fam || 'Rajdhani', wt = o.wt || 700, fu = o.fu || 1, fu2 = o.fu2 || 0, hasSub = o.sub != null && o.sub !== '';
      const T = (fu + (hasSub ? fu2 : 0)) * 1.25, px = (u) => Math.round(u * 100);
      const l = makeLabel(text, {
        w: px(o.wU || 10), h: px(T), height: T, font: `${wt} ${px(fu)}px ${fam}`, color: o.color || '#ffffff', glow: o.glow || pal.hexB, align: o.align || 'left',
        sub: hasSub ? o.sub : null, subFont: `${o.wt2 || 700} ${px(fu2)}px ${o.fam2 || 'Rajdhani'}`, subColor: o.color2 || '#ffffff',
        mainY: (fu * 0.625) / T, subY: (fu * 1.25 + fu2 * 0.625) / T,
      });
      l.opacity = 0; l.sprite.position.set(x, y, 0); grp.add(l.sprite);
      const it = { l, t0, max, T }; labels.push(it); return it;
    };
    const addMesh = (grp, mesh, t0, max = 1) => { mesh.renderOrder = 40; mesh.material.depthTest = false; mesh.userData.t0 = t0; mesh.userData.max = max; grp.add(mesh); meshes.push(mesh); oGeos.push(mesh.geometry); oMats.push(mesh.material); return mesh; };
    const flatMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

    // A. headline block: REGION / SUBJECT / big % with change chip (left-aligned, stacked top-down)
    const [s1, s2] = wrap2(subjectOf(info.subject), 20);
    let y = HTOP;
    const regionL = addText(hudG, region.name.toUpperCase(), { fam: 'Orbitron', fu: 1.45, wU: 13, wt: 700 }, HX, 0, 0.8); regionL.l.sprite.position.y = y - regionL.T / 2; y -= regionL.T;
    const subjL = addText(hudG, s1 || ' ', { fu: 1.35, fu2: 1.35, wU: 14, color: pal.hexA, sub: s2 || null, color2: pal.hexA }, HX, 0, 0.95); subjL.l.sprite.position.y = y - subjL.T / 2; y -= subjL.T;
    const pctL = addText(hudG, pctText(prev), { fam: 'Orbitron', wt: 900, fu: 2.7, fu2: 1.15, wU: 13, sub: ptsText(d).toUpperCase(), color2: dirHex }, HX, 0, 1.9); pctL.l.sprite.position.y = y - pctL.T / 2; y -= pctL.T;
    ov.hud = { regionL, pctL, leaderY: HTOP - regionL.T / 2 };
    const PY = y - 0.5;   // board top

    // C. board: a leaderboard when the story has 2+ outcomes, otherwise one labelled gauge (yesterday -> now) on a 0-100% track
    const outs = (info.outcomes || []).slice(0, 4);
    hasPanel = outs.length >= 2;
    ov.rows = [];
    const mkBar = (top, t0, c, pv, W = BAR_W) => {
      const trackG = new THREE.PlaneGeometry(W, 0.65); trackG.translate(W / 2, 0, 0);
      const track = addMesh(panelG, new THREE.Mesh(trackG, flatMat(DIM)), t0, 0.5); track.position.set(HX, top, 0); track.renderOrder = 39;
      const fillG = new THREE.PlaneGeometry(1, 0.65); fillG.translate(0.5, 0, 0);
      const fill = addMesh(panelG, new THREE.Mesh(fillG, flatMat(c.clone().multiplyScalar(0.85))), t0, 0.95); fill.position.set(HX, top, 0); fill.scale.x = 0.001;
      const tick = addMesh(panelG, new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.1), flatMat(0xffffff)), t0 + 0.7, 0.95); tick.position.set(HX + pv * W, top, 0);
      fill.userData.W = W;
      return fill;
    };
    if (hasPanel) {
      const leadI = outs.reduce((bi, o, i) => (o.p > outs[bi].p ? i : bi), 0);
      addText(panelG, 'CHANCE NOW  ·  WHITE TICK = YESTERDAY', { fu: 0.95, wU: 14, color: '#cfe0ff' }, HX, PY - 0.5, 1.2, 0.95);
      outs.forEach((o, i) => {
        const top = PY - 1.25 - i * ROW, t0 = 1.3 + i * 0.28, hex = OUTCOME_COLORS[i % OUTCOME_COLORS.length], c = new THREE.Color(hex);
        const od = o.d || 0, pv = clamp01(o.p - od), isLead = i === leadI;
        const odCol = od > 0.004 ? HEX.up : od < -0.004 ? TXT_DOWN : '#cfe0ff';
        if (isLead) {   // soft highlight plate behind the leader
          const pg = new THREE.PlaneGeometry(PANEL_W + 0.8, ROW - 0.15); pg.translate((PANEL_W + 0.8) / 2 - 0.4, 0, 0);
          const pl = addMesh(panelG, new THREE.Mesh(pg, flatMat(c.clone().multiplyScalar(0.5))), t0, 0.22); pl.position.set(HX, top - 1.05, 0); pl.renderOrder = 38;
        }
        addText(panelG, shortName(o.name).toUpperCase() || ' ', { fu: 1.2, wU: 8, color: isLead ? '#ffffff' : '#d8e4ff', glow: hex }, HX, top - 0.5, t0);
        const dl = addText(panelG, ptsShort(od), { fu: 1.1, wU: 6, color: odCol, align: 'right', glow: hex }, HX + PANEL_W, top - 0.5, t0 + 1.2);
        const fill = mkBar(top - 1.6, t0, c, pv);
        const pc = addText(panelG, pctText(pv), { fam: 'Orbitron', wt: 900, fu: 1.2, wU: 5, color: isLead ? '#ffffff' : '#e4ecff', glow: hex }, HX + BAR_W + 0.45, top - 1.6, t0);
        ov.rows.push({ fill, pc, dl, t0, pv, p: clamp01(o.p), lastPct: -1 });
      });
    } else {
      const t0 = 1.3, top = PY - 0.4;
      addText(panelG, `YESTERDAY ${pctText(prev)}`, { fu: 1.15, wU: 8, color: '#ffffff' }, HX, top - 0.5, t0);
      const nowL = addText(panelG, `NOW ${pctText(prev)}`, { fu: 1.15, wU: 8, color: dirHex, align: 'right' }, HX + PANEL_W + 1, top - 0.5, t0 + 0.9);
      const fill = mkBar(top - 1.6, t0, pal.a, prev, PANEL_W + 1);
      for (const [p, txt, al] of [[0, '0%', 'left'], [0.5, '50%', 'center'], [1, '100%', 'right']]) addText(panelG, txt, { fu: 1.0, wU: 3, color: '#cfe0ff', align: al }, HX + p * (PANEL_W + 1), top - 2.75, t0 + 0.2, 0.9);
      ov.rows.push({ fill, pc: null, nowL, t0, pv: prev, p: prob, lastPct: -1 });
    }
    // E. footer: source, 24h volume, freshness (flagged amber when thin)
    {
      const parts = [info.source, info.vol != null ? `${info.vol} 24H VOLUME` : null, info.updated ? `UPDATED ${info.updated}` : null, info.thin ? 'THIN MARKET' : null].filter(Boolean);
      if (parts.length) {
        const fg = new THREE.PlaneGeometry(20.5, 1.6); const fm = new THREE.MeshBasicMaterial({ color: 0x06021a, transparent: true, opacity: 0, depthWrite: false });
        const fp = addMesh(footG, new THREE.Mesh(fg, fm), 0.4, 0.6); fp.position.set(0, -(GLOBE_R + 1.45), 0); fp.renderOrder = 39;
      }
      if (parts.length) addText(footG, parts.join('  ·  ').toUpperCase(), { fu: 1.15, wU: 20, color: info.thin ? '#ffcf70' : '#cfe0ff', align: 'center' }, 0, -(GLOBE_R + 1.45), 0.5, 0.95);
    }
    ov.prob = prob; ov.prev = prev; ov.lastNow = -1;
    return beacon;
  }

  // ---- state ----
  let shown = false, fade = 0, tShow = 0, tgtY = -GLOBE_R - 8, tgtRotX = 0.35, tgtRotY = 0, idle = true;
  const api = {
    root, rot, station: station.clone(), R: GLOBE_R,
    get fade() { return fade; },
    // prev = yesterday's chance (prob - change1d); outcomes = [{ name, p, d }]; subject = what the % is of; info = { source, vol, updated, thin }
    show({ region = null, prob = 0.5, prev = null, outcomes = null, subject = '', info = null, palette: pal, seed = 1 } = {}) {
      shown = true; root.visible = true; halo.visible = true; tShow = 0;
      colA.value.copy(pal.a); colB.value.copy(pal.b);
      tgtY = GLOBE_R + 2.6;
      setRegion(region, prob, pal, seed, { ...(info || {}), prev, outcomes, subject });
      if (region) {
        idle = false;
        // park the region on the upper-right of the visible disc so the beacon reads in profile against the sky
        const elev = 0.45, yawOff = 0.85;
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
      const right = GLOBE_R * 2.3;   // the leaderboard / headline block sit right of the sphere
      const box = new THREE.Box3(c.clone().add(new THREE.Vector3(-GLOBE_R * 1.1, -GLOBE_R * 1.2, -3)), c.clone().add(new THREE.Vector3(right, GLOBE_R * 1.25 + 2, 3)));
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
      if (beacon && ov) {
        const on = clamp01((tShow - 0.9) * 1.2);
        for (const m of beacon.mats) { if (m.uniforms?.uFade) m.uniforms.uFade.value = fade * on; else m.opacity = fade * on; }
        // the column rises to yesterday, holds, then sweeps to today
        const pNow = kf((tShow - 0.9) / 2.2, ov.prev, ov.prob), hCur = hOf(pNow);
        beacon.col.scale.y = Math.max(0.05, hCur);
        beacon.tip.position.y = hCur;
        beacon.tip.scale.setScalar(0.85 + 0.3 * Math.sin(t * 5));
        for (const r of beacon.rings) { const k = (t * 0.6 + r.userData.phase) % 1; r.scale.setScalar(0.6 + k * 3.2); r.material.opacity = (1 - k) * 0.8 * fade * on; }
        beacon.ret.rotation.y = t * 0.8;
        // beacon tip in root space, joined to the headline by a leader line
        _n.copy(regionVec).applyQuaternion(rot.quaternion);
        _bp.copy(_n).multiplyScalar(GLOBE_R + hCur);
        const lp = ov.leader.geometry.attributes.position;
        lp.setXYZ(0, _bp.x, _bp.y, _bp.z); lp.setXYZ(1, HX - 0.8, ov.hud.leaderY, 0); lp.setXYZ(2, HX - 0.8, ov.hud.leaderY, 0); lp.needsUpdate = true;
        ov.leader.material.opacity = 0.55 * fade * clamp01((tShow - 1.9) * 2.5);
        // counters follow the column
        const nowPct = Math.round(pNow * 100);
        if (nowPct !== ov.lastNow) { ov.lastNow = nowPct; ov.hud.pctL.l.set(`${nowPct}%`); }
        beacon.ghost.material.opacity = 0.8 * fade * clamp01((tShow - 1.5) * 2.5);
        // board bars: grow to yesterday, hold, sweep to today (staggered)
        for (const r of ov.rows) {
          const v = kf((tShow - r.t0) / 1.6, r.pv, r.p);
          r.fill.scale.x = Math.max(0.001, v * r.fill.userData.W);
          const pc = Math.round(v * 100);
          if (pc !== r.lastPct) { r.lastPct = pc; if (r.pc) r.pc.l.set(`${pc}%`); if (r.nowL) r.nowL.l.set(`NOW ${pc}%`); }
        }
        for (const it of ov.labels) it.l.opacity = fade * clamp01((tShow - it.t0) * 2.5) * it.max;
        for (const m of ov.panelG.children.concat(ov.footG.children)) if (m.material && m.userData.t0 != null) m.material.opacity = fade * clamp01((tShow - m.userData.t0) * 2.5) * m.userData.max;
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
