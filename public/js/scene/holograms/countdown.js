// COUNTDOWN: an orbital clock. A probability core with tilted rings for days / hours / minutes left; the whole
// orbit shrinks as closesAt approaches, and a radar sweep ticks underneath. cluster: satellites for the other markets.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, pctText, boxAt, reveal, TIME } from '../holo.js';
import { arcMesh, floorRing, lineStrip, lineSeg } from './parts.js';

function timeLeft(closesAt, now) {
  const ms = closesAt ? Math.max(0, new Date(closesAt).getTime() - now) : 30 * 86400e3;
  const days = ms / 86400e3;
  return { ms, days, fDay: clamp01(days / 30), fHour: ((ms / 3600e3) % 24) / 24, fMin: ((ms / 60e3) % 60) / 60, fSec: ((ms / 1e3) % 60) / 60 };
}
function leftText(ms) {
  if (ms <= 0) return 'CLOSING NOW';
  const d = Math.floor(ms / 86400e3), h = Math.floor((ms % 86400e3) / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  if (d >= 2) return `${d} DAYS ${h} HRS LEFT`;
  if (d === 1) return `1 DAY ${h} HRS LEFT`;
  if (h >= 1) return `${h} HRS ${m} MIN LEFT`;
  return `${m} MIN LEFT`;
}

export function createCountdown(ctx, story, { cluster = false } = {}) {
  const { pal, rnd } = ctx;
  const lead = story.lead || story.markets?.[0] || { yesPrice: 0.5 };
  const now = Date.now();
  const holo = new Holo(ctx, { height: 20 });
  const root = holo.root;
  const prob = clamp01(lead.yesPrice ?? 0.5);

  // ---- one orbital clock (used for the lead and, smaller, for satellites) ----
  function orbital(market, scale, colorA, colorB, hexA, hexB, big) {
    const g = new THREE.Group();
    const p = clamp01(market.yesPrice ?? 0.5);
    const tl = timeLeft(market.closesAt, now);
    const shrink = 0.68 + 0.32 * tl.fDay; // closer to resolution = tighter orbit
    const coreR = (1.1 + p * 1.3) * scale;
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(coreR, 1), holo.mat(colorA, { flat: 1, alpha: 0.35, glow: 1.3 }));
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(coreR * 1.08, 1)), holo.line(colorB, { alpha: 0.9, glow: 1.8 }));
    g.add(core, wire);
    const rings = [];
    const defs = [[4.8, tl.fMin, 1.4], [6.2, tl.fHour, -0.7], [7.6, tl.fDay, 0.35]];
    const nRings = big ? 3 : 2;
    for (let i = 0; i < nRings; i++) {
      const [r0, frac, spd] = defs[i];
      const r = r0 * shrink * scale;
      const rg = new THREE.Group();
      // minutes ring lies nearly flat, hours ring leans, days ring faces the camera like a clock face
      const sgn = rnd() > 0.5 ? 1 : -1;
      if (i === 0) rg.rotation.set(sgn * (1.25 + rnd() * 0.2), rnd() * 0.6, 0);
      else if (i === 1) rg.rotation.set(sgn * (0.55 + rnd() * 0.25), (rnd() - 0.5) * 0.8, 0);
      else rg.rotation.set((rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.3, 0);
      const track = new THREE.Mesh(new THREE.RingGeometry(r - 0.04 * scale, r + 0.08 * scale, 96), holo.mat(colorB, { flat: 1, alpha: 0.55, glow: 1.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      const start = 0, span = Math.PI * 2;
      const fill = arcMesh(r - 0.26 * scale, r + 0.3 * scale, i === 2 ? colorA : colorB, { start, span, lo: 0, hi: 0, glow: 1.6, alpha: 0.95, segments: 160 });
      holo.reg(fill.material);
      const sat = new THREE.Mesh(new THREE.SphereGeometry(0.36 * scale, 10, 8), holo.mat(COL.white, { flat: 1, glow: 1.6 }));
      rg.add(track, fill, sat);
      // clock ticks on the day ring, finer ticks on the hour ring
      if (big) {
        const nT = i === 2 ? 30 : i === 1 ? 24 : 12, arr = [];
        for (let k = 0; k < nT; k++) { const a = (k / nT) * Math.PI * 2, l = (k % (nT / 6) === 0) ? 0.5 : 0.22; arr.push(Math.cos(a) * (r + 0.35), Math.sin(a) * (r + 0.35), 0, Math.cos(a) * (r + 0.35 + l), Math.sin(a) * (r + 0.35 + l), 0); }
        rg.add(lineSeg(new Float32Array(arr), holo.line(colorB, { alpha: 0.8, glow: 1.8 })));
      }
      g.add(rg);
      rings.push({ g: rg, fill, sat, r, frac, spd: spd * (rnd() > 0.5 ? 1 : -1), start, span, phase: rnd() * 6.28 });
    }
    const outerR = defs[nRings - 1][0] * shrink * scale;
    const lbl = holo.label(pctText(p), { w: 768, h: 256, height: big ? 2.8 : 1.3, font: '900 170px Orbitron', color: '#ffffff', glow: hexA, sub: big ? leftText(tl.ms) : (market.outcome || '').toUpperCase(), subColor: hexB, subFont: '700 84px Rajdhani' });
    const lblOff = -(outerR + (big ? 1.9 : 1.0)); // labels live in root space, so callers place them under their orbital
    return { g, core, wire, rings, lbl, lblOff, tl, p, coreR, shrink, scale, outerR };
  }

  const main = orbital(lead, 1, pal.a, pal.b, pal.hexA, pal.hexB, true);
  const CY = main.outerR + 4.4;
  holo.r1 = holo.station.y + CY + main.outerR + 1.5;
  main.g.position.y = CY; root.add(main.g);
  main.lbl.sprite.position.set(0, CY + main.lblOff, 0.5); main.lbl.yFrac = 0.3;
  // dashed-ish "to resolution" ring on the floor whose radius is the orbit size
  const floorMat = holo.mat(pal.b, { flat: 1, alpha: 0.6, glow: 1.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  root.add(floorRing(main.outerR, main.outerR + 0.15, floorMat));
  // radar sweep on the floor
  const sweepR = main.outerR + 1.6;
  const sweep = new THREE.Mesh(new THREE.CircleGeometry(sweepR, 96), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...reveal.uniforms(), uColor: { value: pal.a.clone() }, uSpeed: { value: 0.6 } },
    vertexShader: `varying vec2 vL; varying vec3 vW; void main(){ vL = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uSpeed; varying vec2 vL;
      ${reveal.glsl}
      void main(){ float rv; float scan = revealScan(rv);
        float ang = atan(vL.y, vL.x); float r = length(vL) / ${sweepR.toFixed(1)};
        float trail = pow(max(fract((ang) / 6.2831853 - uTime * uSpeed), 1e-4), 5.0);
        float ringz = 0.5 + 0.5 * sin(r * 50.0);
        float a = trail * smoothstep(1.0, 0.2, r) * (0.25 + 0.15 * ringz) + exp(-abs(r - 0.98) * 60.0) * 0.4;
        gl_FragColor = vec4(uColor * a * uFade, 1.0); }`,
  }));
  holo.reg(sweep.material);
  sweep.rotation.x = -Math.PI / 2; sweep.position.y = 0.08; root.add(sweep);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, CY - main.coreR, 6), holo.mat(pal.b, { flat: 1, alpha: 0.45, glow: 1.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  stem.position.y = (CY - main.coreR) / 2; root.add(stem);

  // ---- satellites (week cluster): the other markets in this story ----
  const sats = [];
  if (cluster) {
    const others = (story.markets || []).filter((m) => m !== lead && m.id !== lead.id).slice(0, 4);
    others.forEach((m, i) => {
      const o = orbital(m, 0.42, pal.pick(i + 2), pal.b, pal.hex(i + 2), pal.hexB, false);
      const ang = (i / Math.max(1, others.length)) * Math.PI * 2 + 0.6;
      o.g.position.set(Math.cos(ang) * 11.5, CY + Math.sin(ang * 1.7) * 2.0, Math.sin(ang) * 4.0);
      o.ang = ang; o.lbl.yFrac = 0.5;
      root.add(o.g);
      const tether = lineStrip([new THREE.Vector3(0, CY, 0), o.g.position.clone()], holo.line(pal.b, { alpha: 0.25 }));
      root.add(tether); o.tether = tether;
      sats.push(o);
    });
  }

  function tickOrbital(o, dt, t, ts, delay) {
    const grow = ease.back(clamp01((ts - 0.4 - delay) / 1.2));
    o.core.scale.setScalar(Math.max(0.01, grow) * (1 + 0.04 * Math.sin(t * 3)));
    o.wire.scale.setScalar(Math.max(0.01, grow)); o.wire.rotation.y = t * 0.3; o.wire.rotation.x = t * 0.12;
    o.rings.forEach((r, i) => {
      const k = ease.out(clamp01((ts - 0.8 - delay - i * 0.25) / 1.4));
      r.g.scale.setScalar(Math.max(0.01, k));
      r.g.rotation.z += r.spd * dt * 0.5;
      const head = r.frac * k;
      r.fill.material.uniforms.uHi.value = head;
      const a = r.start + r.span * (1 - head);
      r.sat.position.set(Math.cos(a) * r.r, Math.sin(a) * r.r, 0);
      r.sat.scale.setScalar(0.8 + 0.3 * Math.sin(t * 6 + r.phase));
    });
  }

  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    tickOrbital(main, dt, t, ts, 0);
    // the orbit tightens a hair every second: a visible tick toward resolution
    const beat = Math.pow(1 - (t % 1), 6) * 0.03;
    main.g.scale.setScalar(1 - beat);
    sats.forEach((o, i) => {
      tickOrbital(o, dt, t, ts, 0.5 + i * 0.2);
      const ang = o.ang + t * 0.08;
      o.g.position.set(Math.cos(ang) * 11.5, CY + Math.sin(ang * 1.7) * 2.0, Math.sin(ang) * 4.0);
      const pa = o.tether.geometry.attributes.position; pa.setXYZ(1, o.g.position.x, o.g.position.y, o.g.position.z); pa.needsUpdate = true;
      o.lbl.sprite.position.set(o.g.position.x, o.g.position.y + o.lblOff, o.g.position.z + 0.5);
    });
    root.rotation.y = Math.sin(t * 0.14) * 0.08;
  };
  holo.pose = function () {
    const w = cluster ? 13.5 : main.outerR + 1.6;
    const tgt = this.station.clone().add(new THREE.Vector3(0, CY - 1.2, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 2.5, 42)), orbit: 0.14, box: boxAt(this.station, -w, 0, -(cluster ? 6 : 3), w, CY + main.outerR + 1.4, cluster ? 6 : 3) };
  };
  return holo;
}
