// MOVERS: a labelled leaderboard of the day's biggest moves. Two blocks (RISING / FALLING), up to 5 rows each:
// market name, a bar whose LENGTH is the move in points on a shared, labelled 0..N PTS scale (linear, no sqrt), the change chip
// (up/down arrow + points, counting up) and the price sweeping from yesterday's level to NOW. Rows reveal in rank order; the
// top riser and top faller get a ring and a rate-limited streak. Used for seg 'movers' (built from the ticker markets).
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, boxAt } from '../holo.js';
import { lineSeg } from './parts.js';

const PER_SIDE = 5;
const WC = 19.8, GAP = 2.2;          // column width, gap between the two blocks
const NAME_W = 9.2, BX = 10.4, LB = 3.2; // name zone, bar baseline x within a column, bar length at full scale
const P = 3.4, YB = 3.8;               // row pitch, bottom of the rows area

// split a long name over two lines at the most balanced word break (never truncated); same rule as the story-of-the-day board
function nameLines(raw) {
  const name = String(raw || '').toUpperCase().trim();
  if (name.length <= 12) return [name, null];
  const words = name.split(/\s+/);
  if (words.length < 2) return [name, null];
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length, b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}
const nameOf = (m) => (m.label != null && m.label !== '' ? m.label : m.outcome || m.eventTitle || m.title || 'MARKET');
const ctxOf = (m) => String((m.label != null ? m.context : m.outcome ? m.eventTitle : '') || '').toUpperCase().trim();

// scale: smallest nice ceiling of the biggest move, with <= 4 gridline steps
function niceScale(maxPts) {
  const step = [1, 2, 5, 10, 20, 25].find((s) => maxPts / s <= 4) || 25;
  return { step, max: Math.max(step, Math.ceil(maxPts / step) * step) };
}

export function createMovers(ctx, markets) {
  const { pal, fx } = ctx;
  const all = (markets || []).filter((m) => Number.isFinite(m.change1d) && Math.round(Math.abs(m.change1d) * 100) >= 1);
  const rise = all.filter((m) => m.change1d > 0).sort((a, b) => b.change1d - a.change1d).slice(0, PER_SIDE);
  const fall = all.filter((m) => m.change1d < 0).sort((a, b) => a.change1d - b.change1d).slice(0, PER_SIDE);
  const cols = [rise.length && { up: true, list: rise }, fall.length && { up: false, list: fall }].filter(Boolean);
  const R = Math.max(1, ...cols.map((c) => c.list.length));
  const yT = YB + R * P;
  const W = cols.length ? cols.length * WC + (cols.length - 1) * GAP : 24;
  const Hh = yT + 5.6;
  const sc = niceScale(Math.max(1, ...cols.flatMap((c) => c.list.map((m) => Math.min(100, Math.abs(m.change1d) * 100)))));

  const holo = new Holo(ctx, { height: Hh });
  holo.revealDur = 1.2;
  const root = holo.root;
  const HEXUP = '#3dff8a', HEXDN = '#ff2e55';

  // shared geometry and materials
  const barGeo = new THREE.BoxGeometry(1, 0.95, 0.55); barGeo.translate(0.5, 0, 0);
  const tipGeo = new THREE.BoxGeometry(0.14, 1.2, 0.7);
  const pipGeo = new THREE.OctahedronGeometry(0.3, 0);
  const ringGeo = new THREE.RingGeometry(0.8, 1, 36);
  const addv = { flat: 1, alpha: 0.9, glow: 1.7, depthWrite: false, blending: THREE.AdditiveBlending };
  const mats = {
    up: holo.mat(COL.up, { glow: 1.25 }), down: holo.mat(COL.down, { glow: 1.25 }),
    up0: holo.mat(COL.up, { glow: 1.8 }), down0: holo.mat(COL.down, { glow: 1.8 }),
    tip: holo.mat(COL.white, addv),
    ringUp: holo.mat(COL.up, { ...addv, side: THREE.DoubleSide }), ringDown: holo.mat(COL.down, { ...addv, side: THREE.DoubleSide }),
  };
  const lbl = (text, o, x, y, align) => {
    const l = holo.label(text, { ...o, align: align || 'center' });
    l.sprite.position.set(x, y, 0.5); l.yFrac = clamp01(y / Hh); return l;
  };

  // ---- title ----
  lbl('BIGGEST MOVES TODAY', { w: 1280, h: 160, height: 2.1, font: '900 112px Orbitron', color: '#ffffff', glow: pal.hexA }, 0, yT + 4.3);
  root.add(lineSeg(new Float32Array([-W / 2, yT + 3.0, 0, W / 2, yT + 3.0, 0]), holo.line(pal.a, { alpha: 0.55, glow: 1.5 })));
  if (!cols.length) lbl('NO MARKET MOVED A FULL POINT TODAY', { w: 1536, h: 128, height: 1.6, font: '700 90px Rajdhani', color: '#dfe8ff', glow: pal.hexB }, 0, YB + 3);

  // ---- columns ----
  const grid = [], base = [], rowLines = [], tracks = [];
  const rows = [];
  cols.forEach((col, ci) => {
    const cx = -W / 2 + ci * (WC + GAP), bx = cx + BX, hex = col.up ? HEXUP : HEXDN, colr = col.up ? COL.up : COL.down;
    // block header + underline
    lbl(col.up ? '▲ RISING' : '▼ FALLING', { w: 768, h: 128, height: 1.8, font: '900 100px Orbitron', color: '#ffffff', glow: hex }, cx + 0.4, yT + 1.5, 'left');
    root.add(lineSeg(new Float32Array([cx, yT + 0.45, 0, cx + WC, yT + 0.45, 0]), holo.line(colr, { alpha: 0.7, glow: 1.6 })));
    // axis: zero baseline, gridlines, labels, scale legend
    base.push(bx, YB - 0.35, 0, bx, yT + 0.1, 0);
    for (let v = sc.step; v <= sc.max + 1e-9; v += sc.step) { const gx = bx + (v / sc.max) * LB; grid.push(gx, YB - 0.35, 0, gx, yT, 0); }
    for (const v of [0, sc.max]) lbl(String(v), { w: 256, h: 96, height: 1.3, font: '700 70px Rajdhani', color: '#dfe8ff', glow: pal.hexB }, bx + (v / sc.max) * LB, YB - 1.3);
    lbl(`SCALE 0-${sc.max} PTS`, { w: 640, h: 96, height: 1.3, font: '700 66px Rajdhani', color: '#ffe27a', glow: '#ffd23f' }, cx + 0.4, YB - 1.3, 'left');
    col.list.forEach((m, i) => {
      const y = yT - (i + 0.5) * P;
      const c = m.change1d, ptsRaw = Math.abs(c) * 100, pts = Math.round(ptsRaw);
      const now = Number.isFinite(m.yesPrice) ? clamp01(m.yesPrice) : null;
      const prev = now == null ? null : clamp01(now - c);
      const len = Math.max(0.14, (Math.min(ptsRaw, sc.max) / sc.max) * LB);
      rowLines.push(cx, y - P / 2, 0, cx + WC, y - P / 2, 0);
      tracks.push(bx, y, 0, bx + LB, y, 0);
      // rank pip
      const pip = new THREE.Mesh(pipGeo, i === 0 ? mats.tip : (col.up ? mats.up : mats.down)); pip.position.set(cx + 0.3, y, 0.3); pip.scale.setScalar(i === 0 ? 1.15 : 0.8); root.add(pip);
      // name (two lines max) with the event as a small line when the name is short
      const [l1, l2] = nameLines(nameOf(m)); const cxt = ctxOf(m);
      const sub = l2 || (cxt && cxt !== l1 && cxt.length <= 26 ? cxt : null);
      const nameL = holo.label(l1, { w: 704, h: 192, height: 2.8, font: `700 ${l2 ? 90 : 96}px Rajdhani`, color: i === 0 ? '#ffffff' : '#e6ecff', glow: hex, align: 'left', sub, subColor: l2 ? (i === 0 ? '#ffffff' : '#e6ecff') : '#a9b6ee', subFont: l2 ? `700 90px Rajdhani` : '600 58px Rajdhani', mainY: l2 ? 0.27 : 0.36, subY: l2 ? 0.74 : 0.8 });
      nameL.sprite.position.set(cx + 0.7, y, 0.5); nameL.yFrac = clamp01(y / Hh); nameL.bright = 0;
      // bar + tip
      const bar = new THREE.Mesh(barGeo, i === 0 ? (col.up ? mats.up0 : mats.down0) : (col.up ? mats.up : mats.down)); bar.position.set(bx, y, 0); bar.scale.x = 0.001; root.add(bar);
      const tip = new THREE.Mesh(tipGeo, mats.tip); tip.position.set(bx, y, 0.05); root.add(tip);
      // change chip: arrow + points (counts up), NOW % (sweeps yesterday -> now)
      const chip = holo.label(`${col.up ? '▲' : '▼'} 0 PTS`, { w: 600, h: 200, height: 2.7, font: '900 84px Orbitron', color: col.up ? '#c4ffdc' : '#ffc6d2', glow: hex, align: 'left', sub: now == null ? null : `NOW ${Math.round(prev * 100)}%`, subColor: '#dfe8ff', subFont: '700 82px Rajdhani', mainY: 0.32, subY: 0.79 });
      chip.sprite.position.set(bx + 0.6, y, 0.5); chip.yFrac = clamp01(y / Hh); chip.bright = 0;
      const row = { up: col.up, i, y, bx, len, pts, now, prev, bar, tip, chip, nameL, t0: 0.85 + i * 0.22, ring: null, last: '' };
      if (i === 0) {
        row.ring = new THREE.Mesh(ringGeo, col.up ? mats.ringUp : mats.ringDown); row.ring.position.set(bx, y, 0.4); row.ring.scale.setScalar(0.001); root.add(row.ring);
      }
      rows.push(row);
    });
  });
  // static linework
  if (grid.length) root.add(lineSeg(new Float32Array(grid), holo.line(COL.white, { alpha: 0.11 })));
  if (base.length) root.add(lineSeg(new Float32Array(base), holo.line(COL.white, { alpha: 0.7, glow: 1.4 })));
  if (rowLines.length) root.add(lineSeg(new Float32Array(rowLines), holo.line(pal.b, { alpha: 0.2 })));
  if (tracks.length) root.add(lineSeg(new Float32Array(tracks), holo.line(COL.white, { alpha: 0.12 })));
  root.add(lineSeg(new Float32Array([-W / 2, 1.75, 0, W / 2, 1.75, 0]), holo.line(pal.a, { alpha: 0.4 })));
  lbl('BAR = CHANGE IN CHANCE TODAY, IN POINTS', { w: 2048, h: 96, height: 1.4, font: '700 60px Rajdhani', color: '#dfe8ff', glow: pal.hexB }, 0, 0.8);

  let emitAcc = 0, emitFlip = 0;
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    for (const r of rows) {
      const a = clamp01((ts - r.t0) / 0.95), g = ease.back(a), e = ease.out(a);
      const len = Math.max(0.001, r.len * g);
      r.bar.scale.x = len;
      r.tip.position.x = r.bx + len;
      r.tip.scale.y = a > 0 ? 1 + 0.12 * Math.sin(t * 4 + r.i + (r.up ? 0 : 2)) : 0.001;
      const key = `${Math.round(r.pts * e)}|${r.now == null ? '' : Math.round((r.prev + (r.now - r.prev) * e) * 100)}`;
      if (key !== r.last) {
        r.last = key;
        r.chip.set(`${r.up ? '▲' : '▼'} ${Math.round(r.pts * e)} ${Math.round(r.pts * e) === 1 ? 'PT' : 'PTS'}`, r.now == null ? null : `NOW ${Math.round((r.prev + (r.now - r.prev) * e) * 100)}%`);
      }
      r.chip.sprite.position.x = r.bx + len + 0.6;
      r.chip.bright = clamp01((ts - r.t0) * 5);
      r.nameL.bright = clamp01((ts - r.t0 + 0.15) * 5);
      if (r.ring) {
        const on = a >= 1 ? 1 : 0;
        const k = (t * 0.8 + (r.up ? 0 : 0.5)) % 1;
        r.ring.position.x = r.bx + len;
        r.ring.scale.setScalar(on ? 0.45 + k * 0.7 : 0.001);
        r.ring.material.uniforms.uAlpha.value = on * (1 - k) * 0.9;
      }
    }
    // streak off the tips of the top riser and top faller, alternating, rate-limited
    emitAcc += dt;
    if (this.visible && ts > 2.0 && emitAcc > 0.3) {
      emitAcc = 0; emitFlip ^= 1;
      const lead = rows.filter((r) => r.ring);
      const r = lead[emitFlip % Math.max(1, lead.length)];
      if (r) fx.stream(root.localToWorld(new THREE.Vector3(r.bx + r.len, r.y, 0.4)), r.up ? COL.up : COL.down, 3, new THREE.Vector3(0.6, 1, 0.3), { speed: 2.6, lifeS: 1.1, sz: 0.7, spread: 0.5 });
    }
    root.rotation.y = Math.sin(t * 0.17) * 0.04;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, Hh * 0.48, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(-2, 1.5, 46)), orbit: 0.07, box: boxAt(this.station, -W / 2 - 1.5, 0, -1.5, W / 2 + 1.5, Hh + 0.3, 1.5) };
  };
  return holo;
}
