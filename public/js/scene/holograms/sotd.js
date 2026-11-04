// SOTD (Story of the Day): one multi-market board. A small gauge per market (needle sweeps from yesterday's price to now,
// ghost needle left behind, delta arc), the biggest mover highlighted with a halo while the camera pulls in on it, then back out.
// Input: story.markets = state.sotd.markets [{ storyId, label, yesPrice, change1d, source }]. Missing fields never throw.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, pctText, boxAt } from '../holo.js';
import { arcMesh, lineSeg, rectOutline } from './parts.js';

const D2R = Math.PI / 180;
const MAX = 8;   // 4 x 2 keeps every label readable at full-screen size; the 2D board lists the rest
const CELL_X = 7.6, CELL_Y = 9.4, R = 2.7;

// name -> [line1, line2?]: split long names across two lines instead of shrinking or cutting them
function nameLines(raw) {
  const name = String(raw || '').toUpperCase().trim();
  if (name.length <= 13) return [name, null];
  const words = name.split(/\s+/);
  if (words.length < 2) return [name, null];
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length, b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export function createSotd(ctx, story) {
  const { pal, fx } = ctx;
  const all = (story?.markets || []).filter((m) => m && Number.isFinite(m.yesPrice));
  const mk = all.slice().sort((a, b) => Math.abs(b.change1d || 0) - Math.abs(a.change1d || 0)).slice(0, MAX);
  const n = mk.length;
  const cols0 = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * 2.15))));
  const rows = Math.max(1, Math.ceil(n / cols0));
  const boardW = cols0 * CELL_X, boardH = rows * CELL_Y;
  const Y_BASE = 5.4;                                   // centre of the bottom row
  const midY = Y_BASE + ((rows - 1) * CELL_Y) / 2 + 0.6;
  const holo = new Holo(ctx, { height: Y_BASE + (rows - 1) * CELL_Y + R + 3 });
  const root = holo.root;

  const spanDeg = 240, span = spanDeg * D2R, start = (90 - spanDeg / 2) * D2R;
  const angOf = (v) => start + span * (1 - v);
  const cells = [];
  let big = 0;
  mk.forEach((m, i) => { if (Math.abs(m.change1d || 0) > Math.abs(mk[big].change1d || 0)) big = i; });

  mk.forEach((m, i) => {
    const r = Math.floor(i / cols0), inRow = r === rows - 1 ? n - r * cols0 : cols0;
    const c = i - r * cols0;
    const x = (c - (inRow - 1) / 2) * CELL_X;
    const y = Y_BASE + (rows - 1 - r) * CELL_Y;
    const isBig = i === big;
    const value = clamp01(m.yesPrice), d = Number.isFinite(m.change1d) ? m.change1d : 0, prev = clamp01(value - d);
    const col = d >= 0 ? COL.up : COL.down;
    const g = new THREE.Group(); g.position.set(x, y, 0); g.scale.setScalar(isBig ? 1.15 : 1); root.add(g);
    // track + fills
    const track = new THREE.Mesh(new THREE.RingGeometry(R - 0.2, R, 72, 1, start, span), holo.mat(pal.b, { flat: 1, alpha: isBig ? 0.7 : 0.4, glow: 1.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(track);
    const fill = arcMesh(R - 0.85, R - 0.3, isBig ? pal.a : pal.b, { start, span, lo: 0, hi: 0, glow: 1.3, alpha: 0.85, segments: 72 });
    const delta = arcMesh(R - 1.2, R - 0.92, col, { start, span, lo: 0, hi: 0, glow: 1.9, alpha: 0.95, segments: 72 });
    holo.reg(fill.material); holo.reg(delta.material); g.add(fill, delta);
    const needle = (color, alpha, len, w) => {
      const geo = new THREE.BoxGeometry(w, len, w * 0.6); geo.translate(0, len / 2, 0);
      const mesh = new THREE.Mesh(geo, holo.mat(color, { flat: 1, alpha, glow: 1.8 }));
      const pv = new THREE.Group(); pv.add(mesh); g.add(pv); return pv;
    };
    const nd = needle(COL.white, 1, R - 0.6, 0.17);
    const gh = needle(pal.b, 0.4, R - 0.9, 0.1);
    gh.rotation.z = angOf(prev) - Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), holo.mat(isBig ? pal.a : pal.b, { flat: 1, glow: 1.5 })); g.add(hub);
    // value + move inside the gauge, name beneath
    const pts = Math.round(Math.abs(d) * 100);
    const mv = `${d > 0 ? '▲' : d < 0 ? '▼' : ''}${pts || ''}`.trim();
    const inner = holo.label(pctText(value), { w: 384, h: 256, height: 2.6, font: '900 120px Orbitron', color: '#ffffff', glow: isBig ? pal.hexA : pal.hexB, sub: mv || 'FLAT', subColor: d > 0 ? '#3dff8a' : d < 0 ? '#ff2e55' : '#cfd8ff', subFont: '700 78px Rajdhani', mainY: 0.34, subY: 0.8 });
    inner.sprite.position.set(x, y - 1.55 * g.scale.x, 0.5); inner.yFrac = clamp01((y - Y_BASE) / Math.max(1, boardH));
    const [l1, l2] = nameLines(m.label || m.outcome || m.title);
    const nm = holo.label(l1, { w: 640, h: 224, height: 2.5, font: '900 72px Orbitron', color: isBig ? '#ffffff' : '#dfe8ff', glow: isBig ? pal.hexA : pal.hexB, sub: l2, subColor: isBig ? '#ffffff' : '#dfe8ff', subFont: '900 72px Orbitron', mainY: l2 ? 0.28 : 0.5, subY: 0.74 });
    nm.sprite.position.set(x, y - (R + 1.5) * g.scale.x, 0.4); nm.yFrac = inner.yFrac;
    cells.push({ g, nd, fill, delta, prev, value, delay: 0.7 + i * 0.09, isBig, x, y, hub });
  });

  // highlight: halo around the biggest move
  let halo = null;
  if (cells[big]) {
    const bc = cells[big];
    halo = new THREE.Mesh(new THREE.TorusGeometry(R * 1.28, 0.06, 8, 72), holo.mat(bc.value >= bc.prev ? COL.up : COL.down, { flat: 1, alpha: 0.9, glow: 2, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.set(bc.x, bc.y, -0.2); root.add(halo);
  }
  // floor frame + base line
  const frameMat = holo.line(pal.a, { alpha: 0.5 });
  root.add(lineSeg(rectOutline(boardW + 4, 5, 0.05), frameMat));
  const base = new THREE.Mesh(new THREE.PlaneGeometry(boardW + 4, 0.08), holo.mat(pal.a, { flat: 1, alpha: 0.9, glow: 1.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  base.position.set(0, 0.2, 0.2); root.add(base);

  let pulsed = false;
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    for (const c of cells) {
      const k = ease.inOut(clamp01((ts - c.delay) / 1.4));
      const v = clamp01(c.prev + (c.value - c.prev) * k);
      c.nd.rotation.z = angOf(v) - Math.PI / 2;
      c.fill.material.uniforms.uHi.value = v;
      c.delta.material.uniforms.uLo.value = Math.min(c.prev, v); c.delta.material.uniforms.uHi.value = Math.max(c.prev, v);
      c.hub.scale.setScalar(1 + 0.08 * Math.sin(t * 4 + c.x));
      c.g.rotation.y = Math.sin(t * 0.3 + c.x) * 0.08;
    }
    if (halo) { halo.rotation.z = t * 0.6; halo.rotation.x = Math.sin(t * 0.7) * 0.3; }
    if (!pulsed && this.visible && ts > 2.4 && cells[big]) {
      pulsed = true;
      fx.ring(root.localToWorld(new THREE.Vector3(cells[big].x, 0.15, 0)), pal.a, { radius: 14, dur: 1.4, bright: 1.6 });
    }
    // camera pulls in on the biggest move, holds, then returns to the whole board
    this.camFocus = cells[big] && ts >= 2.4 && ts < 8.0 ? { dx: cells[big].x, dy: cells[big].y - midY, zoom: n > 3 ? 0.58 : 0.8 } : null;
    root.rotation.y = Math.sin(t * 0.13) * 0.03;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, midY, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 1.5, 40)), orbit: 0.06, box: boxAt(this.station, -boardW / 2 - 2, 0, -3, boardW / 2 + 2, Y_BASE + (rows - 1) * CELL_Y + R + 3.2, 3) };
  };
  return holo;
}
