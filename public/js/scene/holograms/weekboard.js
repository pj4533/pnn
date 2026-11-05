// WEEK BOARD ("RESOLVING SOON"): a labelled close-time calendar strip for the week segment. A time axis from NOW to the furthest close
// (day ticks in ET), and one lollipop per market planted at the moment it closes: stem height = chance of YES on a 0/50/100% axis, a ball on
// top, a label stack (NAME, big %, change chip), and the exact close time under the axis. A NOW marker sweeps along the axis soonest-first;
// each lollipop pops as it arrives and its ball sweeps from yesterday's level (ghost ring, WAS x%) to today's, with the % counting along.
// The soonest close gets a pulse ring and a NEXT TO CLOSE tag. Labels never move once settled; the root only sways +/-0.05 rad.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, boxAt } from '../holo.js';
import { lineSeg } from './parts.js';
import { OUTCOME_COLORS, money, ago, exchangeName } from '../../util.js';

const Y0 = 7.6, H = 8.5;                                    // axis baseline, height of the 0-100% scale
const MIN_GAP = 9.2;                                        // minimum spacing between lollipops (name labels are ~7.5 wide)
const UP = '#3dff8a', DOWN = '#ff2e55', FLAT = '#cfd8ff', GOLD = '#ffd23f', SOFT = '#cfd8ff';
const HOUR = 3600e3, DAY = 86400e3;

const STEM = new THREE.BoxGeometry(1, 1, 1); STEM.translate(0, 0.5, 0);   // base-anchored, scale.y = height
const BAR = new THREE.BoxGeometry(1, 1, 1); BAR.translate(0.5, 0, 0);     // left-anchored, scale.x = length

// ---- time helpers (US Eastern, like the rest of the broadcast) ----
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
function et(ms) { const p = Object.fromEntries(ET.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { wd: p.weekday.toUpperCase(), mo: p.month.toUpperCase(), d: p.day, h: Number(p.hour) % 24, mi: Number(p.minute), key: `${p.month} ${p.day}` }; }
const h12 = (h) => `${h % 12 || 12}${h < 12 ? 'AM' : 'PM'}`;
const hm = (e) => (e.mi ? `${e.h % 12 || 12}:${String(e.mi).padStart(2, '0')}${e.h < 12 ? 'AM' : 'PM'}` : h12(e.h));
function closeLabel(ms, nowMs) {
  const e = et(ms), same = e.key === et(nowMs).key;
  return `${same ? 'TODAY' : e.wd} ${hm(e)}`;
}
function leftText(ms) {
  if (ms <= 0) return 'CLOSING NOW';
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / 60e3);
  if (d >= 1) return `CLOSES IN ${d}D ${h}H`;
  if (h >= 1) return `CLOSES IN ${h}H ${m}M`;
  return `CLOSES IN ${Math.max(1, m)} MIN`;
}
function wrapName(s, max = 13) {
  const w = s.split(/\s+/).filter(Boolean);
  if (w.join(' ').length <= max || w.length < 2) return [s];
  let best = 1, bd = 1e9;                       // split where the two lines are most even
  for (let i = 1; i < w.length; i++) { const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length); if (d < bd) { bd = d; best = i; } }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}
const cleanName = (s) => String(s || '').replace(/^will (the )?/i, '').replace(/\?+$/, '').trim().toUpperCase();

export function createWeekBoard(ctx, story) {
  const { pal } = ctx;
  const now = Date.now();

  // ---- which markets: the lead, then the story's other markets (related first when present), up to 5 ----
  const lead = story.lead || story.markets?.[0] || { yesPrice: 0.5 };
  const pool = [lead, ...(Array.isArray(story.related) ? story.related : []), ...(story.markets || [])];
  const seen = new Set(), uniq = [];
  for (const m of pool) { if (!m || !Number.isFinite(m.yesPrice) && m !== lead) continue; const k = m.id ?? m; if (seen.has(k)) continue; seen.add(k); uniq.push(m); }
  const chosen = [uniq[0], ...uniq.slice(1).sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)).slice(0, 4)];
  const many = chosen.length > 1;
  const fallbackClose = lead.closesAt ? Date.parse(lead.closesAt) : now + 7 * DAY;
  const items = chosen.map((m, i) => {
    const closeMs = m.closesAt ? Date.parse(m.closesAt) : fallbackClose;
    const p = clamp01(m.yesPrice ?? 0.5), d = Number.isFinite(m.change1d) ? m.change1d : 0;
    const pts = Math.round(Math.abs(d) * 100);
    const hex = many ? OUTCOME_COLORS[i % OUTCOME_COLORS.length] : pal.hexA;
    const name = cleanName(many ? (m.outcome || m.title) : (story.eventTitle || m.title || m.outcome));
    return { m, p, d, pts, was: pts >= 1 ? clamp01(p - d) : p, closeMs: Number.isFinite(closeMs) ? closeMs : fallbackClose, hex, col: new THREE.Color(hex), name };
  }).sort((a, b) => a.closeMs - b.closeMs);

  // frame width follows the number of lollipops (fewer markets = a tighter board = bigger text on screen)
  const L = items.length <= 2 ? 32 : items.length === 3 ? 38 : 44, X0 = -L / 2 + 4.5, X1 = L / 2 - 3.5, TRAVEL = X1 - X0, W = L + 10;
  const holo = new Holo(ctx, { axis: 'x', width: W, height: 24 });
  holo.revealDur = 1.6;
  const root = holo.root;
  const xFrac = (x) => clamp01((x + W / 2) / W);

  // ---- time scale: NOW .. a little past the furthest close ----
  const maxMs = Math.max(...items.map((it) => it.closeMs - now), 0);
  const horizon = Math.min(30 * DAY, Math.max(6 * HOUR, maxMs * 1.12));
  const xOfT = (ms) => X0 + TRAVEL * clamp01((ms - now) / horizon);
  items.forEach((it) => { it.xTrue = xOfT(it.closeMs); it.x = it.xTrue; });
  for (let i = 1; i < items.length; i++) items[i].x = Math.max(items[i].x, items[i - 1].x + MIN_GAP);   // keep labels apart ...
  for (let i = items.length - 2; i >= 0; i--) items[i].x = Math.min(items[i].x, items[i + 1].x - MIN_GAP);
  if (items[items.length - 1].x > X1) { const s = items[items.length - 1].x - X1; items.forEach((it) => { it.x -= s; }); }
  if (items[0].x < X0 + 1.5) { const s = X0 + 1.5 - items[0].x; items.forEach((it) => { it.x += s; }); }

  const yOf = (p) => Y0 + p * H;
  const flat = (c, o = {}) => holo.mat(c, { flat: 1, ...o });
  const lab = (text, o, x, y, z = 0.9) => { const l = holo.label(text, o); l.sprite.position.set(x, y, z); l.yFrac = xFrac(x); return l; };

  // ---- frame: backing panel, floor outline, 0/50/100% grid ----
  {
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(L + 2.4, 27.6), holo.mat(new THREE.Color(0.02, 0.0, 0.09), { flat: 1, alpha: 0.5, depthWrite: false }));
    bg.position.set(0, 13.6, -1.0); root.add(bg);
    const a = -L / 2 - 1.2, b = L / 2 + 1.2, y0 = -0.2, y1 = 27.4, k = 1.6;
    root.add(lineSeg(new Float32Array([a, y0, -0.9, a + k, y0, -0.9, a, y0, -0.9, a, y0 + k, -0.9, b, y0, -0.9, b - k, y0, -0.9, b, y0, -0.9, b, y0 + k, -0.9,
      a, y1, -0.9, a + k, y1, -0.9, a, y1, -0.9, a, y1 - k, -0.9, b, y1, -0.9, b - k, y1, -0.9, b, y1, -0.9, b, y1 - k, -0.9]), holo.line(pal.b, { alpha: 0.8, glow: 1.6 })));
    const g = [];
    for (const f of [0.5, 1]) g.push(-L / 2 + 2.6, yOf(f), -0.3, L / 2 - 0.4, yOf(f), -0.3);
    root.add(lineSeg(new Float32Array(g), holo.line(COL.white, { alpha: 0.2 })));
    for (const [f, t] of [[0, '0%'], [0.5, '50%'], [1, '100%']]) {
      const l = holo.label(t, { w: 256, h: 96, height: 1.2, font: '700 72px Rajdhani', color: SOFT, glow: pal.hexB, align: 'right' });
      l.sprite.position.set(-L / 2 + 2.2, yOf(f) + (f === 0 ? 0.45 : 0), 0.3); l.yFrac = 0.05; l.bright = 0.9;
    }
    const yl = holo.label('CHANCE', { w: 288, h: 160, height: 1.7, font: '700 66px Rajdhani', color: '#9ff6ff', glow: pal.hexB, sub: 'OF YES', subColor: '#9ff6ff', subFont: '700 66px Rajdhani', align: 'right', mainY: 0.3, subY: 0.74 });
    yl.sprite.position.set(-L / 2 + 2.2, yOf(0.75), 0.3); yl.yFrac = 0.05; yl.bright = 0.9;   // between 100% and 50%, clear of the first lollipop's label stack
  }

  // ---- time axis with ET day ticks (or hour ticks when the whole strip is under ~1.5 days) ----
  const axis = new THREE.Mesh(BAR, flat(COL.white, { alpha: 0.7, glow: 1.2 }));
  axis.position.set(X0 - 0.6, Y0, 0); axis.scale.set(TRAVEL + 1.2, 0.1, 0.2); root.add(axis);
  {
    const vt = [], tk = [];
    const t0 = Math.ceil(now / HOUR) * HOUR, tEnd = now + horizon;
    const addTick = (ms) => { const x = xOfT(ms); tk.push(x, Y0 - 0.35, 0.1, x, Y0, 0.1); return x; };
    if (horizon >= 1.5 * DAY) {
      const bounds = [now];
      for (let ms = t0; ms < tEnd; ms += HOUR) if (et(ms).h === 0) bounds.push(ms);
      bounds.push(tEnd);
      const perDay = TRAVEL / (horizon / DAY), step = Math.max(1, Math.ceil(4.2 / perDay));
      for (let k = 0; k < bounds.length - 1; k++) {
        const s = bounds[k], e = bounds[k + 1];
        if (k > 0) { const x = addTick(s); vt.push(x, Y0, -0.3, x, Y0 + H, -0.3); }
        if (k % step) continue;
        const mid = (xOfT(s) + xOfT(e)) / 2, ed = et(k === 0 ? now : s + HOUR);
        if (k === 0 && (mid - X0 < 3.6 || e - s < 0.28 * DAY)) continue;   // a sliver of "today": the NOW label covers it
        const text = k === 0 ? 'TODAY' : `${ed.wd} ${ed.d}`;
        lab(text, { w: 320, h: 96, height: 1.3, font: '700 76px Rajdhani', color: SOFT, glow: pal.hexB }, step > 1 ? xOfT(s) : mid, Y0 - 1.1, 0.3).bright = 0.95;
      }
    } else {
      const stepH = [1, 2, 3, 6, 12].find((s) => TRAVEL / (horizon / HOUR) * s >= 4.2) || 12;
      for (let ms = t0; ms < tEnd; ms += HOUR) {
        const e = et(ms); if (e.h % stepH) continue;
        const x = addTick(ms); vt.push(x, Y0, -0.3, x, Y0 + H, -0.3);
        if (x > X0 + 2.4) lab(h12(e.h), { w: 256, h: 96, height: 1.4, font: '700 76px Rajdhani', color: SOFT, glow: pal.hexB }, x, Y0 - 1.1, 0.3).bright = 0.95;
      }
    }
    root.add(lineSeg(new Float32Array(tk), holo.line(COL.white, { alpha: 0.55 })));
    if (vt.length) root.add(lineSeg(new Float32Array(vt), holo.line(pal.b, { alpha: 0.13 })));
    root.add(lineSeg(new Float32Array([X0, Y0 - 0.5, 0.1, X0, Y0 + H, 0.1]), holo.line(COL.gold, { alpha: 0.5, glow: 1.6 })));
    lab('NOW', { w: 256, h: 96, height: 1.3, font: '900 80px Orbitron', color: '#ffe27a', glow: GOLD }, X0, Y0 - 1.1, 0.4).bright = 1;
  }

  // ---- lollipops ----
  const T0 = 1.35, soon = items[0];
  items.forEach((it, i) => {
    const g = new THREE.Group(); g.position.set(it.x, Y0, 0); root.add(g); it.g = g;
    it.stem = new THREE.Mesh(STEM, flat(it.col, { alpha: 0.5, glow: 1.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    it.chg = new THREE.Mesh(STEM, flat(new THREE.Color(it.d >= 0 ? UP : DOWN), { alpha: 0.95, glow: 1.6 }));
    it.ball = new THREE.Mesh(new THREE.SphereGeometry(0.58, 18, 12), flat(it.col, { glow: 1.7 }));
    it.core = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), flat(COL.white, { glow: 1.8 }));
    it.ghost = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32), flat(COL.white, { alpha: 0.85, glow: 1.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    it.stem.scale.set(0.16, 0.001, 0.16); it.chg.scale.set(0.34, 0.001, 0.34);
    g.add(it.stem, it.chg, it.ball, it.core, it.ghost);
    it.ball.scale.setScalar(0.001); it.core.scale.setScalar(0.001); it.ghost.scale.setScalar(0.001);
    if (it === soon) {
      it.pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), flat(COL.gold, { alpha: 0.9, glow: 1.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      it.pulse.scale.setScalar(0.001); g.add(it.pulse);
    }
    // where it really closes (the stem can be nudged sideways so labels never collide)
    if (Math.abs(it.x - it.xTrue) > 0.3) root.add(lineSeg(new Float32Array([it.xTrue, Y0 + 0.14, 0.2, it.x, Y0 + 0.14, 0.2]), holo.line(it.col, { alpha: 0.7, glow: 1.4 })));
    const tk = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), flat(it.col, { glow: 1.6 })); tk.position.set(it.xTrue, Y0, 0.2); root.add(tk); it.tk = tk; tk.scale.setScalar(0.001);

    const lines = wrapName(it.name);
    it.nameH = lines.length > 1 ? 2.6 : 1.55;
    it.nl = holo.label(lines[0], lines.length > 1
      ? { w: 640, h: 192, height: 2.6, font: '700 66px Orbitron', color: '#ffffff', glow: it.hex, sub: lines[1], subColor: '#ffffff', subFont: '700 66px Orbitron', mainY: 0.29, subY: 0.71 }
      : { w: 640, h: 112, height: 1.55, font: '700 70px Orbitron', color: '#ffffff', glow: it.hex });
    it.nl.yFrac = xFrac(it.x);
    it.chip = it.pts === 0 ? (Number.isFinite(it.m.change1d) ? 'FLAT TODAY' : '') : `${it.d > 0 ? '▲' : '▼'} ${it.pts} ${it.pts === 1 ? 'PT' : 'PTS'} TODAY`;
    it.chipCol = it.pts === 0 ? FLAT : it.d > 0 ? UP : DOWN;
    it.pl = holo.label('0%', { w: 704, h: 256, height: 2.6, font: '900 170px Orbitron', color: '#ffffff', glow: it.hex, sub: '', subColor: it.chipCol, subFont: '800 92px Rajdhani' });
    it.pl.yFrac = xFrac(it.x); it.lastTxt = '0%'; it.lastSub = '';
    it.wl = it.pts >= 2 ? holo.label(`WAS ${Math.round(it.was * 100)}%`, { w: 384, h: 96, height: 1.2, font: '700 70px Rajdhani', color: '#ffe27a', glow: GOLD, align: 'left' }) : null;
    if (it.wl) { it.wl.yFrac = xFrac(it.x); it.wl.sprite.position.set(it.x + 0.95, yOf(it.was), 0.9); }
    it.cl = holo.label(closeLabel(it.closeMs, now), { w: 576, h: 192, height: 2.25, font: '900 86px Orbitron', color: it === soon ? '#ffe27a' : '#ffffff', glow: it === soon ? GOLD : it.hex, sub: leftText(it.closeMs - now), subColor: it === soon ? '#ffe27a' : SOFT, subFont: '700 74px Rajdhani', mainY: 0.34, subY: 0.76 });
    it.cl.sprite.position.set(it.x, Y0 - 3.6, 0.9); it.cl.yFrac = xFrac(it.x);
    it.nl.bright = it.pl.bright = it.cl.bright = 0; if (it.wl) it.wl.bright = 0;
    if (it === soon) {
      it.tag = holo.label('NEXT TO CLOSE', { w: 512, h: 112, height: 1.35, font: '900 62px Orbitron', color: '#ffe27a', glow: GOLD });
      it.tag.yFrac = xFrac(it.x); it.tag.bright = 0;
    }
    // timeline: pop-in at the moment the NOW marker arrives
    const prevX = i ? items[i - 1].x : X0, prevT = i ? items[i - 1].tA : 0.55;
    it.tA = i ? prevT + Math.min(1.0, Math.max(0.6, 0.45 + Math.abs(it.x - prevX) * 0.035)) : T0;
    it.tFrom = prevT; it.xFrom = prevX;
  });

  // ---- NOW marker + burning fuse to the soonest close ----
  const sweepH = H + 1.4;
  const sweepGeo = new THREE.BoxGeometry(0.12, sweepH, 0.12); sweepGeo.translate(0, sweepH / 2, 0);
  const sweepLine = new THREE.Mesh(sweepGeo, flat(COL.white, { alpha: 0.85, glow: 1.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  sweepLine.position.set(X0, Y0 - 0.5, 0.3); root.add(sweepLine);
  const sweepDot = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), flat(COL.white, { glow: 1.8 }));
  sweepDot.position.set(X0, Y0, 0.4); root.add(sweepDot);
  const fuse = new THREE.Mesh(BAR, flat(COL.gold, { alpha: 0.95, glow: 1.6 }));
  fuse.position.set(X0, Y0, 0.15); fuse.scale.set(0.001, 0.26, 0.3); root.add(fuse);

  // ---- title + footer (source, age, volume, THIN) ----
  lab('RESOLVING SOON', { w: 1536, h: 192, height: 2.3, font: '900 100px Orbitron', color: '#ffffff', glow: pal.hexA, align: 'left', sub: 'MARKETS PLACED BY CLOSE TIME', subColor: '#9ff6ff', subFont: '700 78px Rajdhani', mainY: 0.36, subY: 0.8 }, -L / 2 - 0.3, 1.45, 0.9);
  {
    const srcs = (story.sources && story.sources.length ? story.sources : [lead.source]).filter(Boolean);
    const vol = (story.sourceVolumes || []).length ? story.sourceVolumes.reduce((s, x) => s + (x.volume24h || 0), 0) : items.reduce((s, it) => s + (it.m.volume24h || 0), 0);
    lab([srcs.map(exchangeName).join(' + '), lead.updatedAt ? `updated ${ago(lead.updatedAt, now)}` : null].filter(Boolean).join(' · ').toUpperCase(), { w: 1024, h: 192, height: 2.3, font: '700 80px Rajdhani', color: SOFT, glow: pal.hexB, align: 'right', sub: `${money(vol)} traded in 24 hrs`.toUpperCase(), subColor: SOFT, subFont: '700 80px Rajdhani', mainY: 0.32, subY: 0.72 }, L / 2 + 0.3, 1.45, 0.9);
    if (story.thin) lab('THIN MARKET', { w: 512, h: 128, height: 1.5, font: '900 72px Orbitron', color: '#ffab2e', glow: '#ffab2e'}, 1.0, 1.3, 0.9);
  }

  // ---- floor outline + radar ring ----
  root.add(lineSeg(new Float32Array([-L / 2 - 1, 0.05, -3, L / 2 + 1, 0.05, -3, L / 2 + 1, 0.05, -3, L / 2 + 1, 0.05, 2, L / 2 + 1, 0.05, 2, -L / 2 - 1, 0.05, 2, -L / 2 - 1, 0.05, 2, -L / 2 - 1, 0.05, -3]), holo.line(pal.a, { alpha: 0.5 })));

  // ---- animation ----
  const tLast = items[items.length - 1].tA;
  const path = [[0.55, X0], ...items.map((it) => [it.tA, it.x])];
  holo.tick = function (dt, t) {
    const ts = this.tShow;
    // NOW marker: waits, then glides to each close in turn (soonest first), then fades
    let mx = X0;
    if (ts >= path[0][0]) {
      mx = path[path.length - 1][1];
      for (let k = 0; k < path.length - 1; k++) if (ts < path[k + 1][0]) { mx = path[k][1] + (path[k + 1][1] - path[k][1]) * ease.out(clamp01((ts - path[k][0]) / (path[k + 1][0] - path[k][0]))); break; }
    }
    const sOn = clamp01((ts - 0.3) * 4) * (1 - clamp01((ts - tLast - 1.3) / 0.6));
    sweepLine.position.x = mx; sweepDot.position.x = mx;
    sweepLine.material.uniforms.uAlpha.value = 0.85 * sOn; sweepDot.scale.setScalar(Math.max(0.001, sOn));
    fuse.scale.x = Math.max(0.001, Math.min(mx, soon.x) - X0);

    for (const it of items) {
      const a = ts - it.tA;
      const k1 = ease.out(clamp01(a / 0.4)), bounce = a < 0 ? 0 : ease.back(clamp01(a / 0.5));
      const k2 = ease.inOut(clamp01((a - 0.45) / 0.75));
      const vF = a < 0 ? 0 : a < 0.45 ? it.was * k1 : it.was + (it.p - it.was) * k2;
      const lo = Math.min(it.was, vF), hi = Math.max(it.was, vF);
      it.stem.scale.y = Math.max(0.001, lo * H); it.chg.position.y = lo * H; it.chg.scale.y = Math.max(0.001, (hi - lo) * H);
      it.chg.visible = it.pts >= 1 && a > 0.45;
      it.ball.position.y = it.core.position.y = vF * H;
      it.ball.scale.setScalar(Math.max(0.001, bounce)); it.core.scale.setScalar(Math.max(0.001, bounce));
      it.tk.scale.setScalar(Math.max(0.001, a > -0.1 ? ease.back(clamp01((a + 0.1) / 0.4)) : 0));
      it.ghost.position.y = it.was * H; it.ghost.scale.setScalar(it.pts >= 1 ? Math.max(0.001, ease.out(clamp01((a - 0.3) / 0.3))) : 0.001);
      if (it.pulse) {
        const on = a > 0.9 ? 1 : 0, ph = (t % 1.6) / 1.6;
        it.pulse.position.y = vF * H; it.pulse.scale.setScalar(Math.max(0.001, on * (0.7 + ph * 1.5)));
        it.pulseFade = (1 - ph) * on;
      }
      // labels ride above the lollipop head (whichever of yesterday / today is higher)
      const top = Y0 + hi * H + 0.7;
      it.pl.sprite.position.set(it.x, top + 2.2, 0.9);
      it.nl.sprite.position.set(it.x, top + 3.8 + it.nameH / 2, 0.9);
      if (it.tag) it.tag.sprite.position.set(it.x, top + 3.8 + it.nameH + 0.8, 0.9);
      const txt = `${Math.round(vF * 100)}%`, sub = a > 0.45 ? it.chip : '';
      if (txt !== it.lastTxt || sub !== it.lastSub) { it.lastTxt = txt; it.lastSub = sub; it.pl.set(txt, sub, '#ffffff', it.hex); }
      it.pl.bright = clamp01(a / 0.25); it.nl.bright = clamp01((a - 0.05) / 0.25);
      if (it.tag) it.tag.bright = clamp01((a - 0.6) / 0.3);
      if (it.wl) it.wl.bright = clamp01((a - 0.5) / 0.3);
      it.cl.bright = clamp01((a + 0.1) / 0.3);
    }
    this.baseTick(dt);
    if (soon.pulse) soon.pulse.material.uniforms.uFade.value = (soon.pulseFade || 0) * this.fade;
    root.rotation.y = Math.sin(t * 0.14) * 0.05;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, 13.5, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(-2, 1.5, 46)), orbit: 0.06, box: boxAt(this.station, -L / 2 - 1.6, -0.2, -3, L / 2 + 1.6, 27.6, 2.5) };
  };
  return holo;
}
