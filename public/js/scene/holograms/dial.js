// DIAL: a giant probability gauge. The needle sweeps from yesterday's price to today's; a ghost needle marks where it was.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, pctText, ptsText, boxAt } from '../holo.js';
import { arcMesh, tickPositions, floorRing, lineSeg } from './parts.js';

const D2R = Math.PI / 180;

// opts.alert: { from, to, minutes } renders the breaking-move variant
export function createDial(ctx, story, opts = {}) {
  const { pal, rnd } = ctx;
  const lead = story?.lead || story?.markets?.[0] || { yesPrice: 0.5, change1d: 0 };
  const sw = !opts.alert && story?.swing && Number.isFinite(story.swing.from) && Number.isFinite(story.swing.to) ? story.swing : null;
  const value = clamp01(opts.alert ? opts.alert.to : sw ? sw.to : lead.yesPrice);
  const prev = clamp01(opts.alert ? opts.alert.from : sw ? sw.from : value - (lead.change1d || 0));
  const delta = value - prev;
  const R = 8.6, CY = 9.2;
  const holo = new Holo(ctx, { height: CY + R + 2.5 });
  const root = holo.root;

  const spanDeg = 220 + rnd() * 40;
  const span = spanDeg * D2R;
  const start = (90 - spanDeg / 2) * D2R; // value-1 end (right, below the horizon); value-0 end = start + span (left)
  const angOf = (v) => start + span * (1 - v);
  const dial = new THREE.Group(); dial.position.y = CY; root.add(dial);

  // track + ticks
  const track = new THREE.Mesh(new THREE.RingGeometry(R - 0.3, R, 160, 1, start, span), holo.mat(pal.b, { flat: 1, alpha: 0.35, glow: 1.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  dial.add(track);
  dial.add(lineSeg(tickPositions(R + 0.35, start, span), holo.line(pal.b, { alpha: 0.75 })));
  // fills
  const fillMain = arcMesh(R - 1.35, R - 0.45, pal.a, { start, span, lo: 0, hi: 0, glow: 1.3, alpha: 0.85 });
  const upDown = delta >= 0 ? COL.up : COL.down;
  const fillDelta = arcMesh(R - 1.9, R - 1.45, upDown, { start, span, lo: 0, hi: 0, glow: 1.8, alpha: 0.95 });
  holo.reg(fillMain.material); holo.reg(fillDelta.material);
  dial.add(fillMain, fillDelta);
  // needle + ghost
  function needle(color, alpha, len, w) {
    const g = new THREE.BoxGeometry(w, len, w * 0.6); g.translate(0, len / 2, 0);
    const m = new THREE.Mesh(g, holo.mat(color, { flat: 1, alpha, glow: 1.8 }));
    const pivot = new THREE.Group(); pivot.add(m); dial.add(pivot); return pivot;
  }
  // ghost tick: a bright notch on the rim where the needle started (swing cards)
  if (sw) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.2), holo.mat(pal.b, { flat: 1, alpha: 0.95, glow: 2 }));
    tick.position.set(0, R - 0.9, 0.1);
    const tp = new THREE.Group(); tp.add(tick); tp.rotation.z = angOf(prev) - Math.PI / 2; dial.add(tp);
  }
  const nd = needle(COL.white, 1, R - 1.2, 0.26);
  const ghost = needle(pal.b, 0.35, R - 1.6, 0.16);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), holo.mat(pal.a, { flat: 1, glow: 1.5 }));
  dial.add(hub);
  const hubRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 48), holo.mat(COL.white, { flat: 1, alpha: 0.8, glow: 1.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  dial.add(hubRing);
  // decorative orbit rings (seeded gaps), rotate at different speeds
  const orbits = [];
  const nOrb = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nOrb; i++) {
    const r = R + 1.4 + i * 0.9, gap = 0.4 + rnd() * 1.2, segs = 2 + Math.floor(rnd() * 3);
    const g = new THREE.Group();
    for (let s = 0; s < segs; s++) {
      const len = (Math.PI * 2) / segs - gap / r;
      const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.07 + i * 0.03, 64, 1, (s * Math.PI * 2) / segs, len), holo.mat(i % 2 ? pal.a : pal.b, { flat: 1, alpha: 0.55 - i * 0.12, glow: 1.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      g.add(m);
    }
    g.userData.speed = (rnd() - 0.5) * 0.5 * (i + 1);
    dial.add(g); orbits.push(g);
  }
  // radial spokes behind the dial (faint)
  {
    const arr = [];
    for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; arr.push(Math.cos(a) * 1.4, Math.sin(a) * 1.4, -0.3, Math.cos(a) * (R - 2.2), Math.sin(a) * (R - 2.2), -0.3); }
    dial.add(lineSeg(new Float32Array(arr), holo.line(pal.b, { alpha: 0.12 })));
  }
  // min / max end caps
  const capMat = holo.mat(COL.white, { flat: 1, alpha: 0.9, glow: 1.4 });
  for (const v of [0, 1]) { const a = angOf(v); const c = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), capMat); c.position.set(Math.cos(a) * (R - 0.15), Math.sin(a) * (R - 0.15), 0.1); dial.add(c); }

  // floor
  const floorMat = holo.mat(pal.b, { flat: 1, alpha: 0.6, glow: 1.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  root.add(floorRing(R + 2.2, R + 2.35, floorMat));
  root.add(floorRing(3.2, 3.3, floorMat, 64));
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, CY - 1.2, 6), holo.mat(pal.b, { flat: 1, alpha: 0.5, glow: 1.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  stem.position.y = (CY - 1.2) / 2; root.add(stem);

  // labels
  const isAlert = !!opts.alert;
  // full-screen cards (every segment but 'top') already carry the number in 2D: keep the arc, sweep and ticks, drop the big %
  const showBig = isAlert || (opts.seg || 'top') === 'top';
  const big = !showBig ? null : holo.label(pctText(sw ? prev : value), { w: 1024, h: 256, height: 3.0, font: '900 190px Orbitron', color: '#ffffff', glow: isAlert ? '#ff3a2e' : pal.hexA, sub: isAlert ? `${pctText(prev)} → ${pctText(value)} in ${opts.alert.minutes} min` : ptsText(sw ? value - prev : (lead.change1d || 0)), subColor: delta >= 0 ? '#3dff8a' : '#ff2e55', subFont: '700 84px Rajdhani' });
  if (big) { big.sprite.position.set(0, CY - 3.3, 0.6); big.yFrac = 0.4; }
  const ends = holo.label('0%', { w: 256, h: 128, height: 1.0, font: '700 80px Orbitron', color: '#dfe8ff', glow: pal.hexB });
  ends.sprite.position.set(Math.cos(angOf(0)) * (R + 0.4), CY + Math.sin(angOf(0)) * (R + 0.4) - 1.1, 0.2); ends.yFrac = 0.1;
  const ends2 = holo.label('100%', { w: 256, h: 128, height: 1.0, font: '700 80px Orbitron', color: '#dfe8ff', glow: pal.hexB });
  ends2.sprite.position.set(Math.cos(angOf(1)) * (R + 0.4), CY + Math.sin(angOf(1)) * (R + 0.4) - 1.1, 0.2); ends2.yFrac = 0.1;

  let shown = prev, shownTxt = '';
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    // sweep: hold at prev while scanning in, then swing to value with a bit of overshoot
    const k = clamp01((ts - (sw ? 0.9 : 1.0)) / (sw ? 2.0 : 1.9));
    const e = sw ? ease.inOut(k) : ease.back(k);
    shown = prev + (value - prev) * e;
    const vis = clamp01(shown);
    nd.rotation.z = angOf(vis) - Math.PI / 2;
    ghost.rotation.z = angOf(prev) - Math.PI / 2;
    fillMain.material.uniforms.uHi.value = vis;
    const lo = Math.min(prev, vis), hi = Math.max(prev, vis);
    fillDelta.material.uniforms.uLo.value = lo; fillDelta.material.uniforms.uHi.value = hi;
    // swing cards: the number counts along with the needle
    if (big && sw) { const txt = pctText(vis); if (txt !== shownTxt) { shownTxt = txt; big.set(txt); } }
    hub.scale.setScalar(1 + 0.08 * Math.sin(t * 4));
    hubRing.rotation.z = t * 0.9; hubRing.scale.setScalar(1 + 0.05 * Math.sin(t * 2.3));
    for (const o of orbits) o.rotation.z += o.userData.speed * dt;
    // the needle quivers slightly once settled (a live market)
    if (k >= 1) nd.rotation.z += Math.sin(t * 9) * 0.004 + Math.sin(t * 2.3) * 0.003;
    dial.rotation.y = Math.sin(t * 0.21) * 0.1;
    root.rotation.y = Math.sin(t * 0.13) * 0.03;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, CY - 0.5, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 2, 40)), orbit: 0.1, box: boxAt(this.station, -(R + 3), CY - R - 1.5, -1.5, R + 3, CY + R + 2.6, 1.5) };
  };
  return holo;
}
