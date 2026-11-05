// OUTCOMES: a labelled bar race. One bar per outcome (<=3 outcomes stand up as columns, 4-5 lie down as a leaderboard), sorted by chance,
// coloured like the 2D outcome bars. A real value axis (0 to a nice ceiling, no baseline offset) with gridlines, the name, the % and a
// green/red change chip on every bar, and a white tick at yesterday's level. The build-in plays the story: bars grow to yesterday's
// value, hold, then climb or fall to today's while the % counts and the chips pop in. No hemicycle of "seats" (user feedback 2026-11-04).
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, pctText, pctSeq, boxAt } from '../holo.js';
import { lineSeg } from './parts.js';
import { OUTCOME_COLORS } from '../../util.js';

const NICE = [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1];
const STEP = { 0.1: 0.02, 0.2: 0.05, 0.25: 0.05, 0.3: 0.1, 0.4: 0.1, 0.5: 0.1, 0.6: 0.2, 0.75: 0.25, 1: 0.25 };
const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const GREEN = '#3dff8a', RED = '#ff2e55', GOLD = '#ffd23f';
function splitName(s) {
  if (s.length <= 13 || !s.includes(' ')) return [s, null];
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - s.length / 2) < Math.abs(best - s.length / 2))) best = i;
  return [s.slice(0, best), s.slice(best + 1)];
}

export function createOutcomes(ctx, story, opts = {}) {
  const { pal, rnd, fx } = ctx;
  const markets = (story.markets || []).slice(0, 5);
  const n = markets.length;
  const horiz = n >= 4;   // leaderboard for 4-5 outcomes, podium of columns for 2-3
  const HT = horiz ? 19 : 17;
  const holo = new Holo(ctx, { height: HT });
  const root = holo.root;

  // ---- data: current value, yesterday's value, change ----
  const sw = story.swing && Number.isFinite(story.swing.from) && Number.isFinite(story.swing.to) ? story.swing : null;
  const leadIdx = Math.max(0, markets.findIndex((m) => story.lead && m.id === story.lead.id));
  const rawSum = markets.reduce((a, m) => a + clamp01(m.yesPrice ?? 0), 0);
  let items = markets.map((m, i) => {
    const p = clamp01(m.yesPrice ?? 0);
    const ch = Number.isFinite(m.change1d) ? m.change1d : NaN;
    let prev = p, known = false;
    if (sw && i === leadIdx) { prev = clamp01(sw.from); known = true; }
    else if (Number.isFinite(ch) && ch <= p + 0.005 && p - ch <= 1.005) { prev = clamp01(p - ch); known = true; }
    return { m, i, p, prev, known, name: String(m.label || m.outcome || m.title || '').toUpperCase(), hex: OUTCOME_COLORS[i % OUTCOME_COLORS.length] };
  });
  // two-way swing story whose other side carries nonsense change data: it mirrors the lead
  if (sw && n === 2 && Math.abs(rawSum - 1) < 0.1) { const o = items[1 - leadIdx]; if (!o.known) { o.prev = clamp01(1 - sw.from); o.known = true; } }
  items.forEach((it) => { it.d = it.p - it.prev; it.moved = Math.abs(Math.round(it.d * 100)) >= 1; it.color = new THREE.Color(it.hex); });
  items.sort((a, b) => b.p - a.p);
  items.forEach((it, r) => { it.rank = r; });
  const anyMove = items.some((it) => it.moved);
  // feature bar: the swing lead, else the biggest absolute move (3+ points)
  let feat = null;
  if (sw) feat = items.find((it) => it.i === leadIdx) || null;
  else { const mv = items.filter((it) => Math.abs(it.d) >= 0.03).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0]; feat = mv || null; }

  // ---- axis: 0 to a nice ceiling so heights are truthful ----
  const top = Math.max(...items.map((it) => Math.max(it.p, it.prev)), 0.02);
  const AX = NICE.find((v) => v >= top * (horiz ? 1.15 : 1.08)) || 1;
  const step = STEP[AX] || 0.25;
  const ticks = []; for (let v = 0; v <= AX + 1e-9; v += step) ticks.push(v);

  // ---- layout ----
  const LEN = horiz ? 22 : 9, T = horiz ? 1.5 : 3.4, PITCH = horiz ? 3.0 : (n === 2 ? 11 : 9.5);
  const X0 = -9;                                   // horizontal: where bars start
  const ROW0 = 2.2;                                // horizontal: centre of the bottom row
  const axisX = horiz ? X0 : -(n * PITCH) / 2 - 1.5;   // vertical: left axis
  const plotW = n * PITCH + 3;
  const cross = (it) => (horiz ? ROW0 + (n - 1 - it.rank) * PITCH : (it.rank - (n - 1) / 2) * PITCH);   // centre across the bars
  const lenOf = (v) => (v > 0.0005 ? Math.max(0.15, (v / AX) * LEN) : 0);
  const tipXY = (it, v) => (horiz ? [X0 + lenOf(v), cross(it)] : [cross(it), lenOf(v)]);   // build time only; tick uses the scalar forms below (no per-frame arrays)
  const tipX = (it, v) => (horiz ? X0 + lenOf(v) : cross(it));
  const tipY = (it, v) => (horiz ? cross(it) : lenOf(v));
  const L = (text, o, x, y, z = 0.6) => { const l = holo.label(text, o); l.sprite.position.set(x, y, z); l.yFrac = clamp01(y / HT); return l; };
  const gridMat = holo.line(COL.white, { alpha: 0.16 });

  // ---- axis, gridlines, tick labels ----
  {
    const arr = [];
    if (horiz) {
      for (const v of ticks) {
        const x = X0 + (v / AX) * LEN;
        arr.push(x, 0.7, -0.9, x, ROW0 + (n - 1) * PITCH + T, -0.9);
        const al = L(pctText(v), { w: 256, h: 128, height: 1.2, font: '700 80px Rajdhani', color: '#cfd8ff', glow: pal.hexB }, x, -0.3, 0.3); al.bright = 0.9;
      }
    } else {
      for (const v of ticks) {
        const y = (v / AX) * LEN;
        arr.push(axisX, y, -0.9, axisX + plotW, y, -0.9);
        const al = L(pctText(v), { w: 256, h: 128, height: 1.2, font: '700 80px Rajdhani', color: '#cfd8ff', glow: pal.hexB, align: 'right' }, axisX - 0.4, y, 0.3); al.bright = 0.9;
      }
    }
    root.add(lineSeg(new Float32Array(arr), gridMat));
    // baseline + axis spine + a floor frame for depth
    const base = horiz
      ? [X0, 0.7, 0.2, X0, ROW0 + (n - 1) * PITCH + T, 0.2]
      : [axisX, 0, 0.2, axisX + plotW, 0, 0.2, axisX, 0, 0.2, axisX, LEN, 0.2];
    root.add(lineSeg(new Float32Array(base), holo.line(pal.a, { alpha: 0.85, glow: 1.8 })));
    // swings: a gold 50% line labelled TOSS-UP so crossing it is visible
    if (sw && AX >= 0.5) {
      const gold = holo.line(new THREE.Color(GOLD), { alpha: 0.6, glow: 1.5 });
      if (horiz) { const x = X0 + (0.5 / AX) * LEN; root.add(lineSeg(new Float32Array([x, 0.7, -0.5, x, ROW0 + (n - 1) * PITCH + T, -0.5]), gold)); const tl = L('TOSS-UP', { w: 384, h: 96, height: 1.1, font: '700 70px Rajdhani', color: '#ffe28a', glow: GOLD }, x, -1.4, 0.3); tl.bright = 0.95; }
      else { const y = (0.5 / AX) * LEN; root.add(lineSeg(new Float32Array([axisX, y, -0.5, axisX + plotW, y, -0.5]), gold)); const tl = L('TOSS-UP', { w: 384, h: 96, height: 1.1, font: '700 70px Rajdhani', color: '#ffe28a', glow: GOLD, align: 'left' }, axisX + plotW + 0.5, y, 0.3); tl.bright = 0.95; }
    }
    if (!horiz) {
      const x0 = axisX, x1 = axisX + plotW, z0 = -2.2, z1 = 2;
      root.add(lineSeg(new Float32Array([x0, 0.02, z0, x1, 0.02, z0, x1, 0.02, z0, x1, 0.02, z1, x1, 0.02, z1, x0, 0.02, z1, x0, 0.02, z1, x0, 0.02, z0]), holo.line(pal.b, { alpha: 0.4 })));
    }
  }

  // ---- bars ----
  const boxG = new THREE.BoxGeometry(1, 1, 1); if (horiz) boxG.translate(0.5, 0, 0); else boxG.translate(0, 0.5, 0);
  const tickG = new THREE.BoxGeometry(1, 1, 1);
  const bars = items.map((it) => {
    const [x, y] = tipXY(it, 0);
    const mesh = new THREE.Mesh(boxG, holo.mat(it.color, { glow: 1.15 }));
    mesh.position.set(horiz ? X0 : x, horiz ? y : 0.02, 0); root.add(mesh);
    const cap = new THREE.Mesh(tickG, holo.mat(it.color, { flat: 1, alpha: 0.8, glow: 1.1, depthWrite: false, blending: THREE.AdditiveBlending }));
    cap.scale.set(horiz ? 0.12 : T, horiz ? T : 0.12, T * 0.9); root.add(cap);
    // yesterday tick: a thin bright notch across the bar
    let ghost = null;
    if (it.moved) {
      ghost = new THREE.Mesh(tickG, holo.mat(COL.white, { flat: 1, alpha: 0.9, glow: 0.9, depthWrite: false }));
      ghost.scale.set(horiz ? 0.1 : T + 0.9, horiz ? T + 0.7 : 0.1, 0.4);
      const [gx, gy] = tipXY(it, it.prev); ghost.position.set(gx, gy, 0.5); root.add(ghost);
    }
    // name (two lines when long), never shrunk below readable
    const [n1, n2] = splitName(it.name);
    const nameLbl = n2
      ? L(n1, { w: 768, h: 192, height: 2.4, font: '700 78px Rajdhani', color: '#ffffff', glow: it.hex, sub: n2, subColor: '#ffffff', subFont: '700 78px Rajdhani', mainY: 0.3, subY: 0.72, align: horiz ? 'right' : 'center' }, horiz ? X0 - 0.7 : x, horiz ? y : -1.7)
      : L(n1, { w: 768, h: 192, height: 2.4, font: '700 92px Rajdhani', color: '#ffffff', glow: it.hex, align: horiz ? 'right' : 'center' }, horiz ? X0 - 0.7 : x, horiz ? y : -1.7);
    nameLbl.bright = 1; nameLbl.yFrac = horiz ? clamp01(y / HT) : 0;
    const pct = holo.label(pctText(it.prev), horiz
      ? { w: 384, h: 128, height: 1.7, font: '900 104px Orbitron', color: '#ffffff', glow: it.hex, align: 'left' }
      : { w: 512, h: 192, height: 2.2, font: '900 130px Orbitron', color: '#ffffff', glow: it.hex });
    pct.sprite.position.z = 0.7;
    pct.warm(pctSeq(it.prev, it.p));   // prewarm: yesterday -> now
    let chip = null;
    if (it.moved && (horiz || it !== feat)) {   // a vertical feature bar carries its change in the bracket label instead
      const up = it.d > 0, txt = `${up ? '▲' : '▼'} ${Math.abs(Math.round(it.d * 100))} ${Math.abs(Math.round(it.d * 100)) === 1 ? 'PT' : 'PTS'}`;
      chip = holo.label(txt, { w: 384, h: 96, height: horiz ? 1.6 : 1.6, font: '700 70px Rajdhani', color: up ? GREEN : RED, glow: up ? GREEN : RED, align: horiz ? 'left' : 'center' });
      chip.base = chip.sprite.scale.clone(); chip.sprite.scale.setScalar(0.001); chip.bright = 0;
      chip.sprite.position.set(x, y, 0.7); chip.yFrac = clamp01((horiz ? y : 4) / HT);
    }
    return { it, mesh, cap, ghost, pct, chip, x, y, txt: '', cr: cross(it) };
  });
  const lead = bars[0];

  // ---- feature extras: BIGGEST MOVE tag, WAS label, delta bracket, pulsing ring ----
  let tag = null, wasLbl = null, brLbl = null, bracket = null, pulse = null, swHead = null, swBadge = null, swBadgeScale = null;
  const sinceTxt = sw && Number.isFinite(sw.since) ? (sw.since < 90 ? `${Math.round(sw.since)} MIN AGO` : `${Math.round(sw.since / 60)}H AGO`) : (sw?.window === '1h' ? 'AN HOUR AGO' : 'YESTERDAY');
  const fb = feat ? bars.find((b) => b.it === feat) : null;
  if (fb) {
    const up = feat.d > 0, dc = up ? GREEN : RED, dcol = new THREE.Color(dc);
    const isLead = fb === lead;
    tag = holo.label('BIGGEST MOVE', { w: 512, h: 96, height: 1.25, font: '700 62px Rajdhani', color: '#fff3c4', glow: GOLD, align: horiz ? 'left' : 'center' });
    tag.sprite.position.z = 0.7; tag.bright = 0;
    const was = pctText(feat.prev);
    if (horiz) {
      wasLbl = L(`WAS ${was}`, { w: 384, h: 96, height: 1.3, font: '700 66px Rajdhani', color: '#ffffff', glow: '#ffffff' }, fb.x, fb.y, 0.7);
    } else {
      wasLbl = L(`WAS ${was}`, { w: 384, h: 160, height: 1.8, font: '700 70px Rajdhani', color: '#ffffff', glow: '#ffffff', sub: sw ? sinceTxt : 'YESTERDAY', subColor: '#cfd8ff', subFont: '600 56px Rajdhani', align: 'right', mainY: 0.32, subY: 0.74 }, fb.x, fb.y, 0.7);
    }
    wasLbl.bright = 0;
    // bracket between the ghost tick and the cap (geometry rebuilt in tick as the bar moves)
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    bracket = new THREE.LineSegments(g, holo.line(dcol, { alpha: 0.95, glow: 1.8 })); bracket.frustumCulled = false; root.add(bracket);
    // the bracket's arrowhead mesh is for the leaderboard only: the column board's bracket label already starts with the same ▲/▼ glyph (they read as a double ▲ side by side)
    if (horiz) { swHead = new THREE.Mesh(new THREE.CircleGeometry(0.5, 3), holo.mat(dcol, { flat: 1, glow: 2, alpha: 1, side: THREE.DoubleSide, depthWrite: false })); swHead.rotation.z = up ? 0 : Math.PI; swHead.visible = false; root.add(swHead); }
    if (!horiz) {
      brLbl = holo.label(`${up ? '▲' : '▼'} ${Math.abs(Math.round(feat.d * 100))} PTS`, { w: 384, h: 96, height: 1.7, font: '700 76px Rajdhani', color: dc, glow: dc, align: 'left' });
      brLbl.sprite.position.z = 0.7; brLbl.bright = 0;
    }
    // pulsing gold ring on the feature bar when it is not the leader
    if (!isLead) {
      pulse = new THREE.Mesh(new THREE.TorusGeometry(horiz ? T * 0.95 : T * 0.95, 0.06, 8, 40), holo.mat(COL.gold, { flat: 1, alpha: 0.95, glow: 2, depthWrite: false, blending: THREE.AdditiveBlending }));
      if (horiz) pulse.rotation.y = Math.PI / 2; else pulse.rotation.x = Math.PI / 2;
      root.add(pulse);
    }
  }
  // leader halo
  const halo = new THREE.Mesh(new THREE.TorusGeometry(T * 1.15, 0.05, 8, 48), holo.mat(lead.it.color, { flat: 1, alpha: 0.9, glow: 2, depthWrite: false, blending: THREE.AdditiveBlending }));
  if (horiz) halo.rotation.y = Math.PI / 2; else halo.rotation.x = Math.PI / 2;
  root.add(halo);
  // swing badge: FLIPPED (crossed 50%) / LONGSHOT SURGES / FAVORITE SLIPPING, in the gap between the two tallest bars
  if (sw && fb && Math.abs(feat.d) >= 0.005) {
    const up = feat.d > 0, dcol = up ? GREEN : RED, flipped = !!sw.flipped, nP = Math.round(Math.abs(feat.d) * 100);
    const shapeTxt = sw.shape === 'longshot' ? 'LONGSHOT SURGES' : sw.shape === 'slipping' ? 'FAVORITE SLIPPING' : up ? 'BIG JUMP' : 'BIG DROP';
    const bMain = flipped ? 'FLIPPED' : shapeTxt, bSub = flipped ? (sw.shape === 'swing' ? 'CROSSED 50%' : shapeTxt) : `${nP} PTS ${sw.window === '1h' ? 'IN AN HOUR' : 'IN 24 HOURS'}`;
    let bx = 0, by = 0, bh = 2.2, ok = true;
    if (horiz) { bx = X0 + LEN * 0.8; by = ROW0; ok = items[n - 1].p / AX < 0.5; bh = 1.9; }
    else if (n >= 2) { bx = cross(items[1]); by = LEN + 2.0; bh = Math.min(2.2, (Math.abs(cross(items[0]) - cross(items[1])) - T - 0.2) / 3.2); }
    else { bx = axisX + plotW / 2; by = LEN * 0.5; }
    if (ok && bh > 1.2) {
      swBadge = holo.label(bMain, { w: 640, h: 200, height: bh, font: '900 96px Orbitron', color: '#ffffff', glow: flipped ? GOLD : dcol, sub: bSub, subColor: flipped ? '#ffe28a' : '#dfe8ff', subFont: '700 60px Rajdhani', mainY: 0.34, subY: 0.8, plate: true });
      swBadge.sprite.position.set(bx, by, 0.9); swBadge.yFrac = clamp01(by / HT); swBadge.bright = 0; swBadgeScale = swBadge.sprite.scale.clone(); swBadge.flipped = flipped;
    }
  }

  // ---- header (flips YESTERDAY -> NOW) and footer ----
  const hdrY = horiz ? ROW0 + (n - 1) * PITCH + T + 1.8 : LEN + 6.4;
  const hdr = L(anyMove ? 'YESTERDAY' : '', { w: 1024, h: 128, height: 1.6, font: '800 76px Rajdhani', color: '#dfe8ff', glow: pal.hexB }, horiz ? X0 + LEN / 2 : axisX + plotW / 2, hdrY, 0.7);
  hdr.bright = anyMove ? 0 : 0; hdr.yFrac = 0.2;
  const srcs = [...new Set(markets.map((m) => String(m.source || '').toUpperCase()).filter(Boolean))];
  const vol = Number.isFinite(story.volume24h) ? story.volume24h : markets.reduce((a, m) => a + (m.volume24h || 0), 0);
  const total = (story.markets || []).length;
  let note = null, noteCol = '#ffb13b';
  if (total > 5) { note = `TOP 5 OF ${total} OUTCOMES`; noteCol = '#9fe8ff'; } else if (Math.abs(rawSum - 1) > 0.15) note = "OUTCOMES DON'T SUM TO 100%";
  const foot = ['CHANCE OF EACH OUTCOME', srcs.join(' + '), vol > 0 ? `${money(vol)} TODAY` : '', story.thin ? 'THIN MARKET' : ''].filter(Boolean).join(' · ');
  const footY = horiz ? -2.7 : -4.6;
  const fl = L(foot, { w: 1792, h: note ? 176 : 96, height: note ? 2.4 : 1.3, font: '700 58px Rajdhani', color: '#cfd8ff', glow: pal.hexB, sub: note, subColor: noteCol, subFont: '700 58px Rajdhani', mainY: note ? 0.3 : 0.5, subY: 0.74 }, horiz ? X0 + LEN / 2 : axisX + plotW / 2, footY, 0.7);
  fl.yFrac = 0.02; fl.bright = 0.9;
  holo.bx = horiz ? [-20, 20] : [axisX - 3, axisX + plotW + 2];

  // ---- animation ----
  // Per-frame work is scalar math only (no arrays / vectors / closures), the bracket buffer is rewritten only when its ends move, and the
  // counting % labels (each redraw = canvas draw + texture upload) are spread over frames: bar i may redraw on every MOD-th frame only (offset by
  // its rank), so several moving bars never upload in the same frame. The landing value always draws.
  const TA0 = 0.35, TB = anyMove ? 2.2 : 99, TCHIP = TB + 1.2;
  const MOD = n <= 3 ? 2 : 3;
  const UP = new THREE.Vector3(0, 1, 0), vecA = new THREE.Vector3();
  const leadTX = tipX(lead.it, lead.it.p), leadTY = tipY(lead.it, lead.it.p);
  const fGX = fb ? tipX(fb.it, fb.it.prev) : 0, fGY = fb ? tipY(fb.it, fb.it.prev) : 0;
  const toss = sw && AX >= 0.5 ? (0.5 / AX) * LEN : -1;
  let hdrState = 0, emitAcc = 0, frameN = 0, brTx = NaN, brTy = NaN;
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    frameN++;
    const b2 = ease.inOut(clamp01((ts - TB) / 1.5));
    if (anyMove) {
      const st = ts < 0.5 ? 0 : ts < TB ? 1 : 2;
      if (st !== hdrState) { hdrState = st; hdr.set(st === 2 ? 'NOW · WHITE TICK = YESTERDAY' : 'YESTERDAY'); hdr.bright = st ? 1 : 0; }
    }
    for (let bi = 0; bi < bars.length; bi++) {
      const b = bars[bi], it = b.it;
      const a = ease.out(clamp01((ts - TA0 - it.rank * 0.12) / 0.9));
      const vNow = it.prev + (it.p - it.prev) * b2;
      const len = lenOf(vNow * a);
      const tx = horiz ? X0 + len : b.cr, ty = horiz ? b.cr : len;
      if (horiz) b.mesh.scale.set(Math.max(0.01, len), T, T * 0.9); else b.mesh.scale.set(T, Math.max(0.01, len), T * 0.9);
      b.cap.position.set(tx, ty, 0);
      if (b.ghost) b.ghost.visible = a > 0.9;
      const txt = pctText(vNow);
      if (txt !== b.txt && (b2 >= 1 || (frameN + it.rank) % MOD === 0 || b.txt === '')) { b.txt = txt; b.pct.set(txt); }
      b.pct.bright = a > 0.05 ? 1 : 0;
      const oy = horiz ? ty : ty + 1.8;
      b.pct.sprite.position.x = horiz ? tx + 0.6 : tx; b.pct.sprite.position.y = oy;
      b.pct.yFrac = clamp01(oy / HT * 0.8);
      if (b.chip) {
        const k = ease.back(clamp01((ts - TCHIP - it.rank * 0.08) / 0.45)), ks = Math.max(0.001, k);
        b.chip.sprite.scale.set(b.chip.base.x * ks, b.chip.base.y * ks, 1);
        b.chip.bright = k > 0.02 ? 1 : 0;
        if (horiz) b.chip.sprite.position.set(tx + 4.3, ty, 0.7); else {
          let cy = ty + 3.7;
          if (toss >= 0 && Math.abs(cy - toss) < 1.0) cy = toss + 1.0;   // keep the chip off the TOSS-UP line
          b.chip.sprite.position.x = tx; b.chip.sprite.position.y = cy;
        }
        b.chip.yFrac = clamp01(ty / HT * 0.8);
      }
    }
    // halo on the leader's tip
    {
      const v = (lead.it.prev + (lead.it.p - lead.it.prev) * b2) * ease.out(clamp01((ts - TA0) / 0.9));
      const lt = lenOf(v), tx = horiz ? X0 + lt : lead.cr, ty = horiz ? lead.cr : lt;
      const bob = Math.sin(t * 2) * 0.25;
      halo.position.set(horiz ? tx + 0.3 + bob : tx, horiz ? ty : ty + 0.5 + bob, 0);
      halo.rotation[horiz ? 'x' : 'z'] = t * 0.7;
      halo.scale.setScalar(clamp01((ts - 0.9) * 2));
    }
    if (fb) {
      const it = fb.it, a = ease.out(clamp01((ts - TA0 - it.rank * 0.12) / 0.9));
      const fl = lenOf((it.prev + (it.p - it.prev) * b2) * a), tx = horiz ? X0 + fl : fb.cr, ty = horiz ? fb.cr : fl;
      const gx = fGX, gy = fGY;
      const k = clamp01((ts - TCHIP) / 0.5);
      // BIGGEST MOVE tag + WAS label appear with the move
      wasLbl.bright = ts > TB - 0.3 ? 1 : 0;
      tag.bright = ts > TB - 0.3 ? 1 : 0;
      if (horiz) {
        tag.sprite.center.set(0, 0.5); tag.sprite.position.set(X0 + 0.1, fb.y + T / 2 + 0.85, 0.7);
        wasLbl.sprite.position.set(gx, fb.y + T / 2 + 0.85, 0.7);
      } else {
        tag.sprite.position.set(fb.x, ty + (fb.chip ? 5.3 : 3.6), 0.7);
        wasLbl.sprite.position.set(fb.x - T / 2 - 0.8, gy, 0.7);
      }
      tag.yFrac = clamp01(tag.sprite.position.y / HT * 0.8);
      // delta bracket: line from ghost to tip, with end ticks (the buffer is only rewritten and re-uploaded when the tip moved)
      if (tx !== brTx || ty !== brTy) {
        brTx = tx; brTy = ty;
        const pos = bracket.geometry.attributes.position.array;
        if (horiz) {
          const y = fb.y - T / 2 - 0.35;
          pos[0] = gx; pos[1] = y; pos[2] = 0.5; pos[3] = tx; pos[4] = y; pos[5] = 0.5; pos[6] = gx; pos[7] = y; pos[8] = 0.5;
          pos[9] = gx; pos[10] = y + 0.35; pos[11] = 0.5; pos[12] = tx; pos[13] = y; pos[14] = 0.5; pos[15] = tx; pos[16] = y + 0.35; pos[17] = 0.5;
        } else {
          const x = fb.x + T / 2 + 0.9;
          pos[0] = x; pos[1] = gy; pos[2] = 0.5; pos[3] = x; pos[4] = ty; pos[5] = 0.5; pos[6] = x - 0.5; pos[7] = gy; pos[8] = 0.5;
          pos[9] = x; pos[10] = gy; pos[11] = 0.5; pos[12] = x - 0.5; pos[13] = ty; pos[14] = 0.5; pos[15] = x; pos[16] = ty; pos[17] = 0.5;
        }
        bracket.geometry.attributes.position.needsUpdate = true;
      }
      bracket.visible = ts > TB && Math.abs(ty - gy) + Math.abs(tx - gx) > 0.2;
      if (swHead) { swHead.visible = bracket.visible; swHead.position.set(tx - (it.d > 0 ? 0.3 : -0.3), fb.y - T / 2 - 0.35, 0.5); }
      if (brLbl) {
        const my = (gy + ty) / 2;
        brLbl.sprite.position.set(fb.x + T / 2 + 1.7, my, 0.7); brLbl.yFrac = clamp01(my / HT * 0.8);
        brLbl.bright = k > 0.02 ? 1 : 0;
      }
      if (pulse) {
        pulse.visible = ts > TB; const s = 1 + 0.18 * Math.sin(t * 5);
        pulse.position.set(horiz ? tx + 0.3 : tx, horiz ? ty : ty + 0.4, 0); pulse.scale.setScalar(s);
      }
    }
    if (swBadge) { const bk = ease.back(clamp01((ts - TCHIP - 0.2) / 0.5)), bs = Math.max(0.001, bk) * (1 + (swBadge.flipped ? 0.05 * Math.sin(t * 4) : 0)); swBadge.bright = bk > 0.02 ? 1 : 0; swBadge.sprite.scale.set(swBadgeScale.x * bs, swBadgeScale.y * bs, 1); }
    root.rotation.y = Math.sin(t * 0.17) * 0.05;
    emitAcc += dt;
    if (this.visible && ts > TCHIP && emitAcc > 0.5) {
      emitAcc = 0;
      fx.stream(root.localToWorld(vecA.set(leadTX, leadTY + 0.4, 0).clone()), lead.it.color, 5, UP, { speed: 2.2, lifeS: 1.5, sz: 0.7 });
    }
  };
  holo.pose = function () {
    const [bx0, bx1] = this.bx, y0 = horiz ? -4.2 : -6.2, y1 = horiz ? 20.2 : 17.4;
    const tgt = this.station.clone().add(new THREE.Vector3((bx0 + bx1) / 2, (y0 + y1) / 2 - 1, -1));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 2.5, 40)), orbit: 0.08, box: boxAt(this.station, bx0, y0, -3, bx1, y1, 2) };
  };
  return holo;
}
