// FINANCE: a stock / index / bond yield / oil / gold as a three-part hologram.
//   TOP    a 5-day intraday price chart (price ticks on the left, trading days along the bottom, yesterday's close as a dashed line). The older
//          days are drawn in the accent colour; today's session is highlighted in up-green / down-red with a band behind it and a bracket from
//          yesterday's close to the live price. A tracer redraws the five days once, day labels light up as it passes them, the beacon lands on the price.
//   MIDDLE a 1-month daily line for context, with the 5-day window marked on it.
//   BOTTOM the paired prediction-market odds as small bars (the day's move is the bright segment on each bar), linked to the live price by a
//          spine that pulses odds-ward every few seconds. The price is a fact (delayed quote); the bars are odds, labelled as such.
// The story carries story.finance (see js/finance.js). Read-only: it never writes state.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, boxAt, reveal } from '../holo.js';
import { lineSeg, lineStrip } from './parts.js';
import { fmtVal, finDir, moveShortFin, finKindLabel } from '../../finance.js';
import { exchangeName, money, ptsOf } from '../../util.js';

const L = 40, X0 = -L / 2, X1 = X0 + L;                  // chart x range (-20 .. 20); content spans about -26.5 .. 24
const XL = X0 - 6.4;                                       // left edge for left-aligned labels
const SPINE = X1 + 2.6;
const HC = 15, HM = 5, ROW = 2.9;
const NY = 'America/New_York';
const fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: NY });
const fmtWk = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short' });
const fmtMd = new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', day: 'numeric' });
const ease = (k) => { k = clamp01(k); return 1 - Math.pow(1 - k, 3); };

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
const decFor = (step) => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);
const sample = (a, max) => { if (a.length <= max) return a; const k = Math.ceil(a.length / max), out = a.filter((_, i) => i % k === 0); if (out[out.length - 1] !== a[a.length - 1]) out.push(a[a.length - 1]); return out; };

export function createFinance(ctx, story, opts = {}) {
  const { pal, fx } = ctx;
  const fi = story.finance || story.fin;
  const dir = finDir(fi), dirCol = dir > 0 ? COL.up : dir < 0 ? COL.down : COL.gold, dirHex = dir > 0 ? '#3dff8a' : dir < 0 ? '#ff5a86' : '#ffd23f';
  const pairs = (fi.pairs || []).slice(0, 3), nP = pairs.length;

  // ---- series: 5 days intraday, else the month, else yesterday's close -> now
  const nowMs = fi.updated || Date.now();
  let mode = '5d', raw = fi.intraday;
  if (!(raw && raw.length >= 8)) { mode = fi.month?.length >= 5 ? '1m' : '2pt'; raw = mode === '1m' ? fi.month : [{ t: nowMs - 864e5, p: Number.isFinite(fi.prev) ? fi.prev : fi.price }, { t: nowMs, p: fi.price }]; }
  const ser = sample(raw, 150), N = ser.length;
  const dayOf = ser.map((s) => fmtDay.format(s.t));
  const lastDay = dayOf[N - 1];
  let iT = mode === '5d' || mode === '2pt' ? dayOf.indexOf(lastDay) : N - 2;     // first bar of today's session
  if (iT > N - 2) iT = N - 2; if (iT < 0) iT = 0;
  const prev = Number.isFinite(fi.prev) ? fi.prev : NaN;

  // ---- layout, bottom to top
  let cur = nP ? 2.1 : 0.5;                               // the odds footer (source, size, thin flag) sits under the rows
  const oddsRow0 = cur;                                   // bottom of the lowest row
  let oddsTitleY = 0;
  if (nP) { cur += nP * ROW; oddsTitleY = cur + 0.95; cur += 2.2; }
  const hasMonth = mode === '5d' && fi.month?.length >= 5;
  let yM0 = 0, yM1 = 0, monthLabelY = 0;
  if (hasMonth) { monthLabelY = cur + 0.8; yM0 = cur + 2.0; yM1 = yM0 + HM; cur = yM1 + 2.4; } else cur += 0.6;
  const dayLabelY = cur + 0.8, yC0 = cur + 2.0, yC1 = yC0 + HC, titleY = yC1 + 2.7;
  const topY = titleY + 1.8, midY = topY * 0.5;

  const holo = new Holo(ctx, { axis: 'x', width: 54, height: topY });
  holo.revealDur = 1.5;
  const root = holo.root;
  const xf = (x) => clamp01((x + 27) / 54);              // where a label sits along the x reveal sweep
  const label = (text, o, x, y, z = 0.4) => { const l = holo.label(text, o); l.sprite.position.set(x, y, z); l.yFrac = xf(x); return l; };

  // ---- y scale of the main chart (prices + yesterday's close, padded)
  let lo = Math.min(...ser.map((s) => s.p)), hi = Math.max(...ser.map((s) => s.p));
  if (Number.isFinite(prev) && mode !== '1m') { lo = Math.min(lo, prev); hi = Math.max(hi, prev); }
  const pad = Math.max((hi - lo) * 0.16, fi.price * 0.0006, 1e-6);
  lo -= pad; hi += pad;
  const yOf = (p) => yC0 + ((p - lo) / (hi - lo)) * HC;
  const xOf = (i) => X0 + (L * i) / Math.max(1, N - 1);
  const pts = ser.map((s, i) => new THREE.Vector3(xOf(i), yOf(s.p), 0));
  const last = pts[N - 1], xT = pts[iT].x;

  // ---- grid: price ticks (left), trading-day dividers and names (bottom)
  {
    const step = niceStep((hi - lo) / 4), dec = decFor(step), hl = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = yOf(v);
      hl.push(X0 - 0.6, y, 0.1, X1 + 0.6, y, 0.1);
      label(fmtVal(fi, v, dec), { w: 420, h: 112, height: 1.75, font: '800 84px Rajdhani', color: '#f4f7ff', glow: pal.hexB, align: 'right', plate: false }, X0 - 0.9, y).sprite.center.set(1, 0.5);
    }
    root.add(lineSeg(new Float32Array(hl), holo.line(COL.white, { alpha: 0.14 })));
    // axes
    root.add(lineSeg(new Float32Array([X0, yC0, 0.1, X1 + 0.6, yC0, 0.1, X0, yC0, 0.1, X0, yC1 + 0.6, 0.1]), holo.line(pal.a, { alpha: 0.7 })));
  }
  const dayLabels = [];
  if (mode === '5d' || mode === '2pt') {
    const groups = [];
    dayOf.forEach((d, i) => { const g = groups[groups.length - 1]; if (g && g.d === d) g.i1 = i; else groups.push({ d, i0: i, i1: i }); });
    const dv = [];
    groups.forEach((g, gi) => {
      const xa = pts[g.i0].x, xb = pts[Math.min(N - 1, g.i1)].x;
      if (gi > 0) dv.push(xa, yC0, 0.1, xa, yC1 + 0.3, 0.1);
      const isToday = gi === groups.length - 1;
      const wk = fmtWk.format(ser[g.i0].t).toUpperCase();
      const txt = isToday ? (fmtDay.format(Date.now()) === g.d ? 'TODAY' : `${wk} · LAST DAY`) : wk;
      const l = label(txt, { w: 480, h: 112, height: 1.6, font: `${isToday ? 900 : 700} 78px Rajdhani`, color: isToday ? dirHex : '#d9ccff', glow: isToday ? dirHex : pal.hexB, plate: false }, (xa + Math.max(xb, xa + 2)) / 2, dayLabelY);
      l.bright = 0; dayLabels.push({ l, x: (xa + xb) / 2, xa, tgt: 0, v: 0 });
    });
    if (dv.length) root.add(lineSeg(new Float32Array(dv), holo.line(pal.b, { alpha: 0.2 })));
  } else {
    [[0, fmtMd.format(ser[0].t).toUpperCase()], [Math.round((N - 1) / 2), fmtMd.format(ser[Math.round((N - 1) / 2)].t).toUpperCase()], [N - 1, 'TODAY']].forEach(([i, t]) => { const l = label(t, { w: 480, h: 112, height: 1.6, font: '700 78px Rajdhani', color: '#d9ccff', glow: pal.hexB, plate: false }, pts[i].x, dayLabelY); l.bright = 0; dayLabels.push({ l, x: pts[i].x, xa: pts[i].x, tgt: 0, v: 0 }); });
  }

  // ---- today's band, yesterday's close
  const band = new THREE.Mesh(new THREE.PlaneGeometry(X1 - xT, HC), holo.mat(dirCol, { flat: 1, alpha: 0.075, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, glow: 1.2 }));
  band.position.set((xT + X1) / 2, (yC0 + yC1) / 2, -0.15); root.add(band);
  const hasPrev = Number.isFinite(prev) && mode !== '1m';
  if (hasPrev) {
    const y = yOf(prev), d = [];
    for (let x = xT; x < X1 + 0.6; x += 1.3) d.push(x, y, 0.2, Math.min(X1 + 0.6, x + 0.8), y, 0.2);
    root.add(lineSeg(new Float32Array(d), holo.line(COL.gold, { alpha: 0.85, glow: 1.5 })));
    const above = fi.price < prev;
    label(`${mode === '5d' && fmtDay.format(Date.now()) === lastDay ? 'YESTERDAY\'S CLOSE' : 'PREVIOUS CLOSE'} ${fmtVal(fi, prev)}`, { w: 900, h: 112, height: 1.6, font: '800 72px Rajdhani', color: '#fff0a8', glow: '#ffd23f', align: 'left', plate: true }, xT + 0.8, y + (above ? 1.25 : -1.25), 0.5);
  }

  // ---- the price line: older days in the accent, today's session in up/down colour (tube + area fill each)
  const tubeSegs = (n) => Math.max(8, (n - 1) * 2), TUBE_IDX = 8 * 6;
  const mkTube = (sub, radius, mat) => {
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sub, false, 'catmullrom', 0.15), tubeSegs(sub.length), radius, 8, false), mat);
    root.add(m); return { m, segs: tubeSegs(sub.length) };
  };
  // same shader source as the ribbon's fill, so the program compiled in warm-up is reused
  const mkFill = (sub, c1, c2, base = yC0) => {
    const n = sub.length, pos = new Float32Array(n * 2 * 3), av = new Float32Array(n * 2), idx = [];
    for (let i = 0; i < n; i++) {
      const p = sub[i];
      pos.set([p.x, base, 0], i * 6); pos.set([p.x, p.y, 0], i * 6 + 3); av[i * 2] = 0; av[i * 2 + 1] = 1;
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aV', new THREE.BufferAttribute(av, 1)); g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { ...reveal.uniforms(), uColor: { value: c1.clone() }, uColor2: { value: c2.clone() } },
      vertexShader: `attribute float aV; varying float vV; varying vec3 vW; void main(){ vV = aV; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; varying float vV;
        ${reveal.glsl}
        void main(){ float rv; float scan = revealScan(rv);
          float lines = 0.75 + 0.25 * sin(vW.y * 14.0 + uTime * 1.5);
          float cols = 0.9 + 0.1 * sin(vW.x * 2.0 - uTime * 3.0);
          float a = mix(0.05, 0.8, pow(max(vV, 1e-4), 1.5)) * lines * cols;
          gl_FragColor = vec4(mix(uColor, uColor2, vV) * (a + scan * 0.8) * uFade, 1.0); }`,
    });
    holo.reg(m);
    const mesh = new THREE.Mesh(g, m); root.add(mesh); return { mesh, n };
  };
  const old = iT >= 1 ? { pts: pts.slice(0, iT + 1) } : null;
  const tod = { pts: pts.slice(iT) };
  if (old) { old.tube = mkTube(old.pts, 0.13, holo.mat(pal.a, { flat: 1, glow: 1.5 })); old.fill = mkFill(old.pts, pal.b, pal.a); }
  tod.tube = mkTube(tod.pts, 0.24, holo.mat(dirCol, { flat: 1, glow: 1.9 })); tod.fill = mkFill(tod.pts, dirCol.clone().multiplyScalar(0.5), dirCol);
  const setSub = (part, u) => {            // u 0..1 of this part's x-span
    u = clamp01(u);
    part.tube.m.geometry.setDrawRange(0, Math.floor(u * part.tube.segs) * TUBE_IDX);
    part.fill.mesh.geometry.setDrawRange(0, Math.floor(u * (part.fill.n - 1)) * 6);
  };

  // ---- beacon, beam, rings and the day-move bracket
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 12), holo.mat(COL.white, { flat: 1, glow: 1.8 }));
  beacon.position.copy(last); root.add(beacon);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 1, 6, 1, true), holo.mat(dirCol, { flat: 1, alpha: 0.55, glow: 1.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.set(last.x, (last.y + yC0) / 2, 0); beam.scale.y = Math.max(0.1, last.y - yC0); root.add(beam);
  const rings = [0, 1].map((i) => { const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), holo.mat(dirCol, { flat: 1, alpha: 0.8, glow: 1.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); r.userData.phase = i / 2; r.position.copy(last); root.add(r); return r; });
  let bracket = null;
  if (hasPrev && dir) {
    const g = new THREE.BoxGeometry(0.2, 1, 0.2); g.translate(0, 0.5, 0);
    bracket = new THREE.Mesh(g, holo.mat(dirCol, { flat: 1, glow: 1.9, side: THREE.DoubleSide }));
    bracket.position.set(X1 + 1.0, yOf(prev), 0.2); bracket.scale.y = 0.001; root.add(bracket);
    root.add(lineSeg(new Float32Array([X1 + 0.3, yOf(prev), 0.2, X1 + 1.7, yOf(prev), 0.2, X1 + 0.3, last.y, 0.2, X1 + 1.7, last.y, 0.2]), holo.line(dirCol, { alpha: 0.8, glow: 1.6 })));
  }
  const lblNow = label(fmtVal(fi, fi.price), { w: 900, h: 300, height: 3.5, font: '900 140px Orbitron', color: '#ffffff', glow: dirHex, sub: `${moveShortFin(fi)}${fmtDay.format(Date.now()) === lastDay ? ' TODAY' : ''}`.toUpperCase(), subColor: dir > 0 ? '#d4ffe6' : dir < 0 ? '#ffd9e0' : '#ffffff', subFont: '800 112px Rajdhani', mainY: 0.3, subY: 0.77 }, X1 - 4.2, Math.min(yC1 + 2.2, last.y + 3.8), 0.6);
  lblNow.bright = 0;
  // title chip (what is plotted) + the honesty line
  label(String(fi.name).toUpperCase(), { w: 1800, h: 200, height: 3.3, font: '900 88px Orbitron', color: '#ffffff', glow: pal.hexA, sub: `${finKindLabel(fi)} · ${mode === '5d' ? 'LAST 5 TRADING DAYS' : mode === '1m' ? 'LAST MONTH' : 'LAST DAY'} · ${fi.delayed ? 'PRICES DELAYED' : 'OFFICIAL CLOSE'}`, subColor: '#eef3ff', subFont: '700 70px Rajdhani', align: 'left', mainY: 0.3, subY: 0.76 }, XL, titleY, 0.5);

  // ---- 1-month context strip
  const month = { pts: [], draw: null };
  if (hasMonth) {
    const m = sample(fi.month, 40), M = m.length;
    let mlo = Math.min(...m.map((s) => s.p)), mhi = Math.max(...m.map((s) => s.p));
    const mp = Math.max((mhi - mlo) * 0.15, fi.price * 0.0006, 1e-6); mlo -= mp; mhi += mp;
    const yM = (p) => yM0 + ((p - mlo) / (mhi - mlo)) * HM;
    const mpts = m.map((s, i) => new THREE.Vector3(X0 + (L * i) / (M - 1), yM(s.p), 0));
    const line = lineStrip(mpts, holo.line(pal.a, { alpha: 0.95, glow: 1.6 })); root.add(line);
    const fill = mkFill(mpts, pal.b, pal.a, yM0);
    month.pts = mpts; month.line = line; month.fill = fill; month.M = M;
    // axes: low / high on the left, first date and "today" along the bottom
    const step = niceStep((mhi - mlo) / 2), dec = decFor(step), hl = [];
    for (let v = Math.ceil(mlo / step) * step; v <= mhi + 1e-9; v += step) {
      hl.push(X0 - 0.4, yM(v), 0.1, X1 + 0.4, yM(v), 0.1);
      label(fmtVal(fi, v, dec), { w: 420, h: 112, height: 1.6, font: '800 80px Rajdhani', color: '#e4e9ff', glow: pal.hexB, align: 'right', plate: false }, X0 - 0.9, yM(v)).sprite.center.set(1, 0.5);
    }
    root.add(lineSeg(new Float32Array([...hl, X0, yM0, 0.1, X1 + 0.4, yM0, 0.1, X0, yM0, 0.1, X0, yM1 + 0.3, 0.1]), holo.line(pal.a, { alpha: 0.4 })));
    // the 5-day window on the month
    const t5 = ser[0].t - 36e5 * 12;
    let wi = m.findIndex((s) => s.t >= t5); if (wi < 0 || wi > M - 3) wi = Math.max(0, M - 6);
    const xb = mpts[wi].x;
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(X1 - xb, HM + 0.4), holo.mat(pal.b, { flat: 1, alpha: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, glow: 1.2 }));
    bm.position.set((xb + X1) / 2, (yM0 + yM1) / 2, -0.1); root.add(bm); month.band = bm;
    root.add(lineSeg(new Float32Array([xb, yM0 - 0.2, 0.2, xb, yM1 + 0.2, 0.2, xb, yM1 + 0.2, 0.2, X1, yM1 + 0.2, 0.2, xb, yM0 - 0.2, 0.2, X1, yM0 - 0.2, 0.2]), holo.line(pal.b, { alpha: 0.85, glow: 1.5 })));
    label('THE 5 DAYS ABOVE', { w: 700, h: 100, height: 1.5, font: '700 62px Rajdhani', color: '#e8fbff', glow: pal.hexB, plate: true }, (xb + X1) / 2, yM1 + 1.25, 0.5);
    label(fmtMd.format(m[0].t).toUpperCase(), { w: 480, h: 112, height: 1.6, font: '700 78px Rajdhani', color: '#d9ccff', glow: pal.hexB, plate: false }, X0 + 1.6, monthLabelY);
    label('TODAY', { w: 480, h: 112, height: 1.6, font: '700 78px Rajdhani', color: '#d9ccff', glow: pal.hexB, plate: false }, X1 - 1.4, monthLabelY);
    const mchg = ((m[M - 1].p - m[0].p) / m[0].p) * 100, md = Math.abs(mchg) < 0.05 ? 0 : mchg > 0 ? 1 : -1;
    const mtxt = fi.kind === 'yield' ? `${md ? (md > 0 ? 'UP' : 'DOWN') : 'FLAT'} ${Math.abs(m[M - 1].p - m[0].p).toFixed(2)} POINTS` : `${md ? (md > 0 ? 'UP' : 'DOWN') : 'FLAT'} ${Math.abs(mchg).toFixed(Math.abs(mchg) >= 10 ? 0 : 1)}%`;
    label(`1 MONTH: ${mtxt}`.replace(/FLAT \d.*$/, 'FLAT'), { w: 1100, h: 100, height: 1.7, font: '800 68px Rajdhani', color: md > 0 ? '#3dff8a' : md < 0 ? '#ff5a86' : '#ffffff', glow: md > 0 ? '#3dff8a' : md < 0 ? '#ff2e55' : pal.hexB, align: 'left', plate: true }, XL, yM1 + 1.25, 0.5);
  }

  // ---- paired odds: bars + the spine that links them to the live price
  const rows = [];
  if (nP) {
    const TX0 = -1.4, TW = 14;
    const ex = [...new Set(pairs.map((m) => exchangeName(m.source).toUpperCase()))].join(' + ');
    const vol = pairs.reduce((a, m) => a + (m.volume24h || 0), 0), thin = pairs.some((m) => m.thin);
    label('WHAT THE MARKETS ARE PRICING · CHANCE, POINTS CHANGED TODAY', { w: 1900, h: 100, height: 1.65, font: '800 66px Rajdhani', color: '#e8fbff', glow: pal.hexB, align: 'left', plate: true }, XL, oddsTitleY, 0.5);
    label(`${ex}${vol > 0 ? ` · ${money(vol).toUpperCase()} TRADED TODAY` : ''}${thin ? ' · THIN MARKET' : ''}`, { w: 2000, h: 100, height: 1.5, font: '700 66px Rajdhani', color: thin ? '#ffcf7a' : '#eef3ff', glow: thin ? '#ffab2e' : pal.hexB, align: 'left', plate: true }, XL, oddsRow0 - 1.15, 0.5);
    const bg = new THREE.BoxGeometry(1, 0.65, 0.3); bg.translate(0.5, 0, 0);
    pairs.forEach((m, i) => {
      const y = oddsRow0 + (nP - 1 - i) * ROW + ROW / 2;
      const p = clamp01(m.yesPrice), before = clamp01(m.yesPrice - (m.change1d || 0)), n = ptsOf(m.change1d || 0) || 0;   // same rounding as the MARKETS card (ptsOf), QUEUED-FIXES 6
      const up = (m.change1d || 0) >= 0, c = up ? COL.up : COL.down;
      label(m.label, { w: 1360, h: 100, height: 1.8, font: '700 70px Rajdhani', color: '#ffffff', glow: pal.hexB, align: 'left', plate: true }, XL, y, 0.5);
      const track = new THREE.Mesh(bg, holo.mat(COL.white, { flat: 1, alpha: 0.14, glow: 1 })); track.position.set(TX0, y, 0); track.scale.x = TW; root.add(track);
      const base = new THREE.Mesh(bg, holo.mat(pal.a, { flat: 1, glow: 1.6 })); base.position.set(TX0, y, 0.05); base.scale.x = 0.001; root.add(base);
      const dseg = new THREE.Mesh(bg, holo.mat(c, { flat: 1, glow: 2, alpha: up ? 1 : 0.8 })); dseg.position.set(TX0 + Math.min(p, before) * TW, y, 0.1); dseg.scale.x = 0.001; root.add(dseg);
      const tick = lineSeg(new Float32Array([TX0 + before * TW, y - 0.55, 0.2, TX0 + before * TW, y + 0.55, 0.2]), holo.line(COL.white, { alpha: 0.7 })); root.add(tick);
      label(`${Math.round(p * 100)}%`, { w: 420, h: 140, height: 2.2, font: '900 96px Orbitron', color: '#ffffff', glow: pal.hexA, plate: true }, TX0 + TW + 3.2, y, 0.5);
      const mv = label(n ? `${up ? '▲' : '▼'} ${Math.abs(n)}` : '● 0', { w: 360, h: 120, height: 2.0, font: '800 84px Rajdhani', color: n ? (up ? '#3dff8a' : '#ff5a86') : '#d9ccff', glow: up ? '#3dff8a' : '#ff2e55', plate: true }, TX0 + TW + 7.6, y, 0.5);
      rows.push({ y, p, before, base, dseg, mv, up, TW, TX0, flare: 0, track });
    });
    // spine: price beacon -> right edge -> down past every row, a node and a stub at each
    const yb = rows[nP - 1].y, sp = [X1 + 0.7, last.y, 0.2, SPINE, last.y, 0.2, SPINE, last.y, 0.2, SPINE, yb, 0.2];
    rows.forEach((r) => sp.push(SPINE, r.y, 0.2, SPINE - 0.9, r.y, 0.2));
    root.add(lineSeg(new Float32Array(sp), holo.line(pal.a, { alpha: 0.75, glow: 1.6 })));
    rows.forEach((r) => { const nd = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), holo.mat(COL.white, { flat: 1, glow: 1.8 })); nd.position.set(SPINE, r.y, 0.2); root.add(nd); });
  }
  const spineA = SPINE - (X1 + 0.7), spineB = last.y - (rows.length ? rows[rows.length - 1].y : last.y), spineLen = spineA + spineB;
  const pulses = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), holo.mat(COL.white, { flat: 1, glow: 2.4 })); m.visible = false; root.add(m); return { m, s: -1 }; });
  const spineAt = (s, out) => (s <= spineA ? out.set(X1 + 0.7 + s, last.y, 0.3) : out.set(SPINE, last.y - (s - spineA), 0.3));

  // ---- animation
  const T = { month0: 0.8, month1: 2.2, odds0: 1.2, chart0: 2.0, chart1: 5.2 };
  const head = new THREE.Vector3(), tmpv = new THREE.Vector3();
  let emitAcc = 0, pulseAcc = 0, lastTs = 0;
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow, F = this.fade;
    // chart tracer
    const sx = ease((ts - T.chart0) / (T.chart1 - T.chart0)), f = sx * (N - 1), i0 = Math.min(N - 2, Math.floor(f)), u = f - i0;
    head.copy(pts[i0]).lerp(pts[Math.min(N - 1, i0 + 1)], u);
    const frac = (x) => (x - X0) / L;                           // 0..1 along the chart
    if (old) setSub(old, sx / Math.max(1e-6, frac(xT)));
    setSub(tod, (sx - frac(xT)) / Math.max(1e-6, 1 - frac(xT)));
    const landed = ts >= T.chart1, on = clamp01((ts - T.chart0 + 0.2) * 2);
    // today's band fades in as the tracer enters today
    band.material.uniforms.uFade.value = F * clamp01((head.x - xT) / Math.max(1, X1 - xT) * 3);
    beacon.position.copy(head); beacon.scale.setScalar(on * (landed ? 1 + 0.15 * Math.sin(t * 5) : 1.35));
    beacon.material.uniforms.uFade.value = F * on;
    beam.position.set(head.x, (head.y + yC0) / 2, 0); beam.scale.y = Math.max(0.05, head.y - yC0);
    beam.material.uniforms.uFade.value = F * on * (landed ? 0.6 + 0.4 * Math.sin(t * 3) : 1);
    for (const r of rings) { const k = (t * 0.7 + r.userData.phase) % 1; r.position.copy(head); r.scale.setScalar(0.5 + k * 3.2); r.material.uniforms.uFade.value = (1 - k) * F * on; r.rotation.y = t * 0.5; }
    lblNow.bright = landed ? clamp01((ts - T.chart1) * 2.5) : 0;
    if (bracket) bracket.scale.y = (last.y - yOf(prev)) * ease((ts - T.chart1) / 0.8) || 0.001;
    for (const d of dayLabels) { d.tgt = head.x >= d.xa - 0.3 ? 1 : 0; d.v += (d.tgt - d.v) * Math.min(1, dt * 9); d.l.bright = d.v; }
    // month strip draws first, then its 5-day window pulses
    if (hasMonth) {
      const pm = ease((ts - T.month0) / (T.month1 - T.month0));
      month.line.geometry.setDrawRange(0, Math.floor(pm * month.M));
      month.fill.mesh.geometry.setDrawRange(0, Math.floor(pm * (month.M - 1)) * 6);
      month.band.material.uniforms.uFade.value = F * clamp01((ts - T.month1) * 2) * (0.75 + 0.25 * Math.sin(t * 2.4));
    }
    // odds bars grow in, staggered; each flares when a pulse reaches it
    rows.forEach((r, i) => {
      const k = ease((ts - T.odds0 - i * 0.22) / 1.1);
      r.base.scale.x = Math.max(0.001, Math.min(r.p, r.before) * r.TW * k);
      r.dseg.scale.x = Math.max(0.001, Math.abs(r.p - r.before) * r.TW * k);
      r.flare = Math.max(0, r.flare - dt * 1.8);
      r.base.material.uniforms.uPulse.value = r.flare * 0.7; r.dseg.material.uniforms.uPulse.value = r.flare * 0.7 + 0.1 * Math.sin(t * 4 + i);
    });
    // pulses: after the price lands, one runs down the spine every ~2.6s
    if (landed && rows.length) {
      pulseAcc += dt;
      if (pulseAcc > 2.6 || lastTs < T.chart1) { pulseAcc = 0; const p = pulses.find((x) => x.s < 0); if (p) p.s = 0; }
    }
    lastTs = ts;
    for (const p of pulses) {
      if (p.s < 0) { p.m.visible = false; continue; }
      const prevS = p.s; p.s += dt * 15;
      spineAt(p.s, tmpv); p.m.position.copy(tmpv); p.m.visible = true; p.m.material.uniforms.uFade.value = F;
      rows.forEach((r) => { const sAt = spineA + (last.y - r.y); if (prevS < sAt && p.s >= sAt) r.flare = 1; });
      if (p.s > spineLen) { p.s = -1; p.m.visible = false; }
    }
    // camera follows the tracer, then pulls back to the whole widget (gentle: a tighter follow pushed the odds rows under the NEXT BIG DECISION chip)
    this.camFocus = ts >= T.chart0 - 0.1 && ts < T.chart1 + 0.2 ? { dx: head.x * 0.25, dy: (head.y - midY) * 0.15, zoom: 0.96 } : null;
    root.rotation.y = Math.sin(t * 0.15) * 0.04;
    emitAcc += dt;
    if (this.visible && ts >= T.chart0 && !landed && emitAcc > 0.07) { emitAcc = 0; fx.stream(root.localToWorld(head.clone()), pal.a, 4, new THREE.Vector3(0, 1, 0), { speed: 2.2, lifeS: 1.2, sz: 0.7 }); }
    else if (this.visible && landed && emitAcc > 0.6) { emitAcc = 0; fx.stream(root.localToWorld(last.clone()), dir > 0 ? pal.a : pal.b, 5, new THREE.Vector3(0, 1, 0), { speed: 1.5, lifeS: 1.8, sz: 0.7 }); }
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, midY, -1));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(-3, 3, 56)), orbit: 0.06, box: boxAt(this.station, -27, -0.3, -2, 26.5, topY + 0.6, 2.5) };
  };
  return holo;
}
