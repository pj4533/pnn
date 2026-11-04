// OUTCOMES: a clean podium — one rising column per outcome, height = its chance, coloured like the 2D outcome bars
// (OUTCOME_COLORS, same order), with the % and the name floating clear above each column.
// No hemicycle of "seats": that came from Election Night's Senate graphic and misreads a 41% chance as 41 seats
// (user feedback 2026-11-04).
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, pctText, boxAt } from '../holo.js';
import { hemicycle, floorRing, lineSeg } from './parts.js';
import { OUTCOME_COLORS } from '../../util.js';
const SEAT_RE = /\b(seats?|balance of power|majority|supermajority|control of|chamber|trifecta)\b/i;

const DIM = new THREE.Color(0.12, 0.09, 0.26);

export function createOutcomes(ctx, story, opts = {}) {
  const { pal, rnd, fx } = ctx;
  const H = 12;
  const holo = new Holo(ctx, { height: H + 8 }); // room for the taller podium columns + labels
  const root = holo.root;
  const CY = 1.4;

  const markets = (story.markets || []).slice(0, 5);
  const raw = markets.map((m) => clamp01(m.yesPrice ?? 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  const share = sum > 1 ? raw.map((p) => p / sum) : raw.slice();
  // same colours as the 2D outcome bars, one per outcome (the theme palette only has 4 and wrapped)
  const hexes = markets.map((_, i) => OUTCOME_COLORS[i % OUTCOME_COLORS.length]);
  const colors = hexes.map((h) => new THREE.Color(h));
  // Chamber mode: the outcomes are Senate seat counts ("56", "55", "Above 57"). Then the 100 pips are the actual Senate,
  // with the most likely count's seats in the party's colour: 56 blue + 44 red, not "83% of seats" (a probability).
  const ttl = `${story.eventTitle || ''} ${markets[0]?.title || ''}`;
  const leadSeats = parseInt(String(markets[0]?.label || markets[0]?.outcome || '').replace(/[^0-9]/g, ''), 10);
  const seatMode = false; // chamber/hemicycle retired — every outcome story is a podium
  const DEM = new THREE.Color('#3d8bff'), REP = new THREE.Color('#ff3b5c');
  const partyIsRep = /\brepublican|\bgop\b/i.test(ttl) && !/\bdemocrat/i.test(ttl);

  // ---- hemicycle of 100 pips, standing up, facing the camera ----
  const rows = 4 + Math.floor(rnd() * 3);
  const r0 = 4.6, r1 = 9.2;
  const seats = hemicycle(100, rows, r0, r1);
  const shapeK = Math.floor(rnd() * 3);
  const pipGeo = shapeK === 0 ? new THREE.IcosahedronGeometry(0.3, 1) : shapeK === 1 ? new THREE.OctahedronGeometry(0.34, 0) : new THREE.BoxGeometry(0.42, 0.42, 0.42);
  const pipMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
  holo.reg(pipMat);
  const pips = new THREE.InstancedMesh(pipGeo, pipMat, 100);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
  seats.forEach((s, i) => { m4.makeTranslation(s.x, CY + s.y, 0); pips.setMatrixAt(i, m4); pips.setColorAt(i, DIM); });
  pips.instanceMatrix.needsUpdate = true; pips.instanceColor.needsUpdate = true;
  root.add(pips);
  pips.visible = seatMode;
  // seat assignment: outcome i takes round(share*100) pips left to right; rest dim
  // chamber: first leadSeats pips = the party in the question, the rest = the other party
  const counts = seatMode ? [leadSeats, 100 - leadSeats] : [];
  const owner = new Array(100).fill(-1);
  if (seatMode) for (let i = 0; i < 100; i++) owner[i] = i < leadSeats ? 0 : 1;
  const partyCol = [partyIsRep ? REP : DEM, partyIsRep ? DEM : REP];
  const cur = seats.map(() => DIM.clone()), tgt = seats.map((_, i) => (owner[i] >= 0 ? partyCol[owner[i]].clone().multiplyScalar(1.6) : DIM.clone()));

  // ---- columns behind the arc ----
  const n = markets.length;
  const spread = seatMode ? Math.min(22, 4 + n * 4.2) : Math.min(26, 6 + n * 4.6);
  const COLZ = seatMode ? -4.2 : 0;
  const HH = seatMode ? H : H + 3;   // podium columns get more height to show differences
  // seat mode: each column stands under the middle of its own wedge of the hemicycle
  const wedgeX = (() => { let acc = 0; return counts.map((c) => { const mid = acc + c / 2; acc += c; return Math.cos(Math.PI * (1 - mid / 100)) * (r1 + 0.4); }); })();
  // swing: the lead market's column sweeps from swing.from to swing.to (ghost ring left at the old height)
  const sw = story.swing && Number.isFinite(story.swing.from) && Number.isFinite(story.swing.to) ? story.swing : null;
  const leadIdx = Math.max(0, markets.findIndex((m) => story.lead && m.id === story.lead.id));
  const fullCard = (opts.seg || 'top') !== 'top';   // full-screen cards carry the numbers in 2D: columns keep names only
  const colW = Math.min(2.3, spread / Math.max(1, n) - 1.4);
  const colShape = Math.floor(rnd() * 3);
  const cols = [];
  if (seatMode) {
    const lbl = holo.label(`${leadSeats} SEATS`, { w: 900, h: 256, height: 2.2, font: '900 150px Orbitron', color: '#ffffff', glow: partyIsRep ? '#ff3b5c' : '#3d8bff', sub: `${pctText(raw[0])} CHANCE · MOST LIKELY`, subColor: '#ffffff', subFont: '700 84px Rajdhani' });
    lbl.sprite.position.set(0, CY + r1 + 2.6, 0); lbl.yFrac = 1;
  }
  if (!seatMode) markets.forEach((m, i) => {
    const x = seatMode ? wedgeX[i] : n === 1 ? 0 : -spread / 2 + (spread * (i + 0.5)) / n;
    const h = 0.8 + raw[i] * HH;
    let g;
    if (colShape === 0) g = new THREE.BoxGeometry(colW, 1, colW);
    else if (colShape === 1) g = new THREE.CylinderGeometry(colW / 2, colW / 2, 1, 6, 1);
    else g = new THREE.CylinderGeometry(colW / 2 * 0.9, colW / 2, 1, 18, 1);
    g.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(g, holo.mat(colors[i], { glow: 1.15 }));
    mesh.position.set(x, 0.02, COLZ); mesh.scale.y = 0.01;
    root.add(mesh);
    // cap ring at the top
    const capG = new THREE.RingGeometry(colW * 0.75, colW * 0.9, 32); capG.rotateX(-Math.PI / 2);
    const cap = new THREE.Mesh(capG, holo.mat(colors[i], { flat: 1, alpha: 0.9, glow: 1.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    cap.position.set(x, 0.1, COLZ); root.add(cap);
    // label: pct big, outcome name under, staggered so neighbours don't collide
    const name = (m.label || m.outcome || m.title || '').toUpperCase();
    const isSw = !!sw && i === leadIdx;
    const hFrom = isSw ? 0.8 + clamp01(sw.from) * HH : h, hTo = isSw ? 0.8 + clamp01(sw.to) * HH : h;
    const hStart = isSw ? hFrom : h;
    const lbl = fullCard
      ? holo.label(name, { w: 640, h: 192, height: 1.5, font: '900 120px Orbitron', color: '#ffffff', glow: hexes[i] })
      : holo.label(pctText(isSw ? sw.from : raw[i]), { w: 640, h: 256, height: 1.9, font: '900 150px Orbitron', color: '#ffffff', glow: hexes[i], sub: name, subColor: hexes[i], subFont: '700 84px Rajdhani' });
    lbl.sprite.position.set(x, hStart + (fullCard ? 2.2 : 2.6), COLZ);
    lbl.yFrac = clamp01(h / (HH + 4));
    let ghost = null;
    if (isSw) {
      const gg = new THREE.RingGeometry(colW * 0.55, colW * 1.1, 32); gg.rotateX(-Math.PI / 2);
      ghost = new THREE.Mesh(gg, holo.mat(COL.white, { flat: 1, alpha: 0.85, glow: 1.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      ghost.position.set(x, hFrom + 0.1, COLZ); root.add(ghost);
    }
    cols.push({ mesh, cap, h: hStart, hNow: hStart, hFrom, hTo, sw: isSw, lblTxt: '', lbl, name, x, ghost, fullCard, color: colors[i], leader: i === 0 });
  });

  // ---- floor + frame ----
  const frameMat = holo.mat(pal.b, { flat: 1, alpha: 0.7, glow: 1.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  root.add(floorRing(r1 + 0.9, r1 + 1.05, frameMat, 128));
  const base = new THREE.Mesh(new THREE.PlaneGeometry(2 * (r1 + 1.2), 0.08), holo.mat(pal.a, { flat: 1, alpha: 0.9, glow: 1.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  base.position.set(0, CY - 0.5, 0.2); root.add(base);
  const arcLine = new THREE.Mesh(new THREE.RingGeometry(r1 + 0.6, r1 + 0.7, 96, 1, 0, Math.PI), frameMat);
  arcLine.position.set(0, CY, 0); if (seatMode) root.add(arcLine);
  // divider spokes between outcomes on the arc
  {
    const arr = []; let acc = 0;
    for (let i = 0; i < counts.length - 1; i++) { acc += counts[i]; const a = Math.PI * (1 - acc / 100); arr.push(Math.cos(a) * (r0 - 0.6), CY + Math.sin(a) * (r0 - 0.6), 0, Math.cos(a) * (r1 + 0.6), CY + Math.sin(a) * (r1 + 0.6), 0); }
    if (seatMode && arr.length) root.add(lineSeg(new Float32Array(arr), holo.line(COL.white, { alpha: 0.35 })));
  }
  // leader halo ring (rotating) at the leader column
  const leader = cols[0];
  let haloRing = null;
  if (leader) {
    const hg = new THREE.TorusGeometry(colW * 1.1, 0.05, 8, 48);
    haloRing = new THREE.Mesh(hg, holo.mat(leader.color, { flat: 1, alpha: 0.9, glow: 2, depthWrite: false, blending: THREE.AdditiveBlending }));
    haloRing.rotation.x = Math.PI / 2; haloRing.position.set(leader.x, 0, COLZ); root.add(haloRing);
  }

  const tmp = new THREE.Color();
  let emitAcc = 0;
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    // pips reveal outward from both ends, flicker to life
    const kk = 1 - Math.exp(-6 * dt);
    for (let i = 0; i < 100; i++) {
      const order = Math.min(i, 99 - i) / 50;
      const on = clamp01((ts - 0.35 - order * 1.3) / 0.25);
      tmp.copy(DIM).lerp(tgt[i], on);
      if (owner[i] >= 0) tmp.multiplyScalar(0.85 + 0.25 * Math.sin(t * 3 + i * 0.4));
      else tmp.multiplyScalar(0.8 + 0.6 * Math.max(0, Math.sin(t * 1.3 + i * 0.7)) ** 8);
      cur[i].lerp(tmp, kk);
      pips.setColorAt(i, cur[i]);
      // tiny bob
      const s = seats[i];
      p3.set(s.x, CY + s.y + Math.sin(t * 1.7 + i * 0.3) * 0.05, 0);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t * 0.6 + i);
      m4.compose(p3, q, s3); pips.setMatrixAt(i, m4);
    }
    pips.instanceColor.needsUpdate = true; pips.instanceMatrix.needsUpdate = true;
    pipMat.opacity = this.fade;
    // columns grow with a stagger
    cols.forEach((c, i) => {
      const g = ease.back(clamp01((ts - 0.5 - i * 0.12) / 1.1));
      if (c.sw) {
        const k = ease.inOut(clamp01((ts - 1.5) / 2.0));
        c.hNow = c.hFrom + (c.hTo - c.hFrom) * k;
        c.lbl.sprite.position.y = c.hNow * Math.min(1, g) + (c.fullCard ? 2.2 : 2.6);
        if (!c.fullCard) {   // the number counts along with the column
          const v = (c.hNow - 0.8) / HH, txt = pctText(v);
          if (txt !== c.lblTxt) { c.lblTxt = txt; c.lbl.set(txt); }
        }
      } else c.hNow = c.h;
      c.mesh.scale.y = Math.max(0.01, c.hNow * g);
      c.cap.position.y = 0.1 + c.hNow * g; c.cap.rotation.y = t * (c.leader ? 1.2 : 0.4);
    });
    if (haloRing) { haloRing.position.y = leader.hNow * ease.back(clamp01((ts - 0.5) / 1.1)) + 0.6 + Math.sin(t * 2) * 0.3; haloRing.rotation.z = t * 0.7; }
    root.rotation.y = Math.sin(t * 0.17) * 0.06;
    // leader sheds light upward
    emitAcc += dt;
    if (leader && this.visible && ts > 1.6 && emitAcc > 0.35) { emitAcc = 0; fx.stream(root.localToWorld(new THREE.Vector3(leader.x, leader.hNow + 0.4, -4.2)), leader.color, 6, new THREE.Vector3(0, 1, 0), { speed: 2.5, lifeS: 1.6, sz: 0.8 }); }
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, 6.6, -1));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 2.5, 40)), orbit: 0.1, box: boxAt(this.station, -Math.max(r1 + 1.5, spread / 2 + 2), 0, -6, Math.max(r1 + 1.5, spread / 2 + 2), H + 4, 1.5) };
  };
  return holo;
}
