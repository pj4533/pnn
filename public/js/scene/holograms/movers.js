// MOVERS: a field of neon pillars on a floating plate. Risers go up, fallers hang below; height = today's move.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, boxAt } from '../holo.js';
import { rectOutline, bracketPositions, lineSeg } from './parts.js';

export function createMovers(ctx, markets) {
  const { pal, rnd, fx } = ctx;
  const ms = (markets || []).filter((m) => Number.isFinite(m.change1d)).sort((a, b) => b.change1d - a.change1d).slice(0, 18);
  const n = Math.max(1, ms.length);
  const PY = 7.8, UP_MAX = 11.5, DOWN_MAX = 7.0;
  const holo = new Holo(ctx, { height: PY + UP_MAX + 2 });
  const root = holo.root;
  const W = Math.max(16, n * 1.75 + 3), D = 6.5;

  // ---- floating plate ----
  const plateMat = holo.mat(pal.b, { flat: 1, alpha: 0.07, glow: 1.0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(W, D), plateMat);
  plate.rotation.x = -Math.PI / 2; plate.position.y = PY; root.add(plate);
  root.add(lineSeg(rectOutline(W, D, PY), holo.line(pal.b, { alpha: 0.8, glow: 1.7 })));
  root.add(lineSeg(bracketPositions(W + 1.2, D + 1.2, PY, 1.6), holo.line(pal.a, { alpha: 0.9, glow: 1.8 })));
  root.add(lineSeg(rectOutline(W + 3, D + 3, 0.05), holo.line(pal.a, { alpha: 0.35 })));
  // zero line across the plate centre
  root.add(lineSeg(new Float32Array([-W / 2, PY, 0, W / 2, PY, 0]), holo.line(COL.white, { alpha: 0.5 })));
  // support struts
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, PY, 6), holo.mat(pal.b, { flat: 1, alpha: 0.45, glow: 1.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    strut.position.set(sx * (W / 2 - 0.5), PY / 2, -D / 2 + 0.3); root.add(strut);
  }

  // ---- pillars ----
  const pw = Math.min(1.1, (W - 2) / n - 0.45);
  const shapeK = Math.floor(rnd() * 2);
  const pillars = [];
  ms.forEach((m, i) => {
    const c = m.change1d, up = c >= 0;
    const x = -W / 2 + 1 + ((W - 2) * (i + 0.5)) / n;
    const z = 1.6 * Math.cos((i / Math.max(1, n - 1) - 0.5) * Math.PI) - 0.8;
    // sqrt over the full 0..100 point range: small moves stay visible and a 55 vs 96 point move still reads differently
    const mag = Math.sqrt(Math.min(1, Math.abs(c)));
    const h = up ? 0.6 + UP_MAX * mag : 0.6 + DOWN_MAX * mag;
    const g = shapeK ? new THREE.CylinderGeometry(pw / 2, pw / 2, 1, 6, 1) : new THREE.BoxGeometry(pw, 1, pw);
    g.translate(0, up ? 0.5 : -0.5, 0);
    const color = up ? COL.up : COL.down;
    const mesh = new THREE.Mesh(g, holo.mat(color, { glow: 1.25 }));
    mesh.position.set(x, PY, z); mesh.scale.y = 0.01; root.add(mesh);
    const capG = shapeK ? new THREE.RingGeometry(pw * 0.6, pw * 0.72, 6) : new THREE.RingGeometry(pw * 0.62, pw * 0.74, 4);
    capG.rotateX(-Math.PI / 2); if (!shapeK) capG.rotateY(Math.PI / 4);
    const cap = new THREE.Mesh(capG, holo.mat(COL.white, { flat: 1, alpha: 0.9, glow: 1.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    cap.position.set(x, PY, z); root.add(cap);
    const p = { mesh, cap, h, up, x, z, color, c, delay: i * 0.05, lbl: null, beam: null };
    pillars.push(p);
  });
  // streams off the top 3 risers and fallers; a label and beam only on the single biggest of each, because
  // neighbouring pillars sit closer together than a label is wide and labels on all three overprinted
  const ups = pillars.filter((p) => p.up).slice(0, 3), downs = pillars.filter((p) => !p.up).slice(-3).reverse();
  for (const list of [ups.slice(0, 1), downs.slice(0, 1)]) list.forEach((p, i) => {
    const pts = Math.round(Math.abs(p.c) * 100);
    p.lbl = holo.label(`${p.up ? '▲' : '▼'} ${pts}`, { w: 512, h: 224, height: 1.25, font: '900 150px Orbitron', color: '#ffffff', glow: p.up ? '#3dff8a' : '#ff2e55', sub: `${pctText(p)}`, subColor: p.up ? '#3dff8a' : '#ff2e55', subFont: '700 80px Rajdhani' });
    p.lbl.sprite.position.set(p.x, PY + (p.up ? p.h + 1.3 + i * 0.1 : -p.h - 1.2), p.z + 0.5);
    p.lbl.yFrac = clamp01((PY + (p.up ? p.h : -p.h)) / (PY + UP_MAX + 2));
    if (i === 0) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 6), holo.mat(p.color, { flat: 1, alpha: 0.8, glow: 2.0, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.position.set(p.x, PY, p.z); root.add(beam); p.beam = beam;
    }
  });
  function pctText(p) { const m = ms.find((mm) => mm.change1d === p.c); return m ? `NOW ${Math.round(clamp01(m.yesPrice) * 100)}%` : ''; }

  let emitAcc = 0, sweepAcc = 0;
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    for (const p of pillars) {
      const g = ease.back(clamp01((ts - 0.4 - p.delay) / 1.0));
      const hh = Math.max(0.01, p.h * g);
      p.mesh.scale.y = hh;
      p.cap.position.y = PY + (p.up ? hh : -hh);
      p.cap.rotation.y = t * (p.up ? 0.8 : -0.8);
      if (p.beam) { const bl = 4 + Math.sin(t * 3) * 1.2; p.beam.scale.y = bl; p.beam.position.y = PY + (p.up ? hh + bl / 2 : -hh - bl / 2); }
    }
    // energy streams off the tops of the biggest movers
    emitAcc += dt;
    if (this.visible && ts > 1.5 && emitAcc > 0.12) {
      emitAcc = 0;
      const src = Math.random() < 0.55 ? ups : downs;
      const p = src[Math.floor(Math.random() * src.length)];
      if (p) fx.stream(root.localToWorld(new THREE.Vector3(p.x, PY + (p.up ? p.h : -p.h), p.z)), p.color, 4, new THREE.Vector3(0, p.up ? 1 : -1, 0), { speed: 3.5, lifeS: 1.2, sz: 0.8, spread: 0.5 });
    }
    // plate scan sweep
    sweepAcc += dt;
    plateMat.uniforms.uAlpha.value = 0.07 + 0.05 * Math.max(0, Math.sin(t * 1.5));
    root.rotation.y = Math.sin(t * 0.19) * 0.07;
    root.position.y = this.station.y + Math.sin(t * 0.5) * 0.15;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, PY + 1.5, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(4, 5, 44)), orbit: 0.2, box: boxAt(this.station, -W / 2 - 2, 0, -D / 2 - 2, W / 2 + 2, PY + UP_MAX + 3, D / 2 + 2) };
  };
  return holo;
}
